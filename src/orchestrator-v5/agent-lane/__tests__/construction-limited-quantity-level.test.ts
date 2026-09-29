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
 * brief states stays the user's.
 *
 * Condition 2: the user is ASKED for today's level — typed (`level_asks`, `limited-level-ask.ts`) and said where they
 * always see it (`open_questions`), non-blocking: the build registers and nothing in readiness changes.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { limitedLevelAsks } from '../limited-level-ask.js';
import { readFileSync } from 'node:fs';
import {
  collectLeaderEstimatedTargetIds, collectLimitLevelOwners, deriveConstraintVerdict, readRatifiedConstraints,
} from '../../../orchestrator/context/constraint-feasibility.js';

const BRIEF = 'We need to reach £100k MRR within 6 months, while keeping monthly churn under 4%. '
  + 'Should we increase our Pro plan price from £49 to £59 per month, or invest in additional advertising?';
const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const factor = (label: string, baseline_value: number | null, plausible_max: number, unit: string, known = false) => ({
  label, role: 'controllable' as const, baseline_known: known, baseline_value, unit, provenance: known ? 'explicit' : 'ai_proposed', plausible_max,
});
const est = (factor_label: string, value: number, unit: string, provenance = 'ai_proposed') => ({ factor_label, value, value_kind: 'absolute' as const, unit, provenance });

/** Journey C's shape: churn is limited (level frame), acted on by no option, and — in the served 3/17 — left with no level. */
function journeyC(churnBaseline: number | null, frame: 'level' | 'change_abs' = 'level', churnKnown = false) {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, frame: 'level', value: 100000, unit: 'GBP', horizon_months: 6, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
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
  return { graph: GraphV3.parse(graph) as unknown as Graph, inputs, result };
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
    const p = prepareProvisionalCandidate(journeyC(null, 'change_abs') as unknown as CandidateModel) as { baseline_gaps?: unknown[] };
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

type Ask = { kind: string; node_id: string; quantity: string; constraint_ids: string[]; estimate: { value: number; unit: string } | null; question: string };
const asksOf = (r: Record<string, unknown>) => (r.level_asks ?? []) as Ask[];
const questionsOf = (r: Record<string, unknown>) => (r.open_questions ?? []) as string[];

describe('condition 2 — the user is asked, typed and non-blocking, for today\'s level of the quantity they limit', () => {
  it('⭐ RED: Olumi\'s estimate → ONE typed ask on the churn node, naming the limit and the estimate it can only be checked against', async () => {
    const { graph, result } = await construct(BRIEF, journeyC(null), journeyC(3));
    const churnId = churn(graph).id;
    const limitIds = ((graph as unknown as { goal_constraints?: { constraint_id: string; node_id: string }[] }).goal_constraints ?? [])
      .filter((c) => c.node_id === churnId).map((c) => c.constraint_id);
    expect(limitIds).toHaveLength(1);
    expect(asksOf(result)).toEqual([{
      kind: 'limited_quantity_level', node_id: churnId, quantity: 'Monthly churn rate', constraint_ids: limitIds,
      estimate: { value: 3, unit: '%' },
      question: 'What is "Monthly churn rate" today? Your limit (less than 4%) can only be checked against Olumi\'s estimate of 3%, not a figure you gave, until you give yours.',
    }]);
  });

  it('⭐ RED: the ask is said where the user always sees it — in the first two open questions, the two the reply shows', async () => {
    // The drafter parks two questions of its own: the ask still goes ahead of them, behind only the deadline.
    const parked = { ...journeyC(3), unknowns: ['Will competitors match a £59 Pro price?', 'How price-sensitive are Pro customers?'] };
    const { result } = await construct(BRIEF, journeyC(null), parked);
    expect(questionsOf(result).length).toBeGreaterThanOrEqual(4);
    expect(questionsOf(result).slice(0, 2)).toContain(asksOf(result)[0]!.question);
  });

  it('⭐ RED: the retry leaves churn with NO level → still asked, saying the limit cannot be checked (never silent)', async () => {
    const { result } = await construct(BRIEF, journeyC(null), journeyC(null));
    expect(asksOf(result).map((a) => [a.quantity, a.estimate])).toEqual([['Monthly churn rate', null]]);
    expect(questionsOf(result)).toContain('What is "Monthly churn rate" today? Your limit (less than 4%) cannot be checked until the model has its current level.');
  });

  it('NON-BLOCKING: the build still registers the model with the churn limit on it', async () => {
    const { graph, result } = await construct(BRIEF, journeyC(null), journeyC(3));
    expect(result).toMatchObject({ ok: true, mutated: true, goal_constraints_carried: 1 });
    expect((graph as unknown as { goal_constraints?: { node_id: string }[] }).goal_constraints?.map((c) => c.node_id)).toEqual([churn(graph).id]);
  });

  it('CONTRAST: a level the BRIEF states is the user\'s — no ask', async () => {
    const stated = BRIEF.replace('while keeping monthly churn under 4%', 'while keeping monthly churn (3% today) under 4%');
    const { result } = await construct(stated, journeyC(3, 'level', true));
    expect(asksOf(result)).toEqual([]);
    expect(questionsOf(result).join(' ')).not.toContain('today? Your limit');
  });

  it('CONTRAST: a DELTA limit needs no level of its own — no ask', async () => {
    const { result } = await construct(BRIEF, journeyC(null, 'change_abs'));
    expect(asksOf(result)).toEqual([]);
  });

  it('CONTRAST: a limit on a factor an option SETS gets no TODAY-level ask — the option-set ask names Olumi\'s figure instead (DL 5865003207)', async () => {
    const d = journeyC(3);
    const capped = { ...d, constraints: [...d.constraints, { metric: 'Advertising spend', operator: '<=', value: 20000, unit: 'GBP', provenance: 'explicit', frame: 'level' as const }] };
    const { result } = await construct(BRIEF.replace('?', ', with no more than £20,000 on advertising?'), capped as unknown as ReturnType<typeof journeyC>);
    expect(asksOf(result).filter((a) => a.kind === 'limited_quantity_level').map((a) => a.quantity)).toEqual(['Monthly churn rate']);
    // "Additional advertising" sets it at Olumi's £10,000 (`ai_proposed`): the one ask on that limit names it, and is said.
    const set = asksOf(result).filter((a) => a.kind === 'option_set_limit_level');
    expect(set.map((a) => a.quantity)).toEqual(['Advertising spend']);
    expect(set[0]!.question).toContain('£10,000 under "Additional advertising"');
    expect(questionsOf(result)).toContain(set[0]!.question);
  });
});

describe('condition 1 — the limit verdict on Olumi\'s level is estimate_only, never scored (the verdict\'s own producer)', () => {
  /**
   * The served 17d1 PLoT envelope (`tests/fixtures/cross-service/b5-per-limit/`, churn ≤ 4 % computed, P = 1, decision
   * grade) — DERIVED here: its limit id is re-keyed to the id this construction registers, nothing else changes. The
   * verdict is derived exactly as `run_analysis` derives it (`constraint-verdict-per-limit.test.ts` `verdictFor`).
   */
  const ENV = JSON.parse(readFileSync('tests/fixtures/cross-service/b5-per-limit/17d1cd3a.plot-response.json', 'utf8')) as Record<string, unknown>;
  const verdictOn = (graph: Graph) => {
    const g = graph as unknown as Record<string, unknown>;
    const ratified = readRatifiedConstraints(g);
    expect(ratified).toHaveLength(1);
    const id = ratified[0]!.constraint_id;
    const env = JSON.parse(JSON.stringify(ENV).split('agent-lane:monthly_churn:<=').join(id)) as Record<string, unknown>;
    const leader = (env.option_comparison as { option_id: string; win_probability: number }[])
      .slice().sort((a, b) => b.win_probability - a.win_probability)[0]!.option_id;
    return { id, v: deriveConstraintVerdict(env, ratified, leader, undefined, collectLeaderEstimatedTargetIds(g, ratified, leader), collectLimitLevelOwners(g, ratified)) };
  };

  it('⭐ the retry\'s level (Olumi\'s 3%) → per_limit estimate_only / level_olumi_estimate', async () => {
    const { graph } = await construct(BRIEF, journeyC(null), journeyC(3));
    const { id, v } = verdictOn(graph);
    expect(v.perLimit).toEqual([{ constraint_id: id, state: 'estimate_only', reason: 'level_olumi_estimate' }]);
  });

  it('CONTRAST: the same limit on a level the BRIEF states is scored — the user\'s figure', async () => {
    const stated = BRIEF.replace('while keeping monthly churn under 4%', 'while keeping monthly churn (3% today) under 4%');
    const { graph } = await construct(stated, journeyC(3, 'level', true));
    const { id, v } = verdictOn(graph);
    expect(v.perLimit).toEqual([{ constraint_id: id, state: 'scored' }]);
  });
});

describe('the ask says a money figure the way the user writes it (DL copy nit on #2205, 5864058391)', () => {
  const graph = (unit: string, limitUnit: string) => ({
    nodes: [{ id: 'spend', kind: 'factor', label: 'Total spend', observed_state: { value: 0.3, raw_value: 30000, unit, source: 'cee_inference' } }],
    goal_constraints: [{ constraint_id: 'c:spend:<=', node_id: 'spend', operator: '<=', value: 20000, unit: limitUnit, value_frame: 'level' as const }],
  });
  it.each([
    ['GBP', 'GBP', 'at most £20,000', '£30,000'],
    ['£', '£', 'at most £20,000', '£30,000'],
    ['GBP per month', 'GBP per month', 'at most £20,000 per month', '£30,000 per month'],
    ['USD', 'USD', 'at most $20,000', '$30,000'],
    // Served journey E (pj-20260928T051530Z): "GBP/year" — the code, then the period; said with the spaced " / " (DL 5871074397).
    ['GBP/year', 'GBP/year', 'at most £20,000 / year', '£30,000 / year'],
    ['%', '%', 'at most 20,000%', '30,000%'],
    ['subscribers', 'subscribers', 'at most 20,000 subscribers', '30,000 subscribers'],
  ])('unit %s', (unit, limitUnit, limit, level) => {
    const [ask] = limitedLevelAsks(graph(unit, limitUnit));
    expect(ask!.question).toBe(`What is "Total spend" today? Your limit (${limit}) can only be checked against Olumi's estimate of ${level}, not a figure you gave, until you give yours.`);
  });
});
