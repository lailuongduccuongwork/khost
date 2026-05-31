
import React, { useMemo, useState, useEffect } from 'react';
import { Room, Booking, BookingStatus, RoomStatus, Property, RoomType } from '../types';
import { 
    Check, LogOut, LogIn, Zap, User, RotateCcw, 
    Brush, Moon, ArrowRight, Building2, CheckCircle, CalendarDays, Search, X, Loader2, AlertTriangle
} from 'lucide-react';
import { isArchiveBucketRoom } from '../utils/roomBuckets';
import { deriveBookingStatus, deriveRoomOperationalStatus, getActiveBookingForRoom } from '../utils/bookingState';

interface HousekeepingProps {
  rooms: Room[];
  bookings: Booking[];
  roomTypes: RoomType[];
  properties: Property[];
  currentProperty: Property;
  onRefresh: () => void;
  onUpdateStatus: (roomId: string, status: RoomStatus) => void;
  onOpenRoomMap?: (room: Room) => void;
  canUpdateRoomStatus: boolean;
}

type FilterType = 'ALL' | 'DIRTY' | 'CLEAN' | 'OCCUPIED';
type HousekeepingView = 'CURRENT' | 'DAY_SCHEDULE';

const Housekeeping: React.FC<HousekeepingProps> = ({ rooms, bookings, roomTypes, properties, currentProperty, onRefresh, onUpdateStatus, onOpenRoomMap, canUpdateRoomStatus }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [activeView, setActiveView] = useState<HousekeepingView>('CURRENT');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFeedback, setStatusFeedback] = useState<{ roomId: string; state: 'saving' | 'saved'; message: string } | null>(null);
  
  // Cập nhật thời gian thực mỗi phút
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const handleAction = async (roomId: string, newStatus: RoomStatus) => {
      if (!canUpdateRoomStatus) {
          alert('Bạn không có quyền đổi trạng thái sạch/bẩn phòng.');
          return;
      }
      setStatusFeedback({ roomId, state: 'saving', message: 'Đang cập nhật...' });
      try {
          await Promise.resolve(onUpdateStatus(roomId, newStatus));
          setStatusFeedback({ roomId, state: 'saved', message: newStatus === RoomStatus.VACANT_CLEAN ? 'Đã báo sạch' : 'Đã báo bẩn' });
          if (navigator.vibrate) navigator.vibrate(50);
          window.setTimeout(() => {
              setStatusFeedback((current) => current?.roomId === roomId ? null : current);
          }, 1800);
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không thể cập nhật trạng thái phòng.';
          setStatusFeedback(null);
          alert(message);
      }
  };

  // --- HELPER FORMAT ---
  const formatCompactDateTime = (iso: string | null | undefined) => {
    if (!iso) return '--:--';
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
  };

  const formatTimeOnly = (value: string | Date) => {
    const d = typeof value === 'string' ? new Date(value) : value;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const formatDayLabel = (date: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  };

  const isNightTime = (dateStr: string) => {
      const d = new Date(dateStr);
      const h = d.getHours();
      return h >= 22 || h <= 7;
  };

  // --- DATA PROCESSING ---
  const processedRooms = useMemo(() => {
    const nowMs = currentTime.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const todayStart = new Date(currentTime);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const todayStartMs = todayStart.getTime();
    const todayEndMs = todayEnd.getTime();
    const scopedRooms = rooms.filter((room) => {
        if (isArchiveBucketRoom(room)) return false;
        if (currentProperty.id !== 'ALL' && room.propertyId !== currentProperty.id) return false;
        return true;
    });
    const scopedRoomIds = new Set(scopedRooms.map((room) => room.id));
    const scopedBookings = bookings.filter((booking) => scopedRoomIds.has(booking.roomId));

    const list = scopedRooms.map(room => {
        const roomBookings = scopedBookings.filter((booking) => booking.roomId === room.id);
        const effectiveRoomStatus = deriveRoomOperationalStatus(room, roomBookings, nowMs);
        // Booking Logic
        const activeBooking = getActiveBookingForRoom(roomBookings, room.id, nowMs);
        
        const lastBooking = roomBookings
            .filter(b => deriveBookingStatus(b, nowMs) === BookingStatus.CHECKED_OUT)
            .sort((a, b) => new Date(b.checkOutDate).getTime() - new Date(a.checkOutDate).getTime())[0];

        const nextBooking = roomBookings
            .filter(b => deriveBookingStatus(b, nowMs) === BookingStatus.CONFIRMED && new Date(b.checkInDate).getTime() > nowMs)
            .sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime())[0];

        // Urgent Check
        let isUrgent = false;
        let warningText = null;
        if (nextBooking) {
            const checkInMs = new Date(nextBooking.checkInDate).getTime();
            const diffMinutes = Math.floor((checkInMs - nowMs) / 60000);
            if (diffMinutes <= 60 && diffMinutes >= 0) {
                isUrgent = true;
                warningText = `${diffMinutes}p nữa khách vào!`;
            }
        }

        // Occupied Info
        let currentOccupied = null;
        if (activeBooking) {
            const checkOutMs = new Date(activeBooking.checkOutDate).getTime();
            const minutesLeft = Math.floor((checkOutMs - nowMs) / 60000);
            currentOccupied = {
                guestName: activeBooking.guestName,
                checkOut: activeBooking.checkOutDate,
                minutesLeft: minutesLeft
            };
        }

        // Night Shift Logic
        let nightEvent: { type: 'IN' | 'OUT', time: string, displayTime: string } | null = null;
        if (nextBooking) {
            const t = new Date(nextBooking.checkInDate).getTime();
            if (t - nowMs < oneDayMs && isNightTime(nextBooking.checkInDate)) {
                nightEvent = { type: 'IN', time: nextBooking.checkInDate, displayTime: formatCompactDateTime(nextBooking.checkInDate) };
            }
        }
        if (currentOccupied) {
            const t = new Date(currentOccupied.checkOut).getTime();
            if (t - nowMs > -3600000 && t - nowMs < oneDayMs && isNightTime(currentOccupied.checkOut)) {
                nightEvent = { type: 'OUT', time: currentOccupied.checkOut, displayTime: formatCompactDateTime(currentOccupied.checkOut) };
            }
        }

        const hasStaleOccupiedStatus = room.status === RoomStatus.OCCUPIED && !activeBooking;
        const todayBookings = roomBookings
            .filter((booking) => {
                const status = deriveBookingStatus(booking, nowMs);
                if (status === BookingStatus.DELETED || status === BookingStatus.HOLD) return false;
                const checkInMs = new Date(booking.checkInDate).getTime();
                const checkOutMs = new Date(booking.checkOutDate).getTime();
                if (!Number.isFinite(checkInMs) || !Number.isFinite(checkOutMs)) return false;
                return checkInMs < todayEndMs && checkOutMs > todayStartMs;
            })
            .sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime());

        return {
            room: { ...room, status: effectiveRoomStatus },
            storedStatus: room.status,
            hasStaleOccupiedStatus,
            activeBooking,
            lastOut: lastBooking ? lastBooking.checkOutDate : null,
            nextIn: nextBooking ? nextBooking.checkInDate : null,
            isUrgent,
            warningText,
            currentOccupied,
            nightEvent,
            todayBookings
        };
    });

    // Sort: Property -> Room Order -> Number
    return list.sort((a, b) => {
        const propA = properties.find(p => p.id === a.room.propertyId);
        const propB = properties.find(p => p.id === b.room.propertyId);
        const pOrderA = propA?.sortOrder ?? 9999;
        const pOrderB = propB?.sortOrder ?? 9999;
        if (pOrderA !== pOrderB) return pOrderA - pOrderB;

        const rOrderA = a.room.sortOrder ?? 9999;
        const rOrderB = b.room.sortOrder ?? 9999;
        if (rOrderA !== rOrderB) return rOrderA - rOrderB;

        // FIX: Safe localeCompare for undefined room numbers
        const numA = (a.room.number || '').toString();
        const numB = (b.room.number || '').toString();
        return numA.localeCompare(numB, 'vi', { numeric: true });
    });
  }, [rooms, bookings, currentTime, properties, currentProperty.id]);

  const matchesSearch = (item: (typeof processedRooms)[number]) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;

      const propertyName = properties.find((property) => property.id === item.room.propertyId)?.name?.toLowerCase() || '';
      const roomTypeName = roomTypes.find((type) => type.id === item.room.typeId)?.name?.toLowerCase() || '';
      const guestName = item.activeBooking?.guestName?.toLowerCase() || '';
      const roomNumber = (item.room.number || '').toLowerCase();
      const todayGuestNames = item.todayBookings.map((booking) => booking.guestName || '').join(' ').toLowerCase();

      return (
          roomNumber.includes(term) ||
          propertyName.includes(term) ||
          roomTypeName.includes(term) ||
          guestName.includes(term) ||
          todayGuestNames.includes(term)
      );
  };

  const getScheduleTimeLabel = (booking: Booking) => {
      const dayStart = new Date(currentTime);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const checkIn = new Date(booking.checkInDate);
      const checkOut = new Date(booking.checkOutDate);
      const startsBeforeToday = checkIn.getTime() < dayStart.getTime();
      const endsAfterToday = checkOut.getTime() >= dayEnd.getTime();

      const startLabel = startsBeforeToday ? `${formatTimeOnly(checkIn)} hôm trước` : formatTimeOnly(checkIn);
      const endLabel = endsAfterToday ? `${formatTimeOnly(checkOut)} hôm sau` : formatTimeOnly(checkOut);
      return `${startLabel} - ${endLabel}`;
  };

  const getRoomStatusBadge = (item: (typeof processedRooms)[number]) => {
      if (item.activeBooking || item.room.status === RoomStatus.OCCUPIED) {
          return { label: 'Đang ở', className: 'bg-red-100 text-red-700 border-red-200' };
      }
      if (item.room.status === RoomStatus.VACANT_DIRTY) {
          return { label: 'Bẩn', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
      }
      return { label: 'Sạch', className: 'bg-green-100 text-green-700 border-green-200' };
  };

  const getScheduleBookingMeta = (booking: Booking) => {
      const status = deriveBookingStatus(booking, currentTime);
      if (status === BookingStatus.CHECKED_IN) {
          return {
              label: 'Đang ở',
              lineClassName: 'border-red-300 bg-red-50/70 text-red-900',
              dotClassName: 'bg-red-500'
          };
      }
      if (status === BookingStatus.CHECKED_OUT) {
          return {
              label: 'Đã ra',
              lineClassName: 'border-gray-200 bg-gray-50/60 text-gray-500',
              dotClassName: 'bg-gray-300'
          };
      }
      return {
          label: 'Sắp vào',
          lineClassName: 'border-blue-200 bg-blue-50/70 text-blue-900',
          dotClassName: 'bg-blue-500'
      };
  };

  // --- FILTER ---
  const filteredList = processedRooms.filter(item => {
      if (filter === 'DIRTY' && item.room.status !== RoomStatus.VACANT_DIRTY) return false;
      if (filter === 'CLEAN' && item.room.status !== RoomStatus.VACANT_CLEAN) return false;
      if (filter === 'OCCUPIED' && !item.activeBooking && item.room.status !== RoomStatus.OCCUPIED) return false;

      return matchesSearch(item);
  });
  const scheduleList = processedRooms.filter(matchesSearch);

  const nightShiftRooms = processedRooms.filter(r => r.nightEvent !== null);
  const countDirty = processedRooms.filter(item => item.room.status === RoomStatus.VACANT_DIRTY).length;
  const todayBookingCount = scheduleList.reduce((total, item) => total + item.todayBookings.length, 0);
  const branchLabel = currentProperty.id === 'ALL' ? 'Tất cả chi nhánh' : currentProperty.name;
  const todayLabel = formatDayLabel(currentTime);
  const emptyReason = searchTerm.trim()
      ? `Không có phòng khớp từ khóa "${searchTerm.trim()}".`
      : filter !== 'ALL'
          ? `Không có phòng nào trong bộ lọc ${filter === 'DIRTY' ? 'Cần dọn' : filter === 'CLEAN' ? 'Sẵn sàng' : 'Đang ở'} tại ${branchLabel}.`
          : `Không có phòng nào tại ${branchLabel}.`;
  const scheduleEmptyReason = searchTerm.trim()
      ? `Không có phòng hoặc khách khớp từ khóa "${searchTerm.trim()}".`
      : `Không có phòng nào tại ${branchLabel}.`;

  return (
    <div className="katka-liquid-page min-h-screen bg-gray-100 pb-24 font-sans select-none">
      {/* HEADER */}
      <div className="bg-white px-4 py-3 shadow-sm sticky top-0 z-20 border-b border-gray-200">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <h1 className="shrink-0 text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Brush className="text-orange-600" size={24} />
                    BUỒNG PHÒNG
                </h1>
                <span className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-black text-white border border-blue-700 shadow-sm">
                    <Building2 size={12} className="shrink-0" />
                    <span className="truncate">{branchLabel}</span>
                </span>
            </div>

            <div className="relative w-full sm:w-72 lg:ml-auto lg:w-64 xl:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm kiếm"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm font-medium text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {searchTerm && (
                <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="Xóa tìm kiếm"
                >
                    <X size={14} />
                </button>
            )}
            </div>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 items-center">
            <button onClick={() => setActiveView('CURRENT')} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${activeView==='CURRENT' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}>Việc hiện tại</button>
            <button onClick={() => setActiveView('DAY_SCHEDULE')} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${activeView==='DAY_SCHEDULE' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}>Lịch trong ngày</button>
            <div className="h-6 w-px shrink-0 bg-gray-200" />
            {activeView === 'CURRENT' ? (
                <>
                    <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${filter==='ALL' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>Tất cả</button>
                    <button onClick={() => setFilter('DIRTY')} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${filter==='DIRTY' ? 'bg-yellow-500 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}>Cần dọn ({countDirty})</button>
                    <button onClick={() => setFilter('CLEAN')} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${filter==='CLEAN' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}>Sẵn sàng</button>
                    <button onClick={() => setFilter('OCCUPIED')} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${filter==='OCCUPIED' ? 'bg-red-600 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}>Đang ở</button>
                </>
            ) : (
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap bg-gray-100 text-gray-600">
                    {todayLabel} · {todayBookingCount} lượt khách
                </span>
            )}
        </div>
      </div>

      {/* NIGHT SHIFT BANNER */}
      {activeView === 'CURRENT' && nightShiftRooms.length > 0 && (
          <div className="bg-slate-900 text-white p-3 shadow-md mb-2">
              <div className="flex items-center gap-2 mb-2">
                  <Moon className="text-yellow-400 fill-current" size={18} />
                  <h3 className="font-bold text-sm uppercase">Ca Đêm (22h-7h)</h3>
              </div>
              <div className="grid grid-cols-1 gap-1">
                  {nightShiftRooms.map(({ room, nightEvent }) => (
                      <div key={room.id} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded border border-slate-700">
                          <span className="font-black text-yellow-400 text-lg">{room.number}</span>
                          <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold ${nightEvent?.type === 'IN' ? 'text-green-400' : 'text-orange-400'}`}>
                                  {nightEvent?.type === 'IN' ? 'KHÁCH VÀO' : 'KHÁCH RA'}
                              </span>
                              <span className="text-sm font-medium">{nightEvent?.displayTime}</span>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* ROOM LIST */}
      {activeView === 'CURRENT' ? (
      <div className="p-2 space-y-3">
        {filteredList.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
                <div className="font-bold text-gray-700">Không có phòng nào trong danh sách này</div>
                <div className="mt-1">{emptyReason}</div>
            </div>
        )}

        {filteredList.map((item, index) => {
            const { room, activeBooking, lastOut, nextIn, isUrgent, warningText, currentOccupied, nightEvent, hasStaleOccupiedStatus } = item;
            const typeName = roomTypes.find(t => t.id === room.typeId)?.name || '';
            const prevRoom = filteredList[index - 1]?.room;
            const isNewBranch = !prevRoom || prevRoom.propertyId !== room.propertyId;
            const branchName = properties.find(p => p.id === room.propertyId)?.name;

            // --- UI RENDER LOGIC ---
            let cardBg = "bg-white";
            let borderColor = "border-gray-200";
            let actionBtn = null;
            let infoContent = null;
            const feedback = statusFeedback?.roomId === room.id ? statusFeedback : null;
            const isSavingThisRoom = feedback?.state === 'saving';
            const roomMapShortcut = (
                <button
                    type="button"
                    onClick={() => onOpenRoomMap?.(room)}
                    className="w-full border-t border-black/5 bg-white/80 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 hover:bg-blue-50 transition-colors inline-flex items-center justify-center gap-1"
                >
                    <CalendarDays size={12} />
                    Xem lịch
                </button>
            );

            if (activeBooking) {
                // === CASE 1: PHÒNG ĐANG Ở ===
                cardBg = "bg-red-50";
                borderColor = "border-red-200";
                const minLeft = currentOccupied ? currentOccupied.minutesLeft : 999;
                
                infoContent = (
                    <div className="flex flex-col justify-center h-full space-y-1.5 pl-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-black text-red-700 truncate">
                            <User size={13} />
                            {currentOccupied?.guestName || activeBooking.guestName || 'Khách lẻ'}
                        </div>
                        <div className="flex items-center gap-2">
                            <LogOut size={16} className="text-red-500"/>
                            <div className="flex flex-col leading-none">
                                <span className="text-[10px] text-red-400 font-bold uppercase">Khách ra:</span>
                                <span className="text-base font-black text-gray-800">
                                    {currentOccupied ? formatCompactDateTime(currentOccupied.checkOut) : '--:--'}
                                </span>
                            </div>
                        </div>
                        {nextIn && (
                            <div className="flex items-center gap-2 border-t border-red-200 pt-1">
                                <ArrowRight size={14} className="text-green-600"/>
                                <span className="text-[10px] text-green-700 font-bold">Sau đó: {formatCompactDateTime(nextIn)}</span>
                            </div>
                        )}
                        {minLeft <= 60 && minLeft >= 0 && <div className="text-orange-600 font-black text-xs animate-pulse">⚡️ SẮP RA ({minLeft}p)</div>}
                        {minLeft < 0 && <div className="text-red-600 font-black text-xs">⚠️ QUÁ GIỜ ({Math.abs(minLeft)}p)</div>}
                    </div>
                );

                actionBtn = (
                    <div className="w-full h-full flex flex-col">
                        <div className="flex-1 bg-red-100 flex flex-col items-center justify-center text-red-400">
                            <User size={28} />
                            <span className="text-[10px] font-bold mt-1 uppercase">Đang ở</span>
                        </div>
                        {roomMapShortcut}
                    </div>
                );

            } else if (room.status === RoomStatus.VACANT_DIRTY) {
                // === CASE 2: PHÒNG BẨN (CẦN DỌN) ===
                cardBg = "bg-yellow-50";
                borderColor = "border-yellow-400 shadow-md"; 
                
                infoContent = (
                    <div className="flex flex-col justify-center h-full space-y-1 pl-1">
                        <div className="flex items-center gap-2 text-gray-600">
                            <LogOut size={16} className="text-gray-400"/> 
                            <span className="text-sm font-bold">{lastOut ? formatCompactDateTime(lastOut) : 'Chưa có lịch trả gần nhất'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <LogIn size={16} className={nextIn ? "text-blue-600" : "text-gray-300"}/>
                            <span className={`text-sm font-bold ${nextIn ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                                {nextIn ? `Khách vào: ${formatCompactDateTime(nextIn)}` : 'Chưa có khách vào tiếp'}
                            </span>
                        </div>
                        {isUrgent && (
                            <div className="text-red-600 font-black text-xs flex items-center gap-1 mt-1 animate-pulse bg-red-100 px-1 rounded">
                                <Zap size={12} fill="currentColor"/> {warningText}
                            </div>
                        )}
                    </div>
                );

                // --- BIG ACTION BUTTON ---
                actionBtn = (
                    <div className="w-full h-full flex flex-col">
                        <button 
                            onClick={() => handleAction(room.id, RoomStatus.VACANT_CLEAN)}
                            disabled={!canUpdateRoomStatus || isSavingThisRoom}
                            className={`flex-1 bg-green-600 active:bg-green-700 text-white flex flex-col items-center justify-center transition-colors shadow-inner ${!canUpdateRoomStatus ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isSavingThisRoom ? <Loader2 size={28} className="animate-spin" /> : <Check size={32} strokeWidth={4} />}
                            <span className="text-[10px] font-black uppercase mt-1">{isSavingThisRoom ? 'Đang lưu' : 'SẠCH'}</span>
                        </button>
                        {roomMapShortcut}
                    </div>
                );

            } else {
                // === CASE 3: PHÒNG SẠCH ===
                cardBg = "bg-white";
                borderColor = "border-gray-200 opacity-90";

                infoContent = (
                    <div className="flex flex-col justify-center h-full space-y-1 pl-1">
                        <div className="flex items-center gap-2">
                            <CheckCircle size={16} className="text-green-500"/>
                            <span className="text-sm font-bold text-green-700">Đã sẵn sàng</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <LogIn size={16} className={nextIn ? "text-blue-600" : "text-gray-300"}/>
                            <span className={`text-sm font-bold ${nextIn ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                                {nextIn ? `Khách vào: ${formatCompactDateTime(nextIn)}` : 'Chưa có khách vào tiếp'}
                            </span>
                        </div>
                        {hasStaleOccupiedStatus && (
                            <div className="text-amber-700 font-bold text-[11px] flex items-center gap-1 bg-amber-100 px-1.5 py-0.5 rounded">
                                <AlertTriangle size={12} /> Trạng thái cũ đang lệch, có thể báo sạch/bẩn lại.
                            </div>
                        )}
                    </div>
                );

                // Nút Báo Bẩn (Để sửa sai hoặc dọn lại)
                actionBtn = (
                    <div className="w-full h-full flex flex-col">
                        <button 
                            onClick={() => handleAction(room.id, RoomStatus.VACANT_DIRTY)}
                            disabled={!canUpdateRoomStatus || isSavingThisRoom}
                            className={`flex-1 bg-gray-50 hover:bg-gray-100 text-gray-400 active:text-gray-600 flex flex-col items-center justify-center border-l border-gray-100 transition-colors ${!canUpdateRoomStatus ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isSavingThisRoom ? <Loader2 size={20} className="animate-spin" /> : <RotateCcw size={20} />}
                            <span className="text-[9px] font-bold mt-1">{isSavingThisRoom ? 'Đang lưu' : 'Báo bẩn'}</span>
                        </button>
                        {roomMapShortcut}
                    </div>
                );
            }

            return (
                <React.Fragment key={room.id}>
                    {isNewBranch && filter === 'ALL' && (
                        <div className="housekeeping-branch-header sticky top-[105px] z-10 px-4 py-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider border-y shadow-sm mt-4 mb-2 first:mt-0">
                            <Building2 size={14} className="text-blue-600"/>
                            {branchName}
                        </div>
                    )}

                    <div className={`flex min-h-[100px] rounded-xl overflow-hidden border-2 shadow-sm relative transition-all duration-300 ${cardBg} ${borderColor}`}>
                        {feedback?.state === 'saved' && (
                            <div className="absolute right-2 top-2 z-10 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-black text-white shadow">
                                {feedback.message}
                            </div>
                        )}
                        {/* CỘT TRÁI (28%): Số phòng */}
                        <div className="w-[28%] flex flex-col items-center justify-center border-r border-black/5 p-1 relative bg-white/50">
                            {nightEvent && <Moon size={14} className="absolute top-1 left-1 text-indigo-600 fill-current" />}
                            <span className="text-3xl md:text-4xl font-black text-gray-800 tracking-tighter">{room.number}</span>
                            <span className="text-[9px] font-bold uppercase text-gray-500 text-center leading-none mt-1 line-clamp-1">{typeName}</span>
                        </div>

                        {/* CỘT GIỮA (47%): Thông tin */}
                        <div className="w-[47%] px-2 py-2">
                            {infoContent}
                        </div>

                        {/* CỘT PHẢI (25%): Nút bấm */}
                        <div className="w-[25%] border-l border-black/5">
                            {actionBtn}
                        </div>
                    </div>
                </React.Fragment>
            );
        })}
      </div>
      ) : (
      <div className="p-2 space-y-3">
        {scheduleList.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
                <div className="font-bold text-gray-700">Không có phòng nào trong lịch hôm nay</div>
                <div className="mt-1">{scheduleEmptyReason}</div>
            </div>
        )}

        {scheduleList.map((item, index) => {
            const { room, todayBookings } = item;
            const typeName = roomTypes.find(t => t.id === room.typeId)?.name || '';
            const prevRoom = scheduleList[index - 1]?.room;
            const isNewBranch = !prevRoom || prevRoom.propertyId !== room.propertyId;
            const branchName = properties.find(p => p.id === room.propertyId)?.name;
            const statusBadge = getRoomStatusBadge(item);

            return (
                <React.Fragment key={room.id}>
                    {isNewBranch && (
                        <div className="housekeeping-branch-header sticky top-[105px] z-10 px-4 py-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider border-y shadow-sm mt-4 mb-2 first:mt-0">
                            <Building2 size={14} className="text-blue-600"/>
                            {branchName}
                        </div>
                    )}

                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-baseline gap-2">
                                <span className="text-xl font-black text-gray-900 leading-tight">{room.number}</span>
                                <span className="truncate text-[11px] font-bold uppercase text-gray-500">{typeName || 'Chưa có hạng phòng'}</span>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${statusBadge.className}`}>
                                {statusBadge.label}
                            </span>
                        </div>

                        <div className="mt-2 space-y-1.5">
                            {todayBookings.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-400">
                                    Không có lượt khách hôm nay
                                </div>
                            ) : (
                                todayBookings.map((booking) => {
                                    const bookingMeta = getScheduleBookingMeta(booking);
                                    return (
                                    <div key={booking.id} className={`flex items-center gap-2 rounded-lg border-l-4 px-3 py-2 text-sm font-bold ${bookingMeta.lineClassName}`}>
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${bookingMeta.dotClassName}`} />
                                        <span className="truncate">
                                            {getScheduleTimeLabel(booking)} · {booking.guestName || 'Khách lẻ'} · {bookingMeta.label}
                                        </span>
                                    </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </React.Fragment>
            );
        })}
      </div>
      )}
    </div>
  );
};

export default Housekeeping;
