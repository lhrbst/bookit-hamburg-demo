import { useQuery } from '@tanstack/react-query';
import { listResources, type ApiError, type Resource } from '../lib';

/**
 * Shared query for the bookable resource catalogue (`GET /api/resources`,
 * issue #51), keyed by `['resources']` so every consumer — the resource
 * list view and the today overview's resource filter (issue #29) —
 * shares one cache entry rather than each issuing its own request (same
 * rationale as `usePeople`, issue #27).
 */
export function useResources() {
  return useQuery<Resource[], ApiError>({
    queryKey: ['resources'],
    queryFn: listResources,
  });
}
