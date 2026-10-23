import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ApiError, getBooking, type BookingDetail } from '../lib';
import { formatBerlinDateTime } from '../lib/dates';
import { CancelBookingDialog } from '../components/CancelBookingDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Booking detail route (`/bookings/:id`) — FS-02 FR-3/§6.3/AC-11, issue
 * #41 (route scaffolding from issue #39).
 *
 * Shows the full FS-02 §7 field set for one booking (resource, date+time
 * range, creator, booked-for person, purpose) — deliberately more than
 * FS-01's reduced read views, since this is the durable, revisitable
 * detail page for a single booking, not a day/resource overview row.
 *
 * ## Cancel affordance (issue #43, Task 3.4, FS-02 §6.4/AC-8/AC-10/Flow B)
 *
 * The "Cancel booking" trigger button is rendered *only* when the
 * server's `canCancel` flag (from `getBooking`'s response) is `true` —
 * never by comparing `booking.bookedBy.id` to a client-known "current
 * person" id. That flag already encodes exactly who is permitted to
 * cancel (issue #37); re-deriving it here would risk drifting from the
 * backend's rule and would violate Core Rule 6 ("Absent, not
 * disabled-and-unexplained" — so when the flag is `false` the button is
 * not rendered at all, not shown-and-disabled).
 *
 * `CancelBookingDialog` (issue #43) owns the trigger button itself, the
 * real React-Aria-Components modal, the confirm/back-out actions, and the
 * `cancelBooking` mutation — this route only decides WHETHER to render it
 * (`canCancel`) and WHAT to show once it reports the booking gone
 * (`onCancelled` → `isCancelled` below).
 *
 * ## What renders after a successful cancellation
 *
 * The booking record is gone the moment `cancelBooking` resolves (or the
 * dialog treats a `404` as the same outcome). Re-rendering the `<dl>` of a
 * now-nonexistent booking would be misleading, so this route swaps the
 * whole detail display for an explicit "This booking has been cancelled."
 * statement (AC-8: stated, not implied by the row disappearing) once
 * `isCancelled` is `true`. That statement is in a `role="status"` live
 * region so it is *announced*, not just rendered (Core Rule 1).
 *
 * shadcn/ui supplies only the visual layer — the `Card`-framed detail
 * list, `Skeleton`/`Alert` states — over the same semantic structure
 * (region, `<dl>`, `role="status"`) the criteria depend on.
 */
export function BookingDetailRoute() {
  const { id } = useParams<{ id: string }>();

  // Set once `CancelBookingDialog` reports the booking gone (success, or
  // a 404 raced against an already-gone booking — see that component).
  const [isCancelled, setIsCancelled] = useState(false);

  const query = useQuery<{ booking: BookingDetail; canCancel: boolean }, ApiError>({
    queryKey: ['booking', id],
    queryFn: () => getBooking(id as string),
    enabled: id !== undefined,
    retry: (failureCount, error) => {
      if (error.isNotFound) {
        return false;
      }
      return failureCount < 3;
    },
  });

  return (
    <section aria-labelledby="booking-detail-heading" className="flex flex-col gap-6">
      <h1 id="booking-detail-heading" className="font-heading text-2xl font-semibold">
        Booking detail
      </h1>

      {query.isLoading && (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Loading booking…</p>
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {query.isError && (
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

      {query.isSuccess && isCancelled && (
        // AC-8: success is stated in text, not implied by the row simply
        // disappearing. `role="status"` is a live region so assistive
        // technology announces this the moment it appears.
        <Alert role="status">
          <AlertTitle>This booking has been cancelled.</AlertTitle>
        </Alert>
      )}

      {query.isSuccess && !isCancelled && (
        <>
          {/*
            The full FS-02 §7 field set (AC-11's "all five booking
            attributes are displayed"): resource, date+time range,
            creator, booked-for person, purpose. A definition list is the
            appropriate structure for a "field: value" detail view — each
            `<dt>` is programmatically associated with its `<dd>` for
            assistive technology.
          */}
          <Card>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="font-medium text-muted-foreground">Resource</dt>
                <dd>{query.data.booking.resource.name}</dd>

                <dt className="font-medium text-muted-foreground">Date and time</dt>
                <dd>
                  {formatBerlinDateTime(query.data.booking.start)} –{' '}
                  {formatBerlinDateTime(query.data.booking.end)}
                </dd>

                <dt className="font-medium text-muted-foreground">Booked by</dt>
                <dd>{query.data.booking.bookedBy.name}</dd>

                <dt className="font-medium text-muted-foreground">Booked for</dt>
                <dd>{query.data.booking.bookedFor.name}</dd>

                <dt className="font-medium text-muted-foreground">Purpose</dt>
                <dd>{query.data.booking.purpose.label}</dd>
              </dl>
            </CardContent>
          </Card>

          {/*
            Cancel affordance (Core Rule 6): gated purely on the
            server-computed `canCancel` flag, never a client-side id
            comparison. Absent (not rendered) when `false`.
            `CancelBookingDialog` (issue #43) owns its own trigger button,
            the real modal, and the mutation.
          */}
          {query.data.canCancel && (
            <div>
              <CancelBookingDialog
                bookingId={query.data.booking.id}
                resourceName={query.data.booking.resource.name}
                resourceId={query.data.booking.resource.id}
                start={query.data.booking.start}
                end={query.data.booking.end}
                onCancelled={() => setIsCancelled(true)}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
