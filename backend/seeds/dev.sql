INSERT INTO resource (id, name, description, type) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Nebel', 'Meeting room, seats 6', 'room'),
  ('11111111-1111-1111-1111-111111111112', 'Elbe', 'Meeting room, seats 10, video conferencing', 'room'),
  ('11111111-1111-1111-1111-111111111113', 'Projector Cart A', 'Portable projector and screen', 'equipment')
ON CONFLICT (id) DO NOTHING;

INSERT INTO person (id, name) VALUES
  ('22222222-2222-2222-2222-222222222221', 'Alex Nguyen'),
  ('22222222-2222-2222-2222-222222222222', 'Brigitte Kaya'),
  ('22222222-2222-2222-2222-222222222223', 'Chidi Okafor')
ON CONFLICT (id) DO NOTHING;
