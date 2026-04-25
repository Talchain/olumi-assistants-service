/**
 * Shared test helpers for the v5-journey-replay test suite.
 *
 * The DOM `Response` type is large and only a handful of methods are
 * exercised by `client.ts`. We model the precise surface the harness
 * uses (`status`, `headers.get`, `json`, `text`) as `MockResponse` and
 * cast that to `Response` at the boundary — this is the one approved
 * test-only escape, isolated to a single helper rather than scattered
 * across every test file.
 */

import { vi } from 'vitest';

export interface MockHeaders {
  get(name: string): string | null;
}

export interface MockResponse {
  readonly status: number;
  readonly headers?: MockHeaders;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface FetchMockInit {
  readonly status?: number;
  readonly jsonValue?: unknown;
  /** Override stringified body — needed for non-JSON-parseable test inputs. */
  readonly rawText?: string;
  readonly contentType?: string;
}

function buildMockResponse(init: FetchMockInit): MockResponse {
  const jsonBody = init.jsonValue ?? {};
  const rawText = init.rawText ?? JSON.stringify(jsonBody);
  const contentType = init.contentType ?? 'application/json';
  return {
    status: init.status ?? 200,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    async json() {
      return JSON.parse(rawText);
    },
    async text() {
      return rawText;
    },
  };
}

export interface CapturedRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

type FetchSignature = (
  input: string | URL,
  init?: CapturedRequestInit,
) => Promise<Response>;

/**
 * Stub a single `fetch` call returning the given response. The mock
 * is installed via `vi.stubGlobal` and must be cleared by the
 * caller's `afterEach` (`vi.unstubAllGlobals()`). The returned mock
 * function records `(input, init)` for assertion access via
 * `mock.calls[i][1]?.headers` etc.
 */
export function stubFetchOnce(init: FetchMockInit | Error) {
  const fn = vi.fn<FetchSignature>(async (_input, _reqInit) => {
    if (init instanceof Error) throw init;
    return buildMockResponse(init) as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Stub `fetch` with a router that picks a response per URL. Useful
 * for the full-replay integration test where /healthz and
 * /orchestrate/v2/turn need distinct behaviours.
 */
export function stubFetchRouter(
  router: (url: string) => FetchMockInit | Error | Promise<FetchMockInit | Error>,
) {
  const fn = vi.fn<FetchSignature>(async (url, _init) => {
    const u = typeof url === 'string' ? url : url.toString();
    const r = await router(u);
    if (r instanceof Error) throw r;
    return buildMockResponse(r) as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
