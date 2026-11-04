interface LoadingProps {
  label?: string;
}

export function Loading({ label = 'Laster …' }: LoadingProps) {
  return (
    <div className="state state--center" role="status">
      <div className="spinner" aria-hidden="true" />
      <span className="dim">{label}</span>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ title = 'Noe gikk galt', message, onRetry, retrying = false }: ErrorStateProps) {
  return (
    <div className="state state--center" role="alert">
      <div className="state__ornament" aria-hidden="true">
        ❦
      </div>
      <h2>{title}</h2>
      <p className="dim">{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Prøver …' : 'Prøv igjen'}
        </button>
      )}
    </div>
  );
}

interface BlockedStateProps {
  onLogout?: () => void;
  loggingOut?: boolean;
}

/** Egen tilstand for sperrede kontoer. Ingen «Prøv igjen», siden det ikke hjelper. */
export function BlockedState({ onLogout, loggingOut = false }: BlockedStateProps) {
  return (
    <div className="state state--center" role="alert">
      <div className="state__ornament" aria-hidden="true">
        ❦
      </div>
      <h1>Kontoen er sperret</h1>
      <p className="dim">Du har ikke tilgang til kampguiden med denne kontoen.</p>
      {onLogout && (
        <button type="button" className="btn btn--ghost" onClick={onLogout} disabled={loggingOut}>
          {loggingOut ? 'Logger ut …' : 'Logg ut'}
        </button>
      )}
    </div>
  );
}
