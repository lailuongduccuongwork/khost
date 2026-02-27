import { useEffect, useRef } from 'react';
import { Booking, BookingStatus, Room } from '../types';
import { AppNotification } from './useBookingAlert';

const DEBT_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3';

export const useDebtAlert = (bookings: Booking[], rooms: Room[], onNewAlert: (alert: AppNotification) => void) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onNewAlertRef = useRef(onNewAlert);

  useEffect(() => {
      onNewAlertRef.current = onNewAlert;
  }, [onNewAlert]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    audioRef.current = new Audio(DEBT_SOUND_URL);
  }, []);

  const formatMoney = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount);

  const getRoomNumber = (roomId: string) => {
      const r = rooms.find(room => room.id === roomId);
      return r ? r.number : 'Phòng ?';
  };

  useEffect(() => {
      const checkDebts = () => {
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

              if (diffMin > 0 && diffMin <= 60) {
                  const key = `debt_alert_${b.id}_pre_checkout`;
                  if (!localStorage.getItem(key)) triggerDebtAlert(b, debt, 'PRE_CHECKOUT', key);
              }

              if (Math.abs(diffMin) <= 1) {
                  const key = `debt_alert_${b.id}_at_checkout`;
                  if (!localStorage.getItem(key)) triggerDebtAlert(b, debt, 'AT_CHECKOUT', key);
              }

              if (currentMin <= 1 && (currentHour === 15 || currentHour === 21)) {
                  const key = `debt_alert_${b.id}_daily_${currentHour}_${todayStr}`;
                  if (!localStorage.getItem(key)) triggerDebtAlert(b, debt, 'DAILY_REMINDER', key);
              }
          });
      };

      const triggerDebtAlert = (b: Booking, debtAmount: number, type: string, storageKey: string) => {
          localStorage.setItem(storageKey, 'triggered');

          const newAlert: AppNotification = {
              id: storageKey + '_' + Date.now(),
              title: 'CẢNH BÁO CÔNG NỢ',
              message: `Phòng ${getRoomNumber(b.roomId)}: Còn thiếu ${formatMoney(debtAmount)}đ (${type === 'PRE_CHECKOUT' ? 'Sắp out' : type === 'AT_CHECKOUT' ? 'Đã out' : 'Định kỳ'})`,
              type: 'DEBT',
              time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
          };

          if (audioRef.current) {
              audioRef.current.currentTime = 0;
              audioRef.current.play().catch(e => console.log('Audio play blocked:', e));
          }

          if (Notification.permission === 'granted') {
              new Notification(newAlert.title, { body: newAlert.message });
          }

          onNewAlertRef.current(newAlert);
      };

      checkDebts();
      const interval = setInterval(checkDebts, 60000);
      return () => clearInterval(interval);
  }, [bookings, rooms]);
};