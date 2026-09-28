/**
 * ⭐ EVERY PART OF A DECLARED PRODUCT GETS A LEVEL — OLUMI'S, LABELLED — SO THE PRODUCT CAN BE COMPUTED (MG #72 5865315803).
 *
 * Served journey C run 2 (MG gate `c2214/run-20260928T071622Z-2`, CEE 651a7fd): the drafter declared "MRR = Pro plan price ×
 * Pro paying subscribers" and gave the subscribers NO level (`observed_state: null`; not acted on by any option, not limited,
 * so no coverage rule named it). ISL evaluates a product from its parts' levels, so every Run was refused ("the current
 * number of Pro paying subscribers is missing") — from the first one, before the user said anything.
 *
 * The rule (#2205's, one more reason): a quantity a declared product multiplies, with no level, is a baseline gap for the
 * ONE repair retry (`because: 'identity'`), which gives Olumi's provisional estimate — baseline_known:false, ai_proposed —
 * stamped `cee_inference`, never the user's. A part the draft already levels, and a model with no product, are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BRIEF = 'We need to reach £100k MRR within 6 months. Should we develop new features and increase our Pro plan price '
  + 'from £49 to £59 per month, or invest in additional advertising?';
const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const factor = (label: string, baseline_value: number | null, plausible_max: number, unit: string, known = false) => ({
  label, role: 'controllable' as const, baseline_known: known, baseline_value, unit, provenance: known ? 'explicit' : 'ai_proposed', plausible_max,
});
const est = (factor_label: string, value: number, unit: string, provenance = 'ai_proposed') => ({ factor_label, value, value_kind: 'absolute' as const, unit, provenance });

/** Journey C run 2's shape: MRR declared price × subscribers; the subscribers acted on by no option and limited by nothing. */
function journeyC(subscribers: number | null, withProduct = true) {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 6, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
    constraints: [],
    options: [
      { label: 'Features and price rise', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [est('Pro plan price', 59, 'GBP per month', 'explicit')] },
      { label: 'Additional advertising', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [est('Advertising spend', 10000, 'GBP')] },
      { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      factor('Pro plan price', 49, 200, 'GBP per month', true),
      factor('Advertising spend', 0, 50000, 'GBP'),
      { ...factor('Pro paying subscribers', subscribers, 10000, 'subscribers'), role: 'observable' as const },
    ],
    risks: [], outcomes: [],
    links: [
      link('Pro plan price', 'MRR', 'positive'), link('Advertising spend', 'Pro paying subscribers', 'positive'),
      link('Pro paying subscribers', 'MRR', 'positive'),
    ],
    identities: withProduct
      ? [{ outcome: 'MRR', operation: 'product' as const, factors: ['Pro plan price', 'Pro paying subscribers'], provenance: 'ai_proposed' }]
      : [],
    unknowns: [] as string[], decision_question: null,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Graph = { nodes: Array<Record<string, unknown> & { id: string; label?: string; observed_state?: Record<string, unknown> }> };

async function construct(brief: string, ...drafts: ReturnType<typeof journeyC>[]) {
  for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown;
  const inputs: string[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const result = await buildModelFromBrief('0c0c0c0c-1111-4222-8333-444455556677', brief, dispatch, async (req) => {
    inputs.push(String((req as { input: unknown }).input));
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as Record<string, unknown>;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, inputs, result };
}
const subscribers = (g: Graph) => g.nodes.find((n) => n.label === 'Pro paying subscribers')!;

describe('RED — a part of a declared product with no level is a baseline gap the repair retry fills with Olumi\'s estimate', () => {
  it('⭐ preparation names the subscribers as a baseline gap BECAUSE the product multiplies them', () => {
    const p = prepareProvisionalCandidate(journeyC(null) as unknown as CandidateModel) as { baseline_gaps?: { factor: string; because?: string }[] };
    expect(p.baseline_gaps).toEqual([{ factor: 'Pro paying subscribers', because: 'identity' }]);
  });

  it('⭐ the gap goes to the ONE repair retry, which is told the estimate is never the user\'s and must make a stated product hold', async () => {
    const { inputs } = await construct(BRIEF, journeyC(null), journeyC(1500));
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("Pro paying subscribers: give a baseline_value (a provisional estimate with baseline_known:false, provenance ai_proposed — never the user's) — a product in identities multiplies it");
  });

  it('⭐ the adopted level is Olumi\'s — cee_inference, never user_specified or brief_extraction', async () => {
    const { graph } = await construct(BRIEF, journeyC(null), journeyC(1500));
    expect(subscribers(graph).observed_state, JSON.stringify(subscribers(graph))).toMatchObject({ source: 'cee_inference', raw_value: 1500 });
  });
});

describe('unchanged', () => {
  it('CONTRAST: a part the draft already levels is no gap — no retry', async () => {
    const p = prepareProvisionalCandidate(journeyC(1500) as unknown as CandidateModel) as { baseline_gaps?: unknown[] };
    expect(p.baseline_gaps).toEqual([]);
    const { inputs } = await construct(BRIEF, journeyC(1500));
    expect(inputs).toHaveLength(1);
  });

  it('CONTRAST: with no declared product, an unlevelled quantity nothing acts on is no gap (as before)', () => {
    const p = prepareProvisionalCandidate(journeyC(null, false) as unknown as CandidateModel) as { baseline_gaps?: unknown[] };
    expect(p.baseline_gaps).toEqual([]);
  });

  it('CONTRAST: a part an option acts on keeps its acted-on gap, named once', () => {
    const d = journeyC(null);
    const acted = { ...d, options: d.options.map((o) => (o.label === 'Additional advertising'
      ? { ...o, interventions: [...o.interventions, est('Pro paying subscribers', 1800, 'subscribers')] } : o)) };
    const p = prepareProvisionalCandidate(acted as unknown as CandidateModel) as { baseline_gaps?: { factor: string; because?: string }[] };
    expect(p.baseline_gaps).toEqual([{ factor: 'Pro paying subscribers' }]);
  });
});
