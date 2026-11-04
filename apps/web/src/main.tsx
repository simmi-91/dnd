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
import { createQueryClient } from './api/auth';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Fant ikke #root');

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App queryClient={queryClient} />
    </BrowserRouter>
  </StrictMode>,
);
