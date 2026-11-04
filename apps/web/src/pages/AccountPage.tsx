import { useNavigate } from 'react-router';
import { useLogout, useMe } from '../api/auth';
import { errorMessage } from '../components/errorMessage';
import { useDocumentTitle } from '../components/useDocumentTitle';
import styles from './AccountPage.module.css';

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
