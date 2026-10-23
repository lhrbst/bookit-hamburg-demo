/**
 * Person domain model: a member of the maintained set of people bookings
 * reference for `bookedBy` and `bookedFor`. Maintaining that set is out of
 * scope here — people are seed data (see `migrations/0003_seed_data.sql`).
 */
export interface Person {
  id: string;
  name: string;
}
