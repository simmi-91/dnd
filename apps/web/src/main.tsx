import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-600.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { createQueryClient, flushPendingLogout } from './api/auth';
import { App } from './App';
import { onOnline } from './offline/connectivity';
import { enableOfflineStorage } from './offline/storage';
import { setUpdateWaiting } from './offline/pwaUpdate';
import { registerSW } from 'virtual:pwa-register';

const root = document.getElementById('root');
if (!root) throw new Error('Fant ikke #root');

// Ark, kamp og spill huskes lokalt, så de kan åpnes uten nett (fase 5).
enableOfflineStorage();

const queryClient = createQueryClient();

// Logget ut uten nett: send utloggingen så snart nettet er tilbake (og ved oppstart, i fetchMe).
onOnline(() => void flushPendingLogout());

// Service workeren: app-skallet virker uten nett. En ny versjon tas i bruk først når brukeren ber om
// det («Ny versjon – last inn på nytt»), så siden ikke lastes inn på nytt midt i en kamp.
const updateSW = registerSW({
  onNeedRefresh: () => setUpdateWaiting(() => updateSW(true)),
  // Appen står ofte åpen lenge (en hel spillkveld). Se etter ny versjon hver time.
  onRegisteredSW: (_url, reg) => {
    if (reg) setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
  },
});

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App queryClient={queryClient} />
    </BrowserRouter>
  </StrictMode>,
);
