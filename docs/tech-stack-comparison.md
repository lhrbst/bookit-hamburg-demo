# Technology Comparison — BookIt Hamburg

Status: Draft for decision (input for an ADR)
Scope: candidate frontend frameworks, backend languages/frameworks, and databases for FS-01 / FS-02 / FS-03.
Sources: official documentation retrieved via Context7 (links inline).

---

## 1. What the specs actually demand

Before comparing anything, these are the requirements that discriminate between candidates. Everything else (CRUD, REST, forms) every candidate does adequately.

| # | Driver | Spec source | Why it discriminates |
|---|---|---|---|
| D-1 | **No two active bookings on the same resource may share time — ever**, including under concurrent submissions where "the first submission confirmed by the system succeeds" | FS-03 §7 Invariant, FR-5, AC-14 | This is a *correctness invariant under concurrency*, not a validation rule. Application-level "SELECT then INSERT" is a race. Decisive for the **database**. |
| D-2 | **Back-to-back is legal, overlap is not** (`P-start < E-end AND P-end > E-start`) | FS-03 §7 | Half-open interval semantics. Cheap in some stores, hand-rolled in others. |
| D-3 | **Europe/Berlin DST correctness** — ambiguous and non-existent local times must be *rejected*, not silently coerced | FS-02 R-4, AC-5a | Decisive for **backend language + DB time type**. Naive `Date`/`DATETIME` handling fails this. |
| D-4 | **Accessibility is a first-class acceptance criterion** — announced errors, programmatic error/input association, keyboard-only operation, non-colour cues | FS-01 §9/AC-11, FS-02 §9/AC-12, FS-03 §9/AC-13 | Decisive for the **frontend**: form-error wiring, live regions, focus management, dialog semantics. |
| D-5 | **Read-heavy schedule views with combined filters** (resource × day × booked-by × booked-for) and multi-day booking splitting | FS-01 FR-2, FR-3, AC-13 | Favours a query engine with ranges/indexes over in-memory filtering. |
| D-6 | **Business-language error messages carrying data** (e.g. the conflicting time range) | FS-03 FR-3, AC-8 | Needs structured error contracts, not stringly-typed 500s. |
| D-7 | Small team, small dataset (one office's rooms/equipment), fast delivery | Whole repo shape | Penalises heavyweight platforms. |

---

## 2. Database — the decisive choice

D-1 is the hardest requirement in the entire spec set, and it is the one most often got wrong. PostgreSQL solves it *declaratively*; every other candidate requires application-level locking.

### 2.1 PostgreSQL

Range types + a GiST **exclusion constraint** express FS-03 §7 exactly — including D-2 half-open semantics — and enforce it at the storage layer, so AC-14 holds even under simultaneous inserts:

```sql
CREATE EXTENSION btree_gist;

CREATE TABLE booking (
    id         uuid PRIMARY KEY,
    resource_id uuid NOT NULL REFERENCES resource(id),
    during     tstzrange NOT NULL,
    booked_by  uuid NOT NULL REFERENCES person(id),
    booked_for uuid NOT NULL REFERENCES person(id),
    purpose    text NOT NULL,
    EXCLUDE USING GIST (resource_id WITH =, during WITH &&)
);
```

> "Combines a scalar column and a range column in an exclusion constraint using the btree_gist extension." — [PostgreSQL 18, Range Types](https://www.postgresql.org/docs/18/rangetypes.html)

The documented behaviour is precisely FS-03's AC-1..AC-5 and AC-11:

```
INSERT INTO room_reservation VALUES ('123A', '[2010-01-01 14:00, 2010-01-01 15:00)');  -- ok
INSERT INTO room_reservation VALUES ('123A', '[2010-01-01 14:30, 2010-01-01 15:30)');
ERROR:  conflicting key value violates exclusion constraint "room_reservation_room_during_excl"
DETAIL:  Key (room, during)=(123A, [...]) conflicts with existing key (room, during)=(123A, [...]).
INSERT INTO room_reservation VALUES ('123B', '[2010-01-01 14:30, 2010-01-01 15:30)');  -- ok, different resource
```

Mapping to the specs:

- `[start, end)` half-open range ⇒ **AC-6 / AC-7 back-to-back accepted for free**. No custom comparison code, no off-by-one.
- `resource_id WITH =` ⇒ **AC-11**, other resources never conflict.
- The `DETAIL` line carries the conflicting range ⇒ **AC-8 / FR-3** message content comes from the database, not a second query.
- The constraint is checked at commit ⇒ **FR-5 / AC-12 / AC-14** ("slot taken while form was open", "overlapping simultaneous submissions") are satisfied structurally.
- Cancellation = delete the row ⇒ **AC-10** free automatically.

For D-3, `timestamptz` has documented, testable DST behaviour, which is what lets the backend detect and reject ambiguous/non-existent local times rather than guess:

```sql
=> SELECT '2018-03-11 02:30'::timestamptz;   -- non-existent local time, silently shifted
 2018-03-11 03:30:00-04
=> SELECT '2018-11-04 01:30'::timestamptz;   -- ambiguous, resolved to one side
 2018-11-04 01:30:00-05
```
— [Handling of Invalid or Ambiguous Timestamps](https://www.postgresql.org/docs/18/datetime-invalid-input.html)

**Important consequence:** the database *coerces* these; it does not reject them. So R-4 / AC-5a must still be enforced in the backend (§3) before insert. Postgres gives correct storage and arithmetic; the "reject ambiguous input" rule stays application logic.

### 2.2 SQLite

- ✅ Zero-ops, single file, ideal for D-7 and for local dev/tests.
- ❌ **No exclusion constraints, no range types, no GiST.** D-1 must be implemented as `BEGIN IMMEDIATE` + overlap `SELECT` + `INSERT`, relying on SQLite's single-writer model. That *can* be made correct, but the invariant lives in application code and is one forgotten transaction away from being violated.
- ❌ No native date/time type; timestamps are TEXT/INTEGER, and there is no time zone support in core — D-3 handling is entirely on the application. (A third-party extension, `sqlite-jiff`, exists for tz/DST arithmetic, which underlines that core lacks it.)
- ❌ Single writer serialises all booking creation. Fine at this scale, but it converts a data-integrity guarantee into a deployment assumption (one process, one file, no horizontal scale).

### 2.3 MySQL / MariaDB

- ❌ No exclusion constraints and no range types. Overlap prevention requires `SELECT ... FOR UPDATE` on a resource row (or a resource-level advisory lock) plus an application check — more moving parts than Postgres for strictly less guarantee.
- ⚠️ `TIMESTAMP` vs `DATETIME` semantics differ in tz handling; DST edge cases are a known sharp edge for D-3.
- ✅ Widely operated, plenty of hosting.

### 2.4 MongoDB

- ❌ Cannot express D-1 as a constraint at all. A unique index cannot encode "ranges must not overlap". You would need transactions plus an application-level guard, or a slot-bucketing hack that contradicts FS-01's "free-form time range" model and open question 1.
- ❌ Relational shape is a poor fit: `resource`, `person`, `booking` with two person references (`booked by`, `booked for`) and referential integrity is exactly what a relational store is for.
- ⚠️ No schema-level enforcement of FS-02's required-field set.

### 2.5 Verdict — database

| Criterion (weight) | PostgreSQL | SQLite | MySQL | MongoDB |
|---|---|---|---|---|
| D-1 overlap invariant enforced by the store | **✅ declarative** | ❌ app-level | ❌ app-level | ❌ not expressible |
| D-2 back-to-back correct by construction | **✅ `[)` ranges** | ❌ hand-rolled | ❌ hand-rolled | ❌ hand-rolled |
| D-1 under concurrency (AC-14) | **✅ constraint** | ⚠️ single-writer | ⚠️ row locks | ⚠️ txn + guard |
| Conflict detail for FR-3 message | **✅ in error DETAIL** | ❌ extra query | ❌ extra query | ❌ extra query |
| D-3 time/DST support | **✅ `timestamptz`** | ❌ none in core | ⚠️ quirky | ⚠️ UTC only |
| D-5 filtered schedule queries | ✅ | ✅ | ✅ | ⚠️ |
| D-7 operational simplicity | ⚠️ needs a server (Docker/managed) | **✅ file** | ⚠️ server | ⚠️ server |

**Recommendation: PostgreSQL** (16+; 18 docs cited). It is the only candidate that turns FS-03 from *code you must not get wrong* into *a schema line that cannot be violated*. The one cost — running a server — is neutralised by Docker Compose locally and any managed Postgres in production.

> If a zero-infrastructure start is required, SQLite is a defensible *interim* choice, but only with the clash check inside `BEGIN IMMEDIATE` and an explicit migration path recorded in the ADR. Postgres-first avoids paying for that twice.

---

## 3. Backend language / framework

All four candidates can serve JSON REST. They separate on D-3 (DST rejection), D-6 (structured errors), and D-7 (delivery speed).

### 3.1 Node.js + Express

- ✅ Minimal, unopinionated; matches the existing `backend-dev` skill, which already specifies Express 4 as a JSON REST API with `dotenv`, `PORT`, `CORS_ORIGIN`, and a JSON-only response contract.
- ✅ Error middleware maps cleanly to the spec's error taxonomy (D-6): 400 validation, 404 missing, **409 clash**, 500 unexpected:
  ```javascript
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: 'Validation failed', fields: err.fields });
    }
    next(err);
  });
  ```
  — [Express, error handling](https://github.com/expressjs/express)
- ⚠️ Async errors are **not** auto-caught in Express 4 — the docs explicitly warn that a promise rejection must be forwarded with `.catch(next)`. Every booking route touching the DB needs this discipline (Express 5 fixes it).
- ⚠️ Nothing is provided for validation; you bolt on Zod (recommended) or express-validator, and you own the layering.
- ⚠️ D-3 requires a deliberate library choice: `Temporal`/`@js-temporal/polyfill` or Luxon, to detect that a Europe/Berlin local time is ambiguous or non-existent. Plain `Date` silently coerces and will fail AC-5a.

### 3.2 Node.js + NestJS

- ✅ Opinionated structure (modules, DI, pipes, filters) makes D-6 systematic rather than per-route. `ValidationPipe` + DTOs give consistent 400s out of the box; Zod integrates via a small pipe:
  ```typescript
  export class ZodValidationPipe implements PipeTransform {
    constructor(private schema: ZodSchema) {}
    transform(value: unknown) {
      try { return this.schema.parse(value); }
      catch { throw new BadRequestException('Validation failed'); }
    }
  }
  ```
  — [NestJS, pipes](https://docs.nestjs.com/pipes)
- ✅ Global exception filters give one place to translate a Postgres exclusion-constraint violation (`23P01`) into the FS-03 business message — a clean home for D-6.
- ⚠️ Meaningful boilerplate and learning curve for a three-story app (D-7).
- ⚠️ Same `Temporal`/Luxon requirement for D-3.
- ❗ Adopting Nest **contradicts the current `backend-dev` skill**, which forbids introducing new backend frameworks without an ADR-level decision. Choosing Nest requires an explicit ADR superseding that constraint.

### 3.3 Python + FastAPI

- ✅ Strongest *declarative* validation story. Pydantic v2 + `AfterValidator` expresses FS-02's R-1..R-4 as data-level rules rather than imperative checks:
  ```python
  def check_valid_id(id: str):
      if not id.startswith(("isbn-", "imdb-")):
          raise ValueError('Invalid ID format...')
      return id

  @app.get("/items/")
  async def read_items(id: Annotated[str | None, AfterValidator(check_valid_id)] = None): ...
  ```
  — [FastAPI, custom validators](https://fastapi.tiangolo.com/tutorial/query-params-str-validations)
- ✅ Custom `RequestValidationError` handlers give exactly the per-field messages FS-02 §9 requires ("programmatically associated with the input that caused them"):
  ```python
  @app.exception_handler(RequestValidationError)
  async def validation_exception_handler(request, exc: RequestValidationError): ...
  ```
  — [FastAPI, handling errors](https://fastapi.tiangolo.com/tutorial/handling-errors)
- ✅ **Best D-3 story of any candidate**: Python's stdlib `zoneinfo` supports `fold` and `datetime.astimezone` round-trip checks, so "this local time does not exist" and "this local time occurs twice" are detectable with no third-party dependency.
- ✅ Automatic OpenAPI — useful as the frontend/backend contract.
- ❌ Second language in the stack. Splits tooling, CI, and reviewer attention; loses shared types with a TypeScript frontend.

### 3.4 Java + Spring Boot

- ✅ Most mature enterprise story: Bean Validation, `@ControllerAdvice` for D-6, `java.time` with `ZonedDateTime`/`ZoneRules` giving first-class DST ambiguity detection (`getValidOffsets()` → 0 = non-existent, 2 = ambiguous), which is arguably the cleanest D-3 answer available.
- ❌ Heaviest by a wide margin for D-7: build tooling, startup time, boilerplate, and JVM ops for an app with three user stories.
- ❌ Largest deviation from the current repository shape.

### 3.5 Verdict — backend

| Criterion | Express | NestJS | FastAPI | Spring Boot |
|---|---|---|---|---|
| D-3 DST ambiguity detection | ⚠️ lib needed | ⚠️ lib needed | **✅ stdlib `zoneinfo`** | **✅ `ZoneRules`** |
| D-6 structured error contract | ⚠️ manual | **✅ filters + pipes** | **✅ handlers** | ✅ `@ControllerAdvice` |
| Validation ergonomics | ⚠️ bring your own | ✅ DTO/pipes | **✅ Pydantic** | ✅ Bean Validation |
| Async error safety | ❌ manual (v4) | ✅ | ✅ | ✅ |
| One language with frontend | **✅** | **✅** | ❌ | ❌ |
| D-7 delivery speed / low ceremony | **✅** | ⚠️ | ✅ | ❌ |
| Fits existing repo skill/ADR | **✅** | ❌ needs ADR | ❌ | ❌ |

**Recommendation: Node.js + Express (TypeScript) with Zod for validation** and `@js-temporal/polyfill` (or Luxon) for Europe/Berlin DST rules. It is the only option that satisfies D-7 *and* the repo's existing documented architecture, and its two weaknesses are closable by explicit, small choices:

1. Wrap async handlers (or move to Express 5) to eliminate the documented promise-rejection footgun.
2. Encode R-4 as a Zod refinement backed by Temporal, since neither Express nor Postgres rejects ambiguous local times for you.

**Runner-up: NestJS** if the team expects the domain to grow well beyond FS-01..FS-03 — its global filters are the tidiest place to translate Postgres `23P01` into FS-03's business message. Requires an ADR that supersedes the current Express constraint.

**FastAPI** is technically the best fit for the validation- and DST-heavy parts of FS-02, and would be the pick if the team were Python-first. The cost is a polyglot stack.

---

## 4. Frontend framework

D-4 dominates. Every candidate can render a list and a form; they differ in how much accessibility work is built in versus hand-rolled, and in ecosystem depth for the specific widgets this app needs (date navigation, filter comboboxes, a confirmation dialog with focus trap).

The concrete a11y obligations:

- FS-02 §9: required fields exposed to AT; validation errors **announced** and **programmatically associated** with their input; cancellation dialog keyboard-reachable and dismissible.
- FS-03 §9: refusal announced via live region and tied to the time inputs; never colour-alone.
- FS-01 §9: keyboard-operable day navigation and filters; announced empty states; selected day and active filters exposed to AT.

### 4.1 React (+ TypeScript + Vite)

- ✅ Deepest accessible-component ecosystem. **React Aria** provides 50+ components with built-in behaviour, adaptive interactions, and internationalisation — directly covering the dialog, combobox, and date-field needs of FS-02 §6 and FS-01 §6.4. Radix UI and Headless UI are equivalent alternatives.
- ✅ Mature form libraries (React Hook Form) that wire `aria-describedby`/`aria-invalid` and error announcement — i.e. AC-12 — without bespoke plumbing.
- ✅ Largest hiring/knowledge pool; TanStack Query handles FS-01's "data could not be loaded / retry" edge case idiomatically.
- ⚠️ Assembly required: routing, data fetching, and forms are separate choices.
- ✅ Already the presumed direction — the `backend-dev` skill references `docs/adr/ADR-001-react-rest-backend.md` (SPA + REST) and `frontend/src/lib` fetch helpers.

### 4.2 Vue 3

- ✅ Excellent DX, gentle learning curve, official router and state management.
- ⚠️ Accessible-primitive ecosystem is real but thinner and less settled: shadcn-vue and Radix Vue exist, but Radix Vue's Context7 coverage is markedly sparse (3 snippets, benchmark 2.35) versus React Aria's 5,293 — a proxy for documentation maturity when you need exact ARIA semantics for D-4.
- ⚠️ Smaller pool of engineers in most teams.

### 4.3 Angular

- ✅ Batteries included: router, forms (reactive forms map well to FS-02 §6.1 validation state), DI, and Angular Material/CDK with a strong accessibility track record. CDK's `A11yModule` (focus trap, live announcer) directly serves FS-02 §9 and FS-03 §9.
- ✅ Strong typed-forms story for the booking form's validation state.
- ❌ Heaviest framework for a three-view application (D-7); highest ceremony per feature.
- ❌ Largest divergence from the SPA+REST direction already recorded.

### 4.4 SvelteKit

- ✅ Smallest bundles, least boilerplate, very fast to build FS-01's three views. Superforms gives strong form/validation ergonomics.
- ⚠️ Accessible headless-primitive ecosystem is the least mature of the four; the dialog focus-trap and combobox work in FS-02 §6.4 / FS-01 §6.4 is more likely to be hand-written — the exact place D-4 gets violated.
- ⚠️ Full-stack framework: overlaps with the Express backend and blurs the SPA+REST boundary the repo has already chosen.

### 4.5 Verdict — frontend

| Criterion | React | Vue 3 | Angular | SvelteKit |
|---|---|---|---|---|
| D-4 accessible primitives (dialog/combobox/date) | **✅ React Aria, Radix** | ⚠️ thinner | **✅ CDK a11y** | ❌ mostly DIY |
| Form error ↔ input association (AC-12, AC-13) | ✅ RHF | ✅ | ✅ reactive forms | ✅ Superforms |
| D-7 low ceremony | ✅ | **✅** | ❌ | **✅** |
| Fits SPA + REST decision | ✅ | ✅ | ✅ | ⚠️ overlaps backend |
| Ecosystem / hiring | **✅** | ✅ | ✅ | ⚠️ |
| Assembly burden | ⚠️ | ⚠️ | ✅ none | ✅ low |

**Recommendation: React + TypeScript + Vite**, with an accessible headless primitive library (React Aria or Radix) and React Hook Form. It is the only candidate that combines a low-ceremony SPA with a *mature, documented* accessibility primitive layer — and D-4 is a hard acceptance criterion in all three specs, not a nice-to-have.

**Runner-up: Angular** if the team values a single prescribed framework and would use Material/CDK; its a11y tooling is genuinely competitive. The cost is ceremony.

---

## 5. Recommended stack

| Layer | Choice | Decisive reason |
|---|---|---|
| Frontend | **React 19 + TypeScript + Vite**, React Aria/Radix, React Hook Form, TanStack Query | Only low-ceremony option with a mature, documented accessible-primitive layer (D-4) |
| Backend | **Node.js + Express (TypeScript)**, Zod, Temporal/Luxon | Matches the existing documented architecture and skill; one language with the frontend (D-7) |
| Database | **PostgreSQL 16+** with `btree_gist` and `EXCLUDE USING GIST (resource_id WITH =, during WITH &&)` on `tstzrange` | Makes FS-03's invariant unbreakable, including under concurrency (D-1, D-2, AC-14) |

### How the responsibilities split

| Spec rule | Enforced where | Why there |
|---|---|---|
| R-1 end after start, R-2 not in past, R-3 valid purpose | Backend (Zod) | Pure input validation; needs per-field messages for AC-12 |
| **R-4 ambiguous/non-existent local time** | **Backend (Temporal)** | Postgres *coerces* these rather than rejecting; AC-5a demands rejection |
| **FS-03 overlap refusal (AC-1..AC-5, AC-12, AC-14)** | **Database (exclusion constraint)** | Only place that is race-free; app-level checks cannot satisfy AC-14 |
| FS-03 back-to-back acceptance (AC-6, AC-7) | Database (`[)` range) | Correct by construction, no boundary code |
| FR-3 clash message with conflicting range | Backend, translating SQLSTATE `23P01` | Keeps FS-03 §6.1 business language out of the data layer |
| Announcement, focus, association (AC-11, AC-12, AC-13) | Frontend | ARIA live regions, `aria-describedby`, focus trap |

### Open items to settle before the ADR

1. **FS-01 OQ-1 / FS-02 OQ-1 — slot granularity.** Free-form ranges are assumed above; fixed slots would weaken (though not remove) the case for range types.
2. **Auth.** All three specs assume "identified through authenticated access" but none specifies the mechanism. This is an unscoped decision that affects the backend choice more than anything else here.
3. **FS-01 OQ-5 — data freshness.** If real-time updates are required, revisit; the current recommendation assumes refresh-on-view, which plain REST serves.
4. If SQLite is chosen for delivery speed, record the `BEGIN IMMEDIATE` clash-check obligation and the migration trigger explicitly.

---

## 6. Recorded decisions

This comparison has been recorded as three cross-referenced ADRs (one decision per record, per the `adr-writing` skill). All are **proposed** pending team agreement:

| ADR | Decision |
|---|---|
| [ADR-001](./adr/ADR-001-react-typescript-spa.md) | React + TypeScript + Vite as the frontend framework |
| [ADR-002](./adr/ADR-002-express-rest-backend.md) | Node.js + Express + TypeScript for the backend REST API |
| [ADR-003](./adr/ADR-003-postgresql-exclusion-constraint.md) | PostgreSQL with an exclusion constraint enforcing booking non-overlap |

See the [ADR index](./adr/README.md). The open items in §5 above remain unresolved and are not settled by those records.

