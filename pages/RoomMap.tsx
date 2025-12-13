
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Room, RoomType, Booking, BookingStatus, RoomStatus, Customer, Property, Tag } from '../types';
import { DataService } from '../services/dataService';
import { LayoutGrid, List as ListIcon, Plus, X, Search, ChevronRight, ChevronLeft, Trash2, Calendar, Clock, Check, Info, PlusCircle, AlertTriangle, Tag as TagIcon, MapPin, Users } from 'lucide-react';

// Declare html2canvas
declare const html2canvas: any;

interface RoomMapProps {
  rooms: Room[];
  roomTypes: RoomType[];
  bookings: Booking[];
  customers: Customer[];
  tags: Tag[];
  onUpdateStatus: (roomId: string, status: RoomStatus) => void;
  onRefresh: () => void;
  currentProperty: Property;
  currentUser: string;
}

type ViewMode = 'DAY' | 'WEEK' | 'MONTH';

// --- Helpers ---
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const addDays = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
const addHours = (d: Date, hours: number) => { const x = new Date(d); x.setTime(x.getTime() + hours * 3600000); return x; };

// Format helper
const formatNumber = (num: number) => {
    return new Intl.NumberFormat('vi-VN').format(num);
};
const parseNumber = (str: string) => {
    return Number(str.replace(/\./g, ''));
};

const formatTicketDate = (isoStr: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// --- Custom Components ---

// 1. Money Input Control (Auto formats 1.000.000)
const MoneyInput = ({ value, onChange, className }: { value: number, onChange: (val: number) => void, className?: string }) => {
    const [displayVal, setDisplayVal] = useState('');

    useEffect(() => {
        setDisplayVal(formatNumber(value));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Allow digits only
        const raw = e.target.value.replace(/[^0-9]/g, '');
        const val = Number(raw);
        setDisplayVal(formatNumber(val));
        onChange(val);
    };

    return (
        <input 
            type="text"
            className={className}
            value={displayVal}
            onChange={handleChange}
        />
    )
}

// 2. Unified Date/Time Picker Control
const DateTimeControl = ({ 
    dateValue, 
    onChange 
}: { 
    dateValue: string, 
    onChange: (newIso: string) => void 
}) => {
    const [showCalendar, setShowCalendar] = useState(false);
    const [showTime, setShowTime] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [hasError, setHasError] = useState(false);
    const [viewDate, setViewDate] = useState(new Date());
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (dateValue) {
            const d = new Date(dateValue);
            const day = d.getDate().toString().padStart(2, '0');
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const year = d.getFullYear();
            const hour = d.getHours().toString().padStart(2, '0');
            const min = d.getMinutes().toString().padStart(2, '0');
            setInputValue(`${day}/${month}/${year} ${hour}:${min}`);
            setViewDate(d);
            setHasError(false);
        } else {
            setInputValue('');
        }
    }, [dateValue]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setShowCalendar(false);
                setShowTime(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        setHasError(false); 
    };

    const commitChange = () => {
        const match = inputValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s(\d{1,2}):(\d{1,2})$/);
        if (!match) {
            setHasError(true);
            alert("Định dạng không hợp lệ! Vui lòng nhập: dd/mm/yyyy hh:mm");
            if(dateValue) {
                const d = new Date(dateValue);
                 const day = d.getDate().toString().padStart(2, '0');
                const month = (d.getMonth() + 1).toString().padStart(2, '0');
                const year = d.getFullYear();
                const hour = d.getHours().toString().padStart(2, '0');
                const min = d.getMinutes().toString().padStart(2, '0');
                setInputValue(`${day}/${month}/${year} ${hour}:${min}`);
            }
            return;
        }

        const [_, d, m, y, h, min] = match;
        const newDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h), parseInt(min));

        if (isNaN(newDate.getTime()) || newDate.getMonth() !== parseInt(m) - 1) {
             setHasError(true);
             alert("Ngày giờ không tồn tại!");
             return;
        }

        const offset = newDate.getTimezoneOffset() * 60000;
        const isoString = (new Date(newDate.getTime() - offset)).toISOString().slice(0, -1);
        onChange(isoString);
        setViewDate(newDate);
        setHasError(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
            commitChange();
        }
    };

    const handleDateSelect = (day: number) => {
        const current = dateValue ? new Date(dateValue) : new Date();
        const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day, current.getHours(), current.getMinutes());
        const offset = newDate.getTimezoneOffset() * 60000;
        onChange((new Date(newDate.getTime() - offset)).toISOString().slice(0, -1));
        setShowCalendar(false);
    };

    const handleTimeSelect = (h: number, m: number) => {
        const current = dateValue ? new Date(dateValue) : new Date();
        current.setHours(h, m);
        const offset = current.getTimezoneOffset() * 60000;
        onChange((new Date(current.getTime() - offset)).toISOString().slice(0, -1));
        setShowTime(false);
    };

    const timeSlots = [];
    for(let h=0; h<24; h++) {
        timeSlots.push({h, m: 0, label: `${h.toString().padStart(2,'0')}:00`});
        timeSlots.push({h, m: 30, label: `${h.toString().padStart(2,'0')}:30`});
    }

    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();

    return (
        <div className="relative w-full" ref={containerRef}>
            <div className={`flex items-center border rounded-lg px-2 py-2 bg-white gap-2 shadow-sm transition-all ${hasError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300 hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200'}`}>
                <input 
                    type="text"
                    className="flex-1 min-w-0 text-sm font-medium text-black bg-white outline-none placeholder:text-gray-400"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onBlur={commitChange}
                    placeholder="dd/mm/yyyy hh:mm"
                />
                <button onClick={() => { setShowCalendar(!showCalendar); setShowTime(false); }} className="text-gray-500 hover:text-blue-600 p-1 rounded hover:bg-gray-100 transition-colors">
                    <Calendar size={18} />
                </button>
                <button onClick={() => { setShowTime(!showTime); setShowCalendar(false); }} className="text-gray-500 hover:text-blue-600 p-1 rounded hover:bg-gray-100 transition-colors">
                    <Clock size={18} />
                </button>
            </div>
            {showCalendar && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 p-4 z-50 w-72 animate-fade-in">
                    <div className="flex justify-between items-center mb-4">
                        <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronLeft size={20}/></button>
                        <span className="font-bold text-gray-800">Tháng {viewDate.getMonth() + 1} {viewDate.getFullYear()}</span>
                        <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronRight size={20}/></button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-400 mb-2">
                        <span>CN</span><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span>
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const d = i + 1;
                            const isSelected = new Date(dateValue).getDate() === d && new Date(dateValue).getMonth() === viewDate.getMonth();
                            return (
                                <button 
                                    key={d} onClick={() => handleDateSelect(d)}
                                    className={`w-8 h-8 rounded-full text-sm ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                                >
                                    {d}
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-3 pt-3 border-t text-center">
                        <button onClick={() => {
                            const now = new Date();
                            const offset = now.getTimezoneOffset() * 60000;
                            onChange((new Date(now.getTime() - offset)).toISOString().slice(0, -1));
                            setViewDate(now);
                        }} className="text-sm text-green-600 font-bold hover:underline">Về giờ hiện tại</button>
                    </div>
                </div>
            )}
            {showTime && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 py-1 z-50 w-32 max-h-60 overflow-y-auto no-scrollbar">
                    {timeSlots.map((slot, idx) => (
                        <button 
                            key={idx}
                            onClick={() => handleTimeSelect(slot.h, slot.m)}
                            className={`w-full text-left px-4 py-2 text-sm font-medium hover:bg-gray-50 ${
                                new Date(dateValue).getHours() === slot.h && Math.abs(new Date(dateValue).getMinutes() - slot.m) < 15
                                ? 'bg-green-600 text-white hover:bg-green-700' 
                                : 'text-gray-700'
                            }`}
                        >
                            {slot.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};


// --- Main Component ---
const RoomMap: React.FC<RoomMapProps> = ({ rooms, roomTypes, bookings, customers, tags, onUpdateStatus, onRefresh, currentProperty, currentUser }) => {
  const [viewType, setViewType] = useState<'GRID' | 'LIST'>('GRID');
  const [timelineMode, setTimelineMode] = useState<ViewMode>('WEEK');
  const [startDate, setStartDate] = useState(startOfDay(new Date())); 
  
  // Get latest properties for receipt printing
  const properties = DataService.getProperties();

  const [filters, setFilters] = useState({
      // Removed branchId filter from local state as it is controlled globally
      typeId: 'ALL',
      roomId: 'ALL',
      status: 'ALL', 
      search: ''
  });

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); 
  
  // Receipt Modal State
  const [receiptData, setReceiptData] = useState<any | null>(null);
  
  // Data for the modal
  const [bookingMeta, setBookingMeta] = useState<{
      id?: string;
      groupId?: string; // Track Group ID
      guestName: string;
      guestPhone: string;
      totalPrice: number;
      paidAmount: number;
      notes: string;
      status: BookingStatus;
      isManualPrice: boolean;
      tags: string[]; // Selected tag IDs
  }>({
      guestName: '', guestPhone: '', totalPrice: 0, paidAmount: 0, notes: '', status: BookingStatus.CONFIRMED, isManualPrice: false, tags: []
  });

  // Multiple Rows for Rooms
  interface BookingRow {
      tempId: string;
      bookingId?: string; // Existing Booking ID from DB
      roomId: string;
      checkIn: string;
      checkOut: string;
      price: number;
  }
  const [bookingRows, setBookingRows] = useState<BookingRow[]>([]);
  
  // Track original bookings in edit mode to handle deletions
  const [originalBookingIds, setOriginalBookingIds] = useState<string[]>([]);

  // Drag State
  const [dragStart, setDragStart] = useState<{roomId: string, time: Date} | null>(null);
  const [dragEnd, setDragEnd] = useState<{roomId: string, time: Date} | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- Helpers ---
  const getDurationText = (start?: string, end?: string) => {
    if(!start || !end) return '...';
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const diff = e - s;
    if(diff < 0) return 'Lỗi';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        const remainingHours = hours % 24;
        return remainingHours > 0 ? `${days} ngày ${remainingHours}h` : `${days} ngày`;
    }
    return `${hours} giờ`;
  }

  // Auto-update price if not manual
  useEffect(() => {
     if (!bookingMeta.isManualPrice) {
         const sum = bookingRows.reduce((sum, row) => sum + (row.price || 0), 0);
         setBookingMeta(prev => ({ ...prev, totalPrice: sum }));
     }
  }, [bookingRows, bookingMeta.isManualPrice]);


  // --- Filter Logic ---
  const filteredRooms = useMemo(() => {
    // rooms are ALREADY filtered by App.tsx based on Global Property Selector (Single or ALL)
    return rooms.filter(r => {
        if (filters.typeId !== 'ALL' && r.typeId !== filters.typeId) return false;
        if (filters.roomId !== 'ALL' && r.id !== filters.roomId) return false;
        return true;
    });
  }, [rooms, filters]);

  const filteredBookings = useMemo(() => {
    let res = bookings.filter(b => b.status !== BookingStatus.DELETED); 
    if (filters.search) {
        const lower = filters.search.toLowerCase();
        res = res.filter(b => 
            b.guestName.toLowerCase().includes(lower) || 
            b.guestPhone.includes(lower) || 
            b.id.toLowerCase().includes(lower)
        );
    }
    const filterStart = startDate;
    let filterEnd = new Date(startDate);
    if(timelineMode === 'DAY') filterEnd = addDays(filterStart, 1);
    else if(timelineMode === 'WEEK') filterEnd = addDays(filterStart, 7);
    else filterEnd = addDays(filterStart, 30);
    if (filters.status !== 'ALL') {
        res = res.filter(b => {
            const bStart = new Date(b.checkInDate);
            const bEnd = new Date(b.checkOutDate);
            if (filters.status === 'ARRIVING') return bStart >= filterStart && bStart < filterEnd;
            if (filters.status === 'DEPARTING') return bEnd >= filterStart && bEnd < filterEnd;
            if (filters.status === 'STAYING') return bStart < filterEnd && bEnd < filterStart;
            return true;
        });
    }
    return res;
  }, [bookings, filters, startDate, timelineMode]);

  // --- Grid Calculation ---
  const gridColumns = useMemo(() => {
      if (timelineMode === 'DAY') return 24;
      if (timelineMode === 'WEEK') return 7;
      return 30;
  }, [timelineMode]);

  const timeSlots = useMemo(() => {
      const slots = [];
      for(let i=0; i<gridColumns; i++) {
          if (timelineMode === 'DAY') slots.push(addHours(startDate, i));
          else slots.push(addDays(startDate, i));
      }
      return slots;
  }, [gridColumns, timelineMode, startDate]);

  // --- Modal Opening Logic ---
  const openModal = (booking: Partial<Booking> | null, editMode: boolean, defaultRoomId?: string, defaultDates?: {start: string, end: string}) => {
      setIsEditMode(editMode);
      setShowDeleteConfirm(false); 
      
      if (editMode && booking) {
          // GROUP LOGIC: Fetch all bookings in the same group
          let groupBookings: Booking[] = [booking as Booking];
          if (booking.groupId) {
              groupBookings = bookings.filter(b => b.groupId === booking.groupId && b.status !== BookingStatus.DELETED);
              // Fallback if filter fails (shouldn't happen)
              if (groupBookings.length === 0) groupBookings = [booking as Booking];
          }

          const mainBooking = groupBookings[0];
          const totalGroupPrice = groupBookings.reduce((sum, b) => sum + b.totalPrice, 0);
          const totalGroupPaid = groupBookings.reduce((sum, b) => sum + b.paidAmount, 0);

          setBookingMeta({
              id: mainBooking.id, // ID of first booking (used for ref)
              groupId: mainBooking.groupId,
              guestName: mainBooking.guestName || '',
              guestPhone: mainBooking.guestPhone || '',
              totalPrice: totalGroupPrice,
              paidAmount: totalGroupPaid,
              notes: mainBooking.notes || '',
              status: mainBooking.status || BookingStatus.CONFIRMED,
              isManualPrice: true,
              tags: mainBooking.tags || [] 
          });

          const rows: BookingRow[] = groupBookings.map(b => ({
              tempId: `existing-${b.id}`,
              bookingId: b.id,
              roomId: b.roomId,
              checkIn: b.checkInDate,
              checkOut: b.checkOutDate,
              price: b.totalPrice
          }));

          setBookingRows(rows);
          setOriginalBookingIds(groupBookings.map(b => b.id));

      } else {
          // Create Mode
          setBookingMeta({
              guestName: '', guestPhone: '', totalPrice: 0, paidAmount: 0, notes: '', status: BookingStatus.CONFIRMED, isManualPrice: false, tags: []
          });
          setOriginalBookingIds([]);
          
          let checkIn = defaultDates ? defaultDates.start : '';
          let checkOut = defaultDates ? defaultDates.end : '';
          if (!checkIn) {
              const now = new Date();
              now.setHours(14,0,0,0);
              const off = now.getTimezoneOffset() * 60000;
              checkIn = (new Date(now.getTime() - off)).toISOString().slice(0, -1);
          }
          if (!checkOut) {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(12,0,0,0);
              const off = tomorrow.getTimezoneOffset() * 60000;
              checkOut = (new Date(tomorrow.getTime() - off)).toISOString().slice(0, -1);
          }
          setBookingRows([{
              tempId: 'init',
              roomId: defaultRoomId || '',
              checkIn: checkIn,
              checkOut: checkOut,
              price: 0
          }]);
      }
      setShowModal(true);
  };

  const handleAddRow = () => {
      const lastRow = bookingRows[bookingRows.length - 1];
      setBookingRows([...bookingRows, {
          tempId: `row-${Date.now()}`,
          roomId: '',
          checkIn: lastRow.checkIn,
          checkOut: lastRow.checkOut,
          price: 0
      }]);
  };

  const handleRemoveRow = (idx: number) => {
      if (bookingRows.length === 1 && isEditMode) {
          alert("Không thể xóa phòng duy nhất trong chế độ chỉnh sửa. Hãy sử dụng chức năng xóa đơn.");
          return;
      }
      const newRows = [...bookingRows];
      newRows.splice(idx, 1);
      setBookingRows(newRows);
  };

  const updateRow = (idx: number, field: keyof BookingRow, value: any) => {
      const newRows = [...bookingRows];
      newRows[idx] = { ...newRows[idx], [field]: value };
      if (field === 'roomId') {
          const r = rooms.find(rm => rm.id === value);
          if (r) {
              const t = roomTypes.find(type => type.id === r.typeId);
              if (t) newRows[idx].price = t.price;
          }
      }
      setBookingRows(newRows);
  };

  const handleManualCreate = () => {
     openModal(null, false);
  };

  const handleMouseDown = (roomId: string, time: Date) => {
      setIsDragging(true); setDragStart({roomId, time}); setDragEnd({roomId, time});
  };

  const handleMouseEnter = (roomId: string, time: Date) => {
      if (!isDragging || !dragStart) return;
      if (dragStart.roomId !== roomId) return;
      setDragEnd({roomId, time});
  };

  const handleMouseUp = () => {
      if (!isDragging || !dragStart || !dragEnd) {
          setIsDragging(false); setDragStart(null); setDragEnd(null);
          return;
      }
      setIsDragging(false);
      let start = dragStart.time < dragEnd.time ? dragStart.time : dragEnd.time;
      let end = dragStart.time < dragEnd.time ? dragEnd.time : dragStart.time;
      let checkIn: Date, checkOut: Date;

      if (timelineMode === 'DAY') {
          checkIn = new Date(start); checkOut = addHours(end, 1); 
      } else {
          checkIn = new Date(start); checkIn.setHours(14, 0, 0, 0);
          checkOut = new Date(end);
          if (start.getTime() === end.getTime()) checkOut = addDays(checkOut, 1);
          else checkOut = addDays(checkOut, 1);
          checkOut.setHours(12, 0, 0, 0);
      }
      
      const toLocalISO = (d: Date) => {
          const offset = d.getTimezoneOffset() * 60000;
          return (new Date(d.getTime() - offset)).toISOString().slice(0, -1);
      }
      openModal(null, false, dragStart.roomId, {start: toLocalISO(checkIn), end: toLocalISO(checkOut)});
      setDragStart(null); setDragEnd(null);
  };

  const handleSaveBooking = () => {
     const validRows = bookingRows.filter(r => r.roomId);
     if (validRows.length === 0) return alert("Vui lòng chọn ít nhất một phòng");

     // --- Validation Logic ---
     for (const row of validRows) {
         const room = rooms.find(r => r.id === row.roomId);
         const startTime = new Date(row.checkIn).getTime();
         const endTime = new Date(row.checkOut).getTime();
         
         if (startTime >= endTime) {
             alert(`Lỗi thời gian (Phòng ${room?.number || row.roomId}):\nThời gian Trả phòng phải lớn hơn thời gian Nhận phòng.\nVui lòng kiểm tra lại.`);
             return;
         }

         const availability = DataService.validateRoomAvailability(row.roomId, row.checkIn, row.checkOut, row.bookingId);
         if (!availability.valid) {
             alert(`Lỗi đặt phòng (Phòng ${room?.number || row.roomId}):\n${availability.reason}\n\nVui lòng chọn thời gian khác cách ít nhất 30 phút.`);
             return;
         }
     }

     // Generate Group ID if needed (for more than 1 room, or always)
     // Use existing groupId if editing, otherwise generate only if multiple rows (or consistent strategy)
     let groupId = bookingMeta.groupId;
     if (!groupId && validRows.length > 1) {
         groupId = DataService.generateBookingId() + '_grp'; 
     }

     // Handle Save (Create or Update)
     // Distribute price and paid amount roughly equally or proportionally (simplified: first room gets remainder)
     const pricePerRoom = Math.floor(bookingMeta.totalPrice / validRows.length);
     
     // 1. Handle Deletions (If we are in edit mode and some original IDs are missing from validRows)
     if (isEditMode && originalBookingIds.length > 0) {
         const currentIds = validRows.map(r => r.bookingId).filter(Boolean);
         const idsToDelete = originalBookingIds.filter(oid => !currentIds.includes(oid));
         idsToDelete.forEach(id => {
             DataService.deleteBooking(id, currentUser);
         });
     }

     // 2. Upsert Rows
     validRows.forEach((row, idx) => {
         // Calculated distributed values
         const thisPrice = idx === 0 ? pricePerRoom + (bookingMeta.totalPrice % validRows.length) : pricePerRoom;
         const thisPaid = idx === 0 ? bookingMeta.paidAmount : 0; // Simple strategy: Assign payment to leader
         // In a real app, you might want to sum paidAmount from rows, but here we edit total in meta.
         
         const selectedRoom = rooms.find(r => r.id === row.roomId);

         if (row.bookingId) {
             // UPDATE Existing
             const updatedB: Booking = {
                 id: row.bookingId,
                 groupId: groupId, // Ensure group ID is set/preserved
                 propertyId: selectedRoom?.propertyId || currentProperty.id, // Ensure correct property ID from room
                 roomId: row.roomId,
                 customerId: 'c_guest',
                 guestName: bookingMeta.guestName || 'Khách lẻ',
                 guestPhone: bookingMeta.guestPhone || '',
                 checkInDate: row.checkIn,
                 checkOutDate: row.checkOut,
                 status: bookingMeta.status,
                 totalPrice: thisPrice, 
                 paidAmount: thisPaid,
                 createdAt: new Date().toISOString(), // In real app, preserve original createdAt
                 createdBy: currentUser,
                 notes: bookingMeta.notes,
                 tags: bookingMeta.tags
             };
             DataService.updateBooking(updatedB);
         } else {
             // CREATE New
             const newB: Booking = {
                 id: DataService.generateBookingId(),
                 groupId: groupId,
                 propertyId: selectedRoom?.propertyId || currentProperty.id,
                 roomId: row.roomId,
                 customerId: 'c_guest',
                 guestName: bookingMeta.guestName || 'Khách lẻ',
                 guestPhone: bookingMeta.guestPhone || '',
                 checkInDate: row.checkIn,
                 checkOutDate: row.checkOut,
                 status: bookingMeta.status,
                 totalPrice: thisPrice,
                 paidAmount: thisPaid, 
                 createdAt: new Date().toISOString(),
                 createdBy: currentUser,
                 notes: bookingMeta.notes,
                 tags: bookingMeta.tags
             };
             DataService.addBooking(newB);
         }
     });

     // --- PREPARE RECEIPT DATA ---
     // The receipt MUST show all rooms in the current transaction/group
     const receiptRooms = validRows.map(row => {
         const room = rooms.find(r => r.id === row.roomId);
         const type = roomTypes.find(t => t.id === room?.typeId);
         const prop = properties.find(p => p.id === room?.propertyId); 
         return {
             roomNumber: room?.number || 'N/A',
             typeName: type?.name || 'N/A',
             branchName: prop?.name || 'N/A',
             checkIn: row.checkIn,
             checkOut: row.checkOut
         };
     });
     
     const selectedTags = tags.filter(t => bookingMeta.tags.includes(t.id));

     setReceiptData({
         guestName: bookingMeta.guestName || 'Khách lẻ',
         guestPhone: bookingMeta.guestPhone || '',
         notes: bookingMeta.notes,
         tags: selectedTags,
         total: bookingMeta.totalPrice,
         paid: bookingMeta.paidAmount,
         rooms: receiptRooms
     });

     setShowModal(false);
     onRefresh();
  };

  const handleDeleteClick = () => {
      setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
      // Delete ALL bookings in the group if editing a group
      // or just the single booking
      
      const idsToDelete = originalBookingIds.length > 0 ? originalBookingIds : (bookingMeta.id ? [bookingMeta.id] : []);
      
      if (idsToDelete.length === 0) return;

      let successCount = 0;
      idsToDelete.forEach(id => {
          if (DataService.deleteBooking(id, currentUser)) successCount++;
      });
      
      if (successCount > 0) {
          alert(`Đã xóa ${successCount} đơn thành công!`);
          setShowDeleteConfirm(false);
          setShowModal(false);
          onRefresh();
      } else {
          alert("Không thể xóa đơn. Vui lòng kiểm tra console log.");
          setShowDeleteConfirm(false);
      }
  };

  const toggleTag = (tagId: string) => {
      setBookingMeta(prev => {
          const exists = prev.tags.includes(tagId);
          return {
              ...prev,
              tags: exists ? prev.tags.filter(t => t !== tagId) : [...prev.tags, tagId]
          };
      });
  };

  const getBookingStyle = (booking: Booking) => {
     const isPaid = booking.paidAmount >= booking.totalPrice;
     let classes = "absolute h-[80%] top-[10%] rounded-md text-[10px] px-1 overflow-hidden cursor-pointer shadow-sm flex flex-col justify-center transition-all hover:scale-[1.02] z-10 border ";
     if (isPaid) classes += "bg-green-500 text-white border-green-600 shadow-green-200"; 
     else classes += "bg-red-500 text-white border-red-600 shadow-red-200";
     return classes;
  };

  const renderGridCell = (room: Room, slot: Date) => {
      let isSelected = false;
      if (isDragging && dragStart && dragEnd && dragStart.roomId === room.id) {
          const s = dragStart.time < dragEnd.time ? dragStart.time : dragEnd.time;
          const e = dragStart.time < dragEnd.time ? dragEnd.time : dragStart.time;
          if (slot >= s && slot <= e) isSelected = true;
      }
      return (
          <div 
            key={slot.toISOString()}
            className={`border-r h-full relative select-none transition-colors duration-75 ${isSelected ? 'bg-blue-100' : 'hover:bg-gray-50'}`}
            onMouseDown={() => handleMouseDown(room.id, slot)}
            onMouseEnter={() => handleMouseEnter(room.id, slot)}
            onMouseUp={handleMouseUp}
          ></div>
      )
  };

  return (
    <div className="h-full flex flex-col space-y-4 font-sans text-gray-800 animate-fade-in">
       {/* Filters Header (Same as before) */}
       <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-4 transition-all">
          <div className="flex flex-wrap justify-between items-center gap-4">
              <div className="flex bg-gray-100 p-1.5 rounded-xl">
                  {(['DAY', 'WEEK', 'MONTH'] as ViewMode[]).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setTimelineMode(mode)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${timelineMode === mode ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                          {mode === 'DAY' ? 'Theo Ngày' : mode === 'WEEK' ? 'Theo Tuần' : 'Theo Tháng'}
                      </button>
                  ))}
              </div>
              <div className="flex-1 max-w-md relative">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18}/>
                   <input 
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none text-sm transition-all text-gray-900 placeholder:text-gray-400"
                      placeholder="Tìm tên khách, SĐT, Mã booking..."
                      value={filters.search}
                      onChange={e => setFilters({...filters, search: e.target.value})}
                   />
              </div>
              <div className="flex gap-3">
                 <div className="flex bg-gray-100 p-1 rounded-lg">
                      <button onClick={() => setViewType('GRID')} className={`p-2 rounded-md transition-all ${viewType==='GRID'?'bg-white shadow text-blue-600':'text-gray-500'}`}><LayoutGrid size={20}/></button>
                      <button onClick={() => setViewType('LIST')} className={`p-2 rounded-md transition-all ${viewType==='LIST'?'bg-white shadow text-blue-600':'text-gray-500'}`}><ListIcon size={20}/></button>
                 </div>
                 <button onClick={handleManualCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-semibold shadow-md shadow-blue-200 transition-all active:scale-95"><Plus size={20} /> Đặt phòng</button>
              </div>
          </div>
          <div className="flex flex-wrap gap-3 items-center pt-2 border-t border-gray-50">
               <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-100 text-gray-700" value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})}>
                   <option value="ALL">Tất cả trạng thái</option>
                   <option value="STAYING">Đang lưu trú</option>
                   <option value="ARRIVING">Sắp đến</option>
                   <option value="DEPARTING">Sắp đi</option>
               </select>
               {/* REMOVED BRANCH SELECTOR HERE - NOW GLOBAL */}
               <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-100 text-gray-700" value={filters.typeId} onChange={e => setFilters({...filters, typeId: e.target.value})}>
                   <option value="ALL">Tất cả hạng phòng</option>
                   {roomTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
               </select>
               <div className="ml-auto flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1">
                   <button onClick={() => setStartDate(timelineMode === 'DAY' ? addDays(startDate, -1) : timelineMode === 'WEEK' ? addDays(startDate, -7) : addDays(startDate, -30))} className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600"><ChevronLeft size={18}/></button>
                   <div className="w-40"><div className="text-center font-bold text-sm text-gray-700 py-1.5 cursor-pointer hover:bg-gray-50 rounded">{startDate.toLocaleDateString('vi-VN')}</div></div>
                   <button onClick={() => setStartDate(timelineMode === 'DAY' ? addDays(startDate, 1) : timelineMode === 'WEEK' ? addDays(startDate, 7) : addDays(startDate, 30))} className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600"><ChevronRight size={18}/></button>
               </div>
          </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col relative">
          {viewType === 'GRID' ? (
             <div className="flex-1 overflow-auto no-scrollbar relative">
                 <div style={{minWidth: timelineMode === 'MONTH' ? '2000px' : timelineMode === 'DAY' ? '1200px' : '100%'}}>
                     <div className="sticky top-0 z-20 bg-gray-50 border-b flex h-14 shadow-sm">
                         <div className="w-40 flex-shrink-0 border-r p-3 font-bold text-gray-700 bg-gray-50 flex items-center sticky left-0 z-30 shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)]">Phòng</div>
                         <div className="flex-1 grid" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                             {timeSlots.map((slot, i) => (
                                 <div key={i} className={`border-r px-1 text-center text-xs flex flex-col justify-center font-medium ${slot.toDateString() === new Date().toDateString() ? 'bg-blue-50 text-blue-700' : 'text-gray-600'}`}>
                                     {timelineMode === 'DAY' ? `${slot.getHours()}:00` : <><span className={slot.getDate() === new Date().getDate() ? 'font-bold text-base' : 'text-sm'}>{slot.getDate()}/{slot.getMonth()+1}</span></>}
                                 </div>
                             ))}
                         </div>
                     </div>
                     {filteredRooms.map(room => (
                         <div key={room.id} className="flex h-20 border-b hover:bg-gray-50 transition-colors group">
                             <div className="w-40 flex-shrink-0 border-r p-3 flex flex-col justify-center bg-white sticky left-0 z-10 border-r-gray-200 group-hover:bg-gray-50 transition-colors shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                 <div className="font-bold text-lg text-gray-800">{room.number}</div>
                                 <div className="text-xs text-gray-500 truncate mt-1">{roomTypes.find(t=>t.id===room.typeId)?.name}</div>
                             </div>
                             <div className="flex-1 grid relative" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                                 {timeSlots.map((slot) => renderGridCell(room, slot))}
                                 {filteredBookings.filter(b => b.roomId === room.id).map(b => {
                                        const bStart = new Date(b.checkInDate);
                                        const bEnd = new Date(b.checkOutDate);
                                        const viewStart = timeSlots[0];
                                        const viewEnd = timelineMode === 'DAY' ? addHours(viewStart, 24) : addDays(viewStart, gridColumns);
                                        if (bEnd <= viewStart || bStart >= viewEnd) return null;
                                        const totalDuration = viewEnd.getTime() - viewStart.getTime();
                                        const offset = Math.max(0, bStart.getTime() - viewStart.getTime());
                                        const duration = Math.min(bEnd.getTime(), viewEnd.getTime()) - Math.max(bStart.getTime(), viewStart.getTime());
                                        const left = (offset / totalDuration) * 100;
                                        const width = (duration / totalDuration) * 100;
                                        
                                        // Tag styling
                                        const bookingTags = tags.filter(t => b.tags?.includes(t.id));
                                        
                                        // Group Indicator
                                        const isGroup = !!b.groupId;

                                        return (
                                            <div key={b.id} className={getBookingStyle(b)} style={{left: `${left}%`, width: `${width}%`}} onClick={(e) => { e.stopPropagation(); openModal(b, true, undefined, undefined); }}>
                                                {/* Group / Note Indicator */}
                                                <div className="absolute top-0 right-0 flex gap-0.5 z-20">
                                                    {isGroup && (
                                                        <div className="bg-blue-500 text-white w-3 h-3 flex items-center justify-center text-[7px] border border-white rounded-bl-md font-bold shadow-sm" title="Khách đoàn"><Users size={8} /></div>
                                                    )}
                                                    {b.notes && (
                                                        <div className="bg-orange-500 text-white rounded-full w-3 h-3 flex items-center justify-center text-[7px] border border-white shadow-sm font-bold" title="Có ghi chú">!</div>
                                                    )}
                                                </div>
                                                
                                                <div className="font-bold truncate text-xs">{b.guestName}</div>
                                                
                                                {/* Tag Indicators */}
                                                <div className="flex gap-0.5 mt-1">
                                                    {bookingTags.map(t => (
                                                        <div key={t.id} className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: t.color}} title={t.name}></div>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    })}
                             </div>
                         </div>
                     ))}
                 </div>
             </div>
          ) : (
            <div className="overflow-auto">
                <table className="w-full text-sm text-left">
                    {/* Simplified List View */}
                    <thead className="bg-gray-50 text-gray-700 font-bold border-b">
                        <tr><th className="p-4">Mã Đặt Phòng</th><th className="p-4">Phòng</th><th className="p-4">Khách hàng</th><th className="p-4">Tags</th><th className="p-4">Thời gian</th><th className="p-4 text-right">Thao tác</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredBookings.map((b) => {
                            const room = rooms.find(r => r.id === b.roomId);
                            const bookingTags = tags.filter(t => b.tags?.includes(t.id));
                            return (
                                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-mono text-blue-600 font-medium">
                                        {b.id}
                                        {b.groupId && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800"><Users size={10} className="mr-1"/>Đoàn</span>}
                                    </td>
                                    <td className="p-4 font-bold text-gray-800">{room?.number}</td>
                                    <td className="p-4 font-medium text-gray-900">{b.guestName}</td>
                                    <td className="p-4">
                                        <div className="flex gap-1 flex-wrap">
                                            {bookingTags.map(t => <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold" style={{backgroundColor: t.color}}>{t.name}</span>)}
                                        </div>
                                    </td>
                                    <td className="p-4 text-xs text-gray-600">{new Date(b.checkInDate).toLocaleString('vi-VN')}</td>
                                    <td className="p-4 text-right"><button onClick={() => openModal(b, true, undefined, undefined)} className="text-blue-600 hover:text-blue-800 font-medium">Chi tiết</button></td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
          )}
      </div>

      {/* CREATE/EDIT MODAL */}
      {showModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[1200px] overflow-hidden animate-fade-in border border-white/20">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                      <div>
                          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                              {isEditMode ? 'Chi tiết đặt phòng' : 'Tạo đặt phòng mới'}
                              {bookingMeta.groupId && <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full flex items-center gap-1"><Users size={12}/> Khách đoàn</span>}
                          </h3>
                          {bookingMeta.id && <p className="text-sm text-gray-400 font-mono mt-0.5">#{bookingMeta.id} {bookingMeta.groupId ? `(Nhóm: ${bookingMeta.groupId})` : ''}</p>}
                      </div>
                      <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors bg-gray-50 rounded-full p-2 hover:bg-gray-100"><X size={20} /></button>
                  </div>
                  <div className="p-6 overflow-y-auto max-h-[80vh]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                          <div><label className="block text-xs font-bold uppercase text-gray-500 mb-1.5 ml-1">Tên khách hàng</label><input type="text" className="w-full bg-white border border-gray-200 text-gray-900 font-medium p-3 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" placeholder="Nhập tên khách..." value={bookingMeta.guestName} onChange={e => setBookingMeta({...bookingMeta, guestName: e.target.value})} /></div>
                          <div><label className="block text-xs font-bold uppercase text-gray-500 mb-1.5 ml-1">Số điện thoại</label><input type="text" className="w-full bg-white border border-gray-200 text-gray-900 font-medium p-3 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none" placeholder="Nhập số điện thoại..." value={bookingMeta.guestPhone} onChange={e => setBookingMeta({...bookingMeta, guestPhone: e.target.value})} /></div>
                      </div>

                      <div className="border border-emerald-100 rounded-xl mb-4 shadow-sm bg-white">
                          <div className="bg-emerald-50 flex text-xs font-bold text-emerald-800 p-4 items-center uppercase tracking-wider">
                            <div className="w-[15%]">Hạng phòng</div><div className="w-[15%]">Phòng</div><div className="w-[22%]">Nhận phòng</div><div className="w-[22%]">Trả phòng</div><div className="w-[12%] text-center">Dự kiến</div><div className="w-[14%] text-right">Xóa</div>
                          </div>
                          {bookingRows.map((row, idx) => (
                             <div key={row.tempId} className="flex items-center p-3 border-t border-emerald-100 bg-white hover:bg-emerald-50/20 transition-colors gap-3">
                                <div className="w-[15%] text-sm font-semibold text-gray-600 truncate px-2">{rooms.find(r => r.id === row.roomId)?.typeId ? roomTypes.find(t => t.id === rooms.find(r => r.id === row.roomId)?.typeId)?.name : '--'}</div>
                                <div className="w-[15%]"><select className="w-full border border-gray-200 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:border-blue-500 bg-white" value={row.roomId} onChange={e => updateRow(idx, 'roomId', e.target.value)}><option value="">Chọn</option>{rooms.map(r => (<option key={r.id} value={r.id}>{r.number}</option>))}</select></div>
                                <div className="w-[22%]"><DateTimeControl dateValue={row.checkIn} onChange={(val) => updateRow(idx, 'checkIn', val)} /></div>
                                <div className="w-[22%]"><DateTimeControl dateValue={row.checkOut} onChange={(val) => updateRow(idx, 'checkOut', val)} /></div>
                                <div className="w-[12%] text-center text-sm font-bold text-gray-800">{getDurationText(row.checkIn, row.checkOut)}</div>
                                <div className="w-[14%] text-right px-2"><button onClick={() => handleRemoveRow(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-1 hover:bg-red-50 rounded"><Trash2 size={18} /></button></div>
                             </div>
                          ))}
                      </div>

                      <div className="mb-8"><button onClick={handleAddRow} className="flex items-center gap-2 px-4 py-2 border-2 border-green-500 text-green-600 rounded-full font-bold hover:bg-green-50 transition-colors text-sm"><PlusCircle size={18} /> Chọn thêm phòng (Thêm vào đoàn)</button></div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="space-y-4">
                              <h4 className="font-bold text-gray-800 flex items-center gap-2"><Info size={16}/> Thông tin thanh toán (Toàn đoàn)</h4>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold uppercase text-green-700 mb-1.5">Tổng tiền (VNĐ)</label>
                                    <MoneyInput 
                                        className="w-full bg-white border border-gray-200 text-gray-900 p-3 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-green-100 focus:border-green-400"
                                        value={bookingMeta.totalPrice}
                                        onChange={(val) => setBookingMeta(prev => ({ ...prev, totalPrice: val, isManualPrice: true }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold uppercase text-blue-700 mb-1.5">Đã thanh toán (VNĐ)</label>
                                    <MoneyInput 
                                        className="w-full bg-white border border-gray-200 text-gray-900 p-3 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                                        value={bookingMeta.paidAmount || 0}
                                        onChange={(val) => setBookingMeta(prev => ({ ...prev, paidAmount: val }))}
                                    />
                                </div>
                              </div>
                              <div className="text-right border-t pt-3">
                                  <span className={`text-base font-bold ${bookingMeta.totalPrice - (bookingMeta.paidAmount||0) > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                      Cần thanh toán: {formatNumber(bookingMeta.totalPrice - (bookingMeta.paidAmount||0))} VNĐ
                                  </span>
                              </div>
                          </div>
                          <div>
                              <div className="mb-4">
                                  <h4 className="font-bold text-gray-800 flex items-center gap-2 mb-2"><TagIcon size={16}/> Thẻ (Tags)</h4>
                                  <div className="flex flex-wrap gap-2">
                                      {tags.map(t => {
                                          const isSelected = bookingMeta.tags.includes(t.id);
                                          return (
                                              <button 
                                                key={t.id}
                                                onClick={() => toggleTag(t.id)}
                                                className={`px-3 py-1 rounded-full text-xs font-bold transition-all border ${isSelected ? 'text-white' : 'text-gray-500 bg-white border-gray-200'}`}
                                                style={isSelected ? {backgroundColor: t.color, borderColor: t.color} : {}}
                                              >
                                                  {t.name}
                                              </button>
                                          )
                                      })}
                                  </div>
                              </div>
                              <h4 className="font-bold text-gray-800 flex items-center gap-2 mb-2"><Info size={16}/> Ghi chú</h4>
                              <textarea className="w-full bg-white border border-gray-200 text-gray-900 p-3 rounded-xl h-24 focus:ring-2 focus:ring-gray-100 focus:border-gray-400 outline-none resize-none placeholder:text-gray-400 font-medium" placeholder="Yêu cầu đặc biệt..." value={bookingMeta.notes} onChange={e => setBookingMeta({...bookingMeta, notes: e.target.value})}></textarea>
                          </div>
                      </div>

                      <div className="flex justify-between items-center pt-6 mt-6 border-t border-gray-100">
                          <div className="flex gap-2 items-center">
                             {isEditMode && (
                                <>
                                 <select className="border border-gray-200 p-3 rounded-xl font-semibold bg-gray-50 text-gray-700 outline-none focus:border-blue-500" value={bookingMeta.status} onChange={e => setBookingMeta({...bookingMeta, status: e.target.value as any})}>
                                     {!['CHECKED_IN', 'CHECKED_OUT'].includes(bookingMeta.status) && (
                                         <option value={bookingMeta.status} disabled>{bookingMeta.status}</option>
                                     )}
                                     <option value={BookingStatus.CHECKED_IN}>CHECKED_IN</option>
                                     <option value={BookingStatus.CHECKED_OUT}>CHECKED_OUT</option>
                                 </select>
                                 
                                 {!showDeleteConfirm ? (
                                     <button 
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleDeleteClick();
                                        }}
                                        className="flex items-center gap-2 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors ml-2 bg-red-50 font-bold border border-red-100" 
                                        title={originalBookingIds.length > 1 ? "Xóa toàn bộ đoàn" : "Xóa đơn"}
                                     >
                                        <Trash2 size={20} /> {originalBookingIds.length > 1 ? "Xóa đoàn" : "Xóa đơn"}
                                     </button>
                                 ) : (
                                     <div className="flex items-center gap-2 ml-2 bg-red-50 p-1.5 rounded-xl border border-red-100 animate-fade-in">
                                         <AlertTriangle size={18} className="text-red-600 ml-1" />
                                         <span className="text-sm font-bold text-red-700 mr-1">Chắc chắn xóa?</span>
                                         <button 
                                            onClick={handleConfirmDelete} 
                                            className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 shadow-sm transition-colors"
                                         >
                                            Có, xóa ngay
                                         </button>
                                         <button 
                                            onClick={() => setShowDeleteConfirm(false)} 
                                            className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-100 transition-colors"
                                         >
                                            Hủy
                                         </button>
                                     </div>
                                 )}
                                </>
                             )}
                          </div>
                          <div className="flex gap-3">
                              <button onClick={() => setShowModal(false)} className="px-6 py-3 text-gray-600 hover:bg-gray-100 rounded-xl font-semibold transition-colors">Đóng</button>
                              <button onClick={handleSaveBooking} className="px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-200 transition-transform active:scale-95 flex items-center gap-2"><Check size={20} /> Lưu Booking</button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* RECEIPT / TICKET MODAL */}
      {receiptData && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-fade-in">
              <div className="flex flex-col items-center gap-4">
                  {/* The Ticket Itself */}
                  <div className="bg-white w-[400px] rounded-[32px] shadow-2xl overflow-hidden font-sans relative border border-gray-200">
                      {/* Decorative Header */}
                      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 pb-8 relative">
                          <div className="absolute top-0 right-0 p-4 opacity-20"><ListIcon size={100} className="text-white"/></div>
                          <div className="flex flex-col items-center text-white relative z-10">
                              <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-3 border border-white/30 shadow-lg">
                                  <Check size={24} className="text-white" strokeWidth={4} />
                              </div>
                              <h2 className="text-xl font-bold tracking-tight">Xác Nhận Đặt Phòng</h2>
                              <p className="text-blue-100 text-xs mt-1 font-medium opacity-90">{new Date().toLocaleDateString('vi-VN')} • {new Date().toLocaleTimeString('vi-VN')}</p>
                          </div>
                      </div>

                      {/* Ticket Body - Text Standardized to text-sm */}
                      <div className="px-6 py-4 -mt-4 relative z-10 text-sm text-gray-700 font-medium">
                          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 mb-4">
                               <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Khách Hàng</p>
                               <div className="flex justify-between items-start">
                                   <div>
                                       <h3 className="font-bold text-gray-800 text-lg leading-tight">{receiptData.guestName}</h3>
                                       <p className="text-gray-500 mt-1">{receiptData.guestPhone || 'SĐT: ---'}</p>
                                   </div>
                                   {receiptData.tags && receiptData.tags.length > 0 && (
                                       <div className="flex flex-col gap-1 items-end">
                                           {receiptData.tags.map((t: Tag) => (
                                               <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold" style={{backgroundColor: t.color}}>{t.name}</span>
                                           ))}
                                       </div>
                                   )}
                               </div>
                               {receiptData.notes && (
                                   <div className="mt-2 pt-2 border-t border-gray-100">
                                       <p className="text-gray-400 text-xs italic">Ghi chú: {receiptData.notes}</p>
                                   </div>
                               )}
                          </div>

                          <div className="space-y-3 mb-6">
                              {receiptData.rooms.map((r: any, idx: number) => (
                                  <div key={idx} className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex justify-between items-center">
                                      <div>
                                          <div className="flex items-center gap-2 mb-1">
                                             <span className="font-bold text-gray-800">P.{r.roomNumber}</span>
                                             <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold text-xs">{r.typeName}</span>
                                          </div>
                                          <div className="flex items-center gap-1 text-gray-500">
                                              <MapPin size={12} /> <span className="text-xs">{r.branchName}</span>
                                          </div>
                                      </div>
                                      <div className="text-right text-gray-600 leading-tight text-xs">
                                          <div>IN: <span className="text-gray-800 font-bold">{formatTicketDate(r.checkIn)}</span></div>
                                          <div>OUT: <span className="text-gray-800 font-bold">{formatTicketDate(r.checkOut)}</span></div>
                                      </div>
                                  </div>
                              ))}
                          </div>

                          <div className="border-t-2 border-dashed border-gray-200 my-4"></div>

                          <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                  <span className="font-bold text-gray-500">Tổng cộng</span>
                                  <span className="font-bold text-gray-900">{formatNumber(receiptData.total)} đ</span>
                              </div>
                              <div className="flex justify-between items-center">
                                  <span className="font-bold text-green-600">Đã thanh toán</span>
                                  <span className="font-bold text-green-600">{formatNumber(receiptData.paid)} đ</span>
                              </div>
                              {receiptData.total - receiptData.paid > 0 && (
                                  <div className="flex justify-between items-center pt-2 border-t border-gray-100 mt-2">
                                      <span className="font-bold text-red-500">Còn lại</span>
                                      <span className="font-bold text-red-500">{formatNumber(receiptData.total - receiptData.paid)} đ</span>
                                  </div>
                              )}
                          </div>
                      </div>

                      {/* Footer Decoration */}
                      <div className="bg-gray-50 p-4 text-center border-t border-gray-100">
                           <p className="text-[10px] text-gray-400 font-medium">Cảm ơn quý khách đã sử dụng dịch vụ!</p>
                      </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                      <button onClick={() => setReceiptData(null)} className="px-8 py-2.5 rounded-full bg-white text-gray-700 font-bold shadow-lg hover:bg-gray-100 transition-all text-sm">
                          Đóng
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default RoomMap;
