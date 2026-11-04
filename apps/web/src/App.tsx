import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RedirectIfAuthed, RequireAuth } from './components/Guards';
import { Shell } from './components/Shell';
import { AccountPage } from './pages/AccountPage';
import { LoginPage } from './pages/LoginPage';
import { MyGamesPage } from './pages/MyGamesPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/logg-inn"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<MyGamesPage />} />
        <Route path="konto" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

interface AppProps {
  queryClient: QueryClient;
}

/** Alt unntatt routeren, slik at testene kan bruke MemoryRouter. */
export function App({ queryClient }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
