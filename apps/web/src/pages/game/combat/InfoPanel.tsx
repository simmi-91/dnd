import { useRef, useState, type PointerEvent } from 'react';
import styles from './Combat.module.css';
import type { InfoContent } from './info';

/** Infoboksen på laptop: under deltakerlisten til venstre. */
export function InfoBox({ info, onClose }: { info: InfoContent | null; onClose: () => void }) {
  if (!info) return null;
  return (
    <section className={`card ${styles.infoBox}`} aria-label={`Info: ${info.title}`}>
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
    <section className={styles.drawer} style={{ height: h }} aria-label={`Info: ${info.title}`}>
      <button
        type="button"
        className={styles.drawerHandle}
        aria-label={large ? 'Gjør infoen mindre' : 'Gjør infoen større'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
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
