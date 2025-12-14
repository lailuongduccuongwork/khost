
import React from 'react';
import { LayoutDashboard, BedDouble, CalendarDays, Users, BarChart3, Settings, LogOut, Briefcase, X } from 'lucide-react';
import { UserRole, User, PERMISSIONS } from '../types';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  currentUser: User;
  isOpen?: boolean; // New prop for mobile state
  onClose?: () => void; // New prop for closing on mobile
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, onLogout, currentUser, isOpen, onClose }) => {
  // 1. Define Operational Menu Items (Always visible based on permissions)
  const operationMenuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard, permission: PERMISSIONS.VIEW_DASHBOARD },
    { id: 'room-map', label: 'Sơ đồ phòng', icon: BedDouble, permission: PERMISSIONS.MANAGE_ROOMS },
    { id: 'reports', label: 'Báo cáo', icon: BarChart3, permission: PERMISSIONS.VIEW_REPORTS },
  ];

  // Filter operational items based on permissions
  const visibleOperationItems = operationMenuItems.filter(item => {
      // FIX: Ensure Room Map is always visible for Manager and Receptionist regardless of specific permissions data state
      if (item.id === 'room-map') {
          return currentUser.permissions?.includes(item.permission) || 
                 currentUser.role === UserRole.MANAGER || 
                 currentUser.role === UserRole.RECEPTIONIST ||
                 currentUser.role === UserRole.ADMIN;
      }
      return currentUser.permissions?.includes(item.permission);
  });

  // 2. Define Management/System Items (Visible for Admin ONLY)
  // Logic: Only ADMIN can see System Settings. Manager access removed.
  const showManagement = currentUser.role === UserRole.ADMIN;
  
  const managementItem = { id: 'management', label: 'Cài đặt hệ thống', icon: Briefcase };

  // Mobile overlay click handler
  const handleOverlayClick = (e: React.MouseEvent) => {
      if (onClose) onClose();
  };

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={handleOverlayClick}
      ></div>

      {/* Sidebar Content */}
      <div 
        className={`w-64 bg-slate-900 text-white h-screen fixed left-0 top-0 flex flex-col shadow-xl z-50 transition-transform duration-300 transform 
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg bg-blue-500">
              K
            </div>
            <div>
              <h1 className="text-xl font-bold">K-Host</h1>
              <p className="text-xs text-slate-400 capitalize">{currentUser.role === 'ADMIN' ? 'Quản trị viên' : (currentUser.role === 'MANAGER' ? 'Quản lý' : 'Lễ tân')}</p>
            </div>
          </div>
          {/* Close button for mobile */}
          <button onClick={onClose} className="md:hidden text-slate-400 hover:text-white">
              <X size={24} />
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {/* Operational Items (Always Present based on Permissions) */}
          {visibleOperationItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' 
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}

          {/* Management Items Separator */}
          {showManagement && (
            <>
              <div className="my-4 border-t border-slate-700/50 mx-2"></div>
              <div className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Hệ thống</div>
              <button
                key={managementItem.id}
                onClick={() => onNavigate(managementItem.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                  currentPage === managementItem.id
                    ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/50' 
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Briefcase size={20} />
                <span className="font-medium">{managementItem.label}</span>
              </button>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors mt-2"
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
