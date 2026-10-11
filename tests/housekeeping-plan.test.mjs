import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createLoader } from './load-ts.mjs';
const load = createLoader();
const { buildCleaningJobs, planHousekeeping, cleaningWarnings, housekeepingWorkers, housekeepingScope } = load('utils/housekeepingPlan.ts');
const { normalizeNotificationSettings, normalizeHousekeepingSettings } = load('types.ts');
const at = value => Date.parse(`2026-10-${value}+07:00`);
const now = at('10T07:00:00');
const rooms = ['401', '402', '201'].map(id => ({ id, propertyId: 'p3', number: `HD3. ${id}`, status: 'OCCUPIED' }));
const worker = { id: 'a', name: 'Chị A', propertyIds: ['p3'], shiftStart: '08:00', shiftEnd: '22:00', cleaningMinutes: 30, travelMinutes: 15, weekdays: [0, 1, 2, 3, 4, 5, 6] };
const b = (id, roomId, start, end, extra = {}) => ({ id, roomId, propertyId: 'p3', checkInDate: new Date(start).toISOString(), checkOutDate: new Date(end).toISOString(), status: 'CONFIRMED', ...extra });
const pair = (roomId, checkout, checkin, extra = {}) => [b(`old${roomId}`, roomId, at('09T20:00:00'), checkout, extra), b(`new${roomId}`, roomId, checkin, checkin + 3 * 3600000, extra)];
const plan = (bookings, staff = [worker], list = rooms) => planHousekeeping(buildCleaningJobs(bookings, list, now, at('13T00:00:00')), staff);

test('late-night checkout cannot be cleaned before the next 08:00 shift', () => {
    const [job] = plan(pair('401', at('10T23:00:00'), at('11T08:00:00')));
    assert.equal(job.end, at('11T08:30:00')); assert.equal(job.late, true);
});
test('overnight warning distinguishes this guest from the next guest using actual shift hours', () => {
    const before = pair('401', at('10T23:00:00'), at('11T08:00:00'));
    const added = b('overnight', '401', at('11T01:00:00'), at('11T06:00:00'));
    const warnings = cleaningWarnings(before, [...before, added], [rooms[0]], { workers: [worker] }, [added.id], now);
    const own = warnings.find(w => w.bookingId === added.id);
    const next = warnings.find(w => w.bookingId === 'new401');
    assert.match(own.bookingPeriod, /01:00–06:00/);
    assert.match(own.message, /Khách trước trả phòng lúc 23:00 hôm trước/);
    assert.doesNotMatch(own.message, /Khách đến|01:00/);
    assert.match(own.message, /08:00.*mới có người dọn/);
    assert.match(next.message, /Khách tiếp theo.*08:00.*09:00.*mới dọn xong/);
    assert.equal(next.relatedBooking, true);
    const laterShift = cleaningWarnings(before, [...before, added], [rooms[0]], { workers: [{ ...worker, shiftStart: '09:00' }] }, [added.id], now);
    assert.match(laterShift.find(w => w.bookingId === added.id).message, /09:00.*mới có người dọn/);
});
test('two rooms at 08:00 with 08:30 arrivals share one worker, not two', () => {
    const jobs = plan([...pair('401', at('10T08:00:00'), at('10T08:30:00')), ...pair('402', at('10T08:00:00'), at('10T08:30:00'))]);
    assert.equal(jobs.filter(j => j.late).length, 1);
    assert.deepEqual(jobs.map(j => j.end).sort(), [at('10T08:30:00'), at('10T09:00:00')]);
});
test('the three-room example warns for one room; tight arrivals are cleaned first', () => {
    const jobs = plan([...pair('401', at('10T08:00:00'), at('10T09:00:00')), ...pair('402', at('10T08:00:00'), at('10T08:30:00')), ...pair('201', at('10T08:30:00'), at('10T09:00:00'))]);
    assert.equal(jobs.filter(j => j.late).length, 1);
    assert.equal(Math.max(...jobs.map(j => j.end)), at('10T09:30:00'));
});
test('a shared worker reserves travel time and cannot clean at both properties at once', () => {
    const jobs = plan([...pair('401', at('10T08:00:00'), at('10T08:30:00')), ...pair('402', at('10T08:00:00'), at('10T09:00:00'), { propertyId: 'p4' })], [{ ...worker, propertyIds: ['p3', 'p4'] }], [rooms[0], { ...rooms[1], propertyId: 'p4' }]);
    assert.equal(jobs.find(j => j.propertyId === 'p4').end, at('10T09:15:00'));
    assert.equal(jobs.filter(j => j.late).length, 1);
});
test('two distinct employees can clean two rooms simultaneously', () => {
    const jobs = plan([...pair('401', at('10T08:00:00'), at('10T08:30:00')), ...pair('402', at('10T08:00:00'), at('10T08:30:00'))], [worker, { ...worker, id: 'b' }]);
    assert.ok(jobs.every(j => !j.late)); assert.equal(new Set(jobs.map(j => j.workerId)).size, 2);
});
test('work must finish within the shift; breaks, weekly rest and leave are respected', () => {
    assert.equal(plan(pair('401', at('10T21:45:00'), at('10T22:30:00')))[0].end, at('11T08:30:00'));
    assert.equal(plan(pair('401', at('10T12:00:00'), at('10T12:30:00')), [{ ...worker, breakStart: '12:00', breakEnd: '13:00' }])[0].end, at('10T13:30:00'));
    assert.equal(plan(pair('401', at('10T08:00:00'), at('10T09:00:00')), [{ ...worker, daysOff: ['2026-10-10'] }])[0].end, at('11T08:30:00'));
    assert.equal(plan(pair('401', at('10T08:00:00'), at('10T09:00:00')), [{ ...worker, weekdays: [0] }])[0].end, at('11T08:30:00'));
});
test('a ready room can receive guests outside housekeeping hours; a dirty room needs cleaning', () => {
    const bookings = pair('401', at('10T06:00:00'), at('11T07:00:00'));
    assert.equal(plan(bookings, [worker], [{ ...rooms[0], status: 'VACANT_CLEAN', lastCleanedAt: at('10T06:30:00') }]).length, 0);
    const jobs = buildCleaningJobs([b('new', '401', at('10T08:00:00'), at('10T10:00:00'))], [{ ...rooms[0], status: 'VACANT_DIRTY' }], now, at('11T00:00:00'));
    assert.equal(planHousekeeping(jobs, [worker])[0].end, at('10T08:30:00'));
});
test('new cleaning has not yet happened when a previous cleaning timestamp precedes checkout', () => {
    const jobs = plan(pair('401', at('10T08:00:00'), at('10T08:30:00')), [worker], [{ ...rooms[0], status: 'VACANT_CLEAN', lastCleanedAt: at('09T07:00:00') }]);
    assert.equal(jobs.length, 1);
});
test('a clean label without a confirmation timestamp cannot erase a past uncleaned stay', () => {
    const jobs = buildCleaningJobs(pair('401', at('10T06:00:00'), at('10T08:00:00')), [{ ...rooms[0], status: 'VACANT_CLEAN' }], now, at('11T00:00:00'));
    assert.equal(jobs.length, 1);
    const markedDirty = buildCleaningJobs(pair('401', at('10T06:00:00'), at('10T08:00:00')), [{ ...rooms[0], status: 'VACANT_DIRTY', lastCleanedAt: at('10T06:30:00') }], now, at('11T00:00:00'));
    assert.equal(markedDirty.length, 1);
});
test('deleted and held bookings do not generate fictitious cleaning jobs', () => {
    const bookings = pair('401', at('10T08:00:00'), at('10T08:30:00'));
    assert.equal(plan(bookings.map(row => ({ ...row, status: 'DELETED' }))).length, 0);
    assert.equal(plan(bookings.map(row => ({ ...row, isHold: true }))).length, 0);
});
test('warning includes an existing booking made late by a newly added earlier arrival', () => {
    const before = pair('401', at('10T08:00:00'), at('10T08:30:00'));
    const added = pair('402', at('10T08:00:00'), at('10T08:20:00'));
    const warnings = cleaningWarnings(before, [...before, ...added], rooms, { workers: [worker] }, added.map(b => b.id), now);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.some(w => w.bookingId === 'new401'));
});
test('an unrelated existing late booking does not produce a warning on every save', () => {
    const before = pair('401', at('10T08:00:00'), at('10T08:10:00'));
    const added = b('later', '402', at('11T15:00:00'), at('11T17:00:00'));
    assert.equal(cleaningWarnings(before, [...before, added], rooms, { workers: [worker] }, ['later'], now).length, 0);
});
test('shared-worker scope expands transitively and default capacity is only for unassigned branches', () => {
    const settings = { workers: [worker, { ...worker, id: 'b', propertyIds: ['p3', 'p4'] }, { ...worker, id: 'c', propertyIds: ['p4', 'p5'] }] };
    assert.deepEqual(housekeepingScope(settings, ['p3']), ['p3', 'p4', 'p5']);
    assert.equal(housekeepingWorkers(settings, ['p3', 'p4', 'p5', 'p6']).filter(w => w.id.startsWith('default:')).length, 1);
    assert.deepEqual(normalizeNotificationSettings({ housekeeping: settings }).housekeeping, normalizeHousekeepingSettings(settings));
});

function fixture() {
    const bookings = Object.fromEntries(pair('401', at('10T23:00:00'), at('11T08:00:00')).slice(0, 1).map(b => [b.id, { ...b, tenantId: 'tenant' }]));
    const data = { tenants: { tenant: { bookings, rooms: { '401': { ...rooms[0], tenantId: 'tenant' } }, roomPolicies: {}, notificationSettings: { housekeeping: { workers: [worker] } } } } };
    const reads = [], writes = [];
    const read = key => key.split('/').reduce((v, p) => v?.[p], data) ?? null;
    const snap = value => ({ val: () => structuredClone(value), exists: () => value != null });
    const sdk = {
        ref: (_, key = '') => ({ key }), query: (ref, ...parts) => ({ ...ref, ...Object.assign({}, ...parts) }), orderByChild: child => ({ child }), equalTo: equal => ({ equal }), startAt: lower => ({ lower }), endAt: upper => ({ upper }),
        get: async ref => { reads.push(ref); let value = read(ref.key); if (ref.child) value = Object.fromEntries(Object.entries(value || {}).filter(([, item]) => ref.equal !== undefined ? item[ref.child] === ref.equal : (ref.lower === undefined || item[ref.child] >= ref.lower) && (ref.upper === undefined || item[ref.child] <= ref.upper))); return snap(value); },
        update: async (_, updates) => { writes.push(updates); for (const [key, value] of Object.entries(updates)) { const parts = key.split('/'), last = parts.pop(); let parent = data; for (const part of parts) parent = parent[part] ??= {}; if (value === null) delete parent[last]; else parent[last] = structuredClone(value); } },
        set: async (ref, value) => { const parts = ref.key.split('/'), last = parts.pop(); let parent = data; for (const part of parts) parent = parent[part] ??= {}; parent[last] = structuredClone(value); },
    };
    const file = path.resolve('services/dataService.ts');
    const module = createLoader({ 'firebase/app': {}, 'firebase/database': sdk }, { [file]: '\n db = {}; isFirebaseReady = true; activeTenantId = "tenant";\nexport { CACHE };' })(file);
    module.CACHE.rooms = Object.values(data.tenants.tenant.rooms);
    module.CACHE.properties = [{ id: 'p3', tenantId: 'tenant', name: 'CS3' }];
    return { ...module, writes, reads, data };
}
test('saving requires explicit acknowledgement, cancellation writes nothing, confirmation saves and audits', async t => {
    t.mock.timers.enable({ apis: ['Date'], now });
    const f = fixture(), proposal = b('NEW', '401', at('11T08:00:00'), at('11T10:00:00'), { tenantId: 'tenant' });
    let warning;
    try { await f.DataService.saveBookingGroup({ upserts: [{ booking: proposal, mode: 'create' }] }); } catch (e) { warning = e; }
    assert.ok(warning instanceof f.HousekeepingWarningError); assert.equal(f.writes.length, 0);
    await f.DataService.saveBookingGroup({ upserts: [{ booking: proposal, mode: 'create' }] }, { housekeepingAcknowledgement: warning.acknowledgement, staffId: 'sale' });
    assert.ok(f.data.tenants.tenant.bookings.NEW);
    assert.ok(Object.values(f.data.tenants.tenant.history).some(h => h.metadata?.housekeepingConfirmation?.confirmedBy === 'sale'));
});
test('a confirmation becomes invalid when the underlying shared schedule changes', async t => {
    t.mock.timers.enable({ apis: ['Date'], now });
    const f = fixture(), proposal = b('NEW', '401', at('11T08:00:00'), at('11T10:00:00'), { tenantId: 'tenant' });
    let token;
    await assert.rejects(f.DataService.saveBookingGroup({ upserts: [{ booking: proposal, mode: 'create' }] }), e => { token = e.acknowledgement; return e instanceof f.HousekeepingWarningError; });
    f.data.tenants.tenant.notificationSettings.housekeeping.workers[0].cleaningMinutes = 45;
    await assert.rejects(f.DataService.saveBookingGroup({ upserts: [{ booking: proposal, mode: 'create' }] }, { housekeepingAcknowledgement: token }), f.HousekeepingWarningError);
    assert.equal(f.writes.length, 0);
});
test('gaps below 30 minutes remain blocked before and after a stay; exactly 30 minutes is allowed', async t => {
    t.mock.timers.enable({ apis: ['Date'], now });
    const f = fixture();
    assert.equal((await f.DataService.validateRoomAvailabilityRemote('p3', '401', new Date(at('10T23:10:00')).toISOString(), new Date(at('11T01:00:00')).toISOString())).valid, false);
    assert.equal((await f.DataService.validateRoomAvailabilityRemote('p3', '401', new Date(at('10T22:50:00')).toISOString(), new Date(at('11T01:00:00')).toISOString())).valid, false);
    assert.equal((await f.DataService.validateRoomAvailabilityRemote('p3', '401', new Date(at('10T23:30:00')).toISOString(), new Date(at('11T01:00:00')).toISOString())).valid, true);
    assert.equal((await f.DataService.validateRoomAvailabilityRemote('p3', '401', new Date(at('09T18:00:00')).toISOString(), new Date(at('09T19:31:00')).toISOString())).valid, false);
    assert.equal((await f.DataService.validateRoomAvailabilityRemote('p3', '401', new Date(at('09T18:00:00')).toISOString(), new Date(at('09T19:30:00')).toISOString())).valid, true);
});

test('housekeeping confirmation cannot bypass the 30-minute rule for group or single saves', async t => {
    t.mock.timers.enable({ apis: ['Date'], now });
    const f = fixture();
    const proposal = b('TOO_CLOSE', '401', at('10T23:10:00'), at('11T01:00:00'), { tenantId: 'tenant' });
    await assert.rejects(f.DataService.saveBookingGroup({ upserts: [{ booking: proposal, mode: 'create' }] }, { housekeepingAcknowledgement: 'confirmed' }), /Trùng đơn/);
    await assert.rejects(f.DataService.addBooking(proposal, { housekeepingAcknowledgement: 'confirmed' }), /Trùng đơn/);
    assert.equal(f.writes.length, 0);
});
