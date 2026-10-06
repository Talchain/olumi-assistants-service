/**
 * ⭐ F1 ON THE AGENT'S DOORS (red team #87 6006627551, shape (c): chat "make … weak" on a link the user sized in their
 * brief; DL lease to c6, #87 6006752323; Science d5 CONFIRMED 6006667946).
 *
 * The writer refuses to drop the user's own figure (`edge-strength-edit-keeps-user-figure.test.ts`). The Agent must
 * agree with it BEFORE the approval card: never a change prepared that the writer then refuses, and the user hears
 * their figure quoted in the writer's own words. Only the user's own "replace my figure" this turn prepares a replace,
 * and the approval carries it to the writer in-process (`replaces_user_figure` on the held proposal).
 *
 * Graph: served journey C (651a7fd). Cost overrun risk → MRR (−0.5, strong, lowers MRR) is made the user's brief figure;
 * it is not an identity operand, so the definitional rule never fires on it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dispatchTool } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const C05 = (JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-c05-budget-651a7fd.json', import.meta.url), 'utf8')) as { graph: Record<string, unknown> }).graph;
const QUOTE = 'Every overrun costs us about £2k of MRR';
const refusal = (band: string): string =>
  `This link holds your figure: ‘${QUOTE}’. Change the figure, or say ‘replace my figure with ${band}’.`;

type Edge = { from: string; to: string; strength: { mean: number }; provenance?: Record<string, unknown> };
const FDS_QUOTE = 'Each £1k of feature spend adds about 2 points of feature value';
function withFigure(sizing: 'user_stated' | 'olumi_estimate', alsoHoldFds = false): Record<string, unknown> {
  const g = JSON.parse(JSON.stringify(C05)) as { edges: Edge[] };
  if (alsoHoldFds) {
    const f = g.edges.find((x) => x.from === 'feature_development_spend' && x.to === 'pro_plan_feature_value')!;
    f.provenance = { source: 'brief_extraction', magnitude: 'user_stated', source_quote: FDS_QUOTE,
      natural_effect: { amount: 2, amount_unit: 'points', per_source_change: 1000, per_source_change_unit: 'GBP', strength_mean: f.strength.mean, strength_mean_frame: 'edge_strength' } };
  }
  const e = g.edges.find((x) => x.from === 'cost_overrun_risk' && x.to === 'mrr')!;
  const natural = { amount: -2000, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: 'overrun', strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength' };
  e.provenance = sizing === 'user_stated'
    ? { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: natural, source_quote: QUOTE }
    : { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: natural };
  return g as unknown as Record<string, unknown>;
}

async function call(tool: 'propose_link_strength' | 'propose_link_strengths', args: Record<string, unknown>, message: string, graph: Record<string, unknown>) {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(graph)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' },
      analysis_state: { run_state: { kind: 'never_run' } }, analysis_identity_run_use: { kind: 'no_run' } } }
    : { status: 500, json: {} });
  const store = new ProposalStore();
  const puts: Array<{ operations: Array<{ value: Record<string, unknown> }>; public_label: string }> = [];
  const put = store.put.bind(store);
  store.put = (p) => { puts.push(p as never); return put(p); };
  const caps = createAgentCapabilities(d, store);
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c3', authenticated_user_id: null, request_id: 'r', user_text: message, user_turn_text: message };
  return { r: (await dispatchTool(tool, JSON.stringify(args), ctx as never, caps)) as Record<string, unknown>, puts };
}

const LINK = { from_label: 'Cost overrun risk', to_label: 'MRR' };

describe('⭐ F1: propose_link_strength never prepares a move that drops the user’s figure', () => {
  it('RED-TEAM (c): “make … weak” on the user’s brief figure is refused in the writer’s words, “slight”, nothing prepared', async () => {
    const msg = 'Make the link from Cost overrun risk to MRR weak.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'user_figure_held' }));
    expect(String(r.detail)).toContain(`"${refusal('slight')}"`);
    expect(r).not.toHaveProperty('proposal_id');
    expect(puts).toEqual([]);
  });

  it('a negated replace is no replace: “I don’t want to replace my figure” still refuses', async () => {
    const msg = 'I don’t want to replace my figure. Make the link from Cost overrun risk to MRR weak.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'user_figure_held' }));
    expect(puts).toEqual([]);
  });

  it('REPLACE: the user’s own “replace my figure with slight” prepares ONE replace that names the figure, and carries it for the writer', async () => {
    const msg = 'For the link from Cost overrun risk to MRR, replace my figure with slight.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.public_label).toBe(`Replace your figure (‘${QUOTE}’) on "Cost overrun risk" → "MRR" with slight, as your own estimate`);
    expect(puts[0]!.operations[0]!.value).toMatchObject({ intent: 'set', magnitude: 0.1, direction_intent: 'preserve', band: 'weak',
      replaces_user_figure: { quote: QUOTE } });
  });

  it('BUDDY r1 #3: a replace bound to ANOTHER link grants nothing here — “keeping my figure” on this one is refused', async () => {
    const msg = 'Replace my figure on Cost overrun risk to MRR with slight. Make Feature development spend to Pro plan feature value weak too, keeping my figure.';
    const here = await call('propose_link_strength', { from_label: 'Feature development spend', to_label: 'Pro plan feature value', strength: 'weak', rationale: msg }, msg, withFigure('user_stated', true));
    expect(here.r, JSON.stringify(here.r)).toEqual(expect.objectContaining({ ok: false, refusal: 'user_figure_held' }));
    expect(String(here.r.detail)).toContain(FDS_QUOTE);
    expect(here.puts).toEqual([]);
    // …and the link the clause names IS replaced.
    const there = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated', true));
    expect(there.puts[0]!.operations[0]!.value).toMatchObject({ replaces_user_figure: { quote: QUOTE } });
  });

  it('BUDDY r1 #4: “replace my figure with strong” in the band the link already sits in is a replace (set to the midpoint), never a confirm', async () => {
    const msg = 'For the link from Cost overrun risk to MRR, replace my figure with strong.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'strong', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
    expect(puts[0]!.operations[0]!.value).toMatchObject({ intent: 'set', magnitude: 0.55, direction_intent: 'preserve', replaces_user_figure: { quote: QUOTE } });
  });

  it('BUDDY r1 #5: a replace that would also reverse the link is refused in its own words; nothing prepared', async () => {
    const msg = 'For the link from Cost overrun risk to MRR, replace my figure with slight; that link runs the other way.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', direction: 'positive', direction_from_words: 'that link runs the other way', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'replace_keeps_direction' }));
    expect(String(r.detail)).toContain('Replacing your figure keeps the link\u2019s direction. To reverse it, change the figure itself.');
    expect(puts).toEqual([]);
  });

  it('BUDDY r2 #1: a shared END never binds the replace — “on Pro plan price to MRR” is not Cost overrun risk → MRR’s', async () => {
    const msg = 'Replace my figure on Pro plan price to MRR with slight. Make Cost overrun risk to MRR weak too, keeping my figure.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'user_figure_held' }));
    expect(puts).toEqual([]);
  });

  it('BUDDY r2 #2: “Do not, e.g., replace my figure …” through the real tool is no replace', async () => {
    const msg = 'Do not, e.g., replace my figure with slight. Make Cost overrun risk to MRR weak.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'user_figure_held' }));
    expect(puts).toEqual([]);
  });

  it('the replace binds to the band ITS clause states: “… weak. Then replace my figure with strong.” replaces nothing at slight', async () => {
    const msg = 'Make the link from Cost overrun risk to MRR weak. Then replace my figure with strong.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'user_figure_held' }));
    expect(puts).toEqual([]);
  });

  it('CONTROL — naming the band the link already sits in is a confirm: prepared, figure kept (review), no replace carried', async () => {
    const msg = 'The link from Cost overrun risk to MRR is strong.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'strong', rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
    expect(puts[0]!.operations[0]!.value).toMatchObject({ intent: 'confirm_current' });
    expect(puts[0]!.operations[0]!.value).not.toHaveProperty('replaces_user_figure');
  });

  it('TWIN — on Olumi’s estimate the same “make … weak” is prepared as before', async () => {
    const msg = 'Make the link from Cost overrun risk to MRR weak.';
    const { r, puts } = await call('propose_link_strength', { ...LINK, strength: 'weak', rationale: msg }, msg, withFigure('olumi_estimate'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true }));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.operations[0]!.value).not.toHaveProperty('replaces_user_figure');
  });
});

describe('⭐ F1: propose_link_strengths leaves the user’s figure out and says so, for the user’s band and Olumi’s estimate alike', () => {
  it('RED: the only link holds the user’s figure → nothing prepared, the refusal in `left_out_user_figures`', async () => {
    const msg = 'Make the link from Cost overrun risk to MRR weak.';
    const { r, puts } = await call('propose_link_strengths', { links: [{ ...LINK, strength: 'weak', from_words: 'Cost overrun risk to MRR weak' }], rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'user_figure_held', left_out_user_figures: [refusal('slight')] }));
    expect(puts).toEqual([]);
  });

  it('RED: Olumi’s estimate never replaces a brief figure either (the old `usersOwn` test read only `user_specified`)', async () => {
    const msg = 'Use your estimates for these links.';
    const { r, puts } = await call('propose_link_strengths', { links: [{ ...LINK, strength: 'moderate' }], rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'user_figure_held', left_out_user_figures: [refusal('moderate')] }));
    expect(puts).toEqual([]);
  });

  it('MIXED: the other link is prepared, the held one is left out and named for the Agent to say', async () => {
    const msg = 'Make the link from Cost overrun risk to MRR weak, and Feature development spend to Pro plan feature value weak.';
    const { r, puts } = await call('propose_link_strengths', { links: [
      { ...LINK, strength: 'weak', from_words: 'Cost overrun risk to MRR weak' },
      { from_label: 'Feature development spend', to_label: 'Pro plan feature value', strength: 'weak', from_words: 'Feature development spend to Pro plan feature value weak' },
    ], rationale: msg }, msg, withFigure('user_stated'));
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, left_out_user_figures: [refusal('slight')] }));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.operations.map((o) => (o as unknown as { path: string }).path)).toEqual(['feature_development_spend::pro_plan_feature_value']);
  });
});
