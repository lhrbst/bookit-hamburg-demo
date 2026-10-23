# Architecture Decision Records

Records of significant architectural and technology decisions for BookIt Hamburg,
capturing **why** each choice was made. Format follows the `adr-writing` skill.

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-001](./ADR-001-react-typescript-spa.md) | Use React with TypeScript and Vite as the frontend framework | proposed | 2026-08-28 |
| [ADR-002](./ADR-002-express-rest-backend.md) | Use Node.js with Express and TypeScript for the backend REST API | proposed | 2026-08-28 |
| [ADR-003](./ADR-003-postgresql-exclusion-constraint.md) | Use PostgreSQL with an exclusion constraint to enforce booking non-overlap | proposed | 2026-08-28 |

## Status lifecycle

```
proposed → accepted → deprecated
                   ↘ superseded by ADR-NNN
```

All three records above are **proposed**: they document the recommendation from the
[technology comparison](../tech-stack-comparison.md) but have not yet been agreed by the team.
Move them to `accepted` once confirmed.

## Reading order

ADR-003 is the load-bearing decision. FS-03's non-overlap invariant under concurrent
submission (AC-14) is what makes PostgreSQL's exclusion constraint decisive, and that in
turn shapes what ADR-002's backend must and must not enforce. Read 003 first, then 002,
then 001.

## Cross-cutting note

ADR-003 deliberately does **not** discharge FS-02 R-4 (rejecting ambiguous or non-existent
Europe/Berlin local times). PostgreSQL coerces those values rather than rejecting them, so
that rule lives in the backend per ADR-002. This split is the single easiest thing to get
wrong when implementing FS-02.

