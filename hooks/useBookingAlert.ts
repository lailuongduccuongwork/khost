
import { useState, useEffect, useRef } from 'react';
import { Booking, BookingStatus } from '../types';

export interface AlertItem {
  id: string;
  title: string;
  message: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  time: string;
}

const SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'; // Tiếng "Ding" nhẹ nhàng

export const useBookingAlert = (bookings: Booking[]) => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  
  // Dùng useRef để lưu danh sách các sự kiện đã thông báo trong phiên làm việc này
  // Format key: "{bookingId}_{type}_{trigger}" (VD: b1_CHECK_IN_5MIN)
  const processedRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // 1. Xin quyền Notification khi mount
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    
    // Init Audio
    audioRef.current = new Audio(SOUND_URL);
  }, []);

  const triggerAlert = (booking: Booking, type: 'CHECK_IN' | 'CHECK_OUT', trigger: '5MIN' | 'NOW') => {
    const key = `${booking.id}_${type}_${trigger}`;
    
    // Cơ chế chống Spam: Nếu đã báo rồi thì bỏ qua
    if (processedRef.current.has(key)) return;

    // --- A. DATA PREPARATION ---
    const title = type === 'CHECK_IN' ? `Sắp có khách đến!` : `Sắp đến giờ trả phòng!`;
    const guestInfo = `${booking.guestName} (${booking.roomId})`; // Cần join Room number nếu có thể, ở đây dùng ID tạm hoặc map ở UI
    const timeInfo = trigger === '5MIN' ? 'còn 5 phút nữa' : 'ngay bây giờ';
    const message = `${guestInfo} - ${type === 'CHECK_IN' ? 'Check-in' : 'Check-out'} ${timeInfo}.`;

    // --- B. ACTIONS ---
    
    // 1. Play Sound
    if (audioRef.current) {
        audioRef.current.play().catch(err => console.warn("Audio play blocked", err));
    }

    // 2. Browser Notification
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '/icon.png' });
    }

    // 3. App Toast State
    const newAlert: AlertItem = {
        id: key,
        title,
        message,
        type,
        time: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})
    };

    setAlerts(prev => [newAlert, ...prev]);
    
    // Đánh dấu đã xử lý
    processedRef.current.add(key);
  };

  useEffect(() => {
    const checkBookings = () => {
        const now = new Date().getTime();
        
        bookings.forEach(b => {
            if (b.status === BookingStatus.DELETED || b.status === BookingStatus.CANCELLED) return;

            // --- CHECK-IN LOGIC (Chỉ áp dụng cho đơn CONFIRMED) ---
            if (b.status === BookingStatus.CONFIRMED) {
                const checkInTime = new Date(b.checkInDate).getTime();
                const diffMin = (checkInTime - now) / 60000;

                // Trước 5 phút (4 < diff <= 5)
                if (diffMin > 4 && diffMin <= 5) {
                    triggerAlert(b, 'CHECK_IN', '5MIN');
                }
                // Đúng giờ (chênh lệch <= 1 phút)
                if (Math.abs(diffMin) <= 1) {
                    triggerAlert(b, 'CHECK_IN', 'NOW');
                }
            }

            // --- CHECK-OUT LOGIC (Chỉ áp dụng cho đơn CHECKED_IN) ---
            if (b.status === BookingStatus.CHECKED_IN) {
                const checkOutTime = new Date(b.checkOutDate).getTime();
                const diffMin = (checkOutTime - now) / 60000;

                // Trước 5 phút
                if (diffMin > 4 && diffMin <= 5) {
                    triggerAlert(b, 'CHECK_OUT', '5MIN');
                }
                // Đúng giờ
                if (Math.abs(diffMin) <= 1) {
                    triggerAlert(b, 'CHECK_OUT', 'NOW');
                }
            }
        });
    };

    // Chạy ngay lần đầu
    checkBookings();

    // Loop mỗi 60 giây
    const interval = setInterval(checkBookings, 60000);

    return () => clearInterval(interval);
  }, [bookings]); // Re-run khi danh sách booking thay đổi

  const removeAlert = (id: string) => {
      setAlerts(prev => prev.filter(a => a.id !== id));
  };

  return { alerts, removeAlert };
};
