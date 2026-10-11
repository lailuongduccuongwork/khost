import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import DialogFrame from '../components/DialogFrame';
import { HousekeepingWarningError } from '../services/dataService';

export function useHousekeepingWarning(open: boolean) {
    const [pending, setPending] = useState<{ error: HousekeepingWarningError; editing: boolean } | null>(null);
    const resolver = useRef<((confirmed: boolean) => void) | null>(null);
    const settle = (confirmed: boolean) => { const resolve = resolver.current; resolver.current = null; setPending(null); resolve?.(confirmed); };
    useEffect(() => { if (!open) settle(false); }, [open]);
    useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);

    const saveWithWarning = async (save: (acknowledgement?: string) => Promise<unknown>, editing = false): Promise<boolean> => {
        let acknowledgement: string | undefined;
        while (true) {
            try { await save(acknowledgement); return true; }
            catch (error) {
                if (!(error instanceof HousekeepingWarningError)) throw error;
                setPending({ error, editing });
                const confirmed = await new Promise<boolean>(resolve => { resolver.current = resolve; });
                if (!confirmed) return false;
                acknowledgement = error.acknowledgement;
                // Re-read and validate on confirmation; changed schedules require a new confirmation.
            }
        }
    };
    const warningDialog = pending && open ? createPortal(
        <DialogFrame label="Cảnh báo lịch dọn phòng" onDismiss={() => settle(false)} className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
            <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
                <div className="flex items-center gap-3 text-amber-700"><AlertTriangle size={28} /><h3 className="text-lg font-bold">Phòng có thể chưa kịp dọn</h3></div>
                <div className="mt-4 space-y-3">
                    {pending.error.warnings.filter(w => w.relatedBooking !== false).map((warning, i) => <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                        {warning.roomLabel && <p className="font-bold">{warning.roomLabel}{warning.bookingPeriod ? ` · ${warning.bookingPeriod}` : ''}</p>}
                        <p className={warning.roomLabel ? 'mt-1' : ''}>{warning.message}</p>
                    </div>)}
                </div>
                {pending.error.warnings.some(w => w.relatedBooking === false) && <details className="mt-3 text-sm text-gray-700">
                    <summary className="cursor-pointer">Ảnh hưởng thêm {pending.error.warnings.filter(w => w.relatedBooking === false).length} lượt nhận phòng khác</summary>
                    <ul className="mt-2 space-y-2">{pending.error.warnings.filter(w => w.relatedBooking === false).map((warning, i) => <li key={i}><strong>{warning.roomLabel}: </strong>{warning.message}</li>)}</ul>
                </details>}
                <div className="mt-5 flex flex-col-reverse sm:flex-row justify-end gap-2">
                    <button type="button" className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold" onClick={() => settle(false)}>Quay lại sửa</button>
                    <button type="button" className="rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-3 text-sm font-bold text-white" onClick={() => settle(true)}>{pending.editing ? 'Đã hiểu, vẫn lưu thay đổi' : 'Đã hiểu, vẫn tạo đơn'}</button>
                </div>
            </div>
        </DialogFrame>, document.body
    ) : null;
    return { saveWithWarning, warningDialog };
}
