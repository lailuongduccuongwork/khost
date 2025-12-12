
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
import { Lock, Loader2, CloudOff } from 'lucide-react';

const App: React.FC = () => {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUsername, setLoginUsername] = useState('');

  // --- App View State ---
  const [currentPropertyId, setCurrentPropertyId] = useState<string>('');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [viewMode, setViewMode] = useState<'RECEPTION' | 'MANAGEMENT'>('RECEPTION');
  
  // --- Data State ---
  const [isLoading, setIsLoading] = useState(true); // Loading state for DB connection
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Function to pull latest data from Service (Cache) into React State
  const refreshData = () => {
    setProperties(DataService.getProperties());
    setUsers(DataService.getUsers());
    setCustomers(DataService.getCustomers());
    setRoomTypes(DataService.getRoomTypes());
    
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

  // --- INITIALIZATION ---
  useEffect(() => {
    // Kết nối tới Firebase và lắng nghe thay đổi
    DataService.init(() => {
        // Callback này chạy mỗi khi Firebase có dữ liệu mới
        refreshData();
        setIsLoading(false);
    });
  }, []);

  // Update rooms/bookings when property filter changes
  useEffect(() => {
    if (!isLoading) {
        const props = DataService.getProperties();
        if (props.length > 0 && !currentPropertyId) {
            setCurrentPropertyId(props[0].id);
        } else {
            refreshData();
        }
    }
  }, [currentPropertyId, isLoading]);


  useEffect(() => {
    if (currentUser) {
       if (currentUser.propertyId) {
         setCurrentPropertyId(currentUser.propertyId);
       }
       refreshData();
    }
  }, [currentUser]);

  // --- Automation System (Auto Check-in / Check-out) ---
  useEffect(() => {
      if (!currentUser || isLoading) return;

      const runAutomation = () => {
          const now = new Date();
          const allBookings = DataService.getBookings(); // Read directly from service to ensure latest
          let hasChanges = false;
          
          const updatedBookings = allBookings.map(b => {
              const checkIn = new Date(b.checkInDate);
              const checkOut = new Date(b.checkOutDate);
              let updated = { ...b };
              let modified = false;

              if (b.status === BookingStatus.CONFIRMED && now >= checkIn) {
                  updated.status = BookingStatus.CHECKED_IN;
                  DataService.updateRoomStatus(b.roomId, RoomStatus.OCCUPIED); // This triggers sync
                  modified = true;
                  hasChanges = true;
                  // Log is handled inside dataService manually or we call log here
              }

              if (b.status === BookingStatus.CHECKED_IN && now >= checkOut) {
                  updated.status = BookingStatus.CHECKED_OUT;
                  DataService.updateRoomStatus(b.roomId, RoomStatus.VACANT_DIRTY); // This triggers sync
                  modified = true;
                  hasChanges = true;
              }

              return modified ? updated : b;
          });

          if (hasChanges) {
              // We call saveBookings which pushes to Firebase
              // The Firebase listener will then fire, updating our local state via refreshData()
              DataService.saveBookings(updatedBookings);
          }
      };

      runAutomation();
      const intervalId = setInterval(runAutomation, 30000);

      return () => clearInterval(intervalId);
  }, [currentUser, currentPropertyId, isLoading]);


  // --- Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const foundUser = users.find(u => u.username === loginUsername);
    if (foundUser) {
      setCurrentUser(foundUser);
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
    // No need to call refreshData() manually here, 
    // DataService pushes to Firebase -> Listener Fires -> refreshData() called automatically
  };

  const toggleViewMode = () => {
      setViewMode(prev => prev === 'MANAGEMENT' ? 'RECEPTION' : 'MANAGEMENT');
      setCurrentPage('dashboard');
  };

  // --- Loading Screen ---
  if (isLoading) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500 gap-4">
              <Loader2 className="animate-spin text-blue-600" size={48} />
              <p className="font-medium">Đang kết nối cơ sở dữ liệu đám mây...</p>
              <p className="text-xs text-gray-400 max-w-md text-center">
                Nếu quá lâu, hãy kiểm tra file <code>services/dataService.ts</code> và đảm bảo bạn đã điền Firebase Config Key.
              </p>
          </div>
      )
  }

  // --- Login Screen ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-4">
              <Lock size={24} />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Đăng nhập hệ thống</h1>
            <p className="text-gray-500">K-Host Management</p>
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
              Tài khoản mẫu: admin, manager_hn, le_tan
            </div>
          </form>
          
          {/* Cảnh báo nếu chưa config Firebase */}
          {JSON.stringify(properties).length < 5 && (
             <div className="mt-6 p-3 bg-orange-50 border border-orange-200 rounded-lg flex gap-3 items-start">
                 <CloudOff className="text-orange-500 mt-0.5 flex-shrink-0" size={16} />
                 <div className="text-xs text-orange-700">
                     <strong>Chế độ Offline:</strong> Bạn chưa điền API Key trong file <code>dataService.ts</code>. Dữ liệu sẽ không được đồng bộ giữa các thiết bị.
                 </div>
             </div>
          )}
        </div>
      </div>
    );
  }

  // --- Main Layout ---
  const currentPropertyObj = properties.find(p => p.id === currentPropertyId) || properties[0] || {id:'err', name:'Lỗi tải', address:''};

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
              onRefresh={refreshData} // Now redundant but kept for interface compat
              currentProperty={currentPropertyObj}
              currentUser={currentUser.id}
            />
          )}

          {currentPage === 'bookings' && (
            <Bookings 
              bookings={bookings} 
              rooms={rooms} 
              customers={customers} 
              onRefresh={refreshData} 
              currentUserId={currentUser.id}
            />
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
                    rooms={DataService.getRooms()} 
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
