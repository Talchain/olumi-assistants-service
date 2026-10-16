/**
 * ⭐ ITEM 3 numerical use (AIE 16 Oct range contract; TL 17:18Z ACK items 1 and 2; DL-3 17:26Z). A link whose effect the
 * USER stated as a range, which nobody gave a single size ("…thinks it could add somewhere between 4 and 7 attendance points"):
 *  · the range stays the user's statement on the link (construction's record, #3297), whole;
 *  · the link keeps Olumi's placeholder, still Olumi's: no mean, midpoint, end or spread is taken from the range;
 *  · it is never asked "Nobody has said, so Olumi uses a placeholder": the user HAS said, and the range is not asked again;
 *  · the placeholder is said ONCE against the user's recorded source, in the AIE's words (`not_represented`);
 *  · no chance range rests on that placeholder (`goalChanceRangeOf`), while a link with no stated range keeps its range.
 * Through the real build. SYNTHETIC briefs (never the unseen brief).
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { userStatementFor } from '../../statement-door/statements.js';
import { goalChanceRangeOf } from '../../goal-target/goal-chance-range.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const EFFECT = 'Option one is a corporate wellness deal with two offices nearby, which would cost us around £6k a year in discounts — our membership manager thinks it could add somewhere between 4 and 7 attendance points.';
const LEVEL = 'We run a 300-member gym and weekday attendance is about 45% at the moment.';
const TARGET = 'We need weekday attendance to reach at least 55% by the end of March next year.';
const BRIEF = `${LEVEL} ${TARGET} ${EFFECT} Option two is a referral scheme for existing members.`;
const statement = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null, conditions: null });
function draft(withRange: boolean): string {
  return JSON.stringify({
    goal: { kind: null, deliverable: null, metric: 'weekday attendance', operator: '>=', target_stated: true, value: 55, unit: '%', horizon_months: null,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 45, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
      basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'percentage points', effects_at_period_end: false, also_required: null, open_question: null },
      source_quote: TARGET, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Corporate wellness deal', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Corporate deal active', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] },
    ],
    factors: [{ label: 'Corporate deal active', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 }],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [{ from: 'Corporate deal active', to: 'weekday attendance', direction: 'positive', provenance: 'explicit', effect_amount: null,
      effect_per_source_change: null, effect_provenance: 'explicit', definitional: null, basis: null, source_quote: EFFECT }],
    statements: [
      statement(LEVEL, { kind: 'goal', label: 'weekday attendance' }, 'level', 'point', { value: 45 }, '%'),
      statement(TARGET, { kind: 'goal', label: 'weekday attendance' }, 'target', 'lower_bound', { value: 55 }, '%'),
      ...(withRange ? [statement(EFFECT, { kind: 'link', label: 'Corporate deal active', to_label: 'weekday attendance' }, 'effect', 'range', { low: 4, high: 7 }, 'attendance points')] : []),
    ],
  });
}
async function built(withRange: boolean): Promise<{ result: Rec; graph: Rec }> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d', BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: draft(withRange), status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return { result, graph: graph! };
}
const idOf = (g: Rec, label: string): string => (g.nodes as Rec[]).find((n) => n.label === label)!.id as string;
const linkOf = (g: Rec): Rec => (g.edges as Rec[]).find((e) => e.from === idOf(g, 'Corporate deal active') && e.to === idOf(g, 'weekday attendance'))!;
const DISCLOSURE = new RegExp(`^The recorded source for "Corporate deal active" → "weekday attendance" is: "${EFFECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" `
  + `The model currently holds Olumi's provisional size \\(switching on "Corporate deal active" raises "weekday attendance" by [^)]+\\) for this effect, `
  + 'which is not taken from the stated "between 4 and 7 attendance points"\\. I cannot justify that value from this source\\.$');

/**
 * ⛔ BUDDY-A #3312 B1 (R1, its own brief): the user's range is for TEN staff ("adding 10 support staff could raise weekday
 * attendance by between 40 and 55 percentage points") while Olumi's placeholder is per ONE (5 points per staff = 50 per 10,
 * inside the range). A statement records no source-change basis, so the disclosure never says the two conflict.
 */
const STAFF_EFFECT = 'Option one is hiring one support staff member; our membership manager estimates that adding 10 support staff could raise weekday attendance by between 40 and 55 percentage points.';
const STAFF_BRIEF = `${LEVEL} ${TARGET} ${STAFF_EFFECT} Option two is a referral scheme for existing members.`;
function staffDraft(): string {
  const d = JSON.parse(draft(false)) as Rec;
  d.options[1] = { label: 'Hire one support staff member', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
    interventions: [{ factor_label: 'Support staff', value: 1, value_kind: 'absolute', unit: 'staff', provenance: 'explicit' }] };
  d.factors = [{ label: 'Support staff', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'staff', provenance: 'inferred', plausible_max: 10 }];
  d.links = [{ from: 'Support staff', to: 'weekday attendance', direction: 'positive', provenance: 'explicit', effect_amount: null,
    effect_per_source_change: null, effect_provenance: 'explicit', definitional: null, basis: null, source_quote: STAFF_EFFECT }];
  d.statements.push(statement(STAFF_EFFECT, { kind: 'link', label: 'Support staff', to_label: 'weekday attendance' }, 'effect', 'range', { low: 40, high: 55 }, 'percentage points'));
  return JSON.stringify(d);
}

describe('construction: a stated range nobody sized is held, disclosed once against the placeholder, and never asked again', () => {
  it('⭐ the placeholder is said once in the AIE\'s words, against the user\'s whole recorded source', async () => {
    const { result } = await built(true);
    const said = (result.not_represented as string[]).filter((s) => s.includes('Corporate deal active" → "weekday attendance'));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(DISCLOSURE);
  });
  it('⭐ NO-REPEAT: nothing asks how much the link moves the goal ("Nobody has said …"), and nothing asks for the range', async () => {
    const { result } = await built(true);
    const asks = (result.open_questions as string[]).join('\n');
    expect(asks).not.toMatch(/Nobody has said/);
    expect(asks).not.toMatch(/Corporate deal active/);
  });
  it('NEGATIVE: the link stays Olumi\'s placeholder: the range gives it no user size, end or midpoint', async () => {
    const { graph } = await built(true);
    const link = linkOf(graph);
    expect(link.provenance).toMatchObject({ magnitude: 'olumi_placeholder' });
    expect(link.provenance.source).not.toBe('user_specified');
    expect(link.provenance.natural_effect?.stated_range).toBeUndefined();
    expect([4, 5.5, 7]).not.toContain(link.provenance.natural_effect?.amount);
    expect(userStatementFor(graph, { kind: 'link', id: link.from, to_id: link.to, field: 'effect' })?.statements[0])
      .toMatchObject({ form: 'range', low: 4, high: 7, quote: EFFECT });
  });
  it('⛔ B1 (BUDDY-A R1): a range for 10 staff is never said to conflict with Olumi\'s size for 1 staff (the basis is not recorded)', async () => {
    const result = await buildModelFromBrief('7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7e', STAFF_BRIEF, (async (path: string) => (path.endsWith('/graph/register')
      ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } }
      : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } })) as never,
    (async () => ({ text: staffDraft(), status: 'completed' })) as never) as Rec;
    expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
    const said = (result.not_represented as string[]).filter((s) => s.includes('Support staff" → "weekday attendance'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('which is not taken from the stated "between 40 and 55 percentage points"');
    expect(said[0]).not.toMatch(/conflicts/);
  });
  it('CONTRAST: with no stated range, the link is asked about as before, and no range disclosure is made', async () => {
    const { result } = await built(false);
    expect((result.open_questions as string[]).join('\n')).toMatch(/Nobody has said, so Olumi uses a placeholder/);
    expect((result.not_represented as string[]).some((s) => s.startsWith('The recorded source for'))).toBe(false);
  });
});

describe('numerical use on the built graph: no chance range rests on the placeholder of a stated-range link', () => {
  const run = (g: Rec) => {
    const option = (g.nodes as Rec[]).find((n) => n.kind === 'option' && n.label === 'Corporate wellness deal')!.id as string;
    const goal = idOf(g, 'weekday attendance');
    const from = idOf(g, 'Corporate deal active');
    const envelope = { option_comparison: [{ option_id: option }],
      inference_warnings: [{ code: GOAL_FIGURES_PLACEHOLDER_PATH, severity: 'warning', message: 'Withheld.', option_ids: [option] }] };
    const row = { kind: 'link_existence', quantity_id: `${from}->${goal}`, from, to: goal, status: 'resolved', spread: 0.4,
      p_goal_if_absent: 0.004, p_goal_if_present: 0.78, n_absent: 2000, n_present: 8000 };
    return goalChanceRangeOf(envelope, g, option, { driversByOption: new Map([[option, { drivers: [row] }]]),
      goalPaths: [{ option_id: option, links: [{ from, to: goal }] }], plotWithheld: false, goalId: goal });
  };
  it('⭐ the G3 #5 shape from the real build: no "0%–78%" range', async () => {
    expect(run((await built(true)).graph)).toBeNull();
  });
  it('CONTRAST: the same build without the stated range keeps today\'s range', async () => {
    expect(run((await built(false)).graph)).toMatchObject({ kind: 'link_existence', low_pct: 0 });
  });
});
