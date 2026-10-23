import 'dotenv/config';

/**
 * Centralised, typed application configuration.
 *
 * Every environment-specific value (ports, origins, connection strings) is
 * read here and only here. Route and middleware code must import `config`
 * rather than reading `process.env` directly, so there is a single place to
 * audit for hardcoded environment URLs or secrets.
 */
export interface AppConfig {
  /** Port the HTTP server listens on. */
  port: number;
  /** Origin allowed to call this API via CORS (the frontend dev/prod origin). */
  corsOrigin: string;
  /** PostgreSQL connection string consumed by the `pg` pool. */
  databaseUrl: string;
  /** Node environment, for conditional behaviour such as verbose error logging. */
  nodeEnv: string;
  /**
   * The "current person" stand-in id (issue #35). There is no
   * authentication yet; until there is, every request is treated as
   * originating from this seeded person. Read once here, like every
   * other environment-specific value, and consumed only through
   * `domain/currentPerson.ts` — never inline in a route.
   */
  currentPersonId: string;
}

function readPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config: AppConfig = {
  port: readPort(process.env['PORT'], 3001),
  corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
  databaseUrl:
    process.env['DATABASE_URL'] ?? 'postgres://bookit:bookit@localhost:5432/bookit',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  // Fallback is one of the three seeded people from
  // `migrations/0003_seed_data.sql` (Alex Nguyen), so local development
  // and tests work out of the box without setting this explicitly.
  currentPersonId:
    process.env['CURRENT_PERSON_ID'] ?? '22222222-2222-2222-2222-222222222221',
};

