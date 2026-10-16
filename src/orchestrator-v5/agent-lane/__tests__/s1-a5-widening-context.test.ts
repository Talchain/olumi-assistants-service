/**
 * ⭐ S1 slice 2 / A5 (S1-CALL-SITES A5; DL-3 lease of widen-draft.ts): the draft-widening calls (risks, options) saw only
 * `{ brief, graph }`. A build with a construction context (a revision, or Founder's explicit rebuild on the prepare-only
 * return) gave its DRAFTER the retained conversation, the saved model and the user's objections (`firstConstructInput`), but
 * never its widening calls, so a rebuild's widening could re-add a risk the user had rejected (founder a4f055ce T05: "this
 * risk … connects to nothing"). Now the widening calls get the SAME assembled input the drafter read, under
 * `construction_context`, and only when there is a context: initial construction is byte-identical (the sys1 golden pins it).
 * Through the real build with scripted providers. SYNTHETIC brief and conversation.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, firstConstructInput, type ConstructionContext } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const LEVEL = 'We run a 300-member gym and weekday attendance is about 45% at the moment.';
const TARGET = 'We need weekday attendance to reach at least 55% by the end of March next year.';
const BRIEF = `${LEVEL} ${TARGET} Option one is a corporate wellness deal. Option two is a referral scheme for existing members.`;
const REJECTION = 'That "Corporate budgets frozen" risk connects to nothing, so it is useless here: take it out and do not add it back.';
const CHIP = 'Yes, make that change.';
const CONTEXT: ConstructionContext = {
  retained: { brief: BRIEF, conversation: [
    { speaker: 'user', source: 'typed', text: REJECTION },
    { speaker: 'unknown', source: 'stored, origin not verified', text: CHIP },
  ] },
  objections: [REJECTION],
};
const statement = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null, conditions: null });
const switchFactor = (label: string): Rec => ({ label, role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 });
const DRAFT = JSON.stringify({
  goal: { kind: null, deliverable: null, metric: 'weekday attendance', operator: '>=', target_stated: true, value: 55, unit: '%', horizon_months: null,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 45, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
    basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'percentage points', effects_at_period_end: false, also_required: null, open_question: null },
    source_quote: TARGET, deadline_words: null },
  constraints: [],
  options: [
    { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    { label: 'Corporate wellness deal', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Corporate deal active', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] },
    { label: 'Referral scheme', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Referral scheme running', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] },
  ],
  factors: [switchFactor('Corporate deal active'), switchFactor('Referral scheme running')],
  risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
  links: ['Corporate deal active', 'Referral scheme running'].map((from) => ({ from, to: 'weekday attendance', direction: 'positive', provenance: 'ai_proposed',
    effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null })),
  statements: [
    statement(LEVEL, { kind: 'goal', label: 'weekday attendance' }, 'level', 'point', { value: 45 }, '%'),
    statement(TARGET, { kind: 'goal', label: 'weekday attendance' }, 'target', 'lower_bound', { value: 55 }, '%'),
  ],
});

/** The real build; every drafter and widening request is recorded as SENT (the widening replies add nothing). */
async function built(context?: ConstructionContext): Promise<{ drafter: Rec[]; widening: Rec[] }> {
  const drafter: Rec[] = []; const widening: Rec[] = [];
  const result = await buildModelFromBrief('7d6d6d6d-7d6d-4d6d-8d6d-7d6d6d6d6d6d', BRIEF, (async (path: string) => (path.endsWith('/graph/register')
    ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } }
    : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } })) as never,
  (async (req: Rec) => { drafter.push(structuredClone(req)); return { text: DRAFT, status: 'completed' }; }) as never,
  undefined, undefined,
  (async (req: Rec) => { widening.push(structuredClone(req)); return { text: '{}', status: 'completed' }; }) as never,
  undefined, context) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return { drafter, widening };
}

describe('S1 A5: the widening calls read the same assembled context as the drafter', () => {
  it('⭐ with a construction context: every widening call carries the drafter\'s own assembled input, verbatim', async () => {
    const { drafter, widening } = await built(CONTEXT);
    expect(widening.length).toBeGreaterThan(0);
    const assembled = firstConstructInput(BRIEF, CONTEXT);
    expect(drafter[0]!.input).toBe(assembled);
    for (const call of widening) {
      const input = JSON.parse(call.input as string) as Rec;
      expect(Object.keys(input)).toEqual(['brief', 'graph', 'construction_context']);
      // The SAME string the drafter read, from the one assembler; the brief every check reads stays the brief.
      expect(input.construction_context).toBe(drafter[0]!.input);
      expect(input.brief).toBe(BRIEF);
    }
  });
  it('the rejection reaches the widening calls as the user\'s typed words; the chip stays of unknown origin', async () => {
    const { widening } = await built(CONTEXT);
    const context = (JSON.parse(widening[0]!.input as string) as Rec).construction_context as string;
    expect(context).toContain(JSON.stringify({ speaker: 'user', source: 'typed', text: REJECTION }));
    expect(context).toContain(JSON.stringify({ speaker: 'unknown', source: 'stored, origin not verified', text: CHIP }));
    expect(context).not.toContain(JSON.stringify({ speaker: 'user', source: 'typed', text: CHIP }));
  });
  it('CONTRAST (initial construction): no context → the widening input is today\'s { brief, graph }, byte for byte', async () => {
    const { drafter, widening } = await built();
    expect(widening.length).toBeGreaterThan(0);
    expect(drafter[0]!.input).toBe(firstConstructInput(BRIEF));
    for (const call of widening) {
      const input = JSON.parse(call.input as string) as Rec;
      expect(Object.keys(input)).toEqual(['brief', 'graph']);
      expect(call.input).toBe(JSON.stringify({ brief: BRIEF, graph: input.graph }));
    }
  });
});
