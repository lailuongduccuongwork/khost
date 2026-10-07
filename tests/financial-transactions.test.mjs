import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createLoader } from './load-ts.mjs';

const load = createLoader();
const { buildFinancialTransactions, transactionsFromHistory, exportFinancialTransactions, displayTransactionAmount, formatFinancialDate, summarizeFinancialTransactions, transactionTypeLabel } = load('utils/financialTransactions.ts');
const { BookingStatus: B } = load('types.ts');
const context = {
    rooms: [{ id: 'r1', propertyId: 'p1', number: 'HD4. 501', typeId: 't1' }],
    roomTypes: [{ id: 't1', name: 'HD CS4 T5' }], properties: [{ id: 'p1', name: 'HD CS4' }],
    tags: [{ id: 'tag1', name: 'Khách tin nhắn' }], users: [{ id: 'u1', username: 'sale' }],
};
const fee = (amount = 50000, extra = {}) => ({ id: 'f1', categoryId: 'service', name: 'Phụ thu dịch vụ', type: 'REVENUE', amount, ...extra });
const booking = (extra = {}) => ({
    id: '2610-5816', tenantId: 'tenant', propertyId: 'p1', roomId: 'r1', customerId: 'c1', guestName: 'Khách ABC', guestPhone: '',
    checkInDate: '2026-10-09T17:00:00+07:00', checkOutDate: '2026-10-09T21:00:00+07:00',
    createdAt: '2026-10-07T19:57:16+07:00', createdBy: 'u1', status: B.CONFIRMED,
    totalPrice: 125000, paidAmount: 0, tags: ['tag1'], extraFees: [], ...extra,
});
const event = { id: 'event', timestamp: '2026-10-07T13:00:02.000Z', performedBy: 'reception' };
const make = (before, after, overrides = {}) => buildFinancialTransactions(before, after, context, { ...event, includePayments: false, ...overrides });
const payments = (before, after, overrides = {}) => make(before, after, { includePayments: true, ...overrides });

test('adding a surcharge records one row with separate labels and correct bill/net/debt', () => {
    const rows = make([booking()], [booking({ totalPrice: 175000, paidAmount: 175000, extraFees: [fee()] })]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].amount, rows[0].roomPrice, rows[0].otherRevenue, rows[0].totalBill, rows[0].netRevenue, rows[0].debt], [50000, 125000, 50000, 175000, 175000, 0]);
    assert.deepEqual([rows[0].room, rows[0].roomType, rows[0].property, rows[0].tags, rows[0].createdBy, rows[0].performedBy], ['HD4. 501', 'HD CS4 T5', 'HD CS4', 'Khách tin nhắn', 'sale', 'reception']);
    assert.equal(formatFinancialDate(rows[0].timestamp), '07/10/2026 20:00:02');
});

test('fees already present on booking creation are individual transactions, not a combined total', () => {
    const rows = make([], [booking({ extraFees: [fee(), fee(10000, { id: 'f2', type: 'EXPENSE' })], totalPrice: 165000 })]);
    assert.deepEqual(rows.map(r => r.amount), [50000, 10000]);
    assert.equal(rows[1].roomPrice, 125000);
    assert.equal(rows[1].totalBill, 175000);
    assert.equal(rows[1].netRevenue, 165000);
    assert.equal(displayTransactionAmount(rows[1]), -10000);
});

test('editing records only the monetary difference; unchanged and renamed fees do not inflate totals', () => {
    const before = booking({ extraFees: [fee()], totalPrice: 175000 });
    assert.equal(make([before], [before]).length, 0);
    assert.equal(make([before], [booking({ ...before, extraFees: [fee(50000, { name: 'Đổi tên' })] })]).length, 0);
    const rows = make([before], [booking({ extraFees: [fee(70000)], totalPrice: 195000 })]);
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, 20000); assert.equal(rows[0].otherRevenue, 70000);
});

test('deleting a fee reverses it; deleting the booking does not erase or reverse past transactions', () => {
    const before = booking({ extraFees: [fee()], totalPrice: 175000 });
    assert.equal(make([before], [booking()])[0].amount, -50000);
    assert.equal(make([before], [], { deletedBookingIds: [before.id] }).length, 0);
});

test('changing a fee from revenue to expense records reversal and replacement', () => {
    const rows = make([booking({ extraFees: [fee()], totalPrice: 175000 })], [booking({ extraFees: [fee(50000, { type: 'EXPENSE' })], totalPrice: 75000 })]);
    assert.deepEqual(rows.map(r => [r.type, r.amount, displayTransactionAmount(r)]), [['REVENUE', -50000, -50000], ['EXPENSE', 50000, -50000]]);
    assert.equal(rows[1].totalBill, 125000);
});

test('group snapshots include all rooms and fees without multiplying the transaction', () => {
    const leader = booking({ groupId: 'g1', totalPrice: 125000 });
    const child = booking({ id: 'child', groupId: 'g1', totalPrice: 125000 });
    const next = { ...leader, totalPrice: 175000, paidAmount: 300000, extraFees: [fee()] };
    const rows = make([leader, child], [next, child]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].roomPrice, rows[0].totalBill, rows[0].netRevenue, rows[0].paidAmount], [250000, 300000, 300000, 300000]);
    const moved = make([next, child], [{ ...leader, paidAmount: 0 }, { ...child, totalPrice: 175000, paidAmount: 300000, extraFees: [fee()] }]);
    assert.equal(moved.length, 0);
});

test('unrelated bookings that reuse a legacy fee ID still produce separate transactions', () => {
    const first = booking({ extraFees: [fee()], totalPrice: 175000 });
    const second = booking({ id: 'another' });
    const rows = make([first, second], [first, { ...second, extraFees: [fee()], totalPrice: 175000 }]);
    assert.equal(rows.length, 1); assert.equal(rows[0].bookingId, 'another'); assert.equal(rows[0].amount, 50000);
});

test('immutable recorded rows survive catalogue changes and booking deletion; duplicate audit snapshots are ignored', () => {
    const row = make([booking()], [booking({ totalPrice: 175000, extraFees: [fee()] })])[0];
    const logs = [
        { id: 'log1', metadata: { financialReportVersion: 1, financialTransactions: [row] } },
        { id: 'log2', action: 'UPDATE', entityType: 'BOOKING', before: booking(), after: booking({ extraFees: [fee()] }), metadata: { financialReportVersion: 1 } },
    ];
    const restored = transactionsFromHistory(logs, { ...context, rooms: [], users: [], tags: [] });
    assert.equal(restored.length, 1); assert.deepEqual(restored[0], row);
});

test('old detailed and general audit records reconstruct additions, changes and last-fee removal', () => {
    const before = booking({ totalPrice: 175000, extraFees: [fee()] });
    const next = booking({ totalPrice: 195000, extraFees: [fee(70000)] });
    const logs = [
        { id: 'old1', timestamp: event.timestamp, action: 'UPDATE', entityType: 'BOOKING', before, after: next, metadata: { changeKey: 'extraFees', beforeValue: fee(), afterValue: fee(70000) } },
        { id: 'old2', timestamp: event.timestamp, action: 'DELETE', entityType: 'BOOKING', before: next, after: booking({ extraFees: undefined }), metadata: { changeKey: 'extraFees', beforeValue: fee(70000), afterValue: null } },
    ];
    assert.deepEqual(transactionsFromHistory(logs, context).map(r => r.amount), [20000, -70000]);
    const legacyGroup = transactionsFromHistory([{ ...logs[0], before: { ...before, groupId: 'g' }, after: { ...next, groupId: 'g' } }], context)[0];
    assert.equal(legacyGroup.totalBill, null); // Do not invent group totals absent from the old logs.
});

test('payment-only changes are separate from surcharges and imports do not create receipts', () => {
    const b = booking({ extraFees: [fee()] });
    const rows = transactionsFromHistory([{ id: 'x', timestamp: event.timestamp, action: 'UPDATE', entityType: 'BOOKING', before: b, after: { ...b, paidAmount: 100000 } }], context);
    assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'BOOKING_PAYMENT'); assert.equal(rows[0].amount, 100000);
    assert.equal(transactionsFromHistory([{ id: 'x', timestamp: event.timestamp, action: 'CREATE', source: 'IMPORT', entityType: 'BOOKING', after: b }], context).length, 0);
});

test('Excel export preserves all 22 separate columns and numeric values in the agreed order', () => {
    const row = make([], [booking({ extraFees: [fee()], totalPrice: 175000 })])[0];
    const exported = exportFinancialTransactions([row])[0];
    assert.equal(Object.keys(exported).length, 22);
    assert.deepEqual(Object.keys(exported).slice(13, 16), ['Tiền phòng', 'Thu khác', 'Tổng bill']);
    assert.equal(exported['Thời gian giao dịch'], '07/10/2026 20:00:02');
    assert.equal(exported['Số tiền giao dịch'], 50000);
});

test('initial payment and the subsequent balance payment match the two user examples', () => {
    const first = booking({ id: 'ABC', totalPrice: 1500000, paidAmount: 1000000 });
    const second = { ...first, paidAmount: 1500000 };
    const rows = [
        ...payments([], [first], { id: 'first', timestamp: '2026-09-05T08:31:18+07:00' }),
        ...payments([first], [second], { id: 'second', timestamp: '2026-09-06T22:06:17+07:00' }),
    ];
    assert.deepEqual(rows.map(r => [r.kind, r.amount, r.totalBill, r.paidAmount, r.debt]), [
        ['BOOKING_PAYMENT', 1000000, 1500000, 1000000, 500000],
        ['BOOKING_PAYMENT', 500000, 1500000, 1500000, 0],
    ]);
    assert.deepEqual(rows.map(r => exportFinancialTransactions([r])[0]['Thời gian giao dịch']), ['05/09/2026 08:31:18', '06/09/2026 22:06:17']);
    assert.equal(exportFinancialTransactions(rows)[1]['Loại giao dịch'], 'Thanh toán đặt phòng');
    assert.equal(payments([second], [{ ...second, guestName: 'Đổi tên', totalPrice: 1600000 }]).length, 0);
});

test('decreasing the cumulative paid balance records an adjustment without claiming a refund', () => {
    const before = booking({ totalPrice: 1500000, paidAmount: 1500000 });
    const rows = payments([before], [{ ...before, paidAmount: 1200000 }]);
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, -300000);
    assert.equal(rows[0].content, 'Điều chỉnh giảm đã trả');
    assert.equal(transactionTypeLabel(rows[0]), 'Điều chỉnh thanh toán');
    assert.equal(rows[0].debt, 300000);
    assert.equal(payments([before], [], { deletedBookingIds: [before.id] }).length, 0);
});

test('simultaneous fees and payments remain separate in the financial totals', () => {
    const rows = payments([booking()], [booking({ totalPrice: 165000, paidAmount: 175000, extraFees: [fee(), fee(10000, { id: 'expense', type: 'EXPENSE' })] })]);
    assert.equal(rows.length, 3);
    assert.deepEqual(summarizeFinancialTransactions(rows), { payments: 175000, extraRevenue: 50000, extraExpenses: 10000 });
    assert.equal(rows.find(r => r.kind === 'BOOKING_PAYMENT').totalBill, 175000);
    // Stored version-one fee rows did not have a kind field.
    assert.equal(summarizeFinancialTransactions([{ ...rows[0], kind: undefined }]).extraRevenue, 50000);
});

test('group payments compare the whole balance including changes of leader', () => {
    const leader = booking({ groupId: 'group', paidAmount: 100000, totalPrice: 500000 });
    const child = booking({ id: 'child', groupId: 'group', totalPrice: 1000000 });
    const nextLeader = { ...child, paidAmount: 1500000 };
    const rows = payments([leader, child], [{ ...leader, paidAmount: 0 }, nextLeader]);
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, 1400000);
    assert.equal(rows[0].totalBill, 1500000); assert.equal(rows[0].debt, 0);
    assert.equal(payments([leader, child], [{ ...leader, paidAmount: 0 }, { ...child, paidAmount: 100000 }]).length, 0);
    assert.equal(payments([leader, child], [{ ...child, paidAmount: 100000 }], { deletedBookingIds: [leader.id] }).length, 0);
    assert.equal(payments([], [leader, child]).filter(r => r.kind === 'BOOKING_PAYMENT').length, 1);
});

test('legacy field-specific logs deduplicate a payment and preserve its fee event', () => {
    const before = booking({ totalPrice: 1500000, paidAmount: 1000000, updatedAt: '2026-09-05T01:31:18Z' });
    const after = { ...before, totalPrice: 1550000, paidAmount: 1500000, extraFees: [fee()], updatedAt: '2026-09-06T15:06:17Z' };
    const base = { timestamp: after.updatedAt, entityType: 'BOOKING', actorUsername: 'sale', before, after };
    const rows = transactionsFromHistory([
        { ...base, id: 'price', action: 'UPDATE', metadata: { changeKey: 'totalPrice' } },
        { ...base, id: 'fee', action: 'CREATE', metadata: { changeKey: 'extraFees', afterValue: fee() } },
        { ...base, id: 'clear-note', action: 'DELETE', metadata: { changeKey: 'notes' } },
    ], context);
    assert.deepEqual(rows.filter(r => r.kind === 'BOOKING_PAYMENT').map(r => r.amount), [500000]);
    assert.deepEqual(rows.filter(r => r.kind === 'EXTRA_FEE').map(r => r.amount), [50000]);
});

test('legacy group revisions do not misinterpret moving a balance as a payment', () => {
    const leader = booking({ groupId: 'group', paidAmount: 1000000 });
    const child = booking({ id: 'child', groupId: 'group' });
    const updatedAt = '2026-09-06T15:06:17Z';
    const logs = [leader, child].map((before, i) => ({
        id: `old${i}`, timestamp: updatedAt, action: 'UPDATE', entityType: 'BOOKING', before,
        after: { ...before, updatedAt, paidAmount: i ? 1000000 : 0 },
    }));
    assert.equal(transactionsFromHistory(logs, context).length, 0);
    logs[1].after.paidAmount = 1500000;
    const rows = transactionsFromHistory(logs, context);
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, 500000);
    assert.equal(rows[0].totalBill, null);
});

test('version-one audits recover payments, version-two audits use the stored payment only', () => {
    const before = booking({ totalPrice: 1500000, paidAmount: 1000000 });
    const after = { ...before, paidAmount: 1500000, extraFees: [fee()] };
    const base = { id: 'audit', timestamp: event.timestamp, entityType: 'BOOKING', action: 'UPDATE', before, after };
    const restored = transactionsFromHistory([{ ...base, metadata: { financialReportVersion: 1 } }], context);
    assert.equal(restored.length, 1); assert.equal(restored[0].kind, 'BOOKING_PAYMENT'); assert.equal(restored[0].amount, 500000);
    const stored = payments([before], [after]);
    const rows = transactionsFromHistory([
        { ...base, metadata: { financialReportVersion: 2 } },
        { id: 'ledger', timestamp: event.timestamp, metadata: { financialReportVersion: 2, financialTransactions: stored } },
    ], context);
    assert.equal(rows.length, stored.length);
    assert.equal(rows.filter(r => r.kind === 'BOOKING_PAYMENT').length, 1);
});

test('legacy updates lacking a previous paid balance cannot invent a receipt', () => {
    const before = booking({ paidAmount: undefined });
    const after = booking({ paidAmount: 1000000 });
    assert.equal(transactionsFromHistory([{ id: 'unknown', timestamp: event.timestamp, action: 'UPDATE', entityType: 'BOOKING', before, after }], context).length, 0);
});

function fixture(bookings = {}, history = {}) {
    const data = { tenants: { tenant: { bookings, history, roomPolicies: {} } } };
    const writes = [], reads = [];
    let failWrite = false;
    let missingTimestampIndex = false;
    let readError = null;
    const read = key => key.split('/').reduce((v, p) => v?.[p], data) ?? null;
    const snap = value => ({ val: () => structuredClone(value), exists: () => value != null });
    const sdk = {
        ref: (_, key = '') => ({ key }), query: (ref, ...parts) => ({ ...ref, ...Object.assign({}, ...parts) }),
        orderByChild: child => ({ child }), orderByKey: () => ({ byKey: true }), equalTo: equal => ({ equal }), startAt: lower => ({ lower }), endAt: upper => ({ upper }),
        get: async ref => {
            reads.push(ref);
            if (readError) throw readError;
            if (missingTimestampIndex && ref.child === 'timestamp') throw new Error('Index not defined, add ".indexOn": "timestamp", for path /tenants/tenant/history');
            let value = read(ref.key);
            if (ref.child) value = Object.fromEntries(Object.entries(value || {}).filter(([, item]) => ref.equal !== undefined ? item[ref.child] === ref.equal : item[ref.child] >= ref.lower && item[ref.child] <= ref.upper));
            if (ref.byKey) value = Object.fromEntries(Object.entries(value || {}).filter(([key]) => key >= ref.lower && key <= ref.upper));
            return snap(value);
        },
        update: async (_, updates) => {
            if (failWrite) throw new Error('Network write failed');
            writes.push(structuredClone(updates));
            for (const [key, value] of Object.entries(updates)) {
                const keys = key.split('/'); const leaf = keys.pop(); let parent = data;
                for (const part of keys) parent = parent[part] ??= {};
                if (value === null) delete parent[leaf]; else parent[leaf] = structuredClone(value);
            }
        },
        set: async () => {},
    };
    const file = path.resolve('services/dataService.ts');
    const module = createLoader({ 'firebase/app': {}, 'firebase/database': sdk }, {
        [file]: '\n db = {}; isFirebaseReady = true; activeTenantId = "tenant";\nexport { CACHE, _saveBookingAtomic, _saveBookingGroupAtomic };',
    })(file);
    Object.assign(module.CACHE, context);
    return { ...module, writes, reads, fail: () => { failWrite = true; }, missingIndex: () => { missingTimestampIndex = true; }, failRead: error => { readError = error; } };
}

test('a booking save commits its financial snapshot in the same write; retrying the saved booking adds nothing', async () => {
    const before = booking();
    const f = fixture({ [before.id]: before });
    const next = booking({ extraFees: [fee()], totalPrice: 175000 });
    await f._saveBookingAtomic(next, 'update');
    const paths = Object.keys(f.writes[0]);
    assert.ok(paths.includes(`tenants/tenant/bookings/${before.id}`));
    const historyPath = paths.find(p => p.includes('/history/'));
    assert.ok(historyPath);
    assert.equal(f.writes[0][historyPath].metadata.financialTransactions[0].amount, 50000);
    await f._saveBookingAtomic(next, 'update');
    assert.equal(Object.keys(f.writes[1]).filter(p => p.includes('/history/')).length, 0);
});

test('a failed booking write never leaves a successful financial snapshot in cache', async () => {
    const before = booking();
    const f = fixture({ [before.id]: before }); f.fail();
    await assert.rejects(f._saveBookingAtomic(booking({ extraFees: [fee()], totalPrice: 175000 }), 'update'), /Network write failed/);
    assert.equal(f.CACHE.history.length, 0); assert.equal(f.writes.length, 0);
});

test('saving the paid field commits only the increment and retry does not record it again', async () => {
    const before = booking({ totalPrice: 1500000, paidAmount: 1000000 });
    const f = fixture({ [before.id]: before });
    const next = { ...before, paidAmount: 1500000 };
    await f._saveBookingAtomic(next, 'update');
    const entry = Object.entries(f.writes[0]).find(([key]) => key.includes('/history/'))[1];
    assert.equal(entry.metadata.financialReportVersion, 2);
    assert.equal(entry.metadata.financialTransactions.length, 1);
    const row = entry.metadata.financialTransactions[0];
    assert.deepEqual([row.kind, row.amount, row.paidAmount, row.debt], ['BOOKING_PAYMENT', 500000, 1500000, 0]);
    await f._saveBookingAtomic(next, 'update');
    assert.equal(Object.keys(f.writes[1]).filter(key => key.includes('/history/')).length, 0);
});

test('the room-map group save commits one transaction with all room totals and ignores a fee transfer', async () => {
    const leader = booking({ groupId: 'g1' });
    const child = booking({ id: 'child', groupId: 'g1', roomId: 'r2' });
    const f = fixture({ [leader.id]: leader, child });
    f.CACHE.rooms = [
        { ...context.rooms[0], status: 'VACANT_CLEAN' },
        { ...context.rooms[0], id: 'r2', number: '502', status: 'VACANT_CLEAN' },
    ];
    const next = { ...leader, extraFees: [fee()], totalPrice: 175000 };
    await f._saveBookingGroupAtomic({ upserts: [{ booking: next, mode: 'update' }, { booking: child, mode: 'update' }] });
    const entries = Object.entries(f.writes[0]).filter(([key]) => key.includes('/history/'));
    assert.equal(entries.length, 1);
    const rows = entries[0][1].metadata.financialTransactions;
    assert.equal(rows.length, 1); assert.equal(rows[0].totalBill, 300000);
    await f._saveBookingGroupAtomic({ upserts: [
        { booking: leader, mode: 'update' },
        { booking: { ...child, extraFees: [fee()], totalPrice: 175000 }, mode: 'update' },
    ] });
    assert.equal(Object.keys(f.writes[1]).filter(key => key.includes('/history/')).length, 0);
});

test('room-map payments use fresh group balances and preserve totals when the paid balance moves', async () => {
    const leader = booking({ groupId: 'g1', totalPrice: 500000, paidAmount: 1000000 });
    const child = booking({ id: 'child', groupId: 'g1', roomId: 'r2', totalPrice: 1000000 });
    const f = fixture({ [leader.id]: leader, child });
    f.CACHE.bookings = [{ ...leader, paidAmount: 0 }, child]; // A stale local view must not inflate the receipt.
    f.CACHE.rooms = [
        { ...context.rooms[0], status: 'VACANT_CLEAN' },
        { ...context.rooms[0], id: 'r2', number: '502', status: 'VACANT_CLEAN' },
    ];
    await f._saveBookingGroupAtomic({ upserts: [{ booking: { ...leader, paidAmount: 1500000 }, mode: 'update' }, { booking: child, mode: 'update' }] });
    const entry = Object.entries(f.writes[0]).find(([key]) => key.includes('/history/'))[1];
    assert.equal(entry.metadata.financialTransactions.length, 1);
    assert.deepEqual([entry.metadata.financialTransactions[0].amount, entry.metadata.financialTransactions[0].totalBill], [500000, 1500000]);
    await f._saveBookingGroupAtomic({ upserts: [
        { booking: { ...leader, paidAmount: 0 }, mode: 'update' },
        { booking: { ...child, paidAmount: 1500000 }, mode: 'update' },
    ] });
    assert.equal(Object.keys(f.writes[1]).filter(key => key.includes('/history/')).length, 0);
});

test('range query uses the transaction timestamp and filters other properties and tenants', async () => {
    const row = make([], [booking({ extraFees: [fee()], totalPrice: 175000 })])[0];
    const logs = {
        good: { id: 'good', tenantId: 'tenant', timestamp: event.timestamp, metadata: { financialTransactions: [row] } },
        other: { id: 'other', tenantId: 'tenant', timestamp: event.timestamp, metadata: { financialTransactions: [{ ...row, id: 'other', propertyId: 'p2' }] } },
        tenant: { id: 'tenant', tenantId: 'another', timestamp: event.timestamp, metadata: { financialTransactions: [row] } },
        old: { id: 'old', tenantId: 'tenant', timestamp: '2026-10-06T12:00:00.000Z', metadata: { financialTransactions: [{ ...row, id: 'old', timestamp: '2026-10-06T12:00:00.000Z' }] } },
    };
    const f = fixture({}, logs);
    const rows = await f.DataService.fetchFinancialTransactions(['p1'], '2026-10-07T00:00:00+07:00', '2026-10-07T23:59:59.999+07:00');
    assert.equal(rows.length, 1); assert.equal(rows[0].id, row.id);
    assert.equal(f.reads[0].child, 'timestamp'); assert.equal(f.reads[0].lower, '2026-10-06T17:00:00.000Z');
});

test('missing timestamp index falls back to a bounded key query and remembers the missing index', async () => {
    const row = make([], [booking({ extraFees: [fee()], totalPrice: 175000 })])[0];
    const key = `log_${Date.parse(row.timestamp)}_test`;
    const f = fixture({}, { [key]: { id: key, tenantId: 'tenant', timestamp: row.timestamp, metadata: { financialTransactions: [row] } } });
    f.missingIndex();
    const from = '2026-10-07T00:00:00+07:00', to = '2026-10-07T23:59:59.999+07:00';
    assert.equal((await f.DataService.fetchFinancialTransactions(['p1'], from, to)).length, 1);
    assert.equal(f.reads.length, 2);
    assert.equal(f.reads[1].byKey, true);
    assert.equal(f.reads[1].lower, `log_${Date.parse(from) - 1000}_`);
    assert.equal(f.reads[1].upper, `log_${Date.parse(to) + 1000}_\uf8ff`);
    await f.DataService.fetchFinancialTransactions(['p1'], from, to);
    assert.equal(f.reads.length, 3); assert.equal(f.reads[2].byKey, true);
    assert.ok(f.reads.every(ref => ref.child || ref.byKey));
});

test('key fallback filters the clock-tolerance window against exact timestamps at Vietnam midnight', async () => {
    const from = '2026-10-07T00:00:00+07:00', to = '2026-10-07T23:59:59.999+07:00';
    const row = make([], [booking({ extraFees: [fee()], totalPrice: 175000 })])[0];
    const times = [Date.parse(from) - 1, Date.parse(from), Date.parse(to), Date.parse(to) + 1];
    const logs = Object.fromEntries(times.map((time, i) => {
        const timestamp = new Date(time).toISOString(), key = `log_${time}_test`;
        return [key, { id: key, tenantId: 'tenant', timestamp, metadata: { financialTransactions: [{ ...row, id: String(i), timestamp }] } }];
    }));
    const f = fixture({}, logs); f.missingIndex();
    assert.deepEqual((await f.DataService.fetchFinancialTransactions(['p1'], from, to)).map(row => row.id).sort(), ['1', '2']);
});

test('permission and network failures do not fall back to another history read', async () => {
    const f = fixture(); f.failRead(new Error('Permission denied'));
    await assert.rejects(f.DataService.fetchFinancialTransactions(['p1'], '2026-10-07T00:00:00+07:00', '2026-10-07T23:59:59.999+07:00'), /Permission denied/);
    assert.equal(f.reads.length, 1);
});

test('report booking details fetch the current balance and only group members in the requested branches', async () => {
    const leader = booking({ groupId: 'g1', totalPrice: 500000, paidAmount: 1000000 });
    const child = booking({ id: 'child', groupId: 'g1', totalPrice: 1000000 });
    const otherBranch = booking({ id: 'other-branch', groupId: 'g1', propertyId: 'p2' });
    const unrelated = booking({ id: 'unrelated', groupId: 'g2' });
    const deleted = booking({ id: 'deleted', groupId: 'g1', status: B.DELETED });
    const f = fixture(Object.fromEntries([leader, child, otherBranch, unrelated, deleted].map(b => [b.id, b])));
    f.CACHE.bookings = [{ ...leader, paidAmount: 0 }];
    assert.equal((await f.DataService.fetchBookingById(leader.id, { forceRemote: true })).paidAmount, 1000000);
    const members = await f.DataService.fetchBookingGroupMembers('g1', ['p1']);
    assert.deepEqual(members.map(b => b.id).sort(), [leader.id, child.id].sort());
    assert.equal(members.reduce((sum, b) => sum + b.totalPrice, 0), 1500000);
    assert.ok(f.reads.slice(1).every(ref => ref.child === 'propertyId' && ref.equal === 'p1'));
});
