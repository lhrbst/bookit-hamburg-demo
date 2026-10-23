import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getResourceSchedule, queryKeys, type ResourceSchedule } from '../lib';
import { useSelectedDay } from '../hooks/useSelectedDay';
import { usePeople } from '../hooks/usePeople';
import { formatBerlinTime, formatContinuationLabel } from '../lib/dates';
import { PersonFilterSelect } from '../components/PersonFilterSelect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldLegend, FieldSet } from '@/components/ui/field';

/**
 * Resource schedule route (`/resources/:resourceId/schedule/:date`) —
 * FS-01 FR-2/§6.2, issue #23; day navigation wired up in issue #24.
 *
 * The route encodes BOTH the resource id and the day as path segments
 * (rather than a query-param date) so the full view state is bookmarkable
 * and shareable, and so #26/#27 (schedule rendering, filters) have a
 * stable URL shape to read/write without inventing their own convention.
 *
 * The selected day itself — defaulting to today in Europe/Berlin,
 * validated, and reflected back into the URL — is `useSelectedDay`'s job
 * (issue #24), not reimplemented here.
 *
 * Chronological segment rendering and "free all day" messaging (issue
 * #26, FR-2/§6.2/AC-2/AC-3/AC-4/AC-12/AC-13) are implemented below, using
 * `formatBerlinTime`/`formatContinuationLabel` from `lib/dates` (built in
 * #24 specifically for this consumer) and rendering the backend's
 * already-correct segment partition (issue #53) as-is.
 *
 * "Booked by"/"booked for" filters (issue #27, FR-3/§6.4/AC-6/AC-6a/AC-7/
 * AC-8) are additive narrowing of the SAME resource/day — never a way to
 * change the resource itself (FR-3) — passed straight through to the
 * backend (issue #53's `getResourceSchedule` already forwards
 * `bookedById`/`bookedForId`), which recomputes the free/booked segment
 * partition server-side. This route does no client-side segment
 * recomputation of its own.
 *
 * shadcn/ui supplies only the visual layer here — `Skeleton`/`Alert`
 * states, tokenised buttons and segment rows — over the same semantic
 * structure (`<nav>`, `<fieldset>`, `<ul>`) the accessibility criteria
 * depend on.
 */
export function ResourceScheduleRoute() {
  const { resourceId } = useParams<{ resourceId: string }>();
  const { selectedDay, previousDay, nextDay, goToToday } = useSelectedDay();

  // "Booked by"/"booked for" filters (FS-01 FR-3/§6.4, issue #27). Held as
  // plain component state — NOT a URL param — since the day (not the
  // filters) is what issue #23 established as the shareable/bookmarkable
  // part of this view's URL; a filter selection is transient view state,
  // reset like any other local UI state on navigation. `undefined` means
  // "no filter" ("Anyone") for that dimension.
  const [bookedById, setBookedById] = useState<string | undefined>(undefined);
  const [bookedForId, setBookedForId] = useState<string | undefined>(undefined);
  const hasActiveFilters = bookedById !== undefined || bookedForId !== undefined;

  const people = usePeople();
  const peopleById = new Map(people.data?.map((person) => [person.id, person.name]));

  const query = useQuery<ResourceSchedule, ApiError>({
    queryKey: queryKeys.resourceSchedule(resourceId, selectedDay, { bookedById, bookedForId }),
    queryFn: () =>
      getResourceSchedule(resourceId as string, { date: selectedDay, bookedById, bookedForId }),
    enabled: resourceId !== undefined,
    retry: (failureCount, error) => {
      // Don't retry a well-formed 4xx (e.g. not-found) — it will never
      // succeed without different input. Do retry unexpected/network
      // failures, up to a small bound.
      if (error.isNotFound || error.isValidationError) {
        return false;
      }
      return failureCount < 3;
    },
  });

  return (
    <section aria-labelledby="resource-schedule-heading" className="flex flex-col gap-6">
      {/*
        AC-11/§9 (issue #31): the selected day changes via client-side
        navigation only (`useSelectedDay`'s `navigate(...)` — no full page
        reload), so a screen-reader user who presses "Previous day"/
        "Today"/"Next day" would otherwise hear nothing unless they
        manually re-read this heading. `aria-live="polite"` on the
        heading itself — reusing the SAME visible text as the live-region
        content, rather than inventing a separate hidden announcement —
        means the full, self-contained sentence ("Schedule for resource
        X on Y") is announced on every day change, not just the bare
        date, with no extra hidden DOM needed. The element keeps its
        native `<h1>` role; `aria-live` only adds the announcement
        behaviour on top of it.
      */}
      <h1
        id="resource-schedule-heading"
        aria-live="polite"
        className="font-heading text-2xl font-semibold"
      >
        Schedule for resource {resourceId} on {selectedDay}
      </h1>

      {/*
        Day navigation (issue #24 AC: "day navigation moves exactly one
        calendar day ... reachable and operable by keyboard alone", FS-01
        AC-11). Three real `<button>` elements — natively focusable and
        activatable with both Enter and Space, with accessible names that
        state the action in business language rather than an icon alone.
      */}
      <nav aria-label="Day navigation" className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onPress={previousDay}>
          Previous day
        </Button>
        <Button type="button" variant="outline" size="sm" onPress={goToToday}>
          Today
        </Button>
        <Button type="button" variant="outline" size="sm" onPress={nextDay}>
          Next day
        </Button>
      </nav>

      {/*
        "Booked by"/"booked for" filters (FS-01 FR-3/§6.4/AC-6/AC-6a/AC-7/
        AC-8, issue #27). The resource itself is never a filterable
        dimension here (FR-3: a resource schedule always shows its
        selected resource) — these are the only two controls, and neither
        can change `resourceId`, which stays fixed by the URL's own
        `:resourceId` segment.
      */}
      <FieldSet
        aria-label="Filter this schedule"
        className="rounded-xl border border-border bg-card p-4"
      >
        <FieldLegend>Filters</FieldLegend>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
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
            onPress={() => {
              setBookedById(undefined);
              setBookedForId(undefined);
            }}
            isDisabled={!hasActiveFilters}
          >
            Clear filters
          </Button>
        </div>

        {/*
          Active-filter summary (AC-7/AC-8's "currently active filters are
          visible"): a plain, real text node that states in business
          language exactly which filters currently apply, additively
          (AC-7), and unambiguously shows the unfiltered state once
          cleared (AC-8). `role="status"` turns this already-visible
          summary into a polite live region, so a filter change — which,
          like the day, updates this text via client-side state only, no
          page reload — is actually announced (issue #31/§9).
        */}
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {hasActiveFilters ? (
            <>
              Showing bookings
              {bookedById !== undefined && <> booked by {peopleById.get(bookedById) ?? bookedById}</>}
              {bookedForId !== undefined && (
                <> booked for {peopleById.get(bookedForId) ?? bookedForId}</>
              )}
              .
            </>
          ) : (
            'Showing all bookings (no filters applied).'
          )}
        </p>
      </FieldSet>

      {/*
        Minimal reachability link (Task 2.1 AC: "booking form ... route[s]
        ... reachable from the FS-01 views") — NOT the real "book this
        slot" entry point (a specific free segment's own affordance),
        which is issue #44's job once the schedule renders real segments
        (issue #26).
      */}
      {resourceId !== undefined && (
        <p>
          <Link
            to={`/resources/${resourceId}/book`}
            className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            Book this resource
          </Link>
        </p>
      )}

      {query.isLoading && (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Loading schedule…</p>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          {query.error.isNotFound ? (
            // AC-10/§10 "selected resource no longer exists": inform the
            // user, then hand them a real, keyboard-operable `<Link>` back
            // to the resource list (issue #25's route). The message and
            // the link are both inside the `role="alert"` container (the
            // shadcn `Alert`), so the whole refusal — the "what" and the
            // "how to continue" — is announced together.
            <AlertDescription>
              This resource no longer exists.{' '}
              <Link to="/resources">Return to the resource list</Link>.
            </AlertDescription>
          ) : (
            <>
              <AlertTitle>The schedule could not be loaded.</AlertTitle>
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
            </>
          )}
        </Alert>
      )}

      {query.isSuccess && (
        <>
          {/*
            AC-4 ("no bookings on the day → clear 'free all day'
            statement"): the backend's segment builder returns exactly
            zero `booked` segments when nothing is booked. Detecting "no
            booked segments" (rather than assuming the exact single-free-
            segment shape) is the more robust check, and keeping this as an
            EXTRA, prominent status line ABOVE the segment list means
            AC-12's "every unbooked period explicitly identified as free"
            still holds for the list itself.
            `role="status"` (issue #31/§9): this line appears/disappears
            purely from a day change or filter change — never a page
            reload.
          */}
          {!query.data.segments.some((segment) => segment.type === 'booked') && (
            <p role="status" className="text-sm text-muted-foreground">
              This resource is free all day.
            </p>
          )}

          {/*
            AC-2/AC-12/AC-13: the backend already returns `segments` as a
            gap-free, chronologically ordered partition of the full 24
            hours (issue #53) — including keeping back-to-back bookings as
            two separate `booked` entries, never merged (§10, FS-03). This
            list renders that array faithfully, in order, with no
            filtering/reordering/merging of its own.

            Booked vs free is conveyed by a leading text label ("Booked"/
            "Free"), never by colour alone (Core Rule 1). A plain
            semantic list is sufficient here — same judgement as the
            resource list in issue #25.
          */}
          <ul
            aria-label={`Schedule for ${query.data.resource.name} on ${selectedDay}`}
            className="flex flex-col gap-2"
          >
            {query.data.segments.map((segment, index) => {
              const timeRange = `${formatBerlinTime(segment.start)}–${formatBerlinTime(segment.end)}`;

              if (segment.type === 'booked') {
                const continuationLabel = formatContinuationLabel(segment);
                return (
                  <li key={index}>
                    <Link
                      to={`/bookings/${segment.id}`}
                      className="flex flex-col gap-0.5 rounded-lg border-l-4 border-l-primary bg-card p-3 text-sm ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Booked {timeRange} · Booked by {segment.bookedBy.name} for{' '}
                      {segment.bookedFor.name}.
                      {continuationLabel !== null && <> {continuationLabel}</>}
                    </Link>
                  </li>
                );
              }

              return (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground"
                >
                  <span>Free {timeRange}.</span>{' '}
                  {resourceId !== undefined && (
                    <Link
                      to={`/resources/${resourceId}/book`}
                      state={{ start: segment.start, end: segment.end }}
                      className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
                    >
                      Book this free slot, {timeRange}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
