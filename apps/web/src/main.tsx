import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Fant ikke #root');

createRoot(root).render(
  <StrictMode>
    <h1>D&amp;D kampguide</h1>
  </StrictMode>,
);
