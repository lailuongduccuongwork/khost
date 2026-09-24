import {
    Booking,
    BookingCatalogItem,
    BookingFieldSettings,
    BookingStatus,
    Customer,
    DEFAULT_NOTIFICATION_SETTINGS,
    HistoryAction,
    HistoryEntityType,
    HistoryLog,
    NotificationSettings,
    PERMISSIONS,
    Property,
    Room,
    RoomPolicyRule,
    RoomStatus,
    RoomType,
    SubscriptionPlan,
    Tag,
    Tenant,
    TransactionCategory,
    User,
    UserRole,
    normalizeBookingFieldSettings,
    normalizeNotificationSettings,
} from '../types';
import {
    INITIAL_BOOKINGS,
    INITIAL_BOOKING_CATEGORIES,
    INITIAL_BOOKING_SOURCES,
    INITIAL_CUSTOMERS,
    INITIAL_PLANS,
    INITIAL_PROPERTIES,
    INITIAL_ROOMS,
    INITIAL_ROOM_TYPES,
    INITIAL_TAGS,
    INITIAL_TENANTS,
    INITIAL_TRANSACTION_CATEGORIES,
    INITIAL_USERS,
} from './mockData';
import { digestPassword, encodePasswordForView, verifyPassword } from '../utils/security';
import { deriveBookingStatus, deriveRoomOperationalStatus, isBookingOccupyingRoom } from '../utils/bookingState';
import { initializeApp } from 'firebase/app';
import { createRealtimePool } from '../utils/realtimePool';
import { checkoutQueryLowerBound, roomHistoryStart } from '../utils/bookingReadScope';
import { endAt, equalTo, getDatabase, get, limitToLast, onValue, orderByChild, query, ref, remove, runTransaction, serverTimestamp, set, startAt, update } from 'firebase/database';

declare const XLSX: any;
declare global {
    interface Window {
        __KHOST_FIREBASE_DEBUG__?: {
            counters: Record<string, { calls: number; bytes: number }>;
        };
    }
}

const requiredFirebaseEnvKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
] as const;

const missingFirebaseEnvKeys = requiredFirebaseEnvKeys.filter((key) => !import.meta.env[key]);

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let db: any = null;
let isFirebaseReady = false;

let activeTenantId: string | null = null;
const SYSTEM_TENANT_ID = 'SYSTEM';
let activeRealtimeUnsubscribers: Array<() => void> = [];
const missingQueryIndexPaths = new Set<string>();
let bookingIndexWriteEnabled = true;
const realtimePool = createRealtimePool<any>();
const AUDIT_COALESCE_WINDOW_MS = 1500;
const BOOKING_INDEX_FALLBACK_DELAY_MS = 1200;

const CACHE = {
    properties: [] as Property[],
    rooms: [] as Room[],
    roomPolicies: [] as RoomPolicyRule[],
    roomTypes: [] as RoomType[],
    bookings: [] as Booking[],
    customers: [] as Customer[],
    users: [] as User[],
    history: [] as HistoryLog[],
    tags: [] as Tag[],
    transactionCategories: [] as TransactionCategory[],
    bookingCategories: [] as BookingCatalogItem[],
    bookingSources: [] as BookingCatalogItem[],
    bookingFieldSettings: {} as BookingFieldSettings,
    notificationSettings: DEFAULT_NOTIFICATION_SETTINGS as NotificationSettings,
    tenants: [] as Tenant[],
    plans: [] as SubscriptionPlan[],
    systemUsers: [] as User[],
};

let _dataChangeCallback: () => void = () => {};
let realtimeConnectionState: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' = 'UNKNOWN';
let disconnectRealtimeConnectionWatcher: (() => void) | null = null;
const CONNECTION_PREFLIGHT_TIMEOUT_MS = 2000;
const BOOKING_INDEX_NODE = 'bookingIndexByPropertyDate';
const DASHBOARD_BOOKING_RANGE_CACHE_TTL_MS = 15000;
const dashboardBookingRangeInFlight = new Map<string, Promise<Booking[]>>();
const dashboardBookingRangeCache = new Map<string, { expiresAt: number; rows: Booking[] }>();
const dashboardBookingDetailInFlight = new Map<string, Promise<Booking | null>>();

type AuditSource = 'WEB' | 'SYSTEM' | 'IMPORT';
type AuditedNode =
    | 'properties'
    | 'rooms'
    | 'roomPolicies'
    | 'roomTypes'
    | 'bookings'
    | 'customers'
    | 'users'
    | 'tags'
    | 'transactionCategories'
    | 'bookingCategories'
    | 'bookingSources'
    | 'tenants'
    | 'plans';

interface AuditActor {
    id: string;
    username?: string;
    fullName?: string;
    role?: UserRole | 'SYSTEM';
    tenantId?: string;
    permissions?: string[];
    allowedPropertyIds?: string[];
}

interface CollectionConfig<T = any> {
    entityType: HistoryEntityType;
    label: string;
    collectionLabel: string;
    scopedByTenant?: boolean;
    getLabel: (item: T) => string;
}

interface HistoryParams {
    tenantId?: string | null;
    action: HistoryAction | string;
    entityType?: HistoryEntityType | string;
    entityId?: string;
    entityLabel?: string;
    description: string;
    before?: any;
    after?: any;
    metadata?: Record<string, any> | null;
    source?: AuditSource;
    staffId?: string;
    actor?: AuditActor;
    bookingSnapshot?: Booking;
    coalesceKey?: string;
}

interface BookingHistoryQueryParams {
    bookingIds?: string[];
    groupId?: string | null;
    limit?: number;
    tenantId?: string | null;
    fallbackLimit?: number;
}

interface RoomStatusOptions {
    reason?: string;
    source?: AuditSource;
    staffId?: string;
    suppressLog?: boolean;
    expectedRoom?: Pick<Room, 'status' | 'lastCleanedAt'>;
}

interface BookingActionOptions {
    source?: AuditSource;
    staffId?: string;
}

interface BookingGroupSaveItem {
    booking: Booking;
    mode: 'create' | 'update';
}

interface BookingGroupSaveParams {
    upserts: BookingGroupSaveItem[];
    deleteIds?: string[];
}

interface BookingIndexSummary {
    id: string;
    tenantId?: string;
    propertyId: string;
    roomId: string;
    customerId: string;
    guestName: string;
    guestPhone: string;
    groupId?: string | null;
    checkInDate: string;
    checkOutDate: string;
    status: BookingStatus | string;
    createdAt: string;
    updatedAt?: string;
    createdBy: string;
    bookingCategory?: string;
    bookingSource?: string;
    isHold?: boolean;
    holdUntil?: string | null;
    totalPrice: number;
    paidAmount: number;
    tags?: string[];
    hasNotes?: boolean;
    expenseFeeTotal?: number;
}

let currentAuditActor: AuditActor | null = null;
const recentAuditEntries = new Map<string, { id: string; timestamp: number }>();
const HOLD_CLEANUP_THROTTLE_MS = 10000;
let lastHoldCleanupAttemptMs = 0;

type BookingMutationMode = 'create' | 'update' | 'delete';
type ManagementCascadeDeleteKind = 'property' | 'roomType' | 'room';

interface ManagementCascadeDeleteImpact {
    kind: ManagementCascadeDeleteKind;
    targetId: string;
    rooms: number;
    roomTypes: number;
    bookings: number;
    roomPolicies: number;
}

interface ManagementCascadeDeletePlan {
    kind: ManagementCascadeDeleteKind;
    targetId: string;
    target: Property | RoomType | Room;
    impactedRooms: Room[];
    impactedRoomTypes: RoomType[];
    impactedBookings: Booking[];
    impactedPolicies: RoomPolicyRule[];
    impact: ManagementCascadeDeleteImpact;
}

const isSystemMutation = (source?: AuditSource) =>
    source === 'SYSTEM' ||
    currentAuditActor?.role === 'SYSTEM' ||
    currentAuditActor?.role === UserRole.SUPER_ADMIN ||
    activeTenantId === SYSTEM_TENANT_ID;

const isTenantAdminActor = () =>
    currentAuditActor?.role === UserRole.ADMIN || currentAuditActor?.role === UserRole.SUPER_ADMIN;

const actorHasAnyPermission = (permissions: string[], source?: AuditSource) => {
    if (!currentAuditActor || isSystemMutation(source) || isTenantAdminActor()) return true;
    const actorPermissions = currentAuditActor.permissions || [];
    return permissions.some((permission) => actorPermissions.includes(permission));
};

const assertActorHasAnyPermission = (permissions: string[], actionLabel: string, source?: AuditSource) => {
    if (actorHasAnyPermission(permissions, source)) return;
    throw new Error(`Bạn không có quyền ${actionLabel}.`);
};

const assertTenantWriteScope = (item: any, actionLabel: string, source?: AuditSource) => {
    if (!item || isSystemMutation(source)) return;
    if (!activeTenantId || activeTenantId === SYSTEM_TENANT_ID) return;
    if (item.tenantId && item.tenantId !== activeTenantId) {
        throw new Error(`Không thể ${actionLabel}: dữ liệu không thuộc tenant hiện tại.`);
    }
};

const assertPropertyWriteScope = (propertyId: string | undefined | null, actionLabel: string, source?: AuditSource) => {
    if (!propertyId || isSystemMutation(source) || isTenantAdminActor() || !currentAuditActor) return;
    const allowedPropertyIds = currentAuditActor.allowedPropertyIds || [];
    if (allowedPropertyIds.length === 0 || allowedPropertyIds.includes(propertyId)) return;
    throw new Error(`Không thể ${actionLabel}: bạn không có quyền thao tác chi nhánh này.`);
};

const getNodeMutationPermissions = (node: string, mode: 'save' | 'delete') => {
    switch (node) {
        case 'properties':
        case 'rooms':
        case 'roomPolicies':
        case 'roomTypes':
        case 'tags':
        case 'transactionCategories':
            return [PERMISSIONS.MANAGE_ROOMS];
        case 'bookingCategories':
        case 'bookingSources':
            return [PERMISSIONS.ADMIN_SETTINGS];
        case 'customers':
            return [
                PERMISSIONS.MANAGE_BOOKINGS,
                PERMISSIONS.CAN_ADD_BOOKING,
                PERMISSIONS.CAN_EDIT_BOOKING,
            ];
        case 'users':
            return [PERMISSIONS.ADMIN_SETTINGS];
        case 'tenants':
        case 'plans':
            return [] as string[];
        case 'bookings':
            if (mode === 'delete') return [PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.CAN_DELETE_BOOKING];
            return [
                PERMISSIONS.MANAGE_BOOKINGS,
                PERMISSIONS.CAN_ADD_BOOKING,
                PERMISSIONS.CAN_EDIT_BOOKING,
            ];
        default:
            return [] as string[];
    }
};

const assertSystemAdminMutation = (actionLabel: string, source?: AuditSource) => {
    if (!currentAuditActor || isSystemMutation(source)) return;
    throw new Error(`Bạn không có quyền ${actionLabel}.`);
};

const assertNodeMutationAllowed = (
    node: string,
    mode: 'save' | 'delete',
    item?: any,
    source?: AuditSource
) => {
    if (node === 'tenants' || node === 'plans') {
        assertSystemAdminMutation(mode === 'delete' ? `xóa ${node}` : `cập nhật ${node}`, source);
        return;
    }

    const permissions = getNodeMutationPermissions(node, mode);
    if (permissions.length > 0) {
        assertActorHasAnyPermission(
            permissions,
            mode === 'delete' ? `xóa ${node}` : `cập nhật ${node}`,
            source
        );
    }

    assertTenantWriteScope(item, mode === 'delete' ? `xóa ${node}` : `cập nhật ${node}`, source);
    assertPropertyWriteScope(item?.propertyId, mode === 'delete' ? `xóa ${node}` : `cập nhật ${node}`, source);
};

const assertRoomStatusMutationAllowed = (room: Room, source?: AuditSource, requireManualStatusPermission = false) => {
    if (requireManualStatusPermission && source !== 'SYSTEM') {
        const canManuallyUpdateRoomStatus =
            currentAuditActor?.role === UserRole.ADMIN ||
            currentAuditActor?.role === UserRole.SUPER_ADMIN ||
            currentAuditActor?.permissions?.includes(PERMISSIONS.CAN_UPDATE_ROOM_STATUS);

        if (!canManuallyUpdateRoomStatus) {
            throw new Error('Bạn không có quyền đổi trạng thái sạch/bẩn phòng.');
        }
    }

    if (
        currentAuditActor?.role === UserRole.HOUSEKEEPING ||
        actorHasAnyPermission(
            [PERMISSIONS.MANAGE_ROOMS, PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.CAN_EDIT_BOOKING],
            source
        )
    ) {
        assertTenantWriteScope(room, 'cập nhật trạng thái phòng', source);
        assertPropertyWriteScope(room.propertyId, 'cập nhật trạng thái phòng', source);
        return;
    }

    throw new Error('Bạn không có quyền cập nhật trạng thái phòng.');
};

const assertBookingMutationAllowed = (mode: BookingMutationMode, booking: Booking, source?: AuditSource) => {
    const permissionMap: Record<BookingMutationMode, string[]> = {
        create: [PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.CAN_ADD_BOOKING],
        update: [PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.CAN_EDIT_BOOKING],
        delete: [PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.CAN_DELETE_BOOKING],
    };
    const actionMap: Record<BookingMutationMode, string> = {
        create: 'tạo đơn',
        update: 'sửa đơn',
        delete: 'xóa đơn',
    };

    assertActorHasAnyPermission(permissionMap[mode], actionMap[mode], source);
    assertTenantWriteScope(booking, actionMap[mode], source);
    assertPropertyWriteScope(booking.propertyId, actionMap[mode], source);
};

const assertResetBookingsAllowed = () => {
    if (!currentAuditActor || isSystemMutation()) return;
    if (isTenantAdminActor()) return;
    throw new Error('Chỉ quản trị viên mới được xóa toàn bộ dữ liệu đặt phòng.');
};

const normalizeUserCredentialsForStorage = (user: User, existingUser?: User | null): User => {
    const hasNewPassword = typeof user.password === 'string' && user.password.trim().length > 0;
    const fallbackHash = existingUser?.passwordHash;
    const fallbackPlain = existingUser?.password;
    const passwordHash = hasNewPassword
        ? digestPassword(user.password!.trim())
        : user.passwordHash || fallbackHash || (fallbackPlain ? digestPassword(fallbackPlain) : undefined);
    const passwordView = hasNewPassword
        ? encodePasswordForView(user.password!.trim())
        : user.passwordView ||
          existingUser?.passwordView ||
          (fallbackPlain ? encodePasswordForView(fallbackPlain) : undefined);

    const normalizedUser: User = { ...user };
    if (passwordHash) {
        normalizedUser.passwordHash = passwordHash;
    }
    if (passwordView) {
        normalizedUser.passwordView = passwordView;
    }
    delete normalizedUser.password;
    return normalizedUser;
};

const COLLECTION_CONFIGS: Record<AuditedNode, CollectionConfig<any>> = {
    properties: {
        entityType: 'PROPERTY',
        label: 'chi nhánh',
        collectionLabel: 'danh sách chi nhánh',
        scopedByTenant: true,
        getLabel: (item: Property) => item.name || item.id,
    },
    rooms: {
        entityType: 'ROOM',
        label: 'phòng',
        collectionLabel: 'danh sách phòng',
        scopedByTenant: true,
        getLabel: (item: Room) => item.number || item.id,
    },
    roomPolicies: {
        entityType: 'ROOM_POLICY',
        label: 'chính sách phòng',
        collectionLabel: 'chính sách phòng',
        scopedByTenant: true,
        getLabel: (item: RoomPolicyRule) => item.id,
    },
    roomTypes: {
        entityType: 'ROOM_TYPE',
        label: 'hạng phòng',
        collectionLabel: 'danh sách hạng phòng',
        scopedByTenant: true,
        getLabel: (item: RoomType) => item.name || item.id,
    },
    bookings: {
        entityType: 'BOOKING',
        label: 'đơn đặt phòng',
        collectionLabel: 'danh sách đơn đặt phòng',
        scopedByTenant: true,
        getLabel: (item: Booking) => item.id,
    },
    customers: {
        entityType: 'CUSTOMER',
        label: 'khách hàng',
        collectionLabel: 'danh sách khách hàng',
        scopedByTenant: true,
        getLabel: (item: Customer) => item.name || item.id,
    },
    users: {
        entityType: 'USER',
        label: 'tài khoản',
        collectionLabel: 'danh sách tài khoản',
        scopedByTenant: true,
        getLabel: (item: User) => item.fullName || item.username || item.id,
    },
    tags: {
        entityType: 'TAG',
        label: 'thẻ',
        collectionLabel: 'danh sách thẻ',
        scopedByTenant: true,
        getLabel: (item: Tag) => item.name || item.id,
    },
    transactionCategories: {
        entityType: 'TRANSACTION_CATEGORY',
        label: 'danh mục thu chi',
        collectionLabel: 'danh mục thu chi',
        scopedByTenant: true,
        getLabel: (item: TransactionCategory) => item.name || item.id,
    },
    bookingCategories: {
        entityType: 'BOOKING_CATEGORY',
        label: 'phân loại đơn',
        collectionLabel: 'danh mục phân loại đơn',
        scopedByTenant: true,
        getLabel: (item: BookingCatalogItem) => item.name || item.id,
    },
    bookingSources: {
        entityType: 'BOOKING_SOURCE',
        label: 'nguồn đơn',
        collectionLabel: 'danh mục nguồn đơn',
        scopedByTenant: true,
        getLabel: (item: BookingCatalogItem) => item.name || item.id,
    },
    tenants: {
        entityType: 'TENANT',
        label: 'tenant',
        collectionLabel: 'danh sách tenant',
        scopedByTenant: false,
        getLabel: (item: Tenant) => item.name || item.id,
    },
    plans: {
        entityType: 'PLAN',
        label: 'gói cước',
        collectionLabel: 'danh sách gói cước',
        scopedByTenant: false,
        getLabel: (item: SubscriptionPlan) => item.name || item.id,
    },
};

const getBaseRefForTenant = (tenantId: string | null | undefined) => {
    if (!tenantId) return null;
    return tenantId === SYSTEM_TENANT_ID ? 'system' : `tenants/${tenantId}`;
};

const getBaseRef = () => getBaseRefForTenant(activeTenantId);

const getHistoryPath = (tenantId?: string | null) => {
    const basePath = getBaseRefForTenant(tenantId || activeTenantId);
    return basePath ? `${basePath}/history` : null;
};

const isFirebaseDebugEnabled = () => {
    const envDebug = String(import.meta.env.VITE_FIREBASE_DEBUG || '').toLowerCase();
    if (envDebug === '1' || envDebug === 'true') return true;
    if (typeof window === 'undefined') return false;
    try {
        if ((window as any).__KHOST_ENABLE_FIREBASE_DEBUG__ === true) return true;
        return window.localStorage?.getItem('k_host_firebase_debug') === '1';
    } catch {
        return false;
    }
};

const isBookingIndexReadFallbackEnabled = () => {
    const envValue = String(import.meta.env.VITE_BOOKING_INDEX_READ_FALLBACK || '').toLowerCase();
    if (envValue === '1' || envValue === 'true') return true;
    if (envValue === '0' || envValue === 'false') return false;
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage?.getItem('k_host_booking_index_read_fallback') === '1';
    } catch {
        return false;
    }
};
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const estimateBytes = (value: unknown) => {
    if (value === undefined) return 0;
    try {
        const json = JSON.stringify(value) ?? '';
        return textEncoder ? textEncoder.encode(json).length : json.length;
    } catch {
        return 0;
    }
};

const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const countItems = (value: unknown) => {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
    if (value == null) return 0;
    return 1;
};

const debugFirebaseTraffic = (kind: string, path: string, payload?: unknown, extra?: Record<string, unknown>) => {
    if (!isFirebaseDebugEnabled()) return;

    const bytes = estimateBytes(payload);
    const items = countItems(payload);
    const label = `${kind} ${path}`;

    if (typeof window !== 'undefined') {
        window.__KHOST_FIREBASE_DEBUG__ ??= { counters: {} };
        const current = window.__KHOST_FIREBASE_DEBUG__.counters[label] || { calls: 0, bytes: 0 };
        current.calls += 1;
        current.bytes += bytes;
        window.__KHOST_FIREBASE_DEBUG__.counters[label] = current;
    }

    console.groupCollapsed(`[Firebase Debug] ${kind} ${path} | ${formatBytes(bytes)} | ${items} item(s)`);
    if (extra) console.log('meta', extra);
    if (typeof window !== 'undefined' && window.__KHOST_FIREBASE_DEBUG__) {
        console.log('totals', window.__KHOST_FIREBASE_DEBUG__.counters[label]);
    }
    if (payload !== undefined) console.log('payload', payload);
    console.groupEnd();
};

const withReadDeadline = async <T,>(read: Promise<T>, timeoutMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([read, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Data read timed out')), timeoutMs);
        })]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const trackedGet = async (path: string) => {
    const snap = await get(ref(db, path));
    debugFirebaseTraffic('READ:get', path, snap.val(), { exists: snap.exists() });
    return snap;
};

const trackedGetByChild = async (path: string, child: string, value: string) => {
    const snap = await get(query(ref(db, path), orderByChild(child), equalTo(value)));
    debugFirebaseTraffic('READ:getByChild', path, snap.val(), { exists: snap.exists(), child, value });
    return snap;
};

const trackedGetByChildRange = async (path: string, child: string, startValue: string, endValue: string) => {
    const snap = await get(query(ref(db, path), orderByChild(child), startAt(startValue), endAt(endValue)));
    debugFirebaseTraffic('READ:getByChildRange', path, snap.val(), { exists: snap.exists(), child, startValue, endValue });
    return snap;
};

const trackedGetRecentByChild = async (path: string, child: string, value: string, limit: number) => {
    const snap = await get(query(ref(db, path), orderByChild(child), equalTo(value), limitToLast(limit)));
    debugFirebaseTraffic('READ:getRecentByChild', path, snap.val(), { exists: snap.exists(), child, value, limit });
    return snap;
};

const trackedOnValueByChild = (
    path: string,
    child: string,
    value: string,
    callback: (snap: any) => void,
    errorCallback?: (error: unknown) => void
) => realtimePool.subscribe(
    JSON.stringify([path, child, value]),
    (next, error) => onValue(query(ref(db, path), orderByChild(child), equalTo(value)), (snap) => {
        debugFirebaseTraffic('SNAPSHOT:onValueByChild', path, snap.val(), { exists: snap.exists(), child, value });
        next(snap);
    }, error),
    callback,
    errorCallback
);

const isMissingIndexError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes('Index not defined');
};

const trackedGetRecent = async (path: string, limit: number) => {
    const snap = await get(query(ref(db, path), limitToLast(limit)));
    debugFirebaseTraffic('READ:getRecent', path, snap.val(), { exists: snap.exists(), limit });
    return snap;
};

const trackedSet = async (path: string, value: unknown, meta?: Record<string, unknown>) => {
    debugFirebaseTraffic('WRITE:set', path, value, meta);
    return set(ref(db, path), value);
};

const trackedUpdateRoot = async (updates: Record<string, unknown>, meta?: Record<string, unknown>) => {
    debugFirebaseTraffic('WRITE:update', '/', updates, { pathCount: Object.keys(updates).length, ...meta });
    return update(ref(db), updates);
};

const isPermissionDeniedError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes('PERMISSION_DENIED') || message.includes('permission_denied');
};

const stripBookingIndexUpdates = (updates: Record<string, unknown>) =>
    Object.fromEntries(
        Object.entries(updates).filter(([path]) => !path.includes(`/${BOOKING_INDEX_NODE}/`) && !path.endsWith(`/${BOOKING_INDEX_NODE}`))
    );

const trackedUpdateRootWithBookingIndexFallback = async (
    updates: Record<string, unknown>,
    meta?: Record<string, unknown>
) => {
    const hasBookingIndexPaths = Object.keys(updates).some(
        (path) => path.includes(`/${BOOKING_INDEX_NODE}/`) || path.endsWith(`/${BOOKING_INDEX_NODE}`)
    );

    if (!hasBookingIndexPaths || !bookingIndexWriteEnabled) {
        const safeUpdates = !bookingIndexWriteEnabled ? stripBookingIndexUpdates(updates) : updates;
        return trackedUpdateRoot(safeUpdates, meta);
    }

    try {
        return await trackedUpdateRoot(updates, meta);
    } catch (error) {
        if (!isPermissionDeniedError(error)) {
            throw error;
        }

        bookingIndexWriteEnabled = false;
        const fallbackUpdates = stripBookingIndexUpdates(updates);
        if (isFirebaseDebugEnabled()) {
            console.warn(
                `[Firebase Debug] Booking index write is not permitted by current rules. Falling back to booking-only updates until rules are updated.`
            );
        }
        return trackedUpdateRoot(fallbackUpdates, {
            ...meta,
            bookingIndexFallback: true,
            pathCount: Object.keys(fallbackUpdates).length,
        });
    }
};

const trackedRemove = async (path: string, meta?: Record<string, unknown>) => {
    debugFirebaseTraffic('WRITE:remove', path, null, meta);
    return remove(ref(db, path));
};

const getMatchingCollectionChildKeys = async (collectionPath: string, ids: Iterable<string>) => {
    const idSet = new Set(Array.from(ids).filter(Boolean));
    if (idSet.size === 0) return [];

    const matchingKeys = new Set<string>(idSet);
    const snap = await trackedGet(collectionPath);
    const rawCollection = snap.val();

    if (rawCollection && typeof rawCollection === 'object') {
        Object.entries(rawCollection as Record<string, unknown>).forEach(([childKey, childValue]) => {
            if (idSet.has(childKey)) {
                matchingKeys.add(childKey);
                return;
            }

            if (
                childValue &&
                typeof childValue === 'object' &&
                !Array.isArray(childValue) &&
                idSet.has(String((childValue as Record<string, unknown>).id || ''))
            ) {
                matchingKeys.add(childKey);
            }
        });
    }

    return Array.from(matchingKeys);
};

const buildCollectionDeleteUpdates = async (collectionPath: string, ids: Iterable<string>) => {
    const updates: Record<string, null> = {};
    const matchingKeys = await getMatchingCollectionChildKeys(collectionPath, ids);
    matchingKeys.forEach((childKey) => {
        updates[`${collectionPath}/${childKey}`] = null;
    });
    return updates;
};

const trackedOnValue = (path: string, callback: (snap: any) => void, errorCallback?: (error: unknown) => void) =>
    realtimePool.subscribe(JSON.stringify([path]), (next, error) => onValue(ref(db, path), (snap) => {
        // A value snapshot includes cached children; its size is NOT wire traffic.
        debugFirebaseTraffic('SNAPSHOT:onValue', path, snap.val(), { exists: snap.exists() });
        next(snap);
    }, error), callback, errorCallback);

const _disposeActiveRealtimeBindings = () => {
    activeRealtimeUnsubscribers.forEach((unsubscribe) => {
        try {
            unsubscribe();
        } catch (error) {
            console.warn('Cleanup realtime binding failed', error);
        }
    });
    activeRealtimeUnsubscribers = [];
};

const _clearSessionCache = () => {
    _disposeActiveRealtimeBindings();
    realtimePool.clear();
    activeTenantId = null;
    _dataChangeCallback = () => {};
    CACHE.properties = [];
    CACHE.rooms = [];
    CACHE.roomPolicies = [];
    CACHE.roomTypes = [];
    CACHE.bookings = [];
    CACHE.customers = [];
    CACHE.users = [];
    CACHE.history = [];
    CACHE.tags = [];
    CACHE.transactionCategories = [];
    CACHE.bookingCategories = [];
    CACHE.bookingSources = [];
    CACHE.bookingFieldSettings = {};
    CACHE.notificationSettings = DEFAULT_NOTIFICATION_SETTINGS;
    dashboardBookingRangeInFlight.clear();
    dashboardBookingRangeCache.clear();
    dashboardBookingDetailInFlight.clear();
};

const cloneData = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const snapshotToArray = <T extends { id?: string; number?: string; name?: string }>(snap: any): T[] => {
    const val = snap.val();
    if (!val || typeof val !== 'object') return [];

    const rawList: T[] = [];
    Object.keys(val).forEach((key) => {
        const item = val[key];
        if (item && typeof item === 'object') {
            rawList.push({ ...item, id: item.id || key });
        }
    });

    const uniqueMap = new Map<string, T>();
    rawList.forEach((item) => {
        const id = (item as any).id;
        if (!id) return;

        if (uniqueMap.has(id)) {
            const existing = uniqueMap.get(id)!;
            const merged = { ...existing, ...item };
            if ((existing as any).number && !(item as any).number) (merged as any).number = (existing as any).number;
            if ((existing as any).name && !(item as any).name) (merged as any).name = (existing as any).name;
            if ((existing as any).typeId && !(item as any).typeId) (merged as any).typeId = (existing as any).typeId;
            if ((existing as any).propertyId && !(item as any).propertyId) (merged as any).propertyId = (existing as any).propertyId;
            uniqueMap.set(id, merged);
        } else {
            uniqueMap.set(id, item);
        }
    });

    return Array.from(uniqueMap.values());
};

const _ensureFirebase = () => {
    if (!isFirebaseReady) {
        try {
            if (missingFirebaseEnvKeys.length > 0) {
                console.error(
                    `Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}. Check your .env.local file.`
                );
                return false;
            }
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            isFirebaseReady = true;
            if (!disconnectRealtimeConnectionWatcher) {
                const connectedRef = ref(db, '.info/connected');
                disconnectRealtimeConnectionWatcher = onValue(
                    connectedRef,
                    (snap) => {
                        debugFirebaseTraffic('READ:onValue', '.info/connected', snap.val(), { exists: snap.exists() });
                        realtimeConnectionState = snap.val() === true ? 'CONNECTED' : 'DISCONNECTED';
                    },
                    () => {
                        realtimeConnectionState = 'DISCONNECTED';
                    }
                );
            }
        } catch (error) {
            console.error('Firebase connection failed', error);
        }
    }
    return isFirebaseReady;
};

const _resolveRealtimeConnectionState = async (): Promise<'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED'> => {
    if (!db) return 'UNKNOWN';

    try {
        const stateSnap = await Promise.race([
            trackedGet('.info/connected'),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), CONNECTION_PREFLIGHT_TIMEOUT_MS)),
        ]);

        if (!stateSnap) return realtimeConnectionState;
        const connected = stateSnap.val() === true;
        realtimeConnectionState = connected ? 'CONNECTED' : 'DISCONNECTED';
        return realtimeConnectionState;
    } catch (error) {
        return realtimeConnectionState;
    }
};

const _assertOnlineForMutation = async (actionLabel: string) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`Mất kết nối Internet. Không thể ${actionLabel} khi đang offline.`);
    }

    const connectionState = await _resolveRealtimeConnectionState();
    if (connectionState === 'DISCONNECTED') {
        throw new Error(`Mất kết nối tới máy chủ dữ liệu. Không thể ${actionLabel} lúc này.`);
    }
};

const _findUserByCredential = (users: User[], usernameInput: string, passwordInput: string): User | null => {
    const normalizedUsername = usernameInput.trim();
    const candidatePasswords = Array.from(new Set([passwordInput, passwordInput.trim()]));

    const matched = users.find((user) => {
        const userName = (user.username || '').trim();
        if (userName !== normalizedUsername) return false;
        return candidatePasswords.some((candidate) => verifyPassword(candidate, user));
    });

    return matched || null;
};

const sanitizeForLog = (value: any): any => {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));

    const sanitized: Record<string, any> = {};
    Object.entries(value).forEach(([key, itemValue]) => {
        sanitized[key] = key.toLowerCase().includes('password') ? '***' : sanitizeForLog(itemValue);
    });
    return sanitized;
};

const normalizeLegacyBookingStatus = (status?: string): BookingStatus => {
    if (status === BookingStatus.HOLD || status === 'PENDING') return BookingStatus.HOLD;
    if (status === BookingStatus.CONFIRMED) return BookingStatus.CONFIRMED;
    if (status === BookingStatus.CHECKED_IN) return BookingStatus.CHECKED_IN;
    if (status === BookingStatus.CHECKED_OUT) return BookingStatus.CHECKED_OUT;
    if (status === BookingStatus.DELETED || status === 'CANCELLED') return BookingStatus.DELETED;
    return BookingStatus.CONFIRMED;
};

const normalizeLegacyRoomStatus = (status?: string): RoomStatus => {
    if (status === RoomStatus.VACANT_CLEAN) return RoomStatus.VACANT_CLEAN;
    if (status === RoomStatus.VACANT_DIRTY || status === 'MAINTENANCE') return RoomStatus.VACANT_DIRTY;
    if (status === RoomStatus.OCCUPIED) return RoomStatus.OCCUPIED;
    return RoomStatus.VACANT_CLEAN;
};

const attachPersistedBookingStatus = <T extends Record<string, any>>(booking: T, persistedStatus: BookingStatus): T => {
    Object.defineProperty(booking, '__persistedStatus', {
        value: persistedStatus,
        enumerable: false,
        configurable: true,
    });
    return booking;
};

const getPersistedBookingStatus = (booking?: any): BookingStatus | undefined =>
    booking?.__persistedStatus || booking?.status;

const removeUndefinedDeep = (value: any): any => {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => removeUndefinedDeep(item));

    const cleaned: Record<string, any> = {};
    Object.entries(value).forEach(([key, itemValue]) => {
        if (itemValue === undefined) return;
        cleaned[key] = removeUndefinedDeep(itemValue);
    });
    return cleaned;
};

const stripTenantId = (value: any) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const cloned = cloneData(value);
    delete cloned.tenantId;
    return cloned;
};

const getChangedKeys = (before: any, after: any) => {
    const prev = stripTenantId(sanitizeForLog(before)) || {};
    const next = stripTenantId(sanitizeForLog(after)) || {};
    const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
    return keys.filter((key) => JSON.stringify(prev[key] ?? null) !== JSON.stringify(next[key] ?? null));
};

const isOnlySortOrderChange = (before: any, after: any) => {
    const changedKeys = getChangedKeys(before, after);
    return changedKeys.length > 0 && changedKeys.every((key) => key === 'sortOrder');
};

const normalizeForNode = (node: string, item: any, tenantId: string | null) => {
    if (!item) return item;
    if (node === 'history') {
        return { ...item, tenantId: item.tenantId || tenantId || undefined };
    }
    if (node === 'bookings') {
        const normalizedStatus = normalizeLegacyBookingStatus(item.status);
        const normalizedBooking = {
            ...item,
            status: normalizedStatus,
            isHold: item.isHold || normalizedStatus === BookingStatus.HOLD,
        };
        const derivedStatus = deriveBookingStatus(normalizedBooking as Booking);
        const bookingWithDerivedStatus = {
            ...normalizedBooking,
            status: derivedStatus,
            isHold: normalizedBooking.isHold || derivedStatus === BookingStatus.HOLD,
        };
        const result = tenantId ? { ...bookingWithDerivedStatus, tenantId: item.tenantId || tenantId } : bookingWithDerivedStatus;
        return attachPersistedBookingStatus(result, normalizedStatus);
    }
    if (node === 'rooms') {
        const normalizedRoom = {
            ...item,
            status: normalizeLegacyRoomStatus(item.status),
        };
        return tenantId ? { ...normalizedRoom, tenantId: item.tenantId || tenantId } : normalizedRoom;
    }
    if (node === 'users') {
        const withTenant = tenantId ? { ...item, tenantId: item.tenantId || tenantId } : { ...item };
        return normalizeUserCredentialsForStorage(withTenant as User, item as User);
    }
    if (node === 'tenants') {
        const normalizedTenant = { ...item } as Tenant;
        if (normalizedTenant.adminPassword && normalizedTenant.adminPassword.trim()) {
            normalizedTenant.adminPasswordHash = digestPassword(normalizedTenant.adminPassword.trim());
            normalizedTenant.adminPasswordView = encodePasswordForView(normalizedTenant.adminPassword.trim());
        }
        delete normalizedTenant.adminPassword;
        return normalizedTenant;
    }

    const config = COLLECTION_CONFIGS[node as AuditedNode];
    if (tenantId && config?.scopedByTenant !== false) {
        return { ...item, tenantId: item.tenantId || tenantId };
    }
    return { ...item };
};

const sortHistoryCache = () => {
    CACHE.history = [...CACHE.history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

const upsertHistoryCache = (entry: HistoryLog) => {
    const shouldSyncCache =
        !!activeTenantId &&
        activeTenantId === (entry.tenantId || activeTenantId);

    if (!shouldSyncCache) return;

    const index = CACHE.history.findIndex((item) => item.id === entry.id);
    if (index > -1) {
        CACHE.history[index] = entry;
    } else {
        CACHE.history.unshift(entry);
    }
    sortHistoryCache();
    _dataChangeCallback();
};

const getPropertyName = (propertyId?: string | null) => {
    if (!propertyId) return undefined;
    return CACHE.properties.find((property) => property.id === propertyId)?.name;
};

const getRoomNumber = (roomId?: string | null) => {
    if (!roomId) return undefined;
    return CACHE.rooms.find((room) => room.id === roomId)?.number;
};

const getRoomTypeNameById = (typeId?: string | null) => {
    if (!typeId) return undefined;
    return CACHE.roomTypes.find((type) => type.id === typeId)?.name;
};

const getRoomContext = (roomId?: string | null) => {
    if (!roomId) return null;
    const room = CACHE.rooms.find((item) => item.id === roomId);
    if (!room) return null;

    return {
        propertyName: getPropertyName(room.propertyId) || room.propertyId,
        roomTypeName: getRoomTypeNameById(room.typeId) || room.typeId,
        roomNumber: room.number || room.id,
    };
};

const getTagName = (tagId?: string | null) => {
    if (!tagId) return undefined;
    return CACHE.tags.find((tag) => tag.id === tagId)?.name;
};

const getAllowedPropertyNames = (ids?: string[]) => {
    if (!ids || ids.length === 0) return ['Tất cả chi nhánh'];
    return ids
        .map((id) => CACHE.properties.find((property) => property.id === id)?.name)
        .filter(Boolean) as string[];
};

const buildNodeMetadata = (node: AuditedNode, item: any) => {
    switch (node) {
        case 'properties':
            return { address: item.address || '' };
        case 'rooms':
            return {
                propertyId: item.propertyId,
                propertyName: getPropertyName(item.propertyId),
                roomNumber: item.number,
                status: item.status,
                typeId: item.typeId,
                floor: item.floor,
            };
        case 'roomPolicies':
            return {
                mode: item.mode,
                isActive: item.isActive,
                recurrence: item.recurrence,
                weekdays: item.weekdays || [],
                startDate: item.startDate,
                endDate: item.endDate || null,
                propertyIds: item.propertyIds || [],
                roomTypeIds: item.roomTypeIds || [],
                roomIds: item.roomIds || [],
            };
        case 'roomTypes':
            return {
                propertyId: item.propertyId || null,
                propertyName: getPropertyName(item.propertyId),
                price: item.price,
                capacity: item.capacity,
            };
        case 'bookings':
            return {
                bookingId: item.id,
                groupId: item.groupId || null,
                propertyId: item.propertyId,
                propertyName: getPropertyName(item.propertyId),
                roomId: item.roomId,
                roomNumber: getRoomNumber(item.roomId),
                guestName: item.guestName,
                guestPhone: item.guestPhone,
                bookingCategory: item.bookingCategory || '',
                bookingSource: item.bookingSource || '',
                status: item.status,
                checkInDate: item.checkInDate,
                checkOutDate: item.checkOutDate,
                totalPrice: item.totalPrice,
                paidAmount: item.paidAmount,
                tags: item.tags || [],
                extraFees: (item.extraFees || []).map((fee: any) => ({
                    id: fee.id,
                    name: fee.name,
                    amount: fee.amount,
                    type: fee.type,
                })),
                importBatchId: item.importBatchId || null,
                isHold: !!item.isHold,
                holdUntil: item.holdUntil || null,
            };
        case 'customers':
            return {
                phone: item.phone,
                identityCard: item.identityCard,
                email: item.email || '',
            };
        case 'users':
            return {
                username: item.username,
                role: item.role,
                allowedPropertyIds: item.allowedPropertyIds || [],
                allowedProperties: getAllowedPropertyNames(item.allowedPropertyIds),
                permissionCount: item.permissions?.length || 0,
            };
        case 'tags':
            return { color: item.color };
        case 'transactionCategories':
            return { type: item.type };
        case 'bookingCategories':
        case 'bookingSources':
            return { isActive: item.isActive !== false, sortOrder: item.sortOrder || 0 };
        case 'tenants':
            return {
                status: item.status,
                domain: item.domain || '',
                planId: item.planId,
                subscriptionEndDate: item.subscriptionEndDate,
                adminUsername: item.adminUsername || '',
            };
        case 'plans':
            return {
                price: item.price,
                maxRooms: item.maxRooms,
                maxUsers: item.maxUsers,
            };
        default:
            return {};
    }
};

const toCurrency = (value: number) => new Intl.NumberFormat('vi-VN').format(value || 0);

const formatRoomLabel = (roomId?: string | null) => {
    if (!roomId) return 'Không có';
    const number = getRoomNumber(roomId);
    return number ? `Phòng ${number}` : roomId;
};

const formatRoomContextLabel = (roomId?: string | null) => {
    const context = getRoomContext(roomId);
    if (!context) return formatRoomLabel(roomId);
    return `Chi nhánh ${context.propertyName}, Hạng ${context.roomTypeName}, Phòng ${context.roomNumber}`;
};

const formatPropertyLabel = (propertyId?: string | null) => {
    if (!propertyId) return 'Không có';
    const name = getPropertyName(propertyId);
    return name || propertyId;
};

const formatDateLabel = (iso?: string | null) => {
    if (!iso) return 'Trống';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const resolveUserById = (userId?: string | null) => {
    if (!userId) return null;
    return [...CACHE.users, ...CACHE.systemUsers].find((user) => user.id === userId) || null;
};

const resolveAuditActor = (
    staffId?: string,
    tenantId?: string | null,
    source: AuditSource = 'WEB',
    actorOverride?: AuditActor
): AuditActor => {
    if (actorOverride) return actorOverride;

    if (currentAuditActor && (!staffId || currentAuditActor.id === staffId)) {
        return currentAuditActor;
    }

    const knownUser = resolveUserById(staffId);
    if (knownUser) {
        return {
            id: knownUser.id,
            username: knownUser.username,
            fullName: knownUser.fullName,
            role: knownUser.role,
            tenantId: tenantId || knownUser.tenantId,
            permissions: knownUser.permissions || [],
            allowedPropertyIds: knownUser.allowedPropertyIds || [],
        };
    }

    if (staffId) {
        return {
            id: staffId,
            fullName: staffId,
            role: source === 'SYSTEM' ? 'SYSTEM' : undefined,
            tenantId: tenantId || undefined,
        };
    }

    return {
        id: 'system',
        fullName: 'Hệ thống tự động',
        role: 'SYSTEM',
        tenantId: tenantId || undefined,
    };
};

const _writeHistoryLog = (entry: HistoryLog, coalesceKey?: string) => {
    if (!_ensureFirebase() || !db) return;

    const historyPath = getHistoryPath(entry.tenantId);
    if (!historyPath) return;

    let targetId = entry.id;
    if (coalesceKey) {
        const recentKey = `${historyPath}:${coalesceKey}`;
        const existing = recentAuditEntries.get(recentKey);
        const now = Date.now();

        if (existing && now - existing.timestamp <= AUDIT_COALESCE_WINDOW_MS) {
            targetId = existing.id;
        }

        recentAuditEntries.set(recentKey, { id: targetId, timestamp: now });
    }

    const finalEntryRaw = removeUndefinedDeep({ ...entry, id: targetId }) as Record<string, any>;
    if (Object.prototype.hasOwnProperty.call(finalEntryRaw, 'entityld')) {
        if (!finalEntryRaw.entityId && finalEntryRaw.entityld) {
            finalEntryRaw.entityId = finalEntryRaw.entityld;
        }
        delete finalEntryRaw.entityld;
    }
    const finalEntry = finalEntryRaw as HistoryLog;
    upsertHistoryCache(finalEntry);

    try {
        return trackedSet(`${historyPath}/${targetId}`, finalEntry, { source: 'history' }).catch((error: any) => {
            console.error('Write history failed', error);
        });
    } catch (error) {
        console.error('Write history failed', error);
    }
};

const _fetchRecentHistory = async (limit: number = 60, tenantId?: string | null) => {
    if (!_ensureFirebase() || !db) return [] as HistoryLog[];

    const historyPath = getHistoryPath(tenantId);
    if (!historyPath) return [] as HistoryLog[];

    try {
        const snap = await trackedGetRecent(historyPath, limit);
        if (!snap.exists()) return [] as HistoryLog[];
        return snapshotToArray<HistoryLog>(snap).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    } catch (error) {
        console.error('Fetch recent history failed', error);
        return [] as HistoryLog[];
    }
};

const _fetchBookingHistory = async ({
    bookingIds = [],
    groupId,
    limit = 120,
    tenantId,
    fallbackLimit = 80,
}: BookingHistoryQueryParams) => {
    if (!_ensureFirebase() || !db) return [] as HistoryLog[];

    const historyPath = getHistoryPath(tenantId);
    if (!historyPath) return [] as HistoryLog[];

    const normalizedLimit = Math.min(300, Math.max(1, Math.floor(Number(limit) || 120)));
    const normalizedFallbackLimit = Math.min(120, Math.max(1, Math.floor(Number(fallbackLimit) || 80)));
    const uniqueBookingIds = Array.from(new Set((bookingIds || []).map((id) => `${id || ''}`.trim()).filter(Boolean)));
    const normalizedGroupId = `${groupId || ''}`.trim();

    if (uniqueBookingIds.length === 0 && !normalizedGroupId) return [] as HistoryLog[];

    try {
        const queries = [
            ...uniqueBookingIds.map((bookingId) =>
                trackedGetRecentByChild(historyPath, 'entityId', bookingId, normalizedLimit)
            ),
            ...(normalizedGroupId
                ? [trackedGetRecentByChild(historyPath, 'metadata/groupId', normalizedGroupId, normalizedLimit)]
                : []),
        ];
        const snaps = await Promise.all(queries);
        const byId = new Map<string, HistoryLog>();

        snaps.forEach((snap) => {
            if (!snap.exists()) return;
            snapshotToArray<HistoryLog>(snap).forEach((log) => {
                const entityType = log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM');
                if (entityType !== 'BOOKING') return;
                if (!log.id) return;
                byId.set(log.id, log);
            });
        });

        return Array.from(byId.values())
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, normalizedLimit);
    } catch (error) {
        console.error('Fetch booking history failed, falling back to recent history', error);
        return _fetchRecentHistory(normalizedFallbackLimit, tenantId);
    }
};

const _recordHistory = ({
    tenantId,
    action,
    entityType,
    entityId,
    entityLabel,
    description,
    before,
    after,
    metadata,
    source = 'WEB',
    staffId,
    actor,
    bookingSnapshot,
    coalesceKey,
}: HistoryParams) => {
    const targetTenantId = tenantId || activeTenantId;
    if (!targetTenantId) return;

    const resolvedActor = resolveAuditActor(staffId, targetTenantId, source, actor);
    const timestamp = new Date().toISOString();

    const entry: HistoryLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        tenantId: targetTenantId,
        timestamp,
        action,
        entityType,
        entityId,
        entityLabel,
        description,
        actorId: resolvedActor.id,
        actorName: resolvedActor.fullName || resolvedActor.username || resolvedActor.id,
        actorUsername: resolvedActor.username,
        actorRole: resolvedActor.role,
        source,
        before: before ? sanitizeForLog(before) : null,
        after: after ? sanitizeForLog(after) : null,
        metadata: metadata ? sanitizeForLog(metadata) : null,
        bookingSnapshot: bookingSnapshot ? sanitizeForLog(bookingSnapshot) : undefined,
        staffId: resolvedActor.id,
    };

    if (isFirebaseDebugEnabled()) {
        console.groupCollapsed(
            `[KHost Action] ${entry.action}${entry.entityType ? `:${entry.entityType}` : ''} | ${entry.description}`
        );
        console.log('entry', entry);
        console.groupEnd();
    }

    return _writeHistoryLog(entry, coalesceKey);
};

const _initRealtimeConnection = (tenantId: string, onDataChange: () => void) => {
    try {
        _disposeActiveRealtimeBindings();
        if (activeTenantId !== tenantId) realtimePool.clear();
        activeTenantId = tenantId;
        _dataChangeCallback = onDataChange;

        if (!_ensureFirebase()) return;

        const basePath = getBaseRef();
        if (!basePath) return;

        const bind = <T extends { id?: string; number?: string; name?: string }>(
            node: string,
            cacheKey: keyof typeof CACHE
        ) => {
            const unsubscribe = trackedOnValue(`${basePath}/${node}`, (snap) => {
                const rows = snapshotToArray<T>(snap);
                if (cacheKey === 'users' || cacheKey === 'systemUsers') {
                    // @ts-ignore
                    CACHE[cacheKey] = (rows as unknown as User[]).map((user) =>
                        normalizeUserCredentialsForStorage(user, user)
                    );
                } else {
                    // @ts-ignore
                    CACHE[cacheKey] = rows;
                }
                _dataChangeCallback();
            });
            activeRealtimeUnsubscribers.push(unsubscribe);
        };

        if (tenantId === SYSTEM_TENANT_ID) {
            bind<Tenant>('tenants', 'tenants');
            bind<SubscriptionPlan>('plans', 'plans');
            bind<User>('users', 'systemUsers');

            trackedGet('system/tenants').then((snap) => {
                if (!snap.exists() || snap.size === 0) _seedSystemData();
            });
            return;
        }

        bind<Property>('properties', 'properties');
        bind<RoomType>('roomTypes', 'roomTypes');
        bind<Tag>('tags', 'tags');
        bind<TransactionCategory>('transactionCategories', 'transactionCategories');
        bind<BookingCatalogItem>('bookingCategories', 'bookingCategories');
        bind<BookingCatalogItem>('bookingSources', 'bookingSources');
        bind<RoomPolicyRule>('roomPolicies', 'roomPolicies');
        trackedGet(`${basePath}/customers`).then((snap) => {
            CACHE.customers = snapshotToArray<Customer>(snap);
            _dataChangeCallback();
        });

        const bookingFieldSettingsUnsubscribe = trackedOnValue(`${basePath}/bookingFieldSettings`, (snap) => {
            CACHE.bookingFieldSettings = normalizeBookingFieldSettings(snap.val());
            _dataChangeCallback();
        });
        activeRealtimeUnsubscribers.push(bookingFieldSettingsUnsubscribe);

        const notificationSettingsUnsubscribe = trackedOnValue(`${basePath}/notificationSettings`, (snap) => {
            CACHE.notificationSettings = normalizeNotificationSettings(snap.val());
            _dataChangeCallback();
        });
        activeRealtimeUnsubscribers.push(notificationSettingsUnsubscribe);

        const usersUnsubscribe = trackedOnValue(`${basePath}/users`, async (snap) => {
            const users = snapshotToArray<User>(snap).map((user) =>
                normalizeUserCredentialsForStorage(user, user)
            );
            CACHE.users = users;

            if (users.length === 0) {
                try {
                    const sysSnap = await trackedGet('system/users');
                    if (sysSnap.exists()) {
                        const allSystemUsers = snapshotToArray<User>(sysSnap);
                        const recovered = allSystemUsers.filter((user) => user.tenantId === tenantId);

                        if (recovered.length > 0) {
                            CACHE.users = recovered.map((user) => normalizeUserCredentialsForStorage(user, user));
                            const updates: Record<string, any> = {};
                            recovered.forEach((user) => {
                                updates[`${basePath}/users/${user.id}`] = normalizeUserCredentialsForStorage(user, user);
                            });
                            trackedUpdateRoot(updates, { source: 'user-recovery' });
                        }
                    }
                } catch (error) {
                    console.error('Self-repair failed', error);
                }
            }

            _dataChangeCallback();
        });
        activeRealtimeUnsubscribers.push(usersUnsubscribe);

        trackedGet(`${basePath}/properties`).then((propertySnap) => {
            if (!propertySnap.exists() || propertySnap.size === 0) {
                trackedGet(`${basePath}/rooms`).then((roomSnap) => {
                    if (!roomSnap.exists()) {
                        trackedGet(`system/tenants/${tenantId}/initialSeeded`).then((seedSnap) => {
                            if (seedSnap.val() === true) return;
                            if (isFirebaseDebugEnabled()) console.log(`Seeding initial data for ${tenantId}`);
                            _seedTenantData(tenantId);
                        });
                    }
                });
            }
        });
    } catch (error) {
        console.error('Sync init error', error);
    }
};

const normalizePropertyScope = (propertyIds?: string[]) =>
    Array.from(new Set((propertyIds || []).filter(Boolean))).sort();

const filterRowsByPropertyScope = <T extends { propertyId?: string }>(rows: T[], propertyIds?: string[]) => {
    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) return [] as T[];
    const scopeSet = new Set(scopeIds);
    return rows.filter((row) => row.propertyId && scopeSet.has(row.propertyId));
};

const filterBookingsForRange = (bookings: Booking[], startMs: number, endMs: number) =>
    bookings.filter((booking) => {
        if (booking.status === BookingStatus.DELETED || isExpiredHoldBooking(booking)) return false;
        const bookingStartMs = new Date(booking.checkInDate).getTime();
        const bookingEndMs = new Date(booking.checkOutDate).getTime();
        return bookingStartMs < endMs && bookingEndMs > startMs;
    });

const _loadScopedCollectionByProperty = async <T extends { id?: string }>(
    node: 'rooms' | 'bookings',
    cacheKey: 'rooms' | 'bookings',
    propertyIds?: string[],
    syncCache: boolean = true
) => {
    if (!_ensureFirebase()) return [] as T[];

    const basePath = getBaseRef();
    if (!basePath) return [] as T[];

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) {
        if (syncCache) {
            CACHE[cacheKey] = [];
        }
        return [] as T[];
    }

    const path = `${basePath}/${node}`;
    let snapshots: any[] = [];

    if (!missingQueryIndexPaths.has(path)) {
        try {
            snapshots = await Promise.all(scopeIds.map((propertyId) => trackedGetByChild(path, 'propertyId', propertyId)));
        } catch (error) {
            if (!isMissingIndexError(error)) {
                throw error;
            }
            missingQueryIndexPaths.add(path);
            if (isFirebaseDebugEnabled()) {
                console.warn(
                    `[Firebase Debug] Missing index for ${path}. Falling back to full read until ".indexOn": "propertyId" is added to database rules.`
                );
            }
        }
    }

    if (snapshots.length === 0) {
        const fallbackSnap = await trackedGet(path);
        snapshots = [fallbackSnap];
    }

    const unique = new Map<string, T>();
    snapshots.forEach((snap) => {
        snapshotToArray<T>(snap).forEach((item) => {
            const id = item.id || `${node}_${unique.size}`;
            unique.set(id, item);
        });
    });

    const rows = Array.from(unique.values()).map((item) => {
        if (node === 'bookings') return normalizeForNode('bookings', item, activeTenantId) as T;
        if (node === 'rooms') return normalizeForNode('rooms', item, activeTenantId) as T;
        return item;
    });
    const scopedRows = filterRowsByPropertyScope(rows as Array<T & { propertyId?: string }>, scopeIds) as T[];
    if (syncCache) {
        // @ts-ignore
        CACHE[cacheKey] = scopedRows;
    }
    return scopedRows;
};

const _loadRoomsForProperties = async (propertyIds?: string[]) => {
    return _loadScopedCollectionByProperty<Room>('rooms', 'rooms', propertyIds);
};

const _loadBookingsForProperties = async (propertyIds?: string[]) => {
    return _loadScopedCollectionByProperty<Booking>('bookings', 'bookings', propertyIds);
};

const _loadRoomsForPropertiesView = async (propertyIds?: string[]) => {
    return _loadScopedCollectionByProperty<Room>('rooms', 'rooms', propertyIds, false);
};

const _loadBookingsForPropertiesView = async (propertyIds?: string[]) => {
    return _loadScopedCollectionByProperty<Booking>('bookings', 'bookings', propertyIds, false);
};

const _refreshRoomPoliciesRemote = async () => {
    if (!_ensureFirebase()) return CACHE.roomPolicies;

    const basePath = getBaseRef();
    if (!basePath) return CACHE.roomPolicies;

    const snap = await trackedGet(`${basePath}/roomPolicies`);
    const rows = snapshotToArray<RoomPolicyRule>(snap)
        .map((item) => normalizeForNode('roomPolicies', item, activeTenantId) as RoomPolicyRule);
    CACHE.roomPolicies = rows;
    return rows;
};

const _fetchBookingsForProperties = async (propertyIds?: string[]) => {
    if (!_ensureFirebase()) return [] as Booking[];

    const basePath = getBaseRef();
    if (!basePath) return [] as Booking[];

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) return [] as Booking[];

    const snapshots = await Promise.all(scopeIds.map((propertyId) => trackedGetByChild(`${basePath}/bookings`, 'propertyId', propertyId)));
    const unique = new Map<string, Booking>();

    snapshots.forEach((snap) => {
        snapshotToArray<Booking>(snap).forEach((booking) => {
            if (!booking?.id) return;
            unique.set(booking.id, normalizeForNode('bookings', booking, activeTenantId) as Booking);
        });
    });

    return Array.from(unique.values()).filter(
        (booking) => booking.status !== BookingStatus.DELETED && !isExpiredHoldBooking(booking)
    );
};

// Query the canonical bookings, not the day index, for availability and
// cleanliness. Long stays that started before the range must still be included.
const _fetchBookingsEndingAfter = async (propertyIds: string[], timeMs: number) => {
    if (!_ensureFirebase() || !getBaseRef() || propertyIds.length === 0) return [] as Booking[];
    if (!Number.isFinite(timeMs) || timeMs <= 0) return _fetchBookingsForProperties(propertyIds);
    const tenantId = activeTenantId;
    const path = `${getBaseRef()}/bookings`;
    const snap = await get(query(ref(db, path), orderByChild('checkOutDate'), startAt(checkoutQueryLowerBound(timeMs))));
    debugFirebaseTraffic('READ:endingAfter', path, snap.val());
    return filterRowsByPropertyScope(snapshotToArray<Booking>(snap), propertyIds)
        .map(booking => normalizeForNode('bookings', booking, tenantId) as Booking)
        .filter(booking => new Date(booking.checkOutDate).getTime() >= timeMs &&
            booking.status !== BookingStatus.DELETED && !isExpiredHoldBooking(booking));
};

const _subscribeRoomStateBookings = (
    rooms: Room[], callback: (rows: Booking[]) => void, errorCallback?: (error: unknown) => void
) => {
    const propertyIds = normalizePropertyScope(rooms.map(room => room.propertyId));
    const lowerTime = roomHistoryStart(rooms);
    if (!rooms.length || !_ensureFirebase() || !getBaseRef()) {
        callback([]);
        return () => undefined;
    }
    // Keep the property-scoped query for unconfirmed legacy rooms. It avoids
    // downloading unrelated tenants and preserves the existing cleaning rule.
    if (lowerTime <= 0) return _subscribeBookingsForPropertiesView(propertyIds, callback, errorCallback);
    const path = `${getBaseRef()}/bookings`;
    const tenantId = activeTenantId;
    const lowerBound = checkoutQueryLowerBound(lowerTime);
    const roomIds = new Set(rooms.map(room => room.id));
    return realtimePool.subscribe(JSON.stringify([path, 'checkOutDate', lowerBound]),
        (next, error) => onValue(query(ref(db, path), orderByChild('checkOutDate'), startAt(lowerBound)), next, error),
        snap => callback(snapshotToArray<Booking>(snap)
            .filter(booking => roomIds.has(booking.roomId))
            .map(booking => normalizeForNode('bookings', booking, tenantId) as Booking)), errorCallback);
};

const subscribeScopedCollectionByProperty = <T extends { id?: string }>(
    node: 'rooms' | 'bookings',
    cacheKey: 'rooms' | 'bookings',
    propertyIds: string[] | undefined,
    callback: (rows: T[]) => void,
    errorCallback?: (error: unknown) => void,
    syncCache: boolean = true
) => {
    if (!_ensureFirebase()) {
        callback([]);
        return () => undefined;
    }

    const basePath = getBaseRef();
    if (!basePath) {
        callback([]);
        return () => undefined;
    }

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) {
        if (syncCache) {
            // @ts-ignore
            CACHE[cacheKey] = [];
        }
        callback([]);
        return () => undefined;
    }

    const path = `${basePath}/${node}`;
    const snapshotMap = new Map<string, any>();
    let fallbackUnsubscribe: (() => void) | null = null;
    let propertyUnsubscribes: Array<() => void> = [];

    const emit = () => {
        // Do not expose an incomplete property scope as empty/clean rooms.
        if (!snapshotMap.has('fallback') && snapshotMap.size < scopeIds.length) return;
        const unique = new Map<string, T>();
        snapshotMap.forEach((snap) => {
            snapshotToArray<T>(snap).forEach((item) => {
                const id = item.id || `${node}_${unique.size}`;
                unique.set(id, item);
            });
        });
        const rows = Array.from(unique.values()).map((item) => {
            if (node === 'bookings') return normalizeForNode('bookings', item, activeTenantId) as T;
            if (node === 'rooms') return normalizeForNode('rooms', item, activeTenantId) as T;
            return item;
        });
        const scopedRows = filterRowsByPropertyScope(rows as Array<T & { propertyId?: string }>, scopeIds) as T[];
        if (syncCache) {
            // @ts-ignore
            CACHE[cacheKey] = scopedRows;
        }
        callback(scopedRows);
    };

    const teardownPropertySubscriptions = () => {
        propertyUnsubscribes.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch (error) {
                console.warn('Cleanup scoped subscription failed', error);
            }
        });
        propertyUnsubscribes = [];
    };

    const activateFallback = () => {
        if (fallbackUnsubscribe) return;
        teardownPropertySubscriptions();
        fallbackUnsubscribe = trackedOnValue(
            path,
            (snap) => {
                snapshotMap.clear();
                snapshotMap.set('fallback', snap);
                emit();
            },
            errorCallback
        );
    };

    if (missingQueryIndexPaths.has(path)) {
        activateFallback();
    } else {
        propertyUnsubscribes = scopeIds.map((propertyId) =>
            trackedOnValueByChild(
                path,
                'propertyId',
                propertyId,
                (snap) => {
                    snapshotMap.set(propertyId, snap);
                    emit();
                },
                (error) => {
                    if (isMissingIndexError(error)) {
                        missingQueryIndexPaths.add(path);
                        if (isFirebaseDebugEnabled()) {
                            console.warn(
                                `[Firebase Debug] Missing realtime index for ${path}. Falling back to full realtime read until ".indexOn": "propertyId" is added to database rules.`
                            );
                        }
                        activateFallback();
                        return;
                    }
                    errorCallback?.(error);
                }
            )
        );
    }

    return () => {
        teardownPropertySubscriptions();
        if (fallbackUnsubscribe) {
            try {
                fallbackUnsubscribe();
            } catch (error) {
                console.warn('Cleanup fallback subscription failed', error);
            }
        }
    };
};

const _subscribeRoomsForProperties = (
    propertyIds: string[] | undefined,
    callback: (rows: Room[]) => void,
    errorCallback?: (error: unknown) => void
) => subscribeScopedCollectionByProperty<Room>('rooms', 'rooms', propertyIds, callback, errorCallback);

const _subscribeBookingsForProperties = (
    propertyIds: string[] | undefined,
    callback: (rows: Booking[]) => void,
    errorCallback?: (error: unknown) => void
) => subscribeScopedCollectionByProperty<Booking>('bookings', 'bookings', propertyIds, callback, errorCallback);

const _subscribeRoomsForPropertiesView = (
    propertyIds: string[] | undefined,
    callback: (rows: Room[]) => void,
    errorCallback?: (error: unknown) => void
) => subscribeScopedCollectionByProperty<Room>('rooms', 'rooms', propertyIds, callback, errorCallback, false);

const _subscribeBookingsForPropertiesView = (
    propertyIds: string[] | undefined,
    callback: (rows: Booking[]) => void,
    errorCallback?: (error: unknown) => void
) => subscribeScopedCollectionByProperty<Booking>('bookings', 'bookings', propertyIds, callback, errorCallback, false);

const _fetchBookingByIdRemote = async (bookingId: string) => {
    if (!_ensureFirebase() || !bookingId) return null;

    const basePath = getBaseRef();
    if (!basePath) return null;

    const snap = await trackedGet(`${basePath}/bookings/${bookingId}`);
    if (!snap.exists()) return null;
    return normalizeForNode('bookings', { id: bookingId, ...snap.val() }, activeTenantId) as Booking;
};

const _fetchDashboardBookingDetail = (bookingId: string) => {
    const requestKey = `${activeTenantId || 'NO_TENANT'}|${bookingId}`;
    const pending = dashboardBookingDetailInFlight.get(requestKey);
    if (pending) return pending;

    const request = _fetchBookingByIdRemote(bookingId).finally(() => {
        if (dashboardBookingDetailInFlight.get(requestKey) === request) {
            dashboardBookingDetailInFlight.delete(requestKey);
        }
    });
    dashboardBookingDetailInFlight.set(requestKey, request);
    return request;
};

const _fetchRoomByIdRemote = async (roomId: string) => {
    if (!_ensureFirebase() || !roomId) return null;

    const basePath = getBaseRef();
    if (!basePath) return null;

    const directSnap = await trackedGet(`${basePath}/rooms/${roomId}`);
    if (directSnap.exists()) {
        return normalizeForNode('rooms', { id: roomId, ...directSnap.val() }, activeTenantId) as Room;
    }

    const roomsSnap = await trackedGet(`${basePath}/rooms`);
    let matchedRoom: Room | null = null;
    roomsSnap.forEach((child: any) => {
        if (matchedRoom) return;
        const value = child.val();
        if (child.key === roomId || value?.id === roomId) {
            matchedRoom = normalizeForNode('rooms', { id: value?.id || child.key, ...value }, activeTenantId) as Room;
        }
    });

    return matchedRoom;
};

const _fetchBookingById = async (bookingId: string, options: { forceRemote?: boolean } = {}) => {
    if (!_ensureFirebase() || !bookingId) return null;

    const cached = CACHE.bookings.find((booking) => booking.id === bookingId) || null;
    if (!options.forceRemote && cached && cached.status !== BookingStatus.DELETED) return cached;

    const remote = await _fetchBookingByIdRemote(bookingId);
    if (options.forceRemote) return remote;
    return remote || cached;
};

const _fetchOperationalBookings = async (
    propertyId: string,
    start: string,
    end: string,
    paddingDays: number = 14
) => {
    return _fetchOperationalBookingsForProperties([propertyId], start, end, paddingDays);
};

const _fetchOperationalBookingsForProperties = async (
    propertyIds: string[] | undefined,
    start: string,
    end: string,
    paddingDays: number = 14
) => {
    if (!_ensureFirebase()) return [] as Booking[];

    const basePath = getBaseRef();
    if (!basePath) return [] as Booking[];

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) return [] as Booking[];

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return [] as Booking[];

    const rangeStartMs = startDate.getTime();
    const rangeEndMs = endDate.getTime();

    if (!bookingIndexWriteEnabled) {
        const fallback = await _fetchBookingsForProperties(scopeIds);
        const result = filterBookingsForRange(fallback, rangeStartMs, rangeEndMs);
        return result;
    }

    const paddedStart = new Date(startDate);
    paddedStart.setDate(paddedStart.getDate() - paddingDays);
    const paddedEnd = new Date(endDate);
    paddedEnd.setDate(paddedEnd.getDate() + paddingDays);

    const dayKeys = getDateKeysBetween(paddedStart, paddedEnd);
    const unique = new Map<string, Booking>();

    await Promise.all(
        scopeIds.flatMap((propertyId) =>
            dayKeys.map(async (dateKey) => {
                const snap = await trackedGet(`${basePath}/${BOOKING_INDEX_NODE}/${propertyId}/${dateKey}`);
                snapshotToArray<Booking>(snap).forEach((record) => {
                    const booking = normalizeBookingIndexRecord(record);
                    if (!booking?.id) return;
                    unique.set(booking.id, booking);
                });
            })
        )
    );

    const lowerBoundMs = paddedStart.getTime();
    const upperBoundMs = paddedEnd.getTime();

    if (isBookingIndexReadFallbackEnabled()) {
        const fallback = await _fetchBookingsForProperties(scopeIds);
        fallback.forEach((booking) => {
            if (!booking?.id) return;
            unique.set(booking.id, booking);
        });
    }

    return filterBookingsForRange(Array.from(unique.values()), lowerBoundMs, upperBoundMs);
};

const _fetchDashboardBookingsForProperties = async (
    propertyIds: string[] | undefined,
    start: string,
    end: string,
    paddingDays: number = 0
) => {
    if (!_ensureFirebase()) return [] as Booking[];

    const basePath = getBaseRef();
    if (!basePath) return [] as Booking[];

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) return [] as Booking[];

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) return [] as Booking[];

    const requestKey = `${activeTenantId || 'NO_TENANT'}|${scopeIds.join(',')}|${startDate.toISOString()}|${endDate.toISOString()}|${paddingDays}`;
    const cached = dashboardBookingRangeCache.get(requestKey);
    if (cached && cached.expiresAt > Date.now()) return cloneData(cached.rows);

    const pending = dashboardBookingRangeInFlight.get(requestKey);
    if (pending) return pending.then((rows) => cloneData(rows));

    const request = (async () => {
        const scopeSet = new Set(scopeIds);
        const unique = new Map<string, Booking>();
        const addBooking = (booking: Booking | null) => {
            if (!booking?.id) return;
            if (!booking.propertyId || !scopeSet.has(booking.propertyId)) return;
            if (booking.status === BookingStatus.DELETED || isExpiredHoldBooking(booking)) return;
            unique.set(booking.id, booking);
        };

        const endInclusive = new Date(endDate.getTime() - 1).toISOString();
        try {
            const createdSnap = await trackedGetByChildRange(`${basePath}/bookings`, 'createdAt', startDate.toISOString(), endInclusive);
            snapshotToArray<Booking>(createdSnap).forEach((booking) => {
                addBooking(normalizeForNode('bookings', booking, activeTenantId) as Booking);
            });
        } catch (error) {
            console.error('Dashboard booking createdAt range load failed', error);
        }

        const operationalSummaries = await _fetchOperationalBookingsForProperties(scopeIds, start, end, paddingDays);
        await Promise.all(
            operationalSummaries.map(async (summary) => {
                if (!summary?.id || unique.has(summary.id)) return;
                try {
                    addBooking((await _fetchDashboardBookingDetail(summary.id)) || summary);
                } catch (error) {
                    console.error('Dashboard booking detail load failed', error);
                    addBooking(summary);
                }
            })
        );

        const rows = Array.from(unique.values());
        dashboardBookingRangeCache.set(requestKey, { expiresAt: Date.now() + DASHBOARD_BOOKING_RANGE_CACHE_TTL_MS, rows: cloneData(rows) });
        return rows;
    })();

    dashboardBookingRangeInFlight.set(requestKey, request);

    try {
        return cloneData(await request);
    } finally {
        if (dashboardBookingRangeInFlight.get(requestKey) === request) {
            dashboardBookingRangeInFlight.delete(requestKey);
        }
    }
};

const _fetchReportBookingsForProperties = async (
    propertyIds: string[] | undefined,
    start: string,
    end: string
) => {
    if (!_ensureFirebase()) return [] as Booking[];

    const basePath = getBaseRef();
    if (!basePath) return [] as Booking[];

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0 || !start || !end || end < start) return [] as Booking[];

    const scopeSet = new Set(scopeIds);
    const unique = new Map<string, Booking>();
    const addBooking = (booking: Booking) => {
        if (!booking?.id) return;
        if (!booking.propertyId || !scopeSet.has(booking.propertyId)) return;
        if (booking.status === BookingStatus.DELETED || isExpiredHoldBooking(booking)) return;
        unique.set(booking.id, normalizeForNode('bookings', booking, activeTenantId) as Booking);
    };

    const [checkOutSnap, createdSnap] = await Promise.all([
        trackedGetByChildRange(`${basePath}/bookings`, 'checkOutDate', start, end),
        trackedGetByChildRange(`${basePath}/bookings`, 'createdAt', start, end),
    ]);

    snapshotToArray<Booking>(checkOutSnap).forEach(addBooking);
    snapshotToArray<Booking>(createdSnap).forEach(addBooking);

    return Array.from(unique.values());
};

const _subscribeOperationalBookings = (
    propertyIds: string[] | undefined,
    start: string,
    end: string,
    callback: (rows: Booking[]) => void,
    errorCallback?: (error: unknown) => void,
    paddingDays: number = 14
) => {
    if (!_ensureFirebase()) {
        callback([]);
        return () => undefined;
    }

    const basePath = getBaseRef();
    if (!basePath) {
        callback([]);
        return () => undefined;
    }

    const scopeIds = normalizePropertyScope(propertyIds);
    if (scopeIds.length === 0) {
        callback([]);
        return () => undefined;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        callback([]);
        return () => undefined;
    }

    const rangeStartMs = startDate.getTime();
    const rangeEndMs = endDate.getTime();
    const paddedStart = new Date(startDate);
    paddedStart.setDate(paddedStart.getDate() - paddingDays);
    const paddedEnd = new Date(endDate);
    paddedEnd.setDate(paddedEnd.getDate() + paddingDays);
    const lowerBoundMs = paddedStart.getTime();
    const upperBoundMs = paddedEnd.getTime();

    if (!bookingIndexWriteEnabled) {
        return subscribeScopedCollectionByProperty<Booking>(
            'bookings',
            'bookings',
            scopeIds,
            (rows) => {
                const result = filterBookingsForRange(rows, rangeStartMs, rangeEndMs);
                callback(result);
            },
            errorCallback,
            false
        );
    }

    const dayKeys = getDateKeysBetween(paddedStart, paddedEnd);
    const snapshotMap = new Map<string, any>();
    const expectedSnapshotCount = scopeIds.length * dayKeys.length;
    const seenSnapshotKeys = new Set<string>();
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackRows: Booking[] = [];

    const emitIndexRows = () => {
        if (seenSnapshotKeys.size < expectedSnapshotCount) return;
        const unique = new Map<string, Booking>();
        snapshotMap.forEach((storedSnap) => {
            snapshotToArray<Booking>(storedSnap).forEach((record) => {
                const booking = normalizeBookingIndexRecord(record);
                if (!booking?.id) return;
                unique.set(booking.id, booking);
            });
        });

        fallbackRows.forEach((booking) => {
            if (!booking?.id) return;
            unique.set(booking.id, booking);
        });

        callback(filterBookingsForRange(Array.from(unique.values()), lowerBoundMs, upperBoundMs));
    };

    const scheduleOneShotFallback = () => {
        if (!isBookingIndexReadFallbackEnabled() || fallbackTimer) return;
        fallbackTimer = setTimeout(() => {
            _fetchBookingsForProperties(scopeIds)
                .then((rows) => {
                    fallbackRows = rows;
                    emitIndexRows();
                })
                .catch((error) => {
                    errorCallback?.(error);
                });
        }, BOOKING_INDEX_FALLBACK_DELAY_MS);
    };

    const unsubscribes = scopeIds.flatMap((propertyId) =>
        dayKeys.map((dateKey) =>
            trackedOnValue(
                `${basePath}/${BOOKING_INDEX_NODE}/${propertyId}/${dateKey}`,
                (snap) => {
                    const snapshotKey = `${propertyId}:${dateKey}`;
                    seenSnapshotKeys.add(snapshotKey);
                    snapshotMap.set(snapshotKey, snap);
                    emitIndexRows();
                    if (seenSnapshotKeys.size >= expectedSnapshotCount) {
                        scheduleOneShotFallback();
                    }
                },
                errorCallback
            )
        )
    );

    return () => {
        unsubscribes.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch (error) {
                console.warn('Cleanup operational booking subscription failed', error);
            }
        });
        if (fallbackTimer) {
            clearTimeout(fallbackTimer);
        }
    };
};

const _validateRoomAvailabilityRemote = async (
    propertyId: string,
    roomId: string,
    start: string,
    end: string,
    excludeId?: string
) => {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    await _refreshRoomPoliciesRemote();
    const policyCheck = await _validateRoomPolicyRemote(roomId, start, end);
    if (!policyCheck.valid) {
        return {
            valid: false,
            reason: policyCheck.reason || 'Vi phạm chính sách phòng',
            policyMode: (policyCheck as any).policyMode,
        };
    }

    const propertyBookings = await _fetchBookingsEndingAfter([propertyId], startMs);
    const activeBookings = propertyBookings.filter((booking) => isBookingActiveForConflict(booking));
    const conflict = findBookingConflict(activeBookings, roomId, startMs, endMs, excludeId);
    return conflict ? { valid: false, reason: `Trùng đơn ${conflict.id}` } : { valid: true };
};

const _seedSystemData = () => {
    if (!db) return;

    const updates: Record<string, any> = {};
    const tenantsMap: Record<string, Tenant> = {};
    const plansMap: Record<string, SubscriptionPlan> = {};

    INITIAL_TENANTS.forEach((tenant) => {
        tenantsMap[tenant.id] = tenant;
    });
    INITIAL_PLANS.forEach((plan) => {
        plansMap[plan.id] = plan;
    });

    updates['system/tenants'] = tenantsMap;
    updates['system/plans'] = plansMap;

    const usersMap: Record<string, User> = {};
    INITIAL_USERS.forEach((user) => {
        usersMap[user.id] = normalizeUserCredentialsForStorage(user);
    });

    INITIAL_TENANTS.forEach((tenant) => {
        if (!tenant.adminUsername) return;

        const id = `u_${tenant.id}_admin`;
        if (!usersMap[id]) {
            const adminPasswordHash =
                tenant.adminPasswordHash || (tenant.adminPassword ? digestPassword(tenant.adminPassword) : undefined);
            if (!adminPasswordHash) {
                console.warn(`Skip seeding admin user for tenant ${tenant.id}: missing admin credential hash.`);
                return;
            }
            const adminPasswordView =
                tenant.adminPasswordView || (tenant.adminPassword ? encodePasswordForView(tenant.adminPassword) : undefined);
            usersMap[id] = {
                id,
                tenantId: tenant.id,
                username: tenant.adminUsername,
                passwordHash: adminPasswordHash,
                passwordView: adminPasswordView,
                fullName: 'Admin',
                role: UserRole.ADMIN,
                permissions: Object.values(PERMISSIONS),
                allowedPropertyIds: [],
            };
        }
    });

    updates['system/users'] = usersMap;
    trackedUpdateRoot(updates, { source: 'seed-system' });
};

const _seedTenantData = (tenantId: string) => {
    if (!db) return;

    const toMap = (items: any[]) =>
        items.reduce((acc, item) => ({ ...acc, [item.id]: { ...item, tenantId } }), {});

    const path = `tenants/${tenantId}`;
    const updates: Record<string, any> = {};
    updates[`${path}/properties`] = toMap(INITIAL_PROPERTIES);
    updates[`${path}/rooms`] = toMap(INITIAL_ROOMS);
    updates[`${path}/roomTypes`] = toMap(INITIAL_ROOM_TYPES);
    updates[`${path}/bookings`] = toMap(INITIAL_BOOKINGS);
    updates[`${path}/customers`] = toMap(INITIAL_CUSTOMERS);
    updates[`${path}/tags`] = toMap(INITIAL_TAGS);
    updates[`${path}/transactionCategories`] = toMap(INITIAL_TRANSACTION_CATEGORIES);
    updates[`${path}/bookingCategories`] = toMap(INITIAL_BOOKING_CATEGORIES);
    updates[`${path}/bookingSources`] = toMap(INITIAL_BOOKING_SOURCES);
    updates[`system/tenants/${tenantId}/initialSeeded`] = true;

    trackedUpdateRoot(updates, { source: 'seed-tenant', tenantId }).then(() => {
        if (isFirebaseDebugEnabled()) console.log('Seeding complete');
    });
};

const _saveItem = (node: string, item: any) => {
    if (!item?.id || !activeTenantId || !db) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const normalizedItem = removeUndefinedDeep(normalizeForNode(node, item, activeTenantId));
    if (!normalizedItem?.id) return;
    assertNodeMutationAllowed(node, 'save', normalizedItem);

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const index = list.findIndex((entry: any) => entry.id === normalizedItem.id);
        if (index > -1) list[index] = normalizedItem;
        else list.push(normalizedItem);
    }
    _dataChangeCallback();

    try {
        return trackedSet(`${basePath}/${node}/${normalizedItem.id}`, normalizedItem, { node }).catch((error: any) => {
            console.error(`Save ${node} failed`, error);
        });
    } catch (error) {
        console.error(`Save ${node} failed`, error);
    }
};

const _deleteItem = async (node: string, id: string) => {
    if (!activeTenantId || !db) throw new Error('Kết nối dữ liệu chưa sẵn sàng.');

    const basePath = getBaseRef();
    if (!basePath) throw new Error('Không xác định được tenant hiện tại.');

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    const itemBefore = Array.isArray(list) ? list.find((entry: any) => entry.id === id) : null;
    assertNodeMutationAllowed(node, 'delete', itemBefore || { id });
    const updates = await buildCollectionDeleteUpdates(`${basePath}/${node}`, [id]);
    await trackedUpdateRoot(updates, { node, operation: 'delete' });

    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((entry: any) => entry.id !== id);
    }
    _dataChangeCallback();
};

const _saveListAsMap = async (node: string, list: any[]) => {
    if (!activeTenantId || !db) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const normalizedList = list
        .map((item) => removeUndefinedDeep(normalizeForNode(node, item, activeTenantId)))
        .filter((item) => item?.id);
    normalizedList.forEach((item) => assertNodeMutationAllowed(node, 'save', item));
    const updates: Record<string, any> = {};
    const nextIds = new Set(normalizedList.map((item) => item.id));

    // Small list settings must be hard-deleted when removed from the saved list
    // to avoid ghost items reappearing on realtime sync / page refresh.
    const shouldDeleteRemovedListItems = ['roomPolicies', 'tags', 'transactionCategories', 'bookingCategories', 'bookingSources'].includes(node);
    if (shouldDeleteRemovedListItems) {
        // @ts-ignore
        const currentList = CACHE[node as keyof typeof CACHE];
        if (Array.isArray(currentList)) {
            const removedIds = currentList
                .map((item: any) => item?.id)
                .filter((id: string | undefined): id is string => !!id && !nextIds.has(id));
            Object.assign(updates, await buildCollectionDeleteUpdates(`${basePath}/${node}`, removedIds));
        }
    }

    const storedRooms = node === 'rooms' ? (await trackedGet(`${basePath}/rooms`)).val() || {} : {};
    normalizedList.forEach((item) => {
        if (item?.id) {
            const path = `${basePath}/${node}/${item.id}`;
            if (node === 'rooms' && storedRooms[item.id]) {
                // Editing a name/order must not restore stale cleanliness data from an open settings tab.
                const keys = new Set([...Object.keys(storedRooms[item.id]), ...Object.keys(item)]);
                keys.forEach((key) => {
                    if (key === 'status' || key === 'lastCleanedAt') return;
                    updates[`${path}/${key}`] = item[key] ?? null;
                });
                item.status = storedRooms[item.id].status;
                if (storedRooms[item.id].lastCleanedAt !== undefined) {
                    item.lastCleanedAt = storedRooms[item.id].lastCleanedAt;
                } else {
                    delete item.lastCleanedAt;
                }
            } else {
                updates[path] = item;
            }
        }
    });

    try {
        await trackedUpdateRoot(updates, { node, operation: 'bulk-save' });
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = normalizedList;
        _dataChangeCallback();
        return normalizedList;
    } catch (error) {
        console.error(`Bulk save ${node} failed`, error);
        throw error;
    }
};

const _deleteItems = async (node: string, ids: string[]) => {
    if (!activeTenantId || !db) throw new Error('Kết nối dữ liệu chưa sẵn sàng.');
    if (ids.length === 0) return;

    const basePath = getBaseRef();
    if (!basePath) throw new Error('Không xác định được tenant hiện tại.');

    // @ts-ignore
    const currentList = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(currentList)) {
        currentList
            .filter((entry: any) => ids.includes(entry.id))
            .forEach((entry: any) => assertNodeMutationAllowed(node, 'delete', entry));
    } else {
        ids.forEach((id) => assertNodeMutationAllowed(node, 'delete', { id }));
    }

    const updates = await buildCollectionDeleteUpdates(`${basePath}/${node}`, ids);

    await trackedUpdateRoot(updates, { node, operation: 'bulk-delete' });

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((entry: any) => !ids.includes(entry.id));
    }
    _dataChangeCallback();
};

const _auditCollectionMutation = (node: AuditedNode, previousList: any[], nextList: any[]) => {
    const config = COLLECTION_CONFIGS[node];
    const previousMap = new Map(previousList.filter(Boolean).map((item) => [item.id, item]));
    const nextMap = new Map(nextList.filter(Boolean).map((item) => [item.id, item]));

    const created: any[] = [];
    const deleted: any[] = [];
    const updated: Array<{ before: any; after: any }> = [];

    nextMap.forEach((after, id) => {
        const before = previousMap.get(id);
        if (!before) {
            created.push(after);
            return;
        }

        if (getChangedKeys(before, after).length > 0) {
            updated.push({ before, after });
        }
    });

    previousMap.forEach((before, id) => {
        if (!nextMap.has(id)) deleted.push(before);
    });

    if (
        created.length === 0 &&
        deleted.length === 0 &&
        updated.length > 1 &&
        updated.every(({ before, after }) => isOnlySortOrderChange(before, after))
    ) {
        _recordHistory({
            action: 'REORDER',
            entityType: config.entityType,
            description: `Sắp xếp lại ${config.collectionLabel}`,
            metadata: {
                count: updated.length,
                itemIds: updated.map(({ after }) => after.id),
            },
            coalesceKey: `${node}:reorder`,
        });
        return;
    }

    created.forEach((after) => {
        _recordHistory({
            action: 'CREATE',
            entityType: config.entityType,
            entityId: after.id,
            entityLabel: config.getLabel(after),
            description: `Tạo ${config.label} ${config.getLabel(after)}`,
            after,
            metadata: buildNodeMetadata(node, after),
        });
    });

    updated.forEach(({ before, after }) => {
        _recordHistory({
            action: 'UPDATE',
            entityType: config.entityType,
            entityId: after.id,
            entityLabel: config.getLabel(after),
            description: `Cập nhật ${config.label} ${config.getLabel(after)}`,
            before,
            after,
            metadata: {
                ...buildNodeMetadata(node, after),
                changedKeys: getChangedKeys(before, after),
            },
            coalesceKey: `${node}:${after.id}:update`,
        });
    });

    deleted.forEach((before) => {
        _recordHistory({
            action: 'DELETE',
            entityType: config.entityType,
            entityId: before.id,
            entityLabel: config.getLabel(before),
            description: `Xóa ${config.label} ${config.getLabel(before)}`,
            before,
            metadata: buildNodeMetadata(node, before),
        });
    });
};

const _saveAuditedList = async (node: AuditedNode, list: any[]) => {
    const previousList = cloneData(
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] || []
    ) as any[];
    const savedList = await _saveListAsMap(node, list);
    if (savedList) _auditCollectionMutation(node, previousList, savedList);
};

const _saveBookingFieldSettings = async (settings: BookingFieldSettings) => {
    if (!db || !activeTenantId || activeTenantId === SYSTEM_TENANT_ID) {
        throw new Error('Không thể lưu cấu hình danh mục đơn: thiếu kết nối tenant.');
    }

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không thể lưu cấu hình danh mục đơn: không xác định được tenant hiện tại.');
    }

    assertActorHasAnyPermission([PERMISSIONS.ADMIN_SETTINGS], 'cập nhật cấu hình danh mục đơn');

    const previous = cloneData(CACHE.bookingFieldSettings);
    const normalized = normalizeBookingFieldSettings(settings);
    await trackedSet(`${basePath}/bookingFieldSettings`, removeUndefinedDeep(normalized), { node: 'bookingFieldSettings' });

    CACHE.bookingFieldSettings = normalized;
    _dataChangeCallback();

    if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
        _recordHistory({
            action: 'UPDATE',
            entityType: 'SYSTEM',
            entityId: 'bookingFieldSettings',
            entityLabel: 'Cấu hình danh mục đơn',
            description: 'Cập nhật cấu hình danh mục đơn theo chi nhánh',
            before: previous as unknown as Record<string, any>,
            after: normalized as unknown as Record<string, any>,
            metadata: { node: 'bookingFieldSettings' },
            coalesceKey: 'booking-field-settings:update',
        });
    }
};

const _saveNotificationSettings = async (settings: NotificationSettings) => {
    if (!db || !activeTenantId || activeTenantId === SYSTEM_TENANT_ID) {
        throw new Error('Không thể lưu cài đặt thông báo: thiếu kết nối tenant.');
    }

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không thể lưu cài đặt thông báo: không xác định được tenant hiện tại.');
    }

    assertActorHasAnyPermission([PERMISSIONS.ADMIN_SETTINGS], 'cập nhật cài đặt thông báo');

    const previous = cloneData(CACHE.notificationSettings);
    const normalized = normalizeNotificationSettings(settings);
    await trackedSet(`${basePath}/notificationSettings`, removeUndefinedDeep(normalized), { node: 'notificationSettings' });

    CACHE.notificationSettings = normalized;
    _dataChangeCallback();

    if (JSON.stringify(previous) !== JSON.stringify(normalized)) {
        _recordHistory({
            action: 'UPDATE',
            entityType: 'SYSTEM',
            entityId: 'notificationSettings',
            entityLabel: 'Cài đặt thông báo',
            description: 'Cập nhật cài đặt thông báo',
            before: previous as unknown as Record<string, any>,
            after: normalized as unknown as Record<string, any>,
            metadata: { node: 'notificationSettings' },
            coalesceKey: 'notification-settings:update',
        });
    }
};

const _updateRoomStatus = async (roomId: string, status: RoomStatus, options: RoomStatusOptions = {}) => {
    if (!db || !activeTenantId || !roomId) {
        throw new Error('Không thể cập nhật trạng thái phòng: thiếu kết nối dữ liệu.');
    }

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không thể cập nhật trạng thái phòng: không xác định được tenant hiện tại.');
    }

    const tenantId = activeTenantId;
    const roomPath = `${basePath}/rooms/${roomId}`;
    const roomSnap = await trackedGet(roomPath);
    let roomBefore = roomSnap.exists()
        ? normalizeForNode('rooms', { id: roomId, ...roomSnap.val() }, tenantId) as Room
        : null;
    if (!roomBefore) {
        throw new Error(`Không tìm thấy phòng ${roomId} để cập nhật trạng thái.`);
    }
    assertRoomStatusMutationAllowed(roomBefore, options.source, !options.suppressLog);
    const isManual = !options.suppressLog && options.source !== 'SYSTEM';
    const confirmsCleaning = isManual && status === RoomStatus.VACANT_CLEAN;
    if (isManual) {
        const roomBookings = await _fetchBookingsEndingAfter([roomBefore.propertyId], Date.now());
        if (roomBookings.some((booking) => booking.roomId === roomId && isBookingOccupyingRoom(booking))) {
            throw new Error('Phòng đang có khách ở. Vui lòng cập nhật giờ trả phòng trước khi báo sạch/bẩn.');
        }
    }
    if (activeTenantId !== tenantId) throw new Error('Chi nhánh làm việc đã thay đổi. Vui lòng thử lại.');

    // A stale automatic sync must not overwrite a newer cleaning confirmation.
    const expectedStatus = (options.expectedRoom || roomBefore).status;
    const expectedCleanedAt = (options.expectedRoom || roomBefore).lastCleanedAt;
    const result = await runTransaction(ref(db, roomPath), (current) => {
        if (!current) return;
        if (!isManual && (current.status !== expectedStatus || current.lastCleanedAt !== expectedCleanedAt)) return;
        if (current.status === status && !confirmsCleaning) return;
        roomBefore = normalizeForNode('rooms', current, tenantId) as Room;
        return {
            ...current,
            status,
            ...(confirmsCleaning ? { lastCleanedAt: serverTimestamp() } : {}),
        };
    }, { applyLocally: false });
    const roomAfter = normalizeForNode('rooms', result.snapshot.val(), tenantId) as Room | null;
    if (!result.committed || !roomAfter) return roomAfter;

    if (activeTenantId === tenantId) {
        CACHE.rooms = CACHE.rooms.some((room) => room.id === roomId)
            ? CACHE.rooms.map((room) => room.id === roomId ? roomAfter : room)
            : [...CACHE.rooms, roomAfter];
        _dataChangeCallback();
    }

    if (!options.suppressLog) {
        _recordHistory({
            tenantId,
            action: 'STATUS_CHANGE',
            entityType: 'ROOM',
            entityId: roomId,
            entityLabel: roomBefore.number || roomId,
            description:
                options.reason ||
                `Đổi trạng thái phòng ${roomBefore.number || roomId} từ ${roomBefore.status} sang ${status}`,
            before: roomBefore,
            after: roomAfter,
            metadata: {
                ...buildNodeMetadata('rooms', roomAfter),
                fromStatus: roomBefore.status,
                toStatus: status,
            },
            source: options.source || 'WEB',
            staffId: options.staffId,
            coalesceKey: `room:${roomId}:status`,
        });
    }
    return roomAfter;
};

const _syncRoomStatusesForRooms = async (roomIds: string[], options: RoomStatusOptions = {}) => {
    const uniqueRoomIds = Array.from(new Set((roomIds || []).filter(Boolean)));
    if (uniqueRoomIds.length === 0) return;

    const targetRooms = uniqueRoomIds
        .map((roomId) => CACHE.rooms.find((room) => room.id === roomId))
        .filter(Boolean) as Room[];

    if (targetRooms.length === 0) return;

    const propertyIds = normalizePropertyScope(
        Array.from(new Set(targetRooms.map((room) => room.propertyId).filter(Boolean)))
    );
    const bookingsSource =
        db && activeTenantId && propertyIds.length > 0
            ? await _fetchBookingsEndingAfter(propertyIds, roomHistoryStart(targetRooms))
            : CACHE.bookings;

    const nowMs = Date.now();
    await Promise.all(targetRooms.map(async (room) => {
        const targetStatus = deriveRoomOperationalStatus(
            room,
            bookingsSource.filter((booking) => booking.roomId === room.id),
            nowMs
        );
        if (room.status !== targetStatus) {
            await _updateRoomStatus(room.id, targetStatus, { ...options, suppressLog: true, expectedRoom: room });
        }
    }));
};

const _syncOperationalStatuses = async (options: BookingActionOptions = {}) => {
    const nowMs = Date.now();
    const nextBookings = CACHE.bookings.map((booking) => {
        const derivedStatus = deriveBookingStatus(booking, nowMs);
        const persistedStatus = getPersistedBookingStatus(booking) || booking.status;
        const nextBooking = booking.status === derivedStatus ? booking : { ...booking, status: derivedStatus };
        return attachPersistedBookingStatus(nextBooking, persistedStatus);
    });
    const changedBookings = nextBookings.filter((booking, index) => {
        const persistedStatus = getPersistedBookingStatus(CACHE.bookings[index]);
        return persistedStatus !== booking.status;
    });

    if (changedBookings.length > 0 && db && activeTenantId) {
        const basePath = getBaseRef();
        if (basePath) {
            const updates: Record<string, unknown> = {};
            changedBookings.forEach((booking) => {
                updates[`${basePath}/bookings/${booking.id}/status`] = booking.status;
            });
            await trackedUpdateRootWithBookingIndexFallback(updates, {
                operation: 'sync-operational-booking-statuses',
                bookingCount: changedBookings.length,
            });
        }
    }

    const changedBookingIds = new Set(changedBookings.map((booking) => booking.id));
    CACHE.bookings = nextBookings.map((booking) =>
        attachPersistedBookingStatus(
            { ...booking },
            changedBookingIds.has(booking.id) ? booking.status : getPersistedBookingStatus(booking) || booking.status
        )
    );
    _dataChangeCallback();
    await _syncRoomStatusesForRooms(
        nextBookings.filter((booking) => booking.status !== BookingStatus.DELETED).map((booking) => booking.roomId),
        { source: options.source || 'SYSTEM', suppressLog: true }
    );
};

const _hasOperationalStatusDrift = () => {
    const nowMs = Date.now();
    return CACHE.bookings.some((booking) => {
        if (booking.status === BookingStatus.DELETED) return false;
        return getPersistedBookingStatus(booking) !== deriveBookingStatus(booking, nowMs);
    });
};

const _addBooking = async (booking: Booking, options: BookingActionOptions = {}) => {
    const { savedBooking } = await _saveBookingAtomic(booking, 'create', options);

    if (savedBooking.status === BookingStatus.CHECKED_IN) {
        _updateRoomStatus(savedBooking.roomId, RoomStatus.OCCUPIED, {
            source: options.source,
            suppressLog: true,
        });
    } else if (savedBooking.status === BookingStatus.CHECKED_OUT) {
        _updateRoomStatus(savedBooking.roomId, RoomStatus.VACANT_DIRTY, {
            source: options.source,
            suppressLog: true,
        });
    }

    _recordHistory({
        action: 'CREATE',
        entityType: 'BOOKING',
        entityId: savedBooking.id,
        entityLabel: savedBooking.id,
        description: `Tạo đơn ${savedBooking.id} cho ${savedBooking.guestName || 'khách lẻ'}`,
        after: savedBooking,
        metadata: {
            ...buildNodeMetadata('bookings', savedBooking),
            operationName: 'Tạo booking',
        },
        source: options.source || 'WEB',
        staffId: options.staffId,
        bookingSnapshot: savedBooking,
    });

    await _syncRoomStatusesForRooms([savedBooking.roomId], { source: options.source, suppressLog: true });
};

const _updateBooking = async (booking: Booking, options: BookingActionOptions = {}) => {
    const { savedBooking, previousBooking } = await _saveBookingAtomic(booking, 'update', options);
    const oldBooking = previousBooking || null;

    if (!oldBooking) {
        _recordHistory({
            action: 'UPDATE',
            entityType: 'BOOKING',
            entityId: savedBooking.id,
            entityLabel: savedBooking.id,
            description: `Cập nhật thông tin đơn ${savedBooking.id}`,
            after: savedBooking,
            metadata: {
                ...buildNodeMetadata('bookings', savedBooking),
                operationName: 'Sửa booking',
            },
            source: options.source || 'WEB',
            staffId: options.staffId,
            bookingSnapshot: savedBooking,
        });
        return;
    }

    const logFieldChange = (params: {
        action: HistoryAction;
        operationName: string;
        description: string;
        changeKey: string;
        beforeValue?: any;
        afterValue?: any;
    }) => {
        _recordHistory({
            action: params.action,
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: params.description,
            before: oldBooking,
            after: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: params.operationName,
                changeKey: params.changeKey,
                beforeValue: params.beforeValue ?? null,
                afterValue: params.afterValue ?? null,
            },
            source: options.source || 'WEB',
            staffId: options.staffId,
            bookingSnapshot: booking,
        });
    };

    const resolveValueAction = (beforeValue?: string | null, afterValue?: string | null): HistoryAction | null => {
        const beforeText = `${beforeValue || ''}`.trim();
        const afterText = `${afterValue || ''}`.trim();
        if (beforeText === afterText) return null;
        if (!beforeText && afterText) return 'CREATE';
        if (beforeText && !afterText) return 'DELETE';
        return 'UPDATE';
    };

    let hasSpecificLogs = false;
    const statusChanged = oldBooking.status !== booking.status;
    const roomChanged = oldBooking.roomId !== booking.roomId;

    if (statusChanged) {
        if (booking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, { source: options.source, suppressLog: true });
        } else if (booking.status === BookingStatus.CHECKED_OUT) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY, { source: options.source, suppressLog: true });
        }

        let action: HistoryAction = 'UPDATE';
        let description = `Cập nhật trạng thái đơn ${booking.id} sang ${booking.status}`;
        let operationName = 'Sửa trạng thái booking';

        if (booking.status === BookingStatus.CHECKED_IN) {
            action = 'CHECK_IN';
            description = `Check-in đơn ${booking.id}`;
            operationName = 'Đổi trạng thái check-in';
        }
        if (booking.status === BookingStatus.CHECKED_OUT) {
            action = 'CHECK_OUT';
            description = `Check-out đơn ${booking.id}`;
            operationName = 'Đổi trạng thái check-out';
        }
        _recordHistory({
            action,
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description,
            before: oldBooking,
            after: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                fromStatus: oldBooking.status,
                toStatus: booking.status,
                operationName,
                changeKey: 'status',
            },
            source: options.source || 'WEB',
            staffId: options.staffId,
            bookingSnapshot: booking,
        });
        hasSpecificLogs = true;
    }

    if (roomChanged) {
        if (oldBooking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(oldBooking.roomId, RoomStatus.VACANT_DIRTY, { source: options.source, suppressLog: true });
        }
        if (booking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, { source: options.source, suppressLog: true });
        } else if (booking.status === BookingStatus.CHECKED_OUT) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY, { source: options.source, suppressLog: true });
        }
    }

    if (oldBooking.totalPrice !== booking.totalPrice) {
        const beforePrice = oldBooking.totalPrice || 0;
        const afterPrice = booking.totalPrice || 0;
        let action: HistoryAction = 'UPDATE';
        let operationName = 'Sửa giá';
        if (beforePrice === 0 && afterPrice > 0) {
            action = 'CREATE';
            operationName = 'Tạo giá';
        } else if (beforePrice > 0 && afterPrice === 0) {
            action = 'DELETE';
            operationName = 'Xóa giá';
        }
        logFieldChange({
            action,
            operationName,
            description: `${operationName} đơn ${booking.id}: ${toCurrency(beforePrice)} -> ${toCurrency(afterPrice)}`,
            changeKey: 'totalPrice',
            beforeValue: beforePrice,
            afterValue: afterPrice,
        });
        hasSpecificLogs = true;
    }

    const guestNameAction = resolveValueAction(oldBooking.guestName, booking.guestName);
    if (guestNameAction) {
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo tên khách',
            UPDATE: 'Sửa tên khách',
            DELETE: 'Xóa tên khách',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[guestNameAction] || 'Sửa tên khách';
        logFieldChange({
            action: guestNameAction,
            operationName,
            description: `${operationName} đơn ${booking.id}: "${oldBooking.guestName || ''}" -> "${booking.guestName || ''}"`,
            changeKey: 'guestName',
            beforeValue: oldBooking.guestName || '',
            afterValue: booking.guestName || '',
        });
        hasSpecificLogs = true;
    }

    const guestPhoneAction = resolveValueAction(oldBooking.guestPhone, booking.guestPhone);
    if (guestPhoneAction) {
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo số điện thoại',
            UPDATE: 'Sửa số điện thoại',
            DELETE: 'Xóa số điện thoại',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[guestPhoneAction] || 'Sửa số điện thoại';
        logFieldChange({
            action: guestPhoneAction,
            operationName,
            description: `${operationName} đơn ${booking.id}: "${oldBooking.guestPhone || ''}" -> "${booking.guestPhone || ''}"`,
            changeKey: 'guestPhone',
            beforeValue: oldBooking.guestPhone || '',
            afterValue: booking.guestPhone || '',
        });
        hasSpecificLogs = true;
    }

    const notesAction = resolveValueAction(oldBooking.notes, booking.notes);
    if (notesAction) {
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo ghi chú',
            UPDATE: 'Sửa ghi chú',
            DELETE: 'Xóa ghi chú',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[notesAction] || 'Sửa ghi chú';
        logFieldChange({
            action: notesAction,
            operationName,
            description: `${operationName} đơn ${booking.id}`,
            changeKey: 'notes',
            beforeValue: oldBooking.notes || '',
            afterValue: booking.notes || '',
        });
        hasSpecificLogs = true;
    }

    if (roomChanged) {
        const action = resolveValueAction(oldBooking.roomId, booking.roomId) || 'UPDATE';
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo phòng',
            UPDATE: 'Sửa phòng',
            DELETE: 'Xóa phòng',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[action] || 'Sửa phòng';
        logFieldChange({
            action,
            operationName,
            description: `${operationName} từ ${formatRoomContextLabel(oldBooking.roomId)} => ${formatRoomContextLabel(booking.roomId)}`,
            changeKey: 'roomId',
            beforeValue: oldBooking.roomId,
            afterValue: booking.roomId,
        });
        hasSpecificLogs = true;
    }

    if (oldBooking.propertyId !== booking.propertyId) {
        const action = resolveValueAction(oldBooking.propertyId, booking.propertyId) || 'UPDATE';
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo chi nhánh',
            UPDATE: 'Sửa chi nhánh',
            DELETE: 'Xóa chi nhánh',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[action] || 'Sửa chi nhánh';
        logFieldChange({
            action,
            operationName,
            description: `${operationName} từ ${formatPropertyLabel(oldBooking.propertyId)} => ${formatPropertyLabel(booking.propertyId)}`,
            changeKey: 'propertyId',
            beforeValue: oldBooking.propertyId,
            afterValue: booking.propertyId,
        });
        hasSpecificLogs = true;
    }

    if (oldBooking.checkInDate !== booking.checkInDate) {
        const action = resolveValueAction(oldBooking.checkInDate, booking.checkInDate) || 'UPDATE';
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo giờ nhận phòng',
            UPDATE: 'Sửa giờ nhận phòng',
            DELETE: 'Xóa giờ nhận phòng',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[action] || 'Sửa giờ nhận phòng';
        logFieldChange({
            action,
            operationName,
            description: `${operationName} đơn ${booking.id}: ${formatDateLabel(oldBooking.checkInDate)} -> ${formatDateLabel(booking.checkInDate)}`,
            changeKey: 'checkInDate',
            beforeValue: oldBooking.checkInDate,
            afterValue: booking.checkInDate,
        });
        hasSpecificLogs = true;
    }

    if (oldBooking.checkOutDate !== booking.checkOutDate) {
        const action = resolveValueAction(oldBooking.checkOutDate, booking.checkOutDate) || 'UPDATE';
        const operationNameMap: Record<HistoryAction, string> = {
            CREATE: 'Tạo giờ trả phòng',
            UPDATE: 'Sửa giờ trả phòng',
            DELETE: 'Xóa giờ trả phòng',
            CHECK_IN: '',
            CHECK_OUT: '',
            CANCEL: '',
            LOGIN: '',
            LOGOUT: '',
            IMPORT: '',
            EXPORT: '',
            RESET: '',
            STATUS_CHANGE: '',
            REORDER: '',
            BULK_DELETE: '',
        };
        const operationName = operationNameMap[action] || 'Sửa giờ trả phòng';
        logFieldChange({
            action,
            operationName,
            description: `${operationName} đơn ${booking.id}: ${formatDateLabel(oldBooking.checkOutDate)} -> ${formatDateLabel(booking.checkOutDate)}`,
            changeKey: 'checkOutDate',
            beforeValue: oldBooking.checkOutDate,
            afterValue: booking.checkOutDate,
        });
        hasSpecificLogs = true;
    }

    const oldTagIds = oldBooking.tags || [];
    const newTagIds = booking.tags || [];
    const addedTagIds = newTagIds.filter((id) => !oldTagIds.includes(id));
    const removedTagIds = oldTagIds.filter((id) => !newTagIds.includes(id));

    addedTagIds.forEach((tagId) => {
        logFieldChange({
            action: 'CREATE',
            operationName: 'Tạo tag',
            description: `Tạo tag "${getTagName(tagId) || tagId}" cho đơn ${booking.id}`,
            changeKey: 'tags',
            beforeValue: null,
            afterValue: tagId,
        });
        hasSpecificLogs = true;
    });

    removedTagIds.forEach((tagId) => {
        logFieldChange({
            action: 'DELETE',
            operationName: 'Xóa tag',
            description: `Xóa tag "${getTagName(tagId) || tagId}" khỏi đơn ${booking.id}`,
            changeKey: 'tags',
            beforeValue: tagId,
            afterValue: null,
        });
        hasSpecificLogs = true;
    });

    const oldFees = oldBooking.extraFees || [];
    const newFees = booking.extraFees || [];
    const oldFeeMap = new Map(oldFees.map((fee) => [fee.id, fee]));
    const newFeeMap = new Map(newFees.map((fee) => [fee.id, fee]));

    newFeeMap.forEach((fee, id) => {
        const oldFee = oldFeeMap.get(id);
        const feeLabel = `${fee.name} (${fee.type === 'EXPENSE' ? '-' : '+'}${toCurrency(fee.amount)})`;

        if (!oldFee) {
            logFieldChange({
                action: 'CREATE',
                operationName: 'Tạo Dịch vụ & Phụ thu',
                description: `Tạo Dịch vụ & Phụ thu "${feeLabel}" cho đơn ${booking.id}`,
                changeKey: 'extraFees',
                beforeValue: null,
                afterValue: fee,
            });
            hasSpecificLogs = true;
            return;
        }

        const feeChanged =
            oldFee.name !== fee.name ||
            oldFee.amount !== fee.amount ||
            oldFee.type !== fee.type ||
            oldFee.categoryId !== fee.categoryId;

        if (feeChanged) {
            logFieldChange({
                action: 'UPDATE',
                operationName: 'Sửa Dịch vụ & Phụ thu',
                description: `Sửa Dịch vụ & Phụ thu "${oldFee.name}" -> "${fee.name}" cho đơn ${booking.id}`,
                changeKey: 'extraFees',
                beforeValue: oldFee,
                afterValue: fee,
            });
            hasSpecificLogs = true;
        }
    });

    oldFeeMap.forEach((fee, id) => {
        if (newFeeMap.has(id)) return;
        const feeLabel = `${fee.name} (${fee.type === 'EXPENSE' ? '-' : '+'}${toCurrency(fee.amount)})`;
        logFieldChange({
            action: 'DELETE',
            operationName: 'Xóa Dịch vụ & Phụ thu',
            description: `Xóa Dịch vụ & Phụ thu "${feeLabel}" khỏi đơn ${booking.id}`,
            changeKey: 'extraFees',
            beforeValue: fee,
            afterValue: null,
        });
        hasSpecificLogs = true;
    });

    if (!hasSpecificLogs) {
        _recordHistory({
            action: 'UPDATE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Cập nhật thông tin đơn ${booking.id}`,
            before: oldBooking,
            after: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Sửa booking',
                changedKeys: getChangedKeys(oldBooking, booking),
            },
            source: options.source || 'WEB',
            staffId: options.staffId,
            bookingSnapshot: booking,
        });
    }

    await _syncRoomStatusesForRooms(
        Array.from(new Set([oldBooking.roomId, savedBooking.roomId].filter(Boolean))),
        { source: options.source, suppressLog: true }
    );
};

const _saveBookingGroupAtomic = async (params: BookingGroupSaveParams, options: BookingActionOptions = {}) => {
    const source = options.source || 'WEB';
    const rawUpserts = params.upserts || [];
    const rawDeleteIds = params.deleteIds || [];

    if (rawUpserts.length === 0 && rawDeleteIds.length === 0) {
        return { createdIds: [] as string[], updatedIds: [] as string[], deletedIds: [] as string[] };
    }

    if (!activeTenantId || !db) {
        throw new Error('Kết nối dữ liệu chưa sẵn sàng. Vui lòng thử lại.');
    }
    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không xác định được tenant hiện tại. Vui lòng tải lại trang.');
    }

    const normalizedUpsertMap = new Map<string, BookingGroupSaveItem>();
    for (const item of rawUpserts) {
        const normalizedBooking = removeUndefinedDeep(normalizeForNode('bookings', item.booking, activeTenantId));
        if (!normalizedBooking?.id) {
            throw new Error('Có booking không hợp lệ trong thao tác lưu nhóm.');
        }
        if (normalizedUpsertMap.has(normalizedBooking.id)) {
            throw new Error(`Trùng mã đơn ${normalizedBooking.id} trong cùng một lần lưu nhóm.`);
        }
        assertBookingMutationAllowed(item.mode, normalizedBooking as Booking, source);
        normalizedUpsertMap.set(normalizedBooking.id, {
            booking: normalizedBooking as Booking,
            mode: item.mode,
        });
    }

    const normalizedUpserts = Array.from(normalizedUpsertMap.values());
    const deleteIds = Array.from(new Set(rawDeleteIds.filter(Boolean))).filter(
        (id) => !normalizedUpsertMap.has(id)
    );

    const beforeById = new Map<string, Booking | null>();
    const deletedBefore: Booking[] = [];
    const remoteExistingById = new Map<string, Booking>();
    const knownIds = [
        ...normalizedUpserts.map((item) => item.booking.id),
        ...deleteIds,
    ];
    const knownBookings = (await Promise.all(knownIds.map((id) => _fetchBookingById(id)))).filter(Boolean) as Booking[];
    knownBookings.forEach((booking) => {
        remoteExistingById.set(booking.id, booking);
    });

    const involvedPropertyIds = normalizePropertyScope(
        Array.from(
            new Set([
                ...normalizedUpserts.map((item) => item.booking.propertyId),
                ...knownBookings.map((booking) => booking.propertyId),
            ])
        )
    );
    const remotePropertyBookings = await _fetchBookingsForProperties(involvedPropertyIds);
    const nextMap = new Map<string, Booking>();

    remotePropertyBookings.forEach((booking) => {
        nextMap.set(booking.id, booking);
    });

    await _refreshRoomPoliciesRemote();

    for (const deleteId of deleteIds) {
        const existing = nextMap.get(deleteId) || remoteExistingById.get(deleteId) || null;
        if (!existing || existing.status === BookingStatus.DELETED) {
            throw new Error(`Đơn ${deleteId} đã bị xóa hoặc không còn tồn tại.`);
        }
        assertBookingMutationAllowed('delete', existing, source);
        deletedBefore.push(existing);
        nextMap.delete(deleteId);
    }

    for (const item of normalizedUpserts) {
        const nextBooking = item.booking;
        const existing = nextMap.get(nextBooking.id) || remoteExistingById.get(nextBooking.id) || null;

        if (item.mode === 'create' && existing) {
            throw new Error(`Mã đơn ${nextBooking.id} đã tồn tại.`);
        }
        if (item.mode === 'update' && (!existing || existing.status === BookingStatus.DELETED)) {
            throw new Error(`Đơn ${nextBooking.id} đã bị xóa hoặc không còn tồn tại.`);
        }
        if (item.mode === 'update' && existing) {
            assertBookingMutationAllowed('update', existing, source);
        }

        beforeById.set(nextBooking.id, existing || null);

        const startMs = new Date(nextBooking.checkInDate).getTime();
        const endMs = new Date(nextBooking.checkOutDate).getTime();
        const policyCheck = await _validateRoomPolicyRemote(nextBooking.roomId, nextBooking.checkInDate, nextBooking.checkOutDate);
        if (!policyCheck.valid) {
            throw new Error(policyCheck.reason || 'Vi phạm chính sách phòng');
        }

        const conflict = findBookingConflict(
            Array.from(nextMap.values()),
            nextBooking.roomId,
            startMs,
            endMs,
            item.mode === 'update' ? nextBooking.id : undefined
        );
        if (conflict) {
            throw new Error(`Trùng đơn ${conflict.id}`);
        }

        nextMap.set(nextBooking.id, nextBooking);
    }

    const updates: Record<string, unknown> = {};
    deleteIds.forEach((id) => {
        updates[`${basePath}/bookings/${id}`] = null;
    });
    normalizedUpserts.forEach((item) => {
        updates[`${basePath}/bookings/${item.booking.id}`] = item.booking;
    });
    deletedBefore.forEach((booking) => {
        Object.assign(updates, buildBookingIndexDiff(basePath, booking, null));
    });
    normalizedUpserts.forEach((item) => {
        const before = beforeById.get(item.booking.id) || null;
        Object.assign(updates, buildBookingIndexDiff(basePath, before, item.booking));
    });

    await trackedUpdateRootWithBookingIndexFallback(updates, {
        operation: 'save-booking-group',
        upsertCount: normalizedUpserts.length,
        deleteCount: deleteIds.length,
    });

    CACHE.bookings = Array.from(nextMap.values());
    _dataChangeCallback();

    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const deletedIds: string[] = [];

    deletedBefore.forEach((booking) => {
        deletedIds.push(booking.id);
        if (booking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY, {
                source,
                staffId: options.staffId,
                suppressLog: true,
            });
        }

        _recordHistory({
            action: 'DELETE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Xóa đơn ${booking.id}`,
            before: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Xóa booking',
            },
            source,
            staffId: options.staffId,
            bookingSnapshot: booking,
        });
    });

    normalizedUpserts.forEach((item) => {
        const booking = item.booking;
        const before = beforeById.get(booking.id) || null;

        if (!before) {
            createdIds.push(booking.id);
            if (booking.status === BookingStatus.CHECKED_IN) {
                _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, {
                    source,
                    staffId: options.staffId,
                    suppressLog: true,
                });
            }

            _recordHistory({
                action: 'CREATE',
                entityType: 'BOOKING',
                entityId: booking.id,
                entityLabel: booking.id,
                description: `Tạo đơn ${booking.id} cho ${booking.guestName || 'khách lẻ'}`,
                after: booking,
                metadata: {
                    ...buildNodeMetadata('bookings', booking),
                    operationName: 'Tạo booking',
                },
                source,
                staffId: options.staffId,
                bookingSnapshot: booking,
            });
            return;
        }

        updatedIds.push(booking.id);
        const roomChanged = before.roomId !== booking.roomId;
        if (roomChanged && before.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(before.roomId, RoomStatus.VACANT_DIRTY, {
                source,
                staffId: options.staffId,
                suppressLog: true,
            });
        }
        if (before.status !== booking.status) {
            if (booking.status === BookingStatus.CHECKED_IN) {
                _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, {
                    source,
                    staffId: options.staffId,
                    suppressLog: true,
                });
            } else if (booking.status === BookingStatus.CHECKED_OUT) {
                _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY, {
                    source,
                    staffId: options.staffId,
                    suppressLog: true,
                });
            }
        } else if (roomChanged && booking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, {
                source,
                staffId: options.staffId,
                suppressLog: true,
            });
        } else if (roomChanged && booking.status === BookingStatus.CHECKED_OUT) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY, {
                source,
                staffId: options.staffId,
                suppressLog: true,
            });
        }

        _recordHistory({
            action: 'UPDATE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Cập nhật thông tin đơn ${booking.id}`,
            before,
            after: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Sửa booking (lưu nhóm)',
                changedKeys: getChangedKeys(before, booking),
            },
            source,
            staffId: options.staffId,
            bookingSnapshot: booking,
        });
    });

    if (createdIds.length + updatedIds.length + deletedIds.length > 1) {
        _recordHistory({
            action: 'UPDATE',
            entityType: 'BOOKING',
            description: `Lưu nhóm booking: tạo ${createdIds.length}, sửa ${updatedIds.length}, xóa ${deletedIds.length}`,
            metadata: {
                operationName: 'Lưu nhóm booking',
                createdIds,
                updatedIds,
                deletedIds,
            },
            source,
            staffId: options.staffId,
        });
    }

    await _syncRoomStatusesForRooms(
        Array.from(
            new Set(
                [
                    ...deletedBefore.map((booking) => booking.roomId),
                    ...Array.from(beforeById.values())
                        .filter(Boolean)
                        .map((booking) => (booking as Booking).roomId),
                    ...normalizedUpserts.map((item) => item.booking.roomId),
                ].filter(Boolean)
            )
        ),
        { source, staffId: options.staffId, suppressLog: true }
    );

    return { createdIds, updatedIds, deletedIds };
};

const _hardDeleteBookings = (ids: string[], staffId?: string, options: BookingActionOptions = {}) => {
    if (!activeTenantId || !db || ids.length === 0) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const bookingsToDelete = CACHE.bookings.filter((booking) => ids.includes(booking.id));
    if (bookingsToDelete.length === 0) return;
    bookingsToDelete.forEach((booking) => assertBookingMutationAllowed('delete', booking, options.source));

    const updates: Record<string, any> = {};
    bookingsToDelete.forEach((booking) => {
        updates[`${basePath}/bookings/${booking.id}`] = null;
        Object.assign(updates, buildBookingIndexDiff(basePath, booking, null));

        if (booking.status === BookingStatus.CHECKED_IN) {
            updates[`${basePath}/rooms/${booking.roomId}/status`] = RoomStatus.VACANT_DIRTY;
            CACHE.rooms = CACHE.rooms.map((room) =>
                room.id === booking.roomId ? { ...room, status: RoomStatus.VACANT_DIRTY } : room
            );
        }
    });

    CACHE.bookings = CACHE.bookings.filter((booking) => !ids.includes(booking.id));
    _dataChangeCallback();

    trackedUpdateRootWithBookingIndexFallback(updates, { operation: 'hard-delete-bookings' }).catch((error: any) => {
        console.error('Hard delete failed', error);
    });

    bookingsToDelete.forEach((booking) => {
        _recordHistory({
            action: 'DELETE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Xóa đơn ${booking.id}`,
            before: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Xóa booking',
            },
            source: options.source || 'WEB',
            staffId,
            bookingSnapshot: booking,
        });
    });

    if (bookingsToDelete.length > 1) {
        _recordHistory({
            action: 'BULK_DELETE',
            entityType: 'BOOKING',
            description: `Xóa hàng loạt ${bookingsToDelete.length} đơn đặt phòng`,
            metadata: {
                count: bookingsToDelete.length,
                bookingIds: bookingsToDelete.map((booking) => booking.id),
                operationName: 'Xóa hàng loạt booking',
            },
            source: options.source || 'WEB',
            staffId,
        });
    }
};

const _resetAllBookings = async () => {
    if (!activeTenantId || !db) {
        throw new Error('Kết nối dữ liệu chưa sẵn sàng.');
    }

    await _assertOnlineForMutation('reset dữ liệu');
    assertResetBookingsAllowed();

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không xác định được tenant hiện tại.');
    }

    const deletedIds = CACHE.bookings.map((booking) => booking.id);
    const deletedCount = deletedIds.length;

    const updates: Record<string, unknown> = {
        [`${basePath}/bookings`]: null,
        [`${basePath}/${BOOKING_INDEX_NODE}`]: null,
    };

    await trackedUpdateRootWithBookingIndexFallback(updates, { operation: 'reset-all-bookings', pathCount: 2 });

    CACHE.bookings = [];
    _dataChangeCallback();

    _recordHistory({
        action: 'RESET',
        entityType: 'BOOKING',
        description: `Xóa sạch toàn bộ dữ liệu đặt phòng (${deletedCount} đơn)`,
        metadata: {
            deletedCount,
            bookingIds: deletedIds,
        },
    });

    return deletedCount;
};

const _logAction = (action: HistoryAction | string, booking: Booking, description: string, staffId?: string) => {
    _recordHistory({
        action,
        entityType: 'BOOKING',
        entityId: booking.id,
        entityLabel: booking.id,
        description,
        after: booking,
        metadata: {
            ...buildNodeMetadata('bookings', booking),
            operationName: description,
        },
        staffId,
        bookingSnapshot: booking,
    });
};

const _deleteBooking = async (id: string, staffId: string, options: BookingActionOptions = {}) => {
    if (!id) return false;
    const source = options.source || 'WEB';

    if (!activeTenantId || !db) {
        const existing = CACHE.bookings.find((booking) => booking.id === id);
        if (!existing) return false;
        _hardDeleteBookings([id], staffId, options);
        return true;
    }

    const basePath = getBaseRef();
    if (!basePath) return false;
    await _assertOnlineForMutation('xóa đơn');

    const deletedBooking = await _fetchBookingById(id);

    if (!deletedBooking || deletedBooking.status === BookingStatus.DELETED) {
        return false;
    }
    assertBookingMutationAllowed('delete', deletedBooking, source);

    const deleteUpdates: Record<string, unknown> = {
        [`${basePath}/bookings/${id}`]: null,
        ...buildBookingIndexDiff(basePath, deletedBooking, null),
    };

    await trackedUpdateRootWithBookingIndexFallback(deleteUpdates, {
        operation: 'delete-booking',
        pathCount: Object.keys(deleteUpdates).length,
    });

    CACHE.bookings = CACHE.bookings.filter((booking) => booking.id !== id);
    _dataChangeCallback();

    if (deletedBooking.status === BookingStatus.CHECKED_IN) {
        _updateRoomStatus(deletedBooking.roomId, RoomStatus.VACANT_DIRTY, {
            source,
            staffId,
            suppressLog: true,
        });
    }

    _recordHistory({
        action: 'DELETE',
        entityType: 'BOOKING',
        entityId: deletedBooking.id,
        entityLabel: deletedBooking.id,
        description: `Xóa đơn ${deletedBooking.id}`,
        before: deletedBooking,
        metadata: {
            ...buildNodeMetadata('bookings', deletedBooking),
            operationName: 'Xóa booking',
        },
        source,
        staffId,
        bookingSnapshot: deletedBooking,
    });

    await _syncRoomStatusesForRooms([deletedBooking.roomId], {
        source,
        staffId,
        suppressLog: true,
    });

    return true;
};

const _deleteBookingsAtomic = async (ids: string[], staffId: string, options: BookingActionOptions = {}) => {
    const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
    if (uniqueIds.length === 0) return [] as string[];
    const source = options.source || 'WEB';

    if (!activeTenantId || !db) {
        const existingIds = uniqueIds.filter((id) => CACHE.bookings.some((booking) => booking.id === id));
        if (existingIds.length > 0) {
            _hardDeleteBookings(existingIds, staffId, options);
        }
        return existingIds;
    }

    await _assertOnlineForMutation('xóa hàng loạt');

    const basePath = getBaseRef();
    if (!basePath) return [] as string[];

    const deletedBookings = await Promise.all(uniqueIds.map((id) => _fetchBookingById(id)));
    const invalidIndex = deletedBookings.findIndex((booking) => !booking || booking.status === BookingStatus.DELETED);
    const invalidId = invalidIndex >= 0 ? uniqueIds[invalidIndex] : null;
    if (invalidId) {
        throw new Error(`Đơn ${invalidId} đã bị xóa hoặc không còn tồn tại.`);
    }

    const concreteDeletedBookings = deletedBookings.filter(Boolean) as Booking[];
    if (concreteDeletedBookings.length === 0) return [] as string[];
    concreteDeletedBookings.forEach((booking) => assertBookingMutationAllowed('delete', booking, source));

    const updates: Record<string, unknown> = {};
    concreteDeletedBookings.forEach((booking) => {
        updates[`${basePath}/bookings/${booking.id}`] = null;
        Object.assign(updates, buildBookingIndexDiff(basePath, booking, null));
    });

    await trackedUpdateRootWithBookingIndexFallback(updates, {
        operation: 'bulk-delete-bookings',
        bookingCount: concreteDeletedBookings.length,
    });

    const deletedIdSet = new Set(concreteDeletedBookings.map((booking) => booking.id));
    CACHE.bookings = CACHE.bookings.filter((booking) => !deletedIdSet.has(booking.id));
    _dataChangeCallback();

    concreteDeletedBookings.forEach((booking) => {
        if (booking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_DIRTY, {
                source,
                staffId,
                suppressLog: true,
            });
        }

        _recordHistory({
            action: 'DELETE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Xóa đơn ${booking.id}`,
            before: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Xóa booking',
            },
            source,
            staffId,
            bookingSnapshot: booking,
        });
    });

    if (concreteDeletedBookings.length > 1) {
        _recordHistory({
            action: 'BULK_DELETE',
            entityType: 'BOOKING',
            description: `Xóa hàng loạt ${concreteDeletedBookings.length} đơn đặt phòng`,
            metadata: {
                count: concreteDeletedBookings.length,
                bookingIds: concreteDeletedBookings.map((booking) => booking.id),
                operationName: 'Xóa hàng loạt booking',
            },
            source,
            staffId,
        });
    }

    await _syncRoomStatusesForRooms(
        concreteDeletedBookings.map((booking) => booking.roomId),
        { source, staffId, suppressLog: true }
    );

    return concreteDeletedBookings.map((booking) => booking.id);
};

const getRoomTypePropertyId = (roomType: RoomType) => (roomType as RoomType & { propertyId?: string }).propertyId;

const loadFullManagementCascadeDataset = async () => {
    if (!activeTenantId || !db) {
        throw new Error('Kết nối dữ liệu chưa sẵn sàng.');
    }

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không xác định được tenant hiện tại.');
    }

    const [propertySnap, roomTypeSnap, roomSnap, bookingSnap, roomPolicySnap] = await Promise.all([
        trackedGet(`${basePath}/properties`),
        trackedGet(`${basePath}/roomTypes`),
        trackedGet(`${basePath}/rooms`),
        trackedGet(`${basePath}/bookings`),
        trackedGet(`${basePath}/roomPolicies`),
    ]);

    return {
        basePath,
        properties: snapshotToArray<Property>(propertySnap).map(
            (item) => normalizeForNode('properties', item, activeTenantId) as Property
        ),
        roomTypes: snapshotToArray<RoomType>(roomTypeSnap).map(
            (item) => normalizeForNode('roomTypes', item, activeTenantId) as RoomType
        ),
        rooms: snapshotToArray<Room>(roomSnap).map(
            (item) => normalizeForNode('rooms', item, activeTenantId) as Room
        ),
        bookings: snapshotToArray<Booking>(bookingSnap).map(
            (item) => normalizeForNode('bookings', item, activeTenantId) as Booking
        ),
        roomPolicies: snapshotToArray<RoomPolicyRule>(roomPolicySnap).map(
            (item) => normalizeForNode('roomPolicies', item, activeTenantId) as RoomPolicyRule
        ),
    };
};

const buildManagementCascadeDeletePlan = async (
    kind: ManagementCascadeDeleteKind,
    targetId: string
): Promise<ManagementCascadeDeletePlan> => {
    const dataset = await loadFullManagementCascadeDataset();
    const target =
        kind === 'property'
            ? dataset.properties.find((property) => property.id === targetId)
            : kind === 'roomType'
              ? dataset.roomTypes.find((roomType) => roomType.id === targetId)
              : dataset.rooms.find((room) => room.id === targetId);

    if (!target) {
        throw new Error('Dữ liệu cần xóa không còn tồn tại. Vui lòng tải lại trang.');
    }

    const impactedRoomIds = new Set<string>();
    const impactedRoomTypeIds = new Set<string>();

    if (kind === 'property') {
        dataset.rooms
            .filter((room) => room.propertyId === targetId)
            .forEach((room) => {
                impactedRoomIds.add(room.id);
            });
        dataset.roomTypes
            .filter((roomType) => getRoomTypePropertyId(roomType) === targetId)
            .forEach((roomType) => impactedRoomTypeIds.add(roomType.id));
    }

    if (kind === 'roomType') {
        impactedRoomTypeIds.add(targetId);
        dataset.rooms
            .filter((room) => room.typeId === targetId)
            .forEach((room) => impactedRoomIds.add(room.id));
    }

    if (kind === 'room') {
        impactedRoomIds.add(targetId);
    }

    const impactedBookings = dataset.bookings.filter((booking) => {
        if (kind === 'property' && booking.propertyId === targetId) return true;
        return impactedRoomIds.has(booking.roomId);
    });

    const impactedPolicies = dataset.roomPolicies.filter((policy) => {
        const policyPropertyIds = policy.propertyIds || [];
        const policyRoomTypeIds = policy.roomTypeIds || [];
        const policyRoomIds = policy.roomIds || [];

        if (kind === 'property' && policyPropertyIds.includes(targetId)) return true;
        if (policyRoomIds.some((roomId) => impactedRoomIds.has(roomId))) return true;
        if (policyRoomTypeIds.some((roomTypeId) => impactedRoomTypeIds.has(roomTypeId))) return true;
        return false;
    });

    const impactedRooms = dataset.rooms.filter((room) => impactedRoomIds.has(room.id));
    const impactedRoomTypes = dataset.roomTypes.filter((roomType) => impactedRoomTypeIds.has(roomType.id));
    const impact: ManagementCascadeDeleteImpact = {
        kind,
        targetId,
        rooms: impactedRooms.length,
        roomTypes: impactedRoomTypes.length,
        bookings: impactedBookings.length,
        roomPolicies: impactedPolicies.length,
    };

    return {
        kind,
        targetId,
        target,
        impactedRooms,
        impactedRoomTypes,
        impactedBookings,
        impactedPolicies,
        impact,
    };
};

const getManagementCascadeDeleteImpact = async (
    kind: ManagementCascadeDeleteKind,
    targetId: string
) => (await buildManagementCascadeDeletePlan(kind, targetId)).impact;

const _cascadeDeleteManagementItem = async (
    kind: ManagementCascadeDeleteKind,
    targetId: string,
    staffId?: string,
    preparedPlan?: ManagementCascadeDeletePlan
) => {
    if (!activeTenantId || !db || !targetId) {
        throw new Error('Kết nối dữ liệu chưa sẵn sàng.');
    }

    await _assertOnlineForMutation('xóa dữ liệu cài đặt');

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không xác định được tenant hiện tại.');
    }

    const plan =
        preparedPlan && preparedPlan.kind === kind && preparedPlan.targetId === targetId
            ? preparedPlan
            : await buildManagementCascadeDeletePlan(kind, targetId);
    const { target, impactedRooms, impactedRoomTypes, impactedBookings, impactedPolicies, impact } = plan;
    const impactedRoomIds = new Set(impactedRooms.map((room) => room.id));
    const impactedRoomTypeIds = new Set(impactedRoomTypes.map((roomType) => roomType.id));

    if (kind === 'property') {
        assertNodeMutationAllowed('properties', 'delete', target);
        impactedRooms.forEach((room) => assertNodeMutationAllowed('rooms', 'delete', room));
        impactedRoomTypes.forEach((roomType) => assertNodeMutationAllowed('roomTypes', 'delete', roomType));
    }

    if (kind === 'roomType') {
        assertNodeMutationAllowed('roomTypes', 'delete', target);
        impactedRooms.forEach((room) => assertNodeMutationAllowed('rooms', 'delete', room));
    }

    if (kind === 'room') {
        assertNodeMutationAllowed('rooms', 'delete', target);
    }

    impactedBookings.forEach((booking) => assertBookingMutationAllowed('delete', booking));

    const impactedPolicyIds = new Set(impactedPolicies.map((policy) => policy.id));
    impactedPolicies.forEach((policy) => assertNodeMutationAllowed('roomPolicies', 'delete', policy));

    const updates: Record<string, unknown> = {};
    const deleteUpdateGroups = await Promise.all([
        kind === 'property'
            ? buildCollectionDeleteUpdates(`${basePath}/properties`, [targetId])
            : Promise.resolve({}),
        kind === 'roomType'
            ? buildCollectionDeleteUpdates(`${basePath}/roomTypes`, [targetId])
            : Promise.resolve({}),
        kind === 'room'
            ? buildCollectionDeleteUpdates(`${basePath}/rooms`, [targetId])
            : Promise.resolve({}),
        buildCollectionDeleteUpdates(`${basePath}/rooms`, impactedRoomIds),
        buildCollectionDeleteUpdates(`${basePath}/roomTypes`, impactedRoomTypeIds),
        buildCollectionDeleteUpdates(`${basePath}/roomPolicies`, impactedPolicyIds),
        buildCollectionDeleteUpdates(
            `${basePath}/bookings`,
            impactedBookings.map((booking) => booking.id)
        ),
    ]);
    deleteUpdateGroups.forEach((deleteUpdates) => Object.assign(updates, deleteUpdates));

    impactedBookings.forEach((booking) => {
        Object.assign(updates, buildBookingIndexDiff(basePath, booking, null));
    });
    updates[`system/tenants/${activeTenantId}/initialSeeded`] = true;

    await trackedUpdateRootWithBookingIndexFallback(updates, {
        operation: 'cascade-delete-management-item',
        kind,
        targetId,
        roomCount: impactedRoomIds.size,
        roomTypeCount: impactedRoomTypeIds.size,
        bookingCount: impactedBookings.length,
        roomPolicyCount: impactedPolicyIds.size,
    });

    CACHE.properties = kind === 'property' ? CACHE.properties.filter((property) => property.id !== targetId) : CACHE.properties;
    CACHE.roomTypes = CACHE.roomTypes.filter((roomType) => !impactedRoomTypeIds.has(roomType.id));
    CACHE.rooms = CACHE.rooms.filter((room) => !impactedRoomIds.has(room.id));
    CACHE.roomPolicies = CACHE.roomPolicies.filter((policy) => !impactedPolicyIds.has(policy.id));
    const impactedBookingIds = new Set(impactedBookings.map((booking) => booking.id));
    CACHE.bookings = CACHE.bookings.filter((booking) => !impactedBookingIds.has(booking.id));
    _dataChangeCallback();

    const config =
        kind === 'property'
            ? COLLECTION_CONFIGS.properties
            : kind === 'roomType'
              ? COLLECTION_CONFIGS.roomTypes
              : COLLECTION_CONFIGS.rooms;

    _recordHistory({
        action: 'DELETE',
        entityType: config.entityType,
        entityId: targetId,
        entityLabel: config.getLabel(target as any),
        description: `Xóa dây chuyền ${config.label} ${config.getLabel(target as any)}`,
        before: target,
        metadata: {
            ...buildNodeMetadata(kind === 'property' ? 'properties' : kind === 'roomType' ? 'roomTypes' : 'rooms', target),
            cascadeImpact: impact,
        },
        staffId,
    });

    if (impactedBookings.length > 0) {
        _recordHistory({
            action: 'BULK_DELETE',
            entityType: 'BOOKING',
            description: `Xóa dây chuyền ${impactedBookings.length} đơn liên quan tới ${config.getLabel(target as any)}`,
            metadata: {
                bookingIds: impactedBookings.map((booking) => booking.id),
                cascadeSource: { kind, targetId },
            },
            staffId,
        });
    }

    return impact;
};

const _upsertTenantUser = (user: User, mode: 'create' | 'update') => {
    if (!db) return;
    assertNodeMutationAllowed('users', 'save', user);

    const targetTenantId =
        activeTenantId && activeTenantId !== SYSTEM_TENANT_ID ? activeTenantId : user.tenantId;
    const existingUser = resolveUserById(user.id);
    const userWithTenant = normalizeUserCredentialsForStorage(
        { ...user, tenantId: targetTenantId } as User,
        existingUser
    );
    const tenantPath = getBaseRefForTenant(targetTenantId);
    if (!tenantPath) return;

    _saveItem('users', userWithTenant);

    const updates: Record<string, any> = {
        [`system/users/${user.id}`]: userWithTenant,
        [`${tenantPath}/users/${user.id}`]: userWithTenant,
    };
    trackedUpdateRoot(updates, { operation: 'save-user' });

    _recordHistory({
        tenantId: targetTenantId,
        action: mode === 'create' ? 'CREATE' : 'UPDATE',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: user.fullName || user.username || user.id,
        description:
            mode === 'create'
                ? `Tạo tài khoản ${user.fullName || user.username}`
                : `Cập nhật tài khoản ${user.fullName || user.username}`,
        before: mode === 'update' ? existingUser : null,
        after: userWithTenant,
        metadata: buildNodeMetadata('users', userWithTenant),
        coalesceKey: mode === 'update' ? `users:${user.id}:update` : undefined,
    });
};

const _deleteUser = async (id: string) => {
    if (!db) throw new Error('Không thể xóa nhân viên: Firebase chưa sẵn sàng.');
    assertNodeMutationAllowed('users', 'delete', resolveUserById(id) || { id });

    const user = resolveUserById(id);
    const targetTenantId = user?.tenantId && user.tenantId !== SYSTEM_TENANT_ID ? user.tenantId : activeTenantId;
    const updates: Record<string, any> = {
        ...(await buildCollectionDeleteUpdates('system/users', [id])),
    };

    if (targetTenantId && targetTenantId !== SYSTEM_TENANT_ID) {
        Object.assign(updates, await buildCollectionDeleteUpdates(`tenants/${targetTenantId}/users`, [id]));
    }

    await trackedUpdateRoot(updates, { operation: 'delete-user' });

    if (activeTenantId && activeTenantId !== SYSTEM_TENANT_ID) {
        CACHE.users = CACHE.users.filter((item) => item.id !== id);
        _dataChangeCallback();
    } else {
        CACHE.systemUsers = CACHE.systemUsers.filter((item) => item.id !== id);
        _dataChangeCallback();
    }

    _recordHistory({
        tenantId: targetTenantId || SYSTEM_TENANT_ID,
        action: 'DELETE',
        entityType: 'USER',
        entityId: id,
        entityLabel: user?.fullName || user?.username || id,
        description: `Xóa tài khoản ${user?.fullName || user?.username || id}`,
        before: user,
        metadata: user ? buildNodeMetadata('users', user) : null,
    });
};

const _deleteTenant = (id: string) => {
    if (!db) return;
    assertSystemAdminMutation('xóa tenant');

    const tenant = CACHE.tenants.find((item) => item.id === id);
    const updates: Record<string, any> = {
        [`system/tenants/${id}`]: null,
        [`tenants/${id}`]: null,
        [`system/users/u_${id}_admin`]: null,
    };
    trackedUpdateRoot(updates, { operation: 'delete-tenant' });

    _recordHistory({
        tenantId: SYSTEM_TENANT_ID,
        action: 'DELETE',
        entityType: 'TENANT',
        entityId: id,
        entityLabel: tenant?.name || id,
        description: `Xóa tenant ${tenant?.name || id}`,
        before: tenant,
        metadata: tenant ? buildNodeMetadata('tenants', tenant) : null,
    });
};

const _seedTenantAdminUser = (user: User) => {
    if (!db) return;
    assertSystemAdminMutation('khởi tạo admin tenant');
    const normalizedUser = normalizeUserCredentialsForStorage(user);

    const updates: Record<string, any> = {
        [`system/users/${normalizedUser.id}`]: normalizedUser,
        [`tenants/${normalizedUser.tenantId}/users/${normalizedUser.id}`]: normalizedUser,
    };
    trackedUpdateRoot(updates, { operation: 'seed-tenant-admin-user' });

    _recordHistory({
        tenantId: normalizedUser.tenantId,
        action: 'CREATE',
        entityType: 'USER',
        entityId: normalizedUser.id,
        entityLabel: normalizedUser.fullName || normalizedUser.username || normalizedUser.id,
        description: `Khởi tạo tài khoản admin ${normalizedUser.username}`,
        after: normalizedUser,
        metadata: buildNodeMetadata('users', normalizedUser),
        source: 'SYSTEM',
    });
};

const toDayStart = (date: Date) => {
    const clone = new Date(date);
    clone.setHours(0, 0, 0, 0);
    return clone;
};

const addDays = (date: Date, days: number) => {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
};

const DEFAULT_HOURLY_ONLY_MAX_STAY_HOURS = 12;

const normalizeHourlyOnlyMaxStayHours = (value?: number) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return DEFAULT_HOURLY_ONLY_MAX_STAY_HOURS;
    const roundedValue = Math.floor(numericValue);
    if (roundedValue < 1 || roundedValue > 24) return DEFAULT_HOURLY_ONLY_MAX_STAY_HOURS;
    return roundedValue;
};

const isPolicyApplicableOnDate = (policy: RoomPolicyRule, date: Date) => {
    if (!policy.isActive) return false;
    const dayMs = toDayStart(date).getTime();
    const startDateMs = policy.startDate ? toDayStart(new Date(`${policy.startDate}T00:00:00`)).getTime() : null;
    const endDateMs = policy.endDate ? toDayStart(new Date(`${policy.endDate}T00:00:00`)).getTime() : null;

    if (startDateMs !== null && dayMs < startDateMs) return false;
    if (endDateMs !== null && dayMs > endDateMs) return false;

    if (policy.recurrence === 'WEEKLY') {
        const weekdays = policy.weekdays || [];
        if (weekdays.length === 0) return false;
        return weekdays.includes(new Date(dayMs).getDay());
    }
    return true;
};

const getPolicyWindowsInRange = (policy: RoomPolicyRule, rangeStartMs: number, rangeEndMs: number) => {
    if (!policy.isActive) return [];
    const windows: Array<{ startMs: number; endMs: number }> = [];
    const lockedStartTime = getLockedPolicyStartTime(policy);
    const lockedEndTime = getLockedPolicyEndTime(policy);

    if (policy.mode === 'LOCKED' && policy.recurrence !== 'WEEKLY' && policy.endDate) {
        const startMs = getPolicyDateTimeMs(policy.startDate, lockedStartTime);
        let endMs = getPolicyDateTimeMs(policy.endDate, lockedEndTime);
        if (startMs !== null && endMs !== null) {
            if (endMs <= startMs) endMs = addDays(new Date(endMs), 1).getTime();
            if (endMs > rangeStartMs && startMs < rangeEndMs) {
                windows.push({ startMs, endMs });
            }
        }
        return windows;
    }

    let cursor = toDayStart(addDays(new Date(rangeStartMs), -2));
    const cursorEnd = toDayStart(addDays(new Date(rangeEndMs), 2)).getTime();
    let guard = 0;

    while (cursor.getTime() <= cursorEnd && guard < 2000) {
        if (isPolicyApplicableOnDate(policy, cursor)) {
            const windowStart = new Date(cursor);
            const windowEnd = addDays(new Date(cursor), 1);
            if (policy.mode === 'LOCKED') {
                const startParts = getPolicyTimeParts(lockedStartTime);
                const endParts = getPolicyTimeParts(lockedEndTime);
                windowStart.setHours(startParts.hour, startParts.minute, 0, 0);
                windowEnd.setHours(endParts.hour, endParts.minute, 0, 0);
                if (windowEnd.getTime() <= windowStart.getTime()) {
                    windowEnd.setTime(addDays(windowEnd, 1).getTime());
                }
            }

            const startMs = windowStart.getTime();
            const endMs = windowEnd.getTime();
            if (endMs > rangeStartMs && startMs < rangeEndMs) {
                windows.push({ startMs, endMs });
            }
        }
        cursor = addDays(cursor, 1);
        guard += 1;
    }

    return windows;
};

const bookingIntersectsPolicyDays = (policy: RoomPolicyRule, rangeStartMs: number, rangeEndMs: number) => {
    if (!policy.isActive || !Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) {
        return false;
    }

    let cursor = toDayStart(new Date(rangeStartMs));
    const cursorEnd = toDayStart(new Date(rangeEndMs - 1)).getTime();
    let guard = 0;

    while (cursor.getTime() <= cursorEnd && guard < 2000) {
        if (isPolicyApplicableOnDate(policy, cursor)) return true;
        cursor = addDays(cursor, 1);
        guard += 1;
    }

    return false;
};

const roomMatchesPolicy = (policy: RoomPolicyRule, room: Room) => {
    const propertyIds = policy.propertyIds || [];
    const roomTypeIds = policy.roomTypeIds || [];
    const roomIds = policy.roomIds || [];

    const matchProperty = propertyIds.length === 0 || propertyIds.includes(room.propertyId);
    const matchType = roomTypeIds.length === 0 || roomTypeIds.includes(room.typeId);
    const matchRoom = roomIds.length === 0 || roomIds.includes(room.id);
    return matchProperty && matchType && matchRoom;
};

const getPolicyTimeValue = (time: string | undefined, fallback: string) => {
    return typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : fallback;
};

const getLegacyPolicyHourTime = (hour: number | undefined, fallback: string) => {
    const numericHour = Number(hour);
    if (!Number.isFinite(numericHour)) return fallback;
    const normalizedHour = Math.max(0, Math.min(23, Math.floor(numericHour)));
    return `${String(normalizedHour).padStart(2, '0')}:00`;
};

const getLockedPolicyStartTime = (policy: RoomPolicyRule) => {
    return getPolicyTimeValue(policy.startTime, getLegacyPolicyHourTime(policy.checkInHour, '00:00'));
};

const getLockedPolicyEndTime = (policy: RoomPolicyRule) => {
    return getPolicyTimeValue(policy.endTime, getLegacyPolicyHourTime(policy.checkOutHour, '23:59'));
};

const getPolicyTimeParts = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return {
        hour: Number.isFinite(hour) ? hour : 0,
        minute: Number.isFinite(minute) ? minute : 0,
    };
};

const getPolicyDateTimeMs = (date: string | undefined, time: string) => {
    if (!date) return null;
    const ms = new Date(`${date}T${time}:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
};

const _validateRoomPolicyForRoom = (room: Room | null, roomId: string, start: string, end: string) => {
    if (!room) {
        return {
            valid: false,
            reason: `Không tìm thấy phòng ${roomId} để kiểm tra chính sách phòng. Vui lòng tải lại dữ liệu.`,
        };
    }
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { valid: true };

    const matchedPolicies = CACHE.roomPolicies.filter((policy) => roomMatchesPolicy(policy, room));

    for (const policy of matchedPolicies) {
        if (policy.mode === 'LOCKED') {
            const windows = getPolicyWindowsInRange(policy, startMs, endMs);
            if (windows.length === 0) continue;

            return {
                valid: false,
                reason: `Phòng ${room.number} đang bị khóa. ${policy.reason ? `Lý do: ${policy.reason}` : ''}`.trim(),
                policyMode: policy.mode,
            };
        }

        if (policy.mode === 'HOURLY_ONLY') {
            if (!bookingIntersectsPolicyDays(policy, startMs, endMs)) continue;

            const maxStayHours = normalizeHourlyOnlyMaxStayHours(policy.maxStayHours);
            const durationHours = (endMs - startMs) / (1000 * 60 * 60);
            if (durationHours <= maxStayHours) continue;

            return {
                valid: false,
                reason: `Phòng ${room.number} chỉ nhận khách giờ, tổng thời gian lưu trú không được vượt quá ${maxStayHours} tiếng.`,
                policyMode: policy.mode,
            };
        }
    }

    return { valid: true };
};

const _validateRoomPolicy = (roomId: string, start: string, end: string) => {
    const room = CACHE.rooms.find((item) => item.id === roomId) || null;
    return _validateRoomPolicyForRoom(room, roomId, start, end);
};

const _validateRoomPolicyRemote = async (roomId: string, start: string, end: string) => {
    let room = CACHE.rooms.find((item) => item.id === roomId) || null;
    if (!room) {
        room = await _fetchRoomByIdRemote(roomId);
        if (room) {
            CACHE.rooms = [...CACHE.rooms.filter((item) => item.id !== room!.id), room];
        }
    }
    return _validateRoomPolicyForRoom(room, roomId, start, end);
};

const isExpiredHoldBooking = (booking: Booking, nowMs: number = Date.now()) => {
    if (!booking?.isHold || !booking.holdUntil) return false;
    const holdUntilMs = new Date(booking.holdUntil).getTime();
    if (!Number.isFinite(holdUntilMs)) return false;
    return holdUntilMs <= nowMs;
};

const toDateKey = (input: string | Date) => {
    const date = typeof input === 'string' ? new Date(input) : input;
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getDateKeysBetween = (startInput: string | Date, endInput: string | Date) => {
    const startDate = typeof startInput === 'string' ? new Date(startInput) : new Date(startInput);
    const endDate = typeof endInput === 'string' ? new Date(endInput) : new Date(endInput);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return [] as string[];

    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);

    const exclusiveEnd = new Date(endDate.getTime() - 1);
    if (isNaN(exclusiveEnd.getTime())) return [] as string[];
    exclusiveEnd.setHours(0, 0, 0, 0);

    const keys: string[] = [];
    while (cursor.getTime() <= exclusiveEnd.getTime()) {
        keys.push(toDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return keys;
};

const getBookingExpenseFeeTotal = (booking: Pick<Booking, 'extraFees'> | any) =>
    (booking.extraFees || [])
        .filter((fee: any) => fee?.type === 'EXPENSE')
        .reduce((sum: number, fee: any) => sum + (Number(fee.amount) || 0), 0);

const normalizeBookingTagIds = (value: any) => {
    if (!Array.isArray(value)) return [] as string[];
    return value
        .map((tag) => typeof tag === 'string' ? tag : tag?.id)
        .filter((tagId): tagId is string => typeof tagId === 'string' && tagId.trim().length > 0);
};

const buildBookingIndexSummary = (booking: Booking): BookingIndexSummary => ({
    id: booking.id,
    tenantId: booking.tenantId || activeTenantId || undefined,
    propertyId: booking.propertyId,
    roomId: booking.roomId,
    customerId: booking.customerId || 'c_guest',
    guestName: booking.guestName || '',
    guestPhone: booking.guestPhone || '',
    groupId: booking.groupId || null,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    status: getPersistedBookingStatus(booking) || booking.status,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt || booking.createdAt,
    createdBy: booking.createdBy,
    bookingCategory: booking.bookingCategory || '',
    bookingSource: booking.bookingSource || '',
    isHold: !!booking.isHold || booking.status === BookingStatus.HOLD,
    holdUntil: booking.holdUntil || null,
    totalPrice: Number(booking.totalPrice) || 0,
    paidAmount: Number(booking.paidAmount) || 0,
    tags: normalizeBookingTagIds(booking.tags),
    hasNotes: !!String(booking.notes || '').trim(),
    expenseFeeTotal: getBookingExpenseFeeTotal(booking),
});

const normalizeBookingIndexRecord = (record: any): Booking | null => {
    if (!record || typeof record !== 'object') return null;

    const tags = normalizeBookingTagIds(record.tags?.length ? record.tags : record.tagIds);
    const expenseFeeTotal = Number(record.expenseFeeTotal) || getBookingExpenseFeeTotal(record);
    const hasNotes = typeof record.hasNotes === 'boolean'
        ? record.hasNotes
        : !!String(record.notes || '').trim();

    const booking = {
        ...record,
        customerId: record.customerId || 'c_guest',
        guestName: record.guestName || '',
        guestPhone: record.guestPhone || '',
        bookingCategory: record.bookingCategory || '',
        bookingSource: record.bookingSource || '',
        groupId: record.groupId || undefined,
        status: record.status || BookingStatus.CONFIRMED,
        totalPrice: Number(record.totalPrice) || 0,
        paidAmount: Number(record.paidAmount) || 0,
        tags,
        hasNotes,
        expenseFeeTotal,
        notes: typeof record.notes === 'string' ? record.notes : '',
        extraFees: Array.isArray(record.extraFees) ? record.extraFees : [],
    };

    return normalizeForNode('bookings', booking, activeTenantId) as Booking;
};

const buildBookingIndexDiff = (basePath: string, previousBooking: Booking | null, nextBooking: Booking | null) => {
    const updates: Record<string, unknown> = {};
    const previousPaths = new Set<string>();

    if (previousBooking) {
        getDateKeysBetween(previousBooking.checkInDate, previousBooking.checkOutDate).forEach((dateKey) => {
            previousPaths.add(
                `${basePath}/${BOOKING_INDEX_NODE}/${previousBooking.propertyId}/${dateKey}/${previousBooking.id}`
            );
        });
    }

    previousPaths.forEach((path) => {
        updates[path] = null;
    });

    if (nextBooking) {
        const summary = buildBookingIndexSummary(nextBooking);
        getDateKeysBetween(nextBooking.checkInDate, nextBooking.checkOutDate).forEach((dateKey) => {
            updates[`${basePath}/${BOOKING_INDEX_NODE}/${nextBooking.propertyId}/${dateKey}/${nextBooking.id}`] = summary;
        });
    }

    return updates;
};

const isBookingActiveForConflict = (booking: Booking, nowMs: number = Date.now()) => {
    if (booking.status === BookingStatus.DELETED) return false;
    if (isExpiredHoldBooking(booking, nowMs)) return false;
    return true;
};

const toBookingListFromMap = (rawValue: any): Booking[] => {
    if (!rawValue || typeof rawValue !== 'object') return [];
    return Object.entries(rawValue).reduce<Booking[]>((acc, [key, value]) => {
        if (!value || typeof value !== 'object') return acc;
        const booking = normalizeForNode('bookings', value, activeTenantId) as Booking;
        acc.push({ ...booking, id: booking.id || key });
        return acc;
    }, []);
};

const findBookingConflict = (
    bookings: Booking[],
    roomId: string,
    startMs: number,
    endMs: number,
    excludeId?: string
) => {
    const buffer = 30 * 60 * 1000;
    const nowMs = Date.now();
    return bookings.find((booking) => {
        if (booking.id === excludeId) return false;
        if (booking.roomId !== roomId) return false;
        if (!isBookingActiveForConflict(booking, nowMs)) return false;

        const bookingStart = new Date(booking.checkInDate).getTime();
        const bookingEnd = new Date(booking.checkOutDate).getTime();
        return startMs < bookingEnd + buffer && endMs + buffer > bookingStart;
    });
};

const _cleanupExpiredHoldBookings = async (options: BookingActionOptions = {}) => {
    const nowMs = Date.now();
    const expiredInCache = CACHE.bookings.filter((booking) => isExpiredHoldBooking(booking, nowMs));
    if (expiredInCache.length === 0) return 0;

    const source = options.source || 'SYSTEM';

    if (!activeTenantId || !db) {
        const expiredIds = new Set(expiredInCache.map((booking) => booking.id));
        CACHE.bookings = CACHE.bookings.filter((booking) => !expiredIds.has(booking.id));
        _dataChangeCallback();
        expiredInCache.forEach((booking) => {
            _recordHistory({
                action: 'DELETE',
                entityType: 'BOOKING',
                entityId: booking.id,
                entityLabel: booking.id,
                description: `Hết hạn giữ cọc, tự động xoá đơn ${booking.id}`,
                before: booking,
                metadata: {
                    ...buildNodeMetadata('bookings', booking),
                    operationName: 'Tự động xóa giữ cọc hết hạn',
                },
                source,
                staffId: options.staffId,
                bookingSnapshot: booking,
            });
        });
        return expiredInCache.length;
    }

    const basePath = getBaseRef();
    if (!basePath) return 0;

    const deletedBookings = CACHE.bookings.filter((booking) => isExpiredHoldBooking(booking, nowMs));
    if (deletedBookings.length === 0) return 0;

    const updates: Record<string, unknown> = {};
    deletedBookings.forEach((booking) => {
        updates[`${basePath}/bookings/${booking.id}`] = null;
        Object.assign(updates, buildBookingIndexDiff(basePath, booking, null));
    });

    await trackedUpdateRootWithBookingIndexFallback(updates, {
        operation: 'cleanup-expired-holds',
        bookingCount: deletedBookings.length,
    });

    const deletedIds = new Set(deletedBookings.map((booking) => booking.id));
    CACHE.bookings = CACHE.bookings.filter((booking) => !deletedIds.has(booking.id));
    _dataChangeCallback();

    deletedBookings.forEach((booking) => {
        _recordHistory({
            action: 'DELETE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Hết hạn giữ cọc, tự động xoá đơn ${booking.id}`,
            before: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Tự động xóa giữ cọc hết hạn',
            },
            source,
            staffId: options.staffId,
            bookingSnapshot: booking,
        });
    });

    return deletedBookings.length;
};

const _saveBookingAtomic = async (
    booking: Booking,
    mode: 'create' | 'update',
    options: BookingActionOptions = {}
) => {
    if (!booking?.id) throw new Error('Booking không hợp lệ');

    const normalizedBooking = removeUndefinedDeep(normalizeForNode('bookings', booking, activeTenantId));
    if (!normalizedBooking?.id) throw new Error('Booking không hợp lệ');
    assertBookingMutationAllowed(mode, normalizedBooking as Booking, options.source);

    const missingUpdateMessage = `Đơn ${normalizedBooking.id} đã bị xóa hoặc không còn tồn tại. Vui lòng tải lại dữ liệu.`;

    if (!activeTenantId || !db) {
        const existing = CACHE.bookings.find((item) => item.id === normalizedBooking.id) || null;
        if (mode === 'update') {
            if (!existing || existing.status === BookingStatus.DELETED) {
                throw new Error(missingUpdateMessage);
            }
        }
        _saveItem('bookings', normalizedBooking);
        return {
            savedBooking: normalizedBooking as Booking,
            previousBooking: existing,
        };
    }

    const basePath = getBaseRef();
    if (!basePath) {
        const existing = CACHE.bookings.find((item) => item.id === normalizedBooking.id) || null;
        if (mode === 'update') {
            if (!existing || existing.status === BookingStatus.DELETED) {
                throw new Error(missingUpdateMessage);
            }
        }
        _saveItem('bookings', normalizedBooking);
        return {
            savedBooking: normalizedBooking as Booking,
            previousBooking: existing,
        };
    }

    const startMs = new Date(normalizedBooking.checkInDate).getTime();
    const endMs = new Date(normalizedBooking.checkOutDate).getTime();
    const cachedPreviousBooking = CACHE.bookings.find((item) => item.id === normalizedBooking.id) || null;
    const remotePreviousBooking = await _fetchBookingByIdRemote(normalizedBooking.id);
    const previousBookingFromCommittedTxn = remotePreviousBooking || cachedPreviousBooking;

    if (mode === 'create' && previousBookingFromCommittedTxn) {
        throw new Error(`Mã đơn ${normalizedBooking.id} đã tồn tại`);
    }

    if (mode === 'update' && (!previousBookingFromCommittedTxn || previousBookingFromCommittedTxn.status === BookingStatus.DELETED)) {
        throw new Error(missingUpdateMessage);
    }
    if (mode === 'update' && previousBookingFromCommittedTxn) {
        assertBookingMutationAllowed('update', previousBookingFromCommittedTxn, options.source);
    }

    const scheduleChanged =
        mode === 'create' ||
        !previousBookingFromCommittedTxn ||
        previousBookingFromCommittedTxn.roomId !== normalizedBooking.roomId ||
        previousBookingFromCommittedTxn.checkInDate !== normalizedBooking.checkInDate ||
        previousBookingFromCommittedTxn.checkOutDate !== normalizedBooking.checkOutDate;

    if (scheduleChanged) {
        await _refreshRoomPoliciesRemote();
        const policyCheck = await _validateRoomPolicyRemote(
            normalizedBooking.roomId,
            normalizedBooking.checkInDate,
            normalizedBooking.checkOutDate
        );
        if (!policyCheck.valid) {
            throw new Error(policyCheck.reason || 'Vi phạm chính sách phòng');
        }

        const propertyBookings = await _fetchBookingsEndingAfter([normalizedBooking.propertyId], startMs);
        const conflict = findBookingConflict(
            propertyBookings,
            normalizedBooking.roomId,
            startMs,
            endMs,
            mode === 'update' ? normalizedBooking.id : undefined
        );
        if (conflict) {
            throw new Error(`Trùng đơn ${conflict.id}`);
        }
    }

    const updates: Record<string, unknown> = {
        [`${basePath}/bookings/${normalizedBooking.id}`]: normalizedBooking,
        ...buildBookingIndexDiff(basePath, previousBookingFromCommittedTxn, normalizedBooking as Booking),
    };

    await trackedUpdateRootWithBookingIndexFallback(updates, {
        operation: mode === 'create' ? 'create-booking' : 'update-booking',
        pathCount: Object.keys(updates).length,
    });

    const cacheIndex = CACHE.bookings.findIndex((item) => item.id === normalizedBooking.id);
    if (cacheIndex > -1) CACHE.bookings[cacheIndex] = normalizedBooking as Booking;
    else CACHE.bookings.push(normalizedBooking as Booking);
    _dataChangeCallback();

    return {
        savedBooking: normalizedBooking as Booking,
        previousBooking: previousBookingFromCommittedTxn,
    };
};

const _validateRoomAvailability = (roomId: string, start: string, end: string, excludeId?: string) => {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    const policyCheck = _validateRoomPolicy(roomId, start, end);
    if (!policyCheck.valid) {
        return {
            valid: false,
            reason: policyCheck.reason || 'Vi phạm chính sách phòng',
            policyMode: (policyCheck as any).policyMode,
        };
    }

    const activeBookings = CACHE.bookings.filter((booking) => isBookingActiveForConflict(booking));

    const conflict = findBookingConflict(activeBookings, roomId, startMs, endMs, excludeId);

    return conflict ? { valid: false, reason: `Trùng đơn ${conflict.id}` } : { valid: true };
};

const sortBookingCatalogItems = (list: BookingCatalogItem[]) =>
    [...list].sort((a, b) => {
        const orderA = Number.isFinite(a.sortOrder) ? Number(a.sortOrder) : 0;
        const orderB = Number.isFinite(b.sortOrder) ? Number(b.sortOrder) : 0;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '', 'vi', { numeric: true });
    });

const getBookingCatalogList = (list: BookingCatalogItem[], fallback: BookingCatalogItem[]) => {
    const source = list.length > 0 ? list : fallback;
    return sortBookingCatalogItems(source).map(item => ({
        ...item,
        tenantId: activeTenantId && activeTenantId !== SYSTEM_TENANT_ID ? item.tenantId || activeTenantId : item.tenantId,
        isActive: item.isActive !== false,
    }));
};

export const DataService = {
    init: _initRealtimeConnection,
    clearSessionCache: () => _clearSessionCache(),

    setAuditActor: (user: User | null) => {
        currentAuditActor = user
            ? {
                  id: user.id,
                  username: user.username,
                  fullName: user.fullName,
                  role: user.role,
                  tenantId: user.tenantId,
                  permissions: user.permissions || [],
                  allowedPropertyIds: user.allowedPropertyIds || [],
              }
            : null;
    },

    recordLogin: (user: User) => {
        const tenantId = user.role === UserRole.SUPER_ADMIN ? SYSTEM_TENANT_ID : user.tenantId;
        _recordHistory({
            tenantId,
            action: 'LOGIN',
            entityType: 'AUTH',
            entityId: user.id,
            entityLabel: user.fullName || user.username,
            description: `${user.fullName || user.username} đăng nhập hệ thống`,
            metadata: {
                username: user.username,
                role: user.role,
            },
            actor: {
                id: user.id,
                username: user.username,
                fullName: user.fullName,
                role: user.role,
                tenantId,
                permissions: user.permissions || [],
                allowedPropertyIds: user.allowedPropertyIds || [],
            },
        });
    },

    recordLogout: (user: User, tenantIdOverride?: string | null) => {
        const tenantId =
            tenantIdOverride || (user.role === UserRole.SUPER_ADMIN ? SYSTEM_TENANT_ID : user.tenantId);
        _recordHistory({
            tenantId,
            action: 'LOGOUT',
            entityType: 'AUTH',
            entityId: user.id,
            entityLabel: user.fullName || user.username,
            description: `${user.fullName || user.username} đăng xuất`,
            metadata: {
                username: user.username,
                role: user.role,
            },
            actor: {
                id: user.id,
                username: user.username,
                fullName: user.fullName,
                role: user.role,
                tenantId: tenantId || undefined,
                permissions: user.permissions || [],
                allowedPropertyIds: user.allowedPropertyIds || [],
            },
        });
    },

    recordHistoryEvent: ({
        action,
        entityType,
        description,
        metadata,
        source,
        entityId,
        entityLabel,
        staffId,
        tenantId,
    }: {
        action: HistoryAction | string;
        entityType?: HistoryEntityType | string;
        description: string;
        metadata?: Record<string, any>;
        source?: AuditSource;
        entityId?: string;
        entityLabel?: string;
        staffId?: string;
        tenantId?: string;
    }) =>
        _recordHistory({
            tenantId,
            action,
            entityType,
            entityId,
            entityLabel,
            description,
            metadata,
            source,
            staffId,
        }),

    login: async (username: string, password: string) => {
        _ensureFirebase();

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return { user: null as User | null, reason: 'CONNECTION_ERROR' as const };
        }

        if (!db) {
            return { user: null as User | null, reason: 'CONNECTION_ERROR' as const };
        }

        try {
            const connectionState = await _resolveRealtimeConnectionState();
            if (connectionState === 'DISCONNECTED') {
                return { user: null as User | null, reason: 'CONNECTION_ERROR' as const };
            }

            const snap = await Promise.race([
                trackedGet('system/users'),
                new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), CONNECTION_PREFLIGHT_TIMEOUT_MS + 1000)
                ),
            ]);
            if (!snap) {
                return { user: null as User | null, reason: 'CONNECTION_ERROR' as const };
            }
            if (snap.exists()) {
                const users = snapshotToArray<User>(snap);
                const found = _findUserByCredential(users, username, password);
                if (found) {
                    if (!found.passwordHash && found.password) {
                        const migratedUser = normalizeUserCredentialsForStorage(found, found);
                        const updates: Record<string, any> = {
                            [`system/users/${migratedUser.id}`]: migratedUser,
                        };
                        if (migratedUser.tenantId && migratedUser.tenantId !== SYSTEM_TENANT_ID) {
                            updates[`tenants/${migratedUser.tenantId}/users/${migratedUser.id}`] = migratedUser;
                        }
                        trackedUpdateRoot(updates, { operation: 'migrate-user-credential' }).catch((error: any) => {
                            console.error('Migrate user credential failed', error);
                        });
                        return { user: migratedUser, reason: null as null };
                    }
                    return { user: found, reason: null as null };
                }
            }

            // Legacy accounts can be absent from system/users. Read only the
            // small user directories, never the tenant trees (bookings + audit logs).
            const directories = await withReadDeadline((async () => {
                const tenantDirectory = await trackedGet('system/tenants');
                const tenantIds = Object.keys(tenantDirectory.val() || {});
                return Promise.all(tenantIds.map(async (tenantId) => {
                    const userSnap = await trackedGet(`tenants/${tenantId}/users`);
                    return snapshotToArray<User>(userSnap).map(user => ({ ...user, tenantId }));
                }));
            })(), 8000);
            const matchedTenantUser = _findUserByCredential(directories.flat(), username, password);
            if (matchedTenantUser) {
                const normalizedUser = normalizeUserCredentialsForStorage(matchedTenantUser, matchedTenantUser);
                const updates: Record<string, any> = {
                    [`system/users/${normalizedUser.id}`]: normalizedUser,
                    [`tenants/${normalizedUser.tenantId}/users/${normalizedUser.id}`]: normalizedUser,
                };
                trackedUpdateRoot(updates, { operation: 'self-heal-user-index' }).catch((error: any) => {
                    console.error('Self-heal user index failed', error);
                });
                return { user: normalizedUser, reason: null as null };
            }

        } catch (error) {
            console.error('Login error', error);
            return { user: null as User | null, reason: 'CONNECTION_ERROR' as const };
        }

        return { user: null as User | null, reason: 'INVALID_CREDENTIALS' as const };
    },

    findUserByUsername: async (username: string) => {
        return (
            CACHE.systemUsers.find((user) => user.username === username) ||
            CACHE.users.find((user) => user.username === username) ||
            null
        );
    },

    getTenants: () => CACHE.tenants,
    getPlans: () => CACHE.plans,
    getSystemUsers: () => CACHE.systemUsers,
    getProperties: () => [...CACHE.properties].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    getRoomTypes: () => [...CACHE.roomTypes].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    loadRoomsForProperties: (propertyIds?: string[]) => _loadRoomsForProperties(propertyIds),
    loadRoomsForPropertiesView: (propertyIds?: string[]) => _loadRoomsForPropertiesView(propertyIds),
    subscribeRoomsForProperties: (
        propertyIds: string[] | undefined,
        callback: (rows: Room[]) => void,
        errorCallback?: (error: unknown) => void
    ) => _subscribeRoomsForProperties(propertyIds, callback, errorCallback),
    subscribeRoomsForPropertiesView: (
        propertyIds: string[] | undefined,
        callback: (rows: Room[]) => void,
        errorCallback?: (error: unknown) => void
    ) => _subscribeRoomsForPropertiesView(propertyIds, callback, errorCallback),
    getRooms: (propertyId?: string) => {
        let rooms = [...CACHE.rooms];
        if (propertyId) rooms = rooms.filter((room) => room.propertyId === propertyId);
        return rooms.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },
    getRoomPolicies: () => CACHE.roomPolicies,
    loadBookingsForProperties: (propertyIds?: string[]) => _loadBookingsForProperties(propertyIds),
    loadBookingsForPropertiesView: (propertyIds?: string[]) => _loadBookingsForPropertiesView(propertyIds),
    subscribeBookingsForProperties: (
        propertyIds: string[] | undefined,
        callback: (rows: Booking[]) => void,
        errorCallback?: (error: unknown) => void
    ) => _subscribeBookingsForProperties(propertyIds, callback, errorCallback),
    subscribeBookingsForPropertiesView: (
        propertyIds: string[] | undefined,
        callback: (rows: Booking[]) => void,
        errorCallback?: (error: unknown) => void
    ) => _subscribeBookingsForPropertiesView(propertyIds, callback, errorCallback),
    subscribeRoomStateBookings: _subscribeRoomStateBookings,
    fetchBookingsEndingAfter: _fetchBookingsEndingAfter,
    fetchOperationalBookings: (propertyId: string, start: string, end: string, paddingDays?: number) =>
        _fetchOperationalBookings(propertyId, start, end, paddingDays),
    fetchOperationalBookingsForProperties: (propertyIds: string[] | undefined, start: string, end: string, paddingDays?: number) =>
        _fetchOperationalBookingsForProperties(propertyIds, start, end, paddingDays),
    fetchDashboardBookingsForProperties: (propertyIds: string[] | undefined, start: string, end: string, paddingDays?: number) =>
        _fetchDashboardBookingsForProperties(propertyIds, start, end, paddingDays),
    fetchReportBookingsForProperties: (propertyIds: string[] | undefined, start: string, end: string) =>
        _fetchReportBookingsForProperties(propertyIds, start, end),
    subscribeOperationalBookings: (
        propertyIds: string[] | undefined,
        start: string,
        end: string,
        callback: (rows: Booking[]) => void,
        errorCallback?: (error: unknown) => void,
        paddingDays?: number
    ) => _subscribeOperationalBookings(propertyIds, start, end, callback, errorCallback, paddingDays),
    fetchBookingById: (bookingId: string, options?: { forceRemote?: boolean }) => _fetchBookingById(bookingId, options),
    getBookings: (propertyId?: string) => {
        const nowMs = Date.now();
        if (nowMs - lastHoldCleanupAttemptMs > HOLD_CLEANUP_THROTTLE_MS) {
            lastHoldCleanupAttemptMs = nowMs;
            _cleanupExpiredHoldBookings({ source: 'SYSTEM' }).catch((error: any) => {
                console.error('Cleanup expired hold bookings failed', error);
            });
        }

        let bookings = CACHE.bookings.filter(
            (booking) => booking.status !== BookingStatus.DELETED && !isExpiredHoldBooking(booking, nowMs)
        ).map((booking) => {
            const derivedStatus = deriveBookingStatus(booking, nowMs);
            return booking.status === derivedStatus ? booking : { ...booking, status: derivedStatus };
        });
        if (propertyId) bookings = bookings.filter((booking) => booking.propertyId === propertyId);
        return bookings;
    },
    getCustomers: () => CACHE.customers,
    getUsers: () => CACHE.users,
    getTags: () => CACHE.tags,
    getTransactionCategories: () => CACHE.transactionCategories,
    getBookingCategories: () => getBookingCatalogList(CACHE.bookingCategories, INITIAL_BOOKING_CATEGORIES),
    getBookingSources: () => getBookingCatalogList(CACHE.bookingSources, INITIAL_BOOKING_SOURCES),
    getBookingFieldSettings: () => normalizeBookingFieldSettings(CACHE.bookingFieldSettings),
    getNotificationSettings: () => normalizeNotificationSettings(CACHE.notificationSettings),
    getHistory: () => CACHE.history,
    fetchRecentHistory: (limit?: number, tenantId?: string | null) => _fetchRecentHistory(limit, tenantId),
    fetchBookingHistory: (params: BookingHistoryQueryParams) => _fetchBookingHistory(params),
    validateRoomAvailabilityRemote: (
        propertyId: string,
        roomId: string,
        start: string,
        end: string,
        excludeId?: string
    ) => _validateRoomAvailabilityRemote(propertyId, roomId, start, end, excludeId),
    hasOperationalStatusDrift: () => _hasOperationalStatusDrift(),
    syncOperationalStatuses: (options?: BookingActionOptions) => _syncOperationalStatuses(options),

    saveTenants: (list: Tenant[]) => _saveAuditedList('tenants', list),
    deleteTenant: _deleteTenant,

    savePlans: (list: SubscriptionPlan[]) => _saveAuditedList('plans', list),
    seedTenantAdminUser: _seedTenantAdminUser,

    saveProperties: (list: Property[]) => _saveAuditedList('properties', list),
    saveRooms: (list: Room[]) => _saveAuditedList('rooms', list),
    saveRoomPolicies: (list: RoomPolicyRule[]) => _saveAuditedList('roomPolicies', list),
    saveRoomTypes: (list: RoomType[]) => _saveAuditedList('roomTypes', list),
    saveTags: (list: Tag[]) => _saveAuditedList('tags', list),
    saveTransactionCategories: (list: TransactionCategory[]) => _saveAuditedList('transactionCategories', list),
    saveBookingCategories: (list: BookingCatalogItem[]) => _saveAuditedList('bookingCategories', list),
    saveBookingSources: (list: BookingCatalogItem[]) => _saveAuditedList('bookingSources', list),
    saveBookingFieldSettings: (settings: BookingFieldSettings) => _saveBookingFieldSettings(settings),
    saveNotificationSettings: (settings: NotificationSettings) => _saveNotificationSettings(settings),

    updateRoomStatus: _updateRoomStatus,
    addBooking: _addBooking,
    updateBooking: _updateBooking,
    deleteBooking: _deleteBooking,
    saveBookingGroup: _saveBookingGroupAtomic,
    deleteBookings: _deleteBookingsAtomic,
    saveBookings: (list: Booking[]) => _saveAuditedList('bookings', list),
    resetAllBookings: _resetAllBookings,

    addCustomer: (customer: Customer) => {
        _saveItem('customers', customer);
        _recordHistory({
            action: 'CREATE',
            entityType: 'CUSTOMER',
            entityId: customer.id,
            entityLabel: customer.name || customer.id,
            description: `Tạo khách hàng ${customer.name}`,
            after: customer,
            metadata: buildNodeMetadata('customers', customer),
        });
    },

    addUser: (user: User) => _upsertTenantUser(user, 'create'),
    updateUser: (user: User) => _upsertTenantUser(user, 'update'),
    deleteUser: _deleteUser,

    deleteItems: async (node: string, ids: string[]) => {
        const auditedNode = node as AuditedNode;
        const config = COLLECTION_CONFIGS[auditedNode];

        if (!config) {
            await _deleteItems(node, ids);
            return;
        }

        const previousList = cloneData(
            // @ts-ignore
            CACHE[auditedNode as keyof typeof CACHE] || []
        ) as any[];
        const removedItems = previousList.filter((item) => ids.includes(item.id));

        await _deleteItems(node, ids);

        removedItems.forEach((item) => {
            _recordHistory({
                action: 'DELETE',
                entityType: config.entityType,
                entityId: item.id,
                entityLabel: config.getLabel(item),
                description: `Xóa ${config.label} ${config.getLabel(item)}`,
                before: item,
                metadata: buildNodeMetadata(auditedNode, item),
            });
        });
    },
    getManagementCascadeDeleteImpact: (
        kind: ManagementCascadeDeleteKind,
        targetId: string
    ) => getManagementCascadeDeleteImpact(kind, targetId),
    prepareManagementCascadeDelete: (
        kind: ManagementCascadeDeleteKind,
        targetId: string
    ) => buildManagementCascadeDeletePlan(kind, targetId),
    cascadeDeleteManagementItem: (
        kind: ManagementCascadeDeleteKind,
        targetId: string,
        staffId?: string,
        preparedPlan?: ManagementCascadeDeletePlan
    ) => _cascadeDeleteManagementItem(kind, targetId, staffId, preparedPlan),

    deleteBookingsByBatchId: async (batchId: string, staffId: string) => {
        const toDelete = CACHE.bookings.filter((booking) => booking.importBatchId === batchId);
        if (toDelete.length === 0) return 0;

        const ids = toDelete.map((booking) => booking.id);
        const deletedIds = await _deleteBookingsAtomic(ids, staffId, { source: 'IMPORT', staffId });
        if (deletedIds.length === 0) return 0;

        _recordHistory({
            action: 'BULK_DELETE',
            entityType: 'BOOKING',
            description: `Hoàn tác import batch ${batchId} (${deletedIds.length} đơn)`,
            metadata: {
                batchId,
                count: deletedIds.length,
                bookingIds: deletedIds,
            },
            staffId,
        });
        return deletedIds.length;
    },

    logAction: _logAction,

    generateBookingId: () => {
        const now = new Date();
        const seq = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0');
        return `${now.getFullYear().toString().slice(-2)}${(now.getMonth() + 1)
            .toString()
            .padStart(2, '0')}-${seq}`;
    },

    validateRoomAvailability: (roomId: string, start: string, end: string, excludeId?: string) => {
        return _validateRoomAvailability(roomId, start, end, excludeId);
    },
    cleanupExpiredHoldBookings: (options?: BookingActionOptions) => _cleanupExpiredHoldBookings(options),

    exportToExcel: (data: any[], fileName: string, auditMetadata?: Record<string, any>) => {
        if (typeof XLSX === 'undefined') return alert('Thư viện Excel chưa tải xong');

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, fileName);

        _recordHistory({
            action: 'EXPORT',
            entityType: 'REPORT',
            description: `Xuất file ${fileName}`,
            metadata: {
                fileName,
                rowCount: data.length,
                ...auditMetadata,
            },
        });
    },
};
