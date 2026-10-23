import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

/**
 * Application entry point.
 *
 * `QueryClientProvider` backs every server-state read/write (TanStack
 * Query, Core Rule 4). `BrowserRouter` backs the three top-level routes
 * added in Task 2.1 (issue #23) — resource list, resource schedule, and
 * today overview (FS-01 §6).
 */
const queryClient = new QueryClient();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

