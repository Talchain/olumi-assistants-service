/**
 * Pin the step-6 graph-mutation gate behaviour.
 *
 * Step 6's "Increase the budget factor" message is non-deterministic on
 * staging: when no node literally matches "budget", it routes to a
 * clarification ("Did you mean Hiring and Staffing Cost?"). In that
 * case `blocks` is empty, no `graph_patch` is emitted, and the graph
 * state is unchanged. Steps 7-9 must NOT assert staleness on an
 * unmutated graph — that would be a harness-brief flaw, not a
 * production defect. Instead they classify as `skipped_dependency`
 * with an evidence line explaining the gate.
 *
 * This test pins:
 *  1. Detection of mutation: positive evidence required
 *     (graph_patch block OR analysis_ready.staleness_reason non-null).
 *  2. Skip-classification format: status='skipped', evidence starts
 *     with `skipped_dependency: step 6 did not produce a confirmed
 *     graph mutation`, failing_contract is
 *     `skipped_dependency: step_6_no_graph_mutation`.
 *  3. The skip recommendation tells the operator how to make step 6
 *     deterministic.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  stubFetchRouter,
  REPLAY_FIXTURE_ANALYSIS_READY,
  REPLAY_FIXTURE_ASSIST_DRAFT_GRAPH,
  REPLAY_FIXTURE_ASSISTANT_TEXT,
  REPLAY_FIXTURE_STALE_TURN,
  isStep7Message,
} from './_test-helpers.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';
const STAGING = 'https://cee-staging.onrender.com';
const BUILD = '66d1adb';

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

class ProcessExitError extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

let originalArgv: string[] = [];
let originalExit: typeof process.exit;

describe('step-6 graph-mutation gate — controls steps 7/8/9 classification', () => {
  beforeEach(() => {
    writes.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    vi.stubEnv('OLUMI_REPLAY_ALLOW_STALE_DEPLOY', 'true');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    originalArgv = process.argv;
    originalExit = process.exit;
    process.exit = ((code?: number | string | null | undefined) => {
      throw new ProcessExitError(code);
    }) as typeof process.exit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  async function importFreshRun() {
    vi.resetModules();
    return (await import('../../../tools/v5-journey-replay/index.js')) as typeof import('../../../tools/v5-journey-replay/index.js');
  }

  it('clarification on step 6 → steps 7/8/9 skipped_dependency, NOT failed', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-step6-clarify.md',
    ];

    stubFetchRouter((url, body) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: BUILD, service: 'assistants' } };
      }
      if (url.endsWith('/assist/v1/draft-graph')) {
        return { status: 200, jsonValue: REPLAY_FIXTURE_ASSIST_DRAFT_GRAPH };
      }
      if (!url.endsWith('/orchestrate/v2/turn')) {
        return { status: 404, jsonValue: {} };
      }
      // Step 6 returns a clarification — no blocks, no staleness.
      if (typeof body === 'string' && body.includes('Increase the budget factor')) {
        return {
          status: 200,
          jsonValue: {
            response_version: 2,
            assistant_text:
              'I want to make sure I update the right factor. The model has a few elements that could relate to budget. Did you mean one of these? 1. Hiring and Staffing Cost 2. Onboarding Time',
            blocks: [],
            suggested_actions: [],
            stage_indicator: 'frame',
            analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
          },
        };
      }
      // Step 7 should never reach here — the gate must skip it.
      if (isStep7Message(body)) {
        throw new Error('step 7 must be skipped when step 6 did not mutate the graph');
      }
      return {
        status: 200,
        jsonValue: {
          response_version: 2,
          assistant_text: REPLAY_FIXTURE_ASSISTANT_TEXT,
          suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
          analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
        },
      };
    });

    const mod = await importFreshRun();
    // 0 failed steps — the run exits cleanly even though step 7-9 skip.
    await mod.run();

    const pack = writes[0]!.content;
    // Step 6 itself passes (clarification is product-shaped).
    expect(pack).toMatch(/`6_edit_budget` \| \[PASS\] passed/);
    // Steps 7, 8, 9 are SKIPPED with the new evidence line.
    expect(pack).toMatch(/`7_stale_explanation` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/`8_rerun_via_chip` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/`9_what_would_flip` \| \[SKIP\] skipped/);
    // Evidence string explains why and recommends a deterministic message.
    expect(pack).toContain('skipped_dependency: step 6 did not produce a confirmed graph mutation');
    expect(pack).toContain('Set the Hiring and Staffing Cost factor to 0.7');
  });

  it('confirmed graph_patch in step 6 → step 7 runs (no early skip)', async () => {
    vi.stubEnv('OLUMI_REPLAY_API_KEY', SENTINEL);
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      STAGING,
      '--out',
      '/tmp/v5-step6-mutated.md',
    ];

    let step7Hit = false;

    stubFetchRouter((url, body) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: BUILD, service: 'assistants' } };
      }
      if (url.endsWith('/assist/v1/draft-graph')) {
        return { status: 200, jsonValue: REPLAY_FIXTURE_ASSIST_DRAFT_GRAPH };
      }
      if (!url.endsWith('/orchestrate/v2/turn')) {
        return { status: 404, jsonValue: {} };
      }
      // Step 6 returns a graph_patch block — confirmed mutation.
      if (typeof body === 'string' && body.includes('Increase the budget factor')) {
        return {
          status: 200,
          jsonValue: {
            response_version: 2,
            assistant_text: 'Updated the Hiring and Staffing Cost factor to 0.7.',
            blocks: [{ type: 'graph_patch', status: 'committed', operation: 'edit_factor', target_id: 'fac_hiring_cost' }],
            suggested_actions: [],
            stage_indicator: 'frame',
            analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
          },
        };
      }
      if (isStep7Message(body)) {
        step7Hit = true;
        return { status: 200, jsonValue: REPLAY_FIXTURE_STALE_TURN };
      }
      return {
        status: 200,
        jsonValue: {
          response_version: 2,
          assistant_text: REPLAY_FIXTURE_ASSISTANT_TEXT,
          suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
          analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
        },
      };
    });

    const mod = await importFreshRun();
    await mod.run();

    expect(step7Hit).toBe(true);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/`7_stale_explanation` \| \[PASS\] passed/);
  });
});
