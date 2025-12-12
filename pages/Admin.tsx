import React, { useState } from 'react';
import { User, UserRole, Property } from '../types';
import { Trash2, UserPlus, Shield } from 'lucide-react';
import { DataService } from '../services/dataService';

interface AdminProps {
  users: User[];
  properties: Property[];
  onRefresh: () => void;
}

const Admin: React.FC<AdminProps> = ({ users, properties, onRefresh }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState<Partial<User>>({
    role: UserRole.RECEPTIONIST,
    permissions: []
  });

  const handleDelete = (id: string) => {
    if (confirm('Bạn có chắc muốn xóa tài khoản này?')) {
      DataService.deleteUser(id);
      onRefresh();
    }
  };

  const handleAddUser = () => {
    if (!newUser.username || !newUser.fullName) return alert("Thiếu thông tin");
    
    const userToAdd: User = {
        id: 'u' + Date.now(),
        username: newUser.username,
        fullName: newUser.fullName,
        role: newUser.role as UserRole,
        password: '123', // Default password
        propertyId: newUser.propertyId,
        permissions: [] // Simplify for demo
    };

    DataService.addUser(userToAdd);
    setShowAddModal(false);
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
            <h2 className="text-2xl font-bold text-gray-800">Quản trị hệ thống</h2>
            <p className="text-gray-500">Quản lý người dùng và phân quyền</p>
        </div>
        <button 
            onClick={() => setShowAddModal(true)}
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
                  {user.role !== UserRole.ADMIN && (
                    <button 
                        onClick={() => handleDelete(user.id)}
                        className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded"
                    >
                        <Trash2 size={18} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-lg w-full max-w-md shadow-2xl">
                <h3 className="text-xl font-bold mb-4">Thêm nhân viên mới</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Họ và tên</label>
                        <input 
                            type="text" 
                            className="w-full border p-2 rounded mt-1"
                            value={newUser.fullName || ''}
                            onChange={e => setNewUser({...newUser, fullName: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Tên đăng nhập</label>
                        <input 
                            type="text" 
                            className="w-full border p-2 rounded mt-1"
                            value={newUser.username || ''}
                            onChange={e => setNewUser({...newUser, username: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Vai trò</label>
                        <select 
                            className="w-full border p-2 rounded mt-1"
                            value={newUser.role}
                            onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                        >
                            {Object.values(UserRole).map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Chi nhánh</label>
                        <select 
                            className="w-full border p-2 rounded mt-1"
                            value={newUser.propertyId || ''}
                            onChange={e => setNewUser({...newUser, propertyId: e.target.value || undefined})}
                        >
                            <option value="">Tất cả (Admin only)</option>
                            {properties.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                        <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Hủy</button>
                        <button onClick={handleAddUser} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Lưu</button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Admin;