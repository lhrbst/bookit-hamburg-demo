import { useQuery } from '@tanstack/react-query';
import { listPeople, type ApiError, type Person } from '../lib';

/**
 * Shared query for the maintained set of people (`GET /api/people`,
 * issue #52), keyed by `['people']` so every consumer — the resource
 * schedule's "booked by"/"booked for" filters (issue #27) and any future
 * booking-form person pickers — shares one cache entry rather than each
 * issuing its own request (same rationale as `usePurposes`, issue #34).
 */
export function usePeople() {
  return useQuery<Person[], ApiError>({
    queryKey: ['people'],
    queryFn: listPeople,
  });
}
