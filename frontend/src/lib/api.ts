import { config } from '../config';

/**
 * Shared REST fetch helper.
 *
 * Every call to the backend goes through here so the base URL is read
 * from central config once, JSON parsing and error handling are
 * consistent, and later tickets (resource/booking/person fetch hooks) can
 * build on a single primitive rather than each calling `fetch` directly.
 *
 * Kept deliberately thin: no TanStack Query wiring yet. Later frontend
 * tickets add `useQuery`/`useMutation` hooks in `src/lib` that call this.
 */

/**
 * The backend's error taxonomy (issues #22/#38 — see
 * `backend/src/domain/errors.ts`, the authoritative source of this
 * shape). `error` is always an object with a stable machine-readable
 * `code`; `fieldErrors` is present only for `validation_error` and
 * `conflict`.
 */
export type ApiErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'internal_error';

export interface ApiFieldError {
  field: string;
  rule: string;
  message: string;
  /** Only present on `conflict` field errors whose rule is `clash`. */
  conflict?: { start: string; end: string };
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: ApiFieldError[];
  };
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const maybe = body as { error?: unknown };
  if (typeof maybe.error !== 'object' || maybe.error === null) {
    return false;
  }
  const code = (maybe.error as { code?: unknown }).code;
  return typeof code === 'string';
}

/**
 * Thrown for every non-2xx response the backend returns *and* for network
 * failures (the request never reaching the backend at all — DNS/connection
 * errors, offline, CORS rejection before a response body exists). The two
 * cases must stay distinguishable by callers (Task 2.1 AC: "not-found
 * responses are distinguishable from network/unexpected failures"):
 *
 * - A well-formed backend error has `status` set to the real HTTP status
 *   and `code` set from the parsed `error.code` in the body.
 * - A network failure (no response at all) has `status` set to `0` and
 *   `code` set to `undefined` — there is no server-issued code to read.
 *
 * Callers should prefer the `isNotFound`/`isValidationError`/`isConflict`/
 * `isForbidden` getters over comparing `status` numbers directly, so the
 * branch reads as business language and stays correct even if a status
 * code is ever reused for a different meaning.
 */
export class ApiError extends Error {
  /** Real HTTP status, or `0` when the request never reached the server. */
  readonly status: number;
  /** Parsed response body, or `undefined` for a network failure. */
  readonly body: unknown;
  /** The backend's `error.code`, or `undefined` when there is no body to read it from. */
  readonly code: ApiErrorCode | undefined;
  /** Per-field violations, when the backend included them (`validation_error`/`conflict`). */
  readonly fieldErrors: ApiFieldError[] | undefined;

  constructor(status: number, body: unknown) {
    const parsed = isApiErrorBody(body) ? body : undefined;
    super(parsed?.error.message ?? `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = parsed?.error.code;
    this.fieldErrors = parsed?.error.fieldErrors;
  }

  /** True for a network/transport failure — no response was ever received. */
  get isNetworkFailure(): boolean {
    return this.status === 0;
  }

  get isNotFound(): boolean {
    return this.code === 'not_found';
  }

  get isValidationError(): boolean {
    return this.code === 'validation_error';
  }

  get isConflict(): boolean {
    return this.code === 'conflict';
  }

  get isForbidden(): boolean {
    return this.code === 'forbidden';
  }

  /**
   * True for a failure that is neither a recognised client refusal
   * (validation/not-found/forbidden/conflict) nor able to be classified
   * at all (a network drop, or a malformed/absent error body — e.g. a
   * 500 without JSON, or a proxy timeout page). Callers should render
   * this the same generic "unexpected failure, please retry" outcome
   * used for the backend's own `internal_error`.
   */
  get isUnexpected(): boolean {
    return this.code === undefined || this.code === 'internal_error';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    // `fetch` itself rejected: no response was ever received (offline,
    // DNS failure, connection refused, CORS preflight rejection, ...).
    // Distinguished from a well-formed error response by `status === 0`
    // and `body === undefined` — there is no server body to parse.
    throw new ApiError(0, undefined);
  }

  // A `204 No Content` (e.g. `DELETE /api/bookings/:id`, issue #37) has no
  // body at all — calling `.json()`/`.text()` on it is either an empty
  // string (harmless but pointless) or, for some responses, a parse
  // error. Short-circuit before touching the body so a successful
  // no-content response resolves to `undefined` rather than risking a
  // spurious throw. This only special-cases the *success* path — an
  // error response always has a body to parse, so 4xx/5xx below is
  // unaffected.
  if (response.status === 204) {
    if (!response.ok) {
      // Not reachable by the current backend (no route pairs 204 with a
      // non-2xx), but kept defensive rather than assuming.
      throw new ApiError(response.status, undefined);
    }
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  return body as T;
}
