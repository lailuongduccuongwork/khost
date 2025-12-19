
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
  SUPER_ADMIN = 'SUPER_ADMIN', // Platform Owner
  ADMIN = 'ADMIN',             // Tenant Owner
  MANAGER = 'MANAGER',
  RECEPTIONIST = 'RECEPTIONIST',
  HOUSEKEEPING = 'HOUSEKEEPING',
}

// SaaS: Subscription Plan
export interface SubscriptionPlan {
    id: string;
    name: string;
    price: number; // Monthly price
    maxRooms: number;
    maxUsers: number;
    description?: string;
}

// SaaS: Tenant Entity
export interface Tenant {
  id: string;
  name: string;
  domain?: string; // e.g., hotel-a.khost.com
  status: 'ACTIVE' | 'LOCKED' | 'EXPIRED';
  planId: string; // Links to SubscriptionPlan
  subscriptionEndDate: string; // ISO Date
  createdAt: string;
  
  // Admin Credentials (for quick view/reset by Super Admin)
  adminUsername?: string;
  adminPassword?: string; // In real app, never store plain text!
}

export interface Tag {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  name: string;
  color: string; // Hex code
}

// --- NEW INTERFACES FOR FINANCIALS ---
export interface TransactionCategory {
    id: string;
    tenantId?: string;
    name: string;
    type: 'REVENUE' | 'EXPENSE'; // Thu hoặc Chi
}

export interface ExtraFee {
    id: string;
    categoryId: string; // Link tới TransactionCategory
    name: string; // Lưu cứng tên tại thời điểm tạo (đề phòng danh mục bị xoá)
    amount: number; // Số tiền
    type: 'REVENUE' | 'EXPENSE';
}
// -------------------------------------

export interface Property {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  name: string;
  address: string;
  sortOrder?: number; // Order for display
}

export interface RoomType {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  name: string;
  price: number;
  capacity: number;
  sortOrder?: number; // Order for display
}

export interface Room {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  number: string;
  typeId: string;
  propertyId: string;
  status: RoomStatus;
  floor: number;
  sortOrder?: number; // Order for display
}

export interface Customer {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  name: string;
  phone: string;
  email?: string;
  identityCard: string;
}

export interface Booking {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
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
  
  // Added field for extra fees
  extraFees?: ExtraFee[]; 
  
  createdAt: string;
  createdBy: string; // User ID
  notes?: string;
  tags?: string[]; // Array of Tag IDs
}

export interface User {
  id: string;
  tenantId: string; // REQUIRED for standard users, can be 'SYSTEM' for Super Admin
  username: string;
  fullName: string;
  role: UserRole;
  allowedPropertyIds?: string[]; // List of property IDs user can access. If empty/undefined for Admin, means ALL.
  password?: string; 
  permissions: string[];
}

export interface HistoryLog {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
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
  
  // Fine-grained permissions
  CAN_ADD_BOOKING: 'can_add_booking',
  CAN_EDIT_BOOKING: 'can_edit_booking',
  CAN_DELETE_BOOKING: 'can_delete_booking',
  CAN_EXPORT_REPORT: 'can_export_report',
};
