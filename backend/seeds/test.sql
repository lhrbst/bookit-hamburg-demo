-- Historical bookings for disposable E2E databases only, including one resource
-- with a back-to-back pair of bookings (end of one exactly equals the
-- start of the next) usable for the FS-03 clash scenarios (issue #47/#48).
--
-- The purpose category set itself is defined once in
-- `src/domain/purposes.ts`, not here — it is application configuration,
-- not user-managed data, so it does not need a table or seed rows.

-- Room "Nebel": a back-to-back pair (09:00-10:00 immediately followed by
-- 10:00-11:00 — legitimate under half-open semantics, and a fixture for
-- clash scenarios such as "the 09:30-10:30 slot overlaps the first
-- booking" or "10:00-11:00 exactly is already taken").
INSERT INTO booking (id, resource_id, booked_by, booked_for, purpose, during) VALUES
  (
    'a2c9f7d1-24bb-4d5e-802e-24e8fa6ff288',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222221',
    '22222222-2222-2222-2222-222222222222',
    'Meeting',
    tstzrange('2026-09-01 09:00:00+02', '2026-09-01 10:00:00+02', '[)')
  ),
  (
    '72534d6a-6c0a-4527-9ee7-13e4bbaafab1',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    'Focus work',
    tstzrange('2026-09-01 10:00:00+02', '2026-09-01 11:00:00+02', '[)')
  ) ON CONFLICT (id) DO NOTHING;

-- Room "Elbe": a single, unrelated booking on a different resource, to
-- confirm bookings on different resources never conflict (AC-11).
INSERT INTO booking (id, resource_id, booked_by, booked_for, purpose, during) VALUES
  (
    '66c758b4-d200-455c-baaf-30d6c4ad4c73',
    '11111111-1111-1111-1111-111111111112',
    '22222222-2222-2222-2222-222222222223',
    '22222222-2222-2222-2222-222222222221',
    'Interview',
    tstzrange('2026-09-01 13:00:00+02', '2026-09-01 14:00:00+02', '[)')
  ) ON CONFLICT (id) DO NOTHING;
