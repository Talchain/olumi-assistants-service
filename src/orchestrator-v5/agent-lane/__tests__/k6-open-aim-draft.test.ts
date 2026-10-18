/**
 * ⭐ K6 (PL amendment 2; DL ack 18 Oct): a one-line "should we do X?" brief states no aim, so the drafter takes the ACTION as
 * an event goal, which #3026 rightly never saves as the goal. On the user's explicit "draft it now" (the AI quotes it,
 * `explicit_draft_request`; the host checks it is a whole statement of this turn's typed message), the draft is kept as a
 * labelled provisional model: the event becomes an option and the aim an open question. A brief that states a figure keeps
 * the retry-then-ask path, so an attested aim always wins (#3026's hiring case).
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

async function construct(answers: readonly string[], brief: string, draftNow?: boolean): Promise<{ graph: Rec | undefined; result: Rec; calls: number }> {
  let graph: Rec | undefined; let calls = 0;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_id: 'v1', version_number: 1 }, graph, graph_hash: 'h1' } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => { calls += 1; return { text: answers[Math.min(calls, answers.length) - 1]!, status: 'completed' }; };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000k6', brief, dispatch as never, drafter as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, draftNow) as Rec;
  return { graph, result, calls };
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const labels = (g: Rec, kind: string): string[] => (g.nodes as Rec[]).filter((n) => n.kind === kind).map((n) => String(n.label));

describe('K6: an explicit "draft it now" on a brief with no stated aim gets a labelled provisional draft', () => {
  it('⭐ RED→GREEN: the one-line brief + a verified "draft it now" → registered; the event is an option, the aim an open question', async () => {
    const { graph, result, calls } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(cafeDraft())], BRIEF, true);
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

  it('a draft with no choice of its own: the action becomes the option beside it', async () => {
    const one = cafeDraft(); one.options = (one.options as Rec[]).filter((o) => o.label === 'Keep one café');
    const { graph, result } = await construct([JSON.stringify(one), JSON.stringify(one)], BRIEF, true);
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true });
    expect(labels(graph!, 'option').sort()).toEqual(['Keep one café', EVENT]);
    expect((graph!.nodes as Rec[]).find((n) => n.label === EVENT)).toMatchObject({ kind: 'option', provenance: 'ai_inferred' });
  }, 60_000);

  it('⭐ a stated QUALITATIVE aim is kept: when the retry names it, that goal is saved, never the open aim (AIE protection)', async () => {
    const aimed = cafeDraft(); aimed.goal = { ...aimed.goal, kind: null, deliverable: null, metric: 'Weekend sales', unit: '£', provenance: 'explicit', source_quote: null };
    aimed.links = (aimed.links as Rec[]).map((l) => (l.to === EVENT ? { ...l, to: 'Weekend sales' } : l));
    const { graph, result } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(aimed)], 'Should we open a second café in Bristol next spring to grow weekend sales?', true);
    expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, mutated: true });
    expect(result.open_aim).toBeUndefined();
    expect(labels(graph!, 'goal')).toEqual(['Weekend sales']);
  }, 60_000);

  it('CONTRAST: the same brief WITHOUT the request → refused and asked, as today (turn one stays a question)', async () => {
    const { graph, result } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(cafeDraft())], BRIEF);
    expect(result).toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
    expect(graph).toBeUndefined();
  }, 60_000);

  it('⭐ an attested aim wins: a brief that states a figure keeps the retry-then-ask path, even with the request', async () => {
    const stated = 'Should we open a second café in Bristol next spring to reach 5000 customers a month?';
    const { graph, result, calls } = await construct([JSON.stringify(cafeDraft()), JSON.stringify(cafeDraft())], stated, true);
    expect(calls, 'the retry is asked to re-choose the goal').toBe(2);
    expect(result).toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
    expect(graph).toBeUndefined();
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
