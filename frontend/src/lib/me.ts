import { apiFetch } from './api';
import type { Person } from './types';

/**
 * `GET /api/me` — the identified current person (FS-02 FR-1/FR-3, §4,
 * §6.1, issue #35), used to pre-fill/display the booking creator and to
 * decide whether to offer the cancel action (the backend's `canCancel`
 * flag on `GET /api/bookings/:id` already encodes that decision — this
 * helper exists for the form's "booked by" display, not to re-derive
 * permission client-side).
 *
 * There is no auth system yet: this always resolves to the same
 * configured/stand-in person. Fetched once and shared via
 * `useCurrentPerson` (issue #39) rather than re-fetched per component.
 */
export function getCurrentPerson(): Promise<Person> {
  return apiFetch<Person>('/api/me');
}
