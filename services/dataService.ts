import { 
  Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, 
  User, UserRole, Tag, Tenant, SubscriptionPlan, TransactionCategory, 
  HistoryLog 
} from '../types';
import { 
  INITIAL_PLANS, INITIAL_TENANTS, INITIAL_PROPERTIES, 
  INITIAL_TRANSACTION_CATEGORIES, INITIAL_TAGS, INITIAL_ROOM_TYPES, 
  INITIAL_ROOMS, INITIAL_CUSTOMERS, INITIAL_BOOKINGS, INITIAL_USERS 
} from './mockData';

// Declare global variable for XLSX if available in window
declare const XLSX: any;

// --- IN-MEMORY STATE ---
let activeTenantId: string | null = null;

// System Level Data
let systemTenants: Tenant[] = [...INITIAL_TENANTS];
let systemPlans: SubscriptionPlan[] = [...INITIAL_PLANS];
let systemUsersGlobal: User[] = [...INITIAL_USERS]; // All users from all tenants + super admin

// Current Tenant Data Cache
const CACHE = {
  properties: [] as Property[],
  rooms: [] as Room[],
  roomTypes: [] as RoomType[],
  bookings: [] as Booking[],
  customers: [] as Customer[],
  users: [] as User[], // Users belonging to current tenant
  tags: [] as Tag[],
  categories: [] as TransactionCategory[],
  history: [] as HistoryLog[]
};

// --- PERSISTENCE HELPER (LocalStorage) ---
const STORAGE_KEYS = {
  TENANTS: 'k_host_tenants',
  PLANS: 'k_host_plans',
  USERS: 'k_host_users_global', // Store all users here
};

const loadSystemData = () => {
  if (typeof localStorage === 'undefined') return;
  const t = localStorage.getItem(STORAGE_KEYS.TENANTS);
  if (t) systemTenants = JSON.parse(t);
  
  const p = localStorage.getItem(STORAGE_KEYS.PLANS);
  if (p) systemPlans = JSON.parse(p);
  
  const u = localStorage.getItem(STORAGE_KEYS.USERS);
  if (u) systemUsersGlobal = JSON.parse(u);
};

const saveSystemData = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.TENANTS, JSON.stringify(systemTenants));
  localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(systemPlans));
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(systemUsersGlobal));
};

const loadTenantData = (tenantId: string) => {
  if (tenantId === 'SYSTEM') return;

  const key = `k_host_data_${tenantId}`;
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  
  if (raw) {
    const data = JSON.parse(raw);
    CACHE.properties = data.properties || [];
    CACHE.rooms = data.rooms || [];
    CACHE.roomTypes = data.roomTypes || [];
    CACHE.bookings = data.bookings || [];
    CACHE.customers = data.customers || [];
    CACHE.tags = data.tags || [];
    CACHE.categories = data.categories || [];
    CACHE.history = data.history || [];
  } else {
    // Initialize with Mock Data for 'tenant_demo' or 'tenant_luxury' if strictly needed
    // For now, we default 'tenant_demo' to initial mocks, others empty
    if (tenantId === 'tenant_demo') {
      CACHE.properties = [...INITIAL_PROPERTIES];
      CACHE.rooms = [...INITIAL_ROOMS];
      CACHE.roomTypes = [...INITIAL_ROOM_TYPES];
      CACHE.bookings = [...INITIAL_BOOKINGS];
      CACHE.customers = [...INITIAL_CUSTOMERS];
      CACHE.tags = [...INITIAL_TAGS];
      CACHE.categories = [...INITIAL_TRANSACTION_CATEGORIES];
      CACHE.history = [];
    } else {
      // Empty new tenant
      CACHE.properties = [];
      CACHE.rooms = [];
      CACHE.roomTypes = [];
      CACHE.bookings = [];
      CACHE.customers = [];
      CACHE.tags = [];
      CACHE.categories = [];
      CACHE.history = [];
    }
  }
  
  // Filter users for this tenant from Global Users
  CACHE.users = systemUsersGlobal.filter(u => u.tenantId === tenantId);
};

const saveTenantData = () => {
  if (!activeTenantId || activeTenantId === 'SYSTEM' || typeof localStorage === 'undefined') return;
  
  const data = {
    properties: CACHE.properties,
    rooms: CACHE.rooms,
    roomTypes: CACHE.roomTypes,
    bookings: CACHE.bookings,
    customers: CACHE.customers,
    tags: CACHE.tags,
    categories: CACHE.categories,
    history: CACHE.history
  };
  localStorage.setItem(`k_host_data_${activeTenantId}`, JSON.stringify(data));
};

// Initialize System Data Once
loadSystemData();

// --- SERVICE IMPLEMENTATION ---

export const DataService = {
  init: (tenantId: string, callback?: () => void) => {
    activeTenantId = tenantId;
    loadTenantData(tenantId);
    if (callback) setTimeout(callback, 50); 
  },

  // --- SYSTEM METHODS ---
  getTenants: () => systemTenants,
  saveTenants: (list: Tenant[]) => {
    systemTenants = list;
    saveSystemData();
  },
  deleteTenant: (id: string) => {
    systemTenants = systemTenants.filter(t => t.id !== id);
    saveSystemData();
    if (typeof localStorage !== 'undefined') localStorage.removeItem(`k_host_data_${id}`);
    systemUsersGlobal = systemUsersGlobal.filter(u => u.tenantId !== id);
    saveSystemData();
  },

  getPlans: () => systemPlans,
  savePlans: (list: SubscriptionPlan[]) => {
    systemPlans = list;
    saveSystemData();
  },

  getSystemUsers: () => systemUsersGlobal, 

  // --- USER AUTH & MANAGEMENT ---
  login: async (username: string, password: string): Promise<User | undefined> => {
    const user = systemUsersGlobal.find(u => u.username === username && u.password === password);
    return user ? { ...user } : undefined; 
  },

  findUserByUsername: async (username: string): Promise<User | undefined> => {
    return systemUsersGlobal.find(u => u.username === username);
  },

  getUsers: () => CACHE.users,
  addUser: (u: User) => {
    u.tenantId = activeTenantId || u.tenantId;
    systemUsersGlobal.push(u);
    saveSystemData();
    if (activeTenantId) CACHE.users = systemUsersGlobal.filter(x => x.tenantId === activeTenantId);
  },
  updateUser: (u: User) => {
    const idx = systemUsersGlobal.findIndex(x => x.id === u.id);
    if (idx !== -1) {
      systemUsersGlobal[idx] = u;
      saveSystemData();
      if (activeTenantId) CACHE.users = systemUsersGlobal.filter(x => x.tenantId === activeTenantId);
    }
  },
  deleteUser: (id: string) => {
    systemUsersGlobal = systemUsersGlobal.filter(x => x.id !== id);
    saveSystemData();
    if (activeTenantId) CACHE.users = systemUsersGlobal.filter(x => x.tenantId === activeTenantId);
  },
  seedTenantAdminUser: (u: User) => {
    if (!systemUsersGlobal.some(existing => existing.username === u.username)) {
      systemUsersGlobal.push(u);
      saveSystemData();
    }
  },

  // --- ENTITY GETTERS & SETTERS (Current Tenant) ---

  getProperties: () => CACHE.properties,
  saveProperties: (list: Property[]) => {
    CACHE.properties = list;
    saveTenantData();
  },

  getRooms: () => CACHE.rooms,
  saveRooms: (list: Room[]) => {
    CACHE.rooms = list;
    saveTenantData();
  },
  updateRoomStatus: (roomId: string, status: RoomStatus) => {
    const room = CACHE.rooms.find(r => r.id === roomId);
    if (room) {
      room.status = status;
      saveTenantData();
    }
  },

  getRoomTypes: () => CACHE.roomTypes,
  saveRoomTypes: (list: RoomType[]) => {
    CACHE.roomTypes = list;
    saveTenantData();
  },

  getCustomers: () => CACHE.customers,
  addCustomer: (c: Customer) => {
    CACHE.customers.push(c);
    saveTenantData();
  },

  getBookings: () => CACHE.bookings,
  saveBookings: (list: Booking[]) => {
    CACHE.bookings = list;
    saveTenantData();
  },
  addBooking: (b: Booking) => {
    CACHE.bookings.push(b);
    saveTenantData();
  },
  updateBooking: (b: Booking) => {
    const idx = CACHE.bookings.findIndex(x => x.id === b.id);
    if (idx !== -1) {
      CACHE.bookings[idx] = b;
      saveTenantData();
    }
  },
  deleteBooking: (id: string, staffId: string) => {
    const b = CACHE.bookings.find(x => x.id === id);
    if (b) {
      b.status = BookingStatus.DELETED;
      saveTenantData();
      
      const log: HistoryLog = {
        id: `log_${Date.now()}`,
        tenantId: activeTenantId || undefined,
        timestamp: new Date().toISOString(),
        action: 'DELETE',
        description: `Xoá đơn ${id}`,
        bookingSnapshot: b,
        staffId
      };
      CACHE.history.push(log);
      saveTenantData();
      return true;
    }
    return false;
  },
  deleteBookings: (ids: string[], staffId: string) => {
    let changed = false;
    ids.forEach(id => {
      const b = CACHE.bookings.find(x => x.id === id);
      if (b) {
        b.status = BookingStatus.DELETED;
        if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(b.status)) {
             const r = CACHE.rooms.find(rm => rm.id === b.roomId);
             if (r) r.status = RoomStatus.VACANT_CLEAN;
        }
        changed = true;
      }
    });
    if (changed) saveTenantData();
  },
  deleteBookingsByBatchId: (batchId: string, staffId: string) => {
    const toDelete = CACHE.bookings.filter(b => b.importBatchId === batchId && b.status !== BookingStatus.DELETED);
    if (toDelete.length === 0) return 0;
    
    toDelete.forEach(b => {
       b.status = BookingStatus.DELETED;
    });
    saveTenantData();
    return toDelete.length;
  },

  getTags: () => CACHE.tags,
  saveTags: (list: Tag[]) => {
    CACHE.tags = list;
    saveTenantData();
  },

  getTransactionCategories: () => CACHE.categories,
  saveTransactionCategories: (list: TransactionCategory[]) => {
    CACHE.categories = list;
    saveTenantData();
  },

  // --- GENERIC HELPERS ---
  deleteItems: (collectionName: 'bookings'|'rooms'|'properties'|'roomTypes', ids: string[]) => {
    // @ts-ignore
    if (Array.isArray(CACHE[collectionName])) {
       // @ts-ignore
       CACHE[collectionName] = CACHE[collectionName].filter((item: any) => !ids.includes(item.id));
       saveTenantData();
    }
  },

  // Utils
  generateBookingId: () => {
    const now = new Date();
    const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${now.getFullYear().toString().slice(-2)}${(now.getMonth()+1).toString().padStart(2,'0')}-${seq}`;
  },

  validateRoomAvailability: (roomId: string, start: string, end: string, excludeId?: string) => {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      const buffer = 0; 
      
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
