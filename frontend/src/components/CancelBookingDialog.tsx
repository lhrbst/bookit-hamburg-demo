import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';
import { ApiError, cancelBooking, queryKeys } from '../lib';
import { formatBerlinDateTime } from '../lib/dates';
import { toBookingErrorOutcome } from '../lib/bookingErrors';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface CancelBookingDialogProps {
  bookingId: string;
  resourceName: string;
  /** The cancelled booking's resource id (from `BookingDetail.resource.id`
   * — issue #44) — needed to invalidate exactly that resource's schedule
   * cache (`queryKeys.resourceSchedule(resourceId)`), the same partial/
   * prefix key `BookingFormRoute`'s create-side invalidation (issue #40)
   * already uses, so a cancelled booking disappears from its resource
   * schedule and the today overview without a manual reload, the same
   * way a newly created one appears. */
  resourceId: string;
  /** ISO instants — reused with the same `formatBerlinDateTime` the detail
   * view itself uses, so the dialog names the booking identically to how
   * the page already displays it (§6.4: "identify the specific booking"). */
  start: string;
  end: string;
  /** Called once the booking is confirmed gone (either this dialog's own
   * `DELETE` succeeded, or it raced a second `DELETE` against an
   * already-cancelled booking and got `404` — both are the same desired
   * end state from the user's point of view). The caller decides what to
   * render next; this component's only job is the confirm step itself. */
  onCancelled: () => void;
}

/**
 * The FS-02 §6.4/AC-8/AC-10/Flow B cancellation confirmation — issue #43
 * (Task 3.4), replacing the placeholder block issue #41 left in
 * `BookingDetailRoute`.
 *
 * Built on `react-aria-components` `DialogTrigger`/`Modal`/`ModalOverlay`/
 * `Dialog` — the exact primitives shadcn/ui's own dialog wraps — styled
 * here with shadcn's design tokens and `Button`/`Alert` components rather
 * than shadcn's packaged `AlertDialog`, because that packaged component
 * renders `role="alertdialog"` and derives its accessible name from a
 * slotted title, whereas this dialog must keep `role="dialog"` and the
 * explicit `aria-label="Cancel booking: <resource>"` (§6.4: "identify the
 * specific booking"). Composing the primitives directly keeps that
 * contract while still adopting the shadcn visual layer. `DialogTrigger`
 * supplies:
 *
 *  - Focus trapping while the dialog is open (`Modal`'s underlying
 *    `useModalOverlay`/focus scope).
 *  - `Escape` to dismiss — `ModalOverlay`'s `isDismissable` also permits
 *    clicking the underlay to dismiss; NEITHER path calls
 *    `cancelBooking` (only `Dialog`'s `close` render-prop or the
 *    confirm button's `mutate()` do that), so dismissing this way is
 *    exactly "back out, unchanged" (AC-10).
 *  - Focus restoration to the trigger `Button` on close (`PressResponder`
 *    tracks the trigger ref and restores to it).
 *  - The trigger `Button` (this component's own first child) IS the
 *    "Cancel booking" affordance `BookingDetailRoute` renders only when
 *    `canCancel` is `true` — the caller decides visibility by whether it
 *    renders `<CancelBookingDialog>` at all, this component does not
 *    re-check permission itself.
 *
 * The mutation's own `isPending` gate — not a separate `useState` flag —
 * is what disables the confirm button mid-flight, so "confirming twice"
 * cannot fire a second `DELETE` while the first is outstanding. The
 * remaining double-fire case (two `DELETE`s already in flight before the
 * first one's response disables the button — e.g. a very fast
 * double-click race) is handled in `onError`: a `404` there means the
 * booking is provably already gone, which is treated as success, not an
 * alarming duplicate-error state.
 *
 * ## Cache invalidation (issue #44, Task 3.5)
 *
 * On a successful cancel — and on the "already gone" `404` outcome above,
 * which is the same desired end state from the user's point of view — this
 * invalidates the same two FS-01 read-view query keys `BookingFormRoute`'s
 * create-side mutation already invalidates on success (issue #40):
 * `queryKeys.resourceSchedule(resourceId)` (a partial/prefix key,
 * matching every cached day/filter combination for this resource) and
 * `queryKeys.todayOverview()` (a partial key, matching every cached
 * filter combination). Both are `invalidateQueries` calls — a real
 * refetch against the server next time either view is mounted/visible —
 * never `setQueryData`, so the refreshed data always comes from the
 * server, not an optimistic local patch that could drift.
 */
export function CancelBookingDialog({
  bookingId,
  resourceName,
  resourceId,
  start,
  end,
  onCancelled,
}: CancelBookingDialogProps) {
  // Controlled open state (rather than leaving `DialogTrigger`
  // uncontrolled) so a successful/already-gone mutation outcome can close
  // the dialog itself, from `onSuccess`/`onError` — those callbacks fire
  // outside the `Dialog` render prop's `close` closure, so there is no
  // other way to close programmatically on that path.
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const invalidateBookingViews = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.resourceSchedule(resourceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.todayOverview() });
  };

  const mutation = useMutation<void, ApiError>({
    mutationFn: () => cancelBooking(bookingId),
    onSuccess: () => {
      setIsOpen(false);
      invalidateBookingViews();
      onCancelled();
    },
    onError: (error) => {
      // "Already gone" (issue #46's 'gone' outcome) is the SAME desired
      // end state as a successful cancel from the user's point of view —
      // e.g. a slow double-click firing a second DELETE after the first
      // already succeeded, or the booking having been cancelled
      // elsewhere in the meantime. Do not surface this as a failure.
      if (error.isNotFound) {
        setIsOpen(false);
        invalidateBookingViews();
        onCancelled();
      }
    },
  });

  // A `404` is folded into the success path above, so the only error
  // states this dialog itself ever displays are the genuine failure
  // outcomes issue #46 will later refine the wording/retry UX for.
  const showsFailure = mutation.isError && !mutation.error.isNotFound;

  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          // Reset any stale error from a previous attempt once the
          // dialog is dismissed (via Escape, underlay click, or "No,
          // keep it"), so reopening it starts clean.
          mutation.reset();
        }
      }}
    >
      <Button
        type="button"
        variant="destructive"
        className="border-transparent bg-destructive-button text-destructive-button-foreground hover:bg-destructive-button/90 focus-visible:ring-destructive-button/40"
      >
        Cancel booking
      </Button>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 isolate z-50 flex min-h-full items-center justify-center bg-black/20 p-4 supports-backdrop-filter:backdrop-blur-xs"
      >
        <Modal className="grid w-full max-w-sm gap-4 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none">
          <Dialog
            aria-label={`Cancel booking: ${resourceName}`}
            className="grid gap-4 outline-none"
          >
            {({ close }) => (
              <>
                <div className="grid gap-1.5">
                  <Heading
                    slot="title"
                    className="font-heading text-base leading-none font-medium"
                  >
                    Cancel this booking?
                  </Heading>
                  <p className="text-sm text-muted-foreground">
                    {resourceName}, {formatBerlinDateTime(start)} – {formatBerlinDateTime(end)}
                  </p>
                </div>

                {showsFailure && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {mutation.error !== null &&
                      toBookingErrorOutcome(mutation.error) === 'permission'
                        ? 'This booking can no longer be cancelled by you.'
                        : 'This booking could not be cancelled. It is still active. Please try again.'}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    isDisabled={mutation.isPending}
                    onPress={close}
                  >
                    No, keep it
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="border-transparent bg-destructive-button text-destructive-button-foreground hover:bg-destructive-button/90 focus-visible:ring-destructive-button/40"
                    isDisabled={mutation.isPending}
                    onPress={() => mutation.mutate()}
                  >
                    Yes, cancel it
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
