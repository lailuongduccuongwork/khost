import { Room } from '../types';

// Old imports contain both local ISO strings and UTC/offset ISO strings. Start
// two calendar days early, then compare actual timestamps after the query.
export const checkoutQueryLowerBound = (timeMs: number) =>
    new Date(Math.max(0, timeMs - 2 * 86400000)).toISOString().slice(0, 10);

export const roomHistoryStart = (rooms: Pick<Room, 'lastCleanedAt'>[]) => {
    if (!rooms.length) return 0;
    // A legacy room without a cleaning confirmation still needs its history.
    // Do not silently declare it clean by imposing a rolling 30-day window.
    return Math.min(...rooms.map(room =>
        Number.isFinite(room.lastCleanedAt) && room.lastCleanedAt! > 0
            ? room.lastCleanedAt! : 0
    ));
};
