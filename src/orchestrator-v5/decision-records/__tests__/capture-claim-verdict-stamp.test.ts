/**
 * Decision Records — THE CLAIM VERDICT IS STAMPED AT CAPTURE.
 *
 * DEFECT (adversarial review, altitude): a decision record asserts a
 * `chosen_option_label` — a leading-option claim. Whether the turn was
 * ENTITLED to name a leader is decided by the constraint verdict carried on
 * the very `run_analysis` fact the record is projected from. The capture hook
 * held that fact and read nothing off it, so a record captured from a WITHHELD
 * analysis was indistinguishable from one captured from a permitted analysis.
 * At review time the fact is gone and the verdict is NOT re-derivable, so the
 * read has to happen here or never.
 *
 * ⚠ SCOPE OF WHAT LANDED. The verdict rides the CAPTURE EVENT, not
 * `write.prediction`. A new persisted `prediction` key is a three-hop contract
 * change and CEE owns only the middle hop: `DecisionRecordPredictionSchema` is
 * `.strict()` (pinned by `capture.test.ts`'s ".strict() stays armed" case) and
 * `create_decision_record`'s `p_prediction` whitelist — LIVE on staging since
 * 2026-07-11T18:46Z — raises 22023 on any off-whitelist key, refusing the
 * WHOLE record. A unilateral CEE key would take the capture seam down rather
 * than add a field. See the block comment in capture.ts.
 *
 * The verdict is READ from the shared per-fact reader, never re-derived
 * (CLAUDE.md trap #12) — two derivations on one fact is exactly the defect the
 * claim-safety module was extracted to prevent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import type { CreateDecisionRecordWrite } from '../store-adapter.js';

const createRecord = vi.fn<
  (w: CreateDecisionRecordWrite) => Promise<{
    record_id: string;
    deduped: boolean;
    event_id: string | null;
  }>
>();

vi.mock('../index.js', () => ({
  getDecisionRecordStore: () => ({
    createRecord,
    retrieveRecords: async () => ({ records: [], totalCount: 0 }),
  }),
}));

const { recordDecisionRecordForCommit } = await import('../capture.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** A fact whose constraint verdict WITHHELD the leading-option claim. */
function makeFact(
  constraintVerdict: Record<string, unknown> | undefined,
  overrides?: Partial<RunAnalysisHandlerFact['result']>,
): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: 'Option A currently leads.',
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        ],
      },
      graph_hash_at_run: 'abcdef0123456789',
      computed_at: '2026-07-10T12:00:00.000Z',
      ...(constraintVerdict !== undefined ? { constraint_verdict: constraintVerdict } : {}),
      ...(overrides ?? {}),
    },
  } as unknown as RunAnalysisHandlerFact;
}

type Captured = { event: string; data: Record<string, unknown> };
let events: Captured[] = [];

beforeEach(() => {
  events = [];
  createRecord.mockReset();
  createRecord.mockResolvedValue({
    record_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    deduped: false,
    event_id: null,
  });
  setTestSink((event, data) => {
    events.push({ event, data });
  });
});

afterEach(() => {
  setTestSink(null);
});

function captureEvent(): Record<string, unknown> {
  const found = events.find((e) => e.event === TelemetryEvents.V5DecisionRecordCaptured);
  if (!found) throw new Error('no capture event emitted');
  return found.data;
}

const ARGS_BASE = {
  scenarioId: SCENARIO_ID,
  turnId: TURN_ID,
  persistedRowId: 'row-1',
  sessionStore: {},
};

describe('decision-record capture — claim verdict stamped from the projected fact', () => {
  it('stamps a WITHHELD verdict on the captured record event', async () => {
    await recordDecisionRecordForCommit({
      ...ARGS_BASE,
      fact: makeFact({
        may_name_leading_option: false,
        constraint_verdict_state: 'evaluated_infeasible',
      }),
    });

    expect(createRecord).toHaveBeenCalledTimes(1);
    const data = captureEvent();
    expect(data.status).toBe('ok');
    expect(data.may_name_leading_option).toBe(false);
    expect(data.constraint_verdict_state).toBe('evaluated_infeasible');
    expect(data.claim_verdict_provenance).toBe('scenario_fact');
  });

  it('stamps a PERMITTED verdict, so the two populations are distinguishable', async () => {
    await recordDecisionRecordForCommit({
      ...ARGS_BASE,
      fact: makeFact({
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      }),
    });

    const data = captureEvent();
    expect(data.may_name_leading_option).toBe(true);
    expect(data.constraint_verdict_state).toBe('evaluated_feasible');
  });

  it('fails CLOSED on an unstamped fact — an unknown verdict is not a permitted one', async () => {
    await recordDecisionRecordForCommit({ ...ARGS_BASE, fact: makeFact(undefined) });

    const data = captureEvent();
    // The shared reader's own fail-closed branch: a run_analysis fact carrying
    // no verdict must not read as entitled.
    expect(data.may_name_leading_option).toBe(false);
    expect(data.constraint_verdict_state).toBeNull();
  });

  it('stamps the verdict on a SKIPPED capture too — a withhold rate needs the denominator', async () => {
    await recordDecisionRecordForCommit({
      ...ARGS_BASE,
      // No leading option ⇒ builder skips before the RPC.
      fact: makeFact(
        { may_name_leading_option: false, constraint_verdict_state: 'evaluated_infeasible' },
        { leading_option_id: undefined },
      ),
    });

    expect(createRecord).not.toHaveBeenCalled();
    const data = captureEvent();
    expect(data.status).toBe('skipped');
    expect(data.skip_reason).toBe('no_leading_option');
    expect(data.may_name_leading_option).toBe(false);
    expect(data.constraint_verdict_state).toBe('evaluated_infeasible');
  });

  it('stays content-free: no option label, statement or probability on the event', async () => {
    await recordDecisionRecordForCommit({
      ...ARGS_BASE,
      fact: makeFact({ may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' }),
    });

    const serialised = JSON.stringify(captureEvent());
    expect(serialised).not.toContain('Option A');
    expect(serialised).not.toContain('currently leads');
    expect(serialised).not.toContain('0.62');
  });
});
