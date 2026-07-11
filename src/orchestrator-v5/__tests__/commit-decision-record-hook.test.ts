/**
 * ROADMAP 3.1 (CEE half) — commit-seam decision-record capture hook
 * (CEE_DECISION_RECORD_CAPTURE, ships DARK — migration #406 is merged but
 * UNEXECUTED, so the RPC does not exist yet; everything here mocks the
 * client boundary).
 *
 * Pins (mirrors commit-model-version-hook.test.ts):
 *  - flag OFF ⇒ byte-identical commit path: the decision-record store is
 *    NEVER constructed (no env reads, no RPC), even on commits carrying a
 *    successful run_analysis fact — AND the commit result JSON is
 *    byte-identical to the flag-ON result (JSON-additivity pin: the hook
 *    never touches the turn, on or off);
 *  - flag ON + successful run_analysis fact ⇒ fire-and-forget
 *    create_decision_record with the EXACT payload (aag_v1-prefixed
 *    fact-carried graph hash, leading option id + resolved label,
 *    deterministic record_id/event_id, computed_at+90d review_date);
 *  - deterministic ids stable across a retried commit (RPC replay branch
 *    dedupes — never a duplicate record);
 *  - GUEST SHORT-CIRCUIT: unowned scenario (getScenarioOwner → null) skips
 *    capture entirely BEFORE any store construction / RPC call (log-only —
 *    DR001 refuses guests by design; no error may ever surface);
 *  - non-blocking contract: store-construction throw, RPC rejection, and
 *    the authoritative DR001 refusal NEVER affect the turn result;
 *  - optional-forward analysis_summary: absent decision_brief (the normal
 *    case today — PLoT emits it behind its own flag) still records;
 *  - no capture for noop facts / turns without a run_analysis fact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    createRecord: vi.fn(),
    getStoreCalls: 0,
    throwOnGet: false,
  },
}));

vi.mock('../decision-records/index.js', () => ({
  getDecisionRecordStore: vi.fn(() => {
    storeMock.getStoreCalls += 1;
    if (storeMock.throwOnGet) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    return { createRecord: storeMock.createRecord };
  }),
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { _resetConfigCache } from '../../config/index.js';
import * as telemetry from '../../utils/telemetry.js';
import {
  AAG_V1_GRAPH_HASH_PREFIX,
  deriveDecisionRecordId,
} from '../decision-records/capture.js';
import { DecisionRecordSignInRequiredError } from '../decision-records/store-adapter.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH_AT_RUN = 'abcdef0123456789';
const COMPUTED_AT = '2026-07-10T12:00:00.000Z';
const SUMMARY = 'Option A currently leads.';

function makeRunAnalysisFact(overrides?: {
  noop?: boolean;
  result?: Partial<RunAnalysisHandlerFact['result']>;
}): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides?.noop ?? false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: SUMMARY,
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
        ],
      },
      graph_hash_at_run: HASH_AT_RUN,
      computed_at: COMPUTED_AT,
      ...(overrides?.result ?? {}),
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
  return composeDirectAnswerResponse({ assistant_text: 'hi', stage: 'analyse' });
}

/** Owned-scenario store: the guest pre-check resolves an owner. */
function ownedStore(appendId = 'row-1') {
  return createNoopSessionStore({
    appendId,
    getScenarioOwnerBehaviour: { value: 'owner-user-id' },
  });
}

/** The hook is fire-and-forget; give its microtask a chance to run. */
async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const EXPECTED_GRAPH_HASH = `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`;
const EXPECTED_RECORD_ID = deriveDecisionRecordId(SCENARIO_ID, EXPECTED_GRAPH_HASH, COMPUTED_AT);

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.getStoreCalls = 0;
  storeMock.throwOnGet = false;
  storeMock.createRecord.mockResolvedValue({
    record_id: EXPECTED_RECORD_ID,
    deduped: false,
    event_id: `decision_recorded_${EXPECTED_RECORD_ID}`,
  });
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
  emitSpy.mockRestore();
});

function setFlag(on: boolean): void {
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_DECISION_RECORD_CAPTURE', on ? 'true' : 'false');
  _resetConfigCache();
}

function captureEvents() {
  return emitSpy.mock.calls.filter(
    (c: readonly unknown[]) => c[0] === telemetry.TelemetryEvents.V5DecisionRecordCaptured,
  );
}

describe('flag OFF — inert, byte-identical commit path', () => {
  it('never constructs the store, even on a run_analysis-fact commit', async () => {
    setFlag(false);
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      ownedStore(),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(storeMock.getStoreCalls).toBe(0);
    expect(storeMock.createRecord).not.toHaveBeenCalled();
    expect(captureEvents()).toHaveLength(0);
  });

  it('JSON-additivity pin: flag-off and flag-on commit results are byte-identical (the hook never touches the turn)', async () => {
    setFlag(false);
    const off = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      ownedStore('row-pin'),
    );
    await drainMicrotasks();
    setFlag(true);
    const on = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      ownedStore('row-pin'),
    );
    await drainMicrotasks();
    expect(JSON.stringify(off)).toBe(JSON.stringify(on));
  });
});

describe('flag ON — happy path', () => {
  it('fires create_decision_record exactly once with the EXACT payload', async () => {
    setFlag(true);
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      ownedStore('row-2'),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(storeMock.createRecord).toHaveBeenCalledTimes(1);
    expect(storeMock.createRecord.mock.calls[0]![0]).toEqual({
      scenario_id: SCENARIO_ID,
      decision: {
        chosen_option_id: 'opt_a',
        chosen_option_label: 'Option A',
        graph_hash: EXPECTED_GRAPH_HASH,
      },
      // confidence_source stamped on every write from this seam (0.16.0
      // addendum — no user-stated path exists here; calibration honesty §2).
      prediction: { statement: SUMMARY, confidence: 0.62, confidence_source: 'model_derived' },
      review_date: '2026-10-08T12:00:00.000Z', // computed_at + 90 days
      record_id: EXPECTED_RECORD_ID,
      event_id: `decision_recorded_${EXPECTED_RECORD_ID}`,
    });
    const events = captureEvents();
    expect(events).toHaveLength(1);
    expect(events[0]![1]).toMatchObject({
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      turn_row_id: 'row-2',
      status: 'ok',
      record_id: EXPECTED_RECORD_ID,
    });
  });

  it('deterministic ids: a retried commit of the SAME fact carries the SAME record_id + event_id (RPC replay = dedupe)', async () => {
    setFlag(true);
    await commitDirectAnswer(composed(), meta([makeRunAnalysisFact()]), ownedStore());
    await commitDirectAnswer(composed(), meta([makeRunAnalysisFact()]), ownedStore());
    await drainMicrotasks();
    expect(storeMock.createRecord).toHaveBeenCalledTimes(2);
    const [first, second] = storeMock.createRecord.mock.calls.map(
      (c) => c[0] as { record_id: string; event_id: string },
    );
    expect(first!.record_id).toBe(second!.record_id);
    expect(first!.event_id).toBe(second!.event_id);
  });

  it('deduped outcome reports status=deduped on the telemetry event', async () => {
    setFlag(true);
    storeMock.createRecord.mockResolvedValue({
      record_id: EXPECTED_RECORD_ID,
      deduped: true,
      event_id: null,
    });
    await commitDirectAnswer(composed(), meta([makeRunAnalysisFact()]), ownedStore());
    await drainMicrotasks();
    expect(captureEvents()[0]![1]).toMatchObject({ status: 'deduped' });
  });

  it('optional-forward: absent decision_brief.analysis_summary (the normal case today) still records, with NO analysis_summary key', async () => {
    setFlag(true);
    await commitDirectAnswer(composed(), meta([makeRunAnalysisFact()]), ownedStore());
    await drainMicrotasks();
    const write = storeMock.createRecord.mock.calls[0]![0] as {
      decision: Record<string, unknown>;
    };
    expect('analysis_summary' in write.decision).toBe(false);
  });

  it('present + valid decision_brief.analysis_summary is copied verbatim', async () => {
    setFlag(true);
    const analysisSummary = {
      leading_option: 'Option A',
      win_probability: 0.62,
      goal_fit: 0.8,
      robustness_band: 'robust',
    };
    await commitDirectAnswer(
      composed(),
      meta([
        makeRunAnalysisFact({
          result: {
            enrichment: {
              option_comparison: [
                { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
              ],
              decision_brief: { analysis_summary: analysisSummary },
            },
          },
        }),
      ]),
      ownedStore(),
    );
    await drainMicrotasks();
    const write = storeMock.createRecord.mock.calls[0]![0] as {
      decision: { analysis_summary?: unknown };
    };
    expect(write.decision.analysis_summary).toEqual(analysisSummary);
  });
});

describe('flag ON — guest short-circuit (BEFORE any RPC)', () => {
  it('unowned scenario (getScenarioOwner → null) → zero store construction, zero RPC calls, log-only', async () => {
    setFlag(true);
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({
        appendId: 'row-guest',
        getScenarioOwnerBehaviour: { value: null },
      }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(storeMock.createRecord).not.toHaveBeenCalled();
    expect(storeMock.getStoreCalls).toBe(0);
    // Log-only by design (the MM WARN-spam lesson): no capture event either.
    expect(captureEvents()).toHaveLength(0);
  });

  it('pre-check unavailable (store without getScenarioOwner) → fails open to the RPC, which answers authoritatively', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-no-precheck' }),
    );
    await drainMicrotasks();
    expect(storeMock.createRecord).toHaveBeenCalledTimes(1);
  });

  it('authoritative DR001 refusal on the fail-open path is swallowed as the expected guest outcome (turn unaffected)', async () => {
    setFlag(true);
    storeMock.createRecord.mockRejectedValue(
      new DecisionRecordSignInRequiredError('create_decision_record RPC failed: DR001'),
    );
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      createNoopSessionStore({ appendId: 'row-dr001' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-dr001');
    expect(captureEvents()[0]![1]).toMatchObject({ status: 'guest_refused' });
  });
});

describe('flag ON — non-blocking contract (never fail or block the turn)', () => {
  it('store construction throw (missing SUPABASE_* env) never affects the turn result', async () => {
    setFlag(true);
    storeMock.throwOnGet = true;
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      ownedStore('row-3'),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-3');
  });

  it('a rejected createRecord never affects the turn result; telemetry reports error', async () => {
    setFlag(true);
    storeMock.createRecord.mockRejectedValue(new Error('rpc down'));
    const result = await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact()]),
      ownedStore('row-4'),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-4');
    expect(captureEvents()[0]![1]).toMatchObject({ status: 'error' });
  });
});

describe('flag ON — capture scope', () => {
  it('noop run_analysis fact → no capture', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact({ noop: true })]),
      ownedStore(),
    );
    await drainMicrotasks();
    expect(storeMock.createRecord).not.toHaveBeenCalled();
    expect(storeMock.getStoreCalls).toBe(0);
  });

  it('turn without a run_analysis fact → no capture', async () => {
    setFlag(true);
    await commitDirectAnswer(composed(), meta([]), ownedStore());
    await drainMicrotasks();
    expect(storeMock.createRecord).not.toHaveBeenCalled();
    expect(storeMock.getStoreCalls).toBe(0);
  });

  it('no unambiguous leader (leading_option_id null) → skipped before the RPC, disclosed via telemetry', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      meta([makeRunAnalysisFact({ result: { leading_option_id: null } })]),
      ownedStore(),
    );
    await drainMicrotasks();
    expect(storeMock.createRecord).not.toHaveBeenCalled();
    expect(storeMock.getStoreCalls).toBe(0);
    expect(captureEvents()[0]![1]).toMatchObject({
      status: 'skipped',
      skip_reason: 'no_leading_option',
    });
  });
});
