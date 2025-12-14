
import React from 'react';
import { Building2, Bell, UserCircle, RefreshCcw, Menu } from 'lucide-react';
import { User, Property, UserRole } from '../types';

interface HeaderProps {
  user: User;
  properties: Property[];
  currentPropertyId: string;
  onPropertyChange: (id: string) => void;
  onMenuClick?: () => void; // New prop
}

const Header: React.FC<HeaderProps> = ({ user, properties, currentPropertyId, onPropertyChange, onMenuClick }) => {
  // Filter properties allowed for this user
  let allowedProperties = properties;
  if (user.allowedPropertyIds && user.allowedPropertyIds.length > 0) {
      allowedProperties = properties.filter(p => user.allowedPropertyIds!.includes(p.id));
  }

  // Determine label for display
  let displayLabel = 'Đang tải...';
  if (currentPropertyId === 'ALL') {
      displayLabel = 'Toàn bộ chi nhánh';
  } else {
      const prop = allowedProperties.find(p => p.id === currentPropertyId);
      displayLabel = prop ? prop.name : 'Unknown Property';
  }

  return (
    <header className="h-16 bg-white border-b border-gray-200 sticky top-0 z-30 w-full flex items-center justify-between px-3 md:px-6 shadow-sm transition-all duration-300">
      <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
        {/* Mobile Menu Button */}
        <button onClick={onMenuClick} className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            <Menu size={24} />
        </button>

        <div className="flex items-center gap-2 text-gray-600 bg-gray-100 px-2 md:px-3 py-1.5 rounded-md max-w-[200px] md:max-w-none">
          <Building2 size={18} className="flex-shrink-0" />
          {allowedProperties.length > 1 ? (
            <select
              value={currentPropertyId}
              onChange={(e) => onPropertyChange(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-medium text-gray-700 min-w-0 w-full cursor-pointer truncate"
            >
              <option value="ALL" className="font-bold">Toàn bộ chi nhánh ({allowedProperties.length})</option>
              <hr />
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
        <button className="relative text-gray-500 hover:text-blue-600 transition-colors p-1">
          <Bell size={20} />
          <span className="absolute 0 top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
        
        <div className="flex items-center gap-3 pl-3 md:pl-6 border-l border-gray-200">
          <div className="text-right hidden md:block">
            <p className="text-sm font-semibold text-gray-800">{user.fullName}</p>
            <p className="text-xs text-gray-500 capitalize">{user.role}</p>
          </div>
          <div className="w-8 h-8 md:w-9 md:h-9 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
            <UserCircle size={20} className="md:w-6 md:h-6" />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
