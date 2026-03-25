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
import { initializeApp } from 'firebase/app';
import { getDatabase, get, onValue, ref, remove, set, update } from 'firebase/database';

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

type AuditSource = 'WEB' | 'SYSTEM' | 'IMPORT';
type AuditedNode =
    | 'properties'
    | 'rooms'
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

let currentAuditActor: AuditActor | null = null;
const recentAuditEntries = new Map<string, { id: string; timestamp: number }>();

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
        } catch (error) {
            console.error('Firebase connection failed', error);
        }
    }
    return isFirebaseReady;
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

    const finalEntry = { ...entry, id: targetId };
    upsertHistoryCache(finalEntry);

    return set(ref(db, `${historyPath}/${targetId}`), finalEntry).catch((error: any) => {
        console.error('Write history failed', error);
    });
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
                // @ts-ignore
                CACHE[cacheKey] = snapshotToArray<T>(snap);
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
        bind<Booking>('bookings', 'bookings');
        bind<Customer>('customers', 'customers');
        _bindHistory(basePath);

        onValue(ref(db, `${basePath}/users`), async (snap) => {
            const users = snapshotToArray<User>(snap);
            CACHE.users = users;

            if (users.length === 0) {
                try {
                    const sysSnap = await get(ref(db, 'system/users'));
                    if (sysSnap.exists()) {
                        const allSystemUsers = snapshotToArray<User>(sysSnap);
                        const recovered = allSystemUsers.filter((user) => user.tenantId === tenantId);

                        if (recovered.length > 0) {
                            CACHE.users = recovered;
                            const updates: Record<string, any> = {};
                            recovered.forEach((user) => {
                                updates[`${basePath}/users/${user.id}`] = user;
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
        usersMap[user.id] = user;
    });

    INITIAL_TENANTS.forEach((tenant) => {
        if (!tenant.adminUsername) return;

        const id = `u_${tenant.id}_admin`;
        if (!usersMap[id]) {
            usersMap[id] = {
                id,
                tenantId: tenant.id,
                username: tenant.adminUsername,
                password: tenant.adminPassword || '123',
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

    const normalizedItem = normalizeForNode(node, item, activeTenantId);

    // @ts-ignore
    const list = CACHE[node as keyof typeof CACHE];
    if (Array.isArray(list)) {
        const index = list.findIndex((entry: any) => entry.id === normalizedItem.id);
        if (index > -1) list[index] = normalizedItem;
        else list.push(normalizedItem);
    }
    _dataChangeCallback();

    return set(ref(db, `${basePath}/${node}/${normalizedItem.id}`), normalizedItem).catch((error: any) => {
        console.error(`Save ${node} failed`, error);
    });
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

    const normalizedList = list.map((item) => normalizeForNode(node, item, activeTenantId));
    const updates: Record<string, any> = {};

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

const _addBooking = (booking: Booking, options: BookingActionOptions = {}) => {
    _saveItem('bookings', booking);

    if (booking.status === BookingStatus.CHECKED_IN) {
        _updateRoomStatus(booking.roomId, RoomStatus.OCCUPIED, {
            source: options.source,
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
        source: options.source || 'WEB',
        staffId: options.staffId,
        bookingSnapshot: booking,
    });
};

const _updateBooking = (booking: Booking, options: BookingActionOptions = {}) => {
    const oldBooking = CACHE.bookings.find((item) => item.id === booking.id);
    _saveItem('bookings', booking);

    if (!oldBooking) {
        _recordHistory({
            action: 'UPDATE',
            entityType: 'BOOKING',
            entityId: booking.id,
            entityLabel: booking.id,
            description: `Cập nhật thông tin đơn ${booking.id}`,
            after: booking,
            metadata: {
                ...buildNodeMetadata('bookings', booking),
                operationName: 'Sửa booking',
            },
            source: options.source || 'WEB',
            staffId: options.staffId,
            bookingSnapshot: booking,
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

    if (oldBooking.roomId !== booking.roomId) {
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

const _resetAllBookings = () => {
    if (!activeTenantId || !db) return;

    const basePath = getBaseRef();
    if (!basePath) return;

    const deletedIds = CACHE.bookings.map((booking) => booking.id);
    const deletedCount = deletedIds.length;

    remove(ref(db, `${basePath}/bookings`)).then(() => {
        console.log('All bookings deleted');
    });

    const updates: Record<string, any> = {};
    const newRooms = CACHE.rooms.map((room) => {
        updates[`${basePath}/rooms/${room.id}/status`] = RoomStatus.VACANT_CLEAN;
        return { ...room, status: RoomStatus.VACANT_CLEAN };
    });

    update(ref(db), updates);
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

const _deleteBooking = (id: string, staffId: string, options: BookingActionOptions = {}) => {
    _hardDeleteBookings([id], staffId, options);
    return true;
};

const _upsertTenantUser = (user: User, mode: 'create' | 'update') => {
    if (!db) return;

    const targetTenantId =
        activeTenantId && activeTenantId !== SYSTEM_TENANT_ID ? activeTenantId : user.tenantId;
    const userWithTenant = { ...user, tenantId: targetTenantId };
    const tenantPath = getBaseRefForTenant(targetTenantId);
    if (!tenantPath) return;
    const existingUser = resolveUserById(user.id);

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

    const updates: Record<string, any> = {
        [`system/users/${user.id}`]: user,
        [`tenants/${user.tenantId}/users/${user.id}`]: user,
    };
    update(ref(db), updates);

    _recordHistory({
        tenantId: user.tenantId,
        action: 'CREATE',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: user.fullName || user.username || user.id,
        description: `Khởi tạo tài khoản admin ${user.username}`,
        after: user,
        metadata: buildNodeMetadata('users', user),
        source: 'SYSTEM',
    });
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

        if (db) {
            try {
                const snap = await get(ref(db, 'system/users'));
                if (snap.exists()) {
                    const users = snapshotToArray<User>(snap);
                    const found = users.find((user) => user.username === username && user.password === password);
                    if (found) return found;
                }
            } catch (error) {
                console.error('Login error', error);
            }
        }

        return INITIAL_USERS.find((user) => user.username === username && user.password === password) || null;
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
    getBookings: (propertyId?: string) => {
        let bookings = CACHE.bookings.filter((booking) => booking.status !== BookingStatus.DELETED);
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
    saveRoomTypes: (list: RoomType[]) => _saveAuditedList('roomTypes', list),
    saveTags: (list: Tag[]) => _saveAuditedList('tags', list),
    saveTransactionCategories: (list: TransactionCategory[]) => _saveAuditedList('transactionCategories', list),

    updateRoomStatus: _updateRoomStatus,
    addBooking: _addBooking,
    updateBooking: _updateBooking,
    deleteBooking: _deleteBooking,
    deleteBookings: _hardDeleteBookings,
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

    deleteBookingsByBatchId: (batchId: string, staffId: string) => {
        const toDelete = CACHE.bookings.filter((booking) => booking.importBatchId === batchId);
        if (toDelete.length === 0) return 0;

        const ids = toDelete.map((booking) => booking.id);
        _hardDeleteBookings(ids, staffId);
        _recordHistory({
            action: 'BULK_DELETE',
            entityType: 'BOOKING',
            description: `Hoàn tác import batch ${batchId} (${ids.length} đơn)`,
            metadata: {
                batchId,
                count: ids.length,
                bookingIds: ids,
            },
            staffId,
        });
        return ids.length;
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
        const startMs = new Date(start).getTime();
        const endMs = new Date(end).getTime();
        const buffer = 30 * 60 * 1000;
        const activeBookings = CACHE.bookings.filter(
            (booking) =>
                booking.status !== BookingStatus.DELETED && booking.status !== BookingStatus.CANCELLED
        );

        const conflict = activeBookings.find((booking) => {
            if (booking.id === excludeId) return false;
            if (booking.roomId !== roomId) return false;

            const bookingStart = new Date(booking.checkInDate).getTime();
            const bookingEnd = new Date(booking.checkOutDate).getTime();
            return startMs < bookingEnd + buffer && endMs + buffer > bookingStart;
        });

        return conflict ? { valid: false, reason: `Trùng đơn ${conflict.id}` } : { valid: true };
    },

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
