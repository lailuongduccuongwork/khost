
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
// Dùng để hiển thị nhanh (Optimistic UI) trong lúc chờ Firebase phản hồi
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

// --- CORE HELPERS (ATOMIC PATH BUILDER) ---

const getBaseRef = () => {
    if (!activeTenantId) return null;
    return activeTenantId === SYSTEM_TENANT_ID ? 'system' : `tenants/${activeTenantId}`;
};

// Helper: Convert Object to Array safely AND Deduplicate by ID
// Fixes "Ghost Duplicates" where Firebase mixes Array indices and Map keys
const snapshotToArray = <T>(snap: any): T[] => {
    const val = snap.val();
    if (!val) return [];
    
    let rawList: T[] = [];
    if (Array.isArray(val)) {
        rawList = val.filter(x => x); 
    } else {
        rawList = Object.values(val); 
    }

    // Critical Fix: Deduplicate by ID
    const uniqueMap = new Map();
    rawList.forEach((item: any) => {
        if (item && item.id) {
            uniqueMap.set(item.id, item);
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
        if(!_ensureFirebase()) return;

        console.log(`🔌 Connecting Realtime DB for: [${tenantId}]`);

        const basePath = getBaseRef();
        if (!basePath) return;

        // Helper để bind listener
        const bind = <T>(node: string, cacheKey: keyof typeof CACHE) => {
            onValue(ref(db, `${basePath}/${node}`), (snap) => {
                // @ts-ignore
                CACHE[cacheKey] = snapshotToArray<T>(snap);
                onDataChange(); 
            });
        };

        if (tenantId === SYSTEM_TENANT_ID) {
             bind<Tenant>('tenants', 'tenants');
             bind<SubscriptionPlan>('plans', 'plans');
             bind<User>('users', 'systemUsers');
             
             // Auto-seed system data if empty
             get(ref(db, 'system/tenants')).then(snap => { if (!snap.exists()) _seedSystemData(); });
        } else {
            // Business Data Listeners
            bind<Property>('properties', 'properties');
            bind<RoomType>('roomTypes', 'roomTypes');
            bind<Tag>('tags', 'tags');
            bind<TransactionCategory>('transactionCategories', 'transactionCategories');
            bind<Room>('rooms', 'rooms');
            bind<Booking>('bookings', 'bookings');
            bind<Customer>('customers', 'customers');
            
            // Users Sync (Self-Repair & Client-side Filtering)
            onValue(ref(db, `${basePath}/users`), async (snap) => { 
                const users = snapshotToArray<User>(snap);
                CACHE.users = users;
                
                // Logic tự sửa lỗi mất user khi tạo tenant mới
                if (users.length === 0) {
                    try {
                        // Client-side filtering to avoid "Index not defined"
                        const sysSnap = await get(ref(db, 'system/users'));
                        if (sysSnap.exists()) {
                            const allSysUsers = snapshotToArray<User>(sysSnap);
                            const recovered = allSysUsers.filter(u => u.tenantId === tenantId);
                            
                            if (recovered.length > 0) {
                                CACHE.users = recovered;
                                // Write back individually
                                const updates: any = {};
                                recovered.forEach(u => updates[`${basePath}/users/${u.id}`] = u);
                                update(ref(db), updates);
                            }
                        }
                    } catch (e) { console.error("Self-repair failed", e); }
                }
                onDataChange(); 
            });

            // History Listener (Limit 50)
            const historyQuery = query(ref(db, `${basePath}/history`), limitToLast(50));
            onValue(historyQuery, (snap) => {
                 CACHE.history = snapshotToArray<HistoryLog>(snap).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                 onDataChange();
            });

            // Auto-seed default data for new tenants
            get(ref(db, `${basePath}/properties`)).then(snap => { if (!snap.exists()) _seedTenantData(tenantId); });
        }
    } catch (e) {
        console.error("🔥 Sync Init Error:", e);
    }
};

// --- SEEDING (ATOMIC WRITE) ---
const _seedSystemData = () => {
    if (!db) return;
    const updates: any = {};
    updates['system/tenants'] = INITIAL_TENANTS;
    updates['system/plans'] = INITIAL_PLANS;
    
    // Seed users as Map
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
    updates['system/users'] = usersMap;
    update(ref(db), updates);
}

const _seedTenantData = (tenantId: string) => {
    if (!db) return;
    const withT = (arr: any[]) => arr.reduce((acc, item) => ({...acc, [item.id]: {...item, tenantId}}), {});
    const path = `tenants/${tenantId}`;
    
    const updates: any = {};
    updates[`${path}/properties`] = withT(INITIAL_PROPERTIES);
    updates[`${path}/rooms`] = withT(INITIAL_ROOMS);
    updates[`${path}/roomTypes`] = withT(INITIAL_ROOM_TYPES);
    updates[`${path}/bookings`] = withT(INITIAL_BOOKINGS);
    updates[`${path}/customers`] = withT(INITIAL_CUSTOMERS);
    updates[`${path}/tags`] = withT(INITIAL_TAGS);
    updates[`${path}/transactionCategories`] = withT(INITIAL_TRANSACTION_CATEGORIES);
    
    update(ref(db), updates);
}

// --- ATOMIC CRUD OPERATIONS (THE CORE FIX) ---

// 1. Generic Save Item (Update Specific Node)
const _saveItem = (node: string, item: any) => {
    if (!item.id || !activeTenantId || !db) return;
    const basePath = getBaseRef();
    const itemRef = ref(db, `${basePath}/${node}/${item.id}`);
    const scopedItem = { ...item, tenantId: activeTenantId };
    
    // Optimistic Update Cache
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const idx = list.findIndex((x:any) => x.id === item.id);
        if (idx > -1) list[idx] = scopedItem;
        else list.push(scopedItem);
    }

    // Atomic Server Update
    return set(itemRef, scopedItem).catch(e => console.error(`Save ${node} failed`, e));
}

// 2. Generic Delete Item
const _deleteItem = (node: string, id: string) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    const itemRef = ref(db, `${basePath}/${node}/${id}`);
    
    // Optimistic
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((x:any) => x.id !== id);
    }

    return remove(itemRef).catch(e => console.error(`Delete ${node} failed`, e));
}

// 3. Multi-path Update (For Drag & Drop Reordering or Bulk Updates)
const _saveListAsMap = (node: string, list: any[]) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    const updates: any = {};
    
    // Update local cache first
    // @ts-ignore
    CACHE[node as keyof typeof CACHE] = list;

    // Create atomic updates for each item in the list
    list.forEach(item => {
        updates[`${basePath}/${node}/${item.id}`] = { ...item, tenantId: activeTenantId };
    });
    
    // Use root update to apply all changes
    update(ref(db), updates).catch(e => console.error(`Bulk save ${node} failed`, e));
};

// 4. BULK DELETE (Atomic Set Null) - NEW
const _deleteItems = (node: string, ids: string[]) => {
    if (!activeTenantId || !db || ids.length === 0) return;
    const basePath = getBaseRef();
    const updates: any = {};
    
    // Create null updates
    ids.forEach(id => {
        updates[`${basePath}/${node}/${id}`] = null;
    });

    // Optimistic Update Cache
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((x:any) => !ids.includes(x.id));
    }

    return update(ref(db), updates).catch(e => console.error(`Bulk delete ${node} failed`, e));
}


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

const _updateRoomStatus = (roomId: string, status: RoomStatus) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    update(ref(db, `${basePath}/rooms/${roomId}`), { status }).catch(console.error);
    
    // Optimistic
    const r = CACHE.rooms.find(r => r.id === roomId);
    if(r) r.status = status;
};

// Booking Operations (Strictly Atomic)
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

    // Status Change Logic
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
    
    // Soft Delete (Atomic Update Status)
    const deletedSnapshot = { ...booking, status: BookingStatus.DELETED };
    _saveItem('bookings', deletedSnapshot);
    
    // Release Room
    if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(booking.status)) {
        _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN);
    }
    
    _logAction('DELETE', deletedSnapshot, `Xóa đơn ${id}`, staffId);
    return true;
};

// --- PUBLIC API EXPORT ---
export const DataService = {
  init: _initRealtimeConnection,
  
  // Auth & User
  login: async (username: string, password: string) => {
      _ensureFirebase();
      if (db) {
          try {
              // Client-side filtering instead of index
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

  // Setters (Atomic / Bulk Atomic)
  saveTenants: (list: Tenant[]) => _saveListAsMap('tenants', list), // System level
  deleteTenant: (id: string) => {
      if(!db) return;
      const updates: any = {};
      updates[`system/tenants/${id}`] = null;
      updates[`tenants/${id}`] = null;
      updates[`system/users/u_${id}_admin`] = null;
      update(ref(db), updates);
  },
  
  savePlans: (list: SubscriptionPlan[]) => _saveListAsMap('plans', list), // System level

  seedTenantAdminUser: (user: User) => {
      if(!db) return;
      const updates: any = {};
      updates[`system/users/${user.id}`] = user;
      updates[`tenants/${user.tenantId}/users/${user.id}`] = user;
      update(ref(db), updates);
  },

  // Master Data (Using bulk update map for Reordering support)
  saveProperties: (list: Property[]) => _saveListAsMap('properties', list),
  saveRooms: (list: Room[]) => _saveListAsMap('rooms', list),
  saveRoomTypes: (list: RoomType[]) => _saveListAsMap('roomTypes', list),
  saveTags: (list: Tag[]) => _saveListAsMap('tags', list),
  saveTransactionCategories: (list: TransactionCategory[]) => _saveListAsMap('transactionCategories', list),

  // Transactional Data (Strict Atomic)
  updateRoomStatus: _updateRoomStatus,
  addBooking: _addBooking,
  updateBooking: _updateBooking,
  deleteBooking: _deleteBooking,
  saveBookings: (list: Booking[]) => _saveListAsMap('bookings', list), // Fallback for bulk ops

  addCustomer: (c: Customer) => _saveItem('customers', c),
  
  addUser: (u: User) => {
      _saveItem('users', u);
      if(db) set(ref(db, `system/users/${u.id}`), u); // Sync to global
  },
  updateUser: (u: User) => {
      _saveItem('users', u);
      if(db) update(ref(db, `system/users/${u.id}`), u); // Sync to global
  },
  deleteUser: (id: string) => {
      _deleteItem('users', id);
      if(db) remove(ref(db, `system/users/${id}`));
  },

  // NEW: Bulk Delete Generic Helper
  deleteItems: _deleteItems,

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
