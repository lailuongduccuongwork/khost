import { useEffect, useRef } from 'react';
import {
  Booking,
  BookingStatus,
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettings,
  Room,
  normalizeNotificationSettings,
} from '../types';
import { AppNotification } from './useBookingAlert';

const DEBT_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3';

const getNotificationApi = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  return window.Notification;
};

export const useDebtAlert = (
  bookings: Booking[],
  rooms: Room[],
  onNewAlert: (alert: AppNotification) => void,
  notificationSettings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
) => {
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
    audioRef.current = new Audio(DEBT_SOUND_URL);
  }, [notificationSettings]);

  const formatMoney = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount);

  const getRoomNumber = (roomId: string) => {
      const r = rooms.find(room => room.id === roomId);
      return r ? r.number : 'Phòng ?';
  };

  useEffect(() => {
      const checkDebts = () => {
          const settings = settingsRef.current;
          if (!settings.enabled || !settings.debtAlerts.enabled) return;

          const now = new Date();
          const currentHour = now.getHours();
          const currentMin = now.getMinutes();
          const todayStr = now.toLocaleDateString('vi-VN');

          bookings.forEach(b => {
              if (b.status !== BookingStatus.CHECKED_IN) return;

              const debt = b.totalPrice - b.paidAmount;
              if (debt <= 0) return;

              const checkOutTime = new Date(b.checkOutDate);
              const diffMin = (checkOutTime.getTime() - now.getTime()) / 60000;

              if (diffMin > 0 && diffMin <= settings.debtAlerts.minutesBeforeCheckout) {
                  const key = `debt_alert_${b.id}_pre_checkout_${settings.debtAlerts.minutesBeforeCheckout}`;
                  if (!localStorage.getItem(key)) triggerDebtAlert(b, debt, 'PRE_CHECKOUT', key);
              }

              if (settings.debtAlerts.atCheckoutEnabled && Math.abs(diffMin) <= 1) {
                  const key = `debt_alert_${b.id}_at_checkout`;
                  if (!localStorage.getItem(key)) triggerDebtAlert(b, debt, 'AT_CHECKOUT', key);
              }

              if (
                  settings.debtAlerts.dailyReminderEnabled &&
                  currentMin <= 1 &&
                  settings.debtAlerts.dailyHours.includes(currentHour)
              ) {
                  const key = `debt_alert_${b.id}_daily_${currentHour}_${todayStr}`;
                  if (!localStorage.getItem(key)) triggerDebtAlert(b, debt, 'DAILY_REMINDER', key);
              }
          });
      };

      const triggerDebtAlert = (b: Booking, debtAmount: number, type: string, storageKey: string) => {
          const settings = settingsRef.current;
          localStorage.setItem(storageKey, 'triggered');

          const newAlert: AppNotification = {
              id: storageKey + '_' + Date.now(),
              title: 'CẢNH BÁO CÔNG NỢ',
              message: `Phòng ${getRoomNumber(b.roomId)}: Còn thiếu ${formatMoney(debtAmount)}đ (${type === 'PRE_CHECKOUT' ? 'Sắp out' : type === 'AT_CHECKOUT' ? 'Đã out' : 'Định kỳ'})`,
              type: 'DEBT',
              time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
          };

          if (settings.soundEnabled && audioRef.current) {
              audioRef.current.currentTime = 0;
              audioRef.current.play().catch(e => console.log('Audio play blocked:', e));
          }

          const notificationApi = getNotificationApi();
          if (settings.browserEnabled && notificationApi?.permission === 'granted') {
              new notificationApi(newAlert.title, { body: newAlert.message });
          }

          if (settings.inAppEnabled) {
              onNewAlertRef.current(newAlert);
          }
      };

      checkDebts();
      const interval = setInterval(checkDebts, 60000);
      return () => clearInterval(interval);
  }, [bookings, rooms]);
};
