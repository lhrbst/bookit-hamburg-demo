import { useQuery } from '@tanstack/react-query';
import { listPurposes, type ApiError, type Purpose } from '../lib';

/**
 * Shared query for the predefined purpose categories (`GET /api/purposes`,
 * issue #34).
 *
 * Every component that needs the purpose list (the future booking form's
 * purpose select, the detail view's purpose display) calls THIS hook
 * rather than each issuing its own `useQuery`, so TanStack Query's cache
 * — keyed by `['purposes']` — is shared and the request happens once per
 * cache lifetime, not once per component (Task 2.1 AC: "loaded through a
 * shared path, not refetched per component").
 */
export function usePurposes() {
  return useQuery<Purpose[], ApiError>({
    queryKey: ['purposes'],
    queryFn: listPurposes,
    // Static application configuration (see `backend/src/domain/purposes.ts`)
    // — never varies at runtime, so there is no reason to ever mark it
    // stale within a session.
    staleTime: Infinity,
  });
}
