import { useQuery } from '@tanstack/react-query';
import { getCurrentPerson, type ApiError, type Person } from '../lib';

/**
 * Shared query for the current person (`GET /api/me`, issue #35).
 *
 * Every component that needs the current person (the future booking
 * form's "booked by" display, the detail view's cancel-permission
 * display) calls THIS hook rather than each issuing its own `useQuery`,
 * so TanStack Query's cache — keyed by `['me']` — is shared and the
 * request happens once per cache lifetime, not once per component
 * (Task 2.1 AC: "loaded through a shared path, not refetched per
 * component").
 *
 * There is no per-person variation to key on (no auth yet — see
 * `backend/src/domain/currentPerson.ts`), so the key carries no
 * arguments.
 */
export function useCurrentPerson() {
  return useQuery<Person, ApiError>({
    queryKey: ['me'],
    queryFn: getCurrentPerson,
    // The current person practically never changes within a session and
    // is cheap to hold — avoid refetching it every time a component
    // mounts (e.g. navigating between the schedule and the booking
    // form), while still allowing a manual `refetch()` if a caller needs
    // one after an error.
    staleTime: Infinity,
  });
}
