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
import { log } from '../../../../utils/telemetry.js';

const happyFixture = JSON.parse(
  readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8'),
) as V2RunResponseEnvelope;

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-goal-direction-wire';

function graphWithGoalLabel(
  label: string,
  goalExtra: Record<string, unknown> = {},
  factorExtra: Record<string, unknown> = {},
): GraphV3T {
  return GraphV3.parse(rawGraphWithGoalLabel(label, goalExtra, factorExtra));
}

/** The same graph WITHOUT the NodeV3 parse — what a stored graph looks like before the loader. */
function rawGraphWithGoalLabel(
  label: string,
  goalExtra: Record<string, unknown> = {},
  factorExtra: Record<string, unknown> = {},
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  return {
    nodes: [
      { id: 'goal_metric', kind: 'goal', label, ...goalExtra },
      { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { fac_lever: 0.8 } },
      { id: 'opt_b', kind: 'option', label: 'Option B', interventions: { fac_lever: 0.2 } },
      { id: 'fac_lever', kind: 'factor', label: 'Lever', ...factorExtra },
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
  };
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
async function payloadForGoalLabel(label: string): Promise<Record<string, unknown>> {
  return payloadForGraph(graphWithGoalLabel(label));
}

async function payloadForGraph(graph: unknown): Promise<Record<string, unknown>> {
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
 * THE ATTESTED SENSE — the goal node's `goal_direction` (CEE-minted from the user's
 * stated goal operator at construction; NodeV3 carries it) is forwarded AHEAD of the
 * label classifier, in both senses. Bound at the payload PLoT receives and at the
 * handler's own `cee.goal_direction.*` records.
 */
describe('an attested goal_direction on the goal node reaches the PLoT payload', () => {
  async function withDirectionLog(graph: unknown): Promise<{
    payload: Record<string, unknown>;
    events: Array<{ level: 'info' | 'warn' } & Record<string, unknown>>;
  }> {
    const infoSpy = vi.spyOn(log, 'info');
    const warnSpy = vi.spyOn(log, 'warn');
    try {
      const payload = await payloadForGraph(graph);
      const events: Array<{ level: 'info' | 'warn' } & Record<string, unknown>> = [];
      for (const [level, spy] of [['info', infoSpy], ['warn', warnSpy]] as const) {
        for (const [first] of spy.mock.calls as unknown[][]) {
          const rec = first as Record<string, unknown> | undefined;
          if (typeof rec?.event === 'string' && rec.event.startsWith('cee.goal_direction.')) events.push({ level, ...rec });
        }
      }
      return { payload, events };
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  }

  it('an attested maximise on a label that names no direction is SENT (not byte-identical to absent at the wire)', async () => {
    const { payload, events } = await withDirectionLog(graphWithGoalLabel('Revenue', { goal_direction: 'maximise' }));
    expect(payload.goal_direction).toBe('maximise');
    expect(events).toEqual([
      expect.objectContaining({
        level: 'info', event: 'cee.goal_direction.attested', goal_direction: 'maximise',
        goal_node_id: 'goal_metric', provenance: 'attested_from_goal_operator', label_derived: null,
      }),
    ]);
  });

  it('an attested minimise on a label that names no direction is sent as minimise', async () => {
    const { payload, events } = await withDirectionLog(graphWithGoalLabel('Revenue', { goal_direction: 'minimise' }));
    expect(payload.goal_direction).toBe('minimise');
    expect(events.map((e) => e.event)).toEqual(['cee.goal_direction.attested']);
  });

  it('the attested sense WINS against a label that reads the other way, and the disagreement is recorded', async () => {
    const { payload, events } = await withDirectionLog(
      graphWithGoalLabel('Minimise monthly churn', { goal_direction: 'maximise' }),
    );
    expect(payload.goal_direction).toBe('maximise');
    expect(events).toEqual([
      expect.objectContaining({ level: 'info', event: 'cee.goal_direction.attested', label_derived: 'minimise' }),
      expect.objectContaining({
        level: 'warn', event: 'cee.goal_direction.label_disagrees', goal_direction: 'maximise',
        label_derived: 'minimise', goal_node_id: 'goal_metric', provenance: 'attested_from_goal_operator',
      }),
    ]);
  });

  it('an attested sense that AGREES with the label records no disagreement', async () => {
    const { payload, events } = await withDirectionLog(
      graphWithGoalLabel('Minimise monthly churn', { goal_direction: 'minimise' }),
    );
    expect(payload.goal_direction).toBe('minimise');
    expect(events.map((e) => e.event)).toEqual(['cee.goal_direction.attested']);
  });

  it('a sense on a NON-goal node is not the goal\'s sense: nothing attested, the label decides', async () => {
    const { payload, events } = await withDirectionLog(
      graphWithGoalLabel('Revenue', {}, { goal_direction: 'minimise' }),
    );
    expect('goal_direction' in payload).toBe(false);
    expect(events).toEqual([]);
  });

  // ── THE GOAL IS BOUND BY IDENTITY: `snapshot.goal_node_id` AND kind 'goal' ──
  // A graph can hold more than one goal node. Only the one the Run is FOR may lend
  // its sense to the request; the first goal node in array order is not the goal.
  /** Two goal nodes: the FIRST (not the run's goal) carries maximise; `goal_metric` is the run's goal. */
  function twoGoalGraph(runGoalLabel: string, runGoalExtra: Record<string, unknown>): GraphV3T {
    const g = rawGraphWithGoalLabel(runGoalLabel, runGoalExtra);
    return GraphV3.parse({
      ...g,
      nodes: [{ id: 'goal_other', kind: 'goal', label: 'Brand reach', goal_direction: 'maximise' }, ...g.nodes],
    });
  }

  it('two goal nodes: the RUN goal\'s own minimise is sent, never the first goal node\'s maximise', async () => {
    const { payload, events } = await withDirectionLog(twoGoalGraph('Revenue', { goal_direction: 'minimise' }));
    expect(payload.goal_node_id).toBe('goal_metric');
    expect(payload.goal_direction).toBe('minimise');
    expect(events).toEqual([
      expect.objectContaining({ level: 'info', event: 'cee.goal_direction.attested', goal_direction: 'minimise', goal_node_id: 'goal_metric' }),
    ]);
  });

  it('two goal nodes: a run goal with NO sense falls back to its own label, never borrowing the other goal\'s maximise', async () => {
    const { payload, events } = await withDirectionLog(twoGoalGraph('Minimise monthly churn', {}));
    expect(payload.goal_direction).toBe('minimise');
    expect(events.map((e) => [e.event, e.provenance])).toEqual([['cee.goal_direction.derived', 'derived_from_goal_label']]);
  });

  it('a node carrying the run goal\'s id but NOT kind goal is not the goal: nothing attested', async () => {
    const { payload, events } = await withDirectionLog(
      graphWithGoalLabel('Revenue', { kind: 'outcome', goal_direction: 'minimise' }),
    );
    expect('goal_direction' in payload).toBe(false);
    expect(events).toEqual([]);
  });

  it('an unrecognised sense on the goal node is never forwarded; the label fallback still runs', async () => {
    // Raw (unparsed) on purpose: this pins the forwarder's own guard, not NodeV3's.
    const { payload, events } = await withDirectionLog(
      rawGraphWithGoalLabel('Minimise monthly churn', { goal_direction: 'target' }),
    );
    expect(payload.goal_direction).toBe('minimise');
    expect(events.map((e) => [e.event, e.provenance])).toEqual([['cee.goal_direction.derived', 'derived_from_goal_label']]);
  });
});
