/**
 * ⭐ A LIMITED QUANTITY DRAFTED AS AN OUTCOME STILL LEAVES CONSTRUCTION WITH A LEVEL — OLUMI'S, LABELLED.
 *
 * SERVED (DL joined run 2, 28 Sep 2026; CEE c35f1c7 · PLoT aac1970 · ISL 9b8aa34), journey C's brief first pass
 * ("…while keeping monthly churn under 4%", no churn level stated): PJ-B3 FAIL "unvalued factors: monthly_churn ·
 * factor_sensitivity monthly_churn rank 2" and PJ-A3 FAIL "churn limit … constraint_probabilities in 0 option(s) ·
 * CONSTRAINT_TARGET_UNRELIABLE, CONSTRAINT_NOT_CONVERTIBLE". Runs 1 and 3 of the same brief passed: their drafter made
 * "Monthly churn" a FACTOR with Olumi's 3%. Run 2's registered `monthly_churn` was a level-less observable factor, the
 * construction trace says `retried: false`, and the reply asked "What is "Monthly churn" today? … cannot be checked".
 *
 * ROOT CAUSE: the drafter declared "Monthly churn" an OUTCOME. Admission registers an outcome a user-stated percentage
 * LEVEL limit names as an observable factor with a frame and NO value (`admit-model.ts`, "A LIMIT THE USER STATED ON A
 * LEVEL NAMES A QUANTITY THAT CAN HOLD ONE"), but `findCoverageGaps` read only `model.factors`, so #2205's limit gap
 * (`because: 'limit'`) never counted it, the ONE repair retry never ran, and the Run scored churn with no level.
 * Second seam, on the same path: the limit gap's own words ask for "provenance ai_proposed", and a retry obeying them
 * re-authored the quantity the user named as Olumi's, so `keepsEveryUserStatedIdentity` refused it.
 *
 * The served first pass is REBUILT by node id (`fixtures/served-journey-c-churn-outcome-c35f1c7.json`: the raw drafter
 * output is not in the capture); FIDELITY proves its admission is the served node, limit row and ask, byte for byte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate, type ConstructionTrace } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import {
  collectLeaderEstimatedTargetIds, collectLimitLevelOwners, deriveConstraintVerdict, readRatifiedConstraints,
} from '../../../orchestrator/context/constraint-feasibility.js';

type Node = Record<string, unknown> & { id: string; kind: string; label: string; provenance?: string; observed_state?: Record<string, unknown> };
type Graph = { nodes: Node[]; goal_constraints?: Array<Record<string, unknown> & { constraint_id: string; node_id: string }> };
type Draft = Record<string, unknown> & {
  constraints: Array<Record<string, unknown>>;
  factors: Array<Record<string, unknown> & { label: string }>;
  outcomes: Array<{ label: string; provenance: string }>;
};
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-churn-outcome-c35f1c7.json', import.meta.url), 'utf8')) as {
  brief: string;
  served: { draft_graph: Graph; construction_trace: unknown; level_ask_question: string };
  served_contrast: { run1: { monthly_churn_node: Node; construction_trace: unknown } };
  candidate_first_pass: Draft;
};
const BRIEF = FX.brief;
const CHURN = 'Monthly churn';
const served = (id: string): Node => FX.served.draft_graph.nodes.find((n) => n.id === id)!;
const servedLimit = (nodeId: string) => FX.served.draft_graph.goal_constraints!.find((c) => c.node_id === nodeId)!;

/** Run 2's first pass: "Monthly churn" an OUTCOME the user's "< 4 percent" LEVEL limit names. */
const firstPass = (): Draft => structuredClone(FX.candidate_first_pass);
/** The same draft with "Monthly churn" a FACTOR (the retry's shape, and runs 1/3's first pass). */
function churnAsFactor(provenance: string, baseline_value: number | null, over: Record<string, unknown> = {}, unit = 'percent'): Draft {
  const d = firstPass();
  d.outcomes = d.outcomes.filter((o) => o.label !== CHURN);
  d.factors.push({ label: CHURN, role: 'observable', baseline_known: false, baseline_value, unit, provenance, plausible_max: 100, ...over });
  return d;
}
const withChurnLimit = (d: Draft, patch: Record<string, unknown>): Draft =>
  ({ ...d, constraints: d.constraints.map((c) => (c.metric === CHURN ? { ...c, ...patch } : c)) });

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

const construct = (...drafts: Draft[]) => constructOn(BRIEF, ...drafts);
async function constructOn(brief: string, ...drafts: Draft[]) {
  for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown;
  let trace: ConstructionTrace | undefined;
  const inputs: string[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const result = await buildModelFromBrief('7c7c7c7c-2222-4333-8444-555566667777', brief, dispatch, async (req) => {
    inputs.push(String((req as { input: unknown }).input));
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }, (t) => { trace = t; }) as Record<string, unknown>;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, inputs, result, trace };
}
const node = (g: Graph, id: string): Node | undefined => g.nodes.find((n) => n.id === id);
type Ask = { kind: string; node_id: string; quantity: string; estimate: { value: number; unit: string } | null; question: string };
const asks = (r: Record<string, unknown>) => ((r.level_asks ?? []) as Ask[]).filter((a) => a.kind === 'limited_quantity_level');
const gapsOf = (d: Draft) => prepareProvisionalCandidate(d as unknown as CandidateModel).baseline_gaps;

describe('FIDELITY — the rebuilt first pass is the served run-2 first pass', () => {
  it('served: churn registered level-less, no retry ran, and the user was told the limit cannot be checked', () => {
    expect(served('monthly_churn')).toStrictEqual({
      id: 'monthly_churn', kind: 'factor', label: CHURN, category: 'observable', provenance: 'from_brief', scale_frame: 100,
    });
    expect(FX.served.construction_trace).toStrictEqual({ retried: false });
  });

  it('its admission is the served churn node, the served churn limit row and the served ask, byte for byte', async () => {
    // A drafter that repeats its first draft: whatever the retry is asked, the first pass is what registers.
    const { graph, result } = await construct(firstPass());
    expect(node(graph, 'monthly_churn')).toStrictEqual(served('monthly_churn'));
    expect(graph.goal_constraints!.find((c) => c.node_id === 'monthly_churn')).toStrictEqual(servedLimit('monthly_churn'));
    expect(asks(result).map((a) => a.question)).toEqual([FX.served.level_ask_question]);
  });
});

describe('a limit on a quantity drafted as an OUTCOME is a limit gap for the ONE repair retry', () => {
  it('⭐ RED: preparation names "Monthly churn" as a limit gap, drafted as an outcome — and nothing else', () => {
    expect(gapsOf(firstPass())).toEqual([{ factor: CHURN, because: 'limit', outcome: true }]);
  });

  it('⭐ RED: the retry runs and is told to make it a factor with Olumi\'s level', async () => {
    const { inputs, trace } = await construct(firstPass(), churnAsFactor('ai_proposed', 3));
    expect(inputs).toHaveLength(2);
    expect(trace).toMatchObject({ retried: true, reasons: { coverage: 1 }, outcome: 'adopted' });
    expect(inputs[1]).toContain(`${CHURN}: declare it in factors, not outcomes (role observable, with its plausible_max), and give it a baseline_value (a provisional estimate with baseline_known:false, provenance ai_proposed — never the user's) — the user limits its level`);
  });

  it('⭐ RED: the retry that does as asked is ADOPTED — churn registers with Olumi\'s 3%, cee_inference, still the user\'s named quantity', async () => {
    const { graph, result } = await construct(firstPass(), churnAsFactor('ai_proposed', 3));
    const churn = node(graph, 'monthly_churn')!;
    expect(churn.observed_state).toStrictEqual({ value: 0.03, raw_value: 3, unit: 'percent', source: 'cee_inference', extractionType: 'inferred' });
    expect(churn.provenance).toBe('from_brief');
    expect(graph.goal_constraints!.find((c) => c.node_id === 'monthly_churn')).toMatchObject({ constraint_id: 'agent-lane:monthly_churn:<=', value: 4, unit: '%', value_frame: 'level' });
    expect(asks(result).map((a) => [a.node_id, a.estimate])).toEqual([['monthly_churn', { value: 3, unit: 'percent' }]]);
  });

  it('⭐ RED: a retry that keeps the quantity the user\'s (explicit) with Olumi\'s level is adopted the same way', async () => {
    const { graph, trace } = await construct(firstPass(), churnAsFactor('explicit', 3));
    expect(trace).toMatchObject({ outcome: 'adopted' });
    expect(node(graph, 'monthly_churn')!.observed_state).toMatchObject({ source: 'cee_inference', raw_value: 3 });
  });

  it('INVARIANT (holds at base too): the churn limit on the adopted level is Olumi\'s — estimate_only / level_olumi_estimate, never scored as the user\'s', async () => {
    const { graph } = await construct(firstPass(), churnAsFactor('ai_proposed', 3));
    const env = JSON.parse(readFileSync('tests/fixtures/cross-service/b5-per-limit/17d1cd3a.plot-response.json', 'utf8')) as Record<string, unknown>;
    const g = graph as unknown as Record<string, unknown>;
    const ratified = readRatifiedConstraints(g);
    const leader = (env.option_comparison as { option_id: string; win_probability: number }[])
      .slice().sort((a, b) => b.win_probability - a.win_probability)[0]!.option_id;
    const v = deriveConstraintVerdict(env, ratified, leader, undefined, collectLeaderEstimatedTargetIds(g, ratified, leader), collectLimitLevelOwners(g, ratified));
    expect((v.perLimit ?? []).find((p) => p.constraint_id === 'agent-lane:monthly_churn:<=')).toEqual({ constraint_id: 'agent-lane:monthly_churn:<=', state: 'estimate_only', reason: 'level_olumi_estimate' });
  });

  it('⭐ RED (#2205 shape, user-named factor): an explicit level-less churn FACTOR whose retry gives Olumi\'s 3% as asked is adopted', async () => {
    const { graph, trace } = await construct(churnAsFactor('explicit', null), churnAsFactor('ai_proposed', 3));
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(node(graph, 'monthly_churn')!).toMatchObject({ provenance: 'from_brief', observed_state: { source: 'cee_inference', raw_value: 3 } });
  });

  it('a retry that CLAIMS today\'s level as Olumi\'s (baseline_known:true, the limit\'s own 4%) never registers it as the user\'s', async () => {
    // "4%" is in the brief, so a user-authored known 4 would survive `withdrawUnstatedBaselineStamps` as brief_extraction:
    // the quantity keeps the user's authorship only while its level stays an estimate.
    const { graph } = await construct(firstPass(), churnAsFactor('ai_proposed', 4, { baseline_known: true }, '%'));
    const source = node(graph, 'monthly_churn')!.observed_state?.source;
    expect(source).not.toBe('brief_extraction');
    expect(source).not.toBe('user_specified');
  });

  it('a retry that leaves churn an outcome is not adopted — the first pass registers, and the user is still asked', async () => {
    const { graph, result, trace } = await construct(firstPass(), firstPass());
    expect(trace).toMatchObject({ retried: true, outcome: 'kept_first' });
    expect(node(graph, 'monthly_churn')).toStrictEqual(served('monthly_churn'));
    expect(asks(result).map((a) => [a.quantity, a.estimate])).toEqual([[CHURN, null]]);
  });
});

describe('CONTRASTS — shapes that must not change', () => {
  it('runs 1/3 (churn a FACTOR with Olumi\'s 3%): no gap, no retry, the served passing node', async () => {
    const d = churnAsFactor('ai_proposed', 3, {}, '%');
    expect(gapsOf(d)).toEqual([]);
    const { graph, inputs } = await construct(d);
    expect(inputs).toHaveLength(1);
    expect(node(graph, 'monthly_churn')).toStrictEqual(FX.served_contrast.run1.monthly_churn_node);
  });

  it('the served draft\'s money limit on its OUTCOME "Total decision budget" is no gap (the rule is the percent level)', () => {
    expect(gapsOf(firstPass()).map((g) => g.factor)).not.toContain('Total decision budget');
    const noChurnLimit = { ...firstPass(), constraints: firstPass().constraints.filter((c) => c.metric !== CHURN) };
    expect(gapsOf(noChurnLimit)).toEqual([]);
  });

  it('a DELTA limit on the churn outcome needs no level of its own — no gap', () => {
    expect(gapsOf(withChurnLimit(firstPass(), { frame: 'delta', unit: '%', value: 2 }))).toEqual([]);
  });

  it('a limit Olumi proposed (not the user\'s) leaves the outcome an outcome — no gap', () => {
    for (const provenance of ['ai_proposed', 'inferred']) {
      expect(gapsOf(withChurnLimit(firstPass(), { provenance })), provenance).toEqual([]);
    }
  });

  it('a limited quantity Olumi drafted (ai_proposed) stays Olumi\'s when the retry levels it', async () => {
    const { graph, trace } = await construct(churnAsFactor('ai_proposed', null), churnAsFactor('ai_proposed', 3));
    expect(trace).toMatchObject({ outcome: 'adopted' });
    expect(node(graph, 'monthly_churn')!.provenance).toBe('ai_inferred');
  });

  it('an acted-on baseline gap (not a limit) keeps its old adoption rule: a retry re-authoring the user\'s factor is refused', async () => {
    const levelless = (provenance: string, baseline_value: number | null): Draft => {
      const d = churnAsFactor('ai_proposed', 3, {}, '%');
      d.factors = d.factors.map((f) => (f.label === 'Additional advertising spend' ? { ...f, provenance, baseline_known: false, baseline_value } : f));
      return d;
    };
    expect(gapsOf(levelless('explicit', null))).toEqual([{ factor: 'Additional advertising spend' }]);
    const { trace } = await construct(levelless('explicit', null), levelless('ai_proposed', 0));
    expect(trace).toMatchObject({ retried: true, outcome: 'kept_first' });
  });
});

/**
 * VERIFIER FIX_FIRST on f773a217 (T1). (1) HIGH: the limit's OWN figure ("under 4%") returned by the retry as today's
 * level, explicit and known, passed admission's user-figure check (4 IS in the brief — as the limit) and registered as
 * the user's today-level. (2) MEDIUM: a today-level the brief DOES state could only be adopted as Olumi's ("not a figure
 * you gave" — false). (3) LOW: a quantity drafted as factor AND outcome got two gaps and two retry lines. (4) LOW:
 * admission names a limit's quantity case-insensitively (`nodeIdForMetric`), the outcome gap matched exactly.
 */
const BRIEF_STATED = BRIEF.replace(', while keeping monthly churn under 4%.', '. Monthly churn is 3% today, and we must keep it under 4%.');
/** The retry's construction issues, one line per gap, as it was told them. */
const retryLines = (input: string): string[] => JSON.parse(/Construction issues: (\[.*?\])\nCandidate to repair/.exec(input)![1]!) as string[];
const churnLines = (input: string): string[] => retryLines(input).filter((l) => l.startsWith(`${CHURN}:`));

describe('(1) the limit\'s own figure is never the user\'s level; (2) a level the brief states is', () => {
  it('the contrast brief states churn today AND keeps the limit', () => {
    expect(BRIEF_STATED).toContain('Monthly churn is 3% today, and we must keep it under 4%.');
    expect(BRIEF_STATED).not.toBe(BRIEF);
  });

  it('⭐ RED (1): a retry giving the limit\'s own 4 as today\'s level (explicit, known, "%") is not the user\'s — Olumi\'s estimate, and the user is still asked', async () => {
    const { graph, result, trace } = await construct(firstPass(), churnAsFactor('explicit', 4, { baseline_known: true }, '%'));
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    const churn = node(graph, 'monthly_churn')!;
    expect(churn.provenance).toBe('from_brief');
    expect(churn.observed_state).toMatchObject({ raw_value: 4, source: 'cee_inference', extractionType: 'inferred' });
    expect(asks(result).map((a) => [a.node_id, a.estimate])).toEqual([['monthly_churn', { value: 4, unit: '%' }]]);
  });

  it('⭐ RED (1, verifier FIX_FIRST): the limit\'s 4% given back as a SHARE (0.04, known, explicit) on a 0–100 percent frame is not the user\'s either', async () => {
    for (const unit of ['%', '% per month', 'percent per month', '% of subscribers per month']) {
      const { graph, result } = await construct(firstPass(), churnAsFactor('explicit', 0.04, { baseline_known: true, plausible_max: 100 }, unit));
      const os = node(graph, 'monthly_churn')!.observed_state;
      expect(os?.source, unit).not.toBe('brief_extraction');
      expect(os, unit).toMatchObject({ source: 'cee_inference', extractionType: 'inferred' });
      expect(asks(result).map((a) => a.node_id), unit).toEqual(['monthly_churn']);
    }
  });

  it('INVARIANT (measured on 7 units at f773a217, where the gap exists): the limit figure as a proportion (0.04 on a 0–1 frame) is never adopted as the user\'s', async () => {
    for (const unit of ['proportion', 'share', 'rate', 'fraction', 'ratio', '%', 'decimal']) {
      const { graph, trace } = await construct(firstPass(), churnAsFactor('explicit', 0.04, { baseline_known: true, plausible_max: 1 }, unit));
      expect(trace, unit).toMatchObject({ outcome: 'kept_first' });
      expect(node(graph, 'monthly_churn')!.observed_state?.source, unit).not.toBe('brief_extraction');
    }
  });

  it('CONTRAST (1): the brief states today\'s level ("3% today … under 4%") — the retry\'s 3 registers as the user\'s (brief_extraction), and no ask calls it Olumi\'s', async () => {
    const { graph, result, trace } = await constructOn(BRIEF_STATED, firstPass(), churnAsFactor('explicit', 3, { baseline_known: true }, '%'));
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(node(graph, 'monthly_churn')!.observed_state).toMatchObject({ raw_value: 3, source: 'brief_extraction' });
    expect(asks(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('not a figure you gave');
  });

  it('CONTRAST (1): on that same brief, the limit\'s 4 given as today\'s level is still not the user\'s', async () => {
    const { graph } = await constructOn(BRIEF_STATED, firstPass(), churnAsFactor('explicit', 4, { baseline_known: true }, '%'));
    expect(node(graph, 'monthly_churn')!.observed_state).toMatchObject({ raw_value: 4, source: 'cee_inference' });
  });

  it('⭐ RED (2): the outcome gap tells the retry that a today-level the BRIEF states is given as the user\'s — never the limit\'s figure', async () => {
    const { inputs } = await constructOn(BRIEF_STATED, firstPass(), churnAsFactor('explicit', 3, { baseline_known: true }, '%'));
    const [line] = churnLines(inputs[1]!);
    expect(line).toContain(`If the brief itself states today's level of ${CHURN} (never the limit's own figure), give that figure instead, with baseline_known:true, provenance explicit`);
  });
});

describe('(3) one gap per quantity; (4) the quantity a limit names is read as admission reads it', () => {
  const alsoAnOutcome = (d: Draft): Draft => ({ ...d, outcomes: firstPass().outcomes });

  it('⭐ RED (3): churn drafted as BOTH a level-less factor and an outcome is ONE gap, and ONE retry line', async () => {
    const d = alsoAnOutcome(churnAsFactor('explicit', null));
    expect(gapsOf(d)).toEqual([{ factor: CHURN, because: 'limit' }]);
    const { inputs } = await construct(d, churnAsFactor('ai_proposed', 3));
    expect(churnLines(inputs[1]!)).toHaveLength(1);
  });

  it('⭐ RED (3): a churn FACTOR with a level beside the same outcome is no gap — admission registers the factor, level and all', async () => {
    const d = alsoAnOutcome(churnAsFactor('ai_proposed', 3, {}, '%'));
    expect(gapsOf(d)).toEqual([]);
    const { graph, inputs } = await construct(d);
    expect(inputs).toHaveLength(1);
    expect(node(graph, 'monthly_churn')!.observed_state).toMatchObject({ raw_value: 3, source: 'cee_inference' });
  });

  it('(3 × 4): one outcome written twice ("Monthly churn", "monthly churn": one identity, one node) is ONE gap', () => {
    const d = firstPass();
    d.outcomes = [...d.outcomes, { label: 'monthly churn', provenance: 'explicit' }];
    expect(gapsOf(d)).toEqual([{ factor: CHURN, because: 'limit', outcome: true }]);
  });

  it('⭐ RED (4): a limit on "Monthly Churn" names the outcome "Monthly churn" (admission re-kinds it) — a gap', async () => {
    const d = withChurnLimit(firstPass(), { metric: 'Monthly Churn' });
    expect(gapsOf(d)).toEqual([{ factor: CHURN, because: 'limit', outcome: true }]);
    const { graph } = await construct(d);
    expect(node(graph, 'monthly_churn')!.kind).toBe('factor');
  });

  it('⭐ RED (4, verifier LOW): a limit on "Monthly Churn" names a level-less FACTOR "Monthly churn" too — a gap, as admission attaches it', () => {
    const d = withChurnLimit(churnAsFactor('explicit', null), { metric: 'Monthly Churn' });
    expect(gapsOf(d)).toEqual([{ factor: CHURN, because: 'limit' }]);
  });

  it('⭐ RED (4, verifier P6): a level-less factor "monthly churn" + the outcome "Monthly churn" + a limit on "Monthly churn" — one gap', () => {
    const d = firstPass();
    d.factors.push({ label: 'monthly churn', role: 'observable', baseline_known: false, baseline_value: null, unit: 'percent', provenance: 'explicit', plausible_max: 100 });
    expect(gapsOf(d)).toEqual([{ factor: 'monthly churn', because: 'limit' }]);
  });

  it('CONTRAST (4): a metric admission does NOT resolve ("Monthly  churn", two spaces) re-kinds nothing and is no gap', async () => {
    const d = withChurnLimit(firstPass(), { metric: 'Monthly  churn' });
    expect(gapsOf(d)).toEqual([]);
    const { graph } = await construct(d);
    expect(node(graph, 'monthly_churn')!.kind).toBe('outcome');
  });
});
