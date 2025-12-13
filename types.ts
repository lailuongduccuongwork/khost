
export enum RoomStatus {
  VACANT_CLEAN = 'VACANT_CLEAN',
  VACANT_DIRTY = 'VACANT_DIRTY',
  OCCUPIED = 'OCCUPIED',
  MAINTENANCE = 'MAINTENANCE',
}

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
  DELETED = 'DELETED', // Soft delete status
}

export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  RECEPTIONIST = 'RECEPTIONIST',
  HOUSEKEEPING = 'HOUSEKEEPING',
}

export interface Tag {
  id: string;
  name: string;
  color: string; // Hex code
}

export interface Property {
  id: string;
  name: string;
  address: string;
}

export interface RoomType {
  id: string;
  name: string;
  price: number;
  capacity: number;
}

export interface Room {
  id: string;
  number: string;
  typeId: string;
  propertyId: string;
  status: RoomStatus;
  floor: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  identityCard: string;
}

export interface Booking {
  id: string;
  propertyId: string;
  roomId: string;
  customerId: string; // Links to Customer
  // Snapshot of guest info at time of booking (in case customer record changes or for quick access)
  guestName: string;
  guestPhone: string;
  
  groupId?: string; // New field: Links multiple bookings together as a group
  
  checkInDate: string; // ISO Date string
  checkOutDate: string; // ISO Date string
  status: BookingStatus;
  
  totalPrice: number;
  paidAmount: number;
  
  createdAt: string;
  createdBy: string; // User ID
  notes?: string;
  tags?: string[]; // Array of Tag IDs
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  propertyId?: string; // If null, can access all (Super Admin)
  password?: string; 
  permissions: string[];
}

export interface HistoryLog {
  id: string;
  timestamp: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CHECK_IN' | 'CHECK_OUT' | 'CANCEL';
  description: string;
  bookingSnapshot: Booking; // Store full booking data
  staffId: string;
}

// Permissions Constants
export const PERMISSIONS = {
  VIEW_DASHBOARD: 'view_dashboard',
  MANAGE_ROOMS: 'manage_rooms', 
  MANAGE_BOOKINGS: 'manage_bookings', 
  VIEW_REPORTS: 'view_reports',
  ADMIN_SETTINGS: 'admin_settings', 
};
