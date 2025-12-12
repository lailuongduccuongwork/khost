
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, HistoryLog } from '../types';
import { INITIAL_BOOKINGS, INITIAL_CUSTOMERS, INITIAL_PROPERTIES, INITIAL_ROOMS, INITIAL_ROOM_TYPES, INITIAL_USERS } from './mockData';

// Declare XLSX from global scope (loaded via CDN)
declare const XLSX: any;

// Helper to get from local storage or default
const getFromStorage = <T,>(key: string, defaultVal: T): T => {
  const stored = localStorage.getItem(key);
  if (!stored) return defaultVal;
  try {
    return JSON.parse(stored);
  } catch (e) {
    return defaultVal;
  }
};

const saveToStorage = (key: string, data: any) => {
  localStorage.setItem(key, JSON.stringify(data));
};

export const DataService = {
  // --- History Logic ---
  getHistory: (): HistoryLog[] => {
      const history = getFromStorage<HistoryLog[]>('history', []);
      // Filter last 3 months
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return history.filter(h => new Date(h.timestamp) >= threeMonthsAgo);
  },

  logAction: (action: HistoryLog['action'], booking: Booking, description: string, staffId: string) => {
      const history = getFromStorage<HistoryLog[]>('history', []);
      const newLog: HistoryLog = {
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          action,
          description,
          bookingSnapshot: booking,
          staffId
      };
      
      // Add new log
      history.unshift(newLog);
      
      // Cleanup logs older than 3 months
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const cleanHistory = history.filter(h => new Date(h.timestamp) >= threeMonthsAgo);
      
      saveToStorage('history', cleanHistory);
  },

  // Properties
  getProperties: (): Property[] => getFromStorage('properties', INITIAL_PROPERTIES),
  saveProperties: (properties: Property[]) => saveToStorage('properties', properties),
  
  // Room Types
  getRoomTypes: (): RoomType[] => getFromStorage('roomTypes', INITIAL_ROOM_TYPES),
  saveRoomTypes: (types: RoomType[]) => saveToStorage('roomTypes', types),

  // Rooms
  getRooms: (propertyId?: string): Room[] => {
    const rooms = getFromStorage<Room[]>('rooms', INITIAL_ROOMS);
    if (propertyId) return rooms.filter(r => r.propertyId === propertyId);
    return rooms;
  },
  saveRooms: (rooms: Room[]) => saveToStorage('rooms', rooms),
  
  updateRoomStatus: (roomId: string, status: RoomStatus) => {
    const rooms = getFromStorage<Room[]>('rooms', INITIAL_ROOMS);
    const index = rooms.findIndex(r => r.id === roomId);
    if (index !== -1) {
      rooms[index].status = status;
      saveToStorage('rooms', rooms);
    }
  },

  // Customers
  getCustomers: (): Customer[] => getFromStorage('customers', INITIAL_CUSTOMERS),
  addCustomer: (customer: Customer) => {
    const customers = getFromStorage<Customer[]>('customers', INITIAL_CUSTOMERS);
    // Basic de-duplication
    const existing = customers.find(c => c.phone === customer.phone);
    if (existing) {
        Object.assign(existing, customer);
    } else {
        customers.push(customer);
    }
    saveToStorage('customers', customers);
  },

  // Bookings
  getBookings: (propertyId?: string): Booking[] => {
    const bookings = getFromStorage<Booking[]>('bookings', INITIAL_BOOKINGS);
    if (propertyId) return bookings.filter(b => b.propertyId === propertyId);
    return bookings;
  },
  
  generateBookingId: (): string => {
      const bookings = getFromStorage<Booking[]>('bookings', INITIAL_BOOKINGS);
      const now = new Date();
      const yy = now.getFullYear().toString().slice(-2);
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const sequence = bookings.length + 1 + Math.floor(Math.random() * 1000); // Random to avoid simple conflicts in demo
      const seqStr = sequence.toString().padStart(6, '0');
      return `${yy}-${mm}-${seqStr}`;
  },

  // --- Validation Logic ---
  validateRoomAvailability: (roomId: string, startIso: string, endIso: string, excludeBookingId?: string): { valid: boolean; reason?: string } => {
      const bookings = getFromStorage<Booking[]>('bookings', INITIAL_BOOKINGS);
      
      const newStart = new Date(startIso).getTime();
      const newEnd = new Date(endIso).getTime();
      const bufferMs = 30 * 60 * 1000; // 30 minutes buffer

      // Find conflicting bookings
      const conflict = bookings.find(b => {
          // Ignore self (for updates), deleted, or cancelled bookings
          if (b.id === excludeBookingId) return false;
          if (b.status === BookingStatus.DELETED || b.status === BookingStatus.CANCELLED) return false;
          if (b.roomId !== roomId) return false;

          const existStart = new Date(b.checkInDate).getTime();
          const existEnd = new Date(b.checkOutDate).getTime();

          // Standard Overlap Logic: (StartA < EndB) && (EndA > StartB)
          // Added Buffer Logic: 
          // New booking must start at least 30m AFTER existing ends: NewStart >= ExistEnd + 30m
          // New booking must end at least 30m BEFORE existing starts: NewEnd + 30m <= ExistStart
          
          // Therefore, collision exists if:
          // (NewStart < ExistEnd + Buffer) AND (NewEnd + Buffer > ExistStart)
          
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

  saveBookings: (bookings: Booking[]) => saveToStorage('bookings', bookings),
  
  addBooking: (booking: Booking) => {
    const bookings = getFromStorage<Booking[]>('bookings', INITIAL_BOOKINGS);
    bookings.push(booking);
    saveToStorage('bookings', bookings);
    
    // Auto update room status
    if (booking.status === BookingStatus.CHECKED_IN) {
      DataService.updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED);
    }

    DataService.logAction('CREATE', booking, `Tạo mới đơn đặt phòng ${booking.id}`, booking.createdBy);
  },

  updateBooking: (updatedBooking: Booking) => {
    const bookings = getFromStorage<Booking[]>('bookings', INITIAL_BOOKINGS);
    const index = bookings.findIndex(b => b.id === updatedBooking.id);
    if (index !== -1) {
      const oldStatus = bookings[index].status;
      bookings[index] = updatedBooking;
      saveToStorage('bookings', bookings);

      // Handle status transitions
      let actionType: HistoryLog['action'] = 'UPDATE';
      let desc = `Cập nhật thông tin đơn ${updatedBooking.id}`;

      if (updatedBooking.status !== oldStatus) {
        if (updatedBooking.status === BookingStatus.CHECKED_IN) {
           DataService.updateRoomStatus(updatedBooking.roomId, RoomStatus.OCCUPIED);
           actionType = 'CHECK_IN';
           desc = `Check-in đơn ${updatedBooking.id}`;
        } else if (updatedBooking.status === BookingStatus.CHECKED_OUT) {
           DataService.updateRoomStatus(updatedBooking.roomId, RoomStatus.VACANT_DIRTY);
           actionType = 'CHECK_OUT';
           desc = `Check-out đơn ${updatedBooking.id}`;
        } else if (updatedBooking.status === BookingStatus.CANCELLED) {
           DataService.updateRoomStatus(updatedBooking.roomId, RoomStatus.VACANT_CLEAN);
           actionType = 'CANCEL';
           desc = `Hủy đơn ${updatedBooking.id}`;
        }
      }
      
      DataService.logAction(actionType, updatedBooking, desc, updatedBooking.createdBy);
    }
  },

  // Completely remove from active bookings array, save to history
  deleteBooking: (bookingId: string, staffId: string): boolean => {
      let bookings = getFromStorage<Booking[]>('bookings', INITIAL_BOOKINGS);
      const index = bookings.findIndex(b => b.id === bookingId);
      
      if (index !== -1) {
          const bookingToDelete = bookings[index];
          // Log before deleting
          const deletedSnapshot = { ...bookingToDelete, status: BookingStatus.DELETED };
          DataService.logAction('DELETE', deletedSnapshot, `Xóa đơn ${bookingId} khỏi hệ thống`, staffId);
          
          // Restore room status if needed
          if (bookingToDelete.status === BookingStatus.CHECKED_IN) {
              DataService.updateRoomStatus(bookingToDelete.roomId, RoomStatus.VACANT_CLEAN);
          }

          // Remove from list
          bookings.splice(index, 1);
          saveToStorage('bookings', bookings);
          return true;
      }
      return false;
  },

  // Users
  getUsers: (): User[] => getFromStorage('users', INITIAL_USERS),
  addUser: (user: User) => {
     const users = getFromStorage<User[]>('users', INITIAL_USERS);
     users.push(user);
     saveToStorage('users', users);
  },
  deleteUser: (userId: string) => {
    let users = getFromStorage<User[]>('users', INITIAL_USERS);
    users = users.filter(u => u.id !== userId);
    saveToStorage('users', users);
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
