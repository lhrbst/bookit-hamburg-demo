import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { loadRuntimeConfig } from './config';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Button } from './components/ui/button';
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

const root = createRoot(rootElement);
void loadRuntimeConfig().then(() => {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}).catch((error: unknown) => {
  console.error('Application configuration failed', error);
  root.render(
    <main className="mx-auto max-w-3xl p-6">
      <Alert variant="destructive">
        <AlertTitle>Application configuration could not be loaded</AlertTitle>
        <AlertDescription>
          The application cannot start. Reload to try again; if this persists, contact the demo administrator.
        </AlertDescription>
        <Button onPress={() => window.location.reload()}>Reload application</Button>
      </Alert>
    </main>,
  );
});
