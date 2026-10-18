/**
 * ⭐ A3: THE GOAL IS SAVED AS THE USER STATED IT (proof 1, D2: "at least 20 new customers" saved as Olumi's reading). The AI's
 * own statement of the goal's target verified against the brief (`goalTargetStatements`, the one authorship owner), yet the
 * goal's record and its own target row read the draft's provenance flag ("inferred") and were saved as Olumi's. A verified
 * target is the user's; an unverified one stays as drafted. SYNTHETIC brief, through `buildModelFromBrief` → `/graph/register`.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';

type Rec = Record<string, any>;
const SID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const SUCCESS = 'Success means a sign-up rate above 12% and at least 30 new members in the first two months after opening.';
const BRIEF = `We are opening a climbing gym and choosing between a leaflet drop and a social campaign. ${SUCCESS} `
  + 'We can spend at most £5,000 on promotion.';
const GOAL = 'new members';
const RATE = 'Sign-up rate';
const VISITS = 'Trial visits';
const SPEND = 'Promotion spend';

const statement = (quote: string, subject: Rec, field: string, form: string, value: number, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null });
const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
  effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });

/** The served shape: the AI flags its own goal "inferred" while its statement of the target quotes the user. */
function draft(o: { readonly targetQuote?: string } = {}): Rec {
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 30, unit: GOAL, horizon_months: 2,
      provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null,
      quantity_frame: 'level', basis: { reference: 'opening', denominator: null, period_months: 2, period_kind: 'over_period',
        effect_unit: 'new members in the first two months after opening', effects_at_period_end: false,
        also_required: ['a sign-up rate above 12%'], open_question: null }, source_quote: SUCCESS, deadline_words: null },
    constraints: [
      { metric: RATE, operator: '>', value: 12, unit: '%', provenance: 'explicit', frame: 'level', role: 'target' },
      { metric: SPEND, operator: '<=', value: 5000, unit: 'GBP', provenance: 'explicit', frame: 'level', role: 'limit' },
    ],
    options: [
      { label: 'Leaflet drop', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: SPEND, value: 2000, value_kind: 'absolute', unit: 'GBP', provenance: 'ai_proposed' }] },
      { label: 'Social campaign', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: SPEND, value: 4000, value_kind: 'absolute', unit: 'GBP', provenance: 'ai_proposed' }] },
    ],
    factors: [
      // Today's levels are Olumi's estimates (the brief gives none), so the Run can prepare its request.
      { label: SPEND, role: 'controllable', baseline_known: true, baseline_value: 1000, unit: 'GBP', provenance: 'ai_proposed', plausible_max: 10000 },
      { label: VISITS, role: 'observable', baseline_known: true, baseline_value: 200, unit: 'visits', provenance: 'ai_proposed', plausible_max: 1000 },
      { label: RATE, role: 'observable', baseline_known: true, baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [link(SPEND, VISITS), link(VISITS, GOAL), link(RATE, GOAL)],
    identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    statements: [
      statement(o.targetQuote ?? SUCCESS, { kind: 'goal', label: GOAL }, 'target', 'lower_bound', 30, GOAL),
      statement(SUCCESS, { kind: 'factor', label: RATE }, 'target', 'lower_bound', 12, '%'),
    ],
  };
}

async function registered(model: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, BRIEF, d, (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 1500)).toBe(true);
  return graph!;
}
/** The saved graph read cold, as the Run prepares its request, stopped before the engine (0 engine calls). */
async function prepared(graph: Rec): Promise<{ cold: Rec; request: Rec | undefined }> {
  const cold = GraphV3.parse(JSON.parse(JSON.stringify(graph))) as Rec;
  await createAgentCapabilities((async () => ({ status: 200, json: { graph: cold, graph_hash: 'cold' } })) as never, new ProposalStore())
    .getCanonicalState({ scenario_id: SID, authenticated_user_id: null, request_id: 'cold', user_text: 'What is known?', user_turn_text: 'What is known?' } as never);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'cold', { loadGraphAndBriefText: async () => ({ graph: cold, briefText: BRIEF }),
    readMostRecentPendingActions: async () => [] } as never);
  let request: Rec | undefined;
  let engineCalls = 0;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: async () => { engineCalls++; throw Error('ENGINE'); }, validatePatch: async () => { throw Error('ENGINE'); } },
    probe: async (v: Rec) => { request = v.plotPayload; throw Error('STOP_AFTER_REQUEST'); } } as never);
  try {
    await handler({ payload: { scenario_id: SID, turn_id: 'cold', kind: 'message', message: 'Run analysis.' }, requestId: 'cold',
      signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  } catch { /* stopped at the request */ }
  expect(engineCalls).toBe(0);
  return { cold, request };
}
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const ownTargetRow = (g: Rec): Rec | undefined => (g.goal_constraints ?? []).find((c: Rec) => c.node_id === goalOf(g).id && c.role === 'goal_target');

describe('A3: the goal\'s verified target is the user\'s (D2)', () => {
  it('⭐ RED → GREEN: "at least 30 new members", verified in the user\'s sentence, is the user\'s target: saved, read cold and sent to the Run', async () => {
    const { cold, request } = await prepared(await registered(draft()));
    const goal = goalOf(cold);
    expect(goal).toMatchObject({ goal_threshold_raw: 30, goal_direction: '>=' });
    // Authorship, three dimensions. (1) Human source: the goal and its own target row are the user's, with their sentence recorded.
    expect(goal.provenance, JSON.stringify(goal)).toBe('from_brief');
    expect(ownTargetRow(cold), JSON.stringify(cold.goal_constraints)).toMatchObject({ value: 30, provenance: 'explicit' });
    expect(goal.user_statements, JSON.stringify(goal.user_statements ?? null)).toEqual(expect.arrayContaining([expect.objectContaining({
      field: 'target', statements: [expect.objectContaining({ speaker: 'user', quote: SUCCESS, form: 'lower_bound', low: 30 })] })]));
    // (2) Olumi's readings stay Olumi's: the promotion is the verified target only, never the levels Olumi supplied beside it.
    const rateToday = cold.nodes.find((n: Rec) => n.label === RATE);
    expect(rateToday.provenance, JSON.stringify(rateToday)).toBe('ai_inferred');
    expect(goal.goal_deadline_as_stated).toBe('two months');
    // (3) No approval is claimed: the user approved nothing here.
    expect(JSON.stringify(goal)).not.toMatch(/reviewed_by_user|approved_by_user/);
    // The co-equal target the user stated is kept beside it, its strict comparator as stated.
    expect((cold.goal_constraints as Rec[]).find((c) => c.operator_as_stated === '>')).toMatchObject({ value: 12, role: 'goal_target', provenance: 'explicit' });
    // The prepared Run request carries both of the user's targets, by the goal's and the rate's own ids.
    const rate = cold.nodes.find((n: Rec) => n.label === RATE);
    expect(request, 'the Run prepared its request').toBeDefined();
    expect((request!.goal_constraints as Rec[]).map((c) => [c.node_id, c.value]).sort()).toEqual(expect.arrayContaining([[goal.id, 30], [rate.id, 12]]));
  });

  it('CONTRAST: a target statement that does not verify (not the user\'s words) leaves the drafted reading as it was: Olumi\'s', async () => {
    const { cold } = await prepared(await registered(draft({ targetQuote: 'We would like at least 30 new members soon.' })));
    expect(goalOf(cold).provenance).toBe('ai_inferred');
    expect(ownTargetRow(cold)?.provenance).not.toBe('explicit');
  });
});

