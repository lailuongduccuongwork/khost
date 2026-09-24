import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createLoader } from './load-ts.mjs';

const load = createLoader();
const { createRealtimePool } = load('utils/realtimePool.ts');
const { checkoutQueryLowerBound, roomHistoryStart } = load('utils/bookingReadScope.ts');
const { deriveRoomOperationalStatus } = load('utils/bookingState.ts');
const { BookingStatus: B, RoomStatus: R } = load('types.ts');
const now = Date.now();
const iso = time => new Date(time).toISOString();
const room = { id: 'r1', propertyId: 'p1', tenantId: 'tenant', status: R.VACANT_CLEAN, lastCleanedAt: now - 3600000 };
const booking = (id, start, end, extra = {}) => ({
    id, roomId: 'r1', tenantId: 'tenant', propertyId: 'p1', customerId: 'guest',
    checkInDate: start, checkOutDate: end, status: B.CONFIRMED, ...extra,
});

function fixture(bookings = {}, systemUsers = {}, tenantUsers = {}) {
    const data = { '.info': { connected: true }, system: { users: systemUsers, tenants: { tenant: { id: 'tenant' } } },
        tenants: { tenant: { users: tenantUsers, bookings } } };
    const reads = [], listeners = [], writes = [];
    const read = key => key.split('/').reduce((value, part) => value?.[part], data) ?? null;
    const snap = value => ({ val: () => structuredClone(value), exists: () => value != null });
    const sdk = {
        ref: (_, key) => ({ key }),
        query: (ref, ...parts) => ({ ...ref, ...Object.assign({}, ...parts) }),
        orderByChild: child => ({ child }), equalTo: equal => ({ equal }),
        startAt: lower => ({ lower }), endAt: upper => ({ upper }),
        get: async ref => {
            reads.push(ref);
            // Make broad reads fail even if a future refactor reintroduces them.
            assert.notEqual(ref.key, 'tenants');
            assert.notEqual(ref.key, 'tenants/tenant');
            let value = read(ref.key);
            if (ref.child) value = Object.fromEntries(Object.entries(value || {}).filter(([, item]) =>
                ref.equal !== undefined ? item[ref.child] === ref.equal : item[ref.child] >= ref.lower));
            return snap(value);
        },
        onValue: (ref, next, error) => {
            const listener = { ref, next, error, stopped: false };
            listeners.push(listener);
            return () => { listener.stopped = true; };
        },
        update: async (_, value) => { writes.push(value); },
    };
    const file = path.resolve('services/dataService.ts');
    const module = createLoader({ 'firebase/app': {}, 'firebase/database': sdk }, {
        [file]: '\n db = {}; isFirebaseReady = true; activeTenantId = "tenant";\nexport { realtimePool, _clearSessionCache };',
    })(file);
    return { ...module, reads, listeners, writes, snap };
}

test('incorrect password never reads the tenant tree or booking/audit data', async () => {
    const f = fixture({}, { u1: { id: 'u1', username: 'staff', password: 'correct', tenantId: 'tenant' } });
    const result = await f.DataService.login('staff', 'incorrect');
    assert.equal(result.reason, 'INVALID_CREDENTIALS');
    assert.deepEqual(f.reads.map(ref => ref.key), ['.info/connected', 'system/users', 'system/tenants', 'tenants/tenant/users']);
    assert.equal(f.writes.length, 0);
});

test('legacy account missing from system directory still logs in using only tenant/users', async () => {
    const user = { id: 'legacy', username: 'legacy', password: 'correct', tenantId: 'tenant' };
    const f = fixture({}, {}, { legacy: user });
    const result = await f.DataService.login('legacy', 'correct');
    assert.equal(result.user.id, 'legacy');
    assert.equal(result.reason, null);
    assert.ok(f.writes[0]['system/users/legacy']);
    assert.equal(f.reads.filter(ref => ref.key.endsWith('/users')).length, 2);
});

test('normal account does not read other user directories', async () => {
    const f = fixture({}, { u1: { id: 'u1', username: 'staff', password: 'correct', tenantId: 'tenant' } });
    const result = await f.DataService.login('staff', 'correct');
    assert.equal(result.user.id, 'u1');
    assert.deepEqual(f.reads.map(ref => ref.key), ['.info/connected', 'system/users']);
});

test('availability includes long stays and future bookings, excludes old/other-property/deleted bookings', async () => {
    const bookings = {
        long: booking('long', iso(now - 90 * 86400000), iso(now + 86400000)),
        future: booking('future', iso(now + 86400000), iso(now + 2 * 86400000)),
        old: booking('old', iso(now - 5 * 86400000), iso(now - 4 * 86400000)),
        other: booking('other', iso(now - 3600000), iso(now + 86400000), { propertyId: 'p2' }),
        deleted: booking('deleted', iso(now - 3600000), iso(now + 86400000), { status: B.DELETED }),
    };
    const f = fixture(bookings);
    const rows = await f.DataService.fetchBookingsEndingAfter(['p1'], now);
    assert.deepEqual(rows.map(row => row.id).sort(), ['future', 'long']);
    assert.equal(f.reads[0].child, 'checkOutDate');
    assert.equal(f.reads[0].lower, checkoutQueryLowerBound(now));
});

test('checkout query safely includes local, UTC and offset timestamps around midnight', async () => {
    const start = Date.parse('2026-09-24T00:00:00+07:00');
    const f = fixture({
        utc: booking('utc', '2026-09-01T00:00:00Z', '2026-09-23T18:00:00Z'),
        offset: booking('offset', '2026-09-01T00:00:00Z', '2026-09-23T04:30:00-14:00'),
        local: booking('local', '2026-09-01T00:00:00', '2026-09-25T10:00:00.000'),
    });
    assert.equal((await f.DataService.fetchBookingsEndingAfter(['p1'], start)).length, 3);
});

test('room state uses earliest cleaning and includes a stay ending afterwards', () => {
    const f = fixture();
    const values = [];
    f.DataService.subscribeRoomStateBookings([room], rows => values.push(rows));
    assert.equal(f.listeners[0].ref.child, 'checkOutDate');
    const ended = booking('ended', iso(now - 1800000), iso(now - 1000));
    f.listeners[0].next(f.snap({ ended }));
    assert.equal(deriveRoomOperationalStatus(room, values[0], now), R.VACANT_DIRTY);
    f.realtimePool.clear();
});

test('one legacy room keeps full property history: old uncleaned stays are never discarded', () => {
    assert.equal(roomHistoryStart([room, { lastCleanedAt: undefined }]), 0);
    assert.equal(roomHistoryStart([room, { lastCleanedAt: NaN }]), 0);
    const f = fixture(), values = [];
    const legacyRoom = { ...room, lastCleanedAt: undefined };
    f.DataService.subscribeRoomStateBookings([legacyRoom], rows => values.push(rows));
    assert.equal(f.listeners[0].ref.child, 'propertyId');
    const old = booking('old', iso(now - 365 * 86400000), iso(now - 364 * 86400000));
    f.listeners[0].next(f.snap({ old }));
    assert.equal(deriveRoomOperationalStatus(legacyRoom, values[0], now), R.VACANT_DIRTY);
    f.realtimePool.clear();
});

test('route changes reuse the live subscription and receive updates made while no view was attached', () => {
    const pool = createRealtimePool(), values = [];
    let opens = 0, closes = 0, publish;
    const start = next => { opens++; publish = next; return () => { closes++; }; };
    const leave = pool.subscribe('tenant/p1', start, value => values.push(value));
    publish(1); leave(); publish(2);
    const leaveAgain = pool.subscribe('tenant/p1', start, value => values.push(value));
    assert.equal(opens, 1);
    assert.deepEqual(values, [1, 2]);
    leaveAgain(); pool.clear();
    assert.equal(closes, 1);
});

test('unused realtime queries stop after the grace period', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pool = createRealtimePool(15000);
    let closes = 0;
    pool.subscribe('query', () => () => { closes++; }, () => {})();
    t.mock.timers.tick(14999);
    assert.equal(closes, 0);
    t.mock.timers.tick(1);
    assert.equal(closes, 1);
    pool.clear();
});

test('logout immediately detaches retained listeners and never replays old session data', () => {
    const f = fixture(), first = [], second = [];
    f.DataService.subscribeBookingsForPropertiesView(['p1'], rows => first.push(rows));
    f.listeners[0].next(f.snap({ b: booking('b', iso(now), iso(now + 3600000)) }));
    f._clearSessionCache();
    assert.equal(f.listeners[0].stopped, true);
    f.DataService.subscribeBookingsForPropertiesView(['p1'], rows => second.push(rows));
    assert.deepEqual(second, [[]]);
    f.listeners[0].next(f.snap({ b: booking('b', iso(now), iso(now + 3600000)) }));
    assert.equal(first.length, 1);
});

test('cancelled permission-denied query is discarded and a retry starts a new listener', () => {
    const pool = createRealtimePool();
    let fail, opens = 0;
    const errors = [];
    const start = (_, error) => { opens++; fail = error; return () => {}; };
    pool.subscribe('query', start, () => {}, error => errors.push(error));
    fail('PERMISSION_DENIED');
    pool.subscribe('query', start, () => {}, error => errors.push(error));
    assert.equal(opens, 2);
    assert.deepEqual(errors, ['PERMISSION_DENIED']);
    pool.clear();
});

test('calendar never publishes a partial multi-day snapshot as an empty available room', () => {
    const f = fixture(), values = [];
    f.DataService.subscribeOperationalBookings(['p1'], '2026-09-23T00:00:00', '2026-09-25T00:00:00', rows => values.push(rows), assert.fail, 0);
    assert.equal(f.listeners.length, 2);
    f.listeners[0].next(f.snap(null));
    assert.equal(values.length, 0);
    f.listeners[1].next(f.snap({ future: booking('future', '2026-09-24T10:00:00', '2026-09-24T12:00:00') }));
    assert.equal(values.length, 1);
    assert.equal(values[0][0].id, 'future');
    f.realtimePool.clear();
});
