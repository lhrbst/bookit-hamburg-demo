import type { QueryResult } from 'pg';
import { pool } from './pool';
import type { Person } from '../domain/person';

/**
 * Raw shape of a row returned by `listPeople` below. `pg` returns
 * `QueryResult<any>` by default, so the query is given this row type
 * explicitly and mapped to the domain `Person` shape at this edge.
 */
interface PersonRow {
  id: string;
  name: string;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
  };
}

/**
 * Lists the maintained set of people, used to populate 'booked by' and
 * 'booked for' filter/select controls across FS-01 and FS-02 (issue #52).
 * People are seed data (see `migrations/0003_seed_data.sql`); there is no
 * creation/edit/removal endpoint here.
 *
 * Ordered by name for a stable, deterministic dropdown/filter option
 * order. An empty set returns an empty array, not an error — this is a
 * pure read with no rows-to-error translation needed.
 */
export async function listPeople(): Promise<Person[]> {
  const result: QueryResult<PersonRow> = await pool.query(
    'SELECT id, name FROM person ORDER BY name',
  );

  return result.rows.map(toPerson);
}

/**
 * Looks up a single person by id. Returns `null` when the id does not
 * identify a person in the maintained set (unknown or malformed id),
 * rather than throwing — the caller decides what "not found" means for
 * its context (see `domain/currentPerson.ts`).
 */
export async function getPersonById(id: string): Promise<Person | null> {
  const result: QueryResult<PersonRow> = await pool.query(
    'SELECT id, name FROM person WHERE id = $1',
    [id],
  );

  const row = result.rows[0];
  return row === undefined ? null : toPerson(row);
}
