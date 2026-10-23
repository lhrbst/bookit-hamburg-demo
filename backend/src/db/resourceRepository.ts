import type { QueryResult } from 'pg';
import { pool } from './pool';
import type { Resource } from '../domain/resource';

/**
 * Raw shape of a row returned by `listResources` below. `pg` returns
 * `QueryResult<any>` by default, so the query is given this row type
 * explicitly and mapped to the domain `Resource` shape at this edge.
 */
interface ResourceRow {
  id: string;
  name: string;
  type: 'room' | 'equipment';
  description: string;
}

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
  };
}

/**
 * Lists every bookable resource — rooms and shared equipment together in
 * one list (FS-01 §7, AC-1, issue #51). Resources are seed data (see
 * `migrations/0003_seed_data.sql`); there is no creation/edit/removal
 * endpoint (FS-01 §3).
 *
 * Ordered by name for a stable, non-jittery listing across repeated
 * loads. An empty catalogue returns an empty array, not an error — that
 * is a pure read with no rows-to-error translation needed.
 */
export async function listResources(): Promise<Resource[]> {
  const result: QueryResult<ResourceRow> = await pool.query(
    'SELECT id, name, type, description FROM resource ORDER BY name',
  );

  return result.rows.map(toResource);
}

/**
 * Looks up a single resource by id (FS-01 §10 'selected resource no longer
 * exists', issue #53). Returns `null` rather than throwing when `id` does
 * not identify an existing resource — callers (e.g. the schedule route)
 * decide what that means (a 404 via `NotFoundError`), this repository
 * function is a pure read.
 */
export async function getResourceById(id: string): Promise<Resource | null> {
  const result: QueryResult<ResourceRow> = await pool.query(
    'SELECT id, name, type, description FROM resource WHERE id = $1',
    [id],
  );

  const row = result.rows[0];
  return row === undefined ? null : toResource(row);
}
