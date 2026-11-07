import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import styles from './Combat.module.css';
import type { InfoContent } from './info';

/**
 * Fokus går til panelet når det åpnes (så skjermleseren leser det) og tilbake til knappen som åpnet
 * det når det lukkes. Escape lukker.
 */
function useInfoFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || el?.contains(now))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  return { ref, onKeyDown };
}

/** Infoboksen på laptop: under deltakerlisten til venstre. */
export function InfoBox({ info, onClose }: { info: InfoContent | null; onClose: () => void }) {
  const { ref, onKeyDown } = useInfoFocus(info !== null, onClose);
  if (!info) return null;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`card ${styles.infoBox}`}
      aria-label={`Info: ${info.title}`}
    >
      <div className={styles.infoHead}>
        <b>{info.title}</b>
        <button type="button" className={styles.infoClose} onClick={onClose} aria-label="Lukk info">
          ×
        </button>
      </div>
      <p className={styles.infoText}>{info.text}</p>
    </section>
  );
}

const MIN = 120;
const SMALL = 0.35;
const LARGE = 0.75;

/**
 * Skuffen på mobil og nettbrett: nederst på skjermen. Dra i håndtaket for å gjøre den større eller
 * mindre, trykk på håndtaket for å bytte mellom liten og stor, eller lukk den.
 */
export function InfoDrawer({ info, onClose }: { info: InfoContent | null; onClose: () => void }) {
  const [height, setHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  const { ref, onKeyDown } = useInfoFocus(info !== null, onClose);
  if (!info) return null;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const h = height ?? Math.round(vh * SMALL);
  const large = h > vh * 0.55;
  const clamp = (n: number) => Math.max(MIN, Math.min(Math.round(vh * 0.9), n));

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    drag.current = { startY: e.clientY, startH: h, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setHeight(clamp(d.startH + dy));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // Et trykk uten å dra bytter mellom liten og stor.
    if (d && !d.moved) setHeight(Math.round(vh * (large ? SMALL : LARGE)));
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={styles.drawer}
      style={{ height: h }}
      aria-label={`Info: ${info.title}`}
    >
      <button
        type="button"
        className={styles.drawerHandle}
        aria-label={large ? 'Gjør infoen mindre' : 'Gjør infoen større'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        // Enter og mellomrom gir et klikk uten peker (detail 0). Pekerklikk er allerede håndtert av onPointerUp.
        onClick={(e) => {
          if (e.detail === 0) setHeight(Math.round(vh * (large ? SMALL : LARGE)));
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        <span aria-hidden="true" />
      </button>
      <div className={styles.infoHead}>
        <b>{info.title}</b>
        <button type="button" className={styles.infoClose} onClick={onClose} aria-label="Lukk info">
          ×
        </button>
      </div>
      <p className={`${styles.infoText} ${styles.drawerText}`}>{info.text}</p>
    </section>
  );
}
