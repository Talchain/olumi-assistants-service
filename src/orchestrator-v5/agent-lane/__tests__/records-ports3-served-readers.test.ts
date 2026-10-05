/**
 * DL WIRING PORTS 3: each port's value reaches the SERVED reader the P2-ACCEPT table names, through the real records
 * build and the real reader — never a mock that writes the asserted field. Each row turns RED with its port removed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNext as sealedRecords } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { narrateWriteOutcome, openQuestionsForReply } from '../write-outcome.js';
import { parsePendingAction } from '../../session/pending-action.js';
import { goalScopeClaimInput } from '../../compose/goal-scope-claim-input.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { withStatedStrengths } from '../refit-frames.js';
import { isEditableGraph } from '../../system-events/editable-graph.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { createAdjustEdgeStrengthHandler } from '../../tools/handlers/adjust-edge-strength.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

async function build(records: DraftRecordSet, brief: string): Promise<{ result: ToolResult; writes: Record<string, unknown>[] }> {
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Record<string, unknown>); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief, dispatch,
    async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  return { result, writes };
}

const DEADLINE = 'Does "Monthly recurring revenue" get there within 9 months? The model holds the deadline; no result answers that yet.';

describe('PORT 1: the deadline question reaches the served reply and the wire list, first', () => {
  it('the reply status line says it first, and `_agent.open_questions` carries it first', async () => {
    const { result } = await build(sealedRecords(), BRIEF);
    expect(result.ok).toBe(true);
    // The wire list (`_agent.open_questions`, UI serverOpenQuestions) in the producer's order: the deadline FIRST.
    expect(openQuestionsForReply(result)[0]).toBe(DEADLINE);
    // The served reply's status line (`narrateWriteOutcome` → `openQuestionsLine`, first 2 shown) says it first.
    const { status } = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
    expect(status).toContain(`Questions this model does not answer yet: ${DEADLINE}`);
  });

  it('contrast: a brief with no deadline asks none (the first question is the compiler\'s own)', async () => {
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result.ok).toBe(true);
    expect(openQuestionsForReply(result).some((q) => /get there within|Which date does/.test(q))).toBe(false);
  });
});

const PRO_SCOPE = { modelled: 'the Pro plan only', alternative: 'all plans together', stated_in_brief: false };
const PRO_BRIEF = 'Should we raise the Pro plan from £49 to £59 to reach £20k MRR?';
const SCOPE_QUESTION = 'The brief does not say whether your "MRR" goal covers the Pro plan only or all plans together, so the model '
  + 'measures it for the Pro plan only. Which did you mean?';
function proRecords(scope?: { modelled: string; alternative: string; stated_in_brief: boolean }): DraftRecordSet {
  const records = constructionRecords('Raise Pro to £59', 'MRR', 'Pro plan price');
  if (scope !== undefined) records.stated_items[0] = { ...records.stated_items[0]!, scope };
  return records;
}
function registeredGoal(writes: Record<string, unknown>[]): { id: string; label: string } {
  const goals = (writes[0]!.graph as { nodes: Array<{ id: string; kind: string; label: string }> }).nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return goals[0]!;
}

describe('PORT 2 (C46): the unstated goal scope reaches the served route reader', () => {
  it('the route parses the action (agent-v1-turn parsePendingAction), keeps it unresolved (goalScopeClaimInput), and asks first', async () => {
    const { result, writes } = await build(proRecords(PRO_SCOPE), PRO_BRIEF);
    expect(result.ok).toBe(true);
    const goal = registeredGoal(writes);
    // The route's own filter (agent-v1-turn.ts freshScopeIssues): parsed, this scenario, reconcile_goal_scope.
    const parsed = parsePendingAction(result.pending_action);
    expect(parsed).not.toBeNull();
    expect(parsed!.scenario_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(parsed!.action).toMatchObject({ kind: 'reconcile_goal_scope', goal_id: goal.id, goal_label: 'MRR', expected: 'scope',
      declared_scope: PRO_SCOPE, question: SCOPE_QUESTION });
    // The route's composer (withRetainedScopeIssues -> goalScopeClaimInput) over the REGISTERED graph keeps it open.
    const input = goalScopeClaimInput([parsed!], writes[0]!.graph);
    expect(input.status).toBe('unresolved');
    expect(input.issues.map((issue) => issue.goal_id)).toEqual([goal.id]);
    // And the question leads the wire list (`_agent.open_questions`), ahead of any deadline, as legacy unshifts it.
    expect(openQuestionsForReply(result)[0]).toBe(SCOPE_QUESTION);
  });

  it('absent declaration: no action and no question is invented (same brief, same topology)', async () => {
    const { result } = await build(proRecords(), PRO_BRIEF);
    expect(result.ok).toBe(true);
    expect(result.pending_action).toBeUndefined();
    expect(openQuestionsForReply(result).some((q) => /goal covers|Which did you mean/.test(q))).toBe(false);
  });

  it('contrast: a scope the brief itself stated (stated_in_brief true) asks nothing', async () => {
    const { result } = await build(proRecords({ ...PRO_SCOPE, stated_in_brief: true }), PRO_BRIEF);
    expect(result.ok).toBe(true);
    expect(result.pending_action).toBeUndefined();
    expect(openQuestionsForReply(result).some((q) => /goal covers|Which did you mean/.test(q))).toBe(false);
  });
});

// ── PORT 3: the clamp audit ────────────────────────────────────────────────────────────────────────────────────────────
type Rec = Record<string, any>;
/** The parity row's fixture: the gross-price stated effect widened past one (claims[0].value 1,000,000). */
function unfitRecords(): DraftRecordSet {
  const records = sealedRecords();
  records.claims[0] = { ...records.claims[0]!, value: 1000000 };
  return records;
}
/** The registered gross-price stated edge, bound by the records' quantity namespace and its own quote (identity). */
async function clampedBuild(): Promise<{ result: ToolResult; graph: Rec; edge: Rec; records: DraftRecordSet }> {
  const records = unfitRecords();
  const compiled = await replayRecordSet(records, { brief: BRIEF });
  if (!compiled.ok) throw new Error(compiled.detail);
  const source = compiled.projection.graph.nodes.filter((n) => n.kind === 'factor' && n.quantity_ref === records.claims[0]!.quantity);
  const target = compiled.projection.graph.nodes.filter((n) => n.kind === 'outcome' && n.quantity_ref === records.claims[3]!.quantity);
  expect(source).toHaveLength(1); expect(target).toHaveLength(1);
  const { result, writes } = await build(records, BRIEF);
  expect(result.ok).toBe(true);
  const graph = writes[0]!.graph as Rec;
  const edge = graph.edges.find((e: Rec) => e.from === source[0]!.id && e.to === target[0]!.id);
  expect(edge, 'identity: the gross-price stated effect').toBeDefined();
  expect(edge.provenance.source_quote).toBe(records.stated_items[8]!.source_quote);
  return { result, graph, edge, records };
}

describe('PORT 3: a stated size no refit can fit is stored at ±1 with its full β marked, and its readers see it', () => {
  it('stored ±1, clamped_from = natural β > 1, magnitude user_stated, the user\'s quote and figure kept; writable', async () => {
    const { graph, edge } = await clampedBuild();
    expect(edge.strength.mean).toBe(1);
    expect(edge.provenance.magnitude).toBe('user_stated');
    expect(edge.provenance.clamped_from).toBeGreaterThan(1);
    expect(edge.provenance.natural_effect.strength_mean).toBe(edge.provenance.clamped_from);
    for (const e of graph.edges as Rec[]) expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(isEditableGraph(graph)).toBe(true);
  });

  it('contrast: the UNWIDENED stated effect (the sealed fixture as drafted) keeps 0.64 with natural_effect and its quote, no marker', async () => {
    const records = sealedRecords();
    const compiled = await replayRecordSet(records, { brief: BRIEF });
    if (!compiled.ok) throw new Error(compiled.detail);
    const source = compiled.projection.graph.nodes.find((n) => n.kind === 'factor' && n.quantity_ref === records.claims[0]!.quantity)!;
    const target = compiled.projection.graph.nodes.find((n) => n.kind === 'outcome' && n.quantity_ref === records.claims[3]!.quantity)!;
    const { writes } = await build(records, BRIEF);
    const edge = (writes[0]!.graph as Rec).edges.find((e: Rec) => e.from === source.id && e.to === target.id);
    expect(edge.strength.mean).toBeCloseTo(0.64, 12);
    expect(edge.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: records.stated_items[8]!.source_quote });
    expect(edge.provenance.natural_effect.strength_mean).toBe(edge.strength.mean);
    expect(edge.provenance).not.toHaveProperty('clamped_from');
  });

  it('refit-frames.ts:116 reader (withStatedStrengths, every refit and the run\'s wire copy): restores the full β, drops the marker', async () => {
    const { graph, edge } = await clampedBuild();
    const read = (withStatedStrengths(graph) as Rec).edges.find((e: Rec) => e.from === edge.from && e.to === edge.to);
    expect(read.strength.mean).toBe(edge.provenance.clamped_from);
    expect(read.provenance.clamped_from).toBeUndefined();
  });

  it('Science (2): the clamp is DISCLOSED through the existing GOAL_FIGURES_USER_EFFECT_CLAMPED path — run_analysis sends PLoT the full β', async () => {
    const { graph, edge } = await clampedBuild();
    const minimal = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8'));
    const goal = (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option')
      .map((n) => ({ id: n.id, option_id: n.id, label: n.label, interventions: n.interventions ?? {} }));
    const snapshot = { graph: structuredClone(graph), options, goal_node_id: goal.id, rawPersistedGraph: structuredClone(graph) };
    const runMock = vi.fn(async () => structuredClone(minimal));
    const handler = createRunAnalysisHandler({ plotClient: { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) }, scenarioReader: async () => snapshot } as never);
    await handler({ payload: { scenario_id: '11111111-1111-4111-8111-111111111111' }, requestId: 'req-records-clamp', signal: new AbortController().signal, context: {}, orientationText: '' } as never).catch((x: unknown) => x);
    expect(runMock).toHaveBeenCalledTimes(1);
    const sent = ((runMock.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph;
    const wire = (sent.edges as Rec[]).find((e) => e.from === edge.from && e.to === edge.to)!;
    // PLoT receives the user's full β, so it clamps, marks and withholds with GOAL_FIGURES_USER_EFFECT_CLAMPED (#422).
    expect(wire.strength.mean).toBe(edge.provenance.clamped_from);
    expect(Math.abs(wire.strength.mean)).toBeGreaterThan(1);
    expect(snapshot.rawPersistedGraph.edges.find((e: Rec) => e.from === edge.from && e.to === edge.to).strength.mean).toBe(1);
  });

  it('adjust-edge-strength.ts:509 reader (the Agent\'s real writer): a user strength write takes clamped_from and natural_effect with it', async () => {
    const { graph, edge } = await clampedBuild();
    const invocation = {
      context: { session_id: '11111111-1111-4111-8111-111111111111', stage: 'frame', request_id: 'req-records-clamp', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: { kind: 'message', scenario_id: '11111111-1111-4111-8111-111111111111', turn_id: '11111111-1111-4111-8111-111111111399', stage: 'frame', message: 'set the link' },
      requestId: 'req-records-clamp', signal: new AbortController().signal, orientationText: '',
      proposal: { handler_id: 'adjust_edge_strength', entity: { id: `${edge.from}→${edge.to}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [{ name: 'strength', value: 0.3, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] },
      graphForTurn: graph,
    } as unknown as HandlerInvocation;
    const outcome = await createAdjustEdgeStrengthHandler()(invocation);
    expect(outcome.mutated_graph, JSON.stringify(outcome).slice(0, 300)).toBeDefined();
    const written = (outcome.mutated_graph as Rec).edges.find((e: Rec) => e.from === edge.from && e.to === edge.to);
    expect(written.strength.mean).toBe(0.3);
    expect(written.provenance).not.toHaveProperty('clamped_from');
    expect(written.provenance).not.toHaveProperty('natural_effect');
    expect((withStatedStrengths(outcome.mutated_graph) as Rec).edges.find((e: Rec) => e.from === edge.from && e.to === edge.to).strength.mean).toBe(0.3);
  });

  it('link-effect-edit.ts:230 reader: a stated size the frames hold replaces the marked one; the old marker goes with it', async () => {
    const { graph, edge } = await clampedBuild();
    const ne = edge.provenance.natural_effect;
    const effect = { amount: ne.amount / 100000, amount_unit: ne.amount_unit, per_source_change: ne.per_source_change, per_source_change_unit: ne.per_source_change_unit };
    const p = { persistedGraph: graph, from: edge.from, to: edge.to, effect,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, edge.from, edge.to)! },
      quote: 'a smaller size for this link' };
    const r = applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p) });
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r).slice(0, 300));
    const written = (r.mutatedGraph as Rec).edges.find((e: Rec) => e.from === edge.from && e.to === edge.to);
    expect(written.provenance).not.toHaveProperty('clamped_from');
    expect(written.provenance.natural_effect.amount).toBe(effect.amount);
    expect(Math.abs(written.strength.mean)).toBeLessThan(1);
  });
});

/**
 * Science (3): the vans B6(2) case — 17 routes, "55 deliveries per route", Routes frame 100, β 4.89 before refit — through
 * buildModelFromRecords. Routes' frame 100 is CONSTRUCTED here (plausible_max 100): #2573's P2-FRAME fallback
 * (mc/records-frame-fallback @84b90641) is not in this head.
 *
 * ⛔ BLOCKED, NOT BY PORT 3 (measured at base 2bc3e53a and at this head, identical): the compile's deterministic sweep
 * (`deterministic-sweep.ts` factor_goal_split, :1558/:1566) replaces the user's Routes→goal edge with Routes→"Routes Impact"
 * (provenance `synthetic`, the user_stated bundle gone, β 4.89) + "Routes Impact"→goal (0.5 placeholder), BEFORE
 * `fitStatedEffects` sees it; testability fails P5 goal_path_unsized on "Routes Impact". `it.fails`: it turns RED the day
 * the split carries the user's sizing, so this cannot go stale silently.
 */
describe('Science (3): the vans B6(2) Routes case through buildModelFromRecords', () => {
  it.fails('ends targetTestability testable (BLOCKED by the sweep\'s factor→goal split; see the note above)', async () => {
    const VANS = 'We have 8 vans. We make 640 deliveries every month. Lease 5 vans. Adding 5 vans changes deliveries by 18 to 36 every month. Repainting 5 vans will not change deliveries. Goal: at least 900 deliveries every month within 7 months.';
    const VANS_WITH_ROUTES = `${VANS} We have 17 routes. Add 11 routes. Each extra route increases deliveries by 55 every month.`;
    const records: DraftRecordSet = { stated_items: [
      { kind: 'figure', source_quote: 'We have 8 vans.', quantity: 0, value: 8, value_literal: '8', unit: 'vans', unit_literals: ['vans'], role: 'baseline' },
      { kind: 'figure', source_quote: 'We make 640 deliveries every month.', quantity: 1, value: 640, value_literal: '640', unit: 'deliveries/month', unit_literals: ['deliveries', 'every month'], role: 'baseline' },
      { kind: 'option', source_quote: 'Lease 5 vans.', quantity: 0, value: 5, value_literal: '5', is_baseline: false },
      { kind: 'goal', source_quote: 'Goal: at least 900 deliveries every month within 7 months.', quantity: 1, role: 'target', value: 900, value_literal: '900', direction: 'floor', direction_literal: 'at least', baseline_ref: 1, horizon_ref: 4, horizon_months: 7 },
      { kind: 'figure', source_quote: 'within 7 months', value: 7, value_literal: '7', unit: 'months', unit_literals: ['months'] },
      { kind: 'cause', source_quote: 'Repainting 5 vans will not change deliveries.', relationship: { from_quantity: 0, to_quantity: 1, no_effect_literal: 'will not change' } },
      { kind: 'figure', source_quote: 'We have 17 routes.', quantity: 6, value: 17, value_literal: '17', unit: 'routes', unit_literals: ['routes'], role: 'baseline', plausible_max: 100 },
      { kind: 'option', source_quote: 'Add 11 routes.', quantity: 6, value: 11, value_literal: '11' },
      { kind: 'cause', source_quote: 'Each extra route increases deliveries by 55 every month.', relationship: { from_quantity: 6, to_quantity: 1, amount: 55, amount_literal: '55', per_source_change: 1, per_source_literal: 'Each' } },
    ], claims: [
      { claim_kind: 'factor', label: 'Vans', quantity: 0, value: 8 },
      { claim_kind: 'causal_link', label: 'lease setting', from_stated: 2, to_claim: 0, effect: 'positive' },
      { claim_kind: 'factor', label: 'Routes', quantity: 6, value: 17 },
      { claim_kind: 'causal_link', label: 'repainting effect', from_claim: 0, to_stated: 3, effect: 'positive' },
    ] };
    // Precondition (identity): the projector sizes Routes→goal at β 4.89 on Routes' frame 100 before any refit.
    const projected = await replayRecordSet(records, { brief: VANS_WITH_ROUTES });
    if (!projected.ok) throw new Error(projected.detail);
    const routes = projected.projection.graph.nodes.find((n) => n.kind === 'factor' && n.quantity_ref === 6)!;
    expect(routes.scale_frame).toBe(100);
    expect(projected.projection.graph.edges.find((e) => e.provenance?.source_quote === records.stated_items[8]!.source_quote)?.strength_mean).toBeCloseTo(4.89, 2);
    const { result, writes } = await build(records, VANS_WITH_ROUTES);
    expect(result.ok).toBe(true);
    const stored = assignEntityRefs(projectGraphForPersistence(writes[0]!.graph as never, { scenarioId: '11111111-1111-4111-8111-111111111111', turnClass: 'direct_answer', source: 'graph_registration' }), null).graph;
    expect(targetTestabilityOf(stored)).toMatchObject({ kind: 'testable' });
  });
});
