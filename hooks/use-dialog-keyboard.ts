import { useEffect, useRef } from 'react';

// Open dialogs, newest last: only the top one answers Escape and Tab, so a
// confirm opened over an edit dialog closes alone.
const stack: object[] = [];

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal keyboard behaviour: focus moves into the dialog on open, Tab stays
// inside it, Escape closes it, and focus returns to the opener on close.
// Put the returned ref on the dialog panel, next to role="dialog",
// aria-modal="true" and aria-labelledby pointing at its title.
export function useDialogKeyboard<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const token = {};
    stack.push(token);
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || []);
    // Focus after this commit settles (the panel may be inside AnimatePresence).
    const timer = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>('textarea, input:not([type=hidden]), select') || focusables()[0];
      first?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const start = items[0];
      const end = items[items.length - 1];
      if (e.shiftKey && document.activeElement === start) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        start.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      stack.splice(stack.indexOf(token), 1);
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open]);

  return ref;
}
