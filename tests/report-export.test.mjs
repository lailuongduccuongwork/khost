import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoader } from './load-ts.mjs';

const load = createLoader();
const { COMPACT_TRANSACTION_COLUMNS, BOOKING_EXPORT_COLUMNS, readReportExportPreferences, reportExportStorageKey, selectExportColumns } = load('utils/reportExport.ts');
const { buildFinancialTransactions, exportFinancialTransactions, FINANCIAL_COLUMNS } = load('utils/financialTransactions.ts');

test('the requested six-column layout exports only those columns in the requested order, preserving numbers', () => {
    const row = {
        'Mã BK': 'ABC', 'Phòng': '501', 'Thời gian giao dịch': '06/09/2026 22:06:17',
        'Nhân viên thực hiện giao dịch': 'sale', 'Khách hàng': 'Khách ABC', 'Số tiền giao dịch': 500000,
        'Tổng bill': 1500000, _internal: 'hidden',
    };
    const result = selectExportColumns([row, { ...row, 'Số tiền giao dịch': -300000 }], COMPACT_TRANSACTION_COLUMNS, FINANCIAL_COLUMNS.map(c => c.label));
    assert.deepEqual(Object.keys(result[0]), COMPACT_TRANSACTION_COLUMNS);
    assert.equal(result[0]['Số tiền giao dịch'], 500000);
    assert.equal(result[1]['Số tiền giao dịch'], -300000);
    assert.equal('_internal' in result[0], false);
    assert.equal('Tổng bill' in result[0], false);
});

test('reordering columns is preserved and zero or missing values remain valid Excel cells', () => {
    const result = selectExportColumns([{ 'Tiền phòng': 100000, 'Thu khác': 0, 'Tổng bill': 100000, 'Còn nợ': null }], ['Còn nợ', 'Tổng bill', 'Thu khác'], BOOKING_EXPORT_COLUMNS);
    assert.deepEqual(Object.keys(result[0]), ['Còn nợ', 'Tổng bill', 'Thu khác']);
    assert.deepEqual(Object.values(result[0]), ['', 100000, 0]);
    assert.throws(() => selectExportColumns([{}], ['_internal'], BOOKING_EXPORT_COLUMNS), /ít nhất một cột/);
});

test('export uses all matching rows, including rows outside the visible page', () => {
    const rows = Array.from({ length: 61 }, (_, i) => ({ 'Mã BK': `BK${i}`, 'Số tiền giao dịch': i * 1000 }));
    const result = selectExportColumns(rows, ['Số tiền giao dịch', 'Mã BK'], FINANCIAL_COLUMNS.map(c => c.label));
    assert.equal(result.length, 61); assert.equal(result[60]['Mã BK'], 'BK60');
});

test('saved templates and last-used column order survive reload and are isolated by account and report', () => {
    const store = new Map(); const storage = { getItem: key => store.get(key) || null };
    const key = reportExportStorageKey('tenant', 'sale', 'FINANCIAL_TRANSACTIONS');
    const columns = FINANCIAL_COLUMNS.map(c => c.label);
    const saved = { templates: [{ id: 'template_cash', name: 'Thu ngân', columns: COMPACT_TRANSACTION_COLUMNS }], lastColumns: COMPACT_TRANSACTION_COLUMNS, lastTemplateId: 'template_cash' };
    store.set(key, JSON.stringify(saved));
    assert.deepEqual(readReportExportPreferences(storage, key, columns), saved);
    for (const otherKey of [reportExportStorageKey('other-tenant', 'sale', 'FINANCIAL_TRANSACTIONS'), reportExportStorageKey('tenant', 'other-sale', 'FINANCIAL_TRANSACTIONS'), reportExportStorageKey('tenant', 'sale', 'REVENUE')]) {
        assert.deepEqual(readReportExportPreferences(storage, otherKey, columns).templates, []);
        assert.notEqual(otherKey, key);
    }
});

test('broken storage and removed or duplicate columns do not break the export picker', () => {
    const columns = ['Mã BK', 'Phòng'];
    assert.deepEqual(readReportExportPreferences({ getItem: () => '{invalid' }, 'x', columns).lastColumns, columns);
    assert.deepEqual(readReportExportPreferences({ getItem: () => { throw new Error('Blocked'); } }, 'x', columns).templates, []);
    const saved = JSON.stringify({ templates: [null, { id: 'a', name: 'Mẫu', columns: ['Phòng', 'removed', 'Phòng', 'Mã BK'] }, { id: 'a', name: 'Duplicate', columns }], lastColumns: ['removed'] });
    const result = readReportExportPreferences({ getItem: () => saved }, 'x', columns);
    assert.equal(result.templates.length, 1);
    assert.deepEqual(result.templates[0].columns, ['Phòng', 'Mã BK']);
    assert.deepEqual(result.lastColumns, columns);
});

test('actual payment export retains Vietnam timestamps and the incremental payment amount in a saved layout', () => {
    const before = { id: 'ABC', propertyId: 'p1', roomId: 'r1', guestName: 'Khách ABC', createdBy: 'sale', createdAt: '2026-09-05T01:31:18Z', checkInDate: '2026-09-09T10:00:00Z', checkOutDate: '2026-09-09T14:00:00Z', totalPrice: 1500000, paidAmount: 1000000 };
    const context = { rooms: [{ id: 'r1', number: '501' }], roomTypes: [], properties: [], tags: [], users: [] };
    const rows = buildFinancialTransactions([before], [{ ...before, paidAmount: 1500000 }], context, { id: 'payment', timestamp: '2026-09-06T15:06:17Z', performedBy: 'sale' });
    const result = selectExportColumns(exportFinancialTransactions(rows), COMPACT_TRANSACTION_COLUMNS, FINANCIAL_COLUMNS.map(c => c.label));
    assert.equal(result[0]['Thời gian giao dịch'], '06/09/2026 22:06:17');
    assert.equal(result[0]['Số tiền giao dịch'], 500000);
});
