import React, { useState } from 'react';
import { User, Room, RoomType, Property, RoomStatus, Tag, TransactionCategory } from '../types';
import { DataService } from '../services/dataService';
import { 
    Building2, BedDouble, Shield, Settings, Plus, Trash2, Edit2, 
    Check, X, Tag as TagIcon, DollarSign, AlertTriangle, ArrowDownAZ, ArrowUpZA, GripVertical, Info, Users, Key
} from 'lucide-react';
import Admin from './Admin'; 

interface ManagementProps {
  users: User[];
  rooms: Room[];
  roomTypes: RoomType[];
  properties: Property[];
  tags: Tag[];
  onRefresh: () => void;
}

type TabType = 'PROPERTIES' | 'ROOM_MANAGEMENT' | 'ADMIN' | 'ADVANCED';

// --- SUB-COMPONENT: INLINE INPUT (Đã được tối ưu UI/UX để không bị khuất chữ) ---
const InlineInput = ({ 
    value = "", onSave, onCancel, type = "text", placeholder = "", autoSelect = false
}: { 
    value?: string | number, onSave: (val: string) => void, onCancel: () => void, type?: string, placeholder?: string, autoSelect?: boolean
}) => {
    const [localVal, setLocalVal] = useState(value);

    return (
        <div className="flex items-center gap-1.5 w-full animate-fade-in">
            <input 
                type={type} 
                value={localVal} 
                onChange={e => setLocalVal(e.target.value)}
                placeholder={placeholder}
                className="w-full min-w-0 px-2.5 py-1.5 text-sm font-bold text-gray-900 border-2 border-blue-500 rounded-md focus:outline-none focus:ring-4 focus:ring-blue-100 shadow-sm transition-all"
                autoFocus
                onFocus={(e) => {
                    if (autoSelect) e.target.select();
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onSave((localVal ?? "").toString());
                    if (e.key === 'Escape') onCancel();
                }}
            />
            <button onClick={() => onSave((localVal ?? "").toString())} className="p-1.5 shrink-0 bg-green-500 text-white hover:bg-green-600 rounded-md shadow-sm transition-colors" title="Lưu">
                <Check size={16} strokeWidth={3} />
            </button>
            <button onClick={onCancel} className="p-1.5 shrink-0 bg-gray-200 text-gray-600 hover:bg-gray-300 rounded-md shadow-sm transition-colors" title="Hủy">
                <X size={16} strokeWidth={3} />
            </button>
        </div>
    );
};

const Management: React.FC<ManagementProps> = ({ users, rooms, roomTypes, properties, tags, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<TabType>('PROPERTIES');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Modal xóa chung
  const [deleteModal, setDeleteModal] = useState<{isOpen: boolean, title: string, onConfirm: () => void}>({ isOpen: false, title: '', onConfirm: () => {} });

  // --- DRAG & DROP STATE ---
  const [draggedPropIdx, setDraggedPropIdx] = useState<number | null>(null);
  const [draggedRoom, setDraggedRoom] = useState<{ propId: string, idx: number } | null>(null);

  // --- HÀM HỖ TRỢ LỌC DỮ LIỆU THÔNG MINH ---
  const getTypesInProp = (propId: string) => {
      return roomTypes.filter(t => {
          const explicitPropId = (t as any).propertyId;
          if (explicitPropId === propId) return true;
          const hasRoomsHere = rooms.some(r => r.typeId === t.id && r.propertyId === propId);
          if (hasRoomsHere) return true;
          const isOrphan = !explicitPropId && !rooms.some(r => r.typeId === t.id);
          if (isOrphan && properties[0]?.id === propId) return true;
          return false;
      }).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
  };

  // --- HÀM HỖ TRỢ XÓA ---
  const confirmDelete = (type: string, id: string, name: string) => {
      setDeleteModal({
          isOpen: true,
          title: `Xoá ${name}?`,
          onConfirm: () => {
              DataService.deleteItems(type, [id]);
              setDeleteModal({ isOpen: false, title: '', onConfirm: () => {} });
          }
      });
  };

  // --- HÀM SẮP XẾP CHI NHÁNH ---
  const handleSortPropAZ = (isAZ: boolean) => {
      const sorted = [...properties].sort((a, b) => {
          const cmp = String(a.name || '').localeCompare(String(b.name || ''), 'vi', { numeric: true });
          return isAZ ? cmp : -cmp;
      });
      DataService.saveProperties(sorted.map((item, index) => ({ ...item, sortOrder: index })));
  };

  const handleDropProperty = (dropIdx: number) => {
      if (draggedPropIdx === null || draggedPropIdx === dropIdx) return;
      const newList = [...properties].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
      const [removed] = newList.splice(draggedPropIdx, 1);
      newList.splice(dropIdx, 0, removed);
      DataService.saveProperties(newList.map((item, i) => ({ ...item, sortOrder: i })));
      setDraggedPropIdx(null);
  };

  // --- HÀM SẮP XẾP SỐ PHÒNG TRONG CHI NHÁNH ---
  const handleSortRoomsAZ = (propId: string, isAZ: boolean) => {
      let roomsInProp = rooms.filter(r => r.propertyId === propId);
      roomsInProp.sort((a, b) => {
          const cmp = String(a.number || '').localeCompare(String(b.number || ''), 'vi', { numeric: true });
          return isAZ ? cmp : -cmp;
      });
      const updatedRooms = roomsInProp.map((item, i) => ({ ...item, sortOrder: i }));
      const finalRooms = rooms.map(r => updatedRooms.find(u => u.id === r.id) || r);
      DataService.saveRooms(finalRooms);
  };

  const handleDropRoom = (propId: string, dropIdx: number) => {
      if (!draggedRoom || draggedRoom.propId !== propId || draggedRoom.idx === dropIdx) return;
      let roomsInProp = rooms.filter(r => r.propertyId === propId).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
      
      const newList = [...roomsInProp];
      const [removed] = newList.splice(draggedRoom.idx, 1);
      newList.splice(dropIdx, 0, removed);
      
      const updatedRooms = newList.map((item, i) => ({ ...item, sortOrder: i }));
      const finalRooms = rooms.map(r => updatedRooms.find(u => u.id === r.id) || r);
      DataService.saveRooms(finalRooms);
      setDraggedRoom(null);
  };

  // --- HANDLERS: THÊM MỚI ---
  const handleAddProperty = () => {
      const newProp: Property = { id: `p_${Date.now()}`, name: 'Chi nhánh mới', address: 'Địa chỉ...', sortOrder: properties.length };
      DataService.saveProperties([...properties, newProp]);
      setEditingId(newProp.id);
  };

  const handleAddRoomType = (propertyId: string) => {
      const newType: RoomType = { id: `rt_${Date.now()}`, name: 'Hạng phòng mới', price: 0, capacity: 2, sortOrder: 999 };
      (newType as any).propertyId = propertyId;
      DataService.saveRoomTypes([...roomTypes, newType]);
      setEditingId(newType.id);
  };

  const handleAddRoom = (propertyId: string, fallbackTypeId: string) => {
      const newRoom: Room = { id: `r_${Date.now()}`, number: 'Mới', typeId: fallbackTypeId, propertyId: propertyId, status: RoomStatus.VACANT_CLEAN, floor: 1, sortOrder: 999 };
      DataService.saveRooms([...rooms, newRoom]);
      setEditingId(newRoom.id);
  };

  const handleRoomTypeChange = (roomId: string, newTypeId: string) => {
      DataService.saveRooms(rooms.map(r => r.id === roomId ? {...r, typeId: newTypeId} : r));
  };

  // --- COMPONENT: MENU BÊN TRÁI ---
  const renderSidebar = () => {
      const tabs = [
          { id: 'PROPERTIES', label: 'Cơ sở & Chi nhánh', icon: Building2, desc: 'Quản lý các toà nhà' },
          { id: 'ROOM_MANAGEMENT', label: 'Phân bổ Hạng & Phòng', icon: BedDouble, desc: 'Cấu hình phòng theo cấu trúc' },
          { id: 'ADMIN', label: 'Nhân sự & Phân quyền', icon: Shield, desc: 'Tài khoản nhân viên' },
          { id: 'ADVANCED', label: 'Cấu hình nâng cao', icon: Settings, desc: 'Thu chi, thẻ tag' },
      ];

      return (
          <div className="w-full md:w-72 flex-shrink-0 bg-white border border-gray-200 rounded-2xl shadow-sm p-4 h-fit sticky top-24">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 px-2">Cài đặt hệ thống</h2>
              <nav className="flex flex-col gap-1">
                  {tabs.map(tab => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.id;
                      return (
                          <button
                              key={tab.id}
                              onClick={() => setActiveTab(tab.id as TabType)}
                              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                                  isActive ? 'bg-blue-50 border border-blue-100 shadow-sm' : 'hover:bg-gray-50 border border-transparent'
                              }`}
                          >
                              <div className={`p-2 rounded-lg ${isActive ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-gray-100 text-gray-500'}`}><Icon size={20} /></div>
                              <div>
                                  <div className={`font-semibold ${isActive ? 'text-blue-800' : 'text-gray-700'}`}>{tab.label}</div>
                                  <div className="text-[11px] text-gray-500 mt-0.5">{tab.desc}</div>
                              </div>
                          </button>
                      );
                  })}
              </nav>
          </div>
      );
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 animate-fade-in">
      {renderSidebar()}

      <div className="flex-1 w-full min-w-0">
          
          {/* TAB 1: CHI NHÁNH */}
          {activeTab === 'PROPERTIES' && (
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden animate-fade-in">
                  <div className="p-5 md:p-6 border-b border-gray-100 flex flex-col md:flex-row md:justify-between items-start md:items-center gap-4 bg-gray-50/50">
                      <div>
                          <h2 className="text-xl font-bold text-gray-800">Cơ sở & Chi nhánh</h2>
                          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1"><Info size={14}/> Thứ tự hiển thị ở đây sẽ quyết định thứ tự ưu tiên trên toàn hệ thống.</p>
                      </div>
                      <button onClick={handleAddProperty} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-2 hover:bg-blue-700 shadow-md shadow-blue-200 transition-all">
                          <Plus size={18} /> Thêm chi nhánh
                      </button>
                  </div>
                  <div className="p-0 overflow-x-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                          <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-100">
                              <tr>
                                  <th className="px-4 py-4 w-10 text-center text-gray-400" title="Kéo thả để sắp xếp">⋮⋮</th>
                                  <th className="px-6 py-4 w-1/3">
                                      <div className="flex items-center gap-2">
                                          Tên chi nhánh
                                          <div className="flex border border-gray-200 rounded bg-white ml-2">
                                            <button onClick={() => handleSortPropAZ(true)} className="p-1 hover:bg-gray-100 text-gray-500" title="Sắp xếp A-Z"><ArrowDownAZ size={14}/></button>
                                            <button onClick={() => handleSortPropAZ(false)} className="p-1 hover:bg-gray-100 text-gray-500 border-l border-gray-200" title="Sắp xếp Z-A"><ArrowUpZA size={14}/></button>
                                          </div>
                                      </div>
                                  </th>
                                  <th className="px-6 py-4 w-1/2">Địa chỉ</th>
                                  <th className="px-6 py-4 w-32 text-center">Thao tác</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {[...properties].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)).map((prop, index) => (
                                  <tr 
                                      key={prop.id} 
                                      draggable
                                      onDragStart={() => setDraggedPropIdx(index)}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={(e) => { e.preventDefault(); handleDropProperty(index); }}
                                      className={`hover:bg-blue-50/30 transition-colors ${draggedPropIdx === index ? 'opacity-40 bg-gray-100' : ''}`}
                                  >
                                      <td className="px-4 py-4 text-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-600"><GripVertical size={18} className="mx-auto" /></td>
                                      <td className="px-6 py-4">
                                          {editingId === prop.id ? (
                                              <InlineInput value={prop.name} autoSelect onSave={(v) => { DataService.saveProperties(properties.map(p => p.id === prop.id ? {...p, name: v} : p)); setEditingId(null); }} onCancel={() => setEditingId(null)} />
                                          ) : <span className="font-semibold text-gray-800">{prop.name}</span>}
                                      </td>
                                      <td className="px-6 py-4 text-gray-600">
                                            {editingId === prop.id + '_addr' ? (
                                              <InlineInput value={prop.address} autoSelect onSave={(v) => { DataService.saveProperties(properties.map(p => p.id === prop.id ? {...p, address: v} : p)); setEditingId(null); }} onCancel={() => setEditingId(null)} />
                                          ) : <span className="truncate block max-w-xs">{prop.address}</span>}
                                      </td>
                                      <td className="px-6 py-4 flex items-center justify-center gap-2">
                                          <button onClick={() => setEditingId(editingId === prop.id ? null : prop.id)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg" title="Sửa tên"><Edit2 size={16} /></button>
                                          <button onClick={() => setEditingId(editingId === prop.id + '_addr' ? null : prop.id + '_addr')} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Sửa địa chỉ"><Building2 size={16} /></button>
                                          <button onClick={() => confirmDelete('properties', prop.id, `Chi nhánh ${prop.name}`)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {/* TAB 2: QUẢN LÝ PHÒNG VÀ HẠNG PHÒNG */}
          {activeTab === 'ROOM_MANAGEMENT' && (
              <div className="flex flex-col gap-6 animate-fade-in">
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                      <div className="p-5 md:p-6 border-b border-gray-100 flex flex-col md:flex-row md:justify-between items-start md:items-center gap-4 bg-gray-50/50">
                          <div>
                              <h2 className="text-xl font-bold text-gray-800">Phân bổ Hạng phòng & Số phòng</h2>
                              <p className="text-sm text-gray-500 mt-1 flex items-center gap-1"><Info size={14}/> Kéo thả số phòng để sắp xếp vị trí hiển thị trên Sơ đồ phòng.</p>
                          </div>
                      </div>
                      
                      <div className="p-4 md:p-6 space-y-8 bg-gray-50/30">
                          {properties.length === 0 && <div className="text-center py-8 text-gray-500 font-medium">Bạn cần tạo Chi nhánh trước nhé!</div>}
                          
                          {[...properties].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)).map(prop => {
                              const typesInProp = getTypesInProp(prop.id);
                              const roomsInProp = rooms.filter(r => r.propertyId === prop.id).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));

                              return (
                                  <div key={prop.id} className="bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
                                      {/* --- LEVEL 1: CHI NHÁNH --- */}
                                      <div className="bg-blue-600 px-5 py-3 flex justify-between items-center text-white">
                                          <h3 className="font-bold flex items-center gap-2 text-lg"><Building2 size={20}/> {prop.name}</h3>
                                      </div>

                                      {/* --- PHẦN 1: CÁC HẠNG PHÒNG (TỐI GIẢN) --- */}
                                      <div className="p-4 md:p-5 border-b border-gray-100 bg-gray-50/50">
                                          <div className="flex justify-between items-center mb-3">
                                              <h4 className="font-bold text-gray-700 flex items-center gap-2"><BedDouble size={18}/> Các Hạng phòng lựa chọn</h4>
                                              <button onClick={() => handleAddRoomType(prop.id)} className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 hover:bg-blue-50 transition-colors shadow-sm">
                                                  <Plus size={16}/> Thêm Hạng phòng
                                              </button>
                                          </div>
                                          
                                          {typesInProp.length === 0 ? (
                                              <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">Hãy thêm ít nhất 1 hạng phòng để có thể gán cho các phòng nhé!</div>
                                          ) : (
                                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                                  {typesInProp.map(type => (
                                                      <div key={type.id} className="bg-white border border-gray-200 px-3 py-2.5 rounded-xl shadow-sm flex items-center justify-between relative group hover:border-blue-300 transition-colors min-h-[3rem]">
                                                          {editingId === type.id ? (
                                                              <div className="w-full flex-1 -ml-1">
                                                                  <InlineInput value={type.name} autoSelect onSave={(v) => { DataService.saveRoomTypes(roomTypes.map(t => t.id === type.id ? {...t, name: v} : t)); setEditingId(null); }} onCancel={() => setEditingId(null)} />
                                                              </div>
                                                          ) : (
                                                              <>
                                                                  <span className="font-bold text-gray-800 break-words pr-12 line-clamp-1">{type.name}</span>
                                                                  <div className="flex gap-1 absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                      <button onClick={() => setEditingId(type.id)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" title="Đổi tên hạng"><Edit2 size={16}/></button>
                                                                      <button onClick={() => confirmDelete('roomTypes', type.id, `Hạng ${type.name}`)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Xóa hạng"><Trash2 size={16}/></button>
                                                                  </div>
                                                              </>
                                                          )}
                                                      </div>
                                                  ))}
                                              </div>
                                          )}
                                      </div>

                                      {/* --- PHẦN 2: DANH SÁCH SỐ PHÒNG (KÉO THẢ SẮP XẾP) --- */}
                                      <div className="p-4 md:p-5">
                                          <div className="flex justify-between items-center mb-4">
                                              <h4 className="font-bold text-gray-700 flex items-center gap-2"><Key size={18}/> Danh sách Số phòng</h4>
                                              <div className="flex items-center gap-2">
                                                  {roomsInProp.length > 1 && (
                                                      <div className="flex bg-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                                                          <button onClick={() => handleSortRoomsAZ(prop.id, true)} className="px-3 py-1.5 hover:bg-gray-200 text-gray-600 text-xs font-bold border-r border-gray-200 flex items-center gap-1">A-Z</button>
                                                          <button onClick={() => handleSortRoomsAZ(prop.id, false)} className="px-3 py-1.5 hover:bg-gray-200 text-gray-600 text-xs font-bold flex items-center gap-1">Z-A</button>
                                                      </div>
                                                  )}
                                                  <button 
                                                    onClick={() => {
                                                        if(typesInProp.length === 0) return alert('Hãy tạo ít nhất 1 Hạng phòng trước!');
                                                        handleAddRoom(prop.id, typesInProp[0].id);
                                                    }} 
                                                    className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1 hover:bg-blue-200 transition-colors"
                                                  >
                                                      <Plus size={16}/> Thêm Phòng
                                                  </button>
                                              </div>
                                          </div>
                                          
                                          {roomsInProp.length === 0 ? (
                                              <div className="text-center text-gray-400 py-6 border-2 border-dashed border-gray-200 rounded-xl">Chưa có phòng nào. Bấm "Thêm Phòng" để tạo.</div>
                                          ) : (
                                              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                                                  {roomsInProp.map((room, rIdx) => (
                                                      <div 
                                                          key={room.id}
                                                          draggable={editingId !== room.id}
                                                          onDragStart={(e) => { e.stopPropagation(); setDraggedRoom({ propId: prop.id, idx: rIdx }); }}
                                                          onDragOver={(e) => e.preventDefault()}
                                                          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropRoom(prop.id, rIdx); }}
                                                          className={`flex flex-col gap-2 border border-slate-200 bg-white rounded-xl p-2 transition-all group ${draggedRoom?.idx === rIdx && draggedRoom?.propId === prop.id ? 'opacity-30 scale-95 border-dashed border-blue-400' : ''} ${editingId !== room.id ? 'cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-md' : 'shadow-lg border-blue-500 scale-105 z-10'}`}
                                                      >
                                                          {/* Khi bấm sửa số phòng, khung nhập liệu sẽ chiếm toàn bộ card để không bị đẩy lệch */}
                                                          {editingId === room.id ? (
                                                              <div className="w-full">
                                                                  <InlineInput 
                                                                    value={room.number} 
                                                                    autoSelect 
                                                                    onSave={(v) => { DataService.saveRooms(rooms.map(r => r.id === room.id ? {...r, number: v} : r)); setEditingId(null); }} 
                                                                    onCancel={() => setEditingId(null)} 
                                                                  />
                                                              </div>
                                                          ) : (
                                                              <>
                                                                  <div className="flex items-center justify-between">
                                                                      <GripVertical size={16} className="text-gray-300 group-hover:text-blue-500 shrink-0" />
                                                                      <span className="font-black text-gray-800 text-lg flex-1 text-center truncate px-1">{room.number}</span>
                                                                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                                          <button onClick={() => setEditingId(room.id)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" title="Đổi tên"><Edit2 size={15}/></button>
                                                                          <button onClick={() => confirmDelete('rooms', room.id, `Phòng ${room.number}`)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Xóa"><X size={17}/></button>
                                                                      </div>
                                                                  </div>
                                                                  
                                                                  <select 
                                                                      className={`w-full text-xs font-semibold p-1.5 rounded-md border outline-none cursor-pointer ${!typesInProp.some(t => t.id === room.typeId) ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-white focus:border-blue-500'}`}
                                                                      value={room.typeId || ''}
                                                                      onChange={(e) => handleRoomTypeChange(room.id, e.target.value)}
                                                                  >
                                                                      {!typesInProp.some(t => t.id === room.typeId) && <option value={room.typeId} className="hidden">--- Chọn hạng phòng ---</option>}
                                                                      {typesInProp.map(t => (
                                                                          <option key={t.id} value={t.id}>{t.name}</option>
                                                                      ))}
                                                                  </select>
                                                              </>
                                                          )}
                                                      </div>
                                                  ))}
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              )
                          })}
                      </div>
                  </div>
              </div>
          )}

          {/* TAB 3: PHÂN QUYỀN (SỬ DỤNG LẠI COMPONENT ADMIN) */}
          {activeTab === 'ADMIN' && (
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm animate-fade-in">
                 <Admin users={users} properties={properties} onRefresh={onRefresh} />
              </div>
          )}

          {/* TAB 4: ADVANCED (TAGS & DANH MỤC THU CHI) */}
          {activeTab === 'ADVANCED' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                  {/* Quản lý Thẻ (Tags) */}
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                       <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-gray-800 flex items-center gap-2"><TagIcon size={18} className="text-blue-600"/> Thẻ phân loại (Tags)</h2>
                            <button onClick={() => DataService.saveTags([...tags, { id: `t_${Date.now()}`, name: 'Thẻ mới', color: '#3b82f6' }])} className="text-sm bg-white border border-gray-300 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50">Thêm thẻ</button>
                       </div>
                       <div className="p-5 space-y-3">
                            {tags.map(tag => (
                                <div key={tag.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <input type="color" value={tag.color} onChange={(e) => DataService.saveTags(tags.map(t => t.id === tag.id ? {...t, color: e.target.value} : t))} className="w-8 h-8 rounded cursor-pointer border-none" />
                                    <input type="text" value={tag.name} onChange={(e) => DataService.saveTags(tags.map(t => t.id === tag.id ? {...t, name: e.target.value} : t))} className="flex-1 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none px-1 text-sm font-medium" />
                                    <button onClick={() => confirmDelete('tags', tag.id, `Thẻ ${tag.name}`)} className="text-red-500 hover:bg-red-100 p-1.5 rounded-md"><Trash2 size={16}/></button>
                                </div>
                            ))}
                       </div>
                  </div>

                  {/* Quản lý Danh mục Thu/Chi */}
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                       <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-gray-800 flex items-center gap-2"><DollarSign size={18} className="text-green-600"/> Danh mục Thu / Chi</h2>
                            <button onClick={() => DataService.saveTransactionCategories([...DataService.getTransactionCategories(), { id: `cat_${Date.now()}`, name: 'Danh mục mới', type: 'EXPENSE' }])} className="text-sm bg-white border border-gray-300 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50">Thêm danh mục</button>
                       </div>
                       <div className="p-5 space-y-3">
                            {DataService.getTransactionCategories().map(cat => (
                                <div key={cat.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <select 
                                        className={`text-xs font-bold px-2 py-1 rounded-md outline-none border-none ${cat.type === 'REVENUE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                        value={cat.type}
                                        onChange={(e) => DataService.saveTransactionCategories(DataService.getTransactionCategories().map(c => c.id === cat.id ? {...c, type: e.target.value as 'REVENUE'|'EXPENSE'} : c))}
                                    >
                                        <option value="REVENUE">THU</option>
                                        <option value="EXPENSE">CHI</option>
                                    </select>
                                    <input type="text" value={cat.name} onChange={(e) => DataService.saveTransactionCategories(DataService.getTransactionCategories().map(c => c.id === cat.id ? {...c, name: e.target.value} : c))} className="flex-1 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none px-1 text-sm font-medium" />
                                    <button onClick={() => confirmDelete('transactionCategories', cat.id, `Danh mục ${cat.name}`)} className="text-red-500 hover:bg-red-100 p-1.5 rounded-md"><Trash2 size={16}/></button>
                                </div>
                            ))}
                       </div>
                  </div>
              </div>
          )}

      </div>

      {/* --- MODAL XÁC NHẬN XÓA CHUNG --- */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
                  <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{deleteModal.title}</h3>
                  <p className="text-gray-500 text-sm mb-6">Hành động này không thể hoàn tác. Bạn chắc chắn chứ?</p>
                  <div className="flex gap-3">
                      <button onClick={() => setDeleteModal({...deleteModal, isOpen: false})} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors">Huỷ bỏ</button>
                      <button onClick={deleteModal.onConfirm} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-lg shadow-red-200 transition-colors">Xác nhận xoá</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Management;