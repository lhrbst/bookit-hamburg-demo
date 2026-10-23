import { apiFetch } from './api';
import type { Purpose } from './types';

/**
 * `GET /api/purposes` — the predefined purpose categories the booking
 * form offers as a fixed choice (FS-02 FR-1, FR-2 R-3, §6.1, issue #34).
 * Static and auth-independent: always the full set, no per-caller
 * filtering. Fetched once and shared via `useReferenceData` (issue #39)
 * rather than re-fetched per component.
 */
export function listPurposes(): Promise<Purpose[]> {
  return apiFetch<{ purposes: Purpose[] }>('/api/purposes').then((response) => response.purposes);
}
