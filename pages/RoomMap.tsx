import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Room, RoomType, Booking, BookingStatus, RoomStatus, Customer, Property, Tag, User, PERMISSIONS, TransactionCategory, ExtraFee, UserRole, HistoryLog, RoomPolicyRule } from '../types';
import { DataService } from '../services/dataService';
import { LayoutGrid, List as ListIcon, Plus, X, Search, ChevronRight, ChevronLeft, Trash2, Calendar, Clock, Check, Info, PlusCircle, AlertTriangle, Tag as TagIcon, MapPin, Users, Lock, ArrowUpDown, ArrowUp, ArrowDown, Printer, Filter, MoreHorizontal, Receipt, Wallet, ArrowUpCircle, ArrowDownCircle, CheckCircle, Wrench, User as UserIcon, Edit2, Building2, Loader2 } from 'lucide-react';

// Declare html2canvas
declare const html2canvas: any;

interface RoomMapProps {
  rooms: Room[];
  roomTypes: RoomType[];
  roomPolicies: RoomPolicyRule[];
  bookings: Booking[];
  history: HistoryLog[];
  customers: Customer[];
  tags: Tag[];
  properties: Property[];
  onRefresh: () => void;
  currentProperty: Property;
  currentUser: User; 
}

type ViewMode = 'DAY' | 'WEEK' | 'MONTH';

interface RoomPolicyWindow {
    policyId: string;
    mode: RoomPolicyRule['mode'];
    reason?: string;
    startMs: number;
    endMs: number;
}

// --- Helpers ---
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const addDays = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
const addHours = (d: Date, hours: number) => { const x = new Date(d); x.setTime(x.getTime() + hours * 3600000); return x; };
const addMonths = (d: Date, months: number) => { const x = new Date(d); x.setMonth(x.getMonth() + months); return x; };

const parsePolicyDateToDayMs = (dateText?: string) => {
    if (!dateText) return null;
    const parsed = new Date(`${dateText}T00:00:00`);
    if (isNaN(parsed.getTime())) return null;
    return startOfDay(parsed).getTime();
};

const isPolicyApplicableOnDate = (policy: RoomPolicyRule, date: Date) => {
    if (!policy.isActive) return false;

    const dayMs = startOfDay(date).getTime();
    const startDateMs = parsePolicyDateToDayMs(policy.startDate);
    const endDateMs = parsePolicyDateToDayMs(policy.endDate);

    if (startDateMs !== null && dayMs < startDateMs) return false;
    if (endDateMs !== null && dayMs > endDateMs) return false;

    if (policy.recurrence === 'WEEKLY') {
        const weekdays = policy.weekdays || [];
        if (weekdays.length === 0) return false;
        return weekdays.includes(new Date(dayMs).getDay());
    }

    return true;
};

const roomMatchesPolicy = (policy: RoomPolicyRule, room: Room) => {
    const propertyIds = policy.propertyIds || [];
    const roomTypeIds = policy.roomTypeIds || [];
    const roomIds = policy.roomIds || [];

    const matchProperty = propertyIds.length === 0 || propertyIds.includes(room.propertyId);
    const matchType = roomTypeIds.length === 0 || roomTypeIds.includes(room.typeId);
    const matchRoom = roomIds.length === 0 || roomIds.includes(room.id);
    return matchProperty && matchType && matchRoom;
};

const getPolicyWindowsForRange = (policy: RoomPolicyRule, rangeStartMs: number, rangeEndMs: number): RoomPolicyWindow[] => {
    if (!policy.isActive) return [];

    const windows: RoomPolicyWindow[] = [];
    const checkInHour = Number.isFinite(policy.checkInHour) ? Number(policy.checkInHour) : 14;
    const checkOutHour = Number.isFinite(policy.checkOutHour) ? Number(policy.checkOutHour) : 12;

    let cursor = startOfDay(addDays(new Date(rangeStartMs), -2));
    const cursorEnd = startOfDay(addDays(new Date(rangeEndMs), 2)).getTime();
    let guard = 0;

    while (cursor.getTime() <= cursorEnd && guard < 2000) {
        if (isPolicyApplicableOnDate(policy, cursor)) {
            const windowStart = new Date(cursor);
            windowStart.setHours(checkInHour, 0, 0, 0);
            const windowEnd = addDays(new Date(cursor), 1);
            windowEnd.setHours(checkOutHour, 0, 0, 0);

            const startMs = windowStart.getTime();
            const endMs = windowEnd.getTime();
            if (endMs > rangeStartMs && startMs < rangeEndMs) {
                windows.push({
                    policyId: policy.id,
                    mode: policy.mode,
                    reason: policy.reason,
                    startMs,
                    endMs,
                });
            }
        }

        cursor = addDays(cursor, 1);
        guard += 1;
    }

    return windows;
};

// Format helper
const formatNumber = (num: number) => {
    return new Intl.NumberFormat('vi-VN').format(num);
};
const parseNumber = (str: string) => {
    return Number(str.replace(/\./g, ''));
};

// --- Standardized Date Time Format ---
const formatStandardDateTime = (isoStr: string | Date | undefined) => {
    if (!isoStr) return '';
    const d = typeof isoStr === 'string' ? new Date(isoStr) : isoStr;
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatAuditDateTime = (isoStr?: string) => {
    if (!isoStr) return '--';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const toDateTimeLocalValue = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
};

const parseLocalDateTimeToIso = (value: string) => {
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
};

const setTimeOnDate = (date: Date, hours: number, minutes: number = 0) => {
    const next = new Date(date);
    next.setHours(hours, minutes, 0, 0);
    return next;
};

const getWeekdayShortVi = (date: Date) => {
    const day = date.getDay();
    if (day === 0) return 'CN';
    return `T${day + 1}`;
};

// --- Custom Components ---
const MoneyInput = ({ value, onChange, className, disabled, placeholder }: { value: number, onChange: (val: number) => void, className?: string, disabled?: boolean, placeholder?: string }) => {
    const [displayVal, setDisplayVal] = useState('');

    useEffect(() => {
        setDisplayVal(value === 0 ? '' : formatNumber(value));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
            placeholder={placeholder}
        />
    )
}

const DateTimeControl = ({ 
    dateValue, 
    onChange,
    disabled
}: { 
    dateValue: string, 
    onChange: (newIso: string) => void,
    disabled?: boolean
}) => {
    const parseDisplayToIso = (str: string) => {
        const parts = str.trim().split(/[\s/:]+/);
        if (parts.length < 5) return null;
        let d = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10) - 1;
        let y = parseInt(parts[2], 10);
        let h = parseInt(parts[3], 10);
        let min = parseInt(parts[4], 10);
        if (y < 100) y += 2000; 
        const date = new Date(y, m, d, h, min);
        if (isNaN(date.getTime())) return null;
        const offset = date.getTimezoneOffset() * 60000;
        const localIso = new Date(date.getTime() - offset).toISOString().slice(0, 16);
        return localIso;
    };

    const [textVal, setTextVal] = useState(formatStandardDateTime(dateValue));
    const pickerRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setTextVal(formatStandardDateTime(dateValue));
    }, [dateValue]);

    const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTextVal(e.target.value);
    };

    const handleBlur = () => {
        const iso = parseDisplayToIso(textVal);
        if (iso) {
            onChange(iso + ':00.000'); 
        } else {
            setTextVal(formatStandardDateTime(dateValue));
        }
    };

    const handleIconClick = () => {
        if (!disabled && pickerRef.current) {
            try { pickerRef.current.showPicker(); } 
            catch (e) { pickerRef.current.focus(); }
        }
    };

    const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.value) {
            onChange(e.target.value + ':00.000');
        }
    };

    return (
        <div className="relative w-full group">
            <input 
                type="text"
                className={`w-full bg-gray-50 border border-gray-200 text-gray-900 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none font-semibold ${disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                value={textVal}
                onChange={handleTextChange}
                onBlur={handleBlur}
                disabled={disabled}
                placeholder="dd/mm/yyyy hh:mm"
            />
            <div 
                className={`absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 p-1 rounded-md transition-colors ${!disabled ? 'hover:text-blue-600 hover:bg-blue-50 cursor-pointer' : 'cursor-not-allowed'}`}
                onClick={handleIconClick}
            >
                <Clock size={14} />
            </div>
            <input 
                ref={pickerRef}
                type="datetime-local"
                className="absolute top-full left-0 w-0 h-0 opacity-0 pointer-events-none"
                value={dateValue ? dateValue.substring(0, 16) : ''}
                onChange={handlePickerChange}
                tabIndex={-1}
            />
        </div>
    );
};


// --- Main Component ---
const RoomMap: React.FC<RoomMapProps> = ({ rooms, roomTypes, roomPolicies, bookings, history, customers, tags, properties, onRefresh, currentProperty, currentUser }) => {
  const [viewType, setViewType] = useState<'GRID' | 'LIST'>('GRID');
  const [timelineMode, setTimelineMode] = useState<ViewMode>('WEEK');
  const [startDate, setStartDate] = useState(startOfDay(new Date())); 
  const [now, setNow] = useState(new Date());

  const [sortConfig, setSortConfig] = useState<{key: keyof Booking, direction: 'asc' | 'desc'} | null>(null);
  const [financeCategories, setFinanceCategories] = useState<TransactionCategory[]>([]);

  useEffect(() => {
      const timer = setInterval(() => setNow(new Date()), 60000);
      return () => clearInterval(timer);
  }, []);

  const refreshCategories = () => {
      setFinanceCategories(DataService.getTransactionCategories());
  }

  const canAdd = currentUser.permissions?.includes(PERMISSIONS.CAN_ADD_BOOKING);
  const canEdit = currentUser.permissions?.includes(PERMISSIONS.CAN_EDIT_BOOKING);
  const canDelete = currentUser.permissions?.includes(PERMISSIONS.CAN_DELETE_BOOKING);
  const canManageRooms = currentUser.permissions?.includes(PERMISSIONS.MANAGE_ROOMS);
  const allUsers = DataService.getUsers();
  const usernameByUserId = useMemo(() => {
      const map = new Map<string, string>();
      allUsers.forEach(user => {
          map.set(user.id, user.username);
      });
      return map;
  }, [allUsers]);

  const [filters, setFilters] = useState({
      typeId: 'ALL', roomId: 'ALL', status: 'STAYING', search: ''
  });

  const [showModal, setShowModal] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false); 
  const [isEditMode, setIsEditMode] = useState(false);
  const [showBookingHistory, setShowBookingHistory] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); 
  const [isSubmitting, setIsSubmitting] = useState(false); 
  
  // DRAG & DROP CHO ĐƠN ĐÃ CÓ
  const [movingBookingId, setMovingBookingId] = useState<string | null>(null);
  const [isDraggingBooking, setIsDraggingBooking] = useState(false); 
  const [dragBookingAnchorSlots, setDragBookingAnchorSlots] = useState(0);
  const [hoveredDrop, setHoveredDrop] = useState<{roomId: string, time: Date} | null>(null);

  const [moveConfirmModal, setMoveConfirmModal] = useState<{
      isOpen: boolean, booking?: Booking, newRoom?: Room, newCheckIn?: Date, newCheckOut?: Date
  } | null>(null);

  const [statusModal, setStatusModal] = useState<{
      isOpen: boolean; room: Room | null; targetStatus: RoomStatus;
  }>({ isOpen: false, room: null, targetStatus: RoomStatus.VACANT_CLEAN });

  const [receiptData, setReceiptData] = useState<any | null>(null);
  const [bookingMeta, setBookingMeta] = useState<{
      id?: string; groupId?: string; guestName: string; guestPhone: string;
      totalPrice: number; paidAmount: number; notes: string; status: BookingStatus;
      isManualPrice: boolean; tags: string[]; extraFees: ExtraFee[]; 
  }>({
      guestName: '', guestPhone: '', totalPrice: 0, paidAmount: 0, notes: '', status: BookingStatus.CONFIRMED, isManualPrice: false, tags: [], extraFees: []
  });

  const [pendingFee, setPendingFee] = useState<{ categoryId: string, amount: number }>({ categoryId: '', amount: 0 });

  interface BookingRow {
      tempId: string; bookingId?: string; roomId: string; tempPropId?: string; 
      tempTypeId?: string; checkIn: string; checkOut: string; price: number;
  }
  const [bookingRows, setBookingRows] = useState<BookingRow[]>([]);
  const [originalBookingIds, setOriginalBookingIds] = useState<string[]>([]);
  const [showQuickFinder, setShowQuickFinder] = useState(false);
  const [quickPropertyFilter, setQuickPropertyFilter] = useState<string>(
      currentProperty.id === 'ALL' ? 'ALL' : currentProperty.id
  );
  const [quickStartInput, setQuickStartInput] = useState(() => {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      return toDateTimeLocalValue(start);
  });
  const [quickEndInput, setQuickEndInput] = useState(() => {
      const end = new Date();
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() + 2);
      return toDateTimeLocalValue(end);
  });
  const [holdTargetRoomId, setHoldTargetRoomId] = useState<string | null>(null);
  const [holdMinutes, setHoldMinutes] = useState(10);
  const [holdGuestName, setHoldGuestName] = useState('');
  const [holdGuestPhone, setHoldGuestPhone] = useState('');
  const [isSavingHold, setIsSavingHold] = useState(false);

  // Drag State (Kéo lưới tạo đơn)
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
  
  const isCurrentTimeSlot = (slot: Date) => {
      if (timelineMode === 'DAY') {
          return slot.getDate() === now.getDate() && slot.getMonth() === now.getMonth() &&
                 slot.getFullYear() === now.getFullYear() && slot.getHours() === now.getHours();
      } else {
          return slot.getDate() === now.getDate() && slot.getMonth() === now.getMonth() &&
                 slot.getFullYear() === now.getFullYear();
      }
  };

  useEffect(() => {
     if (!bookingMeta.isManualPrice) {
         const sum = bookingRows.reduce((sum, row) => sum + (row.price || 0), 0);
         setBookingMeta(prev => ({ ...prev, totalPrice: sum }));
     }
  }, [bookingRows, bookingMeta.isManualPrice]);

  const sortedRooms = useMemo(() => {
    const filtered = rooms.filter(r => {
        if (filters.typeId !== 'ALL' && r.typeId !== filters.typeId) return false;
        if (filters.roomId !== 'ALL' && r.id !== filters.roomId) return false;
        return true;
    });

    return filtered.sort((a, b) => {
        const propA = properties.find(p => p.id === a.propertyId);
        const propB = properties.find(p => p.id === b.propertyId);
        const pOrderA = propA?.sortOrder ?? 9999;
        const pOrderB = propB?.sortOrder ?? 9999;
        if (pOrderA !== pOrderB) return pOrderA - pOrderB;
        return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
    });
  }, [rooms, filters, properties, roomTypes]);

  const propertyById = useMemo(() => {
      const map = new Map<string, Property>();
      properties.forEach((property) => map.set(property.id, property));
      return map;
  }, [properties]);

  const roomTypeNameById = useMemo(() => {
      const map = new Map<string, string>();
      roomTypes.forEach((type) => map.set(type.id, type.name));
      return map;
  }, [roomTypes]);

  const isExpiredHoldBooking = (booking: Booking) => {
      if (!booking.isHold || !booking.holdUntil) return false;
      const holdUntilMs = new Date(booking.holdUntil).getTime();
      if (!Number.isFinite(holdUntilMs)) return false;
      return holdUntilMs <= Date.now();
  };

  const activeBookingsForQuick = useMemo(() => {
      return bookings.filter((booking) => {
          if (booking.status === BookingStatus.DELETED || booking.status === BookingStatus.CANCELLED) return false;
          if (isExpiredHoldBooking(booking)) return false;
          return true;
      });
  }, [bookings]);

  const quickBookingsByRoom = useMemo(() => {
      const map = new Map<string, Booking[]>();
      activeBookingsForQuick.forEach((booking) => {
          if (!map.has(booking.roomId)) map.set(booking.roomId, []);
          map.get(booking.roomId)!.push(booking);
      });
      map.forEach((list) => {
          list.sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime());
      });
      return map;
  }, [activeBookingsForQuick]);

  const roomsSortedForQuick = useMemo(() => {
      return [...rooms].sort((a, b) => {
          const pOrderA = propertyById.get(a.propertyId)?.sortOrder ?? 9999;
          const pOrderB = propertyById.get(b.propertyId)?.sortOrder ?? 9999;
          if (pOrderA !== pOrderB) return pOrderA - pOrderB;
          const roomOrderA = a.sortOrder ?? 9999;
          const roomOrderB = b.sortOrder ?? 9999;
          if (roomOrderA !== roomOrderB) return roomOrderA - roomOrderB;
          return a.number.localeCompare(b.number, 'vi');
      });
  }, [rooms, propertyById]);

  useEffect(() => {
      if (!showQuickFinder) return;
      setQuickPropertyFilter(currentProperty.id === 'ALL' ? 'ALL' : currentProperty.id);
  }, [showQuickFinder, currentProperty.id]);

  const quickPropertyOptions = useMemo(() => {
      return [...properties].sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
  }, [properties]);

  const quickRange = useMemo(() => {
      const startIso = parseLocalDateTimeToIso(quickStartInput);
      const endIso = parseLocalDateTimeToIso(quickEndInput);
      if (!startIso || !endIso) {
          return { valid: false, message: 'Vui lòng chọn đầy đủ thời gian Từ/Đến.' };
      }
      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
          return { valid: false, message: 'Định dạng thời gian không hợp lệ.' };
      }
      if (startMs >= endMs) {
          return { valid: false, message: 'Thời gian kết thúc phải lớn hơn thời gian bắt đầu.' };
      }
      return { valid: true, startIso, endIso, startMs, endMs };
  }, [quickStartInput, quickEndInput]);

  const quickAvailabilityByProperty = useMemo(() => {
      if (!quickRange.valid) return [] as Array<{ propertyId: string; propertyName: string; rooms: Array<{ room: Room; roomTypeName: string; previousBooking?: Booking; nextBooking?: Booking }> }>;

      const grouped = new Map<string, { propertyId: string; propertyName: string; rooms: Array<{ room: Room; roomTypeName: string; previousBooking?: Booking; nextBooking?: Booking }> }>();
      const { startIso, endIso, startMs, endMs } = quickRange as {
          valid: true;
          startIso: string;
          endIso: string;
          startMs: number;
          endMs: number;
      };

      roomsSortedForQuick.forEach((room) => {
          if (quickPropertyFilter !== 'ALL' && room.propertyId !== quickPropertyFilter) return;
          const availability = DataService.validateRoomAvailability(room.id, startIso, endIso);
          if (!availability.valid) return;

          const roomBookings = quickBookingsByRoom.get(room.id) || [];
          let previousBooking: Booking | undefined;
          let nextBooking: Booking | undefined;

          roomBookings.forEach((booking) => {
              const bookingStartMs = new Date(booking.checkInDate).getTime();
              const bookingEndMs = new Date(booking.checkOutDate).getTime();

              if (bookingEndMs <= startMs) {
                  if (!previousBooking || bookingEndMs > new Date(previousBooking.checkOutDate).getTime()) {
                      previousBooking = booking;
                  }
              }

              if (bookingStartMs >= endMs) {
                  if (!nextBooking || bookingStartMs < new Date(nextBooking.checkInDate).getTime()) {
                      nextBooking = booking;
                  }
              }
          });

          const property = propertyById.get(room.propertyId);
          const group = grouped.get(room.propertyId) || {
              propertyId: room.propertyId,
              propertyName: property?.name || room.propertyId,
              rooms: [],
          };

          group.rooms.push({
              room,
              roomTypeName: roomTypeNameById.get(room.typeId) || room.typeId,
              previousBooking,
              nextBooking,
          });
          grouped.set(room.propertyId, group);
      });

      return Array.from(grouped.values());
  }, [quickRange, roomsSortedForQuick, quickBookingsByRoom, propertyById, roomTypeNameById, quickPropertyFilter]);

  const { viewStart, viewEnd } = useMemo(() => {
      let vStart = new Date(startDate);
      vStart.setHours(0,0,0,0);
      let vEnd = new Date(vStart);
      
      if(timelineMode === 'DAY') vEnd = addDays(vStart, 1);
      else if(timelineMode === 'WEEK') vEnd = addDays(vStart, 7);
      else { 
          vStart.setDate(1); 
          vEnd = new Date(vStart.getFullYear(), vStart.getMonth() + 1, 0); 
          vEnd.setHours(23, 59, 59, 999);
      }
      return { viewStart: vStart, viewEnd: vEnd };
  }, [startDate, timelineMode]);

  const filteredBookings = useMemo(() => {
    let res = bookings.filter(b => b.status !== BookingStatus.DELETED && b.status !== BookingStatus.CANCELLED); 
    if (filters.search) {
        const lower = filters.search.toLowerCase();
        res = res.filter(b => (b.guestName || '').toLowerCase().includes(lower) || (b.guestPhone || '').toLowerCase().includes(lower) || (b.id || '').toLowerCase().includes(lower));
    }
    res = res.filter(b => {
        const bStart = new Date(b.checkInDate).getTime();
        const bEnd = new Date(b.checkOutDate).getTime();
        const fStart = viewStart.getTime();
        const fEnd = viewEnd.getTime();
        if (filters.status === 'ARRIVING') return bStart >= fStart && bStart < fEnd;
        else if (filters.status === 'DEPARTING') return bEnd >= fStart && bEnd < fEnd;
        else return bStart < fEnd && bEnd > fStart;
    });
    return res;
  }, [bookings, filters, viewStart, viewEnd]);

  const filteredBookingsByRoom = useMemo(() => {
      const map = new Map<string, Booking[]>();
      filteredBookings.forEach((booking) => {
          if (!map.has(booking.roomId)) map.set(booking.roomId, []);
          map.get(booking.roomId)!.push(booking);
      });
      return map;
  }, [filteredBookings]);

  const dateRangeLabel = useMemo(() => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      if (timelineMode === 'DAY') return fmt(viewStart);
      else if (timelineMode === 'MONTH') return `Tháng ${viewStart.getMonth() + 1}/${viewStart.getFullYear()}`;
      else {
          const endDisplay = new Date(viewEnd);
          endDisplay.setDate(endDisplay.getDate() - 1); 
          return `${fmt(viewStart)} - ${fmt(endDisplay)}`;
      }
  }, [viewStart, viewEnd, timelineMode]);

  const dateRangeLabelCompact = useMemo(() => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
      if (timelineMode === 'DAY') return fmt(viewStart);
      if (timelineMode === 'MONTH') return `T${viewStart.getMonth() + 1}/${viewStart.getFullYear()}`;
      const endDisplay = new Date(viewEnd);
      endDisplay.setDate(endDisplay.getDate() - 1);
      return `${fmt(viewStart)} - ${fmt(endDisplay)}`;
  }, [viewStart, viewEnd, timelineMode]);

  const sortedBookings = useMemo(() => {
      if (!sortConfig) return filteredBookings;
      return [...filteredBookings].sort((a, b) => {
          let valA = a[sortConfig.key] || '';
          let valB = b[sortConfig.key] || '';
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  }, [filteredBookings, sortConfig]);

  const handleSort = (key: keyof Booking) => {
      let direction: 'asc' | 'desc' = 'desc'; 
      if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
      setSortConfig({ key, direction });
  };

  const SortIcon = ({ colKey }: { colKey: keyof Booking }) => {
      if (sortConfig?.key !== colKey) return <ArrowUpDown size={14} className="ml-1 opacity-30" />;
      return sortConfig.direction === 'asc' ? <ArrowUp size={14} className="ml-1 text-blue-600" /> : <ArrowDown size={14} className="ml-1 text-blue-600" />;
  };

  const handleStatusIconClick = (room: Room) => {
      if (!canManageRooms || room.status === RoomStatus.OCCUPIED) return; 
      const targetStatus = room.status === RoomStatus.VACANT_CLEAN ? RoomStatus.VACANT_DIRTY : RoomStatus.VACANT_CLEAN;
      setStatusModal({ isOpen: true, room: room, targetStatus: targetStatus });
  };

  const confirmStatusChange = () => {
      if (statusModal.room) {
          DataService.updateRoomStatus(statusModal.room.id, statusModal.targetStatus);
          setStatusModal({ isOpen: false, room: null, targetStatus: RoomStatus.VACANT_CLEAN });
      }
  };

  const gridColumns = useMemo(() => {
      if (timelineMode === 'DAY') return 24;
      if (timelineMode === 'WEEK') return 7;
      return new Date(viewStart.getFullYear(), viewStart.getMonth() + 1, 0).getDate();
  }, [timelineMode, viewStart]);

  const timeSlots = useMemo(() => {
      const slots = [];
      for(let i=0; i<gridColumns; i++) {
          if (timelineMode === 'DAY') slots.push(addHours(viewStart, i));
          else slots.push(addDays(viewStart, i));
      }
      return slots;
  }, [gridColumns, timelineMode, viewStart]);

  const viewportStartMs = useMemo(() => {
      if (timeSlots.length === 0) return viewStart.getTime();
      return timeSlots[0].getTime();
  }, [timeSlots, viewStart]);

  const viewportEndMs = useMemo(() => {
      if (timeSlots.length === 0) return viewEnd.getTime();
      return timelineMode === 'DAY'
          ? addHours(timeSlots[0], 24).getTime()
          : addDays(timeSlots[0], gridColumns).getTime();
  }, [timeSlots, timelineMode, gridColumns, viewEnd]);

  const roomPolicyWindowsByRoom = useMemo(() => {
      const map = new Map<string, RoomPolicyWindow[]>();
      if (roomPolicies.length === 0 || sortedRooms.length === 0) return map;

      sortedRooms.forEach((room) => {
          const windows: RoomPolicyWindow[] = [];
          roomPolicies.forEach((policy) => {
              if (!roomMatchesPolicy(policy, room)) return;
              windows.push(...getPolicyWindowsForRange(policy, viewportStartMs, viewportEndMs));
          });

          if (windows.length > 0) {
              windows.sort((a, b) => a.startMs - b.startMs);
              map.set(room.id, windows);
          }
      });

      return map;
  }, [roomPolicies, sortedRooms, viewportStartMs, viewportEndMs]);

  const getPolicyWindowAtPoint = (roomId: string, timeMs: number) => {
      const windows = roomPolicyWindowsByRoom.get(roomId) || [];
      return windows.find((window) => timeMs >= window.startMs && timeMs < window.endMs) || null;
  };

  const handleNavigate = (direction: 'PREV' | 'NEXT') => {
      const factor = direction === 'NEXT' ? 1 : -1;
      if (timelineMode === 'DAY') setStartDate(addDays(startDate, factor));
      else if (timelineMode === 'WEEK') setStartDate(addDays(startDate, factor * 7));
      else setStartDate(addMonths(startDate, factor));
  };

  const handleDateInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.value) return;
      const d = new Date(e.target.value);
      if (!isNaN(d.getTime())) setStartDate(d);
  };

  const openModal = (booking: Partial<Booking> | null, editMode: boolean, defaultRoomId?: string, defaultDates?: {start: string, end: string}) => {
      setIsEditMode(editMode); setShowDeleteConfirm(false); refreshCategories(); 
      setShowBookingHistory(false);
      setPendingFee({ categoryId: '', amount: 0 }); setIsSubmitting(false); 
      
      if (editMode && booking) {
          let groupBookings: Booking[] = [booking as Booking];
          if (booking.groupId) {
              groupBookings = bookings.filter(b => b.groupId === booking.groupId && b.status !== BookingStatus.DELETED);
              if (groupBookings.length === 0) groupBookings = [booking as Booking];
          }

          const mainBooking = groupBookings[0];
          const totalGroupPriceStored = groupBookings.reduce((sum, b) => sum + b.totalPrice, 0);
          const totalGroupPaid = groupBookings.reduce((sum, b) => sum + b.paidAmount, 0);
          const loadedFees = mainBooking.extraFees || [];
          const feeNet = loadedFees.reduce((sum, f) => f.type === 'REVENUE' ? sum + f.amount : sum - f.amount, 0);
          const roomTotal = totalGroupPriceStored - feeNet;

          setBookingMeta({
              id: mainBooking.id, groupId: mainBooking.groupId, guestName: mainBooking.guestName || '', guestPhone: mainBooking.guestPhone || '',
              totalPrice: roomTotal, paidAmount: totalGroupPaid, notes: mainBooking.notes || '', status: mainBooking.status || BookingStatus.CONFIRMED,
              isManualPrice: true, tags: mainBooking.tags || [], extraFees: loadedFees
          });

          const rows: BookingRow[] = groupBookings.map(b => {
              const currentRoom = rooms.find(r => r.id === b.roomId);
              return {
                tempId: `existing-${b.id}`, bookingId: b.id, roomId: b.roomId,
                tempPropId: currentRoom?.propertyId || currentProperty.id, tempTypeId: currentRoom?.typeId || '',
                checkIn: b.checkInDate, checkOut: b.checkOutDate, price: b.totalPrice 
              }
          });
          setBookingRows(rows); setOriginalBookingIds(groupBookings.map(b => b.id));
      } else {
          setBookingMeta({ guestName: '', guestPhone: '', totalPrice: 0, paidAmount: 0, notes: '', status: BookingStatus.CONFIRMED, isManualPrice: false, tags: [], extraFees: [] });
          setOriginalBookingIds([]);
          
          let checkIn = defaultDates ? defaultDates.start : '';
          let checkOut = defaultDates ? defaultDates.end : '';
          if (!checkIn) {
              const now = new Date(); now.setHours(14,0,0,0);
              const off = now.getTimezoneOffset() * 60000;
              checkIn = (new Date(now.getTime() - off)).toISOString().slice(0, -1);
          }
          if (!checkOut) {
              const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(12,0,0,0);
              const off = tomorrow.getTimezoneOffset() * 60000;
              checkOut = (new Date(tomorrow.getTime() - off)).toISOString().slice(0, -1);
          }
          
          const initPropId = defaultRoomId ? rooms.find(r=>r.id===defaultRoomId)?.propertyId : currentProperty.id;
          const initTypeId = defaultRoomId ? rooms.find(r=>r.id===defaultRoomId)?.typeId : '';

          setBookingRows([{ tempId: 'init', roomId: defaultRoomId || '', tempPropId: initPropId, tempTypeId: initTypeId, checkIn: checkIn, checkOut: checkOut, price: 0 }]);
      }
      setShowModal(true);
  };

  const handleAddRow = () => {
      const lastRow = bookingRows[bookingRows.length - 1];
      setBookingRows([...bookingRows, { tempId: `row-${Date.now()}`, roomId: '', tempPropId: currentProperty.id, tempTypeId: '', checkIn: lastRow.checkIn, checkOut: lastRow.checkOut, price: 0 }]);
  };

  const handleRemoveRow = (idx: number) => {
      if (bookingRows.length === 1 && isEditMode) return alert("Không thể xóa phòng duy nhất trong chế độ chỉnh sửa. Hãy sử dụng chức năng xóa đơn.");
      const newRows = [...bookingRows]; newRows.splice(idx, 1); setBookingRows(newRows);
  };

  const updateRow = (idx: number, field: keyof BookingRow, value: any) => {
      const newRows = [...bookingRows];
      if (field === 'tempPropId') newRows[idx] = { ...newRows[idx], tempPropId: value, tempTypeId: '', roomId: '' };
      else if (field === 'tempTypeId') newRows[idx] = { ...newRows[idx], tempTypeId: value, roomId: '' };
      else if (field === 'roomId') {
          newRows[idx] = { ...newRows[idx], roomId: value };
          const r = rooms.find(rm => rm.id === value);
          if (r) {
              const t = roomTypes.find(type => type.id === r.typeId);
              if (t) newRows[idx].price = t.price;
          }
      } else newRows[idx] = { ...newRows[idx], [field]: value };
      setBookingRows(newRows);
  };

  const handleManualCreate = () => {
     if (canAdd) openModal(null, false);
     else alert("Bạn không có quyền thêm đặt phòng mới.");
  };

  const closeQuickFinder = () => {
      if (isSavingHold) return;
      setShowQuickFinder(false);
      setHoldTargetRoomId(null);
  };

  const applyQuickPreset = (preset: 'OVERNIGHT' | 'FULL_DAY') => {
      const base = new Date();
      let start = new Date(base);
      let end = new Date(base);

      if (preset === 'OVERNIGHT') {
          start = setTimeOnDate(base, 21, 0);
          end = setTimeOnDate(addDays(base, 1), 9, 0);
      } else {
          start = setTimeOnDate(base, 14, 0);
          end = setTimeOnDate(addDays(base, 1), 12, 0);
      }

      setQuickStartInput(toDateTimeLocalValue(start));
      setQuickEndInput(toDateTimeLocalValue(end));
  };

  const handleOpenHoldModal = (roomId: string) => {
      if (!quickRange.valid) return;
      setHoldTargetRoomId(roomId);
      setHoldMinutes(10);
      setHoldGuestName('');
      setHoldGuestPhone('');
  };

  const handleCloseHoldModal = () => {
      if (isSavingHold) return;
      setHoldTargetRoomId(null);
  };

  const holdTargetRoom = useMemo(() => {
      if (!holdTargetRoomId) return null;
      return rooms.find((room) => room.id === holdTargetRoomId) || null;
  }, [holdTargetRoomId, rooms]);

  const holdQuickRange = quickRange.valid ? quickRange : null;

  const handleConfirmHoldBooking = async () => {
      if (!holdTargetRoom) return;
      if (!holdQuickRange) return;
      if (holdMinutes < 1 || holdMinutes > 30) {
          alert('Thời gian giữ cọc phải từ 1 đến 30 phút.');
          return;
      }

      const { startIso, endIso } = holdQuickRange;

      const validate = DataService.validateRoomAvailability(holdTargetRoom.id, startIso, endIso);
      if (!validate.valid) {
          alert(`Không thể giữ cọc:\n${validate.reason}`);
          return;
      }

      setIsSavingHold(true);
      try {
          const nowIso = new Date().toISOString();
          const holdUntilIso = new Date(Date.now() + holdMinutes * 60 * 1000).toISOString();
          const displayName = holdGuestName.trim() ? `Giữ cọc - ${holdGuestName.trim()}` : 'Giữ cọc';
          const holdBooking: Booking = {
              id: DataService.generateBookingId(),
              propertyId: holdTargetRoom.propertyId,
              roomId: holdTargetRoom.id,
              customerId: 'c_guest',
              guestName: displayName,
              guestPhone: holdGuestPhone.trim(),
              checkInDate: startIso,
              checkOutDate: endIso,
              status: BookingStatus.PENDING,
              totalPrice: 0,
              paidAmount: 0,
              createdAt: nowIso,
              createdBy: currentUser.id,
              notes: `Giữ cọc ${holdMinutes} phút`,
              tags: [],
              isHold: true,
              holdUntil: holdUntilIso,
          };

          await DataService.addBooking(holdBooking, { staffId: currentUser.id });
          setHoldTargetRoomId(null);
          onRefresh();
          alert(`Đã giữ cọc phòng ${holdTargetRoom.number} trong ${holdMinutes} phút (đến ${formatStandardDateTime(holdUntilIso)}).`);
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không thể giữ cọc phòng.';
          alert(`Giữ cọc thất bại:\n${message}`);
      } finally {
          setIsSavingHold(false);
      }
  };

  // --- MOUSE DRAG TO CREATE NEW BOOKING ---
  const handleMouseDown = (roomId: string, time: Date) => {
      if (!canAdd) return;

      const policyWindow = getPolicyWindowAtPoint(roomId, time.getTime());
      if (policyWindow?.mode === 'LOCKED') {
          const reason = policyWindow.reason ? ` Lý do: ${policyWindow.reason}` : '';
          alert(`🚫 Phòng đang bị khóa trong khung này.${reason}`);
          return;
      }

      setIsDragging(true); setDragStart({roomId, time}); setDragEnd({roomId, time});
  };

  const handleMouseEnter = (roomId: string, time: Date) => {
      if (!isDragging || !dragStart || dragStart.roomId !== roomId) return;
      setDragEnd({roomId, time});
  };

  const handleMouseUp = () => {
      if (!isDragging || !dragStart || !dragEnd) {
          setIsDragging(false); setDragStart(null); setDragEnd(null); return;
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

      const validate = DataService.validateRoomAvailability(
          dragStart.roomId,
          checkIn.toISOString(),
          checkOut.toISOString()
      );
      if (!validate.valid && validate.policyMode !== 'HOURLY_ONLY') {
          alert(`🚫 Không thể tạo đơn!\nLý do: ${validate.reason}`);
          setDragStart(null);
          setDragEnd(null);
          return;
      }

      openModal(null, false, dragStart.roomId, {start: toLocalISO(checkIn), end: toLocalISO(checkOut)});
      setDragStart(null); setDragEnd(null);
  };

  // --- TÍNH NĂNG DRAG TO MOVE EXISTING BOOKING ---
  const getAnchorAdjustedTargetDate = (targetDate: Date) => {
      const unitMs = timelineMode === 'DAY' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      return new Date(targetDate.getTime() - dragBookingAnchorSlots * unitMs);
  };

  const handleBookingDragStart = (
      e: React.DragEvent<HTMLDivElement>,
      bookingId: string,
      bookingStartMs: number,
      bookingEndMs: number,
      viewportStartMs: number,
      viewportEndMs: number
  ) => {
      if (!canEdit) return;
      e.stopPropagation();
      e.dataTransfer.setData('text/plain', bookingId);
      e.dataTransfer.effectAllowed = 'move';

      const unitMs = timelineMode === 'DAY' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const visibleStartMs = Math.max(bookingStartMs, viewportStartMs);
      const visibleEndMs = Math.min(bookingEndMs, viewportEndMs);
      const visibleDurationMs = Math.max(1, visibleEndMs - visibleStartMs);
      const bookingDurationMs = Math.max(1, bookingEndMs - bookingStartMs);

      const rect = e.currentTarget.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(e.clientX - rect.left, rect.width || 1));
      const ratio = rect.width > 0 ? Math.min(0.999999, clampedX / rect.width) : 0;
      const pointerTimeMs = visibleStartMs + ratio * visibleDurationMs;

      let rawOffsetSlots = 0;
      let maxOffsetSlots = 0;

      if (timelineMode === 'DAY') {
          const bookingDurationSlots = Math.max(1, Math.ceil(bookingDurationMs / unitMs));
          rawOffsetSlots = Math.floor((pointerTimeMs - bookingStartMs) / unitMs);
          maxOffsetSlots = bookingDurationSlots - 1;
      } else {
          const dayMs = 24 * 60 * 60 * 1000;
          const bookingStartDayMs = startOfDay(new Date(bookingStartMs)).getTime();
          const bookingEndInclusiveMs = Math.max(bookingStartMs, bookingEndMs - 1);
          const bookingEndDayMs = startOfDay(new Date(bookingEndInclusiveMs)).getTime();
          const bookingSpanDays = Math.max(1, Math.floor((bookingEndDayMs - bookingStartDayMs) / dayMs) + 1);
          const pointerDayMs = startOfDay(new Date(pointerTimeMs)).getTime();

          rawOffsetSlots = Math.floor((pointerDayMs - bookingStartDayMs) / dayMs);
          maxOffsetSlots = bookingSpanDays - 1;
      }

      const boundedOffsetSlots = Math.max(0, Math.min(rawOffsetSlots, maxOffsetSlots));
      setDragBookingAnchorSlots(boundedOffsetSlots);

      setMovingBookingId(bookingId);
      // Giúp thẻ đang kéo xuyên thấu để chạm tới lưới bên dưới
      setTimeout(() => setIsDraggingBooking(true), 10);
  };

  const handleBookingDragEnd = () => {
      setMovingBookingId(null);
      setIsDraggingBooking(false); 
      setDragBookingAnchorSlots(0);
      setHoveredDrop(null);
  };

  const handleBookingDrop = (e: React.DragEvent, targetRoomId: string, targetDate: Date) => {
      e.preventDefault(); e.stopPropagation(); 
      setMovingBookingId(null); setIsDraggingBooking(false); setHoveredDrop(null); setDragBookingAnchorSlots(0);

      const bookingId = e.dataTransfer.getData('text/plain') || movingBookingId;
      if (!bookingId) return;

      const booking = bookings.find(b => b.id === bookingId);
      const targetRoom = rooms.find(r => r.id === targetRoomId);
      if (!booking || !targetRoom) return;

      const oldIn = new Date(booking.checkInDate);
      const oldOut = new Date(booking.checkOutDate);
      const durationMs = oldOut.getTime() - oldIn.getTime();

      const adjustedTargetDate = getAnchorAdjustedTargetDate(targetDate);
      const newCheckIn = new Date(adjustedTargetDate);
      if (timelineMode === 'DAY') newCheckIn.setMinutes(0, 0, 0); 
      else newCheckIn.setHours(14, 0, 0, 0); 
      
      const newCheckOut = new Date(newCheckIn.getTime() + durationMs);
      
      const isSameTime = timelineMode === 'DAY' ? oldIn.getTime() === newCheckIn.getTime() : oldIn.toDateString() === newCheckIn.toDateString();
      if (booking.roomId === targetRoomId && isSameTime) return;

      const validate = DataService.validateRoomAvailability(targetRoomId, newCheckIn.toISOString(), newCheckOut.toISOString(), booking.id);
      if (!validate.valid) return alert(`🚫 Không thể chuyển phòng!\nLý do: ${validate.reason}`);

      setMoveConfirmModal({ isOpen: true, booking, newRoom: targetRoom, newCheckIn, newCheckOut });
  };

  const confirmAndSaveMove = async () => {
      if (!moveConfirmModal || !moveConfirmModal.booking || !moveConfirmModal.newRoom) return;
      const { booking, newRoom, newCheckIn, newCheckOut } = moveConfirmModal;
      const updatedBooking = { ...booking, roomId: newRoom.id, propertyId: newRoom.propertyId, checkInDate: newCheckIn!.toISOString(), checkOutDate: newCheckOut!.toISOString() };
      try {
          await DataService.updateBooking(updatedBooking);
          setMoveConfirmModal(null);
          onRefresh();
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không thể cập nhật đơn khi kéo thả.';
          alert(`Không thể chuyển phòng:\n${message}`);
      }
  };

  // --- EXTRA FEES HANDLERS ---
  const handleAddFee = () => {
      if (!pendingFee.categoryId) return alert("Vui lòng chọn loại phí/dịch vụ");
      if (pendingFee.amount <= 0) return alert("Vui lòng nhập số tiền hợp lệ");
      const cat = financeCategories.find(c => c.id === pendingFee.categoryId);
      if (!cat) return;
      const newFee: ExtraFee = { id: `fee_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, categoryId: cat.id, name: cat.name, amount: pendingFee.amount, type: cat.type };
      setBookingMeta(prev => ({ ...prev, extraFees: [...prev.extraFees, newFee] }));
      setPendingFee({ categoryId: '', amount: 0 }); 
  };

  const handleRemoveFee = (feeId: string) => {
      setBookingMeta(prev => ({ ...prev, extraFees: prev.extraFees.filter(f => f.id !== feeId) }));
  };

  const extraRevenue = bookingMeta.extraFees.reduce((s, f) => f.type === 'REVENUE' ? s + f.amount : s, 0);
  const extraExpense = bookingMeta.extraFees.reduce((s, f) => f.type === 'EXPENSE' ? s + f.amount : s, 0);
  const feeNet = extraRevenue - extraExpense;
  const grandTotal = bookingMeta.totalPrice + feeNet; 

  const selectedBookingHistory = useMemo(() => {
      if (!isEditMode) return [];

      const targetBookingIds = new Set<string>();
      if (bookingMeta.id) targetBookingIds.add(bookingMeta.id);
      originalBookingIds.forEach(id => targetBookingIds.add(id));
      bookingRows.forEach(row => {
          if (row.bookingId) targetBookingIds.add(row.bookingId);
      });

      const targetGroupId = bookingMeta.groupId;

      return history
          .filter(log => {
              const entityType = log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM');
              if (entityType !== 'BOOKING') return false;

              const meta: any = log.metadata || {};
              const logBookingId = log.entityId || meta.bookingId || log.bookingSnapshot?.id || (log.after as any)?.id || (log.before as any)?.id;
              const logGroupId = meta.groupId || log.bookingSnapshot?.groupId || (log.after as any)?.groupId || (log.before as any)?.groupId;

              if (logBookingId && targetBookingIds.has(logBookingId)) return true;
              if (targetGroupId && logGroupId && targetGroupId === logGroupId) return true;
              return false;
          })
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [history, isEditMode, bookingMeta.id, bookingMeta.groupId, originalBookingIds, bookingRows]);

  const getBookingOperationName = (log: HistoryLog) => {
      return log.description;
  };

  const getActorUsername = (log: HistoryLog) => {
      if (log.actorUsername) return log.actorUsername;
      if (log.actorId && usernameByUserId.get(log.actorId)) return usernameByUserId.get(log.actorId)!;
      if (log.staffId && usernameByUserId.get(log.staffId)) return usernameByUserId.get(log.staffId)!;
      return log.actorId || log.staffId || 'không rõ';
  };

  const handleSaveBooking = async () => {
     if (isSubmitting) return; 
     const validRows = bookingRows.filter(r => r.roomId);
     if (validRows.length === 0) return alert("Vui lòng chọn ít nhất một phòng");
     const roomIds = validRows.map(r => r.roomId);
     if (new Set(roomIds).size !== roomIds.length) return alert("Lỗi: Bạn đang chọn cùng 1 phòng cho nhiều dòng khác nhau trong đơn. Vui lòng kiểm tra lại.");

     for (const row of validRows) {
         const room = rooms.find(r => r.id === row.roomId);
         const startTime = new Date(row.checkIn).getTime();
         const endTime = new Date(row.checkOut).getTime();
         if (startTime >= endTime) return alert(`Lỗi thời gian (Phòng ${room?.number || row.roomId}):\nThời gian Trả phòng phải lớn hơn thời gian Nhận phòng.\nVui lòng kiểm tra lại.`);
         const availability = DataService.validateRoomAvailability(row.roomId, row.checkIn, row.checkOut, row.bookingId);
         if (!availability.valid) return alert(`Lỗi đặt phòng (Phòng ${room?.number || row.roomId}):\n${availability.reason}\n\nVui lòng chọn thời gian khác cách ít nhất 30 phút.`);
     }

     setIsSubmitting(true);
     try {
         let groupId = bookingMeta.groupId;
         if (!groupId && validRows.length > 1) groupId = DataService.generateBookingId() + '_grp'; 
         const roomTotal = bookingMeta.totalPrice;
         const pricePerRoom = Math.floor(roomTotal / validRows.length);

         const currentIds = validRows.map(r => r.bookingId).filter(Boolean);
         const idsToDelete = isEditMode && originalBookingIds.length > 0
             ? originalBookingIds.filter(oid => !currentIds.includes(oid))
             : [];

         const upserts: Array<{ booking: Booking; mode: 'create' | 'update' }> = [];

         for (const [idx, row] of validRows.entries()) {
             let thisPrice = idx === 0 ? pricePerRoom + (roomTotal % validRows.length) : pricePerRoom;
             if (idx === 0) thisPrice += feeNet; 
             const thisPaid = idx === 0 ? bookingMeta.paidAmount : 0; 
             const selectedRoom = rooms.find(r => r.id === row.roomId);

             const commonData = {
                 groupId: groupId || null, propertyId: selectedRoom?.propertyId || currentProperty.id, roomId: row.roomId,
                 customerId: 'c_guest', guestName: bookingMeta.guestName || 'Khách lẻ', guestPhone: bookingMeta.guestPhone || '',
                 checkInDate: row.checkIn, checkOutDate: row.checkOut, status: bookingMeta.status, totalPrice: thisPrice, 
                 paidAmount: thisPaid, notes: bookingMeta.notes || '', tags: bookingMeta.tags || [],
                 extraFees: idx === 0 ? (bookingMeta.extraFees || []) : []
             };

             if (row.bookingId) {
                 const existingBooking = bookings.find(b => b.id === row.bookingId);
                 const updatedB: Booking = {
                     ...commonData,
                     id: row.bookingId,
                     createdBy: existingBooking?.createdBy || currentUser.id,
                     createdAt: existingBooking?.createdAt || new Date().toISOString()
                 };
                 upserts.push({ booking: updatedB, mode: 'update' });
             } else {
                 const newB: Booking = {
                     ...commonData,
                     id: DataService.generateBookingId(),
                     createdBy: currentUser.id,
                     createdAt: new Date().toISOString()
                 };
                 upserts.push({ booking: newB, mode: 'create' });
             }
         }

         await DataService.saveBookingGroup(
             {
                 upserts,
                 deleteIds: idsToDelete,
             },
             { staffId: currentUser.id }
         );

         const receiptRooms = validRows.map(row => {
             const room = rooms.find(r => r.id === row.roomId);
             const type = roomTypes.find(t => t.id === room?.typeId);
             const prop = properties.find(p => p.id === room?.propertyId); 
             return { roomNumber: room?.number || 'N/A', typeName: type?.name || 'N/A', branchName: prop?.name || 'N/A', checkIn: row.checkIn, checkOut: row.checkOut };
         });
         
         const selectedTags = tags.filter(t => bookingMeta.tags.includes(t.id));
         const receiptFees = bookingMeta.extraFees.filter(f => f.type === 'REVENUE');
         const receiptTotal = bookingMeta.totalPrice + extraRevenue;

         setReceiptData({
             guestName: bookingMeta.guestName || 'Khách lẻ', guestPhone: bookingMeta.guestPhone || '', notes: bookingMeta.notes,
             tags: selectedTags, total: receiptTotal, paid: bookingMeta.paidAmount, rooms: receiptRooms, extraFees: receiptFees, roomPrice: bookingMeta.totalPrice 
         });

         setShowModal(false); setShowTicketModal(true); onRefresh();
     } catch (e) {
         console.error(e);
         const message = e instanceof Error ? e.message : 'Không thể lưu đơn đặt phòng.';
         alert(`Không thể lưu đơn đặt phòng:\n${message}`);
         setIsSubmitting(false); 
     } finally {
         setTimeout(() => setIsSubmitting(false), 500);
     }
  };

  const handleDeleteClick = () => { if(!canDelete) return; setShowDeleteConfirm(true); };

  const handleConfirmDelete = async () => {
      const idsToDelete = originalBookingIds.length > 0 ? originalBookingIds : (bookingMeta.id ? [bookingMeta.id] : []);
      if (idsToDelete.length === 0) return;
      let successCount = 0;
      for (const id of idsToDelete) {
          if (await DataService.deleteBooking(id, currentUser.id)) successCount++;
      }
      if (successCount > 0) {
          alert(`Đã xóa ${successCount} đơn thành công!`); setShowDeleteConfirm(false); setShowModal(false); onRefresh();
      } else { alert("Không thể xóa đơn. Vui lòng kiểm tra console log."); setShowDeleteConfirm(false); }
  };

  const toggleTag = (tagId: string) => { setBookingMeta(prev => { const exists = prev.tags.includes(tagId); return { ...prev, tags: exists ? prev.tags.filter(t => t !== tagId) : [...prev.tags, tagId] }; }); };

  const getBookingStyle = (booking: Booking) => {
     if (booking.isHold) {
         return "room-booking-chip room-booking-chip-hold absolute h-[80%] top-[10%] rounded-md text-[10px] px-1 overflow-hidden cursor-pointer shadow-sm flex flex-col justify-center transition-all hover:scale-[1.02] z-[5] border bg-amber-500/90 text-white border-amber-600 shadow-amber-200";
     }
     const isPaid = booking.paidAmount >= booking.totalPrice;
     let classes = "room-booking-chip absolute h-[80%] top-[10%] rounded-md text-[10px] px-1 overflow-hidden cursor-pointer shadow-sm flex flex-col justify-center transition-all hover:scale-[1.02] z-[5] border ";
     if (isPaid) classes += "room-booking-chip-paid bg-green-500 text-white border-green-600 shadow-green-200";
     else classes += "room-booking-chip-unpaid bg-red-500 text-white border-red-600 shadow-red-200";
     return classes;
  };

  const renderGridCell = (room: Room, slot: Date) => {
      const isCurrent = isCurrentTimeSlot(slot);
      return (
          <div 
            key={slot.toISOString()}
            className={`border-r h-full relative select-none transition-colors duration-75 ${isCurrent ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
            onMouseDown={() => handleMouseDown(room.id, slot)}
            onMouseEnter={() => handleMouseEnter(room.id, slot)}
            onMouseUp={handleMouseUp}
            onDragEnter={(e) => e.preventDefault()} 
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!movingBookingId) return;
                setHoveredDrop(prev => {
                    if (prev?.roomId === room.id && prev.time.getTime() === slot.getTime()) return prev;
                    return { roomId: room.id, time: slot };
                });
            }}
            onDragLeave={(e) => {}}
            onDrop={(e) => handleBookingDrop(e, room.id, slot)}
          >
            {timelineMode === 'WEEK' && <div className="absolute left-1/2 top-0 bottom-0 w-px border-l border-dashed border-gray-200 pointer-events-none"></div>}
          </div>
      )
  };

  const isReadOnly = isEditMode ? !canEdit : !canAdd;
  const propertiesToRender = currentProperty.id === 'ALL' ? properties : [currentProperty];
  const bookingDetailGridTemplate = '1.05fr 1.35fr 1.05fr 1.85fr 1.85fr 0.8fr';
  const roomColumnWidthClass = 'w-[104px] md:w-40';

  return (
    <div className="katka-liquid-page h-[calc(100vh-5rem)] md:h-[calc(100vh-7rem)] flex flex-col space-y-4 font-sans text-gray-800 animate-fade-in relative z-10">
       <div className="bg-white p-2.5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-2 justify-between transition-all relative z-20 overflow-x-auto no-scrollbar whitespace-nowrap">
          <div className="flex items-center gap-2 shrink-0">
              
              <div className="flex gap-2 w-auto shrink-0">
                  <div className="relative w-[102px] md:w-[112px] shrink-0">
                      <select 
                        value={filters.status}
                        onChange={e => setFilters({...filters, status: e.target.value})}
                        className="w-full h-10 appearance-none pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-xs md:text-sm font-semibold text-gray-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer hover:border-gray-300 transition-colors"
                      >
                          <option value="STAYING">Lưu trú</option>
                          <option value="ARRIVING">Đến</option>
                          <option value="DEPARTING">Đi</option>
                      </select>
                      <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-gray-400 pointer-events-none" size={14} />
                  </div>

                  <div className="relative w-[102px] md:w-[112px] shrink-0">
                      <select 
                        value={timelineMode}
                        onChange={e => setTimelineMode(e.target.value as ViewMode)}
                        className="w-full h-10 appearance-none pl-3 pr-8 bg-white border border-gray-200 rounded-xl text-xs md:text-sm font-semibold text-gray-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer hover:border-gray-300 transition-colors"
                      >
                          <option value="DAY">Ngày</option>
                          <option value="WEEK">Tuần</option>
                          <option value="MONTH">Tháng</option>
                      </select>
                      <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-gray-400 pointer-events-none" size={14} />
                  </div>
              </div>

              <div className="flex items-center gap-2 w-auto shrink-0">
                   <button 
                      onClick={() => handleNavigate('PREV')}
                      className="w-10 h-10 shrink-0 flex items-center justify-center bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 hover:text-blue-600 shadow-sm transition-all active:scale-95"
                   >
                      <ChevronLeft size={18}/>
                   </button>
                   
                   <div className="flex-none group min-w-0">
                       <div className="h-10 flex items-center justify-center gap-1.5 px-2.5 bg-white border border-gray-200 group-hover:border-blue-400 rounded-xl shadow-sm group-hover:bg-blue-50 transition-all min-w-[162px] md:min-w-[172px]">
                           <span className="text-xs md:text-sm font-bold text-gray-700 group-hover:text-blue-700 transition-colors capitalize truncate cursor-default">
                              <span className="hidden xl:inline">{dateRangeLabel}</span>
                              <span className="xl:hidden">{dateRangeLabelCompact}</span>
                           </span>
                           <div className="relative cursor-pointer p-1 -m-1 rounded-full hover:bg-blue-100 transition-colors">
                               <Calendar size={18} className="text-gray-500 group-hover:text-blue-500 transition-colors" />
                               <input 
                                  type={timelineMode === 'MONTH' ? "month" : "date"}
                                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                  onChange={handleDateInput}
                                  onClick={(e) => {
                                      try { (e.currentTarget as any).showPicker(); e.preventDefault(); } catch(e) {}
                                  }}
                               />
                           </div>
                       </div>
                   </div>

                   <button 
                      onClick={() => handleNavigate('NEXT')}
                      className="w-10 h-10 shrink-0 flex items-center justify-center bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 hover:text-blue-600 shadow-sm transition-all active:scale-95"
                   >
                      <ChevronRight size={18}/>
                   </button>
              </div>
          </div>

          <div className="flex items-center gap-2 md:gap-2.5 justify-end ml-auto min-w-0 shrink-0">
                 <div className="relative flex-none w-[132px] md:w-[146px]">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
                     <input 
                        className="h-10 pl-9 pr-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none text-xs md:text-sm transition-all text-gray-900 placeholder:text-gray-400 w-full"
                        placeholder="Tìm kiếm..."
                        value={filters.search}
                        onChange={e => setFilters({...filters, search: e.target.value})}
                     />
                 </div>

                 <button
                    type="button"
                    onClick={() => {
                        setHoldTargetRoomId(null);
                        setShowQuickFinder(true);
                    }}
                    className="h-10 px-2.5 md:px-3 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-xl text-xs md:text-sm font-bold shadow-sm transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1.5"
                    title="Tra phòng nhanh theo khung giờ khách chọn"
                 >
                    <Clock size={16} />
                    <span className="hidden xl:inline">Tra phòng nhanh</span>
                    <span className="xl:hidden">Tra nhanh</span>
                 </button>
                 
                 <div className="h-10 flex items-center bg-gray-100 p-1 rounded-lg">
                      <button onClick={() => setViewType('GRID')} className={`w-9 h-8 flex items-center justify-center rounded-md transition-all ${viewType==='GRID'?'bg-white shadow text-blue-600':'text-gray-500'}`}><LayoutGrid size={18}/></button>
                      <button onClick={() => setViewType('LIST')} className={`w-9 h-8 flex items-center justify-center rounded-md transition-all ${viewType==='LIST'?'bg-white shadow text-blue-600':'text-gray-500'}`}><ListIcon size={18}/></button>
                 </div>

                 {canAdd && (
                    <button onClick={handleManualCreate} className="h-10 bg-green-600 hover:bg-green-700 text-white px-2.5 rounded-xl inline-flex items-center justify-center gap-1.5 font-bold text-xs md:text-sm shadow-md shadow-green-200 transition-all active:scale-95 whitespace-nowrap">
                        <Plus size={18} /> <span className="hidden xl:inline">Đặt phòng</span>
                        <span className="xl:hidden">Đặt</span>
                    </button>
                 )}
          </div>
       </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col relative z-0">
          {viewType === 'GRID' ? (
             <div className="flex-1 overflow-auto no-scrollbar relative bg-white">
                 <div style={{minWidth: timelineMode === 'MONTH' ? '2000px' : timelineMode === 'DAY' ? '1200px' : '100%'}} className="relative w-fit min-w-full">
                     
                     <div className={`sticky top-0 z-[40] bg-gray-50 border-b flex shadow-sm ring-1 ring-gray-200 ${timelineMode === 'WEEK' ? 'h-16 md:h-14' : 'h-14'}`}>
                         <div className={`${roomColumnWidthClass} flex-shrink-0 border-r p-2 md:p-3 font-bold text-gray-700 bg-gray-50 flex items-center sticky left-0 z-[50] shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)] text-sm md:text-base`}>Phòng</div>
                         <div className="flex-1 grid" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                             {timeSlots.map((slot, i) => {
                                 const isCurrent = isCurrentTimeSlot(slot);
                                 return (
                                     <div key={i} className={`border-r px-1 text-center text-xs flex flex-col items-center justify-center leading-tight font-medium ${isCurrent ? 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200' : (slot.toDateString() === new Date().toDateString() ? 'bg-blue-50 text-blue-700' : 'text-gray-600')}`}>
                                         {timelineMode === 'DAY' ? (
                                             `${slot.getHours()}:00`
                                         ) : timelineMode === 'WEEK' ? (
                                             <span className="flex flex-col items-center justify-center leading-tight">
                                                 <span className={isCurrent ? 'font-bold text-sm md:text-base' : 'text-sm md:text-base font-semibold'}>
                                                     {getWeekdayShortVi(slot)}
                                                 </span>
                                                 <span className={isCurrent ? 'font-bold text-sm md:text-base' : 'text-sm md:text-base font-semibold'}>
                                                     {slot.getDate()}/{slot.getMonth()+1}
                                                 </span>
                                             </span>
                                         ) : (
                                             <span className={isCurrent ? 'font-bold text-base' : 'text-sm'}>
                                                 {slot.getDate()}/{slot.getMonth()+1}
                                             </span>
                                         )}
                                     </div>
                                 )
                             })}
                         </div>
                     </div>
                     {sortedRooms.map((room, index) => {
                         const prevRoom = sortedRooms[index - 1];
                         const isNewBranch = !prevRoom || prevRoom.propertyId !== room.propertyId;
                         const propName = properties.find(p => p.id === room.propertyId)?.name;

                         let statusBg = 'bg-white room-status-default';
                         let statusIcon = null;
                         let statusBorder = '';
                         let tooltip = '';

                         if (room.status === RoomStatus.VACANT_DIRTY) {
                            statusBg = 'bg-yellow-50 room-status-dirty'; statusBorder = 'border-l-4 border-l-yellow-400'; statusIcon = <AlertTriangle size={14} className="text-yellow-600" />; tooltip = 'Phòng chưa dọn';
                         } else if (room.status === RoomStatus.VACANT_CLEAN) {
                             statusBg = 'bg-white room-status-clean'; statusBorder = 'border-l-4 border-l-green-500'; statusIcon = <CheckCircle size={14} className="text-green-600" />; tooltip = 'Sẵn sàng';
                         } else if (room.status === RoomStatus.OCCUPIED) {
                             statusBg = 'bg-red-50 room-status-occupied'; statusBorder = 'border-l-4 border-l-red-500'; statusIcon = <UserIcon size={14} className="text-red-600" />; tooltip = 'Đang có khách';
                         } else if (room.status === RoomStatus.MAINTENANCE) {
                             statusBg = 'bg-gray-100 room-status-maintenance'; statusBorder = 'border-l-4 border-l-gray-500'; statusIcon = <Wrench size={14} className="text-gray-600" />; tooltip = 'Bảo trì';
                         }

                         return (
                             <React.Fragment key={room.id}>
                                 {isNewBranch && (
                                     <div className="room-branch-header sticky left-0 z-[20] w-full bg-gray-200/90 border-y border-gray-300/80 font-bold text-gray-700 px-4 py-1.5 text-xs uppercase tracking-wider flex items-center gap-2 backdrop-blur-sm shadow-sm">
                                         <Building2 size={14} className="text-gray-500"/> {propName}
                                     </div>
                                 )}

                                 <div className="flex h-20 border-b hover:bg-gray-50 transition-colors group">
                                     <div 
                                        className={`room-status-panel ${roomColumnWidthClass} flex-shrink-0 border-r p-2 md:p-3 flex flex-col justify-center sticky left-0 z-[30] border-r-gray-200 shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)] transition-all select-none relative ${statusBg} ${statusBorder}`} 
                                        title={tooltip}
                                        onClick={() => handleStatusIconClick(room)}
                                        style={{cursor: canManageRooms ? 'pointer' : 'default'}}
                                     >
                                         <div className="flex items-center gap-1.5">
                                            <div className="room-number font-bold text-base md:text-lg text-gray-800 leading-none">{room.number}</div>
                                            {statusIcon}
                                         </div>
                                         <div className="room-type text-[10px] md:text-xs text-gray-500 truncate mt-1.5 font-medium">{roomTypes.find(t=>t.id===room.typeId)?.name}</div>
                                         {room.status === RoomStatus.VACANT_DIRTY && <span className="room-dirty-badge text-[9px] font-bold text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded w-fit mt-1">CHƯA DỌN</span>}
                                     </div>
                                    
                                     <div className="flex-1 grid relative" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                                         {timeSlots.map((slot) => renderGridCell(room, slot))}

                                         {(roomPolicyWindowsByRoom.get(room.id) || []).map((policyWindow, policyIdx) => {
                                             const bStart = policyWindow.startMs;
                                             const bEnd = policyWindow.endMs;
                                             if (bEnd <= viewportStartMs || bStart >= viewportEndMs) return null;

                                             const totalDuration = viewportEndMs - viewportStartMs;
                                             const offset = Math.max(0, bStart - viewportStartMs);
                                             const duration = Math.min(bEnd, viewportEndMs) - Math.max(bStart, viewportStartMs);
                                             const left = (offset / totalDuration) * 100;
                                             const width = (duration / totalDuration) * 100;
                                             if (width <= 0) return null;

                                             const isLockedPolicy = policyWindow.mode === 'LOCKED';
                                             const label = isLockedPolicy
                                                 ? `Khoá phòng${policyWindow.reason ? `. Lý do: ${policyWindow.reason}` : ''}`
                                                 : 'Chỉ nhận khách giờ';
                                             const tooltipText = isLockedPolicy
                                                 ? label
                                                 : 'Chỉ nhận khách giờ. Không nhận đơn 14h - 12h hôm sau.';

                                             return (
                                                 <div
                                                     key={`${policyWindow.policyId}-${policyWindow.startMs}-${policyIdx}`}
                                                     className={`absolute top-[14%] h-[72%] rounded-md border flex items-center px-1.5 z-[7] pointer-events-none ${
                                                         isLockedPolicy
                                                             ? 'bg-red-500/20 border-red-600/60 text-red-900'
                                                             : 'bg-[#0b1f4d]/30 border-[#0b1f4d]/60 text-[#0b1f4d]'
                                                     }`}
                                                     style={{ left: `${left}%`, width: `${width}%` }}
                                                     title={tooltipText}
                                                 >
                                                     <span className="text-[10px] font-semibold truncate whitespace-nowrap">{label}</span>
                                                 </div>
                                             );
                                         })}
                                         
                                         {/* 1. Bóng mờ cho KÉO TẠO MỚI (Từ 14h đến 12h) */}
                                         {isDragging && dragStart && dragEnd && dragStart.roomId === room.id && (() => {
                                             const s = dragStart.time < dragEnd.time ? dragStart.time : dragEnd.time;
                                             const e = dragStart.time < dragEnd.time ? dragEnd.time : dragStart.time;
                                             let cIn = new Date(s);
                                             let cOut = new Date(e);
                                             if (timelineMode === 'DAY') cOut = addHours(cOut, 1);
                                             else {
                                                 cIn.setHours(14,0,0,0);
                                                 if (s.getTime() === e.getTime()) cOut = addDays(cOut, 1);
                                                 else cOut = addDays(cOut, 1);
                                                 cOut.setHours(12,0,0,0);
                                             }
                                             const bStart = cIn.getTime();
                                             const bEnd = cOut.getTime();
                                             if (bEnd <= viewportStartMs || bStart >= viewportEndMs) return null;
                                             const left = (Math.max(0, bStart - viewportStartMs) / (viewportEndMs - viewportStartMs)) * 100;
                                             const width = ((Math.min(bEnd, viewportEndMs) - Math.max(bStart, viewportStartMs)) / (viewportEndMs - viewportStartMs)) * 100;
                                             
                                             return <div className="absolute top-[10%] h-[80%] bg-blue-400 opacity-50 border-2 border-blue-600 border-dashed rounded-md pointer-events-none z-[15]" style={{left: `${left}%`, width: `${width}%`}}></div>;
                                         })()}

                                         {/* 2. Bóng mờ cho KÉO THẢ ĐỔI PHÒNG (Từ 14h đến 12h) */}
                                         {hoveredDrop?.roomId === room.id && movingBookingId && (() => {
                                             const movingBooking = bookings.find(b => b.id === movingBookingId);
                                             if (!movingBooking) return null;
                                             const oldIn = new Date(movingBooking.checkInDate);
                                             const oldOut = new Date(movingBooking.checkOutDate);
                                             const durationMs = oldOut.getTime() - oldIn.getTime();
                                             const adjustedHoverTime = getAnchorAdjustedTargetDate(hoveredDrop.time);
                                             const newCheckIn = new Date(adjustedHoverTime);
                                             if (timelineMode === 'DAY') newCheckIn.setMinutes(0, 0, 0);
                                             else newCheckIn.setHours(14, 0, 0, 0);
                                             const newCheckOut = new Date(newCheckIn.getTime() + durationMs);
                                             
                                             const bStart = newCheckIn.getTime();
                                             const bEnd = newCheckOut.getTime();
                                             if (bEnd <= viewportStartMs || bStart >= viewportEndMs) return null;
                                             const left = (Math.max(0, bStart - viewportStartMs) / (viewportEndMs - viewportStartMs)) * 100;
                                             const width = ((Math.min(bEnd, viewportEndMs) - Math.max(bStart, viewportStartMs)) / (viewportEndMs - viewportStartMs)) * 100;
                                             
                                             return <div className="absolute top-[10%] h-[80%] bg-amber-400 opacity-60 border-2 border-amber-600 border-dashed rounded-md pointer-events-none z-[15]" style={{left: `${left}%`, width: `${width}%`}}></div>;
                                         })()}

                                         {(filteredBookingsByRoom.get(room.id) || []).map(b => {
                                                const bStart = new Date(b.checkInDate).getTime();
                                                const bEnd = new Date(b.checkOutDate).getTime();

                                                if (bEnd <= viewportStartMs || bStart >= viewportEndMs) return null;
                                                const totalDuration = viewportEndMs - viewportStartMs;
                                                const offset = Math.max(0, bStart - viewportStartMs);
                                                const duration = Math.min(bEnd, viewportEndMs) - Math.max(bStart, viewportStartMs);
                                                const left = (offset / totalDuration) * 100;
                                                const width = (duration / totalDuration) * 100;
                                                const bookingTags = tags.filter(t => b.tags?.includes(t.id));
                                                const isGroup = !!b.groupId;
                                                const isCompactCard = width < (timelineMode === 'DAY' ? 8 : 5);
                                                const showGroupBadge = isGroup;
                                                const showNoteBadge = !!b.notes && (!isCompactCard || !isGroup);

                                                return (
                                                    <div 
                                                        key={b.id} 
                                                        draggable
                                                        onMouseDown={(e) => e.stopPropagation()} 
                                                        onDragStart={(e) => handleBookingDragStart(e, b.id, bStart, bEnd, viewportStartMs, viewportEndMs)}
                                                        onDragEnd={handleBookingDragEnd}
                                                        className={`${getBookingStyle(b)} ${movingBookingId === b.id ? 'opacity-40' : 'opacity-100'}`} 
                                                        style={{
                                                            left: `${left}%`, width: `${width}%`, 
                                                            zIndex: movingBookingId === b.id ? 25 : 10,
                                                            pointerEvents: isDraggingBooking ? 'none' : 'auto' 
                                                        }} 
                                                        onClick={(e) => { e.stopPropagation(); openModal(b, true, undefined, undefined); }}
                                                    >
                                                        <div className="absolute top-0.5 right-0.5 flex items-center gap-1 z-[12]">
                                                            {showGroupBadge && <div className="bg-blue-500 text-white w-3.5 h-3.5 flex items-center justify-center text-[8px] border border-white rounded-md font-bold shadow-sm" title="Khách đoàn"><Users size={8} /></div>}
                                                            {showNoteBadge && <div className="bg-orange-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center text-[8px] border border-white shadow-sm font-bold" title="Có ghi chú">!</div>}
                                                        </div>
                                                        <div className="font-bold truncate text-[10px] md:text-xs relative z-[11]">{b.guestName}</div>
                                                        <div className="flex gap-0.5 mt-1 relative z-[11]">
                                                            {bookingTags.map(t => (
                                                                <div key={t.id} className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: t.color}} title={t.name}></div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                     </div>
                                 </div>
                             </React.Fragment>
                         )
                     })}
                 </div>
             </div>
          ) : (
            <div className="overflow-auto relative z-10 bg-white">
                <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-gray-100 text-gray-700 font-bold border-b text-xs uppercase sticky top-0 z-[40]">
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
                                    <td className="p-4 text-gray-500 text-xs">{formatStandardDateTime(b.createdAt)}</td>
                                    <td className="p-4 text-gray-500 text-xs">{formatStandardDateTime(b.checkInDate)}</td>
                                    <td className="p-4 text-gray-500 text-xs">{formatStandardDateTime(b.checkOutDate)}</td>
                                    
                                    <td className="p-4 text-right font-medium text-gray-900">{formatNumber(b.totalPrice)}</td>
                                    <td className="p-4 text-right font-medium text-blue-600">{formatNumber(b.paidAmount)}</td>
                                    <td className={`p-4 text-right font-bold ${debt > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                        {formatNumber(debt)}
                                    </td>
                                    
                                    <td className="p-4 text-xs text-gray-600">{creator?.username || b.createdBy}</td>
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

      {showQuickFinder && createPortal(
          <div className="katka-app katka-modal-scope fixed inset-0 z-[115] flex items-center justify-center p-2 md:p-3">
              <div className="absolute inset-0 katka-modal-backdrop" onClick={closeQuickFinder}></div>
              <div className="katka-focus-modal relative bg-white w-full max-w-[1024px] h-[calc(100dvh-20px)] md:h-[calc(100dvh-24px)] rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col animate-fade-in">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                      <div>
                          <h3 className="text-sm md:text-[15px] font-bold text-gray-900">Tra phòng nhanh</h3>
                          <p className="hidden md:block text-[11px] text-gray-500">Kiểm tra phòng trống theo thời gian khách chọn và điều phối theo đơn gần nhất trước/sau.</p>
                      </div>
                      <button
                          type="button"
                          onClick={closeQuickFinder}
                          className="w-6 h-6 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center"
                      >
                          <X size={13} />
                      </button>
                  </div>

                  <div className="p-2.5 md:p-3 border-b border-gray-100 bg-white space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-2">
                          <div>
                              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Lọc theo chi nhánh</label>
                              <select
                                  value={quickPropertyFilter}
                                  onChange={(e) => setQuickPropertyFilter(e.target.value)}
                                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                              >
                                  <option value="ALL">Tất cả chi nhánh</option>
                                  {quickPropertyOptions.map((property) => (
                                      <option key={property.id} value={property.id}>
                                          {property.name}
                                      </option>
                                  ))}
                              </select>
                          </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                          <button
                              type="button"
                              onClick={() => applyQuickPreset('OVERNIGHT')}
                              className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-[11px] font-semibold hover:bg-gray-50"
                          >
                              Qua đêm 21:00 - 09:00
                          </button>
                          <button
                              type="button"
                              onClick={() => applyQuickPreset('FULL_DAY')}
                              className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-[11px] font-semibold hover:bg-gray-50"
                          >
                              Cả ngày 14:00 - 12:00
                          </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Từ thời điểm</label>
                              <input
                                  type="datetime-local"
                                  value={quickStartInput}
                                  onChange={(e) => setQuickStartInput(e.target.value)}
                                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                              />
                          </div>
                          <div>
                              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Đến thời điểm</label>
                              <input
                                  type="datetime-local"
                                  value={quickEndInput}
                                  onChange={(e) => setQuickEndInput(e.target.value)}
                                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                              />
                          </div>
                      </div>
                  </div>

                  <div className="relative flex-1 min-h-0 overflow-hidden">
                      <div className={`h-full min-h-0 overflow-y-auto overscroll-contain p-2.5 md:p-3 bg-white transition-[padding] duration-200 [touch-action:pan-y] ${holdTargetRoom && holdQuickRange ? 'md:pr-[360px]' : ''}`}>
                          {!quickRange.valid && (
                              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium">
                                  {quickRange.message}
                              </div>
                          )}

                          {quickRange.valid && quickAvailabilityByProperty.length === 0 && (
                              <div className="p-5 rounded-xl border border-gray-200 bg-white text-sm text-gray-600">
                                  Không có phòng trống phù hợp trong khung giờ này.
                              </div>
                          )}

                          {quickRange.valid && quickAvailabilityByProperty.length > 0 && (
                              <div className="space-y-3">
                                  {quickAvailabilityByProperty.map((group) => (
                                      <div key={group.propertyId} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                          <div className="px-2.5 py-2 bg-white border-b border-gray-200 text-xs font-bold text-gray-800">
                                              {group.propertyName} ({group.rooms.length} phòng trống)
                                          </div>
                                          <div className="overflow-x-auto">
                                              <table className="w-full text-xs">
                                                  <thead className="bg-white text-gray-500 uppercase text-[11px]">
                                                      <tr>
                                                          <th className="px-2.5 py-1.5 text-left">Phòng</th>
                                                          <th className="px-2.5 py-1.5 text-left">Hạng phòng</th>
                                                          <th className="px-2.5 py-1.5 text-left">Trả trước</th>
                                                          <th className="px-2.5 py-1.5 text-left">Nhận sau</th>
                                                          <th className="px-2.5 py-1.5 text-right">Thao tác</th>
                                                      </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-gray-100">
                                                      {group.rooms.map((item) => (
                                                          <tr key={item.room.id} className="hover:bg-gray-50">
                                                              <td className="px-2.5 py-2 font-bold text-gray-900">{item.room.number}</td>
                                                              <td className="px-2.5 py-2 text-gray-600">{item.roomTypeName}</td>
                                                              <td className="px-2.5 py-2 text-gray-700">
                                                                  {item.previousBooking ? formatStandardDateTime(item.previousBooking.checkOutDate) : 'n/a'}
                                                              </td>
                                                              <td className="px-2.5 py-2 text-gray-700">
                                                                  {item.nextBooking ? formatStandardDateTime(item.nextBooking.checkInDate) : 'n/a'}
                                                              </td>
                                                              <td className="px-2.5 py-2">
                                                                  <div className="flex justify-end gap-2.5">
                                                                      {canAdd && (
                                                                          <button
                                                                              type="button"
                                                                              onClick={() => handleOpenHoldModal(item.room.id)}
                                                                              className="px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-[11px] font-bold hover:bg-amber-100"
                                                                          >
                                                                              Giữ cọc
                                                                          </button>
                                                                      )}
                                                                      {canAdd && (
                                                                          <button
                                                                              type="button"
                                                                              onClick={() => {
                                                                                  openModal(
                                                                                      null,
                                                                                      false,
                                                                                      item.room.id,
                                                                                      { start: `${quickStartInput}:00.000`, end: `${quickEndInput}:00.000` }
                                                                                  );
                                                                                  closeQuickFinder();
                                                                              }}
                                                                              className="px-2.5 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-bold hover:bg-blue-100"
                                                                          >
                                                                              Tạo đơn
                                                                          </button>
                                                                      )}
                                                                  </div>
                                                              </td>
                                                          </tr>
                                                      ))}
                                                  </tbody>
                                              </table>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>

                      {holdTargetRoom && holdQuickRange && (
                          <>
                              <div className="absolute inset-0 bg-black/10 md:bg-transparent z-[2]" onClick={handleCloseHoldModal}></div>
                              <aside className="absolute inset-y-0 right-0 z-[3] w-full md:w-[350px] bg-white border-l border-gray-200 shadow-2xl p-3 md:p-3.5 overflow-y-auto animate-fade-in">
                                  <div className="flex items-center justify-between mb-3">
                                      <h4 className="text-sm font-bold text-gray-900">Giữ cọc phòng {holdTargetRoom.number}</h4>
                                      <button
                                          type="button"
                                          onClick={handleCloseHoldModal}
                                          className="w-6 h-6 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center"
                                      >
                                          <X size={13} />
                                      </button>
                                  </div>

                                  <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-2.5 mb-3">
                                      Khung giữ: <b>{formatStandardDateTime(holdQuickRange.startIso)}</b> → <b>{formatStandardDateTime(holdQuickRange.endIso)}</b>
                                  </div>

                                  <div className="space-y-3">
                                      <div>
                                          <label className="block text-[11px] font-bold uppercase text-gray-500 mb-1">Thời gian giữ cọc (phút)</label>
                                          <input
                                              type="number"
                                              min={1}
                                              max={30}
                                              value={holdMinutes}
                                              onChange={(e) => setHoldMinutes(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                                              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                                          />
                                          <p className="text-[11px] text-gray-500 mt-1">Tối thiểu 1 phút, tối đa 30 phút. Hết hạn sẽ tự xoá giữ cọc.</p>
                                      </div>

                                      <div>
                                          <label className="block text-[11px] font-bold uppercase text-gray-500 mb-1">Tên khách (tuỳ chọn)</label>
                                          <input
                                              type="text"
                                              value={holdGuestName}
                                              onChange={(e) => setHoldGuestName(e.target.value)}
                                              placeholder="Ví dụ: Anh Nam"
                                              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                                          />
                                      </div>

                                      <div>
                                          <label className="block text-[11px] font-bold uppercase text-gray-500 mb-1">Số điện thoại (tuỳ chọn)</label>
                                          <input
                                              type="text"
                                              value={holdGuestPhone}
                                              onChange={(e) => setHoldGuestPhone(e.target.value)}
                                              placeholder="Ví dụ: 09xxxxxxxx"
                                              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                                          />
                                      </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2 mt-4">
                                      <button
                                          type="button"
                                          onClick={handleCloseHoldModal}
                                          disabled={isSavingHold}
                                          className="py-2 rounded-lg border border-gray-300 bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 disabled:opacity-70"
                                      >
                                          Hủy
                                      </button>
                                      <button
                                          type="button"
                                          onClick={handleConfirmHoldBooking}
                                          disabled={isSavingHold}
                                          className="py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-70"
                                      >
                                          {isSavingHold ? 'Đang giữ...' : 'Xác nhận'}
                                      </button>
                                  </div>
                              </aside>
                          </>
                      )}
                  </div>
              </div>
          </div>,
          document.body
      )}

      {statusModal.isOpen && statusModal.room && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in relative" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setStatusModal({...statusModal, isOpen: false})} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${statusModal.targetStatus === RoomStatus.VACANT_CLEAN ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                      {statusModal.targetStatus === RoomStatus.VACANT_CLEAN ? <CheckCircle size={24} /> : <AlertTriangle size={24} />}
                  </div>
                  
                  <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                      Xác nhận đổi trạng thái
                  </h3>
                  
                  <div className="text-sm text-center mb-6 text-gray-600">
                      Bạn có chắc chắn muốn đổi phòng <b>{statusModal.room.number}</b> sang trạng thái <br/>
                      <span className={`font-bold ${statusModal.targetStatus === RoomStatus.VACANT_CLEAN ? 'text-green-600' : 'text-yellow-600'}`}>
                          {statusModal.targetStatus === RoomStatus.VACANT_CLEAN ? 'SẠCH (Sẵn sàng đón khách)' : 'BẨN (Cần dọn dẹp)'}
                      </span>?
                  </div>
                  
                  <div className="flex gap-3">
                      <button 
                          onClick={() => setStatusModal({...statusModal, isOpen: false})} 
                          className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors"
                      >
                          Huỷ bỏ
                      </button>
                      <button 
                          onClick={confirmStatusChange} 
                          className={`flex-1 py-2.5 text-white font-bold rounded-lg shadow-lg transition-colors ${statusModal.targetStatus === RoomStatus.VACANT_CLEAN ? 'bg-green-600 hover:bg-green-700 shadow-green-200' : 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-200'}`}
                      >
                          Xác nhận
                      </button>
                  </div>
              </div>
          </div>
      )}

      {moveConfirmModal && moveConfirmModal.isOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                  <div className="bg-blue-600 p-4 text-center">
                      <div className="w-16 h-16 bg-white/20 text-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-inner">
                          <CheckCircle size={32} />
                      </div>
                      <h3 className="text-xl font-bold text-white">Xác nhận chuyển lịch</h3>
                  </div>
                  
                  <div className="p-6">
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 space-y-3">
                          <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                              <span className="text-gray-500 font-medium text-sm">Khách hàng:</span>
                              <span className="font-bold text-gray-800">{moveConfirmModal.booking?.guestName}</span>
                          </div>
                          <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                              <span className="text-gray-500 font-medium text-sm">Chuyển sang phòng:</span>
                              <span className="text-lg font-black text-blue-700">{moveConfirmModal.newRoom?.number}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-500 font-medium">Nhận phòng mới:</span>
                              <span className="font-bold text-gray-800">{formatStandardDateTime(moveConfirmModal.newCheckIn)}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-500 font-medium">Trả phòng mới:</span>
                              <span className="font-bold text-gray-800">{formatStandardDateTime(moveConfirmModal.newCheckOut)}</span>
                          </div>
                      </div>

                      <div className="flex gap-3">
                          <button onClick={() => setMoveConfirmModal(null)} className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors">Huỷ bỏ</button>
                          <button onClick={confirmAndSaveMove} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-colors">Đồng ý chuyển</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {showModal && createPortal(
          <div className="katka-app katka-modal-scope fixed inset-0 z-[120] flex items-center justify-center p-1 md:p-2">
              <div className="absolute inset-0 katka-modal-backdrop" onClick={() => setShowModal(false)}></div>
              
              <div className="katka-focus-modal relative bg-white w-full max-w-[810px] max-h-[calc(100dvh-8px)] md:max-h-[calc(100dvh-16px)] md:rounded-2xl shadow-2xl flex flex-col animate-fade-in border-0 md:border border-gray-200 overflow-hidden">
                  
                  <div className="flex-shrink-0 p-2.5 md:p-3 border-b border-gray-100 flex justify-between items-center bg-white z-10 md:rounded-t-2xl">
                      <div>
                          <div className="flex items-center gap-2">
                              <h3 className="text-[15px] md:text-base font-bold text-gray-900 flex items-center gap-2">
                                  {isEditMode ? 'Chi tiết' : 'Tạo mới'}
                                  {bookingMeta.groupId && <span className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap"><Users size={12}/> Đoàn</span>}
                              </h3>
                              {isEditMode && (
                                  <button
                                      type="button"
                                      onClick={() => setShowBookingHistory(prev => !prev)}
                                      className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${showBookingHistory ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                                      title={showBookingHistory ? 'Thu gọn lịch sử thao tác đơn' : 'Mở lịch sử thao tác đơn'}
                                  >
                                      <Clock size={14} />
                                  </button>
                              )}
                          </div>
                          {bookingMeta.id && <p className="text-[10px] text-gray-400 font-mono mt-0.5">#{bookingMeta.id}</p>}
                      </div>
                      <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700 transition-colors bg-gray-100 border border-gray-300 rounded-full p-1.5 hover:bg-gray-200"><X size={18} /></button>
                  </div>
                  
                  <div className="flex-1 min-h-0 overflow-y-auto p-2 md:p-2.5 bg-white">
                      {isEditMode && showBookingHistory && (
                          <div className="bg-white border border-gray-200 rounded-xl mb-2.5 shadow-sm overflow-hidden">
                              <div className="px-2.5 py-1.5 flex items-center justify-between bg-gray-50 border-b border-gray-200">
                                  <span className="text-[11px] font-bold uppercase text-gray-700">Lịch sử thao tác đơn</span>
                                  <span className="text-xs font-semibold text-gray-500">{selectedBookingHistory.length} mục</span>
                              </div>

                              <div className="max-h-44 overflow-auto">
                                  {selectedBookingHistory.length === 0 ? (
                                      <p className="text-xs text-gray-400 italic text-center py-4">Chưa có lịch sử thao tác cho đơn này.</p>
                                  ) : (
                                      <table className="w-full text-left text-xs table-fixed">
                                          <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider sticky top-0">
                                              <tr>
                                                  <th className="px-3 py-2 font-bold w-[170px]">Thời gian</th>
                                                  <th className="px-3 py-2 font-bold w-[150px]">Người thao tác</th>
                                                  <th className="px-3 py-2 font-bold">Tên thao tác</th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100">
                                              {selectedBookingHistory.map(log => (
                                                  <tr key={log.id} className="hover:bg-gray-50">
                                                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatAuditDateTime(log.timestamp)}</td>
                                                      <td className="px-3 py-2 text-gray-700 font-semibold break-words">{getActorUsername(log)}</td>
                                                      <td className="px-3 py-2 font-semibold text-gray-900 whitespace-normal break-words">{getBookingOperationName(log)}</td>
                                                  </tr>
                                              ))}
                                          </tbody>
                                      </table>
                                  )}
                              </div>
                          </div>
                      )}

                      <div className="px-0.5 mb-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Thông tin cơ bản</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2.5">
                          <div className="bg-white p-2 rounded-xl border border-gray-100 shadow-sm">
                              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Khách hàng</label>
                              <input type="text" disabled={isReadOnly} className="w-full text-gray-900 font-semibold text-sm outline-none bg-transparent placeholder:text-gray-300" placeholder="Nhập tên khách..." value={bookingMeta.guestName} onChange={e => setBookingMeta({...bookingMeta, guestName: e.target.value})} />
                          </div>
                          <div className="bg-white p-2 rounded-xl border border-gray-100 shadow-sm">
                              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Số điện thoại</label>
                              <input type="text" disabled={isReadOnly} className="w-full text-gray-900 font-semibold text-sm outline-none bg-transparent placeholder:text-gray-300" placeholder="Nhập SĐT..." value={bookingMeta.guestPhone} onChange={e => setBookingMeta({...bookingMeta, guestPhone: e.target.value})} />
                          </div>
                      </div>

                      <div className="px-0.5 mb-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Chi tiết phòng</p>
                      </div>
                      <div className="bg-white border border-gray-200 rounded-xl mb-2.5 shadow-sm overflow-hidden">
                          <div
                            className="bg-white text-[10px] font-bold text-gray-500 px-3 py-2 uppercase tracking-wider hidden md:grid md:gap-3 items-center border-b border-gray-200"
                            style={{ gridTemplateColumns: bookingDetailGridTemplate }}
                          >
                            <div>Chi nhánh</div>
                            <div>Hạng</div>
                            <div>Phòng</div>
                            <div>Nhận</div>
                            <div>Trả</div>
                            <div className="text-center">#</div>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {bookingRows.map((row, idx) => (
                                <div
                                  key={row.tempId}
                                  className="p-2 md:px-2.5 md:py-1.5 hover:bg-gray-50 transition-colors flex flex-col md:grid md:gap-2 relative group items-center md:items-center"
                                  style={{ gridTemplateColumns: bookingDetailGridTemplate }}
                                >
                                    <div className="flex justify-between items-center md:hidden pb-2 border-b border-dashed border-gray-100 w-full mb-1">
                                        <span className="font-bold text-blue-600 text-xs">Phòng {idx + 1}</span>
                                        {!isReadOnly && <button onClick={() => handleRemoveRow(idx)} className="text-red-500 text-[10px] flex items-center gap-1"><Trash2 size={12}/> Xóa</button>}
                                    </div>

                                    <div className="w-full space-y-1 md:space-y-0 min-w-0">
                                        <span className="md:hidden text-[10px] text-gray-400 font-medium uppercase block">Chi nhánh</span>
                                        <select 
                                            disabled={isReadOnly} 
                                            className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-gray-700 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400 truncate" 
                                            value={row.tempPropId} 
                                            onChange={e => updateRow(idx, 'tempPropId', e.target.value)}
                                        >
                                            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </select>
                                    </div>

                                    <div className="w-full space-y-1 md:space-y-0 min-w-0">
                                        <span className="md:hidden text-[10px] text-gray-400 font-medium uppercase block">Hạng phòng</span>
                                        <select 
                                            disabled={isReadOnly} 
                                            className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-gray-700 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400 truncate" 
                                            value={row.tempTypeId} 
                                            onChange={e => updateRow(idx, 'tempTypeId', e.target.value)}
                                        >
                                            <option value="">-- Chọn --</option>
                                            {roomTypes.map(t => {
                                                const hasRoomsInBranch = rooms.some(r => r.propertyId === row.tempPropId && r.typeId === t.id);
                                                if (hasRoomsInBranch || !row.tempPropId) return <option key={t.id} value={t.id}>{t.name}</option>;
                                                return null;
                                            })}
                                        </select>
                                    </div>

                                    <div className="w-full space-y-1 md:space-y-0 min-w-0">
                                        <span className="md:hidden text-[10px] text-gray-400 font-medium uppercase block">Phòng</span>
                                        <select 
                                            disabled={isReadOnly} 
                                            className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" 
                                            value={row.roomId} 
                                            onChange={e => updateRow(idx, 'roomId', e.target.value)}
                                        >
                                            <option value="">--</option>
                                            {rooms.map(r => {
                                                if (row.tempPropId && r.propertyId !== row.tempPropId) return null;
                                                if (row.tempTypeId && r.typeId !== row.tempTypeId) return null;

                                                const check = DataService.validateRoomAvailability(r.id, row.checkIn, row.checkOut, row.bookingId);
                                                const isSelectedElsewhere = bookingRows.some((otherRow, otherIdx) => otherIdx !== idx && otherRow.roomId === r.id);
                                                if ((check.valid || r.id === row.roomId) && !isSelectedElsewhere) return <option key={r.id} value={r.id}>{r.number}</option>;
                                                return null;
                                            })}
                                        </select>
                                    </div>

                                    <div className="w-full space-y-1 md:space-y-0 min-w-0">
                                        <span className="md:hidden text-[10px] text-gray-400 font-medium uppercase block">Nhận phòng</span>
                                        <DateTimeControl disabled={isReadOnly} dateValue={row.checkIn} onChange={(val) => updateRow(idx, 'checkIn', val)} />
                                    </div>
                                    <div className="w-full space-y-1 md:space-y-0 min-w-0">
                                        <span className="md:hidden text-[10px] text-gray-400 font-medium uppercase block">Trả phòng</span>
                                        <DateTimeControl disabled={isReadOnly} dateValue={row.checkOut} onChange={(val) => updateRow(idx, 'checkOut', val)} />
                                    </div>
                                    <div className="w-full text-center text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded md:bg-transparent md:border-0 py-1.5 md:py-0 mt-1 md:mt-0 flex justify-between md:justify-center items-center px-2 md:px-0 gap-1">
                                        <span className="md:hidden text-[10px] text-gray-400">TG:</span>
                                        {getDurationText(row.checkIn, row.checkOut)}
                                        <div className="md:hidden">
                                            {!isReadOnly && <button onClick={() => handleRemoveRow(idx)} className="text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>}
                                        </div>
                                        {!isReadOnly && <button onClick={() => handleRemoveRow(idx)} className="hidden md:inline-flex text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>}
                                    </div>
                                </div>
                            ))}
                          </div>
                          {!isReadOnly && (
                            <button onClick={handleAddRow} className="w-full py-2 text-center text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors border-t border-blue-200 flex items-center justify-center gap-1.5">
                                <PlusCircle size={15} /> Thêm phòng vào đoàn
                            </button>
                          )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pb-1">
                          <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm space-y-2">
                              <h4 className="font-bold text-gray-800 text-[11px] flex items-center gap-1.5 uppercase tracking-wide border-b border-gray-100 pb-2"><Info size={12}/> Thanh toán</h4>
                              <div className="space-y-2">
                                  <div className="flex justify-between items-center">
                                      <label className="text-[10px] font-bold text-gray-500 uppercase">Tổng tiền phòng</label>
                                      <div className="w-28">
                                        <MoneyInput 
                                            className="w-full bg-white border border-gray-200 katka-money-primary p-1.5 rounded-md font-bold text-xs text-right outline-none focus:ring-1 focus:ring-blue-200"
                                            value={bookingMeta.totalPrice} 
                                            onChange={(val) => setBookingMeta(prev => ({ ...prev, totalPrice: val, isManualPrice: true }))}
                                            disabled={isReadOnly}
                                        />
                                      </div>
                                  </div>

                                  {extraRevenue > 0 && (
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-600 flex items-center gap-1"><ArrowUpCircle size={10} className="text-green-500"/> Phụ thu / Dịch vụ:</span>
                                        <span className="font-bold text-green-600">+{formatNumber(extraRevenue)}</span>
                                    </div>
                                  )}

                                  {extraExpense > 0 && (
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-600 flex items-center gap-1"><ArrowDownCircle size={10} className="text-red-500"/> Giảm trừ / Chi phí:</span>
                                        <span className="font-bold text-red-600">-{formatNumber(extraExpense)}</span>
                                    </div>
                                  )}
                                  
                                  <div className="border-t border-dashed border-gray-200 my-2"></div>

                                  <div className="flex justify-between items-center">
                                      <label className="text-xs font-extrabold text-gray-700 uppercase">TỔNG CỘNG</label>
                                      <span className="text-lg font-extrabold katka-money-primary tracking-tight">{formatNumber(grandTotal)} đ</span>
                                  </div>

                                  <div className="bg-blue-50/50 p-2.5 rounded-lg border border-blue-100 mt-2">
                                      <label className="block text-[9px] font-bold uppercase text-gray-700 mb-1">Khách đã trả</label>
                                      <MoneyInput 
                                            className="w-full bg-white border border-blue-200 katka-money-primary p-2 rounded-md font-bold text-base outline-none focus:ring-2 focus:ring-blue-200"
                                            value={bookingMeta.paidAmount || 0}
                                            onChange={(val) => setBookingMeta(prev => ({ ...prev, paidAmount: val }))}
                                            disabled={isReadOnly}
                                        />
                                  </div>

                                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                          <span className="text-[11px] font-extrabold uppercase tracking-wide text-red-600">Còn lại cần thu:</span>
                                          <span className="text-xl md:text-2xl font-black katka-money-danger leading-none whitespace-nowrap">
                                              {formatNumber((bookingMeta.totalPrice + extraRevenue) - (bookingMeta.paidAmount||0))}
                                              <span className="ml-1 text-base md:text-lg font-extrabold">đ</span>
                                          </span>
                                      </div>
                                  </div>
                              </div>
                          </div>
                          
                          <div className="space-y-2.5">
                              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                                  <div className="bg-white p-2.5 border-b border-gray-200 flex justify-between items-center">
                                      <h4 className="text-[11px] font-bold text-gray-700 uppercase flex items-center gap-2"><Wallet size={12}/> Dịch vụ & Phụ thu</h4>
                                  </div>
                                  {!isReadOnly && (
                                      <div className="p-2.5 bg-white grid grid-cols-1 md:grid-cols-[minmax(0,1.45fr)_minmax(88px,0.75fr)_auto] gap-1.5 items-center border-b border-dashed border-gray-200">
                                          <select 
                                              className="w-full min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] outline-none bg-white focus:border-blue-400"
                                              value={pendingFee.categoryId}
                                              onChange={e => setPendingFee({...pendingFee, categoryId: e.target.value})}
                                          >
                                              <option value="">-- Chọn loại phí / dịch vụ --</option>
                                              <optgroup label="Khoản Thu (Cộng thêm)">
                                                  {financeCategories.filter(c => c.type === 'REVENUE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                              </optgroup>
                                              <optgroup label="Khoản Chi (Giảm trừ)">
                                                  {financeCategories.filter(c => c.type === 'EXPENSE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                              </optgroup>
                                          </select>
                                          <MoneyInput 
                                              className="w-full min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] outline-none bg-white font-bold text-right focus:border-blue-400"
                                              placeholder="0"
                                              value={pendingFee.amount}
                                              onChange={v => setPendingFee({...pendingFee, amount: v})}
                                          />
                                          <button onClick={handleAddFee} className="shrink-0 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-bold hover:bg-blue-700 transition-colors whitespace-nowrap shadow-sm">Thêm</button>
                                      </div>
                                  )}
                                  <div className="divide-y divide-gray-100">
                                      {bookingMeta.extraFees.length === 0 && <p className="text-center text-gray-400 text-[11px] italic p-3">Chưa có dịch vụ thêm.</p>}
                                      {bookingMeta.extraFees.map(fee => (
                                          <div key={fee.id} className="p-2.5 flex justify-between items-center hover:bg-gray-50 text-sm">
                                              <div className="flex items-center gap-2">
                                                  {fee.type === 'REVENUE' ? <ArrowUpCircle size={14} className="text-green-500"/> : <ArrowDownCircle size={14} className="text-red-500"/>}
                                                  <span className="text-xs font-medium text-gray-700">{fee.name}</span>
                                              </div>
                                              <div className="flex items-center gap-3">
                                                  <span className={`font-bold text-xs ${fee.type === 'REVENUE' ? 'text-green-600' : 'text-red-600'}`}>
                                                      {fee.type === 'REVENUE' ? '+' : '-'}{formatNumber(fee.amount)}
                                                  </span>
                                                  {!isReadOnly && <button onClick={() => handleRemoveFee(fee.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14}/></button>}
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              </div>

                              <div className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm">
                                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1.5">Ghi chú</label>
                                  <textarea disabled={isReadOnly} className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs h-[64px] outline-none focus:ring-2 focus:ring-gray-200 resize-none" placeholder="Yêu cầu đặc biệt..." value={bookingMeta.notes} onChange={e => setBookingMeta({...bookingMeta, notes: e.target.value})}></textarea>
                              </div>
                              
                              <div className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm">
                                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-2">Thẻ (Tags)</label>
                                  <div className="flex flex-wrap gap-1.5">
                                      {tags.map(t => {
                                          const isSelected = bookingMeta.tags.includes(t.id);
                                          return (
                                              <button 
                                                key={t.id}
                                                onClick={() => !isReadOnly && toggleTag(t.id)}
                                                disabled={isReadOnly}
                                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${isSelected ? 'text-white shadow-sm' : 'text-gray-500 bg-white border-gray-200'} ${isReadOnly ? 'opacity-70 cursor-not-allowed' : ''}`}
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

                  <div className="flex-shrink-0 p-2 md:p-2.5 border-t border-gray-100 bg-white z-10 md:rounded-b-2xl">
                      <div className="flex flex-col md:flex-row justify-between items-center gap-2">
                          <div className="flex items-center gap-2 w-full md:w-auto">
                             {isEditMode && canEdit && (
                                <>
                                 <div className="relative flex-1 md:flex-none">
                                     <select 
                                        className="w-full md:w-36 appearance-none bg-white border border-gray-200 text-gray-700 font-bold py-2.5 pl-3 pr-8 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 text-xs shadow-sm" 
                                        value={bookingMeta.status} 
                                        onChange={e => setBookingMeta({...bookingMeta, status: e.target.value as any})}
                                     >
                                         <option value={BookingStatus.CONFIRMED}>CONFIRMED</option>
                                         <option value={BookingStatus.CHECKED_IN}>CHECKED_IN</option>
                                         <option value={BookingStatus.CHECKED_OUT}>CHECKED_OUT</option>
                                         <option value={BookingStatus.CANCELLED}>CANCELLED</option>
                                     </select>
                                     <ArrowUpDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                 </div>
                                 
                                 {canDelete && (
                                     !showDeleteConfirm ? (
                                        <button 
                                            type="button"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteClick(); }}
                                            className="px-3 py-2 text-red-600 bg-white hover:bg-red-50 rounded-lg shadow-sm transition-colors font-bold border border-gray-200 flex-shrink-0"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-1.5 bg-red-50 p-1 rounded-lg border border-red-100 animate-fade-in shadow-sm">
                                            <button onClick={handleConfirmDelete} className="px-2.5 py-1.5 bg-red-600 text-white text-[10px] font-bold rounded-md">Xóa thật</button>
                                            <button onClick={() => setShowDeleteConfirm(false)} className="px-2.5 py-1.5 bg-white border border-gray-300 text-gray-600 text-[10px] font-bold rounded-md">Hủy</button>
                                        </div>
                                    )
                                 )}
                                </>
                             )}
                          </div>
                          
                          <div className="flex gap-2 w-full md:w-auto">
                              <button onClick={() => setShowModal(false)} className="flex-1 md:flex-none px-4 py-2.5 text-gray-700 bg-gray-100 border border-gray-300 shadow-sm hover:bg-gray-200 rounded-lg font-bold text-xs transition-colors">Đóng</button>
                              {!isReadOnly && (
                                <button 
                                    onClick={handleSaveBooking} 
                                    disabled={isSubmitting}
                                    className={`flex-[2] md:flex-none px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold shadow-md shadow-blue-200 transition-all flex items-center justify-center gap-1.5 text-xs ${isSubmitting ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700 active:scale-95'}`}
                                >
                                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    <span>{isSubmitting ? 'Đang lưu...' : 'Lưu lại'}</span>
                                </button>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>,
          document.body
      )}

      {showTicketModal && receiptData && (
          <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4">
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
                                            <span className="font-medium">{formatStandardDateTime(room.checkIn)}</span>
                                            <span className="text-gray-500">Trả phòng:</span>
                                            <span className="font-medium">{formatStandardDateTime(room.checkOut)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t border-dashed border-gray-300 py-2">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-xs uppercase text-gray-500">Tổng tiền phòng</span>
                                    <span className="font-bold text-gray-900">{formatNumber(receiptData.roomPrice)}</span>
                                </div>
                            </div>

                            {receiptData.extraFees && receiptData.extraFees.length > 0 && (
                                <div className="border-t border-dashed border-gray-300 py-2 mb-2">
                                    <h5 className="font-bold text-xs uppercase text-gray-500 mb-2">Dịch vụ & Phụ thu</h5>
                                    <div className="space-y-1">
                                        {receiptData.extraFees.map((f: ExtraFee) => (
                                            <div key={f.id} className="flex justify-between text-xs">
                                                <span>{f.name}</span>
                                                <span className={f.type === 'REVENUE' ? 'text-gray-800' : 'text-red-500'}>
                                                    {f.type === 'REVENUE' ? '' : '-'}{formatNumber(f.amount)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

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
                                        <div className="text-xs text-gray-500 italic bg-gray-50 p-2 rounded border border-gray-100">
                                            {receiptData.notes}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-6 no-print">
                                <button 
                                    onClick={() => window.print()} 
                                    className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
                                >
                                    <Printer size={20}/> In phiếu xác nhận
                                </button>
                            </div>
                        </div>
                   </div>
               </div>
          </div>
      )}
    </div>
  );
};

export default RoomMap;
