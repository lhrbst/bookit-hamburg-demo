# ADR Writing — When to Write an ADR

## Write an ADR when

- A technology or framework is chosen for a new capability (database, auth library, messaging system)
- An architectural pattern is adopted project-wide (CQRS, event sourcing, hexagonal architecture)
- A significant trade-off is accepted (e.g. consistency over availability, monolith over microservices)
- A previous decision is reversed or superseded
- A third-party service or vendor is locked in
- A security model is defined (auth strategy, data encryption approach)
- A team convention is made permanent (API versioning strategy, error format)

## Do NOT write an ADR for

- Implementation details that can be understood from the code itself
- Routine library version bumps (unless a major version with breaking changes)
- Decisions that are easily reversible with low cost
- Personal preferences without team agreement

## Threshold Test

Ask: *"If a new senior engineer joins in 6 months, would they ask 'why did we do this?'"*

- Yes → write the ADR
- No → the code or a comment is sufficient

## Status Lifecycle

```
proposed → accepted → deprecated
                   ↘ superseded by ADR-NNN
```

- **Proposed:** decision is under discussion; not yet binding
- **Accepted:** team agreed; binding for new work
- **Deprecated:** still in place but no longer recommended for new work
- **Superseded:** replaced by a newer ADR (always link the replacement)

## Numbering

- Use sequential integers: `ADR-001`, `ADR-002`, …
- Never reuse a number, even if an ADR is deprecated or superseded
- Keep a `docs/adr/README.md` index table: `| ADR-NNN | Title | Status | Date |`
