
import React, { useState, useMemo, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DollarSign, BedDouble, CalendarCheck, Filter, CreditCard, ArrowUpCircle, ArrowDownCircle, Building2, Info } from 'lucide-react';
import { Booking, BookingStatus, Room, Property } from '../types';
import { isArchiveBucketRoom } from '../utils/roomBuckets';
import { deriveBookingStatus } from '../utils/bookingState';

interface DashboardProps {
  bookings: Booking[];
  rooms: Room[];
  properties: Property[];
  currentPropertyId: string;
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

const startOfLocalDay = (input: string | Date) => {
    const date = typeof input === 'string' ? new Date(input) : new Date(input);
    date.setHours(0, 0, 0, 0);
    return date;
};

const getLocalDateKey = (input: string | Date) => {
    const date = typeof input === 'string' ? new Date(input) : new Date(input);
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getMonthKey = (input: string | Date) => {
    const date = typeof input === 'string' ? new Date(input) : new Date(input);
    if (isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
};

const getMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    return month && year ? `${month}/${year}` : monthKey;
};

const aggregateBookingMoney = (source: Booking[], nowMs: number) => {
    const grouped = new Map<string, Booking[]>();
    const singles: Booking[] = [];

    source.forEach((booking) => {
        if (deriveBookingStatus(booking, nowMs) === BookingStatus.DELETED) return;
        if (booking.groupId) {
            const list = grouped.get(booking.groupId) || [];
            list.push(booking);
            grouped.set(booking.groupId, list);
            return;
        }
        singles.push(booking);
    });

    const records = singles.map((booking) => ({
        id: booking.id,
        totalBill: Number(booking.totalPrice) || 0,
        paid: Number(booking.paidAmount) || 0,
    }));

    grouped.forEach((members, groupId) => {
        const sorted = [...members].sort((left, right) => left.id.localeCompare(right.id));
        records.push({
            id: groupId,
            totalBill: sorted.reduce((sum, booking) => sum + (Number(booking.totalPrice) || 0), 0),
            paid: sorted.reduce((sum, booking) => sum + (Number(booking.paidAmount) || 0), 0),
        });
    });

    return {
        count: records.length,
        totalBill: records.reduce((sum, record) => sum + record.totalBill, 0),
        paid: records.reduce((sum, record) => sum + record.paid, 0),
        debt: records.reduce((sum, record) => sum + Math.max(record.totalBill - record.paid, 0), 0),
    };
};

const Dashboard: React.FC<DashboardProps> = ({ bookings, rooms, properties, currentPropertyId }) => {
  // --- Filter State ---
  const [filterPreset, setFilterPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
      const timer = window.setInterval(() => {
          setNowMs(Date.now());
      }, 30_000);

      return () => {
          window.clearInterval(timer);
      };
  }, []);

  const currentPropertyName = useMemo(() => {
      if (currentPropertyId === 'ALL') return `Toàn bộ chi nhánh (${properties.length})`;
      return properties.find((property) => property.id === currentPropertyId)?.name || 'Chi nhánh hiện tại';
  }, [currentPropertyId, properties]);

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

  const dateRangeInfo = useMemo(() => {
      if (!startDate || !endDate) {
          return { valid: false, message: 'Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc.', days: 0 };
      }
      const start = startOfLocalDay(startDate);
      const end = startOfLocalDay(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return { valid: false, message: 'Khoảng ngày không hợp lệ.', days: 0 };
      }
      if (start.getTime() > end.getTime()) {
          return { valid: false, message: 'Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.', days: 0 };
      }
      const oneDay = 24 * 60 * 60 * 1000;
      return {
          valid: true,
          message: '',
          days: Math.floor((end.getTime() - start.getTime()) / oneDay) + 1,
      };
  }, [startDate, endDate]);

  const roomById = useMemo(() => {
      const map = new Map<string, Room>();
      rooms.forEach((room) => {
          if (!isArchiveBucketRoom(room)) map.set(room.id, room);
      });
      return map;
  }, [rooms]);

  // --- INTEGRITY CHECK ---
  // Chỉ tính booking thật sự vận hành doanh thu/công suất.
  // Loại: DELETED, HOLD/giữ phòng và booking phòng không còn tồn tại.
  const isOperationalBooking = (booking: Booking) => {
      const room = roomById.get(booking.roomId);
      if (!room) return false;
      const effectiveStatus = deriveBookingStatus(booking, nowMs);
      if (effectiveStatus === BookingStatus.DELETED) return false;
      if (effectiveStatus === BookingStatus.HOLD) return false;
      if (booking.isHold) return false;
      return true;
  };
  const operationalRooms = useMemo(
      () => rooms.filter((room) => !isArchiveBucketRoom(room)),
      [rooms]
  );

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
      if (!dateRangeInfo.valid) {
          return { count: 0, totalBill: 0, paid: 0, debt: 0, totalNights: 0 };
      }
      const filtered = bookings.filter(b => 
          isOperationalBooking(b) &&
          deriveBookingStatus(b, nowMs) === BookingStatus.CHECKED_OUT && 
          isInRange(b.checkOutDate)
      );

      return {
          ...aggregateBookingMoney(filtered, nowMs),
          totalNights: filtered.reduce((sum, b) => {
              const start = startOfLocalDay(b.checkInDate).getTime();
              const end = startOfLocalDay(b.checkOutDate).getTime();
              const nights = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
              return sum + nights;
          }, 0)
      };
  }, [bookings, rooms, roomById, startDate, endDate, nowMs, dateRangeInfo.valid]);


  // ==========================================
  // 2. STATS: CREATED / PHÁT SINH (Đơn mới)
  // ==========================================
  const createdStats = useMemo(() => {
      if (!dateRangeInfo.valid) {
          return { count: 0, totalBill: 0, paid: 0, debt: 0 };
      }
      const filtered = bookings.filter(b => 
          isOperationalBooking(b) &&
          isInRange(b.createdAt)
      );

      return aggregateBookingMoney(filtered, nowMs);
  }, [bookings, rooms, roomById, startDate, endDate, nowMs, dateRangeInfo.valid]);


  // ==========================================
  // 3. STATS: OCCUPANCY (OCC%) & ADR
  // ==========================================
  const performanceStats = useMemo(() => {
      if (!dateRangeInfo.valid || operationalRooms.length === 0) return { occ: 0, adr: 0, occupiedInventory: 0, totalInventory: 0 };

      const start = startOfLocalDay(startDate);
      
      const oneDay = 24 * 60 * 60 * 1000;
      const daysDiff = dateRangeInfo.days;
      
      // 1. Total Inventory (Tổng quỹ phòng khả dụng)
      const totalInventory = operationalRooms.length * daysDiff;

      // 2. Occupied Inventory: tính đêm ở từ ngày nhận đến trước ngày trả.
      let occupiedInventory = 0;
      const bookingsWithSoldNight = new Set<string>();
      
      for (let i = 0; i < daysDiff; i++) {
          const currentDayStart = new Date(start.getTime() + i * oneDay);
          
          const occupiedRoomsOnThisDay = new Set<string>();

          bookings.forEach(b => {
             if (!isOperationalBooking(b)) return;
             
             const bookingStartDay = startOfLocalDay(b.checkInDate).getTime();
             const bookingEndDay = startOfLocalDay(b.checkOutDate).getTime();

             if (bookingStartDay <= currentDayStart.getTime() && bookingEndDay > currentDayStart.getTime()) {
                 occupiedRoomsOnThisDay.add(b.roomId);
                 bookingsWithSoldNight.add(b.id);
             }
          });
          
          occupiedInventory += occupiedRoomsOnThisDay.size;
      }

      const occ = totalInventory > 0 ? Math.min(100, Math.round((occupiedInventory / totalInventory) * 100)) : 0;
      const soldNightBookings = bookings.filter((booking) => bookingsWithSoldNight.has(booking.id));
      const totalRevenue = aggregateBookingMoney(soldNightBookings, nowMs).totalBill;
      const adr = occupiedInventory > 0 ? Math.round(totalRevenue / occupiedInventory) : 0;

      return { occ, adr, occupiedInventory, totalInventory };
  }, [bookings, operationalRooms, roomById, startDate, endDate, nowMs, dateRangeInfo.valid, dateRangeInfo.days]);


  // ==========================================
  // 4. CHART DATA: DAILY REVENUE (Line Chart)
  // ==========================================
  const { chartData, maxVal, minVal, chartGranularity } = useMemo(() => {
    if (!dateRangeInfo.valid) return { chartData: [], maxVal: 0, minVal: 0, chartGranularity: 'DAY' as const };

    const start = startOfLocalDay(startDate);
    const end = startOfLocalDay(endDate);
    const shouldGroupByMonth = dateRangeInfo.days > 45;
    const days = [];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    const checkoutBookings = bookings.filter(b => 
            isOperationalBooking(b) &&
            deriveBookingStatus(b, nowMs) === BookingStatus.CHECKED_OUT && 
            isInRange(b.checkOutDate)
    );

    const data = shouldGroupByMonth
        ? Array.from(new Set(days.map((day) => getMonthKey(day)))).map((monthKey) => {
            const monthBookings = checkoutBookings.filter((booking) => getMonthKey(booking.checkOutDate) === monthKey);
            const totals = aggregateBookingMoney(monthBookings, nowMs);
            return {
                dateStr: monthKey,
                name: getMonthLabel(monthKey),
                totalBill: totals.totalBill,
                paidAmount: totals.paid,
            };
        })
        : days.map(day => {
            const dayStr = getLocalDateKey(day);
            const dayBookings = checkoutBookings.filter((booking) => getLocalDateKey(booking.checkOutDate) === dayStr);
            const totals = aggregateBookingMoney(dayBookings, nowMs);

            return {
                dateStr: dayStr,
                name: `${day.getDate()}/${day.getMonth() + 1}`,
                totalBill: totals.totalBill,
                paidAmount: totals.paid,
            };
        });

    if (data.length === 0) return { chartData: [], maxVal: 0, minVal: 0, chartGranularity: shouldGroupByMonth ? 'MONTH' as const : 'DAY' as const };

    const max = Math.max(...data.map(d => d.totalBill));
    const min = Math.min(...data.map(d => d.totalBill));

    return { chartData: data, maxVal: max, minVal: min, chartGranularity: shouldGroupByMonth ? 'MONTH' as const : 'DAY' as const };
  }, [bookings, rooms, roomById, startDate, endDate, nowMs, dateRangeInfo.valid, dateRangeInfo.days]);


  return (
    <div className="katka-liquid-page space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
              <h2 className="text-xl md:text-2xl font-bold text-gray-800">Tổng quan hoạt động</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                      <Building2 size={12} />
                      Đang xem: {currentPropertyName}
                  </span>
                  <span className="text-gray-500 text-xs md:text-sm">Số liệu cập nhật theo dữ liệu đã tải và khoảng thời gian đang lọc.</span>
              </div>
          </div>
          
          {/* FILTER BAR */}
          <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-2 items-stretch md:items-center">
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

             <div className="hidden md:block h-6 w-px bg-gray-300 mx-1"></div>

             <div className="flex items-center gap-2">
                 <input 
                    type="date" 
                    className="flex-1 border border-gray-200 text-gray-700 text-xs rounded-lg px-2 py-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                    value={startDate}
                    onChange={(e) => { setFilterPreset('CUSTOM'); setStartDate(e.target.value); }}
                 />
                 <span className="text-gray-400 font-bold">-</span>
                 <input 
                    type="date" 
                    className="flex-1 border border-gray-200 text-gray-700 text-xs rounded-lg px-2 py-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                    value={endDate}
                    onChange={(e) => { setFilterPreset('CUSTOM'); setEndDate(e.target.value); }}
                 />
             </div>
          </div>
      </div>

      {!dateRangeInfo.valid && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {dateRangeInfo.message}
          </div>
      )}

      {dateRangeInfo.valid && operationalRooms.length === 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              Không có phòng vận hành trong phạm vi chi nhánh hiện tại.
          </div>
      )}

      {dateRangeInfo.valid && operationalRooms.length > 0 && bookings.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">
              Chưa có đơn đặt phòng trong phạm vi dữ liệu hiện tại. Các chỉ số tiền và biểu đồ sẽ hiển thị 0.
          </div>
      )}

      {/* STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        
        {/* GROUP 1: CHECKED OUT STATS (Rounded-3xl for consistency) */}
        <div className="bg-white rounded-2xl md:rounded-[24px] shadow-sm border border-gray-200 overflow-hidden">
             <div className="dashboard-stat-header dashboard-stat-header-success p-4 md:p-6 border-b border-green-100 flex justify-between items-center">
                 <div>
                     <h3 className="text-green-800 font-bold flex items-center gap-2 text-sm md:text-base"><CalendarCheck size={18}/> Khách đã trả phòng</h3>
                     <p className="text-[10px] md:text-xs text-green-600 mt-1 font-medium">Dựa trên ngày check-out</p>
                 </div>
                 <span className="bg-white text-green-700 font-bold px-3 py-1 rounded-full text-xs border border-green-200 shadow-sm">
                     {checkoutStats.count} Đơn
                 </span>
             </div>
             <div className="p-4 md:p-6 space-y-4">
                 <div className="flex justify-between items-end">
                     <span className="text-gray-500 text-xs md:text-sm font-medium">Tổng Bill</span>
                     <span className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">{formatVND(checkoutStats.totalBill)}</span>
                 </div>
                 <div className="h-px bg-gray-100"></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                         <span className="text-[10px] md:text-[11px] text-gray-400 font-bold uppercase block mb-1">Thực thu</span>
                         <span className="text-green-600 font-bold text-base md:text-lg">{formatVND(checkoutStats.paid)}</span>
                     </div>
                     <div className="text-right">
                         <span className="text-[10px] md:text-[11px] text-gray-400 font-bold uppercase block mb-1">Công nợ</span>
                         <span className={`${checkoutStats.debt > 0 ? 'text-red-500' : 'text-gray-400'} font-bold text-base md:text-lg`}>
                             {formatVND(checkoutStats.debt)}
                         </span>
                     </div>
                 </div>
             </div>
        </div>

        {/* GROUP 2: CREATED BOOKINGS STATS (Rounded-3xl for consistency) */}
        <div className="bg-white rounded-2xl md:rounded-[24px] shadow-sm border border-gray-200 overflow-hidden">
             <div className="dashboard-stat-header dashboard-stat-header-info p-4 md:p-6 border-b border-blue-100 flex justify-between items-center">
                 <div>
                     <h3 className="text-blue-800 font-bold flex items-center gap-2 text-sm md:text-base"><CreditCard size={18}/> Đặt phòng phát sinh</h3>
                     <p className="text-[10px] md:text-xs text-blue-600 mt-1 font-medium">Dựa trên ngày tạo đơn</p>
                 </div>
                 <span className="bg-white text-blue-700 font-bold px-3 py-1 rounded-full text-xs border border-blue-200 shadow-sm">
                     {createdStats.count} Đơn
                 </span>
             </div>
             <div className="p-4 md:p-6 space-y-4">
                 <div className="flex justify-between items-end">
                     <span className="text-gray-500 text-xs md:text-sm font-medium">Tổng giá trị</span>
                     <span className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">{formatVND(createdStats.totalBill)}</span>
                 </div>
                 <div className="h-px bg-gray-100"></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                         <span className="text-[10px] md:text-[11px] text-gray-400 font-bold uppercase block mb-1">Đã cọc/TT</span>
                         <span className="text-blue-600 font-bold text-base md:text-lg">{formatVND(createdStats.paid)}</span>
                     </div>
                     <div className="text-right">
                         <span className="text-[10px] md:text-[11px] text-gray-400 font-bold uppercase block mb-1">Chưa thu</span>
                         <span className={`${createdStats.debt > 0 ? 'text-orange-500' : 'text-gray-400'} font-bold text-base md:text-lg`}>
                             {formatVND(createdStats.debt)}
                         </span>
                     </div>
                 </div>
             </div>
        </div>

        {/* GROUP 3: PERFORMANCE STATS - iOS WIDGET STYLE */}
        <div className="bg-white rounded-2xl md:rounded-[32px] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden md:col-span-2 xl:col-span-1 flex flex-col">
             <div className="px-6 md:px-8 pt-6 md:pt-8 pb-4">
                 <h3 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
                    Hiệu suất
                 </h3>
                 <p className="text-[13px] font-medium text-gray-400 mt-1">Theo khoảng thời gian đang lọc</p>
             </div>

             <div className="p-4 md:p-6 pt-2 grid grid-cols-2 gap-4 md:gap-5 h-full">
                 {/* OCC Widget */}
                 <div className="dashboard-kpi-tile rounded-[24px] p-4 md:p-5 flex flex-col items-center justify-center relative group transition-all">
                     <div className="dashboard-kpi-icon-shell mb-4 p-2 md:p-3 rounded-2xl text-purple-600 border border-purple-50/50">
                        <BedDouble size={24} className="md:w-7 md:h-7" strokeWidth={2}/>
                     </div>

                     <p className="text-[10px] md:text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Công suất</p>
                     <p className="text-2xl md:text-4xl font-extrabold text-gray-900 tracking-tight mb-2">{performanceStats.occ}%</p>
                     <div className="dashboard-kpi-pill px-3 py-1 rounded-lg border border-gray-200/50">
                        <p className="text-[10px] md:text-[11px] font-semibold text-gray-500 whitespace-nowrap">
                            {performanceStats.occupiedInventory}/{performanceStats.totalInventory} Đêm phòng
                        </p>
                     </div>
                 </div>
                 
                 {/* ADR Widget */}
                 <div className="dashboard-kpi-tile rounded-[24px] p-4 md:p-5 flex flex-col items-center justify-center relative group transition-all">
                     <div className="dashboard-kpi-icon-shell mb-4 p-2 md:p-3 rounded-2xl text-teal-600 border border-teal-50/50">
                        <DollarSign size={24} className="md:w-7 md:h-7" strokeWidth={2}/>
                     </div>

                     <p className="text-[10px] md:text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Giá TB (ADR)</p>
                     <p className="text-xl md:text-3xl font-extrabold text-gray-900 tracking-tight mb-2">{formatCompactVND(performanceStats.adr)}</p>
                     <div className="dashboard-kpi-pill px-3 py-1 rounded-lg border border-gray-200/50">
                        <p className="text-[10px] md:text-[11px] font-semibold text-gray-500">
                            VNĐ / Đêm
                        </p>
                     </div>
                 </div>
             </div>
        </div>

      </div>

      {/* LINE CHART SECTION (Consistent Radius) */}
      <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-[24px] shadow-sm border border-gray-200 w-full overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div>
                  <h3 className="text-base md:text-lg font-bold text-gray-800 flex items-center gap-2">Biểu đồ tổng bill và tiền đã trả</h3>
                  <p className="text-xs md:text-sm text-gray-500 mt-1">
                      Thống kê theo {chartGranularity === 'MONTH' ? 'tháng' : 'ngày'} khách trả phòng (Check-out)
                  </p>
              </div>
              <div className="flex gap-4 text-xs font-medium bg-gray-50 px-3 py-2 rounded-lg border border-gray-100 w-full md:w-auto justify-between md:justify-start">
                   <div className="flex items-center gap-2 text-green-700">
                       <ArrowUpCircle size={14} className="text-red-500" />
                       <span className="hidden sm:inline">Cao nhất: </span>
                       <span>{formatCompactVND(maxVal)}</span>
                   </div>
                   <div className="w-px h-4 bg-gray-300"></div>
                   <div className="flex items-center gap-2 text-orange-700">
                       <ArrowDownCircle size={14} className="text-orange-500" />
                       <span className="hidden sm:inline">Thấp nhất: </span>
                       <span>{formatCompactVND(minVal)}</span>
                   </div>
              </div>
          </div>

          <div className="h-[250px] md:h-[350px] w-full -ml-2 md:ml-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#9ca3af', fontSize: 10}} 
                    dy={10} 
                    padding={{left: 10, right: 10}}
                    interval="preserveStartEnd"
                />
                <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#9ca3af', fontSize: 10}} 
                    tickFormatter={(val) => formatCompactVND(val)} 
                    width={30}
                />
                <Tooltip 
                    formatter={(value: number) => formatVND(value)} 
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}} 
                    labelStyle={{color: '#6b7280', marginBottom: '0.25rem', fontSize: '0.75rem'}}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px', fontSize: '12px'}} />
                
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
