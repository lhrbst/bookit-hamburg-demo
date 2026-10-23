# ADR-002: Use Node.js with Express and TypeScript for the backend REST API

**Status:** proposed
**Date:** 2026-08-28
**Deciders:** Momme Ristow

## Context

The backend must serve the availability views in FS-01 and enforce the booking validity rules in FS-02 §5. Two of those rules shape the choice. R-4 requires that a start or end time which is ambiguous or does not occur in Europe/Berlin because of a daylight-saving change is *rejected* (AC-5a) — and PostgreSQL coerces such values rather than rejecting them (ADR-003), so this rule has no home other than application code. FS-03 FR-3 additionally requires refusals to be returned in business language carrying the conflicting time range, which needs a structured error contract rather than ad hoc responses. The application is small and the team is small, so framework ceremony is a direct cost to delivery.

## Decision

Implement the backend as a JSON REST API on Node.js using Express with TypeScript, with Zod for request validation and a Temporal-based date-time library (`@js-temporal/polyfill` or Luxon) for Europe/Berlin time rules.

## Consequences

### Positive

- Shares TypeScript and its toolchain with the frontend (ADR-001): one language, one test runner, one lint configuration, and the option of sharing request and response types.
- Express's error-handling middleware gives a single place to express the spec's error taxonomy — 400 for FS-02 validation failures, 404 for a resource that no longer exists, **409 for an FS-03 clash**, 500 for unexpected failure — keeping FS-03 §6.1's business language out of route bodies.
- Zod refinements express R-1 (end after start), R-2 (not in the past), and R-3 (valid purpose) declaratively while still yielding per-field messages, which FS-02 §9 requires for association with the offending input.
- Minimal framework surface means the booking rules stay visible as ordinary code rather than being distributed across framework abstractions.

### Negative

- **Express 4 does not automatically catch rejected promises.** Every asynchronous route touching the database must forward errors with `.catch(next)` or an equivalent wrapper, or the request will hang. This is a standing discipline the framework does not enforce; adopting Express 5 removes it.
- Validation, routing structure, and error shaping are all assembled by hand. NestJS would have supplied a prescribed structure for each.
- Correct DST handling depends on a deliberate library choice and on reviewers noticing if a plain `Date` is used instead. `Date` silently coerces ambiguous local times and would fail AC-5a without any visible error.
- Node's ecosystem requires more dependency-currency attention than a batteries-included platform.

## Rejected Alternatives

### Option: NestJS

**Reason rejected:** Its global exception filters are arguably the tidiest available home for translating PostgreSQL's `23P01` exclusion-constraint violation into the FS-03 refusal message, and `ValidationPipe` with DTOs standardises error responses. Rejected because the boilerplate and learning curve are disproportionate for three user stories. This is the runner-up: if the domain grows well beyond FS-01–FS-03, superseding this ADR with NestJS is the expected path.

### Option: Python with FastAPI

**Reason rejected:** Technically the best fit for the two hardest parts of FS-02. Python's standard-library `zoneinfo` detects non-existent and ambiguous local times through `fold` and an `astimezone` round-trip with no third-party dependency, and Pydantic v2 with `AfterValidator` expresses R-1 to R-4 declaratively. Rejected because it makes the stack polyglot: two languages, two toolchains, two CI paths, and no shared types with a TypeScript frontend. It would be the correct choice for a Python-first team.

### Option: Java with Spring Boot

**Reason rejected:** `java.time` offers the cleanest DST answer of any candidate — `ZoneRules.getValidOffsets()` returns zero offsets for a non-existent local time and two for an ambiguous one, which is exactly R-4's test. Rejected on weight: build tooling, startup time, boilerplate, and JVM operations are a poor trade for an application with three user stories.

## Related

- [ADR-001: Use React with TypeScript and Vite as the frontend framework](./ADR-001-react-typescript-spa.md) — the SPA consuming this REST API
- [ADR-003: Use PostgreSQL with an exclusion constraint to enforce booking non-overlap](./ADR-003-postgresql-exclusion-constraint.md) — defines which rules this backend enforces and which the database enforces; source of the `23P01` error this backend translates
- [Technology comparison](../tech-stack-comparison.md) — full candidate evaluation behind this decision

