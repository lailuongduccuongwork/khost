

export enum RoomStatus {
  VACANT_CLEAN = 'VACANT_CLEAN',
  VACANT_DIRTY = 'VACANT_DIRTY',
  OCCUPIED = 'OCCUPIED',
}

export enum BookingStatus {
  HOLD = 'HOLD',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
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
  adminPasswordHash?: string;
  adminPasswordView?: string;
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

export interface NotificationSettings {
  enabled: boolean;
  inAppEnabled: boolean;
  soundEnabled: boolean;
  browserEnabled: boolean;
  bookingAlerts: {
    checkInEnabled: boolean;
    checkOutEnabled: boolean;
    minutesBefore: number;
    atTimeEnabled: boolean;
  };
  debtAlerts: {
    enabled: boolean;
    minutesBeforeCheckout: number;
    atCheckoutEnabled: boolean;
    dailyReminderEnabled: boolean;
    dailyHours: number[];
  };
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  inAppEnabled: true,
  soundEnabled: true,
  browserEnabled: true,
  bookingAlerts: {
    checkInEnabled: true,
    checkOutEnabled: true,
    minutesBefore: 5,
    atTimeEnabled: true,
  },
  debtAlerts: {
    enabled: true,
    minutesBeforeCheckout: 60,
    atCheckoutEnabled: true,
    dailyReminderEnabled: true,
    dailyHours: [15, 21],
  },
};

const normalizeNotificationBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

const normalizeNotificationMinutes = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.min(1440, Math.round(numeric));
};

export const normalizeNotificationSettings = (value?: any): NotificationSettings => {
  const source = value && typeof value === 'object' ? value : {};
  const bookingAlerts = source.bookingAlerts && typeof source.bookingAlerts === 'object' ? source.bookingAlerts : {};
  const debtAlerts = source.debtAlerts && typeof source.debtAlerts === 'object' ? source.debtAlerts : {};
  const dailyHours = Array.isArray(debtAlerts.dailyHours)
    ? Array.from(new Set(
        debtAlerts.dailyHours
          .map((hour: unknown) => Number(hour))
          .filter((hour: number) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
      )).sort((a, b) => a - b)
    : DEFAULT_NOTIFICATION_SETTINGS.debtAlerts.dailyHours;

  return {
    enabled: normalizeNotificationBoolean(source.enabled, DEFAULT_NOTIFICATION_SETTINGS.enabled),
    inAppEnabled: normalizeNotificationBoolean(source.inAppEnabled, DEFAULT_NOTIFICATION_SETTINGS.inAppEnabled),
    soundEnabled: normalizeNotificationBoolean(source.soundEnabled, DEFAULT_NOTIFICATION_SETTINGS.soundEnabled),
    browserEnabled: normalizeNotificationBoolean(source.browserEnabled, DEFAULT_NOTIFICATION_SETTINGS.browserEnabled),
    bookingAlerts: {
      checkInEnabled: normalizeNotificationBoolean(
        bookingAlerts.checkInEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.bookingAlerts.checkInEnabled
      ),
      checkOutEnabled: normalizeNotificationBoolean(
        bookingAlerts.checkOutEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.bookingAlerts.checkOutEnabled
      ),
      minutesBefore: normalizeNotificationMinutes(
        bookingAlerts.minutesBefore,
        DEFAULT_NOTIFICATION_SETTINGS.bookingAlerts.minutesBefore
      ),
      atTimeEnabled: normalizeNotificationBoolean(
        bookingAlerts.atTimeEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.bookingAlerts.atTimeEnabled
      ),
    },
    debtAlerts: {
      enabled: normalizeNotificationBoolean(debtAlerts.enabled, DEFAULT_NOTIFICATION_SETTINGS.debtAlerts.enabled),
      minutesBeforeCheckout: normalizeNotificationMinutes(
        debtAlerts.minutesBeforeCheckout,
        DEFAULT_NOTIFICATION_SETTINGS.debtAlerts.minutesBeforeCheckout
      ),
      atCheckoutEnabled: normalizeNotificationBoolean(
        debtAlerts.atCheckoutEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.debtAlerts.atCheckoutEnabled
      ),
      dailyReminderEnabled: normalizeNotificationBoolean(
        debtAlerts.dailyReminderEnabled,
        DEFAULT_NOTIFICATION_SETTINGS.debtAlerts.dailyReminderEnabled
      ),
      dailyHours,
    },
  };
};

export interface Property {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  name: string;
  address: string;
  sortOrder?: number; // Order for display
  excludeFromDashboard?: boolean; // Không tính chi nhánh này vào Tổng quan
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
  excludeFromDashboard?: boolean; // Không tính phòng này vào Tổng quan
}

export type RoomPolicyMode = 'LOCKED' | 'HOURLY_ONLY';
export type RoomPolicyRecurrence = 'NONE' | 'WEEKLY';

export interface RoomPolicyRule {
  id: string;
  tenantId?: string;
  mode: RoomPolicyMode;
  reason?: string;
  isActive: boolean;
  startDate: string; // yyyy-mm-dd
  endDate?: string; // yyyy-mm-dd (inclusive)
  recurrence: RoomPolicyRecurrence;
  weekdays?: number[]; // 0-6 (CN-T7), dùng cho WEEKLY
  checkInHour?: number; // mặc định 14
  checkOutHour?: number; // mặc định 12 (ngày hôm sau)
  maxStayHours?: number; // dùng cho HOURLY_ONLY, mặc định 12
  propertyIds?: string[];
  roomTypeIds?: string[];
  roomIds?: string[];
  createdAt: string;
  createdBy: string;
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
  
  importBatchId?: string; // For undoing imports
  isHold?: boolean; // Đơn giữ cọc tạm thời
  holdUntil?: string; // ISO time, hết hạn thì tự xoá
}

export interface User {
  id: string;
  tenantId: string; // REQUIRED for standard users, can be 'SYSTEM' for Super Admin
  username: string;
  fullName: string;
  role: UserRole;
  allowedPropertyIds?: string[]; // List of property IDs user can access. If empty/undefined for Admin, means ALL.
  password?: string; 
  passwordHash?: string;
  passwordView?: string;
  permissions: string[];
}

export type HistoryAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'CANCEL'
  | 'LOGIN'
  | 'LOGOUT'
  | 'IMPORT'
  | 'EXPORT'
  | 'RESET'
  | 'STATUS_CHANGE'
  | 'REORDER'
  | 'BULK_DELETE';

export type HistoryEntityType =
  | 'AUTH'
  | 'BOOKING'
  | 'ROOM'
  | 'USER'
  | 'CUSTOMER'
  | 'PROPERTY'
  | 'ROOM_TYPE'
  | 'ROOM_POLICY'
  | 'TAG'
  | 'TRANSACTION_CATEGORY'
  | 'REPORT'
  | 'TENANT'
  | 'PLAN'
  | 'SYSTEM';

export interface HistoryLog {
  id: string;
  tenantId?: string; // Multi-tenant Foreign Key
  timestamp: string;
  action: HistoryAction | string;
  entityType?: HistoryEntityType | string;
  entityId?: string;
  entityLabel?: string;
  description: string;
  actorId?: string;
  actorName?: string;
  actorUsername?: string;
  actorRole?: UserRole | 'SYSTEM';
  source?: 'WEB' | 'SYSTEM' | 'IMPORT';
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  bookingSnapshot?: Booking; // Legacy compatibility + booking-focused details
  staffId?: string; // Legacy compatibility
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
  VIEW_AUDIT_LOGS: 'view_audit_logs',
};
