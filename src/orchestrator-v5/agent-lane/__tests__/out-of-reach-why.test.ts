/**
 * Science goals §(k) FINAL (8 Oct) + DL conditions: when every licensed option shows the "less than 1%" floor, say why in
 * the model's terms and ask the one question. Fixtures are CAPTURED: C3's stored graph (23b1495c) and the licence record
 * of its sized re-run on the frozen CEE 23349562 (`_capture` in each).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { outOfReachWhyOf } from '../out-of-reach-why.js';

type Rec = Record<string, any>;
const load = (f: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/out-of-reach-c3-23b1495c.${f}.json`, import.meta.url), 'utf8')) as Rec;
const graph = () => load('graph');
const result = (edit: (lic: Rec) => void = () => {}) => {
  const r = load('result');
  edit(r.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED'));
  return { enrichment: r };
};
const node = (g: Rec, id: string) => g.nodes.find((n: Rec) => n.id === id);
const edge = (g: Rec, from: string, to: string) => g.edges.find((e: Rec) => e.from === from && e.to === to);
const ASK = 'What could grow ‘Pro subscribers’ in this decision?';
const FACE = "No option can reach your £20,000 in this model: even at £59 with no subscribers lost, MRR would be £14,750 a month (with Olumi's 250 subscribers).";
const WHY = "In this model, the options only change ‘Pro plan price’, and every route from it to ‘Pro subscribers’ lowers it, through ‘Monthly churn’. So even at £59 with no subscribers lost, MRR would be £59 × 250 (Olumi's starting figure for ‘Pro subscribers’) = £14,750 a month, short of your £20,000.";
const LEVER = '‘New Pro subscribers per month’ would grow ‘Pro subscribers’, but no option changes it.';

describe('out-of-reach why (Science §(k) FINAL)', () => {
  it('RED (C3 23b1495c): the face, the ask and More detail, in Science\'s words', () => {
    expect(outOfReachWhyOf(result(), graph())).toEqual({ visible: `${FACE} ${ASK}`, why: FACE, ask: ASK, detail: [WHY, LEVER] });
  });
  it('RED: the ceiling is the LARGEST licensed option rate (£59, not the status quo £49) × the volume level, by node id', () => {
    const g = graph(); node(g, 'pro_subscribers').observed_state.raw_value = 300;
    expect(outOfReachWhyOf(result(), g)!.visible).toContain('MRR would be £17,700 a month');
  });
  it('the face stays inside the ≤80-word contract', () => {
    expect(outOfReachWhyOf(result(), graph())!.visible.split(/\s+/).length).toBeLessThanOrEqual(45);
  });
  it.each([
    ['one option at 3% (DL condition 3)', (l: Rec) => { l.pct_by_option.raise_pro_to_59 = 3; }],
    ['an option withheld', (l: Rec) => { l.withheld_option_ids = ['raise_pro_to_59']; }],
    ['no licence form "each"', (l: Rec) => { l.form = 'similar'; l.similar_option_ids = ['keep_pro_at_49', 'raise_pro_to_59']; }],
  ])('CONTROL: %s → nothing', (_n, edit) => {
    expect(outOfReachWhyOf(result(edit), graph())).toBeNull();
  });
  it('CONTROL: an unconfirmed reading → nothing', () => {
    const g = graph(); node(g, 'mrr').nonlinear_identity.stated_in_brief = false;
    expect(outOfReachWhyOf(result(), g)).toBeNull();
  });
  it('CONTROL (Science (c)): a route from the rate that GROWS the volume → no why, the ask alone', () => {
    const g = graph();
    g.edges.push({ from: 'pro_plan_price', to: 'new_pro_subscribers_per_month', strength: { mean: 0.2 }, effect_direction: 'positive' });
    const out = outOfReachWhyOf(result(), g)!;
    expect(out.visible).toBe(ASK);
    expect(out.detail.some((d) => d.startsWith('In this model'))).toBe(false);
  });
  it('a placeholder on the route is said by its drafted sign', () => {
    const g = graph(); edge(g, 'monthly_churn', 'pro_subscribers').provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' };
    expect(outOfReachWhyOf(result(), g)!.detail[0]).toContain('through ‘Monthly churn’ (one of these links has no size yet). So even');
  });
  it('the user\'s own level carries no Olumi mark (§(m))', () => {
    // The user's own level, as the ONE provenance authority reads it: the brief's figure, extracted as stated.
    const g = graph(); Object.assign(node(g, 'pro_subscribers').observed_state, { source: 'brief_extraction', extractionType: 'explicit' });
    const out = outOfReachWhyOf(result(), g)!;
    expect(out.visible).toBe(`No option can reach your £20,000 in this model: even at £59 with no subscribers lost, MRR would be £14,750 a month. ${ASK}`);
    expect(out.detail[0]).toContain('£59 × 250 = £14,750 a month');
  });
  it('a level of UNKNOWN origin is never called Olumi\'s (the authority answers whose, three tiers)', async () => {
    const { valueAuthorshipOf } = await import('../../../cee/provenance/provenance-of.js');
    const g = graph(); const os = node(g, 'pro_subscribers').observed_state; delete os.source; delete os.extractionType;
    expect(valueAuthorshipOf(os), 'control: the authority reads this level as unknown').toBe('unknown');
    const out = outOfReachWhyOf(result(), g)!;
    expect(out.visible).toBe(`No option can reach your £20,000 in this model: even at £59 with no subscribers lost, MRR would be £14,750 a month. ${ASK}`);
    expect(out.detail[0]).not.toContain('Olumi');
  });
  it('CONTROL: a ceiling at or over the target → no why (the bound would not hold)', () => {
    const g = graph(); node(g, 'mrr').goal_threshold_raw = 14000;
    expect(outOfReachWhyOf(result(), g)!.visible).toBe(ASK);
  });
  it('CONTROL: a definitional "less"/"plus" term of the reading (7f9fe459 shape) → no why, the ask alone (rate × volume is no ceiling)', () => {
    const g = graph();
    g.nodes.push({ id: 'mrr_lost', kind: 'risk', label: 'MRR lost to price-induced churn' });
    g.edges.push({ from: 'mrr_lost', to: 'mrr', effect_direction: 'negative', strength: { mean: -0.4 }, provenance: { definitional: true } });
    expect(outOfReachWhyOf(result(), g)!.visible).toBe(ASK);
  });
  it('DL condition 1: no growing factor in the graph → no lever, and the ask names nothing else', () => {
    const g = graph(); g.edges = g.edges.filter((e: Rec) => e.from !== 'new_pro_subscribers_per_month');
    const out = outOfReachWhyOf(result(), g)!;
    expect(out.detail).toEqual([WHY]);
    expect(out.ask).toBe(ASK);
  });
});

/**
 * ⭐ THE RUN FACT ON THE REAL PATH (DL 14 Oct: the COPY-SHAPE composer is retired; the AI words it). The Agent's canonical
 * state (`getCanonicalState`, what CURRENT MODEL STATE and the Explain path read) carries C3's reason and its one question
 * under `analysis.goal_out_of_reach`, beside the Run's licence.
 */
describe('the AI receives the out-of-reach reason as a Run fact', () => {
  const served = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Rec;
  const ctx = { scenario_id: '520aab46-9ed5-4819-9d7f-498d16603943', authenticated_user_id: null, request_id: 'goal-reach' };
  const analysisOf = async (read: Rec): Promise<Rec> => {
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../proposal.js');
    const dispatch = (async (path: string) => (path.endsWith('/graph') ? { status: 200, json: read } : { status: 500, json: {} })) as never;
    return ((await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState(ctx)) as Rec).analysis as Rec;
  };
  const c3Read = (edit: (lic: Rec) => void = () => {}): Rec => {
    const read = JSON.parse(JSON.stringify(served)) as Rec;
    read.graph = graph();
    read.analysis_result = result(edit);
    read.analysis_goal_certainty = [];
    return read;
  };

  it('RED (C3 23b1495c): the reason, the detail and the one question reach the AI, with how to use them', async () => {
    const analysis = await analysisOf(c3Read());
    expect(analysis.goal_chance_licence, 'control: the same Run\'s licence is read').toBeDefined();
    expect(analysis.goal_out_of_reach).toEqual({ why: FACE, detail: [WHY, LEVER], question: ASK, note: expect.stringContaining('never figures of your own') });
  }, 60_000);

  it('CONTROL: one option above the floor (3%) → no out-of-reach fact', async () => {
    const analysis = await analysisOf(c3Read((l) => { l.pct_by_option.raise_pro_to_59 = 3; }));
    expect(analysis.goal_chance_licence).toBeDefined();
    expect(analysis).not.toHaveProperty('goal_out_of_reach');
  }, 60_000);

  it('CONTROL: a Run that is not current carries no out-of-reach fact', async () => {
    const read = c3Read();
    read.analysis_state = { ...read.analysis_state, run_state: { ...read.analysis_state.run_state, kind: 'complete_stale' } };
    expect(await analysisOf(read)).not.toHaveProperty('goal_out_of_reach');
  }, 60_000);
});
