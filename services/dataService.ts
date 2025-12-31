
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

// Callback listeners
let _dataChangeCallback: () => void = () => {};

// --- CORE HELPERS (ATOMIC PATH BUILDER) ---

const getBaseRef = () => {
    if (!activeTenantId) return null;
    return activeTenantId === SYSTEM_TENANT_ID ? 'system' : `tenants/${activeTenantId}`;
};

// --- FIX: SMART MERGE DATA PARSER ---
// Hàm này giải quyết vấn đề: Dữ liệu bị trùng lặp VÀ dữ liệu bị mất tên phòng.
// Nó sẽ gom tất cả lại, nếu trùng ID thì hợp nhất (Merge) thay vì ghi đè hoàn toàn.
const snapshotToArray = <T extends { id?: string, number?: string, name?: string }>(snap: any): T[] => {
    const val = snap.val();
    if (!val) return [];
    
    let rawList: T[] = [];

    // 1. Extract data (Lấy hết mọi dữ liệu bất kể cấu trúc Array hay Map)
    if (typeof val === 'object') {
        Object.keys(val).forEach(key => {
            const item = val[key];
            if (item && typeof item === 'object') {
                // Spread để copy object, đảm bảo ID tồn tại
                rawList.push({ ...item, id: item.id || key });
            }
        });
    }

    // 2. DEDUPLICATION WITH INTELLIGENT MERGE (Khử trùng lặp thông minh)
    const uniqueMap = new Map<string, T>();

    rawList.forEach(item => {
        const id = (item as any).id;
        if (!id) return;

        if (uniqueMap.has(id)) {
            // --- LOGIC HỒI PHỤC DỮ LIỆU ---
            // Nếu ID đã tồn tại, ta lấy cái cũ ra
            const existing = uniqueMap.get(id)!;

            // Tạo bản ghi mới bằng cách ghi đè cái cũ bằng cái mới
            const merged = { ...existing, ...item };

            // QUAN TRỌNG: Bảo vệ các trường định danh quan trọng.
            // Nếu bản ghi MỚI (item) bị mất 'number' (Tên phòng) mà bản ghi CŨ (existing) lại có
            // -> Thì phải giữ lại 'number' của bản ghi cũ.
            if ((existing as any).number && !(item as any).number) {
                (merged as any).number = (existing as any).number;
            }
            if ((existing as any).name && !(item as any).name) {
                (merged as any).name = (existing as any).name;
            }
            if ((existing as any).typeId && !(item as any).typeId) {
                (merged as any).typeId = (existing as any).typeId;
            }
            if ((existing as any).propertyId && !(item as any).propertyId) {
                (merged as any).propertyId = (existing as any).propertyId;
            }

            uniqueMap.set(id, merged);
        } else {
            // Chưa có thì thêm mới
            uniqueMap.set(id, item);
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
                const list = snapshotToArray<T>(snap);
                // @ts-ignore
                CACHE[cacheKey] = list;
                _dataChangeCallback(); 
            });
        };

        if (tenantId === SYSTEM_TENANT_ID) {
             bind<Tenant>('tenants', 'tenants');
             bind<SubscriptionPlan>('plans', 'plans');
             bind<User>('users', 'systemUsers');
             
             get(ref(db, 'system/tenants')).then(snap => { 
                 if (!snap.exists() || snap.size === 0) _seedSystemData(); 
             });
        } else {
            bind<Property>('properties', 'properties');
            bind<RoomType>('roomTypes', 'roomTypes');
            bind<Tag>('tags', 'tags');
            bind<TransactionCategory>('transactionCategories', 'transactionCategories');
            bind<Room>('rooms', 'rooms');
            bind<Booking>('bookings', 'bookings');
            bind<Customer>('customers', 'customers');
            
            // Users Sync (Special handling for self-repair)
            onValue(ref(db, `${basePath}/users`), async (snap) => { 
                const users = snapshotToArray<User>(snap);
                CACHE.users = users;
                
                // Self-repair: Recover from System if empty
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

            // History Sync
            const historyQuery = query(ref(db, `${basePath}/history`), limitToLast(50));
            onValue(historyQuery, (snap) => {
                 CACHE.history = snapshotToArray<HistoryLog>(snap).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                 _dataChangeCallback();
            });

            // FIX: STRICT SEEDING CHECK (PREVENT F5 RESET)
            // Chỉ seed khi node 'rooms' VÀ 'properties' hoàn toàn không tồn tại.
            get(ref(db, `${basePath}/properties`)).then(pSnap => {
                if (!pSnap.exists() || pSnap.size === 0) {
                     // Kiểm tra kép (Double check)
                     get(ref(db, `${basePath}/rooms`)).then(rSnap => {
                         if (!rSnap.exists()) {
                             console.log("🌱 Database truly empty. Seeding Initial Data for " + tenantId);
                             _seedTenantData(tenantId);
                         }
                     });
                }
            });
        }
    } catch (e) {
        console.error("🔥 Sync Init Error:", e);
    }
};

// --- SEEDING ---
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
    
    // Use update from root to be safe
    update(ref(db), updates).then(() => console.log("✅ Seeding Complete"));
}

// --- ATOMIC CRUD OPERATIONS ---

const _saveItem = (node: string, item: any) => {
    if (!item.id || !activeTenantId || !db) return;
    const basePath = getBaseRef();
    const itemRef = ref(db, `${basePath}/${node}/${item.id}`);
    const scopedItem = { ...item, tenantId: activeTenantId };
    
    // Optimistic Update
    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const idx = list.findIndex((x:any) => x.id === item.id);
        if (idx > -1) list[idx] = scopedItem;
        else list.push(scopedItem);
    }
    _dataChangeCallback();
    
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
    _dataChangeCallback();
    return remove(itemRef).catch(e => console.error(`Delete ${node} failed`, e));
}

const _saveListAsMap = (node: string, list: any[]) => {
    if (!activeTenantId || !db) return;
    const basePath = getBaseRef();
    const updates: any = {};
    
    // @ts-ignore
    CACHE[node as keyof typeof CACHE] = list;
    _dataChangeCallback();

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
    _dataChangeCallback();
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
                // Unlock room immediately
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

// --- FIX: ROBUST ROOM STATUS UPDATE (NO CROSS CONTAMINATION) ---
const _updateRoomStatus = (roomId: string, status: RoomStatus) => {
    if (!db || !activeTenantId) {
        alert("Chưa kết nối CSDL. Vui lòng tải lại trang.");
        return;
    }
    const basePath = getBaseRef();
    
    // 1. Validation: Ensure roomId is valid string
    if (!roomId || typeof roomId !== 'string') {
        console.error("Invalid RoomID for status update:", roomId);
        return;
    }

    // 2. Optimistic Update (Only update the specific matching ID)
    // CRITICAL: Spread {...r} to create a new object reference. 
    const newRooms = CACHE.rooms.map(r => r.id === roomId ? { ...r, status } : r);
    CACHE.rooms = newRooms;
    _dataChangeCallback();

    // 3. SEND TO SERVER (Use DIRECT UPDATE on ROOT to allow proper path resolution)
    const updates: any = {};
    updates[`${basePath}/rooms/${roomId}/status`] = status;
    
    update(ref(db), updates)
        .then(() => {
            console.log(`✅ Synced room ${roomId} to ${status}`);
        })
        .catch(e => {
            console.error("🔥 Sync Failed:", e);
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
