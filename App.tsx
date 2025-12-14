
import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import RoomMap from './pages/RoomMap';
import Bookings from './pages/Bookings';
import Admin from './pages/Admin';
import Management from './pages/Management';
import Reports from './pages/Reports';
import { DataService } from './services/dataService';
import { User, Room, Booking, Customer, Property, RoomType, UserRole, RoomStatus, BookingStatus, Tag, PERMISSIONS } from './types';
import { Lock, Loader2, CloudOff } from 'lucide-react';

const App: React.FC = () => {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // --- App View State ---
  const [currentPropertyId, setCurrentPropertyId] = useState<string>(''); // Can be 'ALL'
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [viewMode, setViewMode] = useState<'RECEPTION' | 'MANAGEMENT'>('RECEPTION');
  
  // --- Data State ---
  const [isLoading, setIsLoading] = useState(true);
  const [dataTick, setDataTick] = useState(0); // Signal to refresh data with latest state
  
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  // --- INITIALIZATION ---
  useEffect(() => {
    // 1. Restore Login Session
    const savedUser = localStorage.getItem('k_host_user');
    if (savedUser) {
        try {
            const parsedUser = JSON.parse(savedUser);
            // We'll verify against DB users later, but set initial state now
            setCurrentUser(parsedUser);
            if (parsedUser.role === UserRole.ADMIN) setViewMode('MANAGEMENT');
            
            // Set default page based on role/permissions logic
            // If they don't have dashboard access, default to Room Map
            if (parsedUser.permissions && !parsedUser.permissions.includes(PERMISSIONS.VIEW_DASHBOARD)) {
                setCurrentPage('room-map');
            }
        } catch (e) {
            localStorage.removeItem('k_host_user');
        }
    }

    // 2. Connect Firebase
    DataService.init(() => {
        setDataTick(prev => prev + 1);
        setIsLoading(false);
    });
  }, []);

  // --- MAIN DATA REFRESH LOGIC ---
  useEffect(() => {
    if (isLoading) return;

    // 1. Sync Static Data
    const props = DataService.getProperties();
    const allUsers = DataService.getUsers();
    
    setProperties(props);
    setUsers(allUsers);
    setCustomers(DataService.getCustomers());
    setRoomTypes(DataService.getRoomTypes());
    setTags(DataService.getTags());

    // 2. Validate/Refresh Current User from DB Source
    if (currentUser) {
        const freshUser = allUsers.find(u => u.id === currentUser.id);
        if (freshUser && JSON.stringify(freshUser) !== JSON.stringify(currentUser)) {
             // Update session silently if permissions/roles changed in DB
             setCurrentUser(freshUser);
             localStorage.setItem('k_host_user', JSON.stringify(freshUser));
             
             // Security check: If current page is forbidden, redirect
             const perms = freshUser.permissions || [];
             if (currentPage === 'dashboard' && !perms.includes(PERMISSIONS.VIEW_DASHBOARD)) setCurrentPage('room-map');
             if (currentPage === 'bookings' && !perms.includes(PERMISSIONS.MANAGE_BOOKINGS)) setCurrentPage('room-map');
             if (currentPage === 'reports' && !perms.includes(PERMISSIONS.VIEW_REPORTS)) setCurrentPage('room-map');
        }
    }

    // 3. Determine Effective Property ID
    let activePropId = currentPropertyId;
    
    // Check Permissions
    const allowedIds = currentUser?.allowedPropertyIds || [];
    const hasRestrictions = allowedIds.length > 0;

    // Validate activePropId
    const isValid = activePropId && (activePropId === 'ALL' || props.some(p => p.id === activePropId));
    const isAllowed = !hasRestrictions || (activePropId === 'ALL' ? allowedIds.length > 1 : allowedIds.includes(activePropId));

    // If invalid or not allowed, reset to sensible default
    if (!isValid || !isAllowed) {
        if (!hasRestrictions) {
            activePropId = 'ALL';
        } else {
            // If restricted, default to ALL (if multiple allowed) or the single allowed ID
            activePropId = allowedIds.length > 1 ? 'ALL' : allowedIds[0];
        }
        // Only update state if different to prevent loops
        if (activePropId !== currentPropertyId) {
            setCurrentPropertyId(activePropId);
            return; // The state change will trigger this effect again
        }
    }

    // 4. Get & Filter Dynamic Data (Rooms, Bookings)
    let allRooms = DataService.getRooms(); 
    let allBookings = DataService.getBookings();

    // 4a. Security Filter (Permission based)
    if (hasRestrictions) {
        allRooms = allRooms.filter(r => allowedIds.includes(r.propertyId));
        allBookings = allBookings.filter(b => allowedIds.includes(b.propertyId));
    }

    // 4b. View Filter (Selection based)
    if (activePropId && activePropId !== 'ALL') {
       setRooms(allRooms.filter(r => r.propertyId === activePropId));
       setBookings(allBookings.filter(b => b.propertyId === activePropId));
    } else {
       setRooms(allRooms);
       setBookings(allBookings);
    }

  }, [dataTick, currentPropertyId, isLoading, currentUser?.id]);


  // --- Automation System (Auto Check-in / Check-out) ---
  useEffect(() => {
      if (!currentUser || isLoading) return;

      const runAutomation = () => {
          const now = new Date();
          const allBookings = DataService.getBookings();
          let hasChanges = false;
          
          const updatedBookings = allBookings.map(b => {
              const checkIn = new Date(b.checkInDate);
              const checkOut = new Date(b.checkOutDate);
              let updated = { ...b };
              let modified = false;

              if (b.status === BookingStatus.CONFIRMED && now >= checkIn) {
                  updated.status = BookingStatus.CHECKED_IN;
                  DataService.updateRoomStatus(b.roomId, RoomStatus.OCCUPIED);
                  modified = true;
                  hasChanges = true;
              }

              if (b.status === BookingStatus.CHECKED_IN && now >= checkOut) {
                  updated.status = BookingStatus.CHECKED_OUT;
                  DataService.updateRoomStatus(b.roomId, RoomStatus.VACANT_DIRTY);
                  modified = true;
                  hasChanges = true;
              }

              return modified ? updated : b;
          });

          if (hasChanges) {
              DataService.saveBookings(updatedBookings);
          }
      };

      runAutomation();
      const intervalId = setInterval(runAutomation, 30000);

      return () => clearInterval(intervalId);
  }, [currentUser, isLoading]);


  // --- Handlers ---
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    let foundUser = users.find(u => u.username === loginUsername && u.password === loginPassword);
    
    // Recovery Logic
    if (!foundUser && loginUsername === 'admin' && loginPassword === '000') {
        const dbAdmin = users.find(u => u.username === 'admin');
        if (dbAdmin) {
            const updatedAdmin = { ...dbAdmin, password: '000' };
            DataService.updateUser(updatedAdmin);
            foundUser = updatedAdmin;
        }
    }

    if (foundUser) {
      setCurrentUser(foundUser);
      localStorage.setItem('k_host_user', JSON.stringify(foundUser));
      if (foundUser.role === UserRole.ADMIN) setViewMode('MANAGEMENT');
      else setViewMode('RECEPTION');
      
      setCurrentPropertyId(''); // Reset to trigger validation logic
      
      // Smart Default Page
      if (foundUser.permissions && !foundUser.permissions.includes(PERMISSIONS.VIEW_DASHBOARD)) {
          setCurrentPage('room-map');
      } else {
          setCurrentPage('dashboard');
      }

    } else {
      alert('Tên đăng nhập hoặc mật khẩu không đúng!');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setLoginUsername('');
    setLoginPassword('');
    setViewMode('RECEPTION');
    setCurrentPage('dashboard');
    localStorage.removeItem('k_host_user');
  };

  const handleUpdateRoomStatus = (roomId: string, status: RoomStatus) => {
    DataService.updateRoomStatus(roomId, status);
  };

  const toggleViewMode = () => {
      setViewMode(prev => prev === 'MANAGEMENT' ? 'RECEPTION' : 'MANAGEMENT');
      setCurrentPage('dashboard');
  };

  const manualRefresh = () => setDataTick(t => t + 1);

  // --- Loading Screen ---
  if (isLoading) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500 gap-4">
              <Loader2 className="animate-spin text-blue-600" size={48} />
              <p className="font-medium">Đang kết nối cơ sở dữ liệu đám mây...</p>
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
                placeholder="Nhập tên đăng nhập"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
              Đăng nhập
            </button>
          </form>
          
          {JSON.stringify(properties).length < 5 && (
             <div className="mt-6 p-3 bg-orange-50 border border-orange-200 rounded-lg flex gap-3 items-start">
                 <CloudOff className="text-orange-500 mt-0.5 flex-shrink-0" size={16} />
                 <div className="text-xs text-orange-700">
                     <strong>Chế độ Offline:</strong> Database chưa sẵn sàng.
                 </div>
             </div>
          )}
        </div>
      </div>
    );
  }

  // --- Main Layout ---
  const currentPropertyObj = currentPropertyId === 'ALL' 
        ? { id: 'ALL', name: 'Toàn bộ chi nhánh', address: '' }
        : (properties.find(p => p.id === currentPropertyId) || properties[0] || {id:'err', name:'Lỗi tải', address:''});

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar 
        currentPage={currentPage} 
        onNavigate={setCurrentPage} 
        onLogout={handleLogout}
        currentUser={currentUser}
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
          {currentPage === 'dashboard' && currentUser.permissions?.includes(PERMISSIONS.VIEW_DASHBOARD) && (
            <Dashboard bookings={bookings} rooms={rooms} />
          )}
          
          {currentPage === 'room-map' && (
            <RoomMap 
              rooms={rooms} 
              roomTypes={roomTypes} 
              bookings={bookings} 
              customers={customers}
              tags={tags}
              onUpdateStatus={handleUpdateRoomStatus}
              onRefresh={manualRefresh}
              currentProperty={currentPropertyObj}
              currentUser={currentUser} // Pass full user object
            />
          )}

          {currentPage === 'bookings' && currentUser.permissions?.includes(PERMISSIONS.MANAGE_BOOKINGS) && (
            <Bookings 
              bookings={bookings} 
              rooms={rooms} 
              customers={customers} 
              onRefresh={manualRefresh}
              currentUser={currentUser} // Pass full user object
            />
          )}

          {currentPage === 'reports' && currentUser.permissions?.includes(PERMISSIONS.VIEW_REPORTS) && (
              <Reports 
                bookings={bookings} 
                rooms={rooms} 
                users={users} 
                roomTypes={roomTypes} 
                properties={properties} 
                tags={tags}
                currentUser={currentUser} // Pass full user object
              />
          )}
          
          {currentPage === 'management' && viewMode === 'MANAGEMENT' && (
             <div className="space-y-8">
                 <Management 
                    users={users} 
                    rooms={DataService.getRooms()} 
                    roomTypes={roomTypes} 
                    properties={properties} 
                    tags={tags}
                    onRefresh={manualRefresh}
                 />
                 <div className="mt-8">
                     <Admin users={users} properties={properties} onRefresh={manualRefresh} />
                 </div>
             </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
