
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
    // Safety check
    if (!b) return false;

    const customerName = (getDisplayName(b) || '').toLowerCase();
    const customerPhone = (b.guestPhone || customers.find(c => c.id === b.customerId)?.phone || '').toLowerCase();
    const roomNumber = (getRoomNumber(b.roomId) || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    const bId = (b.id || '').toLowerCase();
    
    return customerName.includes(term) || 
           customerPhone.includes(term) || 
           roomNumber.includes(term) || 
           bId.includes(term);
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
      
      const sampleRows = [
          ["HD", "HD", "202", "Đức Anh", "31/12/2025 23:30:00", "01/01/2026 07:30:00", 350000, 350000, "Ghi chú mẫu"],
          ["K-Host ĐN", "Std", "301", "Nguyễn Văn A", "05/05/2025 14:00:00", "06/05/2025 12:00:00", 500000, 200000, "Khách quen"]
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      
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

  // ROBUST DATE PARSER (VIETNAM FORMAT + EXCEL SERIAL + ISO)
  const parseImportDate = (val: any): string | null => {
      if (!val) return null;

      let dateObj: Date | null = null;

      // 1. Handle Excel Serial Number (e.g., 45657.9)
      if (typeof val === 'number') {
           // Excel base date is 1900-01-01. JS is 1970-01-01. Diff is ~25569 days.
           dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
      } 
      // 2. Handle JS Date Object (SheetJS with cellDates: true)
      else if (val instanceof Date) {
           dateObj = val;
      }
      // 3. Handle String Format (Crucial for "31/12/2025 23:30:00")
      else if (typeof val === 'string') {
          const str = val.trim();
          // Regex for dd/mm/yyyy hh:mm:ss or dd/mm/yy hh:mm
          // Split by any non-digit character
          const parts = str.split(/[\s/:\-]+/);
          
          if (parts.length >= 3) {
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1; // JS Month is 0-11
              let year = parseInt(parts[2], 10);
              // Handle 2-digit year (e.g. 25 -> 2025)
              if (year < 100) year += 2000;

              const hour = parts[3] ? parseInt(parts[3], 10) : 12; // Default to noon if no time
              const min = parts[4] ? parseInt(parts[4], 10) : 0;
              const sec = parts[5] ? parseInt(parts[5], 10) : 0;

              dateObj = new Date(year, month, day, hour, min, sec);
          } else {
              // Try standard parsing as fallback
              const tryDate = new Date(str);
              if (!isNaN(tryDate.getTime())) dateObj = tryDate;
          }
      }

      if (!dateObj || isNaN(dateObj.getTime())) return null;

      // ADJUST TIMEZONE: We want the string to "Look" like the local time without UTC conversion shift.
      const offset = dateObj.getTimezoneOffset() * 60000; 
      const localDate = new Date(dateObj.getTime() - offset);
      
      // Return ISO string without 'Z' -> "2025-12-31T23:30:00.000"
      return localDate.toISOString().slice(0, -1);
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
              const batchId = `import_${Date.now()}`;

              // Loop through rows
              for (let i = 1; i < data.length; i++) {
                  const row: any = data[i];
                  if (!row || row.length === 0) continue;

                  // --- EXTRACT DATA ---
                  const branchName = String(row[0] || '').trim();
                  const roomNum = String(row[2] || '').trim(); // Tên phòng
                  const guestName = String(row[3] || 'Khách Import');
                  const checkInRaw = row[4];
                  const checkOutRaw = row[5];
                  const total = Number(row[6]) || 0;
                  const paid = Number(row[7]) || 0;
                  const note = String(row[8] || '');

                  if (!roomNum) continue; // Skip empty rows

                  // --- 1. SMART PROPERTY MATCHING ---
                  let targetPropId: string | undefined;
                  
                  if (branchName) {
                      // Attempt 1: Exact or Partial match
                      // Safeguard: Ensure p.name is string
                      const prop = allProperties.find(p => 
                          (p.name || '').toLowerCase().includes(branchName.toLowerCase()) || 
                          branchName.toLowerCase().includes((p.name || '').toLowerCase())
                      );
                      if (prop) targetPropId = prop.id;
                  }

                  // --- 2. ROOM FINDING LOGIC ---
                  let targetRoom: Room | undefined;

                  // Find all rooms with this number
                  // Safeguard: Ensure r.number is string
                  const matches = rooms.filter(r => (r.number || '').toLowerCase() === roomNum.toLowerCase());

                  if (matches.length === 0) {
                      errorLog.push(`Dòng ${i+1}: Không tìm thấy phòng số "${roomNum}" trong hệ thống.`);
                      continue;
                  } else if (matches.length === 1) {
                      // Perfect! Only one room exists with this number (even if branch name is wrong/missing)
                      targetRoom = matches[0];
                  } else {
                      // Multiple rooms with same number. Need to filter by Property.
                      if (targetPropId) {
                          targetRoom = matches.find(r => r.propertyId === targetPropId);
                      }
                      
                      // If still no match (e.g. Branch "HD" didn't match "K-Host Hà Nội"), fail strictly to avoid wrong assignment
                      if (!targetRoom) {
                          // Try one last fuzzy fallback: Check if the Branch string provided starts with same letter? 
                          // No, too risky. Just Error out.
                          errorLog.push(`Dòng ${i+1}: Có nhiều phòng số "${roomNum}". Vui lòng nhập đúng tên Chi nhánh (VD: ${allProperties.map(p=>p.name).join(', ')}) để phân biệt.`);
                          continue;
                      }
                  }

                  // --- 3. DATE PARSING ---
                  const checkInISO = parseImportDate(checkInRaw);
                  const checkOutISO = parseImportDate(checkOutRaw);

                  if (!checkInISO || !checkOutISO) {
                      errorLog.push(`Dòng ${i+1}: Định dạng ngày tháng không hợp lệ (Yêu cầu: dd/mm/yyyy hh:mm:ss).`);
                      continue;
                  }

                  // --- 4. CREATE BOOKING ---
                  const inferredStatus = inferStatus(new Date(checkInISO), new Date(checkOutISO));

                  const newBooking: Booking = {
                      id: DataService.generateBookingId(),
                      tenantId: targetRoom.tenantId || currentUser.tenantId,
                      propertyId: targetRoom.propertyId,
                      roomId: targetRoom.id,
                      customerId: 'c_import',
                      guestName: guestName,
                      guestPhone: '', 
                      checkInDate: checkInISO,
                      checkOutDate: checkOutISO,
                      status: inferredStatus,
                      totalPrice: total,
                      paidAmount: paid,
                      createdAt: new Date().toISOString(),
                      createdBy: currentUser.id,
                      notes: note + (branchName ? ` [CN: ${branchName}]` : '') + " [Excel]",
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
                  
                  if (errorLog.length > 0) {
                      alert(`Đã nhập thành công ${successCount} dòng.\n\nTUY NHIÊN CÓ MỘT SỐ LỖI:\n${errorLog.join('\n')}`);
                  } else {
                      alert(`Đã nhập thành công ${successCount} đơn đặt phòng!`);
                  }
              } else {
                  if (errorLog.length > 0) alert(`KHÔNG NHẬP ĐƯỢC DÒNG NÀO!\n\nNguyên nhân:\n${errorLog.slice(0, 10).join('\n')}${errorLog.length > 10 ? '\n...' : ''}`);
                  else alert("File không có dữ liệu hợp lệ.");
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
