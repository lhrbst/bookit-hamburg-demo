import { Temporal } from '@js-temporal/polyfill';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { pool } from '../src/db/pool';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const clockFile = resolve(__dirname, '../../.local/e2e-clock.json');
mkdirSync(resolve(__dirname, '../../.local'), { recursive: true });
writeFileSync(clockFile, JSON.stringify('2026-08-31T10:00:00Z'));
const server = createApp(() => {
  const value: unknown = JSON.parse(readFileSync(clockFile, 'utf8'));
  if (typeof value !== 'string') throw new Error('Invalid test clock');
  return Temporal.Instant.from(value);
}).listen(config.port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { void pool.end(); }));
}
