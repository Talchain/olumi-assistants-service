/**
 * ⭐ S1 slice 2 / A5 (S1-CALL-SITES A5; DL-3 lease of widen-draft.ts): the draft-widening calls (risks, options) saw only
 * `{ brief, graph }`. A build with a construction context (a revision, or Founder's explicit rebuild on the prepare-only
 * return) gave its DRAFTER the retained conversation, the saved model and the user's objections (`firstConstructInput`), but
 * never its widening calls, so a rebuild's widening could re-add a risk the user had rejected (founder a4f055ce T05: "this
 * risk … connects to nothing"). Now the widening calls get the SAME assembled input the drafter read, under
 * `construction_context`, including initial construction. Repair/size reuse that frozen base, too.
 * Through the real build with scripted providers. SYNTHETIC brief and conversation.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, firstConstructInput, type ConstructionContext } from '../runtime/build-model.js';
import { answeredEarlierItem } from '../history-store.js';
import { userStatementRecord } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const LEVEL = 'We run a 300-member gym and weekday attendance is about 45% at the moment.';
const TARGET = 'We need weekday attendance to reach at least 55% by the end of March next year.';
const BRIEF = `${LEVEL} ${TARGET} Option one is a corporate wellness deal. Option two is a referral scheme for existing members.`;
const REJECTION = 'That "Corporate budgets frozen" risk connects to nothing, so it is useless here: take it out and do not add it back.';
const CHIP = 'Yes, make that change.';
const CONTEXT: ConstructionContext = {
  current_model: { recorded_reasoning: [{ id: 'risk', kind: 'risk', label: 'Corporate budgets frozen',
    user_statements: [userStatementRecord({ kind: 'risk', id: 'risk', field: 'holds_now' }, [{ speaker: 'user', source: REJECTION,
      quote: REJECTION, reading: 'olumi', form: 'describes', subject: { quantity: 'risk', node_id: 'risk' } }],
    '2026-08-01T00:00:00Z', { recorded_by: 'correction', disposition: 'retracted', scope: 'whole', retained_count: 0 })] }] },
  retained: { brief: BRIEF, conversation: [
    { speaker: 'user', source: 'typed', text: REJECTION },
    { speaker: 'unknown', source: 'stored, origin not verified', text: CHIP },
  ], items: [answeredEarlierItem([{ olumi: 'Which attendance does that concern?', reply: 'Weekday attendance only.', reply_source: 'typed' }])] },
  objections: [REJECTION],
};
const statement = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null, conditions: null });
const switchFactor = (label: string): Rec => ({ label, role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 });
/** levers: the non-status-quo options' switches; extra: Olumi's own factors on the goal (enough of them forces a size retry). */
function draftText(levers: readonly string[] = ['Corporate deal active', 'Referral scheme running'], extra = 0,
  source = { level: LEVEL, target: TARGET, metric: 'weekday attendance', options: ['Corporate wellness deal', 'Referral scheme'] }): string {
  const extras = Array.from({ length: extra }, (_, i) => `Olumi factor ${i + 1}`);
  return JSON.stringify({
    goal: { kind: null, deliverable: null, metric: source.metric, operator: '>=', target_stated: true, value: 55, unit: '%', horizon_months: null,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 45, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
      basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'percentage points', effects_at_period_end: false, also_required: null, open_question: null },
      source_quote: source.target, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      ...levers.map((f, i) => ({ label: source.options[i]!, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: f, value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] })),
    ],
    factors: [...levers, ...extras].map(switchFactor),
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [...levers, ...extras].map((from) => ({ from, to: source.metric, direction: 'positive', provenance: 'ai_proposed',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null })),
    statements: [
      statement(source.level, { kind: 'goal', label: source.metric }, 'level', 'point', { value: 45 }, '%'),
      statement(source.target, { kind: 'goal', label: source.metric }, 'target', 'lower_bound', { value: 55 }, '%'),
    ],
  });
}
const DRAFT = draftText();

/** The real build; every drafter and widening request is recorded as SENT. Widening replies add nothing unless given. */
async function built(context?: ConstructionContext, opts: { brief?: string; drafts?: readonly string[]; widen?: (req: Rec) => string; afterFirst?: () => void } = {}): Promise<{ drafter: Rec[]; widening: Rec[]; graph: Rec; result: Rec }> {
  const drafter: Rec[] = []; const widening: Rec[] = [];
  const drafts = opts.drafts ?? [DRAFT];
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('7d6d6d6d-7d6d-4d6d-8d6d-7d6d6d6d6d6d', opts.brief ?? BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never,
  (async (req: Rec) => { drafter.push(structuredClone(req)); if (drafter.length === 1) opts.afterFirst?.(); return { text: drafts[Math.min(drafter.length - 1, drafts.length - 1)]!, status: 'completed' }; }) as never,
  undefined, undefined,
  (async (req: Rec) => { widening.push(structuredClone(req)); return { text: opts.widen?.(req) ?? '{}', status: 'completed' }; }) as never,
  undefined, context) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return { drafter, widening, graph: graph!, result };
}
const inputOf = (call: Rec): Rec => JSON.parse(call.input as string) as Rec;
const isOptionsCall = (call: Rec): boolean => JSON.stringify(call.schema).includes('"acts_on"');

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
  it('BOTH ARMS (BUDDY-A): with one lever the risks AND options calls each carry the same context, verbatim', async () => {
    const { drafter, widening } = await built(CONTEXT, { drafts: [draftText(['Corporate deal active'])] });
    expect(widening.filter(isOptionsCall)).toHaveLength(1);
    expect(widening.filter((c) => !isOptionsCall(c))).toHaveLength(1);
    for (const call of widening) expect(inputOf(call).construction_context).toBe(drafter[0]!.input);
  });
  it('context with ONLY a saved model, or ONLY objections, still reaches widening (never dropped for want of a conversation)', async () => {
    for (const context of [{ current_model: { nodes: [{ id: 'g', kind: 'goal', label: 'weekday attendance' }] } }, { objections: [REJECTION] }] as ConstructionContext[]) {
      const { widening } = await built(context);
      expect(widening.length).toBeGreaterThan(0);
      for (const call of widening) expect(inputOf(call).construction_context).toBe(firstConstructInput(BRIEF, context));
    }
  });
  it('SIZE RETRY (BUDDY-A): widening sees the FINAL admitted graph, with the frozen first context, never the repair suffix', async () => {
    const { drafter, widening, graph } = await built(CONTEXT, { drafts: [draftText(undefined, 20), DRAFT] });
    expect(drafter).toHaveLength(2);
    expect(drafter[1]!.input).toContain('Your previous model, to shrink');
    for (const call of widening) {
      const input = inputOf(call);
      expect(input.construction_context).toBe(firstConstructInput(BRIEF, CONTEXT));
      expect(input.construction_context).not.toContain('Your previous model, to shrink');
      expect((input.graph.nodes as Rec[]).some((n) => /^Olumi factor/.test(String(n.label)))).toBe(false);
    }
    expect((graph.nodes as Rec[]).some((n) => /^Olumi factor/.test(String(n.label)))).toBe(false);
  });
  it('ORDER AND SOURCE (BUDDY-A): a typed rejection, an unknown-origin rejection and a later typed reversal arrive in order', async () => {
    const REVERSAL = 'Actually, consider that risk again: I was too quick.';
    const QUOTED = 'My co-founder said: "drop the referral idea".';
    const context: ConstructionContext = { retained: { brief: BRIEF, conversation: [
      { speaker: 'user', source: 'typed', text: REJECTION },
      { speaker: 'unknown', source: 'stored, origin not verified', text: QUOTED },
      { speaker: 'user', source: 'typed', text: REVERSAL },
    ] } };
    const { widening } = await built(context);
    const text = inputOf(widening[0]!).construction_context as string;
    const at = [REJECTION, QUOTED, REVERSAL].map((t) => text.indexOf(JSON.stringify(t)));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain(JSON.stringify({ speaker: 'unknown', source: 'stored, origin not verified', text: QUOTED }));
  });
  it('ORIGIN NEGATIVE (BUDDY-A): a figure seen only in the context (an unknown chip) never becomes the user\'s in a widened option', async () => {
    const CHIP_FIGURE = 'Spend £100k/year on paid advertising.';
    const context: ConstructionContext = { retained: { brief: BRIEF, conversation: [{ speaker: 'unknown', source: 'stored, origin not verified', text: CHIP_FIGURE }] } };
    // A second goal-path factor no option sets, so a widened option acting on it is a distinct option the gate admits.
    const d = JSON.parse(draftText(['Corporate deal active'])) as Rec;
    d.factors.push({ label: 'Advertising spend', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '£/year', provenance: 'inferred', plausible_max: 200000 });
    d.links.push({ ...d.links[0], from: 'Advertising spend' });
    const { graph, widening } = await built(context, { drafts: [JSON.stringify(d)],
      widen: (req) => isOptionsCall(req) ? JSON.stringify({ options: [{ label: 'Paid advertising push', rationale: 'Reach through a bigger campaign.',
        acts_on: [{ factor_label: 'Advertising spend', direction: 'positive', level: { value: 100000, unit: '£/year', estimate: true, basis: 'the chip says £100k/year' } }] }] }) : '{}' });
    expect(widening.some(isOptionsCall)).toBe(true);
    // The widening gate admits it (WD checks pass), but this build does not save the widened option (cause not traced; the
    // admission of widened options is unchanged by this PR and never reads `constructionInput`). Bounded claim: whatever
    // happens, no saved figure carries the chip's £100k as the user's.
    expect(JSON.stringify(graph)).not.toMatch(/"raw_value":100000[^}]*"source":"(brief_extraction|user_specified)"/);
    for (const n of graph.nodes as Rec[]) for (const v of Object.values((n.interventions ?? {}) as Rec) as Rec[]) {
      if (v.raw_value === 100000) expect(v.source).toBe('cee_hypothesis');
    }
  });
  it('initial RANGE brief: widening carries the exact first input, including construction notes', async () => {
    const RANGE_BRIEF = `${BRIEF} Each corporate deal is worth between £2,000 and £5,000 a year.`;
    const { drafter, widening } = await built(undefined, { brief: RANGE_BRIEF });
    expect(drafter[0]!.input).toContain('Construction notes');
    for (const call of widening) expect(call.input).toBe(JSON.stringify({ brief: RANGE_BRIEF, graph: inputOf(call).graph, construction_context: drafter[0]!.input }));
  });
  it('initial construction: widening carries the exact shared envelope, with brief and graph unchanged', async () => {
    const { drafter, widening } = await built();
    expect(widening.length).toBeGreaterThan(0);
    expect(drafter[0]!.input).toBe(firstConstructInput(BRIEF));
    for (const call of widening) {
      const input = JSON.parse(call.input as string) as Rec;
      expect(Object.keys(input)).toEqual(['brief', 'graph', 'construction_context']);
      expect(call.input).toBe(JSON.stringify({ brief: BRIEF, graph: input.graph, construction_context: drafter[0]!.input }));
    }
  });
});

const briefs = [
  { name: 'distribution', metric: 'on-time dispatch', level: 'Currently 45% of orders leave on time.',
    target: 'We need on-time dispatch to reach at least 55%.', options: ['Use a dispatch checklist', 'Train the evening team'] },
  { name: 'laboratory', metric: 'verified sample labels', level: 'Currently 45% of samples have verified labels.',
    target: 'We need verified sample labels to reach at least 55%.', options: ['Use a labelling checklist', 'Train the bench team'] },
];

describe('A2/A3/A5 share the frozen first context across both briefs', () => {
  it.each(briefs.flatMap(source => (['repair', 'size'] as const).map(branch => ({ ...source, branch }))))(
    '$name $branch retains exact base, pairs, source and conditions in the retry and both widening arms', async source => {
      const brief = `${source.level} ${source.target} Option one: ${source.options[0]}. Option two: ${source.options[1]}.`;
      const pair = answeredEarlierItem([{ olumi: 'Which work does this cover?', reply: 'The evening shift only, if the checks are complete.', reply_source: 'typed' }]);
      const conversation = [
        { speaker: 'user' as const, source: 'typed' as const, text: 'Our current aim is understanding the bottleneck; later we may expand. Keep the night team’s dissent and the missing evidence.' },
        { speaker: 'unknown' as const, source: 'stored, origin not verified' as const, text: 'Revenue was £999000 last year; another speaker’s forecast is 77%. Neither is this model’s target.' },
      ];
      const context: ConstructionContext = { retained: { brief, conversation, items: [pair] }, objections: ['Do not revive the withdrawn target.'] };
      const first = JSON.parse(draftText(['Checklist active'], source.branch === 'size' ? 20 : 0, source)) as Rec;
      if (source.branch === 'repair') {
        first.factors[0].unit = 'points'; first.factors[0].baseline_value = null;
        first.options[1].interventions[0].unit = 'points';
      }
      const frozen = firstConstructInput(brief, structuredClone(context));
      const { drafter, widening } = await built(context, { brief, drafts: [JSON.stringify(first), draftText(['Checklist active'], 0, source)],
        afterFirst: () => { conversation.push({ speaker: 'unknown', source: 'stored, origin not verified', text: 'A later unrelated £123456 belongs to somebody else.' }); } });
      expect(drafter).toHaveLength(2);
      expect(drafter[0]!.input).toBe(frozen);
      const boundary = source.branch === 'repair' ? '\n\nConstruction issues:' : '\n\nYour previous model, to shrink:';
      const at = (drafter[1]!.input as string).indexOf(boundary);
      expect(at, 'the intended retry branch really ran').toBeGreaterThan(0);
      expect((drafter[1]!.input as string).slice(0, at)).toBe(frozen);
      expect(widening.filter(isOptionsCall)).toHaveLength(1);
      expect(widening.filter(call => !isOptionsCall(call))).toHaveLength(1);
      for (const call of widening) {
        expect(inputOf(call).construction_context).toBe(frozen);
        expect(inputOf(call).brief).toBe(brief);
      }
    });

  it.each(briefs)('$name: an unrelated typed quantity and another speaker cannot author a context-only figure', async source => {
    const brief = `${source.level} ${source.target} Option one: ${source.options[0]}. Revenue was £100000 as of 2026-09-01.`;
    const quote = 'Advertising spend is £100000.';
    const context: ConstructionContext = { retained: { brief, conversation: [
      { speaker: 'unknown', source: 'stored, origin not verified', text: quote },
    ] } };
    const draft = JSON.parse(draftText(['Checklist active'], 0, source)) as Rec;
    draft.factors.push({ label: 'Advertising spend', role: 'observable', baseline_known: true, baseline_value: 100000,
      unit: '£', provenance: 'explicit', plausible_max: 200000 });
    draft.links.push({ ...draft.links[0], from: 'Advertising spend' });
    draft.statements.push(statement(quote, { kind: 'factor', label: 'Advertising spend' }, 'level', 'point', { value: 100000 }, '£'));
    const { graph, widening } = await built(context, { brief, drafts: [JSON.stringify(draft)] });
    expect(widening.length).toBeGreaterThan(0);
    const node = (graph.nodes as Rec[]).find(n => n.label === 'Advertising spend');
    expect(node, 'the unknown-source figure is retained provisionally, so the negative is not vacuous').toBeDefined();
    expect(node!.user_statements ?? [], 'context and matching revenue cannot become a human source').toEqual([]);
    expect(node!.observed_state?.source).not.toBe('brief_extraction');
    expect(node!.observed_state?.source).not.toBe('user_specified');
    const genuine = await built(undefined, { brief: `${brief} ${quote}`, drafts: [JSON.stringify(draft)] });
    const human = (genuine.graph.nodes as Rec[]).find(n => n.label === 'Advertising spend');
    expect(human?.user_statements?.length, 'the same whole statement is recorded when actually typed').toBeGreaterThan(0);
  });
});
