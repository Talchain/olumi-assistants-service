/**
 * ⭐ A3: THE GOAL IS SAVED AS THE USER STATED IT (proof 1, D2: "at least 20 new customers" saved as Olumi's reading). The AI's
 * own statement of the goal's target verified against the brief (`goalTargetStatements`, the one authorship owner), yet the
 * goal's record and its own target row read the draft's provenance flag ("inferred") and were saved as Olumi's. A verified
 * target is the user's; an unverified one stays as drafted. SYNTHETIC brief, through `buildModelFromBrief` → `/graph/register`.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

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
      { label: 'Leaflet drop', provenance: 'explicit', changes: [SPEND], interventions: [], added_capacity: null, is_status_quo: null },
      { label: 'Social campaign', provenance: 'explicit', changes: [SPEND], interventions: [], added_capacity: null, is_status_quo: null },
    ],
    factors: [
      { label: SPEND, role: 'controllable', baseline_known: false, baseline_value: null, unit: 'GBP', provenance: 'explicit', plausible_max: 10000 },
      { label: VISITS, role: 'observable', baseline_known: false, baseline_value: null, unit: 'visits', provenance: 'ai_proposed', plausible_max: 1000 },
      { label: RATE, role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'explicit', plausible_max: 100 },
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
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const ownTargetRow = (g: Rec): Rec | undefined => (g.goal_constraints ?? []).find((c: Rec) => c.node_id === goalOf(g).id && c.role === 'goal_target');

describe('A3: the goal\'s verified target is the user\'s (D2)', () => {
  it('⭐ RED → GREEN: "at least 30 new members", verified in the user\'s sentence, saves the goal and its own target row as the user\'s', async () => {
    const g = await registered(draft());
    expect(goalOf(g)).toMatchObject({ goal_threshold_raw: 30, goal_direction: '>=' });
    expect(goalOf(g).provenance, JSON.stringify(goalOf(g))).not.toBe('ai_inferred');
    expect(ownTargetRow(g), JSON.stringify(g.goal_constraints)).toMatchObject({ value: 30, provenance: 'explicit' });
    // The co-equal target the user stated is kept beside it, its strict comparator as stated.
    expect((g.goal_constraints as Rec[]).find((c) => c.operator_as_stated === '>')).toMatchObject({ value: 12, role: 'goal_target', provenance: 'explicit' });
  });

  it('CONTRAST: a target statement that does not verify (not the user\'s words) leaves the drafted reading as it was: Olumi\'s', async () => {
    const g = await registered(draft({ targetQuote: 'We would like at least 30 new members soon.' }));
    expect(goalOf(g).provenance).toBe('ai_inferred');
    expect(ownTargetRow(g)?.provenance).not.toBe('explicit');
  });
});

/** D4's shape, synthetic: a target the user states as a CUT from today, drafted as a change on the goal with its sign. */
const TODAY = 'Our median order turnaround is 8 days.';
const CUT = "We want to cut it by at least 20% from today's 8 days by the end of next quarter.";
const CUT_BRIEF = `${TODAY} ${CUT} We are choosing between a second packing shift and a new warehouse layout.`;
const TURN = 'Order turnaround';
function cutDraft(o: { readonly statementValue?: number } = {}): Rec {
  const option = (label: string, factor: string): Rec => ({ label, provenance: 'explicit', changes: [factor], interventions: [], added_capacity: null, is_status_quo: null });
  return {
    goal: { kind: null, deliverable: null, metric: TURN, operator: '<=', target_stated: true, value: -20, unit: '%', horizon_months: null,
      provenance: 'explicit', frame: 'change_rel', baseline_known: true, baseline_value: 8, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', basis: { reference: 'today', denominator: "today's 8-day median order turnaround", period_months: null,
        period_kind: 'at_end', effect_unit: 'days', effects_at_period_end: false, also_required: [], open_question: null },
      source_quote: `${TODAY} ${CUT}`, deadline_words: null },
    constraints: [],
    options: [option('Second packing shift', 'Packing shifts'), option('New warehouse layout', 'Warehouse layout change')],
    factors: [
      { label: 'Packing shifts', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'shifts', provenance: 'explicit', plausible_max: 5 },
      { label: 'Warehouse layout change', role: 'controllable', baseline_known: false, baseline_value: null, unit: '', provenance: 'explicit', plausible_max: 1 },
    ],
    risks: [], outcomes: [],
    links: [link('Packing shifts', TURN), link('Warehouse layout change', TURN)].map((l) => ({ ...l, direction: 'negative' })),
    identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    statements: [
      statement(TODAY, { kind: 'goal', label: TURN }, 'level', 'point', 8, 'days'),
      statement(CUT, { kind: 'goal', label: TURN }, 'target', 'lower_bound', o.statementValue ?? -20, '%'),
    ],
  };
}
async function registeredCut(model: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, CUT_BRIEF, d, (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 1500)).toBe(true);
  return graph!;
}

describe('A3: a target stated as a cut from today is saved as that change, not as a "%" level (D4)', () => {
  it('⭐ RED → GREEN: "cut it by at least 20% from today\'s 8 days" saves a −20% change from today, to bring it down', async () => {
    const g = await registeredCut(cutDraft());
    expect(goalOf(g), JSON.stringify(goalOf(g))).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2,
      goal_direction: '<=', goal_deadline_as_stated: 'by the end of next quarter' });
    // The change's "%" is never the turnaround's own unit (the unit the AI's later target in days was refused against).
    expect(goalOf(g).goal_threshold_unit).not.toBe('%');
  });

  it('CONTRAST: a target statement whose figure is not the goal\'s own signed change is read exactly as before (unbound, said)', async () => {
    const g = await registeredCut(cutDraft({ statementValue: -25 }));
    expect(goalOf(g).goal_threshold_frame).not.toBe('change_rel');
  });
});

