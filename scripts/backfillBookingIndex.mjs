import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { get, getDatabase, goOffline, ref, update } from 'firebase/database';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const BOOKING_INDEX_NODE = 'bookingIndexByPropertyDate';
const CHUNK_SIZE = 350;
const READ_TIMEOUT_MS = 15000;

const argList = process.argv.slice(2);
const args = new Set(argList);
const shouldWrite = args.has('--write');
const verifyOnly = args.has('--verify-only');
const dryRun = args.has('--dry-run') || (!shouldWrite && !verifyOnly);
const backupConfirmed = args.has('--backup-confirmed');
const tenantArg = argList.find((arg) => arg.startsWith('--tenant='));
const targetTenantIds = tenantArg
    ? tenantArg
        .split('=')
        .slice(1)
        .join('=')
        .split(',')
        .map((tenantId) => tenantId.trim())
        .filter(Boolean)
    : [];

if ([shouldWrite, verifyOnly, args.has('--dry-run')].filter(Boolean).length > 1) {
    console.error('Choose only one mode: --dry-run, --verify-only, or --write.');
    process.exit(1);
}

if (targetTenantIds.length === 0) {
    console.error('Missing required --tenant=tenant_id. Safe examples:');
    console.error('  npm run backfill:booking-index -- --dry-run --tenant=tenant_1777400052490');
    console.error('  npm run backfill:booking-index -- --verify-only --tenant=tenant_1777400052490');
    console.error('  npm run backfill:booking-index -- --dry-run --tenant=tenant_1,tenant_2');
    process.exit(1);
}

if (shouldWrite && !backupConfirmed) {
    console.error('WRITE mode refused. Backup the Realtime Database first, then rerun with --write --backup-confirmed.');
    process.exit(1);
}

const loadEnvFile = (fileName) => {
    const filePath = path.join(repoRoot, fileName);
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex < 0) return;
        const key = trimmed.slice(0, eqIndex).trim();
        const rawValue = trimmed.slice(eqIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = value;
    });
};

loadEnvFile('.env');
loadEnvFile('.env.local');

const requiredEnvKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
];

const missingEnvKeys = requiredEnvKeys.filter((key) => !process.env[key]);
if (missingEnvKeys.length > 0) {
    console.error(`Missing Firebase env vars: ${missingEnvKeys.join(', ')}`);
    process.exit(1);
}

const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const normalizeLegacyBookingStatus = (status) => {
    if (status === 'HOLD' || status === 'PENDING') return 'HOLD';
    if (status === 'CONFIRMED') return 'CONFIRMED';
    if (status === 'CHECKED_IN') return 'CHECKED_IN';
    if (status === 'CHECKED_OUT') return 'CHECKED_OUT';
    if (status === 'DELETED' || status === 'CANCELLED') return 'DELETED';
    return 'CONFIRMED';
};

const isExpiredHoldBooking = (booking, nowMs = Date.now()) => {
    if (!booking?.isHold && booking?.status !== 'HOLD') return false;
    if (!booking.holdUntil) return false;
    const holdUntilMs = new Date(booking.holdUntil).getTime();
    if (!Number.isFinite(holdUntilMs)) return false;
    return holdUntilMs <= nowMs;
};

const isIndexableBooking = (booking) => {
    if (!booking || typeof booking !== 'object') return false;
    if (normalizeLegacyBookingStatus(booking.status) === 'DELETED') return false;
    if (isExpiredHoldBooking(booking)) return false;
    return true;
};

const toDateKey = (input) => {
    const date = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getDateKeysBetween = (startInput, endInput) => {
    const startDate = typeof startInput === 'string' ? new Date(startInput) : new Date(startInput);
    const endDate = typeof endInput === 'string' ? new Date(endInput) : new Date(endInput);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];

    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);

    const exclusiveEnd = new Date(endDate.getTime() - 1);
    if (Number.isNaN(exclusiveEnd.getTime())) return [];
    exclusiveEnd.setHours(0, 0, 0, 0);

    const keys = [];
    while (cursor.getTime() <= exclusiveEnd.getTime()) {
        keys.push(toDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
};

const getBookingExpenseFeeTotal = (booking) =>
    (booking.extraFees || [])
        .filter((fee) => fee?.type === 'EXPENSE')
        .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);

const normalizeBookingTagIds = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((tag) => (typeof tag === 'string' ? tag : tag?.id))
        .filter((tagId) => typeof tagId === 'string' && tagId.trim().length > 0);
};

const buildBookingIndexSummary = (booking) => ({
    id: booking.id,
    tenantId: booking.tenantId || undefined,
    propertyId: booking.propertyId,
    roomId: booking.roomId,
    customerId: booking.customerId || 'c_guest',
    guestName: booking.guestName || '',
    guestPhone: booking.guestPhone || '',
    groupId: booking.groupId || null,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    status: normalizeLegacyBookingStatus(booking.status),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt || booking.createdAt,
    createdBy: booking.createdBy,
    bookingCategory: booking.bookingCategory || '',
    bookingSource: booking.bookingSource || '',
    isHold: !!booking.isHold || normalizeLegacyBookingStatus(booking.status) === 'HOLD',
    holdUntil: booking.holdUntil || null,
    totalPrice: Number(booking.totalPrice) || 0,
    paidAmount: Number(booking.paidAmount) || 0,
    tags: normalizeBookingTagIds(booking.tags?.length ? booking.tags : booking.tagIds),
    hasNotes: typeof booking.hasNotes === 'boolean' ? booking.hasNotes : !!String(booking.notes || '').trim(),
    expenseFeeTotal: Number(booking.expenseFeeTotal) || getBookingExpenseFeeTotal(booking),
});

const HEAVY_FIELD_KEYS = new Set([
    'notes',
    'extraFees',
    'payment',
    'payments',
    'paymentDetails',
    'paymentDetail',
    'details',
    'detail',
    'receipt',
    'receipts',
]);

const findHeavyFields = (value, prefix = '') => {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
        return value.flatMap((item, index) => findHeavyFields(item, `${prefix}[${index}]`));
    }

    const matches = [];
    Object.entries(value).forEach(([key, itemValue]) => {
        const pathKey = prefix ? `${prefix}.${key}` : key;
        if (HEAVY_FIELD_KEYS.has(key)) matches.push(pathKey);
        if (itemValue && typeof itemValue === 'object') {
            matches.push(...findHeavyFields(itemValue, pathKey));
        }
    });
    return matches;
};

const parseIndexPath = (dbPath) => {
    const parts = dbPath.split('/');
    const nodeIndex = parts.indexOf(BOOKING_INDEX_NODE);
    return {
        propertyId: nodeIndex >= 0 ? parts[nodeIndex + 1] : '',
        dateKey: nodeIndex >= 0 ? parts[nodeIndex + 2] : '',
        bookingId: nodeIndex >= 0 ? parts[nodeIndex + 3] : '',
    };
};

const flattenIndex = (node, tenantBasePath) => {
    const rows = new Map();
    if (!node || typeof node !== 'object') return rows;

    Object.entries(node).forEach(([propertyId, dateNode]) => {
        if (!dateNode || typeof dateNode !== 'object') return;
        Object.entries(dateNode).forEach(([dateKey, bookingNode]) => {
            if (!bookingNode || typeof bookingNode !== 'object') return;
            Object.entries(bookingNode).forEach(([bookingId, booking]) => {
                rows.set(`${tenantBasePath}/${BOOKING_INDEX_NODE}/${propertyId}/${dateKey}/${bookingId}`, booking);
            });
        });
    });

    return rows;
};

const buildExpectedIndex = (bookingsNode, tenantId, tenantBasePath) => {
    const expected = new Map();
    const invalidBookings = [];
    const skippedBookings = [];
    if (!bookingsNode || typeof bookingsNode !== 'object') {
        return { expected, invalidBookings, skippedBookings, sourceBookingCount: 0, indexedBookingCount: 0 };
    }

    let sourceBookingCount = 0;
    const indexedBookingIds = new Set();

    Object.entries(bookingsNode).forEach(([bookingId, rawBooking]) => {
        if (!rawBooking || typeof rawBooking !== 'object') return;
        sourceBookingCount += 1;

        const booking = {
            ...rawBooking,
            id: rawBooking.id || bookingId,
            tenantId: rawBooking.tenantId || tenantId,
            status: normalizeLegacyBookingStatus(rawBooking.status),
            isHold: rawBooking.isHold || normalizeLegacyBookingStatus(rawBooking.status) === 'HOLD',
        };

        if (!isIndexableBooking(booking)) {
            skippedBookings.push(booking.id || bookingId);
            return;
        }

        if (!booking.propertyId || !booking.checkInDate || !booking.checkOutDate || !booking.roomId) {
            invalidBookings.push(booking.id || bookingId);
            return;
        }

        const dateKeys = getDateKeysBetween(booking.checkInDate, booking.checkOutDate);
        if (dateKeys.length === 0) {
            invalidBookings.push(booking.id || bookingId);
            return;
        }

        const summary = buildBookingIndexSummary(booking);
        indexedBookingIds.add(booking.id);
        dateKeys.forEach((dateKey) => {
            expected.set(
                `${tenantBasePath}/${BOOKING_INDEX_NODE}/${booking.propertyId}/${dateKey}/${booking.id}`,
                summary
            );
        });
    });

    return {
        expected,
        invalidBookings,
        skippedBookings,
        sourceBookingCount,
        indexedBookingCount: indexedBookingIds.size,
    };
};

const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
};

const getMismatchType = (dbPath, current, expected) => {
    const parsed = parseIndexPath(dbPath);
    if (!expected) return 'EXTRA_INDEX_PATH';
    if (!current) return 'MISSING_INDEX_PATH';
    if (parsed.propertyId !== expected.propertyId) return 'PROPERTY_ID_PATH_MISMATCH';
    if (current.propertyId !== expected.propertyId) return 'PROPERTY_ID_VALUE_MISMATCH';
    if (current.roomId !== expected.roomId) return 'ROOM_ID_MISMATCH';
    if (normalizeLegacyBookingStatus(current.status) !== expected.status) return 'STATUS_MISMATCH';
    if (stableStringify(current) !== stableStringify(expected)) return 'SUMMARY_MISMATCH';
    return '';
};

const analyzeIndex = (expected, existing) => {
    const missing = [];
    const extra = [];
    const mismatched = [];
    const heavyFields = [];

    expected.forEach((expectedBooking, dbPath) => {
        const current = existing.get(dbPath);
        if (!current) {
            missing.push({ dbPath, bookingId: expectedBooking.id, dateKey: parseIndexPath(dbPath).dateKey });
            return;
        }

        const type = getMismatchType(dbPath, current, expectedBooking);
        if (type) {
            mismatched.push({
                type,
                dbPath,
                bookingId: expectedBooking.id,
                propertyId: current.propertyId,
                expectedPropertyId: expectedBooking.propertyId,
                roomId: current.roomId,
                expectedRoomId: expectedBooking.roomId,
                status: current.status,
                expectedStatus: expectedBooking.status,
            });
        }
    });

    existing.forEach((current, dbPath) => {
        if (!expected.has(dbPath)) {
            const parsed = parseIndexPath(dbPath);
            extra.push({ dbPath, bookingId: parsed.bookingId, propertyId: parsed.propertyId, dateKey: parsed.dateKey });
        }

        const fields = findHeavyFields(current);
        if (fields.length > 0) {
            heavyFields.push({ dbPath, bookingId: parseIndexPath(dbPath).bookingId, fields });
        }
    });

    return { missing, extra, mismatched, heavyFields };
};

const chunkEntries = (entries, size) => {
    const chunks = [];
    for (let index = 0; index < entries.length; index += size) {
        chunks.push(entries.slice(index, index + size));
    }
    return chunks;
};

const readValue = async (dbPath) => {
    const snap = await Promise.race([
        get(ref(db, dbPath)),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out reading ${dbPath}`)), READ_TIMEOUT_MS)
        ),
    ]);
    return snap.exists() ? snap.val() : null;
};

const writeUpdates = async (updates) => {
    const entries = Object.entries(updates);
    const chunks = chunkEntries(entries, CHUNK_SIZE);
    for (const [index, chunk] of chunks.entries()) {
        const chunkUpdates = Object.fromEntries(chunk);
        await update(ref(db), chunkUpdates);
        console.log(`Wrote chunk ${index + 1}/${chunks.length} (${chunk.length} paths)`);
    }
};

const buildUpdates = (expected, existing) => {
    const updates = {};

    expected.forEach((summary, dbPath) => {
        const current = existing.get(dbPath);
        if (!current || stableStringify(current) !== stableStringify(summary)) {
            updates[dbPath] = summary;
        }
    });

    existing.forEach((_booking, dbPath) => {
        if (!expected.has(dbPath)) {
            updates[dbPath] = null;
        }
    });

    return updates;
};

const summarizeAnalysis = (analysis) => ({
    missingIndexPaths: analysis.missing.length,
    extraIndexPaths: analysis.extra.length,
    mismatchedIndexPaths: analysis.mismatched.length,
    heavyFieldIndexPaths: analysis.heavyFields.length,
    missingSamples: analysis.missing.slice(0, 10),
    extraSamples: analysis.extra.slice(0, 10),
    mismatchSamples: analysis.mismatched.slice(0, 10),
    heavyFieldSamples: analysis.heavyFields.slice(0, 10),
});

const processTenant = async (tenantId) => {
    const tenantBasePath = `tenants/${tenantId}`;
    const [bookingsNode, indexNode] = await Promise.all([
        readValue(`${tenantBasePath}/bookings`),
        readValue(`${tenantBasePath}/${BOOKING_INDEX_NODE}`),
    ]);

    const {
        expected,
        invalidBookings,
        skippedBookings,
        sourceBookingCount,
        indexedBookingCount,
    } = buildExpectedIndex(bookingsNode, tenantId, tenantBasePath);
    const existing = flattenIndex(indexNode, tenantBasePath);
    const updates = buildUpdates(expected, existing);
    const analysis = analyzeIndex(expected, existing);

    const pathsToWrite = Object.keys(updates).length;
    const stalePaths = Object.values(updates).filter((value) => value === null).length;
    const upsertPaths = pathsToWrite - stalePaths;
    const report = {
        tenantId,
        mode: shouldWrite ? 'write' : verifyOnly ? 'verify-only' : 'dry-run',
        sourceBookingCount,
        indexedBookingCount,
        expectedIndexPaths: expected.size,
        existingIndexPaths: existing.size,
        upsertPaths,
        stalePaths,
        invalidBookingCount: invalidBookings.length,
        skippedBookingCount: skippedBookings.length,
        invalidBookings: invalidBookings.slice(0, 20),
        skippedBookings: skippedBookings.slice(0, 20),
        ...summarizeAnalysis(analysis),
    };

    console.log(JSON.stringify(report, null, 2));

    if (verifyOnly || dryRun) {
        return {
            tenantId,
            pathsToWrite,
            invalidBookingCount: invalidBookings.length,
            missingIndexPaths: analysis.missing.length,
            extraIndexPaths: analysis.extra.length,
            mismatchedIndexPaths: analysis.mismatched.length,
            heavyFieldIndexPaths: analysis.heavyFields.length,
        };
    }

    if (pathsToWrite === 0) {
        console.log(`No index changes needed for ${tenantId}.`);
        return { tenantId, pathsToWrite, invalidBookingCount: invalidBookings.length, remainingMismatches: 0 };
    }

    console.warn('WRITE mode is active. Confirmed database backup flag was provided.');
    await writeUpdates(updates);

    const afterIndex = flattenIndex(await readValue(`${tenantBasePath}/${BOOKING_INDEX_NODE}`), tenantBasePath);
    const afterAnalysis = analyzeIndex(expected, afterIndex);
    const remainingMismatches =
        afterAnalysis.missing.length +
        afterAnalysis.extra.length +
        afterAnalysis.mismatched.length +
        afterAnalysis.heavyFields.length;

    console.log(
        JSON.stringify(
            {
                tenantId,
                verification: remainingMismatches === 0 ? 'OK' : 'MISMATCH',
                remainingMismatches,
                ...summarizeAnalysis(afterAnalysis),
            },
            null,
            2
        )
    );

    return { tenantId, pathsToWrite, invalidBookingCount: invalidBookings.length, remainingMismatches };
};

const main = async () => {
    console.log(
        `Booking index rebuild mode: ${shouldWrite ? 'WRITE' : verifyOnly ? 'VERIFY_ONLY' : 'DRY_RUN'}${
            targetTenantIds.length > 0 ? `, tenant=${targetTenantIds.join(',')}` : ''
        }`
    );

    if (shouldWrite) {
        console.warn('Before WRITE mode: export/backup the Realtime Database from Firebase Console.');
    }

    const tenantIds = targetTenantIds;
    if (tenantIds.length === 0) {
        console.log('No tenants found.');
        return;
    }

    const results = [];
    for (const tenantId of tenantIds) {
        results.push(await processTenant(tenantId));
    }

    console.log('Summary:');
    console.log(JSON.stringify(results, null, 2));
    goOffline(db);
};

main().catch((error) => {
    console.error('Rebuild booking index failed:', error);
    goOffline(db);
    process.exit(1);
});
