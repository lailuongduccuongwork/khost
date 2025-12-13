
import React, { useState } from 'react';
import { User, UserRole, Property } from '../types';
import { Trash2, UserPlus, Shield, Pencil } from 'lucide-react';
import { DataService } from '../services/dataService';

interface AdminProps {
  users: User[];
  properties: Property[];
  onRefresh: () => void;
}

const Admin: React.FC<AdminProps> = ({ users, properties, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  const [userData, setUserData] = useState<Partial<User>>({
    role: UserRole.RECEPTIONIST,
    permissions: []
  });

  const handleDelete = (id: string) => {
    if (confirm('Bạn có chắc muốn xóa tài khoản này?')) {
      DataService.deleteUser(id);
      onRefresh();
    }
  };

  const openAddModal = () => {
      setEditingUserId(null);
      setUserData({
          role: UserRole.RECEPTIONIST,
          permissions: [],
          password: ''
      });
      setShowModal(true);
  };

  const openEditModal = (user: User) => {
      setEditingUserId(user.id);
      setUserData({ ...user });
      setShowModal(true);
  };

  const handleSaveUser = () => {
    if (!userData.username || !userData.fullName || !userData.password) {
        alert("Thiếu thông tin bắt buộc (Họ tên, Username, Mật khẩu)");
        return;
    }
    
    if (editingUserId) {
        // Edit Mode
        const updatedUser: User = {
            ...userData,
            id: editingUserId,
        } as User;
        
        // Ensure role is valid
        if(!updatedUser.role) updatedUser.role = UserRole.RECEPTIONIST;

        DataService.updateUser(updatedUser);
    } else {
        // Add Mode
        const userToAdd: User = {
            id: 'u' + Date.now(),
            username: userData.username,
            fullName: userData.fullName,
            role: userData.role as UserRole,
            password: userData.password,
            propertyId: userData.propertyId,
            permissions: [] 
        };
        DataService.addUser(userToAdd);
    }

    setShowModal(false);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-gray-800">Quản trị hệ thống</h2>
            <p className="text-gray-500">Quản lý người dùng, phân quyền và tài khoản</p>
        </div>
        <button 
            onClick={openAddModal}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm"
        >
            <UserPlus size={18} /> Thêm nhân viên
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold text-xs uppercase">
            <tr>
              <th className="px-6 py-3">Họ và tên</th>
              <th className="px-6 py-3">Tên đăng nhập</th>
              <th className="px-6 py-3">Mật khẩu</th>
              <th className="px-6 py-3">Vai trò</th>
              <th className="px-6 py-3">Chi nhánh quản lý</th>
              <th className="px-6 py-3 text-right">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">{user.fullName}</td>
                <td className="px-6 py-4 text-gray-500">{user.username}</td>
                <td className="px-6 py-4 font-mono text-gray-600">{user.password}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                    user.role === UserRole.ADMIN ? 'bg-purple-100 text-purple-700' :
                    user.role === UserRole.MANAGER ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  {user.propertyId 
                    ? properties.find(p => p.id === user.propertyId)?.name 
                    : <span className="text-purple-600 font-semibold flex items-center gap-1"><Shield size={12}/> Tất cả chi nhánh</span>
                  }
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                      <button 
                          onClick={() => openEditModal(user)}
                          className="text-blue-500 hover:text-blue-700 p-2 hover:bg-blue-50 rounded"
                          title="Chỉnh sửa thông tin"
                      >
                          <Pencil size={18} />
                      </button>
                      
                      <button 
                          onClick={() => handleDelete(user.id)}
                          className={`p-2 rounded ${user.username === 'admin' ? 'text-gray-300 cursor-not-allowed' : 'text-red-400 hover:text-red-600 hover:bg-red-50'}`}
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg w-full max-w-md shadow-2xl animate-fade-in">
                <h3 className="text-xl font-bold mb-4">{editingUserId ? 'Chỉnh sửa tài khoản' : 'Thêm nhân viên mới'}</h3>
                <div className="space-y-4">
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
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Mật khẩu</label>
                        <input 
                            type="text" 
                            className="w-full border p-2 rounded mt-1 outline-none focus:border-blue-500"
                            placeholder="Nhập mật khẩu..."
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
                            {Object.values(UserRole).map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Chi nhánh quản lý</label>
                        <select 
                            className="w-full border p-2 rounded mt-1 outline-none focus:border-blue-500"
                            value={userData.propertyId || ''}
                            onChange={e => setUserData({...userData, propertyId: e.target.value || undefined})}
                        >
                            <option value="">-- Tất cả (Dành cho Admin) --</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">Admin có thể để trống để quản lý tất cả.</p>
                    </div>
                    <div className="flex justify-end gap-3 mt-6 pt-2 border-t">
                        <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded font-medium">Hủy</button>
                        <button onClick={handleSaveUser} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Lưu thay đổi</button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
