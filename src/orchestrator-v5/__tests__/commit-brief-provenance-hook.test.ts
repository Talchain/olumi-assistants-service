/**
 * ROADMAP 2.1229 (CEE half) — commit-seam brief + provenance hook.
 *
 * USER OUTCOME: a person who has run an analysis can send their model to a
 * colleague, and the colleague opens the link and sees it. The DB-side
 * producers for that were always correct; they lost their caller when the
 * direct browser→PLoT `/v2/run` path was retired, so `scenarios.brief` has
 * been NULL on 14,157 of 14,158 rows and `create_shared_brief` has raised
 * 'No brief to share - generate a brief first' on every real share.
 *
 * This suite pins the CONTRACT of the sibling hook, mirroring
 * commit-decision-record-hook.test.ts:
 *  - successful run_analysis fact + complete envelope ⇒ fire-and-forget
 *    store_brief_and_provenance with the EXACT payload;
 *  - NO qualifying fact ⇒ byte-identical commit path: zero store
 *    construction, therefore zero env reads (this is the property that keeps
 *    every non-analysis turn unchanged, and it is asserted by COUNTING store
 *    construction, not by asserting the RPC was not called — a hook that
 *    built the store and then skipped would pass the weaker assertion);
 *  - an INCOMPLETE envelope is skipped BEFORE store construction too — the
 *    same byte-identical property, for the case where a fact qualifies but
 *    cannot produce a whole envelope;
 *  - non-blocking: store-construction throw, RPC rejection, and a `false`
 *    return (the RPC's own all-or-nothing refusal) NEVER affect the turn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    storeBriefAndProvenance: vi.fn(),
    getStoreCalls: 0,
    throwOnGet: false,
  },
}));

vi.mock('../brief-provenance/index.js', () => ({
  getBriefProvenanceStore: vi.fn(() => {
    storeMock.getStoreCalls += 1;
    if (storeMock.throwOnGet) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    return { storeBriefAndProvenance: storeMock.storeBriefAndProvenance };
  }),
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { _resetConfigCache } from '../../config/index.js';
import * as telemetry from '../../utils/telemetry.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GRAPH_HASH = 'abcdef0123456789';
const RESPONSE_HASH = 'sha256:9f8e7d6c';
const SEED = 2146549360;
const BRIEF = { brief_id: 'brief_123', headline: 'Option A leads.', seed: SEED };

function makeRunAnalysisFact(overrides?: {
  readonly noop?: boolean;
  readonly enrichment?: Record<string, unknown>;
  readonly omitGraphHash?: boolean;
}): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides?.noop ?? false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A currently leads.',
      computed_at: '2026-09-18T12:00:00.000Z',
      enrichment: overrides?.enrichment ?? {
        analysis_status: 'computed',
        response_hash: RESPONSE_HASH,
        decision_brief: BRIEF,
      },
      ...(overrides?.omitGraphHash === true ? {} : { graph_hash_at_run: GRAPH_HASH }),
    },
  };
}

function meta(facts: readonly RunAnalysisHandlerFact[]) {
  return {
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    turn_class: 'handler' as const,
    handler_id: 'run_analysis' as const,
    request_hash: 'sha256:test',
    llm_calls_used: 0,
    duration_ms: 42,
    handler_facts: facts,
  };
}

function composed() {
  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: 'hi',
    stage: 'analyse',
  });
}

/** The hook is fire-and-forget; give its microtask a chance to run. */
async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.getStoreCalls = 0;
  storeMock.throwOnGet = false;
  storeMock.storeBriefAndProvenance.mockResolvedValue(true);
  emitSpy = vi.spyOn(telemetry, 'emit');
  vi.stubEnv('OLUMI_ENV', 'staging');
  _resetConfigCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
  emitSpy.mockRestore();
});

function storedEvents() {
  return emitSpy.mock.calls.filter(
    (c: readonly unknown[]) => c[0] === telemetry.TelemetryEvents.V5BriefProvenanceStored,
  );
}

describe('commit seam — happy path', () => {
  it('fires store_brief_and_provenance exactly once with the EXACT payload', async () => {
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-1' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(storeMock.storeBriefAndProvenance).toHaveBeenCalledTimes(1);
    expect(storeMock.storeBriefAndProvenance.mock.calls[0]![0]).toEqual({
      scenario_id: SCENARIO_ID,
      brief: BRIEF,
      graph_hash: GRAPH_HASH,
      seed_used: SEED,
      response_hash: RESPONSE_HASH,
    });
  });

  it('discloses the stored write on the frozen-registry event', async () => {
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-2' }),
    );
    await drainMicrotasks();
    const events = storedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]![1]).toMatchObject({
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      turn_row_id: 'row-2',
      status: 'ok',
    });
  });
});

describe('commit seam — byte-identical path when nothing qualifies', () => {
  it('turn without a run_analysis fact → ZERO store construction (no env reads)', async () => {
    const result = await commitDirectAnswer(
      composed(),
      meta([]),
      createNoopSessionStore({ appendId: 'row-3' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(storeMock.getStoreCalls).toBe(0);
    expect(storeMock.storeBriefAndProvenance).not.toHaveBeenCalled();
    expect(storedEvents()).toHaveLength(0);
  });

  it('noop run_analysis fact → ZERO store construction', async () => {
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact({ noop: true })]),
      createNoopSessionStore({ appendId: 'row-4' }),
    );
    await drainMicrotasks();
    expect(storeMock.getStoreCalls).toBe(0);
    expect(storeMock.storeBriefAndProvenance).not.toHaveBeenCalled();
  });

  it("refused run_analysis attempt → ZERO store construction (it carries graph_hash_at_run but no envelope)", async () => {
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact({ enrichment: { analysis_status: 'refused' } })]),
      createNoopSessionStore({ appendId: 'row-5' }),
    );
    await drainMicrotasks();
    expect(storeMock.getStoreCalls).toBe(0);
    expect(storeMock.storeBriefAndProvenance).not.toHaveBeenCalled();
  });

  it('qualifying fact with an INCOMPLETE envelope → skipped BEFORE store construction', async () => {
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact({ omitGraphHash: true })]),
      createNoopSessionStore({ appendId: 'row-6' }),
    );
    await drainMicrotasks();
    expect(storeMock.getStoreCalls).toBe(0);
    expect(storeMock.storeBriefAndProvenance).not.toHaveBeenCalled();
    expect(storedEvents()[0]![1]).toMatchObject({
      status: 'skipped',
      skip_reason: 'no_graph_hash',
    });
  });
});

describe('commit seam — non-blocking contract (never fail or block the turn)', () => {
  it('store construction throw (missing SUPABASE_* env) never affects the turn result', async () => {
    storeMock.throwOnGet = true;
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-7' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-7');
    expect(storedEvents()[0]![1]).toMatchObject({ status: 'error' });
  });

  it('a rejected RPC never affects the turn result; telemetry reports error', async () => {
    storeMock.storeBriefAndProvenance.mockRejectedValue(new Error('rpc down'));
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-8' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-8');
    expect(storedEvents()[0]![1]).toMatchObject({ status: 'error' });
  });

  it("the RPC's own all-or-nothing refusal (returns false) is disclosed, not swallowed as success", async () => {
    // `store_brief_and_provenance` returns false when any of the four is null
    // OR when no scenario row matched. Reporting that as `ok` would make a
    // silent no-write indistinguishable from a write — the exact shape of
    // defect this whole lane exists to remove.
    storeMock.storeBriefAndProvenance.mockResolvedValue(false);
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-9' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(storedEvents()[0]![1]).toMatchObject({ status: 'not_stored' });
  });
});
