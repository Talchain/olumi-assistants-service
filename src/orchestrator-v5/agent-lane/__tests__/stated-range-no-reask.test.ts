/**
 * ⭐ ITEM 3, no re-ask after a Run (G3 VERIFY-1a1a7907 check C, re-ask classes 2–3; AIE 16 Oct amended range contract: "do
 * not repeatedly ask for the already-supplied range … not the range again or a ritual point/quartile demand"). A link whose
 * effect the USER stated as a range keeps Olumi's placeholder and its figures stay withheld, but the Run's withhold
 * (`placeholderGoalWarning`, the producer run_analysis and the guided-sizing chips both read) never asks for it again:
 * no size-link chip, no first ask for the Results "Next step", no "Set it". Its one next step is the AIE's qualitative
 * continuation. A link with no stated range is still asked, as before. Through the real build. SYNTHETIC brief.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { placeholderGoalWarning, STATED_RANGE_NEXT_STEP, unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { guidedSizingActions, guidedSizingFromWarning, linkSizeQuestion } from '../guided-sizing.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const EFFECT = 'Option one is a corporate wellness deal with two offices nearby, which would cost us around £6k a year in discounts — our membership manager thinks it could add somewhere between 4 and 7 attendance points.';
const LEVEL = 'We run a 300-member gym and weekday attendance is about 45% at the moment.';
const TARGET = 'We need weekday attendance to reach at least 55% by the end of March next year.';
const BRIEF = `${LEVEL} ${TARGET} ${EFFECT} Option two is a referral scheme for existing members.`;
const statement = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null, conditions: null });
const switchFactor = (label: string): Rec => ({ label, role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 });
const option = (label: string, factor: string): Rec => ({ label, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
  interventions: [{ factor_label: factor, value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] });
const unsized = (from: string, quote: string | null): Rec => ({ from, to: 'weekday attendance', direction: 'positive', provenance: quote === null ? 'ai_proposed' : 'explicit',
  effect_amount: null, effect_per_source_change: null, effect_provenance: quote === null ? null : 'explicit', definitional: null, basis: null, source_quote: quote });
const OTHERS = [['Referral scheme', 'Referral scheme running'], ['Flyer drop', 'Flyers delivered']] as const;
function draft(withRange: boolean, withOthers: boolean): string {
  return JSON.stringify({
    goal: { kind: null, deliverable: null, metric: 'weekday attendance', operator: '>=', target_stated: true, value: 55, unit: '%', horizon_months: null,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 45, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
      basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'percentage points', effects_at_period_end: false, also_required: null, open_question: null },
      source_quote: TARGET, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      option('Corporate wellness deal', 'Corporate deal active'),
      ...(withOthers ? OTHERS.map(([o, f]) => option(o, f)) : []),
    ],
    factors: [switchFactor('Corporate deal active'), ...(withOthers ? OTHERS.map(([, f]) => switchFactor(f)) : [])],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [unsized('Corporate deal active', EFFECT), ...(withOthers ? OTHERS.map(([, f]) => unsized(f, null)) : [])],
    statements: [
      statement(LEVEL, { kind: 'goal', label: 'weekday attendance' }, 'level', 'point', { value: 45 }, '%'),
      statement(TARGET, { kind: 'goal', label: 'weekday attendance' }, 'target', 'lower_bound', { value: 55 }, '%'),
      ...(withRange ? [statement(EFFECT, { kind: 'link', label: 'Corporate deal active', to_label: 'weekday attendance' }, 'effect', 'range', { low: 4, high: 7 }, 'attendance points')] : []),
    ],
  });
}
async function built(withRange: boolean, withOthers = false): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: draft(withRange, withOthers), status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return graph!;
}
const idOf = (g: Rec, label: string): string => (g.nodes as Rec[]).find((n) => n.label === label)!.id as string;
/** The Run's withhold over the given options, as run_analysis and the chips' fresh warning produce it. */
function runWithhold(g: Rec, options: readonly string[]): { w: Rec; chips: Rec[] } {
  const paths = unsizedLeaderGoalPaths(g, options.map((o) => idOf(g, o)));
  expect(paths.length).toBeGreaterThan(0);
  const w = placeholderGoalWarning(g, paths, GOAL_FIGURES_PLACEHOLDER_PATH) as Rec;
  return { w, chips: guidedSizingActions(guidedSizingFromWarning(w, g), g) as Rec[] };
}
const pair = (g: Rec, from: string): Rec => ({ from: idOf(g, from), to: idOf(g, 'weekday attendance') });

describe('a Run never asks again for a link whose effect the user stated as a range', () => {
  it('⭐ the range link: withheld as before, but no chip, no first ask, no "Set it"; the AIE\'s next step instead', async () => {
    const g = await built(true);
    const { w, chips } = runWithhold(g, ['Corporate wellness deal']);
    expect(w.option_ids).toEqual([idOf(g, 'Corporate wellness deal')]);
    expect(w.links).toEqual([pair(g, 'Corporate deal active')]);
    expect(w.acceptable_links).toBeUndefined();
    expect(w.first_ask).toBeUndefined();
    expect(chips).toEqual([]);
    expect(w.message).toMatch(/^This comparison turns on the link from ‘Corporate deal active’ to ‘weekday attendance’, whose strength isn't sized in the model yet\. /);
    expect(w.message).not.toMatch(/Set (it|them)|How strongly/);
    expect(w.message.endsWith(` ${STATED_RANGE_NEXT_STEP}`)).toBe(true);
    expect(w.message.length).toBeLessThanOrEqual(400);
  });
  it('CONTRAST: the same link with no stated range is asked as before (first ask, "Set it")', async () => {
    const g = await built(false);
    const { w, chips } = runWithhold(g, ['Corporate wellness deal']);
    expect(w.acceptable_links).toEqual([pair(g, 'Corporate deal active')]);
    expect(w.first_ask).toEqual({ kind: 'link', ...pair(g, 'Corporate deal active') });
    expect(w.message).toMatch(/Set it to see how much it matters\.$/);
    expect(w.message).not.toContain(STATED_RANGE_NEXT_STEP);
    expect(chips).toEqual([]); // one link: the guided chips start at two (guided-sizing.ts), on both arms
  });
  it('NEGATIVE (other links): a range on one link never silences the OTHER links\' asks; their chips stay, its chip goes', async () => {
    const g = await built(true, true);
    const { w, chips } = runWithhold(g, ['Corporate wellness deal', 'Referral scheme', 'Flyer drop']);
    expect(w.acceptable_links).toHaveLength(2);
    expect(w.acceptable_links).not.toContainEqual(pair(g, 'Corporate deal active'));
    expect(w.first_ask).toMatchObject({ kind: 'link' });
    expect(w.first_ask).not.toMatchObject(pair(g, 'Corporate deal active'));
    // PL 19:07Z: the limitation still names every link; the invitation names only the two with no stated range.
    const [limitation, invite] = w.message.split(/(?<=yet\.) /u);
    expect(limitation).toMatch(/^This comparison turns on the links from ‘Corporate deal active’ to ‘weekday attendance’/);
    expect(limitation).toContain('‘Referral scheme running’');
    expect(limitation).toContain('‘Flyers delivered’');
    expect(invite).toMatch(/^Set the links from ‘(Referral scheme running|Flyers delivered)’ to ‘weekday attendance’ and from ‘(Referral scheme running|Flyers delivered)’ to ‘weekday attendance’ to see how much they matter\.$/);
    expect(invite).not.toContain('Corporate deal active');
    expect(w.message).not.toMatch(/Set them/);
    expect(w.message).not.toContain(STATED_RANGE_NEXT_STEP);
    expect(w.message.length).toBeLessThanOrEqual(400);
    expect(chips.map((c) => c.label).sort()).toEqual(OTHERS.map(([, f]) => linkSizeQuestion(f, 'weekday attendance')).sort());
  });
  it('CONTRAST (other links, no range): all three links get their chips', async () => {
    const g = await built(false, true);
    const { w, chips } = runWithhold(g, ['Corporate wellness deal', 'Referral scheme', 'Flyer drop']);
    expect(w.acceptable_links).toHaveLength(3);
    expect(chips.map((c) => c.label)).toContain(linkSizeQuestion('Corporate deal active', 'weekday attendance'));
    expect(w.message).toMatch(/Set them to see how much they matter\.$/); // no range anywhere: today's sentence
    expect(chips).toHaveLength(3);
  });
});
