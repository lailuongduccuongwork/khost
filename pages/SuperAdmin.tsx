import DialogFrame from '../components/DialogFrame';

import React, { useState } from 'react';
import { Tenant, SubscriptionPlan, UserRole, User, PERMISSIONS } from '../types';
import { DataService } from '../services/dataService';
import { digestPassword, encodePasswordForView } from '../utils/security';
import { 
  Building2, Users, LayoutDashboard, CreditCard, 
  MoreHorizontal, Plus, Search, Shield, Lock, Unlock, 
  LogIn, Edit3, Trash2, Check, X, Calendar, Server, UserCheck, AlertTriangle
} from 'lucide-react';

interface SuperAdminProps {
  tenants: Tenant[];
  plans: SubscriptionPlan[];
  systemUsers: User[]; // All global users
  onRefresh: () => void;
  onAccessTenant: (tenantId: string) => void;
}

const SuperAdmin: React.FC<SuperAdminProps> = ({ tenants, plans, systemUsers, onRefresh, onAccessTenant }) => {
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'TENANTS' | 'PLANS' | 'ADMINS'>('DASHBOARD');
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [actionModal, setActionModal] = useState<{
      type: 'DELETE' | 'LOCK' | 'UNLOCK' | 'DELETE_ADMIN';
      item: any;
      title: string;
      message: string;
  } | null>(null);
  
  const [editingTenant, setEditingTenant] = useState<Partial<Tenant> | null>(null);
  const [editingPlan, setEditingPlan] = useState<Partial<SubscriptionPlan> | null>(null);

  const stats = {
      totalTenants: tenants.length,
      activeTenants: tenants.filter(t => t.status === 'ACTIVE').length,
      totalPlans: plans.length,
      revenueMock: tenants.reduce((sum, t) => {
          const plan = plans.find(p => p.id === t.planId);
          return sum + (plan?.price || 0);
      }, 0)
  };

  const handleSaveTenant = async () => {
      if (!editingTenant?.name || !editingTenant?.planId) return alert("Vui lòng điền tên và chọn gói cước");
      
      let updatedTenants = [...tenants];
      
      if (editingTenant.id) {
          // Edit
          const idx = updatedTenants.findIndex(t => t.id === editingTenant.id);
          if (idx !== -1) {
              const nextTenant = { ...updatedTenants[idx], ...editingTenant } as Tenant;
              if (editingTenant.adminPassword && editingTenant.adminPassword.trim()) {
                  nextTenant.adminPasswordHash = digestPassword(editingTenant.adminPassword.trim());
                  nextTenant.adminPasswordView = encodePasswordForView(editingTenant.adminPassword.trim());
              }
              delete nextTenant.adminPassword;
              updatedTenants[idx] = nextTenant;
          }
      } else {
          // Create New Tenant
          
          // 1. CHECK USERNAME DUPLICATE GLOBALLY
          const requestedUsername = (editingTenant.adminUsername || 'admin').trim();
          if (!requestedUsername) {
              alert('Vui lòng nhập tên đăng nhập cho tài khoản Admin mặc định.');
              return;
          }
          const existingUser = await DataService.findUserByUsername(requestedUsername);
          if (existingUser) {
              alert(`Tên đăng nhập "${requestedUsername}" đã tồn tại trên hệ thống. Vui lòng chọn tên khác cho tài khoản Admin.`);
              return;
          }

          const adminPasswordPlain = (editingTenant.adminPassword || '').trim();
          if (!adminPasswordPlain) {
              alert('Vui lòng nhập mật khẩu cho tài khoản Admin mặc định.');
              return;
          }
          const newId = `tenant_${Date.now()}`;
          const newTenant: Tenant = {
              id: newId,
              name: editingTenant.name,
              domain: editingTenant.domain || '',
              status: 'ACTIVE',
              planId: editingTenant.planId,
              subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), 
              createdAt: new Date().toISOString(),
              adminUsername: requestedUsername,
              adminPasswordHash: digestPassword(adminPasswordPlain),
              adminPasswordView: encodePasswordForView(adminPasswordPlain)
          };
          updatedTenants.push(newTenant);
          
          const adminUser: User = {
              id: `u_${newId}_admin`,
              tenantId: newId,
              username: newTenant.adminUsername!,
              passwordHash: digestPassword(adminPasswordPlain),
              passwordView: encodePasswordForView(adminPasswordPlain),
              fullName: newTenant.adminUsername!, // Use Username as Full Name
              role: UserRole.ADMIN,
              permissions: Object.values(PERMISSIONS),
              allowedPropertyIds: []
          };
          // FIX: Use seedTenantAdminUser instead of upsertSystemUser
          // This ensures the user is added to BOTH system/users AND tenants/{id}/users
          DataService.seedTenantAdminUser(adminUser);
      }
      
      DataService.saveTenants(updatedTenants);
      setShowTenantModal(false);
      onRefresh();
  };

  const openToggleStatusModal = (tenant: Tenant) => {
      const isLocking = tenant.status === 'ACTIVE';
      setActionModal({
          type: isLocking ? 'LOCK' : 'UNLOCK',
          item: tenant,
          title: isLocking ? 'Khóa Khách Hàng' : 'Mở Khóa Khách Hàng',
          message: `Bạn có chắc chắn muốn ${isLocking ? 'KHÓA' : 'MỞ KHÓA'} quyền truy cập của "${tenant.name}" không?`
      });
  };

  const openDeleteTenantModal = (tenant: Tenant) => {
      setActionModal({
          type: 'DELETE',
          item: tenant,
          title: 'Xóa Vĩnh Viễn Khách Hàng',
          message: `CẢNH BÁO: Bạn sắp xóa hoàn toàn khách hàng "${tenant.name}". \n\nHành động này sẽ xóa toàn bộ dữ liệu (đơn hàng, phòng, khách...) và không thể khôi phục.`
      });
  };

  const handleSavePlan = () => {
      if (!editingPlan?.name || !editingPlan?.price) return alert("Thiếu thông tin gói");

      let updatedPlans = [...plans];
      
      if (editingPlan.id) {
          const idx = updatedPlans.findIndex(p => p.id === editingPlan.id);
          if (idx !== -1) updatedPlans[idx] = { ...updatedPlans[idx], ...editingPlan } as SubscriptionPlan;
      } else {
          updatedPlans.push({
              id: `plan_${Date.now()}`,
              name: editingPlan.name,
              price: Number(editingPlan.price),
              maxRooms: Number(editingPlan.maxRooms) || 10,
              maxUsers: Number(editingPlan.maxUsers) || 5,
              description: editingPlan.description || ''
          });
      }

      DataService.savePlans(updatedPlans);
      setShowPlanModal(false);
      onRefresh();
  };

  const handleDeletePlan = (id: string) => {
      if (tenants.some(t => t.planId === id)) return alert("Không thể xóa gói cước đang có người sử dụng!");
      if (confirm("Xóa gói cước này?")) {
          DataService.savePlans(plans.filter(p => p.id !== id));
          onRefresh();
      }
  };

  const openDeleteAdminModal = (user: User) => {
      setActionModal({
          type: 'DELETE_ADMIN',
          item: user,
          title: 'Xóa Quản Trị Viên',
          message: `Bạn có chắc muốn xóa tài khoản Super Admin "${user.username}" không?`
      });
  };

  const handleConfirmAction = () => {
      if (!actionModal) return;

      const { type, item } = actionModal;

      if (type === 'DELETE') {
          DataService.deleteTenant(item.id);
      } else if (type === 'LOCK' || type === 'UNLOCK') {
          const newStatus = type === 'LOCK' ? 'LOCKED' : 'ACTIVE';
          const updated = tenants.map(t => t.id === item.id ? { ...t, status: newStatus } : t);
          DataService.saveTenants(updated as Tenant[]);
      } else if (type === 'DELETE_ADMIN') {
          DataService.deleteUser(item.id);
      }

      setActionModal(null);
      setTimeout(() => onRefresh(), 100);
  };

  return (
    <div className="katka-liquid-page platform-page space-y-6 pb-20 animate-fade-in relative">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h2 className="text-2xl font-bold text-gray-800">Quản trị nền tảng</h2>
                <p className="text-gray-500 text-sm">Quản lý khách hàng, gói dịch vụ và tài khoản hệ thống.</p>
            </div>
            <div className="segmented-control flex overflow-x-auto">
                <button onClick={() => setActiveTab('DASHBOARD')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab==='DASHBOARD' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>Tổng quan</button>
                <button onClick={() => setActiveTab('TENANTS')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab==='TENANTS' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>Khách hàng</button>
                <button onClick={() => setActiveTab('PLANS')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab==='PLANS' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>Gói dịch vụ</button>
                <button onClick={() => setActiveTab('ADMINS')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab==='ADMINS' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>Quản trị viên</button>
            </div>
        </div>

        {activeTab === 'DASHBOARD' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center"><Building2 size={24}/></div>
                    <div>
                        <p className="text-gray-500 text-xs font-bold uppercase">Tổng Tenant</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalTenants}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center"><Check size={24}/></div>
                    <div>
                        <p className="text-gray-500 text-xs font-bold uppercase">Đang hoạt động</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.activeTenants}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center"><CreditCard size={24}/></div>
                    <div>
                        <p className="text-gray-500 text-xs font-bold uppercase">Gói dịch vụ</p>
                        <p className="text-2xl font-bold text-gray-900">{stats.totalPlans}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-100 text-yellow-600 rounded-xl flex items-center justify-center"><Server size={24}/></div>
                    <div>
                        <p className="text-gray-500 text-xs font-bold uppercase">Doanh thu (Ước tính)</p>
                        <p className="text-xl font-bold text-gray-900">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(stats.revenueMock)}</p>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'TENANTS' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-700">Danh sách khách hàng</h3>
                    <button 
                        onClick={() => {
                            setEditingTenant({ adminUsername: 'admin', adminPassword: '' });
                            setShowTenantModal(true);
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                    >
                        <Plus size={16}/> Thêm mới
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-xs">
                            <tr>
                                <th className="p-4">Tên công ty</th>
                                <th className="p-4">Gói cước</th>
                                <th className="p-4">Trạng thái</th>
                                <th className="p-4">Hết hạn</th>
                                <th className="p-4 text-right">Hành động</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {tenants.map(tenant => {
                                const plan = plans.find(p => p.id === tenant.planId);
                                const isExpired = new Date(tenant.subscriptionEndDate) < new Date();
                                
                                return (
                                    <tr key={tenant.id} className="hover:bg-gray-50">
                                        <td className="p-4">
                                            <div className="font-bold text-gray-900">{tenant.name}</div>
                                            <div className="text-xs text-gray-400 font-mono">{tenant.id}</div>
                                            <div className="text-xs text-blue-500">{tenant.domain || 'No domain'}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-bold border border-gray-200">
                                                {plan?.name || 'Unknown Plan'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                tenant.status === 'ACTIVE' 
                                                ? (isExpired ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700')
                                                : 'bg-red-100 text-red-700'
                                            }`}>
                                                {isExpired ? 'EXPIRED' : tenant.status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-gray-600 text-xs">
                                            {new Date(tenant.subscriptionEndDate).toLocaleDateString('vi-VN')}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); onAccessTenant(tenant.id); }}
                                                    className="bg-black hover:bg-gray-800 text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 transition-colors"
                                                    title="Đăng nhập vào Tenant này"
                                                >
                                                    <LogIn size={12}/> Login
                                                </button>
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingTenant({ ...tenant, adminPassword: '' });
                                                        setShowTenantModal(true);
                                                    }} 
                                                    className="p-2 bg-gray-100 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                                                >
                                                    <Edit3 size={16}/>
                                                </button>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); openToggleStatusModal(tenant); }} 
                                                    className={`p-2 bg-gray-100 rounded transition-colors ${tenant.status === 'ACTIVE' ? 'hover:bg-amber-50 text-amber-600' : 'hover:bg-green-50 text-green-600'}`}
                                                    title={tenant.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}
                                                >
                                                    {tenant.status === 'ACTIVE' ? <Lock size={16}/> : <Unlock size={16}/>}
                                                </button>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); openDeleteTenantModal(tenant); }} 
                                                    className="p-2 bg-gray-100 hover:bg-red-50 text-red-600 rounded transition-colors" 
                                                    title="Xóa vĩnh viễn Tenant"
                                                >
                                                    <Trash2 size={16}/>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {activeTab === 'PLANS' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-700">Quản lý Gói cước (Subscription Plans)</h3>
                    <button 
                        onClick={() => { setEditingPlan({}); setShowPlanModal(true); }}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                    >
                        <Plus size={16}/> Thêm gói
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
                    {plans.map(plan => (
                        <div key={plan.id} className="border rounded-xl p-4 hover:shadow-md transition-shadow relative">
                            <div className="absolute top-4 right-4 flex gap-2">
                                <button onClick={() => { setEditingPlan(plan); setShowPlanModal(true); }} className="text-gray-400 hover:text-blue-600"><Edit3 size={16}/></button>
                                <button onClick={() => handleDeletePlan(plan.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16}/></button>
                            </div>
                            <h4 className="font-bold text-lg text-gray-800">{plan.name}</h4>
                            <p className="text-2xl font-bold text-purple-600 my-2">
                                {new Intl.NumberFormat('vi-VN').format(plan.price)} <span className="text-sm text-gray-400 font-normal">/tháng</span>
                            </p>
                            <p className="text-sm text-gray-500 mb-4 h-10">{plan.description}</p>
                            <div className="space-y-2 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                                <div className="flex justify-between"><span>Max Rooms:</span> <b>{plan.maxRooms}</b></div>
                                <div className="flex justify-between"><span>Max Users:</span> <b>{plan.maxUsers}</b></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {activeTab === 'ADMINS' && (
             <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b bg-gray-50">
                    <h3 className="font-bold text-gray-700">Tài khoản Hệ thống (Platform Admins)</h3>
                    <p className="text-xs text-gray-500 mt-1">Quản lý các tài khoản Super Admin khác. Thận trọng khi xóa.</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-xs">
                            <tr>
                                <th className="p-4">Username</th>
                                <th className="p-4">Họ tên</th>
                                <th className="p-4">Vai trò</th>
                                <th className="p-4">Tenant Scope</th>
                                <th className="p-4 text-right">Hành động</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {systemUsers.filter(u => u.role === UserRole.SUPER_ADMIN).map(u => (
                                <tr key={u.id} className="hover:bg-gray-50">
                                    <td className="p-4 font-bold text-gray-800">{u.username}</td>
                                    <td className="p-4 text-gray-600">{u.fullName}</td>
                                    <td className="p-4">
                                        <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full text-xs font-bold">SUPER ADMIN</span>
                                    </td>
                                    <td className="p-4 text-xs font-mono text-gray-500">{u.tenantId}</td>
                                    <td className="p-4 text-right">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); openDeleteAdminModal(u); }}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Xóa tài khoản này"
                                        >
                                            <Trash2 size={18}/>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
        )}

        {showTenantModal && (
            <DialogFrame label="Thông tin khách hàng" onDismiss={() => setShowTenantModal(false)} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 animate-fade-in">
                    <h3 className="text-xl font-bold mb-4">{editingTenant?.id ? 'Chỉnh sửa Tenant' : 'Thêm Tenant Mới'}</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Tên Công Ty / Khách Sạn</label>
                            <input className="w-full border p-2 rounded" value={editingTenant?.name || ''} onChange={e => setEditingTenant({...editingTenant, name: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Domain (Tùy chọn)</label>
                            <input className="w-full border p-2 rounded" placeholder="hotel.khost.vn" value={editingTenant?.domain || ''} onChange={e => setEditingTenant({...editingTenant, domain: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Gói Cước</label>
                            <select className="w-full border p-2 rounded" value={editingTenant?.planId || ''} onChange={e => setEditingTenant({...editingTenant, planId: e.target.value})}>
                                <option value="">Chọn gói...</option>
                                {plans.map(p => <option key={p.id} value={p.id}>{p.name} - {p.price.toLocaleString()}đ</option>)}
                            </select>
                        </div>
                        
                        {!editingTenant?.id && (
                            <div className="grid grid-cols-2 gap-4 bg-yellow-50 p-3 rounded border border-yellow-100">
                                <div className="col-span-2 text-xs font-bold text-yellow-700 uppercase">Tài khoản Admin mặc định</div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600">Username</label>
                                    <input
                                        className="w-full border p-1 rounded text-sm"
                                        value={editingTenant?.adminUsername || ''}
                                        onChange={e => setEditingTenant({...editingTenant, adminUsername: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600">Password</label>
                                    <input
                                        type="password"
                                        className="w-full border p-1 rounded text-sm"
                                        value={editingTenant?.adminPassword || ''}
                                        onChange={e => setEditingTenant({...editingTenant, adminPassword: e.target.value})}
                                    />
                                </div>
                            </div>
                        )}

                        {editingTenant?.id && (
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Ngày hết hạn</label>
                                <input type="date" className="w-full border p-2 rounded" value={editingTenant?.subscriptionEndDate ? editingTenant.subscriptionEndDate.split('T')[0] : ''} onChange={e => setEditingTenant({...editingTenant, subscriptionEndDate: new Date(e.target.value).toISOString()})} />
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <button onClick={() => setShowTenantModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Hủy</button>
                        <button onClick={handleSaveTenant} className="px-4 py-2 bg-purple-600 text-white rounded font-bold hover:bg-purple-700">Lưu thông tin</button>
                    </div>
                </div>
            </DialogFrame>
        )}

        {showPlanModal && (
            <DialogFrame label="Gói dịch vụ" onDismiss={() => setShowPlanModal(false)} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-fade-in">
                    <h3 className="text-xl font-bold mb-4">{editingPlan?.id ? 'Sửa Gói Cước' : 'Thêm Gói Cước'}</h3>
                    <div className="space-y-4">
                        <input className="w-full border p-2 rounded" placeholder="Tên gói (VD: Pro)" value={editingPlan?.name || ''} onChange={e => setEditingPlan({...editingPlan, name: e.target.value})} />
                        <input className="w-full border p-2 rounded" type="number" placeholder="Giá (VNĐ)" value={editingPlan?.price || ''} onChange={e => setEditingPlan({...editingPlan, price: Number(e.target.value)})} />
                        <textarea className="w-full border p-2 rounded" placeholder="Mô tả ngắn..." value={editingPlan?.description || ''} onChange={e => setEditingPlan({...editingPlan, description: e.target.value})} />
                        <div className="grid grid-cols-2 gap-4">
                             <input className="w-full border p-2 rounded" type="number" placeholder="Max Rooms" value={editingPlan?.maxRooms || ''} onChange={e => setEditingPlan({...editingPlan, maxRooms: Number(e.target.value)})} />
                             <input className="w-full border p-2 rounded" type="number" placeholder="Max Users" value={editingPlan?.maxUsers || ''} onChange={e => setEditingPlan({...editingPlan, maxUsers: Number(e.target.value)})} />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <button onClick={() => setShowPlanModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Hủy</button>
                        <button onClick={handleSavePlan} className="px-4 py-2 bg-purple-600 text-white rounded font-bold hover:bg-purple-700">Lưu Gói</button>
                    </div>
                </div>
            </DialogFrame>
        )}

        {actionModal && (
            <DialogFrame label="Xác nhận thao tác" onDismiss={() => setActionModal(null)} className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setActionModal(null)}>
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in relative" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setActionModal(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                    
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${
                        actionModal.type === 'DELETE' || actionModal.type === 'DELETE_ADMIN' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                        <AlertTriangle size={24} />
                    </div>
                    
                    <h3 className="text-lg font-bold text-center text-gray-900 mb-2">{actionModal.title}</h3>
                    <p className="text-sm text-gray-500 text-center mb-6 whitespace-pre-wrap">{actionModal.message}</p>
                    
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setActionModal(null)} 
                            className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            Hủy bỏ
                        </button>
                        <button 
                            onClick={handleConfirmAction} 
                            className={`flex-1 py-2.5 text-white font-bold rounded-lg shadow-lg transition-colors ${
                                actionModal.type === 'DELETE' || actionModal.type === 'DELETE_ADMIN' 
                                ? 'bg-red-600 hover:bg-red-700 shadow-red-200' 
                                : 'bg-amber-600 hover:bg-amber-700 shadow-amber-200'
                            }`}
                        >
                            Xác nhận
                        </button>
                    </div>
                </div>
            </DialogFrame>
        )}
    </div>
  );
};

export default SuperAdmin;
