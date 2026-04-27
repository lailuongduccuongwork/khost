import React from 'react';
import { Room, RoomStatus, RoomType, Booking } from '../types';
import { CheckCircle, AlertCircle, User } from 'lucide-react';

interface RoomCardProps {
  room: Room;
  type?: RoomType;
  currentBooking?: Booking;
  customerName?: string;
  onClick: (room: Room) => void;
}

const RoomCard: React.FC<RoomCardProps> = ({ room, type, currentBooking, customerName, onClick }) => {
  const getStatusConfig = (status: RoomStatus) => {
    switch (status) {
      case RoomStatus.VACANT_CLEAN:
        return { color: 'bg-green-100 border-green-300', text: 'text-green-700', icon: CheckCircle, label: 'Sẵn sàng' };
      case RoomStatus.VACANT_DIRTY:
        return { color: 'bg-yellow-100 border-yellow-300', text: 'text-yellow-700', icon: AlertCircle, label: 'Chưa dọn' };
      case RoomStatus.OCCUPIED:
        return { color: 'bg-red-100 border-red-300', text: 'text-red-700', icon: User, label: 'Đang ở' };
      default:
        return { color: 'bg-gray-100 border-gray-200', text: 'text-gray-500', icon: AlertCircle, label: 'Unknown' };
    }
  };

  const config = getStatusConfig(room.status);
  const Icon = config.icon;

  return (
    <div 
      onClick={() => onClick(room)}
      className={`relative h-32 rounded-lg border-2 p-3 flex flex-col justify-between cursor-pointer transition-transform hover:scale-105 hover:shadow-lg ${config.color}`}
    >
      <div className="flex justify-between items-start">
        <span className={`text-2xl font-bold ${config.text}`}>{room.number}</span>
        <Icon size={18} className={config.text} />
      </div>
      
      <div className="text-xs space-y-1">
        <p className="font-semibold text-gray-700 truncate">{type?.name}</p>
        
        {room.status === RoomStatus.OCCUPIED && currentBooking ? (
           <div className="bg-white/50 p-1 rounded backdrop-blur-sm">
             <p className="font-medium text-red-800 truncate">{customerName || 'Khách'}</p>
             <p className="text-red-600 font-mono text-[10px]">
                OUT: {new Date(currentBooking.checkOutDate).toLocaleDateString('vi-VN')}
             </p>
           </div>
        ) : (
          <p className={`${config.text} font-medium`}>{config.label}</p>
        )}
      </div>
    </div>
  );
};

export default RoomCard;
