import React, { useEffect, useMemo, useState } from 'react';
import { BedDouble, Building2, CalendarCheck, CreditCard, Filter, Trophy } from 'lucide-react';
import { Booking, BookingStatus, Property, Room } from '../types';
import { isArchiveBucketRoom } from '../utils/roomBuckets';
import { deriveBookingStatus } from '../utils/bookingState';

interface DashboardProps {
  bookings: Booking[];
  rooms: Room[];
  properties: Property[];
  currentPropertyId: string;
}

type DatePreset = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'LAST_WEEK' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'THIS_QUARTER' | 'LAST_QUARTER' | 'THIS_YEAR' | 'LAST_YEAR' | 'CUSTOM';
type TopMode = 'ROOM' | 'PROPERTY';
type TopSortMetric = 'revenue' | 'turnoverOcc' | 'guestTurns';
type SortDirection = 'asc' | 'desc';

interface MoneyAggregate {
  count: number;
  roomRevenue: number;
  serviceRevenue: number;
  totalBill: number;
  paid: number;
  debt: number;
}

interface StayStats {
  roomRevenue: number;
  serviceRevenue: number;
  totalRevenue: number;
  roomNights: number;
  guestTurns: number;
  overnightRoomRevenue: number;
}

interface TopRow {
  id: string;
  label: string;
  subLabel: string;
  revenue: number;
  turnoverOcc: number;
  guestTurns: number;
}

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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURLY_BOOKING_LIMIT_HOURS = 12;

const toDate = (input: string | Date) => {
  if (input instanceof Date) return new Date(input);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(input);
};

const startOfLocalDay = (input: string | Date) => {
  const date = toDate(input);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endExclusiveOfLocalDay = (input: string | Date) => {
  const date = startOfLocalDay(input);
  date.setDate(date.getDate() + 1);
  return date;
};

const getLocalDateKey = (input: string | Date) => {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatLocalDateInput = (date: Date) => getLocalDateKey(date);

const isFiniteTime = (value: number) => Number.isFinite(value) && !Number.isNaN(value);

const getBookingTimes = (booking: Booking) => {
  const checkInMs = new Date(booking.checkInDate).getTime();
  const checkOutMs = new Date(booking.checkOutDate).getTime();
  if (!isFiniteTime(checkInMs) || !isFiniteTime(checkOutMs) || checkOutMs <= checkInMs) return null;
  return { checkInMs, checkOutMs, durationMs: checkOutMs - checkInMs };
};

const getOverlapMs = (startA: number, endA: number, startB: number, endB: number) =>
  Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));

const getExtraRevenue = (booking: Booking) =>
  (booking.extraFees || [])
    .filter((fee) => fee.type === 'REVENUE')
    .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);

const getRoomRevenue = (booking: Booking) => Number(booking.totalPrice) || 0;

const getPaidAmount = (booking: Booking) => Number(booking.paidAmount) || 0;

const isHourlyBooking = (booking: Booking) => {
  const times = getBookingTimes(booking);
  if (!times) return true;
  return times.durationMs <= HOURLY_BOOKING_LIMIT_HOURS * HOUR_MS;
};

const getNightStarts = (booking: Booking) => {
  const times = getBookingTimes(booking);
  if (!times) return [];

  const checkInDay = startOfLocalDay(booking.checkInDate);
  const checkOutDay = startOfLocalDay(booking.checkOutDate);
  const nights: Date[] = [];

  if (checkOutDay.getTime() > checkInDay.getTime()) {
    for (let cursor = new Date(checkInDay); cursor.getTime() < checkOutDay.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      nights.push(new Date(cursor));
    }
    return nights;
  }

  // Fallback cho đơn > 12 giờ nhưng cùng ngày: vẫn phân bổ như 1 đêm để không làm mất doanh thu.
  return [checkInDay];
};

const groupFinancials = (source: Booking[], includeExtraRevenue = false): MoneyAggregate => {
  const grouped = new Map<string, Booking[]>();

  source.forEach((booking) => {
    const key = booking.groupId || booking.id;
    const list = grouped.get(key) || [];
    list.push(booking);
    grouped.set(key, list);
  });

  const records = Array.from(grouped.values()).map((members) => {
    const roomRevenue = members.reduce((sum, booking) => sum + getRoomRevenue(booking), 0);
    const serviceRevenue = includeExtraRevenue ? members.reduce((sum, booking) => sum + getExtraRevenue(booking), 0) : 0;
    const totalBill = roomRevenue + serviceRevenue;
    const paid = members.reduce((sum, booking) => sum + getPaidAmount(booking), 0);
    return { roomRevenue, serviceRevenue, totalBill, paid, debt: Math.max(totalBill - paid, 0) };
  });

  return {
    count: records.length,
    roomRevenue: records.reduce((sum, record) => sum + record.roomRevenue, 0),
    serviceRevenue: records.reduce((sum, record) => sum + record.serviceRevenue, 0),
    totalBill: records.reduce((sum, record) => sum + record.totalBill, 0),
    paid: records.reduce((sum, record) => sum + record.paid, 0),
    debt: records.reduce((sum, record) => sum + record.debt, 0),
  };
};

const StatTile: React.FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone = 'text-gray-900' }) => (
  <div className="rounded-2xl border border-gray-100 bg-white/80 p-3 shadow-sm">
    <div className="text-[10px] font-black uppercase tracking-wide text-gray-400">{label}</div>
    <div className={`mt-1.5 text-lg md:text-xl font-black tracking-tight ${tone}`}>{value}</div>
    {sub && <div className="mt-1 text-[11px] font-semibold text-gray-400">{sub}</div>}
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ bookings, rooms, properties, currentPropertyId }) => {
  const [filterPreset, setFilterPreset] = useState<DatePreset>('THIS_MONTH');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [topMode, setTopMode] = useState<TopMode>('ROOM');
  const [topSort, setTopSort] = useState<{ metric: TopSortMetric; direction: SortDirection }>({
    metric: 'revenue',
    direction: 'desc',
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const getRange = (preset: DatePreset): { start: Date; end: Date } | null => {
      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);

      const getStartOfWeek = (date: Date) => {
        const clone = new Date(date);
        const day = clone.getDay();
        const diff = clone.getDate() - day + (day === 0 ? -6 : 1);
        clone.setDate(diff);
        return clone;
      };

      switch (preset) {
        case 'TODAY':
          break;
        case 'YESTERDAY':
          start.setDate(now.getDate() - 1);
          end.setDate(now.getDate() - 1);
          break;
        case 'THIS_WEEK': {
          const weekStart = getStartOfWeek(now);
          start.setTime(weekStart.getTime());
          break;
        }
        case 'LAST_WEEK': {
          const weekStart = getStartOfWeek(now);
          weekStart.setDate(weekStart.getDate() - 7);
          start.setTime(weekStart.getTime());
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          end.setTime(weekEnd.getTime());
          break;
        }
        case 'LAST_7_DAYS':
          start.setDate(now.getDate() - 7);
          break;
        case 'THIS_MONTH':
          start.setDate(1);
          break;
        case 'LAST_MONTH':
          start.setMonth(now.getMonth() - 1, 1);
          end.setDate(0);
          break;
        case 'LAST_30_DAYS':
          start.setDate(now.getDate() - 30);
          break;
        case 'THIS_QUARTER': {
          const quarter = Math.floor(now.getMonth() / 3);
          start.setMonth(quarter * 3, 1);
          break;
        }
        case 'LAST_QUARTER': {
          const currentQuarter = Math.floor(now.getMonth() / 3);
          const lastQuarterStartMonth = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
          start.setFullYear(currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear(), lastQuarterStartMonth, 1);
          const quarterEnd = new Date(start);
          quarterEnd.setMonth(quarterEnd.getMonth() + 3);
          quarterEnd.setDate(0);
          end.setTime(quarterEnd.getTime());
          break;
        }
        case 'THIS_YEAR':
          start.setMonth(0, 1);
          break;
        case 'LAST_YEAR':
          start.setFullYear(now.getFullYear() - 1, 0, 1);
          end.setFullYear(now.getFullYear() - 1, 11, 31);
          break;
        case 'CUSTOM':
          return null;
      }

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    };

    if (filterPreset !== 'CUSTOM') {
      const range = getRange(filterPreset);
      if (range) {
        setStartDate(formatLocalDateInput(range.start));
        setEndDate(formatLocalDateInput(range.end));
      }
    }
  }, [filterPreset]);

  const currentPropertyName = useMemo(() => {
    if (currentPropertyId === 'ALL') return `Toàn bộ chi nhánh (${properties.length})`;
    return properties.find((property) => property.id === currentPropertyId)?.name || 'Chi nhánh hiện tại';
  }, [currentPropertyId, properties]);

  const dateRangeInfo = useMemo(() => {
    if (!startDate || !endDate) return { valid: false, message: 'Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc.', days: 0 };
    const start = startOfLocalDay(startDate);
    const end = startOfLocalDay(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { valid: false, message: 'Khoảng ngày không hợp lệ.', days: 0 };
    if (start.getTime() > end.getTime()) return { valid: false, message: 'Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.', days: 0 };
    return {
      valid: true,
      message: '',
      days: Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1,
    };
  }, [startDate, endDate]);

  const rangeBounds = useMemo(() => {
    if (!dateRangeInfo.valid) return null;
    const start = startOfLocalDay(startDate);
    const endExclusive = endExclusiveOfLocalDay(endDate);
    return { start, endExclusive, startMs: start.getTime(), endExclusiveMs: endExclusive.getTime() };
  }, [startDate, endDate, dateRangeInfo.valid]);

  const operationalRooms = useMemo(
    () => rooms.filter((room) => !isArchiveBucketRoom(room) && (currentPropertyId === 'ALL' || room.propertyId === currentPropertyId)),
    [rooms, currentPropertyId]
  );

  const roomById = useMemo(() => {
    const map = new Map<string, Room>();
    operationalRooms.forEach((room) => map.set(room.id, room));
    return map;
  }, [operationalRooms]);

  const propertyById = useMemo(() => {
    const map = new Map<string, Property>();
    properties.forEach((property) => map.set(property.id, property));
    return map;
  }, [properties]);

  const isOperationalBooking = (booking: Booking) => {
    const room = roomById.get(booking.roomId);
    if (!room) return false;
    const effectiveStatus = deriveBookingStatus(booking, nowMs);
    if (effectiveStatus === BookingStatus.DELETED || effectiveStatus === BookingStatus.HOLD || booking.isHold) return false;
    return true;
  };

  const operationalBookings = useMemo(
    () => bookings.filter((booking) => isOperationalBooking(booking)),
    [bookings, roomById, nowMs]
  );

  const overlapsRange = (booking: Booking, startMs: number, endMs: number) => {
    const times = getBookingTimes(booking);
    if (!times) return false;
    return times.checkInMs < endMs && times.checkOutMs > startMs;
  };

  const isTimeInRange = (value: string, startMs: number, endMs: number) => {
    const timeMs = new Date(value).getTime();
    return isFiniteTime(timeMs) && timeMs >= startMs && timeMs < endMs;
  };

  const calculateStayStats = (periodStartMs: number, periodEndMs: number, serviceAnchorBaseMs = periodStartMs, source = operationalBookings): StayStats => {
    let roomRevenue = 0;
    let serviceRevenue = 0;
    let roomNights = 0;
    let guestTurns = 0;
    let overnightRoomRevenue = 0;

    source.forEach((booking) => {
      const times = getBookingTimes(booking);
      if (!times || !overlapsRange(booking, periodStartMs, periodEndMs)) return;

      guestTurns += 1;
      const bookingRoomRevenue = getRoomRevenue(booking);
      const extraRevenue = getExtraRevenue(booking);

      // Phụ thu chưa có ngày phát sinh riêng, nên gắn vào ngày đầu tiên của booking trong kỳ đang xem.
      const serviceAnchorMs = Math.max(times.checkInMs, serviceAnchorBaseMs);
      if (serviceAnchorMs >= periodStartMs && serviceAnchorMs < periodEndMs) {
        serviceRevenue += extraRevenue;
      }

      if (isHourlyBooking(booking)) {
        const overlapMs = getOverlapMs(times.checkInMs, times.checkOutMs, periodStartMs, periodEndMs);
        roomRevenue += bookingRoomRevenue * (overlapMs / times.durationMs);
        return;
      }

      const nightStarts = getNightStarts(booking);
      if (nightStarts.length === 0) return;
      const revenuePerNight = bookingRoomRevenue / nightStarts.length;
      const nightsInPeriod = nightStarts.filter((nightStart) => {
        const nightStartMs = nightStart.getTime();
        return nightStartMs >= periodStartMs && nightStartMs < periodEndMs;
      }).length;

      roomNights += nightsInPeriod;
      roomRevenue += revenuePerNight * nightsInPeriod;
      overnightRoomRevenue += revenuePerNight * nightsInPeriod;
    });

    return {
      roomRevenue,
      serviceRevenue,
      totalRevenue: roomRevenue + serviceRevenue,
      roomNights,
      guestTurns,
      overnightRoomRevenue,
    };
  };

  const calculateCheckoutStats = (periodStartMs: number, periodEndMs: number) => {
    const checkoutBookings = operationalBookings.filter((booking) => {
      const effectiveStatus = deriveBookingStatus(booking, nowMs);
      return effectiveStatus === BookingStatus.CHECKED_OUT && isTimeInRange(booking.checkOutDate, periodStartMs, periodEndMs);
    });
    return groupFinancials(checkoutBookings, true);
  };

  const createdStats = useMemo(() => {
    if (!rangeBounds) return { count: 0, roomRevenue: 0, serviceRevenue: 0, totalBill: 0, paid: 0, debt: 0 };
    const createdBookings = operationalBookings.filter((booking) => isTimeInRange(booking.createdAt, rangeBounds.startMs, rangeBounds.endExclusiveMs));
    return groupFinancials(createdBookings, true);
  }, [operationalBookings, rangeBounds]);

  const stayStats = useMemo(() => {
    if (!rangeBounds) return { roomRevenue: 0, serviceRevenue: 0, totalRevenue: 0, roomNights: 0, guestTurns: 0, overnightRoomRevenue: 0 };
    return calculateStayStats(rangeBounds.startMs, rangeBounds.endExclusiveMs, rangeBounds.startMs);
  }, [operationalBookings, rangeBounds]);

  const checkoutStats = useMemo(() => {
    if (!rangeBounds) return { count: 0, roomRevenue: 0, serviceRevenue: 0, totalBill: 0, paid: 0, debt: 0 };
    return calculateCheckoutStats(rangeBounds.startMs, rangeBounds.endExclusiveMs);
  }, [operationalBookings, rangeBounds, nowMs]);

  const performanceStats = useMemo(() => {
    if (!rangeBounds || operationalRooms.length === 0) {
      return { turnoverOcc: 0, adr: 0, revPar: 0, guestTurns: 0, roomDayInventory: 0 };
    }
    const roomDayInventory = operationalRooms.length * dateRangeInfo.days;
    const turnoverOcc = roomDayInventory > 0 ? Math.round((stayStats.guestTurns / roomDayInventory) * 100) : 0;
    const adr = stayStats.roomNights > 0 ? Math.round(stayStats.overnightRoomRevenue / stayStats.roomNights) : 0;
    const revPar = roomDayInventory > 0 ? Math.round(stayStats.overnightRoomRevenue / roomDayInventory) : 0;

    return {
      turnoverOcc,
      adr,
      revPar,
      guestTurns: stayStats.guestTurns,
      roomDayInventory,
    };
  }, [rangeBounds, operationalRooms.length, dateRangeInfo.days, stayStats]);

  const topRows = useMemo(() => {
    if (!rangeBounds) return [] as TopRow[];

    const roomRows = operationalRooms.map((room) => {
      const roomBookings = operationalBookings.filter((booking) => booking.roomId === room.id);
      const stats = calculateStayStats(rangeBounds.startMs, rangeBounds.endExclusiveMs, rangeBounds.startMs, roomBookings);
      return {
        id: room.id,
        label: room.number,
        subLabel: propertyById.get(room.propertyId)?.name || 'Chi nhánh',
        revenue: stats.totalRevenue,
        turnoverOcc: dateRangeInfo.days > 0 ? Math.round((stats.guestTurns / dateRangeInfo.days) * 100) : 0,
        guestTurns: stats.guestTurns,
      };
    });

    const roomsByProperty = new Map<string, Room[]>();
    operationalRooms.forEach((room) => {
      const list = roomsByProperty.get(room.propertyId) || [];
      list.push(room);
      roomsByProperty.set(room.propertyId, list);
    });

    const propertyRows = Array.from(roomsByProperty.entries()).map(([propertyId, propertyRooms]) => {
      const roomIds = new Set(propertyRooms.map((room) => room.id));
      const propertyBookings = operationalBookings.filter((booking) => roomIds.has(booking.roomId));
      const stats = calculateStayStats(rangeBounds.startMs, rangeBounds.endExclusiveMs, rangeBounds.startMs, propertyBookings);
      const denominator = propertyRooms.length * dateRangeInfo.days;
      return {
        id: propertyId,
        label: propertyById.get(propertyId)?.name || propertyId,
        subLabel: `${propertyRooms.length} phòng`,
        revenue: stats.totalRevenue,
        turnoverOcc: denominator > 0 ? Math.round((stats.guestTurns / denominator) * 100) : 0,
        guestTurns: stats.guestTurns,
      };
    });

    const rows = topMode === 'ROOM' ? roomRows : propertyRows;
    return [...rows]
      .filter((row) => row.revenue > 0 || row.guestTurns > 0)
      .sort((left, right) => {
        const direction = topSort.direction === 'asc' ? 1 : -1;
        return (left[topSort.metric] - right[topSort.metric]) * direction;
      })
      .slice(0, 8);
  }, [rangeBounds, operationalRooms, operationalBookings, propertyById, topMode, topSort, dateRangeInfo.days]);

  const dailySummaryRows = useMemo(() => {
    if (!rangeBounds) return [] as Array<Record<string, number | string>>;

    const rows = [];
    for (let cursor = new Date(rangeBounds.start); cursor.getTime() < rangeBounds.endExclusiveMs; cursor.setDate(cursor.getDate() + 1)) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      const dayStay = calculateStayStats(cursor.getTime(), next.getTime(), rangeBounds.startMs);
      const dayCheckout = calculateCheckoutStats(cursor.getTime(), next.getTime());
      const dayCreatedBookings = operationalBookings.filter((booking) => isTimeInRange(booking.createdAt, cursor.getTime(), next.getTime()));
      const dayCreated = groupFinancials(dayCreatedBookings, true);
      const denominator = operationalRooms.length;
      rows.push({
        key: getLocalDateKey(cursor),
        name: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
        createdRevenue: Math.round(dayCreated.totalBill),
        checkoutRevenue: Math.round(dayCheckout.totalBill),
        paid: Math.round(dayCheckout.paid),
        debt: Math.round(dayCheckout.debt),
        turnoverOcc: denominator > 0 ? Math.round((dayStay.guestTurns / denominator) * 100) : 0,
        guestTurns: dayStay.guestTurns,
      });
    }
    return rows;
  }, [rangeBounds, operationalBookings, operationalRooms.length, nowMs]);

  const formatVND = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Math.round(value || 0));
  const formatPercent = (value: number) => `${Math.round(value || 0)}%`;

  const toggleTopSort = (metric: TopSortMetric) => {
    setTopSort((current) => ({
      metric,
      direction: current.metric === metric && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortLabel = (metric: TopSortMetric) => {
    if (topSort.metric !== metric) return '↕';
    return topSort.direction === 'desc' ? '↓' : '↑';
  };

  const emptyData = dateRangeInfo.valid && operationalRooms.length > 0 && operationalBookings.length === 0;

  return (
    <div className="katka-liquid-page space-y-4 animate-fade-in pb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-800">Tổng quan hoạt động</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
              <Building2 size={12} />
              Đang xem: {currentPropertyName}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm md:flex-row md:items-center">
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
            <Filter size={16} />
            <span>Lọc:</span>
          </div>
          <select
            className="cursor-pointer rounded-lg border-none bg-white px-2 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus:ring-0"
            value={filterPreset}
            onChange={(event) => setFilterPreset(event.target.value as DatePreset)}
          >
            {DATE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
          </select>
          <div className="hidden h-6 w-px bg-gray-300 md:block" />
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-700 outline-none focus:border-blue-500 focus:ring-blue-500"
              value={startDate}
              onChange={(event) => {
                setFilterPreset('CUSTOM');
                setStartDate(event.target.value);
              }}
            />
            <span className="font-bold text-gray-400">-</span>
            <input
              type="date"
              className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-700 outline-none focus:border-blue-500 focus:ring-blue-500"
              value={endDate}
              onChange={(event) => {
                setFilterPreset('CUSTOM');
                setEndDate(event.target.value);
              }}
            />
          </div>
        </div>
      </div>

      {!dateRangeInfo.valid && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {dateRangeInfo.message}
        </div>
      )}

      {dateRangeInfo.valid && operationalRooms.length === 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Không có phòng vận hành trong phạm vi chi nhánh hiện tại.
        </div>
      )}

      {emptyData && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">
          Chưa có đơn đặt phòng trong phạm vi dữ liệu hiện tại. Các chỉ số sẽ hiển thị 0.
        </div>
      )}

      <section className="rounded-[22px] border border-gray-200 bg-white p-3.5 shadow-sm md:p-4">
        <div className="mb-3 flex items-center gap-2">
          <CreditCard size={18} className="text-blue-600" />
          <h3 className="text-base font-black text-gray-900">Doanh số phát sinh</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Đơn phát sinh" value={`${createdStats.count}`} />
          <StatTile label="Giá trị đơn" value={formatVND(createdStats.totalBill)} />
          <StatTile label="Đã thu/cọc" value={formatVND(createdStats.paid)} tone="text-blue-600" />
          <StatTile label="Chưa thu" value={formatVND(createdStats.debt)} tone={createdStats.debt > 0 ? 'text-orange-600' : 'text-gray-400'} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-[22px] border border-gray-200 bg-white p-3.5 shadow-sm md:p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarCheck size={18} className="text-green-600" />
            <h3 className="text-base font-black text-gray-900">Doanh thu check-out trong kỳ</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile label="Số đơn" value={`${checkoutStats.count}`} />
            <StatTile label="Doanh thu phòng" value={formatVND(checkoutStats.roomRevenue)} />
            <StatTile label="Dịch vụ/phụ thu" value={formatVND(checkoutStats.serviceRevenue)} tone="text-blue-600" />
            <StatTile label="Tổng doanh thu" value={formatVND(checkoutStats.totalBill)} tone="text-emerald-600" />
            <StatTile label="Đã thu" value={formatVND(checkoutStats.paid)} tone="text-green-600" />
            <StatTile label="Còn thiếu" value={formatVND(checkoutStats.debt)} tone={checkoutStats.debt > 0 ? 'text-red-600' : 'text-gray-400'} />
          </div>
        </section>

        <section className="rounded-[22px] border border-gray-200 bg-white p-3.5 shadow-sm md:p-4">
          <div className="mb-3 flex items-center gap-2">
            <BedDouble size={18} className="text-purple-600" />
            <h3 className="text-base font-black text-gray-900">Hiệu suất phòng</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatTile label="OCC lượt phòng" value={formatPercent(performanceStats.turnoverOcc)} sub="Số lượt khai thác / phòng" tone="text-purple-700" />
            <StatTile label="ADR" value={formatVND(performanceStats.adr)} sub="Doanh thu / đêm phòng bán" />
            <StatTile label="RevPAR" value={formatVND(performanceStats.revPar)} sub="Doanh thu / phòng khả dụng" />
            <StatTile label="Số lượt khai thác" value={`${performanceStats.guestTurns} lượt`} />
          </div>
        </section>
      </div>

      <section className="rounded-[22px] border border-gray-200 bg-white p-3.5 shadow-sm md:p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-amber-500" />
            <h3 className="text-base font-black text-gray-900">Top doanh thu / OCC lượt phòng</h3>
          </div>
          <div className="inline-flex w-fit rounded-xl bg-gray-100 p-1 text-xs font-black">
            <button
              type="button"
              onClick={() => setTopMode('ROOM')}
              className={`rounded-lg px-3 py-1.5 ${topMode === 'ROOM' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}
            >
              Theo phòng
            </button>
            <button
              type="button"
              onClick={() => setTopMode('PROPERTY')}
              className={`rounded-lg px-3 py-1.5 ${topMode === 'PROPERTY' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}
            >
              Theo chi nhánh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-400">
                <th className="py-3 pr-4">{topMode === 'ROOM' ? 'Phòng' : 'Chi nhánh'}</th>
                <th className="py-3 pr-4">
                  <button type="button" onClick={() => toggleTopSort('revenue')} className="font-black hover:text-blue-700">
                    Doanh thu {sortLabel('revenue')}
                  </button>
                </th>
                <th className="py-3 pr-4">
                  <button type="button" onClick={() => toggleTopSort('turnoverOcc')} className="font-black hover:text-blue-700">
                    OCC lượt phòng {sortLabel('turnoverOcc')}
                  </button>
                </th>
                <th className="py-3 pr-4">
                  <button type="button" onClick={() => toggleTopSort('guestTurns')} className="font-black hover:text-blue-700">
                    Lượt khách {sortLabel('guestTurns')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {topRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm font-semibold text-gray-400">Chưa có dữ liệu top trong kỳ này.</td>
                </tr>
              ) : (
                topRows.map((row, index) => (
                  <tr key={row.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-black text-blue-700">{index + 1}</span>
                        <div>
                          <div className="font-black text-gray-900">{row.label}</div>
                          <div className="text-xs font-semibold text-gray-400">{row.subLabel}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-black text-gray-900">{formatVND(row.revenue)}</td>
                    <td className="py-3 pr-4 font-black text-purple-700">{formatPercent(row.turnoverOcc)}</td>
                    <td className="py-3 pr-4 font-black text-gray-700">{row.guestTurns} lượt</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[22px] border border-gray-200 bg-white p-3.5 shadow-sm md:p-4">
        <div className="mb-4">
          <h3 className="text-base font-black text-gray-900">Bảng tóm tắt theo ngày</h3>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-400">
                <th className="py-3 pr-4">Ngày</th>
                <th className="py-3 pr-4">DT phát sinh</th>
                <th className="py-3 pr-4">DT check-out</th>
                <th className="py-3 pr-4">Đã thu</th>
                <th className="py-3 pr-4">Còn thiếu</th>
                <th className="py-3 pr-4">OCC lượt</th>
                <th className="py-3 pr-4">Lượt khách</th>
              </tr>
            </thead>
            <tbody>
              {dailySummaryRows.map((row) => (
                <tr key={row.key} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 pr-4 font-black text-gray-900">{row.name}</td>
                  <td className="py-3 pr-4 font-bold text-gray-800">{formatVND(Number(row.createdRevenue))}</td>
                  <td className="py-3 pr-4 font-bold text-gray-800">{formatVND(Number(row.checkoutRevenue))}</td>
                  <td className="py-3 pr-4 font-bold text-green-700">{formatVND(Number(row.paid))}</td>
                  <td className={`py-3 pr-4 font-bold ${Number(row.debt) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{formatVND(Number(row.debt))}</td>
                  <td className="py-3 pr-4 font-bold text-purple-700">{formatPercent(Number(row.turnoverOcc))}</td>
                  <td className="py-3 pr-4 font-bold text-gray-700">{row.guestTurns} lượt</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
