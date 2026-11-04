import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { isBlockedError, useLogout, useMe } from '../api/auth';
import { errorMessage } from './errorMessage';
import { safeRedirectTarget } from './redirect';
import { BlockedState, ErrorState, Loading } from './States';

interface FromState {
  from?: unknown;
}

/** Slipper bare innloggede brukere gjennom. Andre sendes til /logg-inn. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <Loading />;
  if (me.isError && isBlockedError(me.error)) return <BlockedAccount />;
  // En feil ved ny henting skal ikke kaste ut en bruker som allerede er inne.
  if (me.isError && me.data === undefined) {
    return (
      <ErrorState
        title="Får ikke kontakt"
        message={errorMessage(me.error)}
        onRetry={() => void me.refetch()}
        retrying={me.isFetching}
      />
    );
  }
  if (!me.data) {
    const from = location.pathname + location.search;
    return <Navigate to="/logg-inn" replace state={{ from } satisfies FromState} />;
  }
  return children;
}

/** Innloggede brukere har ingenting på /logg-inn å gjøre. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <Loading />;
  if (me.data) {
    const target = safeRedirectTarget((location.state as FromState | null)?.from);
    return <Navigate to={target} replace />;
  }
  return children;
}

function BlockedAccount() {
  const logout = useLogout();
  return <BlockedState onLogout={() => logout.mutate()} loggingOut={logout.isPending} />;
}
