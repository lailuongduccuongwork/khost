import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createLoader } from './load-ts.mjs';

const load = createLoader();
const { deriveRoomOperationalStatus: status } = load('utils/bookingState.ts');
const { RoomStatus: R, BookingStatus: B } = load('types.ts');
const at = (value) => new Date(value).getTime();
const room = { id: '501', tenantId: 'tenant', propertyId: 'p1', number: '501', status: R.VACANT_CLEAN };
const stay = (id, start, end, extra = {}) => ({
    id, tenantId: 'tenant', propertyId: 'p1', roomId: room.id, status: B.CONFIRMED,
    checkInDate: start, checkOutDate: end, ...extra,
});
const afternoon = stay('afternoon', '2026-09-20T15:00:00+07:00', '2026-09-20T17:00:00+07:00');
const evening = stay('evening', '2026-09-20T20:00:00+07:00', '2026-09-20T22:00:00+07:00');
const morning = at('2026-09-21T08:00:00+07:00');

test('501: clean before two stays becomes dirty at checkout and remains dirty on reopening', () => {
    const cleanRoom = { ...room, lastCleanedAt: at('2026-09-20T14:00:55+07:00') };
    assert.equal(status(cleanRoom, [afternoon, evening], at('2026-09-20T14:30:00+07:00')), R.VACANT_CLEAN);
    assert.equal(status(cleanRoom, [afternoon, evening], at('2026-09-20T16:00:00+07:00')), R.OCCUPIED);
    assert.equal(status(cleanRoom, [afternoon, evening], at('2026-09-20T17:00:00+07:00')), R.VACANT_DIRTY);
    assert.equal(status(cleanRoom, [afternoon, evening], at('2026-09-20T21:00:00+07:00')), R.OCCUPIED);
    assert.equal(status(cleanRoom, [afternoon, evening], morning), R.VACANT_DIRTY);
    assert.equal(status(cleanRoom, [afternoon, evening], morning + 30 * 86400000), R.VACANT_DIRTY);
});

test('cleaning after the latest checkout restores readiness until another stay ends', () => {
    const cleaned = { ...room, lastCleanedAt: at('2026-09-20T22:30:00+07:00') };
    assert.equal(status(cleaned, [evening, afternoon], morning), R.VACANT_CLEAN);
    assert.equal(status({ ...cleaned, lastCleanedAt: at(evening.checkOutDate) }, [evening], morning), R.VACANT_CLEAN);
    const next = stay('next', '2026-09-21T12:00:00+07:00', '2026-09-21T17:00:00+07:00');
    assert.equal(status(cleaned, [evening, next], at('2026-09-21T17:00:00+07:00')), R.VACANT_DIRTY);
});

test('legacy clean without a confirmation is dirty after a stay; unused new room stays clean', () => {
    assert.equal(status(room, [evening], morning), R.VACANT_DIRTY);
    assert.equal(status(room, [], morning), R.VACANT_CLEAN);
    assert.equal(status({ ...room, lastCleanedAt: 'bad' }, [evening], morning), R.VACANT_DIRTY);
});

test('deleted, held, invalid and other-room bookings do not invalidate cleaning', () => {
    const ignored = [
        { ...evening, status: B.DELETED }, { ...evening, status: B.HOLD },
        { ...evening, isHold: true }, { ...evening, roomId: '502' },
        { ...evening, checkInDate: 'invalid' }, { ...evening, checkOutDate: evening.checkInDate },
        { ...evening, checkOutDate: afternoon.checkInDate },
    ];
    assert.equal(status(room, ignored, morning), R.VACANT_CLEAN);
});

test('changed checkout time and room assignment are evaluated from the current booking', () => {
    const cleaned = { ...room, lastCleanedAt: at('2026-09-20T22:30:00+07:00') };
    const extended = { ...evening, checkOutDate: '2026-09-21T10:00:00+07:00' };
    assert.equal(status(cleaned, [extended], morning), R.OCCUPIED);
    assert.equal(status(cleaned, [extended], at(extended.checkOutDate)), R.VACANT_DIRTY);
    assert.equal(status(cleaned, [{ ...extended, roomId: '502' }], morning), R.VACANT_CLEAN);
});

test('explicit dirty and orphaned occupied states remain dirty', () => {
    assert.equal(status({ ...room, status: R.VACANT_DIRTY, lastCleanedAt: morning }, [evening], morning), R.VACANT_DIRTY);
    assert.equal(status({ ...room, status: R.OCCUPIED }, [], morning), R.VACANT_DIRTY);
});

function serviceFixture(initialRoom = room, bookings = []) {
    const data = { tenants: { tenant: { rooms: { '501': structuredClone(initialRoom) }, bookings: Object.fromEntries(bookings.map(b => [b.id, b])) } } };
    const state = { data, transactionCount: 0, serverTime: Date.now(), beforeTransaction: null, rejectWrite: false, listeners: [] };
    const read = (key) => key.split('/').filter(Boolean).reduce((value, part) => value?.[part], data) ?? null;
    const write = (key, value) => {
        const parts = key.split('/').filter(Boolean);
        const leaf = parts.pop();
        const parent = parts.reduce((value, part) => value[part] ||= {}, data);
        parent[leaf] = structuredClone(value);
    };
    const snap = (value) => ({ val: () => structuredClone(value), exists: () => value != null });
    const sdk = {
        ref: (_, key = '') => ({ key }),
        query: (ref, ...conditions) => ({ ...ref, ...Object.assign({}, ...conditions) }),
        orderByChild: (child) => ({ child }), equalTo: (value) => ({ value }),
        get: async (ref) => {
            let value = read(ref.key);
            if (ref.child) value = Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item[ref.child] === ref.value));
            return snap(value);
        },
        serverTimestamp: () => ({ '.sv': 'timestamp' }),
        runTransaction: async (ref, updater, options) => {
            assert.equal(options.applyLocally, false);
            state.transactionCount++;
            state.beforeTransaction?.();
            if (state.rejectWrite) throw new Error('PERMISSION_DENIED');
            const updated = updater(structuredClone(read(ref.key)));
            if (updated !== undefined) {
                if (updated.lastCleanedAt?.['.sv'] === 'timestamp') updated.lastCleanedAt = state.serverTime;
                write(ref.key, updated);
            }
            return { committed: updated !== undefined, snapshot: snap(read(ref.key)) };
        },
        set: async (ref, value) => write(ref.key, value),
        update: async (_, updates) => Object.entries(updates).forEach(([key, value]) => write(key, value)),
        onValue: (ref, callback) => { state.listeners.push({ ref, callback }); return () => {}; },
    };
    const file = path.resolve('services/dataService.ts');
    const module = createLoader({ 'firebase/app': {}, 'firebase/database': sdk }, {
        [file]: `\nexport const seedTest = (rooms, bookings) => {
            db = {}; isFirebaseReady = true; activeTenantId = 'tenant';
            CACHE.rooms = rooms; CACHE.bookings = bookings;
            currentAuditActor = { id: 'staff', role: UserRole.ADMIN, tenantId: 'tenant' };
        };\nexport { _syncRoomStatusesForRooms as syncTest };`,
    })(file);
    module.seedTest([structuredClone(initialRoom)], bookings);
    return { ...module, state, read, write, snap };
}

const finishedStay = stay('finished', new Date(Date.now() - 7200000).toISOString(), new Date(Date.now() - 3600000).toISOString());

test('manual clean saves a server timestamp even when stored status was already clean', async () => {
    const fixture = serviceFixture(room, [finishedStay]);
    const result = await fixture.DataService.updateRoomStatus('501', R.VACANT_CLEAN);
    assert.equal(result.lastCleanedAt, fixture.state.serverTime);
    assert.equal(fixture.read('tenants/tenant/rooms/501').lastCleanedAt, fixture.state.serverTime);
    assert.equal(status(result, [finishedStay], fixture.state.serverTime), R.VACANT_CLEAN);
    const log = Object.values(fixture.read('tenants/tenant/history'))[0];
    assert.equal(log.after.lastCleanedAt, fixture.state.serverTime);
    assert.equal(log.actorId, 'staff');
});

test('cleaning cannot be confirmed while the room has an active stay', async () => {
    const now = Date.now();
    const active = stay('active', new Date(now - 60000).toISOString(), new Date(now + 60000).toISOString());
    const fixture = serviceFixture(room, [active]);
    await assert.rejects(fixture.DataService.updateRoomStatus('501', R.VACANT_CLEAN), /đang có khách/);
    assert.equal(fixture.state.transactionCount, 0);
});

test('failed write does not mark the room clean or record a successful cleaning', async () => {
    const fixture = serviceFixture({ ...room, status: R.VACANT_DIRTY });
    fixture.state.rejectWrite = true;
    await assert.rejects(fixture.DataService.updateRoomStatus('501', R.VACANT_CLEAN), /PERMISSION_DENIED/);
    assert.equal(fixture.DataService.getRooms()[0].status, R.VACANT_DIRTY);
    assert.equal(fixture.read('tenants/tenant/history'), null);
});

test('automatic synchronization marks an uncleaned checkout dirty without confirming cleaning', async () => {
    const fixture = serviceFixture(room, [finishedStay]);
    await fixture.syncTest(['501'], { source: 'SYSTEM' });
    const saved = fixture.read('tenants/tenant/rooms/501');
    assert.equal(saved.status, R.VACANT_DIRTY);
    assert.equal(saved.lastCleanedAt, undefined);
});

test('automatic synchronization cannot overwrite a concurrent cleaning confirmation', async () => {
    const fixture = serviceFixture(room, [finishedStay]);
    fixture.state.beforeTransaction = () => fixture.write('tenants/tenant/rooms/501', { ...room, lastCleanedAt: fixture.state.serverTime });
    await fixture.syncTest(['501'], { source: 'SYSTEM' });
    assert.equal(fixture.read('tenants/tenant/rooms/501').status, R.VACANT_CLEAN);
});

test('late booking-status automation does not dirty a room cleaned after checkout', async () => {
    const fixture = serviceFixture({ ...room, lastCleanedAt: Date.now() - 1000 }, [finishedStay]);
    await fixture.DataService.syncOperationalStatuses({ source: 'SYSTEM' });
    assert.equal(fixture.read('tenants/tenant/rooms/501').status, R.VACANT_CLEAN);
});

test('room settings saved from a stale tab preserve the latest cleaning and status', async () => {
    const fixture = serviceFixture({ ...room, status: R.VACANT_DIRTY, lastCleanedAt: 1234 });
    await fixture.DataService.saveRooms([{ ...room, number: 'HD2. 501' }]);
    const saved = fixture.read('tenants/tenant/rooms/501');
    assert.equal(saved.status, R.VACANT_DIRTY);
    assert.equal(saved.lastCleanedAt, 1234);
    assert.equal(saved.number, 'HD2. 501');
});

test('multi-property subscription waits for every property before publishing room history', () => {
    const fixture = serviceFixture();
    const emissions = [];
    fixture.DataService.subscribeBookingsForPropertiesView(['p1', 'p2'], rows => emissions.push(rows));
    assert.equal(fixture.state.listeners.length, 2);
    fixture.state.listeners[0].callback(fixture.snap({ evening }));
    assert.equal(emissions.length, 0);
    fixture.state.listeners[1].callback(fixture.snap({}));
    assert.equal(emissions.length, 1);
    assert.equal(emissions[0][0].id, evening.id);
});
