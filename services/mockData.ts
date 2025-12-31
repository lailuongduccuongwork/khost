
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, PERMISSIONS, Tag, Tenant, SubscriptionPlan, TransactionCategory } from '../types';

// SaaS: Subscription Plans
export const INITIAL_PLANS: SubscriptionPlan[] = [
    { id: 'plan_basic', name: 'Gói Cơ Bản', price: 299000, maxRooms: 10, maxUsers: 2, description: 'Dành cho homestay nhỏ' },
    { id: 'plan_pro', name: 'Gói Chuyên Nghiệp', price: 599000, maxRooms: 50, maxUsers: 10, description: 'Dành cho khách sạn vừa và nhỏ' },
    { id: 'plan_enterprise', name: 'Gói Doanh Nghiệp', price: 999000, maxRooms: 999, maxUsers: 999, description: 'Không giới hạn tính năng' }
];

// SaaS: Mock Tenants
export const INITIAL_TENANTS: Tenant[] = [
    { 
        id: 'tenant_demo', 
        name: 'Demo Hotel Group', 
        domain: 'demo.khost.vn',
        status: 'ACTIVE', 
        planId: 'plan_pro', 
        subscriptionEndDate: new Date(Date.now() + 86400000 * 30).toISOString(), 
        createdAt: new Date().toISOString(),
        adminUsername: 'admin',
        adminPassword: '000'
    }
];

const DEFAULT_TENANT_ID = 'tenant_demo';

export const INITIAL_PROPERTIES: Property[] = [
  { id: 'p1', tenantId: DEFAULT_TENANT_ID, name: 'K-Host Hà Nội', address: '123 Kim Mã, Ba Đình, Hà Nội', sortOrder: 0 },
  { id: 'p2', tenantId: DEFAULT_TENANT_ID, name: 'K-Host Đà Nẵng', address: '456 Võ Văn Kiệt, Sơn Trà, Đà Nẵng', sortOrder: 1 },
];

// NEW: Initial Transaction Categories
export const INITIAL_TRANSACTION_CATEGORIES: TransactionCategory[] = [
  { id: 'cat_drink', tenantId: DEFAULT_TENANT_ID, name: 'Nước ngọt/Minibar', type: 'REVENUE' },
  { id: 'cat_laundry', tenantId: DEFAULT_TENANT_ID, name: 'Giặt là', type: 'REVENUE' },
  { id: 'cat_bike', tenantId: DEFAULT_TENANT_ID, name: 'Thuê xe máy', type: 'REVENUE' },
  { id: 'cat_other_rev', tenantId: DEFAULT_TENANT_ID, name: 'Thu khác', type: 'REVENUE' },
  { id: 'cat_taxi_help', tenantId: DEFAULT_TENANT_ID, name: 'Chi hộ tiền xe', type: 'EXPENSE' },
  { id: 'cat_repair', tenantId: DEFAULT_TENANT_ID, name: 'Sửa chữa vặt', type: 'EXPENSE' },
  { id: 'cat_commission', tenantId: DEFAULT_TENANT_ID, name: 'Hoa hồng Sale', type: 'EXPENSE' },
  { id: 'cat_other_exp', tenantId: DEFAULT_TENANT_ID, name: 'Chi khác', type: 'EXPENSE' },
];

export const INITIAL_TAGS: Tag[] = [
  { id: 'tag1', tenantId: DEFAULT_TENANT_ID, name: 'Combo', color: '#22c55e' }, // Green-500
  { id: 'tag2', tenantId: DEFAULT_TENANT_ID, name: 'Staycation', color: '#38bdf8' }, // Sky-400
];

export const INITIAL_ROOM_TYPES: RoomType[] = [
  { id: 'rt1', tenantId: DEFAULT_TENANT_ID, name: 'Standard Single', price: 500000, capacity: 1, sortOrder: 0 },
  { id: 'rt2', tenantId: DEFAULT_TENANT_ID, name: 'Deluxe Double', price: 800000, capacity: 2, sortOrder: 1 },
  { id: 'rt3', tenantId: DEFAULT_TENANT_ID, name: 'Suite Family', price: 1500000, capacity: 4, sortOrder: 2 },
];

export const INITIAL_ROOMS: Room[] = [
  // Hanoi Rooms
  { id: 'r101', tenantId: DEFAULT_TENANT_ID, number: '101', typeId: 'rt1', propertyId: 'p1', status: RoomStatus.VACANT_CLEAN, floor: 1, sortOrder: 0 },
  { id: 'r102', tenantId: DEFAULT_TENANT_ID, number: '102', typeId: 'rt2', propertyId: 'p1', status: RoomStatus.VACANT_CLEAN, floor: 1, sortOrder: 1 },
  { id: 'r103', tenantId: DEFAULT_TENANT_ID, number: '103', typeId: 'rt1', propertyId: 'p1', status: RoomStatus.VACANT_CLEAN, floor: 1, sortOrder: 2 },
  { id: 'r201', tenantId: DEFAULT_TENANT_ID, number: '201', typeId: 'rt3', propertyId: 'p1', status: RoomStatus.VACANT_CLEAN, floor: 2, sortOrder: 3 },
  { id: 'r202', tenantId: DEFAULT_TENANT_ID, number: '202', typeId: 'rt2', propertyId: 'p1', status: RoomStatus.MAINTENANCE, floor: 2, sortOrder: 4 },
  // Danang Rooms
  { id: 'r301', tenantId: DEFAULT_TENANT_ID, number: '301', typeId: 'rt2', propertyId: 'p2', status: RoomStatus.VACANT_CLEAN, floor: 3, sortOrder: 0 },
  { id: 'r302', tenantId: DEFAULT_TENANT_ID, number: '302', typeId: 'rt3', propertyId: 'p2', status: RoomStatus.VACANT_CLEAN, floor: 3, sortOrder: 1 },
];

export const INITIAL_CUSTOMERS: Customer[] = [
  { id: 'c1', tenantId: DEFAULT_TENANT_ID, name: 'Nguyễn Văn A', phone: '0912345678', identityCard: '001090000001' },
  { id: 'c2', tenantId: DEFAULT_TENANT_ID, name: 'Trần Thị B', phone: '0987654321', identityCard: '001090000002' },
];

// EMPTY BOOKINGS TO RESET SYSTEM
export const INITIAL_BOOKINGS: Booking[] = [];

export const INITIAL_USERS: User[] = [
  {
    id: 'super_admin',
    tenantId: 'SYSTEM',
    username: 'K@superadmin',
    fullName: 'Platform Owner',
    role: UserRole.SUPER_ADMIN,
    password: 'K@superadminx0204',
    permissions: []
  },
  {
    id: 'u1',
    tenantId: DEFAULT_TENANT_ID,
    username: 'admin',
    fullName: 'Chủ khách sạn (Tenant Admin)',
    role: UserRole.ADMIN,
    password: '000',
    allowedPropertyIds: [], // Empty means access all
    permissions: Object.values(PERMISSIONS),
  },
  {
    id: 'u2',
    tenantId: DEFAULT_TENANT_ID,
    username: 'manager_hn',
    fullName: 'Quản lý Hà Nội',
    role: UserRole.MANAGER,
    password: '123',
    allowedPropertyIds: ['p1'],
    permissions: [
        PERMISSIONS.MANAGE_ROOMS,     // Sơ đồ phòng
        PERMISSIONS.VIEW_REPORTS,     // Xem Báo cáo
        PERMISSIONS.CAN_ADD_BOOKING,
        PERMISSIONS.CAN_EDIT_BOOKING,
        PERMISSIONS.CAN_DELETE_BOOKING
    ],
  },
  {
    id: 'u3',
    tenantId: DEFAULT_TENANT_ID,
    username: 'le_tan',
    fullName: 'Lễ tân',
    role: UserRole.RECEPTIONIST,
    password: '123',
    allowedPropertyIds: ['p1', 'p2'], 
    permissions: [
        PERMISSIONS.MANAGE_ROOMS, 
        PERMISSIONS.CAN_ADD_BOOKING,
        PERMISSIONS.CAN_EDIT_BOOKING
    ],
  }
];
