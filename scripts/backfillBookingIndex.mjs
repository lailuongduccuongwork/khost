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

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has('--write');
const verifyOnly = args.has('--verify-only');
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const targetTenantId = tenantArg ? tenantArg.split('=').slice(1).join('=').trim() : '';

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

const isDeletedBooking = (booking) => booking?.status === 'DELETED' || booking?.status === 'CANCELLED';

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
    if (!bookingsNode || typeof bookingsNode !== 'object') {
        return { expected, invalidBookings, sourceBookingCount: 0, indexedBookingCount: 0 };
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
        };

        if (isDeletedBooking(booking)) return;
        if (!booking.propertyId || !booking.checkInDate || !booking.checkOutDate || !booking.roomId) {
            invalidBookings.push(booking.id || bookingId);
            return;
        }

        const dateKeys = getDateKeysBetween(booking.checkInDate, booking.checkOutDate);
        if (dateKeys.length === 0) {
            invalidBookings.push(booking.id || bookingId);
            return;
        }

        indexedBookingIds.add(booking.id);
        dateKeys.forEach((dateKey) => {
            expected.set(
                `${tenantBasePath}/${BOOKING_INDEX_NODE}/${booking.propertyId}/${dateKey}/${booking.id}`,
                booking
            );
        });
    });

    return {
        expected,
        invalidBookings,
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

const getTenantIds = async () => {
    if (targetTenantId) return [targetTenantId];
    const tenantsNode = await readValue('tenants');
    if (!tenantsNode || typeof tenantsNode !== 'object') return [];
    return Object.keys(tenantsNode).sort();
};

const processTenant = async (tenantId) => {
    const tenantBasePath = `tenants/${tenantId}`;
    const [bookingsNode, indexNode] = await Promise.all([
        readValue(`${tenantBasePath}/bookings`),
        readValue(`${tenantBasePath}/${BOOKING_INDEX_NODE}`),
    ]);

    const { expected, invalidBookings, sourceBookingCount, indexedBookingCount } = buildExpectedIndex(
        bookingsNode,
        tenantId,
        tenantBasePath
    );
    const existing = flattenIndex(indexNode, tenantBasePath);
    const updates = {};

    expected.forEach((booking, dbPath) => {
        const current = existing.get(dbPath);
        if (!current || stableStringify(current) !== stableStringify(booking)) {
            updates[dbPath] = booking;
        }
    });

    existing.forEach((_booking, dbPath) => {
        if (!expected.has(dbPath)) {
            updates[dbPath] = null;
        }
    });

    const pathsToWrite = Object.keys(updates).length;
    const stalePaths = Object.values(updates).filter((value) => value === null).length;
    const upsertPaths = pathsToWrite - stalePaths;

    console.log(
        JSON.stringify(
            {
                tenantId,
                sourceBookingCount,
                indexedBookingCount,
                expectedIndexPaths: expected.size,
                existingIndexPaths: existing.size,
                upsertPaths,
                stalePaths,
                invalidBookings: invalidBookings.slice(0, 20),
                invalidBookingCount: invalidBookings.length,
            },
            null,
            2
        )
    );

    if (verifyOnly) {
        return { tenantId, pathsToWrite, invalidBookingCount: invalidBookings.length };
    }

    if (!shouldWrite) {
        console.log(`Dry-run only for ${tenantId}. Re-run with --write to apply.`);
        return { tenantId, pathsToWrite, invalidBookingCount: invalidBookings.length };
    }

    if (pathsToWrite === 0) {
        console.log(`No index changes needed for ${tenantId}.`);
        return { tenantId, pathsToWrite, invalidBookingCount: invalidBookings.length };
    }

    await writeUpdates(updates);
    const afterIndex = flattenIndex(await readValue(`${tenantBasePath}/${BOOKING_INDEX_NODE}`), tenantBasePath);
    let remainingMismatches = 0;
    expected.forEach((booking, dbPath) => {
        const current = afterIndex.get(dbPath);
        if (!current || stableStringify(current) !== stableStringify(booking)) remainingMismatches += 1;
    });
    afterIndex.forEach((_booking, dbPath) => {
        if (!expected.has(dbPath)) remainingMismatches += 1;
    });

    console.log(
        JSON.stringify(
            {
                tenantId,
                verification: remainingMismatches === 0 ? 'OK' : 'MISMATCH',
                remainingMismatches,
            },
            null,
            2
        )
    );

    return { tenantId, pathsToWrite, invalidBookingCount: invalidBookings.length, remainingMismatches };
};

const main = async () => {
    console.log(
        `Booking index backfill mode: ${shouldWrite ? 'WRITE' : verifyOnly ? 'VERIFY_ONLY' : 'DRY_RUN'}${
            targetTenantId ? `, tenant=${targetTenantId}` : ''
        }`
    );

    const tenantIds = await getTenantIds();
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
    console.error('Backfill booking index failed:', error);
    goOffline(db);
    process.exit(1);
});
