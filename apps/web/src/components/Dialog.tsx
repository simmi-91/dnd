import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Modal dialog med `<dialog>`. Escape og «Lukk» kaller `onClose`. Innholdet monteres bare når
 * dialogen er åpen, så skjemaer starter på nytt hver gang.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className={styles.inner}>
          <div className={styles.head}>
            <h2 id={titleId}>{title}</h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Lukk">
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
