import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import RoomMap from './pages/RoomMap';
import Bookings from './pages/Bookings'; 
import Management from './pages/Management';
import Reports from './pages/Reports';
import Performance from './pages/Performance';
import Housekeeping from './pages/Housekeeping'; 
import SuperAdmin from './pages/SuperAdmin'; 
import HistoryPage from './pages/History';
import { DataService } from './services/dataService';
import { User, Room, Booking, Customer, Property, RoomType, UserRole, RoomStatus, BookingStatus, Tag, PERMISSIONS, Tenant, SubscriptionPlan, HistoryLog, RoomPolicyRule } from './types';
import { Lock, Loader2, Users, Bell, X, CheckCircle, Clock, AlertTriangle, Wallet, Sun, Moon, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useBookingAlert, AppNotification } from './hooks/useBookingAlert'; 
import { useDebtAlert } from './hooks/useDebtAlert'; 

type ThemeMode = 'light' | 'dark';

const safeStorageGet = (key: string): string | null => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`localStorage.getItem failed for "${key}"`, error);
    return null;
  }
};

const safeStorageSet = (key: string, value: string) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`localStorage.setItem failed for "${key}"`, error);
  }
};

const safeStorageRemove = (key: string) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`localStorage.removeItem failed for "${key}"`, error);
  }
};

const normalizeStringList = (list?: string[]) =>
  Array.from(new Set((list || []).filter(Boolean))).sort();

const isSameStringList = (left?: string[], right?: string[]) => {
  const a = normalizeStringList(left);
  const b = normalizeStringList(right);
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
};

const App: React.FC = () => {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // --- Multi-Tenant State ---
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [tenantList, setTenantList] = useState<Tenant[]>([]);
  const [planList, setPlanList] = useState<SubscriptionPlan[]>([]); 
  const [systemUsers, setSystemUsers] = useState<User[]>([]); 
  const [isSuperAdminView, setIsSuperAdminView] = useState(false);

  // --- App View State ---
  const [currentPropertyId, setCurrentPropertyId] = useState<string>(''); 
  const [currentPage, setCurrentPage] = useState('dashboard');
  
  // --- Mobile Sidebar State ---
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopSidebarHidden, setIsDesktopSidebarHidden] = useState<boolean>(() => {
    const saved = safeStorageGet('k_host_sidebar_hidden');
    return saved === 'true';
  });
  
  // --- Data State ---
  const [isLoading, setIsLoading] = useState(false); 
  const [dataTick, setDataTick] = useState(0); 
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = safeStorageGet('k_host_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [roomPolicies, setRoomPolicies] = useState<RoomPolicyRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [history, setHistory] = useState<HistoryLog[]>([]);

  // --- NOTIFICATION ENGINE ---
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const loadingFallbackRef = useRef<number | null>(null);
  const userDirectoryHydrationRef = useRef<{ tenantId: string | null; ready: boolean }>({
    tenantId: null,
    ready: false,
  });

  const clearLoadingFallback = useCallback(() => {
    if (loadingFallbackRef.current !== null) {
      window.clearTimeout(loadingFallbackRef.current);
      loadingFallbackRef.current = null;
    }
  }, []);

  const armLoadingFallback = useCallback(() => {
    clearLoadingFallback();
    loadingFallbackRef.current = window.setTimeout(() => {
      setIsLoading(false);
    }, 5000);
  }, [clearLoadingFallback]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    safeStorageSet('k_host_theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    safeStorageSet('k_host_sidebar_hidden', String(isDesktopSidebarHidden));
  }, [isDesktopSidebarHidden]);

  const toggleTheme = () => {
    setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleNewNotification = useCallback((notif: AppNotification) => {
      // 1. Lưu thông báo mới vào lịch sử (isRead = false) và hiển thị Toast (isVisible = true)
      const newNotif = { ...notif, isVisible: true, isRead: false };
      setNotifications(prev => [newNotif, ...prev]);

      // 2. Tự động tắt Toast sau 3 giây (Vẫn giữ lại trong lịch sử cái chuông)
      setTimeout(() => {
          setNotifications(prev => prev.map(n => n.id === newNotif.id ? { ...n, isVisible: false } : n));
      }, 3000);
  }, []);

  useBookingAlert(bookings, handleNewNotification);
  useDebtAlert(bookings, rooms, handleNewNotification);

  const handleMarkAllRead = () => {
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const handleMarkRead = (id: string) => {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const hapticTarget = target.closest('[data-haptic], .katka-primary-btn');
      if (!hapticTarget) return;
      const mode = hapticTarget.getAttribute('data-haptic');
      if (mode === 'medium') navigator.vibrate([12, 10, 12]);
      else navigator.vibrate(8);
    };

    document.addEventListener('click', handleClick, { passive: true });
    return () => document.removeEventListener('click', handleClick);
  }, []);


  // --- INITIALIZATION ---
  useEffect(() => {
    const savedUser = safeStorageGet('k_host_user');
    const savedTenant = safeStorageGet('k_host_tenant');
    
    if (savedUser) {
        try {
            const parsedUser = JSON.parse(savedUser);
            setCurrentUser(parsedUser);
            
            if (parsedUser.tenantId !== 'SYSTEM' && parsedUser.tenantId) {
                initDataService(parsedUser.tenantId);
            } else if (parsedUser.role === UserRole.SUPER_ADMIN) {
                if (savedTenant && savedTenant !== 'SYSTEM') {
                    initDataService(savedTenant);
                } else {
                    initDataService('SYSTEM');
                    setIsSuperAdminView(true);
                }
            }
        } catch (e) {
            safeStorageRemove('k_host_user');
        }
    }
  }, []);

  const initDataService = (tenantId: string) => {
      setIsLoading(true);
      armLoadingFallback();
      setActiveTenantId(tenantId);
      userDirectoryHydrationRef.current = { tenantId, ready: false };
      
      DataService.init(tenantId, () => {
          setDataTick(prev => prev + 1);
          
          if (tenantId === 'SYSTEM') {
              setTenantList(DataService.getTenants());
              setPlanList(DataService.getPlans()); 
              setSystemUsers(DataService.getSystemUsers()); 
              setHistory(DataService.getHistory());
          }
          
          clearLoadingFallback();
          setIsLoading(false);
      });
  };

  useEffect(() => {
    return () => {
      clearLoadingFallback();
    };
  }, [clearLoadingFallback]);

  const clearSession = useCallback((reason?: string) => {
    if (currentUser) {
      try {
        DataService.recordLogout(currentUser, activeTenantId || currentUser.tenantId);
      } catch (e) {
        console.error('recordLogout error', e);
      }
    }
    clearLoadingFallback();
    DataService.setAuditActor(null);
    setCurrentUser(null);
    setLoginUsername('');
    setLoginPassword('');
    setActiveTenantId(null);
    setIsLoading(false);
    setCurrentPage('dashboard');
    setIsSuperAdminView(false);
    userDirectoryHydrationRef.current = { tenantId: null, ready: false };
    safeStorageRemove('k_host_user');
    safeStorageRemove('k_host_tenant');
    if (reason) {
      alert(reason);
    }
  }, [activeTenantId, clearLoadingFallback, currentUser]);

  // --- MAIN DATA REFRESH LOGIC ---
  useEffect(() => {
    if (isLoading || !activeTenantId) return;

    if (activeTenantId === 'SYSTEM') {
        setTenantList(DataService.getTenants());
        setPlanList(DataService.getPlans());
        setSystemUsers(DataService.getSystemUsers());
        setHistory(DataService.getHistory());
        setRoomPolicies([]);
        return;
    }

    const props = DataService.getProperties();
    const allUsers = DataService.getUsers();
    const tenantUsers = allUsers.filter((user) => {
      if (user.tenantId === activeTenantId) return true;
      if (!user.tenantId && currentUser) {
        return user.id === currentUser.id || user.username === currentUser.username;
      }
      return false;
    });
    const hydration = userDirectoryHydrationRef.current;
    if (hydration.tenantId !== activeTenantId) {
      hydration.tenantId = activeTenantId;
      hydration.ready = false;
    }
    if (tenantUsers.length > 0) {
      hydration.ready = true;
    }

    if (currentUser && currentUser.role !== UserRole.SUPER_ADMIN && hydration.ready) {
      // Có thể xảy ra lệch id session tạm thời giữa các trình duyệt/tab mới.
      // Ưu tiên id, fallback theo username cùng tenant để đồng bộ lại session thay vì logout oan.
      const liveUserById = tenantUsers.find((user) => user.id === currentUser.id);
      const liveUserByUsername =
        !liveUserById && currentUser.username
          ? tenantUsers.find(
              (user) =>
                user.username === currentUser.username &&
                user.tenantId === (currentUser.tenantId || activeTenantId)
            )
          : null;

      const liveUser = liveUserById || liveUserByUsername;
      if (!liveUser) {
        clearSession('Tài khoản của bạn không còn khả dụng. Vui lòng đăng nhập lại.');
        return;
      }

      if (liveUserByUsername && liveUserByUsername.id !== currentUser.id) {
        setCurrentUser(liveUserByUsername);
        safeStorageSet('k_host_user', JSON.stringify(liveUserByUsername));
        return;
      }

      const roleChanged = liveUser.role !== currentUser.role;
      const permissionsChanged = !isSameStringList(liveUser.permissions, currentUser.permissions);
      const allowedPropertyChanged = !isSameStringList(liveUser.allowedPropertyIds, currentUser.allowedPropertyIds);

      if (roleChanged || permissionsChanged || allowedPropertyChanged) {
        clearSession('Quyền tài khoản của bạn vừa được quản trị viên cập nhật. Vui lòng đăng nhập lại để áp dụng quyền mới.');
        return;
      }
    }
    
    const allowedIds = currentUser?.allowedPropertyIds || [];
    const hasRestrictions = allowedIds.length > 0;
    const visibleProperties = hasRestrictions ? props.filter((p) => allowedIds.includes(p.id)) : props;

    setProperties(visibleProperties);
    setUsers(tenantUsers);
    setCustomers(DataService.getCustomers());
    setRoomTypes(DataService.getRoomTypes());
    setRoomPolicies(DataService.getRoomPolicies());
    setTags(DataService.getTags());
    setHistory(DataService.getHistory());

    if (visibleProperties.length === 0) {
        setRooms([]);
        setBookings([]);
        return;
    }

    let activePropId = currentPropertyId;

    const isValid =
        activePropId && (activePropId === 'ALL' || visibleProperties.some((p) => p.id === activePropId));
    const isAllowed = !hasRestrictions || (activePropId === 'ALL' ? allowedIds.length > 1 : allowedIds.includes(activePropId));

    if (!isValid || !isAllowed) {
        if (!hasRestrictions) {
            activePropId = 'ALL';
        } else {
            activePropId = allowedIds.length > 1 ? 'ALL' : allowedIds[0];
        }
        if (activePropId !== currentPropertyId) {
            setCurrentPropertyId(activePropId);
            return;
        }
    }

    let allRooms = DataService.getRooms(); 
    let allBookings = DataService.getBookings();

    if (hasRestrictions) {
        allRooms = allRooms.filter(r => allowedIds.includes(r.propertyId));
        allBookings = allBookings.filter(b => allowedIds.includes(b.propertyId));
    }

    if (activePropId && activePropId !== 'ALL') {
       setRooms(allRooms.filter(r => r.propertyId === activePropId));
       setBookings(allBookings.filter(b => b.propertyId === activePropId));
    } else {
       setRooms(allRooms);
       setBookings(allBookings);
    }

  }, [dataTick, currentPropertyId, isLoading, currentUser, activeTenantId, clearSession]);

  // --- SMART AUTOMATION SYSTEM ---
  useEffect(() => {
      if (!currentUser || isLoading || activeTenantId === 'SYSTEM') return;

      const runAutomation = () => {
          const now = new Date();
          DataService.cleanupExpiredHoldBookings({ source: 'SYSTEM' }).catch((error: any) => {
              console.error('Automation cleanup expired hold failed', error);
          });
          const allBookings = DataService.getBookings();
          const allRooms = DataService.getRooms();
          
          const activeBookings = allBookings.filter(b => 
              b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.CHECKED_IN
          );

          activeBookings.forEach(b => {
              const checkIn = new Date(b.checkInDate);
              const checkOut = new Date(b.checkOutDate);
              
              let needsUpdate = false;
              let newStatus = b.status;

              if (b.status === BookingStatus.CONFIRMED && now >= checkIn) {
                  newStatus = BookingStatus.CHECKED_IN;
                  const room = allRooms.find(r => r.id === b.roomId);
                  if (room && room.status !== RoomStatus.OCCUPIED) {
                      DataService.updateRoomStatus(b.roomId, RoomStatus.OCCUPIED, { source: 'SYSTEM', suppressLog: true });
                  }
                  needsUpdate = true;
              }
              else if (b.status === BookingStatus.CHECKED_IN && now >= checkOut) {
                  newStatus = BookingStatus.CHECKED_OUT;
                  const room = allRooms.find(r => r.id === b.roomId);
                  if (room && room.status !== RoomStatus.VACANT_DIRTY) {
                      DataService.updateRoomStatus(b.roomId, RoomStatus.VACANT_DIRTY, { source: 'SYSTEM', suppressLog: true });
                  }
                  needsUpdate = true;
              }

              if (needsUpdate) {
                  const updatedBooking = { ...b, status: newStatus };
                  DataService.updateBooking(updatedBooking, { source: 'SYSTEM' }).catch((error: any) => {
                      console.error('Automation update booking failed', error);
                  });
              }
          });
      };

      runAutomation();
      const intervalId = setInterval(runAutomation, 30000);
      return () => clearInterval(intervalId);
  }, [dataTick, currentUser, isLoading, activeTenantId]); 

  // --- Handlers ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    const loginResult = await DataService.login(loginUsername, loginPassword);
    const foundUser = loginResult?.user || null;

    if (foundUser) {
      setCurrentUser(foundUser);
      safeStorageSet('k_host_user', JSON.stringify(foundUser));
      setCurrentPropertyId('');
      try {
        DataService.recordLogin(foundUser);
      } catch (e) {
        console.error('recordLogin error', e);
      }
      
      if (foundUser.role === UserRole.SUPER_ADMIN) {
          setIsSuperAdminView(true);
          initDataService('SYSTEM');
          setCurrentPage('dashboard');
      } else {
          initDataService(foundUser.tenantId);
          safeStorageSet('k_host_tenant', foundUser.tenantId);
          
          if (foundUser.role === UserRole.HOUSEKEEPING) {
              setCurrentPage('housekeeping');
          } else if (foundUser.permissions && !foundUser.permissions.includes(PERMISSIONS.VIEW_DASHBOARD)) {
              setCurrentPage('room-map');
          } else {
              setCurrentPage('dashboard');
          }
      }

    } else {
      if (loginResult?.reason === 'INVALID_CREDENTIALS') {
        alert('Tên đăng nhập hoặc mật khẩu không đúng!');
      } else {
        alert('Không thể kết nối dữ liệu. Vui lòng kiểm tra Internet và thử lại.');
      }
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    clearSession();
  };

  const manualRefresh = () => setDataTick(t => t + 1);

  const handleAccessTenant = (tenantId: string) => {
      setIsSuperAdminView(false);
      safeStorageSet('k_host_tenant', tenantId);
      initDataService(tenantId);
      setCurrentPage('dashboard');
  };

  const handleExitTenant = () => {
      setIsSuperAdminView(true);
      safeStorageRemove('k_host_tenant');
      initDataService('SYSTEM');
  };

  const handleUpdateRoomStatus = (roomId: string, status: RoomStatus) => {
      DataService.updateRoomStatus(roomId, status);
  };

  const effectiveUser = useMemo(() => {
    if (!currentUser) return null;
    if (currentUser.role === UserRole.SUPER_ADMIN && !isSuperAdminView) {
        return {
            ...currentUser,
            role: UserRole.ADMIN, 
            permissions: Object.values(PERMISSIONS), 
            tenantId: activeTenantId || 'temp_view',
            fullName: `[Super Admin] ${currentUser.fullName}`
        } as User;
    }
    return currentUser;
  }, [currentUser, isSuperAdminView, activeTenantId]);

  useEffect(() => {
    DataService.setAuditActor(effectiveUser);
  }, [effectiveUser]);

  if (isLoading) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center katka-system-bg text-gray-500 gap-4">
              <Loader2 className="animate-spin text-blue-600" size={48} />
              <p className="font-medium">Đang kết nối dữ liệu...</p>
          </div>
      )
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen katka-system-bg flex items-center justify-center p-4">
        <div className="katka-panel w-full max-w-md p-8 animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 katka-primary-btn rounded-xl flex items-center justify-center mb-4 shadow-soft">
              <Lock size={24} />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Đăng nhập hệ thống</h1>
            <p className="text-gray-500">K-Host SaaS Management</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên đăng nhập</label>
              <input 
                type="text" 
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Nhập tên đăng nhập"
                className="w-full px-4 py-3 katka-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                className="w-full px-4 py-3 katka-input"
              />
            </div>
            <button type="submit" data-haptic="medium" className="w-full katka-primary-btn py-3 rounded-lg">
              Đăng nhập
            </button>
          </form>
          
          <div className="mt-6 text-center">
              <p className="text-xs text-gray-400">Hỗ trợ Multi-Tenant Isolation</p>
          </div>
        </div>
      </div>
    );
  }

  if (!effectiveUser) return null;

  const currentPropertyObj = currentPropertyId === 'ALL' 
        ? { id: 'ALL', name: 'Toàn bộ chi nhánh', address: '' } as Property
        : (properties.find(p => p.id === currentPropertyId) || properties[0] || {id:'err', name:'Lỗi tải', address:''} as Property);

  return (
    <div className="min-h-screen katka-app relative">
      
      {/* KHU VỰC HIỂN THỊ THÔNG BÁO NỔI (TOAST) - Tự ẩn sau 3 giây */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {notifications.filter(n => n.isVisible).map(alert => (
              <div key={alert.id} className={`p-4 rounded-xl katka-card flex items-start gap-3 pointer-events-auto animate-fade-in transform transition-all hover:scale-[1.01] ${alert.type === 'DEBT' ? 'bg-red-50 border-l-4 border-red-600' : 'border-l-4 border-blue-600'}`}>
                  <div className={`p-2 rounded-full ${alert.type === 'DEBT' ? 'bg-red-100 text-red-600 animate-pulse' : alert.type === 'CHECK_IN' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                      {alert.type === 'DEBT' ? <Wallet size={20} /> : alert.type === 'CHECK_IN' ? <CheckCircle size={20} /> : <Clock size={20} />}
                  </div>
                  <div className="flex-1">
                      <h4 className={`font-bold text-sm flex items-center gap-1 ${alert.type === 'DEBT' ? 'text-red-800' : 'text-gray-800'}`}>
                          {alert.type === 'DEBT' && <AlertTriangle size={14} />} {alert.title}
                      </h4>
                      <p className={`text-xs mt-1 ${alert.type === 'DEBT' ? 'text-red-700 font-semibold' : 'text-gray-600'}`}>{alert.message}</p>
                      <p className={`text-[10px] mt-1.5 font-medium ${alert.type === 'DEBT' ? 'text-red-500' : 'text-gray-400'}`}>{alert.time}</p>
                  </div>
                  <button onClick={() => setNotifications(prev => prev.map(n => n.id === alert.id ? { ...n, isVisible: false } : n))} className={`p-1 rounded hover:bg-black/5 ${alert.type === 'DEBT' ? 'text-red-400 hover:text-red-600' : 'text-gray-400 hover:text-gray-600'}`}>
                      <X size={16} />
                  </button>
              </div>
          ))}
      </div>

      <Sidebar 
        currentPage={currentPage} 
        onNavigate={(page) => { setCurrentPage(page); setIsMobileMenuOpen(false); }}
        onLogout={handleLogout}
        currentUser={effectiveUser} 
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        isDesktopHidden={isDesktopSidebarHidden}
      />
      
      <div className={`${isDesktopSidebarHidden ? 'md:ml-0' : 'md:ml-64'} min-h-screen flex flex-col transition-all duration-300`}>
        {currentUser.role === UserRole.SUPER_ADMIN && !isSuperAdminView && (
            <div className="katka-glass text-gray-800 px-4 py-2 text-sm flex justify-between items-center sticky top-0 z-50 border-b border-white/50">
                <span className="flex items-center gap-2">
                    <Users size={16} className="text-purple-200" />
                    Bạn đang xem dữ liệu của: <strong>{tenantList.find(t=>t.id===activeTenantId)?.name || activeTenantId}</strong>
                </span>
                <button onClick={handleExitTenant} className="katka-secondary-btn px-3 py-1 rounded text-xs">
                    Thoát ra Platform
                </button>
            </div>
        )}

        {!isSuperAdminView && (
            <Header 
              user={effectiveUser}
              properties={properties}
              currentPropertyId={currentPropertyId}
              onPropertyChange={setCurrentPropertyId}
              onMenuClick={() => setIsMobileMenuOpen(true)}
              notifications={notifications}
              onMarkAllRead={handleMarkAllRead}
              onMarkRead={handleMarkRead}
              themeMode={themeMode}
              onToggleTheme={toggleTheme}
              isSidebarHidden={isDesktopSidebarHidden}
              onToggleSidebar={() => setIsDesktopSidebarHidden((prev) => !prev)}
            />
        )}
        
        {isSuperAdminView && (
             <header className="h-16 katka-glass border-b border-white/60 sticky top-0 z-30 w-full flex items-center justify-between px-3 md:px-6">
                 <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 katka-secondary-btn rounded-lg">
                    <Users size={24} />
                 </button>
                 <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setIsDesktopSidebarHidden((prev) => !prev)}
                      className="hidden md:inline-flex p-2 katka-secondary-btn rounded-lg"
                      title={isDesktopSidebarHidden ? 'Hiện thanh công cụ' : 'Ẩn thanh công cụ'}
                      aria-label={isDesktopSidebarHidden ? 'Hiện thanh công cụ' : 'Ẩn thanh công cụ'}
                      data-haptic="light"
                    >
                      {isDesktopSidebarHidden ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
                    </button>
                    <div className="font-bold text-lg text-purple-700">Platform Owner Console</div>
                 </div>
                 <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="katka-icon-btn"
                      title={themeMode === 'dark' ? 'Chuyển sang Light mode' : 'Chuyển sang Dark mode'}
                      aria-label={themeMode === 'dark' ? 'Chuyển sang Light mode' : 'Chuyển sang Dark mode'}
                      data-haptic="light"
                    >
                      {themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <div className="text-sm font-medium text-gray-600">{currentUser.fullName}</div>
                 </div>
             </header>
        )}

        <main className="flex-1 p-3 md:p-6">
          <div className="max-w-7xl mx-auto h-full">
            
            {isSuperAdminView && (
                 <SuperAdmin 
                    tenants={tenantList} 
                    plans={planList} 
                    systemUsers={systemUsers}
                    onRefresh={manualRefresh} 
                    onAccessTenant={handleAccessTenant}
                 />
            )}

            {!isSuperAdminView && (
                <>
                    {currentPage === 'dashboard' && effectiveUser.permissions?.includes(PERMISSIONS.VIEW_DASHBOARD) && (
                        <Dashboard bookings={bookings} rooms={rooms} />
                    )}
                    
                    {currentPage === 'bookings' && (
                        <Bookings 
                            bookings={bookings}
                            rooms={rooms}
                            roomTypes={roomTypes}
                            properties={properties}
                            tags={tags}
                            users={users}
                            history={history}
                            customers={customers}
                            onRefresh={manualRefresh}
                            currentUser={effectiveUser}
                        />
                    )}

                    {currentPage === 'room-map' && (
                        <RoomMap 
                            rooms={rooms} 
                            roomTypes={roomTypes} 
                            roomPolicies={roomPolicies}
                            bookings={bookings} 
                            history={history}
                            customers={customers}
                            tags={tags}
                            properties={properties}
                            onRefresh={manualRefresh}
                            currentProperty={currentPropertyObj}
                            currentUser={effectiveUser} 
                        />
                    )}

                    {currentPage === 'housekeeping' && (
                        <Housekeeping 
                            rooms={rooms} 
                            bookings={bookings} 
                            roomTypes={roomTypes} 
                            properties={properties}
                            onRefresh={manualRefresh}
                            onUpdateStatus={handleUpdateRoomStatus}
                        />
                    )}

                    {currentPage === 'reports' && effectiveUser.permissions?.includes(PERMISSIONS.VIEW_REPORTS) && (
                        <Reports 
                            bookings={bookings} 
                            rooms={rooms} 
                            users={users} 
                            roomTypes={roomTypes} 
                            properties={properties} 
                            tags={tags}
                            currentUser={effectiveUser} 
                        />
                    )}

                    {currentPage === 'performance' && effectiveUser.permissions?.includes(PERMISSIONS.VIEW_REPORTS) && (
                        <Performance
                            bookings={bookings}
                            rooms={rooms}
                            properties={properties}
                            users={users}
                            history={history}
                            currentUser={effectiveUser}
                        />
                    )}

                    {currentPage === 'history' && (effectiveUser.role === UserRole.ADMIN || effectiveUser.permissions?.includes(PERMISSIONS.VIEW_AUDIT_LOGS)) && (
                        <HistoryPage
                            history={history}
                            users={users}
                            currentUser={effectiveUser}
                        />
                    )}
                    
                    {currentPage === 'management' && effectiveUser.role === UserRole.ADMIN && (
                        <Management 
                            users={users} 
                            rooms={DataService.getRooms()} 
                            roomTypes={roomTypes} 
                            roomPolicies={roomPolicies}
                            properties={properties} 
                            tags={tags}
                            currentUser={effectiveUser}
                            onRefresh={manualRefresh}
                        />
                    )}
                </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
