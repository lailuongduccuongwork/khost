
import React, { useState, useRef, useEffect } from 'react';
import { Booking, BookingStatus, Room, Customer, User, PERMISSIONS, RoomStatus } from '../types';
import { Search, Plus, Trash2, FileUp, FileDown, Download, Upload, RotateCcw, CheckCircle, Square, CheckSquare, X, AlertTriangle } from 'lucide-react';
import { DataService } from '../services/dataService';

// Declare XLSX from global scope (loaded via CDN in index.html)
declare const XLSX: any;

interface BookingsProps {
  bookings: Booking[];
  rooms: Room[];
  customers: Customer[];
  onRefresh?: () => void;
  currentUser: User; // Full user for permissions
}

const Bookings: React.FC<BookingsProps> = ({ bookings, rooms, customers, onRefresh, currentUser }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Custom Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
      isOpen: boolean;
      idsToDelete: string[]; // List of IDs to delete
      isBatchUndo?: boolean; // Flag to distinguish import undo vs normal delete
  }>({ isOpen: false, idsToDelete: [] });

  // Undo Import State
  const [lastImportBatch, setLastImportBatch] = useState<{ id: string, count: number, fileName: string } | null>(null);

  const canAdd = currentUser.permissions?.includes(PERMISSIONS.CAN_ADD_BOOKING);
  const canDelete = currentUser.permissions?.includes(PERMISSIONS.CAN_DELETE_BOOKING);

  // Helper to get display name
  const getDisplayName = (b: Booking) => {
      return b.guestName || customers.find(c => c.id === b.customerId)?.name || 'Khách lẻ';
  };

  const getRoomNumber = (id: string) => rooms.find(r => r.id === id)?.number || 'N/A';

  const filteredBookings = bookings.filter(b => {
    const customerName = getDisplayName(b).toLowerCase();
    const customerPhone = (b.guestPhone || customers.find(c => c.id === b.customerId)?.phone || '').toLowerCase();
    const roomNumber = getRoomNumber(b.roomId).toLowerCase();
    const term = searchTerm.toLowerCase();
    
    return customerName.includes(term) || 
           customerPhone.includes(term) || 
           roomNumber.includes(term) || 
           b.id.toLowerCase().includes(term);
  });

  // --- SELECTION LOGIC ---
  const toggleSelectAll = () => {
      if (selectedIds.size === filteredBookings.length && filteredBookings.length > 0) {
          setSelectedIds(new Set());
      } else {
          const allIds = new Set(filteredBookings.map(b => b.id));
          setSelectedIds(allIds);
      }
  };

  const toggleSelectRow = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) {
          newSet.delete(id);
      } else {
          newSet.add(id);
      }
      setSelectedIds(newSet);
  };

  // --- DELETE LOGIC (UPDATED WITH CUSTOM MODAL) ---
  
  // 1. Trigger for Single Delete
  const handleDeleteSingle = (id: string) => {
      if (!canDelete) return;
      setDeleteModal({
          isOpen: true,
          idsToDelete: [id]
      });
  };

  // 2. Trigger for Bulk Delete
  const handleDeleteSelected = () => {
      if (!canDelete || selectedIds.size === 0) return;
      setDeleteModal({
          isOpen: true,
          idsToDelete: Array.from(selectedIds)
      });
  };

  // 3. Trigger for Undo Import
  const handleUndoImportTrigger = () => {
      if (!lastImportBatch) return;
      setDeleteModal({
          isOpen: true,
          idsToDelete: [lastImportBatch.id], // Here ID refers to BatchID
          isBatchUndo: true
      });
  };

  // 4. Confirm Action
  const confirmDeleteAction = () => {
      const { idsToDelete, isBatchUndo } = deleteModal;

      if (isBatchUndo) {
          // Special case for Batch Undo
          const batchId = idsToDelete[0];
          const deletedCount = DataService.deleteBookingsByBatchId(batchId, currentUser.id);
          setLastImportBatch(null);
      } else {
          // Normal Delete (Single or Bulk)
          DataService.deleteBookings(idsToDelete, currentUser.id);
          setSelectedIds(new Set());
      }

      setDeleteModal({ isOpen: false, idsToDelete: [] });
      if (onRefresh) onRefresh();
  };

  const getStatusBadge = (status: BookingStatus) => {
      const styles = {
          [BookingStatus.PENDING]: 'bg-yellow-100 text-yellow-800',
          [BookingStatus.CONFIRMED]: 'bg-blue-100 text-blue-800',
          [BookingStatus.CHECKED_IN]: 'bg-green-100 text-green-800',
          [BookingStatus.CHECKED_OUT]: 'bg-gray-100 text-gray-800',
          [BookingStatus.CANCELLED]: 'bg-red-100 text-red-800',
          [BookingStatus.DELETED]: 'bg-black text-white',
      };
      return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>{status}</span>;
  };

  const handleCreate = () => {
      if(!canAdd) {
          alert("Bạn không có quyền tạo đơn.");
          return;
      }
      alert("Vui lòng sử dụng Sơ đồ phòng để tạo đơn mới trực quan hơn.");
  };

  // --- EXCEL IMPORT/EXPORT LOGIC ---

  const handleDownloadTemplate = () => {
      const headers = [
          "Chi nhánh",
          "Phòng (Số phòng)", 
          "Hạng phòng",
          "Tên khách hàng", 
          "Số điện thoại", 
          "Ngày nhận (dd/mm/yyyy HH:mm)", 
          "Ngày trả (dd/mm/yyyy HH:mm)", 
          "Tổng tiền", 
          "Đã thanh toán", 
          "Trạng thái (Đang ở/Đã đặt/Đã trả)",
          "Ghi chú"
      ];
      
      // Get properties/types for sample
      const allProps = DataService.getProperties();
      const allTypes = DataService.getRoomTypes();
      
      const sampleProp = allProps[0]?.name || "K-Host Hà Nội";
      const sampleType = allTypes[0]?.name || "Standard Single";
      const sampleRoom = rooms[0]?.number || "101";

      // Sample Data Row
      const sampleRow = [
          sampleProp,
          sampleRoom, 
          sampleType,
          "Nguyễn Văn A", 
          "0912345678", 
          "25/12/2024 14:00", 
          "27/12/2024 12:00", 
          1500000, 
          500000, 
          "Đang ở",
          "Khách quen, nhập dữ liệu cũ"
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
      
      // Set column widths for better UX
      ws['!cols'] = [
          { wch: 20 }, // Branch
          { wch: 10 }, // Room
          { wch: 20 }, // Type
          { wch: 20 }, // Name
          { wch: 15 }, // Phone
          { wch: 20 }, // In
          { wch: 20 }, // Out
          { wch: 12 }, // Total
          { wch: 12 }, // Paid
          { wch: 15 }, // Status
          { wch: 30 }  // Note
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mau_Nhap_Lieu");
      XLSX.writeFile(wb, "KHost_Mau_Import_Booking.xlsx");
  };

  const parseStatus = (val: string): BookingStatus => {
      if (!val) return BookingStatus.CONFIRMED;
      const v = val.toLowerCase().trim();
      if (v.includes('đang') || v.includes('check-in') || v.includes('checkin')) return BookingStatus.CHECKED_IN;
      if (v.includes('trả') || v.includes('xong') || v.includes('check-out') || v.includes('checkout')) return BookingStatus.CHECKED_OUT;
      if (v.includes('hủy') || v.includes('huỷ')) return BookingStatus.CANCELLED;
      return BookingStatus.CONFIRMED;
  }

  // FIXED: Correct Date Parsing without manual offset shifting
  const parseExcelDate = (val: any): string => {
      if (!val) return new Date().toISOString();
      
      let dateObj: Date;
      if (val instanceof Date) {
          dateObj = val;
      } else if (typeof val === 'string') {
          // Try parse string dd/mm/yyyy HH:mm
          const parts = val.split(/[/\s:]/);
          if (parts.length >= 3) {
              // Simple parser assuming dd/mm/yyyy
              // Note: Month is 0-indexed in JS Date
              dateObj = new Date(Number(parts[2]), Number(parts[1])-1, Number(parts[0]), Number(parts[3]||14), Number(parts[4]||0));
          } else {
              dateObj = new Date(val);
          }
      } else {
          // Fallback
          dateObj = new Date();
      }

      // Return standard ISO string. 
      // If dateObj is "25/10 14:00 Local", toISOString will convert it to UTC correctly.
      // RoomMap will then read UTC and convert back to Local 14:00 correctly.
      return dateObj.toISOString();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      const reader = new FileReader();
      
      reader.onload = (evt) => {
          try {
              const bstr = evt.target?.result;
              const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
              const wsname = wb.SheetNames[0];
              const ws = wb.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

              // Data[0] is Header
              // Data[1...] is Rows
              let successCount = 0;
              let errorLog: string[] = [];

              if (data.length < 2) {
                  alert("File không có dữ liệu!");
                  setIsImporting(false);
                  return;
              }

              const allProperties = DataService.getProperties();
              
              // Generate Batch ID for Undo
              const batchId = `import_${Date.now()}`;

              // Mapping logic
              for (let i = 1; i < data.length; i++) {
                  const row: any = data[i];
                  if (!row || row.length === 0) continue;

                  // Indexes based on NEW Template Headers
                  // 0: Chi nhánh, 1: Phòng, 2: Hạng, 3: Khách, 4: SĐT, 5: In, 6: Out, 7: Total, 8: Paid, 9: Status, 10: Note
                  const branchName = String(row[0] || '').trim();
                  const roomNum = String(row[1] || '').trim();
                  // Index 2 is Room Type (Visual only, we lookup by ID mostly via Room)
                  const guestName = String(row[3] || 'Khách import');
                  const phone = String(row[4] || '');
                  const checkInRaw = row[5];
                  const checkOutRaw = row[6];
                  const total = Number(row[7]) || 0;
                  const paid = Number(row[8]) || 0;
                  const statusRaw = String(row[9] || '');
                  const note = String(row[10] || '');

                  // 1. Find Property ID if branch name is provided
                  let targetPropId: string | undefined;
                  if (branchName) {
                      const prop = allProperties.find(p => p.name.toLowerCase() === branchName.toLowerCase());
                      if (prop) targetPropId = prop.id;
                  }

                  // 2. Find Room ID
                  // Filter rooms by Property Name if provided to avoid duplicate room numbers conflicts
                  const targetRoom = rooms.find(r => {
                      const numMatch = r.number === roomNum;
                      if (!numMatch) return false;
                      if (targetPropId) return r.propertyId === targetPropId;
                      return true; // If no branch specified in Excel, match first room found (Risky but fallback)
                  });

                  if (!targetRoom) {
                      errorLog.push(`Dòng ${i+1}: Không tìm thấy phòng "${roomNum}"${branchName ? ` tại chi nhánh "${branchName}"` : ''}`);
                      continue;
                  }

                  // 2. Create Booking Object
                  const newBooking: Booking = {
                      id: DataService.generateBookingId(),
                      tenantId: targetRoom.tenantId || currentUser.tenantId, // Inherit
                      propertyId: targetRoom.propertyId,
                      roomId: targetRoom.id,
                      customerId: 'c_import', // Placeholder or create new customer logic if needed
                      guestName: guestName,
                      guestPhone: phone,
                      checkInDate: parseExcelDate(checkInRaw),
                      checkOutDate: parseExcelDate(checkOutRaw),
                      status: parseStatus(statusRaw),
                      totalPrice: total,
                      paidAmount: paid,
                      createdAt: new Date().toISOString(),
                      createdBy: currentUser.id,
                      notes: note + " [Imported]",
                      tags: [],
                      extraFees: [],
                      importBatchId: batchId // Assign Batch ID
                  };

                  DataService.addBooking(newBooking);
                  successCount++;
              }

              if (successCount > 0) {
                  setLastImportBatch({ id: batchId, count: successCount, fileName: file.name });
                  if (onRefresh) onRefresh();
              } else {
                  if (errorLog.length > 0) alert(`Có lỗi xảy ra:\n${errorLog.slice(0, 5).join('\n')}...`);
              }

          } catch (error) {
              console.error(error);
              alert("Lỗi đọc file Excel. Vui lòng đảm bảo đúng định dạng mẫu.");
          } finally {
              setIsImporting(false);
              if (fileInputRef.current) fileInputRef.current.value = ''; // Reset input
          }
      };
      
      reader.readAsBinaryString(file);
  };

  const triggerUpload = () => {
      if (fileInputRef.current) fileInputRef.current.click();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 animate-fade-in relative">
      <div className="p-5 border-b border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h2 className="text-lg font-bold text-gray-800">Danh sách đặt phòng</h2>
            <p className="text-xs text-gray-500">Quản lý và tra cứu lịch sử đặt phòng</p>
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
            {canAdd && (
                <>
                    <button 
                        onClick={handleDownloadTemplate}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors border border-gray-200"
                        title="Tải file Excel mẫu để nhập liệu"
                    >
                        <Download size={16} /> <span className="hidden sm:inline">Tải mẫu Excel</span>
                    </button>
                    
                    <button 
                        onClick={triggerUpload}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm"
                        title="Nhập dữ liệu từ file Excel"
                        disabled={isImporting}
                    >
                        <FileUp size={16} /> <span className="hidden sm:inline">{isImporting ? 'Đang nhập...' : 'Nhập Excel'}</span>
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".xlsx, .xls" 
                        onChange={handleFileUpload} 
                    />

                    <button 
                        onClick={handleCreate}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm"
                    >
                        <Plus size={16} /> Tạo đơn
                    </button>
                </>
            )}
        </div>
      </div>
      
      {/* UNDO BANNER */}
      {lastImportBatch && (
          <div className="bg-blue-50 border-b border-blue-100 p-3 flex justify-between items-center animate-fade-in">
              <div className="flex items-center gap-2 text-blue-800 text-sm">
                  <CheckCircle size={18} className="text-green-600"/>
                  <span>
                      Đã nhập thành công <b>{lastImportBatch.count}</b> đơn từ file <i>{lastImportBatch.fileName}</i>.
                  </span>
              </div>
              <button 
                  onClick={handleUndoImportTrigger}
                  className="bg-white border border-blue-200 text-red-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-50 flex items-center gap-1 shadow-sm transition-colors"
              >
                  <RotateCcw size={14} /> Hoàn tác (Undo)
              </button>
          </div>
      )}

      {/* BULK ACTIONS TOOLBAR (Floating) */}
      {selectedIds.size > 0 && canDelete && (
          <div className="absolute top-[80px] left-0 right-0 z-10 mx-4">
              <div className="bg-gray-800 text-white p-3 rounded-lg shadow-xl flex justify-between items-center animate-slide-up">
                  <div className="flex items-center gap-3">
                      <span className="font-bold text-sm bg-gray-700 px-2 py-1 rounded">
                          Đã chọn {selectedIds.size}
                      </span>
                      <span className="text-xs text-gray-300">đơn đặt phòng</span>
                  </div>
                  <button 
                      onClick={handleDeleteSelected}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-colors shadow-sm"
                  >
                      <Trash2 size={16}/> Xoá {selectedIds.size} đơn
                  </button>
              </div>
          </div>
      )}

      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
                type="text" 
                placeholder="Tìm theo tên khách, số điện thoại, số phòng, mã đơn..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 text-gray-700 font-semibold uppercase text-xs">
            <tr>
              <th className="px-4 py-3 w-10 text-center">
                  <button onClick={toggleSelectAll}>
                      {selectedIds.size > 0 && selectedIds.size === filteredBookings.length ? (
                          <CheckSquare size={18} className="text-blue-600" />
                      ) : (
                          <Square size={18} className="text-gray-400 hover:text-gray-600" />
                      )}
                  </button>
              </th>
              <th className="px-6 py-3">Mã Booking</th>
              <th className="px-6 py-3">Khách hàng</th>
              <th className="px-6 py-3">Phòng</th>
              <th className="px-6 py-3">Ngày đến - Đi</th>
              <th className="px-6 py-3">Trạng thái</th>
              <th className="px-6 py-3">Tổng tiền</th>
              <th className="px-6 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredBookings.map((booking) => {
                const isSelected = selectedIds.has(booking.id);
                return (
                  <tr key={booking.id} className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-4 text-center">
                        <button onClick={() => toggleSelectRow(booking.id)}>
                            {isSelected ? (
                                <CheckSquare size={18} className="text-blue-600" />
                            ) : (
                                <Square size={18} className="text-gray-300 hover:text-gray-500" />
                            )}
                        </button>
                    </td>
                    <td className="px-6 py-4 font-mono text-blue-600 font-medium">{booking.id}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                        <div>{getDisplayName(booking)}</div>
                        <div className="text-xs text-gray-400">{booking.guestPhone}</div>
                    </td>
                    <td className="px-6 py-4"><span className="bg-gray-100 px-2 py-1 rounded font-bold text-gray-700">{getRoomNumber(booking.roomId)}</span></td>
                    <td className="px-6 py-4">
                        <div className="flex flex-col text-xs">
                            <span>In: {new Date(booking.checkInDate).toLocaleDateString('vi-VN')}</span>
                            <span className="text-gray-400">Out: {new Date(booking.checkOutDate).toLocaleDateString('vi-VN')}</span>
                        </div>
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(booking.status)}</td>
                    <td className="px-6 py-4 font-semibold text-gray-700">
                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(booking.totalPrice)}
                    </td>
                    <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                            {canDelete && (
                                <button 
                                    onClick={() => handleDeleteSingle(booking.id)} 
                                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors" 
                                    title="Xóa đơn vĩnh viễn"
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>
                    </td>
                  </tr>
                );
            })}
            {filteredBookings.length === 0 && (
                <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-gray-400">Không tìm thấy dữ liệu</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CUSTOM DELETE CONFIRMATION MODAL */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in relative" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setDeleteModal({...deleteModal, isOpen: false})} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  
                  <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 mx-auto">
                      <AlertTriangle size={24} />
                  </div>
                  
                  <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                      {deleteModal.isBatchUndo ? 'Hoàn tác Import' : 'Xác nhận xoá'}
                  </h3>
                  
                  <div className="text-sm text-center mb-6 text-gray-600">
                      {deleteModal.isBatchUndo ? (
                          `Bạn có chắc chắn muốn hoàn tác và xoá toàn bộ các đơn đặt phòng vừa nhập?`
                      ) : (
                          <>
                              Bạn sắp xoá vĩnh viễn <b>{deleteModal.idsToDelete.length}</b> đơn đặt phòng.
                              <br/>Hành động này không thể khôi phục.
                          </>
                      )}
                  </div>
                  
                  <div className="flex gap-3">
                      <button 
                          onClick={() => setDeleteModal({...deleteModal, isOpen: false})} 
                          className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200 transition-colors"
                      >
                          Huỷ bỏ
                      </button>
                      <button 
                          onClick={confirmDeleteAction} 
                          className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                      >
                          {deleteModal.isBatchUndo ? 'Xác nhận Hoàn tác' : 'Xoá vĩnh viễn'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Bookings;
