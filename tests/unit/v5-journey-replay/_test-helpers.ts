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
 * Minimal but schema-valid `analysis_ready` payload. Replay rows for
 * Step 4 (run_analysis) hard-fail when this field is absent or missing
 * structural fields (status, options, goal_node_id, computed_at) — the
 * harness must catch the chip-click → finaliser wire regression that
 * prompted the V5 baseline. Test fixtures that simulate any step
 * including run_analysis should include this so the harness assertions
 * accept the response. Tests that specifically verify behaviour when
 * the field is ABSENT (e.g. preflight failure paths) should omit it.
 */
export const REPLAY_FIXTURE_ANALYSIS_READY = {
  status: 'ready' as const,
  goal_node_id: 'goal_test',
  options: [
    { option_id: 'opt_a', label: 'Option A', status: 'ready', interventions: { fac_x: 0.6 } },
    { option_id: 'opt_b', label: 'Option B', status: 'ready', interventions: { fac_x: 0.3 } },
  ],
  computed_at: '2026-04-27T15:07:30.000Z',
};

/**
 * Shared `assistant_text` fixture for replay-harness fixtures. Set above
 * the Step 5 substance gate (text_len > 200) so the same response shape
 * can serve all six canonical steps without per-step branching. Includes
 * `Option A` so it also clears the option-label gate when journey
 * context is threaded — Step 1 of the replay parses option labels from
 * `draft_graph.nodes`, so any fixture lacking a draft_graph leaves the
 * label gate disabled (and this filler is benign in that case).
 */
export const REPLAY_FIXTURE_ASSISTANT_TEXT =
  'Looking at the analysis, Option A leads with about 62% probability against the goal. ' +
  'The strongest driver is the cost factor, and the result is sensitive to a roughly 10% ' +
  'shift in the cost→outcome edge. The most fragile assumption is contingency budget.';

/**
 * Stub `fetch` with a router that picks a response per URL. Useful
 * for the full-replay integration test where /healthz and
 * /orchestrate/v2/turn need distinct behaviours. The optional second
 * parameter exposes the request body to the router so callers can
 * route by user message text (e.g. step 7's "Which option is currently
 * leading?" needs staleness; step 1's brief does not).
 */
export function stubFetchRouter(
  router: (
    url: string,
    body?: string,
  ) => FetchMockInit | Error | Promise<FetchMockInit | Error>,
) {
  const fn = vi.fn<FetchSignature>(async (url, init) => {
    const u = typeof url === 'string' ? url : url.toString();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const r = await router(u, body);
    if (r instanceof Error) throw r;
    return buildMockResponse(r) as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Canonical staleness prefix produced by V5 explanation handlers when the
 * analysis projection carries a `staleness_reason`. Mirror of the source
 * constant in `src/orchestrator-v5/tools/handlers/staleness-prefix.ts`.
 * Used in test fixtures for steps 7 / 8 of the extended replay harness.
 */
export const REPLAY_FIXTURE_STALENESS_PREFIX =
  'These results are from a prior run and may not reflect recent changes to the decision model. Treat any figures below as directional rather than definitive.';

/**
 * Shape-valid fixture for `/assist/v1/draft-graph` step 1a. Two nodes,
 * one edge, both with valid provenance + provenance_display values; a
 * benign coaching block. Lets the new harness step pass without forcing
 * existing tests to construct a full CEE response by hand.
 */
export const REPLAY_FIXTURE_ASSIST_DRAFT_GRAPH = {
  status: 'ok' as const,
  graph: {
    nodes: [
      { id: 'n1', label: 'Hire two senior engineers locally', kind: 'option', provenance: 'from_brief' },
      { id: 'n2', label: 'Engage an offshore partner', kind: 'option', provenance: 'from_brief' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', provenance_display: 'ai_inferred' },
    ],
  },
  coaching: {
    summary: 'Consider runway implications more carefully.',
    strengthen_items: [],
  },
};

/**
 * Wire body for steps 7 / 8 — staleness-prefixed assistant_text plus a
 * single rerun chip (`action_type: 'run_analysis'`). Matches the
 * `assertStaleExplanation` contract.
 */
export const REPLAY_FIXTURE_STALE_TURN = {
  response_version: 2,
  assistant_text:
    REPLAY_FIXTURE_STALENESS_PREFIX +
    ' Option A leads with about 62% probability. The strongest driver is the cost factor, ' +
    'and the result remains directionally consistent. The most fragile assumption is contingency budget.',
  blocks: [],
  suggested_actions: [
    {
      id: 'chip_action_rerun_analysis',
      label: 'Run the analysis',
      message: 'Run the analysis',
      action_type: 'run_analysis',
    },
  ],
  stage_indicator: 'decide',
  analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
};

/**
 * Best-effort detector for the harness's step-7 turn. The harness sends
 * a composer message asking "Which option is currently leading?" — we
 * key off that exact substring so the test router can return the stale
 * fixture only on step 7 (steps 1, 2, 3, 5, 6, 9 keep the generic body).
 */
export function isStep7Message(body?: string): boolean {
  if (!body) return false;
  return body.includes('Which option is currently leading');
}
