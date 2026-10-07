import React from 'react';
import { X } from 'lucide-react';
import { Booking } from '../types';
import DialogFrame from './DialogFrame';

export interface BookingDetailFinancialSummary {
    totalBill: number | null; extraRevenue: number | null; extraExpense: number | null;
    netRevenue: number | null; paidAmount: number | null; outstanding: number | null;
    isGroupedChild: boolean;
}
interface Props {
    booking: Booking; guestName: string; propertyName: string; roomNumber: string; roomTypeName: string;
    hasRoom: boolean; statusLabel: string; creatorLabel: string; tagNames: string[];
    financialSummary: BookingDetailFinancialSummary; historical?: boolean; financialLabel?: string;
    onDismiss: () => void; onOpenRoomMapBooking?: (booking: Booking) => void;
}
const formatCurrency = (amount: number | null) => amount === null ? '—' : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
const toDateTimeLabel = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const BookingDetailDialog: React.FC<Props> = ({ booking, guestName, propertyName, roomNumber, roomTypeName, hasRoom, statusLabel, creatorLabel, tagNames, financialSummary, historical, financialLabel = 'Tài chính', onDismiss, onOpenRoomMapBooking }) => (
<DialogFrame label="Chi tiết đặt phòng" onDismiss={onDismiss} className="fixed inset-0 bg-black/50 z-[104] flex items-center justify-center p-3 md:p-5" onClick={onDismiss}>
              <div
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden animate-fade-in"
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="px-5 py-4 shrink-0 border-b border-gray-200 flex items-center justify-between">
                      <div>
                          <h3 className="text-lg font-bold text-gray-900">Chi tiết đơn #{booking.id}</h3>
                          <p className="text-xs text-gray-500 mt-1">Xem nhanh thông tin khách, phòng, lịch ở và tài chính</p>
                      </div>
                      <button
                          onClick={onDismiss}
                          className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title="Đóng chi tiết" aria-label="Đóng chi tiết"
                      >
                          <X size={18} />
                      </button>
                  </div>

                  {historical && <div role="status" className="mx-5 mt-4 shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">Đơn đã bị xóa. Thông tin dưới đây được lấy từ lịch sử đặt phòng.</div>}
                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm min-h-0 overflow-y-auto">
                      <div className="space-y-3">
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Khách hàng</div>
                              <div className="mt-2 text-base font-bold text-gray-900">{guestName}</div>
                              <div className="text-sm text-gray-600 mt-1">{booking.guestPhone || '--'}</div>
                              <div className="text-sm text-gray-600 mt-1">Trạng thái: <span className="font-semibold text-gray-900">{statusLabel}</span></div>
                          </div>
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Lưu trú</div>
                              <div className="mt-2 text-sm text-gray-700">Chi nhánh: <span className="font-semibold text-gray-900">{propertyName}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Phòng: <span className="font-semibold text-gray-900">{roomNumber}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Hạng phòng: <span className="font-semibold text-gray-900">{roomTypeName}</span></div>
                              {!hasRoom && (
                                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                                      Phòng của đơn này không còn khớp dữ liệu phòng hiện tại.
                                  </div>
                              )}
                              <div className="mt-1 text-sm text-gray-700">Nhận phòng: <span className="font-semibold text-gray-900">{toDateTimeLabel(booking.checkInDate)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Trả phòng: <span className="font-semibold text-gray-900">{toDateTimeLabel(booking.checkOutDate)}</span></div>
                              {onOpenRoomMapBooking && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                      <button
                                          onClick={() => onOpenRoomMapBooking(booking)}
                                          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                      >
                                          Mở trên sơ đồ phòng
                                      </button>
                                      <button
                                          onClick={() => onOpenRoomMapBooking(booking)}
                                          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
                                      >
                                          Sửa đơn
                                      </button>
                                  </div>
                              )}
                          </div>
                      </div>

                      <div className="space-y-3">
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">{financialLabel}</div>
                              {(() => {
                                  const summary = financialSummary;
                                  return (
                                      <div className="mt-2 space-y-1 text-sm text-gray-700">
                                          <div>Tiền phòng: <span className="font-semibold text-gray-900">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.totalBill === null || summary.extraRevenue === null ? null : summary.totalBill - summary.extraRevenue)}</span></div>
                                          <div>Thu khác: <span className="font-semibold text-green-700">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.extraRevenue)}</span></div>
                                          <div>Tổng bill: <span className="font-semibold text-gray-900">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.totalBill)}</span></div>
                                          <div>Chi khác: <span className="font-semibold text-red-700">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.extraExpense)}</span></div>
                                          <div>Doanh thu net: <span className="font-semibold text-blue-700">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.netRevenue)}</span></div>
                                          <div>Đã trả: <span className="font-semibold text-gray-900">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.paidAmount)}</span></div>
                                          <div>Còn nợ: <span className={`font-semibold ${summary.outstanding > 0 ? 'text-red-700' : 'text-green-700'}`}>{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.outstanding)}</span></div>
                                      </div>
                                  );
                              })()}
                          </div>
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Khác</div>
                              <div className="mt-2 text-sm text-gray-700">Nhân viên tạo: <span className="font-semibold text-gray-900">{creatorLabel}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Ngày tạo: <span className="font-semibold text-gray-900">{toDateTimeLabel(booking.createdAt)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Tags: <span className="font-semibold text-gray-900">{tagNames.length > 0 ? tagNames.join(', ') : '--'}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Ghi chú:</div>
                              <div className="mt-1 rounded-lg bg-white border border-gray-200 p-3 text-sm text-gray-700 min-h-20 whitespace-pre-wrap">
                                  {booking.notes || 'Không có ghi chú'}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </DialogFrame>
);
export default BookingDetailDialog;
