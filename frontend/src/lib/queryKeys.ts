/**
 * Shared TanStack Query key factory (issue #39, FS-02 §6/§8 cache seam).
 *
 * A booking create/cancel mutation affects two FS-01 read views: the
 * resource schedule for the booking's resource/day, and the today
 * overview (when the booking's day is today). Both `ResourceScheduleRoute`
 * and `TodayOverviewRoute` build their `useQuery` keys ad hoc today; this
 * module is the single source of truth those two routes should read from
 * (and now do), so a later mutation hook (issue #44) can invalidate the
 * exact same keys rather than guessing at a parallel convention.
 *
 * ## The seam, for issue #44
 *
 * After a successful `createBooking`/`cancelBooking`, call:
 *
 * ```ts
 * queryClient.invalidateQueries({ queryKey: queryKeys.resourceSchedule(resourceId) });
 * queryClient.invalidateQueries({ queryKey: queryKeys.todayOverview() });
 * ```
 *
 * `resourceSchedule(resourceId)` (without a `day` argument) is a PARTIAL
 * key — TanStack Query matches it as a prefix, invalidating every cached
 * day for that resource, not just the day the mutation happened to touch.
 * This is deliberately broad rather than passing the exact day: a booking
 * near midnight can affect the adjoining day's "continues into/from"
 * flags on a neighbouring day's cached schedule too, and invalidating a
 * whole resource is cheap (one resource, refetched on next view) compared
 * to the risk of a stale neighbouring day.
 *
 * `todayOverview()` called with no arguments (as above) is a PARTIAL key,
 * matching every cached filter combination (issue #29 added a `filters`
 * segment) — a mutation invalidates the whole today overview regardless
 * of which resource/booked-by/booked-for filter happens to be active in
 * the currently mounted view, which is correct: a create/cancel can
 * affect what a filtered view would show even though the filter itself
 * didn't change.
 */
/**
 * Optional "booked by"/"booked for" narrowing filters (FS-01 FR-3/§6.4,
 * issue #27) layered onto the resource schedule query key.
 */
export interface ResourceScheduleFilters {
  bookedById?: string;
  bookedForId?: string;
}

/**
 * Optional "resource"/"booked by"/"booked for" narrowing filters (FS-01
 * FR-3/§6.4, issue #29) layered onto the today overview query key.
 */
export interface TodayOverviewFilters {
  resourceId?: string;
  bookedById?: string;
  bookedForId?: string;
}

export const queryKeys = {
  /**
   * Matches `ResourceScheduleRoute`'s `useQuery` key. Called with both
   * `resourceId` and `day` for an exact-match key (what the route itself
   * uses); called with only `resourceId` for a PARTIAL/prefix key,
   * matching every cached day for that resource (what an invalidation
   * seam should use).
   *
   * `filters` (issue #27's "booked by"/"booked for" selects) is appended
   * as its OWN trailing segment — a plain object, not merged into the
   * `day` segment — rather than folded into a combined "day+filters"
   * string. That keeps the #39 invalidation seam unchanged: a booking
   * mutation calling `resourceSchedule(resourceId)` still gets a partial/
   * prefix key match against every cached (day, filters) combination for
   * that resource, exactly as it did before filters existed — it does not
   * need to know about, or enumerate, whatever filter values happen to be
   * cached. TanStack Query serialises plain objects for key comparison,
   * so `{}` (no filters) and any specific filter combination are each
   * their own distinct, cacheable entry, and a filter change always
   * produces a new key (triggering a refetch) rather than reusing stale
   * data cached under different filters.
   */
  resourceSchedule: (
    resourceId: string | undefined,
    day?: string,
    filters?: ResourceScheduleFilters,
  ) =>
    day === undefined
      ? (['resource-schedule', resourceId] as const)
      : (['resource-schedule', resourceId, day, filters ?? {}] as const),
  /**
   * Matches `TodayOverviewRoute`'s `useQuery` key. Called with no
   * arguments for a PARTIAL/prefix key — matching every cached filter
   * combination — which is what the #39 booking-mutation invalidation
   * seam documented above uses and continues to work unchanged. Called
   * with `filters` (issue #29's resource/"booked by"/"booked for"
   * selects) for the exact key the route itself uses, appended as its
   * OWN trailing segment (mirroring `resourceSchedule`'s `filters`
   * segment above) so a filter change always produces a new key
   * (triggering a refetch) rather than reusing stale data cached under a
   * different filter combination.
   */
  todayOverview: (filters?: TodayOverviewFilters) =>
    filters === undefined
      ? (['bookings', 'today'] as const)
      : (['bookings', 'today', filters] as const),
} as const;
