
import { useState, useEffect, useRef } from 'react';
import { Booking, BookingStatus, Room } from '../types';

export interface DebtAlertItem {
  id: string;
  bookingId: string;
  guestName: string;
  roomNumber: string;
  debtAmount: number;
  type: 'PRE_CHECKOUT' | 'AT_CHECKOUT' | 'DAILY_REMINDER';
  time: string;
}

// Âm thanh cảnh báo (Tiếng Alert/Warning gắt hơn)
const DEBT_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3';

export const useDebtAlert = (bookings: Booking[], rooms: Room[]) => {
  const [debtAlerts, setDebtAlerts] = useState<DebtAlertItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Xin quyền Notification nếu chưa có
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    // Init Audio
    audioRef.current = new Audio(DEBT_SOUND_URL);
  }, []);

  // Helper: Format tiền
  const formatMoney = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount);

  // Helper: Lấy số phòng từ ID
  const getRoomNumber = (roomId: string) => {
      const r = rooms.find(room => room.id === roomId);
      return r ? r.number : 'Phòng ?';
  };

  // Hàm kích hoạt thông báo
  const triggerDebtAlert = (booking: Booking, debt: number, type: 'PRE_CHECKOUT' | 'AT_CHECKOUT' | 'DAILY_REMINDER', storageKey: string) => {
      // Check lại storage lần cuối để chắc chắn không spam
      if (localStorage.getItem(storageKey)) return;

      const roomNumber = getRoomNumber(booking.roomId);
      const title = "⚠️ CẢNH BÁO CÔNG NỢ";
      const message = `${booking.guestName} - Phòng ${roomNumber} còn thiếu ${formatMoney(debt)}đ. Vui lòng thu ngay!`;

      // 1. Play Sound (Cố gắng phát âm thanh cảnh báo)
      if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(e => console.warn("Audio play blocked:", e));
      }

      // 2. Browser Notification
      if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { 
              body: message, 
              icon: '/icon.png',
              tag: storageKey, // Tag giúp trình duyệt không hiện trùng lặp
              requireInteraction: true // Bắt buộc người dùng tương tác mới tắt (trên Desktop)
          });
      }

      // 3. In-App Toast State
      setDebtAlerts(prev => [{
          id: storageKey,
          bookingId: booking.id,
          guestName: booking.guestName,
          roomNumber: roomNumber,
          debtAmount: debt,
          type,
          time: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})
      }, ...prev]);

      // 4. Lưu Storage đánh dấu đã báo
      localStorage.setItem(storageKey, new Date().toISOString());
  };

  useEffect(() => {
      const checkDebts = () => {
          const now = new Date();
          const nowTime = now.getTime();
          const currentHour = now.getHours();
          const currentMin = now.getMinutes();
          
          // Lấy ngày hiện tại YYYY-MM-DD để làm key cho báo cáo hàng ngày
          const todayStr = now.toISOString().split('T')[0];

          bookings.forEach(b => {
              // 1. Lọc Trạng thái: Chỉ đơn đang hoạt động hoặc vừa xong
              if (![BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT].includes(b.status)) return;
              
              // 2. Lọc Công nợ: Chỉ xét đơn có tiền thiếu > 0
              const debt = b.totalPrice - b.paidAmount;
              if (debt <= 0) return; 

              const checkOutTime = new Date(b.checkOutDate).getTime();
              const diffMin = (checkOutTime - nowTime) / 60000; // Phút

              // --- TRIGGER A: Trước Check-out 15 phút (14 < diff <= 15) ---
              if (diffMin > 14 && diffMin <= 15) {
                  const key = `debt_alert_${b.id}_pre_15m`;
                  if (!localStorage.getItem(key)) {
                      triggerDebtAlert(b, debt, 'PRE_CHECKOUT', key);
                  }
              }

              // --- TRIGGER B: Đúng giờ Check-out (abs(diff) <= 1) ---
              if (Math.abs(diffMin) <= 1) {
                  const key = `debt_alert_${b.id}_at_checkout`;
                  if (!localStorage.getItem(key)) {
                      triggerDebtAlert(b, debt, 'AT_CHECKOUT', key);
                  }
              }

              // --- TRIGGER C: Định kỳ hàng ngày (15:00 và 21:00) ---
              // Dung sai +/- 1 phút (phút 0 hoặc phút 1) để đảm bảo setInterval bắt được
              if (currentMin <= 1) {
                  if (currentHour === 15 || currentHour === 21) {
                      // Key format: debt_alert_{id}_daily_{hour}_{date}
                      // Đảm bảo mỗi khung giờ trong ngày chỉ báo 1 lần duy nhất
                      const key = `debt_alert_${b.id}_daily_${currentHour}_${todayStr}`;
                      
                      if (!localStorage.getItem(key)) {
                          triggerDebtAlert(b, debt, 'DAILY_REMINDER', key);
                      }
                  }
              }
          });
      };

      // Chạy ngay khi mount
      checkDebts();

      // Loop mỗi 60s
      const interval = setInterval(checkDebts, 60000);
      return () => clearInterval(interval);

  }, [bookings, rooms]);

  const removeDebtAlert = (id: string) => {
      setDebtAlerts(prev => prev.filter(a => a.id !== id));
  };

  return { debtAlerts, removeDebtAlert };
};
