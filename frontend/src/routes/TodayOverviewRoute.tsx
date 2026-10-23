import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listBookings, queryKeys } from '../lib';
import { formatBerlinTime, formatContinuationLabel, todayInBerlin } from '../lib/dates';
import { usePeople } from '../hooks/usePeople';
import { useResources } from '../hooks/useResources';
import { PersonFilterSelect } from '../components/PersonFilterSelect';
import { ResourceFilterSelect } from '../components/ResourceFilterSelect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldLegend, FieldSet } from '@/components/ui/field';

/**
 * Today overview route (`/today`) — FS-01 FR-4/§6.3, issue #23; the real
 * chronological listing built out in issue #28 (AC-9); resource/"booked
 * by"/"booked for" filters added in issue #29 (FR-3/§6.4/AC-5/AC-7/AC-8).
 *
 * Reachable directly from top-level navigation, without first selecting a
 * resource (FR-4) — see the `<nav>` in `App.tsx`.
 *
 * The list itself trusts the backend's ordering entirely (`GET
 * /api/bookings` already returns entries sorted by clipped start ascending,
 * then resource name — issue #21) — this route does no client-side
 * sort/group of its own; the three filters below are additive narrowing
 * (AC-7), forwarded straight through to the backend exactly like
 * `ResourceScheduleRoute`'s "booked by"/"booked for" filters (issue #27).
 *
 * shadcn/ui supplies only the visual layer — `Skeleton`/`Alert`/`Empty`
 * states, tokenised buttons and booking rows — over the same semantic
 * structure (`<fieldset>`, `<ul>`) the accessibility criteria depend on.
 */
export function TodayOverviewRoute() {
  // Held as plain component state, not a URL param — same judgement as
  // `ResourceScheduleRoute`'s filters (issue #27): a filter selection is
  // transient view state. `undefined` means "no filter" for that
  // dimension. At most one resource can ever be selected because
  // `ResourceFilterSelect` is built on React Aria's single-select
  // `Select` (§6.4) — there is no additional guarding needed here.
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [bookedById, setBookedById] = useState<string | undefined>(undefined);
  const [bookedForId, setBookedForId] = useState<string | undefined>(undefined);
  const hasActiveFilters =
    resourceId !== undefined || bookedById !== undefined || bookedForId !== undefined;

  const resources = useResources();
  const people = usePeople();
  const resourcesById = new Map(resources.data?.map((resource) => [resource.id, resource.name]));
  const peopleById = new Map(people.data?.map((person) => [person.id, person.name]));

  const clearFilters = () => {
    setResourceId(undefined);
    setBookedById(undefined);
    setBookedForId(undefined);
  };

  const query = useQuery({
    queryKey: queryKeys.todayOverview({ resourceId, bookedById, bookedForId }),
    // No `date` param: the backend defaults to today in Europe/Berlin
    // (see `backend/src/routes/bookings.ts`) — this route deliberately
    // does not compute "today" itself so there is exactly one place
    // (the server) that decides what "today" means.
    queryFn: () => listBookings({ resourceId, bookedById, bookedForId }),
  });

  return (
    <section aria-labelledby="today-overview-heading" className="flex flex-col gap-6">
      <h1 id="today-overview-heading" className="font-heading text-2xl font-semibold">
        Today&apos;s bookings — {todayInBerlin()}
      </h1>

      {/*
        Resource/"booked by"/"booked for" filters (FS-01 FR-3/§6.4/AC-5/
        AC-7/AC-8, issue #29). Mirrors `ResourceScheduleRoute`'s filter
        fieldset (issue #27) — same components, same UX conventions —
        with a third, resource-narrowing control added, since (unlike the
        schedule view) the resource itself is NOT fixed here.
      */}
      <FieldSet
        aria-label="Filter today's bookings"
        className="rounded-xl border border-border bg-card p-4"
      >
        <FieldLegend>Filters</FieldLegend>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <ResourceFilterSelect
            label="Resource"
            resources={resources.data ?? []}
            value={resourceId}
            onChange={setResourceId}
            isDisabled={!resources.isSuccess}
          />
          <PersonFilterSelect
            label="Booked by"
            people={people.data ?? []}
            value={bookedById}
            onChange={setBookedById}
            isDisabled={!people.isSuccess}
          />
          <PersonFilterSelect
            label="Booked for"
            people={people.data ?? []}
            value={bookedForId}
            onChange={setBookedForId}
            isDisabled={!people.isSuccess}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onPress={clearFilters}
            isDisabled={!hasActiveFilters}
          >
            Clear filters
          </Button>
        </div>

        {/*
          Active-filter summary (AC-8's "active filters are visible"): a
          plain, real text node that states in business language exactly
          which filters currently apply, additively (AC-7), and
          unambiguously shows the unfiltered state once cleared (AC-8).
          `role="status"` (issue #31/§9) makes it a polite live region so
          a filter change (client-side state only, no page reload) is
          announced.
        */}
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {hasActiveFilters ? (
            <>
              Showing bookings
              {resourceId !== undefined && (
                <> for {resourcesById.get(resourceId) ?? resourceId}</>
              )}
              {bookedById !== undefined && <> booked by {peopleById.get(bookedById) ?? bookedById}</>}
              {bookedForId !== undefined && (
                <> booked for {peopleById.get(bookedForId) ?? bookedForId}</>
              )}
              .
            </>
          ) : (
            'Showing all bookings today (no filters applied).'
          )}
        </p>
      </FieldSet>

      {query.isLoading && (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Loading today&apos;s bookings…</p>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Today&apos;s bookings could not be loaded.</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onPress={() => query.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/*
        Two DISTINCT empty states (§10/AC-10): the genuinely unfiltered
        "nothing is booked today" message, and a separate message when
        filters narrowed a non-empty day down to zero results — with a
        "Clear filters" affordance restated right next to this message.
        `role="status"` on both (issue #31/§9): applying a filter that
        narrows a non-empty day down to zero results changes which of
        these two paragraphs is on screen via client-side state only (no
        page reload), so the transition must be a polite live region.
      */}
      {query.isSuccess && query.data.length === 0 && !hasActiveFilters && (
        <p role="status" className="text-sm text-muted-foreground">
          Nothing is booked today.
        </p>
      )}

      {query.isSuccess && query.data.length === 0 && hasActiveFilters && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          No bookings match the current filters.{' '}
          <Button type="button" variant="outline" size="sm" onPress={clearFilters}>
            Clear filters
          </Button>
        </p>
      )}

      {query.isSuccess && query.data.length > 0 && (
        /*
          AC-9: every entry names its resource, time range, creator, and
          booked-for person; ordering is scannable/chronological because
          it is rendered exactly as the backend returns it (no client-side
          sort/group here). A plain semantic list is sufficient.
        */
        <ul
          aria-label={`All bookings today, ${todayInBerlin()}`}
          className="flex flex-col gap-2"
        >
          {query.data.map((booking) => {
            const timeRange = `${formatBerlinTime(booking.start)}–${formatBerlinTime(booking.end)}`;
            const continuationLabel = formatContinuationLabel(booking);
            return (
              <li key={booking.id}>
                <Link
                  to={`/bookings/${booking.id}`}
                  className="flex flex-col gap-0.5 rounded-lg bg-card p-3 text-sm ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {booking.resource.name}: {timeRange} · Booked by {booking.bookedBy.name} for{' '}
                  {booking.bookedFor.name}.
                  {continuationLabel !== null && <> {continuationLabel}</>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
