/**
 * Domain scaffolding.
 *
 * `errors.ts` defines the shared error taxonomy used by the error-handling
 * middleware (see `../middleware/errorHandler.ts`).
 *
 * `booking.ts`, `resource.ts`, and `person.ts` define the domain model
 * (FS-01/FS-02 §7). `purposes.ts` defines the predefined purpose category
 * set as configuration (FS-02 R-3), readable by later API tickets
 * (`GET /api/purposes`, issue #34) rather than as user-managed data.
 *
 * `datetime.ts` is the single Europe/Berlin local-time parsing/validation
 * module built on `@js-temporal/polyfill`, rejecting ambiguous and
 * non-existent local times (FS-02 R-4). `bookingRules.ts` layers the full
 * FS-02 FR-2 booking validity rules (R-1 to R-4, plus required-field
 * presence) on top, as a pure, unit-testable function — issue #33 — ready
 * to be called by `POST /api/bookings` (issue #36) ahead of the FS-03
 * clash check, which remains the database's job
 * (`db/bookingRepository.ts#createBooking`).
 *
 * `clash.ts` (issue #47) is a pure, standalone predicate encoding the
 * FS-03 §7 half-open overlap semantics for exhaustive unit testing and
 * future non-insert consumers (e.g. an availability preview). It is NOT
 * wired into `POST /api/bookings` — the database's `booking_no_overlap`
 * exclusion constraint remains the sole enforcement mechanism (ADR-003).
 */
export * from './booking';
export * from './resource';
export * from './person';
export * from './purposes';
export * from './errors';
export * from './dayClipping';
export * from './bookingQuery';
export * from './datetime';
export * from './bookingRules';
export * from './clash';


