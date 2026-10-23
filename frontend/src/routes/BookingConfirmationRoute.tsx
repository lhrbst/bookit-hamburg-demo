import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError, getBooking, type BookingDetail } from '../lib';
import { berlinDayKeyOf, formatBerlinDateTime } from '../lib/dates';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** The one-time navigation payload `BookingFormRoute` attaches to its
 * `navigate(..., { state })` call on a successful create (issue #42). */
interface ConfirmationLocationState {
  booking?: BookingDetail;
}

/**
 * Booking confirmation route (`/bookings/:id/confirmation`) — FS-02 §6.2,
 * FR-1, AC-1, AC-11, issue #42 (route scaffolding from issue #39/#40).
 *
 * ## No second fetch (the defect this ticket fixes)
 *
 * `BookingFormRoute`'s successful `createBooking` mutation already
 * resolves to the exact `BookingDetail` shape this screen needs to
 * restate everything the acceptance criteria ask for (resource, date+time
 * range, creator, booked-for person, purpose). Issue #40 originally
 * navigated here with only the id in the URL, which forced this route to
 * re-fetch via `getBooking` even though the caller already had the full
 * object in hand — exactly the redundant "second fetch" AC-3 forbids.
 *
 * The fix: `BookingFormRoute` now passes the full booking via
 * `navigate(to, { state: { booking } })`, a one-time value attached to
 * that single navigation (not persisted in the URL or on reload). This
 * route reads it first via `useLocation().state`, and renders directly
 * from it with NO query at all in that path.
 *
 * The `getBooking(id)` query below only ever runs as a FALLBACK, and only
 * when that state is absent — i.e. someone reaches this exact, real URL
 * some other way than the create flow: a bookmark, a hard refresh, or the
 * back/forward cache dropping the state. That is graceful degradation for
 * a directly-navigable route, not what AC-3 is testing; the normal
 * create→confirmation flow (Flow A) never triggers it. It reuses the same
 * loading/error/not-found scaffolding as `BookingDetailRoute` (issue #41)
 * for consistency rather than inventing a new pattern.
 *
 * shadcn/ui supplies only the visual layer — the `Card`-framed detail
 * list, `Skeleton`/`Alert` states, tokenised links — over the same
 * semantic structure (`role="status"`, `<dl>`) the criteria depend on.
 */
export function BookingConfirmationRoute() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const stateBooking = (location.state as ConfirmationLocationState | null)?.booking;

  const query = useQuery<{ booking: BookingDetail; canCancel: boolean }, ApiError>({
    queryKey: ['booking', id],
    queryFn: () => getBooking(id as string),
    // Only reached when router state is missing (direct/bookmarked
    // navigation, or a refresh) — see the class doc comment above.
    enabled: stateBooking === undefined && id !== undefined,
    retry: (failureCount, error) => {
      if (error.isNotFound) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const booking = stateBooking ?? query.data?.booking;

  return (
    <section aria-labelledby="booking-confirmation-heading" className="flex flex-col gap-6">
      <h1
        id="booking-confirmation-heading"
        className="font-heading text-2xl font-semibold"
      >
        Booking confirmed
      </h1>

      {/*
        Explicit success statement (AC "Creation success is stated
        explicitly in text" / Core Rule 1's "success confirmations ...
        must be announced, not just rendered"). `role="status"` is a live
        region so this text is announced to assistive technology as soon
        as it mounts.
      */}
      {booking !== undefined && (
        <Alert role="status">
          <AlertDescription>
            Booking created. Your booking has been confirmed — the details below are what was
            reserved.
          </AlertDescription>
        </Alert>
      )}

      {/* Only reachable via the fallback fetch (state absent). */}
      {stateBooking === undefined && query.isLoading && (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Loading booking…</p>
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {stateBooking === undefined && query.isError && (
        <Alert variant="destructive">
          {query.error.isNotFound ? (
            <AlertTitle>This booking no longer exists.</AlertTitle>
          ) : (
            <>
              <AlertTitle>The booking could not be loaded.</AlertTitle>
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

      {booking !== undefined && (
        <>
          {/*
            Restatement of resource, date+time range, creator, booked-for
            person, and purpose (AC "all restated") — same `<dl>`
            structure as `BookingDetailRoute` (issue #41) for consistency.
          */}
          <Card>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="font-medium text-muted-foreground">Resource</dt>
                <dd>{booking.resource.name}</dd>

                <dt className="font-medium text-muted-foreground">Date and time</dt>
                <dd>
                  {formatBerlinDateTime(booking.start)} – {formatBerlinDateTime(booking.end)}
                </dd>

                <dt className="font-medium text-muted-foreground">Booked by</dt>
                <dd>{booking.bookedBy.name}</dd>

                <dt className="font-medium text-muted-foreground">Booked for</dt>
                <dd>{booking.bookedFor.name}</dd>

                <dt className="font-medium text-muted-foreground">Purpose</dt>
                <dd>{booking.purpose.label}</dd>
              </dl>
            </CardContent>
          </Card>

          {/*
            Onward navigation back to the availability views (AC "a route
            back to the availability views is offered", FR-5/AC-2): the
            booking's OWN date is used for the schedule link (rather than
            today's date) since that is where the user will actually see
            the booking they just created, which may not be today.
          */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 [&_a:hover]:underline">
            <Link to={`/resources/${booking.resource.id}/schedule/${berlinDayKeyOf(booking.start)}`}>
              View {booking.resource.name}&rsquo;s schedule
            </Link>
            {' · '}
            <Link to="/today">View today&rsquo;s overview</Link>
            {' · '}
            <Link to={`/bookings/${booking.id}`}>View booking detail</Link>
          </p>
        </>
      )}
    </section>
  );
}
