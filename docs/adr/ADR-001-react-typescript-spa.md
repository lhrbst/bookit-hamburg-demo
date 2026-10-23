# ADR-001: Use React with TypeScript and Vite as the frontend framework

**Status:** proposed
**Date:** 2026-08-28
**Deciders:** Momme Ristow

## Context

FS-01, FS-02, and FS-03 each make accessibility a binding acceptance criterion rather than a quality aspiration: validation errors must be *announced* and *programmatically associated* with the input that caused them (FS-02 AC-12), the clash refusal must be announced and tied to the time inputs (FS-03 AC-13), and day navigation, filters, and the cancellation dialog must be fully keyboard-operable (FS-01 AC-11, FS-02 §9). Concretely this requires a combobox, a date field, a live region, and a modal dialog with a focus trap — the four widgets that are hardest to build correctly by hand. The application itself is small: three views, a form, and read-heavy filtered lists, so framework ceremony is a real cost.

## Decision

Build the frontend as a single-page application using React with TypeScript and Vite, composed with an accessible headless primitive library (React Aria or Radix UI) and React Hook Form for form state and error wiring.

## Consequences

### Positive

- The accessibility acceptance criteria are met by adopting audited primitives rather than hand-writing ARIA semantics, which is where AC-11/AC-12/AC-13 would most plausibly be failed.
- React Hook Form wires `aria-invalid` and `aria-describedby` between an input and its error message as a matter of course, so FS-02 §9's "programmatically associated" requirement falls out of normal usage.
- TypeScript is shared with the backend (ADR-002), giving one language, one toolchain, and the option of sharing request/response types.
- TanStack Query provides idiomatic handling for FS-01's "booking data cannot be loaded — inform and allow retry" edge case and FS-03's "existing bookings cannot be checked" case.
- Largest hiring and knowledge pool of the candidates, and the deepest supply of worked accessibility examples.

### Negative

- React is unopinionated: routing, data fetching, and form handling are each a separate choice the team must make and keep coherent. Angular would have supplied all three.
- The accessibility guarantee is delegated to a third-party primitive library, creating a dependency on its maintenance and a constraint that custom components must be built on those primitives rather than from scratch.
- No framework-level structure means conventions must be enforced by review rather than by the framework.

## Rejected Alternatives

### Option: Angular

**Reason rejected:** Genuinely competitive on the decisive criterion — the Material CDK's `A11yModule` supplies focus trapping and a live announcer, and reactive forms model FS-02 §6.1's validation state well. Rejected on cost, not capability: it is the heaviest framework of the four for an application with three views, and its ceremony per feature is the highest.

### Option: Vue 3

**Reason rejected:** The accessible headless-primitive ecosystem is materially less mature. Radix Vue's published documentation coverage is sparse (3 indexed snippets) against React Aria's 5,293 — a poor position to be in when the exact ARIA semantics of a combobox or dialog are a stated acceptance criterion rather than a detail.

### Option: SvelteKit

**Reason rejected:** Two independent reasons. Its accessible-primitive ecosystem is the least mature of the four, so the dialog focus trap and filter combobox in FS-01 §6.4 and FS-02 §6.4 would likely be hand-written — precisely where the accessibility criteria get violated. Separately, it is a full-stack framework whose server half overlaps and blurs the SPA-plus-REST boundary established in ADR-002.

## Related

- [ADR-002: Use Node.js with Express and TypeScript for the backend REST API](./ADR-002-express-rest-backend.md) — establishes the REST contract this SPA consumes, and shares the TypeScript toolchain
- [ADR-003: Use PostgreSQL with an exclusion constraint to enforce booking non-overlap](./ADR-003-postgresql-exclusion-constraint.md) — the clash refusal this frontend must announce originates there
- [Technology comparison](../tech-stack-comparison.md) — full candidate evaluation behind this decision

