
import React, { useState } from 'react';
import { Booking, BookingStatus, Room, Customer, User, PERMISSIONS } from '../types';
import { Search, Plus, Eye, Trash2 } from 'lucide-react';
import { DataService } from '../services/dataService';

interface BookingsProps {
  bookings: Booking[];
  rooms: Room[];
  customers: Customer[];
  onRefresh?: () => void;
  currentUser: User; // Full user for permissions
}

const Bookings: React.FC<BookingsProps> = ({ bookings, rooms, customers, onRefresh, currentUser }) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const canAdd = currentUser.permissions?.includes(PERMISSIONS.CAN_ADD_BOOKING);
  const canDelete = currentUser.permissions?.includes(PERMISSIONS.CAN_DELETE_BOOKING);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Unknown';
  const getRoomNumber = (id: string) => rooms.find(r => r.id === id)?.number || 'N/A';

  const filteredBookings = bookings.filter(b => {
    const customerName = getCustomerName(b.customerId).toLowerCase();
    const roomNumber = getRoomNumber(b.roomId).toLowerCase();
    const term = searchTerm.toLowerCase();
    return customerName.includes(term) || roomNumber.includes(term) || b.id.toLowerCase().includes(term);
  });

  const getStatusBadge = (status: BookingStatus) => {
      const styles = {
          [BookingStatus.PENDING]: 'bg-yellow-100 text-yellow-800',
          [BookingStatus.CONFIRMED]: 'bg-blue-100 text-blue-800',
          [BookingStatus.CHECKED_IN]: 'bg-green-100 text-green-800',
          [BookingStatus.CHECKED_OUT]: 'bg-gray-100 text-gray-800',
          [BookingStatus.CANCELLED]: 'bg-red-100 text-red-800',
          [BookingStatus.DELETED]: 'bg-black text-white',
      };
      return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>{status}</span>;
  };

  const handleDelete = (id: string) => {
      if (!canDelete) return;

      if(window.confirm(`CẢNH BÁO: Bạn có chắc chắn muốn xóa vĩnh viễn đơn đặt phòng #${id}?\n\nHành động này sẽ:\n- Xoá đơn khỏi sơ đồ phòng.\n- Xoá đơn khỏi báo cáo doanh thu.\n- Không thể khôi phục.`)) {
          const success = DataService.deleteBooking(id, currentUser.id);
          if (success) {
              alert("Đã xoá đơn thành công.");
              if(onRefresh) onRefresh();
          } else {
              alert("Lỗi: Không thể xoá đơn này.");
          }
      }
  };

  const handleCreate = () => {
      if(!canAdd) {
          alert("Bạn không có quyền tạo đơn.");
          return;
      }
      // Note: This page currently doesn't have a create modal hooked up directly in the original code,
      // it just had a button. In a real scenario, this would open a modal.
      alert("Vui lòng sử dụng Sơ đồ phòng để tạo đơn mới trực quan hơn.");
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 animate-fade-in">
      <div className="p-5 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-lg font-bold text-gray-800">Danh sách đặt phòng</h2>
        {canAdd && (
            <button 
                onClick={handleCreate}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
            >
                <Plus size={16} /> Tạo đặt phòng
            </button>
        )}
      </div>
      
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
                type="text" 
                placeholder="Tìm theo tên khách, số phòng, mã đơn..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-gray-700 font-semibold uppercase text-xs">
            <tr>
              <th className="px-6 py-3">Mã Booking</th>
              <th className="px-6 py-3">Khách hàng</th>
              <th className="px-6 py-3">Phòng</th>
              <th className="px-6 py-3">Ngày đến - Đi</th>
              <th className="px-6 py-3">Trạng thái</th>
              <th className="px-6 py-3">Tổng tiền</th>
              <th className="px-6 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredBookings.map((booking) => (
              <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-mono text-blue-600 font-medium">{booking.id}</td>
                <td className="px-6 py-4 font-medium text-gray-900">{getCustomerName(booking.customerId)}</td>
                <td className="px-6 py-4"><span className="bg-gray-100 px-2 py-1 rounded font-bold text-gray-700">{getRoomNumber(booking.roomId)}</span></td>
                <td className="px-6 py-4">
                    <div className="flex flex-col text-xs">
                        <span>In: {new Date(booking.checkInDate).toLocaleDateString('vi-VN')}</span>
                        <span className="text-gray-400">Out: {new Date(booking.checkOutDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                </td>
                <td className="px-6 py-4">{getStatusBadge(booking.status)}</td>
                <td className="px-6 py-4 font-semibold text-gray-700">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(booking.totalPrice)}
                </td>
                <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                        {canDelete && (
                            <button 
                                onClick={() => handleDelete(booking.id)} 
                                className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors" 
                                title="Xóa đơn vĩnh viễn"
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                </td>
              </tr>
            ))}
            {filteredBookings.length === 0 && (
                <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-400">Không tìm thấy dữ liệu</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Bookings;
