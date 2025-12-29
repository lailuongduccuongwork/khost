
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, HistoryLog, Tag, Tenant, SubscriptionPlan, PERMISSIONS, TransactionCategory } from '../types';
import { INITIAL_BOOKINGS, INITIAL_CUSTOMERS, INITIAL_PROPERTIES, INITIAL_ROOMS, INITIAL_ROOM_TYPES, INITIAL_USERS, INITIAL_TAGS, INITIAL_TENANTS, INITIAL_PLANS, INITIAL_TRANSACTION_CATEGORIES } from './mockData';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, get, child, query, limitToLast, update, remove, orderByChild, equalTo } from "firebase/database";

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
    // Current Tenant Data
    properties: [] as Property[],
    rooms: [] as Room[],
    roomTypes: [] as RoomType[],
    bookings: [] as Booking[],
    customers: [] as Customer[],
    users: [] as User[],
    history: [] as HistoryLog[],
    tags: [] as Tag[],
    transactionCategories: [] as TransactionCategory[], // Added
    
    // System Data (For Super Admin)
    tenants: [] as Tenant[],
    plans: [] as SubscriptionPlan[],
    systemUsers: [] as User[] // Global user lookup
};

// --- DATA ACCESS LAYER HELPERS (MIDDLEWARE) ---
const getTenantRef = (nodeName: string) => {
    if (!db) return null;
    
    if (!activeTenantId) {
        console.error("CRITICAL: Attempted to access DB without Active Tenant ID");
        return null;
    }

    if (activeTenantId === SYSTEM_TENANT_ID) {
        // Super admin accessing system nodes
        return ref(db, `system/${nodeName}`);
    } else {
        // Normal tenant accessing their isolated bucket
        return ref(db, `tenants/${activeTenantId}/${nodeName}`);
    }
};

// HELPER: Convert Firebase Snapshot to Array safely
const snapshotToArray = <T>(snap: any): T[] => {
    const val = snap.val();
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(x => x); // Filter nulls
    return Object.values(val); // Convert Object Map to Array
};

// NEW: Explicitly connect to Firebase (Idempotent)
const _ensureFirebase = () => {
    if (!isFirebaseReady) {
        try {
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            isFirebaseReady = true;
        } catch (e) {
            console.error("Firebase connection failed", e);
        }
    }
    return isFirebaseReady;
};

const _initRealtimeConnection = (tenantId: string, onDataChange: () => void) => {
    try {
        activeTenantId = tenantId;

        // Ensure connection is established
        _ensureFirebase();

        // 1. If Super Admin (System Context)
        if (tenantId === SYSTEM_TENANT_ID) {
             console.log("🔌 Connecting to SYSTEM context...");
             onValue(ref(db, 'system/tenants'), (snap) => { CACHE.tenants = snapshotToArray(snap); onDataChange(); });
             onValue(ref(db, 'system/plans'), (snap) => { CACHE.plans = snapshotToArray(snap); onDataChange(); });
             onValue(ref(db, 'system/users'), (snap) => { CACHE.systemUsers = snapshotToArray(snap); onDataChange(); });
             
             // Check if system data empty, seed it
             get(ref(db, 'system/tenants')).then(snap => {
                 if (!snap.exists()) _seedSystemData();
             });
             return;
        }

        // 2. If Tenant Context (Business Context)
        console.log(`🔌 Connecting to TENANT context: [${tenantId}]...`);
        
        // Listeners scoped to tenant
        onValue(getTenantRef('properties'), (snap) => { CACHE.properties = snapshotToArray(snap); onDataChange(); });
        onValue(getTenantRef('roomTypes'), (snap) => { CACHE.roomTypes = snapshotToArray(snap); onDataChange(); });
        onValue(getTenantRef('tags'), (snap) => { CACHE.tags = snapshotToArray(snap); onDataChange(); });
        onValue(getTenantRef('transactionCategories'), (snap) => { CACHE.transactionCategories = snapshotToArray(snap); onDataChange(); }); // Added Listener
        onValue(getTenantRef('rooms'), (snap) => { CACHE.rooms = snapshotToArray(snap); onDataChange(); });
        onValue(getTenantRef('bookings'), (snap) => { CACHE.bookings = snapshotToArray(snap); onDataChange(); });
        onValue(getTenantRef('customers'), (snap) => { CACHE.customers = snapshotToArray(snap); onDataChange(); });
        
        // CRITICAL FIX: Self-Repair Mechanism for Users
        onValue(getTenantRef('users'), async (snap) => { 
            const users = snapshotToArray<User>(snap);
            CACHE.users = users;
            
            // If local users list is empty, try to fetch from system/users and repair
            if (users.length === 0 && activeTenantId !== SYSTEM_TENANT_ID) {
                console.warn(`⚠️ User list for tenant ${tenantId} is empty. Attempting self-repair from system...`);
                try {
                    const sysUsersRef = ref(db, 'system/users');
                    const q = query(sysUsersRef, orderByChild('tenantId'), equalTo(tenantId));
                    const sysSnap = await get(q);
                    
                    if (sysSnap.exists()) {
                        const recoveredUsers = snapshotToArray<User>(sysSnap);
                        if (recoveredUsers.length > 0) {
                            console.log(`✅ Recovered ${recoveredUsers.length} users from system. Syncing to local...`);
                            CACHE.users = recoveredUsers;
                            await set(getTenantRef('users'), recoveredUsers);
                        }
                    }
                } catch (e) {
                    console.error("Self-repair failed:", e);
                }
            }
            
            onDataChange(); 
        });

        const historyQuery = query(getTenantRef('history'), limitToLast(50));
        onValue(historyQuery, (snap) => {
             const val = snap.val();
             if (val) {
                 CACHE.history = Array.isArray(val) ? val.filter(x => x) : Object.values(val);
                 CACHE.history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
             } else {
                 CACHE.history = [];
             }
             onDataChange();
        });

        // Check if tenant is new (empty properties), seed default data
        get(getTenantRef('properties')).then(snap => {
            if (!snap.exists()) {
                console.log(`✨ New Tenant Detected [${tenantId}]. Seeding default data...`);
                _seedTenantData(tenantId);
            }
        });

    } catch (e) {
        console.error("Firebase Init Error:", e);
        _loadFromMockOrStorage();
        onDataChange();
    }
};

const _seedSystemData = () => {
    if (!isFirebaseReady || !db) return;
    set(ref(db, 'system/tenants'), INITIAL_TENANTS);
    set(ref(db, 'system/plans'), INITIAL_PLANS);
    
    // FIX: Seed users as an Object Map (ID -> Data) instead of Array
    const usersMap: Record<string, User> = INITIAL_USERS.reduce((acc, user) => ({...acc, [user.id]: user}), {} as Record<string, User>);

    INITIAL_TENANTS.forEach(t => {
       if (t.adminUsername) {
           const adminId = `u_${t.id}_admin`;
           const exists = Object.values(usersMap).some(u => u.username === t.adminUsername);
           
           if (!exists) {
               usersMap[adminId] = {
                   id: adminId,
                   tenantId: t.id,
                   username: t.adminUsername,
                   password: t.adminPassword || '123',
                   fullName: t.adminUsername, // FullName same as Username
                   role: UserRole.ADMIN,
                   permissions: Object.values(PERMISSIONS),
                   allowedPropertyIds: []
               };
           }
       }
    });
    
    set(ref(db, 'system/users'), usersMap);
}

const _seedTenantData = (tenantId: string) => {
    if (!isFirebaseReady || !db) return;
    const withTenant = (list: any[]) => list.map(item => ({...item, tenantId}));
    
    set(getTenantRef('properties'), withTenant(INITIAL_PROPERTIES));
    set(getTenantRef('rooms'), withTenant(INITIAL_ROOMS));
    set(getTenantRef('roomTypes'), withTenant(INITIAL_ROOM_TYPES));
    set(getTenantRef('bookings'), withTenant(INITIAL_BOOKINGS));
    set(getTenantRef('customers'), withTenant(INITIAL_CUSTOMERS));
    set(getTenantRef('tags'), withTenant(INITIAL_TAGS));
    set(getTenantRef('transactionCategories'), withTenant(INITIAL_TRANSACTION_CATEGORIES)); // Seed categories
    
    // For users: We do NOT seed INITIAL_USERS here for new tenants because
    // the Super Admin has already created a specific admin user.
    // The self-repair mechanism in onValue('users') will pull that admin down.
}

const _loadFromMockOrStorage = () => {
    const load = (key: string, def: any) => {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : def;
    }
    CACHE.properties = load('properties', INITIAL_PROPERTIES);
    CACHE.rooms = load('rooms', INITIAL_ROOMS);
    CACHE.roomTypes = load('roomTypes', INITIAL_ROOM_TYPES);
    CACHE.bookings = load('bookings', INITIAL_BOOKINGS);
    CACHE.customers = load('customers', INITIAL_CUSTOMERS);
    CACHE.users = load('users', INITIAL_USERS);
    CACHE.history = load('history', []);
    CACHE.tags = load('tags', INITIAL_TAGS);
    CACHE.transactionCategories = load('transactionCategories', INITIAL_TRANSACTION_CATEGORIES); // Load categories
    CACHE.tenants = INITIAL_TENANTS;
    CACHE.plans = INITIAL_PLANS;
    CACHE.systemUsers = INITIAL_USERS;
};

const _saveNode = (nodeName: string, data: any) => {
    if (isFirebaseReady && db && activeTenantId) {
        const cleanData = JSON.parse(JSON.stringify(data));
        set(getTenantRef(nodeName), cleanData).catch(err => console.error(`Save ${nodeName} failed`, err));
    } else {
        localStorage.setItem(nodeName, JSON.stringify(data));
    }
}

const _syncToSystemUsers = async (user: User, action: 'ADD' | 'UPDATE' | 'DELETE') => {
    _ensureFirebase(); // Ensure connection before write
    if (!isFirebaseReady || !db) return;

    try {
        const userRef = ref(db, `system/users/${user.id}`);
        if (action === 'DELETE') {
            await set(userRef, null); 
        } else {
            await set(userRef, user); 
        }
    } catch (e) {
        console.error("Failed to sync system users:", e);
    }
};

const _globalLogin = async (username: string, password: string): Promise<User | null> => {
    // CRITICAL FIX: Always ensure Firebase is connected before checking credentials
    _ensureFirebase();

    if (isFirebaseReady && db) {
        try {
            // 1. Try to fetch from /system/users (Global Lookup)
            const snap = await get(ref(db, 'system/users'));
            let allUsers = snapshotToArray<User>(snap);
            
            if (allUsers.length > 0) {
                const found = allUsers.find(u => u.username === username && u.password === password);
                if (found) return found;
            }
        } catch (e) {
            console.error("Login fetch failed, falling back to mock", e);
        }
    }
    
    const found = INITIAL_USERS.find(u => u.username === username && u.password === password);
    if (found) return found;
    
    return null;
}

const _findUserByUsername = async (username: string): Promise<User | null> => {
    _ensureFirebase(); 
    
    if (isFirebaseReady && db) {
        try {
            const q = query(ref(db, 'system/users'), orderByChild('username'), equalTo(username));
            const snap = await get(q);
            
            if (snap.exists()) {
                const val = snap.val();
                const keys = Object.keys(val);
                if (keys.length > 0) return val[keys[0]];
            }
        } catch (e) {
            console.error("Error checking username uniqueness:", e);
        }
    }
    
    const foundInSystem = CACHE.systemUsers.find(u => u.username === username);
    if (foundInSystem) return foundInSystem;
    
    const foundInTenant = CACHE.users.find(u => u.username === username);
    if (foundInTenant) return foundInTenant;

    return null;
}

// --- API METHODS ---

const _getHistory = (): HistoryLog[] => CACHE.history;

const _logAction = (action: HistoryLog['action'], booking: Booking, description: string, staffId: string) => {
    const newLog: HistoryLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tenantId: activeTenantId || undefined,
        timestamp: new Date().toISOString(),
        action,
        description,
        bookingSnapshot: booking,
        staffId
    };
    
    CACHE.history.unshift(newLog);
    if (CACHE.history.length > 300) CACHE.history.length = 300;
    
    if (isFirebaseReady && db) {
        _saveNode('history', CACHE.history);
    }
};

const _updateRoomStatus = (roomId: string, status: RoomStatus) => {
    const index = CACHE.rooms.findIndex(r => r.id === roomId);
    if (index !== -1) {
      const updatedRooms = [...CACHE.rooms];
      updatedRooms[index] = { ...updatedRooms[index], status };
      CACHE.rooms = updatedRooms;
      _saveNode('rooms', CACHE.rooms);
    }
};

const _getBookingsStrict = (propertyId?: string): Booking[] => {
    const validRoomIds = new Set(CACHE.rooms.map(r => r.id));
    const validPropertyIds = new Set(CACHE.properties.map(p => p.id));

    let cleanList = CACHE.bookings.filter(b => {
        if (b.status === BookingStatus.DELETED) return false;
        const roomExists = validRoomIds.has(b.roomId);
        const propertyExists = validPropertyIds.has(b.propertyId);
        return roomExists && propertyExists;
    });

    if (propertyId) {
        cleanList = cleanList.filter(b => b.propertyId === propertyId);
    }
    return cleanList;
}

const _deleteBooking = (bookingId: string, staffId: string): boolean => {
    try {
        const bookings = [...CACHE.bookings];
        const index = bookings.findIndex(b => b.id === bookingId);
        
        if (index !== -1) {
            const bookingToDelete = bookings[index];
            
            // LOGIC: Xóa đơn -> Trả phòng về Sạch (VACANT_CLEAN)
            if (bookingToDelete.status === BookingStatus.CHECKED_IN || bookingToDelete.status === BookingStatus.CONFIRMED) {
                _updateRoomStatus(bookingToDelete.roomId, RoomStatus.VACANT_CLEAN);
            }
            
            const deletedSnapshot = { ...bookingToDelete, status: BookingStatus.DELETED };
            _logAction('DELETE', deletedSnapshot, `Xóa đơn ${bookingId} khỏi hệ thống`, staffId);
            
            bookings.splice(index, 1);
            CACHE.bookings = bookings;
            _saveNode('bookings', CACHE.bookings);
            return true;
        }
        return false;
    } catch (e) {
        console.error("deleteBooking error:", e);
        return false;
    }
};

const sortByOrder = (a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0);

// --- Exported Service ---
export const DataService = {
  // Core
  init: _initRealtimeConnection,
  login: _globalLogin,
  findUserByUsername: _findUserByUsername,

  getTenants: () => CACHE.tenants, // Only for Super Admin
  saveTenants: (tenants: Tenant[]) => {
      CACHE.tenants = tenants;
      if (activeTenantId === 'SYSTEM') _saveNode('tenants', tenants);
  },
  
  deleteTenant: (tenantId: string) => {
      const newTenants = CACHE.tenants.filter(t => t.id !== tenantId);
      CACHE.tenants = newTenants;
      
      if (activeTenantId === 'SYSTEM') {
          _saveNode('tenants', newTenants);
          if (isFirebaseReady && db) {
              set(ref(db, `tenants/${tenantId}`), null)
                .then(() => console.log(`Deleted data for tenant ${tenantId}`))
                .catch(e => console.error("Error deleting tenant data node:", e));
              
              const adminId = `u_${tenantId}_admin`;
              set(ref(db, `system/users/${adminId}`), null);
          }
      }
  },
  
  getPlans: () => CACHE.plans,
  savePlans: (plans: SubscriptionPlan[]) => {
      CACHE.plans = plans;
      if (activeTenantId === 'SYSTEM') _saveNode('plans', plans);
  },
  
  getSystemUsers: () => CACHE.systemUsers,
  
  upsertSystemUser: (user: User) => {
      _syncToSystemUsers(user, 'UPDATE');
  },
  
  // NEW: Special method for Super Admin to seed a new tenant admin
  // Syncs to BOTH Global User List (for Login) AND Local Tenant User List (for Display)
  seedTenantAdminUser: async (user: User) => {
      _ensureFirebase();
      if (isFirebaseReady && db) {
          try {
              // 1. Global Sync (system/users)
              await set(ref(db, `system/users/${user.id}`), user);
              
              // 2. Local Tenant Sync (tenants/{id}/users)
              // We initialize the array with this single admin user
              await set(ref(db, `tenants/${user.tenantId}/users`), [user]);
          } catch (e) {
              console.error("Error seeding tenant admin:", e);
          }
      }
  },

  getHistory: _getHistory,
  logAction: _logAction,

  getProperties: (): Property[] => [...CACHE.properties].sort(sortByOrder),
  saveProperties: (properties: Property[]) => { 
      const scoped = properties.map(p => ({...p, tenantId: activeTenantId}));
      CACHE.properties = scoped; 
      _saveNode('properties', scoped); 
  },
  
  getRoomTypes: (): RoomType[] => [...CACHE.roomTypes].sort(sortByOrder),
  saveRoomTypes: (types: RoomType[]) => { 
      const scoped = types.map(t => ({...t, tenantId: activeTenantId}));
      CACHE.roomTypes = scoped; 
      _saveNode('roomTypes', scoped); 
  },
  
  getTags: (): Tag[] => CACHE.tags,
  saveTags: (tags: Tag[]) => { 
      const scoped = tags.map(t => ({...t, tenantId: activeTenantId}));
      CACHE.tags = scoped; 
      _saveNode('tags', scoped); 
  },

  // NEW: Transaction Categories Methods
  getTransactionCategories: (): TransactionCategory[] => CACHE.transactionCategories,
  saveTransactionCategories: (cats: TransactionCategory[]) => { 
      const scoped = cats.map(c => ({...c, tenantId: activeTenantId}));
      CACHE.transactionCategories = scoped; 
      _saveNode('transactionCategories', scoped); 
  },

  getRooms: (propertyId?: string): Room[] => {
    let list = [...CACHE.rooms];
    if (propertyId) list = list.filter(r => r.propertyId === propertyId);
    return list.sort(sortByOrder);
  },
  saveRooms: (rooms: Room[]) => { 
      const scoped = rooms.map(r => ({...r, tenantId: activeTenantId}));
      CACHE.rooms = scoped; 
      _saveNode('rooms', scoped); 
  },
  
  updateRoomStatus: _updateRoomStatus,

  getCustomers: (): Customer[] => CACHE.customers,
  addCustomer: (customer: Customer) => {
    const existingIndex = CACHE.customers.findIndex(c => c.phone === customer.phone);
    const newCustomers = [...CACHE.customers];
    const scopedCustomer = { ...customer, tenantId: activeTenantId };
    
    if (existingIndex !== -1) {
        newCustomers[existingIndex] = { ...newCustomers[existingIndex], ...scopedCustomer };
    } else {
        newCustomers.push(scopedCustomer as Customer);
    }
    CACHE.customers = newCustomers;
    _saveNode('customers', newCustomers);
  },

  getBookings: _getBookingsStrict,
  
  generateBookingId: (): string => {
      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const sequence = CACHE.bookings.length + 1 + Math.floor(Math.random() * 1000);
      const seqStr = sequence.toString().padStart(6, '0');
      return `${yy}-${mm}-${seqStr}`;
  },

  validateRoomAvailability: (roomId: string, startIso: string, endIso: string, excludeBookingId?: string): { valid: boolean; reason?: string } => {
      const bookings = _getBookingsStrict(); 
      const newStart = new Date(startIso).getTime();
      const newEnd = new Date(endIso).getTime();
      const bufferMs = 30 * 60 * 1000; 

      const conflict = bookings.find(b => {
          if (b.id === excludeBookingId) return false;
          if (b.status === BookingStatus.CANCELLED) return false;
          if (b.roomId !== roomId) return false;

          const existStart = new Date(b.checkInDate).getTime();
          const existEnd = new Date(b.checkOutDate).getTime();

          return (newStart < existEnd + bufferMs) && (newEnd + bufferMs > existStart);
      });

      if (conflict) {
          return { 
              valid: false, 
              reason: `Trùng lịch với đơn ${conflict.id} (hoặc vi phạm khoảng cách dọn dẹp 30 phút)` 
          };
      }

      return { valid: true };
  },

  saveBookings: (bookings: Booking[]) => { 
      const scoped = bookings.map(b => ({...b, tenantId: activeTenantId}));
      CACHE.bookings = scoped; 
      _saveNode('bookings', scoped); 
  },
  
  addBooking: (booking: Booking) => {
    // extraFees is automatically included via ...booking if present in the object
    const scopedBooking = { ...booking, tenantId: activeTenantId };
    const newBookings = [...CACHE.bookings, scopedBooking as Booking];
    CACHE.bookings = newBookings;
    
    if (booking.status === BookingStatus.CHECKED_IN) {
      const rIdx = CACHE.rooms.findIndex(r => r.id === booking.roomId);
      if(rIdx !== -1) {
          CACHE.rooms[rIdx].status = RoomStatus.OCCUPIED;
          _saveNode('rooms', CACHE.rooms);
      }
    }

    _saveNode('bookings', newBookings);
    
    setTimeout(() => {
        _logAction('CREATE', scopedBooking as Booking, `Tạo mới đơn đặt phòng ${booking.id}`, booking.createdBy);
    }, 100);
  },

  updateBooking: (updatedBooking: Booking) => {
    const bookings = [...CACHE.bookings];
    const index = bookings.findIndex(b => b.id === updatedBooking.id);
    if (index !== -1) {
      const oldStatus = bookings[index].status;
      // extraFees is automatically included via ...updatedBooking
      const scopedBooking = { ...updatedBooking, tenantId: activeTenantId };
      bookings[index] = scopedBooking as Booking;
      CACHE.bookings = bookings;

      let actionType: HistoryLog['action'] = 'UPDATE';
      let desc = `Cập nhật thông tin đơn ${updatedBooking.id}`;
      let roomUpdated = false;

      // --- LOGIC CẬP NHẬT TRẠNG THÁI PHÒNG (Strict Mode) ---
      if (updatedBooking.status !== oldStatus) {
        const rIdx = CACHE.rooms.findIndex(r => r.id === updatedBooking.roomId);

        if (rIdx !== -1) {
            // 1. CHECK_IN -> OCCUPIED
            if (updatedBooking.status === BookingStatus.CHECKED_IN) {
                CACHE.rooms[rIdx].status = RoomStatus.OCCUPIED;
                roomUpdated = true;
                actionType = 'CHECK_IN';
                desc = `Check-in đơn ${updatedBooking.id}`;
            }
            // 2. CHECK_OUT -> VACANT_DIRTY
            else if (updatedBooking.status === BookingStatus.CHECKED_OUT) {
                CACHE.rooms[rIdx].status = RoomStatus.VACANT_DIRTY;
                roomUpdated = true;
                actionType = 'CHECK_OUT';
                desc = `Check-out đơn ${updatedBooking.id}`;
            }
            // 3. CANCELLED -> VACANT_CLEAN
            else if (updatedBooking.status === BookingStatus.CANCELLED) {
                CACHE.rooms[rIdx].status = RoomStatus.VACANT_CLEAN;
                roomUpdated = true;
                actionType = 'CANCEL';
                desc = `Hủy đơn ${updatedBooking.id}`;
            }
        }
      }

      _saveNode('bookings', bookings);
      if(roomUpdated) {
          _saveNode('rooms', CACHE.rooms); // Save rooms immediately
      }

      setTimeout(() => {
         _logAction(actionType, scopedBooking as Booking, desc, updatedBooking.createdBy);
      }, 100);
    }
  },

  deleteBooking: _deleteBooking,

  getUsers: (): User[] => CACHE.users,
  addUser: (user: User) => {
     const scopedUser = { ...user, tenantId: activeTenantId };
     CACHE.users = [...CACHE.users, scopedUser as User];
     _saveNode('users', CACHE.users);
     _syncToSystemUsers(scopedUser as User, 'ADD');
  },
  updateUser: (updatedUser: User) => {
     const newUsers = [...CACHE.users];
     const idx = newUsers.findIndex(u => u.id === updatedUser.id);
     if (idx !== -1) {
         const safeUpdate = { 
             ...newUsers[idx], 
             ...updatedUser,
             tenantId: activeTenantId || newUsers[idx].tenantId 
         };
         newUsers[idx] = safeUpdate;
         CACHE.users = newUsers;
         _saveNode('users', newUsers);
         _syncToSystemUsers(safeUpdate, 'UPDATE');
     }
  },
  deleteUser: (userId: string) => {
      const userToDelete = CACHE.users.find(u => u.id === userId);
      const newUsers = CACHE.users.filter(u => u.id !== userId);
      CACHE.users = newUsers;
      _saveNode('users', newUsers);
      if(userToDelete) _syncToSystemUsers(userToDelete, 'DELETE');
  },
  
  exportToExcel: (data: any[], fileName: string) => {
      if (typeof XLSX === 'undefined') {
          console.error("XLSX library not loaded");
          alert("Thư viện xuất Excel chưa được tải. Vui lòng thử lại sau.");
          return;
      }
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report");
      XLSX.writeFile(wb, fileName);
  }
};
