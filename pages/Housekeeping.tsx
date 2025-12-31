
import React, { useMemo, useState, useEffect } from 'react';
import { Room, Booking, BookingStatus, RoomStatus, Property, RoomType } from '../types';
import { Check, LogOut, LogIn, Zap, User, RotateCcw, Brush, Moon, ArrowRight, Building2, ShieldCheck, AlertCircle } from 'lucide-react';

interface HousekeepingProps {
  rooms: Room[];
  bookings: Booking[];
  roomTypes: RoomType[];
  properties: Property[];
  onRefresh: () => void;
}

const Housekeeping: React.FC<HousekeepingProps> = ({ rooms, bookings, roomTypes, properties, onRefresh }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Cập nhật mỗi phút
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // --- HELPER FORMAT ---
  const formatCompactDateTime = (iso: string | null | undefined) => {
    if (!iso) return '--:--';
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
  };

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
        // 1. TÌM KHÁCH ĐANG Ở
        const activeBooking = bookings.find(b => b.roomId === room.id && b.status === BookingStatus.CHECKED_IN);

        // 2. Tìm khách vừa đi
        const lastBooking = bookings
            .filter(b => b.roomId === room.id && b.status === BookingStatus.CHECKED_OUT)
            .sort((a, b) => new Date(b.checkOutDate).getTime() - new Date(a.checkOutDate).getTime())[0];

        // 3. Tìm khách SẮP ĐẾN
        const nextBooking = bookings
            .filter(b => b.roomId === room.id && b.status === BookingStatus.CONFIRMED && new Date(b.checkInDate).getTime() > nowMs)
            .sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime())[0];

        // Cảnh báo gấp
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

        // Thông tin khách ĐANG Ở
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

        // Logic Ca Đêm
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

        return {
            room,
            activeBooking,
            lastOut: lastBooking ? lastBooking.checkOutDate : null,
            nextIn: nextBooking ? nextBooking.checkInDate : null,
            isUrgent,
            warningText,
            currentOccupied,
            nightEvent
        };
    });

    // --- SORTING LOGIC ---
    return processed.sort((a, b) => {
        const propA = properties.find(p => p.id === a.room.propertyId);
        const propB = properties.find(p => p.id === b.room.propertyId);
        const pOrderA = propA?.sortOrder ?? 9999;
        const pOrderB = propB?.sortOrder ?? 9999;
        if (pOrderA !== pOrderB) return pOrderA - pOrderB;

        const rOrderA = a.room.sortOrder ?? 9999;
        const rOrderB = b.room.sortOrder ?? 9999;
        if (rOrderA !== rOrderB) return rOrderA - rOrderB;

        return a.room.number.localeCompare(b.room.number, 'vi', { numeric: true });
    });

  }, [rooms, bookings, currentTime, properties]);

  const nightShiftRooms = roomList.filter(r => r.nightEvent !== null);
  const countDirty = roomList.filter(item => item.room.status === RoomStatus.VACANT_DIRTY).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24 font-sans select-none">
      {/* HEADER COMPACT */}
      <div className="bg-white px-4 py-3 shadow-sm sticky top-0 z-20 border-b border-gray-200 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Brush className="text-orange-600" size={24} />
          BUỒNG PHÒNG
        </h1>
        <div className="flex gap-2">
            <span className="bg-orange-100 text-orange-800 text-sm font-black px-3 py-1 rounded-lg border border-orange-200">
                CẦN DỌN: {countDirty}
            </span>
        </div>
      </div>

      {/* BANNER CA ĐÊM */}
      {nightShiftRooms.length > 0 && (
          <div className="bg-slate-900 text-white p-3 shadow-md">
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

      {/* DANH SÁCH THẺ */}
      <div className="p-2 space-y-2">
        {roomList.map((item, index) => {
            const { room, activeBooking, lastOut, nextIn, isUrgent, warningText, currentOccupied, nightEvent } = item;
            const typeName = roomTypes.find(t => t.id === room.typeId)?.name || '';
            
            const prevRoom = roomList[index - 1]?.room;
            const isNewBranch = !prevRoom || prevRoom.propertyId !== room.propertyId;
            const branchName = properties.find(p => p.id === room.propertyId)?.name;

            // --- UI RENDER LOGIC ---
            let cardBg = "";
            let borderColor = "";
            let statusIndicator = null; // Thay thế nút bấm bằng Indicator tĩnh
            let infoContent = null;

            if (activeBooking) {
                // === CASE 1: PHÒNG ĐANG Ở ===
                cardBg = "bg-red-50";
                borderColor = "border-red-300";

                const minLeft = currentOccupied ? currentOccupied.minutesLeft : 999;
                const isLeavingSoon = minLeft <= 60 && minLeft >= 0;
                const isOverDue = minLeft < 0;

                infoContent = (
                    <div className="flex flex-col justify-center h-full space-y-1.5">
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
                            <div className="flex items-center gap-2 border-t border-red-100 pt-1">
                                <ArrowRight size={14} className="text-green-600"/>
                                <div className="flex flex-col leading-none">
                                    <span className="text-[10px] text-green-600 font-bold uppercase">Khách kế:</span>
                                    <span className="text-sm font-bold text-green-800">
                                        {formatCompactDateTime(nextIn)}
                                    </span>
                                </div>
                            </div>
                        )}

                        {isLeavingSoon && <div className="text-orange-600 font-black text-xs animate-pulse">⚡️ SẮP RA ({minLeft}p)</div>}
                        {isOverDue && <div className="text-red-600 font-black text-xs">⚠️ QUÁ GIỜ ({Math.abs(minLeft)}p)</div>}
                    </div>
                );

                statusIndicator = (
                    <div className="w-full h-full bg-red-100 flex flex-col items-center justify-center text-red-500 border-l border-red-200">
                        <User size={28} />
                        <span className="text-[10px] font-bold mt-1 text-center uppercase">Đang ở</span>
                    </div>
                );

            } else if (room.status === RoomStatus.VACANT_DIRTY) {
                // === CASE 2: PHÒNG BẨN ===
                cardBg = "bg-yellow-50";
                borderColor = "border-yellow-400";
                
                infoContent = (
                    <div className="flex flex-col justify-center h-full space-y-1">
                        <div className="flex items-center gap-2 text-gray-600">
                            <LogOut size={16} className="text-gray-400"/> 
                            <span className="text-sm font-bold">{formatCompactDateTime(lastOut)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <LogIn size={16} className={nextIn ? "text-blue-600" : "text-gray-300"}/>
                            <span className={`text-sm font-bold ${nextIn ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                                {nextIn ? formatCompactDateTime(nextIn) : 'Chưa có khách'}
                            </span>
                        </div>
                        {isUrgent && (
                            <div className="text-red-600 font-black text-xs flex items-center gap-1 mt-1 animate-pulse">
                                <Zap size={12} fill="currentColor"/> {warningText}
                            </div>
                        )}
                    </div>
                );

                // STATIC INDICATOR - KHÔNG CÓ ONCLICK
                statusIndicator = (
                    <div className="w-full h-full bg-yellow-400 flex flex-col items-center justify-center text-white border-l border-yellow-500">
                        <AlertCircle size={32} strokeWidth={3} />
                        <span className="text-[10px] font-black uppercase mt-1">Cần dọn</span>
                    </div>
                );

            } else {
                // === CASE 3: PHÒNG SẠCH ===
                cardBg = "bg-white";
                borderColor = "border-gray-200 opacity-80";

                infoContent = (
                    <div className="flex flex-col justify-center h-full space-y-1">
                        <div className="flex items-center gap-2">
                            <LogIn size={16} className={nextIn ? "text-blue-600" : "text-gray-300"}/>
                            <div className="flex flex-col leading-none">
                                <span className="text-[10px] text-gray-400 font-bold uppercase">Khách tới:</span>
                                <span className={`text-sm font-bold ${nextIn ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                                    {nextIn ? formatCompactDateTime(nextIn) : 'Chưa có'}
                                </span>
                            </div>
                        </div>
                    </div>
                );

                // STATIC INDICATOR - KHÔNG CÓ ONCLICK
                statusIndicator = (
                    <div className="w-full h-full bg-gray-50 flex flex-col items-center justify-center text-green-600 border-l border-gray-100">
                        <ShieldCheck size={28} />
                        <span className="text-[10px] font-bold mt-1 text-center uppercase">Sẵn sàng</span>
                    </div>
                );
            }

            return (
                <React.Fragment key={room.id}>
                    {isNewBranch && (
                        <div className="sticky top-[58px] z-10 bg-gray-200/90 backdrop-blur-sm px-3 py-1.5 flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wider border-y border-gray-300 shadow-sm mt-2 first:mt-0">
                            <Building2 size={14} className="text-blue-600"/>
                            {branchName}
                        </div>
                    )}

                    <div className={`flex min-h-[100px] rounded-xl overflow-hidden border-2 shadow-sm ${cardBg} ${borderColor}`}>
                        {/* CỘT TRÁI (25%): Số phòng */}
                        <div className="w-[25%] flex flex-col items-center justify-center border-r border-black/5 p-1 relative">
                            {nightEvent && <Moon size={12} className="absolute top-1 left-1 text-indigo-600 fill-current" />}
                            <span className="text-3xl md:text-4xl font-black text-gray-800 tracking-tighter">{room.number}</span>
                            <span className="text-[9px] font-bold uppercase text-gray-500 text-center leading-none mt-1">{typeName}</span>
                        </div>

                        {/* CỘT GIỮA (50%): Thông tin */}
                        <div className="w-[50%] px-3 py-2">
                            {infoContent}
                        </div>

                        {/* CỘT PHẢI (25%): TRẠNG THÁI TĨNH */}
                        <div className="w-[25%]">
                            {statusIndicator}
                        </div>
                    </div>
                </React.Fragment>
            );
        })}
      </div>
    </div>
  );
};

export default Housekeeping;
