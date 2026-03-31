
import React, { useState } from 'react';
import { User, UserRole, Property, PERMISSIONS } from '../types';
import { Trash2, UserPlus, AlertTriangle } from 'lucide-react';
import { DataService } from '../services/dataService';

interface AdminProps {
  users: User[];
  properties: Property[];
  onRefresh: () => void;
}

const Admin: React.FC<AdminProps> = ({ users, properties, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const [userData, setUserData] = useState<Partial<User>>({
    role: UserRole.RECEPTIONIST,
    permissions: [],
    allowedPropertyIds: []
  });

  const handleDeleteClick = (user: User) => {
      setUserToDelete(user);
      setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
      if (userToDelete) {
          DataService.deleteUser(userToDelete.id);
          onRefresh();
          setShowDeleteConfirm(false);
          setUserToDelete(null);
      }
  };

  const openAddModal = () => {
      setEditingUserId(null);
      setUserData({
          role: UserRole.RECEPTIONIST,
          permissions: [
              PERMISSIONS.MANAGE_ROOMS,
              PERMISSIONS.CAN_ADD_BOOKING, 
              PERMISSIONS.CAN_EDIT_BOOKING
          ],
          password: '',
          allowedPropertyIds: []
      });
      setShowModal(true);
  };

  const openEditModal = (user: User) => {
      setEditingUserId(user.id);
      setUserData({ 
          ...user, 
          password: '',
          allowedPropertyIds: user.allowedPropertyIds || [],
          permissions: user.permissions || [] 
      });
      setShowModal(true);
  };

  const toggleProperty = (propId: string) => {
      setUserData(prev => {
          const current = prev.allowedPropertyIds || [];
          if (current.includes(propId)) {
              return { ...prev, allowedPropertyIds: current.filter(id => id !== propId) };
          } else {
              return { ...prev, allowedPropertyIds: [...current, propId] };
          }
      });
  };

  const togglePermission = (perm: string) => {
      setUserData(prev => {
          const current = prev.permissions || [];
          if (current.includes(perm)) {
              return { ...prev, permissions: current.filter(p => p !== perm) };
          } else {
              return { ...prev, permissions: [...current, perm] };
          }
      });
  };

  const handleSaveUser = async () => {
    const creatingNew = !editingUserId;
    if (!userData.username || !userData.fullName) {
        alert("Thiếu thông tin bắt buộc (Họ tên, Username)");
        return;
    }
    if (creatingNew && !userData.password) {
        alert("Thiếu thông tin bắt buộc (Mật khẩu)");
        return;
    }

    const requestedUsername = userData.username;

    // --- CHECK 1: GLOBAL DUPLICATE USERNAME ---
    // If creating new user OR editing user (but changed username)
    // We check if username exists in the whole system
    const globalExistingUser = await DataService.findUserByUsername(requestedUsername);
    if (globalExistingUser && globalExistingUser.id !== editingUserId) {
        alert(`Tên đăng nhập "${requestedUsername}" đã tồn tại trong hệ thống (có thể ở chi nhánh hoặc tenant khác). Vui lòng chọn tên khác.`);
        return;
    }

    if (userData.role === UserRole.SUPER_ADMIN) {
        alert("Bạn không thể tạo tài khoản Super Admin từ giao diện này.");
        return;
    }
    
    let finalPermissions = userData.permissions || [];
    if (userData.role === UserRole.ADMIN) {
        finalPermissions = Object.values(PERMISSIONS);
    }

    if (editingUserId) {
        // Edit Mode
        const updatedUser: User = {
            ...userData,
            id: editingUserId,
            permissions: finalPermissions
        } as User;
        if (!updatedUser.password) {
            delete updatedUser.password;
        }
        
        if(!updatedUser.role) updatedUser.role = UserRole.RECEPTIONIST;

        DataService.updateUser(updatedUser);
    } else {
        // Add Mode
        const userToAdd: User = {
            id: 'u' + Date.now(),
            tenantId: '', // Placeholder, will be set by DataService
            username: userData.username,
            fullName: userData.fullName,
            role: userData.role as UserRole,
            password: userData.password,
            allowedPropertyIds: userData.allowedPropertyIds || [],
            permissions: finalPermissions
        };
        DataService.addUser(userToAdd);
    }

    setShowModal(false);
    onRefresh();
  };

  const permissionOptions = [
      { id: PERMISSIONS.VIEW_DASHBOARD, label: 'Xem Tổng quan (Dashboard)' },
      { id: PERMISSIONS.VIEW_REPORTS, label: 'Xem Báo cáo' },
      { divider: true },
      { id: PERMISSIONS.CAN_ADD_BOOKING, label: 'Được phép THÊM đơn' },
      { id: PERMISSIONS.CAN_EDIT_BOOKING, label: 'Được phép SỬA đơn' },
      { id: PERMISSIONS.CAN_DELETE_BOOKING, label: 'Được phép XOÁ đơn' },
      { id: PERMISSIONS.CAN_EXPORT_REPORT, label: 'Được phép TẢI báo cáo' },
      { id: PERMISSIONS.VIEW_AUDIT_LOGS, label: 'Được phép XEM lịch sử thao tác' },
  ];

  return (
    <div className="katka-liquid-page space-y-6 px-5 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
            <h2 className="text-2xl font-bold text-gray-800">Quản trị hệ thống</h2>
            <p className="text-gray-500">Quản lý người dùng, phân quyền và tài khoản</p>
        </div>
        <button 
            onClick={openAddModal}
            className="self-start bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-sm font-semibold"
        >
            <UserPlus size={18} /> Thêm nhân viên
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/90 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left">
          <thead className="bg-gray-50/80 border-b border-gray-200 text-gray-700 font-semibold text-xs uppercase tracking-wide">
            <tr>
              <th className="px-5 py-3.5">Họ và tên</th>
              <th className="px-5 py-3.5">Tên đăng nhập</th>
              <th className="px-5 py-3.5">Vai trò</th>
              <th className="px-5 py-3.5 text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-gray-50/80">
                <td className="px-5 py-4 font-medium text-gray-900">{user.fullName}</td>
                <td className="px-5 py-4 text-gray-500">{user.username}</td>
                <td className="px-5 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                    user.role === UserRole.ADMIN ? 'bg-purple-100 text-purple-700' :
                    user.role === UserRole.MANAGER ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-2">
                      <button 
                          onClick={() => openEditModal(user)}
                          className="text-blue-600 hover:text-blue-700 px-3 py-1.5 text-sm font-semibold border border-blue-200 hover:bg-blue-50 rounded-lg"
                          title="Xem chi tiết và chỉnh sửa"
                      >
                          Chi tiết
                      </button>
                      
                      <button 
                          onClick={() => handleDeleteClick(user)}
                          className={`p-2 rounded-lg ${user.username === 'admin' ? 'text-gray-300 cursor-not-allowed' : 'text-red-400 hover:text-red-600 hover:bg-red-50'}`}
                          disabled={user.username === 'admin'}
                          title={user.username === 'admin' ? "Không thể xóa Super Admin" : "Xóa tài khoản"}
                      >
                          <Trash2 size={18} />
                      </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white p-6 md:p-7 rounded-2xl w-full max-w-2xl shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold mb-5">{editingUserId ? 'Chỉnh sửa tài khoản' : 'Thêm nhân viên mới'}</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-7">
                    <div className="space-y-4">
                        <h4 className="font-bold text-gray-700 border-b pb-2">Thông tin cơ bản</h4>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Họ và tên</label>
                            <input 
                                type="text" 
                                className="w-full border p-2 rounded mt-1 outline-none focus:border-blue-500"
                                value={userData.fullName || ''}
                                onChange={e => setUserData({...userData, fullName: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Tên đăng nhập</label>
                            <input 
                                type="text" 
                                className="w-full border p-2 rounded mt-1 outline-none focus:border-blue-500"
                                value={userData.username || ''}
                                onChange={e => setUserData({...userData, username: e.target.value})}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Tên đăng nhập phải là duy nhất trên toàn hệ thống.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Mật khẩu</label>
                            <input 
                                type="password" 
                                className="w-full border p-2 rounded mt-1 outline-none focus:border-blue-500"
                                placeholder={editingUserId ? "Để trống nếu không đổi mật khẩu" : "Nhập mật khẩu..."}
                                value={userData.password || ''}
                                onChange={e => setUserData({...userData, password: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Vai trò</label>
                            <select 
                                className="w-full border p-2 rounded mt-1 outline-none focus:border-blue-500"
                                value={userData.role}
                                onChange={e => setUserData({...userData, role: e.target.value as UserRole})}
                            >
                                {Object.values(UserRole)
                                    .filter(r => r !== UserRole.SUPER_ADMIN) 
                                    .map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-bold text-gray-700 border-b pb-2">Phân quyền & Chi nhánh</h4>
                        
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Quyền hạn thao tác</label>
                            <div className="space-y-2">
                                {permissionOptions.map((opt: any, idx: number) => {
                                    if (opt.divider) return <div key={idx} className="h-px bg-gray-200 my-2"></div>;

                                    const isChecked = userData.permissions?.includes(opt.id) || false;
                                    const isAdmin = userData.role === UserRole.ADMIN;
                                    return (
                                        <label key={opt.id} className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${isChecked ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'} ${isAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                            <input 
                                                type="checkbox" 
                                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                                checked={isAdmin || isChecked}
                                                disabled={isAdmin} 
                                                onChange={() => togglePermission(opt.id)}
                                            />
                                            <span className="text-sm font-medium text-gray-700">{opt.label}</span>
                                        </label>
                                    )
                                })}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Chi nhánh được phép truy cập</label>
                            <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-gray-50">
                                {properties.map(p => (
                                    <label key={p.id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded cursor-pointer transition-colors">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                            checked={userData.allowedPropertyIds?.includes(p.id) || false}
                                            onChange={() => toggleProperty(p.id)}
                                        />
                                        <span className="text-sm text-gray-700 font-medium">{p.name}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Để trống = Truy cập tất cả (Chỉ nên dùng cho Admin).</p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
                    <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded font-medium">Hủy</button>
                    <button onClick={handleSaveUser} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium shadow-sm">Lưu thay đổi</button>
                </div>
            </div>
        </div>
      )}

      {showDeleteConfirm && userToDelete && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 animate-fade-in text-center">
                  <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">Xác nhận xóa nhân viên</h3>
                  <p className="text-gray-500 text-sm mb-6">
                      Bạn có chắc chắn muốn xóa tài khoản <b>{userToDelete.fullName}</b> ({userToDelete.username}) không? <br/>
                      Hành động này không thể hoàn tác.
                  </p>
                  <div className="flex gap-3">
                      <button 
                          onClick={() => setShowDeleteConfirm(false)}
                          className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                      >
                          Hủy bỏ
                      </button>
                      <button 
                          onClick={confirmDelete}
                          className="flex-1 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                      >
                          Xóa vĩnh viễn
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Admin;
