export type ExportRow = Record<string, string | number | null | undefined>;
export interface ReportExportTemplate { id: string; name: string; columns: string[]; }
export interface ReportExportPreferences { templates: ReportExportTemplate[]; lastColumns: string[]; lastTemplateId: string; }

export const BOOKING_EXPORT_COLUMNS = [
    'Mã BK', 'Khách hàng', 'Tags', 'Phòng', 'Hạng phòng', 'Chi nhánh', 'Ngày tạo',
    'Thời gian nhận phòng', 'Thời gian trả phòng', 'Tiền phòng', 'Thu khác', 'Tổng bill',
    'Chi khác', 'Doanh thu net', 'Đã trả', 'Còn nợ', 'Nhân viên tạo đơn',
];
export const COMPACT_TRANSACTION_COLUMNS = [
    'Mã BK', 'Phòng', 'Thời gian giao dịch', 'Nhân viên thực hiện giao dịch', 'Khách hàng', 'Số tiền giao dịch',
];

export const reportExportStorageKey = (tenantId: string, userId: string, reportType: string) =>
    `khost.report-export.v1:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}:${reportType}`;

export function validExportColumns(columns: unknown, available: string[]): string[] {
    if (!Array.isArray(columns)) return [];
    const allowed = new Set(available);
    return [...new Set(columns.filter((column): column is string => typeof column === 'string' && allowed.has(column)))];
}

export function readReportExportPreferences(storage: Pick<Storage, 'getItem'>, key: string, available: string[]): ReportExportPreferences {
    const fallback = { templates: [], lastColumns: available.slice(), lastTemplateId: 'ALL' };
    try {
        const saved = JSON.parse(storage.getItem(key) || 'null');
        if (!saved || typeof saved !== 'object') return fallback;
        const ids = new Set<string>();
        const templates = (Array.isArray(saved.templates) ? saved.templates : []).flatMap((template: any) => {
            const columns = validExportColumns(template?.columns, available);
            if (typeof template?.id !== 'string' || !template.id || ids.has(template.id)
                || typeof template.name !== 'string' || !template.name.trim() || !columns.length) return [];
            ids.add(template.id);
            return [{ id: template.id, name: template.name.trim().slice(0, 80), columns }];
        });
        const lastColumns = validExportColumns(saved.lastColumns, available);
        return { templates, lastColumns: lastColumns.length ? lastColumns : available.slice(),
            lastTemplateId: typeof saved.lastTemplateId === 'string' ? saved.lastTemplateId : 'CUSTOM' };
    } catch { return fallback; }
}

/** Only explicitly selected columns enter the workbook, in the selected order. */
export function selectExportColumns(rows: ExportRow[], selected: string[], available: string[]): ExportRow[] {
    const columns = validExportColumns(selected, available);
    if (!columns.length) throw new Error('Vui lòng chọn ít nhất một cột để xuất.');
    return rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? ''])));
}
