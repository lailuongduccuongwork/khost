
import { Booking, BookingStatus, Customer, Property, Room, RoomStatus, RoomType, User, UserRole, PERMISSIONS } from '../types';

export const INITIAL_PROPERTIES: Property[] = [
  { id: 'p1', name: 'K-Host Hà Nội', address: '123 Kim Mã, Ba Đình, Hà Nội' },
  { id: 'p2', name: 'K-Host Đà Nẵng', address: '456 Võ Văn Kiệt, Sơn Trà, Đà Nẵng' },
];

export const INITIAL_ROOM_TYPES: RoomType[] = [
  { id: 'rt1', name: 'Standard Single', price: 500000, capacity: 1 },
  { id: 'rt2', name: 'Deluxe Double', price: 800000, capacity: 2 },
  { id: 'rt3', name: 'Suite Family', price: 1500000, capacity: 4 },
];

export const INITIAL_ROOMS: Room[] = [
  // Hanoi Rooms
  { id: 'r101', number: '101', typeId: 'rt1', propertyId: 'p1', status: RoomStatus.VACANT_CLEAN, floor: 1 },
  { id: 'r102', number: '102', typeId: 'rt2', propertyId: 'p1', status: RoomStatus.OCCUPIED, floor: 1 },
  { id: 'r103', number: '103', typeId: 'rt1', propertyId: 'p1', status: RoomStatus.VACANT_DIRTY, floor: 1 },
  { id: 'r201', number: '201', typeId: 'rt3', propertyId: 'p1', status: RoomStatus.VACANT_CLEAN, floor: 2 },
  { id: 'r202', number: '202', typeId: 'rt2', propertyId: 'p1', status: RoomStatus.MAINTENANCE, floor: 2 },
  // Danang Rooms
  { id: 'r301', number: '301', typeId: 'rt2', propertyId: 'p2', status: RoomStatus.VACANT_CLEAN, floor: 3 },
  { id: 'r302', number: '302', typeId: 'rt3', propertyId: 'p2', status: RoomStatus.OCCUPIED, floor: 3 },
];

export const INITIAL_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Nguyễn Văn A', phone: '0912345678', identityCard: '001090000001' },
  { id: 'c2', name: 'Trần Thị B', phone: '0987654321', identityCard: '001090000002' },
];

export const INITIAL_BOOKINGS: Booking[] = [
  {
    id: 'b1',
    propertyId: 'p1',
    roomId: 'r102',
    customerId: 'c1',
    guestName: 'Nguyễn Văn A',
    guestPhone: '0912345678',
    checkInDate: new Date().toISOString(),
    checkOutDate: new Date(Date.now() + 86400000 * 2).toISOString(),
    status: BookingStatus.CHECKED_IN,
    totalPrice: 1600000,
    paidAmount: 500000,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    createdBy: 'u2',
    notes: 'Khách quen, cần thêm gối'
  },
  {
    id: 'b2',
    propertyId: 'p2',
    roomId: 'r302',
    customerId: 'c2',
    guestName: 'Trần Thị B',
    guestPhone: '0987654321',
    checkInDate: new Date().toISOString(),
    checkOutDate: new Date(Date.now() + 86400000).toISOString(),
    status: BookingStatus.CHECKED_IN,
    totalPrice: 1500000,
    paidAmount: 1500000,
    createdAt: new Date(Date.now() - 100000).toISOString(),
    createdBy: 'u1',
    notes: ''
  }
];

export const INITIAL_USERS: User[] = [
  {
    id: 'u1',
    username: 'admin',
    fullName: 'Quản trị viên',
    role: UserRole.ADMIN,
    password: '123',
    // propertyId removed to avoid undefined error in Firebase
    permissions: Object.values(PERMISSIONS),
  },
  {
    id: 'u2',
    username: 'manager_hn',
    fullName: 'Quản lý Hà Nội',
    role: UserRole.MANAGER,
    password: '123',
    propertyId: 'p1',
    permissions: [PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.MANAGE_ROOMS, PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.VIEW_REPORTS],
  },
  {
    id: 'u3',
    username: 'le_tan',
    fullName: 'Lễ tân',
    role: UserRole.RECEPTIONIST,
    password: '123',
    propertyId: 'p1',
    permissions: [PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.MANAGE_ROOMS, PERMISSIONS.MANAGE_BOOKINGS],
  }
];
