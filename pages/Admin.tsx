
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { User, UserRole, Property, PERMISSIONS } from '../types';
import { Trash2, UserPlus, AlertTriangle } from 'lucide-react';
import { DataService } from '../services/dataService';

interface AdminProps {
  users: User[];
  properties: Property[];
  currentUser: User;
  onRefresh: () => void;
}

const Admin: React.FC<AdminProps> = ({ users, properties, currentUser, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const [userData, setUserData] = useState<Partial<User>>({
    role: UserRole.RECEPTIONIST,
    permissions: [],
    allowedPropertyIds: []
  });
  const adminUsers = users.filter(user => user.role === UserRole.ADMIN);
  const isLastAdmin = (user: User) => user.role === UserRole.ADMIN && adminUsers.length <= 1;
  const isCurrentUser = (userId?: string | null) => Boolean(userId && userId === currentUser.id);

  const handleDeleteClick = (user: User) => {
      if (isLastAdmin(user)) {
          setStatusMessage('Không thể xóa admin cuối cùng của hệ thống.');
          return;
      }
      if (isCurrentUser(user.id)) {
          setStatusMessage('Không thể tự xóa tài khoản đang đăng nhập.');
          return;
      }
      setUserToDelete(user);
      setDeleteError('');
      setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
      if (userToDelete) {
          setDeleteError('');
          try {
              setIsDeleting(true);
              await DataService.deleteUser(userToDelete.id);
              onRefresh();
              setStatusMessage(`Đã xóa tài khoản ${userToDelete.fullName || userToDelete.username}.`);
              setShowDeleteConfirm(false);
              setUserToDelete(null);
          } catch (error) {
              const message = error instanceof Error ? error.message : 'Không thể xóa nhân viên.';
              setDeleteError(message);
          } finally {
              setIsDeleting(false);
          }
      }
  };

  const openAddModal = () => {
      setEditingUserId(null);
      setFormError('');
      setStatusMessage('');
      setUserData({
          role: UserRole.RECEPTIONIST,
          permissions: [
              PERMISSIONS.VIEW_DASHBOARD,
              PERMISSIONS.MANAGE_ROOMS,
              PERMISSIONS.CAN_UPDATE_ROOM_STATUS,
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
      setFormError('');
      setStatusMessage('');
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
    setFormError('');
    setStatusMessage('');

    const normalizedUsername = (userData.username || '').trim();
    const normalizedFullName = (userData.fullName || '').trim();
    const normalizedPassword = (userData.password || '').trim();
    const selectedRole = userData.role || UserRole.RECEPTIONIST;
    const selectedPropertyIds = userData.allowedPropertyIds || [];
    const editingUser = editingUserId ? users.find(user => user.id === editingUserId) : null;

    if (!normalizedUsername || !normalizedFullName) {
        setFormError('Thiếu thông tin bắt buộc: họ tên và tên đăng nhập.');
        return;
    }
    if (/\s/.test(normalizedUsername)) {
        setFormError('Tên đăng nhập không được có khoảng trắng.');
        return;
    }
    if (creatingNew && !normalizedPassword) {
        setFormError('Thiếu mật khẩu cho nhân viên mới.');
        return;
    }
    if (normalizedPassword && normalizedPassword.length < 6) {
        setFormError('Mật khẩu cần có ít nhất 6 ký tự.');
        return;
    }
    if (selectedRole !== UserRole.ADMIN && selectedPropertyIds.length === 0) {
        setFormError('Nhân viên không phải Admin bắt buộc phải chọn ít nhất 1 chi nhánh.');
        return;
    }
    if (editingUser && isLastAdmin(editingUser) && selectedRole !== UserRole.ADMIN) {
        setFormError('Không thể hạ quyền admin cuối cùng của hệ thống.');
        return;
    }
    if (editingUser && isCurrentUser(editingUser.id) && currentUser.role === UserRole.ADMIN && selectedRole !== UserRole.ADMIN) {
        setFormError('Không thể tự hạ quyền tài khoản admin đang đăng nhập.');
        return;
    }
    if (selectedRole === UserRole.SUPER_ADMIN) {
        setFormError('Bạn không thể tạo tài khoản Super Admin từ giao diện này.');
        return;
    }

    // --- CHECK 1: GLOBAL DUPLICATE USERNAME ---
    // If creating new user OR editing user (but changed username)
    // We check if username exists in the whole system
    try {
        setIsSaving(true);
        const globalExistingUser = await DataService.findUserByUsername(normalizedUsername);
        if (globalExistingUser && globalExistingUser.id !== editingUserId) {
            setFormError(`Tên đăng nhập "${normalizedUsername}" đã tồn tại trong hệ thống. Vui lòng chọn tên khác.`);
            return;
        }
        
        const finalPermissions = selectedRole === UserRole.ADMIN ? Object.values(PERMISSIONS) : (userData.permissions || []);
        const finalAllowedPropertyIds = selectedRole === UserRole.ADMIN ? [] : selectedPropertyIds;

        if (editingUserId) {
            // Edit Mode
            const updatedUser: User = {
                ...userData,
                id: editingUserId,
                username: normalizedUsername,
                fullName: normalizedFullName,
                role: selectedRole,
                allowedPropertyIds: finalAllowedPropertyIds,
                permissions: finalPermissions
            } as User;
            if (normalizedPassword) {
                updatedUser.password = normalizedPassword;
            } else {
                delete updatedUser.password;
            }

            DataService.updateUser(updatedUser);
            setStatusMessage(`Đã lưu tài khoản ${normalizedFullName}.`);
        } else {
            // Add Mode
            const userToAdd: User = {
                id: 'u' + Date.now(),
                tenantId: '', // Placeholder, will be set by DataService
                username: normalizedUsername,
                fullName: normalizedFullName,
                role: selectedRole,
                password: normalizedPassword,
                allowedPropertyIds: finalAllowedPropertyIds,
                permissions: finalPermissions
            };
            DataService.addUser(userToAdd);
            setStatusMessage(`Đã thêm nhân viên ${normalizedFullName}.`);
        }

        setShowModal(false);
        onRefresh();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Không thể lưu tài khoản.';
        setFormError(message);
    } finally {
        setIsSaving(false);
    }
  };

  const permissionOptions = [
      { id: PERMISSIONS.VIEW_DASHBOARD, label: 'Xem Tổng quan (Dashboard)' },
      { id: PERMISSIONS.MANAGE_ROOMS, label: 'Được phép vào Sơ đồ phòng / Buồng phòng' },
      { id: PERMISSIONS.CAN_UPDATE_ROOM_STATUS, label: 'Được phép đổi trạng thái sạch/bẩn phòng' },
      { id: PERMISSIONS.MANAGE_BOOKINGS, label: 'Được phép vào Danh sách đơn' },
      { id: PERMISSIONS.VIEW_REPORTS, label: 'Xem Báo cáo' },
      { id: PERMISSIONS.ADMIN_SETTINGS, label: 'Được phép quản trị Cài đặt hệ thống' },
      { divider: true },
      { id: PERMISSIONS.CAN_ADD_BOOKING, label: 'Được phép THÊM đơn' },
      { id: PERMISSIONS.CAN_EDIT_BOOKING, label: 'Được phép SỬA đơn' },
      { id: PERMISSIONS.CAN_DELETE_BOOKING, label: 'Được phép XOÁ đơn' },
      { id: PERMISSIONS.CAN_EXPORT_REPORT, label: 'Được phép TẢI báo cáo' },
      { id: PERMISSIONS.VIEW_AUDIT_LOGS, label: 'Được phép XEM lịch sử thao tác' },
  ];

  const getPropertySummary = (user: User) => {
      if (user.role === UserRole.ADMIN || !user.allowedPropertyIds || user.allowedPropertyIds.length === 0) {
          return 'Tất cả chi nhánh';
      }
      const names = user.allowedPropertyIds
          .map(id => properties.find(property => property.id === id)?.name)
          .filter(Boolean);
      if (names.length === 0) return 'Chưa chọn chi nhánh';
      if (names.length <= 2) return names.join(', ');
      return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  };

  const roleLabels: Record<UserRole, string> = {
      [UserRole.SUPER_ADMIN]: 'SUPER ADMIN',
      [UserRole.ADMIN]: 'ADMIN',
      [UserRole.MANAGER]: 'MANAGER',
      [UserRole.RECEPTIONIST]: 'RECEPTIONIST',
      [UserRole.HOUSEKEEPING]: 'BUỒNG PHÒNG',
  };

  const groupedUsers = (Object.values(UserRole) as UserRole[])
      .map(role => ({
          role,
          label: roleLabels[role],
          users: users
              .filter(user => user.role === role)
              .sort((a, b) => (a.fullName || a.username || '').localeCompare(b.fullName || b.username || '', 'vi'))
      }))
      .filter(group => group.users.length > 0);

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

      {statusMessage && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
            {statusMessage}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/90 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left">
          <thead className="bg-gray-50/80 border-b border-gray-200 text-gray-700 font-semibold text-xs uppercase tracking-wide">
            <tr>
              <th className="px-5 py-3.5">Họ và tên</th>
              <th className="px-5 py-3.5">Tên đăng nhập</th>
              <th className="px-5 py-3.5">Vai trò</th>
              <th className="px-5 py-3.5">Chi nhánh</th>
              <th className="px-5 py-3.5">Quyền</th>
              <th className="px-5 py-3.5 text-right">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {groupedUsers.map(group => (
              <React.Fragment key={group.role}>
                <tr className="bg-slate-50/90">
                  <td colSpan={6} className="px-5 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                    {group.label} ({group.users.length})
                  </td>
                </tr>
                {group.users.map(user => (
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
                    <td className="px-5 py-4 text-sm text-gray-600 max-w-[220px] truncate" title={getPropertySummary(user)}>{getPropertySummary(user)}</td>
                    <td className="px-5 py-4 text-sm text-gray-600">
                        {user.role === UserRole.ADMIN ? (
                            'Toàn quyền'
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                <span>{user.permissions?.length || 0} quyền</span>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                    user.permissions?.includes(PERMISSIONS.CAN_UPDATE_ROOM_STATUS)
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-amber-50 text-amber-700'
                                }`}>
                                    Sạch/Bẩn: {user.permissions?.includes(PERMISSIONS.CAN_UPDATE_ROOM_STATUS) ? 'Bật' : 'Tắt'}
                                </span>
                            </div>
                        )}
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
                              className={`p-2 rounded-lg ${isLastAdmin(user) || isCurrentUser(user.id) ? 'text-gray-300 cursor-not-allowed' : 'text-red-400 hover:text-red-600 hover:bg-red-50'}`}
                              disabled={isLastAdmin(user) || isCurrentUser(user.id)}
                              title={isLastAdmin(user) ? "Không thể xóa admin cuối cùng" : isCurrentUser(user.id) ? "Không thể tự xóa tài khoản đang đăng nhập" : "Xóa tài khoản"}
                          >
                              <Trash2 size={18} />
                          </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 md:p-6">
            <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl animate-fade-in max-h-[calc(100dvh-32px)] overflow-hidden flex flex-col">
                <div className="shrink-0 border-b border-gray-100 px-5 py-4 md:px-7">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">{editingUserId ? 'Chỉnh sửa tài khoản' : 'Thêm nhân viên mới'}</h3>
                            <p className="mt-1 text-sm text-gray-500">Thiết lập tài khoản, vai trò, quyền thao tác và chi nhánh được truy cập.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowModal(false)}
                            disabled={isSaving}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50"
                            aria-label="Đóng popup nhân viên"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 md:px-7">
                    {formError && (
                        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {formError}
                        </div>
                    )}

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
                                onChange={e => {
                                    const nextRole = e.target.value as UserRole;
                                    setUserData({
                                        ...userData,
                                        role: nextRole,
                                        allowedPropertyIds: nextRole === UserRole.ADMIN ? [] : (userData.allowedPropertyIds || [])
                                    });
                                }}
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
                                {userData.role === UserRole.ADMIN && (
                                    <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700">
                                        Admin luôn có toàn bộ quyền và toàn bộ chi nhánh, không cần tick từng quyền bên dưới.
                                    </div>
                                )}
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
                            <div className={`max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 ${userData.role === UserRole.ADMIN ? 'bg-purple-50 border-purple-100 opacity-70' : 'bg-gray-50'}`}>
                                {properties.map(p => (
                                    <label key={p.id} className={`flex items-center gap-2 p-1.5 rounded transition-colors ${userData.role === UserRole.ADMIN ? 'cursor-not-allowed' : 'hover:bg-white cursor-pointer'}`}>
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                            checked={userData.role === UserRole.ADMIN || userData.allowedPropertyIds?.includes(p.id) || false}
                                            disabled={userData.role === UserRole.ADMIN}
                                            onChange={() => toggleProperty(p.id)}
                                        />
                                        <span className="text-sm text-gray-700 font-medium">{p.name}</span>
                                    </label>
                                ))}
                            </div>
                            <p className={`text-xs mt-1 font-semibold ${(userData.allowedPropertyIds || []).length === 0 && userData.role !== UserRole.ADMIN ? 'text-red-600' : 'text-gray-500'}`}>
                                {userData.role === UserRole.ADMIN
                                    ? 'Admin luôn truy cập tất cả chi nhánh.'
                                    : 'Nhân viên bắt buộc phải chọn ít nhất 1 chi nhánh.'}
                            </p>
                        </div>
                    </div>
                </div>
                </div>

                <div className="shrink-0 flex justify-end gap-3 border-t border-gray-100 bg-white px-5 py-4 md:px-7">
                    <button onClick={() => setShowModal(false)} disabled={isSaving} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded font-medium disabled:opacity-50">Hủy</button>
                    <button onClick={handleSaveUser} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium shadow-sm disabled:opacity-60">
                        {isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
      )}

      {showDeleteConfirm && userToDelete && createPortal(
          <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in text-center">
                  <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">Xác nhận xóa nhân viên</h3>
                  <p className="text-gray-500 text-sm mb-6">
                      Bạn có chắc chắn muốn xóa tài khoản <b>{userToDelete.fullName}</b> ({userToDelete.username}) không? <br/>
                      Hành động này không thể hoàn tác.
                  </p>
                  {deleteError && (
                      <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-left text-sm font-semibold text-red-700">
                          {deleteError}
                      </div>
                  )}
                  <div className="flex gap-3">
                      <button 
                          onClick={() => {
                              setShowDeleteConfirm(false);
                              setDeleteError('');
                          }}
                          disabled={isDeleting}
                          className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                      >
                          Hủy bỏ
                      </button>
                      <button 
                          onClick={confirmDelete}
                          disabled={isDeleting}
                          className="flex-1 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-lg shadow-red-200 disabled:opacity-60"
                      >
                          {isDeleting ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
                      </button>
                  </div>
              </div>
          </div>,
          document.body
      )}
    </div>
  );
};

export default Admin;
