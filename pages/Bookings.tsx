
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

  const handleResetAll = () => {
      if(confirm("CẢNH BÁO CỰC KỲ QUAN TRỌNG!\n\nBạn sắp XOÁ SẠCH TOÀN BỘ dữ liệu đặt phòng trên hệ thống.\nHành động này không thể khôi phục được.\n\nBạn có chắc chắn muốn làm mới (Reset) toàn bộ không?")) {
          DataService.resetAllBookings();
          if(onRefresh) onRefresh();
          alert("Đã xoá sạch dữ liệu đặt phòng!");
      }
  }

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

  // --- EXCEL IMPORT/EXPORT LOGIC (UPDATED) ---

  const handleDownloadTemplate = () => {
      // Updated Headers per request
      const headers = [
          "Chi nhánh",
          "Hạng phòng", 
          "Tên phòng",
          "Khách hàng",
          "Thời gian nhận (dd/mm/yyyy hh:mm:ss)", 
          "Thời gian trả (dd/mm/yyyy hh:mm:ss)", 
          "Tổng tiền (###0)", 
          "Khách đã trả (###0)", 
          "Ghi chú"
      ];
      
      // Updated Sample Data
      const sampleRows = [
          ["CS2", "WAFFLE", "301", "Nguyen Phuong Ann", "31/12/2025 00:00:00", "31/12/2025 12:00:00", 606000, 399000, "hihi"],
          ["CS2", "WAFFLE", "401", "Phuc Anhh", "31/12/2025 14:15:00", "31/12/2025 18:15:00", 420000, 420000, "jztr"],
          ["CS2", "WAFFLE", "302", "Tiến Anh", "31/12/2025 09:00:00", "31/12/2025 19:00:00", 699000, 699000, "test"],
          ["CS2", "WAFFLE", "301", "Khoá phòng", "31/12/2025 20:00:00", "31/12/2025 21:00:00", 0, 0, "khoá phòng"]
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      
      // Set column widths for better UX
      ws['!cols'] = [
          { wch: 15 }, // Chi nhánh
          { wch: 15 }, // Hạng phòng
          { wch: 15 }, // Tên phòng
          { wch: 25 }, // Khách hàng
          { wch: 25 }, // Thời gian nhận
          { wch: 25 }, // Thời gian trả
          { wch: 15 }, // Tổng tiền
          { wch: 15 }, // Đã trả
          { wch: 20 }  // Ghi chú
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mau_Nhap_Lieu");
      XLSX.writeFile(wb, "KHost_Mau_Import_Booking.xlsx");
  };

  // Helper to infer status since it's no longer in the template
  const inferStatus = (checkIn: Date, checkOut: Date): BookingStatus => {
      const now = new Date();
      if (now > checkOut) return BookingStatus.CHECKED_OUT;
      if (now >= checkIn && now <= checkOut) return BookingStatus.CHECKED_IN;
      return BookingStatus.CONFIRMED;
  };

  // FIXED: Correct Date Parsing for dd/mm/yyyy hh:mm:ss string or Excel Date
  const parseExcelDate = (val: any): string => {
      if (!val) return new Date().toISOString();
      
      let dateObj: Date;
      if (val instanceof Date) {
          dateObj = val;
      } else if (typeof val === 'string') {
          // Expected: dd/mm/yyyy hh:mm:ss or dd/mm/yy hh:mm
          const parts = val.split(/[/\s:]/); 
          // parts = [dd, mm, yyyy, hh, mm, ss]
          if (parts.length >= 3) {
              const day = Number(parts[0]);
              const month = Number(parts[1]) - 1; // JS Month is 0-indexed
              let year = Number(parts[2]);
              // Handle 2-digit year (e.g., 25 -> 2025)
              if (year < 100) year += 2000;
              
              const hour = parts[3] ? Number(parts[3]) : 14; // Default to 14:00 if time missing
              const min = parts[4] ? Number(parts[4]) : 0;
              const sec = parts[5] ? Number(parts[5]) : 0;
              dateObj = new Date(year, month, day, hour, min, sec);
          } else {
              dateObj = new Date(val);
          }
      } else if (typeof val === 'number') {
          // Excel serial date number
          dateObj = new Date(Math.round((val - 25569)*86400*1000));
      } else {
          // Fallback
          dateObj = new Date();
      }

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

              // Mapping logic based on NEW Template
              // 0: Chi nhánh | 1: Hạng phòng | 2: Tên phòng | 3: Khách | 4: Vào | 5: Ra | 6: Tổng | 7: Trả | 8: Note
              for (let i = 1; i < data.length; i++) {
                  const row: any = data[i];
                  if (!row || row.length === 0) continue;

                  const branchName = String(row[0] || '').trim();
                  // Index 1 (Hạng phòng) ignored for mapping, we match by room name/number
                  const roomNum = String(row[2] || '').trim(); 
                  const guestName = String(row[3] || 'Khách import');
                  const checkInRaw = row[4];
                  const checkOutRaw = row[5];
                  const total = Number(row[6]) || 0;
                  const paid = Number(row[7]) || 0;
                  const note = String(row[8] || '');

                  // 1. Find Property ID if branch name is provided
                  let targetPropId: string | undefined;
                  if (branchName) {
                      // Try exact match or partial match
                      const prop = allProperties.find(p => 
                          p.name.toLowerCase().includes(branchName.toLowerCase()) || 
                          branchName.toLowerCase().includes(p.name.toLowerCase())
                      );
                      if (prop) targetPropId = prop.id;
                  }

                  // 2. Find Room ID
                  const targetRoom = rooms.find(r => {
                      const numMatch = r.number.toLowerCase() === roomNum.toLowerCase();
                      if (!numMatch) return false;
                      if (targetPropId) return r.propertyId === targetPropId;
                      return true; // If no branch specified, first match
                  });

                  if (!targetRoom) {
                      errorLog.push(`Dòng ${i+1}: Không tìm thấy phòng "${roomNum}"${branchName ? ` tại "${branchName}"` : ''}`);
                      continue;
                  }

                  // 3. Parse Dates
                  const checkInISO = parseExcelDate(checkInRaw);
                  const checkOutISO = parseExcelDate(checkOutRaw);

                  // 4. Infer Status
                  const inferredStatus = inferStatus(new Date(checkInISO), new Date(checkOutISO));

                  // 5. Create Booking Object
                  const newBooking: Booking = {
                      id: DataService.generateBookingId(),
                      tenantId: targetRoom.tenantId || currentUser.tenantId,
                      propertyId: targetRoom.propertyId,
                      roomId: targetRoom.id,
                      customerId: 'c_import',
                      guestName: guestName,
                      guestPhone: '', // Not in template anymore
                      checkInDate: checkInISO,
                      checkOutDate: checkOutISO,
                      status: inferredStatus,
                      totalPrice: total,
                      paidAmount: paid,
                      createdAt: new Date().toISOString(),
                      createdBy: currentUser.id,
                      notes: note + " [Excel]",
                      tags: [],
                      extraFees: [],
                      importBatchId: batchId
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
            {/* RESET BUTTON */}
            {canDelete && (
                <button 
                    onClick={handleResetAll}
                    className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-bold transition-colors"
                    title="Xoá sạch toàn bộ dữ liệu đặt phòng"
                >
                    <Trash2 size={16} /> <span className="hidden sm:inline">Reset Dữ Liệu</span>
                </button>
            )}

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
