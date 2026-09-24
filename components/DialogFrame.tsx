import React, { useEffect, useRef } from 'react';

const dialogStack: HTMLElement[] = [];
let previousBodyOverflow = '';

interface DialogFrameProps {
  children: React.ReactNode;
  className?: string;
  label: string;
  onDismiss: () => void;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/** Shared keyboard and focus behavior, including dialogs opened above another dialog. */
const DialogFrame: React.FC<DialogFrameProps> = ({ children, className = '', label, onDismiss, onClick }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialogStack.length) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogStack.push(frame);
    const isTop = () => dialogStack[dialogStack.length - 1] === frame;
    const focusFrame = requestAnimationFrame(() => {
      if (isTop() && !frame.contains(document.activeElement)) frame.focus({ preventScroll: true });
    });
    const handleKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
      }
      if (event.key === 'Tab') {
        const targets = (Array.from(frame.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')) as HTMLElement[])
          .filter(node => node.tabIndex >= 0 && !node.matches(':disabled, [inert]') && node.getClientRects().length > 0);
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (!first) { event.preventDefault(); frame.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === frame)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === frame)) { event.preventDefault(); first.focus(); }
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (isTop() && !frame.contains(event.target as Node)) frame.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      const wasTop = isTop();
      const index = dialogStack.indexOf(frame);
      if (index !== -1) dialogStack.splice(index, 1);
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', containFocus);
      if (!dialogStack.length) document.body.style.overflow = previousBodyOverflow;
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <div ref={frameRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`katka-app dialog-frame ${className}`} onClick={onClick}>{children}</div>;
};

export default DialogFrame;
