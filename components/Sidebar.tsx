
import React, { useEffect, useRef } from 'react';
import { LayoutDashboard, BedDouble, BarChart3, LogOut, Briefcase, X, Shield, PaintBucket, List } from 'lucide-react';
import { UserRole, User, PERMISSIONS } from '../types';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  currentUser: User;
  isOpen?: boolean; // New prop for mobile state
  onClose?: () => void; // New prop for closing on mobile
  isDesktopHidden?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, onLogout, currentUser, isOpen, onClose, isDesktopHidden = false }) => {
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const updateVisibility = () => {
      if (!sidebarRef.current) return;
      const hidden = media.matches ? isDesktopHidden : !isOpen;
      sidebarRef.current.inert = hidden;
      sidebarRef.current.setAttribute('aria-hidden', String(hidden));
    };
    updateVisibility();
    media.addEventListener('change', updateVisibility);
    return () => media.removeEventListener('change', updateVisibility);
  }, [isOpen, isDesktopHidden]);

  useEffect(() => {
    if (!isOpen || window.matchMedia('(min-width: 768px)').matches) return;
    const opener = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); }
      if (event.key === 'Tab') {
        const items = (Array.from(sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button') || []) as HTMLButtonElement[]).filter(item => item.getClientRects().length);
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = oldOverflow; if (opener?.isConnected) opener.focus(); };
  }, [isOpen]);

  // 1. Define Operational Menu Items (Always visible based on permissions)
  const operationMenuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard, permission: PERMISSIONS.VIEW_DASHBOARD },
    { id: 'bookings', label: 'Danh sách đơn', icon: List, permission: PERMISSIONS.MANAGE_BOOKINGS }, // Added Bookings List
    { id: 'room-map', label: 'Sơ đồ phòng', icon: BedDouble, permission: PERMISSIONS.MANAGE_ROOMS },
    // NEW: Housekeeping Menu Item
    { id: 'housekeeping', label: 'Buồng phòng', icon: PaintBucket, permission: PERMISSIONS.MANAGE_ROOMS }, 
    { id: 'reports', label: 'Báo cáo', icon: BarChart3, permission: PERMISSIONS.VIEW_REPORTS },
  ];

  // Filter operational items based on permissions
  // IMPORTANT: Super Admin should NOT see these operational items when in System view, 
  // but if they are impersonating (which effectively makes them Admin/Manager of a tenant), they will see them via standard logic.
  // However, `Sidebar` receives `currentUser`. If `currentUser` is SuperAdmin, we show a special menu.
  
  const isSuperAdmin = currentUser.role === UserRole.SUPER_ADMIN;

  const visibleOperationItems = operationMenuItems.filter(item => {
      // FIX: Ensure Room Map is always visible for Manager and Receptionist regardless of specific permissions data state
      if (item.id === 'room-map') {
          return currentUser.permissions?.includes(item.permission) || 
                 currentUser.role === UserRole.MANAGER || 
                 currentUser.role === UserRole.RECEPTIONIST ||
                 currentUser.role === UserRole.ADMIN;
      }
      // Special logic for Housekeeping: Visible for Housekeeping role AND Admin/Managers
      if (item.id === 'housekeeping') {
          return currentUser.role === UserRole.HOUSEKEEPING || 
                 currentUser.role === UserRole.ADMIN || 
                 currentUser.role === UserRole.MANAGER;
      }
      
      // Ensure Bookings List is visible for Admin/Manager/Receptionist if they have the permission (Admin usually has all)
      if (item.id === 'bookings') {
           return currentUser.permissions?.includes(item.permission) || 
                  currentUser.role === UserRole.ADMIN || 
                  currentUser.role === UserRole.MANAGER;
      }

      return currentUser.permissions?.includes(item.permission);
  });

  // Nhân viên chỉ thấy khu vực mật khẩu ra vào khi được cấp quyền riêng.
  const canEditAccessPasswords = currentUser.permissions?.includes(PERMISSIONS.CAN_EDIT_ACCESS_PASSWORDS);
  const showManagement = currentUser.role === UserRole.ADMIN || canEditAccessPasswords;
  const showSystemSection = showManagement;
  
  const managementItem = {
      id: 'management',
      label: currentUser.role === UserRole.ADMIN ? 'Cài đặt hệ thống' : 'Mật khẩu ra vào',
      icon: Briefcase,
  };

  // Mobile overlay click handler
  const handleOverlayClick = (e: React.MouseEvent) => {
      if (onClose) onClose();
  };

  const roleLabel = isSuperAdmin ? 'Platform Owner' : currentUser.role === UserRole.ADMIN ? 'Quản trị viên' : currentUser.role === UserRole.MANAGER ? 'Quản lý' : currentUser.role === UserRole.HOUSEKEEPING ? 'Buồng phòng' : 'Lễ tân';

  return (
    <>
      <div className={`sidebar-overlay fixed inset-0 z-40 md:hidden ${isOpen ? 'is-visible' : ''}`} onClick={handleOverlayClick} aria-hidden="true" />
      <aside ref={sidebarRef} aria-label="Điều hướng chính" className={`app-sidebar fixed left-0 top-0 flex flex-col z-50 transition-transform duration-200 ${isOpen ? 'translate-x-0' : '-translate-x-full'} ${isDesktopHidden ? 'md:-translate-x-full' : 'md:translate-x-0'}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">k<span>•</span></div>
          <div><h1>K-Host</h1><p>Hospitality workspace</p></div>
          <button onClick={onClose} className="md:hidden ml-auto katka-icon-btn" aria-label="Đóng điều hướng"><X size={18} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <p className="nav-section-label">{isSuperAdmin ? 'Nền tảng' : 'Không gian làm việc'}</p>
          {isSuperAdmin ? (
            <button onClick={() => onNavigate('dashboard')} aria-current={currentPage === 'dashboard' ? 'page' : undefined} className={`nav-item ${currentPage === 'dashboard' ? 'is-active' : ''}`}><Shield size={18} /><span>Tổng quan hệ thống</span></button>
          ) : (
            <>
              {visibleOperationItems.map(item => {
                const Icon = item.icon;
                return <button key={item.id} onClick={() => onNavigate(item.id)} aria-current={currentPage === item.id ? 'page' : undefined} className={`nav-item ${currentPage === item.id ? 'is-active' : ''}`}><Icon size={18} strokeWidth={1.7} /><span>{item.label}</span></button>;
              })}
              {showSystemSection && <div className="mt-8"><p className="nav-section-label">Quản trị</p>{showManagement && <button onClick={() => onNavigate(managementItem.id)} aria-current={currentPage === managementItem.id ? 'page' : undefined} className={`nav-item ${currentPage === managementItem.id ? 'is-active' : ''}`}><Briefcase size={18} strokeWidth={1.7} /><span>{managementItem.label}</span></button>}</div>}
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="flex items-center gap-3 px-2 mb-4"><div className="user-avatar">{currentUser.fullName?.slice(0, 1).toUpperCase()}</div><div className="min-w-0"><p className="text-sm font-semibold truncate">{currentUser.fullName}</p><p className="text-xs text-gray-500 mt-0.5">{roleLabel}</p></div></div>
          <button onClick={onLogout} className="nav-item logout-item"><LogOut size={17} strokeWidth={1.7} /><span>Đăng xuất</span></button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
