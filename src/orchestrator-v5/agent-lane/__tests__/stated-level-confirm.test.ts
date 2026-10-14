/**
 * ⭐ S2 — CONFIRM, NEVER RE-ASK (DL 14 Oct; pricing r2 judge finding 5, served CEE 36f64756, `pricing/reads/02-03-after-reopen.json`).
 * Paul's brief says "increase the Pro plan price from £49 to £59 per month"; the model held his £49 as `unverified_brief`
 * (his figure, its role unverified), so the Run asked "what are they today?" for a price he had already given.
 * His own complete statement, verified by the one shared contract, confirms the HELD figure as his, only by the press,
 * through the served value writer (`applyFactorValueEdit`), and the identity reading then counts it.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { valueClassOf } from '../../../cee/provenance/provenance-of.js';
import { identityPartLevelAsk, identityPartsWithoutLevel } from '../../system-events/identity-confirm-edit.js';

const SCENARIO = '5b52ff13-0000-4000-8000-000000000049';
const BRIEF = 'Our goal is to reach £20k MRR within 12 months while keeping monthly churn under 8%. Should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const SENTENCE = 'Should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const ctx = (now: string, extra: Record<string, unknown> = {}) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r',
  user_text: [BRIEF, now].join('\n'), user_turn_text: now, ...extra });

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; provenance?: string };
// Served pricing r2's stored price, verbatim (`reads/02-03-after-reopen.json`).
const PRICE_OS = { cap: 200, unit: '£ per subscriber per month', value: 0.245, source: 'cee_inference', raw_value: 49, declared_scale: 'unit_interval',
  extractionType: 'inferred', user_material_unverified: true };
const BASE: Node[] = [
  { id: 'mrr', kind: 'goal', label: 'MRR' },
  { id: 'pro_plan_monthly_price', kind: 'factor', label: 'Pro plan monthly price', provenance: 'unverified_brief', observed_state: { ...PRICE_OS } },
  { id: 'pro_paying_subscribers', kind: 'factor', label: 'Pro paying subscribers', provenance: 'ai_inferred',
    observed_state: { unit: 'subscribers', value: 0.25, source: 'cee_inference', raw_value: 250, extractionType: 'inferred' } },
];
const EDGES = ['pro_plan_monthly_price', 'pro_paying_subscribers'].map((from) => (
  { from, to: 'mrr', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }));

/** The product double whose value writer IS the served writer (`keep-olumis-estimate.test.ts`'s). */
function product() {
  let nodes: Node[] = structuredClone(BASE);
  let rev = 0;
  let writes = 0;
  const graph = () => ({ nodes, edges: EDGES });
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind !== 'factor_value_edit') return { status: 400, json: {} };
      const res = await applyFactorValueEdit({
        payload: { kind: 'system_event', turn_id: String(b.turn_id), scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
        event: ev as never, requestId: `w${writes}`, persistedGraph: graph() as never, priorFacts: [],
      });
      if (res.kind !== 'mutated') return { status: 200, json: { assistant_text: 'Not changed.' } };
      writes += 1;
      nodes = (res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes;
      rev += 1;
      const fact = (res as unknown as { handlerFacts: { fact_type: string; result: { after?: unknown } }[] }).handlerFacts.find((f) => f.fact_type === 'set_factor_value');
      return { status: 200, json: { assistant_text: 'Saved.', graph_hash: `h${rev}`, blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: String(ev.target_id), after: fact?.result.after }] } };
    }
    return { status: 200, json: { graph: graph(), graph_hash: `h${rev}`, brief_text: BRIEF } };
  };
  return { d, byId: () => Object.fromEntries(nodes.map((n) => [n.id, n])), writes: () => writes };
}
const confirm = (quote: string, value = 49) => ({ assumptions: [{ factor_label: 'Pro plan monthly price', value, unit: '£ per subscriber per month',
  basis: '', user_stated: true, statements: [{ quote, form: 'point', value }] }] });

describe('S2 confirm: a figure the user wrote is confirmed from their own statement, never asked again', () => {
  it('RED→GREEN: his brief sentence → ONE card quoting it → the press → his £49, unchanged, is HIS (user-stated); 250 stays Olumi’s', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    expect(valueClassOf(p.byId().pro_plan_monthly_price.observed_state), 'PRECONDITION: held, role unverified').not.toBe('user_stated');
    const card = await caps.proposeAssumptions(ctx('What do you need from me?') as never, confirm(SENTENCE) as never) as Record<string, unknown>;
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(String(card.public_label)).toBe(`Record 1 figure you gave: Pro plan monthly price = £49 per subscriber per month today, as you wrote it: “${BRIEF}”`);
    expect(card.assumptions).toEqual([expect.objectContaining({ factor: 'Pro plan monthly price', value: 49, your_figure: true, confirms_your_figure: true })]);
    expect(p.writes(), 'nothing before the press').toBe(0);
    const applied = await caps.authoriseChange(ctx('Yes') as never, { proposal_id: String(card.proposal_id) }) as Record<string, unknown>;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    const os = p.byId().pro_plan_monthly_price.observed_state!;
    expect({ raw_value: os.raw_value, value: os.value, cap: os.cap }).toEqual({ raw_value: 49, value: 0.245, cap: 200 });
    expect(valueClassOf(os), JSON.stringify(os)).toBe('user_stated');
    expect(os).not.toHaveProperty('user_material_unverified');
    // Olumi's 250 is untouched and stays Olumi's.
    expect(valueClassOf(p.byId().pro_paying_subscribers.observed_state)).toBe('ai_drafted');
  });
  it('never on other words: a partial quote, another figure, unverified text or Olumi’s own estimate prepares nothing', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    // "from £49 to £59" drops the rest of his sentence: not his whole statement (T2A5's one check).
    expect(await caps.proposeAssumptions(ctx('Hi') as never, confirm('from £49 to £59 per month') as never)).toMatchObject({ ok: false, refusal: 'level_not_stated' });
    // His sentence states £59 too, but the model holds £49: this act confirms only the held figure.
    expect(await caps.proposeAssumptions(ctx('Hi') as never, confirm(SENTENCE, 59) as never)).toMatchObject({ ok: false, refusal: 'not_the_held_figure' });
    // Only retained, unverified words: origin unknown.
    expect(await caps.proposeAssumptions(ctx('Hi', { user_text: 'Hi', unverified_user_text: BRIEF }) as never, confirm(SENTENCE) as never))
      .toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(p.writes()).toBe(0);
    expect(valueClassOf(p.byId().pro_plan_monthly_price.observed_state)).not.toBe('user_stated');
  });
  it('the identity ask CONFIRMS his held £49 instead of asking for it, and still asks Olumi’s basis-less 250 blank; after his press only the 250 is asked', async () => {
    const PARTS = ['pro_plan_monthly_price', 'pro_paying_subscribers'];
    const ask = (g: unknown) => identityPartLevelAsk('MRR', ['Pro plan monthly price', 'Pro paying subscribers'], identityPartsWithoutLevel(g, PARTS));
    expect(ask({ nodes: BASE, edges: EDGES })).toBe('To work out ‘MRR’ as ‘Pro plan monthly price’ × ‘Pro paying subscribers’: '
      + 'Is your £49 per subscriber per month today\'s ‘Pro plan monthly price’? What is ‘Pro paying subscribers’ today?');
    expect(ask({ nodes: BASE, edges: EDGES })).not.toMatch(/what are they today/);
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const card = await caps.proposeAssumptions(ctx('What do you need from me?') as never, confirm(SENTENCE) as never) as Record<string, unknown>;
    await caps.authoriseChange(ctx('Yes') as never, { proposal_id: String(card.proposal_id) });
    expect(identityPartsWithoutLevel({ nodes: Object.values(p.byId()), edges: EDGES }, PARTS).map((m) => m.id)).toEqual(['pro_paying_subscribers']);
    expect(ask({ nodes: Object.values(p.byId()), edges: EDGES }))
      .toBe('To work out ‘MRR’ as ‘Pro plan monthly price’ × ‘Pro paying subscribers’, I need ‘Pro paying subscribers’: what is it today?');
  });
});
