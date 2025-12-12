
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, HistoryLog } from '../types';
import { INITIAL_BOOKINGS, INITIAL_CUSTOMERS, INITIAL_PROPERTIES, INITIAL_ROOMS, INITIAL_ROOM_TYPES, INITIAL_USERS } from './mockData';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, get, child } from "firebase/database";

// Declare XLSX from global scope (loaded via CDN)
declare const XLSX: any;

// --- FIREBASE CONFIGURATION ---
// BẠN CẦN THAY THẾ CÁC THÔNG SỐ NÀY BẰNG CẤU HÌNH TỪ FIREBASE CONSOLE CỦA BẠN
const firebaseConfig = {
  apiKey: "AIzaSyAZOB79Cz0Lj-zrRGmcackL0A3bsRBEwSc",
  authDomain: "k-host-a2a95.firebaseapp.com",
  databaseURL: "https://k-host-a2a95-default-rtdb.asia-southeast1.firebasedatabase.app", // Thay bằng URL database của bạn
  projectId: "k-host-a2a95",
  storageBucket: "k-host-a2a95.firebasestorage.app",
  messagingSenderId: "875551915320",
  appId: "1:875551915320:web:9516f334551de0a96495cd"
};

// Initialize Firebase
let db: any = null;
let isFirebaseReady = false;

// --- IN-MEMORY CACHE ---
// Giữ dữ liệu trong RAM để truy xuất nhanh (synchronous) cho UI
const CACHE = {
    properties: [] as Property[],
    rooms: [] as Room[],
    roomTypes: [] as RoomType[],
    bookings: [] as Booking[],
    customers: [] as Customer[],
    users: [] as User[],
    history: [] as HistoryLog[]
};

// --- INITIALIZATION ---
// Hàm này được gọi từ App.tsx khi khởi động
const _initRealtimeConnection = (onDataChange: () => void) => {
    try {
        // Chỉ init 1 lần
        if (!isFirebaseReady) {
             // Fallback nếu người dùng chưa điền config thật
             if (firebaseConfig.apiKey.includes("REPLACE_ME")) {
                 console.warn("⚠️ CHƯA CẤU HÌNH FIREBASE: Sử dụng Mock Data cục bộ. Dữ liệu sẽ KHÔNG ĐỒNG BỘ giữa các máy.");
                 _loadFromMockOrStorage();
                 onDataChange();
                 return;
             }

             const app = initializeApp(firebaseConfig);
             db = getDatabase(app);
             isFirebaseReady = true;

             const dbRef = ref(db);
             
             // Lắng nghe toàn bộ dữ liệu thay đổi
             onValue(dbRef, (snapshot) => {
                 const data = snapshot.val();
                 if (data) {
                     // Cập nhật Cache từ Firebase
                     CACHE.properties = data.properties || [];
                     CACHE.rooms = data.rooms || [];
                     CACHE.roomTypes = data.roomTypes || [];
                     CACHE.bookings = data.bookings || [];
                     CACHE.customers = data.customers || [];
                     CACHE.users = data.users || [];
                     CACHE.history = data.history || [];
                 } else {
                     // Nếu DB trống (lần đầu chạy), đẩy dữ liệu mẫu lên
                     console.log("Database trống, khởi tạo dữ liệu mẫu...");
                     _resetToMockData();
                 }
                 // Báo cho React render lại
                 onDataChange();
             }, (error) => {
                 console.error("Firebase Read Error:", error);
                 alert("Lỗi kết nối CSDL: " + error.message);
             });
        }
    } catch (e) {
        console.error("Firebase Init Error:", e);
        _loadFromMockOrStorage();
        onDataChange();
    }
};

const _loadFromMockOrStorage = () => {
    // Fallback logic giống code cũ nếu không có Firebase
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
};

const _resetToMockData = () => {
    CACHE.properties = INITIAL_PROPERTIES;
    CACHE.rooms = INITIAL_ROOMS;
    CACHE.roomTypes = INITIAL_ROOM_TYPES;
    CACHE.bookings = INITIAL_BOOKINGS;
    CACHE.customers = INITIAL_CUSTOMERS;
    CACHE.users = INITIAL_USERS;
    _syncToCloud(); // Đẩy lên Firebase
};

// Hàm lưu toàn bộ cache lên Firebase (hoặc localStorage nếu chưa config)
const _syncToCloud = () => {
    if (isFirebaseReady && db) {
        set(ref(db), CACHE).catch(err => console.error("Sync failed", err));
    } else {
        localStorage.setItem('properties', JSON.stringify(CACHE.properties));
        localStorage.setItem('rooms', JSON.stringify(CACHE.rooms));
        localStorage.setItem('roomTypes', JSON.stringify(CACHE.roomTypes));
        localStorage.setItem('bookings', JSON.stringify(CACHE.bookings));
        localStorage.setItem('customers', JSON.stringify(CACHE.customers));
        localStorage.setItem('users', JSON.stringify(CACHE.users));
        localStorage.setItem('history', JSON.stringify(CACHE.history));
    }
};


// --- Internal Helper Functions ---

const _getHistory = (): HistoryLog[] => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return CACHE.history.filter(h => new Date(h.timestamp) >= threeMonthsAgo);
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
    
    // Unshift into cache
    const history = [...CACHE.history]; // copy
    history.unshift(newLog);
    
    // Clean old
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    CACHE.history = history.filter(h => new Date(h.timestamp) >= threeMonthsAgo);
    
    _syncToCloud();
};

const _updateRoomStatus = (roomId: string, status: RoomStatus) => {
    const index = CACHE.rooms.findIndex(r => r.id === roomId);
    if (index !== -1) {
      const updatedRooms = [...CACHE.rooms];
      updatedRooms[index] = { ...updatedRooms[index], status };
      CACHE.rooms = updatedRooms;
      _syncToCloud();
    }
};

const _deleteBooking = (bookingId: string, staffId: string): boolean => {
    try {
        const bookings = [...CACHE.bookings];
        const index = bookings.findIndex(b => b.id === bookingId);
        
        if (index !== -1) {
            const bookingToDelete = bookings[index];
            
            // Restore room status if needed
            if (bookingToDelete.status === BookingStatus.CHECKED_IN) {
                _updateRoomStatus(bookingToDelete.roomId, RoomStatus.VACANT_CLEAN);
            }

            // Log before deleting
            const deletedSnapshot = { ...bookingToDelete, status: BookingStatus.DELETED };
            _logAction('DELETE', deletedSnapshot, `Xóa đơn ${bookingId} khỏi hệ thống`, staffId);
            
            // Remove from list
            bookings.splice(index, 1);
            CACHE.bookings = bookings;
            _syncToCloud();
            return true;
        }
        return false;
    } catch (e) {
        console.error("[DataService] deleteBooking error:", e);
        return false;
    }
};

// --- Exported Service ---
export const DataService = {
  // New Init Method
  init: _initRealtimeConnection,
  
  getHistory: _getHistory,
  logAction: _logAction,

  // Properties
  getProperties: (): Property[] => CACHE.properties,
  saveProperties: (properties: Property[]) => { CACHE.properties = properties; _syncToCloud(); },
  
  // Room Types
  getRoomTypes: (): RoomType[] => CACHE.roomTypes,
  saveRoomTypes: (types: RoomType[]) => { CACHE.roomTypes = types; _syncToCloud(); },

  // Rooms
  getRooms: (propertyId?: string): Room[] => {
    if (propertyId) return CACHE.rooms.filter(r => r.propertyId === propertyId);
    return CACHE.rooms;
  },
  saveRooms: (rooms: Room[]) => { CACHE.rooms = rooms; _syncToCloud(); },
  
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
    _syncToCloud();
  },

  // Bookings
  getBookings: (propertyId?: string): Booking[] => {
    if (propertyId) return CACHE.bookings.filter(b => b.propertyId === propertyId);
    return CACHE.bookings;
  },
  
  generateBookingId: (): string => {
      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const sequence = CACHE.bookings.length + 1 + Math.floor(Math.random() * 1000);
      const seqStr = sequence.toString().padStart(6, '0');
      return `${yy}-${mm}-${seqStr}`;
  },

  // --- Validation Logic ---
  validateRoomAvailability: (roomId: string, startIso: string, endIso: string, excludeBookingId?: string): { valid: boolean; reason?: string } => {
      const bookings = CACHE.bookings;
      
      const newStart = new Date(startIso).getTime();
      const newEnd = new Date(endIso).getTime();
      const bufferMs = 30 * 60 * 1000; // 30 minutes buffer

      const conflict = bookings.find(b => {
          if (b.id === excludeBookingId) return false;
          if (b.status === BookingStatus.DELETED || b.status === BookingStatus.CANCELLED) return false;
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

  saveBookings: (bookings: Booking[]) => { CACHE.bookings = bookings; _syncToCloud(); },
  
  addBooking: (booking: Booking) => {
    const newBookings = [...CACHE.bookings, booking];
    CACHE.bookings = newBookings;
    
    if (booking.status === BookingStatus.CHECKED_IN) {
      // Direct update to CACHE.rooms to avoid double sync, sync handles by next step
      const rIdx = CACHE.rooms.findIndex(r => r.id === booking.roomId);
      if(rIdx !== -1) CACHE.rooms[rIdx].status = RoomStatus.OCCUPIED;
    }

    _syncToCloud();
    // Log separately (will trigger another sync, but safe)
    // Delay slightly to ensure main sync starts
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

      // Handle status transitions
      let actionType: HistoryLog['action'] = 'UPDATE';
      let desc = `Cập nhật thông tin đơn ${updatedBooking.id}`;

      if (updatedBooking.status !== oldStatus) {
        const rIdx = CACHE.rooms.findIndex(r => r.id === updatedBooking.roomId);
        
        if (updatedBooking.status === BookingStatus.CHECKED_IN) {
           if(rIdx!==-1) CACHE.rooms[rIdx].status = RoomStatus.OCCUPIED;
           actionType = 'CHECK_IN';
           desc = `Check-in đơn ${updatedBooking.id}`;
        } else if (updatedBooking.status === BookingStatus.CHECKED_OUT) {
           if(rIdx!==-1) CACHE.rooms[rIdx].status = RoomStatus.VACANT_DIRTY;
           actionType = 'CHECK_OUT';
           desc = `Check-out đơn ${updatedBooking.id}`;
        } else if (updatedBooking.status === BookingStatus.CANCELLED) {
           if(rIdx!==-1) CACHE.rooms[rIdx].status = RoomStatus.VACANT_CLEAN;
           actionType = 'CANCEL';
           desc = `Hủy đơn ${updatedBooking.id}`;
        }
      }
      
      _syncToCloud();
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
     _syncToCloud();
  },
  deleteUser: (userId: string) => {
    CACHE.users = CACHE.users.filter(u => u.id !== userId);
    _syncToCloud();
  },

  // Export to Excel (.xlsx)
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
