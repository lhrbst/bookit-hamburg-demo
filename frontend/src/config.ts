/**
 * Centralised frontend configuration.
 *
 * Vite exposes `VITE_`-prefixed variables via `import.meta.env`. This is
 * the only place that reads them; components and `src/lib` helpers import
 * `config` instead of touching `import.meta.env` directly, so there is a
 * single place to audit for hardcoded environment URLs.
 */
export interface FrontendConfig {
  /** Base URL of the backend REST API. */
  apiBaseUrl: string;
}

export const config: FrontendConfig = {
  apiBaseUrl: import.meta.env['VITE_API_BASE_URL'] ?? 'http://localhost:3001',
};

