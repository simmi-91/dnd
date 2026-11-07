import { useOffline } from '../offline/connectivity';
import { applyUpdate, dismissUpdate, useUpdateWaiting } from '../offline/pwaUpdate';
import styles from './Shell.module.css';

/**
 * Liten, rolig merkelapp når appen er uten nett. Området med `role="status"` står alltid i DOM-en,
 * for skjermlesere melder bare fra om innhold som kommer inn i et område som fantes fra før.
 */
export function OfflineBadge() {
  const offline = useOffline();
  return (
    <div role="status">
      {offline && (
        <div className={styles.offline} title="Ark og kamp lagres når nettet er tilbake">
          <span className={styles.offlineDot} aria-hidden="true" />
          Uten nett
        </div>
      )}
    </div>
  );
}

/** Ny versjon av appen er klar. Lastes bare inn på nytt når brukeren ber om det. */
export function UpdatePrompt() {
  const waiting = useUpdateWaiting();
  return (
    <div role="status">
      {waiting && (
        <div className={styles.update}>
          <span>Ny versjon –</span>
          <button type="button" className="link-btn" onClick={applyUpdate}>
            last inn på nytt
          </button>
          <button type="button" className={styles.updateClose} onClick={dismissUpdate} aria-label="Senere">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
