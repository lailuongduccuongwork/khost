import React from 'react';
import { LayoutDashboard, BedDouble, CalendarDays, Users, BarChart3, Settings, LogOut, Briefcase } from 'lucide-react';
import { UserRole } from '../types';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  role: UserRole;
  viewMode: 'RECEPTION' | 'MANAGEMENT';
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, onLogout, role, viewMode }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'room-map', label: 'Sơ đồ phòng', icon: BedDouble },
    { id: 'bookings', label: 'Đặt phòng', icon: CalendarDays },
  ];

  // Only show reports if NOT receptionist
  if (role !== UserRole.RECEPTIONIST) {
    menuItems.push({ id: 'reports', label: 'Báo cáo', icon: BarChart3 });
  }

  // Management items
  if (viewMode === 'MANAGEMENT') {
     menuItems.push({ id: 'management', label: 'Cài đặt hệ thống', icon: Briefcase });
  }

  return (
    <div className="w-64 bg-slate-900 text-white h-screen fixed left-0 top-0 flex flex-col shadow-xl z-50">
      <div className="p-6 border-b border-slate-700 flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg ${viewMode === 'MANAGEMENT' ? 'bg-orange-500' : 'bg-blue-500'}`}>
          e
        </div>
        <div>
          <h1 className="text-xl font-bold">ezHotel</h1>
          <p className="text-xs text-slate-400">{viewMode === 'MANAGEMENT' ? 'Quản lý' : 'Lễ tân'}</p>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive 
                  ? (viewMode === 'MANAGEMENT' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') 
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={20} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
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
  );
};

export default Sidebar;