import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { DollarSign, BedDouble, CalendarCheck, TrendingUp } from 'lucide-react';
import { Booking, BookingStatus, Room, RoomStatus } from '../types';

interface DashboardProps {
  bookings: Booking[];
  rooms: Room[];
}

const Dashboard: React.FC<DashboardProps> = ({ bookings, rooms }) => {
  // --- Stats Calculation ---
  const totalRevenue = useMemo(() => {
    return bookings
      .filter(b => b.status === BookingStatus.CHECKED_OUT || b.status === BookingStatus.CHECKED_IN)
      .reduce((sum, b) => sum + b.totalPrice, 0);
  }, [bookings]);

  const activeBookings = bookings.filter(b => b.status === BookingStatus.CHECKED_IN).length;
  
  const occupancyRate = useMemo(() => {
    const total = rooms.length;
    if (total === 0) return 0;
    const occupied = rooms.filter(r => r.status === RoomStatus.OCCUPIED).length;
    return Math.round((occupied / total) * 100);
  }, [rooms]);

  const monthlyData = useMemo(() => {
    const data = [
        { name: 'T1', revenue: 0 }, { name: 'T2', revenue: 0 }, { name: 'T3', revenue: 0 },
        { name: 'T4', revenue: 0 }, { name: 'T5', revenue: 0 }, { name: 'T6', revenue: 0 },
        { name: 'T7', revenue: 0 }, { name: 'T8', revenue: 0 }, { name: 'T9', revenue: 0 },
        { name: 'T10', revenue: 0 }, { name: 'T11', revenue: 0 }, { name: 'T12', revenue: 0 }
    ];
    
    bookings.forEach(b => {
      if (b.status !== BookingStatus.CANCELLED) {
        const month = new Date(b.checkInDate).getMonth();
        data[month].revenue += b.totalPrice;
      }
    });
    return data;
  }, [bookings]);

  const occupancyTrend = useMemo(() => {
     // Mock trend data for demo as real historical occupancy is complex to calc from just current snapshot
     return [
        { name: 'T2', rate: 45 }, { name: 'T3', rate: 52 }, { name: 'T4', rate: 48 },
        { name: 'T5', rate: 61 }, { name: 'T6', rate: 75 }, { name: 'T7', rate: 82 },
        { name: 'T8', rate: 78 }
     ];
  }, []);

  const formatVND = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Stat Cards */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Doanh thu (Năm)</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">{formatVND(totalRevenue)}</h3>
            <span className="text-xs text-green-500 flex items-center mt-1"><TrendingUp size={12} className="mr-1"/> +12% so với năm ngoái</span>
          </div>
          <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
            <DollarSign size={24} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Khách đang ở</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">{activeBookings} phòng</h3>
            <span className="text-xs text-gray-400 mt-1">Hôm nay</span>
          </div>
          <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600">
            <User size={24} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
            <p className="text-sm font-medium text-gray-500">Công suất phòng</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">{occupancyRate}%</h3>
            <span className="text-xs text-blue-500 mt-1">Đang hoạt động</span>
          </div>
          <div className="w-12 h-12 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
            <BedDouble size={24} />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Booking mới</p>
            <h3 className="text-2xl font-bold text-gray-800 mt-1">5</h3>
            <span className="text-xs text-gray-400 mt-1">Trong 24h qua</span>
          </div>
          <div className="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center text-green-600">
            <CalendarCheck size={24} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-6">Biểu đồ doanh thu</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} tickFormatter={(val) => `${val/1000000}M`} />
                <Tooltip 
                  formatter={(value: number) => formatVND(value)}
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Occupancy Chart */}
         <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-6">Xu hướng công suất phòng</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={occupancyTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} />
                <Tooltip 
                  formatter={(value: number) => `${value}%`}
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Line type="monotone" dataKey="rate" stroke="#8b5cf6" strokeWidth={3} dot={{r: 4, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff'}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

// Import needed for icons
import { User } from 'lucide-react';

export default Dashboard;