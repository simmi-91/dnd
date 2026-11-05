import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RedirectIfAuthed, RequireAuth } from './components/Guards';
import { Shell } from './components/Shell';
import { AccountPage } from './pages/AccountPage';
import { LoginPage } from './pages/LoginPage';
import { CompanionsPage } from './pages/game/CompanionsPage';
import { GameLayout } from './pages/game/GameLayout';
import { SheetPage } from './pages/game/SheetPage';
import { MyGamesPage } from './pages/MyGamesPage';
import { NewGamePage } from './pages/NewGamePage';
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
        <Route path="spill/nytt" element={<NewGamePage />} />
        <Route path="spill/:gameId" element={<GameLayout />}>
          <Route index element={<Navigate to="ark" replace />} />
          <Route path="ark" element={<SheetPage />} />
          <Route path="folgesvenner" element={<CompanionsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
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
