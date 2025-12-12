import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import RoomMap from './pages/RoomMap';
import Bookings from './pages/Bookings';
import Admin from './pages/Admin';
import Management from './pages/Management';
import Reports from './pages/Reports';
import { DataService } from './services/dataService';
import { User, Room, Booking, Customer, Property, RoomType, UserRole, RoomStatus, BookingStatus } from './types';
import { Lock } from 'lucide-react';

const App: React.FC = () => {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUsername, setLoginUsername] = useState('');

  // --- App View State ---
  const [currentPropertyId, setCurrentPropertyId] = useState<string>('');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [viewMode, setViewMode] = useState<'RECEPTION' | 'MANAGEMENT'>('RECEPTION');
  
  // --- Data State ---
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Load initial data
  const refreshData = () => {
    setProperties(DataService.getProperties());
    setUsers(DataService.getUsers());
    setCustomers(DataService.getCustomers());
    setRoomTypes(DataService.getRoomTypes());
    
    // Logic: If in Management mode (Admin), might want to see all or filter. 
    // If Reception, stick to property.
    // For simplicity, we filter by property unless explicity needing all.
    const allRooms = DataService.getRooms(); 
    const allBookings = DataService.getBookings();

    if (currentPropertyId) {
       setRooms(allRooms.filter(r => r.propertyId === currentPropertyId));
       setBookings(allBookings.filter(b => b.propertyId === currentPropertyId));
    } else {
       setRooms(allRooms);
       setBookings(allBookings);
    }
  };

  useEffect(() => {
    const props = DataService.getProperties();
    setProperties(props);
    if (props.length > 0 && !currentPropertyId) {
      setCurrentPropertyId(props[0].id);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
       // Force property for non-admins
       if (currentUser.propertyId) {
         setCurrentPropertyId(currentUser.propertyId);
       }
       refreshData();
    }
  }, [currentUser, currentPropertyId]);

  // --- Automation System (Auto Check-in / Check-out) ---
  useEffect(() => {
      if (!currentUser) return;

      const runAutomation = () => {
          const now = new Date();
          const allBookings = DataService.getBookings();
          let hasChanges = false;
          
          const updatedBookings = allBookings.map(b => {
              const checkIn = new Date(b.checkInDate);
              const checkOut = new Date(b.checkOutDate);
              let updated = { ...b };
              let modified = false;

              // 1. Auto Check-in: If CONFIRMED and reached check-in time (now >= checkIn)
              // Note: We remove the "now < checkOut" constraint to ensure late check-ins are processed.
              if (b.status === BookingStatus.CONFIRMED && now >= checkIn) {
                  updated.status = BookingStatus.CHECKED_IN;
                  DataService.updateRoomStatus(b.roomId, RoomStatus.OCCUPIED);
                  DataService.logAction('CHECK_IN', updated, `Hệ thống tự động check-in đơn ${b.id}`, 'SYSTEM');
                  modified = true;
                  hasChanges = true;
              }

              // 2. Auto Check-out: If CHECKED_IN and reached check-out time (now >= checkOut)
              if (b.status === BookingStatus.CHECKED_IN && now >= checkOut) {
                  updated.status = BookingStatus.CHECKED_OUT;
                  DataService.updateRoomStatus(b.roomId, RoomStatus.VACANT_DIRTY);
                  DataService.logAction('CHECK_OUT', updated, `Hệ thống tự động check-out đơn ${b.id}`, 'SYSTEM');
                  modified = true;
                  hasChanges = true;
              }

              return modified ? updated : b;
          });

          if (hasChanges) {
              DataService.saveBookings(updatedBookings);
              refreshData();
          }
      };

      // Run immediately then every 30 seconds
      runAutomation();
      const intervalId = setInterval(runAutomation, 30000);

      return () => clearInterval(intervalId);
  }, [currentUser, currentPropertyId]);


  // --- Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const foundUser = DataService.getUsers().find(u => u.username === loginUsername);
    if (foundUser) {
      setCurrentUser(foundUser);
      // Default to Management view for Admin
      if (foundUser.role === UserRole.ADMIN) setViewMode('MANAGEMENT');
      else setViewMode('RECEPTION');
    } else {
      alert('User not found (Try "admin", "manager_hn", "le_tan")');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setLoginUsername('');
    setViewMode('RECEPTION');
  };

  const handleUpdateRoomStatus = (roomId: string, status: RoomStatus) => {
    DataService.updateRoomStatus(roomId, status);
    refreshData();
  };

  const toggleViewMode = () => {
      setViewMode(prev => prev === 'MANAGEMENT' ? 'RECEPTION' : 'MANAGEMENT');
      // Reset page when switching modes to avoid stuck states
      setCurrentPage('dashboard');
  };

  // --- Login Screen ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-4">
              <Lock size={24} />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Đăng nhập hệ thống</h1>
            <p className="text-gray-500">ezHotel Management</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên đăng nhập</label>
              <input 
                type="text" 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="admin, manager_hn..."
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
              <input 
                type="password" 
                value="123"
                readOnly
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
              Đăng nhập
            </button>
            <div className="text-xs text-center text-gray-400 mt-4">
              Demo accounts: admin, manager_hn, le_tan
            </div>
          </form>
        </div>
      </div>
    );
  }

  // --- Main Layout ---
  const currentPropertyObj = properties.find(p => p.id === currentPropertyId) || properties[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar 
        currentPage={currentPage} 
        onNavigate={setCurrentPage} 
        onLogout={handleLogout}
        role={currentUser.role}
        viewMode={viewMode}
      />
      
      <Header 
        user={currentUser}
        properties={properties}
        currentPropertyId={currentPropertyId}
        onPropertyChange={setCurrentPropertyId}
        viewMode={viewMode}
        onToggleMode={toggleViewMode}
      />

      <main className="ml-64 pt-16 p-6 min-h-screen">
        <div className="max-w-7xl mx-auto h-full">
          {currentPage === 'dashboard' && (
            <Dashboard bookings={bookings} rooms={rooms} />
          )}
          
          {currentPage === 'room-map' && (
            <RoomMap 
              rooms={rooms} 
              roomTypes={roomTypes} 
              bookings={bookings} 
              customers={customers}
              onUpdateStatus={handleUpdateRoomStatus}
              currentProperty={currentPropertyObj}
              onRefresh={refreshData}
              currentUser={currentUser.id}
            />
          )}

          {currentPage === 'bookings' && (
            <Bookings bookings={bookings} rooms={rooms} customers={customers} onRefresh={refreshData} />
          )}

          {currentPage === 'reports' && currentUser.role !== UserRole.RECEPTIONIST && (
              <Reports 
                bookings={bookings} 
                rooms={rooms} 
                users={users} 
                roomTypes={roomTypes} 
                properties={properties} 
              />
          )}
          
          {currentPage === 'management' && viewMode === 'MANAGEMENT' && (
             <div className="space-y-8">
                 <Management 
                    users={users} 
                    rooms={DataService.getRooms()} // Pass all rooms for admin
                    roomTypes={roomTypes} 
                    properties={properties} 
                    onRefresh={refreshData}
                 />
                 <div className="mt-8">
                     <Admin users={users} properties={properties} onRefresh={refreshData} />
                 </div>
             </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;