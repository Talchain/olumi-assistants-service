/**
 * ⭐ AN OPTION THAT CHANGES SOMETHING THE MODEL LACKS: THE FACTOR IS ADDED IN THE SAME CHANGE (DL 5843303596; contract:
 * Runtime 5843960061/5843994112, Canonical's ruling 5843972346 as corrected 5843988693).
 *
 * Served on CEE fbb12b8 (DL (F) run f-20260926T063632Z, F4 FAIL → Runtime): "Please add two more options to compare:
 * "Test £54 versus £59 by customer cohort before rollout" and "Keep £49 and add a paid AI add-on". Add both." Only the
 * cohort option was added; the model has no add-on factor, so the add-on could not be.
 *
 * FIXTURE: that run's served graph (turn F7's read) WITHOUT the add-on option the later answer added — the model as it
 * stood when the add-on was asked for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planNewFactors, planNewOption } from '../propose-new-option.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Node = { id: string; kind: string; label: string; category?: string };
const served = JSON.parse(readFileSync(new URL('./fixtures/served-f4-before-addon-fbb12b8.json', import.meta.url), 'utf8')) as { nodes: Node[]; edges: unknown[] };
const F4 = 'Please add two more options to compare: "Test £54 versus £59 by customer cohort before rollout" and "Keep £49 and add a paid AI add-on". Add both. The add-on raises MRR.';
const ADDON = { label: 'AI add-on price', affects: [{ label: 'Monthly recurring revenue (MRR)', direction: 'positive' as const }] };
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', user_text: F4 };

describe('planNewFactors — a new factor must be new, change something the model has, and say which way', () => {
  it('the add-on price, raising MRR → planned with a batch key and the goal as its target', () => {
    const r = planNewFactors(served.nodes, [ADDON]);
    expect(r).toEqual({ ok: true, factors: [{ key: 'ai_add_on_price', label: 'AI add-on price',
      affects: [{ node_id: 'monthly_recurring_revenue_mrr', label: 'Monthly recurring revenue (MRR)', effect_direction: 'positive' }] }] });
  });

  it('refusals, each with nothing prepared: a name the model has; no target; an unknown target; a lever as target; no direction', () => {
    const refusal = (x: unknown) => (planNewFactors(served.nodes, [x as never]) as { refusal?: string }).refusal;
    expect(refusal({ ...ADDON, label: 'Pro plan price' })).toBe('new_factor_label_taken');
    expect(refusal({ ...ADDON, affects: [] })).toBe('new_factor_affects_nothing');
    expect(refusal({ ...ADDON, affects: [{ label: 'Add-on revenue', direction: 'positive' }] })).toBe('no_such_target');
    expect(refusal({ ...ADDON, affects: [{ label: 'Pro plan price', direction: 'positive' }] })).toBe('target_is_a_lever');
    expect(refusal({ ...ADDON, affects: [{ label: 'Monthly recurring revenue (MRR)' }] })).toBe('new_factor_direction_unstated');
  });

  it('CONTRAST: an observable factor or a risk the model has is a valid target', () => {
    expect(planNewFactors(served.nodes, [{ ...ADDON, affects: [{ label: 'AI feature adoption rate', direction: 'positive' }] }]).ok).toBe(true);
    expect(planNewFactors(served.nodes, [{ ...ADDON, affects: [{ label: 'Price-sensitive churn', direction: 'negative' }] }]).ok).toBe(true);
  });
});

describe('planNewOption links the option to a factor this same change adds', () => {
  const addOn = { label: 'Keep £49 and add a paid AI add-on', acts_on: [{ factor_label: 'AI add-on price', direction: 'positive' as const }], rationale: 'x' };

  it('RED (served F4): with the add-on declared, the option acts on it — no "no such factor"', () => {
    const nf = planNewFactors(served.nodes, [ADDON]);
    const plan = planNewOption(served.nodes, { ...addOn, newFactors: nf.ok ? nf.factors : [] });
    expect(plan).toEqual(expect.objectContaining({ ok: true, actsOn: [], newActsOn: [{ key: 'ai_add_on_price', label: 'AI add-on price', direction: 'positive' }] }));
  });

  it('CONTRAST: undeclared, it is still refused — and the refusal offers new_factors, never an unrelated link', () => {
    const plan = planNewOption(served.nodes, addOn) as { refusal?: string; detail?: string };
    expect(plan.refusal).toBe('no_such_factor');
    expect(plan.detail).toContain('new_factors');
  });
});

describe('propose_new_option sends ONE change carrying the option AND the factor it needs', () => {
  const setup = () => {
    const sent: { path: string; body: unknown }[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: served, graph_hash: 'h0' } };
      sent.push({ path, body });
      return { status: 500, json: {} };
    };
    return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
  };
  const call = {
    label: 'Keep £49 and add a paid AI add-on',
    acts_on: [{ factor_label: 'AI add-on price', direction: 'positive' }],
    new_factors: [ADDON],
    rationale: 'the user asked for it',
  };

  it('RED (served F4; needs Canonical\'s builder): the typed turn carries new_factors and the option names it by factor_key', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, call as never);
    const params = (sent[0]?.body as { chip?: { parameters?: Record<string, unknown> } } | undefined)?.chip?.parameters;
    expect(params, JSON.stringify(r)).toBeDefined();
    expect(params!['new_factors']).toEqual([{ key: 'ai_add_on_price', label: 'AI add-on price',
      affects: [{ node_id: 'monthly_recurring_revenue_mrr', effect_direction: 'positive' }] }]);
    expect(params!['interventions']).toEqual([{ factor_key: 'ai_add_on_price', value: null }]);
  });

  it('the size limit counts each new factor and what it affects — refused before anything is sent (#1974 review N2)', async () => {
    const { caps, sent } = setup();
    // 4 options × (option + decision link + 3 factors) = 20; 4 new factors × (node + 3 targets) = 16; 36 > 32.
    const targets = [{ label: 'Monthly recurring revenue (MRR)', direction: 'positive' }, { label: 'Active Pro subscribers', direction: 'positive' }, { label: 'Monthly churn', direction: 'negative' }];
    const nf = [1, 2, 3, 4].map((i) => ({ label: `Add-on ${i} price`, affects: targets }));
    const options = [1, 2, 3, 4].map((i) => ({ label: `Add-on ${i}`, acts_on: [
      { factor_label: 'Pro plan price', direction: 'positive' }, { factor_label: 'AI feature adoption rate', direction: 'positive' }, { factor_label: `Add-on ${i} price`, direction: 'positive' },
    ] }));
    const r = await caps.proposeNewOption(ctx, { options, new_factors: nf, rationale: 'x' } as never) as { refusal?: string; detail?: string };
    expect(r.refusal, JSON.stringify(r)).toBe('too_many_links');
    expect(sent, 'without the new factors the count would be 20 and it would have been sent').toEqual([]);
  });

  it('the preview asks for the new factor\'s value today, and never says the analysis will (#1974 review N1)', async () => {
    const src = readFileSync(new URL('../runtime/agent-capabilities.ts', import.meta.url), 'utf8');
    expect(src).toContain('Ask the user what it is today');
    expect(src, 'the old claim: readiness raises nothing once a level is set').not.toContain('not set yet \\u2014 the analysis will ask for it');
  });

  it('a factor declared for no option is refused before anything is sent', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { ...call, acts_on: [{ factor_label: 'Pro plan price', direction: 'positive' }] } as never) as { refusal?: string };
    expect(r.refusal).toBe('new_factor_unused');
    expect(sent).toEqual([]);
  });

  it('a bad new factor refuses the whole change before anything is sent', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, { ...call, new_factors: [{ ...ADDON, affects: [{ label: 'Monthly recurring revenue (MRR)' }] }] } as never) as { refusal?: string };
    expect(r.refusal).toBe('new_factor_direction_unstated');
    expect(sent).toEqual([]);
  });
});
