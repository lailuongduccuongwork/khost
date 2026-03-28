import React, { useEffect, useMemo, useState } from 'react';
import { Booking, BookingStatus, HistoryLog, Property, Room, User } from '../types';
import {
    Activity,
    AlertTriangle,
    CandlestickChart,
    Clock3,
    Filter,
    LineChart as LineChartIcon,
    Search,
    ShieldCheck,
    Sparkles,
    TrendingUp,
} from 'lucide-react';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface PerformanceProps {
    bookings: Booking[];
    rooms: Room[];
    properties: Property[];
    users: User[];
    history: HistoryLog[];
    currentUser: User;
}

type Period = 'DAY' | 'WEEK' | 'MONTH';
type TimeRef = 'CREATED_AT' | 'CHECK_IN' | 'CHECK_OUT';
type Metric = 'ORDER_VALUE' | 'PAID' | 'ORDER_COUNT' | 'NET_REVENUE' | 'COLLECTION_RATE';
type ChartMode = 'LINE' | 'INDEX' | 'CANDLE';
type HistorySourceFilter = 'ALL' | 'WEB' | 'IMPORT' | 'SYSTEM';
type StatusFilter = 'ALL' | BookingStatus;

type MetricAgg = {
    orderValue: number;
    paidAmount: number;
    orderCount: number;
    netRevenue: number;
};

type StaffOption = {
    id: string;
    username: string;
    fullName: string;
    ticker: string;
};

type CandlePoint = {
    bucketKey: string;
    label: string;
    open: number;
    close: number;
    high: number;
    low: number;
    isUp: boolean;
};

const SERIES_COLORS = [
    '#2563eb',
    '#0ea5e9',
    '#14b8a6',
    '#22c55e',
    '#f59e0b',
    '#f97316',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#64748b',
];

const EMPTY_AGG: MetricAgg = {
    orderValue: 0,
    paidAmount: 0,
    orderCount: 0,
    netRevenue: 0,
};

const METRIC_LABELS: Record<Metric, string> = {
    ORDER_VALUE: 'Tổng giá trị chốt',
    PAID: 'Số tiền khách đã trả',
    ORDER_COUNT: 'Số đơn',
    NET_REVENUE: 'Doanh thu net',
    COLLECTION_RATE: 'Tỷ lệ thu tiền',
};

const toDateInputValue = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const parseDateStart = (value: string) => new Date(`${value}T00:00:00`).getTime();
const parseDateEnd = (value: string) => new Date(`${value}T23:59:59.999`).getTime();

const safeDate = (value?: string | Date | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date;
};

const startOfWeek = (date: Date) => {
    const clone = new Date(date);
    const day = clone.getDay();
    const delta = day === 0 ? -6 : 1 - day;
    clone.setDate(clone.getDate() + delta);
    clone.setHours(0, 0, 0, 0);
    return clone;
};

const getBucketStart = (date: Date, period: Period) => {
    const clone = new Date(date);
    clone.setSeconds(0, 0);
    if (period === 'DAY') {
        clone.setHours(0, 0, 0, 0);
        return clone;
    }
    if (period === 'WEEK') {
        return startOfWeek(clone);
    }
    clone.setDate(1);
    clone.setHours(0, 0, 0, 0);
    return clone;
};

const addBucket = (date: Date, period: Period) => {
    const clone = new Date(date);
    if (period === 'DAY') {
        clone.setDate(clone.getDate() + 1);
        return clone;
    }
    if (period === 'WEEK') {
        clone.setDate(clone.getDate() + 7);
        return clone;
    }
    clone.setMonth(clone.getMonth() + 1);
    return clone;
};

const getBucketLabel = (date: Date, period: Period) => {
    const pad = (n: number) => `${n}`.padStart(2, '0');
    if (period === 'DAY') return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
    if (period === 'WEEK') {
        const end = new Date(date);
        end.setDate(end.getDate() + 6);
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}-${pad(end.getDate())}/${pad(end.getMonth() + 1)}`;
    }
    return `${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

const compactCurrency = (amount: number) => {
    const abs = Math.abs(amount);
    if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${Math.round(amount / 1_000)}K`;
    return `${Math.round(amount)}`;
};

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);

const formatDateTime = (iso: string) => {
    const date = safeDate(iso);
    if (!date) return '--';
    return date.toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const formatMetricValue = (value: number, metric: Metric, compact = false) => {
    if (metric === 'ORDER_COUNT') return `${Math.round(value)}`;
    if (metric === 'COLLECTION_RATE') return `${value.toFixed(1)}%`;
    if (compact) return compactCurrency(value);
    return formatCurrency(value);
};

const toMetricValue = (agg: MetricAgg, metric: Metric) => {
    if (metric === 'ORDER_VALUE') return agg.orderValue;
    if (metric === 'PAID') return agg.paidAmount;
    if (metric === 'ORDER_COUNT') return agg.orderCount;
    if (metric === 'NET_REVENUE') return agg.netRevenue;
    if (agg.orderValue <= 0) return 0;
    return (agg.paidAmount / agg.orderValue) * 100;
};

const getTickerFromUsername = (username: string) => {
    const base = username.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!base) return 'USER';
    return base.slice(0, 6);
};

const getBookingFinancials = (booking: Booking) => {
    const fees = booking.extraFees || [];
    const extraRevenue = fees
        .filter((fee) => fee.type === 'REVENUE')
        .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
    const extraExpense = fees
        .filter((fee) => fee.type === 'EXPENSE')
        .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);

    const orderValue = (Number(booking.totalPrice) || 0) + extraRevenue;
    const paidAmount = Number(booking.paidAmount) || 0;
    const netRevenue = (Number(booking.totalPrice) || 0) + extraRevenue - extraExpense;
    return { orderValue, paidAmount, netRevenue };
};

const getHistorySourceLabel = (source?: string) => {
    if (source === 'SYSTEM') return 'System';
    if (source === 'IMPORT') return 'Import';
    return 'Web/App';
};

const getHistoryActionLabel = (action: string) => {
    const map: Record<string, string> = {
        CREATE: 'Tạo',
        UPDATE: 'Sửa',
        DELETE: 'Xóa',
        CHECK_IN: 'Check-in',
        CHECK_OUT: 'Check-out',
        CANCEL: 'Cancel',
        BULK_DELETE: 'Xóa hàng loạt',
        IMPORT: 'Import',
        EXPORT: 'Export',
        RESET: 'Reset',
    };
    return map[action] || action;
};

const CandlestickPanel: React.FC<{
    data: CandlePoint[];
    metricLabel: string;
    selectedBucketKey: string | null;
    onSelectBucket: (bucketKey: string) => void;
}> = ({ data, metricLabel, selectedBucketKey, onSelectBucket }) => {
    if (data.length === 0) {
        return (
            <div className="h-[360px] flex items-center justify-center text-gray-400 text-sm">
                Không có dữ liệu để dựng candlestick.
            </div>
        );
    }

    const width = Math.max(760, data.length * 52);
    const height = 360;
    const margin = { top: 18, right: 36, bottom: 50, left: 56 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const minValue = Math.min(...data.map((item) => item.low));
    const maxValue = Math.max(...data.map((item) => item.high));
    const padding = (maxValue - minValue || 1) * 0.08;
    const domainMin = minValue - padding;
    const domainMax = maxValue + padding;

    const y = (value: number) => {
        if (domainMax === domainMin) return margin.top + chartHeight / 2;
        return margin.top + ((domainMax - value) / (domainMax - domainMin)) * chartHeight;
    };

    const xStep = chartWidth / Math.max(data.length, 1);
    const xCenter = (index: number) => margin.left + xStep * index + xStep / 2;

    const yTicks = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const value = domainMax - ratio * (domainMax - domainMin);
        return value;
    });

    return (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <svg width={width} height={height} role="img" aria-label={`Candlestick ${metricLabel}`}>
                {yTicks.map((tick, index) => (
                    <g key={`ytick-${index}`}>
                        <line
                            x1={margin.left}
                            x2={width - margin.right}
                            y1={y(tick)}
                            y2={y(tick)}
                            stroke="#e5e7eb"
                            strokeDasharray="4 3"
                        />
                        <text
                            x={margin.left - 10}
                            y={y(tick) + 4}
                            textAnchor="end"
                            className="fill-gray-500 text-[11px] font-semibold"
                        >
                            {compactCurrency(tick)}
                        </text>
                    </g>
                ))}

                {data.map((item, index) => {
                    const center = xCenter(index);
                    const bodyWidth = Math.max(8, Math.min(20, xStep * 0.45));
                    const openY = y(item.open);
                    const closeY = y(item.close);
                    const highY = y(item.high);
                    const lowY = y(item.low);
                    const bodyY = Math.min(openY, closeY);
                    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
                    const bodyColor = item.isUp ? '#16a34a' : '#dc2626';
                    const isSelected = selectedBucketKey === item.bucketKey;

                    return (
                        <g key={item.bucketKey} onClick={() => onSelectBucket(item.bucketKey)} className="cursor-pointer">
                            {isSelected && (
                                <rect
                                    x={center - xStep / 2 + 1}
                                    y={margin.top}
                                    width={Math.max(xStep - 2, 10)}
                                    height={chartHeight}
                                    fill="#dbeafe"
                                    fillOpacity={0.35}
                                    rx={4}
                                />
                            )}
                            <line x1={center} x2={center} y1={highY} y2={lowY} stroke={bodyColor} strokeWidth={1.5} />
                            <rect
                                x={center - bodyWidth / 2}
                                y={bodyY}
                                width={bodyWidth}
                                height={bodyHeight}
                                rx={2}
                                fill={item.isUp ? '#22c55e' : '#ef4444'}
                                stroke={bodyColor}
                                strokeWidth={1}
                            />
                            {index % Math.max(1, Math.floor(data.length / 10)) === 0 && (
                                <text
                                    x={center}
                                    y={height - margin.bottom + 20}
                                    textAnchor="middle"
                                    className="fill-gray-500 text-[11px] font-medium"
                                >
                                    {item.label}
                                </text>
                            )}
                        </g>
                    );
                })}

                <text x={margin.left} y={16} className="fill-gray-700 text-xs font-bold uppercase">
                    {metricLabel}
                </text>
            </svg>
        </div>
    );
};

const Performance: React.FC<PerformanceProps> = ({ bookings, rooms, properties, users, history, currentUser }) => {
    const today = useMemo(() => new Date(), []);
    const defaultTo = toDateInputValue(today);
    const defaultFromDate = useMemo(() => {
        const from = new Date(today);
        from.setDate(from.getDate() - 29);
        return toDateInputValue(from);
    }, [today]);

    const [fromDate, setFromDate] = useState(defaultFromDate);
    const [toDate, setToDate] = useState(defaultTo);
    const [period, setPeriod] = useState<Period>('DAY');
    const [timeRef, setTimeRef] = useState<TimeRef>('CREATED_AT');
    const [metric, setMetric] = useState<Metric>('ORDER_VALUE');
    const [chartMode, setChartMode] = useState<ChartMode>('LINE');
    const [selectedPropertyId, setSelectedPropertyId] = useState('ALL');
    const [selectedRoomId, setSelectedRoomId] = useState('ALL');
    const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('ALL');
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [watchlistUserIds, setWatchlistUserIds] = useState<string[]>([]);
    const [focusTickerId, setFocusTickerId] = useState<string>('COMPANY');
    const [includeCompanyLine, setIncludeCompanyLine] = useState(true);
    const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
    const [drillSearch, setDrillSearch] = useState('');

    const [historyActorFilter, setHistoryActorFilter] = useState('ALL');
    const [historySourceFilter, setHistorySourceFilter] = useState<HistorySourceFilter>('ALL');
    const [historyStatusFilter, setHistoryStatusFilter] = useState('ALL');
    const [historyPropertyFilter, setHistoryPropertyFilter] = useState('ALL');
    const [historyRoomFilter, setHistoryRoomFilter] = useState('ALL');

    const [now, setNow] = useState(new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 5000);
        return () => window.clearInterval(timer);
    }, []);

    const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
    const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
    const propertyById = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);

    const staffOptions = useMemo(() => {
        const ids = new Set<string>();
        users.forEach((user) => ids.add(user.id));
        bookings.forEach((booking) => {
            if (booking.createdBy) ids.add(booking.createdBy);
        });

        return Array.from(ids)
            .map((id) => {
                const user = userById.get(id);
                const username = user?.username || id;
                return {
                    id,
                    username,
                    fullName: user?.fullName || username,
                    ticker: getTickerFromUsername(username),
                };
            })
            .sort((a, b) => a.username.localeCompare(b.username, 'vi'));
    }, [bookings, users, userById]);

    const rangeInfo = useMemo(() => {
        const startMs = parseDateStart(fromDate);
        const endMs = parseDateEnd(toDate);
        if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
            return null;
        }
        const duration = endMs - startMs + 1;
        const prevEndMs = startMs - 1;
        const prevStartMs = prevEndMs - duration + 1;
        return { startMs, endMs, prevStartMs, prevEndMs };
    }, [fromDate, toDate]);

    const getReferenceDate = (booking: Booking) => {
        if (timeRef === 'CHECK_IN') return safeDate(booking.checkInDate);
        if (timeRef === 'CHECK_OUT') return safeDate(booking.checkOutDate);
        return safeDate(booking.createdAt);
    };

    const passesCommonFilters = (booking: Booking) => {
        if (booking.status === BookingStatus.DELETED) return false;
        if (booking.isHold) return false;
        if (selectedStatus === 'ALL' && booking.status === BookingStatus.PENDING) return false;
        if (selectedStatus === 'ALL' && booking.status === BookingStatus.CANCELLED) return false;
        if (selectedPropertyId !== 'ALL' && booking.propertyId !== selectedPropertyId) return false;
        if (selectedRoomId !== 'ALL' && booking.roomId !== selectedRoomId) return false;
        if (selectedStatus !== 'ALL' && booking.status !== selectedStatus) return false;
        return true;
    };

    const aggregateByStaff = (startMs: number, endMs: number) => {
        const map = new Map<string, MetricAgg>();
        bookings.forEach((booking) => {
            if (!passesCommonFilters(booking)) return;
            const refDate = getReferenceDate(booking);
            if (!refDate) return;
            const refMs = refDate.getTime();
            if (refMs < startMs || refMs > endMs) return;

            const current = map.get(booking.createdBy) || { ...EMPTY_AGG };
            const financials = getBookingFinancials(booking);

            current.orderValue += financials.orderValue;
            current.paidAmount += financials.paidAmount;
            current.netRevenue += financials.netRevenue;
            current.orderCount += 1;

            map.set(booking.createdBy, current);
        });
        return map;
    };

    const filteredBookings = useMemo(() => {
        if (!rangeInfo) return [];
        return bookings.filter((booking) => {
            if (!passesCommonFilters(booking)) return false;
            const refDate = getReferenceDate(booking);
            if (!refDate) return false;
            const refMs = refDate.getTime();
            return refMs >= rangeInfo.startMs && refMs <= rangeInfo.endMs;
        });
    }, [bookings, rangeInfo, selectedPropertyId, selectedRoomId, selectedStatus, timeRef]);

    const currentAggByStaff = useMemo(() => {
        if (!rangeInfo) return new Map<string, MetricAgg>();
        return aggregateByStaff(rangeInfo.startMs, rangeInfo.endMs);
    }, [rangeInfo, bookings, selectedPropertyId, selectedRoomId, selectedStatus, timeRef]);

    const previousAggByStaff = useMemo(() => {
        if (!rangeInfo) return new Map<string, MetricAgg>();
        return aggregateByStaff(rangeInfo.prevStartMs, rangeInfo.prevEndMs);
    }, [rangeInfo, bookings, selectedPropertyId, selectedRoomId, selectedStatus, timeRef]);

    const companySummary = useMemo(() => {
        return filteredBookings.reduce(
            (acc, booking) => {
                const financials = getBookingFinancials(booking);
                acc.orderValue += financials.orderValue;
                acc.paidAmount += financials.paidAmount;
                acc.orderCount += 1;
                acc.netRevenue += financials.netRevenue;
                return acc;
            },
            { ...EMPTY_AGG }
        );
    }, [filteredBookings]);

    const previousCompanySummary = useMemo(() => {
        if (!rangeInfo) return { ...EMPTY_AGG };
        return bookings.reduce(
            (acc, booking) => {
                if (!passesCommonFilters(booking)) return acc;
                const refDate = getReferenceDate(booking);
                if (!refDate) return acc;
                const refMs = refDate.getTime();
                if (refMs < rangeInfo.prevStartMs || refMs > rangeInfo.prevEndMs) return acc;

                const financials = getBookingFinancials(booking);
                acc.orderValue += financials.orderValue;
                acc.paidAmount += financials.paidAmount;
                acc.orderCount += 1;
                acc.netRevenue += financials.netRevenue;
                return acc;
            },
            { ...EMPTY_AGG }
        );
    }, [bookings, rangeInfo, selectedPropertyId, selectedRoomId, selectedStatus, timeRef]);

    const staffSummary = useMemo(() => {
        const rows = staffOptions.map((staff) => {
            const current = currentAggByStaff.get(staff.id) || { ...EMPTY_AGG };
            const previous = previousAggByStaff.get(staff.id) || { ...EMPTY_AGG };
            const currentMetric = toMetricValue(current, metric);
            const previousMetric = toMetricValue(previous, metric);
            const growth =
                previousMetric === 0 ? (currentMetric > 0 ? 100 : 0) : ((currentMetric - previousMetric) / Math.abs(previousMetric)) * 100;

            return {
                ...staff,
                current,
                previous,
                currentMetric,
                growth,
                collectionRate: current.orderValue > 0 ? (current.paidAmount / current.orderValue) * 100 : 0,
            };
        });

        return rows.sort((a, b) => b.currentMetric - a.currentMetric);
    }, [staffOptions, currentAggByStaff, previousAggByStaff, metric]);

    useEffect(() => {
        if (watchlistUserIds.length > 0) return;
        const topIds = staffSummary.slice(0, 8).map((staff) => staff.id);
        setWatchlistUserIds(topIds);
    }, [staffSummary, watchlistUserIds.length]);

    useEffect(() => {
        if (selectedUserIds.length > 0) return;
        const seeds = watchlistUserIds.slice(0, 3);
        if (seeds.length > 0) {
            setSelectedUserIds(seeds);
            return;
        }
        const topIds = staffSummary.slice(0, 3).map((staff) => staff.id);
        if (topIds.length > 0) setSelectedUserIds(topIds);
    }, [selectedUserIds.length, watchlistUserIds, staffSummary]);

    useEffect(() => {
        const validFocus =
            focusTickerId === 'COMPANY' ||
            selectedUserIds.includes(focusTickerId) ||
            watchlistUserIds.includes(focusTickerId);
        if (!validFocus) setFocusTickerId('COMPANY');
    }, [focusTickerId, selectedUserIds, watchlistUserIds]);

    const toggleWatchlist = (staffId: string) => {
        setWatchlistUserIds((prev) => {
            if (prev.includes(staffId)) return prev.filter((id) => id !== staffId);
            return [...prev, staffId];
        });
    };

    const toggleCompare = (staffId: string) => {
        setSelectedUserIds((prev) => {
            if (prev.includes(staffId)) return prev.filter((id) => id !== staffId);
            return [...prev, staffId];
        });
    };

    const timelineBuckets = useMemo(() => {
        if (!rangeInfo) return [];
        const start = getBucketStart(new Date(rangeInfo.startMs), period);
        const end = getBucketStart(new Date(rangeInfo.endMs), period);
        const result: Array<{ key: string; label: string; startMs: number; endMs: number }> = [];

        let cursor = new Date(start);
        let guard = 0;
        while (cursor.getTime() <= end.getTime() && guard < 1500) {
            const bucketStartMs = cursor.getTime();
            const bucketEndMs = addBucket(cursor, period).getTime() - 1;
            result.push({
                key: new Date(bucketStartMs).toISOString(),
                label: getBucketLabel(cursor, period),
                startMs: bucketStartMs,
                endMs: bucketEndMs,
            });
            cursor = addBucket(cursor, period);
            guard += 1;
        }
        return result;
    }, [rangeInfo, period]);

    const seriesMeta = useMemo(() => {
        const selectedStaff = staffSummary.filter((staff) => selectedUserIds.includes(staff.id));
        const lines = selectedStaff.map((staff, index) => ({
            id: staff.id,
            key: `staff_${staff.id}`,
            label: `${staff.ticker} (${staff.username})`,
            color: SERIES_COLORS[index % SERIES_COLORS.length],
        }));

        if (includeCompanyLine) {
            lines.unshift({
                id: 'COMPANY',
                key: 'company',
                label: 'TOÀN CÔNG TY',
                color: '#0f172a',
            });
        }
        return lines;
    }, [staffSummary, selectedUserIds, includeCompanyLine]);

    const rawChartRows = useMemo(() => {
        const staffBucketMap = new Map<string, Map<string, MetricAgg>>();
        const companyBucketMap = new Map<string, MetricAgg>();

        filteredBookings.forEach((booking) => {
            const refDate = getReferenceDate(booking);
            if (!refDate) return;
            const bucket = getBucketStart(refDate, period).toISOString();
            const financials = getBookingFinancials(booking);

            const staffMap = staffBucketMap.get(booking.createdBy) || new Map<string, MetricAgg>();
            const staffCurrent = staffMap.get(bucket) || { ...EMPTY_AGG };
            staffCurrent.orderValue += financials.orderValue;
            staffCurrent.paidAmount += financials.paidAmount;
            staffCurrent.netRevenue += financials.netRevenue;
            staffCurrent.orderCount += 1;
            staffMap.set(bucket, staffCurrent);
            staffBucketMap.set(booking.createdBy, staffMap);

            const companyCurrent = companyBucketMap.get(bucket) || { ...EMPTY_AGG };
            companyCurrent.orderValue += financials.orderValue;
            companyCurrent.paidAmount += financials.paidAmount;
            companyCurrent.netRevenue += financials.netRevenue;
            companyCurrent.orderCount += 1;
            companyBucketMap.set(bucket, companyCurrent);
        });

        return timelineBuckets.map((bucket) => {
            const companyAgg = companyBucketMap.get(bucket.key) || { ...EMPTY_AGG };
            const row: Record<string, any> = {
                bucketKey: bucket.key,
                label: bucket.label,
                volume: companyAgg.orderCount,
                company: toMetricValue(companyAgg, metric),
            };

            selectedUserIds.forEach((staffId) => {
                const staffAgg = staffBucketMap.get(staffId)?.get(bucket.key) || { ...EMPTY_AGG };
                row[`staff_${staffId}`] = toMetricValue(staffAgg, metric);
            });

            return row;
        });
    }, [filteredBookings, timelineBuckets, selectedUserIds, period, metric, timeRef]);

    const indexedChartRows = useMemo(() => {
        if (chartMode !== 'INDEX') return rawChartRows;
        if (rawChartRows.length === 0) return rawChartRows;

        const baseline = new Map<string, number>();
        seriesMeta.forEach((series) => {
            const firstValid = rawChartRows.find((row) => Number(row[series.key] || 0) > 0);
            baseline.set(series.key, firstValid ? Number(firstValid[series.key]) : 1);
        });

        return rawChartRows.map((row) => {
            const clone: Record<string, any> = { ...row };
            seriesMeta.forEach((series) => {
                const base = baseline.get(series.key) || 1;
                const value = Number(row[series.key] || 0);
                clone[series.key] = (value / base) * 100;
            });
            return clone;
        });
    }, [chartMode, rawChartRows, seriesMeta]);

    useEffect(() => {
        if (selectedBucketKey && indexedChartRows.some((row) => row.bucketKey === selectedBucketKey)) return;
        if (indexedChartRows.length === 0) {
            setSelectedBucketKey(null);
            return;
        }
        setSelectedBucketKey(indexedChartRows[indexedChartRows.length - 1].bucketKey);
    }, [indexedChartRows, selectedBucketKey]);

    const selectedBucket = useMemo(
        () => timelineBuckets.find((bucket) => bucket.key === selectedBucketKey) || null,
        [timelineBuckets, selectedBucketKey]
    );

    const candleData = useMemo(() => {
        const focusKey = focusTickerId === 'COMPANY' ? 'company' : `staff_${focusTickerId}`;
        let previousClose = 0;
        return rawChartRows.map((row, index) => {
            const close = Number(row[focusKey] || 0);
            const open = index === 0 ? close : previousClose;
            const high = Math.max(open, close);
            const low = Math.min(open, close);
            previousClose = close;
            return {
                bucketKey: row.bucketKey,
                label: row.label,
                open,
                close,
                high,
                low,
                isUp: close >= open,
            } as CandlePoint;
        });
    }, [rawChartRows, focusTickerId]);

    const companyGrowth = useMemo(() => {
        const currentMetric = toMetricValue(companySummary, metric);
        const previousMetric = toMetricValue(previousCompanySummary, metric);
        if (previousMetric === 0) return currentMetric > 0 ? 100 : 0;
        return ((currentMetric - previousMetric) / Math.abs(previousMetric)) * 100;
    }, [companySummary, previousCompanySummary, metric]);

    const drillDownBookings = useMemo(() => {
        if (!selectedBucket) return [];
        const filtered = filteredBookings.filter((booking) => {
            const refDate = getReferenceDate(booking);
            if (!refDate) return false;
            const refMs = refDate.getTime();
            if (refMs < selectedBucket.startMs || refMs > selectedBucket.endMs) return false;
            if (focusTickerId !== 'COMPANY' && booking.createdBy !== focusTickerId) return false;
            return true;
        });

        const loweredSearch = drillSearch.trim().toLowerCase();
        return filtered
            .filter((booking) => {
                if (!loweredSearch) return true;
                const room = roomById.get(booking.roomId);
                const creator = userById.get(booking.createdBy);
                const haystack = [
                    booking.id,
                    booking.guestName,
                    booking.guestPhone,
                    room?.number,
                    creator?.username,
                    creator?.fullName,
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(loweredSearch);
            })
            .sort((a, b) => {
                const aDate = getReferenceDate(a)?.getTime() || 0;
                const bDate = getReferenceDate(b)?.getTime() || 0;
                return bDate - aDate;
            });
    }, [filteredBookings, selectedBucket, focusTickerId, drillSearch, timeRef, roomById, userById]);

    const historyRows = useMemo(() => {
        if (!rangeInfo) return [];
        return history
            .filter((log) => (log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM')) === 'BOOKING')
            .filter((log) => {
                const ts = safeDate(log.timestamp)?.getTime();
                if (!ts) return false;
                if (ts < rangeInfo.startMs || ts > rangeInfo.endMs) return false;

                const metadata = (log.metadata || {}) as Record<string, any>;
                const before = (log.before || {}) as Record<string, any>;
                const after = (log.after || {}) as Record<string, any>;

                const propertyId = `${metadata.propertyId || after.propertyId || before.propertyId || ''}`;
                const roomId = `${metadata.roomId || after.roomId || before.roomId || ''}`;
                const status = `${metadata.toStatus || metadata.status || after.status || before.status || ''}`;
                const actorId = `${log.actorId || log.staffId || ''}`;
                const source = (log.source || 'WEB') as Exclude<HistorySourceFilter, 'ALL'>;

                if (historyPropertyFilter !== 'ALL' && propertyId !== historyPropertyFilter) return false;
                if (historyRoomFilter !== 'ALL' && roomId !== historyRoomFilter) return false;
                if (historyStatusFilter !== 'ALL' && status !== historyStatusFilter) return false;
                if (historyActorFilter !== 'ALL' && actorId !== historyActorFilter) return false;
                if (historySourceFilter !== 'ALL' && source !== historySourceFilter) return false;

                return true;
            })
            .sort((a, b) => {
                const aTs = safeDate(a.timestamp)?.getTime() || 0;
                const bTs = safeDate(b.timestamp)?.getTime() || 0;
                return bTs - aTs;
            });
    }, [
        history,
        rangeInfo,
        historyPropertyFilter,
        historyRoomFilter,
        historyStatusFilter,
        historyActorFilter,
        historySourceFilter,
    ]);

    const historyOptions = useMemo(() => {
        const actorMap = new Map<string, string>();
        const statusSet = new Set<string>();
        const propertySet = new Set<string>();
        const roomSet = new Set<string>();

        history.forEach((log) => {
            const metadata = (log.metadata || {}) as Record<string, any>;
            const before = (log.before || {}) as Record<string, any>;
            const after = (log.after || {}) as Record<string, any>;

            const actorId = `${log.actorId || log.staffId || ''}`;
            const actorName =
                log.actorUsername ||
                (actorId && userById.get(actorId)?.username) ||
                log.actorName ||
                actorId ||
                'không rõ';
            if (actorId) actorMap.set(actorId, actorName);

            const status = `${metadata.toStatus || metadata.status || after.status || before.status || ''}`;
            if (status) statusSet.add(status);

            const propertyId = `${metadata.propertyId || after.propertyId || before.propertyId || ''}`;
            if (propertyId) propertySet.add(propertyId);

            const roomId = `${metadata.roomId || after.roomId || before.roomId || ''}`;
            if (roomId) roomSet.add(roomId);
        });

        return {
            actors: Array.from(actorMap.entries())
                .map(([id, label]) => ({ id, label }))
                .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
            statuses: Array.from(statusSet.values()).sort((a, b) => a.localeCompare(b)),
            properties: Array.from(propertySet.values())
                .map((id) => ({ id, label: propertyById.get(id)?.name || id }))
                .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
            rooms: Array.from(roomSet.values())
                .map((id) => ({ id, label: roomById.get(id)?.number ? `Phòng ${roomById.get(id)!.number}` : id }))
                .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
        };
    }, [history, propertyById, roomById, userById]);

    const anomalies = useMemo(() => {
        const results: Array<{ id: string; severity: 'HIGH' | 'MEDIUM'; title: string; detail: string; at: string }> = [];

        const priceLogs = historyRows.filter(
            (log) => `${(log.metadata || {}).changeKey || ''}` === 'totalPrice' && ['UPDATE', 'CREATE', 'DELETE'].includes(log.action)
        );

        const priceEditCount = new Map<string, number>();
        priceLogs.forEach((log) => {
            const bookingId = `${log.entityId || (log.metadata || {}).bookingId || ''}`;
            if (!bookingId) return;
            priceEditCount.set(bookingId, (priceEditCount.get(bookingId) || 0) + 1);

            const before = Number((log.metadata || {}).beforeValue || 0);
            const after = Number((log.metadata || {}).afterValue || 0);
            if (before > 0 && after >= 0 && after < before * 0.7) {
                results.push({
                    id: `drop-${log.id}`,
                    severity: 'HIGH',
                    title: `Giảm giá mạnh ở đơn ${bookingId}`,
                    detail: `Giá giảm từ ${formatCurrency(before)} xuống ${formatCurrency(after)} (${(((after - before) / before) * 100).toFixed(1)}%).`,
                    at: log.timestamp,
                });
            }
        });

        priceEditCount.forEach((count, bookingId) => {
            if (count < 3) return;
            const sample = priceLogs.find((log) => `${log.entityId || (log.metadata || {}).bookingId || ''}` === bookingId);
            results.push({
                id: `many-price-${bookingId}`,
                severity: count >= 5 ? 'HIGH' : 'MEDIUM',
                title: `Đơn ${bookingId} bị sửa giá nhiều lần`,
                detail: `Đã ghi nhận ${count} lần sửa giá trong kỳ lọc.`,
                at: sample?.timestamp || new Date().toISOString(),
            });
        });

        const actorCount = new Map<string, number>();
        historyRows.forEach((log) => {
            const actorId = `${log.actorId || log.staffId || ''}`;
            if (!actorId) return;
            actorCount.set(actorId, (actorCount.get(actorId) || 0) + 1);
        });

        actorCount.forEach((count, actorId) => {
            if (count < 40) return;
            const username = userById.get(actorId)?.username || actorId;
            results.push({
                id: `actor-spike-${actorId}`,
                severity: 'MEDIUM',
                title: `Tần suất thao tác cao từ ${username}`,
                detail: `Tài khoản này phát sinh ${count} thay đổi booking trong kỳ, nên rà soát để tránh sai sót.`,
                at: historyRows.find((log) => `${log.actorId || log.staffId || ''}` === actorId)?.timestamp || new Date().toISOString(),
            });
        });

        const importCreateLogs = historyRows.filter((log) => log.source === 'IMPORT' && log.action === 'CREATE');
        const importByDay = new Map<string, number>();
        importCreateLogs.forEach((log) => {
            const date = safeDate(log.timestamp);
            if (!date) return;
            const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
            importByDay.set(key, (importByDay.get(key) || 0) + 1);
        });

        importByDay.forEach((count, dayKey) => {
            if (count < 15) return;
            results.push({
                id: `import-spike-${dayKey}`,
                severity: 'MEDIUM',
                title: `Import tăng đột biến ngày ${dayKey}`,
                detail: `Ngày này có ${count} thao tác tạo booking từ nguồn import.`,
                at: new Date().toISOString(),
            });
        });

        return results
            .sort((a, b) => {
                const scoreA = a.severity === 'HIGH' ? 2 : 1;
                const scoreB = b.severity === 'HIGH' ? 2 : 1;
                if (scoreA !== scoreB) return scoreB - scoreA;
                return (safeDate(b.at)?.getTime() || 0) - (safeDate(a.at)?.getTime() || 0);
            })
            .slice(0, 12);
    }, [historyRows, userById]);

    const chartRowsToRender = chartMode === 'INDEX' ? indexedChartRows : rawChartRows;

    const yTickFormatter = (value: number) => {
        if (chartMode === 'INDEX') return `${value.toFixed(0)}`;
        return formatMetricValue(value, metric, true);
    };

    const roomOptions = useMemo(() => {
        return rooms
            .filter((room) => (selectedPropertyId === 'ALL' ? true : room.propertyId === selectedPropertyId))
            .sort((a, b) => (a.number || '').localeCompare(b.number || '', 'vi'));
    }, [rooms, selectedPropertyId]);

    const referenceLabel = timeRef === 'CREATED_AT' ? 'Ngày tạo đơn' : timeRef === 'CHECK_IN' ? 'Ngày nhận phòng' : 'Ngày trả phòng';

    return (
        <div className="space-y-6 animate-fade-in pb-8">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-blue-50 text-blue-700">
                            <ShieldCheck size={14} />
                            Sales Performance Terminal
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mt-3">Quản lý hiệu suất chốt đơn theo thời gian thực</h2>
                        <p className="text-sm text-gray-500 mt-2 max-w-3xl">
                            Xem hiệu suất từng nhân sự như mã chứng khoán: chọn chỉ số, so sánh theo ngày/tuần/tháng, drill-down theo kỳ và theo dõi bất thường từ audit log.
                        </p>
                    </div>

                    <div className="bg-slate-900 text-white rounded-2xl px-4 py-4 min-w-[280px]">
                        <div className="text-xs uppercase tracking-wider text-slate-400">Realtime</div>
                        <div className="flex items-center gap-2 mt-1 text-lg font-bold">
                            <Activity size={16} className="text-emerald-400" />
                            Đang đồng bộ
                        </div>
                        <div className="text-xs text-slate-300 mt-1">Cập nhật gần nhất: {formatDateTime(now.toISOString())}</div>
                        <div className="text-xs text-slate-400 mt-2">
                            Người xem: {currentUser.username} • {currentUser.role}
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-4">
                    <Filter size={16} />
                    Bộ lọc hiệu suất
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
                    <label className="text-xs font-semibold text-gray-600">
                        Từ ngày
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        />
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Đến ngày
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        />
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Chu kỳ
                        <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value as Period)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="DAY">Ngày</option>
                            <option value="WEEK">Tuần</option>
                            <option value="MONTH">Tháng</option>
                        </select>
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Hệ quy chiếu
                        <select
                            value={timeRef}
                            onChange={(e) => setTimeRef(e.target.value as TimeRef)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="CREATED_AT">Thời gian đặt phòng (Ngày tạo)</option>
                            <option value="CHECK_IN">Thời gian nhận phòng</option>
                            <option value="CHECK_OUT">Thời gian trả phòng</option>
                        </select>
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Chỉ số
                        <select
                            value={metric}
                            onChange={(e) => setMetric(e.target.value as Metric)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="ORDER_VALUE">Tổng giá trị chốt</option>
                            <option value="PAID">Số tiền đã trả</option>
                            <option value="ORDER_COUNT">Số đơn</option>
                            <option value="NET_REVENUE">Doanh thu net</option>
                            <option value="COLLECTION_RATE">Tỷ lệ thu tiền</option>
                        </select>
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Biểu đồ
                        <select
                            value={chartMode}
                            onChange={(e) => setChartMode(e.target.value as ChartMode)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="LINE">Line + Volume</option>
                            <option value="INDEX">Index 100</option>
                            <option value="CANDLE">Candlestick</option>
                        </select>
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
                    <label className="text-xs font-semibold text-gray-600">
                        Chi nhánh
                        <select
                            value={selectedPropertyId}
                            onChange={(e) => {
                                setSelectedPropertyId(e.target.value);
                                if (e.target.value !== 'ALL') {
                                    const roomInBranch = rooms.some((room) => room.id === selectedRoomId && room.propertyId === e.target.value);
                                    if (!roomInBranch) setSelectedRoomId('ALL');
                                }
                            }}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="ALL">Tất cả chi nhánh</option>
                            {properties.map((property) => (
                                <option key={property.id} value={property.id}>
                                    {property.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Phòng
                        <select
                            value={selectedRoomId}
                            onChange={(e) => setSelectedRoomId(e.target.value)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="ALL">Tất cả phòng</option>
                            {roomOptions.map((room) => (
                                <option key={room.id} value={room.id}>
                                    {room.number} • {propertyById.get(room.propertyId)?.name || room.propertyId}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="text-xs font-semibold text-gray-600">
                        Trạng thái đơn
                        <select
                            value={selectedStatus}
                            onChange={(e) => setSelectedStatus(e.target.value as StatusFilter)}
                            className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        >
                            <option value="ALL">Tất cả trạng thái</option>
                            <option value={BookingStatus.PENDING}>PENDING</option>
                            <option value={BookingStatus.CONFIRMED}>CONFIRMED</option>
                            <option value={BookingStatus.CHECKED_IN}>CHECKED_IN</option>
                            <option value={BookingStatus.CHECKED_OUT}>CHECKED_OUT</option>
                            <option value={BookingStatus.CANCELLED}>CANCELLED</option>
                        </select>
                    </label>

                    <div className="text-xs font-semibold text-gray-600 flex items-end">
                        <label className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeCompanyLine}
                                onChange={(e) => setIncludeCompanyLine(e.target.checked)}
                                className="accent-blue-600"
                            />
                            Hiện line toàn công ty
                        </label>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-400 font-bold">{METRIC_LABELS.ORDER_VALUE}</div>
                    <div className="text-2xl font-black text-gray-900 mt-2">{formatCurrency(companySummary.orderValue)}</div>
                    <div className="text-xs text-gray-500 mt-1">Theo {referenceLabel}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-400 font-bold">{METRIC_LABELS.PAID}</div>
                    <div className="text-2xl font-black text-emerald-700 mt-2">{formatCurrency(companySummary.paidAmount)}</div>
                    <div className="text-xs text-gray-500 mt-1">Tổng tiền đã thu</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-400 font-bold">{METRIC_LABELS.ORDER_COUNT}</div>
                    <div className="text-2xl font-black text-blue-700 mt-2">{companySummary.orderCount}</div>
                    <div className="text-xs text-gray-500 mt-1">Số booking trong kỳ</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-400 font-bold">{METRIC_LABELS.COLLECTION_RATE}</div>
                    <div className="text-2xl font-black text-indigo-700 mt-2">
                        {companySummary.orderValue > 0 ? ((companySummary.paidAmount / companySummary.orderValue) * 100).toFixed(1) : '0.0'}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Paid / Giá trị chốt</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-gray-400 font-bold">Xu hướng kỳ trước</div>
                    <div
                        className={`text-2xl font-black mt-2 flex items-center gap-2 ${
                            companyGrowth >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                    >
                        {companyGrowth >= 0 ? '+' : ''}
                        {companyGrowth.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">So với kỳ liền trước cùng độ dài</div>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div>
                        <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                            <Sparkles size={15} className="text-amber-500" />
                            Watchlist Nhân sự (Ticker)
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Chọn nhân sự theo dõi và chọn nhân sự đưa vào biểu đồ so sánh.</p>
                    </div>
                    <div className="text-xs text-gray-500">
                        Đang so sánh: <span className="font-bold text-gray-800">{selectedUserIds.length}</span> nhân sự
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                    <div className="flex flex-wrap gap-2">
                        {staffSummary.slice(0, 18).map((staff) => {
                            const inWatchlist = watchlistUserIds.includes(staff.id);
                            return (
                                <button
                                    key={`watch-${staff.id}`}
                                    onClick={() => toggleWatchlist(staff.id)}
                                    className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                                        inWatchlist
                                            ? 'bg-amber-50 border-amber-200 text-amber-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                    title={`${staff.username} (${staff.fullName})`}
                                >
                                    {staff.ticker}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {watchlistUserIds.map((staffId) => {
                            const staff = staffSummary.find((item) => item.id === staffId);
                            if (!staff) return null;
                            const selected = selectedUserIds.includes(staff.id);
                            return (
                                <button
                                    key={`compare-${staff.id}`}
                                    onClick={() => toggleCompare(staff.id)}
                                    className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                                        selected
                                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    {staff.ticker} • {staff.username}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                        {chartMode === 'CANDLE' ? <CandlestickChart size={16} /> : <LineChartIcon size={16} />}
                        {chartMode === 'INDEX' ? 'Biểu đồ Index 100' : chartMode === 'CANDLE' ? 'Biểu đồ Candlestick' : 'Biểu đồ hiệu suất'}
                    </div>

                    {chartMode === 'CANDLE' && (
                        <label className="text-xs font-semibold text-gray-600">
                            Ticker Candlestick
                            <select
                                value={focusTickerId}
                                onChange={(e) => setFocusTickerId(e.target.value)}
                                className="ml-2 px-3 py-2 rounded-lg border border-gray-200"
                            >
                                <option value="COMPANY">TOÀN CÔNG TY</option>
                                {selectedUserIds.map((staffId) => {
                                    const staff = staffSummary.find((item) => item.id === staffId);
                                    if (!staff) return null;
                                    return (
                                        <option key={staff.id} value={staff.id}>
                                            {staff.ticker} ({staff.username})
                                        </option>
                                    );
                                })}
                            </select>
                        </label>
                    )}
                </div>

                {chartMode === 'CANDLE' ? (
                    <CandlestickPanel
                        data={candleData}
                        metricLabel={METRIC_LABELS[metric]}
                        selectedBucketKey={selectedBucketKey}
                        onSelectBucket={setSelectedBucketKey}
                    />
                ) : (
                    <div className="h-[380px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                                data={chartRowsToRender}
                                onClick={(state: any) => {
                                    const bucketKey = state?.activePayload?.[0]?.payload?.bucketKey;
                                    if (bucketKey) setSelectedBucketKey(bucketKey);
                                }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                                <YAxis
                                    yAxisId="left"
                                    tick={{ fontSize: 12 }}
                                    tickFormatter={yTickFormatter}
                                    domain={chartMode === 'INDEX' ? [0, 'auto'] : [0, 'auto']}
                                />
                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} allowDecimals={false} />
                                <Tooltip
                                    formatter={(value: any, name: string) => {
                                        if (name === 'Khối lượng đơn') return [`${value}`, name];
                                        return [formatMetricValue(Number(value || 0), chartMode === 'INDEX' ? 'ORDER_COUNT' : metric), name];
                                    }}
                                />
                                <Legend />

                                <Bar
                                    yAxisId="right"
                                    dataKey="volume"
                                    name="Khối lượng đơn"
                                    barSize={18}
                                    fill="#cbd5e1"
                                    radius={[4, 4, 0, 0]}
                                />

                                {seriesMeta.map((series) => (
                                    <Line
                                        key={series.key}
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey={series.key}
                                        name={series.label}
                                        stroke={series.color}
                                        strokeWidth={series.id === 'COMPANY' ? 3 : 2}
                                        dot={false}
                                        activeDot={{ r: 5 }}
                                    />
                                ))}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                )}

                <div className="mt-3 text-xs text-gray-500">
                    Chỉ số hiện tại: <span className="font-semibold text-gray-700">{METRIC_LABELS[metric]}</span> • Trục thời gian: {' '}
                    <span className="font-semibold text-gray-700">{referenceLabel}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b bg-gray-50">
                        <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                            <TrendingUp size={15} className="text-blue-600" />
                            Bảng xếp hạng hiệu suất nhân sự
                        </h3>
                    </div>
                    <div className="overflow-auto max-h-[520px]">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white border-b">
                                <tr className="text-left text-xs uppercase text-gray-500">
                                    <th className="px-3 py-2">Ticker</th>
                                    <th className="px-3 py-2">Nhân sự</th>
                                    <th className="px-3 py-2 text-right">Giá trị chốt</th>
                                    <th className="px-3 py-2 text-right">Đã thu</th>
                                    <th className="px-3 py-2 text-right">Số đơn</th>
                                    <th className="px-3 py-2 text-right">Thu tiền</th>
                                    <th className="px-3 py-2 text-right">Xu hướng</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {staffSummary.map((staff) => (
                                    <tr key={`rank-${staff.id}`} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 font-bold text-blue-700">{staff.ticker}</td>
                                        <td className="px-3 py-2">
                                            <div className="font-semibold text-gray-800">{staff.username}</div>
                                            <div className="text-xs text-gray-500">{staff.fullName}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold">{compactCurrency(staff.current.orderValue)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                            {compactCurrency(staff.current.paidAmount)}
                                        </td>
                                        <td className="px-3 py-2 text-right">{staff.current.orderCount}</td>
                                        <td className="px-3 py-2 text-right">{staff.collectionRate.toFixed(1)}%</td>
                                        <td
                                            className={`px-3 py-2 text-right font-bold ${
                                                staff.growth >= 0 ? 'text-emerald-700' : 'text-red-700'
                                            }`}
                                        >
                                            {staff.growth >= 0 ? '+' : ''}
                                            {staff.growth.toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                                {staffSummary.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-6 text-center text-sm text-gray-400" colSpan={7}>
                                            Chưa có dữ liệu nhân sự trong kỳ lọc.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b bg-gray-50">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                                <Search size={15} className="text-indigo-600" />
                                Drill-down đơn theo kỳ
                            </h3>
                            <div className="text-xs text-gray-500">
                                Kỳ: <span className="font-semibold text-gray-700">{selectedBucket?.label || '--'}</span>
                            </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <label className="text-xs text-gray-500">Ticker:</label>
                            <select
                                value={focusTickerId}
                                onChange={(e) => setFocusTickerId(e.target.value)}
                                className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                            >
                                <option value="COMPANY">TOÀN CÔNG TY</option>
                                {staffSummary.map((staff) => (
                                    <option key={`focus-${staff.id}`} value={staff.id}>
                                        {staff.ticker} ({staff.username})
                                    </option>
                                ))}
                            </select>
                            <label className="relative flex-1 min-w-[160px]">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    value={drillSearch}
                                    onChange={(e) => setDrillSearch(e.target.value)}
                                    placeholder="Tìm theo mã BK / khách / phòng..."
                                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="overflow-auto max-h-[520px]">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white border-b">
                                <tr className="text-left text-xs uppercase text-gray-500">
                                    <th className="px-3 py-2">Mã BK</th>
                                    <th className="px-3 py-2">Khách</th>
                                    <th className="px-3 py-2">Phòng</th>
                                    <th className="px-3 py-2">Nhân sự</th>
                                    <th className="px-3 py-2">Mốc thời gian</th>
                                    <th className="px-3 py-2 text-right">Giá trị</th>
                                    <th className="px-3 py-2 text-right">Đã trả</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {drillDownBookings.map((booking) => {
                                    const room = roomById.get(booking.roomId);
                                    const staff = userById.get(booking.createdBy);
                                    const financials = getBookingFinancials(booking);
                                    const refDate = getReferenceDate(booking);
                                    return (
                                        <tr key={`drill-${booking.id}`} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 font-semibold text-gray-800">{booking.id}</td>
                                            <td className="px-3 py-2">
                                                <div className="font-medium">{booking.guestName || 'Khách lẻ'}</div>
                                                <div className="text-xs text-gray-500">{booking.guestPhone || '--'}</div>
                                            </td>
                                            <td className="px-3 py-2">{room?.number || booking.roomId}</td>
                                            <td className="px-3 py-2">{staff?.username || booking.createdBy}</td>
                                            <td className="px-3 py-2">{refDate ? formatDateTime(refDate.toISOString()) : '--'}</td>
                                            <td className="px-3 py-2 text-right font-semibold">{compactCurrency(financials.orderValue)}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                                {compactCurrency(financials.paidAmount)}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {drillDownBookings.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-7 text-center text-sm text-gray-400">
                                            Không có booking phù hợp ở kỳ đang chọn.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b bg-red-50/70">
                        <h3 className="font-bold text-sm text-red-800 flex items-center gap-2">
                            <AlertTriangle size={15} />
                            Cảnh báo bất thường (Phase 3)
                        </h3>
                        <p className="text-xs text-red-700 mt-1">
                            Dựa trên lịch sử thao tác: sửa giá nhiều lần, giảm giá mạnh, import đột biến, tài khoản thao tác quá dày.
                        </p>
                    </div>

                    <div className="p-3 space-y-2 max-h-[430px] overflow-auto">
                        {anomalies.map((item) => (
                            <div
                                key={item.id}
                                className={`rounded-xl border p-3 ${
                                    item.severity === 'HIGH' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div
                                        className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                                            item.severity === 'HIGH'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-amber-100 text-amber-700'
                                        }`}
                                    >
                                        {item.severity}
                                    </div>
                                    <div className="text-[11px] text-gray-500">{formatDateTime(item.at)}</div>
                                </div>
                                <div className="text-sm font-bold text-gray-900 mt-2">{item.title}</div>
                                <div className="text-xs text-gray-700 mt-1">{item.detail}</div>
                            </div>
                        ))}
                        {anomalies.length === 0 && (
                            <div className="text-center text-sm text-gray-400 py-8">
                                Chưa phát hiện bất thường trong kỳ lọc hiện tại.
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b bg-gray-50">
                        <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                            <Clock3 size={15} className="text-slate-600" />
                            Tape lịch sử thao tác (thời gian - user - thao tác - trước/sau)
                        </h3>
                    </div>

                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2 border-b border-gray-100">
                        <label className="text-xs text-gray-600">
                            Người thao tác
                            <select
                                value={historyActorFilter}
                                onChange={(e) => setHistoryActorFilter(e.target.value)}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                            >
                                <option value="ALL">Tất cả</option>
                                {historyOptions.actors.map((actor) => (
                                    <option key={actor.id} value={actor.id}>
                                        {actor.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="text-xs text-gray-600">
                            Nguồn thao tác
                            <select
                                value={historySourceFilter}
                                onChange={(e) => setHistorySourceFilter(e.target.value as HistorySourceFilter)}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                            >
                                <option value="ALL">Tất cả</option>
                                <option value="WEB">Web/App</option>
                                <option value="IMPORT">Import</option>
                                <option value="SYSTEM">System</option>
                            </select>
                        </label>

                        <label className="text-xs text-gray-600">
                            Chi nhánh
                            <select
                                value={historyPropertyFilter}
                                onChange={(e) => setHistoryPropertyFilter(e.target.value)}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                            >
                                <option value="ALL">Tất cả</option>
                                {historyOptions.properties.map((property) => (
                                    <option key={property.id} value={property.id}>
                                        {property.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="text-xs text-gray-600">
                            Phòng
                            <select
                                value={historyRoomFilter}
                                onChange={(e) => setHistoryRoomFilter(e.target.value)}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                            >
                                <option value="ALL">Tất cả</option>
                                {historyOptions.rooms.map((room) => (
                                    <option key={room.id} value={room.id}>
                                        {room.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="text-xs text-gray-600 md:col-span-2">
                            Trạng thái
                            <select
                                value={historyStatusFilter}
                                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                                className="mt-1 w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                            >
                                <option value="ALL">Tất cả</option>
                                {historyOptions.statuses.map((status) => (
                                    <option key={status} value={status}>
                                        {status}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="overflow-auto max-h-[430px]">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white border-b">
                                <tr className="text-left text-xs uppercase text-gray-500">
                                    <th className="px-3 py-2">Thời gian</th>
                                    <th className="px-3 py-2">Tên đăng nhập</th>
                                    <th className="px-3 py-2">Thao tác</th>
                                    <th className="px-3 py-2">Trước</th>
                                    <th className="px-3 py-2">Sau</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {historyRows.slice(0, 220).map((log) => {
                                    const metadata = (log.metadata || {}) as Record<string, any>;
                                    const beforeVal = metadata.beforeValue ?? '--';
                                    const afterVal = metadata.afterValue ?? '--';
                                    const username =
                                        log.actorUsername ||
                                        (log.actorId && userById.get(log.actorId)?.username) ||
                                        (log.staffId && userById.get(log.staffId)?.username) ||
                                        log.actorId ||
                                        log.staffId ||
                                        'không rõ';
                                    return (
                                        <tr key={`log-${log.id}`} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{formatDateTime(log.timestamp)}</td>
                                            <td className="px-3 py-2 text-xs font-semibold text-gray-800 whitespace-nowrap">{username}</td>
                                            <td className="px-3 py-2 text-xs">
                                                <div className="font-semibold text-gray-800">{metadata.operationName || getHistoryActionLabel(log.action)}</div>
                                                <div className="text-gray-500">{getHistorySourceLabel(log.source)}</div>
                                            </td>
                                            <td className="px-3 py-2 text-xs text-red-700 max-w-[220px] truncate" title={`${beforeVal}`}>
                                                {`${beforeVal}`}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-emerald-700 max-w-[220px] truncate" title={`${afterVal}`}>
                                                {`${afterVal}`}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {historyRows.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-7 text-center text-sm text-gray-400" colSpan={5}>
                                            Không có log phù hợp với bộ lọc hiện tại.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Performance;
