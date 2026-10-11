import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { HousekeepingSettings, HousekeepingWorker, Property, normalizeHousekeepingSettings } from '../types';
import { DataService } from '../services/dataService';

const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export default function HousekeepingSettingsPanel({ properties, settings }: { properties: Property[]; settings?: HousekeepingSettings }) {
    const [draft, setDraft] = useState(() => normalizeHousekeepingSettings(settings));
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [error, setError] = useState('');
    const [dirty, setDirty] = useState(false);
    const signature = JSON.stringify(settings);
    useEffect(() => { if (!dirty) setDraft(normalizeHousekeepingSettings(settings)); }, [signature, dirty]);
    const change = (id: string, value: Partial<HousekeepingWorker>) => {
        setDirty(true); setFeedback(''); setError('');
        setDraft(prev => ({ workers: prev.workers.map(w => w.id === id ? { ...w, ...value } : w) }));
    };
    const add = () => {
        setDirty(true); setFeedback('');
        setDraft(prev => ({ workers: [...prev.workers, { id: `hk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: '', propertyIds: [],
            shiftStart: '08:00', shiftEnd: '22:00', cleaningMinutes: 30, travelMinutes: 15, weekdays: [0, 1, 2, 3, 4, 5, 6], daysOff: [] }] }));
    };
    const save = async () => {
        setError(''); setFeedback('');
        for (const w of draft.workers) {
            if (!w.name.trim() || !w.propertyIds.length) { setError('Mỗi nhân viên cần có tên và ít nhất một cơ sở phụ trách.'); return; }
            if (!w.shiftStart || !w.shiftEnd || w.shiftEnd <= w.shiftStart) { setError(`Ca của ${w.name} cần bắt đầu và kết thúc trong cùng ngày, giờ kết thúc phải sau giờ bắt đầu.`); return; }
            if (!w.weekdays.length) { setError(`Hãy chọn ít nhất một ngày làm việc cho ${w.name}.`); return; }
            if (!Number.isFinite(w.cleaningMinutes) || w.cleaningMinutes < 1 || w.cleaningMinutes > 480 || !Number.isFinite(w.travelMinutes) || w.travelMinutes < 0 || w.travelMinutes > 480) { setError('Thời gian dọn cần từ 1–480 phút; di chuyển từ 0–480 phút.'); return; }
            if ((w.breakStart || w.breakEnd) && (!w.breakStart || !w.breakEnd || w.breakEnd <= w.breakStart || w.breakStart < w.shiftStart || w.breakEnd > w.shiftEnd)) { setError(`Giờ nghỉ của ${w.name} cần nằm trong ca và có đủ giờ bắt đầu, kết thúc.`); return; }
            const available = (Number(w.shiftEnd.slice(0, 2)) * 60 + Number(w.shiftEnd.slice(3))) - (Number(w.shiftStart.slice(0, 2)) * 60 + Number(w.shiftStart.slice(3)));
            if (w.cleaningMinutes > available) { setError(`Ca của ${w.name} ngắn hơn thời gian dọn một phòng.`); return; }
        }
        setSaving(true);
        try { await DataService.saveHousekeepingSettings(draft); setDirty(false); setFeedback('Đã lưu lịch buồng phòng.'); }
        catch (e) { setError(e instanceof Error ? e.message : 'Không thể lưu cấu hình.'); }
        finally { setSaving(false); }
    };
    const input = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
    return <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-5">
        <div><h2 className="text-lg font-bold">Lịch nhân viên buồng phòng</h2>
            <p className="mt-2 text-sm text-gray-600">Thêm mỗi nhân viên một lần và chọn tất cả cơ sở người đó phụ trách. Một người không được tính thành hai người khi làm ở hai cơ sở.</p>
            <p className="mt-2 text-sm text-gray-500">Cơ sở chưa phân công tạm tính 1 người riêng, làm 08:00–22:00 hằng ngày, dọn 30 phút/phòng. Hãy cấu hình người dùng chung để cảnh báo liên cơ sở chính xác hơn.</p>
        </div>
        <fieldset disabled={saving} className="space-y-4">
            {draft.workers.map(w => <div key={w.id} className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-4">
                <div className="flex items-end gap-3"><label className="flex-1 text-sm font-semibold">Tên nhân viên<input className={input} value={w.name} placeholder="Ví dụ: Chị Hương" onChange={e => change(w.id, { name: e.target.value })} /></label>
                    <button type="button" aria-label={`Xóa nhân viên ${w.name || 'chưa đặt tên'}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { setDirty(true); setDraft(prev => ({ workers: prev.workers.filter(worker => worker.id !== w.id) })); }}><Trash2 size={18} /></button>
                </div>
                <div><p className="text-sm font-semibold mb-2">Cơ sở phụ trách</p><div className="flex flex-wrap gap-3">{properties.map(p => <label key={p.id} className="flex gap-2 items-center text-sm"><input type="checkbox" checked={w.propertyIds.includes(p.id)} onChange={e => change(w.id, { propertyIds: e.target.checked ? [...w.propertyIds, p.id] : w.propertyIds.filter(id => id !== p.id) })} />{p.name}</label>)}</div></div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <label className="text-sm">Bắt đầu ca<input type="time" className={input} value={w.shiftStart} onChange={e => change(w.id, { shiftStart: e.target.value })} /></label>
                    <label className="text-sm">Kết thúc ca<input type="time" className={input} value={w.shiftEnd} onChange={e => change(w.id, { shiftEnd: e.target.value })} /></label>
                    <label className="text-sm">Dọn một phòng (phút)<input type="number" min="1" max="480" className={input} value={w.cleaningMinutes} onChange={e => change(w.id, { cleaningMinutes: Number(e.target.value) })} /></label>
                    <label className="text-sm">Di chuyển giữa cơ sở (phút)<input type="number" min="0" max="480" className={input} value={w.travelMinutes} onChange={e => change(w.id, { travelMinutes: Number(e.target.value) })} /></label>
                    <label className="text-sm">Bắt đầu nghỉ (tùy chọn)<input type="time" className={input} value={w.breakStart || ''} onChange={e => change(w.id, { breakStart: e.target.value })} /></label>
                    <label className="text-sm">Kết thúc nghỉ (tùy chọn)<input type="time" className={input} value={w.breakEnd || ''} onChange={e => change(w.id, { breakEnd: e.target.value })} /></label>
                </div>
                <div><p className="text-sm font-semibold mb-2">Ngày làm việc</p><div className="flex flex-wrap gap-3">{weekdays.map((label, d) => <label key={d} className="flex gap-1.5 items-center text-sm"><input type="checkbox" checked={w.weekdays.includes(d)} onChange={e => change(w.id, { weekdays: e.target.checked ? [...w.weekdays, d] : w.weekdays.filter(v => v !== d) })} />{label}</label>)}</div></div>
                <label className="block text-sm">Ngày nghỉ riêng (tùy chọn)<input type="date" className={`${input} max-w-xs`} value="" aria-label={`Thêm ngày nghỉ cho ${w.name || 'nhân viên'}`} onChange={e => { if (e.target.value) change(w.id, { daysOff: [...new Set([...(w.daysOff || []), e.target.value])].sort() }); }} /></label>
                {!!w.daysOff?.length && <div className="flex gap-2 flex-wrap">{w.daysOff.map(day => <button key={day} type="button" className="rounded-full border border-gray-300 px-3 py-1 text-xs" onClick={() => change(w.id, { daysOff: w.daysOff!.filter(d => d !== day) })}>{day.split('-').reverse().join('/')} ×</button>)}</div>}
            </div>)}
            <button type="button" onClick={add} className="flex items-center gap-2 rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700"><Plus size={17} />Thêm nhân viên</button>
        </fieldset>
        <p className="text-sm text-gray-600">Khi không đủ thời gian dọn, sale sẽ thấy cảnh báo và vẫn được lưu sau khi bấm xác nhận. Cấu hình này dùng chung cho mọi tài khoản trong khách sạn.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{feedback && <p role="status" className="text-sm text-green-700">{feedback}</p>}
        <button type="button" disabled={saving} onClick={save} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />} {saving ? 'Đang lưu...' : 'Lưu lịch buồng phòng'}</button>
    </div>;
}
