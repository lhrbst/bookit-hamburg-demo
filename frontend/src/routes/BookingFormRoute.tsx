import { useId } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { usePurposes } from '../hooks/usePurposes';
import { useCurrentPerson } from '../hooks/useCurrentPerson';
import { usePeople } from '../hooks/usePeople';
import { useResources } from '../hooks/useResources';
import {
  createBooking,
  queryKeys,
  toBookingErrorOutcome,
  toFieldErrorMap,
  todayInBerlin,
  toBerlinDateTimeLocalInputValue,
  type ApiError,
  type BookingDetail,
  type CreateBookingInput,
} from '../lib';
import { FormSelectField } from '../components/FormSelectField';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

/** Native form-control styling matching shadcn/ui's `Input`, applied to a
 * plain `<input>` so React Hook Form's `register()` (value, `onChange`,
 * `ref`, `onBlur`) wires up exactly as it does for any standard HTML
 * control — the `datetime-local` inputs are deliberately native (see the
 * note above the fields for why), and shadcn's React-Aria-based `Input`
 * wrapper does not forward `register`'s controlled wiring for them. */
const dateTimeInputClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30';

/** Values held by the booking form (FS-02 §6.1). */
interface BookingFormValues {
  bookedForId: string;
  purposeId: string;
  start: string;
  end: string;
}

const EMPTY_VALUES: BookingFormValues = {
  bookedForId: '',
  purposeId: '',
  start: '',
  end: '',
};

/**
 * Router `state` shape a resource schedule's free-segment "Book this free
 * slot" link (issue #44) navigates here with — an ISO-instant start/end
 * pair to PRE-FILL (never lock) the start/end inputs below. Optional and
 * loosely checked (a direct visit/bookmark/refresh legitimately has no
 * `state` at all), so this is read defensively, never assumed present.
 */
interface BookingFormLocationState {
  start?: unknown;
  end?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Booking form route (`/resources/:resourceId/book`) — FS-02 §6.1, FR-1,
 * FR-4, AC-1, AC-7, AC-11, Flow A, Flow C, issue #40.
 *
 * The resource being booked and the current person (booking creator) are
 * DISPLAYED, never editable inputs (AC-1); "booked for" and "purpose" are
 * required `Select`s drawn from already-loaded sets, never free text;
 * start/end are native `datetime-local` inputs (see the note above the
 * fields for why); submission goes through `createBooking` (issue #39) via
 * `useMutation`, and the backend's field-keyed errors (issue #39's
 * `bookingErrors.ts`) are mapped onto these exact fields with React Hook
 * Form's `setError` — this form never reimplements FS-02's rules or the
 * FS-03 clash check itself (Core Rule 2/4 of this agent's contract).
 *
 * shadcn/ui supplies only the visual layer — `Card`-framed form,
 * `Skeleton`/`Alert` states, tokenised `Input`/`Label`/`Button` — over
 * the same semantic structure (labels, `aria-invalid`/`aria-describedby`,
 * `role="alert"`) the accessibility criteria depend on.
 */
export function BookingFormRoute() {
  const { resourceId } = useParams<{ resourceId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const resources = useResources();
  const currentPerson = useCurrentPerson();
  const purposes = usePurposes();
  const people = usePeople();

  const resource = resources.data?.find((candidate) => candidate.id === resourceId);

  // Pre-fill from a free-segment "Book this free slot" link's router
  // state (issue #44, Flow A steps 1–2), if present — a convenience
  // default only; the user can still change either value before
  // submitting, and a direct visit/refresh with no `state` falls back to
  // the same empty strings as before this ticket.
  const locationState = location.state as BookingFormLocationState | null;
  const prefillStart = isNonEmptyString(locationState?.start)
    ? toBerlinDateTimeLocalInputValue(locationState.start)
    : '';
  const prefillEnd = isNonEmptyString(locationState?.end)
    ? toBerlinDateTimeLocalInputValue(locationState.end)
    : '';

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormValues>({
    defaultValues: { ...EMPTY_VALUES, start: prefillStart, end: prefillEnd },
  });

  const startInputId = useId();
  const startErrorId = useId();
  const endInputId = useId();
  const endErrorId = useId();

  const mutation = useMutation<BookingDetail, ApiError, CreateBookingInput>({
    mutationFn: createBooking,
  });

  function onSubmit(values: BookingFormValues) {
    if (resourceId === undefined) {
      return;
    }

    mutation.mutate(
      {
        resourceId,
        bookedForId: values.bookedForId,
        purposeId: values.purposeId,
        start: values.start,
        end: values.end,
      },
      {
        onSuccess: (booking) => {
          // Invalidate the two FS-01 read views this create affects, so
          // the new booking shows up without a manual refresh when the
          // user navigates back to either.
          queryClient.invalidateQueries({ queryKey: queryKeys.resourceSchedule(resourceId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.todayOverview() });
          // Pass the FULL create-response payload via router state (issue
          // #42) rather than only the id in the URL — the confirmation
          // route already has everything it needs to render and must not
          // re-fetch it.
          navigate(`/bookings/${booking.id}/confirmation`, { state: { booking } });
        },
        onError: (error) => {
          const outcome = toBookingErrorOutcome(error);

          if (outcome === 'validation' || outcome === 'clash') {
            // Per-field messages (AC-3/AC-4/AC-5/AC-5a/AC-7): the clash
            // outcome's fieldErrors carry `start`/`end` entries whose
            // message already names the conflicting range (issue #48),
            // so no extra "clash" copy is invented here beyond what the
            // backend sent.
            const fieldErrors = toFieldErrorMap(error);
            for (const [field, message] of Object.entries(fieldErrors)) {
              if (
                field === 'bookedForId' ||
                field === 'purposeId' ||
                field === 'start' ||
                field === 'end'
              ) {
                setError(field, { type: 'server', message });
              }
            }
            setError('root.serverError', {
              type: 'server',
              message:
                outcome === 'clash'
                  ? 'This resource is not available for the time you chose — see the message below the time fields for the conflicting booking.'
                  : 'This booking could not be created — see the messages below for what to fix.',
            });
          } else if (outcome === 'gone') {
            setError('root.serverError', {
              type: 'server',
              message:
                'This resource no longer exists. Go back and choose another resource to book.',
            });
          } else if (outcome === 'permission') {
            setError('root.serverError', {
              type: 'server',
              message: 'This booking could not be created for the selected person.',
            });
          } else {
            // 'save-failed' — a safe generic message plus retry; React
            // Hook Form does not reset the form on a failed submission,
            // so every entered value is preserved for the retry.
            setError('root.serverError', {
              type: 'server',
              message:
                'Something went wrong while saving this booking. Your entries have been kept — please try again.',
            });
          }
        },
      },
    );
  }

  if (resourceId === undefined) {
    return (
      <section aria-labelledby="booking-form-heading" className="flex flex-col gap-6">
        <h1 id="booking-form-heading" className="font-heading text-2xl font-semibold">
          Book a resource
        </h1>
        <Alert variant="destructive">
          <AlertTitle>No resource was specified.</AlertTitle>
        </Alert>
      </section>
    );
  }

  return (
    <section aria-labelledby="booking-form-heading" className="flex flex-col gap-6">
      <h1 id="booking-form-heading" className="font-heading text-2xl font-semibold">
        {resource !== undefined ? `Book ${resource.name}` : 'Book resource'}
      </h1>

      {/* The resource being booked (AC-1) — displayed, never editable. */}
      {resources.isLoading && (
        <div role="status">
          <Skeleton className="h-5 w-48" />
        </div>
      )}
      {resources.isError && (
        <Alert variant="destructive">
          <AlertTitle>The resource could not be loaded.</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onPress={() => resources.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {resources.isSuccess && resource === undefined && (
        <Alert variant="destructive">
          <AlertTitle>
            This resource no longer exists. Go back and choose another resource.
          </AlertTitle>
        </Alert>
      )}
      {resource !== undefined && (
        <p className="text-sm text-muted-foreground">
          Booking <strong className="text-foreground">{resource.name}</strong> ({resource.type}).
        </p>
      )}

      {/* The booking creator (AC-1) — the current person, displayed, never editable. */}
      {currentPerson.isLoading && (
        <div role="status">
          <Skeleton className="h-5 w-40" />
        </div>
      )}
      {currentPerson.isError && (
        <Alert variant="destructive">
          <AlertTitle>Your identity could not be loaded.</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onPress={() => currentPerson.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {currentPerson.isSuccess && (
        <p className="text-sm text-muted-foreground">Booking as {currentPerson.data.name}.</p>
      )}

      {errors.root?.serverError?.message !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.serverError.message}</AlertDescription>
        </Alert>
      )}

      {resource !== undefined && currentPerson.isSuccess && (
        <Card>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
              <Controller
                control={control}
                name="bookedForId"
                rules={{ required: 'Choose who this booking is for.' }}
                render={({ field, fieldState }) => (
                  <FormSelectField
                    label="Booked for"
                    options={(people.data ?? []).map((person) => ({
                      id: person.id,
                      label: person.name,
                    }))}
                    selectedKey={field.value === '' ? null : field.value}
                    onSelectionChange={(id) => field.onChange(id ?? '')}
                    onBlur={field.onBlur}
                    isRequired
                    isDisabled={!people.isSuccess}
                    errorMessage={fieldState.error?.message}
                    placeholder={people.isSuccess ? 'Choose a person' : 'Loading people…'}
                  />
                )}
              />

              <Controller
                control={control}
                name="purposeId"
                rules={{ required: 'Choose the purpose of this booking.' }}
                render={({ field, fieldState }) => (
                  <FormSelectField
                    label="Purpose"
                    options={purposes.data ?? []}
                    selectedKey={field.value === '' ? null : field.value}
                    onSelectionChange={(id) => field.onChange(id ?? '')}
                    onBlur={field.onBlur}
                    isRequired
                    isDisabled={!purposes.isSuccess}
                    errorMessage={fieldState.error?.message}
                    placeholder={purposes.isSuccess ? 'Choose a purpose' : 'Loading purposes…'}
                  />
                )}
              />

              {/*
                Start/end date-time entry (FR-4/AC-11): a native
                `<input type="datetime-local">` (styled by shadcn's
                `Input`, which is a thin wrapper over React Aria's
                `Input`), not a React Aria `DateField`/`DatePicker`.
                Decision, documented once here:

                - Native `datetime-local` inputs already have first-class
                  keyboard and screen-reader support built into the
                  browser — using one is NOT hand-writing ARIA semantics;
                  there is no ARIA widget being reimplemented, just a
                  standard HTML form control wired through React Hook
                  Form's `register()` like any other input.
                - Its value is already exactly `YYYY-MM-DDTHH:mm` —
                  precisely the bare local wall-clock format the backend's
                  `parseBerlinLocalDateTime` requires, with NO offset/zone
                  suffix. No reformatting step is needed or introduced.
                - It exposes no time zone control at all (FR-4/AC-11).
              */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={startInputId}>Start</Label>
                <input
                  id={startInputId}
                  type="datetime-local"
                  required
                  aria-required="true"
                  aria-invalid={errors.start !== undefined}
                  aria-describedby={errors.start !== undefined ? startErrorId : undefined}
                  className={dateTimeInputClass}
                  {...register('start', { required: 'Enter when the booking starts.' })}
                />
                {errors.start?.message !== undefined && (
                  <div role="alert">
                    <p id={startErrorId} className="text-sm font-medium text-destructive">
                      {errors.start.message}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={endInputId}>End</Label>
                <input
                  id={endInputId}
                  type="datetime-local"
                  required
                  aria-required="true"
                  aria-invalid={errors.end !== undefined}
                  aria-describedby={errors.end !== undefined ? endErrorId : undefined}
                  className={dateTimeInputClass}
                  {...register('end', { required: 'Enter when the booking ends.' })}
                />
                {errors.end?.message !== undefined && (
                  <div role="alert">
                    <p id={endErrorId} className="text-sm font-medium text-destructive">
                      {errors.end.message}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" isDisabled={isSubmitting || mutation.isPending}>
                  Book this resource
                </Button>
                <Link
                  to={`/resources/${resourceId}/schedule/${todayInBerlin()}`}
                  className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  Cancel and return to schedule
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
