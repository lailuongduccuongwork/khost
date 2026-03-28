
import React from 'react';
import { LayoutDashboard, BedDouble, CalendarDays, Users, BarChart3, Settings, LogOut, Briefcase, X, Shield, Server, CreditCard, PaintBucket, List, TrendingUp } from 'lucide-react';
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
  // 1. Define Operational Menu Items (Always visible based on permissions)
  const operationMenuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard, permission: PERMISSIONS.VIEW_DASHBOARD },
    { id: 'bookings', label: 'Danh sách đơn', icon: List, permission: PERMISSIONS.MANAGE_BOOKINGS }, // Added Bookings List
    { id: 'room-map', label: 'Sơ đồ phòng', icon: BedDouble, permission: PERMISSIONS.MANAGE_ROOMS },
    // NEW: Housekeeping Menu Item
    { id: 'housekeeping', label: 'Buồng phòng', icon: PaintBucket, permission: PERMISSIONS.MANAGE_ROOMS }, 
    { id: 'performance', label: 'Hiệu suất chốt đơn', icon: TrendingUp, permission: PERMISSIONS.VIEW_REPORTS },
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

      if (item.id === 'performance') {
          return currentUser.permissions?.includes(item.permission) ||
                 currentUser.role === UserRole.ADMIN ||
                 currentUser.role === UserRole.MANAGER;
      }

      return currentUser.permissions?.includes(item.permission);
  });

  // 2. Define Management/System Items (Visible for Admin ONLY)
  // Logic: Only ADMIN can see System Settings. Manager access removed.
  const showManagement = currentUser.role === UserRole.ADMIN;
  const canViewHistory = currentUser.role === UserRole.ADMIN || currentUser.permissions?.includes(PERMISSIONS.VIEW_AUDIT_LOGS);
  const showSystemSection = showManagement || canViewHistory;
  
  const managementItem = { id: 'management', label: 'Cài đặt hệ thống', icon: Briefcase };
  const historyItem = { id: 'history', label: 'Lịch sử thao tác', icon: CalendarDays };

  // Mobile overlay click handler
  const handleOverlayClick = (e: React.MouseEvent) => {
      if (onClose) onClose();
  };

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/35 backdrop-blur-[2px] z-40 md:hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={handleOverlayClick}
      ></div>

      {/* Sidebar Content */}
      <div 
        className={`w-64 katka-glass text-gray-800 h-screen fixed left-0 top-0 flex flex-col border-r border-white/50 shadow-soft z-50 transition-transform duration-300 transform 
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} ${isDesktopHidden ? 'md:-translate-x-full' : 'md:translate-x-0'}`}
      >
        <div className="p-6 border-b border-white/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg text-white ${isSuperAdmin ? 'bg-purple-600' : 'bg-blue-600'}`}>
              K
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">K-Host</h1>
              <p className="text-xs text-gray-500 capitalize">
                {isSuperAdmin ? 'Platform Owner' : (currentUser.role === 'ADMIN' ? 'Quản trị viên' : (currentUser.role === 'MANAGER' ? 'Quản lý' : (currentUser.role === 'HOUSEKEEPING' ? 'Buồng phòng' : 'Lễ tân')))}
              </p>
            </div>
          </div>
          {/* Close button for mobile */}
          <button onClick={onClose} className="md:hidden text-gray-500 hover:text-gray-900">
              <X size={24} />
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          
          {/* SUPER ADMIN MENU */}
          {isSuperAdmin ? (
              <>
                <div className="px-4 text-xs font-bold text-purple-500 uppercase tracking-wider mb-2">Platform Admin</div>
                <button
                    onClick={() => onNavigate('dashboard')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                    currentPage === 'dashboard'
                        ? 'bg-purple-600 text-white shadow-soft'
                        : 'text-gray-700 hover:bg-purple-50'
                    }`}
                >
                    <Shield size={20} />
                    <span className="font-medium">Tổng quan hệ thống</span>
                </button>
                {/* Note: In SuperAdmin.tsx, tabs are internal, but we map 'dashboard' to the component entry */}
              </>
          ) : (
             /* STANDARD TENANT MENU */
             <>
                {visibleOperationItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.id;
                    return (
                    <button
                        key={item.id}
                        onClick={() => onNavigate(item.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                        isActive 
                            ? 'bg-blue-600 text-white shadow-soft'
                            : 'text-gray-700 hover:bg-blue-50'
                        }`}
                    >
                        <Icon size={20} />
                        <span className="font-medium">{item.label}</span>
                    </button>
                    );
                })}

                {/* Management Items Separator */}
                {showSystemSection && (
                    <>
                    <div className="my-4 border-t border-gray-200 mx-2"></div>
                    <div className="px-4 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Hệ thống</div>
                    {showManagement && (
                      <button
                          key={managementItem.id}
                          onClick={() => onNavigate(managementItem.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                          currentPage === managementItem.id
                              ? 'bg-orange-600 text-white shadow-soft'
                              : 'text-gray-700 hover:bg-orange-50'
                          }`}
                      >
                          <Briefcase size={20} />
                          <span className="font-medium">{managementItem.label}</span>
                      </button>
                    )}
                    {canViewHistory && (
                      <button
                          key={historyItem.id}
                          onClick={() => onNavigate(historyItem.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                          currentPage === historyItem.id
                              ? 'bg-emerald-600 text-white shadow-soft'
                              : 'text-gray-700 katka-history-nav-hover'
                          }`}
                      >
                          <CalendarDays size={20} />
                          <span className="font-medium">{historyItem.label}</span>
                      </button>
                    )}
                    </>
                )}
             </>
          )}

        </nav>

        <div className="p-4 border-t border-gray-200">
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mt-2"
          >
            <LogOut size={20} />
            <span className="font-medium">Đăng xuất</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
