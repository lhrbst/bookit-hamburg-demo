import { apiFetch } from './api';
import type { Person } from './types';

/**
 * `GET /api/people` — the maintained set of people, used to populate
 * 'booked by'/'booked for' filter and select controls (issue #52).
 * No filtering: this is the full set.
 */
export function listPeople(): Promise<Person[]> {
  return apiFetch<Person[]>('/api/people');
}
