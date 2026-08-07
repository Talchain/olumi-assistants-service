/**
 * L16 — GATE-REASON INTEGRITY at the edit-lane dispatch.
 *
 * ⭐ THE EVIDENCE (journey-rewalk-2026-08-03b §2b, raw `b-wire-r5-0*-res.txt`,
 * deployed CEE `9a0541b`). Seven remedy turns were captured after an
 * add-option closed the run gate. Exactly TWO shipped no `analysis_ready`:
 *
 *   r5-01  "Configure Launch Customer Retention Programme"
 *          → `exit_path:"edit_graph"`, `rejection_code:"OPERATION_DID_NOT_LAND"`
 *          → **no `analysis_ready`**
 *   r5-03  "Set the effect of … to -0.3"
 *          → `exit_path:"edit_graph"`, a clarifying question, zero ops
 *          → **no `analysis_ready`**
 *
 * The other five all carried the block. And those two are exactly the turns on
 * which the tester watched the gate copy DEGRADE from the specific reason
 * ("'Launch Customer Retention Programme' has no effect values yet. Tell Olumi
 * what it changes and the analysis can run.") to the generic
 * ("Olumi is not able to run this yet. Ask in the chat and it will explain what
 * is missing."). The specific reason is composed from `analysis_ready.options`;
 * drop the block and the only copy left to show is generic.
 *
 * THE MECHANISM, at the bytes (`edit-graph-dispatch.ts`): `analysisReady` was
 * computed ONLY when `effectiveAppliedMutation` was true, and left `undefined`
 * otherwise — so every non-apply edit-lane turn (rejection, clarification,
 * no-op) silently dropped the readiness block.
 *
 * THE FIX, and why it is safe: when no mutation applied, the graph is
 * UNCHANGED, so readiness derived from the PRE-EDIT graph is not a guess — it
 * is exactly the current truth, and it is the same base the edit itself ran
 * against. The original gate exists to stop readiness being stamped from an
 * *unpersisted* `appliedGraph`; that hazard does not apply to the pre-edit
 * graph, which IS what is persisted. Gated on the strict GraphV3 parse, so a
 * structural-fallback graph never stamps readiness.
 *
 * MUTATION SENSITIVITY: restore `: undefined` on the non-apply branch and
 * every case below goes RED.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const OPTION_LABEL = 'Launch Customer Retention Programme';

/**
 * Edge shape taken from the walk's OWN persisted graph
 * (`b-wire-r4-02-confirm-option-res.txt` → `draft_graph.edges`, 32 edges,
 * ZERO missing `strength` / `exists_probability` / `effect_direction` across
 * every source-node kind including `option`).
 *
 * This matters, and it is why the fixture is not hand-minimised: the fix's
 * non-apply branch is gated on the STRICT GraphV3 parse, and strict GraphV3
 * requires all three fields on every edge. A fixture with bare `{from,to}`
 * edges parses non-strictly, silently skips the branch, and would have let
 * this suite pass for the wrong reason — or, worse, "prove" the fix works
 * against a graph shape the product never persists. Measured before use.
 */
function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

/**
 * The walk's post-add-option graph: one option configured, one linked but
 * with no interventions (`needs_encoding` — the specific blocker the gate
 * copy was naming before it degraded).
 */
const BASE_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_arr', kind: 'goal', label: 'Reach £1,000,000 ARR' },
    { id: 'fac_retention_investment', kind: 'factor', label: 'Customer Retention Investment' },
    { id: 'fac_content_spend', kind: 'factor', label: 'Content Spend' },
    { id: 'opt_retention', kind: 'option', label: OPTION_LABEL },
    {
      id: 'opt_content',
      kind: 'option',
      label: 'Invest in Content Marketing',
      // TOP-LEVEL `interventions`, in the rich InterventionV3 shape the walk's
      // own persisted graph carries (`b-wire-r4-02-confirm-option-res.txt`).
      // NOT `data.interventions`: `NodeV3` has no `data` field and is
      // non-passthrough, so `GraphV3.safeParse` STRIPS it on read — and
      // `normalise-option-interventions.ts` merges `data.interventions` onto
      // this canonical top-level bundle at the single `scenarios.graph` write
      // chokepoint precisely so the persisted record survives that strip.
      // A `data.interventions` fixture would therefore parse to an option with
      // NO interventions and quietly make this control assert the opposite of
      // what it claims.
      interventions: {
        fac_content_spend: { value: 1, source: 'brief_extraction', value_confidence: 'high' },
      },
    },
  ],
  edges: [
    edge('opt_retention', 'fac_retention_investment'),
    edge('opt_content', 'fac_content_spend'),
    edge('fac_retention_investment', 'goal_arr'),
    edge('fac_content_spend', 'goal_arr'),
  ],
} as unknown as GraphStateIngress;

function payload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: `Configure ${OPTION_LABEL}`,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/** r5-01: the edit LLM produced an op that did not survive canonicalisation. */
function rejectedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: "I wasn't able to make that change safely.",
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: true,
  };
}

/** r5-03: the edit LLM asked a clarifying question and wrote nothing. */
function clarifyResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Which one should I update?',
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: false,
  };
}

function commitOk(graphPersisted: boolean) {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-gate',
    graphPersisted,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

async function run(result: EditGraphResult) {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    commitOk(false) as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
  return dispatchEditGraph({
    payload: payload(),
    requestId: 'req-gate-reason',
    request: STUB_REQUEST,
    graphState: BASE_GRAPH,
    analysisState: null,
  });
}

describe('edit-graph-dispatch — a failed remedy must not drop the specific gate reason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a REJECTED edit still surfaces analysisReady, carrying the specific per-option blocker (walk r5-01)', async () => {
    const out = await run(rejectedResult());

    expect(out.analysisReady).toBeDefined();
    const ar = out.analysisReady!;
    expect(ar.goal_node_id).toBe('goal_arr');

    const retention = ar.options.find((o) => o.option_id === 'opt_retention');
    expect(retention).toBeDefined();
    // The SPECIFIC reason survives the failed remedy.
    expect(retention!.status).toBe('needs_encoding');
    expect(retention!.label).toBe(OPTION_LABEL);

    // Positive control (trap 13): the block is not an empty carrier that
    // would satisfy `toBeDefined()` while carrying nothing — the configured
    // sibling is still reported ready, so the content is load-bearing.
    expect(ar.options.find((o) => o.option_id === 'opt_content')?.status).toBe('ready');

    // Composer-cleanliness invariant is untouched: readiness rides the
    // dispatch result, never the composed response.
    expect('analysis_ready' in out.response).toBe(false);
    // …and the dispatcher still does NOT stamp computed_at (finaliser's job).
    expect((ar as { computed_at?: string }).computed_at).toBeUndefined();
  });

  it('a CLARIFYING edit turn (zero ops, not a rejection) also keeps the specific reason (walk r5-03)', async () => {
    const out = await run(clarifyResult());

    expect(out.analysisReady).toBeDefined();
    expect(
      out.analysisReady!.options.find((o) => o.option_id === 'opt_retention')?.status,
    ).toBe('needs_encoding');
  });

  it('readiness on a non-apply turn is derived from the UNCHANGED graph, so it never claims the option got configured', async () => {
    const out = await run(rejectedResult());

    // The whole point: a failed remedy must not report success. The option
    // the user tried and failed to configure is still blocked, by name.
    const retention = out.analysisReady!.options.find((o) => o.option_id === 'opt_retention');
    expect(retention!.status).not.toBe('ready');
    expect(retention!.interventions).toEqual({});
  });
});
