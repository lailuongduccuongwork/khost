
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Room, RoomType, Booking, BookingStatus, RoomStatus, Customer, Property, Tag, User, PERMISSIONS } from '../types';
import { DataService } from '../services/dataService';
import { LayoutGrid, List as ListIcon, Plus, X, Search, ChevronRight, ChevronLeft, Trash2, Calendar, Clock, Check, Info, PlusCircle, AlertTriangle, Tag as TagIcon, MapPin, Users, Lock, ArrowUpDown, ArrowUp, ArrowDown, Printer, Filter, MoreHorizontal } from 'lucide-react';

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
  currentUser: User; // Use full User object for permissions
}

type ViewMode = 'DAY' | 'WEEK' | 'MONTH';

// --- Helpers ---
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const addDays = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
const addHours = (d: Date, hours: number) => { const x = new Date(d); x.setTime(x.getTime() + hours * 3600000); return x; };
const addMonths = (d: Date, months: number) => { const x = new Date(d); x.setMonth(x.getMonth() + months); return x; };

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
const MoneyInput = ({ value, onChange, className, disabled }: { value: number, onChange: (val: number) => void, className?: string, disabled?: boolean }) => {
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
            disabled={disabled}
        />
    )
}

// 2. Unified Date/Time Picker Control
const DateTimeControl = ({ 
    dateValue, 
    onChange,
    disabled
}: { 
    dateValue: string, 
    onChange: (newIso: string) => void,
    disabled?: boolean
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
            <div className={`flex items-center border rounded-lg px-2 py-2 bg-white gap-2 shadow-sm transition-all ${hasError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300 hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200'} ${disabled ? 'bg-gray-100 opacity-70' : ''}`}>
                <input 
                    type="text"
                    className="flex-1 min-w-0 text-sm font-medium text-black bg-transparent outline-none placeholder:text-gray-400"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onBlur={commitChange}
                    placeholder="dd/mm/yyyy hh:mm"
                    disabled={disabled}
                />
                {!disabled && (
                    <>
                    <button onClick={() => { setShowCalendar(!showCalendar); setShowTime(false); }} className="text-gray-500 hover:text-blue-600 p-1 rounded hover:bg-gray-100 transition-colors">
                        <Calendar size={18} />
                    </button>
                    <button onClick={() => { setShowTime(!showTime); setShowCalendar(false); }} className="text-gray-500 hover:text-blue-600 p-1 rounded hover:bg-gray-100 transition-colors">
                        <Clock size={18} />
                    </button>
                    </>
                )}
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
  
  // Real-time current time for indicator
  const [now, setNow] = useState(new Date());

  // SORTING STATE
  const [sortConfig, setSortConfig] = useState<{key: keyof Booking, direction: 'asc' | 'desc'} | null>(null);

  useEffect(() => {
      // Update time every minute
      const timer = setInterval(() => setNow(new Date()), 60000);
      return () => clearInterval(timer);
  }, []);

  // Permissions
  const canAdd = currentUser.permissions?.includes(PERMISSIONS.CAN_ADD_BOOKING);
  const canEdit = currentUser.permissions?.includes(PERMISSIONS.CAN_EDIT_BOOKING);
  const canDelete = currentUser.permissions?.includes(PERMISSIONS.CAN_DELETE_BOOKING);

  // Get latest properties for receipt printing
  const properties = DataService.getProperties();
  const allUsers = DataService.getUsers();

  const [filters, setFilters] = useState({
      // Removed branchId filter from local state as it is controlled globally
      typeId: 'ALL',
      roomId: 'ALL',
      status: 'STAYING', // Default to STAYING (Thời gian lưu trú)
      search: ''
  });

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false); // NEW STATE FOR TICKET
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
  
  // Determine if a slot is the current time/date
  const isCurrentTimeSlot = (slot: Date) => {
      if (timelineMode === 'DAY') {
          // Compare Hour and Date
          return slot.getDate() === now.getDate() && 
                 slot.getMonth() === now.getMonth() &&
                 slot.getFullYear() === now.getFullYear() &&
                 slot.getHours() === now.getHours();
      } else {
          // Compare Date only (Week/Month view)
          return slot.getDate() === now.getDate() && 
                 slot.getMonth() === now.getMonth() &&
                 slot.getFullYear() === now.getFullYear();
      }
  };

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

  // Calculate View Range
  const { viewStart, viewEnd } = useMemo(() => {
      let vStart = new Date(startDate);
      vStart.setHours(0,0,0,0);
      let vEnd = new Date(vStart);
      
      if(timelineMode === 'DAY') {
          vEnd = addDays(vStart, 1);
      } else if(timelineMode === 'WEEK') {
          // Week view starts from selected startDate and adds 7 days
          vEnd = addDays(vStart, 7);
      } else { 
          // MONTH Mode: Strict 1st to Last Day
          // 1. Force start to 1st of month
          vStart.setDate(1); 
          // 2. End is last day of the current month
          vEnd = new Date(vStart.getFullYear(), vStart.getMonth() + 1, 0); 
          vEnd.setHours(23, 59, 59, 999);
      }

      return { viewStart: vStart, viewEnd: vEnd };
  }, [startDate, timelineMode]);

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
    
    // Apply Time Range Filter based on selected STATUS (Filter Type)
    res = res.filter(b => {
        const bStart = new Date(b.checkInDate).getTime();
        const bEnd = new Date(b.checkOutDate).getTime();
        const fStart = viewStart.getTime();
        const fEnd = viewEnd.getTime();

        if (filters.status === 'ARRIVING') {
            // "Thời gian nhận": Booking STARTS within the view range
            return bStart >= fStart && bStart < fEnd;
        } else if (filters.status === 'DEPARTING') {
            // "Thời gian trả": Booking ENDS within the view range
            return bEnd >= fStart && bEnd < fEnd;
        } else {
            // "Thời gian lưu trú" (STAYING/Default): Booking OVERLAPS with the view range
            return bStart < fEnd && bEnd > fStart;
        }
    });

    return res;
  }, [bookings, filters, viewStart, viewEnd]);

  // --- Date Range Label Helper ---
  const dateRangeLabel = useMemo(() => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      
      if (timelineMode === 'DAY') {
          return fmt(viewStart);
      } else if (timelineMode === 'MONTH') {
          return `Tháng ${viewStart.getMonth() + 1}/${viewStart.getFullYear()}`;
      } else {
          // WEEK: Show range start - end
          const endDisplay = new Date(viewEnd);
          endDisplay.setDate(endDisplay.getDate() - 1); // Display inclusive end date (e.g. Mon-Sun)
          return `${fmt(viewStart)} - ${fmt(endDisplay)}`;
      }
  }, [viewStart, viewEnd, timelineMode]);


  // --- SORTING LOGIC ---
  const sortedBookings = useMemo(() => {
      if (!sortConfig) return filteredBookings;
      
      return [...filteredBookings].sort((a, b) => {
          let valA = a[sortConfig.key];
          let valB = b[sortConfig.key];
          
          if (!valA) valA = '';
          if (!valB) valB = '';

          // String comparison for ISO Dates
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  }, [filteredBookings, sortConfig]);

  const handleSort = (key: keyof Booking) => {
      let direction: 'asc' | 'desc' = 'desc'; // Default to newest first
      if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
          direction = 'asc';
      }
      setSortConfig({ key, direction });
  };

  const SortIcon = ({ colKey }: { colKey: keyof Booking }) => {
      if (sortConfig?.key !== colKey) return <ArrowUpDown size={14} className="ml-1 opacity-30" />;
      return sortConfig.direction === 'asc' 
             ? <ArrowUp size={14} className="ml-1 text-blue-600" /> 
             : <ArrowDown size={14} className="ml-1 text-blue-600" />;
  };


  // --- Grid Calculation ---
  const gridColumns = useMemo(() => {
      if (timelineMode === 'DAY') return 24;
      if (timelineMode === 'WEEK') return 7;
      
      // MONTH: Calculate days in the specific month
      return new Date(viewStart.getFullYear(), viewStart.getMonth() + 1, 0).getDate();
  }, [timelineMode, viewStart]);

  const timeSlots = useMemo(() => {
      const slots = [];
      // Use the calculated viewStart which is already 1st of month for MONTH mode
      for(let i=0; i<gridColumns; i++) {
          if (timelineMode === 'DAY') slots.push(addHours(viewStart, i));
          else slots.push(addDays(viewStart, i));
      }
      return slots;
  }, [gridColumns, timelineMode, viewStart]);

  // --- Date Navigator Handler ---
  const handleNavigate = (direction: 'PREV' | 'NEXT') => {
      const factor = direction === 'NEXT' ? 1 : -1;
      
      if (timelineMode === 'DAY') {
          setStartDate(addDays(startDate, factor));
      } else if (timelineMode === 'WEEK') {
          setStartDate(addDays(startDate, factor * 7));
      } else {
          // MONTH: Move by 1 Month
          setStartDate(addMonths(startDate, factor));
      }
  };

  const handleDateInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.value) return;
      const d = new Date(e.target.value);
      if (!isNaN(d.getTime())) {
          setStartDate(d);
      }
  };

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
     if (canAdd) openModal(null, false);
     else alert("Bạn không có quyền thêm đặt phòng mới.");
  };

  const handleMouseDown = (roomId: string, time: Date) => {
      if (!canAdd) return; // Prevent drag if no permission
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
     let groupId = bookingMeta.groupId;
     if (!groupId && validRows.length > 1) {
         groupId = DataService.generateBookingId() + '_grp'; 
     }

     const pricePerRoom = Math.floor(bookingMeta.totalPrice / validRows.length);
     
     if (isEditMode && originalBookingIds.length > 0) {
         const currentIds = validRows.map(r => r.bookingId).filter(Boolean);
         const idsToDelete = originalBookingIds.filter(oid => !currentIds.includes(oid));
         idsToDelete.forEach(id => {
             DataService.deleteBooking(id, currentUser.id);
         });
     }

     validRows.forEach((row, idx) => {
         const thisPrice = idx === 0 ? pricePerRoom + (bookingMeta.totalPrice % validRows.length) : pricePerRoom;
         const thisPaid = idx === 0 ? bookingMeta.paidAmount : 0; 
         
         const selectedRoom = rooms.find(r => r.id === row.roomId);

         if (row.bookingId) {
             // UPDATE Existing
             // FIND ORIGINAL BOOKING TO PRESERVE createdAt
             const existingBooking = bookings.find(b => b.id === row.bookingId);

             const updatedB: Booking = {
                 id: row.bookingId,
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
                 // FIX: Preserve original createdAt
                 createdAt: existingBooking?.createdAt || new Date().toISOString(), 
                 createdBy: currentUser.id,
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
                 createdBy: currentUser.id,
                 notes: bookingMeta.notes,
                 tags: bookingMeta.tags
             };
             DataService.addBooking(newB);
         }
     });

     // --- PREPARE RECEIPT DATA FOR TICKET ---
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
     setShowTicketModal(true); // Open Ticket Modal
     onRefresh();
  };

  const handleDeleteClick = () => {
      if(!canDelete) return;
      setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
      const idsToDelete = originalBookingIds.length > 0 ? originalBookingIds : (bookingMeta.id ? [bookingMeta.id] : []);
      if (idsToDelete.length === 0) return;

      let successCount = 0;
      idsToDelete.forEach(id => {
          if (DataService.deleteBooking(id, currentUser.id)) successCount++;
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
      const isCurrent = isCurrentTimeSlot(slot);

      if (isDragging && dragStart && dragEnd && dragStart.roomId === room.id) {
          const s = dragStart.time < dragEnd.time ? dragStart.time : dragEnd.time;
          const e = dragStart.time < dragEnd.time ? dragEnd.time : dragStart.time;
          if (slot >= s && slot <= e) isSelected = true;
      }
      return (
          <div 
            key={slot.toISOString()}
            className={`border-r h-full relative select-none transition-colors duration-75 ${isSelected ? 'bg-blue-100' : (isCurrent ? 'bg-amber-50' : 'hover:bg-gray-50')}`}
            onMouseDown={() => handleMouseDown(room.id, slot)}
            onMouseEnter={() => handleMouseEnter(room.id, slot)}
            onMouseUp={handleMouseUp}
          >
            {/* NEW: 12:00 Line for Week View */}
            {timelineMode === 'WEEK' && (
                <div className="absolute left-1/2 top-0 bottom-0 w-px border-l border-dashed border-gray-200 pointer-events-none"></div>
            )}
          </div>
      )
  };

  // Determine if inputs should be disabled
  const isReadOnly = isEditMode ? !canEdit : !canAdd;

  return (
    <div className="h-[calc(100vh-5rem)] md:h-[calc(100vh-7rem)] flex flex-col space-y-4 font-sans text-gray-800 animate-fade-in">
       {/* New Filter Header */}
       <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between transition-all">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              
              <div className="flex gap-2 w-full md:w-auto">
                  {/* Filter Type Dropdown */}
                  <div className="relative flex-1 md:flex-none">
                      <select 
                        value={filters.status}
                        onChange={e => setFilters({...filters, status: e.target.value})}
                        className="w-full appearance-none pl-3 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-xs md:text-sm font-semibold text-gray-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer hover:border-gray-300 transition-colors"
                      >
                          <option value="STAYING">Lưu trú</option>
                          <option value="ARRIVING">Đến</option>
                          <option value="DEPARTING">Đi</option>
                      </select>
                      <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-gray-400 pointer-events-none" size={14} />
                  </div>

                  {/* View Mode Dropdown */}
                  <div className="relative flex-1 md:flex-none">
                      <select 
                        value={timelineMode}
                        onChange={e => setTimelineMode(e.target.value as ViewMode)}
                        className="w-full appearance-none pl-3 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-xs md:text-sm font-semibold text-gray-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer hover:border-gray-300 transition-colors"
                      >
                          <option value="DAY">Ngày</option>
                          <option value="WEEK">Tuần</option>
                          <option value="MONTH">Tháng</option>
                      </select>
                      <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-gray-400 pointer-events-none" size={14} />
                  </div>
              </div>

              {/* Date Range Navigator */}
              <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden h-[40px] md:h-[42px] w-full md:w-auto">
                   <button 
                      onClick={() => handleNavigate('PREV')}
                      className="h-full px-3 hover:bg-gray-100 text-gray-500 border-r border-gray-100 transition-colors"
                   >
                      <ChevronLeft size={18}/>
                   </button>
                   
                   <div className="relative h-full flex-1 md:flex-none flex items-center justify-center px-4 min-w-[150px] md:min-w-[200px] cursor-pointer hover:bg-gray-50 transition-colors group">
                       <span className="text-xs md:text-sm font-bold text-green-700 capitalize truncate">{dateRangeLabel}</span>
                       <input 
                          type={timelineMode === 'MONTH' ? "month" : "date"}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          onChange={handleDateInput}
                       />
                   </div>

                   <button 
                      onClick={() => handleNavigate('NEXT')}
                      className="h-full px-3 hover:bg-gray-100 text-gray-500 border-l border-gray-100 transition-colors"
                   >
                      <ChevronRight size={18}/>
                   </button>
              </div>
          </div>

          <div className="flex gap-2 md:gap-3 items-center md:ml-auto">
                 <div className="relative flex-1 md:flex-none">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
                     <input 
                        className="pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none text-xs md:text-sm transition-all text-gray-900 placeholder:text-gray-400 w-full md:w-48"
                        placeholder="Tìm kiếm..."
                        value={filters.search}
                        onChange={e => setFilters({...filters, search: e.target.value})}
                     />
                 </div>
                 
                 <div className="flex bg-gray-100 p-1 rounded-lg hidden sm:flex">
                      <button onClick={() => setViewType('GRID')} className={`p-2 rounded-md transition-all ${viewType==='GRID'?'bg-white shadow text-blue-600':'text-gray-500'}`}><LayoutGrid size={20}/></button>
                      <button onClick={() => setViewType('LIST')} className={`p-2 rounded-md transition-all ${viewType==='LIST'?'bg-white shadow text-blue-600':'text-gray-500'}`}><ListIcon size={20}/></button>
                 </div>

                 {canAdd && (
                    <button onClick={handleManualCreate} className="bg-green-600 hover:bg-green-700 text-white px-3 md:px-4 py-2.5 rounded-xl flex items-center gap-2 font-bold text-xs md:text-sm shadow-md shadow-green-200 transition-all active:scale-95 whitespace-nowrap">
                        <Plus size={20} /> <span className="hidden sm:inline">Đặt phòng</span>
                    </button>
                 )}
          </div>
       </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col relative">
          {viewType === 'GRID' ? (
             <div className="flex-1 overflow-auto no-scrollbar relative">
                 <div style={{minWidth: timelineMode === 'MONTH' ? '2000px' : timelineMode === 'DAY' ? '1200px' : '100%'}} className="relative h-full min-h-full">
                     <div className="sticky top-0 z-40 bg-gray-50 border-b flex h-14 shadow-sm ring-1 ring-gray-200">
                         <div className="w-24 md:w-40 flex-shrink-0 border-r p-2 md:p-3 font-bold text-gray-700 bg-gray-50 flex items-center sticky left-0 z-50 shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)] text-sm md:text-base">Phòng</div>
                         <div className="flex-1 grid" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                             {timeSlots.map((slot, i) => {
                                 const isCurrent = isCurrentTimeSlot(slot);
                                 return (
                                     <div key={i} className={`border-r px-1 text-center text-xs flex flex-col justify-center font-medium ${isCurrent ? 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200' : (slot.toDateString() === new Date().toDateString() ? 'bg-blue-50 text-blue-700' : 'text-gray-600')}`}>
                                         {timelineMode === 'DAY' ? `${slot.getHours()}:00` : <><span className={slot.getDate() === new Date().getDate() ? 'font-bold text-base' : 'text-sm'}>{slot.getDate()}/{slot.getMonth()+1}</span></>}
                                     </div>
                                 )
                             })}
                         </div>
                     </div>
                     {filteredRooms.map(room => (
                         <div key={room.id} className="flex h-20 border-b hover:bg-gray-50 transition-colors group">
                             <div className="w-24 md:w-40 flex-shrink-0 border-r p-2 md:p-3 flex flex-col justify-center bg-white sticky left-0 z-30 border-r-gray-200 group-hover:bg-gray-50 transition-colors shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                 <div className="font-bold text-base md:text-lg text-gray-800">{room.number}</div>
                                 <div className="text-[10px] md:text-xs text-gray-500 truncate mt-1">{roomTypes.find(t=>t.id===room.typeId)?.name}</div>
                             </div>
                             <div className="flex-1 grid relative" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                                 {timeSlots.map((slot) => renderGridCell(room, slot))}
                                 {filteredBookings.filter(b => b.roomId === room.id).map(b => {
                                        /* ... rendering booking bar ... */
                                        const bStart = new Date(b.checkInDate);
                                        const bEnd = new Date(b.checkOutDate);
                                        const viewStart = timeSlots[0];
                                        // Specific viewEnd calculation for render limits
                                        const viewEnd = timelineMode === 'DAY' 
                                            ? addHours(viewStart, 24) 
                                            : addDays(viewStart, gridColumns);

                                        if (bEnd <= viewStart || bStart >= viewEnd) return null;
                                        const totalDuration = viewEnd.getTime() - viewStart.getTime();
                                        const offset = Math.max(0, bStart.getTime() - viewStart.getTime());
                                        const duration = Math.min(bEnd.getTime(), viewEnd.getTime()) - Math.max(bStart.getTime(), viewStart.getTime());
                                        const left = (offset / totalDuration) * 100;
                                        const width = (duration / totalDuration) * 100;
                                        const bookingTags = tags.filter(t => b.tags?.includes(t.id));
                                        const isGroup = !!b.groupId;

                                        return (
                                            <div key={b.id} className={getBookingStyle(b)} style={{left: `${left}%`, width: `${width}%`, zIndex: 10}} onClick={(e) => { e.stopPropagation(); openModal(b, true, undefined, undefined); }}>
                                                <div className="absolute top-0 right-0 flex gap-0.5 z-20">
                                                    {isGroup && (
                                                        <div className="bg-blue-500 text-white w-3 h-3 flex items-center justify-center text-[7px] border border-white rounded-bl-md font-bold shadow-sm" title="Khách đoàn"><Users size={8} /></div>
                                                    )}
                                                    {b.notes && (
                                                        <div className="bg-orange-500 text-white rounded-full w-3 h-3 flex items-center justify-center text-[7px] border border-white shadow-sm font-bold" title="Có ghi chú">!</div>
                                                    )}
                                                </div>
                                                <div className="font-bold truncate text-[10px] md:text-xs">{b.guestName}</div>
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
                {/* List View */}
                <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-gray-100 text-gray-700 font-bold border-b text-xs uppercase">
                        <tr>
                            <th className="p-4">Mã BK</th>
                            <th className="p-4">Khách hàng</th>
                            <th className="p-4">Tags</th>
                            <th className="p-4">Phòng</th>
                            <th className="p-4">Hạng phòng</th>
                            <th className="p-4">Chi nhánh</th>
                            
                            <th className="p-4 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleSort('createdAt')}>
                                <div className="flex items-center gap-1">Ngày tạo <SortIcon colKey="createdAt"/></div>
                            </th>
                            <th className="p-4 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleSort('checkInDate')}>
                                <div className="flex items-center gap-1">TG Nhận phòng <SortIcon colKey="checkInDate"/></div>
                            </th>
                            <th className="p-4 cursor-pointer hover:bg-gray-200 transition-colors select-none" onClick={() => handleSort('checkOutDate')}>
                                <div className="flex items-center gap-1">TG Trả phòng <SortIcon colKey="checkOutDate"/></div>
                            </th>

                            <th className="p-4 text-right">Tổng bill</th>
                            <th className="p-4 text-right">Đã trả</th>
                            <th className="p-4 text-right">Còn nợ</th>
                            <th className="p-4">Nhân viên</th>
                            <th className="p-4 text-center">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedBookings.map((b) => {
                            const room = rooms.find(r => r.id === b.roomId);
                            const type = roomTypes.find(t => t.id === room?.typeId);
                            const prop = properties.find(p => p.id === b.propertyId);
                            const creator = allUsers.find(u => u.id === b.createdBy);
                            const bookingTags = tags.filter(t => b.tags?.includes(t.id));
                            const debt = b.totalPrice - b.paidAmount;

                            return (
                                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-mono text-blue-600 font-medium text-xs">
                                        {b.id}
                                        {b.groupId && <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800"><Users size={10} className="mr-1"/>Grp</span>}
                                    </td>
                                    <td className="p-4 font-bold text-gray-800">
                                        <div>{b.guestName}</div>
                                        <div className="text-[10px] text-gray-400 font-normal">{b.guestPhone}</div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex gap-1 flex-wrap w-32">
                                            {bookingTags.map(t => <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold" style={{backgroundColor: t.color}}>{t.name}</span>)}
                                        </div>
                                    </td>
                                    <td className="p-4 font-bold text-gray-800">{room?.number}</td>
                                    <td className="p-4 text-gray-600 text-xs">{type?.name}</td>
                                    <td className="p-4 text-gray-500 text-xs">{prop?.name}</td>
                                    <td className="p-4 text-gray-500 text-xs">{new Date(b.createdAt).toLocaleString('vi-VN')}</td>
                                    <td className="p-4 text-gray-500 text-xs">{new Date(b.checkInDate).toLocaleString('vi-VN')}</td>
                                    <td className="p-4 text-gray-500 text-xs">{new Date(b.checkOutDate).toLocaleString('vi-VN')}</td>
                                    
                                    <td className="p-4 text-right font-medium text-gray-900">{formatNumber(b.totalPrice)}</td>
                                    <td className="p-4 text-right font-medium text-blue-600">{formatNumber(b.paidAmount)}</td>
                                    <td className={`p-4 text-right font-bold ${debt > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                        {formatNumber(debt)}
                                    </td>
                                    
                                    <td className="p-4 text-xs text-gray-600">{creator?.fullName || b.createdBy}</td>
                                    <td className="p-4 text-center">
                                        <button onClick={() => openModal(b, true, undefined, undefined)} className="text-blue-600 hover:text-blue-800 font-medium text-xs border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
                                            Chi tiết
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
          )}
      </div>

      {/* CREATE/EDIT MODAL - OPTIMIZED FOR MOBILE */}
      {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
              {/* Overlay */}
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
              
              {/* Modal Content */}
              <div className="relative bg-white w-full h-full md:h-auto md:max-h-[90vh] md:max-w-[1200px] md:rounded-3xl shadow-2xl flex flex-col animate-fade-in md:border md:border-white/20">
                  
                  {/* Modal Header - Sticky */}
                  <div className="flex-shrink-0 p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10 md:rounded-t-3xl">
                      <div>
                          <h3 className="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2">
                              {isEditMode ? 'Chi tiết' : 'Tạo mới'}
                              {bookingMeta.groupId && <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full flex items-center gap-1 whitespace-nowrap"><Users size={12}/> Đoàn</span>}
                          </h3>
                          {bookingMeta.id && <p className="text-xs text-gray-400 font-mono mt-0.5">#{bookingMeta.id}</p>}
                      </div>
                      <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors bg-gray-50 rounded-full p-2 hover:bg-gray-100"><X size={20} /></button>
                  </div>
                  
                  {/* Modal Body - Scrollable */}
                  <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50/30">
                      {/* Guest Info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                          <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                              <label className="block text-xs font-bold uppercase text-gray-500 mb-1.5">Khách hàng</label>
                              <input type="text" disabled={isReadOnly} className="w-full text-gray-900 font-semibold text-sm outline-none bg-transparent placeholder:text-gray-300" placeholder="Nhập tên khách..." value={bookingMeta.guestName} onChange={e => setBookingMeta({...bookingMeta, guestName: e.target.value})} />
                          </div>
                          <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                              <label className="block text-xs font-bold uppercase text-gray-500 mb-1.5">Số điện thoại</label>
                              <input type="text" disabled={isReadOnly} className="w-full text-gray-900 font-semibold text-sm outline-none bg-transparent placeholder:text-gray-300" placeholder="Nhập SĐT..." value={bookingMeta.guestPhone} onChange={e => setBookingMeta({...bookingMeta, guestPhone: e.target.value})} />
                          </div>
                      </div>

                      {/* Rooms List */}
                      <div className="bg-white border border-gray-200 rounded-xl mb-6 shadow-sm overflow-hidden">
                          <div className="bg-gray-50 flex text-xs font-bold text-gray-500 p-3 items-center uppercase tracking-wider hidden md:flex border-b border-gray-200">
                            <div className="w-[15%]">Hạng</div><div className="w-[15%]">Phòng</div><div className="w-[22%]">Nhận</div><div className="w-[22%]">Trả</div><div className="w-[12%] text-center">Thời gian</div><div className="w-[14%] text-right">#</div>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {bookingRows.map((row, idx) => (
                                <div key={row.tempId} className="p-3 md:p-3 hover:bg-gray-50 transition-colors flex flex-col md:flex-row gap-3 relative group">
                                    {/* Mobile Header for Room */}
                                    <div className="flex justify-between items-center md:hidden pb-2 border-b border-dashed border-gray-100 mb-1">
                                        <span className="font-bold text-blue-600">Phòng {idx + 1}</span>
                                        {!isReadOnly && <button onClick={() => handleRemoveRow(idx)} className="text-red-500 text-xs flex items-center gap-1"><Trash2 size={12}/> Xóa</button>}
                                    </div>

                                    <div className="md:w-[15%] flex justify-between md:block items-center">
                                        <span className="md:hidden text-xs text-gray-400 font-medium uppercase">Hạng</span>
                                        <span className="text-sm font-medium text-gray-600 truncate">{rooms.find(r => r.id === row.roomId)?.typeId ? roomTypes.find(t => t.id === rooms.find(r => r.id === row.roomId)?.typeId)?.name : '--'}</span>
                                    </div>
                                    <div className="md:w-[15%]">
                                        <select disabled={isReadOnly} className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" value={row.roomId} onChange={e => updateRow(idx, 'roomId', e.target.value)}><option value="">Chọn phòng</option>{rooms.map(r => (<option key={r.id} value={r.id}>{r.number}</option>))}</select>
                                    </div>
                                    <div className="md:w-[22%] space-y-1 md:space-y-0">
                                        <span className="md:hidden text-xs text-gray-400 font-medium uppercase block">Nhận phòng</span>
                                        <DateTimeControl disabled={isReadOnly} dateValue={row.checkIn} onChange={(val) => updateRow(idx, 'checkIn', val)} />
                                    </div>
                                    <div className="md:w-[22%] space-y-1 md:space-y-0">
                                        <span className="md:hidden text-xs text-gray-400 font-medium uppercase block">Trả phòng</span>
                                        <DateTimeControl disabled={isReadOnly} dateValue={row.checkOut} onChange={(val) => updateRow(idx, 'checkOut', val)} />
                                    </div>
                                    <div className="md:w-[12%] text-center text-sm font-medium text-gray-600 bg-gray-50 rounded md:bg-transparent py-1 md:py-0 mt-1 md:mt-0 flex justify-between md:block px-2 md:px-0">
                                        <span className="md:hidden text-xs text-gray-400">Thời lượng:</span>
                                        {getDurationText(row.checkIn, row.checkOut)}
                                    </div>
                                    <div className="hidden md:block md:w-[14%] text-right">
                                        {!isReadOnly && (
                                            <button onClick={() => handleRemoveRow(idx)} className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-full hover:bg-red-50"><Trash2 size={18} /></button>
                                        )}
                                    </div>
                                </div>
                            ))}
                          </div>
                          {!isReadOnly && (
                            <button onClick={handleAddRow} className="w-full py-3 text-center text-sm font-bold text-green-600 hover:bg-green-50 transition-colors border-t border-gray-100 flex items-center justify-center gap-2">
                                <PlusCircle size={16} /> Thêm phòng vào đoàn
                            </button>
                          )}
                      </div>

                      {/* Payment & Extras */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20 md:pb-0">
                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                              <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2 uppercase tracking-wide border-b pb-2"><Info size={14}/> Thanh toán</h4>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] md:text-xs font-bold uppercase text-green-700 mb-1">Tổng tiền</label>
                                    <MoneyInput 
                                        className="w-full bg-green-50/50 border border-green-100 text-green-800 p-2.5 rounded-lg font-bold text-base outline-none focus:ring-2 focus:ring-green-200"
                                        value={bookingMeta.totalPrice}
                                        onChange={(val) => setBookingMeta(prev => ({ ...prev, totalPrice: val, isManualPrice: true }))}
                                        disabled={isReadOnly}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] md:text-xs font-bold uppercase text-blue-700 mb-1">Đã trả</label>
                                    <MoneyInput 
                                        className="w-full bg-blue-50/50 border border-blue-100 text-blue-800 p-2.5 rounded-lg font-bold text-base outline-none focus:ring-2 focus:ring-blue-200"
                                        value={bookingMeta.paidAmount || 0}
                                        onChange={(val) => setBookingMeta(prev => ({ ...prev, paidAmount: val }))}
                                        disabled={isReadOnly}
                                    />
                                </div>
                              </div>
                              <div className="flex justify-between items-center pt-2 border-t border-dashed">
                                  <span className="text-xs text-gray-500 font-medium">Còn lại cần thu:</span>
                                  <span className={`text-base font-bold ${bookingMeta.totalPrice - (bookingMeta.paidAmount||0) > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                      {formatNumber(bookingMeta.totalPrice - (bookingMeta.paidAmount||0))}
                                  </span>
                              </div>
                          </div>
                          
                          <div className="space-y-4">
                              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                  <label className="block text-xs font-bold uppercase text-gray-500 mb-2">Ghi chú</label>
                                  <textarea disabled={isReadOnly} className="w-full bg-gray-50 border-0 rounded-lg p-3 text-sm h-20 outline-none focus:ring-2 focus:ring-gray-200 resize-none" placeholder="Yêu cầu đặc biệt..." value={bookingMeta.notes} onChange={e => setBookingMeta({...bookingMeta, notes: e.target.value})}></textarea>
                              </div>
                              
                              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                  <label className="block text-xs font-bold uppercase text-gray-500 mb-2">Thẻ (Tags)</label>
                                  <div className="flex flex-wrap gap-2">
                                      {tags.map(t => {
                                          const isSelected = bookingMeta.tags.includes(t.id);
                                          return (
                                              <button 
                                                key={t.id}
                                                onClick={() => !isReadOnly && toggleTag(t.id)}
                                                disabled={isReadOnly}
                                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${isSelected ? 'text-white shadow-sm' : 'text-gray-500 bg-white border-gray-200'} ${isReadOnly ? 'opacity-70 cursor-not-allowed' : ''}`}
                                                style={isSelected ? {backgroundColor: t.color, borderColor: t.color} : {}}
                                              >
                                                  {t.name}
                                              </button>
                                          )
                                      })}
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>

                  {/* Modal Footer - Sticky */}
                  <div className="flex-shrink-0 p-4 border-t border-gray-100 bg-white z-10 md:rounded-b-3xl">
                      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                          <div className="flex items-center gap-3 w-full md:w-auto">
                             {isEditMode && canEdit && (
                                <>
                                 <div className="relative flex-1 md:flex-none">
                                     <select 
                                        className="w-full md:w-40 appearance-none bg-gray-100 border border-gray-200 text-gray-700 font-bold py-3 pl-4 pr-8 rounded-xl outline-none focus:ring-2 focus:ring-blue-100" 
                                        value={bookingMeta.status} 
                                        onChange={e => setBookingMeta({...bookingMeta, status: e.target.value as any})}
                                     >
                                         <option value={BookingStatus.CONFIRMED}>CONFIRMED</option>
                                         <option value={BookingStatus.CHECKED_IN}>CHECKED_IN</option>
                                         <option value={BookingStatus.CHECKED_OUT}>CHECKED_OUT</option>
                                         <option value={BookingStatus.CANCELLED}>CANCELLED</option>
                                     </select>
                                     <ArrowUpDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                 </div>
                                 
                                 {canDelete && (
                                     !showDeleteConfirm ? (
                                        <button 
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleDeleteClick();
                                            }}
                                            className="px-4 py-3 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors font-bold border border-red-100 flex-shrink-0"
                                        >
                                            <Trash2 size={20} />
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-xl border border-red-100 animate-fade-in">
                                            <button 
                                                onClick={handleConfirmDelete} 
                                                className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg"
                                            >
                                                Xóa thật
                                            </button>
                                            <button 
                                                onClick={() => setShowDeleteConfirm(false)} 
                                                className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 text-xs font-bold rounded-lg"
                                            >
                                                Hủy
                                            </button>
                                        </div>
                                    )
                                 )}
                                </>
                             )}
                          </div>
                          
                          <div className="flex gap-3 w-full md:w-auto">
                              <button onClick={() => setShowModal(false)} className="flex-1 md:flex-none px-6 py-3 text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl font-bold transition-colors">Đóng</button>
                              {!isReadOnly && (
                                <button onClick={handleSaveBooking} className="flex-[2] md:flex-none px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-200 transition-transform active:scale-95 flex items-center justify-center gap-2">
                                    <Check size={20} /> Lưu
                                </button>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* NEW: TICKET MODAL */}
      {showTicketModal && receiptData && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
               <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full animate-fade-in relative">
                   <button onClick={() => setShowTicketModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1"><X size={20}/></button>
                   
                   <div id="print-area">
                        <div className="text-center mb-6">
                            <h2 className="text-xl font-bold uppercase text-gray-900">Xác Nhận Đặt Phòng</h2>
                            <div className="w-20 h-1 bg-gray-200 mx-auto mt-2"></div>
                        </div>

                        <div className="text-sm text-gray-800 space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                                <span className="font-bold text-gray-500">Khách hàng:</span>
                                <span className="col-span-2 font-semibold">{receiptData.guestName}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <span className="font-bold text-gray-500">Số điện thoại:</span>
                                <span className="col-span-2">{receiptData.guestPhone || '--'}</span>
                            </div>

                            <div className="border-t border-dashed border-gray-300 my-4 py-3 space-y-4">
                                {receiptData.rooms.map((room: any, idx: number) => (
                                    <div key={idx} className="pb-3 border-b border-dashed border-gray-200 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-blue-600 text-base">{room.roomNumber}</span>
                                            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{room.typeName}</span>
                                        </div>
                                        <div className="text-xs text-gray-500 mb-2 italic">Chi nhánh: {room.branchName}</div>
                                        
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                            <span className="text-gray-500">Nhận phòng:</span>
                                            <span className="font-medium">{formatTicketDate(room.checkIn)}</span>
                                            <span className="text-gray-500">Trả phòng:</span>
                                            <span className="font-medium">{formatTicketDate(room.checkOut)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-gray-50 p-3 rounded-lg space-y-2 border border-gray-100">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-gray-600">Tổng bill:</span>
                                    <span className="font-bold text-lg text-gray-900">{formatNumber(receiptData.total)} đ</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-gray-600">Đã thanh toán:</span>
                                    <span className="font-bold text-blue-600">{formatNumber(receiptData.paid)} đ</span>
                                </div>
                                <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                                    <span className="font-bold text-gray-600">Còn lại:</span>
                                    <span className={`font-bold ${receiptData.total - receiptData.paid > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                        {formatNumber(receiptData.total - receiptData.paid)} đ
                                    </span>
                                </div>
                            </div>

                            {(receiptData.tags?.length > 0 || receiptData.notes) && (
                                <div className="pt-2 space-y-2">
                                    {receiptData.tags.length > 0 && (
                                        <div className="flex gap-1 flex-wrap">
                                            {receiptData.tags.map((t: Tag) => (
                                                <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold" style={{backgroundColor: t.color}}>
                                                    {t.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {receiptData.notes && (
                                        <div className="text-xs italic text-gray-500 bg-yellow-50 p-2 rounded border border-yellow-100">
                                            Ghi chú: {receiptData.notes}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <p className="text-xs text-center italic text-gray-400 mt-6">Cảm ơn quý khách đã sử dụng dịch vụ!</p>
                   </div>
                   
                   <div className="mt-6 flex gap-3">
                       <button onClick={() => setShowTicketModal(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors">Đóng</button>
                       <button className="flex-1 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200">
                           <Printer size={18}/> In phiếu
                       </button>
                   </div>
               </div>
          </div>
      )}
    </div>
  );
};

export default RoomMap;
