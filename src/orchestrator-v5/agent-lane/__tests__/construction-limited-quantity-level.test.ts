/**
 * ⭐ A QUANTITY THE USER LIMITS GETS A LEVEL — OLUMI'S, LABELLED — SO THE LIMIT CAN BE CHECKED (DL ruling #72 5863840239).
 *
 * Served journey C ("…while keeping monthly churn under 4%", no churn level stated): 3 of the last 17 A/C brief drafts
 * left the limited churn with NO level, so the limit was refused (`CONSTRAINT_TARGET_NO_OBSERVED_VALUE`,
 * `NOT_CONVERTIBLE`) and churn ranked #2 among drivers unvalued (PJ-B3, PJ-A3); the other 14 gave it 3% as Olumi's and A3
 * passed on it. The build prompt even said "Never set a current level … just because the user named a limit on it".
 *
 * Ruling (ii): a LEVEL limit's own quantity with no level is a baseline gap for the ONE repair retry (`findCoverageGaps`,
 * `because: 'limit'`), which gives Olumi's provisional estimate — baseline_known:false, ai_proposed — stamped
 * `cee_inference`, never `user_specified` or `brief_extraction`. A DELTA limit needs no level of its own; a level the
 * brief states stays the user's. (The typed non-blocking ask for the user's own level is the ruling's condition 2.)
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BRIEF = 'We need to reach £100k MRR within 6 months, while keeping monthly churn under 4%. '
  + 'Should we increase our Pro plan price from £49 to £59 per month, or invest in additional advertising?';
const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const factor = (label: string, baseline_value: number | null, plausible_max: number, unit: string, known = false) => ({
  label, role: 'controllable' as const, baseline_known: known, baseline_value, unit, provenance: known ? 'explicit' : 'ai_proposed', plausible_max,
});
const est = (factor_label: string, value: number, unit: string, provenance = 'ai_proposed') => ({ factor_label, value, value_kind: 'absolute' as const, unit, provenance });

/** Journey C's shape: churn is limited (level frame), acted on by no option, and — in the served 3/17 — left with no level. */
function journeyC(churnBaseline: number | null, frame: 'level' | 'delta' = 'level', churnKnown = false) {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 6, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
    constraints: [{ metric: 'Monthly churn rate', operator: '<', value: 4, unit: '%', provenance: 'explicit', frame }],
    options: [
      { label: 'Raise Pro price to £59', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [est('Pro plan price', 59, 'GBP per month', 'explicit')] },
      { label: 'Additional advertising', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [est('Advertising spend', 10000, 'GBP')] },
      { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      factor('Pro plan price', 49, 200, 'GBP per month', true),
      factor('Advertising spend', 0, 50000, 'GBP'),
      { ...factor('Monthly churn rate', churnBaseline, 100, '%', churnKnown), role: 'observable' as const },
      factor('Pro paying subscribers', 1500, 5000, 'subscribers'),
    ],
    risks: [], outcomes: [],
    links: [
      link('Pro plan price', 'MRR', 'positive'), link('Pro plan price', 'Monthly churn rate', 'positive'),
      link('Advertising spend', 'Pro paying subscribers', 'positive'), link('Pro paying subscribers', 'MRR', 'positive'),
      link('Monthly churn rate', 'Pro paying subscribers', 'negative'),
    ],
    identities: [], unknowns: [] as string[], decision_question: null,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Graph = { nodes: Array<Record<string, unknown> & { id: string; kind: string; observed_state?: Record<string, unknown> }> };

async function construct(brief: string, ...drafts: ReturnType<typeof journeyC>[]) {
  for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown;
  const inputs: string[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const result = await buildModelFromBrief('0c0c0c0c-1111-4222-8333-444455556666', brief, dispatch, async (req) => {
    inputs.push(String((req as { input: unknown }).input));
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as Record<string, unknown>;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, inputs };
}
const churn = (g: Graph) => g.nodes.find((n) => n.label === 'Monthly churn rate')!;

describe('a LEVEL limit\'s quantity with no level is a baseline gap the repair retry fills with Olumi\'s estimate', () => {
  it('⭐ RED: preparation names churn as a baseline gap BECAUSE the user limits it', () => {
    const p = prepareProvisionalCandidate(journeyC(null) as unknown as CandidateModel) as { baseline_gaps?: { factor: string; because?: string }[] };
    expect(p.baseline_gaps).toEqual([{ factor: 'Monthly churn rate', because: 'limit' }]);
  });

  it('⭐ RED: the gap goes to the ONE repair retry, which is told the estimate is never the user\'s', async () => {
    const { inputs } = await construct(BRIEF, journeyC(null), journeyC(3));
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("Monthly churn rate: give a baseline_value (a provisional estimate with baseline_known:false, provenance ai_proposed — never the user's) — the user limits it");
  });

  it('⭐ RED: the adopted level is Olumi\'s — cee_inference, never user_specified or brief_extraction', async () => {
    const { graph } = await construct(BRIEF, journeyC(null), journeyC(3));
    const os = churn(graph).observed_state;
    expect(os, JSON.stringify(churn(graph))).toMatchObject({ source: 'cee_inference', raw_value: 3 });
  });

  it('CONTRAST: a DELTA limit needs no level of its own — no gap, no retry', async () => {
    const p = prepareProvisionalCandidate(journeyC(null, 'delta') as unknown as CandidateModel) as { baseline_gaps?: unknown[] };
    expect(p.baseline_gaps).toEqual([]);
  });

  it('CONTRAST: a limited quantity the draft already levels (Olumi\'s 3%) is no gap — the 14/17 served drafts are unchanged', async () => {
    const p = prepareProvisionalCandidate(journeyC(3) as unknown as CandidateModel) as { baseline_gaps?: unknown[] };
    expect(p.baseline_gaps).toEqual([]);
    const { inputs } = await construct(BRIEF, journeyC(3));
    expect(inputs).toHaveLength(1);
  });

  it('CONTRAST: a level the BRIEF states stays the user\'s (brief_extraction), never re-stamped', async () => {
    const stated = BRIEF.replace('while keeping monthly churn under 4%', 'while keeping monthly churn (3% today) under 4%');
    const { graph } = await construct(stated, journeyC(3, 'level', true));
    expect(churn(graph).observed_state).toMatchObject({ source: 'brief_extraction', raw_value: 3 });
  });
});
