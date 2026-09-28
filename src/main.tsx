import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createBrowserSessionRecovery } from './storage/sessionRecovery';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <App recovery={createBrowserSessionRecovery()} />
  </StrictMode>,
);
