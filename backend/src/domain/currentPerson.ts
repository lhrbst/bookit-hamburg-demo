import { config } from '../config';
import { getPersonById } from '../db/personRepository';
import { NotFoundError } from './errors';
import type { Person } from './person';

/**
 * The single seam through which "the identified current person" (FS-02
 * §4: "the application identifies the current person through
 * authenticated access") is resolved.
 *
 * There is no authentication system yet (issue #35 is scaffolding only).
 * Until one exists, this resolves to a fixed, configured person id
 * (`CURRENT_PERSON_ID`, see `config.ts`), read via `personRepository`.
 * When real authentication is added, only this function's *body* changes
 * (e.g. reading a session/JWT instead of `config.currentPersonId`) — its
 * signature and return shape stay the same, so no call site needs to
 * change.
 *
 * Every route that needs "who is booking" (creating or cancelling a
 * booking) MUST call this function to get the authoritative person.
 * Nothing in the codebase may trust a `bookedBy`/creator id supplied by
 * the client in a request body or params for that purpose — the client
 * can send whatever it likes there, but it is never read as the acting
 * person's identity.
 *
 * Throws `NotFoundError` if the configured/stand-in person id does not
 * exist in the database. That should not happen in normal operation (the
 * default points at seeded data, and a real deployment configures a real
 * person id) — treating it as a 404 rather than crashing the process
 * keeps a single misconfiguration from taking the whole API down, while
 * still surfacing clearly as "current person could not be resolved"
 * rather than silently booking as nobody.
 */
export async function getCurrentPerson(): Promise<Person> {
  const person = await getPersonById(config.currentPersonId);

  if (person === null) {
    throw new NotFoundError(
      'The current person could not be identified. Please contact an administrator.',
    );
  }

  return person;
}
