
import React, { useMemo, useState, useEffect } from 'react';
import { Booking, BookingStatus, Room, User, RoomType, Property } from '../types';
import { DataService } from '../services/dataService';
import { FileSpreadsheet, TrendingUp, Calendar, Filter, Info } from 'lucide-react';

interface ReportsProps {
  bookings: Booking[];
  rooms: Room[];
  users: User[];
  roomTypes: RoomType[];
  properties: Property[];
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

const Reports: React.FC<ReportsProps> = ({ bookings, rooms, users, roomTypes, properties }) => {
  const [activeTab, setActiveTab] = useState<'REVENUE' | 'BOOKINGS'>('REVENUE');
  
  // Filter States
  const [filterPreset, setFilterPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // --- Date Logic Helpers ---
  const getRange = (preset: DatePreset): { start: Date, end: Date } | null => {
      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);
      
      const getStartOfWeek = (d: Date) => {
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
          return new Date(d.setDate(diff));
      }

      switch (preset) {
          case 'TODAY':
              break; // Start/End is today
          case 'YESTERDAY':
              start.setDate(now.getDate() - 1);
              end.setDate(now.getDate() - 1);
              break;
          case 'THIS_WEEK':
              {
                  const s = getStartOfWeek(new Date());
                  start.setTime(s.getTime());
              }
              break;
          case 'LAST_WEEK':
              {
                  const s = getStartOfWeek(new Date());
                  s.setDate(s.getDate() - 7);
                  start.setTime(s.getTime());
                  const e = new Date(s);
                  e.setDate(e.getDate() + 6);
                  end.setTime(e.getTime());
              }
              break;
          case 'LAST_7_DAYS':
              start.setDate(now.getDate() - 7);
              break;
          case 'THIS_MONTH':
              start.setDate(1);
              break;
          case 'LAST_MONTH':
              start.setMonth(now.getMonth() - 1);
              start.setDate(1);
              end.setDate(0); // Last day of previous month
              break;
          case 'LAST_30_DAYS':
              start.setDate(now.getDate() - 30);
              break;
          case 'THIS_QUARTER':
              {
                  const currQuarter = Math.floor(now.getMonth() / 3);
                  start.setMonth(currQuarter * 3);
                  start.setDate(1);
              }
              break;
          case 'LAST_QUARTER':
              {
                  const currQuarter = Math.floor(now.getMonth() / 3);
                  const prevQuarter = currQuarter - 1;
                  if (prevQuarter < 0) {
                      start.setFullYear(now.getFullYear() - 1);
                      start.setMonth(9); // Oct
                  } else {
                      start.setMonth(prevQuarter * 3);
                  }
                  start.setDate(1);
                  
                  // End of last quarter
                  const e = new Date(start);
                  e.setMonth(e.getMonth() + 3);
                  e.setDate(0);
                  end.setTime(e.getTime());
              }
              break;
          case 'THIS_YEAR':
              start.setMonth(0, 1);
              break;
          case 'LAST_YEAR':
              start.setFullYear(now.getFullYear() - 1);
              start.setMonth(0, 1);
              end.setFullYear(now.getFullYear() - 1);
              end.setMonth(11, 31);
              break;
          case 'CUSTOM':
              return null;
          default:
              return null;
      }
      
      // Normalize times
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
  };

  // Effect to update inputs when preset changes
  useEffect(() => {
      if (filterPreset !== 'CUSTOM') {
          const range = getRange(filterPreset);
          if (range) {
              // Convert to YYYY-MM-DD for input type="date"
              // Local time handling to prevent timezone shifts
              const toLocalISO = (d: Date) => {
                  const offset = d.getTimezoneOffset() * 60000;
                  return (new Date(d.getTime() - offset)).toISOString().split('T')[0];
              };
              setStartDate(toLocalISO(range.start));
              setEndDate(toLocalISO(range.end));
          }
      }
  }, [filterPreset]);

  // Handle manual date change
  const handleDateChange = (type: 'START' | 'END', val: string) => {
      setFilterPreset('CUSTOM');
      if (type === 'START') setStartDate(val);
      else setEndDate(val);
  };


  // --- Formatting Helpers ---
  const formatDateTime = (isoDate: string) => {
      if(!isoDate) return '';
      const d = new Date(isoDate);
      const pad = (num: number) => num.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const getFullBookingData = (b: Booking) => {
      const room = rooms.find(r => r.id === b.roomId);
      const user = users.find(u => u.id === b.createdBy);
      const type = roomTypes.find(t => t.id === room?.typeId);
      const property = properties.find(p => p.id === b.propertyId);
      const debt = b.totalPrice - b.paidAmount;

      return {
          "Mã BK": b.id,
          "Khách hàng": b.guestName,
          "Phòng": room?.number || 'N/A',
          "Hạng phòng": type?.name || 'N/A',
          "Chi nhánh": property?.name || b.propertyId,
          "Ngày tạo": formatDateTime(b.createdAt),
          "Thời gian nhận phòng": formatDateTime(b.checkInDate),
          "Thời gian trả phòng": formatDateTime(b.checkOutDate),
          "Tổng bill": b.totalPrice,
          "Đã trả": b.paidAmount,
          "Còn nợ": debt,
          "Nhân viên tạo đơn": user?.fullName || b.createdBy,
          // Raw object for table color logic and sorting
          _debtRaw: debt,
          _status: b.status,
          _checkOutDate: new Date(b.checkOutDate),
          _createdAt: new Date(b.createdAt)
      };
  };

  // --- Filter Logic ---
  const filterDateRange = (dateToCheck: Date) => {
      if (!startDate || !endDate) return true;
      const start = new Date(startDate); start.setHours(0,0,0,0);
      const end = new Date(endDate); end.setHours(23,59,59,999);
      return dateToCheck >= start && dateToCheck <= end;
  };

  // --- 1. Revenue Report (Báo cáo doanh thu phòng) ---
  // Criteria: Booking has ended (CHECKED_OUT) AND checkOutDate is within range
  const revenueData = useMemo(() => {
      return bookings
        .filter(b => b.status === BookingStatus.CHECKED_OUT)
        // NOTE: No need to check for DELETED here because active bookings list 
        // is guaranteed to be clean of soft-deleted items by DataService.
        .filter(b => filterDateRange(new Date(b.checkOutDate))) // Filter by Checkout Time
        .map(getFullBookingData)
        .sort((a, b) => b._checkOutDate.getTime() - a._checkOutDate.getTime());
  }, [bookings, rooms, users, roomTypes, properties, startDate, endDate]);

  const totalRevenue = revenueData.reduce((acc, curr) => acc + curr["Tổng bill"], 0);

  // --- 2. Booking Report (Báo cáo đặt phòng phát sinh) ---
  // Criteria: All existing bookings AND createdAt is within range
  const bookingReportData = useMemo(() => {
      return bookings
        // Same here: Input 'bookings' array contains ONLY visible/active bookings.
        .filter(b => filterDateRange(new Date(b.createdAt))) // Filter by Creation Time
        .map(getFullBookingData)
        .sort((a, b) => b._createdAt.getTime() - a._createdAt.getTime());
  }, [bookings, rooms, users, roomTypes, properties, startDate, endDate]);


  const handleExport = (data: any[], fileName: string) => {
      const cleanData = data.map(({ _debtRaw, _status, _checkOutDate, _createdAt, ...rest }) => rest);
      DataService.exportToExcel(cleanData, fileName);
  };

  // --- Shared Table Component ---
  const ReportTable = ({ data }: { data: any[] }) => (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 font-bold text-gray-700 text-xs uppercase whitespace-nowrap">
                  <tr>
                      <th className="p-4 border-b">Mã BK</th>
                      <th className="p-4 border-b">Khách hàng</th>
                      <th className="p-4 border-b">Phòng</th>
                      <th className="p-4 border-b">Hạng phòng</th>
                      <th className="p-4 border-b">Chi nhánh</th>
                      <th className="p-4 border-b">Ngày tạo</th>
                      <th className="p-4 border-b">TG Nhận phòng</th>
                      <th className="p-4 border-b">TG Trả phòng</th>
                      <th className="p-4 border-b text-right text-green-700 bg-green-50">Tổng bill</th>
                      <th className="p-4 border-b text-right text-blue-700 bg-blue-50">Đã trả</th>
                      <th className="p-4 border-b text-right text-red-700 bg-red-50">Còn nợ</th>
                      <th className="p-4 border-b">Nhân viên</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                  {data.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 font-mono text-gray-500 text-xs font-semibold">{row["Mã BK"]}</td>
                          <td className="p-4 font-bold text-gray-800 whitespace-nowrap">{row["Khách hàng"]}</td>
                          <td className="p-4 font-medium text-blue-600">{row["Phòng"]}</td>
                          <td className="p-4 text-gray-600">{row["Hạng phòng"]}</td>
                          <td className="p-4 text-gray-500 text-xs">{row["Chi nhánh"]}</td>
                          <td className="p-4 text-gray-500 text-xs whitespace-nowrap">{row["Ngày tạo"]}</td>
                          <td className="p-4 text-gray-500 text-xs whitespace-nowrap">{row["Thời gian nhận phòng"]}</td>
                          <td className="p-4 text-gray-500 text-xs whitespace-nowrap">{row["Thời gian trả phòng"]}</td>
                          
                          <td className="p-4 text-right font-bold text-green-600 bg-green-50/30">
                              {row["Tổng bill"].toLocaleString()}
                          </td>
                          <td className="p-4 text-right font-semibold text-blue-600 bg-blue-50/30">
                              {row["Đã trả"].toLocaleString()}
                          </td>
                          <td className={`p-4 text-right font-bold bg-red-50/30 ${row._debtRaw > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {row._debtRaw > 0 ? row._debtRaw.toLocaleString() : '0'}
                          </td>
                          
                          <td className="p-4 text-gray-600 text-xs font-medium">{row["Nhân viên tạo đơn"]}</td>
                      </tr>
                  ))}
                  {data.length === 0 && (
                      <tr><td colSpan={12} className="p-8 text-center text-gray-400 italic">Không có dữ liệu trong khoảng thời gian này</td></tr>
                  )}
              </tbody>
          </table>
      </div>
  );

  return (
    <div className="space-y-6 pb-10 font-sans animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
            <h2 className="text-2xl font-bold text-gray-800">Báo cáo & Thống kê</h2>
            <div className="flex items-center gap-2 mt-1">
                <p className="text-gray-500 text-sm">Hệ thống báo cáo chi tiết hoạt động kinh doanh.</p>
                <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded border border-orange-100 flex items-center gap-1">
                    <Info size={10} /> Đồng bộ realtime với sơ đồ phòng
                </span>
            </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-4 items-center">
         <div className="flex items-center gap-2 text-gray-700 font-semibold mr-2">
             <Filter size={20} />
             <span>Bộ lọc thời gian:</span>
         </div>
         
         <div className="flex flex-col sm:flex-row gap-4 flex-1">
             <select 
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-medium min-w-[180px]"
                value={filterPreset}
                onChange={(e) => setFilterPreset(e.target.value as DatePreset)}
             >
                 {DATE_PRESETS.map(p => (
                     <option key={p.value} value={p.value}>{p.label}</option>
                 ))}
             </select>

             <div className="flex items-center gap-2">
                 <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-500"><Calendar size={14}/></div>
                    <input 
                        type="date" 
                        className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-9 p-2.5" 
                        value={startDate}
                        onChange={(e) => handleDateChange('START', e.target.value)}
                    />
                 </div>
                 <span className="text-gray-400 font-bold">-</span>
                 <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-500"><Calendar size={14}/></div>
                    <input 
                        type="date" 
                        className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-9 p-2.5" 
                        value={endDate}
                        onChange={(e) => handleDateChange('END', e.target.value)}
                    />
                 </div>
             </div>
         </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-1 flex gap-1 w-fit">
          <button 
             onClick={() => setActiveTab('REVENUE')}
             className={`px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all ${
                 activeTab === 'REVENUE' 
                 ? 'bg-green-100 text-green-700 shadow-sm' 
                 : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
             }`}
          >
              <TrendingUp size={18} /> Báo cáo Doanh thu phòng
          </button>
          <button 
             onClick={() => setActiveTab('BOOKINGS')}
             className={`px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all ${
                 activeTab === 'BOOKINGS' 
                 ? 'bg-blue-100 text-blue-700 shadow-sm' 
                 : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
             }`}
          >
              <Calendar size={18} /> Báo cáo Đặt phòng phát sinh
          </button>
      </div>

      {/* REVENUE TAB */}
      {activeTab === 'REVENUE' && (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-fade-in">
          <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
              <div>
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      Báo cáo Doanh thu phòng (Đã Check-out)
                  </h3>
                  <p className="text-sm text-gray-400 mt-0.5">
                      Lọc theo thời gian khách trả phòng: <span className="font-semibold text-gray-700">{startDate ? new Date(startDate).toLocaleDateString('vi-VN') : '...'}</span> đến <span className="font-semibold text-gray-700">{endDate ? new Date(endDate).toLocaleDateString('vi-VN') : '...'}</span>
                  </p>
              </div>
              
              <div className="flex items-center gap-4">
                  <div className="px-4 py-2 bg-green-50 rounded-lg border border-green-100 text-right">
                      <span className="text-xs text-green-600 font-bold uppercase block">Tổng doanh thu</span>
                      <span className="text-xl font-bold text-green-700">{totalRevenue.toLocaleString()} VNĐ</span>
                  </div>
                  <button onClick={() => handleExport(revenueData, 'Bao_cao_doanh_thu_phong.xlsx')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm transition-colors font-medium text-sm h-10">
                      <FileSpreadsheet size={18} /> Tải Excel
                  </button>
              </div>
          </div>

          <ReportTable data={revenueData} />
      </div>
      )}

      {/* BOOKING REPORT TAB */}
      {activeTab === 'BOOKINGS' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 animate-fade-in">
             <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                <div>
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        Báo cáo Đặt phòng phát sinh
                    </h3>
                    <p className="text-sm text-gray-400 mt-0.5">
                        Lọc theo thời gian tạo đơn: <span className="font-semibold text-gray-700">{startDate ? new Date(startDate).toLocaleDateString('vi-VN') : '...'}</span> đến <span className="font-semibold text-gray-700">{endDate ? new Date(endDate).toLocaleDateString('vi-VN') : '...'}</span>
                    </p>
                </div>
                <button onClick={() => handleExport(bookingReportData, 'Bao_cao_dat_phong.xlsx')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors font-medium text-sm h-10">
                    <FileSpreadsheet size={18} /> Tải Excel
                </button>
             </div>

             <ReportTable data={bookingReportData} />
          </div>
      )}
    </div>
  );
};

export default Reports;
