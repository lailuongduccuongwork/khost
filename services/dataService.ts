
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, HistoryLog, Tag, Tenant, SubscriptionPlan, PERMISSIONS, TransactionCategory } from '../types';
import { INITIAL_BOOKINGS, INITIAL_CUSTOMERS, INITIAL_PROPERTIES, INITIAL_ROOMS, INITIAL_ROOM_TYPES, INITIAL_USERS, INITIAL_TAGS, INITIAL_TENANTS, INITIAL_PLANS, INITIAL_TRANSACTION_CATEGORIES } from './mockData';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, get, update, remove, query, limitToLast, orderByChild, equalTo } from "firebase/database";

// Declare XLSX from global scope (loaded via CDN)
declare const XLSX: any;

// --- FIREBASE CONFIGURATION ---
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

// --- IN-MEMORY CACHE ---
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
    
    // System Data
    tenants: [] as Tenant[],
    plans: [] as SubscriptionPlan[],
    systemUsers: [] as User[] 
};

// --- PENDING WRITES LOCK (CRITICAL FOR UI STABILITY) ---
// Map lưu trữ trạng thái đang chờ ghi lên server.
// Key: RoomID, Value: Desired Status
// Dữ liệu từ Server trả về sẽ bị ignore nếu ID nằm trong map này và status chưa khớp.
const _pendingRoomStatus = new Map<string, RoomStatus>();

// Callback listeners
let _dataChangeCallback: () => void = () => {};

// --- CORE HELPERS (ATOMIC PATH BUILDER) ---

const getBaseRef = () => {
    if (!activeTenantId) return null;
    return activeTenantId === SYSTEM_TENANT_ID ? 'system' : `tenants/${activeTenantId}`;
};

// --- CRITICAL FIX: HYBRID DATA PARSER & DEDUPLICATOR ---
const snapshotToArray = <T>(snap: any): T[] => {
    const val = snap.val();
    if (!val) return [];
    
    let rawList: T[] = [];
    
    // 1. Lấy toàn bộ dữ liệu thô bất kể cấu trúc
    if (Array.isArray(val)) {
        rawList = val.filter(x => x); 
    } else if (typeof val === 'object') {
        rawList = Object.values(val);
    }

    // 2. KHỬ TRÙNG LẶP DỰA TRÊN ID & DEEP CLONE (Tránh tham chiếu chéo)
    const uniqueMap = new Map();
    rawList.forEach((item: any) => {
        if (item && typeof item === 'object' && item.id) {
            // QUAN TRỌNG: Spread operator {...item} để tạo bản sao mới, tránh tham chiếu vùng nhớ
            uniqueMap.set(item.id, { ...item });
        }
    });
    
    return Array.from(uniqueMap.values());
};

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
        _dataChangeCallback = onDataChange;

        if(!_ensureFirebase()) return;

        const basePath = getBaseRef();
        if (!basePath) return;

        console.log(`🔌 Listening to: ${basePath}`);

        const bind = <T>(node: string, cacheKey: keyof typeof CACHE) => {
            const nodeRef = ref(db, `${basePath}/${node}`);
            onValue(nodeRef, (snap) => {
                let list = snapshotToArray<T>(snap);

                // --- DATA INTERCEPTOR FOR ROOMS (LATENCY PROTECTION) ---
                if (cacheKey === 'rooms') {
                    // @ts-ignore
                    list = list.map((item: any) => {
                        // Nếu phòng này đang có lệnh chờ ghi (Pending Write)
                        if (_pendingRoomStatus.has(item.id)) {
                            const pendingStatus = _pendingRoomStatus.get(item.id);
                            
                            // Nếu dữ liệu Server đã khớp với lệnh chờ -> Xóa Pending (Đã đồng bộ xong)
                            if (item.status === pendingStatus) {
                                _pendingRoomStatus.delete(item.id);
                                return item;
                            } 
                            
                            // Nếu dữ liệu Server VẪN CŨ (chưa cập nhật kịp) -> GHI ĐÈ bằng dữ liệu Pending
                            // Để UI không bị giật lùi về trạng thái cũ
                            return { ...item, status: pendingStatus };
                        }
                        return item;
                    });
                }

                // @ts-ignore
                CACHE[cacheKey] = list;
                _dataChangeCallback(); 
            });
        };

        if (tenantId === SYSTEM_TENANT_ID) {
             bind<Tenant>('tenants', 'tenants');
             bind<SubscriptionPlan>('plans', 'plans');
             bind<User>('users', 'systemUsers');
             get(ref(db, 'system/tenants')).then(snap => { if (!snap.exists()) _seedSystemData(); });
        } else {
            bind<Property>('properties', 'properties');
            bind<RoomType>('roomTypes', 'roomTypes');
            bind<Tag>('tags', 'tags');
            bind<TransactionCategory>('transactionCategories', 'transactionCategories');
            bind<Room>('rooms', 'rooms');
            bind<Booking>('bookings', 'bookings');
            bind<Customer>('customers', 'customers');
            
            onValue(ref(db, `${basePath}/users`), async (snap) => { 
                const users = snapshotToArray<User>(snap);
                CACHE.users = users;
                
                if (users.length === 0) {
                    try {
                        const sysSnap = await get(ref(db, 'system/users'));
                        if (sysSnap.exists()) {
                            const allSysUsers = snapshotToArray<User>(sysSnap);
                            const recovered = allSysUsers.filter(u => u.tenantId === tenantId);
                            if (recovered.length > 0) {
                                CACHE.users = recovered;
                                const updates: any = {};
                                recovered.forEach(u => updates[`${basePath}/users/${u.id}`] = u);
                                update(ref(db), updates);
                            }
                        }
                    } catch (e) { console.error("Self-repair failed", e); }
                }
                _dataChangeCallback(); 
            });

            const historyQuery = query(ref(db, `${basePath}/history`), limitToLast(50));
            onValue(historyQuery, (snap) => {
                 CACHE.history = snapshotToArray<HistoryLog>(snap).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                 _dataChangeCallback();
            });

            get(ref(db, `${basePath}/properties`)).then(snap => { if (!snap.exists()) _seedTenantData(tenantId); });
        }
    } catch (e) {
        console.error("🔥 Sync Init Error:", e);
    }
};

// --- SEEDING (ATOMIC WRITE MAP) ---
const _seedSystemData = () => {
    if (!db) return;
    const updates: any = {};
    const tenantsMap: any = {}; INITIAL_TENANTS.forEach(t => tenantsMap[t.id] = t);
    const plansMap: any = {}; INITIAL_PLANS.forEach(p => plansMap[p.id] = p);
    updates['system/tenants'] = tenantsMap;
    updates['system/plans'] = plansMap;
    
    const usersMap: Record<string, User> = {};
    INITIAL_USERS.forEach(u => usersMap[u.id] = u);
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
    updates['system/users'] = usersMap;
    update(ref(db), updates);
}

const _seedTenantData = (tenantId: string) => {
    if (!db) return;
    const toMap = (arr: any[]) => arr.reduce((acc, item) => ({...acc, [item.id]: {...item, tenantId}}), {});
    const path = `tenants/${tenantId}`;
    const updates: any = {};
    updates[`${path}/properties`] = toMap(INITIAL_PROPERTIES);
    updates[`${path}/rooms`] = toMap(INITIAL_ROOMS);
    updates[`${path}/roomTypes`] = toMap(INITIAL_ROOM_TYPES);
    updates[`${path}/bookings`] = toMap(INITIAL_BOOKINGS);
    updates[`${path}/customers`] = toMap(INITIAL_CUSTOMERS);
    updates[`${path}/tags`] = toMap(INITIAL_TAGS);
    updates[`${path}/transactionCategories`] = toMap(INITIAL_TRANSACTION_CATEGORIES);
    update(ref(db), updates);
}

// --- ATOMIC CRUD OPERATIONS ---

const _saveItem = (node: string, item: any) => {
    if (!item.id || !activeTenantId || !db) return;
    const basePath = getBaseRef();
    const itemRef = ref(db, `${basePath}/${node}/${item.id}`);
    const scopedItem = { ...item, tenantId: activeTenantId };
    
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const idx = list.findIndex((x:any) => x.id === item.id);
        if (idx > -1) list[idx] = scopedItem;
        else list.push(scopedItem);
    }
    return set(itemRef, scopedItem).catch(e => console.error(`Save ${node} failed`, e));
}

const _deleteItem = (node: string, id: string) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    const itemRef = ref(db, `${basePath}/${node}/${id}`);
    
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((x:any) => x.id !== id);
    }
    return remove(itemRef).catch(e => console.error(`Delete ${node} failed`, e));
}

const _saveListAsMap = (node: string, list: any[]) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    const updates: any = {};
    
    // @ts-ignore
    CACHE[node as keyof typeof CACHE] = list;

    list.forEach(item => {
        if(item && item.id) {
            updates[`${basePath}/${node}/${item.id}`] = { ...item, tenantId: activeTenantId };
        }
    });
    update(ref(db), updates).catch(e => console.error(`Bulk save ${node} failed`, e));
};

const _deleteItems = (node: string, ids: string[]) => {
    if (!activeTenantId || !db || ids.length === 0) return;
    const basePath = getBaseRef();
    const updates: any = {};
    ids.forEach(id => {
        updates[`${basePath}/${node}/${id}`] = null;
    });
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((x:any) => !ids.includes(x.id));
    }
    return update(ref(db), updates).catch(e => console.error(`Bulk delete ${node} failed`, e));
}

// --- HARD DELETE BOOKINGS ---
const _hardDeleteBookings = (ids: string[], staffId: string) => {
    if (!activeTenantId || !db || ids.length === 0) return;
    const basePath = getBaseRef();
    const updates: any = {};
    
    ids.forEach(id => {
        updates[`${basePath}/bookings/${id}`] = null;
        
        const booking = CACHE.bookings.find(b => b.id === id);
        if (booking) {
            if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(booking.status)) {
                // IMPORTANT: When releasing a room, update directly but DON'T trigger "Pending Lock" for this
                // because this is a background cleanup, not a user interaction on the Room Screen.
                updates[`${basePath}/rooms/${booking.roomId}/status`] = RoomStatus.VACANT_CLEAN;
                CACHE.rooms = CACHE.rooms.map(r => r.id === booking.roomId ? {...r, status: RoomStatus.VACANT_CLEAN} : r);
            }

            const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
            const newLog: HistoryLog = {
                id: logId,
                tenantId: activeTenantId || undefined,
                timestamp: new Date().toISOString(),
                action: 'DELETE',
                description: `XOÁ VĨNH VIỄN đơn: ${id}`,
                bookingSnapshot: booking,
                staffId
            };
            updates[`${basePath}/history/${logId}`] = newLog;
        }
    });

    CACHE.bookings = CACHE.bookings.filter(b => !ids.includes(b.id));
    _dataChangeCallback();

    return update(ref(db), updates).catch(e => console.error("Hard delete failed", e));
};

const _resetAllBookings = () => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    
    remove(ref(db, `${basePath}/bookings`)).then(() => {
        console.log("Đã xoá sạch toàn bộ booking trên Firebase");
    });

    const updates: any = {};
    const newRooms = CACHE.rooms.map(r => {
        updates[`${basePath}/rooms/${r.id}/status`] = RoomStatus.VACANT_CLEAN;
        return { ...r, status: RoomStatus.VACANT_CLEAN };
    });
    
    update(ref(db), updates);
    CACHE.bookings = [];
    CACHE.rooms = newRooms;
    _pendingRoomStatus.clear(); // Clear locks
    _dataChangeCallback();
};


// --- DOMAIN SPECIFIC METHODS ---

const _logAction = (action: HistoryLog['action'], booking: Booking, description: string, staffId: string) => {
    const logId = `log_${Date.now()}`;
    const newLog: HistoryLog = {
        id: logId,
        tenantId: activeTenantId || undefined,
        timestamp: new Date().toISOString(),
        action, description, bookingSnapshot: booking, staffId
    };
    _saveItem('history', newLog);
};

// --- FIX: IMMUTABLE OPTIMISTIC UPDATE WITH LOCKING ---
const _updateRoomStatus = (roomId: string, status: RoomStatus) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    
    // 1. SET LOCK: Ngăn dữ liệu cũ từ server ghi đè lên trạng thái này
    _pendingRoomStatus.set(roomId, status);

    // 2. UPDATE CACHE IMMEDIATELY (Tạo object mới hoàn toàn)
    const newRooms = CACHE.rooms.map(r => r.id === roomId ? { ...r, status } : r);
    CACHE.rooms = newRooms;
    
    // 3. TRIGGER UI
    _dataChangeCallback();

    // 4. SEND TO SERVER
    update(ref(db, `${basePath}/rooms/${roomId}`), { status })
        .catch(e => {
            console.error("Update failed", e);
            // Nếu lỗi, gỡ bỏ lock để dữ liệu server (dù cũ) được hiển thị lại
            _pendingRoomStatus.delete(roomId);
            _dataChangeCallback();
        });
};

// Booking Operations
const _addBooking = (booking: Booking) => {
    _saveItem('bookings', booking);
    if (booking.status === BookingStatus.CHECKED_IN) {
        _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED);
    }
    _logAction('CREATE', booking, `Tạo đơn ${booking.id}`, booking.createdBy);
};

const _updateBooking = (booking: Booking) => {
    const oldBooking = CACHE.bookings.find(b => b.id === booking.id);
    _saveItem('bookings', booking);

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
    _hardDeleteBookings([id], staffId);
    return true;
};

// --- PUBLIC API EXPORT ---
export const DataService = {
  init: _initRealtimeConnection,
  login: async (username: string, password: string) => {
      _ensureFirebase();
      if (db) {
          try {
              const snap = await get(ref(db, 'system/users'));
              if (snap.exists()) {
                  const users = snapshotToArray<User>(snap);
                  const found = users.find(u => u.username === username && u.password === password);
                  if (found) return found;
              }
          } catch (e) { console.error("Login Error", e); }
      }
      return INITIAL_USERS.find(u => u.username === username && u.password === password) || null;
  },
  
  findUserByUsername: async (u: string) => {
      return CACHE.systemUsers.find(user => user.username === u) || CACHE.users.find(user => user.username === u) || null;
  },

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

  saveTenants: (list: Tenant[]) => _saveListAsMap('tenants', list), 
  deleteTenant: (id: string) => {
      if(!db) return;
      const updates: any = {};
      updates[`system/tenants/${id}`] = null;
      updates[`tenants/${id}`] = null; 
      updates[`system/users/u_${id}_admin`] = null; 
      update(ref(db), updates);
  },
  
  savePlans: (list: SubscriptionPlan[]) => _saveListAsMap('plans', list), 

  seedTenantAdminUser: (user: User) => {
      if(!db) return;
      const updates: any = {};
      updates[`system/users/${user.id}`] = user;
      updates[`tenants/${user.tenantId}/users/${user.id}`] = user;
      update(ref(db), updates);
  },

  saveProperties: (list: Property[]) => _saveListAsMap('properties', list),
  saveRooms: (list: Room[]) => _saveListAsMap('rooms', list),
  saveRoomTypes: (list: RoomType[]) => _saveListAsMap('roomTypes', list),
  saveTags: (list: Tag[]) => _saveListAsMap('tags', list),
  saveTransactionCategories: (list: TransactionCategory[]) => _saveListAsMap('transactionCategories', list),

  updateRoomStatus: _updateRoomStatus,
  addBooking: _addBooking,
  updateBooking: _updateBooking,
  deleteBooking: _deleteBooking,
  deleteBookings: _hardDeleteBookings,
  saveBookings: (list: Booking[]) => _saveListAsMap('bookings', list), 
  resetAllBookings: _resetAllBookings,

  addCustomer: (c: Customer) => _saveItem('customers', c),
  
  addUser: (u: User) => {
      _saveItem('users', u);
      if(db) set(ref(db, `system/users/${u.id}`), u); 
  },
  updateUser: (u: User) => {
      _saveItem('users', u);
      if(db) update(ref(db, `system/users/${u.id}`), u); 
  },
  deleteUser: (id: string) => {
      _deleteItem('users', id);
      if(db) remove(ref(db, `system/users/${id}`));
  },

  deleteItems: _deleteItems,
  
  deleteBookingsByBatchId: (batchId: string, staffId: string) => {
      const toDelete = CACHE.bookings.filter(b => b.importBatchId === batchId);
      if (toDelete.length === 0) return 0;
      const ids = toDelete.map(b => b.id);
      _hardDeleteBookings(ids, staffId);
      return ids.length;
  },

  logAction: _logAction,

  generateBookingId: () => {
      const now = new Date();
      const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `${now.getFullYear().toString().slice(-2)}${(now.getMonth()+1).toString().padStart(2,'0')}-${seq}`;
  },
  
  validateRoomAvailability: (roomId: string, start: string, end: string, excludeId?: string) => {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      const buffer = 30 * 60 * 1000;
      const activeBookings = CACHE.bookings.filter(b => b.status !== BookingStatus.DELETED && b.status !== BookingStatus.CANCELLED);

      const conflict = activeBookings.find(b => {
          if(b.id === excludeId) return false;
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
