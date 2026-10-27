import { validateRuntimeConfig } from '../runtime-config.mjs';

export interface FrontendConfig {
  /** Base URL of the backend REST API. */
  apiBaseUrl: string;
}

let loaded: FrontendConfig | undefined;

export async function loadRuntimeConfig(): Promise<void> {
  const response = await fetch('/config.json', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Runtime configuration request failed (${response.status}).`);
  loaded = validateRuntimeConfig(await response.json());
}

export const config: FrontendConfig = {
  get apiBaseUrl() {
    if (!loaded) throw new Error('Runtime configuration has not been loaded.');
    return loaded.apiBaseUrl;
  },
};
