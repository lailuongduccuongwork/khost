import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Booking, BookingStatus } from '../types';
import { DataService } from '../services/dataService';
import { FinancialContext, financialSnapshot } from '../utils/financialTransactions';
import { deriveBookingStatus } from '../utils/bookingState';
import BookingDetailDialog from './BookingDetailDialog';
import DialogFrame from './DialogFrame';

interface Props {
    request: { bookingId: string; propertyId: string };
    propertyIds: string[];
    tenantId: string;
    context: FinancialContext;
    onDismiss: () => void;
}

const STATUS_LABELS: Record<BookingStatus, string> = {
    [BookingStatus.HOLD]: 'Giữ chỗ', [BookingStatus.CONFIRMED]: 'Đã xác nhận',
    [BookingStatus.CHECKED_IN]: 'Đang ở', [BookingStatus.CHECKED_OUT]: 'Đã trả',
    [BookingStatus.DELETED]: 'Đã xóa',
};

const ReportBookingDetails: React.FC<Props> = ({ request, propertyIds, tenantId, context, onDismiss }) => {
    const [detail, setDetail] = useState<{ booking: Booking; members: Booking[]; historical: boolean } | null>(null);
    const [error, setError] = useState('');
    const propertyKey = propertyIds.slice().sort().join(',');

    useEffect(() => {
        let cancelled = false;
        setDetail(null); setError('');
        const allowed = new Set(propertyIds);
        const permitted = (booking: Booking) => booking?.id === request.bookingId && allowed.has(booking.propertyId)
            && (!booking.tenantId || booking.tenantId === tenantId);
        if (!allowed.has(request.propertyId)) { onDismiss(); return; }
        const load = async () => {
            let booking = await DataService.fetchBookingById(request.bookingId, { forceRemote: true });
            const historical = !booking || booking.status === BookingStatus.DELETED;
            if (!booking) {
                const logs = await DataService.fetchBookingHistory({ bookingIds: [request.bookingId], limit: 120, fallbackLimit: 80 });
                const snapshots = [...logs].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
                    .flatMap(log => [log.after, log.bookingSnapshot, log.before]);
                const snapshot = snapshots.find(value => value && permitted(value as Booking)
                    && (value as Booking).createdAt && (value as Booking).checkInDate) as Booking | undefined;
                if (snapshot) booking = { ...snapshot, status: BookingStatus.DELETED };
            }
            if (!booking) throw new Error('Không còn thông tin chi tiết của đơn này trong dữ liệu hoặc lịch sử đặt phòng.');
            if (!permitted(booking)) throw new Error('Đơn này không thuộc phạm vi chi nhánh bạn được xem.');
            const members = booking.groupId && !historical
                ? await DataService.fetchBookingGroupMembers(booking.groupId, propertyIds)
                : [booking];
            if (!cancelled) setDetail({ booking, members: [booking, ...members.filter(b => b.id !== booking!.id
                && allowed.has(b.propertyId) && (!b.tenantId || b.tenantId === tenantId))], historical });
        };
        load().catch(err => {
            if (!cancelled) setError(err instanceof Error && (err.message.startsWith('Không còn') || err.message.startsWith('Đơn này'))
                ? err.message : 'Không tải được chi tiết đặt phòng. Vui lòng đóng hộp thoại và thử lại.');
        });
        return () => { cancelled = true; };
    }, [request.bookingId, request.propertyId, propertyKey, tenantId]);

    if (!detail) return createPortal(<DialogFrame label="Chi tiết đặt phòng" onDismiss={onDismiss}
        className="fixed inset-0 bg-black/50 z-[104] flex items-center justify-center p-3" onClick={onDismiss}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center gap-3 mb-4">
                <h3 className="font-bold text-gray-900">Chi tiết đơn #{request.bookingId}</h3>
                <button type="button" onClick={onDismiss} aria-label="Đóng chi tiết" className="p-2 rounded-full text-gray-500 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <p role={error ? 'alert' : 'status'} className={error ? 'text-red-600 text-sm' : 'text-gray-500 text-sm'}>{error || 'Đang tải chi tiết đặt phòng...'}</p>
        </div>
    </DialogFrame>, document.body);

    const { booking, members, historical } = detail;
    const room = context.rooms.find(r => r.id === booking.roomId);
    const snapshot = financialSnapshot(booking, members, context, !historical);
    return createPortal(<BookingDetailDialog booking={booking} guestName={booking.guestName || 'Khách lẻ'}
        propertyName={snapshot.property} roomNumber={room?.number || booking.roomId || 'Phòng không xác định'}
        roomTypeName={snapshot.roomType || 'Không xác định'} hasRoom={!!room}
        statusLabel={STATUS_LABELS[deriveBookingStatus(booking)]} creatorLabel={snapshot.createdBy}
        tagNames={(booking.tags || []).map(id => context.tags.find(t => t.id === id)?.name || id)}
        financialSummary={{ totalBill: snapshot.totalBill, extraRevenue: snapshot.otherRevenue, extraExpense: snapshot.otherExpenses,
            netRevenue: snapshot.netRevenue, paidAmount: snapshot.paidAmount, outstanding: snapshot.debt, isGroupedChild: false }}
        historical={historical} financialLabel={booking.groupId ? 'Tài chính đơn nhóm' : 'Tài chính'} onDismiss={onDismiss} />, document.body);
};

export default ReportBookingDetails;
