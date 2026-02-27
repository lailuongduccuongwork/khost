import { useEffect, useRef } from 'react';
import { Booking, BookingStatus } from '../types';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'CHECK_IN' | 'CHECK_OUT' | 'DEBT' | 'INFO';
  time: string;
  isVisible?: boolean; // Dành cho Toast (hiển thị 3s)
  isRead?: boolean;    // Dành cho Lịch sử cái chuông
}

const SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

export const useBookingAlert = (bookings: Booking[], onNewAlert: (alert: AppNotification) => void) => {
  const processedRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onNewAlertRef = useRef(onNewAlert);

  useEffect(() => {
      onNewAlertRef.current = onNewAlert;
  }, [onNewAlert]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    audioRef.current = new Audio(SOUND_URL);
  }, []);

  useEffect(() => {
    const checkBookings = () => {
        const now = new Date().getTime();
        bookings.forEach(b => {
            if (b.status === BookingStatus.CONFIRMED) {
                const checkInTime = new Date(b.checkInDate).getTime();
                const diffMin = (checkInTime - now) / 60000;
                if (diffMin > 4 && diffMin <= 5) triggerAlert(b, 'CHECK_IN', '5MIN');
                if (Math.abs(diffMin) <= 1) triggerAlert(b, 'CHECK_IN', 'NOW');
            }
            if (b.status === BookingStatus.CHECKED_IN) {
                const checkOutTime = new Date(b.checkOutDate).getTime();
                const diffMin = (checkOutTime - now) / 60000;
                if (diffMin > 4 && diffMin <= 5) triggerAlert(b, 'CHECK_OUT', '5MIN');
                if (Math.abs(diffMin) <= 1) triggerAlert(b, 'CHECK_OUT', 'NOW');
            }
        });
    };

    const triggerAlert = (booking: Booking, type: 'CHECK_IN' | 'CHECK_OUT', trigger: '5MIN' | 'NOW') => {
        const key = `${booking.id}_${type}_${trigger}`;
        if (processedRef.current.has(key)) return;
        processedRef.current.add(key);

        let title = ''; let message = '';
        if (type === 'CHECK_IN') {
            title = 'Sắp đến giờ Check-in';
            message = trigger === '5MIN' ? `Đơn ${booking.id} sẽ check-in trong 5 phút nữa.` : `Đã đến giờ check-in cho đơn ${booking.id}.`;
        } else {
            title = 'Sắp đến giờ Check-out';
            message = trigger === '5MIN' ? `Đơn ${booking.id} sẽ check-out trong 5 phút nữa.` : `Đã đến giờ check-out cho đơn ${booking.id}.`;
        }

        const newAlert: AppNotification = {
            id: key + '_' + Date.now(),
            title,
            message,
            type,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        };

        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(e => console.log('Audio play blocked:', e));
        }

        if (Notification.permission === 'granted') {
            new Notification(title, { body: message, icon: '/favicon.ico' });
        }

        onNewAlertRef.current(newAlert);
    };

    checkBookings();
    const interval = setInterval(checkBookings, 60000);
    return () => clearInterval(interval);
  }, [bookings]);
};