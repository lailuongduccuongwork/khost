
import React, { useState, useMemo, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DollarSign, BedDouble, CalendarCheck, TrendingUp, Filter, Calendar, CreditCard, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { Booking, BookingStatus, Room } from '../types';

interface DashboardProps {
  bookings: Booking[];
  rooms: Room[];
}

type DatePreset = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'LAST_WEEK' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'THIS_QUARTER' | 'LAST_QUARTER' | 'THIS_YEAR' | 'LAST_YEAR' | 'CUSTOM';

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
    { label: 'Hôm nay', value: 'TODAY' },
    { label: 'Hôm qua', value: 'YESTERDAY' },
    { label: 'Tuần này', value: 'THIS_WEEK' },
    { label: 'Tuần trước', value: 'LAST_WEEK' },
    { label: '7 ngày qua', value: 'LAST_7_DAYS' },
    { label: 'Tháng này', value: 'THIS_MONTH' },
    { label: 'Tháng trước', value: 'LAST_MONTH' },
    { label: '30 ngày qua', value: 'LAST_30_DAYS' },
    { label: 'Quý này', value: 'THIS_QUARTER' },
    { label: 'Quý trước', value: 'LAST_QUARTER' },
    { label: 'Năm này', value: 'THIS_YEAR' },
    { label: 'Năm ngoái', value: 'LAST_YEAR' },
    { label: 'Tùy chọn...', value: 'CUSTOM' },
];

// Custom Dot to highlight Min/Max
const CustomizedDot = (props: any) => {
    const { cx, cy, stroke, payload, value, maxVal, minVal } = props;
    
    if (value === maxVal && maxVal > 0) {
        return (
            <svg x={cx - 10} y={cy - 10} width={20} height={20} fill="red" viewBox="0 0 1024 1024">
                <circle cx="512" cy="512" r="512" fill="#ef4444" stroke="white" strokeWidth="50"/>
            </svg>
        );
    }
    if (value === minVal && maxVal > 0) {
        return (
             <svg x={cx - 6} y={cy - 6} width={12} height={12} fill="orange" viewBox="0 0 1024 1024">
                <circle cx="512" cy="512" r="512" fill="#f97316" stroke="white" strokeWidth="50" />
            </svg>
        );
    }
    
    return (
        <circle cx={cx} cy={cy} r={4} stroke={stroke} strokeWidth={2} fill="white" />
    );
};

const Dashboard: React.FC<DashboardProps> = ({ bookings, rooms }) => {
  // --- Filter State ---
  const [filterPreset, setFilterPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // --- Date Logic ---
  useEffect(() => {
    const getRange = (preset: DatePreset): { start: Date, end: Date } | null => {
        const now = new Date();
        const start = new Date(now);
        const end = new Date(now);
        
        const getStartOfWeek = (d: Date) => {
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
            return new Date(d.setDate(diff));
        }

        switch (preset) {
            case 'TODAY': break; 
            case 'YESTERDAY': start.setDate(now.getDate() - 1); end.setDate(now.getDate() - 1); break;
            case 'THIS_WEEK': { const s = getStartOfWeek(new Date()); start.setTime(s.getTime()); } break;
            case 'LAST_WEEK': { const s = getStartOfWeek(new Date()); s.setDate(s.getDate() - 7); start.setTime(s.getTime()); const e = new Date(s); e.setDate(e.getDate() + 6); end.setTime(e.getTime()); } break;
            case 'LAST_7_DAYS': start.setDate(now.getDate() - 7); break;
            case 'THIS_MONTH': start.setDate(1); break;
            case 'LAST_MONTH': start.setMonth(now.getMonth() - 1); start.setDate(1); end.setDate(0); break;
            case 'LAST_30_DAYS': start.setDate(now.getDate() - 30); break;
            case 'THIS_QUARTER': { const q = Math.floor(now.getMonth() / 3); start.setMonth(q * 3); start.setDate(1); } break;
            case 'LAST_QUARTER': { const q = Math.floor(now.getMonth() / 3) - 1; if (q < 0) { start.setFullYear(now.getFullYear() - 1); start.setMonth(9); } else { start.setMonth(q * 3); } start.setDate(1); const e = new Date(start); e.setMonth(e.getMonth() + 3); e.setDate(0); end.setTime(e.getTime()); } break;
            case 'THIS_YEAR': start.setMonth(0, 1); break;
            case 'LAST_YEAR': start.setFullYear(now.getFullYear() - 1); start.setMonth(0, 1); end.setFullYear(now.getFullYear() - 1); end.setMonth(11, 31); break;
            case 'CUSTOM': return null;
        }
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    };

    if (filterPreset !== 'CUSTOM') {
        const range = getRange(filterPreset);
        if (range) {
            const toLocalISO = (d: Date) => {
                const offset = d.getTimezoneOffset() * 60000;
                return (new Date(d.getTime() - offset)).toISOString().split('T')[0];
            };
            setStartDate(toLocalISO(range.start));
            setEndDate(toLocalISO(range.end));
        }
    }
  }, [filterPreset]);

  // --- Helper: Check date in range ---
  const isInRange = (dateStr: string) => {
      if (!startDate || !endDate) return false;
      const d = new Date(dateStr).getTime();
      const s = new Date(startDate); s.setHours(0,0,0,0);
      const e = new Date(endDate); e.setHours(23,59,59,999);
      return d >= s.getTime() && d <= e.getTime();
  };

  // --- Helper: Format Currency ---
  const formatVND = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
  const formatCompactVND = (val: number) => {
      if (val >= 1000000000) return (val / 1000000000).toFixed(1) + 'B';
      if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
      if (val >= 1000) return (val / 1000).toFixed(0) + 'K';
      return val.toString();
  };


  // ==========================================
  // 1. STATS: CHECKED-OUT (Khách đã trả phòng)
  // ==========================================
  const checkoutStats = useMemo(() => {
      const filtered = bookings.filter(b => 
          b.status === BookingStatus.CHECKED_OUT && 
          isInRange(b.checkOutDate)
      );

      return {
          count: filtered.length,
          totalBill: filtered.reduce((sum, b) => sum + b.totalPrice, 0),
          paid: filtered.reduce((sum, b) => sum + b.paidAmount, 0),
          debt: filtered.reduce((sum, b) => sum + (b.totalPrice - b.paidAmount), 0),
          totalNights: filtered.reduce((sum, b) => {
              const start = new Date(b.checkInDate).getTime();
              const end = new Date(b.checkOutDate).getTime();
              const nights = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
              return sum + nights;
          }, 0)
      };
  }, [bookings, startDate, endDate]);


  // ==========================================
  // 2. STATS: CREATED / PHÁT SINH (Đơn mới)
  // ==========================================
  const createdStats = useMemo(() => {
      const filtered = bookings.filter(b => 
          b.status !== BookingStatus.DELETED && 
          isInRange(b.createdAt)
      );

      return {
          count: filtered.length,
          totalBill: filtered.reduce((sum, b) => sum + b.totalPrice, 0),
          paid: filtered.reduce((sum, b) => sum + b.paidAmount, 0),
          debt: filtered.reduce((sum, b) => sum + (b.totalPrice - b.paidAmount), 0)
      };
  }, [bookings, startDate, endDate]);


  // ==========================================
  // 3. STATS: OCCUPANCY (OCC%) & ADR
  // ==========================================
  const performanceStats = useMemo(() => {
      if (!startDate || !endDate || rooms.length === 0) return { occ: 0, adr: 0, occupiedInventory: 0, totalInventory: 0 };

      const start = new Date(startDate); start.setHours(0,0,0,0);
      const end = new Date(endDate); end.setHours(23,59,59,999);
      
      const oneDay = 24 * 60 * 60 * 1000;
      const daysDiff = Math.round(Math.abs((end.getTime() - start.getTime()) / oneDay)) + 1;
      const totalInventory = rooms.length * daysDiff;

      let occupiedInventory = 0;
      
      for (let i = 0; i < daysDiff; i++) {
          const currentDay = new Date(start.getTime() + i * oneDay);
          currentDay.setHours(12, 0, 0, 0); 
          const occupiedRoomsOnThisDay = new Set<string>();

          bookings.forEach(b => {
             if (b.status === BookingStatus.DELETED || b.status === BookingStatus.CANCELLED) return;
             const bStart = new Date(b.checkInDate);
             const bEnd = new Date(b.checkOutDate);
             const bStartDay = new Date(bStart); bStartDay.setHours(0,0,0,0);
             const bEndDay = new Date(bEnd); bEndDay.setHours(0,0,0,0);
             const cDay = new Date(currentDay); cDay.setHours(0,0,0,0);

             if (cDay.getTime() >= bStartDay.getTime()) {
                 if (bStartDay.getTime() === bEndDay.getTime()) {
                     if (cDay.getTime() === bStartDay.getTime()) occupiedRoomsOnThisDay.add(b.roomId);
                 } else {
                     if (cDay.getTime() < bEndDay.getTime()) occupiedRoomsOnThisDay.add(b.roomId);
                 }
             }
          });
          occupiedInventory += occupiedRoomsOnThisDay.size;
      }

      const occ = totalInventory > 0 ? Math.min(100, Math.round((occupiedInventory / totalInventory) * 100)) : 0;
      const adr = checkoutStats.totalNights > 0 ? Math.round(checkoutStats.totalBill / checkoutStats.totalNights) : 0;

      return { occ, adr, occupiedInventory, totalInventory };
  }, [bookings, rooms, startDate, endDate, checkoutStats]);


  // ==========================================
  // 4. CHART DATA: DAILY REVENUE (Line Chart)
  // ==========================================
  const { chartData, maxVal, minVal } = useMemo(() => {
    if (!startDate || !endDate) return { chartData: [], maxVal: 0, minVal: 0 };

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = [];
    
    // Generate dates
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    const data = days.map(day => {
        const dayStr = day.toISOString().split('T')[0];
        // Filter bookings CHECKED_OUT on this specific day
        const dayBookings = bookings.filter(b => 
            b.status === BookingStatus.CHECKED_OUT && 
            b.checkOutDate.startsWith(dayStr)
        );

        const total = dayBookings.reduce((sum, b) => sum + b.totalPrice, 0);
        const paid = dayBookings.reduce((sum, b) => sum + b.paidAmount, 0);

        return {
            dateStr: dayStr,
            name: `${day.getDate()}/${day.getMonth() + 1}`,
            totalBill: total,
            paidAmount: paid
        };
    });

    const max = Math.max(...data.map(d => d.totalBill));
    const min = Math.min(...data.map(d => d.totalBill));

    return { chartData: data, maxVal: max, minVal: min };
  }, [bookings, startDate, endDate]);


  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
              <h2 className="text-2xl font-bold text-gray-800">Tổng quan hoạt động</h2>
              <p className="text-gray-500 text-sm">Thống kê chi tiết theo thời gian thực</p>
          </div>
          
          {/* FILTER BAR */}
          <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-2 items-center">
             <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-gray-700 font-semibold text-sm">
                 <Filter size={16} />
                 <span>Lọc:</span>
             </div>
             
             <select 
                className="bg-white border-none text-gray-900 text-sm font-semibold focus:ring-0 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-2"
                value={filterPreset}
                onChange={(e) => setFilterPreset(e.target.value as DatePreset)}
             >
                 {DATE_PRESETS.map(p => (
                     <option key={p.value} value={p.value}>{p.label}</option>
                 ))}
             </select>

             <div className="h-6 w-px bg-gray-300 mx-1"></div>

             <div className="flex items-center gap-2">
                 <input 
                    type="date" 
                    className="border border-gray-200 text-gray-700 text-xs rounded-lg px-2 py-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                    value={startDate}
                    onChange={(e) => { setFilterPreset('CUSTOM'); setStartDate(e.target.value); }}
                 />
                 <span className="text-gray-400 font-bold">-</span>
                 <input 
                    type="date" 
                    className="border border-gray-200 text-gray-700 text-xs rounded-lg px-2 py-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                    value={endDate}
                    onChange={(e) => { setFilterPreset('CUSTOM'); setEndDate(e.target.value); }}
                 />
             </div>
          </div>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        
        {/* GROUP 1: CHECKED OUT STATS */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
             <div className="bg-green-50/50 p-4 border-b border-green-100 flex justify-between items-center">
                 <div>
                     <h3 className="text-green-800 font-bold flex items-center gap-2"><CalendarCheck size={18}/> Khách đã trả phòng</h3>
                     <p className="text-xs text-green-600 mt-0.5">Dựa trên ngày check-out</p>
                 </div>
                 <span className="bg-white text-green-700 font-bold px-3 py-1 rounded-full text-xs border border-green-200 shadow-sm">
                     {checkoutStats.count} Đơn
                 </span>
             </div>
             <div className="p-5 space-y-4">
                 <div className="flex justify-between items-end">
                     <span className="text-gray-500 text-sm font-medium">Tổng Bill</span>
                     <span className="text-xl font-bold text-gray-800">{formatVND(checkoutStats.totalBill)}</span>
                 </div>
                 <div className="h-px bg-gray-100"></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                         <span className="text-xs text-gray-400 font-bold uppercase block mb-1">Thực thu</span>
                         <span className="text-green-600 font-bold">{formatVND(checkoutStats.paid)}</span>
                     </div>
                     <div className="text-right">
                         <span className="text-xs text-gray-400 font-bold uppercase block mb-1">Công nợ</span>
                         <span className={`${checkoutStats.debt > 0 ? 'text-red-500' : 'text-gray-400'} font-bold`}>
                             {formatVND(checkoutStats.debt)}
                         </span>
                     </div>
                 </div>
             </div>
        </div>

        {/* GROUP 2: CREATED BOOKINGS STATS */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
             <div className="bg-blue-50/50 p-4 border-b border-blue-100 flex justify-between items-center">
                 <div>
                     <h3 className="text-blue-800 font-bold flex items-center gap-2"><CreditCard size={18}/> Đặt phòng phát sinh</h3>
                     <p className="text-xs text-blue-600 mt-0.5">Dựa trên ngày tạo đơn</p>
                 </div>
                 <span className="bg-white text-blue-700 font-bold px-3 py-1 rounded-full text-xs border border-blue-200 shadow-sm">
                     {createdStats.count} Đơn
                 </span>
             </div>
             <div className="p-5 space-y-4">
                 <div className="flex justify-between items-end">
                     <span className="text-gray-500 text-sm font-medium">Tổng giá trị</span>
                     <span className="text-xl font-bold text-gray-800">{formatVND(createdStats.totalBill)}</span>
                 </div>
                 <div className="h-px bg-gray-100"></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                         <span className="text-xs text-gray-400 font-bold uppercase block mb-1">Đã cọc/TT</span>
                         <span className="text-blue-600 font-bold">{formatVND(createdStats.paid)}</span>
                     </div>
                     <div className="text-right">
                         <span className="text-xs text-gray-400 font-bold uppercase block mb-1">Chưa thu</span>
                         <span className={`${createdStats.debt > 0 ? 'text-orange-500' : 'text-gray-400'} font-bold`}>
                             {formatVND(createdStats.debt)}
                         </span>
                     </div>
                 </div>
             </div>
        </div>

        {/* GROUP 3: PERFORMANCE STATS */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-2 xl:col-span-1">
             <div className="bg-purple-50/50 p-4 border-b border-purple-100 flex justify-between items-center">
                 <div>
                     <h3 className="text-purple-800 font-bold flex items-center gap-2"><TrendingUp size={18}/> Hiệu suất phòng</h3>
                     <p className="text-xs text-purple-600 mt-0.5">Chỉ số vận hành</p>
                 </div>
             </div>
             <div className="p-5 grid grid-cols-2 gap-6 h-full items-center">
                 <div className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100">
                     <div className="text-purple-600 mb-1 flex justify-center"><BedDouble size={24}/></div>
                     <p className="text-xs text-gray-500 font-bold uppercase">Công suất (OCC)</p>
                     <p className="text-2xl font-extrabold text-gray-800 mt-1">{performanceStats.occ}%</p>
                     <p className="text-[10px] text-gray-400 mt-1">{performanceStats.occupiedInventory}/{performanceStats.totalInventory} Inventory</p>
                 </div>
                 
                 <div className="text-center p-3 rounded-xl bg-gray-50 border border-gray-100">
                     <div className="text-green-600 mb-1 flex justify-center"><DollarSign size={24}/></div>
                     <p className="text-xs text-gray-500 font-bold uppercase">Bình quân (ADR)</p>
                     <p className="text-2xl font-extrabold text-gray-800 mt-1">{performanceStats.adr.toLocaleString()}</p>
                     <p className="text-[10px] text-gray-400 mt-1">VNĐ / Đêm</p>
                 </div>
             </div>
        </div>

      </div>

      {/* LINE CHART SECTION */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 w-full">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div>
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">Biểu đồ doanh thu thực tế</h3>
                  <p className="text-sm text-gray-500 mt-1">
                      Thống kê theo ngày khách trả phòng (Check-out)
                  </p>
              </div>
              <div className="flex gap-4 text-xs font-medium bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
                   <div className="flex items-center gap-2 text-green-700">
                       <ArrowUpCircle size={14} className="text-red-500" />
                       <span>Cao nhất: {formatCompactVND(maxVal)}</span>
                   </div>
                   <div className="w-px h-4 bg-gray-300"></div>
                   <div className="flex items-center gap-2 text-orange-700">
                       <ArrowDownCircle size={14} className="text-orange-500" />
                       <span>Thấp nhất: {formatCompactVND(minVal)}</span>
                   </div>
              </div>
          </div>

          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#9ca3af', fontSize: 12}} 
                    dy={10} 
                    padding={{left: 20, right: 20}}
                />
                <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#9ca3af', fontSize: 12}} 
                    tickFormatter={(val) => formatCompactVND(val)} 
                />
                <Tooltip 
                    formatter={(value: number) => formatVND(value)} 
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{color: '#6b7280', marginBottom: '0.25rem', fontSize: '0.75rem'}}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                
                {/* Tổng Bill - Green Line */}
                <Line 
                    type="monotone" 
                    dataKey="totalBill" 
                    name="Tổng bill"
                    stroke="#10b981" 
                    strokeWidth={3} 
                    dot={<CustomizedDot maxVal={maxVal} minVal={minVal} />} 
                    activeDot={{ r: 6, strokeWidth: 0 }}
                />

                {/* Đã Trả - Blue Line */}
                <Line 
                    type="monotone" 
                    dataKey="paidAmount" 
                    name="Tiền đã trả"
                    stroke="#3b82f6" 
                    strokeWidth={3} 
                    dot={false}
                    strokeDasharray="5 5"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;
