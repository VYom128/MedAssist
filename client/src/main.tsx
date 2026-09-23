import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { Provider } from 'react-redux';
import SessionRestorer from './app/SessionRestorer';
import { store } from './app/store';
import { settingsApi } from './features/settings/api';
import AppRoutes from './routes/AppRoutes';
import './index.css';

// Public clinic settings (name, timezone for dates) are loaded once and kept for the session.
void store.dispatch(settingsApi.endpoints.getPublicSettings.initiate());

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <Provider store={store}>
      <SessionRestorer>
        <AppRoutes />
      </SessionRestorer>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
    </Provider>
  </StrictMode>,
);
