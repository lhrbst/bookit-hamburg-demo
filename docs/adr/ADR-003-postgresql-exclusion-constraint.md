# ADR-003: Use PostgreSQL with an exclusion constraint to enforce booking non-overlap

**Status:** proposed
**Date:** 2026-08-28
**Deciders:** Momme Ristow

## Context

FS-03 §7 states an invariant, not a validation rule: "At any moment, no two active bookings on the same resource share any period of time." AC-14 makes the concurrency case explicit — when competing submissions request overlapping time on the same resource, the first confirmed succeeds and every later one is refused — and AC-12 requires the same for a slot taken while a form was open. An application-level check that reads existing bookings and then inserts is a time-of-check-to-time-of-use race and cannot satisfy AC-14 without additional locking. FS-03 §7 also defines overlap with half-open semantics (`P-start < E-end AND P-end > E-start`), so that bookings which merely touch are legitimate (AC-6, AC-7). This is the most consequential technical requirement in the spec set.

## Decision

Use PostgreSQL 16 or later as the datastore, storing each booking's time span as a single `tstzrange` column and enforcing non-overlap declaratively with `EXCLUDE USING GIST (resource_id WITH =, during WITH &&)` via the `btree_gist` extension.

## Consequences

### Positive

- **The FS-03 invariant becomes unbreakable.** The constraint is evaluated at commit by the database, so AC-12 and AC-14 hold structurally regardless of how the application is written or how many processes serve requests. No amount of application-level carelessness can produce overlapping bookings.
- Half-open `[start, end)` ranges make AC-6 and AC-7 correct by construction — a booking ending exactly when another begins shares no time — with no boundary-comparison code to get wrong.
- `resource_id WITH =` scopes the check to a single resource, satisfying AC-11 (bookings on different resources never conflict) without a separate predicate.
- The violation error's `DETAIL` line names the conflicting range, so FS-03 FR-3 and AC-8 ("the message identifies the conflicting time range") can be satisfied without a second query to find the conflict.
- Cancellation is a row deletion, so AC-10 (a cancelled slot is bookable again) requires no additional logic.
- `timestamptz` gives correct storage and DST-aware arithmetic, and the relational model matches the domain: `resource`, `person`, and `booking` with two person references and referential integrity.

### Negative

- **Introduces a server dependency.** Local development needs Docker Compose and production needs a managed or self-hosted instance, against SQLite's zero-configuration single file.
- **PostgreSQL does not satisfy FS-02 R-4.** It *coerces* ambiguous and non-existent local times rather than rejecting them — `'2018-03-11 02:30'::timestamptz` silently becomes `03:30` — so AC-5a must be enforced in application code before insert (ADR-002). Choosing PostgreSQL does not discharge this obligation, and assuming it does would be a live bug.
- The FS-03 rule is now expressed in a migration rather than in domain code, so it is invisible to a reader of the service layer. The backend must translate SQLSTATE `23P01` into the business message, coupling the error path to a database-specific code.
- Requires the `btree_gist` extension to be available, which constrains the choice of managed hosting to providers that permit it.

## Rejected Alternatives

### Option: SQLite

**Reason rejected:** No exclusion constraints, no range types, and no GiST indexing, so the FS-03 invariant would have to be implemented as `BEGIN IMMEDIATE` plus an overlap `SELECT` plus an `INSERT`, relying on the single-writer model. That can be made correct, but it moves the invariant into application code where one forgotten transaction violates it, and it converts a data-integrity guarantee into a deployment assumption of exactly one writing process. It also has no native date-time type and no time zone support in core. Remains defensible as an interim choice only if the clash check is inside `BEGIN IMMEDIATE` and a migration trigger is recorded.

### Option: MySQL / MariaDB

**Reason rejected:** No exclusion constraints and no range types. Preventing overlap requires `SELECT ... FOR UPDATE` on the resource row or a resource-level advisory lock plus an application check — strictly more moving parts than PostgreSQL for strictly weaker guarantees. Its `TIMESTAMP` versus `DATETIME` time-zone semantics are an additional known sharp edge for FS-02 R-4.

### Option: MongoDB

**Reason rejected:** The invariant cannot be expressed as a constraint at all; a unique index cannot encode "ranges must not overlap". Enforcement would require transactions plus an application guard, or bucketing time into fixed slots, which contradicts the free-form time ranges assumed by FS-01 and FS-02. The domain is also plainly relational, with referential integrity between bookings, resources, and two person references.

## Related

- [ADR-002: Use Node.js with Express and TypeScript for the backend REST API](./ADR-002-express-rest-backend.md) — enforces FS-02 R-1 to R-4, including the DST rejection this ADR explicitly does not cover, and translates `23P01` into the FS-03 refusal message
- [ADR-001: Use React with TypeScript and Vite as the frontend framework](./ADR-001-react-typescript-spa.md) — announces the resulting clash refusal per FS-03 AC-13
- [Technology comparison](../tech-stack-comparison.md) — full candidate evaluation behind this decision

