import React, { useState } from 'react';
import { User, Room, RoomType, Property, RoomStatus } from '../types';
import { DataService } from '../services/dataService';
import { Plus, Trash2, Save, X } from 'lucide-react';

interface ManagementProps {
  users: User[];
  rooms: Room[];
  roomTypes: RoomType[];
  properties: Property[];
  onRefresh: () => void;
}

const Management: React.FC<ManagementProps> = ({ users, rooms, roomTypes, properties, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'ROOMS' | 'TYPES' | 'BRANCHES' | 'USERS'>('ROOMS');

  // --- CRUD States ---
  const [newRoom, setNewRoom] = useState<Partial<Room>>({});
  const [newType, setNewType] = useState<Partial<RoomType>>({});
  const [newProp, setNewProp] = useState<Partial<Property>>({});
  // Users already handled in Admin.tsx logic but moved here

  // --- Handlers ---
  const handleAddRoom = () => {
      if(!newRoom.number || !newRoom.typeId || !newRoom.propertyId) return alert("Thiếu thông tin");
      const r: Room = {
          id: `r${Date.now()}`,
          number: newRoom.number,
          typeId: newRoom.typeId,
          propertyId: newRoom.propertyId,
          floor: Number(newRoom.floor) || 1,
          status: RoomStatus.VACANT_CLEAN
      };
      DataService.saveRooms([...rooms, r]);
      setNewRoom({});
      onRefresh();
  };

  const handleDeleteRoom = (id: string) => {
      if(confirm("Xác nhận xoá phòng? Phòng sẽ biến mất khỏi sơ đồ và toàn bộ hệ thống ngay lập tức.")) {
          DataService.saveRooms(rooms.filter(r => r.id !== id));
          onRefresh();
      }
  };

  const handleAddType = () => {
      if(!newType.name) return;
      const t: RoomType = {
          id: `rt${Date.now()}`,
          name: newType.name,
          price: Number(newType.price) || 0,
          capacity: Number(newType.capacity) || 1
      };
      DataService.saveRoomTypes([...roomTypes, t]);
      setNewType({});
      onRefresh();
  };

  const handleDeleteType = (id: string) => {
     if(confirm("Xoá hạng phòng? Các phòng thuộc hạng này sẽ bị lỗi.")) {
         DataService.saveRoomTypes(roomTypes.filter(t => t.id !== id));
         onRefresh();
     }
  };
  
  const handleAddProp = () => {
      if(!newProp.name) return;
      const p: Property = {
          id: `p${Date.now()}`,
          name: newProp.name,
          address: newProp.address || ''
      };
      DataService.saveProperties([...properties, p]);
      setNewProp({});
      onRefresh();
  };

  const handleDeleteProp = (id: string) => {
      if(confirm("Xoá chi nhánh? Dữ liệu liên quan sẽ mất kết nối.")) {
          DataService.saveProperties(properties.filter(p => p.id !== id));
          onRefresh();
      }
  }

  // Reuse User logic logic from Admin.tsx (simplified here for brevity, assuming users prop passed)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-h-[500px]">
      <div className="flex border-b">
         {['ROOMS', 'TYPES', 'BRANCHES'].map((tab) => (
             <button 
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-6 py-4 font-medium text-sm transition-colors border-b-2 ${activeTab === tab ? 'border-orange-500 text-orange-600 bg-orange-50' : 'border-transparent text-gray-500 hover:bg-gray-50'}`}
             >
                 {tab === 'ROOMS' ? 'Quản lý Phòng' : tab === 'TYPES' ? 'Hạng phòng & Giá' : 'Chi nhánh'}
             </button>
         ))}
      </div>

      <div className="p-6">
          {/* ROOMS TAB */}
          {activeTab === 'ROOMS' && (
              <div className="space-y-6">
                  <div className="grid grid-cols-5 gap-4 bg-gray-50 p-4 rounded-lg border">
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
                      <button onClick={handleAddRoom} className="bg-orange-500 text-white rounded hover:bg-orange-600 flex items-center justify-center gap-2"><Plus size={18}/> Thêm</button>
                  </div>
                  <div className="overflow-auto max-h-[500px]">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-gray-100">
                              <tr><th>Phòng</th><th>Tầng</th><th>Hạng</th><th>Chi nhánh</th><th className="text-right">Xoá</th></tr>
                          </thead>
                          <tbody>
                              {rooms.map(r => (
                                  <tr key={r.id} className="border-b">
                                      <td className="p-3 font-bold">{r.number}</td>
                                      <td className="p-3">{r.floor}</td>
                                      <td className="p-3">{roomTypes.find(t => t.id === r.typeId)?.name}</td>
                                      <td className="p-3">{properties.find(p => p.id === r.propertyId)?.name}</td>
                                      <td className="p-3 text-right"><button onClick={() => handleDeleteRoom(r.id)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16}/></button></td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {/* TYPES TAB */}
          {activeTab === 'TYPES' && (
               <div className="space-y-6">
               <div className="grid grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border">
                   <input placeholder="Tên hạng phòng" className="border p-2 rounded" value={newType.name || ''} onChange={e => setNewType({...newType, name: e.target.value})} />
                   <input placeholder="Giá (VNĐ)" type="number" className="border p-2 rounded" value={newType.price || ''} onChange={e => setNewType({...newType, price: Number(e.target.value)})} />
                   <input placeholder="Sức chứa" type="number" className="border p-2 rounded" value={newType.capacity || ''} onChange={e => setNewType({...newType, capacity: Number(e.target.value)})} />
                   <button onClick={handleAddType} className="bg-orange-500 text-white rounded hover:bg-orange-600 flex items-center justify-center gap-2"><Plus size={18}/> Thêm</button>
               </div>
               <table className="w-full text-sm text-left">
                       <thead className="bg-gray-100">
                           <tr><th>Tên hạng</th><th>Giá chuẩn</th><th>Sức chứa</th><th className="text-right">Xoá</th></tr>
                       </thead>
                       <tbody>
                           {roomTypes.map(t => (
                               <tr key={t.id} className="border-b">
                                   <td className="p-3 font-bold">{t.name}</td>
                                   <td className="p-3">{t.price.toLocaleString()}</td>
                                   <td className="p-3">{t.capacity}</td>
                                   <td className="p-3 text-right"><button onClick={() => handleDeleteType(t.id)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16}/></button></td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </div>
          )}

          {/* BRANCHES TAB */}
           {activeTab === 'BRANCHES' && (
               <div className="space-y-6">
               <div className="grid grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg border">
                   <input placeholder="Tên chi nhánh" className="border p-2 rounded" value={newProp.name || ''} onChange={e => setNewProp({...newProp, name: e.target.value})} />
                   <input placeholder="Địa chỉ" className="border p-2 rounded" value={newProp.address || ''} onChange={e => setNewProp({...newProp, address: e.target.value})} />
                   <button onClick={handleAddProp} className="bg-orange-500 text-white rounded hover:bg-orange-600 flex items-center justify-center gap-2"><Plus size={18}/> Thêm</button>
               </div>
               <table className="w-full text-sm text-left">
                       <thead className="bg-gray-100">
                           <tr><th>Tên chi nhánh</th><th>Địa chỉ</th><th className="text-right">Xoá</th></tr>
                       </thead>
                       <tbody>
                           {properties.map(p => (
                               <tr key={p.id} className="border-b">
                                   <td className="p-3 font-bold">{p.name}</td>
                                   <td className="p-3">{p.address}</td>
                                   <td className="p-3 text-right"><button onClick={() => handleDeleteProp(p.id)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16}/></button></td>
                               </tr>
                           ))}
                       </tbody>
                   </table>
               </div>
          )}
      </div>
    </div>
  );
};

export default Management;