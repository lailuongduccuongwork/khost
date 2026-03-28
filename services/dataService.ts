import {
    Booking,
    BookingStatus,
    Customer,
    HistoryAction,
    HistoryEntityType,
    HistoryLog,
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
} from '../types';
import {
    INITIAL_BOOKINGS,
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
import { initializeApp } from 'firebase/app';
import { getDatabase, get, onValue, ref, remove, runTransaction, set, update } from 'firebase/database';

declare const XLSX: any;

const firebaseConfig = {
    apiKey: "AIzaSyAZOB79Cz0Lj-zrRGmcackL0A3bsRBEwSc",
    authDomain: "k-host-a2a95.firebaseapp.com",
    databaseURL: "https://k-host-a2a95-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "k-host-a2a95",
    storageBucket: "k-host-a2a95.firebasestorage.app",
    messagingSenderId: "875551915320",
    appId: "1:875551915320:web:9516f334551de0a96495cd",
    measurementId: "G-QZPYL00KCV",
};

let db: any = null;
let isFirebaseReady = false;

let activeTenantId: string | null = null;
const SYSTEM_TENANT_ID = 'SYSTEM';
const AUDIT_COALESCE_WINDOW_MS = 1500;

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
    tenants: [] as Tenant[],
    plans: [] as SubscriptionPlan[],
    systemUsers: [] as User[],
};

let _dataChangeCallback: () => void = () => {};
let realtimeConnectionState: 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' = 'UNKNOWN';
let disconnectRealtimeConnectionWatcher: (() => void) | null = null;
const CONNECTION_PREFLIGHT_TIMEOUT_MS = 2000;

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
    | 'tenants'
    | 'plans';

interface AuditActor {
    id: string;
    username?: string;
    fullName?: string;
    role?: UserRole | 'SYSTEM';
    tenantId?: string;
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

interface RoomStatusOptions {
    reason?: string;
    source?: AuditSource;
    staffId?: string;
    suppressLog?: boolean;
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

let currentAuditActor: AuditActor | null = null;
const recentAuditEntries = new Map<string, { id: string; timestamp: number }>();
const HOLD_CLEANUP_THROTTLE_MS = 10000;
let lastHoldCleanupAttemptMs = 0;

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
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            isFirebaseReady = true;
            if (!disconnectRealtimeConnectionWatcher) {
                const connectedRef = ref(db, '.info/connected');
                disconnectRealtimeConnectionWatcher = onValue(
                    connectedRef,
                    (snap) => {
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
            get(ref(db, '.info/connected')),
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
        return set(ref(db, `${historyPath}/${targetId}`), finalEntry).catch((error: any) => {
            console.error('Write history failed', error);
        });
    } catch (error) {
        console.error('Write history failed', error);
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

    return _writeHistoryLog(entry, coalesceKey);
};

const _bindHistory = (basePath: string) => {
    onValue(ref(db, `${basePath}/history`), (snap) => {
        CACHE.history = snapshotToArray<HistoryLog>(snap).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        _dataChangeCallback();
    });
};

const _initRealtimeConnection = (tenantId: string, onDataChange: () => void) => {
    try {
        activeTenantId = tenantId;
        _dataChangeCallback = onDataChange;

        if (!_ensureFirebase()) return;

        const basePath = getBaseRef();
        if (!basePath) return;

        const bind = <T extends { id?: string; number?: string; name?: string }>(
            node: string,
            cacheKey: keyof typeof CACHE
        ) => {
            const nodeRef = ref(db, `${basePath}/${node}`);
            onValue(nodeRef, (snap) => {
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
        };

        if (tenantId === SYSTEM_TENANT_ID) {
            bind<Tenant>('tenants', 'tenants');
            bind<SubscriptionPlan>('plans', 'plans');
            bind<User>('users', 'systemUsers');
            _bindHistory(basePath);

            get(ref(db, 'system/tenants')).then((snap) => {
                if (!snap.exists() || snap.size === 0) _seedSystemData();
            });
            return;
        }

        bind<Property>('properties', 'properties');
        bind<RoomType>('roomTypes', 'roomTypes');
        bind<Tag>('tags', 'tags');
        bind<TransactionCategory>('transactionCategories', 'transactionCategories');
        bind<Room>('rooms', 'rooms');
        bind<RoomPolicyRule>('roomPolicies', 'roomPolicies');
        bind<Booking>('bookings', 'bookings');
        bind<Customer>('customers', 'customers');
        _bindHistory(basePath);

        onValue(ref(db, `${basePath}/users`), async (snap) => {
            const users = snapshotToArray<User>(snap).map((user) =>
                normalizeUserCredentialsForStorage(user, user)
            );
            CACHE.users = users;

            if (users.length === 0) {
                try {
                    const sysSnap = await get(ref(db, 'system/users'));
                    if (sysSnap.exists()) {
                        const allSystemUsers = snapshotToArray<User>(sysSnap);
                        const recovered = allSystemUsers.filter((user) => user.tenantId === tenantId);

                        if (recovered.length > 0) {
                            CACHE.users = recovered.map((user) => normalizeUserCredentialsForStorage(user, user));
                            const updates: Record<string, any> = {};
                            recovered.forEach((user) => {
                                updates[`${basePath}/users/${user.id}`] = normalizeUserCredentialsForStorage(user, user);
                            });
                            update(ref(db), updates);
                        }
                    }
                } catch (error) {
                    console.error('Self-repair failed', error);
                }
            }

            _dataChangeCallback();
        });

        get(ref(db, `${basePath}/properties`)).then((propertySnap) => {
            if (!propertySnap.exists() || propertySnap.size === 0) {
                get(ref(db, `${basePath}/rooms`)).then((roomSnap) => {
                    if (!roomSnap.exists()) {
                        console.log(`Seeding initial data for ${tenantId}`);
                        _seedTenantData(tenantId);
                    }
                });
            }
        });
    } catch (error) {
        console.error('Sync init error', error);
    }
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
    update(ref(db), updates);
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

    update(ref(db), updates).then(() => console.log('Seeding complete'));
};

const _saveItem = (node: string, item: any) => {
    if (!item?.id || !activeTenantId || !db) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const normalizedItem = removeUndefinedDeep(normalizeForNode(node, item, activeTenantId));
    if (!normalizedItem?.id) return;

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const index = list.findIndex((entry: any) => entry.id === normalizedItem.id);
        if (index > -1) list[index] = normalizedItem;
        else list.push(normalizedItem);
    }
    _dataChangeCallback();

    try {
        return set(ref(db, `${basePath}/${node}/${normalizedItem.id}`), normalizedItem).catch((error: any) => {
            console.error(`Save ${node} failed`, error);
        });
    } catch (error) {
        console.error(`Save ${node} failed`, error);
    }
};

const _deleteItem = (node: string, id: string) => {
    if (!activeTenantId || !db) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((entry: any) => entry.id !== id);
    }
    _dataChangeCallback();

    return remove(ref(db, `${basePath}/${node}/${id}`)).catch((error: any) => {
        console.error(`Delete ${node} failed`, error);
    });
};

const _saveListAsMap = (node: string, list: any[]) => {
    if (!activeTenantId || !db) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const normalizedList = list
        .map((item) => removeUndefinedDeep(normalizeForNode(node, item, activeTenantId)))
        .filter((item) => item?.id);
    const updates: Record<string, any> = {};
    const nextIds = new Set(normalizedList.map((item) => item.id));

    // Room policies must be hard-deleted when removed from list
    // to avoid ghost policies reappearing on realtime sync.
    if (node === 'roomPolicies') {
        // @ts-ignore
        const currentList = CACHE[node as keyof typeof CACHE];
        if (Array.isArray(currentList)) {
            currentList.forEach((item: any) => {
                if (!item?.id) return;
                if (!nextIds.has(item.id)) {
                    updates[`${basePath}/${node}/${item.id}`] = null;
                }
            });
        }
    }

    // @ts-ignore
    CACHE[node as keyof typeof CACHE] = normalizedList;
    _dataChangeCallback();

    normalizedList.forEach((item) => {
        if (item?.id) {
            updates[`${basePath}/${node}/${item.id}`] = item;
        }
    });

    return update(ref(db), updates).catch((error: any) => {
        console.error(`Bulk save ${node} failed`, error);
    });
};

const _deleteItems = (node: string, ids: string[]) => {
    if (!activeTenantId || !db || ids.length === 0) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const updates: Record<string, any> = {};
    ids.forEach((id) => {
        updates[`${basePath}/${node}/${id}`] = null;
    });

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] = list.filter((entry: any) => !ids.includes(entry.id));
    }
    _dataChangeCallback();

    return update(ref(db), updates).catch((error: any) => {
        console.error(`Bulk delete ${node} failed`, error);
    });
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

const _saveAuditedList = (node: AuditedNode, list: any[]) => {
    const previousList = cloneData(
        // @ts-ignore
        CACHE[node as keyof typeof CACHE] || []
    ) as any[];
    const normalizedList = list.map((item) => normalizeForNode(node, item, activeTenantId));

    _saveListAsMap(node, list);
    _auditCollectionMutation(node, previousList, normalizedList);
};

const _updateRoomStatus = (roomId: string, status: RoomStatus, options: RoomStatusOptions = {}) => {
    if (!db || !activeTenantId || !roomId) return;

    const roomBefore = CACHE.rooms.find((room) => room.id === roomId);
    if (!roomBefore || roomBefore.status === status) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const roomAfter: Room = { ...roomBefore, status };
    CACHE.rooms = CACHE.rooms.map((room) => (room.id === roomId ? roomAfter : room));
    _dataChangeCallback();

    update(ref(db), { [`${basePath}/rooms/${roomId}/status`]: status }).catch((error: any) => {
        console.error('Sync room status failed', error);
    });

    if (!options.suppressLog) {
        _recordHistory({
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
};

const _addBooking = async (booking: Booking, options: BookingActionOptions = {}) => {
    const { savedBooking } = await _saveBookingAtomic(booking, 'create');

    if (savedBooking.status === BookingStatus.CHECKED_IN) {
        _updateRoomStatus(savedBooking.roomId, RoomStatus.OCCUPIED, {
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
};

const _updateBooking = async (booking: Booking, options: BookingActionOptions = {}) => {
    const { savedBooking, previousBooking } = await _saveBookingAtomic(booking, 'update');
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
        } else if (booking.status === BookingStatus.CANCELLED) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN, { source: options.source, suppressLog: true });
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
        if (booking.status === BookingStatus.CANCELLED) {
            action = 'CANCEL';
            description = `Hủy đơn ${booking.id}`;
            operationName = 'Đổi trạng thái cancel';
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
            _updateRoomStatus(oldBooking.roomId, RoomStatus.VACANT_CLEAN, { source: options.source, suppressLog: true });
        }
        if (booking.status === BookingStatus.CHECKED_IN) {
            _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, { source: options.source, suppressLog: true });
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
        normalizedUpsertMap.set(normalizedBooking.id, {
            booking: normalizedBooking as Booking,
            mode: item.mode,
        });
    }

    const normalizedUpserts = Array.from(normalizedUpsertMap.values());
    const deleteIds = Array.from(new Set(rawDeleteIds.filter(Boolean))).filter(
        (id) => !normalizedUpsertMap.has(id)
    );

    const bookingRef = ref(db, `${basePath}/bookings`);
    let rejectReason = '';
    const beforeById = new Map<string, Booking | null>();
    let deletedBefore: Booking[] = [];

    const result = await runTransaction(
        bookingRef,
        (currentValue) => {
            rejectReason = '';
            beforeById.clear();
            deletedBefore = [];

            const nextMap = currentValue && typeof currentValue === 'object' ? { ...currentValue } : {};

            for (const deleteId of deleteIds) {
                const existing = nextMap[deleteId] as Booking | undefined;
                if (!existing || existing.status === BookingStatus.DELETED) {
                    rejectReason = `Đơn ${deleteId} đã bị xóa hoặc không còn tồn tại.`;
                    return;
                }
                deletedBefore.push({
                    ...existing,
                    id: existing.id || deleteId,
                });
                delete nextMap[deleteId];
            }

            for (const item of normalizedUpserts) {
                const nextBooking = item.booking;
                const existing = nextMap[nextBooking.id] as Booking | undefined;

                if (item.mode === 'create' && existing) {
                    rejectReason = `Mã đơn ${nextBooking.id} đã tồn tại.`;
                    return;
                }
                if (item.mode === 'update' && (!existing || existing.status === BookingStatus.DELETED)) {
                    rejectReason = `Đơn ${nextBooking.id} đã bị xóa hoặc không còn tồn tại.`;
                    return;
                }

                beforeById.set(
                    nextBooking.id,
                    existing
                        ? {
                              ...existing,
                              id: existing.id || nextBooking.id,
                          }
                        : null
                );

                const startMs = new Date(nextBooking.checkInDate).getTime();
                const endMs = new Date(nextBooking.checkOutDate).getTime();
                const policyCheck = _validateRoomPolicy(nextBooking.roomId, nextBooking.checkInDate, nextBooking.checkOutDate);
                if (!policyCheck.valid) {
                    rejectReason = policyCheck.reason || 'Vi phạm chính sách phòng';
                    return;
                }

                const conflict = findBookingConflict(
                    toBookingListFromMap(nextMap),
                    nextBooking.roomId,
                    startMs,
                    endMs,
                    item.mode === 'update' ? nextBooking.id : undefined
                );
                if (conflict) {
                    rejectReason = `Trùng đơn ${conflict.id}`;
                    return;
                }

                nextMap[nextBooking.id] = nextBooking;
            }

            return nextMap;
        },
        { applyLocally: false }
    );

    if (!result.committed) {
        throw new Error(rejectReason || 'Dữ liệu vừa thay đổi bởi người dùng khác. Vui lòng thử lại.');
    }

    CACHE.bookings = toBookingListFromMap(result.snapshot.val());
    _dataChangeCallback();

    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const deletedIds: string[] = [];

    deletedBefore.forEach((booking) => {
        deletedIds.push(booking.id);
        if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(booking.status)) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN, {
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
            _updateRoomStatus(before.roomId, RoomStatus.VACANT_CLEAN, {
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
            } else if (booking.status === BookingStatus.CANCELLED) {
                _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN, {
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

    return { createdIds, updatedIds, deletedIds };
};

const _hardDeleteBookings = (ids: string[], staffId?: string, options: BookingActionOptions = {}) => {
    if (!activeTenantId || !db || ids.length === 0) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const bookingsToDelete = CACHE.bookings.filter((booking) => ids.includes(booking.id));
    if (bookingsToDelete.length === 0) return;

    const updates: Record<string, any> = {};
    bookingsToDelete.forEach((booking) => {
        updates[`${basePath}/bookings/${booking.id}`] = null;

        if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(booking.status)) {
            updates[`${basePath}/rooms/${booking.roomId}/status`] = RoomStatus.VACANT_CLEAN;
            CACHE.rooms = CACHE.rooms.map((room) =>
                room.id === booking.roomId ? { ...room, status: RoomStatus.VACANT_CLEAN } : room
            );
        }
    });

    CACHE.bookings = CACHE.bookings.filter((booking) => !ids.includes(booking.id));
    _dataChangeCallback();

    update(ref(db), updates).catch((error: any) => {
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

    const basePath = getBaseRef();
    if (!basePath) {
        throw new Error('Không xác định được tenant hiện tại.');
    }

    const deletedIds = CACHE.bookings.map((booking) => booking.id);
    const deletedCount = deletedIds.length;

    const updates: Record<string, any> = {};
    const newRooms = CACHE.rooms.map((room) => {
        updates[`${basePath}/rooms/${room.id}/status`] = RoomStatus.VACANT_CLEAN;
        return { ...room, status: RoomStatus.VACANT_CLEAN };
    });

    await remove(ref(db, `${basePath}/bookings`));
    await update(ref(db), updates);

    CACHE.bookings = [];
    CACHE.rooms = newRooms;
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

    const bookingRef = ref(db, `${basePath}/bookings`);
    let deletedBooking: Booking | null = null;

    const result = await runTransaction(
        bookingRef,
        (currentValue) => {
            deletedBooking = null;
            const currentMap = currentValue && typeof currentValue === 'object' ? { ...currentValue } : {};
            const existing = currentMap[id] as Booking | undefined;
            if (!existing || existing.status === BookingStatus.DELETED) {
                return;
            }
            deletedBooking = {
                ...existing,
                id: existing.id || id,
            };
            delete currentMap[id];
            return currentMap;
        },
        { applyLocally: false }
    );

    if (!result.committed || !deletedBooking) {
        return false;
    }

    CACHE.bookings = toBookingListFromMap(result.snapshot.val());
    _dataChangeCallback();

    if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(deletedBooking.status)) {
        _updateRoomStatus(deletedBooking.roomId, RoomStatus.VACANT_CLEAN, {
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

    const bookingRef = ref(db, `${basePath}/bookings`);
    const deletedBookings: Booking[] = [];
    let rejectReason = '';

    const result = await runTransaction(
        bookingRef,
        (currentValue) => {
            rejectReason = '';
            deletedBookings.length = 0;
            const currentMap = currentValue && typeof currentValue === 'object' ? { ...currentValue } : {};

            for (const id of uniqueIds) {
                const existing = currentMap[id] as Booking | undefined;
                if (!existing || existing.status === BookingStatus.DELETED) {
                    rejectReason = `Đơn ${id} đã bị xóa hoặc không còn tồn tại.`;
                    return;
                }
                deletedBookings.push({
                    ...existing,
                    id: existing.id || id,
                });
            }

            deletedBookings.forEach((booking) => {
                delete currentMap[booking.id];
            });

            return currentMap;
        },
        { applyLocally: false }
    );

    if (!result.committed) {
        throw new Error(rejectReason || 'Dữ liệu vừa thay đổi bởi người dùng khác. Vui lòng thử lại.');
    }

    if (deletedBookings.length === 0) return [] as string[];

    CACHE.bookings = toBookingListFromMap(result.snapshot.val());
    _dataChangeCallback();

    deletedBookings.forEach((booking) => {
        if ([BookingStatus.CHECKED_IN, BookingStatus.CONFIRMED].includes(booking.status)) {
            _updateRoomStatus(booking.roomId, RoomStatus.VACANT_CLEAN, {
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

    if (deletedBookings.length > 1) {
        _recordHistory({
            action: 'BULK_DELETE',
            entityType: 'BOOKING',
            description: `Xóa hàng loạt ${deletedBookings.length} đơn đặt phòng`,
            metadata: {
                count: deletedBookings.length,
                bookingIds: deletedBookings.map((booking) => booking.id),
                operationName: 'Xóa hàng loạt booking',
            },
            source,
            staffId,
        });
    }

    return deletedBookings.map((booking) => booking.id);
};

const _upsertTenantUser = (user: User, mode: 'create' | 'update') => {
    if (!db) return;

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
    update(ref(db), updates);

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

const _deleteUser = (id: string) => {
    if (!db) return;

    const user = resolveUserById(id);
    const targetTenantId = user?.tenantId && user.tenantId !== SYSTEM_TENANT_ID ? user.tenantId : activeTenantId;
    const updates: Record<string, any> = {
        [`system/users/${id}`]: null,
    };

    if (targetTenantId && targetTenantId !== SYSTEM_TENANT_ID) {
        updates[`tenants/${targetTenantId}/users/${id}`] = null;
    }

    if (activeTenantId && activeTenantId !== SYSTEM_TENANT_ID) {
        _deleteItem('users', id);
    } else {
        CACHE.systemUsers = CACHE.systemUsers.filter((item) => item.id !== id);
        _dataChangeCallback();
    }

    update(ref(db), updates);

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

    const tenant = CACHE.tenants.find((item) => item.id === id);
    const updates: Record<string, any> = {
        [`system/tenants/${id}`]: null,
        [`tenants/${id}`]: null,
        [`system/users/u_${id}_admin`]: null,
    };
    update(ref(db), updates);

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
    const normalizedUser = normalizeUserCredentialsForStorage(user);

    const updates: Record<string, any> = {
        [`system/users/${normalizedUser.id}`]: normalizedUser,
        [`tenants/${normalizedUser.tenantId}/users/${normalizedUser.id}`]: normalizedUser,
    };
    update(ref(db), updates);

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
    const checkInHour = Number.isFinite(policy.checkInHour) ? Number(policy.checkInHour) : 14;
    const checkOutHour = Number.isFinite(policy.checkOutHour) ? Number(policy.checkOutHour) : 12;
    let cursor = toDayStart(addDays(new Date(rangeStartMs), -2));
    const cursorEnd = toDayStart(addDays(new Date(rangeEndMs), 2)).getTime();
    let guard = 0;

    while (cursor.getTime() <= cursorEnd && guard < 2000) {
        if (isPolicyApplicableOnDate(policy, cursor)) {
            const windowStart = new Date(cursor);
            windowStart.setHours(checkInHour, 0, 0, 0);
            const windowEnd = addDays(new Date(cursor), 1);
            windowEnd.setHours(checkOutHour, 0, 0, 0);

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

const roomMatchesPolicy = (policy: RoomPolicyRule, room: Room) => {
    const propertyIds = policy.propertyIds || [];
    const roomTypeIds = policy.roomTypeIds || [];
    const roomIds = policy.roomIds || [];

    const matchProperty = propertyIds.length === 0 || propertyIds.includes(room.propertyId);
    const matchType = roomTypeIds.length === 0 || roomTypeIds.includes(room.typeId);
    const matchRoom = roomIds.length === 0 || roomIds.includes(room.id);
    return matchProperty && matchType && matchRoom;
};

const _validateRoomPolicy = (roomId: string, start: string, end: string) => {
    const room = CACHE.rooms.find((item) => item.id === roomId);
    if (!room) return { valid: true };

    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { valid: true };

    const matchedPolicies = CACHE.roomPolicies.filter((policy) => roomMatchesPolicy(policy, room));

    for (const policy of matchedPolicies) {
        const windows = getPolicyWindowsInRange(policy, startMs, endMs);
        if (windows.length === 0) continue;

        if (policy.mode === 'LOCKED') {
            return {
                valid: false,
                reason: `Phòng ${room.number} đang bị khóa. ${policy.reason ? `Lý do: ${policy.reason}` : ''}`.trim(),
                policyMode: policy.mode,
            };
        }

        if (policy.mode === 'HOURLY_ONLY') {
            // Chặn mọi đơn bao trùm full khung 14h -> 12h hôm sau
            // (bao gồm cả check-in sớm hoặc check-out muộn).
            const coversDailyWindow = windows.some(
                (window) => startMs <= window.startMs && endMs >= window.endMs
            );
            if (!coversDailyWindow) continue;

            return {
                valid: false,
                reason: `Phòng ${room.number} chỉ nhận khách giờ trong khung này, không nhận đơn 14h-12h.`,
                policyMode: policy.mode,
            };
        }
    }

    return { valid: true };
};

const isExpiredHoldBooking = (booking: Booking, nowMs: number = Date.now()) => {
    if (!booking?.isHold || !booking.holdUntil) return false;
    const holdUntilMs = new Date(booking.holdUntil).getTime();
    if (!Number.isFinite(holdUntilMs)) return false;
    return holdUntilMs <= nowMs;
};

const isBookingActiveForConflict = (booking: Booking, nowMs: number = Date.now()) => {
    if (booking.status === BookingStatus.DELETED || booking.status === BookingStatus.CANCELLED) return false;
    if (isExpiredHoldBooking(booking, nowMs)) return false;
    return true;
};

const toBookingListFromMap = (rawValue: any): Booking[] => {
    if (!rawValue || typeof rawValue !== 'object') return [];
    return Object.entries(rawValue).reduce<Booking[]>((acc, [key, value]) => {
        if (!value || typeof value !== 'object') return acc;
        const booking = value as Booking;
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

    const bookingRef = ref(db, `${basePath}/bookings`);
    const deletedBookings: Booking[] = [];

    const result = await runTransaction(
        bookingRef,
        (currentValue) => {
            deletedBookings.length = 0;
            const currentMap = currentValue && typeof currentValue === 'object' ? { ...currentValue } : {};
            let changed = false;

            Object.entries(currentMap).forEach(([bookingId, rawValue]) => {
                if (!rawValue || typeof rawValue !== 'object') return;
                const booking = rawValue as Booking;
                const normalizedBooking: Booking = { ...booking, id: booking.id || bookingId };
                if (!isExpiredHoldBooking(normalizedBooking, nowMs)) return;

                delete currentMap[bookingId];
                deletedBookings.push(normalizedBooking);
                changed = true;
            });

            if (!changed) return;
            return currentMap;
        },
        { applyLocally: false }
    );

    if (!result.committed || deletedBookings.length === 0) return 0;

    CACHE.bookings = toBookingListFromMap(result.snapshot.val());
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
    mode: 'create' | 'update'
) => {
    if (!booking?.id) throw new Error('Booking không hợp lệ');

    const normalizedBooking = removeUndefinedDeep(normalizeForNode('bookings', booking, activeTenantId));
    if (!normalizedBooking?.id) throw new Error('Booking không hợp lệ');

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

    const bookingRef = ref(db, `${basePath}/bookings`);
    const startMs = new Date(normalizedBooking.checkInDate).getTime();
    const endMs = new Date(normalizedBooking.checkOutDate).getTime();
    let rejectReason = '';
    let previousBookingFromCommittedTxn: Booking | null = null;

    const result = await runTransaction(
        bookingRef,
        (currentValue) => {
            rejectReason = '';
            previousBookingFromCommittedTxn = null;
            const currentMap = currentValue && typeof currentValue === 'object' ? { ...currentValue } : {};
            const currentBookings = toBookingListFromMap(currentMap);
            const existingSameId = currentMap[normalizedBooking.id] as Booking | undefined;
            if (existingSameId && typeof existingSameId === 'object') {
                previousBookingFromCommittedTxn = {
                    ...(existingSameId as Booking),
                    id: (existingSameId as Booking).id || normalizedBooking.id,
                };
            }

            if (mode === 'create' && existingSameId) {
                rejectReason = `Mã đơn ${normalizedBooking.id} đã tồn tại`;
                return;
            }

            if (mode === 'update' && (!existingSameId || existingSameId.status === BookingStatus.DELETED)) {
                rejectReason = missingUpdateMessage;
                return;
            }

            const scheduleChanged =
                mode === 'create' ||
                existingSameId.roomId !== normalizedBooking.roomId ||
                existingSameId.checkInDate !== normalizedBooking.checkInDate ||
                existingSameId.checkOutDate !== normalizedBooking.checkOutDate;

            if (scheduleChanged) {
                const policyCheck = _validateRoomPolicy(
                    normalizedBooking.roomId,
                    normalizedBooking.checkInDate,
                    normalizedBooking.checkOutDate
                );
                if (!policyCheck.valid) {
                    rejectReason = policyCheck.reason || 'Vi phạm chính sách phòng';
                    return;
                }

                const conflict = findBookingConflict(
                    currentBookings,
                    normalizedBooking.roomId,
                    startMs,
                    endMs,
                    mode === 'update' ? normalizedBooking.id : undefined
                );
                if (conflict) {
                    rejectReason = `Trùng đơn ${conflict.id}`;
                    return;
                }
            }

            currentMap[normalizedBooking.id] = normalizedBooking;
            return currentMap;
        },
        {
            applyLocally: false,
        }
    );

    if (!result.committed) {
        throw new Error(rejectReason || 'Dữ liệu vừa thay đổi bởi người dùng khác. Vui lòng thử lại.');
    }

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

export const DataService = {
    init: _initRealtimeConnection,

    setAuditActor: (user: User | null) => {
        currentAuditActor = user
            ? {
                  id: user.id,
                  username: user.username,
                  fullName: user.fullName,
                  role: user.role,
                  tenantId: user.tenantId,
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
                get(ref(db, 'system/users')),
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
                        update(ref(db), updates).catch((error: any) => {
                            console.error('Migrate user credential failed', error);
                        });
                        return { user: migratedUser, reason: null as null };
                    }
                    return { user: found, reason: null as null };
                }
            }

            // Fallback self-heal: trong trường hợp system/users bị lệch, thử tra ngược tenant users.
            const tenantSnap = await Promise.race([
                get(ref(db, 'tenants')),
                new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), CONNECTION_PREFLIGHT_TIMEOUT_MS + 1000)
                ),
            ]);
            if (tenantSnap && tenantSnap.exists()) {
                const tenantsRaw = tenantSnap.val() || {};
                const tenantEntries = Object.entries(tenantsRaw) as Array<[string, any]>;

                for (const [tenantId, tenantNode] of tenantEntries) {
                    if (!tenantNode || typeof tenantNode !== 'object') continue;
                    const tenantUsersNode = tenantNode.users;
                    if (!tenantUsersNode || typeof tenantUsersNode !== 'object') continue;

                    const tenantUsers = Object.entries(tenantUsersNode).reduce<User[]>((acc, [userId, userRaw]) => {
                        if (!userRaw || typeof userRaw !== 'object') return acc;
                        const nextUser = {
                            ...(userRaw as User),
                            id: (userRaw as User).id || userId,
                            tenantId: (userRaw as User).tenantId || tenantId,
                        };
                        acc.push(nextUser);
                        return acc;
                    }, []);

                    const matchedTenantUser = _findUserByCredential(tenantUsers, username, password);
                    if (!matchedTenantUser) continue;

                    const normalizedUser = normalizeUserCredentialsForStorage(matchedTenantUser, matchedTenantUser);
                    const updates: Record<string, any> = {
                        [`system/users/${normalizedUser.id}`]: normalizedUser,
                        [`tenants/${normalizedUser.tenantId}/users/${normalizedUser.id}`]: normalizedUser,
                    };
                    update(ref(db), updates).catch((error: any) => {
                        console.error('Self-heal user index failed', error);
                    });

                    return { user: normalizedUser, reason: null as null };
                }
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
    getRooms: (propertyId?: string) => {
        let rooms = [...CACHE.rooms];
        if (propertyId) rooms = rooms.filter((room) => room.propertyId === propertyId);
        return rooms.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },
    getRoomPolicies: () => CACHE.roomPolicies,
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
        );
        if (propertyId) bookings = bookings.filter((booking) => booking.propertyId === propertyId);
        return bookings;
    },
    getCustomers: () => CACHE.customers,
    getUsers: () => CACHE.users,
    getTags: () => CACHE.tags,
    getTransactionCategories: () => CACHE.transactionCategories,
    getHistory: () => CACHE.history,

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

    deleteItems: (node: string, ids: string[]) => {
        const auditedNode = node as AuditedNode;
        const config = COLLECTION_CONFIGS[auditedNode];

        if (!config) {
            _deleteItems(node, ids);
            return;
        }

        const previousList = cloneData(
            // @ts-ignore
            CACHE[auditedNode as keyof typeof CACHE] || []
        ) as any[];
        const removedItems = previousList.filter((item) => ids.includes(item.id));

        _deleteItems(node, ids);

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
