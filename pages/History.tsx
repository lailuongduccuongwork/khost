import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Filter, Search, Shield, User as UserIcon } from 'lucide-react';
import { HistoryLog, User } from '../types';

interface HistoryPageProps {
    history: HistoryLog[];
    users: User[];
    currentUser: User;
}

const ACTION_LABELS: Record<string, string> = {
    CREATE: 'Tạo mới',
    UPDATE: 'Cập nhật',
    DELETE: 'Xóa',
    CHECK_IN: 'Check-in',
    CHECK_OUT: 'Check-out',
    CANCEL: 'Hủy',
    LOGIN: 'Đăng nhập',
    LOGOUT: 'Đăng xuất',
    IMPORT: 'Import',
    EXPORT: 'Xuất file',
    RESET: 'Reset',
    STATUS_CHANGE: 'Đổi trạng thái',
    REORDER: 'Sắp xếp lại',
    BULK_DELETE: 'Xóa hàng loạt',
};

const ENTITY_LABELS: Record<string, string> = {
    AUTH: 'Xác thực',
    BOOKING: 'Đơn đặt phòng',
    ROOM: 'Phòng',
    USER: 'Tài khoản',
    CUSTOMER: 'Khách hàng',
    PROPERTY: 'Chi nhánh',
    ROOM_TYPE: 'Hạng phòng',
    TAG: 'Thẻ',
    TRANSACTION_CATEGORY: 'Danh mục',
    REPORT: 'Báo cáo',
    TENANT: 'Tenant',
    PLAN: 'Gói cước',
    SYSTEM: 'Hệ thống',
};

const ACTION_STYLES: Record<string, string> = {
    CREATE: 'bg-emerald-100 text-emerald-700',
    UPDATE: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
    CHECK_IN: 'bg-green-100 text-green-700',
    CHECK_OUT: 'bg-slate-200 text-slate-700',
    CANCEL: 'bg-rose-100 text-rose-700',
    LOGIN: 'bg-cyan-100 text-cyan-700',
    LOGOUT: 'bg-gray-200 text-gray-700',
    IMPORT: 'bg-indigo-100 text-indigo-700',
    EXPORT: 'bg-amber-100 text-amber-700',
    RESET: 'bg-red-200 text-red-800',
    STATUS_CHANGE: 'bg-orange-100 text-orange-700',
    REORDER: 'bg-violet-100 text-violet-700',
    BULK_DELETE: 'bg-red-200 text-red-800',
};

const RISKY_ACTIONS = new Set(['DELETE', 'RESET', 'BULK_DELETE', 'EXPORT']);

const formatDateTime = (iso: string) => {
    const date = new Date(iso);
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const safeStringify = (value: any) => {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return '';
    }
};

const HistoryPage: React.FC<HistoryPageProps> = ({ history, users, currentUser }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [actionFilter, setActionFilter] = useState('ALL');
    const [entityFilter, setEntityFilter] = useState('ALL');
    const [actorFilter, setActorFilter] = useState('ALL');
    const [sourceFilter, setSourceFilter] = useState('ALL');

    const usernameByUserId = useMemo(() => {
        const map = new Map<string, string>();
        users.forEach((user) => {
            map.set(user.id, user.username);
        });
        return map;
    }, [users]);

    const actorOptions = useMemo(() => {
        return Array.from(
            new Map(
                history
                    .filter((log) => log.actorId || log.staffId)
                    .map((log) => [
                        log.actorId || log.staffId || '',
                        {
                            id: log.actorId || log.staffId || '',
                            label:
                                log.actorUsername ||
                                (log.actorId ? usernameByUserId.get(log.actorId) : undefined) ||
                                (log.staffId ? usernameByUserId.get(log.staffId) : undefined) ||
                                log.actorId ||
                                log.staffId ||
                                'không rõ',
                        },
                    ])
            ).values()
        );
    }, [history, usernameByUserId]);

    const filteredHistory = useMemo(() => {
        const lowered = searchTerm.trim().toLowerCase();

        return history.filter((log) => {
            const entityType = log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM');
            const actorId = log.actorId || log.staffId || '';
            const actorUsername =
                log.actorUsername ||
                (log.actorId ? usernameByUserId.get(log.actorId) : undefined) ||
                (log.staffId ? usernameByUserId.get(log.staffId) : undefined) ||
                log.actorId ||
                log.staffId ||
                'không rõ';
            const haystack = [
                log.description,
                log.entityLabel,
                actorUsername,
                log.staffId,
                safeStringify(log.metadata),
                log.bookingSnapshot?.guestName,
                log.bookingSnapshot?.id,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
            if (entityFilter !== 'ALL' && entityType !== entityFilter) return false;
            if (actorFilter !== 'ALL' && actorId !== actorFilter) return false;
            if (sourceFilter !== 'ALL' && (log.source || 'WEB') !== sourceFilter) return false;
            if (lowered && !haystack.includes(lowered)) return false;

            return true;
        });
    }, [actionFilter, actorFilter, entityFilter, history, searchTerm, sourceFilter, usernameByUserId]);

    const stats = useMemo(() => {
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

        return {
            total: history.length,
            today: history.filter((log) => {
                const date = new Date(log.timestamp);
                return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` === todayKey;
            }).length,
            risky: history.filter((log) => RISKY_ACTIONS.has(log.action)).length,
            actors: new Set(history.map((log) => log.actorId || log.staffId).filter(Boolean)).size,
        };
    }, [history]);

    return (
        <div className="katka-liquid-page space-y-6 animate-fade-in">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 md:p-6">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wide">
                            <Shield size={14} />
                            Realtime Audit Log
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mt-3">Lịch sử thao tác toàn hệ thống tenant</h2>
                        <p className="text-sm text-gray-500 mt-2 max-w-3xl">
                            Trang này lưu toàn bộ thao tác đang lấy được trong app hiện tại theo thời gian thực, mặc định dành cho ADMIN và có thể phân quyền thêm cho vai trò khác sau.
                        </p>
                    </div>
                    <div className="bg-slate-900 text-white rounded-2xl px-4 py-4 min-w-[260px]">
                        <div className="text-xs uppercase tracking-wider text-slate-400">Người đang xem</div>
                        <div className="text-lg font-bold mt-1">{currentUser.fullName}</div>
                        <div className="text-sm text-slate-300 mt-1">{currentUser.username} • {currentUser.role}</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">Tổng log</div>
                    <div className="text-3xl font-black text-gray-900 mt-2">{stats.total}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">Phát sinh hôm nay</div>
                    <div className="text-3xl font-black text-blue-700 mt-2">{stats.today}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">Hành động rủi ro</div>
                    <div className="text-3xl font-black text-red-700 mt-2">{stats.risky}</div>
                </div>
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">Tài khoản có hoạt động</div>
                    <div className="text-3xl font-black text-emerald-700 mt-2">{stats.actors}</div>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-4">
                    <Filter size={16} />
                    Bộ lọc lịch sử
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                    <label className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Tìm theo mô tả, người dùng, đối tượng..."
                            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                        />
                    </label>

                    <select
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                    >
                        <option value="ALL">Tất cả hành động</option>
                        {Array.from(new Set<string>(history.map((log) => String(log.action || '')))).map((action) => (
                            <option key={action} value={action}>{ACTION_LABELS[action] || action}</option>
                        ))}
                    </select>

                    <select
                        value={entityFilter}
                        onChange={(e) => setEntityFilter(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                    >
                        <option value="ALL">Tất cả đối tượng</option>
                        {Array.from(new Set<string>(history.map((log) => String(log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM'))))).map((entity) => (
                            <option key={entity} value={entity}>{ENTITY_LABELS[entity] || entity}</option>
                        ))}
                    </select>

                    <select
                        value={actorFilter}
                        onChange={(e) => setActorFilter(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                    >
                        <option value="ALL">Tất cả tài khoản</option>
                        {actorOptions.map((actor) => (
                            <option key={actor.id} value={actor.id}>{actor.label}</option>
                        ))}
                    </select>

                    <select
                        value={sourceFilter}
                        onChange={(e) => setSourceFilter(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                    >
                        <option value="ALL">Tất cả nguồn</option>
                        <option value="WEB">Web/App</option>
                        <option value="IMPORT">Import</option>
                        <option value="SYSTEM">Tự động hệ thống</option>
                    </select>
                </div>
                <div className="mt-3 text-sm text-gray-500">
                    Đang hiển thị <span className="font-bold text-gray-800">{filteredHistory.length}</span> / {history.length} log.
                </div>
            </div>

            <div className="space-y-4">
                {filteredHistory.length === 0 && (
                    <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-10 text-center text-gray-400">
                        Chưa có lịch sử phù hợp với bộ lọc hiện tại.
                    </div>
                )}

                {filteredHistory.map((log) => {
                    const metadata = log.metadata || {};
                    const actorUsername =
                        log.actorUsername ||
                        (log.actorId ? usernameByUserId.get(log.actorId) : undefined) ||
                        (log.staffId ? usernameByUserId.get(log.staffId) : undefined) ||
                        log.actorId ||
                        log.staffId ||
                        'không rõ';
                    const entityType = log.entityType || (log.bookingSnapshot ? 'BOOKING' : 'SYSTEM');
                    const actionLabel = ACTION_LABELS[log.action] || log.action;
                    const entityLabel = ENTITY_LABELS[entityType] || entityType;
                    const style = ACTION_STYLES[log.action] || 'bg-gray-100 text-gray-700';
                    const metadataChips = [
                        metadata.propertyName,
                        metadata.roomNumber ? `Phòng ${metadata.roomNumber}` : null,
                        metadata.guestName ? `Khách ${metadata.guestName}` : null,
                        metadata.fileName,
                        typeof metadata.count === 'number' ? `${metadata.count} mục` : null,
                    ].filter(Boolean);

                    return (
                        <div key={log.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
                            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${style}`}>{actionLabel}</span>
                                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{entityLabel}</span>
                                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{log.source || 'WEB'}</span>
                                        {RISKY_ACTIONS.has(log.action) && (
                                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 flex items-center gap-1">
                                                <AlertTriangle size={12} />
                                                Rủi ro
                                            </span>
                                        )}
                                    </div>

                                    <h3 className="text-base md:text-lg font-bold text-gray-900">{log.description}</h3>

                                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                                        <span className="flex items-center gap-1.5">
                                            <UserIcon size={14} />
                                            {actorUsername}
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <Clock3 size={14} />
                                            {formatDateTime(log.timestamp)}
                                        </span>
                                        {log.entityLabel && (
                                            <span className="font-medium text-gray-700">
                                                Đối tượng: {log.entityLabel}
                                            </span>
                                        )}
                                    </div>

                                    {metadataChips.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {metadataChips.map((chip) => (
                                                <span key={String(chip)} className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                                                    {chip}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {(log.before || log.after || log.metadata || log.bookingSnapshot) && (
                                <details className="mt-4 border-t border-gray-100 pt-4">
                                    <summary className="cursor-pointer text-sm font-bold text-blue-700 hover:text-blue-800 select-none">
                                        Xem chi tiết thay đổi
                                    </summary>
                                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
                                        {log.before && (
                                            <div className="bg-rose-50 rounded-xl p-4 border border-rose-100">
                                                <div className="text-xs uppercase tracking-wide text-rose-600 font-bold mb-2">Trước thay đổi</div>
                                                <pre className="text-xs text-rose-900 whitespace-pre-wrap break-words">{safeStringify(log.before)}</pre>
                                            </div>
                                        )}
                                        {log.after && (
                                            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                                                <div className="text-xs uppercase tracking-wide text-emerald-700 font-bold mb-2">Sau thay đổi</div>
                                                <pre className="text-xs text-emerald-900 whitespace-pre-wrap break-words">{safeStringify(log.after)}</pre>
                                            </div>
                                        )}
                                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                            <div className="text-xs uppercase tracking-wide text-slate-600 font-bold mb-2">Metadata</div>
                                            <pre className="text-xs text-slate-800 whitespace-pre-wrap break-words">
                                                {safeStringify(log.metadata || log.bookingSnapshot || {})}
                                            </pre>
                                        </div>
                                    </div>
                                </details>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default HistoryPage;
