
import React, { useState } from 'react';
import { User, Room, RoomType, Property, RoomStatus, Tag, TransactionCategory } from '../types';
import { DataService } from '../services/dataService';
import { Plus, Trash2, Save, X, Tag as TagIcon, Pencil, RotateCcw, ArrowUp, ArrowDown, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface ManagementProps {
  users: User[];
  rooms: Room[];
  roomTypes: RoomType[];
  properties: Property[];
  tags: Tag[];
  onRefresh: () => void;
}

const Management: React.FC<ManagementProps> = ({ users, rooms, roomTypes, properties, tags, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'ROOMS' | 'TYPES' | 'BRANCHES' | 'TAGS' | 'FINANCE'>('ROOMS');
  
  // Track which item ID is being edited. If null, we are adding new.
  const [editingId, setEditingId] = useState<string | null>(null);

  // --- CRUD States ---
  const [newRoom, setNewRoom] = useState<Partial<Room>>({});
  const [newType, setNewType] = useState<Partial<RoomType>>({});
  const [newProp, setNewProp] = useState<Partial<Property>>({});
  const [newTag, setNewTag] = useState<Partial<Tag>>({ color: '#3b82f6' });
  const [newCategory, setNewCategory] = useState<Partial<TransactionCategory>>({ type: 'REVENUE' });

  // Get Finance Data (Directly from service as it is not passed via props in this step)
  const transactionCategories = DataService.getTransactionCategories();

  // --- Helper to Reset Forms ---
  const resetForms = () => {
    setEditingId(null);
    setNewRoom({});
    setNewType({});
    setNewProp({});
    setNewTag({ color: '#3b82f6' });
    setNewCategory({ type: 'REVENUE' });
  };

  // --- REORDERING HELPER ---
  const moveItem = (list: any[], index: number, direction: number, saveFn: (items: any[]) => void) => {
      if (index + direction < 0 || index + direction >= list.length) return;
      
      const newList = [...list];
      const item = newList[index];
      newList.splice(index, 1);
      newList.splice(index + direction, 0, item);
      
      // Update sortOrder for all items to match new index
      const updatedList = newList.map((item, idx) => ({ ...item, sortOrder: idx }));
      
      saveFn(updatedList);
      onRefresh();
  };

  // --- Handlers: ROOMS ---
  const startEditRoom = (room: Room) => {
      setEditingId(room.id);
      setNewRoom({ ...room });
  };

  const handleSaveRoom = () => {
      if(!newRoom.number || !newRoom.typeId || !newRoom.propertyId) return alert("Thiếu thông tin");
      
      let updatedRooms = [...rooms];
      if (editingId) {
          // Update existing
          const index = updatedRooms.findIndex(r => r.id === editingId);
          if (index !== -1) {
              updatedRooms[index] = { ...updatedRooms[index], ...newRoom } as Room;
          }
      } else {
          // Create new
          const r: Room = {
              id: `r${Date.now()}`,
              number: newRoom.number,
              typeId: newRoom.typeId,
              propertyId: newRoom.propertyId,
              floor: Number(newRoom.floor) || 1,
              status: RoomStatus.VACANT_CLEAN,
              sortOrder: rooms.length // Append to end
          };
          updatedRooms.push(r);
      }
      
      DataService.saveRooms(updatedRooms);
      resetForms();
      onRefresh();
  };

  const handleDeleteRoom = (id: string) => {
      if(confirm("Xác nhận xoá phòng? Phòng sẽ biến mất khỏi sơ đồ và toàn bộ hệ thống ngay lập tức.")) {
          DataService.saveRooms(rooms.filter(r => r.id !== id));
          if (editingId === id) resetForms();
          onRefresh();
      }
  };

  // --- Handlers: TYPES ---
  const startEditType = (type: RoomType) => {
      setEditingId(type.id);
      setNewType({ ...type });
  };

  const handleSaveType = () => {
      if(!newType.name) return;
      let updatedTypes = [...roomTypes];

      if (editingId) {
         const index = updatedTypes.findIndex(t => t.id === editingId);
         if (index !== -1) {
             updatedTypes[index] = { ...updatedTypes[index], ...newType } as RoomType;
         }
      } else {
          const t: RoomType = {
              id: `rt${Date.now()}`,
              name: newType.name,
              price: Number(newType.price) || 0,
              capacity: Number(newType.capacity) || 1,
              sortOrder: roomTypes.length
          };
          updatedTypes.push(t);
      }

      DataService.saveRoomTypes(updatedTypes);
      resetForms();
      onRefresh();
  };

  const handleDeleteType = (id: string) => {
     if(confirm("Xoá hạng phòng? Các phòng thuộc hạng này sẽ bị lỗi.")) {
         DataService.saveRoomTypes(roomTypes.filter(t => t.id !== id));
         if (editingId === id) resetForms();
         onRefresh();
     }
  };
  
  // --- Handlers: BRANCHES ---
  const startEditProp = (prop: Property) => {
      setEditingId(prop.id);
      setNewProp({ ...prop });
  };

  const handleSaveProp = () => {
      if(!newProp.name) return;
      let updatedProps = [...properties];

      if (editingId) {
          const index = updatedProps.findIndex(p => p.id === editingId);
          if (index !== -1) {
              updatedProps[index] = { ...updatedProps[index], ...newProp } as Property;
          }
      } else {
          const p: Property = {
              id: `p${Date.now()}`,
              name: newProp.name,
              address: newProp.address || '',
              sortOrder: properties.length
          };
          updatedProps.push(p);
      }

      DataService.saveProperties(updatedProps);
      resetForms();
      onRefresh();
  };

  const handleDeleteProp = (id: string) => {
      if(confirm("Xoá chi nhánh? Dữ liệu liên quan sẽ mất kết nối.")) {
          DataService.saveProperties(properties.filter(p => p.id !== id));
          if (editingId === id) resetForms();
          onRefresh();
      }
  }

  // --- Handlers: TAGS ---
  const startEditTag = (tag: Tag) => {
      setEditingId(tag.id);
      setNewTag({ ...tag });
  };

  const handleSaveTag = () => {
      if(!newTag.name || !newTag.color) return;
      let updatedTags = [...tags];

      if (editingId) {
          const index = updatedTags.findIndex(t => t.id === editingId);
          if (index !== -1) {
              updatedTags[index] = { ...updatedTags[index], ...newTag } as Tag;
          }
      } else {
          const t: Tag = {
              id: `tag${Date.now()}`,
              name: newTag.name,
              color: newTag.color
          };
          updatedTags.push(t);
      }

      DataService.saveTags(updatedTags);
      setNewTag({ color: '#3b82f6' }); // keep default blue
      setEditingId(null);
      onRefresh();
  }

  const handleDeleteTag = (id: string) => {
      if(confirm("Xoá Tag? Các đơn đặt phòng đang dùng tag này sẽ mất tag.")) {
          DataService.saveTags(tags.filter(t => t.id !== id));
          if (editingId === id) resetForms();
          onRefresh();
      }
  }

  // --- Handlers: FINANCE (TRANSACTION CATEGORIES) ---
  const startEditCategory = (cat: TransactionCategory) => {
      setEditingId(cat.id);
      setNewCategory({ ...cat });
  };

  const handleSaveCategory = () => {
      if (!newCategory.name) return alert("Vui lòng nhập tên danh mục");
      
      let updatedCats = [...transactionCategories];
      if (editingId) {
          const idx = updatedCats.findIndex(c => c.id === editingId);
          if (idx !== -1) updatedCats[idx] = { ...updatedCats[idx], ...newCategory } as TransactionCategory;
      } else {
          updatedCats.push({
              id: `cat_${Date.now()}`,
              name: newCategory.name,
              type: newCategory.type || 'REVENUE'
          });
      }
      DataService.saveTransactionCategories(updatedCats);
      resetForms();
      onRefresh();
  };

  const handleDeleteCategory = (id: string) => {
      if(confirm("Xóa danh mục này?")) {
          DataService.saveTransactionCategories(transactionCategories.filter(c => c.id !== id));
          if (editingId === id) resetForms();
          onRefresh();
      }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-h-[500px] flex flex-col pb-20 md:pb-0">
      <div className="flex border-b overflow-x-auto no-scrollbar">
         {['ROOMS', 'TYPES', 'BRANCHES', 'TAGS', 'FINANCE'].map((tab) => (
             <button 
                key={tab}
                onClick={() => { setActiveTab(tab as any); resetForms(); }}
                className={`px-4 md:px-6 py-4 font-medium text-sm transition-colors border-b-2 whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'border-orange-500 text-orange-600 bg-orange-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
             >
                 {tab === 'ROOMS' ? 'Quản lý Phòng' : tab === 'TYPES' ? 'Hạng phòng & Giá' : tab === 'TAGS' ? 'Quản lý Tag' : tab === 'FINANCE' ? 'LOẠI THU/CHI' : 'Chi nhánh'}
             </button>
         ))}
      </div>

      <div className="p-4 md:p-6 flex-1 overflow-hidden flex flex-col">
          {/* ROOMS TAB */}
          {activeTab === 'ROOMS' && (
              <div className="space-y-6 flex-1 flex flex-col overflow-hidden">
                  <div className={`grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4 p-4 rounded-lg border ${editingId ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                      <input placeholder="Số phòng" className="border p-2 rounded" value={newRoom.number || ''} onChange={e => setNewRoom({...newRoom, number: e.target.value})} />
                      <input placeholder="Tầng" type="number" className="border p-2 rounded" value={newRoom.floor || ''} onChange={e => setNewRoom({...newRoom, floor: Number(e.target.value)})} />
                      <select className="border p-2 rounded" value={newRoom.typeId || ''} onChange={e => setNewRoom({...newRoom, typeId: e.target.value})}>
                          <option value="">Chọn hạng phòng</option>
                          {roomTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <select className="border p-2 rounded" value={newRoom.propertyId || ''} onChange={e => setNewRoom({...newRoom, propertyId: e.target.value})}>
                          <option value="">Chọn chi nhánh</option>
                          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button onClick={handleSaveRoom} className={`flex-1 text-white rounded hover:opacity-90 flex items-center justify-center gap-2 py-2 md:py-0 ${editingId ? 'bg-orange-600' : 'bg-orange-500'}`}>
                            {editingId ? <Save size={18}/> : <Plus size={18}/>} 
                            {editingId ? 'Lưu' : 'Thêm'}
                        </button>
                        {editingId && (
                            <button onClick={resetForms} className="px-3 bg-gray-200 text-gray-600 rounded hover:bg-gray-300" title="Hủy sửa"><RotateCcw size={18}/></button>
                        )}
                      </div>
                  </div>
                  <div className="overflow-auto max-h-[500px] shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.1)] border rounded">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-gray-100 sticky top-0">
                              <tr><th className="p-3">Thứ tự</th><th className="p-3">Phòng</th><th className="p-3">Tầng</th><th className="p-3">Hạng</th><th className="p-3">Chi nhánh</th><th className="p-3 text-right">Thao tác</th></tr>
                          </thead>
                          <tbody>
                              {rooms.map((r, idx) => (
                                  <tr key={r.id} className={`border-b ${editingId === r.id ? 'bg-orange-50' : ''}`}>
                                      <td className="p-3">
                                          <div className="flex flex-col">
                                              <button onClick={() => moveItem(rooms, idx, -1, DataService.saveRooms)} disabled={idx===0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={14}/></button>
                                              <button onClick={() => moveItem(rooms, idx, 1, DataService.saveRooms)} disabled={idx===rooms.length-1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={14}/></button>
                                          </div>
                                      </td>
                                      <td className="p-3 font-bold">{r.number}</td>
                                      <td className="p-3">{r.floor}</td>
                                      <td className="p-3 min-w-[120px]">{roomTypes.find(t => t.id === r.typeId)?.name}</td>
                                      <td className="p-3 min-w-[120px]">{properties.find(p => p.id === r.propertyId)?.name}</td>
                                      <td className="p-3 text-right">
                                          <div className="flex justify-end gap-2">
                                              <button onClick={() => startEditRoom(r)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded"><Pencil size={16}/></button>
                                              <button onClick={() => handleDeleteRoom(r.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={16}/></button>
                                          </div>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {/* TYPES TAB */}
          {activeTab === 'TYPES' && (
               <div className="space-y-6 flex-1 flex flex-col overflow-hidden">
               <div className={`grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 p-4 rounded-lg border ${editingId ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                   <input placeholder="Tên hạng phòng" className="border p-2 rounded" value={newType.name || ''} onChange={e => setNewType({...newType, name: e.target.value})} />
                   <input placeholder="Giá (VNĐ)" type="number" className="border p-2 rounded" value={newType.price || ''} onChange={e => setNewType({...newType, price: Number(e.target.value)})} />
                   <input placeholder="Sức chứa" type="number" className="border p-2 rounded" value={newType.capacity || ''} onChange={e => setNewType({...newType, capacity: Number(e.target.value)})} />
                   <div className="flex gap-2">
                        <button onClick={handleSaveType} className={`flex-1 text-white rounded hover:opacity-90 flex items-center justify-center gap-2 py-2 md:py-0 ${editingId ? 'bg-orange-600' : 'bg-orange-500'}`}>
                            {editingId ? <Save size={18}/> : <Plus size={18}/>} 
                            {editingId ? 'Lưu' : 'Thêm'}
                        </button>
                        {editingId && (
                            <button onClick={resetForms} className="px-3 bg-gray-200 text-gray-600 rounded hover:bg-gray-300" title="Hủy sửa"><RotateCcw size={18}/></button>
                        )}
                   </div>
               </div>
               <div className="overflow-auto max-h-[500px] shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.1)] border rounded">
                   <table className="w-full text-sm text-left">
                       <thead className="bg-gray-100 sticky top-0">
                           <tr><th className="p-3">Thứ tự</th><th className="p-3">Tên hạng</th><th className="p-3">Giá chuẩn</th><th className="p-3">Sức chứa</th><th className="p-3 text-right">Thao tác</th></tr>
                       </thead>
                       <tbody>
                           {roomTypes.map((t, idx) => (
                               <tr key={t.id} className={`border-b ${editingId === t.id ? 'bg-orange-50' : ''}`}>
                                   <td className="p-3">
                                          <div className="flex flex-col">
                                              <button onClick={() => moveItem(roomTypes, idx, -1, DataService.saveRoomTypes)} disabled={idx===0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={14}/></button>
                                              <button onClick={() => moveItem(roomTypes, idx, 1, DataService.saveRoomTypes)} disabled={idx===roomTypes.length-1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={14}/></button>
                                          </div>
                                   </td>
                                   <td className="p-3 font-bold">{t.name}</td>
                                   <td className="p-3">{t.price.toLocaleString()}</td>
                                   <td className="p-3">{t.capacity}</td>
                                   <td className="p-3 text-right">
                                       <div className="flex justify-end gap-2">
                                          <button onClick={() => startEditType(t)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded"><Pencil size={16}/></button>
                                          <button onClick={() => handleDeleteType(t.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={16}/></button>
                                       </div>
                                   </td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </div>
               </div>
          )}

          {/* BRANCHES TAB */}
           {activeTab === 'BRANCHES' && (
               <div className="space-y-6 flex-1 flex flex-col overflow-hidden">
               <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 p-4 rounded-lg border ${editingId ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                   <input placeholder="Tên chi nhánh" className="border p-2 rounded" value={newProp.name || ''} onChange={e => setNewProp({...newProp, name: e.target.value})} />
                   <input placeholder="Địa chỉ" className="border p-2 rounded" value={newProp.address || ''} onChange={e => setNewProp({...newProp, address: e.target.value})} />
                   <div className="flex gap-2">
                        <button onClick={handleSaveProp} className={`flex-1 text-white rounded hover:opacity-90 flex items-center justify-center gap-2 py-2 md:py-0 ${editingId ? 'bg-orange-600' : 'bg-orange-500'}`}>
                            {editingId ? <Save size={18}/> : <Plus size={18}/>} 
                            {editingId ? 'Lưu' : 'Thêm'}
                        </button>
                        {editingId && (
                            <button onClick={resetForms} className="px-3 bg-gray-200 text-gray-600 rounded hover:bg-gray-300" title="Hủy sửa"><RotateCcw size={18}/></button>
                        )}
                   </div>
               </div>
               <div className="overflow-auto max-h-[500px] shadow-[inset_-12px_0_12px_-12px_rgba(0,0,0,0.1)] border rounded">
                   <table className="w-full text-sm text-left">
                       <thead className="bg-gray-100 sticky top-0">
                           <tr><th className="p-3">Thứ tự</th><th className="p-3">Tên chi nhánh</th><th className="p-3">Địa chỉ</th><th className="p-3 text-right">Thao tác</th></tr>
                       </thead>
                       <tbody>
                           {properties.map((p, idx) => (
                               <tr key={p.id} className={`border-b ${editingId === p.id ? 'bg-orange-50' : ''}`}>
                                   <td className="p-3">
                                          <div className="flex flex-col">
                                              <button onClick={() => moveItem(properties, idx, -1, DataService.saveProperties)} disabled={idx===0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={14}/></button>
                                              <button onClick={() => moveItem(properties, idx, 1, DataService.saveProperties)} disabled={idx===properties.length-1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={14}/></button>
                                          </div>
                                   </td>
                                   <td className="p-3 font-bold">{p.name}</td>
                                   <td className="p-3 min-w-[200px]">{p.address}</td>
                                   <td className="p-3 text-right">
                                       <div className="flex justify-end gap-2">
                                           <button onClick={() => startEditProp(p)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded"><Pencil size={16}/></button>
                                           <button onClick={() => handleDeleteProp(p.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 size={16}/></button>
                                       </div>
                                   </td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </div>
               </div>
          )}

          {/* TAGS TAB */}
          {activeTab === 'TAGS' && (
               <div className="space-y-6">
                   <div className={`flex flex-col md:flex-row gap-4 p-4 rounded-lg border items-end ${editingId ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                       <div className="flex-1 w-full">
                           <label className="text-xs font-bold text-gray-500 uppercase">Tên Tag</label>
                           <input placeholder="VD: Combo, Vip..." className="border p-2 rounded w-full mt-1" value={newTag.name || ''} onChange={e => setNewTag({...newTag, name: e.target.value})} />
                       </div>
                       <div className="flex-1 w-full">
                           <label className="text-xs font-bold text-gray-500 uppercase">Màu sắc</label>
                           <div className="flex gap-2 mt-1">
                               <input type="color" className="h-10 w-16 p-0 border rounded cursor-pointer" value={newTag.color} onChange={e => setNewTag({...newTag, color: e.target.value})} />
                               <input type="text" className="border p-2 rounded flex-1 uppercase" value={newTag.color} onChange={e => setNewTag({...newTag, color: e.target.value})} />
                           </div>
                       </div>
                       <div className="flex gap-2 h-10 w-full md:w-auto">
                            <button onClick={handleSaveTag} className={`flex-1 md:flex-none px-6 text-white rounded font-bold hover:opacity-90 flex items-center justify-center gap-2 ${editingId ? 'bg-orange-600' : 'bg-orange-500'}`}>
                                {editingId ? <Save size={18}/> : <Plus size={18}/>} 
                                {editingId ? 'Lưu Tag' : 'Tạo Tag'}
                            </button>
                            {editingId && (
                                <button onClick={resetForms} className="px-3 bg-gray-200 text-gray-600 rounded hover:bg-gray-300" title="Hủy sửa"><RotateCcw size={18}/></button>
                            )}
                       </div>
                   </div>
                   
                   <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                       {tags.map(t => (
                           <div key={t.id} className={`border rounded-lg p-3 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow bg-white ${editingId === t.id ? 'ring-2 ring-orange-400' : ''}`}>
                               <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => startEditTag(t)}>
                                   <div className="w-8 h-8 rounded-full border border-gray-100 shadow-inner" style={{backgroundColor: t.color}}></div>
                                   <span className="font-bold text-gray-700">{t.name}</span>
                               </div>
                               <div className="flex gap-1">
                                   <button onClick={() => startEditTag(t)} className="text-blue-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-full transition-colors"><Pencil size={16}/></button>
                                   <button onClick={() => handleDeleteTag(t.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={16}/></button>
                               </div>
                           </div>
                       ))}
                   </div>
                   {tags.length === 0 && <p className="text-center text-gray-400 py-10">Chưa có tag nào.</p>}
               </div>
          )}

          {/* FINANCE CATEGORIES TAB */}
          {activeTab === 'FINANCE' && (
              <div className="space-y-6">
                  <div className={`flex flex-col md:flex-row gap-4 p-4 rounded-lg border items-end ${editingId ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex-1 w-full">
                          <label className="text-xs font-bold text-gray-500 uppercase">Tên khoản mục</label>
                          <input placeholder="VD: Nước ngọt, Giặt là, Chi hộ..." className="border p-2 rounded w-full mt-1" value={newCategory.name || ''} onChange={e => setNewCategory({...newCategory, name: e.target.value})} />
                      </div>
                      <div className="flex-1 w-full">
                          <label className="text-xs font-bold text-gray-500 uppercase">Loại giao dịch</label>
                          <select className="border p-2 rounded w-full mt-1 bg-white" value={newCategory.type} onChange={e => setNewCategory({...newCategory, type: e.target.value as any})}>
                              <option value="REVENUE">Khoản Thu (Thu thêm từ khách)</option>
                              <option value="EXPENSE">Khoản Chi (Chi phí phát sinh)</option>
                          </select>
                      </div>
                      <div className="flex gap-2 h-10 w-full md:w-auto">
                           <button onClick={handleSaveCategory} className={`flex-1 md:flex-none px-6 text-white rounded font-bold hover:opacity-90 flex items-center justify-center gap-2 ${editingId ? 'bg-orange-600' : 'bg-orange-500'}`}>
                               {editingId ? <Save size={18}/> : <Plus size={18}/>} 
                               {editingId ? 'Lưu' : 'Thêm'}
                           </button>
                           {editingId && (
                               <button onClick={resetForms} className="px-3 bg-gray-200 text-gray-600 rounded hover:bg-gray-300" title="Hủy sửa"><RotateCcw size={18}/></button>
                           )}
                      </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Revenue List */}
                      <div>
                          <h4 className="font-bold text-green-700 mb-3 flex items-center gap-2"><ArrowUpCircle size={18}/> Danh sách Khoản Thu</h4>
                          <div className="space-y-2">
                              {transactionCategories.filter(c => c.type === 'REVENUE').map(c => (
                                  <div key={c.id} className={`flex justify-between items-center p-3 rounded-lg border bg-white shadow-sm hover:border-green-300 transition-colors ${editingId === c.id ? 'ring-2 ring-orange-400' : ''}`}>
                                      <span className="font-bold text-gray-700">{c.name}</span>
                                      <div className="flex gap-1">
                                          <button onClick={() => startEditCategory(c)} className="text-blue-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-full transition-colors"><Pencil size={16}/></button>
                                          <button onClick={() => handleDeleteCategory(c.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={16}/></button>
                                      </div>
                                  </div>
                              ))}
                              {transactionCategories.filter(c => c.type === 'REVENUE').length === 0 && <p className="text-gray-400 text-sm italic">Chưa có mục nào.</p>}
                          </div>
                      </div>

                      {/* Expense List */}
                      <div>
                          <h4 className="font-bold text-red-700 mb-3 flex items-center gap-2"><ArrowDownCircle size={18}/> Danh sách Khoản Chi</h4>
                          <div className="space-y-2">
                              {transactionCategories.filter(c => c.type === 'EXPENSE').map(c => (
                                  <div key={c.id} className={`flex justify-between items-center p-3 rounded-lg border bg-white shadow-sm hover:border-red-300 transition-colors ${editingId === c.id ? 'ring-2 ring-orange-400' : ''}`}>
                                      <span className="font-bold text-gray-700">{c.name}</span>
                                      <div className="flex gap-1">
                                          <button onClick={() => startEditCategory(c)} className="text-blue-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-full transition-colors"><Pencil size={16}/></button>
                                          <button onClick={() => handleDeleteCategory(c.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={16}/></button>
                                      </div>
                                  </div>
                              ))}
                              {transactionCategories.filter(c => c.type === 'EXPENSE').length === 0 && <p className="text-gray-400 text-sm italic">Chưa có mục nào.</p>}
                          </div>
                      </div>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
};

export default Management;
