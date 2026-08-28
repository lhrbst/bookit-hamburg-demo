# FS-01: See What's Free

## 1. Overview

Users need to know when a room or piece of shared equipment is available before they commit to booking it. This feature lets a user browse all bookable resources, inspect a single resource's bookings for a chosen day, narrow the schedule down by resource, day, or the person who booked, and see everything that is booked today in one place.

This specification covers discovery and visibility of availability only. Creating, changing, or cancelling a booking is out of scope.

## 2. User Story

**As** someone who needs a room or shared equipment,
**I want** to see when a resource is already booked and when it is free,
**so that** I can identify an open slot before I try to book it.

Source: GitHub issue #1 "See what's free" (label: `story`).

## 3. Scope & Boundaries

**In scope**

- Browsing the list of bookable resources (rooms and shared equipment).
- Viewing the bookings of a single resource for a chosen day.
- Filtering the schedule by resource, by day, and by the person who booked.
- A combined view of all bookings across all resources for the current day.

**Out of scope**

- Creating, editing, or cancelling bookings.
- Creating, editing, or removing resources.
- Recurring bookings, booking approval, or conflict resolution.
- Notifications, reminders, or calendar system integration.
- Reporting or utilisation analytics.

## 4. Actors & Preconditions

**Actor**

- **Viewer** — any person using the application to check availability. No distinct roles or permission levels are defined by this story.

**Preconditions**

- At least one bookable resource exists in the system.
- Bookings, where they exist, are associated with a resource, a time range, and people selected from the maintained set of people for both the booking creator and the person the booking is for.

## 5. Functional Requirements

### FR-1 — Browse bookable resources

- The system lists all bookable resources.
- Each resource is shown with its **name** and a **short description** (for example, how many people a room seats).
- Rooms and shared equipment both appear as bookable resources.
- Selecting a resource leads to that resource's schedule.

### FR-2 — View a resource's bookings for a chosen day

- The user can view the bookings of a single resource for one selected day.
- Each booking entry shows its **time range**, **who made the booking**, and **who the booking is for**.
- The schedule covers the full 24 hours of the selected calendar day.
- A booking that spans calendar days appears on every daily schedule it overlaps, showing the portion that occupies that day.
- Bookings are presented in chronological order, with every unbooked period shown explicitly as free, including before the first booking, between bookings, and after the last booking.
- The user can move to a different day without leaving the view.

### FR-3 — Narrow the schedule

The user can restrict the bookings shown by any combination of:

- **Resource** — on the today overview, limit the schedule to one selected resource.
- **Day** — limit the schedule to a selected day.
- **Booked by** — limit the schedule to bookings made by a selected person.
- **Booked for** — limit the schedule to bookings for a selected person.

Rules:

- Filters combine additively; only bookings matching all active filters are shown.
- A resource schedule always shows its selected resource only; its resource is not changed by filtering.
- The currently active filters are visible to the user.
- The user can clear filters and return to the unfiltered view.

### FR-4 — Today overview

- A single view shows every booking across all resources for the current day.
- Each entry identifies the **resource**, the **time range**, **who made the booking**, and **who the booking is for**.
- Entries are ordered so the day can be scanned in sequence.
- This view is reachable directly, without first selecting a resource.

## 6. UI Specification

The feature is expressed through three user-facing views. Layout, styling, and component choices are deliberately not prescribed.

### 6.1 Resource list

- Shows all bookable resources.
- Per resource: name, short description.
- Each entry is selectable and navigates to the resource schedule.

### 6.2 Resource schedule (single resource, single day)

- Identifies the resource being viewed and the day being viewed.
- Covers the full 24 hours of the day and shows booked and free periods in chronological order.
- Each booking shows its time range, who made the booking, and who the booking is for.
- Offers day navigation (move to another day).
- Communicates clearly when the resource has no bookings on the selected day.

### 6.3 Today overview

- Identifies itself as showing the current day.
- Lists all bookings for today across all resources, each with resource, time range, who made the booking, and who the booking is for.

### 6.4 Filter controls

- On the resource schedule, allow selection by day, booked by, and booked for; the resource remains the selected resource.
- On the today overview, allow selection by resource, booked by, and booked for; at most one resource can be selected.
- Show which filters are currently active and allow them to be cleared.

## 7. State & Data

### Resource

| Field | Description |
| --- | --- |
| Name | Human-readable identifier of the room or equipment. |
| Type | Whether the resource is a room or shared equipment. |
| Description | Short descriptive text, e.g. seating capacity for a room. |

### Booking

| Field | Description |
| --- | --- |
| Resource | The resource the booking applies to. |
| Time range | The booking's start and end date and time. |
| Booked by | The person from the maintained set of people who created the booking. |
| Booked for | The person from the maintained set of people the booking is for. |

### View state

- **Selected resource** — which resource's schedule is being viewed.
- **Selected day** — defaults to the current day.
- **Active filters** — resource, day, and booker selections currently applied.

All data shown by this feature is read-only.

## 8. Interaction Flows

### Flow A — Find an open slot for a specific resource

1. User opens the resource list.
2. User reads names and descriptions to identify a suitable resource.
3. User selects the resource.
4. The resource schedule opens for the current day.
5. User reads the explicitly shown free periods and identifies an open slot.
6. If nothing suitable is free, the user moves to another day and repeats step 5.

### Flow B — Check what is happening today

1. User opens the today overview.
2. User sees all bookings for today across all resources.
3. User optionally narrows the list by resource or by booker.

### Flow C — Find a colleague's bookings

1. User opens a schedule view.
2. User filters by the person who made the booking or the person the booking is for.
3. Only bookings matching that person's selected relationship remain visible.
4. User optionally adds the filters available in that view to narrow further.

## 9. Accessibility

- All views are fully operable by keyboard, including resource selection, day navigation, and filter controls.
- Bookings are announced with their resource, time range, booking creator, and booked-for person so the information is understandable without visual layout.
- Availability and occupancy are never communicated by colour alone; text or another non-colour cue is always present.
- Empty states are announced, not silently blank.
- The currently selected day and active filters are exposed to assistive technology.

## 10. Edge Cases & Error Handling

| Situation | Expected behaviour |
| --- | --- |
| No resources exist | The resource list shows an explanatory empty state instead of a blank page. |
| Resource has no bookings on the selected day | The schedule states the resource is free for the whole day. |
| No bookings anywhere today | The today overview states that nothing is booked today. |
| Filter combination yields no results | The view states no bookings match the current filters and offers a way to clear them. |
| Resource has no description | The resource is still listed; the description area is simply omitted. |
| Booking spans calendar days | It appears on every daily schedule it overlaps, showing only the portion occupying that day. |
| Two bookings on a resource touch (one ends as the next begins) | Both are shown as distinct entries; this is a legitimate back-to-back arrangement, not a conflict. See FS-03. |
| Bookings overlap in time | This state cannot arise: FS-03 refuses overlapping bookings and booking records cannot be imported. |
| Booking data cannot be loaded | The user is informed that availability could not be retrieved and can retry. |
| Selected resource no longer exists | The user is informed and returned to the resource list. |

## 11. Acceptance Criteria

**AC-1** Given resources exist, when the user opens the resource list, then every bookable resource is shown with its name and short description.

**AC-2** Given a resource is selected, when its schedule is opened, then the bookings for the selected day are listed chronologically with time range, booking creator, and booked-for person.

**AC-3** Given a resource schedule is open, when the user changes the day, then the schedule updates to show that day's bookings for the same resource.

**AC-4** Given a resource has no bookings on the selected day, when its schedule is viewed, then the view clearly states the resource is free.

**AC-5** Given the today overview is shown, when the user filters by one resource, then only bookings for that resource remain.

**AC-6** Given a schedule is shown, when the user filters by booker, then only that person's bookings remain.

**AC-6a** Given a schedule is shown, when the user filters by booked-for person, then only bookings for that person remain.

**AC-7** Given multiple filters are applied, when the schedule is rendered, then only bookings matching all active filters are shown.

**AC-8** Given filters are active, when the user clears them, then the unfiltered schedule is restored.

**AC-9** Given the user opens the today overview, then all bookings for the current day are listed across all resources, each identifying its resource, time range, booking creator, and booked-for person.

**AC-10** Given no bookings match the current view, then an explanatory empty state is shown rather than a blank list.

**AC-11** Given a user navigates by keyboard only, then resource selection, day navigation, and filtering are all reachable and operable.

**AC-12** Given a resource schedule is shown, then the full 24 hours of the selected day are represented and every unbooked period is explicitly identified as free.

**AC-13** Given a booking overlaps more than one calendar day, when a user views any affected daily schedule, then the booking is shown with only the portion occupying that day.

## 12. Dependencies & Open Questions

### Assumptions

- A "day" is a single calendar day; the story gives no indication of week or month views.
- All booking and availability dates and times use the team's fixed Europe/Berlin time zone.
- Bookings have a defined start and end time, and unbooked periods within the 24-hour day are shown as free.
- The person who made a booking is the identified current person when the booking is created, and the person it is for is selected from the maintained set of people.
- People are identified through authenticated access. All users see the same availability information; FS-02 defines cancellation permission.

### Open questions

1. **Slot granularity** — Are bookings free-form time ranges, or restricted to fixed slots (e.g. 30 or 60 minutes)?
2. **Historic days** — May users browse past days, or only today and future days?
3. **Resource types** — Beyond rooms and shared equipment, are further resource types expected?
4. **Filter persistence** — Should active filters persist when the user navigates between views or returns later?
5. **Data freshness** — Must the availability view reflect bookings made by others in real time, or is a refresh on view acceptable?

### Dependencies

- Depends on a source of resource data (name, type, description).
- Depends on a source of booking data (resource, day, time range, booker).
- FS-02 defines booking creation and cancellation, and is the authoritative source for the booking field set. FS-03 defines when a slot counts as taken; the availability shown here must agree with it, including that back-to-back bookings are legitimate.

