
import React, { useState, useEffect, useRef } from 'react';
import { User, Room, RoomType, Property, RoomStatus, Tag, TransactionCategory, PERMISSIONS } from '../types';
import { DataService } from '../services/dataService';
import { 
    Plus, Trash2, Save, X, Settings, GripVertical, 
    Building2, DollarSign, Tag as TagIcon, ArrowDownAZ, ArrowUpZA, ArrowUp, ArrowDown, CheckSquare, Square, AlertTriangle
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

// --- SUB-COMPONENT: SETTINGS MODAL ---
const SettingsModal = ({ isOpen, onClose, tags, onRefresh }: { isOpen: boolean, onClose: () => void, tags: Tag[], onRefresh: () => void }) => {
    const [activeTab, setActiveTab] = useState<'TAGS' | 'FINANCE'>('TAGS');
    const [categories, setCategories] = useState<TransactionCategory[]>(DataService.getTransactionCategories());

    // Tag State
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6'); // Default Blue

    // Finance State
    const [newCatName, setNewCatName] = useState('');
    const [newCatType, setNewCatType] = useState<'REVENUE' | 'EXPENSE'>('EXPENSE');

    useEffect(() => {
        if (isOpen) {
            setCategories(DataService.getTransactionCategories());
        }
    }, [isOpen]);

    // --- TAG ACTIONS ---
    const handleAddTag = () => {
        if (!newTagName) return;
        const newTag: Tag = {
            id: `tag_${Date.now()}`,
            name: newTagName,
            color: newTagColor
        };
        DataService.saveTags([...tags, newTag]);
        setNewTagName('');
        onRefresh();
    };

    const handleDeleteTag = (id: string) => {
        if (confirm('Xoá tag này?')) {
            DataService.deleteItems('tags', [id]);
            onRefresh();
        }
    };

    // --- FINANCE ACTIONS ---
    const handleAddCategory = () => {
        if (!newCatName) return;
        const newCat: TransactionCategory = {
            id: `cat_${Date.now()}`,
            name: newCatName,
            type: newCatType
        };
        DataService.saveTransactionCategories([...categories, newCat]);
        setNewCatName('');
        setCategories([...categories, newCat]); // Optimistic update for local state
        onRefresh();
    };

    const handleDeleteCategory = (id: string) => {
         if (confirm('Xoá danh mục này?')) {
            DataService.deleteItems('transactionCategories', [id]);
            setCategories(categories.filter(c => c.id !== id));
            onRefresh();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col animate-fade-in relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                
                <div className="p-6 border-b">
                    <h3 className="text-xl font-bold text-gray-800">Cài đặt nâng cao</h3>
                    <div className="flex gap-4 mt-4 border-b border-gray-100">
                        <button 
                            onClick={() => setActiveTab('TAGS')}
                            className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'TAGS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                            Quản lý Tags
                        </button>
                        <button 
                            onClick={() => setActiveTab('FINANCE')}
                            className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'FINANCE' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                            Danh mục Thu/Chi
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                    {activeTab === 'TAGS' && (
                        <div className="space-y-6">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Plus size={16}/> Thêm Tag mới</h4>
                                <div className="flex gap-2">
                                    <input 
                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                                        placeholder="Tên tag (VD: Khách quen)..."
                                        value={newTagName}
                                        onChange={e => setNewTagName(e.target.value)}
                                    />
                                    <input 
                                        type="color" 
                                        className="h-10 w-10 border border-gray-200 rounded-lg cursor-pointer p-1 bg-white"
                                        value={newTagColor}
                                        onChange={e => setNewTagColor(e.target.value)}
                                    />
                                    <button onClick={handleAddTag} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700">Thêm</button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {tags.map(tag => (
                                    <div key={tag.id} className="bg-white p-3 rounded-xl border border-gray-200 flex justify-between items-center group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-4 h-4 rounded-full" style={{backgroundColor: tag.color}}></div>
                                            <span className="font-bold text-gray-700">{tag.name}</span>
                                        </div>
                                        <button onClick={() => handleDeleteTag(tag.id)} className="text-gray-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                                            <Trash2 size={16}/>
                                        </button>
                                    </div>
                                ))}
                                {tags.length === 0 && <p className="text-center text-gray-400 text-sm">Chưa có tag nào.</p>}
                            </div>
                        </div>
                    )}

                    {activeTab === 'FINANCE' && (
                        <div className="space-y-6">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Plus size={16}/> Thêm Danh mục Thu/Chi</h4>
                                <div className="flex gap-2 flex-col md:flex-row">
                                    <input 
                                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                                        placeholder="Tên danh mục (VD: Giặt là, Nước ngọt)..."
                                        value={newCatName}
                                        onChange={e => setNewCatName(e.target.value)}
                                    />
                                    <select 
                                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white"
                                        value={newCatType}
                                        onChange={e => setNewCatType(e.target.value as any)}
                                    >
                                        <option value="REVENUE">Khoản Thu (+)</option>
                                        <option value="EXPENSE">Khoản Chi (-)</option>
                                    </select>
                                    <button onClick={handleAddCategory} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700">Thêm</button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <h5 className="font-bold text-xs text-gray-400 uppercase">Khoản Thu (Revenue)</h5>
                                    {categories.filter(c => c.type === 'REVENUE').map(cat => (
                                        <div key={cat.id} className="bg-white p-3 rounded-xl border border-green-200 flex justify-between items-center group shadow-sm">
                                            <span className="font-bold text-gray-700">{cat.name}</span>
                                            <button onClick={() => handleDeleteCategory(cat.id)} className="text-gray-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                                                <Trash2 size={16}/>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <h5 className="font-bold text-xs text-gray-400 uppercase">Khoản Chi (Expense)</h5>
                                    {categories.filter(c => c.type === 'EXPENSE').map(cat => (
                                        <div key={cat.id} className="bg-white p-3 rounded-xl border border-red-200 flex justify-between items-center group shadow-sm">
                                            <span className="font-bold text-gray-700">{cat.name}</span>
                                            <button onClick={() => handleDeleteCategory(cat.id)} className="text-gray-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                                                <Trash2 size={16}/>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
             </div>
        </div>
    );
};

const Management: React.FC<ManagementProps> = ({ users, rooms, roomTypes, properties, tags, onRefresh }) => {
  // --- STATE ---
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // Custom Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
      isOpen: boolean;
      title: string;
      description: React.ReactNode;
      onConfirm: () => void;
  }>({ isOpen: false, title: '', description: null, onConfirm: () => {} });

  // Quick Add States
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypePrice, setNewTypePrice] = useState('');

  // Bulk Selection States
  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set());
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());

  // --- DRAG & DROP REFS ---
  const dragItem = useRef<{ type: 'PROPERTY' | 'ROOM', index: number, parentId?: string } | null>(null);
  const dragOverItem = useRef<{ type: 'PROPERTY' | 'ROOM', index: number, parentId?: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- BULK SELECTION HELPERS ---
  const toggleSelection = (id: string, setFn: React.Dispatch<React.SetStateAction<Set<string>>>) => {
      setFn(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  const toggleAllRoomsInProperty = (propId: string) => {
      const propRooms = rooms.filter(r => r.propertyId === propId);
      const allSelected = propRooms.every(r => selectedRoomIds.has(r.id));
      
      setSelectedRoomIds(prev => {
          const next = new Set(prev);
          if (allSelected) {
              propRooms.forEach(r => next.delete(r.id));
          } else {
              propRooms.forEach(r => next.add(r.id));
          }
          return next;
      });
  };

  // --- BULK DELETE LOGIC (CASCADING WITH CUSTOM MODAL) ---
  const handleBulkDeleteRoomTypes = () => {
      if (selectedTypeIds.size === 0) return;
      const typesToDelete = roomTypes.filter(t => selectedTypeIds.has(t.id));
      const affectedRooms = rooms.filter(r => selectedTypeIds.has(r.typeId));
      const affectedBookings = DataService.getBookings().filter(b => affectedRooms.some(r => r.id === b.roomId));
      
      setDeleteModal({
          isOpen: true,
          title: `Xoá ${selectedTypeIds.size} Hạng phòng?`,
          description: (
              <div className="space-y-2 text-sm text-gray-600">
                  <p>Bạn sắp xoá các hạng phòng: <b>{typesToDelete.map(t => t.name).join(', ')}</b>.</p>
                  <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                      <p className="font-bold text-red-700 mb-1">Cảnh báo tác động:</p>
                      <ul className="list-disc pl-5 space-y-1 text-red-600">
                          <li>Xoá vĩnh viễn <b>{affectedRooms.length}</b> phòng thuộc các hạng này.</li>
                          <li>Xoá vĩnh viễn <b>{affectedBookings.length}</b> đơn đặt phòng liên quan.</li>
                      </ul>
                  </div>
                  <p className="italic">Dữ liệu không thể khôi phục sau khi xoá.</p>
              </div>
          ),
          onConfirm: () => {
              DataService.deleteItems('bookings', affectedBookings.map(b => b.id));
              DataService.deleteItems('rooms', affectedRooms.map(r => r.id));
              DataService.deleteItems('roomTypes', Array.from(selectedTypeIds));
              setSelectedTypeIds(new Set());
              onRefresh();
              setDeleteModal(prev => ({...prev, isOpen: false}));
          }
      });
  };

  const handleBulkDeleteProperties = () => {
      if (selectedPropIds.size === 0) return;
      const propsToDelete = properties.filter(p => selectedPropIds.has(p.id));
      const affectedRooms = rooms.filter(r => selectedPropIds.has(r.propertyId));
      const affectedBookings = DataService.getBookings().filter(b => affectedRooms.some(r => r.id === b.roomId));
      
      setDeleteModal({
          isOpen: true,
          title: `Xoá ${selectedPropIds.size} Chi nhánh?`,
          description: (
              <div className="space-y-2 text-sm text-gray-600">
                  <p>Bạn sắp xoá các chi nhánh: <b>{propsToDelete.map(p => p.name).join(', ')}</b>.</p>
                  <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                      <p className="font-bold text-red-700 mb-1">Cảnh báo tác động:</p>
                      <ul className="list-disc pl-5 space-y-1 text-red-600">
                          <li>Xoá vĩnh viễn <b>{affectedRooms.length}</b> phòng thuộc chi nhánh.</li>
                          <li>Xoá vĩnh viễn <b>{affectedBookings.length}</b> đơn đặt phòng liên quan.</li>
                      </ul>
                  </div>
              </div>
          ),
          onConfirm: () => {
              DataService.deleteItems('bookings', affectedBookings.map(b => b.id));
              DataService.deleteItems('rooms', affectedRooms.map(r => r.id));
              DataService.deleteItems('properties', Array.from(selectedPropIds));
              setSelectedPropIds(new Set());
              onRefresh();
              setDeleteModal(prev => ({...prev, isOpen: false}));
          }
      });
  };

  const handleBulkDeleteRooms = () => {
      if (selectedRoomIds.size === 0) return;
      const affectedRooms = rooms.filter(r => selectedRoomIds.has(r.id));
      const affectedBookings = DataService.getBookings().filter(b => selectedRoomIds.has(b.roomId));
      
      setDeleteModal({
          isOpen: true,
          title: `Xoá ${selectedRoomIds.size} Phòng?`,
          description: (
              <div className="space-y-2 text-sm text-gray-600">
                  <p>Danh sách phòng bị xoá: <b>{affectedRooms.map(r => r.number).join(', ')}</b>.</p>
                  {affectedBookings.length > 0 && (
                      <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-red-600">
                          <AlertTriangle size={16} className="inline mr-1"/>
                          Sẽ xoá kèm <b>{affectedBookings.length}</b> đơn đặt phòng liên quan.
                      </div>
                  )}
              </div>
          ),
          onConfirm: () => {
              DataService.deleteItems('bookings', affectedBookings.map(b => b.id));
              DataService.deleteItems('rooms', Array.from(selectedRoomIds));
              setSelectedRoomIds(new Set());
              onRefresh();
              setDeleteModal(prev => ({...prev, isOpen: false}));
          }
      });
  };

  const handleSingleDeleteRoom = (room: Room) => {
      const affectedBookings = DataService.getBookings().filter(b => b.roomId === room.id);
      
      setDeleteModal({
          isOpen: true,
          title: `Xoá phòng ${room.number}?`,
          description: (
              <div className="text-sm text-gray-600">
                  {affectedBookings.length > 0 ? (
                      <span className="text-red-600 font-medium">
                          Phòng này đang có {affectedBookings.length} đơn đặt. Nếu xoá phòng, các đơn này cũng sẽ bị xoá vĩnh viễn.
                      </span>
                  ) : (
                      "Bạn có chắc chắn muốn xoá phòng này không?"
                  )}
              </div>
          ),
          onConfirm: () => {
              DataService.deleteItems('bookings', affectedBookings.map(b => b.id));
              DataService.deleteItems('rooms', [room.id]);
              onRefresh();
              setDeleteModal(prev => ({...prev, isOpen: false}));
          }
      });
  };


  // --- DRAG HANDLERS: PROPERTIES ---
  const onPropDragStart = (e: React.DragEvent, index: number) => {
      dragItem.current = { type: 'PROPERTY', index };
      setIsDragging(true);
  };

  const onPropDragEnter = (e: React.DragEvent, index: number) => {
      if (!dragItem.current || dragItem.current.type !== 'PROPERTY') return;
      dragOverItem.current = { type: 'PROPERTY', index };
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

      const _props = [...properties];
      const draggedItemContent = _props.splice(source.index, 1)[0];
      _props.splice(destination.index, 0, draggedItemContent);
      const reindexed = _props.map((item, idx) => ({ ...item, sortOrder: idx }));
      DataService.saveProperties(reindexed);
      
      dragItem.current = null;
      dragOverItem.current = null;
      onRefresh();
  };

  // --- DRAG HANDLERS: ROOMS ---
  const onRoomDragStart = (e: React.DragEvent, index: number, propertyId: string) => {
      e.stopPropagation();
      dragItem.current = { type: 'ROOM', index, parentId: propertyId };
      setIsDragging(true);
  };

  const onRoomDragEnter = (e: React.DragEvent, index: number, propertyId: string) => {
      e.stopPropagation();
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

      const propRooms = rooms
          .filter(r => r.propertyId === propertyId)
          .sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));

      const draggedRoomContent = propRooms.splice(source.index, 1)[0];
      propRooms.splice(destination.index, 0, draggedRoomContent);
      propRooms.forEach((r, idx) => { r.sortOrder = idx; });

      const newGlobalRooms = rooms.map(r => {
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
      const reindexed = newList.map((item, idx) => ({ ...item, sortOrder: idx }));
      saveFn(reindexed);
      onRefresh();
  };

  const handleAutoSortRooms = (propertyId: string, direction: 'ASC' | 'DESC') => {
      const propRooms = rooms.filter(r => r.propertyId === propertyId);
      propRooms.sort((a, b) => {
          // FIX: Safe localeCompare
          const numA = (a.number || '').toString();
          const numB = (b.number || '').toString();
          return direction === 'ASC'
              ? numA.localeCompare(numB, 'vi', { numeric: true })
              : numB.localeCompare(numA, 'vi', { numeric: true });
      });
      propRooms.forEach((r, idx) => { r.sortOrder = idx; });
      const newGlobalRooms = rooms.map(r => {
          const found = propRooms.find(pr => pr.id === r.id);
          return found ? found : r;
      });
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
          <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                  <DollarSign size={14}/> Danh mục Hạng phòng (Giá tham khảo)
              </h3>
              {selectedTypeIds.size > 0 && (
                  <button onClick={handleBulkDeleteRoomTypes} className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded font-bold hover:bg-red-200 flex items-center gap-1">
                      <Trash2 size={12}/> Xoá ({selectedTypeIds.size}) hạng phòng
                  </button>
              )}
          </div>
          
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar pb-2">
              {roomTypes.map((type) => (
                  <div key={type.id} className={`flex-shrink-0 group relative border rounded-lg p-3 min-w-[180px] hover:shadow-md transition-all ${selectedTypeIds.has(type.id) ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-100'}`}>
                      <div className="absolute top-2 left-2">
                          <button onClick={() => toggleSelection(type.id, setSelectedTypeIds)}>
                              {selectedTypeIds.has(type.id) 
                                ? <CheckSquare size={16} className="text-blue-600"/> 
                                : <Square size={16} className="text-gray-400 hover:text-gray-600"/>
                              }
                          </button>
                      </div>
                      
                      <div className="flex justify-end mb-1 pl-6">
                          <InlineInput 
                              value={type.name} 
                              onSave={(v) => handleUpdateType(type.id, 'name', v)}
                              className="font-bold text-gray-800 w-full text-right"
                          />
                      </div>
                      <div className="flex items-center justify-end gap-1 text-sm text-gray-600">
                          <DollarSign size={12} className="text-orange-400"/>
                          <InlineInput 
                              value={type.price} 
                              onSave={(v) => handleUpdateType(type.id, 'price', Number(v))}
                              type="number"
                              className="w-20 font-mono text-right"
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
          {/* Global Actions */}
          <div className="flex gap-2">
              <button 
                  onClick={handleAddProperty}
                  className="flex-1 py-4 bg-gray-100 hover:bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-all font-bold flex items-center justify-center gap-2"
              >
                  <Building2 size={20}/> Thêm Chi Nhánh Mới
              </button>
              {selectedPropIds.size > 0 && (
                  <button onClick={handleBulkDeleteProperties} className="px-6 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 rounded-xl font-bold flex items-center gap-2">
                      <Trash2 size={20}/> Xoá ({selectedPropIds.size}) CN
                  </button>
              )}
          </div>

          
          {properties.map((prop, propIdx) => (
              <div 
                key={prop.id} 
                className={`bg-white rounded-xl shadow-sm border overflow-hidden animate-fade-in transition-all ${selectedPropIds.has(prop.id) ? 'border-blue-300 ring-1 ring-blue-300' : 'border-gray-200'}`}
                draggable
                onDragStart={(e) => onPropDragStart(e, propIdx)}
                onDragEnter={(e) => onPropDragEnter(e, propIdx)}
                onDragEnd={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onPropDrop}
              >
                  {/* BRANCH HEADER */}
                  <div className={`bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center group cursor-grab active:cursor-grabbing hover:bg-gray-100 transition-colors
                      ${isDragging && dragItem.current?.type === 'PROPERTY' && dragItem.current.index === propIdx ? 'opacity-50 border-2 border-dashed border-blue-300' : ''}
                  `}>
                      <div className="flex items-center gap-3">
                          <button onClick={(e) => { e.stopPropagation(); toggleSelection(prop.id, setSelectedPropIds); }}>
                              {selectedPropIds.has(prop.id) 
                                ? <CheckSquare size={20} className="text-blue-600"/> 
                                : <Square size={20} className="text-gray-400 hover:text-gray-600"/>
                              }
                          </button>
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
                              <button onClick={() => handleAutoSortRooms(prop.id, 'ASC')} className="p-1.5 hover:bg-blue-50 text-gray-500 hover:text-blue-600 border-r border-gray-100"><ArrowDownAZ size={16}/></button>
                              <button onClick={() => handleAutoSortRooms(prop.id, 'DESC')} className="p-1.5 hover:bg-blue-50 text-gray-500 hover:text-blue-600"><ArrowUpZA size={16}/></button>
                          </div>

                          <button onClick={() => moveItem(properties, propIdx, 'UP', DataService.saveProperties)} className="p-1.5 hover:bg-white rounded text-gray-500 hover:text-blue-600"><ArrowUp size={16}/></button>
                          <button onClick={() => moveItem(properties, propIdx, 'DOWN', DataService.saveProperties)} className="p-1.5 hover:bg-white rounded text-gray-500 hover:text-blue-600"><ArrowDown size={16}/></button>
                      </div>
                  </div>

                  {/* ROOM LIST */}
                  <div className="p-2 md:p-4 bg-white">
                      <table className="w-full text-sm">
                          <thead className="text-xs text-gray-400 uppercase font-medium border-b">
                              <tr>
                                  <th className="pb-2 pl-2 text-left w-10">
                                      <button onClick={() => toggleAllRoomsInProperty(prop.id)} title="Chọn tất cả phòng chi nhánh này">
                                          <CheckSquare size={16} className="text-gray-400 hover:text-blue-600"/>
                                      </button>
                                  </th>
                                  <th className="pb-2 text-left w-1/4">Số phòng</th>
                                  <th className="pb-2 text-left w-1/3">Hạng phòng</th>
                                  <th className="pb-2 text-left">Trạng thái</th>
                                  <th className="pb-2 text-right">
                                      {selectedRoomIds.size > 0 && rooms.filter(r => r.propertyId === prop.id && selectedRoomIds.has(r.id)).length > 0 && (
                                          <button onClick={handleBulkDeleteRooms} className="text-red-600 font-bold text-xs hover:bg-red-50 px-2 py-1 rounded">
                                              Xoá Đã Chọn
                                          </button>
                                      )}
                                  </th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                              {rooms
                                .filter(r => r.propertyId === prop.id)
                                .sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0))
                                .map((room, rIdx) => (
                                  <tr 
                                    key={room.id} 
                                    className={`group transition-colors
                                        ${selectedRoomIds.has(room.id) ? 'bg-blue-50' : 'hover:bg-blue-50/30'}
                                        ${isDragging && dragItem.current?.type === 'ROOM' && dragItem.current.index === rIdx && dragItem.current.parentId === prop.id ? 'opacity-30 bg-blue-100' : ''}
                                    `}
                                    draggable
                                    onDragStart={(e) => onRoomDragStart(e, rIdx, prop.id)}
                                    onDragEnter={(e) => onRoomDragEnter(e, rIdx, prop.id)}
                                    onDragEnd={(e) => { e.preventDefault(); setIsDragging(false); }}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => onRoomDrop(e, prop.id)}
                                  >
                                      <td className="py-2 pl-2">
                                          <div className="flex items-center gap-2">
                                              <button onClick={() => toggleSelection(room.id, setSelectedRoomIds)}>
                                                  {selectedRoomIds.has(room.id) 
                                                    ? <CheckSquare size={16} className="text-blue-600"/> 
                                                    : <Square size={16} className="text-gray-300 hover:text-gray-500"/>
                                                  }
                                              </button>
                                              <GripVertical size={16} className="text-gray-300 cursor-grab active:cursor-grabbing"/>
                                          </div>
                                      </td>
                                      
                                      <td className="py-2">
                                          <InlineInput 
                                              value={room.number}
                                              onSave={(v) => handleUpdateRoom(room.id, 'number', v)}
                                              className="font-bold text-gray-800 text-base"
                                          />
                                      </td>

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

                                      <td className="py-2 text-right">
                                          {/* Individual Delete hidden if bulk selection active to avoid confusion, or keep it */}
                                          <button 
                                              onClick={() => handleSingleDeleteRoom(room)} 
                                              className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                          >
                                              <Trash2 size={14}/>
                                          </button>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>

                      <button 
                          onClick={() => handleAddRoom(prop.id)}
                          className="w-full mt-2 py-2 border-2 border-dashed border-gray-100 rounded-lg text-gray-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all text-sm font-bold flex items-center justify-center gap-2"
                      >
                          <Plus size={16}/> Thêm phòng vào {prop.name}
                      </button>
                  </div>
              </div>
          ))}
      </div>

      {/* --- CUSTOM DELETE CONFIRMATION MODAL --- */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in relative" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setDeleteModal({...deleteModal, isOpen: false})} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 mx-auto">
                      <AlertTriangle size={24} />
                  </div>
                  
                  <h3 className="text-lg font-bold text-center text-gray-900 mb-2">{deleteModal.title}</h3>
                  <div className="text-sm text-center mb-6">{deleteModal.description}</div>
                  
                  <div className="flex gap-3">
                      <button 
                          onClick={() => setDeleteModal({...deleteModal, isOpen: false})} 
                          className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors"
                      >
                          Huỷ bỏ
                      </button>
                      <button 
                          onClick={deleteModal.onConfirm} 
                          className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                      >
                          Xác nhận xoá
                      </button>
                  </div>
              </div>
          </div>
      )}

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

export default Management;
