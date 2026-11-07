import { useNavigate } from 'react-router';
import { useLogout, useMe } from '../api/auth';
import { errorMessage } from '../components/errorMessage';
import { useDocumentTitle } from '../components/useDocumentTitle';
import styles from './AccountPage.module.css';

/** Versjonen fra package.json og commit, f.eks. «1.0.0 (379ac5f)». Settes i vite.config.ts. */
function versionText(): string {
  const version = import.meta.env.VITE_APP_VERSION as string | undefined;
  const sha = import.meta.env.VITE_BUILD_SHA as string | undefined;
  if (!version) return 'Ukjent';
  return sha ? `${version} (${sha})` : version;
}

/** Byggetiden i norsk format, f.eks. «7. november 2026 kl. 14:32». */
function buildTimeText(): string {
  const raw = import.meta.env.VITE_BUILD_TIME as string | undefined;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Ukjent';
  return date.toLocaleString('nb-NO', { dateStyle: 'long', timeStyle: 'short' });
}

export function AccountPage() {
  useDocumentTitle('Konto');
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const user = me.data;

  return (
    <div className="page">
      <header className="page__head">
        <div className="sc">Innlogget</div>
        <h1>Konto</h1>
      </header>
      {user && (
        <section className={`card ${styles.card}`} aria-label="Kontoen din">
          <dl className={styles.list}>
            <div>
              <dt className="sc">Navn</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt className="sc">E-post</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt className="sc">Versjon</dt>
              <dd>{versionText()}</dd>
            </div>
            <div>
              <dt className="sc">Bygd</dt>
              <dd>{buildTimeText()}</dd>
            </div>
          </dl>
          <hr className="rule" />
          <button
            type="button"
            className="btn btn--ghost"
            disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate('/logg-inn') })}
          >
            {logout.isPending ? 'Logger ut …' : 'Logg ut'}
          </button>
          {logout.isError && (
            <p className="alert" role="alert">
              {errorMessage(logout.error)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
