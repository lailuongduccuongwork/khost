import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Room, RoomType, Booking, BookingStatus, RoomStatus, Customer, Property, Tag, User, PERMISSIONS, TransactionCategory, ExtraFee, UserRole, HistoryLog, RoomPolicyRule } from '../types';
import { DataService } from '../services/dataService';
import { LayoutGrid, List as ListIcon, Plus, X, Search, ChevronRight, ChevronLeft, Trash2, Calendar, Clock, Check, Info, PlusCircle, AlertTriangle, Tag as TagIcon, MapPin, Users, Lock, ArrowUpDown, ArrowUp, ArrowDown, Filter, MoreHorizontal, Receipt, Wallet, ArrowUpCircle, ArrowDownCircle, CheckCircle, User as UserIcon, Edit2, Building2, Loader2, LogIn, LogOut } from 'lucide-react';
import { isArchiveBucketRoom } from '../utils/roomBuckets';
import { deriveBookingStatus, deriveRoomOperationalStatus, getActiveBookingForRoom } from '../utils/bookingState';

// Declare html2canvas
declare const html2canvas: any;

interface RoomMapProps {
  rooms: Room[];
  roomTypes: RoomType[];
  roomPolicies: RoomPolicyRule[];
  bookings: Booking[];
  customers: Customer[];
  tags: Tag[];
  properties: Property[];
  onRefresh: () => void;
  onUpdateStatus?: (roomId: string, status: RoomStatus) => void | Promise<void>;
  currentProperty: Property;
  currentUser: User; 
  searchSeed?: string;
  searchSeedNonce?: number;
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

const formatCompactRoomDateTime = (isoStr?: string) => {
    if (!isoStr) return '--:--';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '--:--';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

const getBookingStatusLabel = (status: BookingStatus) => {
    switch (status) {
        case BookingStatus.CHECKED_IN:
            return 'Đang ở';
        case BookingStatus.CHECKED_OUT:
            return 'Đã trả';
        case BookingStatus.CONFIRMED:
            return 'Đã xác nhận';
        case BookingStatus.HOLD:
            return 'Giữ chỗ';
        case BookingStatus.DELETED:
            return 'Đã xóa';
        default:
            return status;
    }
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

const isExpiredHoldBooking = (booking: Booking, nowMs = Date.now()) => {
    if (!booking.isHold || !booking.holdUntil) return false;
    const holdUntilMs = new Date(booking.holdUntil).getTime();
    if (!Number.isFinite(holdUntilMs)) return false;
    return holdUntilMs <= nowMs;
};

const isActiveRoomMapBooking = (booking: Booking, nowMs = Date.now()) => {
    if (deriveBookingStatus(booking, nowMs) === BookingStatus.DELETED) return false;
    if (isExpiredHoldBooking(booking, nowMs)) return false;
    return true;
};

const getRoomMapFilterLabel = (status: string) => {
    if (status === 'ARRIVING') return 'Nhận trong khung';
    if (status === 'DEPARTING') return 'Trả trong khung';
    return 'Trong khung';
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
const RoomMap: React.FC<RoomMapProps> = ({ rooms, roomTypes, roomPolicies, bookings: _incomingBookings, customers, tags, properties, onRefresh: _onRefresh, onUpdateStatus, currentProperty, currentUser, searchSeed = '', searchSeedNonce = 0 }) => {
  const [viewType, setViewType] = useState<'GRID' | 'LIST'>('GRID');
  const [timelineMode, setTimelineMode] = useState<ViewMode>('WEEK');
  const [startDate, setStartDate] = useState(startOfDay(new Date())); 
  const [now, setNow] = useState(new Date());
  const [operationalBookings, setOperationalBookings] = useState<Booking[]>([]);
  const [isLoadingOperationalBookings, setIsLoadingOperationalBookings] = useState(false);
  const [quickBookings, setQuickBookings] = useState<Booking[]>([]);
  const [isLoadingQuickFinder, setIsLoadingQuickFinder] = useState(false);
  const operationalScopeRef = useRef('');

  const [sortConfig, setSortConfig] = useState<{key: keyof Booking, direction: 'asc' | 'desc'} | null>(null);
  const [financeCategories, setFinanceCategories] = useState<TransactionCategory[]>([]);

  useEffect(() => {
      const timer = setInterval(() => setNow(new Date()), 60000);
      return () => clearInterval(timer);
  }, []);

  useEffect(() => {
      if (searchSeedNonce === 0) return;
      setFilters(prev => ({ ...prev, search: searchSeed }));
  }, [searchSeed, searchSeedNonce]);

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
      typeId: 'ALL', roomId: 'ALL', status: 'IN_RANGE', search: ''
  });

  const [showModal, setShowModal] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false); 
  const [isEditMode, setIsEditMode] = useState(false);
  const [showBookingHistory, setShowBookingHistory] = useState(false);
  const [recentHistory, setRecentHistory] = useState<HistoryLog[]>([]);
  const [isLoadingRecentHistory, setIsLoadingRecentHistory] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); 
  const [isSubmitting, setIsSubmitting] = useState(false); 
  const [isDeletingBooking, setIsDeletingBooking] = useState(false);
  
  // DRAG & DROP CHO ĐƠN ĐÃ CÓ
  const [movingBookingId, setMovingBookingId] = useState<string | null>(null);
  const [isDraggingBooking, setIsDraggingBooking] = useState(false); 
  const [dragBookingAnchorSlots, setDragBookingAnchorSlots] = useState(0);
  const [hoveredDrop, setHoveredDrop] = useState<{roomId: string, time: Date} | null>(null);

  const [moveConfirmModal, setMoveConfirmModal] = useState<{
      isOpen: boolean, booking?: Booking, newRoom?: Room, newCheckIn?: Date, newCheckOut?: Date
  } | null>(null);
  const [isSavingMove, setIsSavingMove] = useState(false);

  const [statusModal, setStatusModal] = useState<{
      isOpen: boolean; room: Room | null; targetStatus: RoomStatus;
  }>({ isOpen: false, room: null, targetStatus: RoomStatus.VACANT_CLEAN });
  const [isSavingRoomStatus, setIsSavingRoomStatus] = useState(false);
  const [roomStatusOverrides, setRoomStatusOverrides] = useState<Record<string, RoomStatus>>({});

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
  const [modalAvailabilityBookings, setModalAvailabilityBookings] = useState<Booking[]>([]);
  const [isLoadingModalAvailability, setIsLoadingModalAvailability] = useState(false);
  const [showQuickFinder, setShowQuickFinder] = useState(false);
  const [quickRooms, setQuickRooms] = useState<Room[]>([]);
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

  const modalScopePropertyIds = useMemo(() => {
      if (!showModal) return [] as string[];

      const ids = bookingRows
          .map((row) => row.tempPropId || (currentProperty.id !== 'ALL' ? currentProperty.id : ''))
          .filter((propertyId): propertyId is string => !!propertyId);

      return Array.from(new Set(ids)).sort();
  }, [bookingRows, currentProperty.id, showModal]);

  const modalScopeKey = useMemo(() => modalScopePropertyIds.join('|'), [modalScopePropertyIds]);

  useEffect(() => {
      if (!showModal) {
          setModalAvailabilityBookings([]);
          setIsLoadingModalAvailability(false);
          return;
      }

      const scopedPropertyIds = modalScopeKey.split('|').filter(Boolean);
      if (scopedPropertyIds.length === 0) {
          setModalAvailabilityBookings([]);
          setIsLoadingModalAvailability(false);
          return;
      }

      let cancelled = false;
      setIsLoadingModalAvailability(true);

      DataService.loadBookingsForPropertiesView(scopedPropertyIds)
          .then((rows) => {
              if (cancelled) return;
              setModalAvailabilityBookings(rows);
          })
          .catch((error) => {
              if (cancelled) return;
              console.error('Booking modal availability load failed', error);
              setModalAvailabilityBookings([]);
          })
          .finally(() => {
              if (cancelled) return;
              setIsLoadingModalAvailability(false);
          });

      return () => {
          cancelled = true;
      };
  }, [showModal, modalScopeKey]);

  const activeModalAvailabilityBookings = useMemo(() => {
      const nowMs = now.getTime();
      return modalAvailabilityBookings.filter((booking) => {
          return isActiveRoomMapBooking(booking, nowMs);
      });
  }, [modalAvailabilityBookings, now]);

  const modalAvailableRoomIdsByRow = useMemo(() => {
      const rowsMap = new Map<string, Set<string>>();
      const bufferMs = 30 * 60 * 1000;

      bookingRows.forEach((row, rowIdx) => {
          const startMs = new Date(row.checkIn).getTime();
          const endMs = new Date(row.checkOut).getTime();
          const selectedElsewhere = new Set(
              bookingRows
                  .filter((otherRow, otherIdx) => otherIdx !== rowIdx && !!otherRow.roomId)
                  .map((otherRow) => otherRow.roomId)
          );

          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
              const fallback = new Set<string>();
              if (row.roomId) fallback.add(row.roomId);
              rowsMap.set(row.tempId, fallback);
              return;
          }

          const rowPropertyId = row.tempPropId || (row.roomId ? rooms.find((room) => room.id === row.roomId)?.propertyId : '');
          const rowTypeId = row.tempTypeId || (row.roomId ? rooms.find((room) => room.id === row.roomId)?.typeId : '');

          const conflicts = new Set<string>();
          activeModalAvailabilityBookings.forEach((booking) => {
              if (booking.id === row.bookingId) return;
              if (rowPropertyId && booking.propertyId && booking.propertyId !== rowPropertyId) return;

              const bookingStartMs = new Date(booking.checkInDate).getTime();
              const bookingEndMs = new Date(booking.checkOutDate).getTime();
              if (!Number.isFinite(bookingStartMs) || !Number.isFinite(bookingEndMs)) return;

              if (startMs < bookingEndMs + bufferMs && endMs + bufferMs > bookingStartMs) {
                  conflicts.add(booking.roomId);
              }
          });

          const availableRoomIds = new Set<string>();
          rooms.forEach((room) => {
              if (rowPropertyId && room.propertyId !== rowPropertyId) return;
              if (rowTypeId && room.typeId !== rowTypeId) return;
              if (conflicts.has(room.id)) return;
              if (selectedElsewhere.has(room.id)) return;
              availableRoomIds.add(room.id);
          });

          if (row.roomId) availableRoomIds.add(row.roomId);
          rowsMap.set(row.tempId, availableRoomIds);
      });

      return rowsMap;
  }, [activeModalAvailabilityBookings, bookingRows, rooms]);

  const roomMapBookings = operationalBookings;
  const activeRoomMapBookings = useMemo(() => {
      const nowMs = now.getTime();
      return roomMapBookings.filter((booking) => isActiveRoomMapBooking(booking, nowMs));
  }, [roomMapBookings, now]);

  const orphanRoomMapBookings = useMemo(() => {
      return activeRoomMapBookings.filter((booking) => {
          const room = rooms.find((item) => item.id === booking.roomId);
          return !room || isArchiveBucketRoom(room);
      });
  }, [activeRoomMapBookings, rooms]);
  const orphanRoomMapPreview = useMemo(() => {
      return orphanRoomMapBookings
          .slice(0, 5)
          .map((booking) => `${booking.id} (${booking.guestName || 'Khách lẻ'}, phòng ${booking.roomId || 'trống'})`)
          .join('; ');
  }, [orphanRoomMapBookings]);

  const operationalPropertyIds = useMemo(() => {
      if (currentProperty.id === 'ALL') {
          return properties
              .map((property) => property.id)
              .filter(Boolean)
              .sort();
      }
      return currentProperty.id ? [currentProperty.id] : [];
  }, [currentProperty.id, properties]);
  const operationalPropertyKey = useMemo(() => operationalPropertyIds.join('|'), [operationalPropertyIds]);

  const mergeOperationalBookings = (upserts: Booking[], deleteIds: string[] = []) => {
      const deleteIdSet = new Set(deleteIds.filter(Boolean));
      setOperationalBookings((current) => {
          const byId = new Map<string, Booking>();
          current.forEach((booking) => {
              if (!deleteIdSet.has(booking.id)) byId.set(booking.id, booking);
          });
          upserts.forEach((booking) => {
              if (booking?.id && !deleteIdSet.has(booking.id)) byId.set(booking.id, booking);
          });
          return Array.from(byId.values());
      });
  };

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
        if (isArchiveBucketRoom(r)) return false;
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

  useEffect(() => {
      setRoomStatusOverrides((current) => {
          const next: Record<string, RoomStatus> = {};
          rooms.forEach((room) => {
              if (current[room.id] && current[room.id] !== room.status) {
                  next[room.id] = current[room.id];
              }
          });
          return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
  }, [rooms]);

  const roomTypeNameById = useMemo(() => {
      const map = new Map<string, string>();
      roomTypes.forEach((type) => map.set(type.id, type.name));
      return map;
  }, [roomTypes]);

  const activeBookingsForQuick = useMemo(() => {
      const nowMs = now.getTime();
      return quickBookings.filter((booking) => {
          const room = quickRooms.find((item) => item.id === booking.roomId);
          if (!room || isArchiveBucketRoom(room)) return false;
          return isActiveRoomMapBooking(booking, nowMs);
      });
  }, [quickBookings, quickRooms, now]);

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
      return quickRooms.filter((room) => !isArchiveBucketRoom(room)).sort((a, b) => {
          const pOrderA = propertyById.get(a.propertyId)?.sortOrder ?? 9999;
          const pOrderB = propertyById.get(b.propertyId)?.sortOrder ?? 9999;
          if (pOrderA !== pOrderB) return pOrderA - pOrderB;
          const roomOrderA = a.sortOrder ?? 9999;
          const roomOrderB = b.sortOrder ?? 9999;
          if (roomOrderA !== roomOrderB) return roomOrderA - roomOrderB;
          return a.number.localeCompare(b.number, 'vi');
      });
  }, [quickRooms, propertyById]);

  useEffect(() => {
      if (!showQuickFinder) return;
      setQuickPropertyFilter(currentProperty.id === 'ALL' ? 'ALL' : currentProperty.id);
  }, [showQuickFinder, currentProperty.id]);

  const quickPropertyOptions = useMemo(() => {
      return [...properties].sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
  }, [properties]);

  const quickScopedPropertyIds = useMemo(() => {
      if (quickPropertyFilter === 'ALL') {
          return quickPropertyOptions.map((property) => property.id).filter(Boolean);
      }
      return quickPropertyFilter ? [quickPropertyFilter] : [];
  }, [quickPropertyFilter, quickPropertyOptions]);
  const quickScopeKey = useMemo(() => quickScopedPropertyIds.join('|'), [quickScopedPropertyIds]);

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
  const quickRangeKey = useMemo(() => {
      if (!quickRange.valid) return `invalid:${quickRange.message}`;
      return `${quickRange.startIso}|${quickRange.endIso}`;
  }, [quickRange]);

  useEffect(() => {
      if (!showQuickFinder) {
          setQuickBookings([]);
          setQuickRooms([]);
          setIsLoadingQuickFinder(false);
          return;
      }

      const scopedPropertyIds = quickScopeKey.split('|').filter(Boolean);
      if (!quickRange.valid || scopedPropertyIds.length === 0) {
          setQuickBookings([]);
          setQuickRooms([]);
          setIsLoadingQuickFinder(false);
          return;
      }

      let cancelled = false;
      setIsLoadingQuickFinder(true);

      Promise.all([
          DataService.loadRoomsForPropertiesView(scopedPropertyIds),
          DataService.fetchOperationalBookingsForProperties(
              scopedPropertyIds,
              quickRange.startIso,
              quickRange.endIso,
              30
          )
      ])
          .then(([roomRows, bookingRows]) => {
              if (cancelled) return;
              setQuickRooms(roomRows);
              setQuickBookings(bookingRows);
          })
          .catch((error) => {
              if (cancelled) return;
              console.error('Quick room finder load failed', error);
              setQuickRooms([]);
              setQuickBookings([]);
          })
          .finally(() => {
              if (cancelled) return;
              setIsLoadingQuickFinder(false);
          });

      return () => {
          cancelled = true;
      };
  }, [showQuickFinder, quickRangeKey, quickScopeKey]);

  const quickAvailabilityByProperty = useMemo(() => {
      if (!quickRange.valid) return [] as Array<{ propertyId: string; propertyName: string; rooms: Array<{ room: Room; roomTypeName: string; previousBooking?: Booking; nextBooking?: Booking }> }>;

      const grouped = new Map<string, { propertyId: string; propertyName: string; rooms: Array<{ room: Room; roomTypeName: string; previousBooking?: Booking; nextBooking?: Booking }> }>();
      const { startMs, endMs } = quickRange as {
          valid: true;
          startMs: number;
          endMs: number;
      };

      roomsSortedForQuick.forEach((room) => {
          if (quickPropertyFilter !== 'ALL' && room.propertyId !== quickPropertyFilter) return;
          const roomBookings = quickBookingsByRoom.get(room.id) || [];
          const hasConflict = roomBookings.some((booking) => {
              const bookingStartMs = new Date(booking.checkInDate).getTime();
              const bookingEndMs = new Date(booking.checkOutDate).getTime();
              return bookingStartMs < endMs && bookingEndMs > startMs;
          });
          if (hasConflict) return;
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

  const refreshOperationalBookings = async () => {
      if (operationalPropertyIds.length === 0) {
          setOperationalBookings([]);
          return;
      }
      setIsLoadingOperationalBookings(true);
      try {
          const next = await DataService.fetchOperationalBookingsForProperties(
              operationalPropertyIds,
              viewStart.toISOString(),
              viewEnd.toISOString(),
              14
          );
          setOperationalBookings(next);
      } catch (error) {
          console.error('Load operational bookings failed', error);
          setOperationalBookings([]);
      } finally {
          setIsLoadingOperationalBookings(false);
      }
  };

  useEffect(() => {
      if (operationalPropertyIds.length === 0) {
          if (currentProperty.id === 'ALL' && properties.length === 0) {
              setIsLoadingOperationalBookings(true);
              return;
          }
          setOperationalBookings([]);
          setIsLoadingOperationalBookings(false);
          return;
      }

      const scopeKey = `${operationalPropertyKey}|${viewStart.toISOString()}|${viewEnd.toISOString()}`;
      operationalScopeRef.current = scopeKey;
      setIsLoadingOperationalBookings(true);
      return DataService.subscribeOperationalBookings(
          operationalPropertyIds,
          viewStart.toISOString(),
          viewEnd.toISOString(),
          (next) => {
              if (operationalScopeRef.current !== scopeKey) return;
              setOperationalBookings(next);
              setIsLoadingOperationalBookings(false);
          },
          (error) => {
              if (operationalScopeRef.current !== scopeKey) return;
              console.error('Load operational bookings failed', error);
              setOperationalBookings([]);
              setIsLoadingOperationalBookings(false);
          },
          14
      );
  }, [operationalPropertyKey, viewStart.getTime(), viewEnd.getTime(), currentProperty.id, properties.length]);

  const filteredBookings = useMemo(() => {
    let res = activeRoomMapBookings.filter((b) => {
        const room = rooms.find((item) => item.id === b.roomId);
        return !!room && !isArchiveBucketRoom(room);
    }); 
    if (filters.search) {
        const lower = filters.search.toLowerCase();
        res = res.filter((b) => {
            const room = rooms.find((item) => item.id === b.roomId);
            const roomNumber = (room?.number || '').toLowerCase();
            const roomTypeName = room ? (roomTypeNameById.get(room.typeId) || '').toLowerCase() : '';
            const propertyName = room ? (propertyById.get(room.propertyId)?.name || '').toLowerCase() : '';
            return (
                (b.guestName || '').toLowerCase().includes(lower) ||
                (b.guestPhone || '').toLowerCase().includes(lower) ||
                (b.id || '').toLowerCase().includes(lower) ||
                roomNumber.includes(lower) ||
                roomTypeName.includes(lower) ||
                propertyName.includes(lower)
            );
        });
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
  }, [activeRoomMapBookings, filters, viewStart, viewEnd, rooms, roomTypeNameById, propertyById, now]);

  const filteredBookingsByRoom = useMemo(() => {
      const map = new Map<string, Booking[]>();
      filteredBookings.forEach((booking) => {
          if (!map.has(booking.roomId)) map.set(booking.roomId, []);
          map.get(booking.roomId)!.push(booking);
      });
      return map;
  }, [filteredBookings]);

  const bookingLayoutByRoom = useMemo(() => {
      const layout = new Map<string, { laneCount: number; byBookingId: Map<string, { lane: number }> }>();

      filteredBookingsByRoom.forEach((roomBookings, roomId) => {
          const sortedRoomBookings = [...roomBookings].sort((a, b) => {
              const startDiff = new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime();
              if (startDiff !== 0) return startDiff;
              return new Date(b.checkOutDate).getTime() - new Date(a.checkOutDate).getTime();
          });

          const laneEndTimes: number[] = [];
          const byBookingId = new Map<string, { lane: number }>();

          sortedRoomBookings.forEach((booking) => {
              const bookingStart = new Date(booking.checkInDate).getTime();
              const bookingEnd = new Date(booking.checkOutDate).getTime();
              let laneIndex = laneEndTimes.findIndex((laneEnd) => laneEnd <= bookingStart);
              if (laneIndex === -1) laneIndex = laneEndTimes.length;
              laneEndTimes[laneIndex] = bookingEnd;
              byBookingId.set(booking.id, { lane: laneIndex });
          });

          layout.set(roomId, {
              laneCount: Math.max(1, laneEndTimes.length),
              byBookingId,
          });
      });

      return layout;
  }, [filteredBookingsByRoom]);

  const roomOperationalInsights = useMemo(() => {
      const nowMs = now.getTime();
      const map = new Map<string, { activeBooking: Booking | null; nextBooking: Booking | null }>();

      rooms.forEach((room) => {
          const roomBookings = roomMapBookings.filter((booking) => booking.roomId === room.id && isActiveRoomMapBooking(booking, nowMs));
          const activeBooking = getActiveBookingForRoom(roomBookings, room.id, nowMs);
          const nextBooking = roomBookings
              .filter((booking) => deriveBookingStatus(booking, nowMs) === BookingStatus.CONFIRMED && new Date(booking.checkInDate).getTime() > nowMs)
              .sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime())[0] || null;

          map.set(room.id, { activeBooking, nextBooking });
      });

      return map;
  }, [rooms, roomMapBookings, now]);

  const roomTrustSummary = useMemo(() => {
      const summary = {
          occupied: 0,
          dirty: 0,
          clean: 0,
          arriving: 0,
          departing: 0,
      };

      sortedRooms.forEach((room) => {
          if (room.status === RoomStatus.OCCUPIED) summary.occupied += 1;
          if (room.status === RoomStatus.VACANT_DIRTY) summary.dirty += 1;
          if (room.status === RoomStatus.VACANT_CLEAN) summary.clean += 1;

          const insight = roomOperationalInsights.get(room.id);
          if (insight?.nextBooking) summary.arriving += 1;
          if (insight?.activeBooking) {
              const checkOutMs = new Date(insight.activeBooking.checkOutDate).getTime();
              if (checkOutMs >= viewStart.getTime() && checkOutMs < viewEnd.getTime()) {
                  summary.departing += 1;
              }
          }
      });

      return summary;
  }, [sortedRooms, roomOperationalInsights, viewStart, viewEnd]);

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

  const hasSearchOrStatusFilter = filters.search.trim().length > 0 || filters.status !== 'IN_RANGE';

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

  const bookingsByGroupId = useMemo(() => {
      const nowMs = now.getTime();
      const map = new Map<string, Booking[]>();
      activeRoomMapBookings
          .filter((booking) => booking.groupId)
          .forEach((booking) => {
              const groupId = booking.groupId!;
              if (!map.has(groupId)) map.set(groupId, []);
              map.get(groupId)!.push(booking);
          });

      map.forEach((groupBookings) => {
          groupBookings.sort((a, b) => a.id.localeCompare(b.id));
      });

      return map;
  }, [activeRoomMapBookings, now]);

  const getBookingFinancialSummary = (booking: Booking) => {
      if (!booking.groupId) {
          const totalBill = Number(booking.totalPrice) || 0;
          const paidAmount = Number(booking.paidAmount) || 0;
          const outstanding = Math.max(totalBill - paidAmount, 0);
          return {
              totalBill,
              paidAmount,
              outstanding,
              isGroupedChild: false,
          };
      }

      const groupBookings = bookingsByGroupId.get(booking.groupId) || [booking];
      const leader = groupBookings[0];
      const isLeader = leader?.id === booking.id;

      if (!isLeader) {
          return {
              totalBill: 0,
              paidAmount: 0,
              outstanding: 0,
              isGroupedChild: true,
          };
      }

      const leaderFees = leader.extraFees || [];
      const extraExpense = leaderFees
          .filter((fee) => fee.type === 'EXPENSE')
          .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
      const netRevenue = groupBookings.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
      const paidAmount = groupBookings.reduce((sum, item) => sum + (Number(item.paidAmount) || 0), 0);
      const totalBill = netRevenue + extraExpense;
      const outstanding = Math.max(totalBill - paidAmount, 0);

      return {
          totalBill,
          paidAmount,
          outstanding,
          isGroupedChild: false,
      };
  };

  const handleSort = (key: keyof Booking) => {
      let direction: 'asc' | 'desc' = 'desc'; 
      if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
      setSortConfig({ key, direction });
  };

  const SortIcon = ({ colKey }: { colKey: keyof Booking }) => {
      if (sortConfig?.key !== colKey) return <ArrowUpDown size={14} className="ml-1 opacity-30" />;
      return sortConfig.direction === 'asc' ? <ArrowUp size={14} className="ml-1 text-blue-600" /> : <ArrowDown size={14} className="ml-1 text-blue-600" />;
  };

  const getRoomMapEffectiveStatus = (room: Room) => {
      const insight = roomOperationalInsights.get(room.id);
      const overriddenRoom = roomStatusOverrides[room.id]
          ? { ...room, status: roomStatusOverrides[room.id] }
          : room;
      return deriveRoomOperationalStatus(overriddenRoom, insight?.activeBooking ? [insight.activeBooking] : [], now.getTime());
  };

  const handleStatusIconClick = (room: Room) => {
      if (!canManageRooms) return; 
      const insight = roomOperationalInsights.get(room.id);
      if (insight?.activeBooking) {
          alert('Phòng đang có booking active trong khung hiện tại. Không đổi sạch/bẩn trực tiếp từ sơ đồ để tránh sai trạng thái.');
          return;
      }
      const effectiveStatus = getRoomMapEffectiveStatus(room);
      const targetStatus = effectiveStatus === RoomStatus.VACANT_CLEAN ? RoomStatus.VACANT_DIRTY : RoomStatus.VACANT_CLEAN;
      setStatusModal({ isOpen: true, room: room, targetStatus: targetStatus });
  };

  const confirmStatusChange = async () => {
      if (!statusModal.room || isSavingRoomStatus) return;
      setIsSavingRoomStatus(true);
      try {
          if (onUpdateStatus) {
              await onUpdateStatus(statusModal.room.id, statusModal.targetStatus);
          } else {
              await Promise.resolve(DataService.updateRoomStatus(statusModal.room.id, statusModal.targetStatus));
          }
          setRoomStatusOverrides((current) => ({
              ...current,
              [statusModal.room!.id]: statusModal.targetStatus,
          }));
          setStatusModal({ isOpen: false, room: null, targetStatus: RoomStatus.VACANT_CLEAN });
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không thể cập nhật trạng thái phòng.';
          alert(message);
      } finally {
          setIsSavingRoomStatus(false);
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

  const currentTimeLeftPercent = useMemo(() => {
      const startMs = viewportStartMs;
      const endMs = viewportEndMs;
      const currentMs = now.getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      if (currentMs < startMs || currentMs > endMs) return null;
      return ((currentMs - startMs) / (endMs - startMs)) * 100;
  }, [now, viewportStartMs, viewportEndMs]);

  const renderCurrentTimeLine = (extraClassName = '') => {
      if (currentTimeLeftPercent === null) return null;
      return (
          <div
              className={`pointer-events-none absolute top-0 bottom-0 z-[35] w-px border-l border-dashed border-blue-500/80 ${extraClassName}`}
              style={{ left: `${currentTimeLeftPercent}%` }}
              aria-hidden="true"
          />
      );
  };

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

  const getHourlyOnlyViolation = (roomId: string, checkIn: Date, checkOut: Date) => {
      const durationHours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
      if (durationHours <= 12) return null;

      const windows = roomPolicyWindowsByRoom.get(roomId) || [];
      const overlapsHourlyWindow = windows.some((window) =>
          window.mode === 'HOURLY_ONLY' &&
          window.endMs > checkIn.getTime() &&
          window.startMs < checkOut.getTime()
      );
      if (!overlapsHourlyWindow) return null;

      const room = rooms.find((item) => item.id === roomId);
      return `Phòng ${room?.number || roomId} chỉ nhận khách giờ trong khung này, tổng thời gian lưu trú không được vượt quá 12 tiếng.`;
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
              const nowMs = now.getTime();
              groupBookings = roomMapBookings.filter(b => b.groupId === booking.groupId && isActiveRoomMapBooking(b, nowMs));
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
                tempPropId: currentRoom?.propertyId || b.propertyId || (currentProperty.id !== 'ALL' ? currentProperty.id : ''), tempTypeId: currentRoom?.typeId || '',
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
          
          const defaultPropertyId = currentProperty.id === 'ALL' ? '' : currentProperty.id;
          const initPropId = defaultRoomId ? rooms.find(r=>r.id===defaultRoomId)?.propertyId : defaultPropertyId;
          const initTypeId = defaultRoomId ? rooms.find(r=>r.id===defaultRoomId)?.typeId : '';

          setBookingRows([{ tempId: 'init', roomId: defaultRoomId || '', tempPropId: initPropId, tempTypeId: initTypeId, checkIn: checkIn, checkOut: checkOut, price: 0 }]);
      }
      setShowModal(true);
  };

  const handleAddRow = () => {
      const lastRow = bookingRows[bookingRows.length - 1];
      const defaultPropertyId = lastRow?.tempPropId || (currentProperty.id === 'ALL' ? '' : currentProperty.id);
      const defaultTypeId = lastRow?.tempTypeId || '';
      setBookingRows([...bookingRows, { tempId: `row-${Date.now()}`, roomId: '', tempPropId: defaultPropertyId, tempTypeId: defaultTypeId, checkIn: lastRow.checkIn, checkOut: lastRow.checkOut, price: 0 }]);
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

          const validate = await DataService.validateRoomAvailabilityRemote(
              holdTargetRoom.propertyId,
              holdTargetRoom.id,
              startIso,
              endIso
          );
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
              status: BookingStatus.HOLD,
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

  const handleMouseUp = async () => {
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

      const draggedRoom = rooms.find((room) => room.id === dragStart.roomId);
      if (!draggedRoom) {
          setDragStart(null);
          setDragEnd(null);
          return;
      }
      const hourlyOnlyViolation = getHourlyOnlyViolation(dragStart.roomId, checkIn, checkOut);
      if (hourlyOnlyViolation) {
          alert(`🚫 Không thể tạo đơn!\nLý do: ${hourlyOnlyViolation}`);
          setDragStart(null);
          setDragEnd(null);
          return;
      }
      const validate = await DataService.validateRoomAvailabilityRemote(
          draggedRoom.propertyId,
          dragStart.roomId,
          checkIn.toISOString(),
          checkOut.toISOString()
      );
      if (!validate.valid) {
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

  const handleBookingDrop = async (e: React.DragEvent, targetRoomId: string, targetDate: Date) => {
      e.preventDefault(); e.stopPropagation(); 
      setMovingBookingId(null); setIsDraggingBooking(false); setHoveredDrop(null); setDragBookingAnchorSlots(0);

      const bookingId = e.dataTransfer.getData('text/plain') || movingBookingId;
      if (!bookingId) return;

      const booking = roomMapBookings.find(b => b.id === bookingId);
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

      const hourlyOnlyViolation = getHourlyOnlyViolation(targetRoomId, newCheckIn, newCheckOut);
      if (hourlyOnlyViolation) return alert(`🚫 Không thể chuyển phòng!\nLý do: ${hourlyOnlyViolation}`);

      const validate = await DataService.validateRoomAvailabilityRemote(
          targetRoom.propertyId,
          targetRoomId,
          newCheckIn.toISOString(),
          newCheckOut.toISOString(),
          booking.id
      );
      if (!validate.valid) return alert(`🚫 Không thể chuyển phòng!\nLý do: ${validate.reason}`);

      setMoveConfirmModal({ isOpen: true, booking, newRoom: targetRoom, newCheckIn, newCheckOut });
  };

  const confirmAndSaveMove = async () => {
      if (isSavingMove || !moveConfirmModal || !moveConfirmModal.booking || !moveConfirmModal.newRoom) return;
      const { booking, newRoom, newCheckIn, newCheckOut } = moveConfirmModal;
      setIsSavingMove(true);
      try {
          const latestBooking = await DataService.fetchBookingById(booking.id);
          if (!latestBooking || deriveBookingStatus(latestBooking, now.getTime()) === BookingStatus.DELETED) {
              throw new Error(`Đơn ${booking.id} đã bị xóa hoặc không còn tồn tại. Vui lòng tải lại dữ liệu.`);
          }

          const validate = await DataService.validateRoomAvailabilityRemote(
              newRoom.propertyId,
              newRoom.id,
              newCheckIn!.toISOString(),
              newCheckOut!.toISOString(),
              latestBooking.id
          );
          if (!validate.valid) {
              throw new Error(validate.reason || 'Phòng không còn khả dụng cho khung thời gian này.');
          }

          const updatedBooking = { ...latestBooking, roomId: newRoom.id, propertyId: newRoom.propertyId, checkInDate: newCheckIn!.toISOString(), checkOutDate: newCheckOut!.toISOString() };
          await DataService.updateBooking(updatedBooking);
          mergeOperationalBookings([updatedBooking]);
          setMoveConfirmModal(null);
      } catch (error) {
          console.error('Room move failed', { bookingId: booking.id, targetRoomId: newRoom.id, error });
          const message = error instanceof Error ? error.message : 'Không thể cập nhật đơn khi kéo thả.';
          alert(`Không thể chuyển phòng:\n${message}`);
      } finally {
          setIsSavingMove(false);
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

  useEffect(() => {
      let cancelled = false;

      if ((!isEditMode || !showBookingHistory) && !statusModal.isOpen) {
          setRecentHistory([]);
          setIsLoadingRecentHistory(false);
          return;
      }

      setIsLoadingRecentHistory(true);
      DataService.fetchRecentHistory(80)
          .then((logs) => {
              if (!cancelled) {
                  setRecentHistory(logs);
              }
          })
          .finally(() => {
              if (!cancelled) {
                  setIsLoadingRecentHistory(false);
              }
          });

      return () => {
          cancelled = true;
      };
  }, [isEditMode, showBookingHistory, statusModal.isOpen, bookingMeta.id, bookingMeta.groupId, originalBookingIds.join('|')]);

  const selectedBookingHistory = useMemo(() => {
      if (!isEditMode) return [];

      const targetBookingIds = new Set<string>();
      if (bookingMeta.id) targetBookingIds.add(bookingMeta.id);
      originalBookingIds.forEach(id => targetBookingIds.add(id));
      bookingRows.forEach(row => {
          if (row.bookingId) targetBookingIds.add(row.bookingId);
      });

      const targetGroupId = bookingMeta.groupId;

      return recentHistory
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
  }, [recentHistory, isEditMode, bookingMeta.id, bookingMeta.groupId, originalBookingIds, bookingRows]);

  const selectedRoomStatusHistory = useMemo(() => {
      if (!statusModal.room) return [];

      return recentHistory
          .filter((log) => {
              const entityType = log.entityType || 'SYSTEM';
              if (entityType !== 'ROOM') return false;
              if (log.action !== 'STATUS_CHANGE') return false;

              const metadata = (log.metadata || {}) as Record<string, any>;
              const roomId = log.entityId || metadata.roomId || (log.after as any)?.id || (log.before as any)?.id;
              return roomId === statusModal.room?.id;
          })
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 8);
  }, [recentHistory, statusModal.room]);

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

     for (const [idx, row] of validRows.entries()) {
         const room = rooms.find(r => r.id === row.roomId);
         const startTime = new Date(row.checkIn).getTime();
         const endTime = new Date(row.checkOut).getTime();
         if (startTime >= endTime) return alert(`Lỗi thời gian (Phòng ${room?.number || row.roomId}):\nThời gian Trả phòng phải lớn hơn thời gian Nhận phòng.\nVui lòng kiểm tra lại.`);
         const rowRoom = rooms.find(r => r.id === row.roomId);
         if (!rowRoom) return alert(`Không tìm thấy phòng cho dòng ${idx + 1}.`);
         if (row.tempPropId && rowRoom.propertyId !== row.tempPropId) {
             return alert(`Lỗi chọn phòng (Dòng ${idx + 1}):\nPhòng ${rowRoom.number} không thuộc chi nhánh đã chọn. Vui lòng chọn lại phòng.`);
         }
         if (row.tempTypeId && rowRoom.typeId !== row.tempTypeId) {
             return alert(`Lỗi chọn phòng (Dòng ${idx + 1}):\nPhòng ${rowRoom.number} không thuộc hạng phòng đã chọn. Vui lòng chọn lại phòng.`);
         }
         const availability = await DataService.validateRoomAvailabilityRemote(
             rowRoom.propertyId,
             row.roomId,
             row.checkIn,
             row.checkOut,
             row.bookingId
         );
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
                 const existingBooking = roomMapBookings.find(b => b.id === row.bookingId);
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
         mergeOperationalBookings(upserts.map((item) => item.booking), idsToDelete);

         const receiptRooms = validRows.map(row => {
             const room = rooms.find(r => r.id === row.roomId);
             const type = roomTypes.find(t => t.id === room?.typeId);
             const prop = properties.find(p => p.id === room?.propertyId); 
             return { roomNumber: room?.number || 'N/A', typeName: type?.name || 'N/A', branchName: prop?.name || 'N/A', checkIn: row.checkIn, checkOut: row.checkOut };
         });
         
         const selectedTags = tags.filter(t => bookingMeta.tags.includes(t.id));
         const receiptFees = bookingMeta.extraFees.filter(f => f.type === 'REVENUE');
         const receiptTotal = bookingMeta.totalPrice + extraRevenue;
         const receiptBookingCodes = upserts.map(item => item.booking.id).filter(Boolean);
         const primaryBranchName = receiptRooms[0]?.branchName || currentProperty.name || 'K-Host';
         const receiptIssuer = (currentUser.fullName || currentUser.username || 'K-Host').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'K-Host';

         setReceiptData({
             guestName: bookingMeta.guestName || 'Khách lẻ', guestPhone: bookingMeta.guestPhone || '', notes: bookingMeta.notes,
             tags: selectedTags, total: receiptTotal, paid: bookingMeta.paidAmount, rooms: receiptRooms, extraFees: receiptFees, roomPrice: bookingMeta.totalPrice,
             bookingCode: receiptBookingCodes[0] || '--',
             roomCount: receiptRooms.length,
             branchName: primaryBranchName,
             issuedAt: new Date().toISOString(),
             issuedBy: receiptIssuer,
             mode: isEditMode ? 'UPDATE' : 'CREATE'
         });

         setShowModal(false);
         setShowTicketModal(true);
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
      if (isDeletingBooking) return;
      const idsToDelete = originalBookingIds.length > 0 ? originalBookingIds : (bookingMeta.id ? [bookingMeta.id] : []);
      if (idsToDelete.length === 0) return;
      setIsDeletingBooking(true);
      try {
          let successCount = 0;
          for (const id of idsToDelete) {
              if (await DataService.deleteBooking(id, currentUser.id)) successCount++;
          }
          if (successCount > 0) {
              mergeOperationalBookings([], idsToDelete);
              alert(`Đã xóa ${successCount} đơn thành công!`); setShowDeleteConfirm(false); setShowModal(false);
          } else {
              console.error('Booking delete failed: no matching booking was deleted', { idsToDelete });
              alert("Không thể xóa đơn: đơn đã bị xóa hoặc không còn tồn tại trong dữ liệu hiện tại.");
              setShowDeleteConfirm(false);
          }
      } catch (error) {
          console.error('Booking delete failed', { idsToDelete, error });
          const message = error instanceof Error ? error.message : 'Không thể xóa đơn.';
          alert(`Không thể xóa đơn:\n${message}`);
          setShowDeleteConfirm(false);
      } finally {
          setIsDeletingBooking(false);
      }
  };

  const toggleTag = (tagId: string) => { setBookingMeta(prev => { const exists = prev.tags.includes(tagId); return { ...prev, tags: exists ? prev.tags.filter(t => t !== tagId) : [...prev.tags, tagId] }; }); };

  const getBookingStyle = (booking: Booking) => {
     if (booking.isHold) {
         return "room-booking-chip room-booking-chip-hold absolute rounded-md text-[10px] px-1 overflow-hidden cursor-pointer shadow-sm flex flex-col justify-center transition-all hover:scale-[1.02] z-[5] border bg-amber-500/90 text-white border-amber-600 shadow-amber-200";
     }
     const { outstanding } = getBookingFinancialSummary(booking);
     const isPaid = outstanding <= 0;
     let classes = "room-booking-chip absolute rounded-md text-[10px] px-1 overflow-hidden cursor-pointer shadow-sm flex flex-col justify-center transition-all hover:scale-[1.02] z-[5] border ";
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
  const roomColumnWidthClass = 'w-[112px] md:w-[148px]';

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
                          <option value="IN_RANGE">Trong khung</option>
                          <option value="ARRIVING">Nhận trong khung</option>
                          <option value="DEPARTING">Trả trong khung</option>
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
                        placeholder="Khách, phòng, hạng..."
                        value={filters.search}
                        onChange={e => setFilters({...filters, search: e.target.value})}
                     />
                 </div>

                 {hasSearchOrStatusFilter && (
                    <button
                        type="button"
                        onClick={() => setFilters((prev) => ({ ...prev, search: '', status: 'IN_RANGE' }))}
                        className="h-10 px-2.5 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                        title="Xóa tìm kiếm và đưa về trạng thái đang lưu trú"
                    >
                        <X size={14} />
                        Xóa lọc
                    </button>
                 )}

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

                 {isLoadingOperationalBookings && (
                    <div className="h-10 px-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Loader2 size={14} className="animate-spin" />
                        Đang cập nhật lịch
                    </div>
                 )}

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
          <div className="roommap-summary-bar border-b border-gray-100 px-3 py-1.5">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap text-[11px] md:text-xs text-slate-600">
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">
                      {getRoomMapFilterLabel(filters.status)}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-bold text-red-700">
                      <span className="h-2 w-2 rounded-full bg-red-500"></span>Ở {roomTrustSummary.occupied}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-bold text-yellow-700">
                      <span className="h-2 w-2 rounded-full bg-yellow-400"></span>Dọn {roomTrustSummary.dirty}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-bold text-green-700">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>Sẵn sàng {roomTrustSummary.clean}
                  </span>
                  <span className="h-4 w-px shrink-0 bg-slate-200"></span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-bold text-blue-700">
                      <span className="h-2 w-2 rounded-full bg-blue-500"></span>Vào {roomTrustSummary.arriving}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-bold text-orange-700">
                      <span className="h-2 w-2 rounded-full bg-orange-500"></span>Ra {roomTrustSummary.departing}
                  </span>
              </div>
          </div>
          {viewType === 'GRID' ? (
             <div className="flex-1 overflow-auto no-scrollbar relative bg-white">
                 {isLoadingOperationalBookings && (
                    <div className="sticky top-0 z-[60] border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Đang tải lại lịch theo chi nhánh và khung ngày. Nếu lưới đang trống, vui lòng chờ cập nhật xong.
                    </div>
                 )}
                 {orphanRoomMapBookings.length > 0 && (
                    <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">
                        Có {orphanRoomMapBookings.length} đơn chưa khớp phòng nên chưa đặt được lên sơ đồ.
                        {orphanRoomMapPreview && <span className="ml-1 font-semibold">Mẫu: {orphanRoomMapPreview}{orphanRoomMapBookings.length > 5 ? '...' : ''}</span>}
                    </div>
                 )}
                 {filteredBookings.length === 0 && hasSearchOrStatusFilter && (
                    <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                        Không có booking nào khớp bộ lọc hiện tại trong khung này. Bộ lọc chỉ áp dụng cho booking, các dòng phòng vẫn hiển thị để đối chiếu.
                    </div>
                 )}
                 {sortedRooms.length === 0 && (
                    <div className="m-4 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
                        Không có phòng để hiển thị. Hãy kiểm tra chi nhánh đang chọn, quyền xem chi nhánh hoặc cấu hình phòng.
                    </div>
                 )}
                 <div style={{minWidth: timelineMode === 'MONTH' ? '2000px' : timelineMode === 'DAY' ? '1200px' : '100%'}} className="relative w-fit min-w-full">
                     
                     <div className={`sticky top-0 z-[40] bg-gray-50 border-b flex shadow-sm ring-1 ring-gray-200 ${timelineMode === 'WEEK' ? 'h-16 md:h-14' : 'h-14'}`}>
                         <div className={`${roomColumnWidthClass} flex-shrink-0 border-r p-2 md:p-3 font-bold text-gray-700 bg-gray-50 flex items-center sticky left-0 z-[50] shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)] text-sm md:text-base`}>Phòng</div>
                         <div className="flex-1 grid relative" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                             {renderCurrentTimeLine()}
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
                         const property = properties.find(p => p.id === room.propertyId);
                         const propName = property?.name;
                         const showRoomPropertyChip = currentProperty.id === 'ALL';
                         const operationalInsight = roomOperationalInsights.get(room.id);
                         const activeBooking = operationalInsight?.activeBooking || null;
                         const nextBooking = operationalInsight?.nextBooking || null;
                         const effectiveRoomStatus = getRoomMapEffectiveStatus(room);
                         const roomLayoutMeta = bookingLayoutByRoom.get(room.id);
                         const laneCount = roomLayoutMeta?.laneCount ?? 1;
                         const roomRowHeight = Math.max(88, 44 + (laneCount * 24));

                         let statusBg = 'bg-white room-status-default';
                         let statusIcon = null;
                         let statusBorder = '';
                         let tooltip = '';

                         if (effectiveRoomStatus === RoomStatus.VACANT_DIRTY) {
                            statusBg = 'bg-yellow-50 room-status-dirty'; statusBorder = 'border-l-4 border-l-yellow-400'; statusIcon = <AlertTriangle size={14} className="text-yellow-600" />; tooltip = 'Phòng chưa dọn';
                         } else if (effectiveRoomStatus === RoomStatus.VACANT_CLEAN) {
                             statusBg = 'bg-white room-status-clean'; statusBorder = 'border-l-4 border-l-green-500'; statusIcon = <CheckCircle size={14} className="text-green-600" />; tooltip = 'Sẵn sàng';
                         } else if (effectiveRoomStatus === RoomStatus.OCCUPIED) {
                             statusBg = 'bg-red-50 room-status-occupied'; statusBorder = 'border-l-4 border-l-red-500'; statusIcon = <UserIcon size={14} className="text-red-600" />; tooltip = 'Đang có khách';
                         }

                         return (
                             <React.Fragment key={room.id}>
                                 {isNewBranch && (
                                     <div className="room-branch-header sticky left-0 z-[20] w-full bg-gray-200/90 border-y border-gray-300/80 font-bold text-gray-700 px-4 py-1.5 text-xs uppercase tracking-wider flex items-center gap-2 backdrop-blur-sm shadow-sm">
                                         <Building2 size={14} className="text-gray-500"/> {propName}
                                     </div>
                                 )}

                                 <div
                                    className="flex border-b hover:bg-gray-50 transition-colors group"
                                    style={{ height: `${roomRowHeight}px` }}
                                 >
                                     <div 
                                        className={`room-status-panel ${roomColumnWidthClass} flex-shrink-0 border-r p-3 md:p-4 flex flex-col justify-start sticky left-0 z-[30] border-r-gray-200 shadow-[4px_0_5px_-2px_rgba(0,0,0,0.05)] transition-all select-none relative gap-2 ${statusBg} ${statusBorder}`} 
                                        title={tooltip}
                                     >
                                         <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="room-number font-black text-[20px] md:text-[22px] text-gray-800 leading-none tracking-tight">{room.number}</div>
                                                <div className="room-type text-[10px] md:text-xs text-gray-500 truncate mt-1 font-semibold uppercase tracking-wide">{roomTypes.find(t=>t.id===room.typeId)?.name}</div>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!canManageRooms || effectiveRoomStatus === RoomStatus.OCCUPIED || !!activeBooking}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleStatusIconClick(room);
                                                }}
                                                className="pt-0.5 shrink-0 rounded-full p-1 hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-70"
                                                title={canManageRooms && effectiveRoomStatus !== RoomStatus.OCCUPIED && !activeBooking ? 'Đổi sạch/bẩn' : tooltip}
                                            >
                                                {statusIcon}
                                            </button>
                                         </div>
                                         <div className="flex flex-wrap items-center gap-1.5">
                                            {showRoomPropertyChip && propName && (
                                                <span className="inline-flex max-w-full items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 truncate">
                                                    {propName}
                                                </span>
                                            )}
                                         </div>
                                     </div>
                                    
                                     <div className="flex-1 grid relative" style={{gridTemplateColumns: `repeat(${gridColumns}, 1fr)`}}>
                                         {timeSlots.map((slot) => renderGridCell(room, slot))}
                                         {renderCurrentTimeLine()}

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
                                             const movingBooking = roomMapBookings.find(b => b.id === movingBookingId);
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
                                                const roomLayout = bookingLayoutByRoom.get(room.id);
                                                const laneCount = roomLayout?.laneCount ?? 1;
                                                const laneIndex = roomLayout?.byBookingId.get(b.id)?.lane ?? 0;
                                                const isStackedLayout = laneCount > 1;
                                                const bookingTop = isStackedLayout ? 6 + (laneIndex * 24) : '10%';
                                                const bookingHeight = isStackedLayout ? 20 : '80%';
                                                const bookingTimeLabel = `${formatCompactRoomDateTime(b.checkInDate)} - ${formatCompactRoomDateTime(b.checkOutDate)}`;
                                                const bookingTitle = `${b.guestName || 'Khách lẻ'} | ${bookingTimeLabel} | ${getBookingStatusLabel(deriveBookingStatus(b, now.getTime()))}`;

                                                return (
                                                    <div 
                                                        key={b.id} 
                                                        draggable
                                                        onMouseDown={(e) => e.stopPropagation()} 
                                                        onDragStart={(e) => handleBookingDragStart(e, b.id, bStart, bEnd, viewportStartMs, viewportEndMs)}
                                                        onDragEnd={handleBookingDragEnd}
                                                        className={`${getBookingStyle(b)} ${movingBookingId === b.id ? 'opacity-40' : 'opacity-100'}`} 
                                                        title={bookingTitle}
                                                        style={{
                                                            left: `${left}%`, width: `${width}%`, 
                                                            top: bookingTop,
                                                            height: bookingHeight,
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
                                                        {!isCompactCard && !isStackedLayout && (
                                                            <div className="truncate text-[9px] md:text-[10px] opacity-90 relative z-[11]">{bookingTimeLabel}</div>
                                                        )}
                                                        {!isStackedLayout && (
                                                            <div className="flex gap-0.5 mt-1 relative z-[11]">
                                                                {bookingTags.map(t => (
                                                                    <div key={t.id} className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: t.color}} title={t.name}></div>
                                                                ))}
                                                            </div>
                                                        )}
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
                {isLoadingOperationalBookings && (
                    <div className="sticky top-0 z-[60] border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Đang tải lại danh sách booking theo khung hiện tại...
                    </div>
                )}
                {orphanRoomMapBookings.length > 0 && (
                    <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">
                        Có {orphanRoomMapBookings.length} đơn chưa khớp phòng nên chưa hiển thị đủ trong danh sách này.
                        {orphanRoomMapPreview && <span className="ml-1 font-semibold">Mẫu: {orphanRoomMapPreview}{orphanRoomMapBookings.length > 5 ? '...' : ''}</span>}
                    </div>
                )}
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

                            <th className="p-4">Trạng thái</th>
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
                            const { totalBill, paidAmount, outstanding, isGroupedChild } = getBookingFinancialSummary(b);
                            const derivedStatus = deriveBookingStatus(b, now.getTime());
                            const statusPillClass = derivedStatus === BookingStatus.CHECKED_IN
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : derivedStatus === BookingStatus.CONFIRMED
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : derivedStatus === BookingStatus.CHECKED_OUT
                                        ? 'bg-gray-100 text-gray-600 border-gray-200'
                                        : 'bg-slate-100 text-slate-700 border-slate-200';

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
                                    <td className="p-4">
                                        <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-bold ${statusPillClass}`}>
                                            {getBookingStatusLabel(derivedStatus)}
                                        </span>
                                    </td>
                                    
                                    <td className="p-4 text-right font-medium text-gray-900">
                                        {isGroupedChild ? <span className="text-xs text-gray-400 italic">Gộp theo đoàn</span> : formatNumber(totalBill)}
                                    </td>
                                    <td className="p-4 text-right font-medium text-blue-600">
                                        {isGroupedChild ? <span className="text-xs text-gray-400 italic">Theo đoàn</span> : formatNumber(paidAmount)}
                                    </td>
                                    <td className={`p-4 text-right font-bold ${outstanding > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                        {isGroupedChild ? <span className="text-xs text-gray-400 italic">Theo đoàn</span> : formatNumber(outstanding)}
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
                        {sortedBookings.length === 0 && (
                            <tr>
                                <td colSpan={15} className="p-8 text-center text-sm text-gray-500">
                                    Không có booking trong khung/bộ lọc hiện tại. Hãy đổi ngày, đổi trạng thái lọc hoặc xóa tìm kiếm.
                                </td>
                            </tr>
                        )}
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

                      {isLoadingQuickFinder && (
                          <div className="flex items-center gap-2 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
                              <Loader2 size={13} className="animate-spin" />
                              Đang kiểm tra phòng trống theo khung giờ đã chọn...
                          </div>
                      )}

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
                                  Không có phòng trống phù hợp trong khung giờ này. Hãy kiểm tra lại chi nhánh, khoảng giờ hoặc các lịch khóa phòng/booking đang giao nhau.
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
                                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
                                      Giữ cọc sẽ tạo một đơn giữ chỗ tạm thời trên sơ đồ phòng và tự hết hạn sau thời gian bên dưới.
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

                  <div className="mb-5 rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase text-gray-700">Lịch sử đổi trạng thái gần đây</span>
                          <span className="text-[11px] text-gray-500">{selectedRoomStatusHistory.length} mục</span>
                      </div>
                      <div className="max-h-40 overflow-auto">
                          {isLoadingRecentHistory ? (
                              <p className="text-xs text-gray-400 italic text-center py-4">Đang tải hoạt động gần đây...</p>
                          ) : selectedRoomStatusHistory.length === 0 ? (
                              <p className="text-xs text-gray-400 italic text-center py-4">Chưa có lịch sử đổi trạng thái cho phòng này.</p>
                          ) : (
                              <div className="divide-y divide-gray-100">
                                  {selectedRoomStatusHistory.map((log) => (
                                      <div key={log.id} className="px-3 py-2">
                                          <div className="text-xs font-semibold text-gray-900">{log.description}</div>
                                          <div className="mt-1 text-[11px] text-gray-500">
                                              {formatAuditDateTime(log.timestamp)} • {getActorUsername(log)}
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>

                  <div className="flex gap-3">
                          <button 
                              onClick={() => setStatusModal({...statusModal, isOpen: false})} 
                              disabled={isSavingRoomStatus}
                              className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors"
                          >
                              Huỷ bỏ
                          </button>
                          <button 
                              onClick={confirmStatusChange} 
                              disabled={isSavingRoomStatus}
                              className={`flex-1 py-2.5 text-white font-bold rounded-lg shadow-lg transition-colors ${statusModal.targetStatus === RoomStatus.VACANT_CLEAN ? 'bg-green-600 hover:bg-green-700 shadow-green-200' : 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-200'}`}
                          >
                              {isSavingRoomStatus ? 'Đang lưu...' : 'Xác nhận'}
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
                          <button
                              onClick={() => setMoveConfirmModal(null)}
                              disabled={isSavingMove}
                              className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                              Huỷ bỏ
                          </button>
                          <button
                              onClick={confirmAndSaveMove}
                              disabled={isSavingMove}
                              className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                          >
                              {isSavingMove && <Loader2 size={16} className="animate-spin" />}
                              {isSavingMove ? 'Đang chuyển...' : 'Đồng ý chuyển'}
                          </button>
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
                                  {isEditMode ? 'Chi tiết đơn' : 'Tạo đơn mới'}
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
                                  <span className="text-[11px] font-bold uppercase text-gray-700">80 hoạt động gần đây</span>
                                  <span className="text-xs font-semibold text-gray-500">{selectedBookingHistory.length} mục khớp đơn</span>
                              </div>

                              <div className="max-h-44 overflow-auto">
                                  {isLoadingRecentHistory ? (
                                      <p className="text-xs text-gray-400 italic text-center py-4">Đang tải lịch sử gần đây...</p>
                                  ) : selectedBookingHistory.length === 0 ? (
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
                      {currentProperty.id === 'ALL' && !isEditMode && (
                          <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">
                              Bạn đang xem toàn bộ chi nhánh. Hãy chọn chi nhánh trước khi chọn hạng/phòng để tránh tạo nhầm cơ sở.
                          </div>
                      )}
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
                                            <option value="">-- Chọn chi nhánh --</option>
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
                                            <option value="">{row.tempPropId ? '-- Chọn hạng --' : 'Chọn chi nhánh trước'}</option>
                                            {roomTypes.map(t => {
                                                if (!row.tempPropId) return null;
                                                const hasRoomsInBranch = rooms.some(r => r.propertyId === row.tempPropId && r.typeId === t.id);
                                                if (hasRoomsInBranch) return <option key={t.id} value={t.id}>{t.name}</option>;
                                                return null;
                                            })}
                                        </select>
                                    </div>

                                    <div className="w-full space-y-1 md:space-y-0 min-w-0">
                                        <span className="md:hidden text-[10px] text-gray-400 font-medium uppercase block">Phòng</span>
                                        {(() => {
                                            const availableRoomIds = modalAvailableRoomIdsByRow.get(row.tempId);
                                            return (
                                        <select 
                                            disabled={isReadOnly || isLoadingModalAvailability || !row.tempPropId} 
                                            className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" 
                                            value={row.roomId} 
                                            onChange={e => updateRow(idx, 'roomId', e.target.value)}
                                        >
                                            <option value="">{!row.tempPropId ? 'Chọn chi nhánh trước' : isLoadingModalAvailability ? 'Đang tải...' : '-- Chọn phòng --'}</option>
                                            {rooms.map(r => {
                                                if (!row.tempPropId) return null;
                                                if (row.tempPropId && r.propertyId !== row.tempPropId) return null;
                                                if (row.tempTypeId && r.typeId !== row.tempTypeId) return null;
                                                if (availableRoomIds?.has(r.id)) return <option key={r.id} value={r.id}>{r.number}</option>;
                                                return null;
                                            })}
                                        </select>
                                            );
                                        })()}
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
                                         <option value={BookingStatus.CONFIRMED}>Đã xác nhận</option>
                                         <option value={BookingStatus.HOLD}>Giữ chỗ</option>
                                         <option value={BookingStatus.CHECKED_IN}>Đang ở</option>
                                         <option value={BookingStatus.CHECKED_OUT}>Đã trả</option>
                                     </select>
                                     <ArrowUpDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                 </div>
                                 
                                 {canDelete && (
                                     !showDeleteConfirm ? (
                                        <button 
                                            type="button"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteClick(); }}
                                            className="px-3 py-2 text-red-600 bg-white hover:bg-red-50 rounded-lg shadow-sm transition-colors font-bold border border-gray-200 flex-shrink-0 inline-flex items-center gap-1.5 text-xs"
                                        >
                                            <Trash2 size={16} />
                                            Xóa đơn
                                        </button>
                                     ) : (
                                        <div className="flex items-center gap-1.5 bg-red-50 p-1 rounded-lg border border-red-100 animate-fade-in shadow-sm">
                                            <button
                                                onClick={handleConfirmDelete}
                                                disabled={isDeletingBooking}
                                                className="px-2.5 py-1.5 bg-red-600 text-white text-[10px] font-bold rounded-md disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center gap-1"
                                            >
                                                {isDeletingBooking && <Loader2 size={12} className="animate-spin" />}
                                                {isDeletingBooking ? 'Đang xóa' : 'Xóa thật'}
                                            </button>
                                            <button
                                                onClick={() => setShowDeleteConfirm(false)}
                                                disabled={isDeletingBooking}
                                                className="px-2.5 py-1.5 bg-white border border-gray-300 text-gray-600 text-[10px] font-bold rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                                Hủy
                                            </button>
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

      {showTicketModal && receiptData && createPortal(
          <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-3 md:p-6">
               <div className="bg-white rounded-[28px] shadow-[0_24px_80px_rgba(15,23,42,0.24)] max-w-3xl w-full h-auto max-h-[calc(100dvh-48px)] animate-fade-in relative overflow-hidden flex flex-col">
                   <button onClick={() => setShowTicketModal(false)} className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900"><X size={18}/></button>

                   <div className="shrink-0 bg-white px-5 py-4 pr-14 md:px-7 md:py-5">
                       <div className="flex items-start justify-between gap-4">
                           <div className="min-w-0">
                               <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">K-Host · {receiptData.branchName}</div>
                               <h2 className="mt-1 text-xl md:text-2xl font-black tracking-tight text-gray-950">Phiếu xác nhận đặt phòng</h2>
                               <div className="mt-1.5 space-y-0.5 text-[12px] font-medium leading-relaxed text-gray-500">
                                   <div>Mã đơn: <span className="font-semibold text-gray-800">{receiptData.bookingCode}</span> · Tạo lúc: <span className="font-semibold text-gray-800">{formatStandardDateTime(receiptData.issuedAt)}</span></div>
                                   <div>Người tạo: <span className="font-semibold text-gray-800">{receiptData.issuedBy}</span> · Số phòng: <span className="font-semibold text-gray-800">{receiptData.roomCount || receiptData.rooms.length}</span></div>
                                </div>
                            </div>
                        </div>
                   </div>

                   <div id="print-area" className="bg-white overflow-y-auto flex-1 min-h-0 overscroll-contain">
                        <div className="px-5 pb-5 md:px-7 md:pb-7 text-sm text-gray-800">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px] md:items-start">
                                <div className="space-y-3">
                                    <section className="rounded-[22px] bg-gray-50 p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
                                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                                            <UserIcon size={14} />
                                            Thông tin khách
                                        </div>
                                        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2">
                                            <span className="font-semibold text-gray-500">Khách hàng</span>
                                            <span className="font-bold text-gray-950">{receiptData.guestName}</span>
                                            <span className="font-semibold text-gray-500">Số điện thoại</span>
                                            <span>{receiptData.guestPhone || '--'}</span>
                                        </div>
                                    </section>

                                    <section className="rounded-[22px] bg-gray-50 p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
                                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                                            <Building2 size={14} />
                                            Thông tin phòng
                                        </div>
                                        <div className="space-y-2.5">
                                            {receiptData.rooms.map((room: any, idx: number) => (
                                                <div key={idx} className="rounded-[18px] bg-white p-3 shadow-[0_6px_20px_rgba(37,99,235,0.08)]">
                                                    <div className="mb-2 flex items-start justify-between gap-3">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                                                                <Building2 size={16} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="truncate font-black text-blue-700 text-base">Phòng {room.roomNumber} - {room.typeName}</div>
                                                                <div className="text-xs font-semibold text-gray-500">Chi nhánh: {room.branchName}</div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs text-gray-700">
                                                        <span className="text-gray-500">Nhận phòng</span>
                                                        <span className="font-semibold">{formatStandardDateTime(room.checkIn)}</span>
                                                        <span className="text-gray-500">Trả phòng</span>
                                                        <span className="font-semibold">{formatStandardDateTime(room.checkOut)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                </div>

                                <aside className="space-y-3">
                                    <section className="rounded-[22px] bg-gray-50 p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
                                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                                            <Wallet size={14} />
                                            Thanh toán
                                        </div>
                                        <div className="space-y-2 font-semibold tabular-nums">
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-600">Tổng bill</span>
                                                <span className="text-lg font-black text-gray-950">{formatNumber(receiptData.total)} đ</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-600">Đã thanh toán</span>
                                                <span className="font-black text-blue-600">{formatNumber(receiptData.paid)} đ</span>
                                            </div>
                                            <div className="border-t border-gray-200/80 pt-2 flex justify-between items-center">
                                                <span className="text-gray-600">Còn lại</span>
                                                <span className={`font-black ${receiptData.total - receiptData.paid > 0 ? 'text-orange-700' : 'text-emerald-600'}`}>
                                                    {formatNumber(receiptData.total - receiptData.paid)} đ
                                                </span>
                                            </div>
                                        </div>
                                    </section>

                                    {receiptData.extraFees && receiptData.extraFees.length > 0 && (
                                        <section className="rounded-[22px] bg-gray-50 p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
                                            <h5 className="font-bold text-xs uppercase text-gray-400 mb-2">Dịch vụ & Phụ thu</h5>
                                            <div className="space-y-1.5">
                                                {receiptData.extraFees.map((f: ExtraFee) => (
                                                    <div key={f.id} className="flex justify-between gap-3 text-xs">
                                                        <span className="text-gray-700">{f.name}</span>
                                                        <span className={`shrink-0 font-semibold tabular-nums ${f.type === 'REVENUE' ? 'text-gray-900' : 'text-orange-700'}`}>
                                                            {f.type === 'REVENUE' ? '' : '-'}{formatNumber(f.amount)} đ
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    {(receiptData.tags?.length > 0 || receiptData.notes) && (
                                        <section className="rounded-[22px] bg-gray-50 p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
                                            <div className="space-y-2">
                                                {receiptData.tags.length > 0 && (
                                                    <div>
                                                        <div className="mb-1 text-[11px] font-bold uppercase text-gray-400">Tag</div>
                                                        <div className="flex gap-1 flex-wrap">
                                                            {receiptData.tags.map((t: Tag) => (
                                                                <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold" style={{backgroundColor: t.color}}>
                                                                    {t.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {receiptData.notes && (
                                                    <div>
                                                        <div className="mb-1 text-[11px] font-bold uppercase text-gray-400">Ghi chú</div>
                                                        <div className="rounded-2xl bg-white p-2 text-xs italic text-gray-500 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
                                                            {receiptData.notes}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    )}
                                </aside>
                            </div>

                            <div className="mt-4 border-t border-dashed border-gray-200 pt-4 text-center text-xs font-semibold text-gray-500">
                                Vui lòng kiểm tra lại thông tin đặt phòng. Cảm ơn quý khách.
                            </div>
                        </div>
                   </div>
               </div>
          </div>,
          document.body
      )}
    </div>
  );
};

export default RoomMap;
