/**
 * ⭐⭐⭐ DOES THE CORRECTED LIMIT ACTUALLY REACH PLoT? — the boundary Codex has
 * named six times and I had not produced (CX240/253/255/262/264/267).
 *
 * Everything shipped before this proves the WRITE. None of it proves the saved
 * input is what the engine is asked to score. A chip appearing, a warning
 * disappearing and a stored row are three different things, and none of them
 * is this one.
 *
 * WHAT THIS IS: the REAL `run_analysis` handler, driven end to end, with the
 * PLoT transport replaced by a CAPTURE. The payload asserted below is the
 * object the handler actually hands the client — not a reconstruction, not a
 * reading of the assembly code.
 *
 * ⛔ WHAT THIS IS NOT, stated so nobody upgrades it by accident:
 *   · NOT a wire witness — the transport is stubbed, so nothing here shows
 *     bytes leaving the process.
 *   · NOT proof PLoT SCORED it. It proves the intended input ARRIVES with the
 *     fields PLoT needs. Scoring can still be refused downstream by the unit
 *     gate, the range gate or the temporal drop.
 *   · NOT a journey witness — no draft, no user, no deployed build.
 * Status ladder: TESTED. Stubbed PLoT + stubbed scenario reader.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEST = 'f_hiring_cost';
const SOURCE = 'r_overrun';

const edge = (id: string, from: string, to: string) => ({
  id, from, to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

/** Paul's shape: a money limit, a risk that cannot carry it, a measured cost factor. */
const GRAPH = {
  version: '1',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Bridge the gap' },
    { id: 'decision', kind: 'decision', label: 'Hiring' },
    // The destination: a ROOT (no factor parent) carrying a finite observed value.
    {
      id: DEST, kind: 'factor', label: 'Hiring and Onboarding Cost',
      category: 'controllable',
      observed_state: { value: 0.6, raw_value: 150000, cap: 250000, unit: '£' },
    },
    { id: SOURCE, kind: 'risk', label: 'Budget Overrun Risk', observed_state: null },
    { id: 'opt_a', kind: 'option', label: 'Hire a lead', interventions: { [DEST]: 0.4 } },
    { id: 'opt_b', kind: 'option', label: 'Two developers', interventions: { [DEST]: 0.8 } },
  ],
  edges: [
    edge('e1', 'decision', 'opt_a'), edge('e2', 'decision', 'opt_b'),
    edge('e3', 'opt_a', DEST), edge('e4', 'opt_b', DEST),
    edge('e5', DEST, 'goal'), edge('e6', SOURCE, 'goal'),
  ],
};

/** What the CORRECTION leaves behind: one row, on the destination, frame intact. */
const CORRECTED = [{
  constraint_id: 'gc-moved', node_id: DEST, operator: '<=',
  value: 200000, unit: 'GBP', provenance: 'explicit', value_frame: 'level',
}];

/** What the defect left behind: the limit still on the risk node. */
const UNCORRECTED = [{
  constraint_id: 'gc-wrong', node_id: SOURCE, operator: '<=',
  value: 200000, unit: 'GBP', provenance: 'explicit', value_frame: 'level',
}];

function capturingClient(): { client: PLoTClient; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'corrected-limit' },
    response_hash: 'corrected-limit',
    analysis_status: 'computed',
    option_comparison: [
      { option_id: 'opt_a', option_label: 'Hire a lead', win_probability: 0.6, status: 'computed' },
      { option_id: 'opt_b', option_label: 'Two developers', win_probability: 0.4, status: 'computed' },
    ],
    factor_sensitivity: [],
  } as unknown as V2RunResponseEnvelope;
  const client = {
    run: vi.fn((payload: Record<string, unknown>) => {
      sent.push(JSON.parse(JSON.stringify(payload)) as Record<string, unknown>);
      return Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope);
    }),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
  return { client, sent };
}

function reader(goalConstraints: unknown): ScenarioReader {
  const snapshot = {
    graph: GRAPH,
    options: GRAPH.nodes.filter((n) => n.kind === 'option'),
    goal_node_id: 'goal',
    rawPersistedGraph: GRAPH,
    goal_constraints: goalConstraints,
  } as unknown as RunAnalysisScenarioSnapshot;
  return (() => Promise.resolve(snapshot)) as ScenarioReader;
}

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO,
      request_id: 'req-corrected-limit',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: 'turn-1',
      stage: 'analyse', message: 'run the analysis',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-corrected-limit',
    signal: new AbortController().signal,
    orientationText: '',
    proposal: { handler_id: 'run_analysis', entity: { id: 'goal', kind: 'goal', resolution_status: 'resolved', resolution_method: 'id_match' }, parameters: [], cited_context_fields: [] } as never,
    graphForTurn: GRAPH as never,
  };
}

async function send(goalConstraints: unknown) {
  const { client, sent } = capturingClient();
  const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: reader(goalConstraints) });
  await handler(invocation());
  return sent[0];
}

describe('the corrected limit reaches PLoT', () => {
  it('⭐⭐ the saved corrected row IS in the payload — on the destination, with its unit and frame', async () => {
    const payload = await send(CORRECTED);
    expect(payload).toBeDefined();
    const rows = payload!.goal_constraints as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      node_id: DEST, operator: '<=', value: 200000, unit: 'GBP', value_frame: 'level',
    });
  });

  it('⭐ the limit is NOT sent against the node that could not carry it', async () => {
    const rows = (await send(CORRECTED))!.goal_constraints as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.node_id === SOURCE)).toBe(false);
  });

  it('⭐⭐ `value_frame` survives to the payload — an unstamped limit deletes EVERY sibling verdict', async () => {
    // ISL fail-closes an unstamped constraint by omitting the ENTIRE
    // constraint_analysis block, so this field carries a RUN-WIDE property, not
    // a per-row nicety (PLoT intervention-normaliser.ts:1841-1843).
    const rows = (await send(CORRECTED))!.goal_constraints as Array<Record<string, unknown>>;
    expect(rows[0]).toHaveProperty('value_frame', 'level');
  });

  it('⭐ the target PLoT is asked to score carries the figure that anchors it', async () => {
    // Without a finite observed_state.value on a root, PLoT cannot anchor the
    // sample frame and suppresses the constraint silently.
    const payload = await send(CORRECTED);
    const graph = payload!.graph as { nodes: Array<Record<string, unknown>> };
    const target = graph.nodes.find((n) => n.id === DEST);
    const observed = target?.observed_state as { value?: unknown } | undefined;
    expect(typeof observed?.value).toBe('number');
    expect(Number.isFinite(observed?.value as number)).toBe(true);
  });

  it('⛔ CONTRAST — uncorrected, the limit still rides the risk node into PLoT', async () => {
    // Without this arm the assertions above could pass because the payload
    // always looks like that, rather than because the correction did anything.
    const rows = (await send(UNCORRECTED))!.goal_constraints as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ node_id: SOURCE });
    const graph = (await send(UNCORRECTED))!.graph as { nodes: Array<Record<string, unknown>> };
    const risk = graph.nodes.find((n) => n.id === SOURCE);
    // And the node it rides carries nothing to score against — the defect.
    expect(risk?.observed_state ?? null).toBeNull();
  });
});
