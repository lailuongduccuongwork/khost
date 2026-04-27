import React, { useState, useRef, useEffect } from 'react';
import { Building2, Bell, UserCircle, Menu, CheckCircle, Clock, Wallet, Check, Sun, Moon, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { User, Property } from '../types';
import { AppNotification } from '../hooks/useBookingAlert';

interface HeaderProps {
  user: User;
  properties: Property[];
  currentPropertyId: string;
  allowAllSelection?: boolean;
  onPropertyChange: (id: string) => void;
  onMenuClick?: () => void;
  notifications?: AppNotification[];
  onMarkAllRead?: () => void;
  onMarkRead?: (id: string) => void;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  isSidebarHidden?: boolean;
  onToggleSidebar?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  user,
  properties,
  currentPropertyId,
  allowAllSelection = true,
  onPropertyChange,
  onMenuClick,
  notifications = [],
  onMarkAllRead,
  onMarkRead,
  themeMode,
  onToggleTheme,
  isSidebarHidden = false,
  onToggleSidebar,
}) => {
  const [showNotif, setShowNotif] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Filter properties allowed for this user
  let allowedProperties = properties;
  if (user.allowedPropertyIds && user.allowedPropertyIds.length > 0) {
      allowedProperties = properties.filter(p => user.allowedPropertyIds!.includes(p.id));
  }

  let displayLabel = 'Đang tải...';
  if (currentPropertyId === 'ALL') {
      displayLabel = 'Toàn bộ chi nhánh';
  } else {
      const prop = allowedProperties.find(p => p.id === currentPropertyId);
      displayLabel = prop ? prop.name : 'Unknown Property';
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Ẩn bảng thông báo khi click ra ngoài
  useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
          if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
              setShowNotif(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-16 katka-glass katka-liquid-shell border-b border-white/60 sticky top-0 z-30 w-full flex items-center justify-between px-3 md:px-6 transition-all duration-300">
      <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
        <button onClick={onMenuClick} className="md:hidden p-2 katka-secondary-btn rounded-lg shrink-0">
          <Menu size={24} />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          className="hidden md:inline-flex p-2 katka-secondary-btn rounded-lg shrink-0"
          title={isSidebarHidden ? 'Hiện thanh công cụ' : 'Ẩn thanh công cụ'}
          aria-label={isSidebarHidden ? 'Hiện thanh công cụ' : 'Ẩn thanh công cụ'}
          data-haptic="light"
        >
          {isSidebarHidden ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <div className="w-8 h-8 md:w-10 md:h-10 katka-primary-btn rounded-xl flex items-center justify-center shadow-soft">
            <Building2 size={20} />
          </div>
          <h1 className="text-xl md:text-2xl font-black text-gray-800 tracking-tight hidden sm:block">K-Host</h1>
        </div>
        
        <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>

        <div className="flex flex-col justify-center min-w-0">
          <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider hidden sm:block">Chi nhánh hiện tại</p>
          {allowedProperties.length > 1 ? (
            <select 
              value={currentPropertyId}
              onChange={(e) => onPropertyChange(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-medium text-gray-700 min-w-0 w-full cursor-pointer truncate"
            >
              {allowAllSelection && (
                <option value="ALL" className="font-bold">Toàn bộ chi nhánh ({allowedProperties.length})</option>
              )}
              {allowedProperties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-medium text-gray-700 truncate">
              {displayLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-6">
        <button
          type="button"
          onClick={onToggleTheme}
          className="katka-icon-btn"
          title={themeMode === 'dark' ? 'Chuyển sang Light mode' : 'Chuyển sang Dark mode'}
          aria-label={themeMode === 'dark' ? 'Chuyển sang Light mode' : 'Chuyển sang Dark mode'}
          data-haptic="light"
        >
          {themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        
        {/* TRUNG TÂM THÔNG BÁO (NOTIFICATION BELL) */}
        <div className="relative" ref={notifRef}>
            <button onClick={() => setShowNotif(!showNotif)} className="relative text-gray-500 hover:text-blue-600 transition-colors p-1.5 rounded-lg hover:bg-blue-50">
              <Bell size={20} />
              {unreadCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full border-2 border-white animate-pulse">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            
            {showNotif && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 katka-panel katka-liquid-shell z-50 overflow-hidden animate-fade-in">
                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Bell size={16} className="text-blue-600"/> Thông báo</h3>
                        {unreadCount > 0 && (
                            <button onClick={onMarkAllRead} className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-md transition-colors">
                                <Check size={14}/> Đã đọc tất cả
                            </button>
                        )}
                    </div>
                    <div className="max-h-96 overflow-y-auto no-scrollbar">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
                                <Bell size={32} className="text-gray-200" />
                                Chưa có thông báo nào
                            </div>
                        ) : (
                            notifications.map(notif => (
                                <div 
                                    key={notif.id} 
                                    onClick={() => onMarkRead && onMarkRead(notif.id)}
                                    className={`p-3.5 border-b border-gray-50 hover:bg-gray-50 cursor-pointer flex gap-3.5 transition-colors ${!notif.isRead ? 'bg-blue-50/40' : ''}`}
                                >
                                    <div className={`mt-0.5 shrink-0 p-2 rounded-full h-fit ${notif.type === 'DEBT' ? 'bg-red-100 text-red-600' : notif.type === 'CHECK_IN' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                                        {notif.type === 'DEBT' ? <Wallet size={16} /> : notif.type === 'CHECK_IN' ? <CheckCircle size={16} /> : <Clock size={16} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm ${!notif.isRead ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>{notif.title}</p>
                                        <p className={`text-xs mt-1 break-words line-clamp-2 ${!notif.isRead ? 'text-gray-600' : 'text-gray-500'}`}>{notif.message}</p>
                                        <p className="text-[10px] text-gray-400 mt-1.5 font-medium">{notif.time}</p>
                                    </div>
                                    {!notif.isRead && <div className="w-2.5 h-2.5 rounded-full bg-blue-500 self-center shrink-0 shadow-sm shadow-blue-200"></div>}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
        
        <div className="flex items-center gap-3 pl-3 md:pl-6 border-l border-gray-200">
          <div className="text-right hidden md:block">
            <p className="text-sm font-semibold text-gray-800">{user.fullName}</p>
            <p className="text-xs text-gray-500 capitalize">{user.role}</p>
          </div>
          <div className="w-8 h-8 md:w-9 md:h-9 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 border border-gray-200 shrink-0">
            <UserCircle size={24} />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
