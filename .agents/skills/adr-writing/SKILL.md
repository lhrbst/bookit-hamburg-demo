---
name: "adr-writing"
description: "Write Architecture Decision Records (ADRs) that capture why a decision was made, not just what. Activate when the user makes a technology choice, rejects an alternative, accepts a significant trade-off, or asks to document an architecture decision."
---

# ADR Writing

Use this skill when a significant architectural or technology decision needs to be documented for future contributors.

## Read First

- [ADR template](./references/adr-template.md) — standard format with all sections
- [When to write an ADR](./references/when-to-write.md) — decision types that warrant an ADR; anti-patterns

## Workflow

1. **Confirm it warrants an ADR** — see [when to write](./references/when-to-write.md)
2. **Assign number and status** — `ADR-NNN`, status: `proposed | accepted | deprecated | superseded`
3. **Fill all required sections** — Context, Decision, Consequences (positive + negative)
4. **List rejected alternatives** — with the reason each was rejected
5. **Save** to `docs/adr/ADR-NNN-<slug>.md`

## Core Rules

- **Why, not what** — the codebase shows what was done; the ADR explains why
- **One decision per ADR** — if two decisions are linked, write two ADRs and cross-reference
- Status `accepted` means the team agreed; `proposed` means still under discussion
- Consequences section must list **both** positive and negative outcomes — no ADR has only upsides
- Rejected alternatives are mandatory: future readers need to know what was considered

## Done When

- [ ] All five sections present: Title, Status, Context, Decision, Consequences
- [ ] At least one rejected alternative with reason documented
- [ ] Saved as `docs/adr/ADR-NNN-<slug>.md`
- [ ] Linked from `docs/adr/README.md` index (if project maintains one)
- [ ] Cross-references added if this supersedes or relates to another ADR
