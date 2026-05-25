import { useEffect, useRef } from 'react';
import {
  Booking,
  BookingStatus,
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettings,
  normalizeNotificationSettings,
} from '../types';

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

const getNotificationApi = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  return window.Notification;
};

const shouldTriggerBefore = (diffMin: number, minutesBefore: number) =>
  diffMin > minutesBefore - 1 && diffMin <= minutesBefore;

export const useBookingAlert = (
  bookings: Booking[],
  onNewAlert: (alert: AppNotification) => void,
  notificationSettings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
) => {
  const processedRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onNewAlertRef = useRef(onNewAlert);
  const settingsRef = useRef<NotificationSettings>(normalizeNotificationSettings(notificationSettings));

  useEffect(() => {
      onNewAlertRef.current = onNewAlert;
  }, [onNewAlert]);

  useEffect(() => {
      settingsRef.current = normalizeNotificationSettings(notificationSettings);
  }, [notificationSettings]);

  useEffect(() => {
    const settings = settingsRef.current;
    const notificationApi = getNotificationApi();
    if (settings.enabled && settings.browserEnabled && notificationApi && notificationApi.permission !== 'granted') {
      notificationApi.requestPermission();
    }
    audioRef.current = new Audio(SOUND_URL);
  }, [notificationSettings]);

  useEffect(() => {
    const checkBookings = () => {
        const settings = settingsRef.current;
        if (!settings.enabled) return;
        if (!settings.bookingAlerts.checkInEnabled && !settings.bookingAlerts.checkOutEnabled) return;

        const now = new Date().getTime();
        bookings.forEach(b => {
            if (b.status === BookingStatus.CONFIRMED && settings.bookingAlerts.checkInEnabled) {
                const checkInTime = new Date(b.checkInDate).getTime();
                const diffMin = (checkInTime - now) / 60000;
                if (shouldTriggerBefore(diffMin, settings.bookingAlerts.minutesBefore)) {
                    triggerAlert(b, 'CHECK_IN', 'BEFORE', settings.bookingAlerts.minutesBefore);
                }
                if (settings.bookingAlerts.atTimeEnabled && Math.abs(diffMin) <= 1) {
                    triggerAlert(b, 'CHECK_IN', 'NOW');
                }
            }
            if (b.status === BookingStatus.CHECKED_IN && settings.bookingAlerts.checkOutEnabled) {
                const checkOutTime = new Date(b.checkOutDate).getTime();
                const diffMin = (checkOutTime - now) / 60000;
                if (shouldTriggerBefore(diffMin, settings.bookingAlerts.minutesBefore)) {
                    triggerAlert(b, 'CHECK_OUT', 'BEFORE', settings.bookingAlerts.minutesBefore);
                }
                if (settings.bookingAlerts.atTimeEnabled && Math.abs(diffMin) <= 1) {
                    triggerAlert(b, 'CHECK_OUT', 'NOW');
                }
            }
        });
    };

    const triggerAlert = (booking: Booking, type: 'CHECK_IN' | 'CHECK_OUT', trigger: 'BEFORE' | 'NOW', minutesBefore?: number) => {
        const settings = settingsRef.current;
        const beforeLabel = trigger === 'BEFORE' ? minutesBefore || settings.bookingAlerts.minutesBefore : 'NOW';
        const key = `${booking.id}_${type}_${trigger}_${beforeLabel}`;
        if (processedRef.current.has(key)) return;
        processedRef.current.add(key);

        let title = ''; let message = '';
        if (type === 'CHECK_IN') {
            title = 'Sắp đến giờ Check-in';
            message = trigger === 'BEFORE'
                ? `Đơn ${booking.id} sẽ check-in trong ${beforeLabel} phút nữa.`
                : `Đã đến giờ check-in cho đơn ${booking.id}.`;
        } else {
            title = 'Sắp đến giờ Check-out';
            message = trigger === 'BEFORE'
                ? `Đơn ${booking.id} sẽ check-out trong ${beforeLabel} phút nữa.`
                : `Đã đến giờ check-out cho đơn ${booking.id}.`;
        }

        const newAlert: AppNotification = {
            id: key + '_' + Date.now(),
            title,
            message,
            type,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        };

        if (settings.soundEnabled && audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(e => console.log('Audio play blocked:', e));
        }

        const notificationApi = getNotificationApi();
        if (settings.browserEnabled && notificationApi?.permission === 'granted') {
            new notificationApi(title, { body: message, icon: '/favicon.ico' });
        }

        if (settings.inAppEnabled) {
            onNewAlertRef.current(newAlert);
        }
    };

    checkBookings();
    const interval = setInterval(checkBookings, 60000);
    return () => clearInterval(interval);
  }, [bookings]);
};
