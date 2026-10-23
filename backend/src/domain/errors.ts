/**
 * Typed domain error taxonomy for the API.
 *
 * These are the only error types route/service code should throw for
 * expected failure conditions. The error-handling middleware (see
 * `middleware/errorHandler.ts`) maps each subclass to a stable HTTP status
 * and JSON shape. Business wording lives in the middleware, not here or in
 * route bodies — these classes carry structured data only.
 *
 * Later tickets (booking creation, cancellation) are expected to throw
 * `ValidationError`, `NotFoundError`, `ForbiddenError`, and `ConflictError`
 * as appropriate; this scaffold defines the taxonomy so those tickets do
 * not each invent their own shape.
 *
 * ## Error response contract (issue #22, extended by issue #38)
 *
 * Every error response — for every endpoint, without route-by-route
 * special-casing — has the shape:
 *
 * ```json
 * { "error": { "code": "validation_error", "message": "...", "fieldErrors": [
 *     { "field": "date", "rule": "invalid-date", "message": "..." }
 * ] } }
 * ```
 *
 * `error` is always an object, never a bare string, so the frontend can
 * branch on `error.code` mechanically. `fieldErrors` is present only for
 * `validation_error` and only when there is at least one per-field issue;
 * every other error omits it entirely rather than emitting `fieldErrors:
 * null`/`[]` noise. A single-violation validation issue still uses the
 * same array shape (one entry), so callers only ever branch on one
 * representation, never a special single-field shape.
 *
 * `fieldErrors` is an ARRAY, not a map keyed by field, because a single
 * field can in principle need more than one simultaneous violation (e.g.
 * "required" is meaningfully distinct from "the value present fails a
 * business rule", and future rules may want to report both at once). As
 * of this ticket no call site in this codebase actually produces two
 * entries for the same field in one response — every current check is
 * guarded so at most one rule fires per field per request (see
 * `bookingRules.ts`) — but the wire shape does not assume that, so a
 * later rule addition never needs another breaking change here.
 *
 * Each entry is `{ field, rule, message }`:
 *  - `field` names the offending input (`start`, `end`, `purposeId`,
 *    `resourceId`, `bookedForId`, `date`, …) so the client can associate
 *    the message with the input programmatically (FS-02 §9).
 *  - `rule` is a stable, machine-consumable code (e.g. `end-after-start`,
 *    `not-in-past`, `valid-purpose`, `ambiguous-local-time`,
 *    `nonexistent-local-time`, `required`, `invalid-date`, `invalid-id`,
 *    `not-found`) — never a sentence, so the client need not string-match
 *    `message` to branch on which rule failed.
 *  - `message` is business language: what is wrong and how to fix it.
 *    Never a SQLSTATE, a framework/validator name, or a stack trace.
 *
 * Machine-consumable `code` values, mapped 1:1 from the classes below:
 *
 * | code               | status | class            | `fieldErrors`? |
 * | ------------------ | ------ | ----------------- | -------------- |
 * | `validation_error` | 400    | `ValidationError` | yes            |
 * | `not_found`        | 404    | `NotFoundError`   | no             |
 * | `forbidden`        | 403    | `ForbiddenError`  | no             |
 * | `conflict`         | 409    | `ConflictError`   | yes*           |
 * | `internal_error`   | 500    | (unrecognised)    | no             |
 *
 * \* `ConflictError` (extended by issue #48, FS-03 FR-3/AC-8) reuses the
 * SAME `fieldErrors: FieldError[]` array shape as `validation_error` —
 * one entry each for `start` and `end`, since a clash is attributed to
 * the time fields the user must change — rather than inventing a second
 * "how do multi-field problems look" pattern. Each entry additionally
 * carries an optional `conflict: { start, end }` (the existing booking's
 * conflicting range, when the database's error detail could be parsed),
 * which plain `FieldError` entries never have. `conflict` (409) and
 * `validation_error` (400) stay distinguishable purely by `error.code` —
 * and MUST stay distinguishable that way per FS-03's acceptance criteria
 * — even though their bodies otherwise look alike: a clash is a conflict
 * with existing state (ADR-003), not a malformed request, so it is never
 * rendered as a 400 regardless of how similar the JSON looks.
 *
 * The four outcome classes (`validation_error`, `forbidden`, `not_found`,
 * `internal_error`) are always distinguishable by `error.code` alone,
 * with no string-matching of `message` required — this is what lets a
 * write-failure UI (FS-02 §10) decide "show inline field errors" vs. "you
 * can't do that" vs. "that's gone, go back" vs. "retry, your input is
 * still here" without inspecting prose.
 *
 * This shape is a single extension of the FS-01 read-side contract
 * (issue #22), not a parallel one: every `ValidationError` — whether
 * thrown by a read endpoint's query-param parsing (`dayQuery.ts`,
 * `bookingQuery.ts`, `scheduleQuery.ts`) or a write endpoint's body
 * validation (`bookingRules.ts`, `routes/bookings.ts`) — carries exactly
 * this `FieldError[]` shape and is rendered by the same middleware
 * branch.
 */

/** One field-level validation violation. */
export interface FieldError {
  /** The offending input's name, e.g. `start`, `purposeId`, `date`. */
  field: string;
  /** Stable, machine-consumable rule code — never prose. */
  rule: string;
  /** Business-language explanation of what is wrong and how to fix it. */
  message: string;
}

export class ValidationError extends Error {
  readonly status = 400 as const;
  /** All accumulated field-level violations, not just the first. */
  readonly fieldErrors: FieldError[];

  constructor(fieldErrors: FieldError[]) {
    super('The request could not be validated.');
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends Error {
  readonly status = 404 as const;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * A conflict-scoped field issue (issue #48). Same base shape as
 * `FieldError` — `field`/`rule`/`message` — plus an optional `conflict`
 * range naming the existing booking's `[start, end)` in business
 * language, when the database's `23P01` `DETAIL` line could be parsed.
 * Deliberately never carries who holds the conflicting booking or its
 * purpose (FS-03 §12 Q1/Q2 — a deliberate decision, not an omission).
 */
export interface ConflictFieldError extends FieldError {
  rule: 'clash';
  conflict?: { start: string; end: string };
}

export class ConflictError extends Error {
  readonly status = 409 as const;
  /**
   * One entry per affected field (`start` and `end` — both are what the
   * user must change to resolve a clash, per FS-03 §6.1), each carrying
   * the same optional conflicting range so the client need not cross-
   * reference entries to find it.
   */
  readonly fieldErrors: ConflictFieldError[];

  constructor(message: string, fieldErrors: ConflictFieldError[]) {
    super(message);
    this.name = 'ConflictError';
    this.fieldErrors = fieldErrors;
  }
}

