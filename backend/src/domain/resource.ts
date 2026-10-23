/**
 * Resource domain model (FS-01 §7): the room or piece of shared equipment
 * being booked. Creating, editing, or removing resources is out of scope
 * (FS-01 §3) — resources are seed data (see `migrations/0003_seed_data.sql`).
 */
export interface Resource {
  id: string;
  name: string;
  description: string;
  type: 'room' | 'equipment';
}
