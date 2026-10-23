-- 0002_create_schema.sql
--
-- Relational schema for the domain (FS-01/FS-02 §7, ADR-003): resource,
-- person, and booking, with booking non-overlap enforced declaratively.
--
-- `gen_random_uuid()` is built into PostgreSQL core since v13, so no
-- additional extension is needed for id generation. `btree_gist` (enabled
-- in 0001) is required for the exclusion constraint below, because it
-- mixes the equality operator on `resource_id` into a GiST index.

CREATE TABLE resource (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL,
  type        text NOT NULL CHECK (type IN ('room', 'equipment'))
);

CREATE TABLE person (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

-- Booking time is a single half-open `tstzrange` column, not two loose
-- `timestamptz` columns: `[start, end)` semantics make back-to-back
-- bookings correct by construction, with no boundary comparison to get
-- wrong. `purpose` is free text here; it is validated against the
-- configured category set (see `src/domain/purposes.ts`) at the
-- application layer, not by a database check constraint, so the set can
-- change without a migration.
CREATE TABLE booking (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resource(id),
  booked_by   uuid NOT NULL REFERENCES person(id),
  booked_for  uuid NOT NULL REFERENCES person(id),
  purpose     text NOT NULL,
  during      tstzrange NOT NULL,

  -- The FS-03 §7 invariant ("no two active bookings on the same resource
  -- share any period of time") lives here, enforced by the database at
  -- commit time, not as an application read-then-insert check (ADR-003).
  -- Do not remove or "helpfully" duplicate this as an app-level check.
  CONSTRAINT booking_no_overlap
    EXCLUDE USING GIST (resource_id WITH =, during WITH &&)
);

CREATE INDEX booking_resource_id_idx ON booking (resource_id);
CREATE INDEX booking_booked_by_idx ON booking (booked_by);
CREATE INDEX booking_booked_for_idx ON booking (booked_for);
