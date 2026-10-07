import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpDown, ArrowUpRight, ChevronLeft, ChevronRight, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import { FinancialTransaction, PERMISSIONS, Property, User } from '../types';
import { DataService } from '../services/dataService';
import { displayTransactionAmount, exportFinancialTransactions, FINANCIAL_COLUMNS, FinancialContext, formatFinancialDate, summarizeFinancialTransactions, transactionKind, transactionTypeLabel } from '../utils/financialTransactions';
import ReportExportDialog from './ReportExportDialog';
import { COMPACT_TRANSACTION_COLUMNS, reportExportStorageKey, selectExportColumns } from '../utils/reportExport';

interface Props {
    propertyIds: string[];
    properties: Property[];
    context: FinancialContext;
    currentUser: User;
    startDate: string;
    endDate: string;
    onOpenBooking: (bookingId: string, propertyId: string) => void;
}

const DATE_COLUMNS = new Set(['timestamp', 'createdAt', 'checkInDate', 'checkOutDate']);
const MONEY_COLUMNS = new Set(['roomPrice', 'otherRevenue', 'totalBill', 'otherExpenses', 'netRevenue', 'paidAmount', 'debt']);
const EXPORT_COLUMNS = FINANCIAL_COLUMNS.map(column => column.label);
const COMPACT_TEMPLATE = { id: 'COMPACT', name: 'Thu/chi · 6 cột', columns: COMPACT_TRANSACTION_COLUMNS };
const formatMoney = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

const FinancialReport: React.FC<Props> = ({ propertyIds, properties, context, currentUser, startDate, endDate, onOpenBooking }) => {
    const [source, setSource] = useState<FinancialTransaction[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [property, setProperty] = useState('ALL');
    const [type, setType] = useState('ALL');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState({ key: 'timestamp', direction: 'desc' as 'asc' | 'desc' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const propertyKey = propertyIds.slice().sort().join(',');
    const scope = useMemo(() => new Set(propertyIds), [propertyKey]);
    const canExport = currentUser.permissions?.includes(PERMISSIONS.CAN_EXPORT_REPORT);

    useEffect(() => {
        let cancelled = false;
        setSource([]);
        setError('');
        if (!startDate || !endDate || !scope.size) { setLoading(false); return; }
        if (startDate > endDate) { setError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'); setLoading(false); return; }
        setLoading(true);
        DataService.fetchFinancialTransactions(propertyIds, `${startDate}T00:00:00+07:00`, `${endDate}T23:59:59.999+07:00`, context)
            .then(rows => { if (!cancelled) setSource(rows); })
            .catch(err => {
                if (cancelled) return;
                console.error('Financial report load failed', err);
                setError('Không tải được báo cáo phát sinh thu/chi. Vui lòng thử lại.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [propertyKey, currentUser.tenantId, startDate, endDate, refresh, context]);

    useEffect(() => { if (property !== 'ALL' && !scope.has(property)) setProperty('ALL'); }, [propertyKey, property]);
    useEffect(() => { setPage(1); }, [propertyKey, startDate, endDate, property, type, search, pageSize, refresh]);

    const rows = useMemo(() => {
        const term = search.trim().toLocaleLowerCase('vi');
        const value = (row: FinancialTransaction) => sort.key === 'displayAmount' ? displayTransactionAmount(row)
            : sort.key === 'displayType' ? transactionTypeLabel(row)
            : DATE_COLUMNS.has(sort.key) ? Date.parse(row[sort.key as keyof FinancialTransaction] as string)
            : row[sort.key as keyof FinancialTransaction];
        return source.filter(row => scope.has(row.propertyId)
            && (property === 'ALL' || row.propertyId === property)
            && (type === 'ALL' || (type === 'BOOKING_PAYMENT' ? transactionKind(row) === 'BOOKING_PAYMENT'
                : transactionKind(row) === 'EXTRA_FEE' && row.type === type))
            && (!term || [row.bookingId, row.guestName, row.content, row.tags, row.room, row.roomType, row.property, row.createdBy, row.performedBy].join(' ').toLocaleLowerCase('vi').includes(term)))
            .sort((a, b) => {
                const av = value(a), bv = value(b);
                const result = typeof av === 'number' && typeof bv === 'number' ? av - bv
                    : String(av ?? '').localeCompare(String(bv ?? ''), 'vi', { numeric: true });
                return (sort.direction === 'asc' ? result : -result) || b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id);
            });
    }, [source, scope, property, type, search, sort]);

    const totals = summarizeFinancialTransactions(rows);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(page, pages);
    const offset = (currentPage - 1) * pageSize;
    const visibleRows = rows.slice(offset, offset + pageSize);
    const changeSort = (key: string) => setSort(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
    const jump = (key: string) => {
        const container = scrollRef.current;
        if (!container) return;
        const target = container.querySelector<HTMLElement>(`[data-financial-column="${key}"]`);
        const pinnedWidth = window.matchMedia('(min-width: 768px)').matches ? 350 : 0;
        container.scrollTo({ left: key === 'timestamp' ? 0 : Math.max(0, (target?.offsetLeft || 0) - pinnedWidth), behavior: 'smooth' });
    };
    const exportReport = (columns: string[], templateName: string) => {
        if (!canExport || loading || error || !rows.length) return;
        DataService.exportToExcel(selectExportColumns(exportFinancialTransactions(rows), columns, EXPORT_COLUMNS), 'Bao_cao_phat_sinh_thu_chi.xlsx', {
            reportType: 'FINANCIAL_TRANSACTIONS', startDate, endDate, propertyIds: property === 'ALL' ? propertyIds : [property], type, search,
            columns, templateName,
        });
    };

    const cellValue = (row: FinancialTransaction, key: string) => {
        if (key === 'bookingId') return <button type="button" aria-label={`Xem chi tiết đặt phòng ${row.bookingId}`} className="hover:underline"
            onClick={e => { e.stopPropagation(); onOpenBooking(row.bookingId, row.propertyId); }}>{row.bookingId}</button>;
        if (DATE_COLUMNS.has(key)) return formatFinancialDate(row[key as keyof FinancialTransaction] as string) || '—';
        if (key === 'displayAmount') {
            const amount = displayTransactionAmount(row);
            return <span className={amount < 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}>{amount > 0 ? '+' : ''}{formatMoney(amount)}</span>;
        }
        if (key === 'displayType') return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${transactionKind(row) === 'BOOKING_PAYMENT' ? 'bg-blue-50 text-blue-700' : row.type === 'REVENUE' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{transactionTypeLabel(row)}</span>;
        if (MONEY_COLUMNS.has(key)) {
            const amount = row[key as keyof FinancialTransaction] as number | null;
            return <span className={key === 'debt' && amount > 0 ? 'text-red-600 font-bold' : ''}>{amount === null ? '—' : formatMoney(amount)}</span>;
        }
        if (key === 'tags') return row.tags ? <span className="inline-block rounded-md bg-purple-50 text-purple-700 px-2 py-1 text-xs">{row.tags}</span> : '—';
        return (row[key as keyof FinancialTransaction] as string) || '—';
    };

    return <div className="space-y-4 animate-fade-in">
        {exportDialogOpen && canExport && <ReportExportDialog
            key={reportExportStorageKey(currentUser.tenantId, currentUser.id, 'FINANCIAL_TRANSACTIONS')}
            storageKey={reportExportStorageKey(currentUser.tenantId, currentUser.id, 'FINANCIAL_TRANSACTIONS')}
            title="Báo cáo phát sinh thu/chi" columns={EXPORT_COLUMNS} suggestedTemplate={COMPACT_TEMPLATE}
            rows={loading || error ? [] : exportFinancialTransactions(rows)} onDismiss={() => setExportDialogOpen(false)} onExport={exportReport} />}
        <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">Chi nhánh
                <select className="border border-gray-200 rounded-lg bg-white text-sm p-2.5 min-w-[180px]" value={property} onChange={e => setProperty(e.target.value)}>
                    <option value="ALL">Tất cả chi nhánh đã chọn</option>
                    {properties.filter(p => scope.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">Loại giao dịch
                <select className="border border-gray-200 rounded-lg bg-white text-sm p-2.5 min-w-[160px]" value={type} onChange={e => setType(e.target.value)}>
                    <option value="ALL">Tất cả giao dịch</option><option value="BOOKING_PAYMENT">Thanh toán đặt phòng</option><option value="REVENUE">Thu phụ thu/dịch vụ</option><option value="EXPENSE">Chi phụ thu/dịch vụ</option>
                </select>
            </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-live="polite">
            {[
                { label: 'Khách thanh toán trong kỳ', value: totals.payments, Icon: ArrowLeftRight, color: 'bg-blue-50 text-blue-600' },
                { label: 'Thu phụ thu/dịch vụ', value: totals.extraRevenue, Icon: ArrowUpRight, color: 'bg-green-50 text-green-600' },
                { label: 'Chi phụ thu/dịch vụ', value: totals.extraExpenses, Icon: ArrowDownLeft, color: 'bg-red-50 text-red-600' },
            ].map(({ label, value, Icon, color }) => <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                <div className={`p-2.5 rounded-lg ${color}`}><Icon size={18} /></div><div><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900 tabular-nums">{loading || error ? '—' : formatMoney(value)} <span className="text-xs font-normal text-gray-500">đ</span></p></div>
            </div>)}
        </div>
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-bold text-gray-800">Chi tiết phát sinh thu/chi</h3>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setRefresh(n => n + 1)} disabled={loading} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Làm mới</button>
                    {canExport && <button type="button" onClick={() => setExportDialogOpen(true)} disabled={loading || !!error || !rows.length} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-green-600 text-white font-semibold disabled:opacity-50"><FileSpreadsheet size={16} />Xuất Excel</button>}
                </div>
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 w-full sm:w-80"><Search size={15} className="text-gray-400 shrink-0" /><input className="outline-none text-sm w-full min-w-0 bg-transparent" aria-label="Tìm mã BK, khách hàng hoặc nội dung" placeholder="Tìm mã BK, khách hàng, nội dung..." value={search} onChange={e => setSearch(e.target.value)} /></label>
                <div className="flex gap-2 text-xs text-gray-600">
                    <button type="button" className="bg-gray-50 rounded-md px-2 py-1.5" onClick={() => jump('timestamp')}>Đầu bảng</button>
                    <button type="button" className="bg-gray-50 rounded-md px-2 py-1.5" onClick={() => jump('roomPrice')}>Tài chính →</button>
                    <button type="button" className="bg-gray-50 rounded-md px-2 py-1.5" onClick={() => jump('createdBy')}>Nhân viên →</button>
                </div>
            </div>
            {error && <div className="mx-4 mb-3 bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-700" role="alert">{error}</div>}
            <div ref={scrollRef} className="financial-report-scroll overflow-x-auto relative" aria-busy={loading}>
                <table className="w-full text-sm text-left border-separate border-spacing-0">
                    <thead><tr>{FINANCIAL_COLUMNS.map((col, index) => <th key={col.key} data-financial-column={col.key} aria-sort={sort.key === col.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                        style={{ minWidth: col.width || 125, ...(index < 2 ? { width: col.width, maxWidth: col.width } : {}) }}
                        className={`p-3 border-y border-gray-200 whitespace-nowrap ${MONEY_COLUMNS.has(col.key) ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'} ${index === 0 ? 'financial-pin-time' : index === 1 ? 'financial-pin-amount' : ''}`}>
                        <button type="button" onClick={() => changeSort(col.key)} className={`flex items-center gap-1 font-semibold ${col.numeric ? 'ml-auto' : ''}`}>
                            {col.label}<ArrowUpDown size={12} className={sort.key === col.key ? 'text-blue-600' : 'opacity-40'} />
                        </button>
                    </th>)}</tr></thead>
                    <tbody>{loading ? <tr><td colSpan={22} className="p-8 text-gray-500">Đang tải các khoản phát sinh...</td></tr>
                        : visibleRows.length ? visibleRows.map(row => <tr key={row.id} className="group cursor-pointer" onClick={() => onOpenBooking(row.bookingId, row.propertyId)}>{FINANCIAL_COLUMNS.map((col, index) => <td key={col.key}
                            className={`p-3 border-b border-gray-100 whitespace-nowrap group-hover:bg-gray-50 ${col.numeric ? 'text-right tabular-nums' : ''} ${col.key === 'bookingId' ? 'text-blue-600 font-semibold' : ''} ${col.key === 'guestName' ? 'font-medium' : ''} ${col.key === 'totalBill' || col.key === 'netRevenue' ? 'bg-blue-50/30 font-semibold' : 'bg-white'} ${index === 0 ? 'financial-pin-time' : index === 1 ? 'financial-pin-amount' : ''}`}>
                            {cellValue(row, col.key)}
                        </td>)}</tr>) : <tr><td colSpan={22} className="p-8 text-gray-500">{error ? 'Dữ liệu chưa tải được.' : 'Chưa có khoản phát sinh phù hợp với bộ lọc.'}</td></tr>}
                    </tbody>
                </table>
            </div>
            <div className="p-4 flex flex-wrap justify-between items-center gap-3 text-xs text-gray-500">
                <span aria-live="polite">{loading || error ? '—' : `${rows.length ? offset + 1 : 0}–${offset + visibleRows.length} / ${rows.length} giao dịch · ${new Set(rows.map(r => r.bookingId)).size} đơn đặt phòng`}</span>
                <div className="flex flex-wrap items-center gap-2">
                    <select aria-label="Số dòng mỗi trang" className="bg-white border border-gray-200 rounded-md p-1.5" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>{[25, 50, 100].map(n => <option key={n} value={n}>{n} dòng / trang</option>)}</select>
                    <button type="button" aria-label="Trang trước" disabled={currentPage === 1 || loading} className="p-1.5 border rounded-md disabled:opacity-40" onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button>
                    <span>{currentPage} / {pages}</span>
                    <button type="button" aria-label="Trang sau" disabled={currentPage === pages || loading} className="p-1.5 border rounded-md disabled:opacity-40" onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button>
                </div>
            </div>
        </section>
    </div>;
};

export default FinancialReport;
