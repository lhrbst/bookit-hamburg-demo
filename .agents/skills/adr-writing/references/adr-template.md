# ADR Template

Save as `docs/adr/ADR-NNN-<short-slug>.md`. Replace all `<placeholders>`.

---

```markdown
# ADR-NNN: <Title — one sentence describing the decision>

**Status:** proposed | accepted | deprecated | superseded by [ADR-NNN](./ADR-NNN-<slug>.md)
**Date:** YYYY-MM-DD
**Deciders:** <names or team>

## Context

<2–4 sentences. What situation, constraint, or requirement drove this decision?
What problem were we solving? What was the state of the system at the time?>

## Decision

<1–3 sentences. What did we decide to do? State it clearly and directly.
Avoid explaining why here — that belongs in Consequences.>

## Consequences

### Positive
- <outcome that improves the system or team velocity>
- <outcome that reduces risk or complexity>

### Negative
- <trade-off accepted; what we give up>
- <new constraint or maintenance burden introduced>

## Rejected Alternatives

### Option: <Name>
**Reason rejected:** <Why this was not chosen. Be specific — "not good enough" is not a reason.>

### Option: <Name>
**Reason rejected:** <Why this was not chosen.>

## Related

- [ADR-NNN: <title>](./ADR-NNN-<slug>.md) — <how it relates>
```

---

## Filed Example

```markdown
# ADR-007: Use PostgreSQL as the primary datastore

**Status:** accepted
**Date:** 2025-03-14
**Deciders:** Backend team

## Context

The platform needs a relational datastore for the PGK domain model.
Data has complex relationships (users, orders, items, audit logs) and requires
ACID transactions for financial operations. The team has strong PostgreSQL experience.

## Decision

Use PostgreSQL 16 as the sole relational datastore for all persistent domain data.

## Consequences

### Positive
- ACID guarantees for financial transactions
- Strong JSON support (jsonb) for semi-structured config data
- Team expertise — no learning curve
- Excellent Kubernetes operator support (CloudNativePG)

### Negative
- Horizontal write scaling requires sharding (not needed at current scale)
- Adds infrastructure dependency vs. embedded DB options

## Rejected Alternatives

### Option: MySQL 8
**Reason rejected:** Weaker JSON support; team has no operational experience.

### Option: MongoDB
**Reason rejected:** Document model doesn't fit the relational domain; loses ACID
guarantees needed for financial data.

## Related

- [ADR-008: Use CloudNativePG operator for PostgreSQL on Kubernetes](./ADR-008-cloudnativepg.md)
```
