/**
 * Data-access layer.
 *
 * `pool.ts` exports the shared `pg` `Pool`. `bookingRepository.ts` holds
 * the parameterised SQL for booking persistence — `tstzrange`
 * construction and (from issue #47/#48) `23P01` detection/translation —
 * kept out of route handlers per ADR-002/ADR-003. Later tickets add
 * further repository modules here (e.g. `resourceRepository.ts`,
 * `personRepository.ts`) as read routes need them.
 */
export * from './bookingRepository';


