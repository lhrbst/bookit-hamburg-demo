import { AsyncLocalStorage } from 'node:async_hooks';
import { Temporal } from '@js-temporal/polyfill';

export type Clock = () => Temporal.Instant;

const requestClock = new AsyncLocalStorage<Clock>();
export const systemClock: Clock = () => Temporal.Now.instant();

export function now(): Temporal.Instant {
  return (requestClock.getStore() ?? systemClock)();
}

export function withClock<T>(clock: Clock, callback: () => T): T {
  return requestClock.run(clock, callback);
}
