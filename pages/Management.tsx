
import React, { useState, useEffect, useRef } from 'react';
import { User, Room, RoomType, Property, RoomStatus, Tag, TransactionCategory, PERMISSIONS } from '../types';
import { DataService } from '../services/dataService';
import { 
    Plus, Trash2, Save, X, Settings, GripVertical, 
    Building2, DollarSign, Tag as TagIcon, ArrowDownAZ, ArrowUpZA, ArrowUp, ArrowDown
} from 'lucide-react';

interface ManagementProps {
  users: User[];
  rooms: Room[];
  roomTypes: RoomType[];
  properties: Property[];
  tags: Tag[];
  onRefresh: () => void;
}

// --- SUB-COMPONENT: INLINE INPUT ---
const InlineInput = ({ 
    value, 
    onSave, 
    placeholder, 
    className, 
    type = "text" 
}: { 
    value: string | number, 
    onSave: (val: string) => void, 
    placeholder?: string, 
    className?: string,
    type?: string
}) => {
    const [localVal, setLocalVal] = useState(value);

    useEffect(() => { setLocalVal(value); }, [value]);

    const handleBlur = () => {
        if (localVal.toString() !== value.toString()) {
            onSave(localVal.toString());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    return (
        <input 
            type={type}
            className={`bg-transparent outline-none border border-transparent focus:border-blue-300 focus:bg-white rounded px-2 py-1 transition-all ${className}`}
            value={localVal}
            onChange={(e) => setLocalVal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
        />
    );
};

const Management: React.FC<ManagementProps> = ({ users, rooms, roomTypes, properties, tags, onRefresh }) => {
  // --- STATE ---
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // Quick Add States
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypePrice, setNewTypePrice] = useState('');

  // --- DRAG & DROP REFS ---
  // Store the indices of the item being dragged and the item being hovered over
  const dragItem = useRef<{ type: 'PROPERTY' | 'ROOM', index: number, parentId?: string } | null>(null);
  const dragOverItem = useRef<{ type: 'PROPERTY' | 'ROOM', index: number, parentId?: string } | null>(null);
  
  // State to trigger re-render for visual feedback (highlighting drop target)
  const [isDragging, setIsDragging] = useState(false);

  // --- DRAG HANDLERS: PROPERTIES ---
  const onPropDragStart = (e: React.DragEvent, index: number) => {
      dragItem.current = { type: 'PROPERTY', index };
      setIsDragging(true);
      // Hack to remove the ghost image background if desired, or leave default
  };

  const onPropDragEnter = (e: React.DragEvent, index: number) => {
      if (!dragItem.current || dragItem.current.type !== 'PROPERTY') return;
      dragOverItem.current = { type: 'PROPERTY', index };
      // Force update to show highlight? In simple list, CSS :hover might conflict with drag. 
      // We can use a lightweight state if we want complex highlights, but for now we rely on logical order swap on drop.
  };

  const onPropDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      
      const source = dragItem.current;
      const destination = dragOverItem.current;

      if (!source || !destination || source.type !== 'PROPERTY' || destination.type !== 'PROPERTY' || source.index === destination.index) {
          dragItem.current = null;
          dragOverItem.current = null;
          return;
      }

      // Reorder Logic
      const _props = [...properties];
      const draggedItemContent = _props.splice(source.index, 1)[0];
      _props.splice(destination.index, 0, draggedItemContent);

      // Re-index sortOrder
      const reindexed = _props.map((item, idx) => ({ ...item, sortOrder: idx }));
      DataService.saveProperties(reindexed);
      
      dragItem.current = null;
      dragOverItem.current = null;
      onRefresh();
  };

  // --- DRAG HANDLERS: ROOMS ---
  const onRoomDragStart = (e: React.DragEvent, index: number, propertyId: string) => {
      e.stopPropagation(); // Stop propagation to avoid triggering property drag
      dragItem.current = { type: 'ROOM', index, parentId: propertyId };
      setIsDragging(true);
  };

  const onRoomDragEnter = (e: React.DragEvent, index: number, propertyId: string) => {
      e.stopPropagation();
      // Ensure we are dragging a room AND within the same property
      if (!dragItem.current || dragItem.current.type !== 'ROOM' || dragItem.current.parentId !== propertyId) return;
      dragOverItem.current = { type: 'ROOM', index, parentId: propertyId };
  };

  const onRoomDrop = (e: React.DragEvent, propertyId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const source = dragItem.current;
      const destination = dragOverItem.current;

      if (!source || !destination || source.type !== 'ROOM' || destination.type !== 'ROOM' || source.parentId !== destination.parentId || source.index === destination.index) {
          dragItem.current = null;
          dragOverItem.current = null;
          return;
      }

      // 1. Get rooms for this property only (sorted)
      const propRooms = rooms
          .filter(r => r.propertyId === propertyId)
          .sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));

      // 2. Perform Swap in the subset
      const draggedRoomContent = propRooms.splice(source.index, 1)[0];
      propRooms.splice(destination.index, 0, draggedRoomContent);

      // 3. Update sortOrder for the subset
      propRooms.forEach((r, idx) => { r.sortOrder = idx; });

      // 4. Merge back into global rooms array
      const newGlobalRooms = rooms.map(r => {
          // If room is in the modified subset, return the modified version
          const found = propRooms.find(pr => pr.id === r.id);
          return found ? found : r;
      });

      DataService.saveRooms(newGlobalRooms);
      
      dragItem.current = null;
      dragOverItem.current = null;
      onRefresh();
  };

  // --- SORTING HELPERS ---
  const moveItem = (list: any[], index: number, direction: 'UP' | 'DOWN', saveFn: (items: any[]) => void) => {
      const newList = [...list];
      if (direction === 'UP' && index > 0) {
          [newList[index], newList[index - 1]] = [newList[index - 1], newList[index]];
      } else if (direction === 'DOWN' && index < newList.length - 1) {
          [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
      } else {
          return;
      }
      // Re-index sortOrder
      const reindexed = newList.map((item, idx) => ({ ...item, sortOrder: idx }));
      saveFn(reindexed);
      onRefresh();
  };

  // --- AUTO SORT ROOMS ---
  const handleAutoSortRooms = (propertyId: string, direction: 'ASC' | 'DESC') => {
      if (!confirm(`Bạn có chắc muốn sắp xếp lại toàn bộ phòng của chi nhánh này theo tên (${direction === 'ASC' ? 'A->Z' : 'Z->A'})?`)) return;

      // 1. Get rooms for this prop
      const propRooms = rooms.filter(r => r.propertyId === propertyId);

      // 2. Sort them locally using natural sort order (numeric: true handles "Room 2" vs "Room 10" correctly)
      propRooms.sort((a, b) => {
          return direction === 'ASC'
              ? a.number.localeCompare(b.number, 'vi', { numeric: true })
              : b.number.localeCompare(a.number, 'vi', { numeric: true });
      });

      // 3. Update sortOrder based on new index
      propRooms.forEach((r, idx) => { r.sortOrder = idx; });

      // 4. Merge back
      const newGlobalRooms = rooms.map(r => {
          const found = propRooms.find(pr => pr.id === r.id);
          return found ? found : r;
      });

      // 5. Save
      DataService.saveRooms(newGlobalRooms);
      onRefresh();
  };

  // --- ACTIONS: MASTER DATA ---
  const handleAddType = () => {
      if (!newTypeName) return;
      const newType: RoomType = {
          id: `rt${Date.now()}`,
          name: newTypeName,
          price: Number(newTypePrice) || 0,
          capacity: 2,
          sortOrder: roomTypes.length
      };
      DataService.saveRoomTypes([...roomTypes, newType]);
      setNewTypeName('');
      setNewTypePrice('');
      onRefresh();
  };

  const handleUpdateType = (id: string, field: keyof RoomType, val: any) => {
      const updated = roomTypes.map(t => t.id === id ? { ...t, [field]: val } : t);
      DataService.saveRoomTypes(updated);
      onRefresh();
  };

  const handleDeleteType = (id: string) => {
      if (confirm("Xóa hạng phòng này? Các phòng thuộc hạng này sẽ bị mất liên kết.")) {
          DataService.saveRoomTypes(roomTypes.filter(t => t.id !== id));
          onRefresh();
      }
  };

  // --- ACTIONS: PROPERTIES ---
  const handleAddProperty = () => {
      const newProp: Property = {
          id: `p${Date.now()}`,
          name: 'Chi nhánh mới',
          address: '',
          sortOrder: properties.length
      };
      DataService.saveProperties([...properties, newProp]);
      onRefresh();
  };

  const handleUpdateProperty = (id: string, field: keyof Property, val: any) => {
      const updated = properties.map(p => p.id === id ? { ...p, [field]: val } : p);
      DataService.saveProperties(updated);
      onRefresh();
  };

  const handleDeleteProperty = (id: string) => {
      if (confirm("CẢNH BÁO: Xóa chi nhánh sẽ xóa toàn bộ phòng thuộc chi nhánh đó!")) {
          DataService.saveProperties(properties.filter(p => p.id !== id));
          DataService.saveRooms(rooms.filter(r => r.propertyId !== id));
          onRefresh();
      }
  };

  // --- ACTIONS: ROOMS ---
  const handleAddRoom = (propertyId: string) => {
      const defaultType = roomTypes.length > 0 ? roomTypes[0].id : '';
      const roomsInProp = rooms.filter(r => r.propertyId === propertyId);
      const maxOrder = roomsInProp.length > 0 ? Math.max(...roomsInProp.map(r => r.sortOrder || 0)) : -1;

      const newRoom: Room = {
          id: `r${Date.now()}`,
          number: `P${roomsInProp.length + 101}`,
          typeId: defaultType,
          propertyId: propertyId,
          status: RoomStatus.VACANT_CLEAN,
          floor: 1,
          sortOrder: maxOrder + 1
      };
      DataService.saveRooms([...rooms, newRoom]);
      onRefresh();
  };

  const handleUpdateRoom = (id: string, field: keyof Room, val: any) => {
      const updated = rooms.map(r => r.id === id ? { ...r, [field]: val } : r);
      DataService.saveRooms(updated);
      onRefresh();
  };

  const handleDeleteRoom = (id: string) => {
      if (confirm("Xóa phòng này?")) {
          DataService.saveRooms(rooms.filter(r => r.id !== id));
          onRefresh();
      }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] animate-fade-in space-y-6 pb-20 md:pb-0">
      
      {/* --- HEADER: SETTINGS & TITLE --- */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div>
              <h2 className="text-xl font-bold text-gray-800">Cấu hình Hệ thống</h2>
              <p className="text-xs text-gray-500">Kéo thả để sắp xếp vị trí hiển thị trên Sơ đồ phòng.</p>
          </div>
          <button 
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors"
          >
              <Settings size={18}/> <span className="hidden md:inline">Tag & Tài chính</span>
          </button>
      </div>

      {/* --- SECTION 1: MASTER DATA (ROOM TYPES) --- */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center gap-2">
              <DollarSign size={14}/> Danh mục Hạng phòng (Giá tham khảo)
          </h3>
          
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar pb-2">
              {roomTypes.map((type) => (
                  <div key={type.id} className="flex-shrink-0 group relative bg-orange-50 border border-orange-100 rounded-lg p-3 min-w-[180px] hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-1">
                          <InlineInput 
                              value={type.name} 
                              onSave={(v) => handleUpdateType(type.id, 'name', v)}
                              className="font-bold text-gray-800 w-28"
                          />
                          <button onClick={() => handleDeleteType(type.id)} className="text-orange-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                              <X size={14} />
                          </button>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                          <DollarSign size={12} className="text-orange-400"/>
                          <InlineInput 
                              value={type.price} 
                              onSave={(v) => handleUpdateType(type.id, 'price', Number(v))}
                              type="number"
                              className="w-20 font-mono"
                          />
                      </div>
                  </div>
              ))}

              <div className="flex-shrink-0 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 min-w-[180px] flex flex-col gap-2 justify-center">
                  <input 
                    placeholder="Tên hạng mới..." 
                    className="bg-white border border-gray-200 rounded px-2 py-1 text-sm outline-none focus:border-blue-400"
                    value={newTypeName}
                    onChange={e => setNewTypeName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddType()}
                  />
                  <div className="flex gap-2">
                      <input 
                        type="number"
                        placeholder="Giá..." 
                        className="bg-white border border-gray-200 rounded px-2 py-1 text-sm outline-none focus:border-blue-400 w-full"
                        value={newTypePrice}
                        onChange={e => setNewTypePrice(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddType()}
                      />
                      <button onClick={handleAddType} className="bg-blue-600 text-white p-1 rounded hover:bg-blue-700">
                          <Plus size={18}/>
                      </button>
                  </div>
              </div>
          </div>
      </div>

      {/* --- SECTION 2: HIERARCHY (BRANCHES & ROOMS) --- */}
      <div className="flex-1 space-y-6 overflow-y-auto pr-2 pb-20">
          
          {properties.map((prop, propIdx) => (
              <div 
                key={prop.id} 
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in transition-all"
                draggable
                onDragStart={(e) => onPropDragStart(e, propIdx)}
                onDragEnter={(e) => onPropDragEnter(e, propIdx)}
                onDragEnd={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDragOver={(e) => e.preventDefault()} // Allow drop
                onDrop={onPropDrop}
              >
                  {/* BRANCH HEADER */}
                  <div className={`bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center group cursor-grab active:cursor-grabbing hover:bg-gray-100 transition-colors
                      ${isDragging && dragItem.current?.type === 'PROPERTY' && dragItem.current.index === propIdx ? 'opacity-50 border-2 border-dashed border-blue-300' : ''}
                  `}>
                      <div className="flex items-center gap-3">
                          <GripVertical className="text-gray-400" size={20} />
                          <Building2 className="text-blue-600" size={20} />
                          <InlineInput 
                              value={prop.name} 
                              onSave={(v) => handleUpdateProperty(prop.id, 'name', v)}
                              className="font-bold text-lg text-gray-800 bg-transparent"
                          />
                          <span className="text-xs text-gray-400 font-mono hidden md:inline">ID: {prop.id}</span>
                      </div>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* AUTO SORT BUTTONS */}
                          <div className="flex bg-white rounded border border-gray-200 mr-2">
                              <button 
                                onClick={() => handleAutoSortRooms(prop.id, 'ASC')} 
                                className="p-1.5 hover:bg-blue-50 text-gray-500 hover:text-blue-600 border-r border-gray-100" 
                                title="Sắp xếp tên phòng A -> Z"
                              >
                                  <ArrowDownAZ size={16}/>
                              </button>
                              <button 
                                onClick={() => handleAutoSortRooms(prop.id, 'DESC')} 
                                className="p-1.5 hover:bg-blue-50 text-gray-500 hover:text-blue-600" 
                                title="Sắp xếp tên phòng Z -> A"
                              >
                                  <ArrowUpZA size={16}/>
                              </button>
                          </div>

                          <button onClick={() => moveItem(properties, propIdx, 'UP', DataService.saveProperties)} className="p-1.5 hover:bg-white rounded text-gray-500 hover:text-blue-600" title="Lên"><ArrowUp size={16}/></button>
                          <button onClick={() => moveItem(properties, propIdx, 'DOWN', DataService.saveProperties)} className="p-1.5 hover:bg-white rounded text-gray-500 hover:text-blue-600" title="Xuống"><ArrowDown size={16}/></button>
                          <div className="w-px h-4 bg-gray-300 mx-1"></div>
                          <button onClick={() => handleDeleteProperty(prop.id)} className="p-1.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-600" title="Xóa chi nhánh">
                              <Trash2 size={16}/>
                          </button>
                      </div>
                  </div>

                  {/* ROOM LIST */}
                  <div className="p-2 md:p-4 bg-white">
                      <table className="w-full text-sm">
                          <thead className="text-xs text-gray-400 uppercase font-medium border-b">
                              <tr>
                                  <th className="pb-2 pl-2 text-left w-10"></th>
                                  <th className="pb-2 text-left w-1/4">Số phòng</th>
                                  <th className="pb-2 text-left w-1/3">Hạng phòng</th>
                                  <th className="pb-2 text-left">Trạng thái</th>
                                  <th className="pb-2 text-right">#</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                              {rooms
                                .filter(r => r.propertyId === prop.id)
                                .sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0))
                                .map((room, rIdx) => (
                                  <tr 
                                    key={room.id} 
                                    className={`group hover:bg-blue-50/30 transition-colors
                                        ${isDragging && dragItem.current?.type === 'ROOM' && dragItem.current.index === rIdx && dragItem.current.parentId === prop.id ? 'opacity-30 bg-blue-50' : ''}
                                    `}
                                    draggable
                                    onDragStart={(e) => onRoomDragStart(e, rIdx, prop.id)}
                                    onDragEnter={(e) => onRoomDragEnter(e, rIdx, prop.id)}
                                    onDragEnd={(e) => { e.preventDefault(); setIsDragging(false); }}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => onRoomDrop(e, prop.id)}
                                  >
                                      <td className="py-2 pl-2 text-gray-300 cursor-grab active:cursor-grabbing"><GripVertical size={16}/></td>
                                      
                                      {/* Room Number Input */}
                                      <td className="py-2">
                                          <InlineInput 
                                              value={room.number}
                                              onSave={(v) => handleUpdateRoom(room.id, 'number', v)}
                                              className="font-bold text-gray-800 text-base"
                                          />
                                      </td>

                                      {/* Room Type Select */}
                                      <td className="py-2">
                                          <select 
                                              className="bg-transparent border border-transparent hover:border-gray-200 rounded px-2 py-1 outline-none text-gray-600 cursor-pointer w-full max-w-[200px]"
                                              value={room.typeId}
                                              onChange={(e) => handleUpdateRoom(room.id, 'typeId', e.target.value)}
                                          >
                                              <option value="">-- Chọn hạng --</option>
                                              {roomTypes.map(t => (
                                                  <option key={t.id} value={t.id}>{t.name}</option>
                                              ))}
                                          </select>
                                      </td>

                                      <td className="py-2">
                                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${room.status === RoomStatus.VACANT_CLEAN ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                              {room.status}
                                          </span>
                                      </td>

                                      {/* Actions */}
                                      <td className="py-2 text-right">
                                          <button onClick={() => handleDeleteRoom(room.id)} className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>

                      {/* Add Room Footer */}
                      <button 
                          onClick={() => handleAddRoom(prop.id)}
                          className="w-full mt-2 py-2 border-2 border-dashed border-gray-100 rounded-lg text-gray-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all text-sm font-bold flex items-center justify-center gap-2"
                      >
                          <Plus size={16}/> Thêm phòng vào {prop.name}
                      </button>
                  </div>
              </div>
          ))}

          {/* ADD BRANCH BLOCK */}
          <button 
              onClick={handleAddProperty}
              className="w-full py-4 bg-gray-100 hover:bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-all font-bold flex items-center justify-center gap-2"
          >
              <Building2 size={20}/> Thêm Chi Nhánh Mới
          </button>
      </div>

      {/* --- MODAL: ADVANCED SETTINGS (Tags & Finance) --- */}
      {showSettingsModal && (
          <SettingsModal 
            isOpen={showSettingsModal} 
            onClose={() => setShowSettingsModal(false)} 
            tags={tags}
            onRefresh={onRefresh}
          />
      )}

    </div>
  );
};

// --- SUB-COMPONENT: SETTINGS MODAL (Tags & Finance) ---
const SettingsModal = ({ isOpen, onClose, tags, onRefresh }: any) => {
    const [tab, setTab] = useState<'TAGS' | 'FINANCE'>('TAGS');
    const [newTag, setNewTag] = useState({ name: '', color: '#3b82f6' });
    const [newCat, setNewCat] = useState<Partial<TransactionCategory>>({ type: 'REVENUE' });
    
    // Fetch categories directly
    const categories = DataService.getTransactionCategories();

    if (!isOpen) return null;

    const handleSaveTag = () => {
        if(!newTag.name) return;
        DataService.saveTags([...tags, { id: `tag${Date.now()}`, ...newTag }]);
        setNewTag({ name: '', color: '#3b82f6' });
        onRefresh();
    };
    const handleDeleteTag = (id: string) => {
        DataService.saveTags(tags.filter((t: any) => t.id !== id));
        onRefresh();
    };

    const handleSaveCat = () => {
        if(!newCat.name) return;
        DataService.saveTransactionCategories([...categories, { id: `cat${Date.now()}`, ...newCat } as TransactionCategory]);
        setNewCat({ name: '', type: 'REVENUE' });
        onRefresh();
    };
    const handleDeleteCat = (id: string) => {
        DataService.saveTransactionCategories(categories.filter(c => c.id !== id));
        onRefresh();
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg h-[80vh] flex flex-col animate-fade-in overflow-hidden">
                <div className="flex border-b">
                    <button onClick={() => setTab('TAGS')} className={`flex-1 py-4 font-bold text-sm ${tab==='TAGS'?'border-b-2 border-blue-600 text-blue-700 bg-blue-50':'text-gray-500'}`}>Quản lý Tag</button>
                    <button onClick={() => setTab('FINANCE')} className={`flex-1 py-4 font-bold text-sm ${tab==='FINANCE'?'border-b-2 border-green-600 text-green-700 bg-green-50':'text-gray-500'}`}>Loại Thu/Chi</button>
                    <button onClick={onClose} className="px-4 text-gray-400 hover:text-gray-600"><X size={24}/></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                    {tab === 'TAGS' && (
                        <div className="space-y-4">
                            <div className="flex gap-2 p-3 bg-white rounded border">
                                <input className="flex-1 outline-none text-sm" placeholder="Tên Tag..." value={newTag.name} onChange={e => setNewTag({...newTag, name: e.target.value})} />
                                <input type="color" className="w-8 h-8 rounded cursor-pointer border-none" value={newTag.color} onChange={e => setNewTag({...newTag, color: e.target.value})} />
                                <button onClick={handleSaveTag} className="bg-blue-600 text-white p-2 rounded"><Plus size={16}/></button>
                            </div>
                            <div className="space-y-2">
                                {tags.map((t: any) => (
                                    <div key={t.id} className="flex justify-between items-center p-3 bg-white border rounded">
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded-full" style={{backgroundColor: t.color}}></div>
                                            <span className="font-bold text-sm">{t.name}</span>
                                        </div>
                                        <button onClick={() => handleDeleteTag(t.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {tab === 'FINANCE' && (
                        <div className="space-y-4">
                            <div className="flex gap-2 p-3 bg-white rounded border">
                                <input className="flex-1 outline-none text-sm" placeholder="Tên khoản mục..." value={newCat.name || ''} onChange={e => setNewCat({...newCat, name: e.target.value})} />
                                <select className="text-sm outline-none border-l pl-2" value={newCat.type} onChange={e => setNewCat({...newCat, type: e.target.value as any})}>
                                    <option value="REVENUE">Thu (+)</option>
                                    <option value="EXPENSE">Chi (-)</option>
                                </select>
                                <button onClick={handleSaveCat} className="bg-green-600 text-white p-2 rounded"><Plus size={16}/></button>
                            </div>
                            <div className="space-y-2">
                                {categories.map(c => (
                                    <div key={c.id} className="flex justify-between items-center p-3 bg-white border rounded">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${c.type==='REVENUE'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{c.type === 'REVENUE' ? 'THU' : 'CHI'}</span>
                                            <span className="font-bold text-sm">{c.name}</span>
                                        </div>
                                        <button onClick={() => handleDeleteCat(c.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Management;
