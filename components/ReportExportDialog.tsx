import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, FileSpreadsheet, Save, X } from 'lucide-react';
import DialogFrame from './DialogFrame';
import { ExportRow, ReportExportPreferences, ReportExportTemplate, readReportExportPreferences, validExportColumns } from '../utils/reportExport';

interface Props {
    title: string; columns: string[]; rows: ExportRow[]; storageKey: string;
    suggestedTemplate?: ReportExportTemplate;
    onDismiss: () => void;
    onExport: (columns: string[], templateName: string) => void;
}

const ReportExportDialog: React.FC<Props> = ({ title, columns, rows, storageKey, suggestedTemplate, onDismiss, onExport }) => {
    const [preferences] = useState(() => {
        try { return readReportExportPreferences(window.localStorage, storageKey, columns); }
        catch { return { templates: [], lastColumns: columns.slice(), lastTemplateId: 'ALL' }; }
    });
    const [templates, setTemplates] = useState(preferences.templates);
    const [selected, setSelected] = useState(preferences.lastColumns);
    const [templateId, setTemplateId] = useState(() => ['ALL', 'CUSTOM', suggestedTemplate?.id, ...preferences.templates.map(t => t.id)].includes(preferences.lastTemplateId) ? preferences.lastTemplateId : 'CUSTOM');
    const [name, setName] = useState(preferences.templates.find(t => t.id === preferences.lastTemplateId)?.name || '');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const persist = (next: ReportExportPreferences) => {
        try { window.localStorage.setItem(storageKey, JSON.stringify(next)); return true; }
        catch { setError('Không lưu được mẫu trên trình duyệt này. Bạn vẫn có thể xuất Excel với các cột đã chọn.'); return false; }
    };
    const chooseTemplate = (id: string) => {
        setTemplateId(id); setMessage(''); setError('');
        if (id === 'CUSTOM') return;
        const template = id === suggestedTemplate?.id ? suggestedTemplate : templates.find(t => t.id === id);
        setSelected(id === 'ALL' ? columns.slice() : validExportColumns(template?.columns, columns));
        setName(template && template.id !== suggestedTemplate?.id ? template.name : '');
    };
    const changeColumns = (next: string[]) => { setSelected(next); setTemplateId('CUSTOM'); setMessage(''); setError(''); };
    const toggleColumn = (column: string) => changeColumns(selected.includes(column) ? selected.filter(c => c !== column) : [...selected, column]);
    const move = (index: number, direction: number) => {
        const next = selected.slice();
        [next[index], next[index + direction]] = [next[index + direction], next[index]];
        changeColumns(next);
    };
    const saveTemplate = () => {
        setMessage(''); setError('');
        const trimmedName = name.trim();
        if (!trimmedName) { setError('Vui lòng đặt tên mẫu xuất.'); return; }
        if (!selected.length) { setError('Vui lòng chọn ít nhất một cột.'); return; }
        const existing = templates.find(t => t.name.toLocaleLowerCase('vi') === trimmedName.toLocaleLowerCase('vi'));
        const template = { id: existing?.id || `template_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: trimmedName, columns: selected.slice() };
        const next = [...templates.filter(t => t.id !== template.id), template];
        if (persist({ templates: next, lastColumns: selected, lastTemplateId: template.id })) {
            setTemplates(next); setTemplateId(template.id); setName(trimmedName);
            setMessage(existing ? 'Đã cập nhật mẫu xuất.' : 'Đã lưu mẫu xuất để dùng lần sau.');
        }
    };
    const removeTemplate = () => {
        const next = templates.filter(t => t.id !== templateId);
        if (persist({ templates: next, lastColumns: selected, lastTemplateId: 'CUSTOM' })) {
            setTemplates(next); setTemplateId('CUSTOM'); setName(''); setMessage('Đã xóa mẫu xuất.'); setError('');
        }
    };
    const exportReport = () => {
        if (!selected.length || !rows.length) return;
        setError('');
        try {
            persist({ templates, lastColumns: selected, lastTemplateId: templateId });
            const templateName = templateId === suggestedTemplate?.id ? suggestedTemplate.name : templates.find(t => t.id === templateId)?.name || '';
            onExport(selected.slice(), templateName);
            onDismiss();
        } catch { setError('Không xuất được file Excel. Vui lòng thử lại.'); }
    };

    return createPortal(<DialogFrame label="Tùy chỉnh xuất Excel" onDismiss={onDismiss} className="fixed inset-0 bg-black/50 z-[106] flex items-center justify-center p-3 md:p-5" onClick={onDismiss}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3 shrink-0">
                <div><h3 className="font-bold text-lg text-gray-900">Tùy chỉnh xuất Excel</h3><p className="text-xs text-gray-500 mt-1">{title} · {rows.length.toLocaleString('vi-VN')} dòng theo bộ lọc hiện tại</p></div>
                <button type="button" aria-label="Đóng tùy chỉnh xuất Excel" onClick={onDismiss} className="p-2 rounded-full text-gray-500 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto min-h-0">
                <div className="flex flex-wrap gap-3 items-end">
                    <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1 flex-1 min-w-[180px]">Mẫu xuất
                        <select className="border border-gray-200 bg-white rounded-lg p-2.5 text-sm" value={templateId} onChange={e => chooseTemplate(e.target.value)}>
                            <option value="ALL">Tất cả các cột</option><option value="CUSTOM">Tùy chỉnh</option>
                            {suggestedTemplate && <option value={suggestedTemplate.id}>{suggestedTemplate.name}</option>}
                            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </label>
                    <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1 flex-1 min-w-[180px]">Tên mẫu
                        <input className="border border-gray-200 bg-white rounded-lg p-2.5 text-sm" placeholder="Ví dụ: Thu ngân" maxLength={80} value={name} onChange={e => setName(e.target.value)} />
                    </label>
                    <button type="button" onClick={saveTemplate} disabled={!selected.length} className="border border-blue-200 text-blue-700 rounded-lg px-3 py-2.5 flex items-center gap-2 text-sm font-semibold disabled:opacity-40"><Save size={16} />Lưu mẫu</button>
                    {templates.some(t => t.id === templateId) && <button type="button" onClick={removeTemplate} className="text-red-600 text-sm px-2 py-2.5">Xóa mẫu</button>}
                </div>
                <p className="text-xs text-gray-500">Mẫu được lưu riêng theo tài khoản trên trình duyệt này.</p>
                {message && <p role="status" className="text-sm text-green-700">{message}</p>}
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <section className="border border-gray-200 rounded-xl p-4">
                        <div className="flex flex-wrap justify-between items-center gap-2 mb-3"><h4 className="font-semibold text-sm text-gray-800">Chọn cột xuất</h4>
                            <div className="flex gap-3 text-xs text-blue-600"><button type="button" onClick={() => changeColumns(columns.slice())}>Chọn tất cả</button><button type="button" onClick={() => changeColumns([])}>Bỏ chọn tất cả</button></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{columns.map(column => <label key={column} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer p-1">
                            <input type="checkbox" checked={selected.includes(column)} onChange={() => toggleColumn(column)} className="mt-1 accent-blue-600" /><span>{column}</span>
                        </label>)}</div>
                    </section>
                    <section className="border border-gray-200 rounded-xl p-4">
                        <h4 className="font-semibold text-sm text-gray-800 mb-3">Thứ tự cột · {selected.length} cột</h4>
                        {!selected.length && <p className="text-sm text-gray-500">Chọn ít nhất một cột để xuất Excel.</p>}
                        <ol className="space-y-1">{selected.map((column, index) => <li key={column} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm text-gray-700">
                            <span><span className="text-gray-400 mr-2">{index + 1}.</span>{column}</span>
                            <div className="flex shrink-0 gap-1">
                                <button type="button" aria-label={`Đưa ${column} lên`} disabled={index === 0} onClick={() => move(index, -1)} className="p-1 rounded hover:bg-white disabled:opacity-25"><ArrowUp size={15} /></button>
                                <button type="button" aria-label={`Đưa ${column} xuống`} disabled={index === selected.length - 1} onClick={() => move(index, 1)} className="p-1 rounded hover:bg-white disabled:opacity-25"><ArrowDown size={15} /></button>
                            </div>
                        </li>)}</ol>
                    </section>
                </div>
                <section><h4 className="text-sm font-semibold text-gray-800 mb-2">Xem trước · {Math.min(3, rows.length)} dòng đầu</h4>
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                        <table className="w-full text-xs text-left whitespace-nowrap"><thead className="bg-gray-50 text-gray-600"><tr>{selected.map(column => <th key={column} className="p-3 min-w-[130px]">{column}</th>)}</tr></thead>
                            <tbody>{rows.slice(0, 3).map((row, index) => <tr key={index} className="border-t border-gray-100">{selected.map(column => <td key={column} className="p-3 text-gray-700">{typeof row[column] === 'number' ? row[column].toLocaleString('vi-VN') : row[column] ?? '—'}</td>)}</tr>)}</tbody>
                        </table>
                    </div>
                </section>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex flex-wrap justify-between items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500">Xuất {selected.length} cột · {rows.length.toLocaleString('vi-VN')} dòng</span>
                <div className="flex gap-2"><button type="button" onClick={onDismiss} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">Hủy</button>
                    <button type="button" onClick={exportReport} disabled={!selected.length || !rows.length} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-40"><FileSpreadsheet size={16} />Xuất Excel</button></div>
            </div>
        </div>
    </DialogFrame>, document.body);
};
export default ReportExportDialog;
