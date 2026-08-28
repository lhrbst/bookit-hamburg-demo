# FS-02: Book a Room

## 1. Overview

Once a user has found an open slot, they need to claim it. This feature lets a user reserve a room or a piece of shared equipment for a time range, recording who made the booking, who it is for, and what it is for, and lets them cancel a booking they made.

FS-01 covers discovering availability. This specification covers acting on it: creating and cancelling bookings, and the rules that govern a valid booking.

## 2. User Story

**As** someone who needs a room or shared equipment,
**I want** to book it for a time slot and cancel bookings I made,
**so that** I can secure the resource when I need it and release it when I don't.

Source: GitHub issue #2 "Book a room" (label: `story`).

## 3. Scope & Boundaries

**In scope**

- Creating a booking for a resource with a person, a purpose, a start time, and an end time.
- Validating that a booking is legal: end after start and not in the past.
- Cancelling a booking the user made.
- Presenting and accepting all times in the team's local time.

**Out of scope**

- Editing an existing booking in place (see open question 7).
- Recurring or repeating bookings.
- Booking approval, moderation, or waitlists.
- Creating, editing, or removing resources.
- Notifications, reminders, or calendar system integration.
- Availability browsing and filtering — specified in FS-01.

## 4. Actors & Preconditions

**Actor**

- **Booker** — the authenticated person creating or cancelling a booking. The application identifies the current person through authenticated access. The story defines no additional roles or permission levels.

**Preconditions**

- At least one bookable resource exists.
- The booker has identified the resource and the time slot they want, typically via the availability views in FS-01.

## 5. Functional Requirements

### FR-1 — Create a booking

- The user can create a booking against a selected resource.
- A booking captures:
  - **Booked by** — the identified person from the maintained set of people who creates the booking.
  - **Booked for** — the person from the maintained set of people the booking is for.
  - **Purpose** — a required predefined category describing what the booking is for.
  - **Start date and time** — when the booking begins.
  - **End date and time** — when the booking ends.
- On successful creation the user receives clear confirmation that the booking exists.

### FR-2 — Booking validity rules

A booking is only accepted when all of the following hold:

- **R-1 — End after start:** the end time is strictly later than the start time. Equal start and end times are rejected.
- **R-2 — Not in the past:** the booking does not start in the past.
- **R-3 — Valid purpose:** the purpose is one of the predefined categories configured for the application.
- **R-4 — Valid local times:** the start and end must each be an unambiguous time that occurs in the Europe/Berlin time zone. A time that occurs twice, or does not occur because of a daylight-saving clock change, is rejected.

When a rule is violated the user is told which rule failed, in business language, and the booking is not created.

### FR-3 — Cancel a booking

- The user can cancel a booking they made.
- The cancel action is offered only when the identified current person is the booking's creator.
- Cancellation is confirmed before it takes effect, because it is not reversible.
- After cancellation the slot is no longer occupied and the resource shows as free for that time.
- The user receives clear confirmation that the cancellation succeeded.

### FR-4 — Local time

- All times are entered and displayed in the team's single local time: the Europe/Berlin time zone.
- No time zone selection is offered to the user, and no time zone conversion is exposed.

### FR-5 — Visibility of bookings

- A created booking appears in the resource schedule and the today overview described in FS-01.
- A cancelled booking no longer appears in those views.

## 6. UI Specification

The feature is expressed through the following user-facing elements. Layout, styling, and component choices are deliberately not prescribed.

### 6.1 Booking form

- Identifies the resource being booked.
- Identifies the booking creator as the current person and captures: booked for, purpose, start date and time, end date and time.
- Indicates which inputs are required.
- Offers a clear action to submit and a way to abandon without creating a booking.
- Shows validation messages next to the input that caused them.

### 6.2 Booking confirmation

- Confirms the booking was created.
- Restates the resource, the booking's date and time range, who made it, who it is for, and what it is for.

### 6.3 Booking detail with cancel action

- Shows an existing booking's resource, date and time range, booking creator, booked-for person, and purpose.
- Offers a cancel action when the user is permitted to cancel that booking.

### 6.4 Cancellation confirmation

- Asks the user to confirm before the booking is removed.
- Identifies the booking being cancelled so the user cannot confirm the wrong one.
- Allows the user to back out without cancelling.

## 7. State & Data

### Booking

This specification defines the authoritative field set for a booking. It extends the read-side view described in FS-01 §7.

| Field | Description | Required |
| --- | --- | --- |
| Resource | The room or equipment being booked. | Yes |
| Booked by | The identified person from the maintained set of people who creates the booking. | Yes |
| Booked for | The person from the maintained set of people the booking is for. | Yes |
| Purpose | A predefined category describing what the booking is for. | Yes |
| Start date and time | When the booking begins. | Yes |
| End date and time | When the booking ends, later than start. | Yes |

### View state

- **Selected resource** — the resource the booking form applies to.
- **Draft booking** — the values entered but not yet submitted.
- **Validation state** — which rules currently fail and the messages shown for them.

## 8. Interaction Flows

### Flow A — Book a resource

1. User views a resource's availability and identifies an open slot (FS-01).
2. User starts a booking for that resource.
3. User enters who is making the booking, who it is for, what it is for, and the start and end times.
4. User submits.
5. The system validates the booking against the booking validity rules.
6. On success, the booking is created and confirmed, and it becomes visible in the availability views.
7. On failure, the user is told which rule failed and can correct the input and resubmit.

### Flow B — Cancel a booking

1. User locates a booking they made.
2. User chooses to cancel it.
3. The system asks for confirmation and identifies the booking.
4. User confirms.
5. The booking is removed, the slot becomes free, and the user is told the cancellation succeeded.

### Flow C — Abandon a draft

1. User starts a booking and enters some details.
2. User decides not to proceed and leaves the form.
3. No booking is created.

## 9. Accessibility

- The booking form is fully operable by keyboard, including time entry and submission.
- Required inputs are identified to assistive technology, not by visual marker alone.
- Validation errors are announced when they appear and are programmatically associated with the input that caused them.
- Error messages state what is wrong and how to fix it, in plain language.
- Confirmation of a created or cancelled booking is announced, not conveyed only by a visual change.
- The cancellation confirmation is keyboard-reachable, clearly identifies the booking, and can be dismissed without cancelling.

## 10. Edge Cases & Error Handling

| Situation | Expected behaviour |
| --- | --- |
| End time earlier than start time | Booking rejected; user told the end must be after the start. |
| End time equal to start time | Booking rejected; a booking must have a duration. |
| Start time in the past | Booking rejected; user told bookings cannot be made in the past. |
| Start or end is a local time that occurs twice because clocks move back | Booking rejected; user is told to choose a different, unambiguous local time. |
| Start or end is a local time that does not occur because clocks move forward | Booking rejected; user is told to choose a valid local time. |
| Booking crosses midnight | Booking is accepted if it meets all booking validity and clash rules. |
| Required field left empty | Booking rejected; the missing field is identified. |
| Purpose is not an available category | Booking rejected; the user is told to select an available purpose. |
| Slot was taken while the user was filling the form | Booking refused at submission; user is told the slot is no longer available and can choose another. See FS-03. |
| Proposed booking overlaps an existing booking on the same resource | Booking refused with a clear explanation. Specified in FS-03. |
| Proposed booking begins exactly when another ends | Accepted; back-to-back bookings are legitimate. See FS-03. |
| Booking already cancelled or no longer exists | User is told the booking is gone; no error state is left on screen. |
| User attempts to cancel a booking they did not make | The cancel action is not offered. |
| Booking cannot be saved | User is told the booking was not created, their entered values are preserved, and they can retry. |
| Cancellation cannot be completed | User is told the booking is still active and can retry. |
| Current time passes the start time while the form is open | Validation is applied at submission, so the stale booking is rejected with the past-booking message. |

## 11. Acceptance Criteria

**AC-1** Given a resource is selected, when the user submits a booking with a booking creator, a booked-for person, a purpose, and a valid start and end time, then the booking is created and confirmed.

**AC-2** Given a booking has been created, when the user views the resource schedule or today overview, then the booking appears there.

**AC-3** Given the end time is earlier than the start time, when the user submits, then the booking is rejected and the user is told the end must be after the start.

**AC-4** Given the end time equals the start time, when the user submits, then the booking is rejected.

**AC-5** Given the start time is in the past, when the user submits, then the booking is rejected and the user is told bookings cannot be made in the past.

**AC-5a** Given a submitted start or end time is ambiguous or does not occur in the Europe/Berlin time zone because of a daylight-saving clock change, then the booking is rejected and the user is told to choose a valid, unambiguous local time.

**AC-6** Given the start and end fall on different calendar days, when the user submits, then the booking may be created if it meets all booking validity and clash rules.

**AC-7** Given a required field is empty, when the user submits, then the booking is rejected and the empty field is identified.

**AC-8** Given a booking the user made, when the user cancels it and confirms, then the booking is removed and the user is told the cancellation succeeded.

**AC-9** Given a booking has been cancelled, when the user views the resource schedule, then the slot is shown as free and the booking is absent.

**AC-10** Given the user starts a cancellation, when they back out of the confirmation, then the booking remains unchanged.

**AC-11** Given any time is shown or entered, then it is expressed in the team's local time with no time zone choice presented.

**AC-12** Given the user navigates by keyboard only, then the booking form, submission, and cancellation confirmation are all reachable and operable, and validation errors are announced.

## 12. Dependencies & Open Questions

### Assumptions

- A booking occupies a contiguous time range and may span calendar days.
- "The team's local time" is the Europe/Berlin time zone for all users; no per-user time zone exists.
- Booked-by and booked-for people are selected from a maintained set of people.
- The booking creator is the identified current person at the time the booking is created.
- Purpose is selected from a predefined set of categories configured for the application. The configured set is fixed for a deployed application and is not changed by users during normal use.
- Cancellation removes the booking outright rather than marking it cancelled but visible.
- "Not in the past" is evaluated against the booking's start time at the moment of submission.

### Resolved since drafting

- **Double-booking** — Resolved by FS-03: a booking that overlaps an existing one on the same resource is refused with a clear explanation, while back-to-back bookings that merely touch are accepted. FS-01 §10 has been updated to match.

### Open questions

1. **Duration limits** — Is there a minimum or maximum booking length, and must start and end align to fixed increments? This must agree with the slot granularity question raised in FS-01 §12.
2. **Cancelling past or in-progress bookings** — May a user cancel a booking that has already started or already finished?
3. **Editing** — Is changing an existing booking expected, or is cancel-and-rebook the intended path?
4. **Bookable window** — Is there a limit on how far ahead a booking may be made?

### Dependencies

- Depends on FS-01 for resource data and for the availability views in which bookings become visible.
- FS-03 extends the validity rules in §5 with clash detection; a booking must satisfy the rules here before FS-03's overlap check applies.
- FS-01 §7 describes the booking fields from a read-only perspective; this specification is the authoritative source for the booking's field set and validity rules. FS-01 should be revisited if open question 2 ("booked for") changes that shape.

