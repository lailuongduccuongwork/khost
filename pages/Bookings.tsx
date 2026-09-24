import DialogFrame from '../components/DialogFrame';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Booking, BookingStatus, Customer, HistoryLog, PERMISSIONS, Property, Room, RoomType, Tag, User } from '../types';
import { AlertTriangle, ArrowUpDown, CheckCircle, CheckSquare, Clock3, Download, Eye, FileUp, Plus, RotateCcw, Search, Square, Trash2, X } from 'lucide-react';
import { DataService } from '../services/dataService';
import { isArchiveBucketRoom } from '../utils/roomBuckets';
import { deriveBookingStatus } from '../utils/bookingState';

// Declare XLSX from global scope (loaded via CDN in index.html)
declare const XLSX: any;

interface BookingsProps {
  bookings: Booking[];
  rooms: Room[];
  roomTypes: RoomType[];
  properties: Property[];
  tags: Tag[];
  users: User[];
  customers: Customer[];
  onRefresh?: () => void;
  onCreateBooking?: () => void;
  onOpenRoomMapBooking?: (booking: Booking) => void;
  currentPropertyId: string;
  isScopeLoading?: boolean;
  currentUser: User; // Full user for permissions
}

type BookingSortField = 'createdAt' | 'checkInDate' | 'checkOutDate';
type SortDirection = 'asc' | 'desc';
type HistorySourceFilter = 'ALL' | 'WEB' | 'IMPORT' | 'SYSTEM';
type BookingStatusFilter = 'ALL' | BookingStatus;
const BOOKINGS_PER_PAGE = 20;

type BookingHistoryFilters = {
    fromDate: string;
    toDate: string;
    propertyId: string;
    roomId: string;
    status: string;
    actorId: string;
    source: HistorySourceFilter;
};

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

const toDateTimeLabel = (iso: string) => {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return '--';
    return dt.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const toDateTimeWithSecondsLabel = (iso: string) => {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return '--';
    return dt.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const getBookingStatusLabel = (status: BookingStatus) => {
    switch (status) {
        case BookingStatus.HOLD:
            return 'Giữ chỗ';
        case BookingStatus.CONFIRMED:
            return 'Đã xác nhận';
        case BookingStatus.CHECKED_IN:
            return 'Đang ở';
        case BookingStatus.CHECKED_OUT:
            return 'Đã trả';
        case BookingStatus.DELETED:
            return 'Đã xóa';
        default:
            return status;
    }
};

const getBookingStatusPillClass = (status: BookingStatus) => {
    switch (status) {
        case BookingStatus.HOLD:
            return 'bg-amber-50 text-amber-700 border-amber-200';
        case BookingStatus.CONFIRMED:
            return 'bg-blue-50 text-blue-700 border-blue-200';
        case BookingStatus.CHECKED_IN:
            return 'bg-red-50 text-red-700 border-red-200';
        case BookingStatus.CHECKED_OUT:
            return 'bg-gray-100 text-gray-700 border-gray-200';
        default:
            return 'bg-slate-100 text-slate-700 border-slate-200';
    }
};

const defaultHistoryFilters = (): BookingHistoryFilters => ({
    fromDate: '',
    toDate: '',
    propertyId: 'ALL',
    roomId: 'ALL',
    status: 'ALL',
    actorId: 'ALL',
    source: 'ALL',
});

const formatDateInputValue = (iso?: string | null) => {
    if (!iso) return '';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    const year = dt.getFullYear();
    const month = `${dt.getMonth() + 1}`.padStart(2, '0');
    const day = `${dt.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const BRANCH_STOP_WORDS = new Set(['chi', 'nhanh', 'cn', 'co', 'so', 'khost', 'host', 'branch']);

const normalizeImportText = (value: string) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');

const toCompactKey = (value: string) => normalizeImportText(value).replace(/\s+/g, '');

const toReducedBranchText = (value: string) => {
    const normalized = normalizeImportText(value);
    if (!normalized) return '';
    return normalized
        .split(' ')
        .filter((token) => token && !BRANCH_STOP_WORDS.has(token))
        .join(' ');
};

const buildPropertyImportLookup = (allProperties: Property[]) => {
    const byKey = new Map<string, Property[]>();

    const attach = (key: string, property: Property) => {
        if (!key) return;
        const current = byKey.get(key) || [];
        if (!current.some((item) => item.id === property.id)) {
            current.push(property);
            byKey.set(key, current);
        }
    };

    allProperties.forEach((property) => {
        const propertyName = String(property.name || '').trim();
        const normalized = normalizeImportText(propertyName);
        const reduced = toReducedBranchText(propertyName);
        const rawTokens = propertyName.split(/[^0-9A-Za-zÀ-ỹĐđ]+/).map((token) => token.trim()).filter(Boolean);

        const keys = new Set<string>();
        keys.add(toCompactKey(normalized));
        keys.add(toCompactKey(reduced));

        const initials = rawTokens
            .map((token) => toCompactKey(token).charAt(0))
            .filter(Boolean)
            .join('');
        if (initials) keys.add(initials);

        rawTokens.forEach((token) => {
            const compactToken = toCompactKey(token);
            if (!compactToken) return;

            const hasDigit = /\d/.test(token);
            const isUpperShort = token.length <= 6 && token === token.toUpperCase();
            if (hasDigit || isUpperShort) {
                keys.add(compactToken);
            }
        });

        keys.forEach((key) => attach(key, property));
    });

    return byKey;
};

const resolveImportedProperty = (branchName: string, propertyLookup: Map<string, Property[]>) => {
    const normalized = normalizeImportText(branchName);
    if (!normalized) {
        return { status: 'EMPTY' as const, property: null as Property | null, candidates: [] as Property[] };
    }

    const reduced = toReducedBranchText(normalized);
    const keys = Array.from(new Set([toCompactKey(normalized), toCompactKey(reduced)].filter(Boolean)));

    const candidatesById = new Map<string, Property>();
    keys.forEach((key) => {
        const candidates = propertyLookup.get(key) || [];
        candidates.forEach((property) => candidatesById.set(property.id, property));
    });

    const candidates = Array.from(candidatesById.values());
    if (candidates.length === 0) {
        return { status: 'NOT_FOUND' as const, property: null as Property | null, candidates: [] as Property[] };
    }
    if (candidates.length > 1) {
        return { status: 'AMBIGUOUS' as const, property: null as Property | null, candidates };
    }

    return { status: 'MATCHED' as const, property: candidates[0], candidates };
};

const Bookings: React.FC<BookingsProps> = ({ bookings, rooms, roomTypes, properties, tags, users, customers, onRefresh, onCreateBooking, onOpenRoomMapBooking, currentPropertyId, isScopeLoading = false, currentUser }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [searchTerm, setSearchTerm] = useState('');
  const [propertyFilter, setPropertyFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<BookingStatusFilter>('ALL');
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('ALL');
  const [roomFilter, setRoomFilter] = useState<string>('ALL');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isHydratingScope, setIsHydratingScope] = useState(false);
  const [sortField, setSortField] = useState<BookingSortField>('checkOutDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [detailModalBookingId, setDetailModalBookingId] = useState<string | null>(null);
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; bookingId: string | null }>({
      isOpen: false,
      bookingId: null,
  });
  const [historyFilters, setHistoryFilters] = useState<BookingHistoryFilters>(defaultHistoryFilters);
  const [recentHistory, setRecentHistory] = useState<HistoryLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Custom Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
      isOpen: boolean;
      idsToDelete: string[]; // List of IDs to delete
      isBatchUndo?: boolean; // Flag to distinguish import undo vs normal delete
  }>({ isOpen: false, idsToDelete: [] });

  // Undo Import State
  const [lastImportBatch, setLastImportBatch] = useState<{ id: string, count: number, fileName: string } | null>(null);

  const canAdd = currentUser.permissions?.includes(PERMISSIONS.CAN_ADD_BOOKING);
  const canDelete = currentUser.permissions?.includes(PERMISSIONS.CAN_DELETE_BOOKING);
  const isHeaderScopedToSingleProperty = currentPropertyId !== 'ALL';
  const currentScopeName = currentPropertyId === 'ALL'
      ? `Toàn bộ chi nhánh (${properties.length})`
      : properties.find((property) => property.id === currentPropertyId)?.name || 'Chi nhánh hiện tại';

  const customerById = useMemo(() => new Map(customers.map(customer => [customer.id, customer])), [customers]);
  const roomById = useMemo(() => new Map(rooms.map(room => [room.id, room])), [rooms]);
  const roomTypeById = useMemo(() => new Map(roomTypes.map(roomType => [roomType.id, roomType.name])), [roomTypes]);
  const propertyById = useMemo(() => new Map(properties.map(property => [property.id, property.name])), [properties]);
  const tagById = useMemo(() => new Map(tags.map(tag => [tag.id, tag.name])), [tags]);
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);

  useEffect(() => {
      const timer = window.setInterval(() => {
          setNowMs(Date.now());
      }, 30_000);

      return () => {
          window.clearInterval(timer);
      };
  }, []);

  useEffect(() => {
      setPropertyFilter(currentPropertyId || 'ALL');
      setRoomFilter('ALL');
      setIsHydratingScope(true);
  }, [currentPropertyId]);

  useEffect(() => {
      if (!isHydratingScope) return;
      const timer = window.setTimeout(() => setIsHydratingScope(false), 250);
      return () => window.clearTimeout(timer);
  }, [bookings, rooms, isHydratingScope]);
  const visibleRooms = useMemo(() => {
      return rooms
          .filter((room) => {
              if (isArchiveBucketRoom(room)) return false;
              if (propertyFilter !== 'ALL' && room.propertyId !== propertyFilter) return false;
              if (roomTypeFilter !== 'ALL' && room.typeId !== roomTypeFilter) return false;
              return true;
          })
          .sort((a, b) => a.number.localeCompare(b.number, 'vi', { numeric: true }));
  }, [rooms, propertyFilter, roomTypeFilter]);
  const userLookupByImportKey = useMemo(() => {
      const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
      const map = new Map<string, User>();
      users.forEach((user) => {
          map.set(normalize(user.id), user);
          map.set(normalize(user.username), user);
          if (user.fullName) map.set(normalize(user.fullName), user);
      });
      return map;
  }, [users]);

  const getDisplayName = (booking: Booking) =>
      booking.guestName || customerById.get(booking.customerId)?.name || 'Khách lẻ';

  const getRoomNumber = (roomId: string) => roomById.get(roomId)?.number || 'Phòng không xác định';
  const getRoomTypeName = (booking: Booking) => roomTypeById.get(roomById.get(booking.roomId)?.typeId || '') || 'Không xác định';
  const getPropertyName = (booking: Booking) =>
      propertyById.get(booking.propertyId || roomById.get(booking.roomId)?.propertyId || '') || '--';
  const getCreatorLabel = (booking: Booking) => {
      const staff = userById.get(booking.createdBy);
      if (!staff) return booking.createdBy || '--';
      return staff.username || booking.createdBy || '--';
  };
  const getBookingTags = (booking: Booking) => (booking.tags || []).map(tagId => tagById.get(tagId) || tagId);
  const bookingsByGroupId = useMemo(() => {
      const map = new Map<string, Booking[]>();
      bookings
          .filter((booking) => booking.groupId && deriveBookingStatus(booking, nowMs) !== BookingStatus.DELETED)
          .forEach((booking) => {
              const groupId = booking.groupId!;
              if (!map.has(groupId)) map.set(groupId, []);
              map.get(groupId)!.push(booking);
          });

      map.forEach((groupBookings) => {
          groupBookings.sort((a, b) => a.id.localeCompare(b.id));
      });

      return map;
  }, [bookings, nowMs]);

  const getBookingFinancialSummary = (booking: Booking) => {
      const ownFees = booking.extraFees || [];
      const ownExtraRevenue = ownFees
          .filter((fee) => fee.type === 'REVENUE')
          .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
      const ownExtraExpense = ownFees
          .filter((fee) => fee.type === 'EXPENSE')
          .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);

      if (!booking.groupId) {
          const netRevenue = Number(booking.totalPrice) || 0;
          const paidAmount = Number(booking.paidAmount) || 0;
          const totalBill = netRevenue + ownExtraExpense;
          const outstanding = Math.max(totalBill - paidAmount, 0);

          return {
              extraRevenue: ownExtraRevenue,
              extraExpense: ownExtraExpense,
              netRevenue,
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
              extraRevenue: 0,
              extraExpense: 0,
              netRevenue: 0,
              totalBill: 0,
              paidAmount: 0,
              outstanding: 0,
              isGroupedChild: true,
          };
      }

      const leaderFees = leader.extraFees || [];
      const extraRevenue = leaderFees
          .filter((fee) => fee.type === 'REVENUE')
          .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
      const extraExpense = leaderFees
          .filter((fee) => fee.type === 'EXPENSE')
          .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
      const netRevenue = groupBookings.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
      const paidAmount = groupBookings.reduce((sum, item) => sum + (Number(item.paidAmount) || 0), 0);
      const totalBill = netRevenue + extraExpense;
      const outstanding = Math.max(totalBill - paidAmount, 0);

      return {
          extraRevenue,
          extraExpense,
          netRevenue,
          totalBill,
          paidAmount,
          outstanding,
          isGroupedChild: false,
      };
  };

  const getRoomContextLabelByIds = (roomId?: string | null, propertyId?: string | null) => {
      const room = roomId ? roomById.get(roomId) : undefined;
      const effectivePropertyId = propertyId || room?.propertyId;
      const propertyName = effectivePropertyId ? (propertyById.get(effectivePropertyId) || effectivePropertyId) : '--';
      if (!room) return `Chi nhánh ${propertyName}`;

      const roomTypeName = roomTypeById.get(room.typeId) || room.typeId;
      return `Chi nhánh ${propertyName}, Hạng ${roomTypeName}, Phòng ${room.number}`;
  };

  const getActorUsername = (log: HistoryLog) => {
      if (log.actorUsername) return log.actorUsername;
      if (log.actorId && userById.has(log.actorId)) return userById.get(log.actorId)!.username;
      if (log.staffId && userById.has(log.staffId)) return userById.get(log.staffId)!.username;
      return log.actorId || log.staffId || 'không rõ';
  };

  const extractHistoryFields = (log: HistoryLog) => {
      const metadata = (log.metadata || {}) as Record<string, any>;
      const beforeData = ((log.before && typeof log.before === 'object') ? log.before : null) as Record<string, any> | null;
      const afterData = ((log.after && typeof log.after === 'object') ? log.after : null) as Record<string, any> | null;
      const snapshot = log.bookingSnapshot || null;

      const bookingId =
          log.entityId ||
          metadata.bookingId ||
          snapshot?.id ||
          afterData?.id ||
          beforeData?.id ||
          '';
      const groupId =
          metadata.groupId ||
          snapshot?.groupId ||
          afterData?.groupId ||
          beforeData?.groupId ||
          '';
      const propertyId =
          metadata.propertyId ||
          snapshot?.propertyId ||
          afterData?.propertyId ||
          beforeData?.propertyId ||
          '';
      const roomId =
          metadata.roomId ||
          snapshot?.roomId ||
          afterData?.roomId ||
          beforeData?.roomId ||
          '';
      const status =
          metadata.toStatus ||
          metadata.status ||
          afterData?.status ||
          snapshot?.status ||
          beforeData?.status ||
          '';
      const actorId = log.actorId || log.staffId || '';
      const source = (log.source || 'WEB') as Exclude<HistorySourceFilter, 'ALL'>;
      const timestamp = new Date(log.timestamp).getTime();

      return {
          bookingId,
          groupId,
          propertyId,
          roomId,
          status,
          actorId,
          source,
          timestamp,
      };
  };

  const selectedHistoryBooking = useMemo(() => {
      if (!historyModal.bookingId) return null;
      return bookings.find((booking) => booking.id === historyModal.bookingId) || null;
  }, [bookings, historyModal.bookingId]);
  const selectedDetailBooking = useMemo(() => {
      if (!detailModalBookingId) return null;
      return bookings.find((booking) => booking.id === detailModalBookingId) || null;
  }, [bookings, detailModalBookingId]);

  useEffect(() => {
      let cancelled = false;

      if (!historyModal.isOpen || !selectedHistoryBooking) {
          setRecentHistory([]);
          setIsLoadingHistory(false);
          return;
      }

      setIsLoadingHistory(true);
      DataService.fetchBookingHistory({
          bookingIds: [selectedHistoryBooking.id],
          groupId: selectedHistoryBooking.groupId,
          limit: 120,
          fallbackLimit: 80,
      })
          .then((logs) => {
              if (!cancelled) {
                  setRecentHistory(logs);
              }
          })
          .finally(() => {
              if (!cancelled) {
                  setIsLoadingHistory(false);
              }
          });

      return () => {
          cancelled = true;
      };
  }, [historyModal.isOpen, selectedHistoryBooking?.id, selectedHistoryBooking?.groupId]);

  const bookingHistoryLogs = useMemo(() => {
      if (!selectedHistoryBooking) return [];

      const targetBookingIds = new Set<string>([selectedHistoryBooking.id]);
      const targetGroupId = selectedHistoryBooking.groupId || '';

      return recentHistory
          .filter((log) => {
              const entityType = log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM');
              if (entityType !== 'BOOKING') return false;

              const fields = extractHistoryFields(log);
              if (fields.bookingId && targetBookingIds.has(fields.bookingId)) return true;
              if (targetGroupId && fields.groupId && fields.groupId === targetGroupId) return true;
              return false;
          })
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [recentHistory, selectedHistoryBooking]);

  const historyFilterOptions = useMemo(() => {
      const propertyMap = new Map<string, string>();
      const roomMap = new Map<string, string>();
      const statusSet = new Set<string>();
      const actorMap = new Map<string, string>();

      bookingHistoryLogs.forEach((log) => {
          const fields = extractHistoryFields(log);
          if (fields.propertyId) {
              propertyMap.set(fields.propertyId, propertyById.get(fields.propertyId) || fields.propertyId);
          }
          if (fields.roomId) {
              roomMap.set(fields.roomId, getRoomContextLabelByIds(fields.roomId, fields.propertyId));
          }
          if (fields.status) {
              statusSet.add(fields.status);
          }
          if (fields.actorId) {
              actorMap.set(fields.actorId, getActorUsername(log));
          }
      });

      return {
          properties: Array.from(propertyMap.entries())
              .map(([id, label]) => ({ id, label }))
              .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
          rooms: Array.from(roomMap.entries())
              .map(([id, label]) => ({ id, label }))
              .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
          statuses: Array.from(statusSet.values()).sort((a, b) => a.localeCompare(b)),
          actors: Array.from(actorMap.entries())
              .map(([id, label]) => ({ id, label }))
              .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
      };
  }, [bookingHistoryLogs, propertyById, getRoomContextLabelByIds, getActorUsername]);

  const filteredBookingHistory = useMemo(() => {
      return bookingHistoryLogs.filter((log) => {
          const fields = extractHistoryFields(log);

          if (historyFilters.fromDate) {
              const start = new Date(`${historyFilters.fromDate}T00:00:00`).getTime();
              if (!Number.isNaN(start) && fields.timestamp < start) return false;
          }

          if (historyFilters.toDate) {
              const end = new Date(`${historyFilters.toDate}T23:59:59.999`).getTime();
              if (!Number.isNaN(end) && fields.timestamp > end) return false;
          }

          if (historyFilters.propertyId !== 'ALL' && fields.propertyId !== historyFilters.propertyId) return false;
          if (historyFilters.roomId !== 'ALL' && fields.roomId !== historyFilters.roomId) return false;
          if (historyFilters.status !== 'ALL' && fields.status !== historyFilters.status) return false;
          if (historyFilters.actorId !== 'ALL' && fields.actorId !== historyFilters.actorId) return false;
          if (historyFilters.source !== 'ALL' && fields.source !== historyFilters.source) return false;

          return true;
      });
  }, [bookingHistoryLogs, historyFilters]);

  const formatHistoryValue = (value: any, changeKey?: string): string => {
      if (value === null || value === undefined || value === '') return '--';

      if (changeKey === 'propertyId') {
          return propertyById.get(`${value}`) || `${value}`;
      }

      if (changeKey === 'roomId') {
          return getRoomContextLabelByIds(`${value}`);
      }

      if (changeKey === 'checkInDate' || changeKey === 'checkOutDate') {
          return toDateTimeLabel(`${value}`);
      }

      if (changeKey === 'totalPrice' || changeKey === 'paidAmount') {
          return formatCurrency(Number(value) || 0);
      }

      if (changeKey === 'tags') {
          if (Array.isArray(value)) {
              const names = value.map((item) => tagById.get(`${item}`) || `${item}`);
              return names.length ? names.join(', ') : '--';
          }
          return tagById.get(`${value}`) || `${value}`;
      }

      if (changeKey === 'extraFees' && typeof value === 'object') {
          const fee = value as any;
          const amount = formatCurrency(Number(fee.amount) || 0);
          return `${fee.name || 'Dịch vụ'} (${fee.type === 'EXPENSE' ? '-' : '+'}${amount})`;
      }

      if (typeof value === 'number') return `${value}`;
      if (typeof value === 'string') return value;

      if (Array.isArray(value)) {
          const serialized = value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : `${item}`)).join(', ');
          return serialized || '--';
      }

      if (typeof value === 'object') {
          const objectValue = value as Record<string, any>;
          if (objectValue.id && objectValue.roomId) {
              return `Đơn ${objectValue.id} | ${objectValue.guestName || '--'} | ${getRoomContextLabelByIds(objectValue.roomId, objectValue.propertyId)} | ${objectValue.status || '--'}`;
          }
          const serialized = JSON.stringify(objectValue);
          return serialized.length > 180 ? `${serialized.slice(0, 180)}...` : serialized;
      }

      return `${value}`;
  };

  const getHistoryBeforeAfter = (log: HistoryLog) => {
      const metadata = (log.metadata || {}) as Record<string, any>;
      const changeKey = typeof metadata.changeKey === 'string' ? metadata.changeKey : undefined;

      let beforeValue = metadata.beforeValue;
      let afterValue = metadata.afterValue;

      if (beforeValue === undefined && metadata.fromStatus !== undefined) beforeValue = metadata.fromStatus;
      if (afterValue === undefined && metadata.toStatus !== undefined) afterValue = metadata.toStatus;

      if (beforeValue === undefined && changeKey && log.before && typeof log.before === 'object') {
          beforeValue = (log.before as Record<string, any>)[changeKey];
      }
      if (afterValue === undefined && changeKey && log.after && typeof log.after === 'object') {
          afterValue = (log.after as Record<string, any>)[changeKey];
      }

      if (beforeValue === undefined && log.before !== null) beforeValue = log.before;
      if (afterValue === undefined && log.after !== null) afterValue = log.after;

      return {
          beforeText: formatHistoryValue(beforeValue, changeKey),
          afterText: formatHistoryValue(afterValue, changeKey),
      };
  };

  const filteredBookings = useMemo(() => {
      const term = searchTerm.trim().toLowerCase();
      const visibleBookings = bookings.filter((booking) => {
          if (!booking || booking.status === BookingStatus.DELETED) return false;
          const room = roomById.get(booking.roomId);
          if (room && isArchiveBucketRoom(room)) return false;
          const effectiveStatus = deriveBookingStatus(booking, nowMs);
          if (propertyFilter !== 'ALL' && booking.propertyId !== propertyFilter && room?.propertyId !== propertyFilter) return false;
          if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
          if (roomTypeFilter !== 'ALL' && room?.typeId !== roomTypeFilter) return false;
          if (roomFilter !== 'ALL' && booking.roomId !== roomFilter) return false;

          const checkInDateValue = formatDateInputValue(booking.checkInDate);
          const checkOutDateValue = formatDateInputValue(booking.checkOutDate);
          if (fromDateFilter && checkOutDateValue < fromDateFilter) return false;
          if (toDateFilter && checkInDateValue > toDateFilter) return false;
          return true;
      });

      if (!term) return visibleBookings;

      return visibleBookings.filter(booking => {
          if (!booking) return false;
          const customerName = getDisplayName(booking).toLowerCase();
          const customerPhone = (booking.guestPhone || customerById.get(booking.customerId)?.phone || '').toLowerCase();
          const roomNumber = getRoomNumber(booking.roomId).toLowerCase();
          const roomTypeName = getRoomTypeName(booking).toLowerCase();
          const propertyName = getPropertyName(booking).toLowerCase();
          const creator = getCreatorLabel(booking).toLowerCase();
          const tagsLabel = getBookingTags(booking).join(' ').toLowerCase();
          const bookingCode = (booking.id || '').toLowerCase();
          const statusLabel = getBookingStatusLabel(deriveBookingStatus(booking, nowMs)).toLowerCase();

          return (
              customerName.includes(term) ||
              customerPhone.includes(term) ||
              roomNumber.includes(term) ||
              roomTypeName.includes(term) ||
              propertyName.includes(term) ||
              creator.includes(term) ||
              tagsLabel.includes(term) ||
              bookingCode.includes(term) ||
              statusLabel.includes(term)
          );
      });
  }, [bookings, searchTerm, customerById, getCreatorLabel, getPropertyName, getRoomNumber, getRoomTypeName, getDisplayName, getBookingTags, roomById, propertyFilter, statusFilter, roomTypeFilter, roomFilter, fromDateFilter, toDateFilter, nowMs]);

  useEffect(() => {
      const visibleBookingIds = new Set(filteredBookings.map((booking) => booking.id));
      setSelectedIds((previous) => {
          const next = new Set(Array.from(previous).filter((id) => visibleBookingIds.has(id)));
          return next.size === previous.size ? previous : next;
      });

      if (detailModalBookingId && !visibleBookingIds.has(detailModalBookingId)) {
          setDetailModalBookingId(null);
      }
      if (historyModal.bookingId && !visibleBookingIds.has(historyModal.bookingId)) {
          setHistoryModal({ isOpen: false, bookingId: null });
      }
  }, [filteredBookings, detailModalBookingId, historyModal.bookingId]);

  const sortedBookings = useMemo(() => {
      const parseTime = (value: string) => {
          const time = new Date(value).getTime();
          return Number.isNaN(time) ? 0 : time;
      };

      return [...filteredBookings].sort((bookingA, bookingB) => {
          const timeA = parseTime(bookingA[sortField]);
          const timeB = parseTime(bookingB[sortField]);

          if (timeA === timeB) {
              return sortDirection === 'asc'
                  ? bookingA.id.localeCompare(bookingB.id)
                  : bookingB.id.localeCompare(bookingA.id);
          }

          return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
      });
  }, [filteredBookings, sortDirection, sortField]);

  const totalPages = Math.max(1, Math.ceil(sortedBookings.length / BOOKINGS_PER_PAGE));
  const safePageIndex = Math.min(currentPageIndex, totalPages);
  const pageStartIndex = (safePageIndex - 1) * BOOKINGS_PER_PAGE;
  const paginatedBookings = sortedBookings.slice(pageStartIndex, pageStartIndex + BOOKINGS_PER_PAGE);
  const selectedInPageCount = paginatedBookings.filter(booking => selectedIds.has(booking.id)).length;
  const isAllInViewSelected = paginatedBookings.length > 0 && selectedInPageCount === paginatedBookings.length;
  const visibleRangeStart = sortedBookings.length === 0 ? 0 : pageStartIndex + 1;
  const visibleRangeEnd = Math.min(pageStartIndex + BOOKINGS_PER_PAGE, sortedBookings.length);

  useEffect(() => {
      setCurrentPageIndex(1);
  }, [searchTerm, propertyFilter, statusFilter, roomTypeFilter, roomFilter, fromDateFilter, toDateFilter, sortField, sortDirection]);

  useEffect(() => {
      if (currentPageIndex > totalPages) {
          setCurrentPageIndex(totalPages);
      }
  }, [currentPageIndex, totalPages]);
  const filteredSummary = useMemo(() => {
      return filteredBookings.reduce(
          (summary, booking) => {
              const status = deriveBookingStatus(booking, nowMs);
              const financial = getBookingFinancialSummary(booking);
              summary.total += 1;
              if (status === BookingStatus.CHECKED_IN) summary.checkedIn += 1;
              if (status === BookingStatus.CONFIRMED) summary.confirmed += 1;
              if (status === BookingStatus.CHECKED_OUT) summary.checkedOut += 1;
              if (!financial.isGroupedChild) summary.debt += financial.outstanding;
              return summary;
          },
          { total: 0, checkedIn: 0, confirmed: 0, checkedOut: 0, debt: 0 }
      );
  }, [filteredBookings, nowMs]);
  const hasActiveFilters =
      searchTerm.trim() ||
      propertyFilter !== (currentPropertyId || 'ALL') ||
      statusFilter !== 'ALL' ||
      roomTypeFilter !== 'ALL' ||
      roomFilter !== 'ALL' ||
      fromDateFilter ||
      toDateFilter;
  const emptyStateText = sortedBookings.length === 0
      ? `Không có đơn phù hợp trong phạm vi ${currentScopeName}${statusFilter !== 'ALL' ? `, trạng thái ${getBookingStatusLabel(statusFilter as BookingStatus)}` : ''}${searchTerm.trim() ? `, từ khóa "${searchTerm.trim()}"` : ''}.`
      : '';

  // --- SELECTION LOGIC ---
  const toggleSelectAll = () => {
      if (isAllInViewSelected) {
          const nextSelected = new Set(selectedIds);
          paginatedBookings.forEach(booking => nextSelected.delete(booking.id));
          setSelectedIds(nextSelected);
      } else {
          const nextSelected = new Set(selectedIds);
          paginatedBookings.forEach(booking => nextSelected.add(booking.id));
          setSelectedIds(nextSelected);
      }
  };

  const toggleSelectRow = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) {
          newSet.delete(id);
      } else {
          newSet.add(id);
      }
      setSelectedIds(newSet);
  };

  // --- DELETE LOGIC (UPDATED WITH CUSTOM MODAL) ---
  
  // 1. Trigger for Single Delete
  const handleDeleteSingle = (id: string) => {
      if (!canDelete) return;
      setDeleteModal({
          isOpen: true,
          idsToDelete: [id]
      });
  };

  // 2. Trigger for Bulk Delete
  const handleDeleteSelected = () => {
      if (!canDelete || selectedIds.size === 0) return;
      const visibleSelectedIds = paginatedBookings
          .filter((booking) => selectedIds.has(booking.id))
          .map((booking) => booking.id);
      if (visibleSelectedIds.length === 0) return;
      setDeleteModal({
          isOpen: true,
          idsToDelete: visibleSelectedIds
      });
  };

  // 3. Trigger for Undo Import
  const handleUndoImportTrigger = () => {
      if (!lastImportBatch) return;
      setDeleteModal({
          isOpen: true,
          idsToDelete: [lastImportBatch.id], // Here ID refers to BatchID
          isBatchUndo: true
      });
  };

  // 4. Confirm Action
  const confirmDeleteAction = async () => {
      const { idsToDelete, isBatchUndo } = deleteModal;
      let deletedCount = 0;

      try {
          if (isBatchUndo) {
              // Special case for Batch Undo
              const batchId = idsToDelete[0];
              deletedCount = await DataService.deleteBookingsByBatchId(batchId, currentUser.id);
              if (deletedCount > 0) setLastImportBatch(null);
          } else {
              // Normal Delete (Single or Bulk)
              const deletedIds = await DataService.deleteBookings(idsToDelete, currentUser.id);
              deletedCount = deletedIds.length;
              if (deletedCount > 0) setSelectedIds(new Set());
          }

          if (deletedCount <= 0) {
              alert('Không có đơn nào được xóa. Dữ liệu có thể đã thay đổi hoặc đã bị xóa trước đó.');
          }
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Lỗi không xác định';
          alert(`Xóa đơn thất bại: ${message}`);
      } finally {
          setDeleteModal({ isOpen: false, idsToDelete: [] });
          if (onRefresh) onRefresh();
      }
  };

  const handleCreate = () => {
      if(!canAdd) {
          alert("Bạn không có quyền tạo đơn.");
          return;
      }
      if (onCreateBooking) {
          onCreateBooking();
          return;
      }
      alert("Vui lòng sử dụng Sơ đồ phòng để tạo đơn mới trực quan hơn.");
  };

  const resetFilters = () => {
      setSearchTerm('');
      setPropertyFilter(currentPropertyId || 'ALL');
      setStatusFilter('ALL');
      setRoomTypeFilter('ALL');
      setRoomFilter('ALL');
      setFromDateFilter('');
      setToDateFilter('');
  };

  // --- EXCEL IMPORT/EXPORT LOGIC (UPDATED) ---

  const handleDownloadTemplate = () => {
      // Updated Headers per request
      const headers = [
          "Chi nhánh",
          "Hạng phòng", 
          "Tên phòng",
          "Khách hàng",
          "Thời gian đặt (dd/mm/yyyy hh:mm:ss)",
          "Thời gian nhận (dd/mm/yyyy hh:mm:ss)", 
          "Thời gian trả (dd/mm/yyyy hh:mm:ss)", 
          "Tổng tiền (###0)", 
          "Khách đã trả (###0)", 
          "Nhân viên đặt",
          "Ghi chú"
      ];
      
      const sampleRows = [
          ["HD", "HD", "202", "Đức Anh", "30/12/2025 10:15:00", "31/12/2025 23:30:00", "01/01/2026 07:30:00", 350000, 350000, "sale01", "Ghi chú mẫu"],
          ["K-Host ĐN", "Std", "301", "Nguyễn Văn A", "04/05/2025 21:40:00", "05/05/2025 14:00:00", "06/05/2025 12:00:00", 500000, 200000, "admin", "Khách quen"]
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      
      ws['!cols'] = [
          { wch: 15 }, // Chi nhánh
          { wch: 15 }, // Hạng phòng
          { wch: 15 }, // Tên phòng
          { wch: 25 }, // Khách hàng
          { wch: 25 }, // Thời gian đặt
          { wch: 25 }, // Thời gian nhận
          { wch: 25 }, // Thời gian trả
          { wch: 15 }, // Tổng tiền
          { wch: 15 }, // Đã trả
          { wch: 20 }, // Nhân viên đặt
          { wch: 20 }  // Ghi chú
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mau_Nhap_Lieu");
      XLSX.writeFile(wb, "KHost_Mau_Import_Booking.xlsx");
  };

  // Helper to infer status since it's no longer in the template
  const inferStatus = (checkIn: Date, checkOut: Date): BookingStatus => {
      const now = new Date();
      if (now > checkOut) return BookingStatus.CHECKED_OUT;
      if (now >= checkIn && now <= checkOut) return BookingStatus.CHECKED_IN;
      return BookingStatus.CONFIRMED;
  };

  // ROBUST DATE PARSER (VIETNAM FORMAT + EXCEL SERIAL + ISO)
  const parseImportDate = (val: any): string | null => {
      if (!val) return null;

      let dateObj: Date | null = null;

      // 1. Handle Excel Serial Number (e.g., 45657.9)
      if (typeof val === 'number') {
           // Excel base date is 1900-01-01. JS is 1970-01-01. Diff is ~25569 days.
           dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
      } 
      // 2. Handle JS Date Object (SheetJS with cellDates: true)
      else if (val instanceof Date) {
           dateObj = val;
      }
      // 3. Handle String Format (Crucial for "31/12/2025 23:30:00")
      else if (typeof val === 'string') {
          const str = val.trim();
          // Regex for dd/mm/yyyy hh:mm:ss or dd/mm/yy hh:mm
          // Split by any non-digit character
          const parts = str.split(/[\s/:\-]+/);
          
          if (parts.length >= 3) {
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1; // JS Month is 0-11
              let year = parseInt(parts[2], 10);
              // Handle 2-digit year (e.g. 25 -> 2025)
              if (year < 100) year += 2000;

              const hour = parts[3] ? parseInt(parts[3], 10) : 12; // Default to noon if no time
              const min = parts[4] ? parseInt(parts[4], 10) : 0;
              const sec = parts[5] ? parseInt(parts[5], 10) : 0;

              dateObj = new Date(year, month, day, hour, min, sec);
          } else {
              // Try standard parsing as fallback
              const tryDate = new Date(str);
              if (!isNaN(tryDate.getTime())) dateObj = tryDate;
          }
      }

      if (!dateObj || isNaN(dateObj.getTime())) return null;

      // ADJUST TIMEZONE: We want the string to "Look" like the local time without UTC conversion shift.
      const offset = dateObj.getTimezoneOffset() * 60000; 
      const localDate = new Date(dateObj.getTime() - offset);
      
      // Return ISO string without 'Z' -> "2025-12-31T23:30:00.000"
      return localDate.toISOString().slice(0, -1);
  };

  const parseImportAmount = (value: any): number => {
      if (value === null || value === undefined || value === '') return 0;
      if (typeof value === 'number' && Number.isFinite(value)) return value;

      const raw = String(value).trim();
      if (!raw) return 0;

      // Hỗ trợ format VN phổ biến: 490.000 / 1,200,000 / 1 200 000đ
      const normalizedDigits = raw
          .replace(/[₫đĐ]/g, '')
          .replace(/\s+/g, '')
          .replace(/[^\d-]/g, '');

      const parsed = Number(normalizedDigits);
      return Number.isFinite(parsed) ? parsed : 0;
  };

  const resolveImportStaff = (rawValue: any) => {
      const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
      const staffText = String(rawValue || '').trim();
      if (!staffText) return { staffId: currentUser.id, unresolved: '' };
      const matchedUser = userLookupByImportKey.get(normalize(staffText));
      if (matchedUser) return { staffId: matchedUser.id, unresolved: '' };
      return { staffId: currentUser.id, unresolved: staffText };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      const reader = new FileReader();
      
      reader.onload = async (evt) => {
          try {
              const raw = evt.target?.result;
              if (!raw) throw new Error('File reader không trả về dữ liệu');

              const wb =
                  raw instanceof ArrayBuffer
                      ? XLSX.read(new Uint8Array(raw), { type: 'array', cellDates: true })
                      : XLSX.read(raw, { type: 'binary', cellDates: true });
              const wsname = wb.SheetNames[0];
              const ws = wb.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

              // Data[0] is Header
              // Data[1...] is Rows
              let successCount = 0;
              let errorLog: string[] = [];
              let warningLog: string[] = [];

              if (data.length < 2) {
                  alert("File không có dữ liệu!");
                  setIsImporting(false);
                  return;
              }

              const allProperties = DataService.getProperties();
              const propertyLookup = buildPropertyImportLookup(allProperties);
              const propertyNamesHint = allProperties.map((property) => property.name).join(', ');
              const batchId = `import_${Date.now()}`;
              const headerRow = Array.isArray(data[0]) ? (data[0] as any[]) : [];
              const normalizedHeaders = headerRow.map((cell) => String(cell || '').trim().toLowerCase());
              const isNewTemplate = normalizedHeaders.length >= 11;

              const findColumnIndex = (candidates: string[], fallback: number) => {
                  const idx = normalizedHeaders.findIndex((header) =>
                      candidates.some((candidate) => header.includes(candidate))
                  );
                  return idx >= 0 ? idx : fallback;
              };

              const columns = {
                  branch: findColumnIndex(['chi nhánh', 'chi nhanh'], 0),
                  room: findColumnIndex(['tên phòng', 'ten phong'], 2),
                  guest: findColumnIndex(['khách hàng', 'khach hang'], 3),
                  createdAt: findColumnIndex(['thời gian đặt', 'thoi gian dat', 'ngày đặt', 'ngay dat'], isNewTemplate ? 4 : -1),
                  checkIn: findColumnIndex(['thời gian nhận', 'thoi gian nhan', 'nhận phòng', 'nhan phong'], isNewTemplate ? 5 : 4),
                  checkOut: findColumnIndex(['thời gian trả', 'thoi gian tra', 'trả phòng', 'tra phong'], isNewTemplate ? 6 : 5),
                  total: findColumnIndex(['tổng tiền', 'tong tien'], isNewTemplate ? 7 : 6),
                  paid: findColumnIndex(['khách đã trả', 'khach da tra', 'đã trả', 'da tra'], isNewTemplate ? 8 : 7),
                  staff: findColumnIndex(['nhân viên đặt', 'nhan vien dat', 'sale', 'nhân viên', 'nhan vien'], isNewTemplate ? 9 : -1),
                  note: findColumnIndex(['ghi chú', 'ghi chu', 'note'], isNewTemplate ? 10 : 8),
              };

              const readCell = (row: any[], index: number) => (index >= 0 ? row[index] : undefined);

              // Loop through rows
              for (let i = 1; i < data.length; i++) {
                  const row: any = data[i];
                  if (!row || row.length === 0) continue;

                  // --- EXTRACT DATA ---
                  const branchName = String(readCell(row, columns.branch) || '').trim();
                  const roomNum = String(readCell(row, columns.room) || '').trim(); // Tên phòng
                  const guestName = String(readCell(row, columns.guest) || 'Khách Import');
                  const createdAtRaw = readCell(row, columns.createdAt);
                  const checkInRaw = readCell(row, columns.checkIn);
                  const checkOutRaw = readCell(row, columns.checkOut);
                  const total = parseImportAmount(readCell(row, columns.total));
                  const paid = parseImportAmount(readCell(row, columns.paid));
                  const staffRaw = readCell(row, columns.staff);
                  const note = String(readCell(row, columns.note) || '');

                  if (!roomNum) continue; // Skip empty rows

                  // --- 1. STRICT PROPERTY MATCHING ---
                  let targetPropId: string | undefined;
                  
                  if (branchName) {
                      const resolvedProperty = resolveImportedProperty(branchName, propertyLookup);
                      if (resolvedProperty.status === 'NOT_FOUND') {
                          errorLog.push(
                              `Dòng ${i + 1}: Chi nhánh "${branchName}" không khớp chính xác trong hệ thống. Vui lòng nhập đúng tên/viết tắt duy nhất (VD: ${propertyNamesHint}).`
                          );
                          continue;
                      }
                      if (resolvedProperty.status === 'AMBIGUOUS') {
                          const candidateNames = resolvedProperty.candidates.map((property) => property.name).join(', ');
                          errorLog.push(
                              `Dòng ${i + 1}: Chi nhánh "${branchName}" bị mơ hồ (${candidateNames}). Vui lòng ghi rõ hơn để tránh vào sai cơ sở.`
                          );
                          continue;
                      }
                      if (resolvedProperty.status === 'MATCHED' && resolvedProperty.property) {
                          targetPropId = resolvedProperty.property.id;
                      }
                  }

                  // --- 2. ROOM FINDING LOGIC ---
                  let targetRoom: Room | undefined;

                  // Find all rooms with this number (normalize cả trường hợp có/không có khoảng trắng)
                  const normalizeRoomNumber = (value: string) => value.toLowerCase().replace(/\s+/g, '');
                  const targetRoomNumber = normalizeRoomNumber(roomNum);
                  const matches = rooms.filter(r => normalizeRoomNumber(r.number || '') === targetRoomNumber);

                  if (matches.length === 0) {
                      errorLog.push(`Dòng ${i+1}: Không tìm thấy phòng số "${roomNum}" trong hệ thống.`);
                      continue;
                  } else if (targetPropId) {
                      targetRoom = matches.find(r => r.propertyId === targetPropId);
                      if (!targetRoom) {
                          const branchesContainingSameRoom = Array.from(
                              new Set(
                                  matches
                                      .map((room) => allProperties.find((property) => property.id === room.propertyId)?.name || room.propertyId)
                                      .filter(Boolean)
                              )
                          );
                          errorLog.push(
                              `Dòng ${i + 1}: Phòng "${roomNum}" không thuộc chi nhánh "${branchName}". Phòng này hiện có ở: ${branchesContainingSameRoom.join(', ')}.`
                          );
                          continue;
                      }
                  } else if (matches.length === 1) {
                      targetRoom = matches[0];
                  } else {
                      errorLog.push(`Dòng ${i + 1}: Có nhiều phòng số "${roomNum}". Vui lòng nhập đúng tên Chi nhánh (VD: ${propertyNamesHint}) để phân biệt.`);
                      continue;
                  }

                  // --- 3. DATE PARSING ---
                  const checkInISO = parseImportDate(checkInRaw);
                  const checkOutISO = parseImportDate(checkOutRaw);

                  if (!checkInISO || !checkOutISO) {
                      errorLog.push(`Dòng ${i+1}: Định dạng ngày tháng không hợp lệ (Yêu cầu: dd/mm/yyyy hh:mm:ss).`);
                      continue;
                  }

                  const createdAtParsed = parseImportDate(createdAtRaw);
                  let createdAtISO = new Date().toISOString();
                  if (createdAtRaw && !createdAtParsed) {
                      warningLog.push(`Dòng ${i+1}: Thời gian đặt không hợp lệ, đã gán theo thời gian hiện tại.`);
                  } else if (createdAtParsed) {
                      const createdAtDate = new Date(createdAtParsed);
                      if (!isNaN(createdAtDate.getTime())) {
                          createdAtISO = createdAtDate.toISOString();
                      }
                  }

                  const resolvedStaff = resolveImportStaff(staffRaw);
                  if (resolvedStaff.unresolved) {
                      warningLog.push(`Dòng ${i+1}: Không tìm thấy nhân viên "${resolvedStaff.unresolved}", đã gán về tài khoản import hiện tại (${currentUser.username}).`);
                  }

                  // --- 4. CREATE BOOKING ---
                  const inferredStatus = inferStatus(new Date(checkInISO), new Date(checkOutISO));

                  const newBooking: Booking = {
                      id: DataService.generateBookingId(),
                      tenantId: targetRoom.tenantId || currentUser.tenantId,
                      propertyId: targetRoom.propertyId,
                      roomId: targetRoom.id,
                      customerId: 'c_import',
                      guestName: guestName,
                      guestPhone: '', 
                      checkInDate: checkInISO,
                      checkOutDate: checkOutISO,
                      status: inferredStatus,
                      totalPrice: total,
                      paidAmount: paid,
                      createdAt: createdAtISO,
                      createdBy: resolvedStaff.staffId,
                      notes:
                          note +
                          (branchName ? ` [CN: ${branchName}]` : '') +
                          (resolvedStaff.unresolved ? ` [NV đặt import: ${resolvedStaff.unresolved}]` : '') +
                          " [Excel]",
                      tags: [],
                      extraFees: [],
                      importBatchId: batchId
                  };

                  try {
                      await DataService.addBooking(newBooking, { source: 'IMPORT', staffId: currentUser.id });
                      successCount++;
                  } catch (createError) {
                      const detail = createError instanceof Error ? createError.message : 'Không rõ nguyên nhân';
                      errorLog.push(`Dòng ${i + 1}: Không thể tạo đơn cho phòng "${roomNum}" (${detail}).`);
                      continue;
                  }
              }

              if (successCount > 0) {
                  DataService.recordHistoryEvent({
                      action: 'IMPORT',
                      entityType: 'BOOKING',
                      description: `Import ${successCount} đơn đặt phòng từ file ${file.name}`,
                      metadata: {
                          fileName: file.name,
                          batchId,
                          successCount,
                          errorCount: errorLog.length,
                          warningCount: warningLog.length
                      },
                      source: 'IMPORT'
                  });
                  setLastImportBatch({ id: batchId, count: successCount, fileName: file.name });
                  if (onRefresh) onRefresh();
                  
                  if (errorLog.length > 0) {
                      const warningText = warningLog.length > 0 ? `\n\nCẢNH BÁO:\n${warningLog.slice(0, 10).join('\n')}${warningLog.length > 10 ? '\n...' : ''}` : '';
                      alert(`Đã nhập thành công ${successCount} dòng.\n\nTUY NHIÊN CÓ MỘT SỐ LỖI:\n${errorLog.join('\n')}${warningText}`);
                  } else {
                      if (warningLog.length > 0) {
                          alert(`Đã nhập thành công ${successCount} đơn đặt phòng.\n\nCẢNH BÁO:\n${warningLog.slice(0, 10).join('\n')}${warningLog.length > 10 ? '\n...' : ''}`);
                      } else {
                          alert(`Đã nhập thành công ${successCount} đơn đặt phòng!`);
                      }
                  }
              } else {
                  if (errorLog.length > 0) alert(`KHÔNG NHẬP ĐƯỢC DÒNG NÀO!\n\nNguyên nhân:\n${errorLog.slice(0, 10).join('\n')}${errorLog.length > 10 ? '\n...' : ''}`);
                  else alert("File không có dữ liệu hợp lệ.");
              }

          } catch (error) {
              console.error(error);
              const errorMessage = error instanceof Error ? error.message : 'Không rõ nguyên nhân';
              alert(`Lỗi đọc file Excel. Vui lòng đảm bảo đúng định dạng mẫu.\nChi tiết kỹ thuật: ${errorMessage}`);
          } finally {
              setIsImporting(false);
              if (fileInputRef.current) fileInputRef.current.value = ''; // Reset input
          }
      };
      
      reader.readAsArrayBuffer(file);
  };

  const triggerUpload = () => {
      if (fileInputRef.current) fileInputRef.current.click();
  };

  const openBookingHistory = (bookingId: string) => {
      setHistoryFilters(defaultHistoryFilters());
      setHistoryModal({ isOpen: true, bookingId });
  };

  const closeBookingHistory = () => {
      setHistoryModal({ isOpen: false, bookingId: null });
      setHistoryFilters(defaultHistoryFilters());
  };

  const updateHistoryFilter = <K extends keyof BookingHistoryFilters>(key: K, value: BookingHistoryFilters[K]) => {
      setHistoryFilters((prev) => ({ ...prev, [key]: value }));
  };

  const getHistorySourceLabel = (source?: string) => {
      if (source === 'IMPORT') return 'IMPORT';
      if (source === 'SYSTEM') return 'SYSTEM';
      return 'TAY';
  };

  return (
    <div className="katka-liquid-page bookings-page bg-white rounded-lg shadow-sm border border-gray-200 animate-fade-in relative">
      <div className="bookings-heading p-6 border-b border-gray-200 flex flex-wrap justify-between items-start md:items-center gap-5">
        <div>
            <h2 className="page-title">Danh sách đặt phòng</h2>
            <p className="text-xs text-gray-500">Phạm vi đang xem: <span className="font-bold text-gray-700">{currentScopeName}</span></p>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
            {canAdd && (
                <>
                    <button 
                        onClick={handleDownloadTemplate}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors border border-gray-200"
                        title="Tải file Excel mẫu để nhập liệu"
                    >
                        <Download size={16} /> <span className="hidden sm:inline">Tải mẫu Excel</span>
                    </button>
                    
                    <button 
                        onClick={triggerUpload}
                        className="katka-secondary-btn hover:bg-gray-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm"
                        title="Nhập dữ liệu từ file Excel"
                        disabled={isImporting}
                    >
                        <FileUp size={16} /> <span className="hidden sm:inline">{isImporting ? 'Đang nhập...' : 'Nhập Excel'}</span>
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".xlsx, .xls" 
                        onChange={handleFileUpload} 
                    />

                    <button 
                        onClick={handleCreate}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm"
                        title="Chuyển sang Sơ đồ phòng để tạo đơn mới"
                    >
                        <Plus size={16} /> Tạo đơn mới
                    </button>
                </>
            )}
        </div>
        <div className="booking-summary w-full grid grid-cols-2 gap-3 xl:grid-cols-5">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-[11px] font-bold uppercase text-gray-400">Tổng đơn</div>
                <div className="text-base font-black text-gray-900">{filteredSummary.total}</div>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                <div className="text-[11px] font-bold uppercase text-red-400">Đang ở</div>
                <div className="text-base font-black text-red-700">{filteredSummary.checkedIn}</div>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="text-[11px] font-bold uppercase text-blue-400">Sắp vào</div>
                <div className="text-base font-black text-blue-700">{filteredSummary.confirmed}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-[11px] font-bold uppercase text-gray-400">Đã trả</div>
                <div className="text-base font-black text-gray-700">{filteredSummary.checkedOut}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                <div className="text-[11px] font-bold uppercase text-amber-500">Tổng nợ</div>
                <div className="text-base font-black text-amber-700">{formatCurrency(filteredSummary.debt)}</div>
            </div>
        </div>
      </div>
      
      {/* UNDO BANNER */}
      {lastImportBatch && (
          <div className="bg-blue-50 border-b border-blue-100 p-3 flex justify-between items-center animate-fade-in">
              <div className="flex items-center gap-2 text-blue-800 text-sm">
                  <CheckCircle size={18} className="text-green-600"/>
                  <span>
                      Đã nhập thành công <b>{lastImportBatch.count}</b> đơn từ file <i>{lastImportBatch.fileName}</i>.
                  </span>
              </div>
              <button 
                  onClick={handleUndoImportTrigger}
                  className="bg-white border border-blue-200 text-red-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-50 flex items-center gap-1 shadow-sm transition-colors"
              >
                  <RotateCcw size={14} /> Hoàn tác (Undo)
              </button>
          </div>
      )}

      {/* BULK ACTIONS TOOLBAR (Floating) */}
      {selectedInPageCount > 0 && canDelete && (
          <div className="absolute top-[80px] left-0 right-0 z-10 mx-4">
              <div className="bg-gray-800 text-white p-3 rounded-lg shadow-xl flex justify-between items-center animate-slide-up">
                  <div className="flex items-center gap-3">
                      <span className="font-bold text-sm bg-gray-700 px-2 py-1 rounded">
                          Đã chọn {selectedInPageCount}
                      </span>
                      <span className="text-xs text-gray-300">đơn đang hiển thị</span>
                  </div>
                  <button 
                      onClick={handleDeleteSelected}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-colors shadow-sm"
                  >
                      <Trash2 size={16}/> Xoá {selectedInPageCount} đơn
                  </button>
              </div>
          </div>
      )}

      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div className="relative max-w-md w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Tìm theo mã đơn, khách, SĐT, tags, phòng, hạng, chi nhánh..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={propertyFilter}
                    onChange={(e) => {
                        setPropertyFilter(e.target.value);
                        setRoomFilter('ALL');
                    }}
                    disabled={isHeaderScopedToSingleProperty}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title={isHeaderScopedToSingleProperty ? 'Bộ lọc chi nhánh đang đồng bộ theo header hiện tại' : 'Lọc theo chi nhánh'}
                >
                    <option value="ALL">Toàn bộ chi nhánh</option>
                    {properties.map((property) => (
                        <option key={property.id} value={property.id}>{property.name}</option>
                    ))}
                </select>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as BookingStatusFilter)}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="ALL">Tất cả trạng thái</option>
                    <option value={BookingStatus.HOLD}>Giữ chỗ</option>
                    <option value={BookingStatus.CONFIRMED}>Đã xác nhận</option>
                    <option value={BookingStatus.CHECKED_IN}>Đang ở</option>
                    <option value={BookingStatus.CHECKED_OUT}>Đã trả</option>
                </select>
                <select
                    value={roomTypeFilter}
                    onChange={(e) => {
                        setRoomTypeFilter(e.target.value);
                        setRoomFilter('ALL');
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="ALL">Tất cả hạng phòng</option>
                    {roomTypes.map((roomType) => (
                        <option key={roomType.id} value={roomType.id}>{roomType.name}</option>
                    ))}
                </select>
                <select
                    value={roomFilter}
                    onChange={(e) => setRoomFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="ALL">Tất cả phòng</option>
                    {visibleRooms.map((room) => (
                        <option key={room.id} value={room.id}>{room.number}</option>
                    ))}
                </select>
                <input
                    type="date"
                    value={fromDateFilter}
                    onChange={(e) => setFromDateFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Từ ngày"
                />
                <input
                    type="date"
                    value={toDateFilter}
                    onChange={(e) => setToDateFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Đến ngày"
                />
                <button
                    onClick={resetFilters}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                >
                    Xóa lọc
                </button>
                <span className="text-xs font-semibold text-gray-600 inline-flex items-center gap-1">
                    <ArrowUpDown size={14} />
                    Sắp xếp
                </span>
                <select
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as BookingSortField)}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="checkOutDate">Thời gian trả phòng</option>
                    <option value="checkInDate">Thời gian nhận phòng</option>
                    <option value="createdAt">Ngày tạo</option>
                </select>
                <select
                    value={sortDirection}
                    onChange={(e) => setSortDirection(e.target.value as SortDirection)}
                    className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="asc">Tăng dần</option>
                    <option value="desc">Giảm dần</option>
                </select>
                <span className="text-xs text-gray-500 bg-white px-3 py-2 rounded-md border border-gray-200">
                    Hiển thị <span className="font-bold text-gray-700">{visibleRangeStart}-{visibleRangeEnd}</span> / {sortedBookings.length} đơn phù hợp
                </span>
            </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 font-bold text-blue-700">
                Phạm vi: {currentScopeName}
            </span>
            {(isHydratingScope || isScopeLoading) && (
                <span className="inline-flex items-center rounded-full border border-blue-100 bg-white px-3 py-1 text-blue-700">
                    Đang tải danh sách đơn...
                </span>
            )}
            {isHeaderScopedToSingleProperty && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1">
                    Bộ lọc chi nhánh đang theo header, đổi chi nhánh ở thanh trên để xem cơ sở khác.
                </span>
            )}
            {hasActiveFilters && (
                <span className="inline-flex items-center rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-amber-700">
                    Đang áp dụng bộ lọc
                </span>
            )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="booking-table w-full min-w-[1700px] text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-gray-700 font-semibold uppercase text-xs">
            <tr>
              <th className="px-4 py-3 w-10 text-center">
                  <button onClick={toggleSelectAll}>
                      {isAllInViewSelected ? (
                          <CheckSquare size={18} className="text-blue-600" />
                      ) : (
                          <Square size={18} className="text-gray-400 hover:text-gray-600" />
                      )}
                  </button>
              </th>
              <th className="px-6 py-3">Mã BK</th>
              <th className="sticky left-0 z-20 min-w-[220px] bg-gray-50 px-6 py-3 shadow-[4px_0_6px_-4px_rgba(0,0,0,0.25)]">Khách hàng</th>
              <th className="px-6 py-3">Tags</th>
              <th className="sticky left-[220px] z-20 min-w-[150px] bg-gray-50 px-6 py-3 shadow-[4px_0_6px_-4px_rgba(0,0,0,0.25)]">Phòng</th>
              <th className="px-6 py-3">Hạng phòng</th>
              <th className="px-6 py-3">Chi nhánh</th>
              <th className="px-6 py-3">Ngày tạo</th>
              <th className="px-6 py-3">Thời gian nhận phòng</th>
              <th className="px-6 py-3">Thời gian trả phòng</th>
              <th className="px-6 py-3">Trạng thái</th>
              <th className="px-6 py-3 text-right">Tài chính</th>
              <th className="px-6 py-3">Nhân viên tạo đơn</th>
              <th className="sticky right-0 z-20 min-w-[190px] bg-gray-50 px-6 py-3 text-right shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.25)]">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedBookings.map((booking) => {
                const isSelected = selectedIds.has(booking.id);
                const tagLabels = getBookingTags(booking);
                const effectiveStatus = deriveBookingStatus(booking, nowMs);
                const room = roomById.get(booking.roomId);
                const isMissingRoom = !room;
                const { extraRevenue, extraExpense, netRevenue, totalBill, paidAmount, outstanding, isGroupedChild } =
                    getBookingFinancialSummary(booking);
                return (
                  <tr key={booking.id} className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-4 text-center">
                        <button onClick={() => toggleSelectRow(booking.id)}>
                            {isSelected ? (
                                <CheckSquare size={18} className="text-blue-600" />
                            ) : (
                                <Square size={18} className="text-gray-300 hover:text-gray-500" />
                            )}
                        </button>
                    </td>
                    <td className="px-6 py-4 font-mono text-blue-600 font-medium">{booking.id}</td>
                    <td className={`sticky left-0 z-10 min-w-[220px] px-6 py-4 font-medium text-gray-900 shadow-[4px_0_6px_-4px_rgba(0,0,0,0.25)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                        <div>{getDisplayName(booking)}</div>
                        <div className="text-xs text-gray-400">{booking.guestPhone}</div>
                    </td>
                    <td className="px-6 py-4">
                        {tagLabels.length === 0 ? (
                            <span className="text-xs text-gray-400">--</span>
                        ) : (
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                                {tagLabels.map((label, index) => (
                                    <span key={`${booking.id}-tag-${index}`} className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-[11px] font-medium text-gray-700">
                                        {label}
                                    </span>
                                ))}
                            </div>
                        )}
                    </td>
                    <td className={`sticky left-[220px] z-10 min-w-[150px] px-6 py-4 shadow-[4px_0_6px_-4px_rgba(0,0,0,0.25)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded font-bold ${isMissingRoom ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-gray-100 text-gray-700'}`}>
                            {isMissingRoom && <AlertTriangle size={13} />}
                            {getRoomNumber(booking.roomId)}
                        </span>
                    </td>
                    <td className="px-6 py-4">{getRoomTypeName(booking)}</td>
                    <td className="px-6 py-4">{getPropertyName(booking)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{toDateTimeLabel(booking.createdAt)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{toDateTimeLabel(booking.checkInDate)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{toDateTimeLabel(booking.checkOutDate)}</td>
                    <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${getBookingStatusPillClass(effectiveStatus)}`}>
                            {getBookingStatusLabel(effectiveStatus)}
                        </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                        {isGroupedChild ? (
                            <span className="text-xs text-gray-400 italic">Theo đoàn</span>
                        ) : (
                            <div className="space-y-0.5 whitespace-nowrap text-xs">
                                <div><span className="text-gray-400">Bill:</span> <span className="font-bold text-gray-800">{formatCurrency(totalBill)}</span></div>
                                <div><span className="text-gray-400">Đã trả:</span> <span className="font-semibold text-gray-700">{formatCurrency(paidAmount)}</span></div>
                                <div><span className="text-gray-400">Nợ:</span> <span className={`font-black ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(outstanding)}</span></div>
                                {(extraRevenue > 0 || extraExpense > 0) && (
                                    <div className="text-[11px] text-gray-400">Khác: +{formatCurrency(extraRevenue)} / -{formatCurrency(extraExpense)}</div>
                                )}
                            </div>
                        )}
                    </td>
                    <td className="px-6 py-4">{getCreatorLabel(booking)}</td>
                    <td className={`sticky right-0 z-10 min-w-[190px] px-6 py-4 text-right shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.25)] ${isSelected ? 'bg-blue-50' : 'bg-white'}`}>
                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={() => setDetailModalBookingId(booking.id)}
                                className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-2.5 py-2 rounded transition-colors font-bold text-xs"
                                title="Chi tiết đơn"
                            >
                                <Eye size={16} /> Chi tiết
                            </button>
                            <button
                                onClick={() => openBookingHistory(booking.id)}
                                className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-2 rounded transition-colors"
                                title="Lịch sử thao tác đơn"
                            >
                                <Clock3 size={18} />
                            </button>
                            {canDelete && (
                                <button 
                                    onClick={() => handleDeleteSingle(booking.id)} 
                                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors" 
                                    title="Xóa đơn vĩnh viễn"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    </td>
                  </tr>
                );
            })}
            {sortedBookings.length === 0 && (
                <tr>
                    <td colSpan={14} className="px-6 py-10 text-center">
                        <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-gray-50 p-5">
                            <div className="font-bold text-gray-800">{isHydratingScope || isScopeLoading ? 'Đang tải danh sách đơn...' : 'Không có đơn phù hợp'}</div>
                            <div className="mt-1 text-sm text-gray-500">
                                {isHydratingScope || isScopeLoading ? `Đang đồng bộ dữ liệu trong phạm vi ${currentScopeName}.` : emptyStateText}
                            </div>
                            {!isHydratingScope && !isScopeLoading && hasActiveFilters && (
                                <button
                                    onClick={resetFilters}
                                    className="mt-4 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100"
                                >
                                    Xóa bộ lọc
                                </button>
                            )}
                        </div>
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {sortedBookings.length > BOOKINGS_PER_PAGE && (
          <div className="flex flex-col gap-3 border-t border-gray-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-gray-600">
                  Trang <span className="font-bold text-gray-900">{safePageIndex}</span> / {totalPages}, hiển thị {visibleRangeStart}-{visibleRangeEnd} trong {sortedBookings.length} đơn phù hợp.
              </div>
              <div className="flex items-center gap-2">
                  <button
                      type="button"
                      onClick={() => setCurrentPageIndex(1)}
                      disabled={safePageIndex === 1}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-gray-50"
                  >
                      Đầu
                  </button>
                  <button
                      type="button"
                      onClick={() => setCurrentPageIndex((page) => Math.max(1, page - 1))}
                      disabled={safePageIndex === 1}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-gray-50"
                  >
                      Trước
                  </button>
                  <button
                      type="button"
                      onClick={() => setCurrentPageIndex((page) => Math.min(totalPages, page + 1))}
                      disabled={safePageIndex === totalPages}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-gray-50"
                  >
                      Sau
                  </button>
                  <button
                      type="button"
                      onClick={() => setCurrentPageIndex(totalPages)}
                      disabled={safePageIndex === totalPages}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-gray-50"
                  >
                      Cuối
                  </button>
              </div>
          </div>
      )}

      {selectedDetailBooking && (
          <DialogFrame label="Chi tiết đặt phòng" onDismiss={() => setDetailModalBookingId(null)} className="fixed inset-0 bg-black/50 z-[104] flex items-center justify-center p-3 md:p-5" onClick={() => setDetailModalBookingId(null)}>
              <div
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(100dvh-32px)] overflow-hidden animate-fade-in"
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                      <div>
                          <h3 className="text-lg font-bold text-gray-900">Chi tiết đơn #{selectedDetailBooking.id}</h3>
                          <p className="text-xs text-gray-500 mt-1">Xem nhanh thông tin khách, phòng, lịch ở và tài chính</p>
                      </div>
                      <button
                          onClick={() => setDetailModalBookingId(null)}
                          className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title="Đóng chi tiết"
                      >
                          <X size={18} />
                      </button>
                  </div>

                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm overflow-y-auto max-h-[calc(100dvh-140px)]">
                      <div className="space-y-3">
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Khách hàng</div>
                              <div className="mt-2 text-base font-bold text-gray-900">{getDisplayName(selectedDetailBooking)}</div>
                              <div className="text-sm text-gray-600 mt-1">{selectedDetailBooking.guestPhone || '--'}</div>
                              <div className="text-sm text-gray-600 mt-1">Trạng thái: <span className="font-semibold text-gray-900">{getBookingStatusLabel(deriveBookingStatus(selectedDetailBooking, nowMs))}</span></div>
                          </div>
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Lưu trú</div>
                              <div className="mt-2 text-sm text-gray-700">Chi nhánh: <span className="font-semibold text-gray-900">{getPropertyName(selectedDetailBooking)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Phòng: <span className="font-semibold text-gray-900">{getRoomNumber(selectedDetailBooking.roomId)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Hạng phòng: <span className="font-semibold text-gray-900">{getRoomTypeName(selectedDetailBooking)}</span></div>
                              {!roomById.get(selectedDetailBooking.roomId) && (
                                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                                      Phòng của đơn này không còn khớp dữ liệu phòng hiện tại.
                                  </div>
                              )}
                              <div className="mt-1 text-sm text-gray-700">Nhận phòng: <span className="font-semibold text-gray-900">{toDateTimeLabel(selectedDetailBooking.checkInDate)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Trả phòng: <span className="font-semibold text-gray-900">{toDateTimeLabel(selectedDetailBooking.checkOutDate)}</span></div>
                              {onOpenRoomMapBooking && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                      <button
                                          onClick={() => onOpenRoomMapBooking(selectedDetailBooking)}
                                          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                      >
                                          Mở trên sơ đồ phòng
                                      </button>
                                      <button
                                          onClick={() => onOpenRoomMapBooking(selectedDetailBooking)}
                                          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
                                      >
                                          Sửa đơn
                                      </button>
                                  </div>
                              )}
                          </div>
                      </div>

                      <div className="space-y-3">
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Tài chính</div>
                              {(() => {
                                  const summary = getBookingFinancialSummary(selectedDetailBooking);
                                  return (
                                      <div className="mt-2 space-y-1 text-sm text-gray-700">
                                          <div>Tổng bill: <span className="font-semibold text-gray-900">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.totalBill)}</span></div>
                                          <div>Thu khác: <span className="font-semibold text-green-700">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.extraRevenue)}</span></div>
                                          <div>Chi khác: <span className="font-semibold text-red-700">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.extraExpense)}</span></div>
                                          <div>Doanh thu net: <span className="font-semibold text-blue-700">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.netRevenue)}</span></div>
                                          <div>Đã trả: <span className="font-semibold text-gray-900">{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.paidAmount)}</span></div>
                                          <div>Còn nợ: <span className={`font-semibold ${summary.outstanding > 0 ? 'text-red-700' : 'text-green-700'}`}>{summary.isGroupedChild ? 'Theo đoàn' : formatCurrency(summary.outstanding)}</span></div>
                                      </div>
                                  );
                              })()}
                          </div>
                          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">Khác</div>
                              <div className="mt-2 text-sm text-gray-700">Nhân viên tạo: <span className="font-semibold text-gray-900">{getCreatorLabel(selectedDetailBooking)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Ngày tạo: <span className="font-semibold text-gray-900">{toDateTimeLabel(selectedDetailBooking.createdAt)}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Tags: <span className="font-semibold text-gray-900">{getBookingTags(selectedDetailBooking).length > 0 ? getBookingTags(selectedDetailBooking).join(', ') : '--'}</span></div>
                              <div className="mt-1 text-sm text-gray-700">Ghi chú:</div>
                              <div className="mt-1 rounded-lg bg-white border border-gray-200 p-3 text-sm text-gray-700 min-h-20 whitespace-pre-wrap">
                                  {selectedDetailBooking.notes || 'Không có ghi chú'}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </DialogFrame>
      )}

      {historyModal.isOpen && selectedHistoryBooking && (
          <DialogFrame label="Lịch sử đặt phòng" onDismiss={closeBookingHistory} className="fixed inset-0 bg-black/50 z-[105] flex items-center justify-center p-3 md:p-5" onClick={closeBookingHistory}>
              <div
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-[min(1300px,96vw)] max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden animate-fade-in"
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="px-4 py-3 md:px-5 md:py-4 border-b border-gray-200 flex items-center justify-between gap-3">
                      <div>
                          <h3 className="text-base md:text-lg font-bold text-gray-900">Lịch sử gần đây của đơn #{selectedHistoryBooking.id}</h3>
                          <p className="text-xs text-gray-500 mt-1">
                              Đang lấy 80 log gần nhất. Hiển thị: Thời gian • Tên đăng nhập • Thao tác • Trước/Sau
                          </p>
                      </div>
                      <button
                          onClick={closeBookingHistory}
                          className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title="Đóng lịch sử"
                      >
                          <X size={18} />
                      </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-5 space-y-4 bg-gray-50/40">
                      <div className="bg-white border border-gray-200 rounded-xl p-3 md:p-4 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                              <label className="text-xs font-semibold text-gray-600">
                                  Từ ngày
                                  <input
                                      type="date"
                                      value={historyFilters.fromDate}
                                      onChange={(e) => updateHistoryFilter('fromDate', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  />
                              </label>

                              <label className="text-xs font-semibold text-gray-600">
                                  Đến ngày
                                  <input
                                      type="date"
                                      value={historyFilters.toDate}
                                      onChange={(e) => updateHistoryFilter('toDate', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  />
                              </label>

                              <label className="text-xs font-semibold text-gray-600">
                                  Chi nhánh
                                  <select
                                      value={historyFilters.propertyId}
                                      onChange={(e) => updateHistoryFilter('propertyId', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  >
                                      <option value="ALL">Tất cả chi nhánh</option>
                                      {historyFilterOptions.properties.map((property) => (
                                          <option key={property.id} value={property.id}>{property.label}</option>
                                      ))}
                                  </select>
                              </label>

                              <label className="text-xs font-semibold text-gray-600">
                                  Phòng
                                  <select
                                      value={historyFilters.roomId}
                                      onChange={(e) => updateHistoryFilter('roomId', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  >
                                      <option value="ALL">Tất cả phòng</option>
                                      {historyFilterOptions.rooms.map((room) => (
                                          <option key={room.id} value={room.id}>{room.label}</option>
                                      ))}
                                  </select>
                              </label>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                              <label className="text-xs font-semibold text-gray-600">
                                  Trạng thái
                                  <select
                                      value={historyFilters.status}
                                      onChange={(e) => updateHistoryFilter('status', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  >
                                      <option value="ALL">Tất cả trạng thái</option>
                                      {historyFilterOptions.statuses.map((status) => (
                                          <option key={status} value={status}>{status}</option>
                                      ))}
                                  </select>
                              </label>

                              <label className="text-xs font-semibold text-gray-600">
                                  Người thao tác
                                  <select
                                      value={historyFilters.actorId}
                                      onChange={(e) => updateHistoryFilter('actorId', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  >
                                      <option value="ALL">Tất cả người thao tác</option>
                                      {historyFilterOptions.actors.map((actor) => (
                                          <option key={actor.id} value={actor.id}>{actor.label}</option>
                                      ))}
                                  </select>
                              </label>

                              <label className="text-xs font-semibold text-gray-600">
                                  Nguồn thao tác
                                  <select
                                      value={historyFilters.source}
                                      onChange={(e) => updateHistoryFilter('source', e.target.value as HistorySourceFilter)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  >
                                      <option value="ALL">Tất cả nguồn</option>
                                      <option value="WEB">Tay (Web/App)</option>
                                      <option value="IMPORT">Import</option>
                                      <option value="SYSTEM">System</option>
                                  </select>
                              </label>

                              <div className="flex items-end">
                                  <button
                                      onClick={() => setHistoryFilters(defaultHistoryFilters())}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-100 text-sm font-semibold text-gray-700 transition-colors"
                                  >
                                      Xóa bộ lọc
                                  </button>
                              </div>
                          </div>

                          <div className="text-xs text-gray-500">
                              Đang hiển thị <span className="font-bold text-gray-700">{filteredBookingHistory.length}</span> / {bookingHistoryLogs.length} bản ghi lịch sử.
                          </div>
                      </div>

                      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                          <div className="overflow-auto max-h-[420px]">
                              {isLoadingHistory ? (
                                  <div className="py-10 text-center text-gray-400 text-sm">Đang tải lịch sử gần đây...</div>
                              ) : filteredBookingHistory.length === 0 ? (
                                  <div className="py-10 text-center text-gray-400 text-sm">Không có lịch sử phù hợp với bộ lọc hiện tại.</div>
                              ) : (
                                  <table className="w-full min-w-[1300px] text-left text-xs">
                                      <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider sticky top-0">
                                          <tr>
                                              <th className="px-3 py-2.5 font-bold w-[170px]">Thời gian</th>
                                              <th className="px-3 py-2.5 font-bold w-[170px]">Tên đăng nhập</th>
                                              <th className="px-3 py-2.5 font-bold w-[320px]">Thao tác</th>
                                              <th className="px-3 py-2.5 font-bold w-[290px]">Trước</th>
                                              <th className="px-3 py-2.5 font-bold w-[290px]">Sau</th>
                                              <th className="px-3 py-2.5 font-bold w-[110px]">Nguồn</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                          {filteredBookingHistory.map((log) => {
                                              const metadata = (log.metadata || {}) as Record<string, any>;
                                              const operationName =
                                                  (typeof metadata.operationName === 'string' && metadata.operationName) ||
                                                  log.action;
                                              const { beforeText, afterText } = getHistoryBeforeAfter(log);

                                              return (
                                                  <tr key={log.id} className="hover:bg-gray-50 align-top">
                                                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{toDateTimeWithSecondsLabel(log.timestamp)}</td>
                                                      <td className="px-3 py-2.5 font-semibold text-gray-800 break-words">{getActorUsername(log)}</td>
                                                      <td className="px-3 py-2.5">
                                                          <div className="font-semibold text-gray-900 break-words">{operationName}</div>
                                                          <div className="text-gray-500 mt-1 break-words">{log.description}</div>
                                                      </td>
                                                      <td className="px-3 py-2.5 text-gray-700 whitespace-pre-wrap break-words">{beforeText}</td>
                                                      <td className="px-3 py-2.5 text-gray-700 whitespace-pre-wrap break-words">{afterText}</td>
                                                      <td className="px-3 py-2.5">
                                                          <span className="inline-flex px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
                                                              {getHistorySourceLabel(log.source)}
                                                          </span>
                                                      </td>
                                                  </tr>
                                              );
                                          })}
                                      </tbody>
                                  </table>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </DialogFrame>
      )}

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {deleteModal.isOpen && (
          <DialogFrame label="Xác nhận xóa" onDismiss={() => setDeleteModal({...deleteModal, isOpen: false})} className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in relative" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setDeleteModal({...deleteModal, isOpen: false})} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 mx-auto">
                      <AlertTriangle size={24} />
                  </div>
                  
                  <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                      {deleteModal.isBatchUndo ? 'Hoàn tác Import' : 'Xác nhận xoá'}
                  </h3>
                  
                  <div className="text-sm text-center mb-6 text-gray-600">
                      {deleteModal.isBatchUndo ? (
                          `Bạn có chắc chắn muốn hoàn tác và xoá toàn bộ các đơn đặt phòng vừa nhập?`
                      ) : (
                          <>
                              Bạn sắp xoá vĩnh viễn <b>{deleteModal.idsToDelete.length}</b> đơn đặt phòng.
                              <br/>Hành động này không thể khôi phục.
                          </>
                      )}
                  </div>
                  
                  <div className="flex gap-3">
                      <button 
                          onClick={() => setDeleteModal({...deleteModal, isOpen: false})} 
                          className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors"
                      >
                          Huỷ bỏ
                      </button>
                      <button 
                          onClick={confirmDeleteAction} 
                          className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                      >
                          {deleteModal.isBatchUndo ? 'Xác nhận Hoàn tác' : 'Xoá vĩnh viễn'}
                      </button>
                  </div>
              </div>
          </DialogFrame>
      )}
    </div>
  );
};

export default Bookings;
