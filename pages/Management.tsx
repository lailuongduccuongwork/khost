import React, { useEffect, useMemo, useState } from 'react';
import { User, Room, RoomType, Property, RoomStatus, Tag, TransactionCategory, RoomPolicyRule } from '../types';
import { DataService } from '../services/dataService';
import { 
    Building2, BedDouble, Shield, Settings, Plus, Trash2, Edit2, 
    Check, X, Tag as TagIcon, DollarSign, AlertTriangle, ArrowDownAZ, ArrowUpZA, GripVertical, Info, Users, Key, ChevronDown
} from 'lucide-react';
import Admin from './Admin'; 

interface ManagementProps {
  users: User[];
  rooms: Room[];
  roomTypes: RoomType[];
  roomPolicies: RoomPolicyRule[];
  properties: Property[];
  tags: Tag[];
  currentUser: User;
  onRefresh: () => void;
}

type TabType = 'PROPERTIES' | 'ROOM_MANAGEMENT' | 'ROOM_POLICIES' | 'ADMIN' | 'ADVANCED';
type CascadeDeleteKind = 'property' | 'roomType' | 'room';
type NewRoomTypeDraft = { propertyId: string; name: string } | null;
type NewRoomDraft = { propertyId: string; number: string; typeId: string } | null;

interface DangerousDeleteModalState {
    isOpen: boolean;
    kind: CascadeDeleteKind;
    id: string;
    name: string;
    title: string;
    impact: {
        rooms: number;
        roomTypes: number;
        bookings: number;
        roomPolicies: number;
    };
}

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
            <button onClick={onCancel} className="p-1.5 shrink-0 bg-red-100 text-red-600 hover:bg-red-200 rounded-md shadow-sm transition-colors" title="Hủy">
                <X size={16} strokeWidth={3} />
            </button>
        </div>
    );
};

const Management: React.FC<ManagementProps> = ({ users, rooms, roomTypes, roomPolicies, properties, tags, currentUser, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<TabType>('PROPERTIES');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isMobileTabPickerOpen, setIsMobileTabPickerOpen] = useState(false);
  
  // Modal xóa nguy hiểm: bắt buộc gõ XÓA để tránh xóa dây chuyền nhầm dữ liệu thật.
  const [deleteModal, setDeleteModal] = useState<DangerousDeleteModalState | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [draftTags, setDraftTags] = useState<Tag[]>(tags);
  const [draftCategories, setDraftCategories] = useState<TransactionCategory[]>(DataService.getTransactionCategories());
  const [collapsedPropertyIds, setCollapsedPropertyIds] = useState<string[]>([]);
  const [newRoomTypeDraft, setNewRoomTypeDraft] = useState<NewRoomTypeDraft>(null);
  const [newRoomDraft, setNewRoomDraft] = useState<NewRoomDraft>(null);
  const [roomManagementSearch, setRoomManagementSearch] = useState('');
  const [managementRooms, setManagementRooms] = useState<Room[]>(rooms);
  const [managementRoomTypes, setManagementRoomTypes] = useState<RoomType[]>(roomTypes);

  // --- DRAG & DROP STATE ---
  const [draggedPropIdx, setDraggedPropIdx] = useState<number | null>(null);
  const [draggedRoom, setDraggedRoom] = useState<{ propId: string, idx: number } | null>(null);

  // --- ROOM POLICY STATE (KHÓA PHÒNG / CHỈ NHẬN GIỜ) ---
  const todayISO = new Date().toISOString().slice(0, 10);
  const [policyMode, setPolicyMode] = useState<'LOCKED' | 'HOURLY_ONLY'>('LOCKED');
  const [policyReason, setPolicyReason] = useState('');
  const [policyRecurrence, setPolicyRecurrence] = useState<'NONE' | 'WEEKLY'>('NONE');
  const [policyStartDate, setPolicyStartDate] = useState(todayISO);
  const [policyEndDate, setPolicyEndDate] = useState('');
  const [policyWeekdays, setPolicyWeekdays] = useState<number[]>([6, 0]); // T7 + CN
  const [policyPropertyIds, setPolicyPropertyIds] = useState<string[]>([]);
  const [policyRoomTypeIds, setPolicyRoomTypeIds] = useState<string[]>([]);
  const [policyRoomIds, setPolicyRoomIds] = useState<string[]>([]);
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const managementTabs: Array<{ id: TabType; label: string; icon: any; desc: string }> = [
      { id: 'PROPERTIES', label: 'Cơ sở & Chi nhánh', icon: Building2, desc: 'Quản lý các toà nhà' },
      { id: 'ROOM_MANAGEMENT', label: 'Phân bổ Hạng & Phòng', icon: BedDouble, desc: 'Cấu hình phòng theo cấu trúc' },
      { id: 'ROOM_POLICIES', label: 'Chính sách phòng', icon: AlertTriangle, desc: 'Khóa phòng / Chỉ nhận giờ' },
      { id: 'ADMIN', label: 'Nhân sự & Phân quyền', icon: Shield, desc: 'Tài khoản nhân viên' },
      { id: 'ADVANCED', label: 'Cấu hình nâng cao', icon: Settings, desc: 'Thu chi, thẻ tag' },
  ];
  const activeTabMeta = managementTabs.find(tab => tab.id === activeTab) || managementTabs[0];
  const ActiveTabIcon = activeTabMeta.icon;
  const managementPropertyIds = useMemo(
      () => properties.map(prop => prop.id).filter(Boolean).sort(),
      [properties]
  );

  useEffect(() => {
      setDraftTags(tags);
  }, [tags]);

  useEffect(() => {
      setDraftCategories(DataService.getTransactionCategories());
  }, [activeTab, tags]);

  useEffect(() => {
      setManagementRooms(rooms);
  }, [rooms]);

  useEffect(() => {
      if (activeTab !== 'ROOM_MANAGEMENT') return;
      if (managementPropertyIds.length === 0) {
          setManagementRooms([]);
          return;
      }

      let cancelled = false;
      DataService.loadRoomsForPropertiesView(managementPropertyIds)
          .then((loadedRooms) => {
              if (!cancelled) setManagementRooms(loadedRooms);
          })
          .catch((error) => {
              console.error('Failed to load full room list for room management', error);
          });

      return () => {
          cancelled = true;
      };
  }, [activeTab, managementPropertyIds]);

  useEffect(() => {
      setManagementRoomTypes(roomTypes);
  }, [roomTypes]);

  const runSaveAction = async (actionLabel: string, action: () => Promise<unknown> | unknown) => {
      try {
          setSaveStatus(`Đang lưu ${actionLabel}...`);
          await Promise.resolve(action());
          setSaveStatus(`Đã lưu ${actionLabel}.`);
          window.setTimeout(() => setSaveStatus(''), 2200);
          onRefresh();
          return true;
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không rõ lỗi.';
          setSaveStatus(`Lỗi lưu ${actionLabel}: ${message}`);
          return false;
      }
  };

  const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

  const getRoomTypePropertyId = (type: RoomType) => (type as RoomType & { propertyId?: string }).propertyId;

  // --- HÀM HỖ TRỢ LỌC DỮ LIỆU THÔNG MINH ---
  const getTypesInProp = (propId: string) => {
      return managementRoomTypes.filter(t => {
          const explicitPropId = (t as any).propertyId;
          const hasRoomsHere = managementRooms.some(r => r.typeId === t.id && r.propertyId === propId);
          if (hasRoomsHere) return true;
          if (explicitPropId === propId) return true;
          const isOrphan = !explicitPropId && !managementRooms.some(r => r.typeId === t.id);
          if (isOrphan && properties.length === 1 && properties[0]?.id === propId) return true;
          return false;
      }).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
  };

  const propertyHasDuplicateName = (name: string, excludeId?: string) =>
      properties.some(prop => prop.id !== excludeId && normalizeName(prop.name) === normalizeName(name));

  const roomTypeHasDuplicateName = (propertyId: string, name: string, excludeId?: string) => {
      const scopedTypes = getTypesInProp(propertyId);
      return scopedTypes.some(type => type.id !== excludeId && normalizeName(type.name) === normalizeName(name));
  };

  const roomHasDuplicateNumber = (propertyId: string, number: string, excludeId?: string) =>
      managementRooms.some(room => room.id !== excludeId && room.propertyId === propertyId && normalizeName(room.number) === normalizeName(number));

  const getRoomTypeName = (typeId?: string) =>
      managementRoomTypes.find(type => type.id === typeId)?.name || '';

  const propertyMatchesRoomManagementSearch = (prop: Property) => {
      const query = normalizeName(roomManagementSearch);
      if (!query) return true;
      if (normalizeName(prop.name).includes(query)) return true;
      const propRooms = managementRooms.filter(room => room.propertyId === prop.id);
      if (propRooms.some(room => normalizeName(room.number).includes(query))) return true;
      return getTypesInProp(prop.id).some(type => normalizeName(type.name).includes(query));
  };

  useEffect(() => {
      setNewRoomTypeDraft(null);
      setNewRoomDraft(null);
      setEditingId(null);
      setDraggedRoom(null);
  }, [activeTab, roomManagementSearch]);

  const toggleArrayValue = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
      setter(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);
  };

  const toggleWeekday = (day: number) => {
      setPolicyWeekdays(prev => prev.includes(day) ? prev.filter(item => item !== day) : [...prev, day]);
  };

  const availablePropertyOptions = useMemo(() => {
      if (policyRoomTypeIds.length === 0) return properties;
      const propertyIdSet = new Set(
          rooms
              .filter(room => policyRoomTypeIds.includes(room.typeId))
              .map(room => room.propertyId)
      );
      return properties.filter(prop => propertyIdSet.has(prop.id));
  }, [properties, rooms, policyRoomTypeIds]);

  const availableRoomTypeOptions = useMemo(() => {
      if (policyPropertyIds.length === 0) {
          const allTypeIds = new Set(rooms.map(room => room.typeId));
          return roomTypes.filter(type => allTypeIds.has(type.id));
      }
      const typeIdSet = new Set(
          rooms
              .filter(room => policyPropertyIds.includes(room.propertyId))
              .map(room => room.typeId)
      );
      return roomTypes.filter(type => typeIdSet.has(type.id));
  }, [roomTypes, rooms, policyPropertyIds]);

  const policyFilteredRooms = useMemo(() => {
      return rooms
          .filter(room => policyPropertyIds.length === 0 || policyPropertyIds.includes(room.propertyId))
          .filter(room => policyRoomTypeIds.length === 0 || policyRoomTypeIds.includes(room.typeId))
          .sort((a, b) => (a.number || '').localeCompare((b.number || ''), 'vi', { numeric: true }));
  }, [rooms, policyPropertyIds, policyRoomTypeIds]);

  useEffect(() => {
      const allowedPropertyIds = new Set(availablePropertyOptions.map(prop => prop.id));
      setPolicyPropertyIds(prev => {
          const next = prev.filter(id => allowedPropertyIds.has(id));
          return next.length === prev.length ? prev : next;
      });
  }, [availablePropertyOptions]);

  useEffect(() => {
      const allowedTypeIds = new Set(availableRoomTypeOptions.map(type => type.id));
      setPolicyRoomTypeIds(prev => {
          const next = prev.filter(id => allowedTypeIds.has(id));
          return next.length === prev.length ? prev : next;
      });
  }, [availableRoomTypeOptions]);

  useEffect(() => {
      const allowedRoomIds = new Set(policyFilteredRooms.map(room => room.id));
      setPolicyRoomIds(prev => {
          const next = prev.filter(id => allowedRoomIds.has(id));
          return next.length === prev.length ? prev : next;
      });
  }, [policyFilteredRooms]);

  useEffect(() => {
      setIsMobileTabPickerOpen(false);
  }, [activeTab]);

  const policyTargetSummary = (rule: RoomPolicyRule) => {
      const targetRooms = (rule.roomIds || [])
          .map(roomId => rooms.find(room => room.id === roomId)?.number || roomId)
          .slice(0, 4);
      const roomText = targetRooms.length > 0 ? `Phòng ${targetRooms.join(', ')}` : 'Nhiều phòng';
      const branchText = (rule.propertyIds || [])
          .map(propId => properties.find(prop => prop.id === propId)?.name || propId)
          .slice(0, 2)
          .join(', ');
      return branchText ? `${roomText} • ${branchText}` : roomText;
  };

  const resetPolicyForm = () => {
      setPolicyMode('LOCKED');
      setPolicyReason('');
      setPolicyRecurrence('NONE');
      setPolicyStartDate(todayISO);
      setPolicyEndDate('');
      setPolicyWeekdays([6, 0]);
      setPolicyPropertyIds([]);
      setPolicyRoomTypeIds([]);
      setPolicyRoomIds([]);
  };

  // --- HÀM HỖ TRỢ XÓA ---
  const confirmDelete = (kind: CascadeDeleteKind, id: string, name: string) => {
      try {
          const impact = DataService.getManagementCascadeDeleteImpact(kind, id);
          setDeleteConfirmText('');
          setDeleteError('');
          setDeleteModal({
              isOpen: true,
              kind,
              id,
              name,
              title: `Xoá ${name}?`,
              impact,
          });
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không thể kiểm tra dữ liệu liên quan.';
          alert(message);
      }
  };

  const closeDeleteModal = () => {
      if (isDeleting) return;
      setDeleteModal(null);
      setDeleteConfirmText('');
      setDeleteError('');
  };

  const handleConfirmCascadeDelete = async () => {
      if (!deleteModal || deleteConfirmText.trim() !== 'XÓA') return;
      setIsDeleting(true);
      setDeleteError('');
      try {
          await DataService.cascadeDeleteManagementItem(deleteModal.kind, deleteModal.id, currentUser.id);
          setManagementRooms(DataService.getRooms());
          setManagementRoomTypes(DataService.getRoomTypes());
          setDeleteModal(null);
          setDeleteConfirmText('');
          setSaveStatus(`Đã xóa ${deleteModal.name} và dữ liệu liên quan.`);
          window.setTimeout(() => setSaveStatus(''), 2600);
          onRefresh();
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Không thể xóa dữ liệu.';
          setDeleteError(message);
      } finally {
          setIsDeleting(false);
      }
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
      let roomsInProp = managementRooms.filter(r => r.propertyId === propId);
      roomsInProp.sort((a, b) => {
          const cmp = String(a.number || '').localeCompare(String(b.number || ''), 'vi', { numeric: true });
          return isAZ ? cmp : -cmp;
      });
      const updatedRooms = roomsInProp.map((item, i) => ({ ...item, sortOrder: i }));
      const finalRooms = managementRooms.map(r => updatedRooms.find(u => u.id === r.id) || r);
      setManagementRooms(finalRooms);
      runSaveAction('thứ tự phòng', () => DataService.saveRooms(finalRooms));
  };

  const handleDropRoom = (propId: string, dropIdx: number) => {
      if (!draggedRoom || draggedRoom.propId !== propId || draggedRoom.idx === dropIdx) return;
      let roomsInProp = managementRooms.filter(r => r.propertyId === propId).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
      
      const newList = [...roomsInProp];
      const [removed] = newList.splice(draggedRoom.idx, 1);
      newList.splice(dropIdx, 0, removed);
      
      const updatedRooms = newList.map((item, i) => ({ ...item, sortOrder: i }));
      const finalRooms = managementRooms.map(r => updatedRooms.find(u => u.id === r.id) || r);
      setManagementRooms(finalRooms);
      runSaveAction('thứ tự phòng', () => DataService.saveRooms(finalRooms));
      setDraggedRoom(null);
  };

  // --- HANDLERS: THÊM MỚI ---
  const handleAddProperty = () => {
      const baseName = 'Chi nhánh mới';
      const suffix = properties.filter(prop => prop.name.startsWith(baseName)).length;
      const name = suffix > 0 ? `${baseName} ${suffix + 1}` : baseName;
      const newProp: Property = { id: `p_${Date.now()}`, name, address: 'Địa chỉ...', sortOrder: properties.length };
      DataService.saveProperties([...properties, newProp]);
      setEditingId(newProp.id);
  };

  const handleAddRoomType = (propertyId: string) => {
      setNewRoomTypeDraft({ propertyId, name: '' });
      setNewRoomDraft(null);
  };

  const handleAddRoom = (propertyId: string, fallbackTypeId: string) => {
      setNewRoomDraft({ propertyId, number: '', typeId: fallbackTypeId });
      setNewRoomTypeDraft(null);
  };

  const handleSaveNewRoomType = () => {
      if (!newRoomTypeDraft) return;
      const name = newRoomTypeDraft.name.trim();
      if (!name) return alert('Tên hạng phòng không được để trống.');
      if (roomTypeHasDuplicateName(newRoomTypeDraft.propertyId, name)) return alert('Tên hạng phòng đã tồn tại trong chi nhánh này.');
      const newType: RoomType = { id: `rt_${Date.now()}`, name, price: 0, capacity: 2, sortOrder: 999 };
      (newType as any).propertyId = newRoomTypeDraft.propertyId;
      const nextRoomTypes = [...managementRoomTypes, newType];
      setManagementRoomTypes(nextRoomTypes);
      runSaveAction('hạng phòng mới', () => DataService.saveRoomTypes(nextRoomTypes));
      setNewRoomTypeDraft(null);
  };

  const handleSaveNewRoom = () => {
      if (!newRoomDraft) return;
      const number = newRoomDraft.number.trim();
      if (!number) return alert('Số phòng không được để trống.');
      if (!newRoomDraft.typeId) return alert('Vui lòng chọn hạng phòng.');
      if (roomHasDuplicateNumber(newRoomDraft.propertyId, number)) return alert('Số phòng đã tồn tại trong chi nhánh này.');
      const newRoom: Room = {
          id: `r_${Date.now()}`,
          number,
          typeId: newRoomDraft.typeId,
          propertyId: newRoomDraft.propertyId,
          status: RoomStatus.VACANT_CLEAN,
          floor: 1,
          sortOrder: 999,
      };
      const nextRooms = [...managementRooms, newRoom];
      setManagementRooms(nextRooms);
      runSaveAction('phòng mới', () => DataService.saveRooms(nextRooms));
      setNewRoomDraft(null);
  };

  const handleRoomTypeChange = (roomId: string, newTypeId: string) => {
      const nextRooms = managementRooms.map(r => r.id === roomId ? {...r, typeId: newTypeId} : r);
      setManagementRooms(nextRooms);
      runSaveAction('hạng phòng của phòng', () => DataService.saveRooms(nextRooms));
  };

  const handleCreateRoomPolicy = () => {
      if (!policyStartDate) return alert('Vui lòng chọn ngày bắt đầu.');
      if (policyEndDate && policyEndDate < policyStartDate) return alert('Ngày kết thúc không được nhỏ hơn ngày bắt đầu.');
      if (policyRecurrence === 'WEEKLY' && policyWeekdays.length === 0) return alert('Vui lòng chọn ít nhất 1 ngày trong tuần.');
      if (policyRoomIds.length === 0 && policyPropertyIds.length === 0 && policyRoomTypeIds.length === 0) {
          return alert('Vui lòng chọn phòng hoặc chọn theo chi nhánh/hạng phòng để áp dụng hàng loạt.');
      }

      const newPolicy: RoomPolicyRule = {
          id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          mode: policyMode,
          reason: policyReason.trim(),
          isActive: true,
          startDate: policyStartDate,
          endDate: policyEndDate || undefined,
          recurrence: policyRecurrence,
          weekdays: policyRecurrence === 'WEEKLY' ? [...policyWeekdays].sort((a, b) => a - b) : [],
          propertyIds: [...policyPropertyIds],
          roomTypeIds: [...policyRoomTypeIds],
          roomIds: [...policyRoomIds],
          createdAt: new Date().toISOString(),
          createdBy: currentUser.id,
      };

      runSaveAction('chính sách phòng', () => DataService.saveRoomPolicies([...roomPolicies, newPolicy]));
      setActiveTab('ROOM_POLICIES');
      resetPolicyForm();
  };

  const applyBulkPolicyState = (active: boolean) => {
      if (selectedPolicyIds.length === 0) return;
      const updated = roomPolicies.map(policy =>
          selectedPolicyIds.includes(policy.id) ? { ...policy, isActive: active } : policy
      );
      DataService.saveRoomPolicies(updated);
      setSelectedPolicyIds([]);
      onRefresh();
  };

  const deleteSelectedPolicies = () => {
      if (selectedPolicyIds.length === 0) return;
      if (!window.confirm(`Xóa ${selectedPolicyIds.length} chính sách phòng đã chọn? Hành động này không thể hoàn tác.`)) return;
      DataService.deleteItems('roomPolicies', selectedPolicyIds);
      setSelectedPolicyIds([]);
      onRefresh();
  };

  // --- COMPONENT: MENU BÊN TRÁI ---
  const renderSidebar = () => {
      return (
          <div className="w-full md:w-72 flex-shrink-0 bg-white border border-gray-200 rounded-2xl shadow-sm p-4 h-fit sticky top-24">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 px-2">Cài đặt hệ thống</h2>
              <nav className="flex flex-col gap-1">
                  {managementTabs.map(tab => {
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
    <div className="katka-liquid-page flex flex-col md:flex-row gap-6 animate-fade-in">
      <div className="hidden md:block">{renderSidebar()}</div>

      <div className="flex-1 w-full min-w-0">
          <div className="md:hidden relative mb-3">
              <button
                  onClick={() => setIsMobileTabPickerOpen(prev => !prev)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-3 flex items-center justify-between shadow-sm"
              >
                  <div className="flex items-center gap-2">
                      <ActiveTabIcon size={18} className="text-blue-600" />
                      <div className="text-left">
                          <div className="text-sm font-bold text-gray-800">{activeTabMeta.label}</div>
                          <div className="text-[11px] text-gray-500">{activeTabMeta.desc}</div>
                      </div>
                  </div>
                  <ChevronDown size={18} className={`text-gray-500 transition-transform ${isMobileTabPickerOpen ? 'rotate-180' : ''}`} />
              </button>
              {isMobileTabPickerOpen && (
                  <div className="absolute left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
                      {managementTabs.map(tab => {
                          const Icon = tab.icon;
                          const isActive = activeTab === tab.id;
                          return (
                              <button
                                  key={`mobile-${tab.id}`}
                                  onClick={() => setActiveTab(tab.id)}
                                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-gray-100 last:border-b-0 ${
                                      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                                  }`}
                              >
                                  <Icon size={16} />
                                  <span className="text-sm font-semibold">{tab.label}</span>
                              </button>
                          );
                      })}
                  </div>
              )}
          </div>
          {saveStatus && (
              <div className={`mb-3 rounded-xl border px-4 py-2 text-sm font-semibold ${
                  saveStatus.startsWith('Lỗi')
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : saveStatus.startsWith('Đang')
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-green-200 bg-green-50 text-green-700'
              }`}>
                  {saveStatus}
              </div>
          )}
          
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
                                              <InlineInput value={prop.name} autoSelect onSave={(v) => {
                                                  const name = v.trim();
                                                  if (!name) return alert('Tên chi nhánh không được để trống.');
                                                  if (propertyHasDuplicateName(name, prop.id)) return alert('Tên chi nhánh đã tồn tại.');
                                                  runSaveAction('chi nhánh', () => DataService.saveProperties(properties.map(p => p.id === prop.id ? {...p, name} : p)));
                                                  setEditingId(null);
                                              }} onCancel={() => setEditingId(null)} />
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
                                          <button onClick={() => confirmDelete('property', prop.id, `Chi nhánh ${prop.name}`)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
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
                          <div className="flex w-full md:w-96 gap-2">
                              <input
                                  type="text"
                                  value={roomManagementSearch}
                                  onChange={(e) => setRoomManagementSearch(e.target.value)}
                                  placeholder="Tìm chi nhánh, hạng, số phòng..."
                                  className="min-w-0 flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                              />
                              {roomManagementSearch && (
                                  <button
                                      onClick={() => setRoomManagementSearch('')}
                                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
                                  >
                                      Xóa
                                  </button>
                              )}
                          </div>
                      </div>
                      
                      <div className="p-4 md:p-6 space-y-8 bg-gray-50/30">
                          {properties.length === 0 && <div className="text-center py-8 text-gray-500 font-medium">Bạn cần tạo Chi nhánh trước nhé!</div>}
                          
                          {properties.length > 0 && [...properties].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)).filter(propertyMatchesRoomManagementSearch).length === 0 && (
                              <div className="text-center py-10 text-gray-500 font-semibold bg-white border border-dashed border-gray-200 rounded-2xl">
                                  Không tìm thấy chi nhánh, hạng phòng hoặc số phòng phù hợp.
                              </div>
                          )}

                          {[...properties].sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)).filter(propertyMatchesRoomManagementSearch).map(prop => {
                              const typesInProp = getTypesInProp(prop.id);
                              const roomsInProp = managementRooms.filter(r => r.propertyId === prop.id).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
                              const isCollapsed = collapsedPropertyIds.includes(prop.id);
                              const query = normalizeName(roomManagementSearch);
                              const propertyNameMatches = query && normalizeName(prop.name).includes(query);
                              const displayedTypesInProp = !query || propertyNameMatches
                                  ? typesInProp
                                  : typesInProp.filter(type => {
                                      if (normalizeName(type.name).includes(query)) return true;
                                      return roomsInProp.some(room => room.typeId === type.id && normalizeName(room.number).includes(query));
                                  });
                              const displayedRoomsInProp = !query || propertyNameMatches
                                  ? roomsInProp
                                  : roomsInProp.filter(room =>
                                      normalizeName(room.number).includes(query) ||
                                      normalizeName(getRoomTypeName(room.typeId)).includes(query)
                                  );
                              const isSearchActive = Boolean(query);

                              return (
                                  <div key={prop.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                      {/* --- LEVEL 1: CHI NHÁNH --- */}
                                      <div className="bg-slate-900 px-5 py-3 flex flex-col gap-3 md:flex-row md:justify-between md:items-center text-white">
                                          <div>
                                              <h3 className="font-bold flex items-center gap-2 text-lg"><Building2 size={20}/> {prop.name}</h3>
                                              <div className="mt-1 text-xs font-bold text-slate-300">
                                                  {typesInProp.length} hạng phòng • {roomsInProp.length} phòng
                                                  {isSearchActive && ` • đang hiện ${displayedTypesInProp.length} hạng, ${displayedRoomsInProp.length} phòng`}
                                              </div>
                                          </div>
                                          <button
                                              onClick={() => setCollapsedPropertyIds(prev => prev.includes(prop.id) ? prev.filter(id => id !== prop.id) : [...prev, prop.id])}
                                              className="self-start md:self-auto rounded-lg bg-white/15 px-3 py-1.5 text-sm font-bold text-white hover:bg-white/25 flex items-center gap-1"
                                          >
                                              {isCollapsed ? 'Mở rộng' : 'Thu gọn'}
                                              <ChevronDown size={16} className={`transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                                          </button>
                                      </div>

                                      {isCollapsed && (
                                          <div className="px-5 py-4 bg-slate-50 text-sm font-semibold text-slate-600">
                                              Chi nhánh đang thu gọn. Bấm Mở rộng để sửa hạng phòng và số phòng.
                                          </div>
                                      )}

                                      {/* --- PHẦN 1: CÁC HẠNG PHÒNG (TỐI GIẢN) --- */}
                                      {!isCollapsed && <div className="p-4 md:p-5 border-b border-gray-100 bg-gray-50/50">
                                          <div className="flex justify-between items-center mb-3">
                                              <h4 className="font-bold text-gray-700 flex items-center gap-2"><BedDouble size={18}/> Các Hạng phòng lựa chọn</h4>
                                              <button onClick={() => handleAddRoomType(prop.id)} className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 hover:bg-blue-50 transition-colors shadow-sm">
                                                  <Plus size={16}/> Thêm Hạng phòng
                                              </button>
                                          </div>

                                          {newRoomTypeDraft?.propertyId === prop.id && (
                                              <div className="mb-3 rounded-xl border-2 border-blue-200 bg-white p-3 shadow-sm">
                                                  <div className="text-xs font-bold uppercase tracking-wide text-blue-600 mb-2">Hạng phòng mới</div>
                                                  <div className="flex flex-col md:flex-row gap-2">
                                                      <input
                                                          value={newRoomTypeDraft.name}
                                                          onChange={(e) => setNewRoomTypeDraft({ ...newRoomTypeDraft, name: e.target.value })}
                                                          onKeyDown={(e) => {
                                                              if (e.key === 'Enter') handleSaveNewRoomType();
                                                              if (e.key === 'Escape') setNewRoomTypeDraft(null);
                                                          }}
                                                          autoFocus
                                                          placeholder="Nhập tên hạng phòng"
                                                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
                                                      />
                                                      <button onClick={handleSaveNewRoomType} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">Lưu hạng</button>
                                                      <button onClick={() => setNewRoomTypeDraft(null)} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200">Hủy</button>
                                                  </div>
                                              </div>
                                          )}
                                          
                                          {displayedTypesInProp.length === 0 ? (
                                              <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
                                                  {isSearchActive ? 'Không có hạng phòng phù hợp với từ khóa tìm kiếm.' : 'Hãy thêm ít nhất 1 hạng phòng để có thể gán cho các phòng nhé!'}
                                              </div>
                                          ) : (
                                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                                  {displayedTypesInProp.map(type => (
                                                      <div key={type.id} className="bg-white border border-gray-200 px-3 py-2.5 rounded-xl shadow-sm flex items-center justify-between relative hover:border-blue-300 transition-colors min-h-[3rem]">
                                                          {editingId === type.id ? (
                                                              <div className="w-full flex-1 -ml-1">
                                                                  <InlineInput value={type.name} autoSelect onSave={(v) => {
                                                                      const name = v.trim();
                                                                      const propertyId = getRoomTypePropertyId(type) || prop.id;
                                                                      if (!name) return alert('Tên hạng phòng không được để trống.');
                                                                      if (roomTypeHasDuplicateName(propertyId, name, type.id)) return alert('Tên hạng phòng đã tồn tại trong chi nhánh này.');
                                                                      const nextRoomTypes = managementRoomTypes.map(t => t.id === type.id ? {...t, name} : t);
                                                                      setManagementRoomTypes(nextRoomTypes);
                                                                      runSaveAction('hạng phòng', () => DataService.saveRoomTypes(nextRoomTypes));
                                                                      setEditingId(null);
                                                                  }} onCancel={() => setEditingId(null)} />
                                                              </div>
                                                          ) : (
                                                              <>
                                                                  <div className="min-w-0 pr-12">
                                                                      <span className="font-bold text-gray-800 break-words line-clamp-1" title={type.name}>{type.name}</span>
                                                                      <div className="mt-1 text-[11px] font-bold text-gray-400">{roomsInProp.filter(room => room.typeId === type.id).length} phòng</div>
                                                                  </div>
                                                                  <div className="flex gap-1 absolute right-2">
                                                                      <button onClick={() => setEditingId(type.id)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" title="Đổi tên hạng"><Edit2 size={16}/></button>
                                                                      <button onClick={() => confirmDelete('roomType', type.id, `Hạng ${type.name}`)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Xóa hạng"><Trash2 size={16}/></button>
                                                                  </div>
                                                              </>
                                                          )}
                                                      </div>
                                                  ))}
                                              </div>
                                          )}
                                      </div>}

                                      {/* --- PHẦN 2: DANH SÁCH SỐ PHÒNG (KÉO THẢ SẮP XẾP) --- */}
                                      {!isCollapsed && <div className="p-4 md:p-5">
                                          <div className="flex justify-between items-center mb-4">
                                              <h4 className="font-bold text-gray-700 flex items-center gap-2"><Key size={18}/> Danh sách Số phòng</h4>
                                              <div className="flex items-center gap-2">
                                                  {roomsInProp.length > 1 && !isSearchActive && (
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

                                          {newRoomDraft?.propertyId === prop.id && (
                                              <div className="mb-4 rounded-xl border-2 border-blue-200 bg-white p-3 shadow-sm">
                                                  <div className="text-xs font-bold uppercase tracking-wide text-blue-600 mb-2">Phòng mới</div>
                                                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto_auto] gap-2">
                                                      <input
                                                          value={newRoomDraft.number}
                                                          onChange={(e) => setNewRoomDraft({ ...newRoomDraft, number: e.target.value })}
                                                          onKeyDown={(e) => {
                                                              if (e.key === 'Enter') handleSaveNewRoom();
                                                              if (e.key === 'Escape') setNewRoomDraft(null);
                                                          }}
                                                          autoFocus
                                                          placeholder="Nhập số phòng"
                                                          className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
                                                      />
                                                      <select
                                                          value={newRoomDraft.typeId}
                                                          onChange={(e) => setNewRoomDraft({ ...newRoomDraft, typeId: e.target.value })}
                                                          className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-blue-500"
                                                      >
                                                          {typesInProp.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                                                      </select>
                                                      <button onClick={handleSaveNewRoom} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">Lưu phòng</button>
                                                      <button onClick={() => setNewRoomDraft(null)} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200">Hủy</button>
                                                  </div>
                                              </div>
                                          )}
                                          
                                          {displayedRoomsInProp.length === 0 ? (
                                              <div className="text-center text-gray-400 py-6 border-2 border-dashed border-gray-200 rounded-xl">
                                                  {isSearchActive ? 'Không có phòng phù hợp với từ khóa tìm kiếm.' : 'Chưa có phòng nào. Bấm "Thêm Phòng" để tạo.'}
                                              </div>
                                          ) : (
                                              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                                                  {displayedRoomsInProp.map((room, rIdx) => (
                                                      <div 
                                                          key={room.id}
                                                          draggable={editingId !== room.id && !isSearchActive}
                                                          onDragStart={(e) => { e.stopPropagation(); setDraggedRoom({ propId: prop.id, idx: rIdx }); }}
                                                          onDragOver={(e) => e.preventDefault()}
                                                          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropRoom(prop.id, rIdx); }}
                                                          className={`flex flex-col gap-2 border border-slate-200 bg-white rounded-xl p-2 transition-all ${draggedRoom?.idx === rIdx && draggedRoom?.propId === prop.id ? 'opacity-30 scale-95 border-dashed border-blue-400' : ''} ${editingId !== room.id && !isSearchActive ? 'cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-md' : editingId === room.id ? 'shadow-md border-blue-500 ring-2 ring-blue-300' : 'hover:border-slate-300'}`}
                                                      >
                                                          {/* Khi bấm sửa số phòng, khung nhập liệu sẽ chiếm toàn bộ card để không bị đẩy lệch */}
                                                          {editingId === room.id ? (
                                                              <div className="w-full">
                                                                  <InlineInput 
                                                                    value={room.number} 
                                                                    autoSelect 
                                                                    onSave={(v) => {
                                                                        const number = v.trim();
                                                                        if (!number) return alert('Số phòng không được để trống.');
                                                                        if (roomHasDuplicateNumber(room.propertyId, number, room.id)) return alert('Số phòng đã tồn tại trong chi nhánh này.');
                                                                        const nextRooms = managementRooms.map(r => r.id === room.id ? {...r, number} : r);
                                                                        setManagementRooms(nextRooms);
                                                                        runSaveAction('phòng', () => DataService.saveRooms(nextRooms));
                                                                        setEditingId(null);
                                                                    }}
                                                                    onCancel={() => setEditingId(null)} 
                                                                  />
                                                              </div>
                                                          ) : (
                                                              <>
                                                                  <div className="flex items-center justify-between">
                                                                      <GripVertical size={16} className="text-gray-300 shrink-0" />
                                                                      <span className="font-black text-gray-800 text-base leading-tight flex-1 text-center px-1 break-words whitespace-normal">{room.number}</span>
                                                                      <div className="flex items-center shrink-0">
                                                                          <button onClick={() => setEditingId(room.id)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" title="Đổi tên"><Edit2 size={15}/></button>
                                                                          <button onClick={() => confirmDelete('room', room.id, `Phòng ${room.number}`)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Xóa"><X size={17}/></button>
                                                                      </div>
                                                                  </div>
                                                                  
                                                                  <select 
                                                                      className={`w-full min-h-[2.25rem] text-sm font-semibold p-2 rounded-lg border outline-none cursor-pointer ${!typesInProp.some(t => t.id === room.typeId) ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-white focus:border-blue-500'}`}
                                                                      value={room.typeId || ''}
                                                                      onChange={(e) => handleRoomTypeChange(room.id, e.target.value)}
                                                                      title={getRoomTypeName(room.typeId) || 'Hạng phòng không hợp lệ'}
                                                                  >
                                                                      {!typesInProp.some(t => t.id === room.typeId) && <option value={room.typeId} className="hidden">--- Chọn hạng phòng ---</option>}
                                                                      {typesInProp.map(t => (
                                                                          <option key={t.id} value={t.id}>{t.name}</option>
                                                                      ))}
                                                                  </select>
                                                                  <div className={`text-[11px] font-bold ${!typesInProp.some(t => t.id === room.typeId) ? 'text-red-600' : 'text-gray-400'}`}>
                                                                      {!typesInProp.some(t => t.id === room.typeId)
                                                                          ? 'Hạng phòng này không còn tồn tại, hãy chọn lại.'
                                                                          : `Hạng: ${getRoomTypeName(room.typeId)}`}
                                                                  </div>
                                                              </>
                                                          )}
                                                      </div>
                                                  ))}
                                              </div>
                                          )}
                                      </div>}
                                  </div>
                              )
                          })}
                      </div>
                  </div>
              </div>
          )}

          {/* TAB 3: CHÍNH SÁCH PHÒNG (KHÓA / CHỈ NHẬN GIỜ) */}
          {activeTab === 'ROOM_POLICIES' && (
              <div className="space-y-6 animate-fade-in">
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                      <div className="p-5 md:p-6 border-b border-gray-100 bg-gray-50/50">
                          <h2 className="text-xl font-bold text-gray-800">Chính sách phòng theo lịch</h2>
                          <p className="text-sm text-gray-500 mt-1">
                              Admin có thể khóa phòng hoặc đặt chế độ chỉ nhận khách giờ theo từng ngày / lặp hàng tuần (T7, CN...).
                          </p>
                      </div>

                      <div className="p-5 md:p-6 space-y-5">
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                              <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                  Chế độ
                                  <select
                                      value={policyMode}
                                      onChange={(e) => setPolicyMode(e.target.value as 'LOCKED' | 'HOURLY_ONLY')}
                                      className="mt-1.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                                  >
                                      <option value="LOCKED">Khóa phòng (chặn nhận khách)</option>
                                      <option value="HOURLY_ONLY">Chỉ nhận khách giờ (tối đa 12 tiếng)</option>
                                  </select>
                              </label>

                              <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                  Kiểu lịch
                                  <select
                                      value={policyRecurrence}
                                      onChange={(e) => setPolicyRecurrence(e.target.value as 'NONE' | 'WEEKLY')}
                                      className="mt-1.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                                  >
                                      <option value="NONE">Theo khoảng ngày</option>
                                      <option value="WEEKLY">Lặp hàng tuần</option>
                                  </select>
                              </label>

                              <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                  Ngày bắt đầu
                                  <input
                                      type="date"
                                      value={policyStartDate}
                                      onChange={(e) => setPolicyStartDate(e.target.value)}
                                      className="mt-1.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                                  />
                              </label>

                              <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                                  Ngày kết thúc
                                  <input
                                      type="date"
                                      value={policyEndDate}
                                      onChange={(e) => setPolicyEndDate(e.target.value)}
                                      className="mt-1.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500"
                                  />
                                  <div className="mt-1 text-[11px] font-medium normal-case text-gray-500">
                                      Để trống = lặp không giới hạn (đến khi bạn tạm dừng/mở khoá).
                                  </div>
                              </label>
                          </div>

                          {policyRecurrence === 'WEEKLY' && (
                              <div>
                                  <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Ngày áp dụng trong tuần</div>
                                  <div className="flex flex-wrap gap-2">
                                      {[
                                          { day: 1, label: 'T2' },
                                          { day: 2, label: 'T3' },
                                          { day: 3, label: 'T4' },
                                          { day: 4, label: 'T5' },
                                          { day: 5, label: 'T6' },
                                          { day: 6, label: 'T7' },
                                          { day: 0, label: 'CN' },
                                      ].map(item => (
                                          <button
                                              key={item.label}
                                              onClick={() => toggleWeekday(item.day)}
                                              className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-colors ${
                                                  policyWeekdays.includes(item.day)
                                                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                                                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                              }`}
                                          >
                                              {item.label}
                                          </button>
                                      ))}
                                  </div>
                              </div>
                          )}

                          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                                  <div className="text-xs font-bold text-gray-600 uppercase mb-2">Lọc theo chi nhánh</div>
                                  <div className="max-h-36 overflow-auto space-y-1">
                                      {availablePropertyOptions.map(prop => (
                                          <label key={prop.id} className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                              <input
                                                  type="checkbox"
                                                  checked={policyPropertyIds.includes(prop.id)}
                                                  onChange={() => toggleArrayValue(prop.id, setPolicyPropertyIds)}
                                                  className="accent-blue-600"
                                              />
                                              {prop.name}
                                          </label>
                                      ))}
                                      {availablePropertyOptions.length === 0 && (
                                          <div className="text-xs text-gray-400">Không có chi nhánh phù hợp với hạng đã lọc.</div>
                                      )}
                                  </div>
                              </div>

                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                                  <div className="text-xs font-bold text-gray-600 uppercase mb-2">Lọc theo hạng phòng</div>
                                  <div className="max-h-36 overflow-auto space-y-1">
                                      {availableRoomTypeOptions.map(type => (
                                          <label key={type.id} className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                              <input
                                                  type="checkbox"
                                                  checked={policyRoomTypeIds.includes(type.id)}
                                                  onChange={() => toggleArrayValue(type.id, setPolicyRoomTypeIds)}
                                                  className="accent-blue-600"
                                              />
                                              {type.name}
                                          </label>
                                      ))}
                                      {availableRoomTypeOptions.length === 0 && (
                                          <div className="text-xs text-gray-400">Không có hạng phòng phù hợp với chi nhánh đã lọc.</div>
                                      )}
                                  </div>
                              </div>

                              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                                  <div className="flex items-center justify-between mb-2">
                                      <div className="text-xs font-bold text-gray-600 uppercase">Chọn phòng áp dụng</div>
                                      <button
                                          onClick={() => setPolicyRoomIds(policyFilteredRooms.map(room => room.id))}
                                          className="text-[11px] font-bold text-blue-600 hover:underline"
                                      >
                                          Chọn tất cả
                                      </button>
                                  </div>
                                  <div className="max-h-36 overflow-auto space-y-1">
                                      {policyFilteredRooms.map(room => (
                                          <label key={room.id} className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                              <input
                                                  type="checkbox"
                                                  checked={policyRoomIds.includes(room.id)}
                                                  onChange={() => toggleArrayValue(room.id, setPolicyRoomIds)}
                                                  className="accent-blue-600"
                                              />
                                              {room.number}
                                          </label>
                                      ))}
                                      {policyFilteredRooms.length === 0 && (
                                          <div className="text-xs text-gray-400">Không có phòng phù hợp với bộ lọc hiện tại.</div>
                                      )}
                                  </div>
                              </div>
                          </div>

                          <div>
                              <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">Lý do / ghi chú</label>
                              <input
                                  type="text"
                                  value={policyReason}
                                  onChange={(e) => setPolicyReason(e.target.value)}
                                  placeholder={policyMode === 'LOCKED' ? 'Ví dụ: Bảo trì hệ thống điện' : 'Ví dụ: Chỉ nhận khách theo giờ cuối tuần'}
                                  className="mt-1.5 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium outline-none focus:border-blue-500"
                              />
                          </div>

                          <div className="flex flex-wrap gap-2">
                              <button
                                  onClick={handleCreateRoomPolicy}
                                  className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 shadow-sm"
                              >
                                  Lưu chính sách
                              </button>
                              <button
                                  onClick={() => {
                                      setPolicyRecurrence('WEEKLY');
                                      setPolicyWeekdays([6, 0]);
                                  }}
                                  className="bg-white border border-gray-200 px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                  Mẫu T7 + CN hằng tuần
                              </button>
                              <button
                                  onClick={resetPolicyForm}
                                  className="bg-white border border-gray-200 px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                  Reset form
                              </button>
                          </div>
                      </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                          <h3 className="font-bold text-gray-800">Danh sách chính sách đã tạo</h3>
                          <div className="flex gap-2">
                              <button
                                  onClick={() => applyBulkPolicyState(true)}
                                  disabled={selectedPolicyIds.length === 0}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                      selectedPolicyIds.length === 0
                                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                                  }`}
                              >
                                  Mở khóa/Bật lại ({selectedPolicyIds.length})
                              </button>
                              <button
                                  onClick={() => applyBulkPolicyState(false)}
                                  disabled={selectedPolicyIds.length === 0}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                      selectedPolicyIds.length === 0
                                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                  }`}
                              >
                                  Tạm dừng ({selectedPolicyIds.length})
                              </button>
                              <button
                                  onClick={deleteSelectedPolicies}
                                  disabled={selectedPolicyIds.length === 0}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                      selectedPolicyIds.length === 0
                                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                                  }`}
                              >
                                  Xóa ({selectedPolicyIds.length})
                              </button>
                          </div>
                      </div>

                      <div className="overflow-auto">
                          <table className="w-full text-left text-sm whitespace-nowrap">
                              <thead className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500">
                                  <tr>
                                      <th className="px-4 py-3">
                                          <input
                                              type="checkbox"
                                              checked={roomPolicies.length > 0 && selectedPolicyIds.length === roomPolicies.length}
                                              onChange={(e) => setSelectedPolicyIds(e.target.checked ? roomPolicies.map(policy => policy.id) : [])}
                                          />
                                      </th>
                                      <th className="px-4 py-3">Chế độ</th>
                                      <th className="px-4 py-3">Lịch áp dụng</th>
                                      <th className="px-4 py-3">Mục tiêu</th>
                                      <th className="px-4 py-3">Lý do</th>
                                      <th className="px-4 py-3">Trạng thái</th>
                                      <th className="px-4 py-3">Thao tác</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                  {roomPolicies.map(policy => {
                                      const weekdayLabel = (policy.weekdays || []).map(day => ({
                                          0: 'CN',
                                          1: 'T2',
                                          2: 'T3',
                                          3: 'T4',
                                          4: 'T5',
                                          5: 'T6',
                                          6: 'T7',
                                      }[day])).filter(Boolean).join(', ');

                                      return (
                                          <tr key={policy.id} className="hover:bg-gray-50">
                                              <td className="px-4 py-3">
                                                  <input
                                                      type="checkbox"
                                                      checked={selectedPolicyIds.includes(policy.id)}
                                                      onChange={() =>
                                                          setSelectedPolicyIds(prev =>
                                                              prev.includes(policy.id)
                                                                  ? prev.filter(id => id !== policy.id)
                                                                  : [...prev, policy.id]
                                                          )
                                                      }
                                                  />
                                              </td>
                                              <td className="px-4 py-3">
                                                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                      policy.mode === 'LOCKED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                                  }`}>
                                                      {policy.mode === 'LOCKED' ? 'Khóa phòng' : 'Chỉ nhận khách giờ'}
                                                  </span>
                                              </td>
                                              <td className="px-4 py-3 text-xs font-semibold text-gray-700">
                                                  <div>{policy.startDate} → {policy.endDate || 'Không giới hạn'}</div>
                                                  {policy.recurrence === 'WEEKLY' && <div className="text-blue-600 mt-0.5">Lặp: {weekdayLabel || '--'}</div>}
                                                  {policy.mode === 'HOURLY_ONLY' && <div className="text-gray-500 mt-0.5">Tối đa 12 tiếng/lượt lưu trú</div>}
                                              </td>
                                              <td className="px-4 py-3 text-xs font-semibold text-gray-700">{policyTargetSummary(policy)}</td>
                                              <td className="px-4 py-3 text-xs text-gray-600 max-w-[260px] truncate" title={policy.reason || '--'}>
                                                  {policy.reason || '--'}
                                              </td>
                                              <td className="px-4 py-3">
                                                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                      policy.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                                  }`}>
                                                      {policy.isActive ? 'Đang áp dụng' : 'Tạm dừng'}
                                                  </span>
                                              </td>
                                              <td className="px-4 py-3">
                                                  <div className="flex gap-2">
                                                      <button
                                                          onClick={() => DataService.saveRoomPolicies(roomPolicies.map(item => item.id === policy.id ? { ...item, isActive: !item.isActive } : item))}
                                                          className="px-2.5 py-1 rounded-md text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                      >
                                                          {policy.isActive ? 'Dừng' : 'Bật'}
                                                      </button>
                                                      <button
                                                          onClick={() => {
                                                              if (!window.confirm('Xóa chính sách phòng này? Hành động này không thể hoàn tác.')) return;
                                                              DataService.deleteItems('roomPolicies', [policy.id]);
                                                              setSelectedPolicyIds(prev => prev.filter(id => id !== policy.id));
                                                              onRefresh();
                                                          }}
                                                          className="px-2.5 py-1 rounded-md text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200"
                                                      >
                                                          Xóa
                                                      </button>
                                                  </div>
                                              </td>
                                          </tr>
                                      );
                                  })}
                                  {roomPolicies.length === 0 && (
                                      <tr>
                                          <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                                              Chưa có chính sách nào. Hãy tạo chính sách ở form phía trên.
                                          </td>
                                      </tr>
                                  )}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          )}

          {/* TAB 4: PHÂN QUYỀN (SỬ DỤNG LẠI COMPONENT ADMIN) */}
          {activeTab === 'ADMIN' && (
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm animate-fade-in">
                 <Admin users={users} properties={properties} currentUser={currentUser} onRefresh={onRefresh} />
              </div>
          )}

          {/* TAB 5: ADVANCED (TAGS & DANH MỤC THU CHI) */}
          {activeTab === 'ADVANCED' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                  {/* Quản lý Thẻ (Tags) */}
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                       <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-gray-800 flex items-center gap-2"><TagIcon size={18} className="text-blue-600"/> Thẻ phân loại (Tags)</h2>
                            <div className="flex gap-2">
                                <button onClick={() => setDraftTags([...draftTags, { id: `t_${Date.now()}`, name: 'Thẻ mới', color: '#3b82f6' }])} className="text-sm bg-white border border-gray-300 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50">Thêm thẻ</button>
                                <button onClick={() => runSaveAction('thẻ', () => DataService.saveTags(draftTags.map(tag => ({ ...tag, name: tag.name.trim() || 'Chưa đặt tên' }))))} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700">Lưu</button>
                            </div>
                       </div>
                       <div className="p-5 space-y-3">
                            {draftTags.map(tag => (
                                <div key={tag.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <input type="color" value={tag.color} onChange={(e) => setDraftTags(draftTags.map(t => t.id === tag.id ? {...t, color: e.target.value} : t))} className="w-8 h-8 rounded cursor-pointer border-none" />
                                    <input type="text" value={tag.name} onChange={(e) => setDraftTags(draftTags.map(t => t.id === tag.id ? {...t, name: e.target.value} : t))} className="flex-1 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none px-1 text-sm font-medium" />
                                    <button onClick={() => setDraftTags(draftTags.filter(t => t.id !== tag.id))} className="text-red-500 hover:bg-red-100 p-1.5 rounded-md"><Trash2 size={16}/></button>
                                </div>
                            ))}
                            {draftTags.length === 0 && <div className="text-sm text-gray-400 text-center py-6">Chưa có thẻ nào.</div>}
                       </div>
                  </div>

                  {/* Quản lý Danh mục Thu/Chi */}
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                       <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <h2 className="font-bold text-gray-800 flex items-center gap-2"><DollarSign size={18} className="text-green-600"/> Danh mục Thu / Chi</h2>
                            <div className="flex gap-2">
                                <button onClick={() => setDraftCategories([...draftCategories, { id: `cat_${Date.now()}`, name: 'Danh mục mới', type: 'EXPENSE' }])} className="text-sm bg-white border border-gray-300 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50">Thêm danh mục</button>
                                <button onClick={() => runSaveAction('danh mục thu chi', () => DataService.saveTransactionCategories(draftCategories.map(cat => ({ ...cat, name: cat.name.trim() || 'Chưa đặt tên' }))))} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700">Lưu</button>
                            </div>
                       </div>
                       <div className="p-5 space-y-3">
                            {draftCategories.map(cat => (
                                <div key={cat.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <select 
                                        className={`text-xs font-bold px-2 py-1 rounded-md outline-none border-none ${cat.type === 'REVENUE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                        value={cat.type}
                                        onChange={(e) => setDraftCategories(draftCategories.map(c => c.id === cat.id ? {...c, type: e.target.value as 'REVENUE'|'EXPENSE'} : c))}
                                    >
                                        <option value="REVENUE">THU</option>
                                        <option value="EXPENSE">CHI</option>
                                    </select>
                                    <input type="text" value={cat.name} onChange={(e) => setDraftCategories(draftCategories.map(c => c.id === cat.id ? {...c, name: e.target.value} : c))} className="flex-1 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none px-1 text-sm font-medium" />
                                    <button onClick={() => setDraftCategories(draftCategories.filter(c => c.id !== cat.id))} className="text-red-500 hover:bg-red-100 p-1.5 rounded-md"><Trash2 size={16}/></button>
                                </div>
                            ))}
                            {draftCategories.length === 0 && <div className="text-sm text-gray-400 text-center py-6">Chưa có danh mục nào.</div>}
                       </div>
                  </div>
              </div>
          )}

      </div>

      {/* --- MODAL XÁC NHẬN XÓA CHUNG --- */}
      {deleteModal?.isOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
                  <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">{deleteModal.title}</h3>
                  <p className="text-gray-600 text-sm mb-4 text-center">
                      Nếu xóa, toàn bộ dữ liệu liên quan sẽ bị xóa vĩnh viễn và không thể hoàn tác.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                      <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                          <div className="text-xs text-red-500 font-bold uppercase">Phòng</div>
                          <div className="text-lg font-black text-red-700">{deleteModal.impact.rooms}</div>
                      </div>
                      <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                          <div className="text-xs text-red-500 font-bold uppercase">Hạng phòng</div>
                          <div className="text-lg font-black text-red-700">{deleteModal.impact.roomTypes}</div>
                      </div>
                      <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                          <div className="text-xs text-red-500 font-bold uppercase">Booking</div>
                          <div className="text-lg font-black text-red-700">{deleteModal.impact.bookings}</div>
                      </div>
                      <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                          <div className="text-xs text-red-500 font-bold uppercase">Chính sách</div>
                          <div className="text-lg font-black text-red-700">{deleteModal.impact.roomPolicies}</div>
                      </div>
                  </div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                      Gõ đúng <span className="text-red-600">XÓA</span> để xác nhận
                  </label>
                  <input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      className="w-full border-2 border-red-200 rounded-lg px-3 py-2 font-bold text-gray-900 outline-none focus:border-red-500"
                      placeholder="XÓA"
                      autoFocus
                  />
                  {deleteError && (
                      <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm font-semibold text-red-700">
                          {deleteError}
                      </div>
                  )}
                  <div className="flex gap-3">
                      <button onClick={closeDeleteModal} disabled={isDeleting} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-60">Huỷ bỏ</button>
                      <button
                          onClick={handleConfirmCascadeDelete}
                          disabled={deleteConfirmText.trim() !== 'XÓA' || isDeleting}
                          className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-lg shadow-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                          {isDeleting ? 'Đang xoá...' : 'Xóa vĩnh viễn'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Management;
