/**
 * ⭐ THE EXISTING-ROUTE WITNESS for the native-quantity loop (Codex CX-68).
 *
 * The component specs prove the pieces. This proves the ROUTE: a live
 * `elicit_option_native_quantity` pending, a real reply, and what the
 * dispatcher actually hands to the applier.
 *
 * ⚠⚠ IT ASSERTS THE NEGATIVE CASE AS CAREFULLY AS THE POSITIVE, because the
 * reviewer's exact words were: "builder-null followed by LLM fallback is not
 * proof the whole turn refuses". A refusal to compose a deterministic
 * operation must leave the turn on the ordinary LLM path — not kill it. So the
 * unsupported arm asserts `handleEditGraph` is STILL CALLED, and called
 * WITHOUT pre-composed operations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ⚠⚠ `importOriginal` SPREAD, NOT A HAND-LISTED MOCK — CLAUDE.md trap 12.
// A factory that names only `handleEditGraph` REPLACES the whole module, so
// `parseEditGraphResponse` becomes undefined. The dispatcher's canonicaliser
// calls it inside a try/catch and falls back to "did not survive
// canonicalisation", so EVERY deterministic operation silently vanished and
// this suite measured a broken instrument: the positive arm failed for the
// wrong reason and the three negative arms PASSED for it.
vi.mock('../../../orchestrator/tools/edit-graph.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  handleEditGraph: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: 'Mock LLM result.',
    latencyMs: 5,
    appliedGraph: null,
    wasRejected: false,
  }),
}));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn().mockResolvedValue({
    response: {}, performed: true as const, persisted_row_id: 'row-1', graphPersisted: false,
  }),
  computeRequestHash: vi.fn().mockReturnValue('sha256:test'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapter: vi.fn().mockReturnValue({}) }));

const pendingStore: { rows: unknown[] } = { rows: [] };
vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn().mockResolvedValue({
    prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    most_recent_pending_actions: [],
  }),
  loadMostRecentPendingActions: vi.fn(async () => pendingStore.rows),
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUB_REQUEST = {} as FastifyRequest;

/** `calibrated` decides whether the target factor carries a usable scale. */
const graphWith = (calibrated: boolean): GraphStateIngress =>
  ({
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Goal' },
      { id: 'dec_d', kind: 'decision', label: 'Decision' },
      {
        id: 'fac_cost',
        kind: 'factor',
        label: 'Hiring Cost',
        observed_state: calibrated ? { unit: 'GBP', cap: 250000 } : { unit: 'GBP' },
      },
      { id: 'fac_other', kind: 'factor', label: 'Team size' },
      {
        id: 'opt_a',
        kind: 'option',
        label: 'Hire a Tech Lead',
        data: {
          interventions: {
            // The cell under test: encoded value plus the metadata that must survive.
            fac_cost: {
              value: 0.7,
              source: 'user_specified',
              target_match: { node_id: 'fac_cost', match_type: 'exact_id', confidence: 'high' },
              reasoning: 'earlier estimate',
            },
            // ⭐ AN UNRELATED CELL — it must come through the route untouched.
            fac_other: { value: 0.3, source: 'brief_extraction' },
          },
        },
      },
    ],
    edges: [
      { from: 'dec_d', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
      { from: 'opt_a', to: 'goal_g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    ],
  }) as GraphStateIngress;

const livePending = (graph: GraphStateIngress) => ({
  id: 'pa-native-1',
  scenario_id: SCENARIO_ID,
  chip_id: 'chip_elicit_option_native_quantity',
  action: {
    kind: 'elicit_option_native_quantity',
    option_id: 'opt_a',
    option_label: 'Hire a Tech Lead',
    factor_id: 'fac_cost',
    factor_label: 'Hiring Cost',
    unit: 'GBP',
  },
  preconditions: { graph_hash: computeAnalysisAffectingGraphHash(graph) },
  expires_at_turn_count: 2,
  expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
  emitted_at_iso: new Date(Date.now() - 1_000).toISOString(),
});

const drive = async (message: string, calibrated: boolean) => {
  const graph = graphWith(calibrated);
  pendingStore.rows = [livePending(graph)];
  await dispatchEditGraph({
    payload: {
      kind: 'message' as const, scenario_id: SCENARIO_ID, turn_id: 'turn-1',
      stage: 'analyse' as const, message, turn_class: 'frame' as const, source: 'composer' as const,
    },
    requestId: `req-native-${calibrated ? 'ok' : 'nocal'}`,
    request: STUB_REQUEST,
    graphState: graph,
    analysisState: null,
  });
  return vi.mocked(handleEditGraph).mock.calls[0];
};

describe('dispatchEditGraph — the native-quantity route', () => {
  beforeEach(() => { vi.clearAllMocks(); setTestSink(() => {}); });
  afterEach(() => { setTestSink(null); pendingStore.rows = []; });

  it('⭐ POSITIVE — a reply to the live ask reaches the applier as ONE pre-composed operation', async () => {
    const call = await drive('£95,000', true);
    expect(call).toBeDefined();
    const opts = call![call!.length - 1] as { preComposedOperations?: readonly unknown[] } | undefined;
    expect(opts?.preComposedOperations).toHaveLength(1);

    // ⚠ The estate's parser NORMALISES the operation: the JSON-pointer path
    // becomes the node id and `value` becomes a field-keyed map. Asserting the
    // raw shape I authored would be asserting my own input, not what the
    // applier receives.
    const op = opts!.preComposedOperations![0] as Record<string, unknown>;
    expect(op.op).toBe('update_node');
    expect(op.path).toBe('opt_a');

    const fields = op.value as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(['data/interventions/fac_cost']);
    const cell = fields['data/interventions/fac_cost'] as Record<string, unknown>;
    expect(cell.raw_value).toBe(95000);
    expect(cell.unit).toBe('GBP');
    // The stale encoded value is gone, so the calibration authority derives it.
    expect(cell).not.toHaveProperty('value');
    // Everything else on the ANSWERED cell survives.
    expect(cell.source).toBe('user_specified');
    expect(cell.target_match).toEqual({ node_id: 'fac_cost', match_type: 'exact_id', confidence: 'high' });
    expect(cell.reasoning).toBe('earlier estimate');
  });

  it('⭐ the operation touches ONE cell — the unrelated intervention is not in it', async () => {
    // Preserving siblings is not "the builder spread an object"; it is that the
    // route never proposes a change to them. The path names one cell.
    const call = await drive('£95,000', true);
    const opts = call![call!.length - 1] as { preComposedOperations?: readonly unknown[] };
    const op = opts.preComposedOperations![0] as Record<string, unknown>;
    const keys = Object.keys(op.value as Record<string, unknown>);
    expect(keys).toEqual(['data/interventions/fac_cost']);
    expect(keys.join()).not.toContain('fac_other');
    // The unrelated cell's own provenance never appears in the operation.
    expect(JSON.stringify(op.value)).not.toContain('brief_extraction');
  });

  it('⚠ NEGATIVE — with NO calibration the turn still runs, on the LLM path', async () => {
    // The reviewer's exact caution: a builder that returns null must not be
    // read as the whole turn refusing. The turn proceeds; it simply carries no
    // deterministic operation.
    const call = await drive('£95,000', false);
    expect(handleEditGraph).toHaveBeenCalledTimes(1);
    const opts = call![call!.length - 1] as { preComposedOperations?: readonly unknown[] } | undefined;
    expect(opts?.preComposedOperations).toBeUndefined();
  });

  it('⚠ NEGATIVE — a reply in the WRONG CURRENCY does not compose an operation', async () => {
    const call = await drive('$95,000', true);
    expect(handleEditGraph).toHaveBeenCalledTimes(1);
    const opts = call![call!.length - 1] as { preComposedOperations?: readonly unknown[] } | undefined;
    expect(opts?.preComposedOperations).toBeUndefined();
  });

  it('CONTROL — with NO live ask, an ordinary message composes nothing', async () => {
    // Proves the positive arm is the PENDING's doing, not something the route
    // does to any message carrying a number.
    pendingStore.rows = [];
    const graph = graphWith(true);
    await dispatchEditGraph({
      payload: {
        kind: 'message' as const, scenario_id: SCENARIO_ID, turn_id: 'turn-1',
        stage: 'analyse' as const, message: '£95,000', turn_class: 'frame' as const, source: 'composer' as const,
      },
      requestId: 'req-native-control', request: STUB_REQUEST, graphState: graph, analysisState: null,
    });
    const call = vi.mocked(handleEditGraph).mock.calls[0];
    const opts = call?.[call.length - 1] as { preComposedOperations?: readonly unknown[] } | undefined;
    expect(opts?.preComposedOperations).toBeUndefined();
  });
});
