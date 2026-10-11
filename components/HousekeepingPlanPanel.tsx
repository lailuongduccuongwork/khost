import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Property, Room } from '../types';
import { DataService } from '../services/dataService';
import { CleaningAssignment, housekeepingDate } from '../utils/housekeepingPlan';

export default function HousekeepingPlanPanel({ properties, propertyIds }: { properties: Property[]; propertyIds: string[] }) {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const [date, setDate] = useState(today);
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [rows, setRows] = useState<CleaningAssignment[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [incomplete, setIncomplete] = useState(false);
    const scope = [...propertyIds].sort().join('|');
    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(''); setRows([]);
        DataService.fetchHousekeepingPlan(scope.split('|').filter(Boolean), date).then(result => {
            if (!cancelled) { setRows(result.assignments); setRooms(result.rooms); setIncomplete(result.incomplete); }
        }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Không tải được lịch dọn.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [scope, date, revision]);
    return <div className="m-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Lịch dọn dự kiến theo nhân viên</h2><p className="text-sm text-gray-500 mt-1">Các phòng có khách nhận trong ngày được chọn; gồm cả cơ sở dùng chung nhân viên.</p></div>
            <div className="flex gap-2"><input type="date" aria-label="Ngày xem lịch dọn" min={today} value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button type="button" aria-label="Làm mới lịch dọn" disabled={loading} onClick={() => setRevision(v => v + 1)} className="rounded-lg border border-gray-300 p-2"><RefreshCw size={18} /></button></div>
        </div>
        <p className="text-sm text-gray-600 mt-3">Lịch này là dự kiến, có tính ca làm, ngày nghỉ và di chuyển. Phòng chỉ được xác nhận sạch khi nhân viên báo đã dọn xong.</p>
        {incomplete && <p role="alert" className="mt-3 text-sm text-amber-700">Chưa xem được đầy đủ cơ sở dùng chung nhân viên do giới hạn quyền truy cập.</p>}
        {loading ? <div role="status" className="flex gap-2 py-8 justify-center text-gray-500"><Loader2 className="animate-spin" size={20} />Đang kiểm tra lịch dọn...</div> : error ? <p role="alert" className="py-5 text-red-600">{error}</p> : <>
            <div className="my-4 flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={17} className="text-amber-600" />{rows.filter(r => r.late).length} lượt có nguy cơ trễ / {rows.length} lượt cần dọn</div>
            <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-gray-50 text-gray-600"><tr>{['Phòng', 'Cơ sở', 'Nhân viên', 'Có thể bắt đầu từ', 'Lịch dọn dự kiến', 'Khách nhận phòng', 'Đánh giá'].map(label => <th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead>
                <tbody>{rows.map(r => <tr key={r.id} className={`border-t border-gray-100 ${r.late ? 'bg-amber-50/70' : ''}`}><td className="p-3 font-semibold">{rooms.find(room => room.id === r.roomId)?.number || r.roomId}</td><td className="p-3">{properties.find(p => p.id === r.propertyId)?.name || 'Cơ sở liên quan'}</td><td className="p-3">{r.workerName || 'Chưa xếp được'}</td><td className="p-3 whitespace-nowrap">{housekeepingDate(r.release)}</td><td className="p-3 whitespace-nowrap">{r.start && r.end ? `${housekeepingDate(r.start)} → ${housekeepingDate(r.end)}` : 'Chưa có ca phù hợp'}</td><td className="p-3 whitespace-nowrap">{housekeepingDate(r.deadline)}</td><td className={`p-3 font-semibold ${r.late ? 'text-amber-700' : 'text-green-700'}`}>{r.late ? 'Nguy cơ trễ' : 'Dự kiến kịp'}</td></tr>)}</tbody>
            </table></div>{!rows.length && <p className="py-8 text-center text-sm text-gray-500">Không có lượt cần dọn trước giờ khách nhận trong ngày này.</p>}
        </>}
    </div>;
}
