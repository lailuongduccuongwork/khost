
import React, { useMemo, useState, useEffect } from 'react';
import { Booking, BookingStatus, Room, User, RoomType, Property, Tag, PERMISSIONS } from '../types';
import { DataService } from '../services/dataService';
import { FileSpreadsheet, TrendingUp, Calendar, Filter, Info, Lock, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { isArchiveBucketRoom } from '../utils/roomBuckets';
import { deriveBookingStatus } from '../utils/bookingState';

interface ReportsProps {
  bookings: Booking[];
  rooms: Room[];
  users: User[];
  roomTypes: RoomType[];
  properties: Property[];
  tags: Tag[];
  currentPropertyId: string;
  currentUser: User; // Need full user for permissions
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

const Reports: React.FC<ReportsProps> = ({ bookings: _bookings, rooms, users, roomTypes, properties, tags, currentPropertyId, currentUser }) => {
  const [activeTab, setActiveTab] = useState<'REVENUE' | 'BOOKINGS'>('REVENUE');
  
  // Filter States
  const [filterPreset, setFilterPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportSourceBookings, setReportSourceBookings] = useState<Booking[]>([]);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportLoadError, setReportLoadError] = useState('');
  
  // Sort State
  const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc' | 'desc'} | null>(null);

  const canExport = currentUser.permissions?.includes(PERMISSIONS.CAN_EXPORT_REPORT);
  const visiblePropertyIds = useMemo(() => {
      const allowedIds = currentUser?.allowedPropertyIds || [];
      const hasRestrictions = allowedIds.length > 0;
      return (hasRestrictions ? properties.filter((p) => allowedIds.includes(p.id)) : properties).map(
          (property) => property.id
      );
  }, [currentUser?.allowedPropertyIds, properties]);

  const targetPropertyIds = useMemo(() => {
      if (currentPropertyId && currentPropertyId !== 'ALL') return [currentPropertyId];
      return visiblePropertyIds;
  }, [currentPropertyId, visiblePropertyIds]);

  const targetPropertySet = useMemo(() => new Set(targetPropertyIds), [targetPropertyIds]);

  const reportRooms = useMemo(() => {
      return rooms
          .filter((room) => !isArchiveBucketRoom(room))
          .filter((room) => targetPropertySet.has(room.propertyId))
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [rooms, targetPropertySet]);

  const reportBookings = useMemo(() => {
      return reportSourceBookings
          .filter((booking) => targetPropertySet.has(booking.propertyId));
  }, [reportSourceBookings, targetPropertySet]);

  const reportRangeKey = startDate && endDate ? `${startDate}|${endDate}` : '';
  const reportPropertyKey = useMemo(() => targetPropertyIds.slice().sort().join(','), [targetPropertyIds]);

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

  useEffect(() => {
      if (!reportRangeKey || targetPropertyIds.length === 0) {
          setReportSourceBookings([]);
          setIsReportLoading(false);
          setReportLoadError('');
          return;
      }

      let cancelled = false;
      setIsReportLoading(true);
      setReportLoadError('');

      DataService.fetchReportBookingsForProperties(
          targetPropertyIds,
          `${startDate}T00:00:00`,
          `${endDate}T23:59:59\uf8ff`
      )
          .then((rows) => {
              if (cancelled) return;
              setReportSourceBookings(rows);
          })
          .catch((error) => {
              if (cancelled) return;
              console.error('Report booking range load failed', error);
              setReportSourceBookings([]);
              setReportLoadError('Không tải được dữ liệu báo cáo. Vui lòng thử lại.');
          })
          .finally(() => {
              if (cancelled) return;
              setIsReportLoading(false);
          });

      return () => {
          cancelled = true;
      };
  }, [reportRangeKey, reportPropertyKey]);


  // --- Formatting Helpers ---
  const formatDateTime = (isoDate: string) => {
      if(!isoDate) return '';
      const d = new Date(isoDate);
      const pad = (num: number) => num.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const getFullBookingData = (b: Booking, aggregationSource: Booking[] = reportBookings) => {
      const room = reportRooms.find(r => r.id === b.roomId);
      const user = users.find(u => u.id === b.createdBy);
      const type = roomTypes.find(t => t.id === room?.typeId);
      const property = properties.find(p => p.id === b.propertyId);
      
      // --- XỬ LÝ EXTRA FEES ---
      const extraFees = b.extraFees || [];
      const otherRevenue = extraFees.filter(f => f.type === 'REVENUE').reduce((sum, f) => sum + f.amount, 0);
      const otherExpenses = extraFees.filter(f => f.type === 'EXPENSE').reduce((sum, f) => sum + f.amount, 0);

      // --- LOGIC TÍNH TIỀN KHÁCH ĐOÀN ---
      let groupTotalStored = b.totalPrice; // Đây là giá trị lưu DB = (Tiền phòng + Thu khác - Chi khác)
      let finalPaid = b.paidAmount;
      
      // Biến hiển thị
      let displayOtherRevenue = otherRevenue;
      let displayOtherExpenses = otherExpenses;

      if (b.groupId) {
          // 1. Tìm tất cả các phòng trong đoàn
          const groupMembers = aggregationSource.filter(x => x.groupId === b.groupId && deriveBookingStatus(x) !== BookingStatus.DELETED);
          
          // 2. Sắp xếp để tìm "Leader"
          groupMembers.sort((x, y) => x.id.localeCompare(y.id));

          if (groupMembers.length > 0) {
              const leader = groupMembers[0];
              
              if (b.id === leader.id) {
                  // Leader: Cộng dồn toàn bộ
                  groupTotalStored = groupMembers.reduce((sum, item) => sum + item.totalPrice, 0);
                  finalPaid = groupMembers.reduce((sum, item) => sum + item.paidAmount, 0);
                  // Lưu ý: extraFees hiện tại logic chỉ lưu ở Leader nên lấy trực tiếp từ b là đúng
              } else {
                  // Các phòng còn lại: Hiển thị 0
                  groupTotalStored = 0;
                  finalPaid = 0;
                  displayOtherRevenue = 0;
                  displayOtherExpenses = 0;
              }
          }
      }

      // --- TÍNH TOÁN CÁC CỘT BÁO CÁO ---
      // 1. "Tổng bill" (Khách cần trả) = Tiền phòng + Thu khác
      // Do DB lưu: groupTotalStored = Tiền phòng + Thu khác - Chi khác
      // => Tiền phòng + Thu khác = groupTotalStored + Chi khác
      const customerBill = groupTotalStored + displayOtherExpenses;

      // 2. "Doanh thu net" (Thực thu về túi KS) = Tiền phòng + Thu khác - Chi khác
      // Chính là giá trị lưu trong DB
      const netRevenue = groupTotalStored; 

      // 3. "Còn nợ" = Tổng bill (Khách cần trả) - Đã trả
      const debt = customerBill - finalPaid;

      // Map tags
      const bookingTags = (b.tags || []).map(tid => tags.find(t => t.id === tid)).filter(Boolean) as Tag[];
      const tagNames = bookingTags.map(t => t.name).join(", ");

      return {
          "Mã BK": b.id,
          "Khách hàng": b.guestName,
          "Tags": tagNames, 
          "Phòng": room?.number || 'N/A',
          "Hạng phòng": type?.name || 'N/A',
          "Chi nhánh": property?.name || b.propertyId,
          "Ngày tạo": formatDateTime(b.createdAt),
          "Thời gian nhận phòng": formatDateTime(b.checkInDate),
          "Thời gian trả phòng": formatDateTime(b.checkOutDate),
          
          "Tổng bill": customerBill,
          "Thu khác": displayOtherRevenue,
          "Chi khác": displayOtherExpenses,
          "Doanh thu net": netRevenue,
          
          "Đã trả": finalPaid,
          "Còn nợ": debt,
          "Nhân viên tạo đơn": user?.username || b.createdBy,
          
          // Raw object for table color logic and sorting
          _debtRaw: debt,
          _status: deriveBookingStatus(b),
          _checkOutDate: new Date(b.checkOutDate),
          _checkInDate: new Date(b.checkInDate),
          _createdAt: new Date(b.createdAt),
          _tags: bookingTags 
      };
  };

  // --- Filter Logic ---
  const filterDateRange = (dateToCheck: Date) => {
      if (!startDate || !endDate) return true;
      const start = new Date(startDate); start.setHours(0,0,0,0);
      const end = new Date(endDate); end.setHours(23,59,59,999);
      return dateToCheck >= start && dateToCheck <= end;
  };

  // --- INTEGRITY CHECK ---
  // Reports are historical, so missing room/type metadata should not blank valid bookings.
  const isValidLinkage = (b: Booking) => {
      const room = reportRooms.find(r => r.id === b.roomId);
      if (room && isArchiveBucketRoom(room)) return false;

      const prop = properties.find(p => p.id === b.propertyId);
      if (!prop) return false; // Property deleted

      return true;
  };

  // --- 1. Revenue Report (Báo cáo doanh thu phòng) ---
  // Criteria: Booking has ended (CHECKED_OUT) AND checkOutDate is within range
  const revenueData = useMemo(() => {
      const eligibleBookings = reportBookings
        .filter(isValidLinkage) // <-- Apply Orphan Filter
        .filter(b => deriveBookingStatus(b) !== BookingStatus.DELETED)
        .filter(b => deriveBookingStatus(b) === BookingStatus.CHECKED_OUT)
        .filter(b => filterDateRange(new Date(b.checkOutDate))); // Filter by Checkout Time

      let data = eligibleBookings.map((booking) => getFullBookingData(booking, eligibleBookings));

      if (sortConfig) {
          data.sort((a: any, b: any) => {
             let valA, valB;
             // Map display keys to internal raw keys for sorting
             if (sortConfig.key === 'Ngày tạo') { valA = a._createdAt; valB = b._createdAt; }
             else if (sortConfig.key === 'TG Nhận phòng') { valA = a._checkInDate; valB = b._checkInDate; }
             else if (sortConfig.key === 'TG Trả phòng') { valA = a._checkOutDate; valB = b._checkOutDate; }
             else return 0;

             if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
             if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
             return 0;
          });
      } else {
          // Default Sort: Check-out Date DESC
          data.sort((a, b) => b._checkOutDate.getTime() - a._checkOutDate.getTime());
      }
      return data;
  }, [reportBookings, reportRooms, users, roomTypes, properties, startDate, endDate, tags, sortConfig]);

  // Total Revenue based on NET REVENUE (Real income)
  const totalRevenue = revenueData.reduce((acc, curr) => acc + curr["Doanh thu net"], 0);

  // --- 2. Booking Report (Báo cáo đặt phòng phát sinh) ---
  // Criteria: All existing bookings AND createdAt is within range
  const bookingReportData = useMemo(() => {
      const eligibleBookings = reportBookings
        .filter(isValidLinkage) // <-- Apply Orphan Filter
        .filter(b => {
            const effectiveStatus = deriveBookingStatus(b);
            return effectiveStatus !== BookingStatus.DELETED && effectiveStatus !== BookingStatus.HOLD;
        })
        .filter(b => filterDateRange(new Date(b.createdAt))); // Filter by Creation Time

      let data = eligibleBookings.map((booking) => getFullBookingData(booking, eligibleBookings));

      if (sortConfig) {
          data.sort((a: any, b: any) => {
             let valA, valB;
             if (sortConfig.key === 'Ngày tạo') { valA = a._createdAt; valB = b._createdAt; }
             else if (sortConfig.key === 'TG Nhận phòng') { valA = a._checkInDate; valB = b._checkInDate; }
             else if (sortConfig.key === 'TG Trả phòng') { valA = a._checkOutDate; valB = b._checkOutDate; }
             else return 0;

             if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
             if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
             return 0;
          });
      } else {
           // Default Sort: Created Date DESC
           data.sort((a, b) => b._createdAt.getTime() - a._createdAt.getTime());
      }
      return data;
  }, [reportBookings, reportRooms, users, roomTypes, properties, startDate, endDate, tags, sortConfig]);


  const handleExport = (data: any[], fileName: string) => {
      if (!canExport) {
          alert("Bạn không có quyền tải xuống báo cáo này.");
          return;
      }
      const cleanData = data.map(({ _debtRaw, _status, _checkOutDate, _checkInDate, _createdAt, _tags, ...rest }) => rest);
      DataService.exportToExcel(cleanData, fileName, {
          reportType: activeTab,
          startDate,
          endDate,
      });
  };

  const handleSort = (key: string) => {
      // Only allow sorting for specific columns
      if (!['Ngày tạo', 'TG Nhận phòng', 'TG Trả phòng'].includes(key)) return;

      let direction: 'asc' | 'desc' = 'desc'; // Default to newest/latest first
      if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
          direction = 'asc';
      }
      setSortConfig({ key, direction });
  };

  const SortIcon = ({ colKey }: { colKey: string }) => {
      if (!['Ngày tạo', 'TG Nhận phòng', 'TG Trả phòng'].includes(colKey)) return null;
      
      if (sortConfig?.key !== colKey) return <ArrowUpDown size={14} className="ml-1 opacity-30 inline" />;
      return sortConfig.direction === 'asc' 
             ? <ArrowUp size={14} className="ml-1 text-blue-600 inline" /> 
             : <ArrowDown size={14} className="ml-1 text-blue-600 inline" />;
  };

  // --- Shared Table Component ---
  const ReportTable = ({ data, onSort }: { data: any[], onSort: (key: string) => void }) => (
      <div className="relative rounded-lg border border-gray-200">
          <div className="overflow-x-auto shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.1)]">
            <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 font-bold text-gray-700 text-xs uppercase whitespace-nowrap">
                    <tr>
                        <th className="p-4 border-b">Mã BK</th>
                        <th className="p-4 border-b">Khách hàng</th>
                        <th className="p-4 border-b">Tags</th>
                        <th className="p-4 border-b">Phòng</th>
                        <th className="p-4 border-b">Hạng phòng</th>
                        <th className="p-4 border-b">Chi nhánh</th>
                        
                        <th className="p-4 border-b cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => onSort('Ngày tạo')}>
                            Ngày tạo <SortIcon colKey="Ngày tạo"/>
                        </th>
                        <th className="p-4 border-b cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => onSort('TG Nhận phòng')}>
                            TG Nhận phòng <SortIcon colKey="TG Nhận phòng"/>
                        </th>
                        <th className="p-4 border-b cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => onSort('TG Trả phòng')}>
                            TG Trả phòng <SortIcon colKey="TG Trả phòng"/>
                        </th>

                        <th className="p-4 border-b text-right text-gray-700 bg-gray-50">Tổng bill</th>
                        <th className="p-4 border-b text-right text-green-600 bg-gray-50">Thu khác</th>
                        <th className="p-4 border-b text-right text-red-600 bg-gray-50">Chi khác</th>
                        <th className="p-4 border-b text-right font-extrabold report-col-net">Doanh thu Net</th>
                        <th className="p-4 border-b text-right report-col-paid">Đã trả</th>
                        <th className="p-4 border-b text-right report-col-debt">Còn nợ</th>
                        <th className="p-4 border-b">Nhân viên</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {data.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td className="p-4 font-mono text-gray-500 text-xs font-semibold">{row["Mã BK"]}</td>
                            <td className="p-4 font-bold text-gray-800 whitespace-nowrap">{row["Khách hàng"]}</td>
                            
                            {/* Render Tags */}
                            <td className="p-4">
                                <div className="flex flex-wrap gap-1 max-w-[150px]">
                                    {row._tags && row._tags.length > 0 ? row._tags.map((t: Tag) => (
                                        <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold whitespace-nowrap" style={{backgroundColor: t.color}}>
                                            {t.name}
                                        </span>
                                    )) : <span className="text-gray-300 text-xs italic">--</span>}
                                </div>
                            </td>

                            <td className="p-4 font-medium text-blue-600">{row["Phòng"]}</td>
                            <td className="p-4 text-gray-600">{row["Hạng phòng"]}</td>
                            <td className="p-4 text-gray-500 text-xs">{row["Chi nhánh"]}</td>
                            <td className="p-4 text-gray-500 text-xs whitespace-nowrap">{row["Ngày tạo"]}</td>
                            <td className="p-4 text-gray-500 text-xs whitespace-nowrap">{row["Thời gian nhận phòng"]}</td>
                            <td className="p-4 text-gray-500 text-xs whitespace-nowrap">{row["Thời gian trả phòng"]}</td>
                            
                            <td className="p-4 text-right font-bold text-gray-700 bg-gray-50/50">
                                {row["Tổng bill"] > 0 ? row["Tổng bill"].toLocaleString() : '-'}
                            </td>
                            <td className="p-4 text-right font-medium text-green-600 bg-gray-50/50">
                                {row["Thu khác"] > 0 ? `+${row["Thu khác"].toLocaleString()}` : '-'}
                            </td>
                            <td className="p-4 text-right font-medium text-red-500 bg-gray-50/50">
                                {row["Chi khác"] > 0 ? `-${row["Chi khác"].toLocaleString()}` : '-'}
                            </td>
                            <td className="p-4 text-right font-extrabold border-l border-r border-purple-100 report-col-net-cell">
                                {row["Doanh thu net"] > 0 ? row["Doanh thu net"].toLocaleString() : '-'}
                            </td>

                            <td className="p-4 text-right font-semibold report-col-paid-cell">
                                {row["Đã trả"] > 0 ? row["Đã trả"].toLocaleString() : '-'}
                            </td>
                            <td className={`p-4 text-right font-bold report-col-debt-cell ${row._debtRaw > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                {row._debtRaw > 0 ? row._debtRaw.toLocaleString() : '-'}
                            </td>
                            
                            <td className="p-4 text-gray-600 text-xs font-medium">{row["Nhân viên tạo đơn"]}</td>
                        </tr>
                    ))}
                    {data.length === 0 && (
                        <tr><td colSpan={16} className="p-8 text-center text-gray-400 italic">Không có dữ liệu trong khoảng thời gian này</td></tr>
                    )}
                </tbody>
            </table>
          </div>
      </div>
  );

  return (
    <div className="katka-liquid-page space-y-4 md:space-y-6 pb-20 font-sans animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-2 md:gap-4">
        <div>
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">Báo cáo & Thống kê</h2>
            <div className="flex items-center gap-2 mt-1">
                <p className="text-gray-500 text-xs md:text-sm">Hệ thống báo cáo chi tiết hoạt động kinh doanh.</p>
            </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
         <div className="flex items-center gap-2 text-gray-700 font-semibold md:mr-2">
             <Filter size={18} />
             <span className="text-sm">Bộ lọc thời gian:</span>
         </div>
         
         <div className="flex flex-col sm:flex-row gap-2 md:gap-4 flex-1">
             <select 
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-medium w-full md:min-w-[180px]"
                value={filterPreset}
                onChange={(e) => setFilterPreset(e.target.value as DatePreset)}
             >
                 {DATE_PRESETS.map(p => (
                     <option key={p.value} value={p.value}>{p.label}</option>
                 ))}
             </select>

             <div className="flex items-center gap-2 w-full md:w-auto">
                 <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-500"><Calendar size={14}/></div>
                    <input 
                        type="date" 
                        className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-9 p-2.5" 
                        value={startDate}
                        onChange={(e) => handleDateChange('START', e.target.value)}
                    />
                 </div>
                 <span className="text-gray-400 font-bold">-</span>
                 <div className="relative flex-1">
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-1 flex w-full overflow-x-auto no-scrollbar">
          <button 
             onClick={() => { setActiveTab('REVENUE'); setSortConfig(null); }}
             className={`flex-1 md:flex-none px-4 md:px-5 py-2.5 rounded-lg font-semibold text-xs md:text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                 activeTab === 'REVENUE' 
                 ? 'bg-green-100 text-green-700 shadow-sm' 
                 : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
             }`}
          >
              <TrendingUp size={16} /> Báo cáo Doanh thu
          </button>
          <button 
             onClick={() => { setActiveTab('BOOKINGS'); setSortConfig(null); }}
             className={`flex-1 md:flex-none px-4 md:px-5 py-2.5 rounded-lg font-semibold text-xs md:text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                 activeTab === 'BOOKINGS' 
                 ? 'bg-blue-100 text-blue-700 shadow-sm' 
                 : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
             }`}
          >
              <Calendar size={16} /> Báo cáo Đặt phòng
          </button>
      </div>

      {isReportLoading && (
          <div className="bg-blue-50 border border-blue-100 text-blue-700 rounded-xl px-4 py-3 text-sm font-semibold">
              Đang tải dữ liệu báo cáo...
          </div>
      )}

      {reportLoadError && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl px-4 py-3 text-sm font-semibold">
              {reportLoadError}
          </div>
      )}

      {/* REVENUE TAB */}
      {activeTab === 'REVENUE' && (
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-200 animate-fade-in">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div>
                  <h3 className="text-base md:text-lg font-bold text-gray-800 flex items-center gap-2">
                      Báo cáo Doanh thu phòng (Đã Check-out)
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5 hidden md:block">
                      Lọc theo thời gian khách trả phòng: <span className="font-semibold text-gray-700">{startDate ? new Date(startDate).toLocaleDateString('vi-VN') : '...'}</span> đến <span className="font-semibold text-gray-700">{endDate ? new Date(endDate).toLocaleDateString('vi-VN') : '...'}</span>
                  </p>
              </div>
              
              <div className="flex flex-col-reverse md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                  <div className="px-4 py-2 bg-purple-50 rounded-lg border border-purple-100 text-right flex justify-between md:block items-center">
                      <span className="text-xs text-purple-600 font-bold uppercase block">Tổng doanh thu thực (Net)</span>
                      <span className="text-lg md:text-xl font-bold text-purple-700">{totalRevenue.toLocaleString()} VNĐ</span>
                  </div>
                  {canExport && (
                      <button onClick={() => handleExport(revenueData, 'Bao_cao_doanh_thu_phong.xlsx')} className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm transition-colors font-medium text-sm h-10 w-full md:w-auto">
                          <FileSpreadsheet size={18} /> <span className="md:hidden">Xuất Excel</span><span className="hidden md:inline">Tải Excel</span>
                      </button>
                  )}
              </div>
          </div>

          <ReportTable data={revenueData} onSort={handleSort} />
      </div>
      )}

      {/* BOOKING REPORT TAB */}
      {activeTab === 'BOOKINGS' && (
          <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-200 animate-fade-in">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h3 className="text-base md:text-lg font-bold text-gray-800 flex items-center gap-2">
                        Báo cáo Đặt phòng phát sinh
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5 hidden md:block">
                        Lọc theo thời gian tạo đơn: <span className="font-semibold text-gray-700">{startDate ? new Date(startDate).toLocaleDateString('vi-VN') : '...'}</span> đến <span className="font-semibold text-gray-700">{endDate ? new Date(endDate).toLocaleDateString('vi-VN') : '...'}</span>
                    </p>
                </div>
                {canExport && (
                    <button onClick={() => handleExport(bookingReportData, 'Bao_cao_dat_phong.xlsx')} className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors font-medium text-sm h-10 w-full md:w-auto">
                        <FileSpreadsheet size={18} /> <span className="md:hidden">Xuất Excel</span><span className="hidden md:inline">Tải Excel</span>
                    </button>
                )}
             </div>

             <ReportTable data={bookingReportData} onSort={handleSort} />
          </div>
      )}
    </div>
  );
};

export default Reports;
