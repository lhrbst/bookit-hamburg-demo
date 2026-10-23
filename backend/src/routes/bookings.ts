import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { parseBookingQuery } from '../domain/bookingQuery';
import { listBookings, createBooking, getBookingById, cancelBooking } from '../db/bookingRepository';
import { validateBookingInput } from '../domain/bookingRules';
import { getCurrentPerson } from '../domain/currentPerson';
import { getResourceById } from '../db/resourceRepository';
import { getPersonById } from '../db/personRepository';
import { ValidationError, NotFoundError, ForbiddenError, type FieldError } from '../domain/errors';

/** Matches a well-formed UUID; a malformed `:id` cannot identify a booking
 * and is treated the same as an unknown one (404), not a 500 from an
 * invalid `uuid`-typed value reaching PostgreSQL. Mirrors
 * `routes/resources.ts`'s `UUID_SHAPE`. */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/bookings` — the cross-resource "today overview" query (FS-01
 * FR-3/FR-4, AC-5/AC-6/AC-6a/AC-7/AC-9, issue #21).
 *
 * Query params (all optional, combined additively/AND):
 *   - `date=YYYY-MM-DD` — defaults to today in Europe/Berlin.
 *   - `resourceId`, `bookedById`, `bookedForId` — UUIDs.
 *
 * A malformed `date` or a syntactically invalid UUID filter is rejected
 * with 400 via the existing `ValidationError` shape. An unknown id, or a
 * filter combination matching nothing, is not an error: it returns 200
 * with `[]` (FS-01 §10, AC-10).
 */
export const bookingsRouter = Router();

bookingsRouter.get(
  '/api/bookings',
  asyncHandler(async (req, res) => {
    const filters = parseBookingQuery(req.query);
    const bookings = await listBookings(filters);
    res.json(bookings);
  }),
);

/**
 * `POST /api/bookings` — create one booking (FS-02 FR-1/FR-5, AC-1/AC-2/
 * AC-6/AC-7, issue #36).
 *
 * Request body: `{ resourceId, bookedForId, purposeId, start, end }`.
 * `bookedBy` is never read from the request body — it is always the
 * current person (`domain/currentPerson.ts`, issue #35), so a client that
 * sends a `bookedBy`-shaped field has it silently ignored.
 *
 * Validation runs in two parts, and *both* run to completion before
 * anything is thrown, so a single submission that fails on several fronts
 * (e.g. an unknown resource AND a past start time) reports every problem
 * in one response rather than the first one found:
 *
 *   1. Existence of `resourceId` and `bookedForId` (this route, via
 *      `getResourceById`/`getPersonById` — an unknown id is a client
 *      error, not a database crash).
 *   2. FS-02 FR-2 booking validity rules R-1 to R-4 plus required-field
 *      presence (`validateBookingInput`, issue #33) — the request's
 *      `purposeId` is mapped to the domain's `purpose` field name here.
 *
 * Non-overlap (FS-03) is deliberately NOT checked here: the
 * `booking_no_overlap` exclusion constraint enforces it at insert time,
 * and any violation currently propagates unhandled — issues #47/#48 will
 * translate it into a 409. That is expected and acceptable for this
 * ticket.
 */
bookingsRouter.post(
  '/api/bookings',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const toOptionalString = (value: unknown): string | undefined =>
      typeof value === 'string' ? value : undefined;

    const resourceId = toOptionalString(body.resourceId);
    const bookedForId = toOptionalString(body.bookedForId);
    const purpose = toOptionalString(body.purposeId);
    const start = toOptionalString(body.start);
    const end = toOptionalString(body.end);

    // `bookedBy` is authoritative and never taken from the request body.
    const bookedBy = await getCurrentPerson();

    const fieldErrors: FieldError[] = [];

    // --- Existence checks (resourceId / bookedForId) --------------------
    // Run before/alongside the rule validation below so an unknown id is
    // reported alongside any other field problem in the same response,
    // not as a separate round trip. This is a field-level 400 (not the
    // route-level `NotFoundError`/404 used for an unknown `:id` itself,
    // e.g. `GET/DELETE /api/bookings/:id`): a request body that merely
    // *references* an id that no longer exists is a validation problem
    // against that field, not "the requested resource is gone" (#36).
    let resource = null;
    if (resourceId !== undefined) {
      resource = await getResourceById(resourceId);
      if (resource === null) {
        fieldErrors.push({
          field: 'resourceId',
          rule: 'not-found',
          message: 'This resource no longer exists.',
        });
      }
    }

    let bookedFor = null;
    if (bookedForId !== undefined) {
      bookedFor = await getPersonById(bookedForId);
      if (bookedFor === null) {
        fieldErrors.push({
          field: 'bookedForId',
          rule: 'not-found',
          message: 'This person no longer exists.',
        });
      }
    }

    // --- FS-02 FR-2 validity rules (R-1 to R-4, required fields) --------
    let validated;
    try {
      validated = validateBookingInput({ resourceId, bookedForId, purpose, start, end });
    } catch (err) {
      if (err instanceof ValidationError) {
        // `validateBookingInput` uses the domain field name `purpose`
        // (issue #33); the wire request body field is `purposeId`
        // (this route's own mapping, above). Remap it here, at the HTTP
        // boundary, so a client never has to know the domain's internal
        // naming to associate the error with the input it actually sent.
        const remapped = err.fieldErrors.map((fieldError) =>
          fieldError.field === 'purpose' ? { ...fieldError, field: 'purposeId' } : fieldError,
        );
        // Merge with the existence-check errors gathered above so every
        // problem surfaces in one response, rather than a second round
        // trip once the first batch is fixed. Both sets are field-scoped
        // `FieldError[]` entries, so this is a plain concatenation, not
        // an overwrite — a field could in principle appear in both
        // (e.g. `resourceId` missing AND, hypothetically, another
        // resourceId-scoped rule), and neither set is allowed to shadow
        // the other silently.
        throw new ValidationError([...remapped, ...fieldErrors]);
      }
      throw err;
    }

    if (fieldErrors.length > 0) {
      throw new ValidationError(fieldErrors);
    }

    // At this point `resource` and `bookedFor` are guaranteed non-null:
    // `validateBookingInput` already required `resourceId`/`bookedForId`
    // to be present, and the existence checks above would otherwise have
    // thrown.
    const booking = await createBooking({
      resourceId: validated.resourceId,
      bookedBy: bookedBy.id,
      bookedFor: validated.bookedForId,
      purpose: validated.purpose,
      start: validated.start,
      end: validated.end,
    });

    res.status(201).json({
      booking: {
        id: booking.id,
        resource: {
          id: resource!.id,
          name: resource!.name,
          type: resource!.type,
        },
        bookedBy: { id: bookedBy.id, name: bookedBy.name },
        bookedFor: { id: bookedFor!.id, name: bookedFor!.name },
        purpose: { id: booking.purpose, label: booking.purpose },
        start: booking.start,
        end: booking.end,
      },
    });
  }),
);

/**
 * `GET /api/bookings/:id` — a single booking's detail (FS-02 FR-3/FR-5,
 * AC-8/AC-9, §6.3, issue #37).
 *
 * Response shape matches `POST /api/bookings`'s create response
 * (`{ booking: { id, resource, bookedBy, bookedFor, purpose, start, end } }`,
 * issue #36), plus a top-level `canCancel: boolean` computed server-side
 * — `booking.bookedBy.id === (current person).id` — so the frontend never
 * has to reimplement the "only the creator may cancel" rule itself; it
 * only has to render (or not render) the button `canCancel` already
 * decided.
 *
 * An unknown id throws `NotFoundError`, rendered by the shared error
 * middleware as the "gone" outcome (same shape as every other 404).
 */
bookingsRouter.get(
  '/api/bookings/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (id === undefined || !UUID_SHAPE.test(id)) {
      throw new NotFoundError('This booking no longer exists.');
    }

    const booking = await getBookingById(id);

    if (booking === null) {
      throw new NotFoundError('This booking no longer exists.');
    }

    const currentPerson = await getCurrentPerson();

    res.json({
      booking,
      canCancel: booking.bookedBy.id === currentPerson.id,
    });
  }),
);

/**
 * `DELETE /api/bookings/:id` — cancel a booking, releasing its time
 * (FS-02 FR-3/FR-5, AC-8/AC-9, §6.3, issue #37).
 *
 * Flow, deliberately lookup-then-authorize-then-delete rather than
 * delete-then-check: the booking's `bookedBy` is needed to decide the
 * permission *before* anything is removed, so a non-creator's request
 * never touches the row.
 *
 *   1. `getBookingById` — unknown/already-cancelled id throws
 *      `NotFoundError` ("this booking no longer exists"), distinguishable
 *      from a permission refusal and from a server failure.
 *   2. Compare `booking.bookedBy.id` to the current person
 *      (`domain/currentPerson.ts`, issue #35) — the client's own
 *      identity is never trusted for this check. A mismatch throws
 *      `ForbiddenError` and the booking is left untouched.
 *   3. `cancelBooking` — a hard delete (FS-02 §12: not a soft
 *      delete/tombstone). The `booking_no_overlap` exclusion constraint
 *      only ever sees rows that still exist, so the slot is immediately
 *      free for a new booking with no further logic (AC-9, FS-03 AC-10).
 *
 * Responds `204 No Content` on success: cancellation returns no
 * resource body to describe (the booking is gone), which is exactly what
 * 204 communicates, and it keeps this endpoint's success case from
 * needing its own bespoke JSON shape alongside the existing error
 * contract.
 *
 * No time-based restriction is applied (FS-02 §12 Q2 is an open
 * question) — the creator may cancel a booking regardless of whether it
 * is in the future, in progress, or already past.
 */
bookingsRouter.delete(
  '/api/bookings/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (id === undefined || !UUID_SHAPE.test(id)) {
      throw new NotFoundError('This booking no longer exists.');
    }

    const booking = await getBookingById(id);

    if (booking === null) {
      throw new NotFoundError('This booking no longer exists.');
    }

    const currentPerson = await getCurrentPerson();

    if (booking.bookedBy.id !== currentPerson.id) {
      throw new ForbiddenError('You may only cancel a booking you made yourself.');
    }

    await cancelBooking(booking.id);

    res.status(204).send();
  }),
);
