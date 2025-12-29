
import React, { useMemo, useState, useEffect } from 'react';
import { Room, Booking, BookingStatus, RoomStatus, Property, RoomType } from '../types';
import { DataService } from '../services/dataService';
import { Check, Clock, LogOut, LogIn, Zap, User, RotateCcw, AlertTriangle, Brush, Moon } from 'lucide-react';

interface HousekeepingProps {
  rooms: Room[];
  bookings: Booking[];
  roomTypes: RoomType[];
  properties: Property[];
  onRefresh: () => void;
}

const Housekeeping: React.FC<HousekeepingProps> = ({ rooms, bookings, roomTypes, properties, onRefresh }) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Cập nhật thời gian mỗi phút để tính toán cảnh báo
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // --- HELPER FORMAT DATE ---
  const formatFullDateTime = (iso: string | null | undefined) => {
    if (!iso) return '--:-- --/--';
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
  };

  const formatTimeOnly = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // --- NIGHT SHIFT LOGIC (22:00 - 07:00) ---
  const isNightTime = (dateStr: string) => {
      const d = new Date(dateStr);
      const h = d.getHours();
      return h >= 22 || h <= 7;
  };

  // --- LOGIC XỬ LÝ DỮ LIỆU ---
  const roomList = useMemo(() => {
    const nowMs = currentTime.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const processed = rooms.map(room => {
        // A. LOGIC CHO PHÒNG TRỐNG (Tìm khách vừa đi & sắp đến)
        const lastBooking = bookings
            .filter(b => b.roomId === room.id && b.status === BookingStatus.CHECKED_OUT)
            .sort((a, b) => new Date(b.checkOutDate).getTime() - new Date(a.checkOutDate).getTime())[0];

        const nextBooking = bookings
            .filter(b => b.roomId === room.id && b.status === BookingStatus.CONFIRMED && new Date(b.checkInDate).getTime() > nowMs)
            .sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime())[0];

        // Cảnh báo khách đến (Cho phòng trống)
        let isUrgent = false;
        let warningText = null;
        if (nextBooking) {
            const checkInMs = new Date(nextBooking.checkInDate).getTime();
            const diffMinutes = Math.floor((checkInMs - nowMs) / 60000);
            if (diffMinutes <= 60 && diffMinutes >= 0) {
                isUrgent = true;
                warningText = `⚡️ Khách sắp đến lúc ${formatTimeOnly(nextBooking.checkInDate)}!`;
            }
        }

        // B. LOGIC CHO PHÒNG CÓ KHÁCH (OCCUPIED) - Tìm đơn đang Check-in
        let occupiedDetails = null;
        let activeBooking = null; // Store for Night check
        if (room.status === RoomStatus.OCCUPIED) {
            activeBooking = bookings.find(b => b.roomId === room.id && b.status === BookingStatus.CHECKED_IN);
            if (activeBooking) {
                const checkOutMs = new Date(activeBooking.checkOutDate).getTime();
                const minutesLeft = Math.floor((checkOutMs - nowMs) / 60000);
                occupiedDetails = {
                    checkIn: activeBooking.checkInDate,
                    checkOut: activeBooking.checkOutDate,
                    minutesLeft: minutesLeft
                };
            }
        }

        // C. LOGIC CA ĐÊM (NIGHT SHIFT)
        // Kiểm tra sự kiện xảy ra trong 24h tới VÀ rơi vào khung giờ đêm
        let nightEvent: { type: 'IN' | 'OUT', time: string, displayTime: string } | null = null;

        // 1. Check Incoming Night (Khách đến đêm nay/sáng mai)
        if (nextBooking) {
            const t = new Date(nextBooking.checkInDate).getTime();
            if (t - nowMs < oneDayMs && isNightTime(nextBooking.checkInDate)) {
                nightEvent = { 
                    type: 'IN', 
                    time: nextBooking.checkInDate,
                    displayTime: formatFullDateTime(nextBooking.checkInDate)
                };
            }
        }

        // 2. Check Outgoing Night (Khách đi đêm nay/sáng mai)
        if (activeBooking) {
            const t = new Date(activeBooking.checkOutDate).getTime();
            // Chỉ báo nếu chưa quá hạn quá lâu (trong vòng 1 tiếng trước) hoặc tương lai
            if (t - nowMs > -3600000 && t - nowMs < oneDayMs && isNightTime(activeBooking.checkOutDate)) {
                nightEvent = { 
                    type: 'OUT', 
                    time: activeBooking.checkOutDate,
                    displayTime: formatFullDateTime(activeBooking.checkOutDate)
                };
            }
        }

        return {
            room,
            lastOut: lastBooking ? lastBooking.checkOutDate : null,
            nextIn: nextBooking ? nextBooking.checkInDate : null,
            isUrgent,
            warningText,
            occupiedDetails,
            nightEvent // New Field
        };
    });

    // --- SORTING LOGIC ---
    return processed.sort((a, b) => {
        // Priority 1: Phòng BẨN lên đầu
        const isDirtyA = a.room.status === RoomStatus.VACANT_DIRTY;
        const isDirtyB = b.room.status === RoomStatus.VACANT_DIRTY;
        if (isDirtyA && !isDirtyB) return -1;
        if (!isDirtyA && isDirtyB) return 1;

        // Priority 2: Gấp (Khách sắp đến)
        if (a.isUrgent && !b.isUrgent) return -1;
        if (!a.isUrgent && b.isUrgent) return 1;

        // Priority 3: Số phòng
        return a.room.number.localeCompare(b.room.number);
    });

  }, [rooms, bookings, currentTime]);

  // Lọc danh sách phòng có sự kiện đêm để hiển thị Banner
  const nightShiftRooms = roomList.filter(r => r.nightEvent !== null);

  // --- ACTIONS ---
  const handleUpdateStatus = (room: Room, newStatus: RoomStatus) => {
      if (navigator.vibrate) navigator.vibrate(50);
      DataService.updateRoomStatus(room.id, newStatus);
      onRefresh();
  };

  const countDirty = rooms.filter(r => r.status === RoomStatus.VACANT_DIRTY).length;

  return (
    <div className="min-h-screen bg-gray-100 pb-24 font-sans select-none">
      {/* HEADER */}
      <div className="bg-white px-4 py-3 shadow-sm sticky top-0 z-20 border-b border-gray-200 flex justify-between items-center">
        <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Brush className="text-orange-500" />
          DS Phòng
        </h1>
        <div className="flex gap-2">
            <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-1 rounded border border-yellow-200">
                Bẩn: {countDirty}
            </span>
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded border border-green-200">
                Tổng: {rooms.length}
            </span>
        </div>
      </div>

      {/* BANNER CA ĐÊM (Night Shift Warning) */}
      {nightShiftRooms.length > 0 && (
          <div className="bg-indigo-900 text-white p-4 shadow-md animate-fade-in">
              <div className="flex items-center gap-2 mb-2 border-b border-indigo-700 pb-2">
                  <Moon className="text-yellow-400 fill-current" size={20} />
                  <h3 className="font-bold text-sm md:text-base uppercase tracking-wider">Lưu ý Ca Đêm (22h - 7h)</h3>
              </div>
              <div className="space-y-1.5">
                  {nightShiftRooms.map(({ room, nightEvent }) => (
                      <div key={room.id} className="flex items-start gap-2 text-xs md:text-sm font-medium bg-indigo-800/50 p-1.5 rounded">
                          <span className="font-bold text-yellow-300 min-w-[40px]">{room.number}</span>
                          <span className="text-indigo-200">-</span>
                          <span className={nightEvent?.type === 'IN' ? 'text-green-300' : 'text-red-300'}>
                              KHÁCH {nightEvent?.type === 'IN' ? 'VÀO' : 'RA'}
                          </span>
                          <span className="text-white">lúc {nightEvent?.displayTime}</span>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* DANH SÁCH THẺ */}
      <div className="p-3 space-y-3">
        {roomList.map(({ room, lastOut, nextIn, isUrgent, warningText, occupiedDetails, nightEvent }) => {
            const typeName = roomTypes.find(t => t.id === room.typeId)?.name || '';
            
            // --- CẤU HÌNH GIAO DIỆN THEO TRẠNG THÁI ---
            let cardStyle = "";
            let leftColStyle = "";
            let actionCol = null;
            let middleContent = null;

            if (room.status === RoomStatus.VACANT_DIRTY) {
                // *** CASE 1: PHÒNG BẨN ***
                cardStyle = "bg-yellow-50 border-yellow-400 ring-1 ring-yellow-200";
                leftColStyle = "bg-yellow-100 text-yellow-900 border-r-yellow-200";
                actionCol = (
                    <button 
                        onClick={() => handleUpdateStatus(room, RoomStatus.VACANT_CLEAN)}
                        className="w-[30%] bg-green-600 active:bg-green-700 flex flex-col items-center justify-center text-white cursor-pointer transition-colors h-full"
                    >
                        <Check size={32} strokeWidth={4} />
                        <span className="text-[10px] md:text-xs font-bold uppercase mt-1">Dọn xong</span>
                    </button>
                );
                // Nội dung giữa: Khách ra / Khách vào
                middleContent = (
                    <>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-1 text-gray-500 text-[10px] font-bold uppercase">
                                <LogOut size={10}/> Khách ra:
                            </div>
                            <span className="text-xs font-bold text-gray-800">{formatFullDateTime(lastOut)}</span>
                        </div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-1 text-gray-500 text-[10px] font-bold uppercase">
                                <LogIn size={10}/> Khách vào:
                            </div>
                            <span className={`text-xs font-bold ${nextIn ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                                {nextIn ? formatFullDateTime(nextIn) : 'Trống'}
                            </span>
                        </div>
                        {isUrgent && warningText && (
                            <div className="absolute bottom-1 left-[30%] right-[30%] md:static md:w-full bg-red-100 text-red-600 text-[10px] font-bold px-1 py-0.5 rounded flex items-center gap-1 animate-pulse border border-red-200 justify-center md:justify-start">
                                <Zap size={10} fill="currentColor" /> {warningText}
                            </div>
                        )}
                    </>
                );

            } else if (room.status === RoomStatus.VACANT_CLEAN) {
                // *** CASE 2: PHÒNG SẠCH ***
                cardStyle = "bg-emerald-50 border-emerald-400 opacity-90";
                leftColStyle = "bg-emerald-100 text-emerald-900 border-r-emerald-200";
                actionCol = (
                    <div className="w-[30%] flex flex-col items-center justify-center border-l border-emerald-100 bg-white/50 h-full gap-2">
                        <div className="text-emerald-600 flex flex-col items-center">
                            <Check size={24} />
                            <span className="text-[10px] font-bold">SẠCH</span>
                        </div>
                        <button 
                            onClick={() => {
                                if(confirm(`Báo phòng ${room.number} là BẨN (Cần dọn lại)?`)) {
                                    handleUpdateStatus(room, RoomStatus.VACANT_DIRTY);
                                }
                            }}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-600 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-1"
                        >
                            <RotateCcw size={10} /> Báo bẩn
                        </button>
                    </div>
                );
                // Nội dung giữa: Tương tự phòng bẩn nhưng không có cảnh báo gấp
                middleContent = (
                    <>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-1 text-gray-500 text-[10px] font-bold uppercase">
                                <LogOut size={10}/> Khách ra:
                            </div>
                            <span className="text-xs font-bold text-gray-800">{formatFullDateTime(lastOut)}</span>
                        </div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-1 text-gray-500 text-[10px] font-bold uppercase">
                                <LogIn size={10}/> Khách vào:
                            </div>
                            <span className={`text-xs font-bold ${nextIn ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                                {nextIn ? formatFullDateTime(nextIn) : 'Trống'}
                            </span>
                        </div>
                    </>
                );

            } else if (room.status === RoomStatus.OCCUPIED) {
                // *** CASE 3: CÓ KHÁCH (Logic mới) ***
                cardStyle = "bg-red-50 border-red-300 opacity-95";
                leftColStyle = "bg-red-100 text-red-900 border-r-red-200";
                
                // Cột phải: Icon Đang ở
                actionCol = (
                    <div className="w-[30%] flex flex-col items-center justify-center border-l border-red-100 bg-white/50 h-full text-red-400">
                        <User size={28} />
                        <span className="text-[10px] font-bold text-center mt-1">Đang ở</span>
                    </div>
                );

                // Cột giữa: Thông tin Check-in/Check-out hiện tại
                if (occupiedDetails) {
                    const minLeft = occupiedDetails.minutesLeft;
                    middleContent = (
                        <>
                            <div className="flex flex-col">
                                <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold uppercase">
                                    <LogIn size={10}/> Khách vào:
                                </div>
                                <span className="text-xs font-bold text-gray-800">{formatFullDateTime(occupiedDetails.checkIn)}</span>
                            </div>
                            <div className="flex flex-col">
                                <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold uppercase">
                                    <LogOut size={10}/> Dự kiến ra:
                                </div>
                                <span className="text-xs font-bold text-gray-800">{formatFullDateTime(occupiedDetails.checkOut)}</span>
                            </div>

                            {/* Cảnh báo Sắp Check-out hoặc Quá giờ */}
                            {minLeft <= 60 && minLeft >= 0 && (
                                <div className="bg-orange-100 text-orange-700 text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-orange-200 mt-1 animate-pulse">
                                    <Clock size={12} /> SẮP RA (còn {minLeft}p)
                                </div>
                            )}
                            {minLeft < 0 && (
                                <div className="bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-red-700 mt-1 shadow-sm">
                                    <AlertTriangle size={12} fill="white" /> QUÁ GIỜ ({Math.abs(minLeft)}p)
                                </div>
                            )}
                        </>
                    );
                } else {
                    // Fallback nếu không tìm thấy booking (lỗi dữ liệu)
                    middleContent = <div className="text-xs text-gray-400 italic">Không tìm thấy thông tin đơn.</div>;
                }

            } else {
                // Case: Maintenance
                cardStyle = "bg-gray-100 border-gray-300 opacity-70";
                leftColStyle = "bg-gray-200 text-gray-600";
                actionCol = <div className="w-[30%] flex items-center justify-center text-xs font-bold text-gray-400">Bảo trì</div>;
                middleContent = <div className="text-xs text-gray-500 italic p-2">Phòng đang bảo trì kỹ thuật.</div>;
            }

            return (
                <div 
                    key={room.id} 
                    className={`flex h-32 rounded-xl shadow-sm overflow-hidden border-2 relative transition-transform ${cardStyle}`}
                >
                    {/* Badge CA ĐÊM */}
                    {nightEvent && (
                        <div className="absolute top-0 right-[30%] bg-indigo-600 text-white px-2 py-0.5 rounded-bl-lg z-10 flex items-center gap-1 shadow-sm border-b border-l border-indigo-700">
                            <Moon size={10} className="fill-current text-yellow-300" />
                            <span className="text-[9px] font-bold uppercase tracking-wide">
                                {nightEvent.type === 'IN' ? 'Vào đêm' : 'Ra đêm'}
                            </span>
                        </div>
                    )}

                    {/* CỘT TRÁI (30%): Số phòng */}
                    <div className={`w-[30%] flex flex-col items-center justify-center border-r ${leftColStyle}`}>
                        <span className="text-3xl font-black tracking-tighter">{room.number}</span>
                        <span className="text-[10px] font-bold uppercase mt-1 text-center px-1 truncate w-full opacity-70">
                            {typeName}
                        </span>
                    </div>

                    {/* CỘT GIỮA (40%): Thông tin */}
                    <div className="w-[40%] flex flex-col justify-center px-3 space-y-1.5 py-2">
                        {middleContent}
                    </div>

                    {/* CỘT PHẢI (30%): Hành động */}
                    {actionCol}
                </div>
            );
        })}
      </div>
    </div>
  );
};

export default Housekeeping;
