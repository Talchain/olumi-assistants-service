/**
 * ⭐⭐ THE CHIP CLICK — the seam that made the whole value batch unreachable.
 *
 * `estimateValueBatch` (producer), `prepareValueBatchOffer` (composition),
 * `readValueBatchResume` (resume) and `executeValueBatch` (the only writer) all
 * existed and were all tested. Nothing handled the CLICK, so a user who pressed
 * the one chip the feature offers fell through to the generic
 * `apply_proposed_change` synthesis, which does not know this handler id and
 * resolves it `invalid` — a decline of the action the user just approved.
 *
 * ⚠ THESE ARE ROUTE-LEVEL TESTS ON PURPOSE. Every module below this seam is
 * already green; the defect lived entirely in the wiring, so a test that stops
 * at the handler cannot see it. The assertions here read the DURABLE WRITE the
 * executor hands its store, which is the thing a user's graph is made of.
 *
 * ⭐ ASSERTIONS BIND BY IDENTITY (trap 19). Written values are looked up by the
 * proposal's own `option_id` / `factor_id`, never by finding "a node with value
 * 0.6" — another option could satisfy that predicate and the extractor could be
 * deleted with the suite still green.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  selectValueBatchMembership,
  writableCells,
  VALUE_BATCH_INTERVENTION_SOURCE,
  type ValueBatchProposal,
} from '../handlers/readiness-value-batch.js';
import { prepareValueBatchOffer } from '../handlers/readiness-value-batch-flow.js';
import { buildReadinessRepairOffer } from '../handlers/readiness-repair-proposal.js';
import { _resetConfigCache } from '../../config/index.js';

type Dict = Record<string, unknown>;
const SCENARIO_ID = randomUUID();

// ---------------------------------------------------------------------------
// The value-batch fixture: a DATED CAPTURE, not a hand-written graph.
// ---------------------------------------------------------------------------

const CAPTURE = JSON.parse(
  readFileSync(
    new URL('./fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as { draft_graph: { nodes: Dict[]; edges: Dict[] } };

/** The witnessed arm: every option unconfigured, so every effect value is open. */
function zeroConfiguredGraph(): { nodes: Dict[]; edges: Dict[] } {
  const graph = structuredClone(CAPTURE.draft_graph);
  for (const node of graph.nodes) if (node.kind === 'option') node.interventions = {};
  return graph;
}

const BATCH_GRAPH = zeroConfiguredGraph();
const BATCH_HASH = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(BATCH_GRAPH));
if (BATCH_HASH === null) throw new Error('value batch fixture must have an analysis hash');

/**
 * Build the offer through the REAL flow, with a mixed estimate set (one decline
 * with a reason, the rest valued), then cross the JSON/JSONB boundary the
 * pending actually crosses. A hand-written pending would encode my model of the
 * producer rather than the producer.
 */
const BATCH_OFFER = await (async () => {
  const assessment = assessCanonicalAnalysisReadiness(BATCH_GRAPH);
  const cells = selectValueBatchMembership(assessment).cells;
  const out = await prepareValueBatchOffer(
    {
      assessment,
      graph: BATCH_GRAPH,
      currentGraphHash: BATCH_HASH,
      scenarioId: SCENARIO_ID,
      brief: undefined,
    },
    async () => ({
      content: JSON.stringify({
        estimates: cells.map((cell, index) => ({
          option_id: cell.option_id,
          factor_id: cell.factor_id,
          ...(index === 0
            ? { value: null, declined_reason: 'No basis in the brief.' }
            : { value: 0.6, reasoning: 'From the brief.', confidence: 'medium' as const }),
        })),
      }),
    }),
  );
  if (out.kind !== 'offer') throw new Error(`expected an offer, got ${out.kind}`);
  return {
    pending: JSON.parse(JSON.stringify(out.offer.pending)) as PendingAction,
    proposal: out.proposal,
  };
})();

const BATCH_PENDING = BATCH_OFFER.pending;
const BATCH_PROPOSAL = BATCH_OFFER.proposal;
const WRITABLE = writableCells(BATCH_PROPOSAL);
const DECLINED = BATCH_PROPOSAL.cells.filter((cell) => cell.value === null);

// PRECONDITION, pinned in-test: the fixture really does carry BOTH a written
// cell and a declined one. Without this the disclosure cases below could pass
// against a one-shaped proposal that cannot exercise them (trap 13b).
if (WRITABLE.length === 0) throw new Error('fixture must carry at least one writable cell');
if (DECLINED.length === 0) throw new Error('fixture must carry at least one declined cell');

// ---------------------------------------------------------------------------
// The SIBLING fixture: the discrimination control. A `readiness_multi_repair_v1`
// pending must be untouched by the value-batch wiring.
// ---------------------------------------------------------------------------

function edge(from: string, to: string): Dict {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  };
}

const REPAIR_GRAPH: Dict = {
  goal_node_id: 'goal_1',
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow responsibly' },
    {
      id: 'fac_cost',
      kind: 'factor',
      label: 'Annual cost',
      category: 'controllable',
      observed_state: { value: 0.4, unit: '£', cap: 100 },
    },
    { id: 'fac_capacity', kind: 'factor', label: 'Delivery capacity', category: 'controllable' },
    {
      id: 'opt_a',
      kind: 'option',
      label: 'Option A',
      data: { interventions: { fac_cost: { raw_value: 40, unit: '£' } } },
    },
    {
      id: 'opt_b',
      kind: 'option',
      label: 'Option B',
      'data/interventions/fac_cost': { raw_value: 60, unit: '£' },
    },
  ],
  edges: [
    edge('opt_a', 'fac_cost'),
    edge('opt_b', 'fac_cost'),
    edge('fac_cost', 'goal_1'),
    edge('fac_capacity', 'goal_1'),
  ],
};

const REPAIR_HASH = computeAnalysisAffectingGraphHash(
  GraphStateIngressSchema.parse(REPAIR_GRAPH),
);
if (REPAIR_HASH === null) throw new Error('repair fixture must have an analysis hash');
const REPAIR_OFFER = buildReadinessRepairOffer({
  assessment: assessCanonicalAnalysisReadiness(REPAIR_GRAPH),
  currentGraphHash: REPAIR_HASH,
  scenarioId: SCENARIO_ID,
})!;
if (!REPAIR_OFFER) throw new Error('repair fixture must produce an offer');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let graphForRead: unknown = BATCH_GRAPH;
let pendingActionsForRead: readonly PendingAction[] = [BATCH_PENDING];
const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => graphForRead,
    loadGraphAndBriefText: async () => ({ graph: graphForRead, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message: 'yes',
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('a reviewed value batch must not call the routing model');
      }),
  };
}

/** The written intervention for ONE named cell, looked up by identity. */
function writtenIntervention(write: Dict, optionId: string, factorId: string): Dict | undefined {
  const graph = write.graph as { nodes?: Dict[] } | undefined;
  const node = graph?.nodes?.find((candidate) => candidate.id === optionId);
  const interventions = node?.interventions as Record<string, Dict> | undefined;
  return interventions?.[factorId];
}

/** Mutate a copy of the batch pending's proposal, across the JSON boundary. */
function mutatedBatchPending(mutate: (proposal: any) => void): PendingAction {
  const clone = JSON.parse(JSON.stringify(BATCH_PENDING)) as any;
  mutate(clone.action.inline_patch.proposal as ValueBatchProposal);
  return clone as PendingAction;
}

beforeEach(() => {
  vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
  _resetConfigCache();
  appendCalls.length = 0;
  graphForRead = BATCH_GRAPH;
  pendingActionsForRead = [BATCH_PENDING];
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('value batch chip click — one approval, one commit', () => {
  it('EXECUTES the reviewed batch: every writable cell lands, marked cee_hypothesis', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload(), 'req-value-batch-apply', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0]!;
    expect(write.graph).toBeDefined();
    // ⚠ WAS `toEqual([])`, AND THAT PINNED THE DEAD END. The applied turn used
    // to offer nothing, so it minted nothing. It now offers the run, and an
    // EXECUTABLE chip is pre-authorised by a pending action — that is the
    // estate's existing mechanism for chip clicks, not new machinery.
    //
    // ⭐ BOUND BY IDENTITY, not by "non-empty": exactly one pending, and it is
    // the run offer for the chip this turn emitted. A value predicate would be
    // satisfied by any stray pending and would not notice the wrong one.
    expect(write.pending_actions).toHaveLength(1);
    const pending = (write.pending_actions as Array<{ chip_id?: string; action?: { kind?: string } }>)[0];
    expect(pending?.chip_id).toBe('chip_action_run_analysis_post_apply');
    expect(pending?.action?.kind).toBe('run_analysis');
    expect((write.handler_facts as Array<{ fact_type?: string }>)[0]?.fact_type).toBe('edit_graph');

    // ⭐ BOUND BY IDENTITY: each cell's own option_id/factor_id, never "a node
    // that happens to hold 0.6".
    for (const cell of WRITABLE) {
      const stored = writtenIntervention(write, cell.option_id, cell.factor_id);
      expect(stored, `${cell.option_id}/${cell.factor_id} must be written`).toBeDefined();
      expect(stored!.value).toBeCloseTo(cell.value);
      // THE PERMANENT MARK — the difference between "the product chose this"
      // and "I said this", for the rest of the graph's life.
      expect(stored!.source).toBe(VALUE_BATCH_INTERVENTION_SOURCE);
    }
    expect(result.response.draft_graph).toBeDefined();
  });

  /**
   * ⭐⭐ THE PAYOFF TURN OFFERS THE NEXT ACT — ASSERTED AT THE ROUTE.
   *
   * The turn that applies the user's values built its response with a literal
   * `suggested_actions: []` and then `return finalizeRun()`, and every
   * `generateChips(...)` site is far below that return — so the empty list was
   * FINAL. The user supplied exactly what Olumi asked for, was told the model
   * now passes, and was offered nothing to do next.
   *
   * ⚠ ASSERTED ON THE RESPONSE THE EXECUTOR RETURNS, not on the helper. A unit
   * test of `buildPostApplyChips` would pass while this call site still sent
   * `[]` — which is precisely the failure being closed.
   */
  it('⭐ the applied turn offers the next act, instead of dead-ending', async () => {
    const result = await runTurnExecutor(payload(), 'req-value-batch-chips', {
      routingAdapter: throwingRoutingAdapter(),
    });
    const chips = result.response.suggested_actions ?? [];
    expect(chips.length, 'the payoff turn must not dead-end').toBeGreaterThan(0);
    // CONTRAST CONTROL: the response itself is real — it carries the applied
    // narration — so an empty chip list would be a genuine absence, not an
    // empty response.
    expect(result.response.assistant_text).toMatch(/Confirmed/i);
    // Whatever is offered must be renderable by the client, which drops
    // anything past the third entry.
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  /**
   * ⭐⭐ THE PAYOFF TURN MUST CARRY THE RUN ADMISSION, NOT JUST A STATUS.
   *
   * This is the turn right after the user supplied what Olumi asked for. It set
   * the turn's readiness from
   * `assessCanonicalAnalysisReadiness(persistedGraph).analysisReady`, which does
   * NOT compute `may_run` — only `canonicalAnalysisReadyFrom(
   * resolveRunAdmission(g), g)` does. So the payload reached every Run-affordance
   * consumer with no admission verdict and they fell back to the stricter
   * `status` rule. Measured: `may_run` absent on 400/400 assessments of real
   * persisted models, and 95/400 (23.8%) carry a non-empty value-batch
   * membership, so this turn is genuinely reachable.
   *
   * ⚠ BOUND AT THE ROUTE, NOT AT THE HELPER. A unit test of the two producers
   * pins the MECHANISM but would stay green if this call site were reverted —
   * which is the whole failure mode. This asserts the field on the response the
   * executor actually returns.
   */
  it('⭐ the applied turn publishes may_run, so the Run affordance is not withheld', async () => {
    const result = await runTurnExecutor(payload(), 'req-value-batch-may-run', {
      routingAdapter: throwingRoutingAdapter(),
    });
    // ⚠ `analysisReady` is on the EXECUTOR RESULT, not inside `response` — the
    // response-finaliser stamps it onto the wire envelope after composition.
    // This is the value that stamping reads, so it is the right binding point.
    const ready = result.analysisReady as { status?: unknown; may_run?: unknown } | undefined;
    expect(ready, 'the applied turn must publish a readiness payload').toBeDefined();
    // CONTRAST CONTROL: `status` was always present, so its presence proves the
    // payload is real and a missing `may_run` is a genuine absence.
    expect(typeof ready?.status).toBe('string');
    expect(typeof ready?.may_run).toBe('boolean');
  });

  it('a DECLINED cell writes nothing — an honest refusal is not an invented number', async () => {
    await runTurnExecutor(payload(), 'req-value-batch-declined', {
      routingAdapter: throwingRoutingAdapter(),
    });
    const write = appendCalls[0]!;
    // ⚠ PRECONDITION PINNED IN-TEST (trap 13b). Without this the absence below
    // passes whenever the batch wrote NOTHING AT ALL — which is exactly the
    // pristine behaviour this file exists to change. The guard must be
    // discriminating, not merely true.
    for (const cell of WRITABLE) {
      expect(
        writtenIntervention(write, cell.option_id, cell.factor_id),
        `precondition: ${cell.option_id}/${cell.factor_id} must have been written`,
      ).toBeDefined();
    }
    for (const cell of DECLINED) {
      expect(
        writtenIntervention(write, cell.option_id, cell.factor_id),
        `${cell.option_id}/${cell.factor_id} declined — nothing may be written`,
      ).toBeUndefined();
    }
  });

  it('says the values were AI-ESTIMATED and REVIEWED, and discloses what it could not do', async () => {
    const result = await runTurnExecutor(payload(), 'req-value-batch-copy', {
      routingAdapter: throwingRoutingAdapter(),
    });
    const text = result.response.assistant_text;
    expect(text).toContain('estimate');
    expect(text.toLowerCase()).toContain('reviewed');
    // The declined cells are NAMED as not done, never silently dropped.
    expect(text).toMatch(/could not estimate/i);
  });
});

describe('value batch chip click — the discrimination', () => {
  /**
   * ⭐⭐ THE MUTANT THAT SURVIVED, AND WHY THE OBVIOUS TEST COULD NOT SEE IT.
   *
   * Removing the `kind !== 'not_value_batch'` guard left the readiness-repair
   * case below GREEN — because the repair check runs FIRST and returns before
   * the mutated line is ever reached. The sibling test pins ORDERING, not the
   * guard: it was passing for a reason that had nothing to do with what it
   * claimed to prove (trap 19 — bound to an object that never reaches the
   * predicate).
   *
   * What reaches the guard with `not_value_batch` is a pending that is neither:
   * a foreign handler id, which must fall through to the GENERIC synthesis. The
   * two paths say different things, so the response text discriminates them.
   */
  it('⭐ a FOREIGN handler id is not captured: it reaches the generic synthesis, not the batch path', async () => {
    const action = BATCH_PENDING.action;
    if (action.kind !== 'apply_proposed_change') throw new Error('fixture');
    pendingActionsForRead = [{
      ...BATCH_PENDING,
      action: {
        ...action,
        inline_patch: {
          ...(action.inline_patch as Dict),
          handler_id: 'some_unrelated_handler_v1',
        },
      },
    }];
    const result = await runTurnExecutor(payload(), 'req-value-batch-foreign', {
      routingAdapter: throwingRoutingAdapter(),
    });
    const text = result.response.assistant_text;
    // NEGATIVE: the batch path's own decline copy must NOT appear. This is the
    // assertion the surviving mutant flips.
    expect(text).not.toMatch(/estimated values/i);
    // POSITIVE, so the negative above cannot pass by the turn having failed
    // entirely: the generic synthesis' own decline is what the user gets.
    expect(text).toMatch(/no longer valid/i);
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
  });

  it('⭐ not_value_batch FALLS THROUGH: a readiness-repair pending still applies its own repair', async () => {
    graphForRead = REPAIR_GRAPH;
    pendingActionsForRead = [REPAIR_OFFER.pending];
    const result = await runTurnExecutor(payload(), 'req-value-batch-sibling', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0]!;
    // The SIBLING's own outcome, unchanged: value-preserving canonicalisation
    // of the option carriers, not an estimated value.
    expect(write.graph).toBeDefined();
    const optionA = ((write.graph as Dict).nodes as Dict[]).find((n) => n.id === 'opt_a')!;
    expect((optionA.interventions as Dict).fac_cost).toMatchObject({ value: 0.4 });
    expect(result.response.assistant_text).toContain('did not invent');
  });
});

describe('value batch chip click — reachable by its own affordance', () => {
  /**
   * ⭐⭐ THE AFFORDANCE TEST, AND IT CAUGHT A SECOND DEFECT.
   *
   * A real chip click replays the chip's own MESSAGE, which lands in the
   * deterministic label/ordinal pre-route. Wiring only the bare-confirm "yes"
   * site would leave the feature unreachable by the one control that offers it
   * — a component witness that never composes into a journey.
   *
   * ⛔ At pristine this REDed for a reason that had nothing to do with the
   * wiring: the chip's message was `Approved — apply all N estimates.`, and the
   * EM DASH is a `SAFETY_FORBIDDEN_TOKEN`. `resolveProposalRenderCopy` therefore
   * replaced the whole message with the generic fallback "Apply the proposed
   * change" — which is the string the matcher compares against — so the click
   * matched nothing and the approval reached the LLM. Measured with a contrast
   * control: the sibling `readiness_multi_repair_v1` message ("Yes, apply all N
   * safe model fixes.") carries no em dash, survives the sanitiser and matches.
   * One character made the difference between a reachable feature and a dark
   * one, and NO suite below this level could see it.
   *
   * The message is read off the pending rather than restated here, so this
   * binds to the copy the product actually ships.
   */
  it('a chip click replaying the batch chip’s own message reaches the batch writer', async () => {
    const action = BATCH_PENDING.action;
    if (action.kind !== 'apply_proposed_change') throw new Error('fixture');
    const chipMessage = action.public_message;
    expect(typeof chipMessage).toBe('string');
    pendingActionsForRead = [BATCH_PENDING];
    const result = await runTurnExecutor(
      { ...payload(), message: chipMessage as string },
      'req-value-batch-label',
      { routingAdapter: throwingRoutingAdapter() },
    );
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0]!;
    expect(write.graph, 'the chip’s own message must reach the writer').toBeDefined();
    for (const cell of WRITABLE) {
      const stored = writtenIntervention(write, cell.option_id, cell.factor_id);
      expect(stored, `${cell.option_id}/${cell.factor_id} must be written`).toBeDefined();
      expect(stored!.source).toBe(VALUE_BATCH_INTERVENTION_SOURCE);
    }
    expect(result.response.assistant_text).toContain('estimate');
  });
});

describe('value batch chip click — degrade with disclosure, never a partial write', () => {
  it('⭐ A STALE PIN APPLIES NOTHING: zero graph writes, and the user is told why', async () => {
    pendingActionsForRead = [{
      ...BATCH_PENDING,
      preconditions: { graph_hash: 'stale_hash' },
    }];
    const result = await runTurnExecutor(payload(), 'req-value-batch-stale', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(result.response.assistant_text).toMatch(/did not apply/i);
    expect(result.response.assistant_text).toMatch(/changed/i);
  });

  it('⭐ MEMBERSHIP MOVED APPLIES NOTHING — a subset proposal is refused whole', async () => {
    // One cell dropped. `executeValueBatch` re-derives membership from the
    // CURRENT graph and refuses; the executor must not pre-empt or bypass that,
    // and must not write the cells that DID still match.
    pendingActionsForRead = [mutatedBatchPending((proposal) => {
      proposal.cells = proposal.cells.slice(1);
    })];
    const result = await runTurnExecutor(payload(), 'req-value-batch-moved', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(result.response.assistant_text).toMatch(/did not apply/i);
  });

  it('an unreadable proposal applies nothing and still answers the user', async () => {
    pendingActionsForRead = [mutatedBatchPending((proposal) => {
      (proposal as any).smuggled_key = true;
    })];
    const result = await runTurnExecutor(payload(), 'req-value-batch-invalid', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(result.response.assistant_text.length).toBeGreaterThan(0);
  });
});
