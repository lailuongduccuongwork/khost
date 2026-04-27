import { Booking, BookingStatus, Room, RoomStatus } from '../types';

const toTime = (value?: string | null) => {
    if (!value) return Number.NaN;
    return new Date(value).getTime();
};

const toNow = (nowInput: number | Date) => (typeof nowInput === 'number' ? nowInput : nowInput.getTime());

export const deriveBookingStatus = (
    booking: Pick<Booking, 'status' | 'checkInDate' | 'checkOutDate' | 'isHold'>,
    nowInput: number | Date = Date.now()
): BookingStatus => {
    if (booking.status === BookingStatus.DELETED) return BookingStatus.DELETED;
    if (booking.status === BookingStatus.HOLD || booking.isHold) return BookingStatus.HOLD;

    const nowMs = toNow(nowInput);
    const checkInMs = toTime(booking.checkInDate);
    const checkOutMs = toTime(booking.checkOutDate);

    if (!Number.isFinite(checkInMs) || !Number.isFinite(checkOutMs) || checkOutMs <= checkInMs) {
        return booking.status === BookingStatus.CHECKED_OUT ? BookingStatus.CHECKED_OUT : BookingStatus.CONFIRMED;
    }

    if (nowMs >= checkOutMs) return BookingStatus.CHECKED_OUT;
    if (nowMs >= checkInMs) return BookingStatus.CHECKED_IN;
    return BookingStatus.CONFIRMED;
};

export const isBookingOccupyingRoom = (booking: Booking, nowInput: number | Date = Date.now()) =>
    deriveBookingStatus(booking, nowInput) === BookingStatus.CHECKED_IN;

export const getActiveBookingForRoom = (
    bookings: Booking[],
    roomId: string,
    nowInput: number | Date = Date.now()
) =>
    bookings
        .filter((booking) => booking.roomId === roomId && isBookingOccupyingRoom(booking, nowInput))
        .sort((left, right) => new Date(left.checkInDate).getTime() - new Date(right.checkInDate).getTime())[0];

export const deriveRoomOperationalStatus = (
    room: Pick<Room, 'id' | 'status'>,
    bookings: Booking[],
    nowInput: number | Date = Date.now()
): RoomStatus => {
    if (getActiveBookingForRoom(bookings, room.id, nowInput)) return RoomStatus.OCCUPIED;
    if (room.status === RoomStatus.OCCUPIED) return RoomStatus.VACANT_DIRTY;
    return room.status === RoomStatus.VACANT_DIRTY ? RoomStatus.VACANT_DIRTY : RoomStatus.VACANT_CLEAN;
};
