/**
 * `src/lib` — REST fetch helpers and their supporting hooks.
 *
 * `api.ts` exports the shared `apiFetch` primitive and `ApiError` (with
 * `isNotFound`/`isValidationError`/`isConflict`/`isForbidden`/`isUnexpected`
 * getters for distinguishing outcomes). `types.ts` holds the shared
 * response shapes. `resources.ts`, `people.ts`, `bookings.ts`,
 * `purposes.ts`, and `me.ts` are the typed per-endpoint helpers (reads
 * from Task 2.1/issue #23; booking mutation helpers `createBooking`/
 * `getBooking`/`cancelBooking` plus `listPurposes`/`getCurrentPerson`
 * added in issue #39) — view code calls these, never `fetch`/`apiFetch`
 * directly. `bookingErrors.ts` (issue #39) reshapes a caught `ApiError`
 * into a field-error map and a named outcome class for the write flows.
 * `queryKeys.ts` (issue #39) is the shared TanStack Query key factory for
 * the FS-01 schedule/today-overview reads, so a booking mutation's
 * `onSuccess` can invalidate exactly the queries those views use. `dates.ts`
 * (issue #24) is the single Europe/Berlin day-key and time-formatting
 * module — every view reads/parses calendar days and formats times
 * through it rather than inventing per-component `Date` logic.
 */
export * from './api';
export * from './types';
export * from './resources';
export * from './people';
export * from './bookings';
export * from './purposes';
export * from './me';
export * from './bookingErrors';
export * from './queryKeys';
export * from './dates';

