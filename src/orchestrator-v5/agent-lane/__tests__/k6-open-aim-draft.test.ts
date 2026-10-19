/**
 * ⭐ K6 (PL amendment 2; DL ack 18 Oct): a one-line "should we do X?" brief states no aim, so the drafter takes the ACTION as
 * an event goal, which #3026 rightly never saves as the goal. The draft is kept as a labelled provisional model: the event
 * becomes an option and the aim an open question. The goal retry runs first, so an aim the drafter can name wins.
 * ⭐ RE-RULED (signed change 6, DL-3 19 Oct; Paul's live test dd904404): for EVERY brief. The "draft it now" request and the
 * no-figure condition are retired (they left a good draft unshown when the brief stated any figure).
 *
 * Construction replayed for real (`buildModelFromBrief`). Scripted: the drafter. SYNTHETIC wording (a café). 0 provider calls.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, OPEN_AIM_GOAL_LABEL } from '../runtime/build-model.js';
import { currentRequestChecks } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const BRIEF = 'Should we open a second café in Bristol next spring?';
const EVENT = 'Open a second café';
/** The drafter's answer for a one-line brief: the action as an event goal (the K6 shape), two options, a short chain. */
const cafeDraft = (): Rec => ({
  goal: { kind: 'event_by_date', deliverable: 'second café', metric: EVENT, operator: '>=', target_stated: false, value: null, unit: '',
    horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred',
    scope: null, quantity_frame: 'level', basis: null, source_quote: 'open a second café in Bristol' },
  constraints: [],
  options: [
    { label: 'Open in Bristol next spring', provenance: 'ai_proposed', changes: [], interventions: [
      { factor_label: 'Number of cafés', value: 2, value_kind: 'absolute', unit: 'cafés', provenance: 'ai_proposed', stated_evidence: null }] },
    { label: 'Keep one café', provenance: 'ai_proposed', changes: [], interventions: [
      { factor_label: 'Number of cafés', value: 1, value_kind: 'absolute', unit: 'cafés', provenance: 'ai_proposed', stated_evidence: null }] },
  ],
  factors: [
    { label: 'Number of cafés', role: 'controllable', baseline_known: false, baseline_evidence: null, baseline_value: 1, unit: 'cafés', provenance: 'ai_proposed', plausible_max: 5 },
    { label: 'Monthly customers', role: 'external', baseline_known: false, baseline_evidence: null, baseline_value: 3000, unit: 'customers', provenance: 'ai_proposed', plausible_max: 20000 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Number of cafés', to: 'Monthly customers', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
    { from: 'Monthly customers', to: EVENT, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
  ],
  identities: [], unknowns: [], decision_question: BRIEF, unknown_concerns: [],
});

async function construct(answers: readonly string[], brief: string, widen = false): Promise<{ graph: Rec | undefined; result: Rec; calls: number }> {
  let graph: Rec | undefined; let calls = 0;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_id: 'v1', version_number: 1 }, graph, graph_hash: 'h1' } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => { calls += 1; return { text: answers[Math.min(calls, answers.length) - 1]!, status: 'completed' }; };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000k6', brief, dispatch as never, drafter as never,
    undefined, undefined, widen ? drafter as never : undefined) as Rec;
  return { graph, result, calls };
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const labels = (g: Rec, kind: string): string[] => (g.nodes as Rec[]).filter((n) => n.kind === kind).map((n) => String(n.label));

describe('K6: a brief with no stated aim gets a labelled provisional draft', () => {
  it('⭐ RED→GREEN: the one-line brief, with no request → registered; the event is an option, the aim an open question', async () => {
    const { graph, result, calls } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(cafeDraft())], BRIEF);
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true });
    expect(calls, 'the one goal retry runs first (a stated aim, qualitative included, is kept when the drafter can name it)').toBe(2);
    expect(result.open_aim, 'said as a provisional draft with its aim open').toBe(true);
    // The aim is an open question, Olumi's reading, with no figure invented for it; what led to the event leads to it.
    expect(goalOf(graph!)).toMatchObject({ label: OPEN_AIM_GOAL_LABEL, provenance: 'ai_inferred' });
    expect('goal_threshold' in goalOf(graph!), 'no figure invented for the aim').toBe(false);
    expect((graph!.edges as Rec[]).some((e) => e.from === 'monthly_customers' && e.to === goalOf(graph!).id)).toBe(true);
    expect(labels(graph!, 'goal')).not.toContain(EVENT);
    // The draft already weighs the action (two options): kept as drafted, never doubled.
    expect(labels(graph!, 'option').sort()).toEqual(['Keep one café', 'Open in Bristol next spring']);
  }, 60_000);

  it('⛔ Codex on #3426 @a36d8e6b: with the capability path\'s widening provider passed, the open-aim draft still makes exactly the two calls (draft, goal retry) — no widening on an open aim', async () => {
    const { result, calls } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(cafeDraft())], BRIEF, true);
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true, open_aim: true });
    expect(calls, 'draft + goal retry; the open-aim pass answers its own first call and does not widen').toBe(2);
  }, 60_000);

  it('a draft with no choice of its own: the action becomes the option beside it', async () => {
    const one = cafeDraft(); one.options = (one.options as Rec[]).filter((o) => o.label === 'Keep one café');
    const { graph, result } = await construct([JSON.stringify(one), JSON.stringify(one)], BRIEF);
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true });
    expect(labels(graph!, 'option').sort()).toEqual(['Keep one café', EVENT]);
    expect((graph!.nodes as Rec[]).find((n) => n.label === EVENT)).toMatchObject({ kind: 'option', provenance: 'ai_inferred' });
  }, 60_000);

  it('⭐ a stated QUALITATIVE aim is kept: when the retry names it, that goal is saved, never the open aim (AIE protection)', async () => {
    const aimed = cafeDraft(); aimed.goal = { ...aimed.goal, kind: null, deliverable: null, metric: 'Weekend sales', unit: '£', provenance: 'explicit', source_quote: null };
    aimed.links = (aimed.links as Rec[]).map((l) => (l.to === EVENT ? { ...l, to: 'Weekend sales' } : l));
    const { graph, result } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(aimed)], 'Should we open a second café in Bristol next spring to grow weekend sales?');
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true });
    expect(result.open_aim).toBeUndefined();
    expect(labels(graph!, 'goal')).toEqual(['Weekend sales']);
  }, 60_000);

  // ⭐ RE-RULED (signed change 6): a stated figure no longer withholds the draft (Paul's dd904404 stated two durations and
  // saw nothing). The aim is still Olumi's open question, never a goal built from the figure.
  it.each([['digits', 'We currently have 5 cafés. Should we open another in Bristol next spring?'],
    ['words', 'We currently have five cafés. Should we open another in Bristol next spring?'],
    ['a stated aim the drafter never names', 'Should we open a second café in Bristol next spring to reach 5000 customers a month?']])(
    '⭐ RE-RULED (%s): a brief that states a figure is drafted with the aim open, Olumi\'s, no figure invented for it', async (_form, stated) => {
      const { graph, result, calls } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(cafeDraft())], stated);
      expect(calls).toBe(2);
      expect(result, JSON.stringify(result).slice(0, 400)).toMatchObject({ ok: true, open_aim: true });
      expect(goalOf(graph!)).toMatchObject({ label: OPEN_AIM_GOAL_LABEL, provenance: 'ai_inferred' });
      expect('goal_threshold_raw' in goalOf(graph!)).toBe(false);
    }, 60_000);
});

/**
 * ⛔ Codex R1 on #3460 (probes `saved-authority.test.ts`, adopted verbatim; RED on 0520351a and 10a04939): ANOTHER event sentence
 * in the brief ("launch the website by December") made the brief-wide `event_by_date_prompted` true, which skipped this goal's
 * own attestation, so "Open a second café" was saved as the user's event goal. Attestation is now the drafted goal's own.
 */
describe('an aim the brief attests outranks a different drafted event (attestation is goal-bound)', () => {
  it.each(['Our goal is to launch the website by December.', 'Our aim is to grow weekend sales by 10%. We launch the website by December.'])(
    '⭐ RED→GREEN: %s', async (aim) => {
      const { briefAttestsEventByDate } = await import('../../goal-target/event-by-date-model.js');
      const d = cafeDraft();
      const brief = `${aim} Should we open a second café in Bristol next spring?`;
      expect(briefAttestsEventByDate(brief, d.goal as never), 'PRECONDITION: the brief does not attest THIS event').toBe(false);
      expect(briefAttestsEventByDate(brief), 'PRECONDITION: the brief states another event by a date').toBe(true);
      const { graph, result } = await construct([JSON.stringify(d), JSON.stringify(d)], brief);
      expect(graph?.nodes.find((n: Rec) => n.kind === 'goal')?.label).not.toBe(EVENT);
      expect(result, JSON.stringify(result).slice(0, 400)).toMatchObject({ ok: true, open_aim: true });
      expect((graph!.nodes as Rec[]).filter((n) => n.kind === 'goal')).toEqual([expect.objectContaining({ label: OPEN_AIM_GOAL_LABEL, provenance: 'ai_inferred' })]);
    }, 60_000);
});

/**
 * ⭐ Paul's live test (scenario dd904404, CEE cae490f4, 13:01Z): a dilemma about a dated release, stated with two durations and
 * two courses of action, no aim. The drafter took the release as an inferred event goal twice (the retry under kind null),
 * #3026 refused both and the K6 path was skipped (no "draft it now"; the brief states figures), so nothing was shown. SYNTHETIC
 * brief of the same structure (another domain): an unattested dated event as the goal, durations (one another speaker's), two
 * stated options, four risks, no link into the goal.
 */
describe('signed change 6: a dilemma brief with figures and no aim is shown as a labelled provisional draft', () => {
  const S = [
    'Our new exhibition is meant to open before the spring half-term.',
    'Priya has just told us the climate control in the main gallery keeps failing, and a proper repair needs at least 4 weeks.',
    "Our school bookings need 2 weeks' notice to move.",
    'If we postpone the opening we lose the school bookings, but if we open with the main gallery closed we will get complaints and refund requests.',
    'Should we postpone the opening or open with the main gallery closed?',
  ];
  const DILEMMA = S.join(' ');
  const OPENING = 'Spring exhibition opening';
  const link = (from: string, to: string, direction: string, quote: string | null = null): Rec => ({ from, to, direction,
    provenance: quote === null ? 'inferred' : 'explicit', effect_amount: null, effect_per_source_change: null, effect_provenance: null,
    definitional: null, basis: null, source_quote: quote });
  const statement = (quote: string, kind: string, label: string, field: string, form: string, extra: Rec = {}): Rec => ({ quote,
    subject: { kind, label, to_label: null, factor_label: null }, field, form, value: null, low: null, high: null, unit: null,
    qualifier: null, conditions: null, speaker: 'user', ...extra });
  const dilemmaDraft = (kind: 'event_by_date' | null): Rec => ({
    goal: { kind, deliverable: kind === null ? null : 'exhibition opening', metric: OPENING, operator: '>=', target_stated: false, value: null,
      unit: '', horizon_months: null, provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null,
      baseline_provenance: 'inferred', scope: null, quantity_frame: 'level', basis: null, source_quote: S[0] },
    constraints: [],
    options: [
      { label: 'Postpone the opening', provenance: 'explicit', changes: ['Opening timing'], interventions: [], added_capacity: null, is_status_quo: null },
      { label: 'Open with the main gallery closed', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    ],
    factors: [
      { label: 'Climate control failure', role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: null },
      { label: 'Repair duration', role: 'external', baseline_known: false, baseline_value: null, unit: 'weeks', provenance: 'inferred', plausible_max: null },
      { label: 'School booking notice', role: 'external', baseline_known: true, baseline_value: 2, unit: 'weeks', provenance: 'explicit', plausible_max: null },
      { label: 'Opening timing', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: null },
      { label: 'Repair window before opening', role: 'external', baseline_known: false, baseline_value: null, unit: 'weeks', provenance: 'inferred', plausible_max: null },
    ],
    risks: ['Lost school bookings', 'Visitor complaints', 'Refund requests'].map((label) => ({ label, provenance: 'explicit', unit: null, plausible_max: null, already_true_evidence: null }))
      .concat([{ label: 'Repair-status disagreement', provenance: 'inferred', unit: null, plausible_max: null, already_true_evidence: null }]),
    outcomes: [],
    links: [link('Opening timing', 'Repair window before opening', 'positive'), link('Repair window before opening', 'Climate control failure', 'negative'),
      link('Opening timing', 'Lost school bookings', 'positive', S[3]!), link('Climate control failure', 'Visitor complaints', 'positive', S[3]!),
      link('Visitor complaints', 'Refund requests', 'positive', S[3]!)],
    identities: [], unknowns: ['What date does the spring half-term start?'], decision_question: S[4], unknown_concerns: [],
    statements: [statement(S[0]!, 'goal', OPENING, 'measure', 'describes'),
      statement(S[1]!, 'factor', 'Repair duration', 'level', 'lower_bound', { value: 4, unit: 'weeks', qualifier: 'at least', speaker: 'other' }),
      statement(S[2]!, 'factor', 'School booking notice', 'level', 'point', { value: 2, unit: 'weeks' })],
  });

  it('PRECONDITION: the brief states figures and no aim, and the dated event is not one it attests', async () => {
    const { unattestedEventGoal } = await import('../../goal-target/event-by-date-model.js');
    expect(unattestedEventGoal(dilemmaDraft('event_by_date') as never, DILEMMA, false)).toMatchObject({ event: OPENING });
    expect(DILEMMA).toMatch(/\d/);
  });

  it('⭐ RED on cae490f4 (refused twice, nothing shown) → GREEN: saved with the aim open and Olumi\'s, both stated options, every risk, the event never the goal', async () => {
    const { graph, result, calls } = await construct([JSON.stringify(dilemmaDraft('event_by_date')), JSON.stringify(dilemmaDraft(null))], DILEMMA);
    expect(calls, 'draft + goal retry, no third call').toBe(2);
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true, open_aim: true });
    expect((graph!.nodes as Rec[]).filter((n) => n.kind === 'goal')).toEqual([expect.objectContaining({ label: OPEN_AIM_GOAL_LABEL, provenance: 'ai_inferred' })]);
    expect('goal_threshold_raw' in goalOf(graph!), 'no figure is invented for the open aim').toBe(false);
    expect(labels(graph!, 'goal').concat(labels(graph!, 'option'))).not.toContain(OPENING);
    expect((graph!.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => [n.label, n.provenance]).sort())
      .toEqual([['Open with the main gallery closed', 'from_brief'], ['Postpone the opening', 'from_brief']]);
    expect(labels(graph!, 'risk')).toHaveLength(4);
  }, 60_000);
});

describe('the request is the user\'s CURRENT words, quoted whole (the explicit_rebuild_request rule)', () => {
  const ctx = (typed: string) => ({ user_turn_text: typed, verified_user_messages: [typed] });
  const NOW = 'Just use your best guesses and draft the model now.';
  it('verified: a whole statement of this turn\'s typed message', () => {
    expect(currentRequestChecks(ctx(`Thanks. ${NOW}`), NOW)).toEqual([]);
  });
  it.each([
    ['words the user did not type', 'Draft the model now.', 'not_whole_current_statement'],
    ['a fragment that drops a negation', 'draft the model', 'not_whole_current_statement'],
  ])('refused: %s', (_n, words, check) => {
    expect(currentRequestChecks(ctx("Don't draft the model yet."), words)).toContain(check);
  });
  it('refused: an earlier message (not this turn\'s typed words) and a card press', () => {
    expect(currentRequestChecks({ user_turn_text: 'What now?', verified_user_messages: ['What now?', NOW] }, NOW)).toContain('not_whole_current_statement');
    expect(currentRequestChecks({ ...ctx(NOW), typed_approval_of: 'prop_x' }, NOW)).toContain('card_press');
  });
});
