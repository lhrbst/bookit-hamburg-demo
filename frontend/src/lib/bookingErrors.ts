import type { ApiError } from './api';

/**
 * Error normalisation for the booking write flows (Task 2.1, issue #39,
 * FS-02 §6/§8/§10).
 *
 * `ApiError` (see `api.ts`) already carries everything a view needs —
 * this module is a THIN booking-domain convenience layer over it, not a
 * reimplementation: it does not add new information, it only reshapes
 * what `ApiError` already exposes into two forms views consume directly.
 *
 * 1. `toFieldErrorMap` — turns `ApiError.fieldErrors` (an array, because
 *    the backend's contract allows more than one violation per field —
 *    see `backend/src/domain/errors.ts`) into a `Record<field, message>`.
 *    Where a field has more than one entry, the LAST one wins — current
 *    backend rules never actually emit two entries for the same field in
 *    one response (see that same doc comment), so this only matters if
 *    that ever changes, and "last wins" keeps the reshape a total
 *    function without inventing multi-message-per-field UI now.
 *
 *    The intended consumer is React Hook Form's `setError`:
 *
 *    ```ts
 *    const fieldErrors = toFieldErrorMap(apiError);
 *    for (const [field, message] of Object.entries(fieldErrors)) {
 *      setError(field as keyof FormValues, { type: 'server', message });
 *    }
 *    ```
 *
 * 2. `toBookingErrorOutcome` — maps `ApiError`'s existing boolean getters
 *    onto ONE of five named outcome classes, so a view can switch on a
 *    single string instead of re-checking four different booleans and
 *    guessing what a fifth ("neither of the above") case means. No view
 *    may branch by string-matching `ApiError#message`/`fieldErrors[].message`
 *    — only this outcome class and the field-error map above.
 *
 * ## Outcome mapping (documented once here; consumed by #40/#41/#45/#46)
 *
 * | Outcome class  | Derived from            | HTTP | View is expected to...                                            |
 * | -------------- | ------------------------ | ---- | ------------------------------------------------------------------ |
 * | `'validation'` | `ApiError#isValidationError` | 400  | Show inline per-field messages (from `toFieldErrorMap`), keep the form filled, allow retry. |
 * | `'permission'` | `ApiError#isForbidden`   | 403  | Explain the action isn't allowed for this person; do not offer retry of the same action. |
 * | `'gone'`       | `ApiError#isNotFound`    | 404  | Tell the user the booking is already cancelled/gone; leave no stuck error state (e.g. route away, not a dead retry button). |
 * | `'clash'`      | `ApiError#isConflict`    | 409  | Announce the refusal in business language, tied to the start/end inputs (via `toFieldErrorMap`, which also carries the `start`/`end` messages naming the conflicting range); keep the form filled so the user can pick another slot. |
 * | `'save-failed'`| `ApiError#isUnexpected`  | 500 / network | Show a safe generic message plus a retry affordance; preserve entered values. |
 */

export type BookingErrorOutcome = 'validation' | 'permission' | 'gone' | 'clash' | 'save-failed';

/**
 * Reshapes `ApiError.fieldErrors` (an array of `{ field, rule, message,
 * conflict? }`) into a `Record<field, message>` suitable for React Hook
 * Form's `setError(field, { type: 'server', message })`. Returns `{}`
 * when the error carries no field errors at all (e.g. `forbidden`/
 * `not_found`/`internal_error` never populate `fieldErrors`).
 */
export function toFieldErrorMap(error: ApiError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const fieldError of error.fieldErrors ?? []) {
    map[fieldError.field] = fieldError.message;
  }
  return map;
}

/**
 * Maps an `ApiError` onto one of five named outcome classes a view can
 * switch on directly, per the table in this module's doc comment above.
 * `isUnexpected` is checked last and is deliberately the catch-all: it is
 * `true` for both a recognised `internal_error` and an unrecognised/
 * network failure, so every `ApiError` maps to exactly one outcome —
 * there is no sixth "unhandled" case a view could forget to render.
 */
export function toBookingErrorOutcome(error: ApiError): BookingErrorOutcome {
  if (error.isValidationError) {
    return 'validation';
  }
  if (error.isForbidden) {
    return 'permission';
  }
  if (error.isNotFound) {
    return 'gone';
  }
  if (error.isConflict) {
    return 'clash';
  }
  return 'save-failed';
}
