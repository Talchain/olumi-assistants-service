/**
 * V5 Golden Journey benchmark prep — integration tests (mocked fetch).
 *
 * Drives the full `run()` against a stubbed staging service for both P0
 * modes and asserts the structural outcomes that matter for the prep:
 *   - the flip-excluded banner on `p0-partial-spine` (and that no flip step
 *     row appears);
 *   - flip step rows present on `p0-full-golden`;
 *   - build-provenance fields (scenario id, included/excluded PRs);
 *   - the per-step capture section;
 *   - no API-key leak anywhere.
 * Plus a focused `client.postTurn` request-id capture test.
 *
 * NO network: a universal stubbed turn response makes every spine + flip
 * step pass so the chain executes end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

const writes: Array<{ path: string; content: string }> = [];
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn((path: string, content: string) => {
      writes.push({ path: String(path), content: String(content) });
    }),
  };
});

import { stubFetchOnce, stubFetchRouter, REPLAY_FIXTURE_ANALYSIS_READY } from './_test-helpers.js';
import { postTurn, type TurnPayload } from '../../../tools/v5-journey-replay/client.js';

// A universal turn response that satisfies every P0 spine + flip assertion:
// acknowledges an add ("Added"), acknowledges a mutation ("Updated"),
// references an option label (so containment reads applied_option_ref),
// references the factor label (so what_changed passes), carries a populated
// DGAI analysis_result block + analysis_ready, and includes a rerun chip with
// no executable what_would_flip chip (so the stale follow-up steers to rerun).
const UNIVERSAL_TURN = {
  response_version: 2,
  assistant_text:
    'Added a new option. Updated the model. The Engage an offshore partner option now reflects the new cost. ' +
    'Option A leads at about 62% win probability against the goal, with Budget as the strongest driver and a ' +
    'fair amount of contingency. The result is sensitive to a roughly 10% shift in the cost-to-outcome edge. ' +
    'You may want to re-run the analysis to pick up the latest edit.',
  suggested_actions: [
    { id: 'c1', label: 'Re-run analysis', message: 'Re-run analysis on the updated graph.', action_type: 'run_analysis' },
  ],
  blocks: [
    {
      type: 'analysis_result',
      summary: 'Option A leads against the goal.',
      leading_option_id: 'opt_a',
      win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
    },
  ],
  analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
  draft_graph: {
    nodes: [
      { kind: 'option', label: 'Option A' },
      { kind: 'option', label: 'Engage an offshore partner' },
      { kind: 'factor', label: 'Budget' },
    ],
  },
};

const HEALTHZ_OK = {
  status: 200,
  jsonValue: { ok: true, build: '9ac9ea6', version: '1.12.0', service: 'assistants', degraded: false },
};

function universalRouter(url: string) {
  if (url.endsWith('/healthz')) return HEALTHZ_OK;
  if (url.endsWith('/orchestrate/v2/turn')) return { status: 200, jsonValue: UNIVERSAL_TURN };
  return { status: 404, jsonValue: {} };
}

describe('client.postTurn — request_id capture', () => {
  const payload: TurnPayload = {
    kind: 'message',
    turn_id: 't1',
    scenario_id: 's1',
    stage: 'frame',
    message: 'hello',
    turn_class: 'frame',
    source: 'composer',
  };

  afterEach(() => vi.unstubAllGlobals());

  it('captures X-Request-Id from the response header', async () => {
    stubFetchOnce({ status: 200, jsonValue: { assistant_text: 'ok' }, requestId: 'req_header_123' });
    const r = await postTurn('https://cee-staging.onrender.com', payload, 5000, 'KEY');
    expect(r.request_id).toBe('req_header_123');
  });

  it('falls back to the body request_id when the header is absent', async () => {
    stubFetchOnce({ status: 422, jsonValue: { error: 'X', boundary: 'b', request_id: 'req_body_9' } });
    const r = await postTurn('https://cee-staging.onrender.com', payload, 5000, 'KEY');
    expect(r.request_id).toBe('req_body_9');
  });
});

describe('P0 journey integration (mocked staging)', () => {
  let originalArgv: string[] = [];
  let originalExit: typeof process.exit;
  const consoleLogs: string[] = [];
  const consoleErrs: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    consoleLogs.length = 0;
    consoleErrs.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      consoleLogs.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      consoleErrs.push(a.map(String).join(' '));
    });
    originalArgv = process.argv;
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.argv = originalArgv;
    process.exit = originalExit;
    delete process.env.OLUMI_REPLAY_API_KEY;
  });

  async function importFreshRun() {
    vi.resetModules();
    return (await import(
      '../../../tools/v5-journey-replay/index.js'
    )) as typeof import('../../../tools/v5-journey-replay/index.js');
  }

  it('p0-partial-spine: green run, flip-excluded banner, provenance, capture section, NO flip step rows', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--journey',
      'p0-partial-spine',
      '--expected-build',
      '9ac9ea6',
      '--out',
      '/tmp/p0-partial.md',
      '--included-prs',
      '276:8d05e3b,278:9ac9ea6',
      '--excluded-prs',
      '277,270,271',
    ];
    stubFetchRouter(universalRouter);

    const mod = await importFreshRun();
    await mod.run(); // green → no process.exit

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).not.toContain(SENTINEL);
    // Flip-excluded banner.
    expect(pack).toContain('EXCLUDED — #277 not deployed');
    // Provenance.
    expect(pack).toMatch(/Scenario ID:/);
    expect(pack).toContain('278:9ac9ea6');
    expect(pack).toMatch(/Excluded open PRs:/);
    expect(pack).toContain('277');
    // Capture section.
    expect(pack).toContain('Per-step capture');
    // Spine step rows present; flip step rows absent.
    expect(pack).toContain('4_add_option_encode');
    expect(pack).toContain('6_edit_option_intervention');
    expect(pack).not.toMatch(/what_would_flip_chip/);
    expect(pack).not.toMatch(/what_would_flip_stale/);
    // All spine steps passed.
    expect(pack).not.toMatch(/\[FAIL\] failed/);

    for (const line of [...consoleLogs, ...consoleErrs]) {
      expect(line).not.toContain(SENTINEL);
    }
  });

  it('p0-full-golden: flip step rows present + INCLUDED banner + capture section', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/index.ts',
      '--base-url',
      'https://cee-staging.onrender.com',
      '--journey',
      'p0-full-golden',
      '--out',
      '/tmp/p0-full.md',
    ];
    stubFetchRouter(universalRouter);

    const mod = await importFreshRun();
    await mod.run();

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).not.toContain(SENTINEL);
    expect(pack).toContain('4_what_would_flip_chip');
    expect(pack).toContain('11_what_would_flip_stale');
    expect(pack).toContain('what_would_flip legs:** INCLUDED');
    expect(pack).toContain('Per-step capture');
  });
});
