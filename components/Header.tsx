
import React from 'react';
import { Building2, Bell, UserCircle, RefreshCcw } from 'lucide-react';
import { User, Property, UserRole } from '../types';

interface HeaderProps {
  user: User;
  properties: Property[];
  currentPropertyId: string;
  onPropertyChange: (id: string) => void;
  viewMode: 'RECEPTION' | 'MANAGEMENT';
  onToggleMode: () => void;
}

const Header: React.FC<HeaderProps> = ({ user, properties, currentPropertyId, onPropertyChange, viewMode, onToggleMode }) => {
  const canSwitchMode = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;

  // Filter properties allowed for this user
  // If allowedPropertyIds is undefined or empty, assume all access (typical for Admin)
  // HOWEVER, for Receptionist/Manager, if defined, we filter.
  // Exception: Admin usually has empty list = All. 
  
  let allowedProperties = properties;
  if (user.allowedPropertyIds && user.allowedPropertyIds.length > 0) {
      allowedProperties = properties.filter(p => user.allowedPropertyIds!.includes(p.id));
  }

  // If user has restricted access but not assigned to current property, we need to show something?
  // Ideally, the App.tsx ensures currentPropertyId is valid.

  return (
    <header className="h-16 bg-white border-b border-gray-200 fixed top-0 right-0 left-64 z-40 flex items-center justify-between px-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-gray-600 bg-gray-100 px-3 py-1.5 rounded-md">
          <Building2 size={18} />
          {allowedProperties.length > 1 ? (
            <select
              value={currentPropertyId}
              onChange={(e) => onPropertyChange(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-medium text-gray-700 min-w-[200px]"
            >
              {allowedProperties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-medium text-gray-700">
              {allowedProperties.find(p => p.id === currentPropertyId)?.name || 'Unknown Property'}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-6">
        {canSwitchMode && (
          <button 
            onClick={onToggleMode}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              viewMode === 'MANAGEMENT' 
                ? 'bg-orange-100 text-orange-700 border border-orange-200' 
                : 'bg-blue-100 text-blue-700 border border-blue-200'
            }`}
          >
            <RefreshCcw size={14} />
            {viewMode === 'MANAGEMENT' ? 'Chế độ Quản lý' : 'Chế độ Lễ tân'}
          </button>
        )}

        <button className="relative text-gray-500 hover:text-blue-600 transition-colors">
          <Bell size={20} />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
        
        <div className="flex items-center gap-3 pl-6 border-l border-gray-200">
          <div className="text-right hidden md:block">
            <p className="text-sm font-semibold text-gray-800">{user.fullName}</p>
            <p className="text-xs text-gray-500 capitalize">{user.role}</p>
          </div>
          <div className="w-9 h-9 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
            <UserCircle size={24} />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
