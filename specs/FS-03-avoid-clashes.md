# FS-03: Avoid Clashes

## 1. Overview

Two people must never end up holding the same resource at the same time. When a user tries to book a slot that overlaps a booking that already exists on that resource, the booking is refused and the user is told clearly why.

Bookings that merely touch are not a clash. A booking that ends exactly when the next one begins is legitimate and must be accepted, so a resource can be used back-to-back without artificial gaps.

This specification refines the booking creation rules defined in FS-02.

## 2. User Story

**As** someone booking a room or piece of equipment,
**I want** the app to refuse a booking that overlaps an existing one and tell me why,
**so that** two people never turn up expecting the same resource at the same time.

Source: GitHub issue #3 "Avoid clashes" (label: `story`).

## 3. Scope & Boundaries

**In scope**

- Detecting that a proposed booking overlaps an existing booking on the same resource.
- Refusing the proposed booking when it overlaps.
- Permitting back-to-back bookings that touch at a boundary.
- Explaining the refusal clearly to the user.

**Out of scope**

- Suggesting alternative slots or the next free time.
- Waitlists, queuing, or requesting a slot already held.
- Overrides, priority, or bumping an existing booking.
- Conflicts that are not about a single resource — for example, the same person being booked into two resources at once.
- Capacity sharing, where a resource could hold more than one booking at a time.

## 4. Actors & Preconditions

**Actor**

- **Booker** — the person attempting to create a booking, as defined in FS-02.

**Preconditions**

- The user is creating a booking against a specific resource.
- The proposed booking already satisfies the booking validity rules in FS-02 §5; clash checking applies to otherwise-valid bookings.

## 5. Functional Requirements

### FR-1 — Refuse overlapping bookings

- A proposed booking is refused when it overlaps any existing booking on the same resource.
- Two bookings overlap when they share any period of time greater than zero.
- No booking is created when a clash is detected.

### FR-2 — Touching bookings are permitted

- A proposed booking whose **end time equals** the start time of an existing booking is accepted.
- A proposed booking whose **start time equals** the end time of an existing booking is accepted.
- Sharing only a boundary instant is not a clash.

### FR-3 — Explain the refusal

- When a booking is refused for a clash, the user is told that the resource is already booked for that time.
- The message identifies the conflicting time range so the user can pick a different slot.
- The message is expressed in business language, not as a technical or system error.

### FR-4 — Scope of the check

- Clash detection considers only bookings on the **same resource**. Bookings on other resources never conflict.
- Cancelled bookings do not block a new booking; a cancelled slot is free.
- The proposed booking is not compared against itself.

### FR-5 — Check at submission

- The clash check is applied at the moment the booking is submitted, against the bookings that exist at that moment.
- A slot that was free when the user opened the form but taken by the time they submit is refused.
- When competing submissions request overlapping time on the same resource, the first submission confirmed by the system succeeds; each later competing submission is refused as a clash.

## 6. UI Specification

No new views are introduced. This specification adds behaviour to the booking form described in FS-02 §6.1.

### 6.1 Clash message

- Shown on the booking form when a submission is refused for a clash.
- States that the resource is already booked for the requested time.
- Identifies the conflicting time range.
- Is presented alongside the time inputs, since those are what the user must change.

### 6.2 Form behaviour on refusal

- The booking form remains open.
- The values the user entered are preserved so they only need to adjust the times.
- No booking is created, and no partial or draft record is left behind.

## 7. State & Data

This specification introduces no new data entity. It constrains which Booking records, as defined in FS-02 §7, may exist together.

### Overlap rule

For two bookings on the same resource, with the proposed booking running from **P-start** to **P-end** and an existing booking from **E-start** to **E-end**:

- They **clash** when `P-start` is earlier than `E-end` **and** `P-end` is later than `E-start`.
- They **do not clash** when `P-end` equals `E-start`, or when `P-start` equals `E-end`.

Stated plainly: any shared time is a clash; a shared boundary is not.

### Invariant

At any moment, no two active bookings on the same resource share any period of time.

## 8. Interaction Flows

### Flow A — Clashing booking is refused

1. User completes the booking form for a resource and time range.
2. User submits.
3. The system finds an existing booking on that resource sharing time with the proposal.
4. The booking is refused and the clash is explained, naming the conflicting time range.
5. The form stays open with the entered values intact.
6. User adjusts the times and resubmits.
7. With no remaining clash, the booking is created and confirmed.

### Flow B — Back-to-back booking is accepted

1. An existing booking on the resource runs until a given time.
2. User creates a booking on the same resource starting exactly at that time.
3. The system detects no shared time.
4. The booking is created and confirmed.

### Flow C — Slot taken while the form was open

1. User opens the booking form for a slot that is currently free.
2. Another booking is created for that slot before the user submits.
3. User submits.
4. The clash is detected at submission and the booking is refused with the clash explanation.
5. User adjusts the times and resubmits.

## 9. Accessibility

- The clash refusal is announced when it appears, not conveyed only by a visual change.
- The message is programmatically associated with the time inputs the user must change.
- The refusal states the problem and the conflicting time range in plain language, so the user knows what to change without inspecting the schedule.
- Refused state is never indicated by colour alone.

## 10. Edge Cases & Error Handling

| Situation | Expected behaviour |
| --- | --- |
| Proposed range is identical to an existing booking | Refused as a clash. |
| Proposed range sits entirely inside an existing booking | Refused as a clash. |
| Proposed range entirely contains an existing booking | Refused as a clash. |
| Proposed range starts during an existing booking and ends after it | Refused as a clash. |
| Proposed range starts before an existing booking and ends during it | Refused as a clash. |
| Proposed end equals an existing start | Accepted; back-to-back is not a clash. |
| Proposed start equals an existing end | Accepted; back-to-back is not a clash. |
| Proposed range clashes with several existing bookings | Refused; the user is told the slot is unavailable and given at least one conflicting range. |
| Proposed range overlaps a booking that has been cancelled | Accepted; cancelled bookings do not reserve time. |
| Proposed range overlaps a booking on a different resource | Accepted; resources are independent. |
| Slot becomes taken between opening the form and submitting | Refused at submission with the clash explanation. |
| Overlapping submissions are made at the same time | The first submission confirmed by the system is created; every later submission is refused with the clash explanation. |
| Existing bookings cannot be checked | Booking is not created; the user is told availability could not be confirmed and can retry. |

## 11. Acceptance Criteria

**AC-1** Given an existing booking on a resource, when the user submits a booking on the same resource for the identical time range, then the booking is refused and the user is told the resource is already booked.

**AC-2** Given an existing booking, when the user submits a booking wholly inside that booking's time range, then it is refused.

**AC-3** Given an existing booking, when the user submits a booking that wholly contains that booking's time range, then it is refused.

**AC-4** Given an existing booking, when the user submits a booking that starts during it and ends after it, then it is refused.

**AC-5** Given an existing booking, when the user submits a booking that starts before it and ends during it, then it is refused.

**AC-6** Given an existing booking that starts at a given time, when the user submits a booking on the same resource ending exactly at that time, then the booking is created.

**AC-7** Given an existing booking that ends at a given time, when the user submits a booking on the same resource starting exactly at that time, then the booking is created.

**AC-8** Given a booking is refused for a clash, then the refusal message identifies the conflicting time range and no booking is created.

**AC-9** Given a booking is refused for a clash, then the form retains the values the user entered.

**AC-10** Given a booking on a resource was cancelled, when the user submits a booking for that same time and resource, then the booking is created.

**AC-11** Given a booking exists on one resource, when the user submits a booking for the same time on a different resource, then the booking is created.

**AC-12** Given a slot was free when the form was opened but taken before submission, when the user submits, then the booking is refused with the clash explanation.

**AC-13** Given a clash refusal is shown, when the user navigates by keyboard or uses assistive technology, then the refusal is announced and associated with the time inputs.

**AC-14** Given competing submissions request overlapping time on the same resource, when the system confirms one submission first, then that booking is created and each later competing submission is refused with the clash explanation.

## 12. Dependencies & Open Questions

### Resolved by this specification

- **FS-02 §12, open question 1 — double-booking.** Now settled: overlapping bookings on the same resource are refused, and touching bookings are permitted. FS-01 §10 and FS-02 have been updated to match.

### Assumptions

- A resource can hold only one booking at a time; there is no notion of shared capacity within a single resource.
- Cancelled bookings release their time immediately.
- Clash detection is not affected by the booking creator or the person the booking is for; two bookings for the same person on the same resource clash exactly as any others would.
- Booking records are created through the booking flow in FS-02; importing booking records is not permitted.

### Open questions

1. **Naming the holder** — Should the refusal message say who holds the conflicting booking, or only the time range? Revealing the person may be unwanted; the story requires only that the refusal is clear.
2. **Purpose of the conflicting booking** — Similarly, should the conflicting booking's purpose be shown to help the user judge whether to ask for the slot?
3. **Overrides** — Is there any circumstance in which a user may take a slot that is already held, for example a privileged role? The story implies none.
4. **Shared equipment capacity** — Are all pieces of equipment exclusive, or could an item exist in multiples that several people could book at once?
5. **Cross-resource conflicts** — Should the app warn when the same person is booked into two resources at overlapping times? Out of scope here, but plausible as a later refinement.

### Dependencies

- Depends on FS-02 for the booking creation flow, the booking form, and the validity rules that run before clash detection.
- Depends on FS-01 for the availability views the user consults to pick a slot; those views and this rule must agree on what counts as free.

