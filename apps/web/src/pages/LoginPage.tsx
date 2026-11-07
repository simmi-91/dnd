import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useState } from 'react';
import { isBlockedError, useAuthConfig, useDevLogin, useGoogleSignIn, useMe } from '../api/auth';
import { errorMessage } from '../components/errorMessage';
import { ErrorState, Loading } from '../components/States';
import { useDocumentTitle } from '../components/useDocumentTitle';
import styles from './LoginPage.module.css';

export function LoginPage() {
  useDocumentTitle('Logg inn');
  const config = useAuthConfig();
  const signIn = useGoogleSignIn();
  const devSignIn = useDevLogin();
  const me = useMe();
  const [googleFailed, setGoogleFailed] = useState(false);

  if (config.isPending) return <Loading />;
  if (config.isError) {
    return (
      <ErrorState
        title="Får ikke kontakt"
        message={errorMessage(config.error)}
        onRetry={() => void config.refetch()}
        retrying={config.isFetching}
      />
    );
  }

  const { googleClientId, devLogin } = config.data;
  const nothingConfigured = !googleClientId && !devLogin;
  let error: string | null = null;
  if (signIn.isError) error = errorMessage(signIn.error);
  else if (devSignIn.isError) error = errorMessage(devSignIn.error);
  else if (googleFailed) error = 'Innloggingen med Google ble avbrutt. Prøv igjen.';
  else if (isBlockedError(me.error)) error = errorMessage(me.error);
  const busy = signIn.isPending || devSignIn.isPending;

  return (
    <main className={styles.wrap}>
      <section className={`card ${styles.panel}`} aria-labelledby="login-title">
        <div className="sc">D&amp;D 5e · 2024</div>
        <h1 id="login-title" className={styles.title}>
          Kampguide
        </h1>
        <p className={`dim ${styles.lead}`}>Hva kan jeg gjøre nå, og hva vet vi om kampanjen?</p>
        <hr className="rule" />

        {nothingConfigured ? (
          <p className={styles.notice}>
            Innlogging er ikke satt opp ennå. Serveren mangler en Google client ID, og lokal innlogging er
            slått av.
          </p>
        ) : (
          <div className={styles.actions}>
            {googleClientId && (
              <GoogleOAuthProvider clientId={googleClientId} locale="no">
                <div className={styles.google} aria-busy={busy}>
                  <GoogleLogin
                    onSuccess={(res) => {
                      setGoogleFailed(false);
                      devSignIn.reset();
                      if (res.credential) signIn.mutate(res.credential);
                      else setGoogleFailed(true);
                    }}
                    onError={() => {
                      signIn.reset();
                      devSignIn.reset();
                      setGoogleFailed(true);
                    }}
                    text="signin_with"
                    shape="rectangular"
                    theme="outline"
                    size="large"
                    width={260}
                  />
                </div>
              </GoogleOAuthProvider>
            )}
            {devLogin && (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => {
                  signIn.reset();
                  setGoogleFailed(false);
                  devSignIn.mutate();
                }}
              >
                Logg inn lokalt
              </button>
            )}
          </div>
        )}

        {busy && (
          <p className="dim" role="status">
            Logger inn …
          </p>
        )}
        {error && (
          <p className={`alert ${styles.error}`} role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
