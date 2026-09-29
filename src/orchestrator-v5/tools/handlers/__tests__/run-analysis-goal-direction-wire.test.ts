/**
 * THE WIRE SEAM FOR `goal_direction` — the assertion the feature was missing.
 *
 * ⚠ WHY THIS FILE EXISTS. The original suite for ROADMAP 2.920 tested the pure
 * function only. An independent review mutated the single non-comment
 * assignment (`run-analysis.ts:894` → discard the derived direction, i.e.
 * restore today's broken behaviour) and it SURVIVED the whole required set:
 * 2,447 files, 43,884 tests, exit 0. Reverting the fix turned nothing red, so
 * nothing in the repo asserted that the direction ever reaches PLoT.
 *
 * These assertions bind the PAYLOAD PLoT ACTUALLY RECEIVES, captured through
 * the real handler with a mocked client — the same harness
 * `run-analysis-merged-graph.test.ts` uses.
 *
 * ⚠ SCOPE. This proves CEE puts the key on the wire. It says nothing about
 * ISL's behaviour on receipt (measured separately against isl-staging and
 * recorded in `goal-direction.ts`'s header), and nothing about incidence.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';

const happyFixture = JSON.parse(
  readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8'),
) as V2RunResponseEnvelope;

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-goal-direction-wire';

/** A current level on the goal as admission writes it (`admitStatedGoalLevel`), in `unit`, stamped `source`. */
type GoalLevel = { readonly unit: string; readonly targetUnit: string; readonly source: string };
function graphWithGoalLabel(label: string, held?: string, level?: GoalLevel): GraphV3T {
  return GraphV3.parse({
    nodes: [
      {
        id: 'goal_metric', kind: 'goal', label, ...(held !== undefined ? { goal_direction: held } : {}),
        ...(level !== undefined ? {
          goal_threshold: 0.8, goal_threshold_raw: 36, goal_threshold_cap: 45, goal_threshold_unit: level.targetUnit,
          observed_state: { value: 1, baseline: 1, raw_value: 45, cap: 45, unit: level.unit, source: level.source },
        } : {}),
      },
      { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { fac_lever: 0.8 } },
      { id: 'opt_b', kind: 'option', label: 'Option B', interventions: { fac_lever: 0.2 } },
      { id: 'fac_lever', kind: 'factor', label: 'Lever' },
    ],
    edges: [
      {
        from: 'fac_lever',
        to: 'goal_metric',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  });
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

/** Drive the real handler and return the payload PLoT received. */
async function payloadForGoalLabel(label: string, held?: string, level?: GoalLevel): Promise<Record<string, unknown>> {
  const graph = graphWithGoalLabel(label, held, level);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_lever: 0.8 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_lever: 0.2 } },
    ],
    goal_node_id: 'goal_metric',
    rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));

  let captured: Record<string, unknown> | undefined;
  const run = vi.fn((payload: Record<string, unknown>) => {
    captured = payload;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;

  await createRunAnalysisHandler({ plotClient, scenarioReader })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  return captured as Record<string, unknown>;
}

describe('goal_direction reaches the PLoT payload', () => {
  it('a REDUCE goal puts goal_direction=minimise ON THE WIRE', async () => {
    const payload = await payloadForGoalLabel('Minimise monthly churn');
    expect(payload.goal_direction).toBe('minimise');
  });

  it('CONTROL: an INCREASE goal sends no key at all', async () => {
    const payload = await payloadForGoalLabel('Grow monthly revenue');
    expect('goal_direction' in payload).toBe(false);
  });

  it('CONTROL: an undetermined goal sends no key at all', async () => {
    const payload = await payloadForGoalLabel('Revenue');
    expect('goal_direction' in payload).toBe(false);
  });

  // ── the measured false positives ────────────────────────────────────────
  // Each names a quantity the user wants to RISE. Before the hyphen fix these
  // classified `decrease` and would have INVERTED the engine's ranking.
  for (const label of [
    'Lower-funnel conversion rate',
    'Cut-through in the market',
    'Drop-in session bookings',
    'Lower-tier subscription revenue',
    'Cut-price volume share',
  ]) {
    it(`a hyphenated compound is not a direction verb: "${label}"`, async () => {
      const payload = await payloadForGoalLabel(label);
      expect('goal_direction' in payload).toBe(false);
    });
  }


  // ── THE FEATURE'S ONLY REAL HITS, PINNED AT THE WIRE ────────────────────
  // These are the two labels the repo's externally-harvested 73-label corpus
  // classifies as `decrease` (harvested 2026-08-14 at CEE 73ea84e6). Reach is
  // 2 of 73 (2.7%), measured — this is deliberately NOT a broad capability.
  // They are pinned here because the gates above (hyphen boundary, subject
  // conjunction) each narrow the classifier, and a future tightening that
  // suppressed these would leave the feature emitting nothing at all while
  // every other test still passed. Measured: neither is suppressed today.
  for (const label of ['Minimise TCO over 3 years', 'Minimize long-term energy costs']) {
    it(`corpus decrease label still reaches the wire: "${label}"`, async () => {
      const payload = await payloadForGoalLabel(label);
      expect(payload.goal_direction).toBe('minimise');
    });
  }

  // ── consumed inside its validated conjunction ───────────────────────────
  for (const label of ['Reduce', 'Cost reduced']) {
    it(`a direction with no subject names no quantity: "${label}"`, async () => {
      const payload = await payloadForGoalLabel(label);
      expect('goal_direction' in payload).toBe(false);
    });
  }
});

/**
 * ⭐ THE USER'S HELD COMPARATOR COMES FIRST (MG #72 5870097103). Construction holds `goal_direction` on the goal node
 * only beside a target the user wrote (G1). A held ceiling sends `minimise` whatever the label says (the label
 * classifier reads nothing for "Monthly spend") — ONLY beside the level the user stated in the target's unit (R1 S1,
 * AIQ 5871459631); a held floor sends nothing, whatever the label says.
 */
describe('a held comparator on the goal node decides goal_direction before the label', () => {
  const STATED: GoalLevel = { unit: '£k/month', targetUnit: '£k/month', source: 'brief_extraction' };
  for (const held of ['<=', '<']) {
    it(`RED: held "${held}" beside the level the user stated in the target's unit ("Monthly spend") → minimise`, async () => {
      const payload = await payloadForGoalLabel('Monthly spend', held, STATED);
      expect(payload.goal_direction).toBe('minimise');
    });
  }

  // AIQ R1 ruling 5871459631: a ceiling sends `minimise` ONLY when its target is a LEVEL of the node — proven, before
  // R1 types the frame, by the user's stated level in the target's own unit. Otherwise silence (UNATTESTED stays).
  it('R1 S1: held "<=" with NO stated level → no key (no proof the target is a level of the node)', async () => {
    const payload = await payloadForGoalLabel('Monthly spend', '<=');
    expect('goal_direction' in payload).toBe(false);
  });

  it('R1 S1: held "<=" on a CHANGE target ("% reduction") beside a £ level → no key ("reduce costs by at most 10%" is a floor on cost)', async () => {
    const payload = await payloadForGoalLabel('costs', '<=', { ...STATED, targetUnit: '% reduction' });
    expect('goal_direction' in payload).toBe(false);
  });

  // AIQ 5872082179: on the brief route level and target share one unit, so a PERCENT or POINTS ceiling passes the unit
  // check by construction ("gross margin 30%, reduce by at most 2%" is a floor). Until S4 types the frame: nothing sent.
  for (const u of ['%', 'percentage points', 'pp', 'bps', 'points', 'NPS points']) {
    it(`R1 S1 (AIQ 5872082179): held "<=" in "${u}" beside the user's level in the same unit → no key`, async () => {
      const payload = await payloadForGoalLabel('Gross margin', '<=', { unit: u, targetUnit: u, source: 'brief_extraction' });
      expect('goal_direction' in payload).toBe(false);
    });
  }

  it('R1 S1: held "<=" beside a level the user GAVE IN CHAT (user_override, approved) → minimise', async () => {
    const payload = await payloadForGoalLabel('Monthly spend', '<=', { ...STATED, source: 'user_override' });
    expect(payload.goal_direction).toBe('minimise');
  });

  it('R1 S1: held "<=" beside a level that is Olumi\'s estimate (cee_inference), not the user\'s → no key', async () => {
    const payload = await payloadForGoalLabel('Monthly spend', '<=', { ...STATED, source: 'cee_inference' });
    expect('goal_direction' in payload).toBe(false);
  });

  // DL E13 (5872375159): a held floor reads exactly as base — the label decides (its own sense is S4's).
  for (const held of ['>=', '>']) {
    it(`held "${held}" + a label that reads reduce ("Minimise monthly churn") → minimise from the LABEL, exactly as base`, async () => {
      const payload = await payloadForGoalLabel('Minimise monthly churn', held);
      expect(payload.goal_direction).toBe('minimise');
    });
  }
  it('an UNPROVEN held "<=" + a label that reads reduce → minimise from the LABEL, exactly as base', async () => {
    const payload = await payloadForGoalLabel('Minimise monthly churn', '<=');
    expect(payload.goal_direction).toBe('minimise');
  });

  it('CONTROL: no held comparator ("Monthly spend") → no key, exactly as before', async () => {
    const payload = await payloadForGoalLabel('Monthly spend');
    expect('goal_direction' in payload).toBe(false);
  });
});
