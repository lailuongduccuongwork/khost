import React, { useState, useRef, useEffect } from 'react';
import { Building2, Bell, Menu, CheckCircle, Clock, Wallet, Check, Sun, Moon, PanelLeftClose, PanelLeftOpen, ChevronDown } from 'lucide-react';
import { User, Property } from '../types';
import { AppNotification } from '../hooks/useBookingAlert';

interface HeaderProps {
  user: User;
  properties: Property[];
  selectedPropertyIds: string[];
  onPropertyChange: (ids: string[]) => void;
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
  selectedPropertyIds,
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
  const [showProperties, setShowProperties] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const propertyRef = useRef<HTMLDivElement>(null);

  // Filter properties allowed for this user
  let allowedProperties = properties;
  if (user.allowedPropertyIds && user.allowedPropertyIds.length > 0) {
      allowedProperties = properties.filter(p => user.allowedPropertyIds!.includes(p.id));
  }

  const allowedPropertyIds = allowedProperties.map(property => property.id);
  const selectedIds = selectedPropertyIds.filter(id => allowedPropertyIds.includes(id));
  const allSelected = allowedProperties.length > 0 && selectedIds.length === allowedProperties.length;
  const displayLabel = allSelected
      ? `Toàn bộ chi nhánh (${allowedProperties.length})`
      : selectedIds.length === 1
          ? allowedProperties.find(property => property.id === selectedIds[0])?.name || 'Chi nhánh hiện tại'
          : selectedIds.length > 1
              ? `${selectedIds.length} chi nhánh`
              : 'Đang tải...';

  const toggleProperty = (propertyId: string) => {
      if (selectedIds.includes(propertyId)) {
          if (selectedIds.length === 1) return;
          onPropertyChange(selectedIds.filter(id => id !== propertyId));
          return;
      }
      onPropertyChange([...selectedIds, propertyId]);
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Ẩn bảng thông báo khi click ra ngoài
  useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
          if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
              setShowNotif(false);
          }
          if (propertyRef.current && !propertyRef.current.contains(e.target as Node)) {
              setShowProperties(false);
          }
      };
      const handleEscape = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          setShowNotif(false);
          setShowProperties(false);
      };
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleEscape); };
  }, []);

  return (
    <header className="app-header khost-safe-top-header sticky top-0 z-30 w-full flex items-center justify-between px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-2 overflow-visible md:gap-4">
        <button aria-label="Mở điều hướng" onClick={onMenuClick} className="md:hidden p-2 katka-secondary-btn rounded-lg shrink-0">
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
          {isSidebarHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>

        <Building2 size={18} strokeWidth={1.6} className="text-gray-400 shrink-0 hidden sm:block" />
        <div className="flex flex-col justify-center min-w-0">
          <p className="text-[11px] font-medium text-gray-400 hidden sm:block mb-0.5">Không gian hiện tại</p>
          {allowedProperties.length > 1 ? (
            <div className="relative min-w-0" ref={propertyRef}>
              <button
                type="button"
                aria-label="Chọn chi nhánh"
                aria-haspopup="listbox"
                aria-expanded={showProperties}
                onClick={() => setShowProperties(value => !value)}
                className="property-select flex max-w-[220px] items-center gap-1.5 bg-transparent border-none outline-none text-sm font-medium text-gray-700 min-w-0 w-full cursor-pointer"
              >
                <span className="truncate">{displayLabel}</span>
                <ChevronDown size={14} className={`shrink-0 transition-transform ${showProperties ? 'rotate-180' : ''}`} />
              </button>
              {showProperties && (
                <div className="property-multiselect absolute left-0 top-full z-50 mt-3 min-w-[260px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl" role="listbox" aria-multiselectable="true">
                  <button
                    type="button"
                    role="option"
                    aria-selected={allSelected}
                    onClick={() => onPropertyChange(allowedPropertyIds)}
                    className="property-option w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-semibold border-b border-gray-100"
                  >
                    <span className={`property-check ${allSelected ? 'is-selected' : ''}`}><Check size={13} /></span>
                    <span className="flex-1">Toàn bộ chi nhánh</span>
                    <span className="text-xs text-gray-400">{allowedProperties.length}</span>
                  </button>
                  <div className="max-h-72 overflow-y-auto p-1.5">
                    {allowedProperties.map(property => {
                      const checked = selectedIds.includes(property.id);
                      return (
                        <button
                          type="button"
                          key={property.id}
                          role="option"
                          aria-selected={checked}
                          onClick={() => toggleProperty(property.id)}
                          className="property-option w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm"
                        >
                          <span className={`property-check ${checked ? 'is-selected' : ''}`}><Check size={13} /></span>
                          <span className="truncate">{property.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
                    Đã chọn {selectedIds.length}/{allowedProperties.length} chi nhánh
                  </div>
                </div>
              )}
            </div>
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
            <button aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ""}`} aria-expanded={showNotif} onClick={() => setShowNotif(!showNotif)} className="relative katka-icon-btn">
              <Bell size={20} />
              {unreadCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full border-2 border-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            
            {showNotif && (
                <div className="notification-popover absolute right-0 mt-3 w-80 sm:w-96 katka-panel z-50 overflow-hidden animate-fade-in">
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
            <p className="text-xs text-gray-500">{({ ADMIN: 'Quản trị viên', MANAGER: 'Quản lý', RECEPTIONIST: 'Lễ tân', HOUSEKEEPING: 'Buồng phòng', SUPER_ADMIN: 'Platform Owner' } as Record<string, string>)[user.role] || user.role}</p>
          </div>
          <div className="w-8 h-8 md:w-9 md:h-9 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 border border-gray-200 shrink-0">
            <span className="text-xs font-semibold">{user.fullName?.slice(0, 1).toUpperCase()}</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
