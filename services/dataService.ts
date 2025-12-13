
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, HistoryLog, Tag } from '../types';
import { INITIAL_BOOKINGS, INITIAL_CUSTOMERS, INITIAL_PROPERTIES, INITIAL_ROOMS, INITIAL_ROOM_TYPES, INITIAL_USERS, INITIAL_TAGS } from './mockData';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, get, child, query, limitToLast } from "firebase/database";

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
  appId: "1:875551915320:web:9516f334551de0a96495cd"
};

// Initialize Firebase
let db: any = null;
let isFirebaseReady = false;

// --- IN-MEMORY CACHE ---
const CACHE = {
    properties: [] as Property[],
    rooms: [] as Room[],
    roomTypes: [] as RoomType[],
    bookings: [] as Booking[],
    customers: [] as Customer[],
    users: [] as User[],
    history: [] as HistoryLog[],
    tags: [] as Tag[]
};

// --- INITIALIZATION ---
const _initRealtimeConnection = (onDataChange: () => void) => {
    try {
        if (!isFirebaseReady) {
             if (firebaseConfig.apiKey.includes("REPLACE_ME")) {
                 console.warn("⚠️ CHƯA CẤU HÌNH FIREBASE");
                 _loadFromMockOrStorage();
                 onDataChange();
                 return;
             }

             const app = initializeApp(firebaseConfig);
             db = getDatabase(app);
             isFirebaseReady = true;

             // OPTIMIZATION: Listen to specific nodes instead of root to save bandwidth
             // 1. Static/Config Data
             onValue(ref(db, 'properties'), (snap) => { CACHE.properties = snap.val() || []; onDataChange(); });
             onValue(ref(db, 'roomTypes'), (snap) => { CACHE.roomTypes = snap.val() || []; onDataChange(); });
             onValue(ref(db, 'tags'), (snap) => { CACHE.tags = snap.val() || []; onDataChange(); });
             
             // 2. Dynamic Data
             onValue(ref(db, 'rooms'), (snap) => { CACHE.rooms = snap.val() || []; onDataChange(); });
             
             // Load Raw Bookings - Filtering happens in getter
             onValue(ref(db, 'bookings'), (snap) => { 
                 CACHE.bookings = snap.val() || [];
                 onDataChange(); 
             });

             onValue(ref(db, 'customers'), (snap) => { CACHE.customers = snap.val() || []; onDataChange(); });
             onValue(ref(db, 'users'), (snap) => { CACHE.users = snap.val() || []; onDataChange(); });

             // 3. Heavy Data (History)
             const historyQuery = query(ref(db, 'history'), limitToLast(50));
             onValue(historyQuery, (snap) => {
                 const val = snap.val();
                 if (val) {
                     if (Array.isArray(val)) {
                         CACHE.history = val.filter(x => x);
                     } else {
                         CACHE.history = Object.values(val);
                     }
                     CACHE.history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                 } else {
                     CACHE.history = [];
                 }
                 onDataChange();
             });

             // Check if empty and init
             get(ref(db, 'properties')).then(snap => {
                 if (!snap.exists()) {
                     console.log("Database trống, khởi tạo dữ liệu mẫu...");
                     _resetToMockData();
                 }
             });
        }
    } catch (e) {
        console.error("Firebase Init Error:", e);
        _loadFromMockOrStorage();
        onDataChange();
    }
};

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
};

const _resetToMockData = () => {
    CACHE.properties = INITIAL_PROPERTIES;
    CACHE.rooms = INITIAL_ROOMS;
    CACHE.roomTypes = INITIAL_ROOM_TYPES;
    CACHE.bookings = INITIAL_BOOKINGS;
    CACHE.customers = INITIAL_CUSTOMERS;
    CACHE.users = INITIAL_USERS;
    CACHE.tags = INITIAL_TAGS;
    
    if (isFirebaseReady && db) {
        set(ref(db, 'properties'), CACHE.properties);
        set(ref(db, 'rooms'), CACHE.rooms);
        set(ref(db, 'roomTypes'), CACHE.roomTypes);
        set(ref(db, 'bookings'), CACHE.bookings);
        set(ref(db, 'customers'), CACHE.customers);
        set(ref(db, 'users'), CACHE.users);
        set(ref(db, 'tags'), CACHE.tags);
    }
};

// Helper to save specific node
const _saveNode = (nodeName: string, data: any) => {
    if (isFirebaseReady && db) {
        const cleanData = JSON.parse(JSON.stringify(data));
        set(ref(db, nodeName), cleanData).catch(err => console.error(`Save ${nodeName} failed`, err));
    } else {
        localStorage.setItem(nodeName, JSON.stringify(data));
    }
}

// --- Internal Helper Functions ---

const _getHistory = (): HistoryLog[] => {
    return CACHE.history;
};

const _logAction = (action: HistoryLog['action'], booking: Booking, description: string, staffId: string) => {
    const newLog: HistoryLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        action,
        description,
        bookingSnapshot: booking,
        staffId
    };
    
    CACHE.history.unshift(newLog);
    
    if (isFirebaseReady && db) {
        if (CACHE.history.length > 300) CACHE.history.length = 300;
        _saveNode('history', CACHE.history);
    } else {
        localStorage.setItem('history', JSON.stringify(CACHE.history));
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

// --- Strict Data Access ---
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
            
            if (bookingToDelete.status === BookingStatus.CHECKED_IN) {
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

// Helper sorting function
const sortByOrder = (a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0);

// --- Exported Service ---
export const DataService = {
  init: _initRealtimeConnection,
  getHistory: _getHistory,
  logAction: _logAction,

  // Properties
  getProperties: (): Property[] => [...CACHE.properties].sort(sortByOrder),
  saveProperties: (properties: Property[]) => { CACHE.properties = properties; _saveNode('properties', properties); },
  
  // Room Types
  getRoomTypes: (): RoomType[] => [...CACHE.roomTypes].sort(sortByOrder),
  saveRoomTypes: (types: RoomType[]) => { CACHE.roomTypes = types; _saveNode('roomTypes', types); },
  
  // Tags
  getTags: (): Tag[] => CACHE.tags,
  saveTags: (tags: Tag[]) => { CACHE.tags = tags; _saveNode('tags', tags); },

  // Rooms
  getRooms: (propertyId?: string): Room[] => {
    let list = [...CACHE.rooms];
    if (propertyId) list = list.filter(r => r.propertyId === propertyId);
    return list.sort(sortByOrder);
  },
  saveRooms: (rooms: Room[]) => { CACHE.rooms = rooms; _saveNode('rooms', rooms); },
  
  updateRoomStatus: _updateRoomStatus,

  // Customers
  getCustomers: (): Customer[] => CACHE.customers,
  addCustomer: (customer: Customer) => {
    const existingIndex = CACHE.customers.findIndex(c => c.phone === customer.phone);
    const newCustomers = [...CACHE.customers];
    if (existingIndex !== -1) {
        newCustomers[existingIndex] = { ...newCustomers[existingIndex], ...customer };
    } else {
        newCustomers.push(customer);
    }
    CACHE.customers = newCustomers;
    _saveNode('customers', newCustomers);
  },

  // Bookings
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

  saveBookings: (bookings: Booking[]) => { CACHE.bookings = bookings; _saveNode('bookings', bookings); },
  
  addBooking: (booking: Booking) => {
    const newBookings = [...CACHE.bookings, booking];
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
        _logAction('CREATE', booking, `Tạo mới đơn đặt phòng ${booking.id}`, booking.createdBy);
    }, 100);
  },

  updateBooking: (updatedBooking: Booking) => {
    const bookings = [...CACHE.bookings];
    const index = bookings.findIndex(b => b.id === updatedBooking.id);
    if (index !== -1) {
      const oldStatus = bookings[index].status;
      bookings[index] = updatedBooking;
      CACHE.bookings = bookings;

      let actionType: HistoryLog['action'] = 'UPDATE';
      let desc = `Cập nhật thông tin đơn ${updatedBooking.id}`;
      let roomUpdated = false;

      if (updatedBooking.status !== oldStatus) {
        const rIdx = CACHE.rooms.findIndex(r => r.id === updatedBooking.roomId);
        
        if (updatedBooking.status === BookingStatus.CHECKED_IN) {
           if(rIdx!==-1) { CACHE.rooms[rIdx].status = RoomStatus.OCCUPIED; roomUpdated = true; }
           actionType = 'CHECK_IN';
           desc = `Check-in đơn ${updatedBooking.id}`;
        } else if (updatedBooking.status === BookingStatus.CHECKED_OUT) {
           if(rIdx!==-1) { CACHE.rooms[rIdx].status = RoomStatus.VACANT_DIRTY; roomUpdated = true; }
           actionType = 'CHECK_OUT';
           desc = `Check-out đơn ${updatedBooking.id}`;
        } else if (updatedBooking.status === BookingStatus.CANCELLED) {
           if(rIdx!==-1) { CACHE.rooms[rIdx].status = RoomStatus.VACANT_CLEAN; roomUpdated = true; }
           actionType = 'CANCEL';
           desc = `Hủy đơn ${updatedBooking.id}`;
        }
      }
      
      _saveNode('bookings', bookings);
      if(roomUpdated) _saveNode('rooms', CACHE.rooms);

      setTimeout(() => {
         _logAction(actionType, updatedBooking, desc, updatedBooking.createdBy);
      }, 100);
    }
  },

  deleteBooking: _deleteBooking,

  // Users
  getUsers: (): User[] => CACHE.users,
  addUser: (user: User) => {
     CACHE.users = [...CACHE.users, user];
     _saveNode('users', CACHE.users);
  },
  updateUser: (updatedUser: User) => {
     const newUsers = [...CACHE.users];
     const idx = newUsers.findIndex(u => u.id === updatedUser.id);
     if (idx !== -1) {
         newUsers[idx] = updatedUser;
         CACHE.users = newUsers;
         _saveNode('users', newUsers);
     }
  },
  deleteUser: (userId: string) => {
    CACHE.users = CACHE.users.filter(u => u.id !== userId);
    _saveNode('users', CACHE.users);
  },

  exportToExcel: (data: any[], filename: string) => {
    if (data.length === 0 || typeof XLSX === 'undefined') {
        if(typeof XLSX === 'undefined') alert("Lỗi thư viện Excel. Vui lòng tải lại trang.");
        return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    const objectMaxLength: number[] = []; 
    data.forEach(d => {
        Object.values(d).forEach((value, i) => {
            let l = value ? value.toString().length : 0;
            objectMaxLength[i] = objectMaxLength[i] >= l ? objectMaxLength[i] : l;
        });
    });
    ws['!cols'] = objectMaxLength.map(w => ({ width: w + 2 }));
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  }
};
