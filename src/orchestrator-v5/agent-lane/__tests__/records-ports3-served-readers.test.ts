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
import { createHash } from 'node:crypto';
import { censusConfidenceParameters, comparisonSubstrate } from '../../admission/analysis-admission.js';
import { earnsAuthorshipCredit, edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { holdsByDefinition, nodeUnitOf } from '../../../orchestrator/context/placeholder-parts.js';
import { nodesUnderANonlinearIdentity } from '../admit-model.js';
import { GOAL_QUANTITY_IDENTITY_QUOTE } from '../../../cee/draft/records/projector.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { omitOptionalRecordNulls } from '../runtime/build-model-from-records.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../../cee/constants.js';
import { EdgeStrengthV3, GraphV3 } from '../../../schemas/cee-v3.js';
import { Graph as V1GraphSchema } from '../../../schemas/graph.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';

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

// ── Science (3) and the Science ruling's binding rows (option A, 5 Oct 2026) ──────────────────────────────────────────
// The vans B6(2) case — 17 routes, "55 deliveries per route", Routes frame 100 (CONSTRUCTED here: plausible_max 100),
// β 4.89 before refit — through buildModelFromRecords. It was BLOCKED (an `it.fails` here): the user's cause targets the
// GOAL's own quantity, so the projector drew Routes→goal and the served sweep's factor_goal_split (`deterministic-sweep.ts`)
// replaced it with a synthetic "Routes Impact" + a 0.5 placeholder before any refit (P5 goal_path_unsized). Option A
// (records-only, `projector.ts` "VANS OUTCOME CARRIER"): the cause lands on the goal quantity's OUTCOME node and the goal
// is reached by the same-quantity identity the sealed brief's outcome claim gets, sized by the ONE writer (pass 3e
// `writeDefinition`). No sweep change; `records-v25/` untouched.
const VANS = 'We have 8 vans. We make 640 deliveries every month. Lease 5 vans. Adding 5 vans changes deliveries by 18 to 36 every month. Repainting 5 vans will not change deliveries. Goal: at least 900 deliveries every month within 7 months.';
const VANS_WITH_ROUTES = `${VANS} We have 17 routes. Add 11 routes. Each extra route increases deliveries by 55 every month.`;
const ROUTE_QUOTE = 'Each extra route increases deliveries by 55 every month.';
const SCENARIO = '11111111-1111-4111-8111-111111111111';
/** B6(2): the stated no-effect on vans, the stated Routes cause on the goal's quantity (q1). */
function vansB62Records(): DraftRecordSet {
  return { stated_items: [
    { kind: 'figure', source_quote: 'We have 8 vans.', quantity: 0, value: 8, value_literal: '8', unit: 'vans', unit_literals: ['vans'], role: 'baseline' },
    { kind: 'figure', source_quote: 'We make 640 deliveries every month.', quantity: 1, value: 640, value_literal: '640', unit: 'deliveries/month', unit_literals: ['deliveries', 'every month'], role: 'baseline' },
    { kind: 'option', source_quote: 'Lease 5 vans.', quantity: 0, value: 5, value_literal: '5', is_baseline: false },
    { kind: 'goal', source_quote: 'Goal: at least 900 deliveries every month within 7 months.', quantity: 1, role: 'target', value: 900, value_literal: '900', direction: 'floor', direction_literal: 'at least', baseline_ref: 1, horizon_ref: 4, horizon_months: 7 },
    { kind: 'figure', source_quote: 'within 7 months', value: 7, value_literal: '7', unit: 'months', unit_literals: ['months'] },
    { kind: 'cause', source_quote: 'Repainting 5 vans will not change deliveries.', relationship: { from_quantity: 0, to_quantity: 1, no_effect_literal: 'will not change' } },
    { kind: 'figure', source_quote: 'We have 17 routes.', quantity: 6, value: 17, value_literal: '17', unit: 'routes', unit_literals: ['routes'], role: 'baseline', plausible_max: 100 },
    { kind: 'option', source_quote: 'Add 11 routes.', quantity: 6, value: 11, value_literal: '11' },
    { kind: 'cause', source_quote: ROUTE_QUOTE, relationship: { from_quantity: 6, to_quantity: 1, amount: 55, amount_literal: '55', per_source_change: 1, per_source_literal: 'Each' } },
  ], claims: [
    { claim_kind: 'factor', label: 'Vans', quantity: 0, value: 8 },
    { claim_kind: 'causal_link', label: 'lease setting', from_stated: 2, to_claim: 0, effect: 'positive' },
    { claim_kind: 'factor', label: 'Routes', quantity: 6, value: 17 },
    { claim_kind: 'causal_link', label: 'repainting effect', from_claim: 0, to_stated: 3, effect: 'positive' },
  ] };
}
/** The Run variant (probe default): the vans cause SIZED (18 to 36 per 5 vans), so both options reach the goal and run. */
function vansSizedRecords(): DraftRecordSet {
  const records = vansB62Records();
  records.stated_items[5] = { kind: 'cause', source_quote: 'Adding 5 vans changes deliveries by 18 to 36 every month.',
    relationship: { from_quantity: 0, to_quantity: 1, per_source_change: 5, per_source_literal: '5', range: { low: 18, high: 36, low_literal: '18', high_literal: '36' } } };
  records.claims = records.claims.slice(0, 3);
  return records;
}
type Built = { result: ToolResult; graph: Rec; stored: Rec; projected: Rec; goal: Rec; outcome: Rec; routes: Rec };
/** One records build, its registered and stored graphs, and the goal / goal-quantity outcome / Routes by identity. */
async function vansBuild(records: DraftRecordSet, brief = VANS_WITH_ROUTES): Promise<Built> {
  const replay = await replayRecordSet(structuredClone(records), { brief });
  if (!replay.ok) throw new Error(replay.detail);
  const projected = replay.projection.graph as Rec;
  const goal = (projected.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  const outcomes = (projected.nodes as Rec[]).filter((n) => n.kind === 'outcome' && n.quantity_ref === goal.quantity_ref);
  const routes = (projected.nodes as Rec[]).find((n) => n.kind === 'factor' && n.quantity_ref === 6)!;
  const { result, writes } = await build(records, brief);
  expect(result.ok).toBe(true);
  const graph = writes[0]!.graph as Rec;
  const stored = assignEntityRefs(projectGraphForPersistence(graph as never, { scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration' }), null).graph as Rec;
  return { result, graph, stored, projected, goal, outcome: outcomes[0]!, routes };
}
/** The served run_analysis handler on a registered graph: the PLoT request it sends and its recorded `input_snapshot`. */
async function plotRequest(graph: Rec): Promise<{ sent: Rec; snapshot: Rec | undefined }> {
  const minimal = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8'));
  const goal = (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option')
    .map((n) => ({ id: n.id, option_id: n.id, label: n.label, interventions: n.interventions ?? {} }));
  const snapshot = { graph: structuredClone(graph), options, goal_node_id: goal.id, rawPersistedGraph: structuredClone(graph) };
  const runMock = vi.fn(async () => structuredClone(minimal));
  const handler = createRunAnalysisHandler({ plotClient: { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) }, scenarioReader: async () => snapshot } as never);
  const out = await handler({ payload: { scenario_id: SCENARIO }, requestId: 'req-vans-outcome', signal: new AbortController().signal, context: {}, orientationText: '' } as never).catch((x: unknown) => x);
  expect(runMock, JSON.stringify(out).slice(0, 400)).toHaveBeenCalledTimes(1);
  return { sent: ((runMock.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph,
    snapshot: (out as { handler_facts?: Array<{ result?: { input_snapshot?: Rec } }> }).handler_facts?.[0]?.result?.input_snapshot };
}
/** The sweep's split shape, by its own minted identity: an `out_<factor>_impact` node, or its 0.5 placeholder limb. */
const splitNodes = (g: Rec): Rec[] => (g.nodes as Rec[]).filter((n) => /^out_.*_impact$/.test(n.id) || / Impact$/.test(String(n.label)));
const splitLimbs = (g: Rec): Rec[] => (g.edges as Rec[]).filter((e) => e.provenance?.quote === 'Split factor→goal into factor→outcome→goal');

describe('Science (3): the vans B6(2) Routes case through buildModelFromRecords', () => {
  it('ends targetTestability testable, the user\'s 55/route carried on Routes→outcome (refit to the frames, so no clamp to disclose)', async () => {
    const records = vansB62Records();
    const { stored, projected, goal, outcome, routes } = await vansBuild(records);
    // Precondition (identity): Routes' frame 100; the projector sizes the user's cause at β 4.89 before any refit.
    expect(routes.scale_frame).toBe(100);
    expect(outcome, 'the goal quantity\'s outcome carrier').toBeDefined();
    const projectedEdge = (projected.edges as Rec[]).find((e) => e.provenance?.source_quote === ROUTE_QUOTE)!;
    expect([projectedEdge.from, projectedEdge.to]).toEqual([routes.id, outcome.id]);
    expect(projectedEdge.strength_mean).toBeCloseTo(4.89, 2);
    expect((projected.edges as Rec[]).filter((e) => e.from === routes.id && e.to === goal.id)).toHaveLength(0);
    // P5 holds: the goal path is sized.
    expect(targetTestabilityOf(stored as never)).toEqual({ kind: 'testable', goal_id: goal.id });
    // The user's 55 deliveries per route, carried. MEASURED: port 3's refit widens the outcome (and, by A4f's cascade, the
    // goal) 1125 → 10,000, so the size FITS at 0.55 (55 × 100 / 10,000) — no clamp, so no clamp disclosure is owed.
    const edge = (stored.edges as Rec[]).find((e) => e.from === routes.id && e.to === outcome.id)!;
    expect(edge.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: ROUTE_QUOTE,
      natural_effect: { amount: 55, amount_unit: 'deliveries/month', per_source_change: 1, per_source_change_unit: 'routes' } });
    expect(edge.provenance.natural_effect.strength_mean).toBe(edge.strength.mean);
    expect(edge.strength.mean).toBeCloseTo(0.55, 12);
    expect(edge.provenance).not.toHaveProperty('clamped_from');
    expect((stored.nodes as Rec[]).find((n) => n.id === outcome.id)!.scale_frame).toBe(10000);
  });

  it('a model link that drew the stated cause into the goal MOVES onto the outcome: one Routes link, the user\'s, none left for the sweep', async () => {
    const records = vansB62Records();
    records.claims.push({ claim_kind: 'causal_link', label: 'routes help', from_claim: 2, to_stated: 3, effect: 'positive' });
    const { stored, projected, goal, outcome, routes } = await vansBuild(records);
    const fromRoutes = (projected.edges as Rec[]).filter((e) => e.from === routes.id);
    expect(fromRoutes.map((e) => e.to)).toEqual([outcome.id]);
    expect(fromRoutes[0]!.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: ROUTE_QUOTE });
    expect((stored.edges as Rec[]).filter((e) => e.from === routes.id && e.to === goal.id)).toEqual([]);
    expect(splitNodes(stored)).toEqual([]);
    expect(targetTestabilityOf(stored as never)).toEqual({ kind: 'testable', goal_id: goal.id });
  });

  it('Science row 1: outcome→goal is a LINEAR identity — β 1 per 1 in the goal\'s unit, definitional, positive; nothing nonlinear', async () => {
    const { graph, stored, goal, outcome } = await vansBuild(vansB62Records());
    // The outcome measures the goal's quantity in the goal's unit (the projector's carrier; V3 stores a unit only beside a level).
    expect(outcome).toMatchObject({ kind: 'outcome', quantity_ref: goal.quantity_ref, data: { unit: goal.goal_threshold_unit } });
    const into = (stored.edges as Rec[]).filter((e) => e.from === outcome.id && e.to === goal.id);
    expect(into).toHaveLength(1);
    const identity = into[0]!;
    expect(identity.strength.mean).toBe(1);
    expect(identity.effect_direction).toBe('positive');
    expect(identity.provenance).toMatchObject({ definitional: true, quote: GOAL_QUANTITY_IDENTITY_QUOTE,
      natural_effect: { amount: 1, per_source_change: 1, amount_unit: goal.goal_threshold_unit, per_source_change_unit: goal.goal_threshold_unit, strength_mean: 1 } });
    expect(holdsByDefinition(identity, nodeUnitOf(stored.nodes as unknown[]))).toBe(true);
    // Linear: no product/sum carrier anywhere, so nothing is under a nonlinear identity (registered and stored).
    expect((graph.nodes as Rec[]).filter((n) => n.nonlinear_identity !== undefined)).toEqual([]);
    expect(nodesUnderANonlinearIdentity(graph).size).toBe(0);
    expect(nodesUnderANonlinearIdentity(stored).size).toBe(0);
    // The ONE writer: the sealed brief's model-drawn identity (its outcome claim → goal) stores the same numbers.
    const sealed = (await build(sealedRecords(), BRIEF)).writes[0]!.graph as Rec;
    const sealedGoal = (sealed.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const sealedIdentity = (sealed.edges as Rec[]).filter((e) => e.to === sealedGoal.id && e.provenance?.definitional === true);
    expect(sealedIdentity).toHaveLength(1);
    const numbers = (e: Rec) => ({ strength: e.strength, exists_probability: e.exists_probability, effect_direction: e.effect_direction, source: e.provenance.source });
    expect(numbers(identity)).toEqual(numbers(sealedIdentity[0]!));
  });

  // IDENTITY NOISE (i) (Science ruling 2026-10-05): a definitional identity is noise-free. Was `it.fails` (the writer stored
  // std 0.5·β and V3 gave exists 0.8). std 0 itself is not representable on CEE's path (`IDENTITY NOISE (i)` rows below),
  // so "noise-free" is the estate's definitional floor: std LLM_STRENGTH_STD_FLOOR, exists 1 (as legacy's sum parts).
  it('Science row 1 "no noise" (identity noise (i)): certain and at the definitional floor — projected, registered, stored, sent', async () => {
    const records = vansSizedRecords();
    const replay = await replayRecordSet(structuredClone(records), { brief: VANS_WITH_ROUTES });
    if (!replay.ok) throw new Error(replay.detail);
    const { graph, stored, goal, outcome } = await vansBuild(records);
    const projected = replay.projection.graph.edges.find((e) => e.from === outcome.id && e.to === goal.id)!;
    expect({ std: projected.strength_std, exists: projected.belief_exists }).toEqual({ std: LLM_STRENGTH_STD_FLOOR, exists: 1 });
    const noise = (g: Rec) => {
      const e = (g.edges as Rec[]).find((x) => x.from === outcome.id && x.to === goal.id)!;
      return { mean: e.strength.mean, std: e.strength.std, exists_probability: e.exists_probability };
    };
    const expected = { mean: 1, std: LLM_STRENGTH_STD_FLOOR, exists_probability: 1 };
    expect(noise(graph)).toEqual(expected);
    expect(noise(stored)).toEqual(expected);
    expect(noise((await plotRequest(graph)).sent)).toEqual(expected);
    // Still the definitional identity it was: the size and its natural_effect are untouched by the noise.
    expect(holdsByDefinition((stored.edges as Rec[]).find((e) => e.from === outcome.id && e.to === goal.id)!, nodeUnitOf(stored.nodes as unknown[]))).toBe(true);
    // The ONE writer: the sealed brief's model-drawn identity carries the same noise.
    const sealed = (await build(sealedRecords(), BRIEF)).writes[0]!.graph as Rec;
    const sealedGoal = (sealed.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const sealedIdentity = (sealed.edges as Rec[]).find((e) => e.to === sealedGoal.id && e.provenance?.definitional === true)!;
    expect({ std: sealedIdentity.strength.std, exists_probability: sealedIdentity.exists_probability }).toEqual({ std: LLM_STRENGTH_STD_FLOOR, exists_probability: 1 });
  });

  it('Science row 1 NEGATIVE TWIN: a stated cause on a DIFFERENT quantity (another unit) mints no outcome and no identity edge', async () => {
    const records = vansB62Records();
    const brief = `${VANS} We have 17 routes. Add 11 routes. Fuel costs £2,000 a month. Each extra route adds £120 a month in fuel.`;
    records.stated_items[8] = { kind: 'cause', source_quote: 'Each extra route adds £120 a month in fuel.',
      relationship: { from_quantity: 6, to_quantity: 9, amount: 120, amount_literal: '£120', per_source_change: 1, per_source_literal: 'Each' } };
    records.stated_items[9] = { kind: 'figure', source_quote: 'Fuel costs £2,000 a month.', quantity: 9, value: 2000, value_literal: '£2,000', unit: '£/month', unit_literals: ['a month'], role: 'baseline' };
    records.claims.push({ claim_kind: 'outcome', label: 'Fuel cost', quantity: 9 }, { claim_kind: 'causal_link', label: 'fuel spend', from_claim: 4, to_stated: 3, effect: 'negative' });
    const replay = await replayRecordSet(records, { brief });
    if (!replay.ok) throw new Error(replay.detail);
    const g = replay.projection.graph as Rec;
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const fuel = (g.nodes as Rec[]).find((n) => n.label === 'Fuel cost')!;
    const routes = (g.nodes as Rec[]).find((n) => n.kind === 'factor' && n.quantity_ref === 6)!;
    // The cause is carried on its OWN quantity's carrier, never re-pointed at the goal…
    expect((g.edges as Rec[]).find((e) => e.provenance?.source_quote === 'Each extra route adds £120 a month in fuel.')).toMatchObject({ from: routes.id, to: fuel.id });
    // …and nothing is minted for the goal's quantity: no outcome on q1, no identity edge, no definitional link into the goal.
    expect((g.nodes as Rec[]).filter((n) => n.kind === 'outcome' && n.quantity_ref === goal.quantity_ref)).toEqual([]);
    expect((g.edges as Rec[]).filter((e) => e.provenance?.quote === GOAL_QUANTITY_IDENTITY_QUOTE || (e.to === goal.id && e.provenance?.definitional === true))).toEqual([]);
    // Control (same run): the goal-quantity cause DOES mint exactly one (the probe sees the class).
    const control = await replayRecordSet(vansB62Records(), { brief: VANS_WITH_ROUTES });
    if (!control.ok) throw new Error(control.detail);
    expect(control.projection.graph.edges.filter((e) => e.provenance?.quote === GOAL_QUANTITY_IDENTITY_QUOTE)).toHaveLength(1);
  });

  it('a goal-quantity cause REFUSED after the mint leaves no outcome and no identity: the goal carries the quantity as before', async () => {
    const records = vansB62Records();
    const quote = 'Each extra route changes deliveries by -10 to 55 every month.';
    records.stated_items[8] = { kind: 'cause', source_quote: quote, relationship: { from_quantity: 6, to_quantity: 1, per_source_change: 1, per_source_literal: 'Each',
      range: { low: -10, high: 55, low_literal: '-10', high_literal: '55' } } };
    const replay = await replayRecordSet(records, { brief: `${VANS} We have 17 routes. Add 11 routes. ${quote}` });
    if (!replay.ok) throw new Error(replay.detail);
    const g = replay.projection.graph;
    const goal = g.nodes.find((n) => n.kind === 'goal')!;
    expect(replay.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 8, reason: 'range_straddles_zero' }));
    expect(g.nodes.filter((n) => n.kind === 'outcome' && n.quantity_ref === goal.quantity_ref)).toEqual([]);
    expect(g.edges.filter((e) => e.provenance?.quote === GOAL_QUANTITY_IDENTITY_QUOTE)).toEqual([]);
  });

  it('SCOPE: an INFERRED link into the goal (no stated cause) stays factor→goal, byte-identical to the build without option A\'s mint', async () => {
    const withInferred = (records: DraftRecordSet): DraftRecordSet => {
      records.claims.push({ claim_kind: 'factor', label: 'Driver hours' }, { claim_kind: 'causal_link', label: 'driver hours help', from_claim: records.claims.length, to_stated: 3, effect: 'positive' });
      return records;
    };
    const minted = await replayRecordSet(withInferred(vansB62Records()), { brief: VANS_WITH_ROUTES });
    // Contrast: the same records without the stated goal-quantity cause, so option A mints nothing.
    const unminted = vansB62Records();
    unminted.stated_items[8] = { kind: 'figure', source_quote: 'We have 17 routes.', value: 17, value_literal: '17', unit: 'routes', unit_literals: ['routes'] };
    const plain = await replayRecordSet(withInferred(unminted), { brief: VANS_WITH_ROUTES });
    if (!minted.ok || !plain.ok) throw new Error('replay refused');
    const inferredOf = (g: Rec) => {
      const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
      const driver = (g.nodes as Rec[]).find((n) => n.label === 'Driver hours')!;
      return (g.edges as Rec[]).filter((e) => e.from === driver.id && (e.to === goal.id || (g.nodes as Rec[]).some((n) => n.id === e.to && n.kind === 'outcome')));
    };
    expect(minted.projection.graph.edges.filter((e) => e.provenance?.quote === GOAL_QUANTITY_IDENTITY_QUOTE)).toHaveLength(1);
    expect(plain.projection.graph.edges.filter((e) => e.provenance?.quote === GOAL_QUANTITY_IDENTITY_QUOTE)).toHaveLength(0);
    const a = inferredOf(minted.projection.graph as Rec);
    expect(a).toHaveLength(1);
    expect(a[0]!.to).toBe((minted.projection.graph.nodes as Rec[]).find((n) => n.kind === 'goal')!.id);
    expect(a[0]!.provenance).not.toHaveProperty('magnitude');
    expect(stableStringify(a)).toBe(stableStringify(inferredOf(plain.projection.graph as Rec)));
  });

  it('Science row 2: the PLoT request carries the user\'s β and bundle on Routes→outcome; no placeholder, no synthetic Impact on the goal path', async () => {
    const { graph, goal, outcome, routes } = await vansBuild(vansSizedRecords());
    const { sent, snapshot } = await plotRequest(graph);
    const wire = (sent.edges as Rec[]).find((e) => e.from === routes.id && e.to === outcome.id)!;
    expect(wire.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: ROUTE_QUOTE,
      natural_effect: { amount: 55, amount_unit: 'deliveries/month', per_source_change: 1, per_source_change_unit: 'routes' } });
    // The β sent IS the user's size in the Run's frames (refit, so ≤ 1 and nothing for PLoT to clamp).
    expect(wire.strength.mean).toBe(wire.provenance.natural_effect.strength_mean);
    expect(wire.strength.mean).toBeCloseTo(0.55, 12);
    expect(wire.provenance).not.toHaveProperty('clamped_from');
    // Every link into the goal is a definitional identity from a goal-quantity outcome; none is Olumi's placeholder.
    const intoGoal = (sent.edges as Rec[]).filter((e) => e.to === goal.id);
    expect(intoGoal.map((e) => [e.from, e.strength.mean, e.provenance.definitional])).toEqual([[outcome.id, 1, true]]);
    expect(splitNodes(sent)).toEqual([]);
    expect(splitLimbs(sent)).toEqual([]);
    // input_snapshot (what the Run was SENT, SC-24): the same link, sized by the user.
    expect(snapshot, 'input_snapshot recorded').toBeDefined();
    expect((snapshot!.links as Rec[]).find((l) => l.from === routes.id && l.to === outcome.id)).toMatchObject({ mean: wire.strength.mean, sizing: 'user' });
    expect((snapshot!.links as Rec[]).filter((l) => /^out_.*_impact$/.test(l.from) || /^out_.*_impact$/.test(l.to))).toEqual([]);
  });

  it('Science row 2 CONTRAST (same run): an inferred factor→goal link still gets the sweep\'s Impact + 0.5 placeholder — the probe sees the class', async () => {
    const records = vansSizedRecords();
    records.claims.push({ claim_kind: 'factor', label: 'Driver hours' }, { claim_kind: 'causal_link', label: 'driver hours help', from_claim: 3, to_stated: 3, effect: 'positive' });
    const { graph, goal, outcome, routes } = await vansBuild(records);
    const { sent } = await plotRequest(graph);
    expect(splitNodes(sent).map((n) => n.label)).toEqual(['Driver hours Impact']);
    expect(splitLimbs(sent).find((e) => e.to === goal.id)?.strength.mean).toBe(0.5);
    // …while the user's stated cause is untouched beside it.
    expect((sent.edges as Rec[]).find((e) => e.from === routes.id && e.to === outcome.id)?.provenance?.magnitude).toBe('user_stated');
  });

  it('Science row 3: the vans Run is testable and admission counts the stated Routes→outcome size as user-stated MATERIAL', async () => {
    const { stored, goal, outcome, routes } = await vansBuild(vansB62Records());
    expect(targetTestabilityOf(stored as never)).toEqual({ kind: 'testable', goal_id: goal.id });
    const edge = (stored.edges as Rec[]).find((e) => e.from === routes.id && e.to === outcome.id)!;
    expect(earnsAuthorshipCredit(edgeStrengthProvenance(edge))).toBe(true);
    const { materialNodeIds } = comparisonSubstrate(stored);
    expect(materialNodeIds.has(routes.id) && materialNodeIds.has(outcome.id)).toBe(true);
    const census = censusConfidenceParameters(stored);
    expect(census.material_parameters_user_stated).toBeGreaterThan(0);
    // By identity: THIS link is the user-stated material parameter (strip its authorship and the count drops by one).
    const stripped = structuredClone(stored);
    const twin = (stripped.edges as Rec[]).find((e) => e.from === routes.id && e.to === outcome.id)!;
    twin.provenance = { source: 'cee_hypothesis' };
    expect(censusConfidenceParameters(stripped).material_parameters_user_stated).toBe(census.material_parameters_user_stated - 1);
  });
});

/** sha256 of a canonical serialisation: the byte identity row 4 pins. */
const fingerprint = (value: unknown): string => createHash('sha256').update(stableStringify(value ?? null)).digest('hex');

describe('Science row 4: the sealed brief is byte-identical under option A; re-pinned ONLY for identity noise (i)', () => {
  // Option A left these byte-identical to base a6617c31a432b80234a55b626656b6a7615a9d3f (pins taken there).
  // RE-PIN — "Science ruling 2026-10-05 identity noise (i)": the projector's ONE identity writer now writes each definitional
  // identity certain and at the definitional floor (std 0.5 → LLM_STRENGTH_STD_FLOOR, exists 0.8 → 1). That is the ONLY
  // byte change (each draw carries projector-written identities). Old (option A / base) → new:
  //   sealed projection a645a166…7fc25d → 635ed976…271135 · registration f04d5fe2…f27541 → 81c789a4…523afe ·
  //   analysis a47b8f90…0571fa → 483e9d19…284782 ·
  //   d1 projection 45d222f1…a1cea6 → 8ea5c39a…0d2266 · analysis d00c20f5…a35485 → 8ec98fdc…c39a51 ·
  //   d2 projection 655393ed…6cded9 → 3bbd7edc…453439 · analysis 1bb2f360…c0e8d6 → 9f077ed8…6fbb36 ·
  //   d3 projection f33c319b…8988ea → 3ee81559…25e2eb · analysis 1789a5e8…3c3ce2 → bdb571be…d90231.
  it('sealed v-next: projection, registration body and analysis-affecting hash', async () => {
    const replay = await replayRecordSet(sealedRecords(), { brief: BRIEF });
    if (!replay.ok) throw new Error(replay.detail);
    expect(fingerprint({ graph: replay.projection.graph, dropped: replay.projection.dropped })).toBe('635ed976a38296691b609faf815dd6b36c8fb8e04873adad20a35d60b7271135');
    const { writes } = await build(sealedRecords(), BRIEF);
    expect(fingerprint(writes[0])).toBe('81c789a43a9e9b1a3b2cfb73a410e2131fa2cf0db99fa134b511429bb7523afe');
    expect(computeAnalysisAffectingGraphHashSha256(writes[0]!.graph as never)).toBe('483e9d19708a92167d28808a92d794ec707fbc738035cbe126e5f1f65e284782');
  });

  const A16 = [
    { draw: 1, projection: '8ea5c39a16ac66aa94fd19d52e916a638136235a23b7c3746b05f6f0d80d2266', analysis: '8ec98fdc7a121d19c9832e16b288303f0ff2a21b78915b464213cc19abc39a51' },
    { draw: 2, projection: '3bbd7edc1b0455ab8baa4d514559f7fc695310a39330762bffde5fb44a453439', analysis: '9f077ed8fd9415d575591a00443c9279aeb697ded44e51fbcc1de7ce016fbb36' },
    { draw: 3, projection: '3ee815599bfced0e57b388b2bac3339aad592c73382bc2f73d1aaa3b0d25e2eb', analysis: 'bdb571be2bfffdb14bbe4768c4fced66d0136e9ef95612f7731e623259d90231' },
  ];
  for (const pin of A16) it(`banked sealed draw ${pin.draw}: projection and analysis-affecting hash`, async () => {
    const raw = JSON.parse(readFileSync(new URL(`../../../cee/draft/records/__tests__/compile-spec/fixtures/s2-sealed-d${pin.draw}.records.json`, import.meta.url), 'utf8')) as unknown;
    const replay = await replayRecordSet(omitOptionalRecordNulls(raw) as DraftRecordSet, { brief: BRIEF });
    if (!replay.ok) throw new Error(replay.detail);
    expect(fingerprint({ graph: replay.projection.graph, dropped: replay.projection.dropped })).toBe(pin.projection);
    let registered: Rec | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { registered = body as Rec; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    };
    const result = await buildModelFromRecords(SCENARIO, BRIEF, dispatch, async () => ({ text: JSON.stringify(raw), status: 'completed' }));
    expect(result.ok).toBe(true);
    expect(computeAnalysisAffectingGraphHashSha256(registered!.graph as never)).toBe(pin.analysis);
  });
});

// ── IDENTITY NOISE (i) (Science ruling 2026-10-05): the Lead's binding conditions, CEE side ─────────────────────────────
const PRE_NOISE_STORED = new URL('./fixtures/sealed-stored-pre-identity-noise-20261005.json', import.meta.url);
const C46_BRIEF = 'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase '
  + 'the Pro plan price from £49 to £59 per month with the next AI feature release?';
/** C46's product shape (MRR = Pro plan price × Pro subscribers), through the LEGACY constructor: a nonlinear identity. */
function productWire(): Record<string, unknown> {
  const link = (from: string, to: string, direction: string) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
  const price = (value: number) => ({ factor_label: 'Pro plan price', value, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' });
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, frame: 'level', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [price(49)] },
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [price(59)] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [link('Pro plan price', 'Monthly churn', 'positive'), link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Pro plan price', 'MRR', 'positive'), link('Pro subscribers', 'MRR', 'positive')],
    identities: [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' }],
    unknowns: [], decision_question: null,
  };
}

describe('IDENTITY NOISE (i): only the identity edges the projector writes change; schemas, stored graphs, nonlinear', () => {
  it('validators (CEE): exists 1 and the definitional floor pass V1, V3, GraphV3 and the run ingress; std 0 is refused (why the floor)', async () => {
    const { graph, stored, goal, outcome } = await vansBuild(vansSizedRecords());
    const identity = (stored.edges as Rec[]).find((e) => e.from === outcome.id && e.to === goal.id)!;
    expect(EdgeStrengthV3.safeParse(identity.strength).success).toBe(true);
    expect(GraphV3.safeParse(stored).success).toBe(true);
    expect(GraphV3.safeParse(graph).success).toBe(true);
    expect(GraphStateIngressSchema.safeParse(stored).success).toBe(true);
    const v1Edge = { from: outcome.id, to: goal.id, strength_mean: 1, belief_exists: 1 };
    const v1 = (std: number) => V1GraphSchema.safeParse({ nodes: [{ id: outcome.id, kind: 'outcome' }, { id: goal.id, kind: 'goal' }], edges: [{ ...v1Edge, strength_std: std }] }).success;
    expect(v1(LLM_STRENGTH_STD_FLOOR)).toBe(true);
    // std 0 itself is refused on CEE's own path — V1 `strength_std` and V3 `std` are `.positive()` — so it is not written.
    expect(v1(0)).toBe(false);
    expect(EdgeStrengthV3.safeParse({ mean: 1, std: 0 }).success).toBe(false);
  });

  it('a STORED pre-change graph is untouched: its analysis hash is the pre-change pin, and a Run sends its identity as stored', async () => {
    const pre = JSON.parse(readFileSync(PRE_NOISE_STORED, 'utf8')) as Rec;
    // Pinned at ed49c939c98e1f0e4fb5ab6f4c380e1051049e77 (before identity noise (i)): the sealed brief's stored graph.
    expect(computeAnalysisAffectingGraphHashSha256(pre as never)).toBe('a47b8f90834ce3256543b79e8fd96e5750e86c76a5e2b24395d9f7229d0571fa');
    const goal = (pre.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const stale = (pre.edges as Rec[]).find((e) => e.to === goal.id && e.provenance?.definitional === true)!;
    expect({ std: stale.strength.std, exists: stale.exists_probability }).toEqual({ std: 0.5, exists: 0.8 });
    // Nothing on the Run path rewrites it: PLoT is sent the stored numbers.
    const { sent } = await plotRequest(structuredClone(pre));
    expect((sent.edges as Rec[]).find((e) => e.from === stale.from && e.to === stale.to)).toMatchObject({ strength: { mean: 1, std: 0.5 }, exists_probability: 0.8 });
    // Contrast (same run): a fresh build writes the identity noise-free, so its hash differs — the probe sees the change.
    const fresh = (await build(sealedRecords(), BRIEF)).writes[0]!.graph as Rec;
    expect(computeAnalysisAffectingGraphHashSha256(fresh as never)).not.toBe('a47b8f90834ce3256543b79e8fd96e5750e86c76a5e2b24395d9f7229d0571fa');
    expect((fresh.edges as Rec[]).find((e) => e.from === stale.from && e.to === stale.to)).toMatchObject({ strength: { std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1 });
  });

  it('a NONLINEAR identity is unchanged: the legacy product carrier and the links into it are byte-identical to before (i)', async () => {
    let registered: Rec | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { registered = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const call = (async () => ({ text: JSON.stringify(productWire()) })) as unknown as CallStructuredModel;
    const out = await buildModelFromBrief('46464646-4646-4646-8646-46464646464e', C46_BRIEF, dispatch, call);
    expect(out.ok).toBe(true);
    const carrier = (registered!.nodes as Rec[]).find((n) => n.nonlinear_identity !== undefined)!;
    expect(carrier).toMatchObject({ id: 'mrr', nonlinear_identity: { operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'] } });
    const into = (registered!.edges as Rec[]).filter((e) => e.to === carrier.id).map((e) => ({ from: e.from, strength: e.strength, exists: e.exists_probability }));
    // Pinned at ed49c939c98e1f0e4fb5ab6f4c380e1051049e77 (before identity noise (i)).
    expect(into).toEqual([
      { from: 'pro_plan_price', strength: { mean: 0.5, std: 0.125 }, exists: 0.8 },
      { from: 'pro_subscribers', strength: { mean: 0.5, std: 0.125 }, exists: 0.8 },
    ]);
    expect(fingerprint(registered)).toBe('91f58c6171bbf5bdfda2559e4bbab7ad5a8c49a9eca17f4ff5eac2bc42fd3ba4');
    expect(computeAnalysisAffectingGraphHashSha256(registered as never)).toBe('c5608621972f4d36c0ca0ca73d3bc35f45cae157542cf60293e3a4d4d27e1c0b');
  });
});
