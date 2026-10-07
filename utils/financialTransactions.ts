import { Booking, BookingStatus, ExtraFee, FinancialTransaction, HistoryLog, Property, Room, RoomType, Tag, User } from '../types';

export interface FinancialContext {
    rooms: Room[];
    roomTypes: RoomType[];
    properties: Property[];
    tags: Tag[];
    users: User[];
}

export const FINANCIAL_COLUMNS: { key: keyof FinancialTransaction | 'displayAmount' | 'displayType'; label: string; numeric?: boolean; width?: number }[] = [
    { key: 'timestamp', label: 'Thời gian giao dịch', width: 190 },
    { key: 'displayAmount', label: 'Số tiền giao dịch', numeric: true, width: 160 },
    { key: 'displayType', label: 'Loại giao dịch', width: 205 },
    { key: 'content', label: 'Nội dung khoản thu/chi', width: 200 },
    { key: 'bookingId', label: 'Mã BK' },
    { key: 'guestName', label: 'Khách hàng', width: 200 },
    { key: 'tags', label: 'Tags' },
    { key: 'room', label: 'Phòng' },
    { key: 'roomType', label: 'Hạng phòng' },
    { key: 'property', label: 'Chi nhánh' },
    { key: 'createdAt', label: 'Ngày tạo', width: 190 },
    { key: 'checkInDate', label: 'Thời gian nhận phòng', width: 190 },
    { key: 'checkOutDate', label: 'Thời gian trả phòng', width: 190 },
    { key: 'roomPrice', label: 'Tiền phòng', numeric: true },
    { key: 'otherRevenue', label: 'Thu khác', numeric: true },
    { key: 'totalBill', label: 'Tổng bill', numeric: true },
    { key: 'otherExpenses', label: 'Chi khác', numeric: true },
    { key: 'netRevenue', label: 'Doanh thu net', numeric: true },
    { key: 'paidAmount', label: 'Đã trả', numeric: true },
    { key: 'debt', label: 'Còn nợ', numeric: true },
    { key: 'createdBy', label: 'Nhân viên tạo đơn' },
    { key: 'performedBy', label: 'Nhân viên thực hiện giao dịch', width: 230 },
];

export const displayTransactionAmount = (row: FinancialTransaction) => row.type === 'EXPENSE' ? -row.amount : row.amount;
export const transactionKind = (row: FinancialTransaction) => row.kind || 'EXTRA_FEE';
export const transactionTypeLabel = (row: FinancialTransaction) => transactionKind(row) === 'BOOKING_PAYMENT'
    ? (row.amount < 0 ? 'Điều chỉnh thanh toán' : 'Thanh toán đặt phòng')
    : row.type === 'REVENUE' ? 'Thu phụ thu/dịch vụ' : 'Chi phụ thu/dịch vụ';
export function summarizeFinancialTransactions(rows: FinancialTransaction[]) {
    return rows.reduce((totals, row) => {
        if (transactionKind(row) === 'BOOKING_PAYMENT') totals.payments += row.amount;
        else if (row.type === 'REVENUE') totals.extraRevenue += row.amount;
        else totals.extraExpenses += row.amount;
        return totals;
    }, { payments: 0, extraRevenue: 0, extraExpenses: 0 });
}
export const formatFinancialDate = (value: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type: string) => parts.find(p => p.type === type)?.value || '';
    return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
};

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function financialSnapshot(booking: Booking, bookings: Booking[], context: FinancialContext, completeGroup = true) {
    const members = booking.groupId ? bookings.filter(b => b.groupId === booking.groupId && b.status !== BookingStatus.DELETED) : [booking];
    const group = members.length ? members : [booking];
    const fees = group.flatMap(b => b.extraFees || []);
    const otherRevenue = fees.filter(f => f.type === 'REVENUE').reduce((s, f) => s + number(f.amount), 0);
    const otherExpenses = fees.filter(f => f.type === 'EXPENSE').reduce((s, f) => s + number(f.amount), 0);
    const netRevenue = group.reduce((s, b) => s + number(b.totalPrice), 0);
    const totalBill = netRevenue + otherExpenses;
    const paidAmount = group.reduce((s, b) => s + number(b.paidAmount), 0);
    const room = context.rooms.find(r => r.id === booking.roomId);
    const username = context.users.find(u => u.id === booking.createdBy)?.username || booking.createdBy;
    const knownTotals = !booking.groupId || completeGroup;
    return {
        propertyId: booking.propertyId, bookingId: booking.id, guestName: booking.guestName || '',
        tags: (booking.tags || []).map(id => context.tags.find(t => t.id === id)?.name || id).join(', '),
        room: room?.number || booking.roomId,
        roomType: context.roomTypes.find(t => t.id === room?.typeId)?.name || room?.typeId || '',
        property: context.properties.find(p => p.id === booking.propertyId)?.name || booking.propertyId,
        createdAt: booking.createdAt, checkInDate: booking.checkInDate, checkOutDate: booking.checkOutDate,
        roomPrice: knownTotals ? totalBill - otherRevenue : null,
        otherRevenue: knownTotals ? otherRevenue : null, totalBill: knownTotals ? totalBill : null,
        otherExpenses: knownTotals ? otherExpenses : null, netRevenue: knownTotals ? netRevenue : null,
        paidAmount: knownTotals ? paidAmount : null, debt: knownTotals ? totalBill - paidAmount : null,
        createdBy: username,
    };
}

/** Match within a booking or its group; unrelated bookings may reuse old fee IDs. */
export function buildFinancialTransactions(
    before: Booking[], after: Booking[], context: FinancialContext,
    event: { id: string; timestamp: string; performedBy: string; deletedBookingIds?: string[]; completeGroup?: boolean; includeFees?: boolean; includePayments?: boolean }
): FinancialTransaction[] {
    const feeMap = (bookings: Booking[]) => new Map(bookings.flatMap(booking =>
        (booking.extraFees || []).map(fee => [`${booking.id}:${fee.id}`, { fee, booking }] as const)));
    const oldFees = feeMap(before), newFees = feeMap(after);
    const beforeBookings = new Map(before.map(b => [b.id, b]));
    const afterBookings = new Map(after.map(b => [b.id, b]));
    const matched = new Set<string>();
    const deletedIds = new Set(event.deletedBookingIds || []);
    const rows: FinancialTransaction[] = [];
    const add = (fee: ExtraFee, booking: Booking, amount: number, operation: string) => {
        if (!amount) return;
        rows.push({
            ...financialSnapshot(booking, after, context, event.completeGroup !== false),
            id: `${event.id}:${fee.id}:${rows.length}`, feeId: fee.id, kind: 'EXTRA_FEE',
            timestamp: event.timestamp, type: fee.type, amount, content: `${operation}${fee.name}`,
            performedBy: event.performedBy,
        });
    };
    for (const [id, current] of event.includeFees === false ? [] : newFees) {
        let previousKey = id;
        let previous = oldFees.get(id);
        if (!previous) {
            const groups = [current.booking.groupId, beforeBookings.get(current.booking.id)?.groupId].filter(Boolean);
            const transferred = Array.from(oldFees).find(([key, old]) => !matched.has(key) && old.fee.id === current.fee.id
                && [old.booking.groupId, afterBookings.get(old.booking.id)?.groupId].some(group => group && groups.includes(group)));
            if (transferred) [previousKey, previous] = transferred;
        }
        if (previous) matched.add(previousKey);
        if (!previous) add(current.fee, current.booking, number(current.fee.amount), '');
        else if (previous.fee.type !== current.fee.type || previous.fee.categoryId !== current.fee.categoryId) {
            add(previous.fee, current.booking, -number(previous.fee.amount), 'Điều chỉnh giảm: ');
            add(current.fee, current.booking, number(current.fee.amount), 'Điều chỉnh tăng: ');
        } else {
            add(current.fee, current.booking, number(current.fee.amount) - number(previous.fee.amount), 'Điều chỉnh: ');
        }
    }
    for (const [id, previous] of event.includeFees === false ? [] : oldFees) {
        if (matched.has(id) || deletedIds.has(previous.booking.id)) continue;
        const booking = after.find(b => b.id === previous.booking.id) || previous.booking;
        add(previous.fee, booking, -number(previous.fee.amount), 'Xóa khoản: ');
    }
    if (event.includePayments !== false) {
        // Connect room members in both revisions so reallocating a group's paid
        // balance, including when removing its former leader, is not a payment.
        const parents = new Map<string, string>();
        const find = (id: string): string => {
            const parent = parents.get(id) || id;
            if (parent === id) { parents.set(id, id); return id; }
            const root = find(parent); parents.set(id, root); return root;
        };
        const groupOwner = new Map<string, string>();
        for (const booking of [...before, ...after]) {
            find(booking.id);
            if (!booking.groupId) continue;
            const owner = groupOwner.get(booking.groupId);
            if (owner) parents.set(find(booking.id), find(owner));
            else groupOwner.set(booking.groupId, booking.id);
        }
        const groups = new Map<string, { before: Booking[]; after: Booking[] }>();
        for (const [version, bookings] of [['before', before], ['after', after]] as const) {
            for (const booking of bookings) {
                if (booking.status === BookingStatus.DELETED) continue;
                const id = find(booking.id);
                const group = groups.get(id) || { before: [], after: [] };
                group[version].push(booking); groups.set(id, group);
            }
        }
        for (const group of groups.values()) {
            const changed = group.after.filter(b => number(b.paidAmount) !== number(beforeBookings.get(b.id)?.paidAmount));
            if (!changed.length) continue; // Deletion alone is not a refund.
            const amount = group.after.reduce((s, b) => s + number(b.paidAmount), 0) - group.before.reduce((s, b) => s + number(b.paidAmount), 0);
            if (!amount) continue;
            const booking = changed.find(b => (number(b.paidAmount) - number(beforeBookings.get(b.id)?.paidAmount)) * amount > 0) || changed[0];
            rows.push({
                ...financialSnapshot(booking, after, context, event.completeGroup !== false),
                id: `${event.id}:payment:${booking.id}`, feeId: '', kind: 'BOOKING_PAYMENT',
                timestamp: event.timestamp, type: 'REVENUE', amount,
                content: amount > 0 ? 'Thanh toán đặt phòng' : 'Điều chỉnh giảm đã trả',
                performedBy: event.performedBy,
            });
        }
    }
    return rows;
}

/** Old audit records are usable only where they contain the before/after amounts. */
export function transactionsFromHistory(logs: HistoryLog[], context: FinancialContext): FinancialTransaction[] {
    const result = new Map<string, FinancialTransaction>();
    const paymentRevisions = new Map<string, number>();
    const paymentBatches = new Map<string, { log: HistoryLog; before?: Booking; after: Booking }[]>();
    for (const log of [...logs].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
        const metadata = log.metadata || {};
        if (Array.isArray(metadata.financialTransactions)) {
            for (const row of metadata.financialTransactions as FinancialTransaction[]) result.set(row.id, row);
            continue;
        }
        if (number(metadata.financialReportVersion) >= 2 || log.source === 'IMPORT' || (log.action === 'DELETE' && !metadata.changeKey)) continue;
        if (log.entityType !== 'BOOKING' && !log.bookingSnapshot) continue;
        const rawAfter = (log.after || log.bookingSnapshot) as Booking | undefined;
        const before = log.before as Booking | undefined;
        if (!rawAfter?.id || !rawAfter.propertyId) continue;
        const after = { ...rawAfter, extraFees: rawAfter.extraFees || [] };
        // No before state on an UPDATE means the difference is unknowable.
        if (!before?.id && log.action !== 'CREATE') continue;
        const includeFees = !metadata.financialReportVersion && (!metadata.changeKey || metadata.changeKey === 'extraFees');
        let includePayments = Number.isFinite(Number(after.paidAmount)) && (!before || Number.isFinite(Number(before.paidAmount)));
        if (includePayments) {
            // One older save may have emitted several field-specific logs with
            // the same paid balance change. Match its revision, not its log ID.
            const revision = JSON.stringify([after.id, before?.updatedAt || '', after.updatedAt || '', number(before?.paidAmount), number(after.paidAmount), after.groupId || '', after.totalPrice]);
            const previousTime = paymentRevisions.get(revision);
            const time = Date.parse(log.timestamp);
            if (previousTime !== undefined && (after.updatedAt || Math.abs(time - previousTime) <= 1500)) includePayments = false;
            else if (number(after.paidAmount) !== number(before?.paidAmount)) paymentRevisions.set(revision, time);
        }
        if (includePayments) {
            // Room-map saves stamp every room with one revision. Compare those
            // rooms together, so moving the group's balance creates no receipt.
            const groupId = after.groupId || before?.groupId;
            const batchId = groupId && after.updatedAt
                ? JSON.stringify([log.tenantId, groupId, after.updatedAt, log.actorId || log.staffId])
                : log.id;
            const batch = paymentBatches.get(batchId) || [];
            if (!batch.some(item => item.after.id === after.id)) batch.push({ log, before, after });
            paymentBatches.set(batchId, batch);
        }
        if (!includeFees && !includePayments) continue;
        let oldBooking = before;
        let nextBooking = after;
        if (metadata.changeKey === 'extraFees') {
            const oldFee = metadata.beforeValue as ExtraFee | undefined;
            const newFee = metadata.afterValue as ExtraFee | undefined;
            oldBooking = { ...(before || after), extraFees: oldFee?.id ? [oldFee] : [] };
            // Use the full after snapshot for financial totals, restrict the diff below to this fee.
            const feeId = newFee?.id || oldFee?.id;
            const otherFees = after.extraFees.filter(f => f.id !== feeId);
            oldBooking.extraFees = [...otherFees, ...(oldFee?.id ? [oldFee] : [])];
            nextBooking = { ...after, extraFees: [...otherFees, ...(newFee?.id ? [newFee] : [])] };
        }
        const rows = buildFinancialTransactions(oldBooking ? [oldBooking] : [], [nextBooking], context, {
            id: log.id, timestamp: log.timestamp,
            performedBy: log.actorUsername || context.users.find(u => u.id === (log.actorId || log.staffId))?.username || log.actorName || log.staffId || '',
            completeGroup: false,
            includeFees, includePayments: false,
        });
        for (const row of rows) {
            // Prefer stored names in the old audit snapshot over renamed catalogue values.
            row.property = metadata.propertyName || row.property;
            row.room = metadata.roomNumber || row.room;
            result.set(row.id, row);
        }
    }
    for (const batch of paymentBatches.values()) {
        const rows = buildFinancialTransactions(batch.flatMap(item => item.before ? [item.before] : []), batch.map(item => item.after), context, {
            id: batch[0].log.id, timestamp: batch[0].log.timestamp, performedBy: '',
            completeGroup: false, includeFees: false,
        });
        for (const row of rows) {
            const { log } = batch.find(item => item.after.id === row.bookingId) || batch[0];
            row.id = `${log.id}:payment:${row.bookingId}`;
            row.timestamp = log.timestamp;
            row.performedBy = log.actorUsername || context.users.find(u => u.id === (log.actorId || log.staffId))?.username || log.actorName || log.staffId || '';
            row.property = log.metadata?.propertyName || row.property;
            row.room = log.metadata?.roomNumber || row.room;
            result.set(row.id, row);
        }
    }
    return Array.from(result.values());
}

export function exportFinancialTransactions(rows: FinancialTransaction[]) {
    const dates = new Set(['timestamp', 'createdAt', 'checkInDate', 'checkOutDate']);
    return rows.map(row => Object.fromEntries(FINANCIAL_COLUMNS.map(col => {
        let value: string | number | null = col.key === 'displayAmount' ? displayTransactionAmount(row)
            : col.key === 'displayType' ? transactionTypeLabel(row) : row[col.key];
        if (dates.has(col.key)) value = formatFinancialDate(String(value || ''));
        return [col.label, value ?? ''];
    })));
}
