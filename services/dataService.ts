
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, HistoryLog, Tag, Tenant, SubscriptionPlan, PERMISSIONS, TransactionCategory, ExtraFee } from '../types';
import { INITIAL_BOOKINGS, INITIAL_CUSTOMERS, INITIAL_PROPERTIES, INITIAL_ROOMS, INITIAL_ROOM_TYPES, INITIAL_USERS, INITIAL_TAGS, INITIAL_TENANTS, INITIAL_PLANS, INITIAL_TRANSACTION_CATEGORIES } from './mockData';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, get, update, remove, query, limitToLast, orderByChild, equalTo } from "firebase/database";

// Declare XLSX from global scope (loaded via CDN)
declare const XLSX: any;

// --- FIREBASE CONFIGURATION ---
// Coach Katka: Đảm bảo config này khớp với Project thật của bạn
const firebaseConfig = {
  apiKey: "AIzaSyAZOB79Cz0Lj-zrRGmcackL0A3bsRBEwSc",
  authDomain: "k-host-a2a95.firebaseapp.com",
  databaseURL: "https://k-host-a2a95-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "k-host-a2a95",
  storageBucket: "k-host-a2a95.firebasestorage.app",
  messagingSenderId: "875551915320",
  appId: "1:875551915320:web:9516f334551de0a96495cd",
  measurementId: "G-QZPYL00KCV"
};

// Initialize Firebase
let db: any = null;
let isFirebaseReady = false;

// --- MULTI-TENANCY CONTEXT ---
let activeTenantId: string | null = null;
const SYSTEM_TENANT_ID = 'SYSTEM';

// --- IN-MEMORY CACHE (Chỉ dùng để Read nhanh, Write phải đi thẳng lên DB) ---
const CACHE = {
    properties: [] as Property[],
    rooms: [] as Room[],
    roomTypes: [] as RoomType[],
    bookings: [] as Booking[],
    customers: [] as Customer[],
    users: [] as User[],
    history: [] as HistoryLog[],
    tags: [] as Tag[],
    transactionCategories: [] as TransactionCategory[],
    
    tenants: [] as Tenant[],
    plans: [] as SubscriptionPlan[],
    systemUsers: [] as User[] 
};

// --- CORE HELPERS ---

// 1. Path Builder (Atomic Path)
// Thay vì lấy cả cụm, ta lấy ref trỏ thẳng vào item ID
const getRef = (path: string) => {
    if (!db) return null;
    if (!activeTenantId) {
        console.error("⛔ CRITICAL: Missing Tenant ID");
        return null;
    }
    const basePath = activeTenantId === SYSTEM_TENANT_ID ? 'system' : `tenants/${activeTenantId}`;
    return ref(db, `${basePath}/${path}`);
};

// 2. Snapshot Converter (Object -> Array)
// Firebase lưu dạng Object {key: val}, UI cần Array [val]. Hàm này convert chuẩn.
const snapshotToArray = <T>(snap: any): T[] => {
    const val = snap.val();
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(x => x); 
    return Object.values(val); 
};

// 3. Connection Init
const _ensureFirebase = () => {
    if (!isFirebaseReady) {
        try {
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            isFirebaseReady = true;
        } catch (e) {
            console.error("🔥 Firebase connection failed", e);
        }
    }
    return isFirebaseReady;
};

// --- REALTIME SYNC ENGINE ---
const _initRealtimeConnection = (tenantId: string, onDataChange: () => void) => {
    try {
        activeTenantId = tenantId;
        if(!_ensureFirebase()) return;

        console.log(`🔌 Connecting Realtime DB for: [${tenantId}]`);

        // Helper để bind listener và update CACHE
        const bind = <T>(path: string, cacheKey: keyof typeof CACHE) => {
            onValue(getRef(path), (snap) => {
                // @ts-ignore
                CACHE[cacheKey] = snapshotToArray<T>(snap);
                onDataChange(); // Báo cho App.tsx render lại
            });
        };

        if (tenantId === SYSTEM_TENANT_ID) {
             bind<Tenant>('tenants', 'tenants');
             bind<SubscriptionPlan>('plans', 'plans');
             bind<User>('users', 'systemUsers');
             
             // Auto-seed system data if empty
             get(getRef('tenants')).then(snap => { if (!snap.exists()) _seedSystemData(); });
        } else {
            // Business Data Listeners
            bind<Property>('properties', 'properties');
            bind<RoomType>('roomTypes', 'roomTypes');
            bind<Tag>('tags', 'tags');
            bind<TransactionCategory>('transactionCategories', 'transactionCategories');
            bind<Room>('rooms', 'rooms');
            bind<Booking>('bookings', 'bookings');
            bind<Customer>('customers', 'customers');
            
            // Users Sync (Self-Repair)
            onValue(getRef('users'), async (snap) => { 
                const users = snapshotToArray<User>(snap);
                CACHE.users = users;
                
                // Logic tự sửa lỗi mất user khi tạo tenant mới
                if (users.length === 0) {
                    try {
                        const sysUsersRef = ref(db, 'system/users');
                        // FIX: Client-side filtering instead of orderByChild to avoid index error
                        const sysSnap = await get(sysUsersRef);
                        if (sysSnap.exists()) {
                            const allSysUsers = snapshotToArray<User>(sysSnap);
                            const recovered = allSysUsers.filter(u => u.tenantId === tenantId);
                            
                            if (recovered.length > 0) {
                                CACHE.users = recovered;
                                // Write back individually
                                const updates: any = {};
                                recovered.forEach(u => updates[`users/${u.id}`] = u);
                                update(getRef(''), updates);
                            }
                        }
                    } catch (e) { console.error("Self-repair failed", e); }
                }
                onDataChange(); 
            });

            // History Listener (Limit 50)
            const historyQuery = query(getRef('history'), limitToLast(50));
            onValue(historyQuery, (snap) => {
                 CACHE.history = snapshotToArray<HistoryLog>(snap).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                 onDataChange();
            });

            // Auto-seed default data for new tenants
            get(getRef('properties')).then(snap => { if (!snap.exists()) _seedTenantData(tenantId); });
        }
    } catch (e) {
        console.error("🔥 Sync Init Error:", e);
    }
};

// --- SEEDING (ATOMIC WRITE) ---
const _seedSystemData = () => {
    if (!db) return;
    set(ref(db, 'system/tenants'), INITIAL_TENANTS);
    set(ref(db, 'system/plans'), INITIAL_PLANS);
    
    // Seed users as Map to avoid Array index issues
    const usersMap: Record<string, User> = {};
    INITIAL_USERS.forEach(u => usersMap[u.id] = u);
    
    // Auto generate admin for demo tenants
    INITIAL_TENANTS.forEach(t => {
        if (t.adminUsername) {
            const uid = `u_${t.id}_admin`;
            if(!usersMap[uid]) {
                usersMap[uid] = {
                    id: uid, tenantId: t.id, username: t.adminUsername, password: t.adminPassword || '123',
                    fullName: 'Admin', role: UserRole.ADMIN, permissions: Object.values(PERMISSIONS), allowedPropertyIds: []
                };
            }
        }
    });
    set(ref(db, 'system/users'), usersMap);
}

const _seedTenantData = (tenantId: string) => {
    if (!db) return;
    const withT = (arr: any[]) => arr.reduce((acc, item) => ({...acc, [item.id]: {...item, tenantId}}), {});
    
    // Use multi-path update for atomicity
    const updates: any = {};
    updates['properties'] = withT(INITIAL_PROPERTIES);
    updates['rooms'] = withT(INITIAL_ROOMS);
    updates['roomTypes'] = withT(INITIAL_ROOM_TYPES);
    updates['bookings'] = withT(INITIAL_BOOKINGS);
    updates['customers'] = withT(INITIAL_CUSTOMERS);
    updates['tags'] = withT(INITIAL_TAGS);
    updates['transactionCategories'] = withT(INITIAL_TRANSACTION_CATEGORIES);
    
    update(getRef(''), updates);
}

// --- ATOMIC CRUD OPERATIONS (THE FIX) ---

// Generic Helper: Update/Set specific item by ID
const _saveItem = (node: string, item: any) => {
    if (!item.id) return;
    const itemRef = getRef(`${node}/${item.id}`);
    const scopedItem = { ...item, tenantId: activeTenantId };
    
    // Optimistic Update (Cập nhật Cache ngay lập tức để UI mượt)
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const idx = list.findIndex((x:any) => x.id === item.id);
        if (idx > -1) list[idx] = scopedItem;
        else list.push(scopedItem);
    }

    // Server Update (Đây là chỗ quan trọng: Chỉ update đúng node ID đó)
    return set(itemRef, scopedItem).catch(e => console.error(`Save ${node} failed`, e));
}

const _deleteItem = (node: string, id: string) => {
    const itemRef = getRef(`${node}/${id}`);
    
    // Optimistic
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((x:any) => x.id !== id);
    }

    return remove(itemRef).catch(e => console.error(`Delete ${node} failed`, e));
}


// --- DOMAIN SPECIFIC METHODS ---

// 1. LOGIN & USER
const _globalLogin = async (username: string, password: string): Promise<User | null> => {
    _ensureFirebase();
    if (db) {
        try {
            // Find in System Users
            // FIX: Use client-side filtering to avoid needing Firebase Index
            const snap = await get(ref(db, 'system/users'));
            if (snap.exists()) {
                const users = snapshotToArray<User>(snap);
                const found = users.find(u => u.username === username && u.password === password);
                if (found) return found;
            }
        } catch (e) { console.error("Login Error", e); }
    }
    // Fallback Mock
    return INITIAL_USERS.find(u => u.username === username && u.password === password) || null;
}

// 2. LOGGING
const _logAction = (action: HistoryLog['action'], booking: Booking, description: string, staffId: string) => {
    const logId = `log_${Date.now()}`;
    const newLog: HistoryLog = {
        id: logId,
        tenantId: activeTenantId || undefined,
        timestamp: new Date().toISOString(),
        action, description, bookingSnapshot: booking, staffId
    };
    // Push directly to history node
    const logRef = getRef(`history/${logId}`);
    set(logRef, newLog);
};

// 3. BOOKINGS (Atomic)
const _updateRoomStatus = (roomId: string, status: RoomStatus) => {
    // Chỉ update đúng field 'status' của phòng đó
    update(getRef(`rooms/${roomId}`), { status }).catch(console.error);
};

const _addBooking = (booking: Booking) => {
    _saveItem('bookings', booking);
    if (booking.status === BookingStatus.CHECKED_IN) {
        _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED);
    }
    _logAction('CREATE', booking, `Tạo đơn ${booking.id}`, booking.createdBy);
};

const _updateBooking = (booking: Booking) => {
    // Lấy trạng thái cũ từ Cache để so sánh
    const oldBooking = CACHE.bookings.find(b => b.id === booking.id);
    _saveItem('bookings', booking); // Atomic Save

    // Xử lý logic đổi trạng thái phòng
    if (oldBooking && oldBooking.status !== booking.status) {
        if (booking.status === BookingStatus.CHECKED_IN) _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED);
        else if (booking.status === BookingStatus.CHECKED_OUT) _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY);
        else if (booking.status === BookingStatus.CANCELLED) _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN);
        
        let action: HistoryLog['action'] = 'UPDATE';
        if (booking.status === BookingStatus.CHECKED_IN) action = 'CHECK_IN';
        if (booking.status === BookingStatus.CHECKED_OUT) action = 'CHECK_OUT';
        if (booking.status === BookingStatus.CANCELLED) action = 'CANCEL';
        
        _logAction(action, booking, `Đổi trạng thái: ${booking.status}`, booking.createdBy);
    } else {
        _logAction('UPDATE', booking, `Cập nhật thông tin đơn`, booking.createdBy);
    }
};

const _deleteBooking = (id: string, staffId: string): boolean => {
    const booking = CACHE.bookings.find(b => b.id === id);
    if (!booking) return false;
    
    // Soft Delete: Update status to DELETED
    const deletedSnapshot = { ...booking, status: BookingStatus.DELETED };
    _saveItem('bookings', deletedSnapshot);
    
    // Trả phòng về sạch nếu xóa đơn
    if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(booking.status)) {
        _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN);
    }
    
    _logAction('DELETE', deletedSnapshot, `Xóa đơn ${id}`, staffId);
    return true;
};

// 4. OTHER ENTITIES (Atomic Wrappers)
const _saveProperties = (list: Property[]) => {
    // Với các danh sách master data ít thay đổi, có thể chấp nhận ghi đè hoặc loop update
    // Để an toàn, ta dùng multi-path update
    const updates: any = {};
    list.forEach(p => updates[`properties/${p.id}`] = {...p, tenantId: activeTenantId});
    update(getRef(''), updates);
};

const _saveRooms = (list: Room[]) => {
    const updates: any = {};
    list.forEach(r => updates[`rooms/${r.id}`] = {...r, tenantId: activeTenantId});
    update(getRef(''), updates);
};

// --- EXPORT ---
export const DataService = {
  init: _initRealtimeConnection,
  login: _globalLogin,
  findUserByUsername: async (u: string) => {
      // Mock check, real app needs DB query
      return CACHE.systemUsers.find(user => user.username === u) || CACHE.users.find(user => user.username === u) || null;
  },

  // Getters (Read from Cache - Fast)
  getTenants: () => CACHE.tenants,
  getPlans: () => CACHE.plans,
  getSystemUsers: () => CACHE.systemUsers,
  getProperties: () => [...CACHE.properties].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)),
  getRooms: (propId?: string) => {
      let r = [...CACHE.rooms];
      if (propId) r = r.filter(x => x.propertyId === propId);
      return r.sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
  },
  getRoomTypes: () => CACHE.roomTypes,
  getBookings: (propId?: string) => {
      let b = CACHE.bookings.filter(x => x.status !== BookingStatus.DELETED);
      if (propId) b = b.filter(x => x.propertyId === propId);
      return b;
  },
  getCustomers: () => CACHE.customers,
  getUsers: () => CACHE.users,
  getTags: () => CACHE.tags,
  getTransactionCategories: () => CACHE.transactionCategories,
  getHistory: () => CACHE.history,

  // Setters (Write to DB Atomically - Safe)
  saveTenants: (list: Tenant[]) => {
      const updates: any = {};
      list.forEach(i => updates[`system/tenants/${i.id}`] = i);
      update(ref(db, ''), updates);
  },
  deleteTenant: (id: string) => {
      remove(ref(db, `system/tenants/${id}`));
      remove(ref(db, `tenants/${id}`));
      remove(ref(db, `system/users/u_${id}_admin`));
  },
  
  savePlans: (list: SubscriptionPlan[]) => {
       const updates: any = {};
       list.forEach(i => updates[`system/plans/${i.id}`] = i);
       update(ref(db, ''), updates);
  },

  seedTenantAdminUser: (user: User) => {
      const updates: any = {};
      updates[`system/users/${user.id}`] = user;
      updates[`tenants/${user.tenantId}/users/${user.id}`] = user;
      update(ref(db, ''), updates);
  },

  saveProperties: _saveProperties,
  saveRooms: _saveRooms, // Dùng hàm atomic wrapper
  
  saveRoomTypes: (list: RoomType[]) => {
      const updates: any = {};
      list.forEach(i => updates[`roomTypes/${i.id}`] = {...i, tenantId: activeTenantId});
      update(getRef(''), updates);
  },
  
  saveTags: (list: Tag[]) => {
      const updates: any = {};
      list.forEach(i => updates[`tags/${i.id}`] = {...i, tenantId: activeTenantId});
      update(getRef(''), updates);
  },
  
  saveTransactionCategories: (list: TransactionCategory[]) => {
      const updates: any = {};
      list.forEach(i => updates[`transactionCategories/${i.id}`] = {...i, tenantId: activeTenantId});
      update(getRef(''), updates);
  },

  // Atomic Items
  updateRoomStatus: _updateRoomStatus,
  addBooking: _addBooking,
  updateBooking: _updateBooking,
  deleteBooking: _deleteBooking,
  saveBookings: (list: Booking[]) => {
       // Fallback nếu cần save hàng loạt
       const updates: any = {};
       list.forEach(b => updates[`bookings/${b.id}`] = b);
       update(getRef(''), updates);
  },

  addCustomer: (c: Customer) => _saveItem('customers', c),
  
  addUser: (u: User) => {
      _saveItem('users', u);
      // Sync to system lookup
      set(ref(db, `system/users/${u.id}`), u);
  },
  updateUser: (u: User) => {
      _saveItem('users', u);
      set(ref(db, `system/users/${u.id}`), u);
  },
  deleteUser: (id: string) => {
      _deleteItem('users', id);
      remove(ref(db, `system/users/${id}`));
  },

  logAction: _logAction,

  // Utils
  generateBookingId: () => {
      const now = new Date();
      const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `${now.getFullYear().toString().slice(-2)}${(now.getMonth()+1).toString().padStart(2,'0')}-${seq}`;
  },
  
  validateRoomAvailability: (roomId: string, start: string, end: string, excludeId?: string) => {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      const buffer = 30 * 60 * 1000;
      
      const conflict = CACHE.bookings.find(b => {
          if(b.id === excludeId || b.status === BookingStatus.CANCELLED || b.status === BookingStatus.DELETED) return false;
          if(b.roomId !== roomId) return false;
          const bs = new Date(b.checkInDate).getTime();
          const be = new Date(b.checkOutDate).getTime();
          return (s < be + buffer) && (e + buffer > bs);
      });
      
      return conflict ? { valid: false, reason: `Trùng đơn ${conflict.id}` } : { valid: true };
  },

  exportToExcel: (data: any[], fileName: string) => {
      if (typeof XLSX === 'undefined') return alert("Thư viện Excel chưa tải xong");
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      XLSX.writeFile(wb, fileName);
  }
};
