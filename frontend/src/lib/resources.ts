import { apiFetch } from './api';
import type { Resource, ResourceSchedule } from './types';

/**
 * `GET /api/resources` — the full bookable catalogue (FS-01 FR-1, §6.1,
 * issue #51). No filtering: the resource list view applies none.
 */
export function listResources(): Promise<Resource[]> {
  return apiFetch<Resource[]>('/api/resources');
}

/** Optional narrowing filters for {@link getResourceSchedule} (FS-01 FR-3). */
export interface GetResourceScheduleParams {
  /** `YYYY-MM-DD`, Europe/Berlin calendar day. Omit to default to today (server-side). */
  date?: string;
  bookedById?: string;
  bookedForId?: string;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * `GET /api/resources/:id/schedule` — one resource's full-day schedule
 * (FS-01 FR-2, §6.2, issue #53). Rejects with a `not_found`-coded
 * `ApiError` when `resourceId` does not identify an existing resource
 * (FS-01 §10 "selected resource no longer exists") — callers branch on
 * `ApiError#isNotFound` rather than the raw HTTP status.
 */
export function getResourceSchedule(
  resourceId: string,
  params: GetResourceScheduleParams = {},
): Promise<ResourceSchedule> {
  const query = buildQuery({
    date: params.date,
    bookedById: params.bookedById,
    bookedForId: params.bookedForId,
  });
  return apiFetch<ResourceSchedule>(
    `/api/resources/${encodeURIComponent(resourceId)}/schedule${query}`,
  );
}
