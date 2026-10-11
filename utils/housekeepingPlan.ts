import { Booking, BookingStatus, Room, RoomStatus, HousekeepingSettings, HousekeepingWorker, normalizeHousekeepingSettings } from '../types';

const MINUTE = 60000;
const DAY = 86400000;
const VN = 7 * 60 * MINUTE;
export const housekeepingDate = (ms: number) => new Date(ms).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const dayStart = (ms: number) => Math.floor((ms + VN) / DAY) * DAY - VN;
const clock = (s: string) => { const [h, m] = s.split(':').map(Number); return (h * 60 + m) * MINUTE; };
const dateKey = (ms: number) => new Date(ms + VN).toISOString().slice(0, 10);

export interface CleaningJob {
    id: string;
    roomId: string;
    propertyId: string;
    bookingId: string;
    previousBookingId?: string;
    release: number;
    deadline: number;
}
export interface CleaningAssignment extends CleaningJob {
    workerId?: string;
    workerName?: string;
    start?: number;
    end?: number;
    late: boolean;
    reason?: string;
}
export interface CleaningWarning {
    bookingId?: string;
    roomId?: string;
    roomLabel?: string;
    bookingPeriod?: string;
    relatedBooking?: boolean;
    message: string;
}

export function housekeepingWorkers(settings: HousekeepingSettings, propertyIds: string[]): HousekeepingWorker[] {
    const configured = normalizeHousekeepingSettings(settings).workers;
    return [...configured, ...propertyIds.filter(id => !configured.some(w => w.propertyIds.includes(id))).map(id => ({
        id: `default:${id}`, name: 'Nhân viên dự kiến (chưa cấu hình)', propertyIds: [id], shiftStart: '08:00', shiftEnd: '22:00',
        cleaningMinutes: 30, travelMinutes: 15, weekdays: [0, 1, 2, 3, 4, 5, 6],
    }))];
}

// Include all branches connected through a shared worker, even if only one branch is visible.
export function housekeepingScope(settings: HousekeepingSettings, initial: string[]): string[] {
    const scope = new Set(initial);
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const w of settings.workers) if (w.propertyIds.some(id => scope.has(id))) {
            for (const id of w.propertyIds) if (!scope.has(id)) { scope.add(id); expanded = true; }
        }
    }
    return [...scope].sort();
}

function workWindows(worker: HousekeepingWorker, day: number): Array<[number, number]> {
    if (!worker.weekdays.includes(new Date(day + VN).getUTCDay()) || worker.daysOff?.includes(dateKey(day))) return [];
    const start = day + clock(worker.shiftStart), end = day + clock(worker.shiftEnd);
    if (!(end > start)) return []; // Same-day shifts; never assume overnight coverage.
    const bs = worker.breakStart ? day + clock(worker.breakStart) : NaN;
    const be = worker.breakEnd ? day + clock(worker.breakEnd) : NaN;
    return be > bs && bs < end && be > start
        ? [[start, Math.max(start, bs)], [Math.min(end, be), end]].filter(([a, b]) => b > a) as Array<[number, number]>
        : [[start, end]];
}

export function buildCleaningJobs(bookings: Booking[], rooms: Room[], now: number, until: number): CleaningJob[] {
    const byRoom = new Map<string, Booking[]>();
    for (const b of bookings) {
        if (b.status === BookingStatus.DELETED || b.isHold || b.status === BookingStatus.HOLD) continue;
        if (!Number.isFinite(Date.parse(b.checkInDate)) || !Number.isFinite(Date.parse(b.checkOutDate))) continue;
        const list = byRoom.get(b.roomId) || []; list.push(b); byRoom.set(b.roomId, list);
    }
    const jobs: CleaningJob[] = [];
    for (const room of rooms) {
        const list = (byRoom.get(room.id) || []).sort((a, b) => Date.parse(a.checkInDate) - Date.parse(b.checkInDate) || a.id.localeCompare(b.id));
        for (let i = 0; i < list.length; i++) {
            const next = list[i], deadline = Date.parse(next.checkInDate);
            if (deadline < now || deadline > until) continue;
            const previous = list[i - 1];
            const checkout = previous ? Date.parse(previous.checkOutDate) : now;
            if (checkout > deadline) continue; // Actual overlap is handled by booking validation.
            const wasCleaned = room.status !== RoomStatus.VACANT_DIRTY && checkout <= now && (room.lastCleanedAt || 0) >= checkout;
            if (wasCleaned) continue;
            if (!previous && room.status !== RoomStatus.VACANT_DIRTY && room.status !== RoomStatus.OCCUPIED) continue;
            jobs.push({ id: `${previous?.id || 'dirty'}>${next.id}`, roomId: room.id, propertyId: room.propertyId,
                bookingId: next.id, previousBookingId: previous?.id, release: Math.max(now, checkout), deadline });
        }
    }
    return jobs;
}

function earliestSlot(job: CleaningJob, worker: HousekeepingWorker, calendar: CleaningAssignment[]): { start: number; end: number } | null {
    const duration = worker.cleaningMinutes * MINUTE;
    const travel = (other?: CleaningAssignment) => other && other.propertyId !== job.propertyId ? worker.travelMinutes * MINUTE : 0;
    let best: { start: number; end: number } | null = null;
    for (let gap = 0; gap <= calendar.length; gap++) {
        const previous = calendar[gap - 1], next = calendar[gap];
        const lower = Math.max(job.release, previous?.end || job.release);
        const upper = next ? next.start! - travel(next) : Infinity;
        if (lower + duration > upper) continue;
        // Search covers weekly days off and explicit leave without blocking the UI indefinitely.
        for (let d = dayStart(lower); d <= dayStart(lower) + 31 * DAY; d += DAY) {
            if (best && d > best.start) break;
            for (const [open, close] of workWindows(worker, d)) {
                const move = travel(previous);
                const start = Math.max(job.release, open + move, (previous?.end || open) + move);
                const end = start + duration;
                if (end > close || end > upper) continue;
                // A trip to the following assignment also needs working time.
                if (next && travel(next) && !workWindows(worker, dayStart(next.start!)).some(([a, b]) => next.start! - travel(next) >= a && next.start! <= b)) continue;
                if (!best || end < best.end) best = { start, end };
            }
            if (best && best.end <= job.deadline) break;
            if (d > upper) break;
        }
    }
    return best;
}

// Place tight deadlines first, then fill available gaps. This is a suggested schedule,
// not a proof that no other arrangement could work; warnings remain overridable.
export function planHousekeeping(jobs: CleaningJob[], workers: HousekeepingWorker[]): CleaningAssignment[] {
    const calendars = new Map<string, CleaningAssignment[]>();
    const result: CleaningAssignment[] = [];
    for (const job of [...jobs].sort((a, b) => a.deadline - b.deadline || a.release - b.release || a.id.localeCompare(b.id))) {
        let chosen: { worker: HousekeepingWorker; start: number; end: number } | null = null;
        for (const worker of workers.filter(w => w.propertyIds.includes(job.propertyId))) {
            const slot = earliestSlot(job, worker, calendars.get(worker.id) || []);
            if (slot && (!chosen || slot.end < chosen.end)) chosen = { worker, ...slot };
        }
        if (!chosen) { result.push({ ...job, late: true, reason: 'Không tìm được ca dọn phù hợp trong lịch làm việc đã cấu hình.' }); continue; }
        const assignment: CleaningAssignment = { ...job, workerId: chosen.worker.id, workerName: chosen.worker.name,
            start: chosen.start, end: chosen.end, late: chosen.end > job.deadline };
        const calendar = calendars.get(chosen.worker.id) || [];
        calendar.push(assignment); calendar.sort((a, b) => a.start! - b.start!); calendars.set(chosen.worker.id, calendar);
        result.push(assignment);
    }
    return result;
}

export function cleaningWarnings(before: Booking[], after: Booking[], rooms: Room[], settings: HousekeepingSettings, changedIds: string[], now = Date.now()): CleaningWarning[] {
    const changed = new Set(changedIds);
    const touched = [...before, ...after].filter(b => changed.has(b.id));
    const until = Math.max(now, ...touched.map(b => Date.parse(b.checkOutDate)).filter(Number.isFinite)) + 2 * DAY;
    const workers = housekeepingWorkers(settings, [...new Set(rooms.map(r => r.propertyId))]);
    const baseline = new Map(planHousekeeping(buildCleaningJobs(before, rooms, now, until), workers).map(j => [j.id, j]));
    const plan = planHousekeeping(buildCleaningJobs(after, rooms, now, until), workers);
    return plan.filter(j => j.late && (changed.has(j.bookingId) || changed.has(j.previousBookingId || '') || !baseline.get(j.id)?.late || (j.end || Infinity) > (baseline.get(j.id)?.end || Infinity))).map(j => {
        const room = rooms.find(r => r.id === j.roomId)?.number || j.roomId;
        const ownBooking = changed.has(j.bookingId);
        const nextBooking = changed.has(j.previousBookingId || '');
        const booking = ownBooking ? after.find(b => b.id === j.bookingId) : undefined;
        const time = (ms: number) => new Date(ms).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false });
        let bookingPeriod: string | undefined;
        if (booking) {
            const checkIn = Date.parse(booking.checkInDate), checkOut = Date.parse(booking.checkOutDate);
            bookingPeriod = dateKey(checkIn) === dateKey(checkOut)
                ? `${time(checkIn)}–${time(checkOut)} ngày ${new Date(checkIn).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
                : `${housekeepingDate(checkIn)} → ${housekeepingDate(checkOut)}`;
        }
        const available = workers.filter(w => w.propertyIds.includes(j.propertyId)).flatMap(w => {
            const windows: number[] = [];
            for (let d = dayStart(j.release); d <= dayStart(j.release) + 31 * DAY; d += DAY) {
                for (const [start, end] of workWindows(w, d)) if (end > j.release) windows.push(Math.max(start, j.release));
                if (windows.length) break;
            }
            return windows;
        });
        const firstAvailable = available.length ? Math.min(...available) : undefined;
        const arrival = `${nextBooking ? 'Khách tiếp theo' : 'Khách'} đến ${housekeepingDate(j.deadline)}`;
        const briefTime = (ms: number) => dateKey(ms) === dateKey(j.deadline) ? time(ms)
            : dayStart(ms) === dayStart(j.deadline) - DAY ? `${time(ms)} hôm trước` : housekeepingDate(ms);
        const previous = after.find(b => b.id === j.previousBookingId);
        const previousCheckout = previous ? Date.parse(previous.checkOutDate) : undefined;
        const context = previousCheckout !== undefined
            ? `Khách trước trả phòng lúc ${briefTime(previousCheckout)}.`
            : 'Phòng chưa được xác nhận sạch.';
        const reason = ownBooking && firstAvailable !== undefined && firstAvailable > j.deadline
            ? `Chưa có người dọn; ${briefTime(firstAvailable)} mới có người dọn.`
            : j.end ? `dự kiến ${housekeepingDate(j.end)} mới dọn xong.` : 'chưa bố trí được người dọn kịp giờ.';
        return { bookingId: j.bookingId, roomId: j.roomId, roomLabel: room, bookingPeriod,
            relatedBooking: ownBooking || nextBooking, message: ownBooking ? `${context} ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : `${arrival}; ${reason}` };
    });
}
