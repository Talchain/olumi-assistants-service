import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import {
  GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_OPTIONS_IDENTICAL, readOptionResultSources, runWithheldGoalFigures,
} from '../../../../orchestrator/context/option-result-source.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { buildIdenticalArmsDisclosure, IDENTICAL_ARMS_DISCLOSURE_MAX_CHARS, IDENTICAL_ARMS_DISCLOSURE_RE_SRC } from '../../../coaching/scaffold-disclosure.js';
import { goalChanceWithheldForAgent, GOAL_CHANCE_WITHHELD_NOTE, OPTIONS_IDENTICAL_NOTE, PLACEHOLDER_PATH_NOTE } from '../../../agent-lane/goal-chance-withheld.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH as PLACEHOLDER, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../../../../orchestrator/context/option-result-source.js';
import { TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS } from '../../../coaching/analysis-result-headline.js';
import { detectIdenticalArms } from '../identical-arms.js';
import { createRunAnalysisHandler } from '../run-analysis.js';

/**
 * DL GATE 1 v2 (5 Oct 2026): two arms the Run could not tell apart split each other's wins, so the comparison is withheld
 * and said; every arm's outcome distribution stays. Identity is read off the Run's own result.
 */
type Rec = Record<string, unknown>;
// Same loader as the other run-analysis specs (the ratchet's tsconfig has no JSON import attributes).
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
const opt = (id: string, label: string, interventions: Rec, is_baseline = false): Rec =>
  ({ id, option_id: id, label, is_baseline, interventions });
const OPTIONS = [
  opt('carry_on', 'Carry On', { fac_capacity: 0.5 }, true),
  opt('hire_two', 'Hire Two', { fac_capacity: 0.5 }),
  opt('tech_lead', 'Tech Lead', { fac_capacity: 0.8 }),
];
const SAME = { outcome: { p10: 10, p50: 20, p90: 30, mean: 20, std: 5, n_valid_samples: 1000 },
  downside: { p05: 8, cvar_10: 6, expected_regret: 2 } };
const OTHER = { outcome: { p10: 15, p50: 40, p90: 60, mean: 40, std: 9, n_valid_samples: 1000 },
  downside: { p05: 12, cvar_10: 10, expected_regret: 1 } };
const BASELINE_LINE = " Hire Two came out identical to Carry On: in this model it doesn't change the outcome. The comparison is held back until it differs: edit its value, or remove it.";
const PAIR_LINE = " Hire Two and Hire Three came out identical: in this model they lead to the same outcome. The comparison is held back until they differ: edit one of their values, or remove one.";

/** A PLoT-shaped body (golden envelope) whose rows carry `stats` per option id, shares as given. */
function body(rows: Array<[string, string, Rec, number]>): Rec {
  const entries = rows.map(([id, label, stats, share]) => ({
    option_id: id, option_label: label, status: 'computed', win_probability: share,
    probability_of_goal: 0.5, ...structuredClone(stats),
  }));
  const lead = [...entries].sort((a, b) => b.win_probability - a.win_probability)[0]!;
  return {
    ...structuredClone(happy), option_comparison: structuredClone(entries), results: structuredClone(entries),
    decision_brief: { options: entries.map((e, i) => ({ ...structuredClone(e), rank: i + 1 })),
      headline_banded: { option_id: lead.option_id, text: `${lead.option_label} currently leads.` } },
    robustness: { level: 'moderate', recommended_option_id: lead.option_id, fragile_edges: [], robust_edges: [] },
    flip_thresholds: [{ alternative_winner_id: lead.option_id }],
  };
}
const threeArm = (hireTwo: Rec = SAME): Rec => body([
  ['carry_on', 'Carry On', SAME, 0.3], ['hire_two', 'Hire Two', hireTwo, 0.3], ['tech_lead', 'Tech Lead', OTHER, 0.4]]);
/** Nudge ONE outcome statistic. The shared rule (`identical-arms-core.ts`) compares the outcome distribution and the
 *  draw count; `downside` is not compared (the same draws give the same downside). */
const nudged = (field: 'mean' | 'p90', rel: number): Rec => {
  const s = structuredClone(SAME) as { outcome: Rec; downside: Rec };
  s.outcome[field] = (s.outcome[field] as number) * (1 + rel);
  return s;
};

describe('gate 1 v2 — identical arms are detected on the Run\'s own result', () => {
  it('(a) set-to-today arm: one group with its baseline, bound by id; exact baseline sentence', () => {
    const groups = detectIdenticalArms(threeArm(), OPTIONS);
    expect(groups).toEqual([{ option_ids: ['carry_on', 'hire_two'], labels: ['Carry On', 'Hire Two'], baseline_option_id: 'carry_on' }]);
    expect(buildIdenticalArmsDisclosure(groups)).toBe(BASELINE_LINE);
  });

  it('(b) no-path arm (identical for that reason): the same group; the sentence never claims a cause', () => {
    const noPath = [OPTIONS[0]!, opt('hire_two', 'Hire Two', { fac_unlinked: 0.9 }), OPTIONS[2]!];
    const groups = detectIdenticalArms(threeArm(), noPath);
    expect(groups.map((g) => g.option_ids)).toEqual([['carry_on', 'hire_two']]);
    expect(buildIdenticalArmsDisclosure(groups)).not.toMatch(/today's level|no path/);
  });

  it('DL condition 1: ANY pair, no baseline involved — Hire Two = Hire Three, both ≠ Carry On', () => {
    const options = [OPTIONS[0]!, opt('hire_two', 'Hire Two', { fac_capacity: 0.7 }), opt('hire_three', 'Hire Three', { fac_capacity: 0.7 })];
    const b = body([['carry_on', 'Carry On', OTHER, 0.2], ['hire_two', 'Hire Two', SAME, 0.4], ['hire_three', 'Hire Three', SAME, 0.4]]);
    const groups = detectIdenticalArms(b, options);
    expect(groups).toEqual([{ option_ids: ['hire_two', 'hire_three'], labels: ['Hire Two', 'Hire Three'], baseline_option_id: null }]);
    expect(buildIdenticalArmsDisclosure(groups)).toBe(PAIR_LINE);
    // With no baseline flag anywhere the pair is still found.
    expect(detectIdenticalArms(b, options.map((o) => ({ ...o, is_baseline: false })))).toHaveLength(1);
  });

  it.each([1e-6, 1e-9, 1e-11])('(c) DL contrast: arms that differ by relative %s on ONE statistic are not identical', (rel) => {
    expect(detectIdenticalArms(threeArm(nudged('mean', rel)), OPTIONS)).toEqual([]);
    expect(detectIdenticalArms(threeArm(nudged('p90', rel)), OPTIONS)).toEqual([]);
  });

  it('within tolerance (relative 1e-13) is identical', () => {
    expect(detectIdenticalArms(threeArm(nudged('mean', 1e-13)), OPTIONS)).toHaveLength(1);
  });

  it('(d) nothing identical → nothing detected; three identical arms form ONE group', () => {
    expect(detectIdenticalArms(threeArm(OTHER), OPTIONS)).toEqual([
      { option_ids: ['hire_two', 'tech_lead'], labels: ['Hire Two', 'Tech Lead'], baseline_option_id: null }]);
    const distinct = body([['carry_on', 'Carry On', SAME, 0.3], ['hire_two', 'Hire Two', nudged('mean', 1e-3), 0.3], ['tech_lead', 'Tech Lead', OTHER, 0.4]]);
    expect(detectIdenticalArms(distinct, OPTIONS)).toEqual([]);
    const all = body([['carry_on', 'Carry On', SAME, 1 / 3], ['hire_two', 'Hire Two', SAME, 1 / 3], ['tech_lead', 'Tech Lead', SAME, 1 / 3]]);
    const groups = detectIdenticalArms(all, OPTIONS);
    expect(groups.map((g) => g.option_ids)).toEqual([['carry_on', 'hire_two', 'tech_lead']]);
    expect(buildIdenticalArmsDisclosure(groups)).toContain('Carry On, Hire Two and Tech Lead came out identical');
  });

  it('(f) a missing outcome on either side is never identical', () => {
    const b = threeArm();
    delete (b.option_comparison as Rec[])[1]!.outcome;
    expect(detectIdenticalArms(b, OPTIONS)).toEqual([]);
  });

  it('a non-computed arm (status skipped) is never grouped, whatever its statistics (the shared usability gate)', () => {
    const b = threeArm();
    (b.option_comparison as Rec[])[1]!.status = 'skipped';
    expect(detectIdenticalArms(b, OPTIONS)).toEqual([]);
    expect(detectIdenticalArms(threeArm(), OPTIONS)).toHaveLength(1); // control
  });

  it('(f) a percentile present on one side only is never identical', () => {
    const b = threeArm();
    delete ((b.option_comparison as Rec[])[1]!.outcome as Rec).p90;
    expect(detectIdenticalArms(b, OPTIONS)).toEqual([]);
  });

  it.each([undefined, NaN, Infinity])('non-finite or absent statistics are never identical: %s', (v) => {
    const b = threeArm();
    ((b.option_comparison as Rec[])[1]!.outcome as Rec).std = v;
    expect(detectIdenticalArms(b, OPTIONS)).toEqual([]);
  });

  it('different n_valid_samples are never identical', () => {
    const b = threeArm();
    ((b.option_comparison as Rec[])[1]!.outcome as Rec).n_valid_samples = 999;
    expect(detectIdenticalArms(b, OPTIONS)).toEqual([]);
  });

  it('(g) purity: the response and options are not mutated', () => {
    const b = threeArm(), before = structuredClone(b), optsBefore = structuredClone(OPTIONS);
    detectIdenticalArms(b, OPTIONS);
    expect(b).toEqual(before);
    expect(OPTIONS).toEqual(optsBefore);
  });

  it('the disclosure is registered on the template channel and matches its grammar', () => {
    const re = new RegExp(`^(?:${IDENTICAL_ARMS_DISCLOSURE_RE_SRC})$`);
    expect(re.test(BASELINE_LINE)).toBe(true);
    expect(re.test(PAIR_LINE)).toBe(true);
    expect(re.test(BASELINE_LINE + PAIR_LINE)).toBe(true);
    expect(TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.some((g) => g.name === 'IDENTICAL_ARMS_DISCLOSURE_RE_SRC')).toBe(true);
  });

  it('Codex P2: past MAX_OPTIONS arms the disclosure is the ONE generic sentence, inside the grammar and the budget', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `plan_${i}`);
    const labels = ids.map((_, i) => `Plan ${String.fromCharCode(65 + i)} ${'a'.repeat(193)}`);
    const said = buildIdenticalArmsDisclosure([{ option_ids: ids, labels, baseline_option_id: null }]);
    expect(said).toBe(" Some options came out identical: in this model they lead to the same outcome. The comparison is held back until they differ: edit one of their values, or remove one.");
    expect(said.length).toBeLessThanOrEqual(IDENTICAL_ARMS_DISCLOSURE_MAX_CHARS);
    expect(new RegExp(`^(?:${IDENTICAL_ARMS_DISCLOSURE_RE_SRC})$`).test(said)).toBe(true);
    // Contrast: three pairs at the 200-character bound (six arms) are still named, and still inside the budget.
    const pairs = [0, 1, 2].map((k) => ({ option_ids: [`a${k}`, `b${k}`], labels: [`A${k} ${'x'.repeat(197)}`, `B${k} ${'y'.repeat(197)}`], baseline_option_id: null }));
    const named = buildIdenticalArmsDisclosure(pairs);
    expect(named).toContain(`A0 ${'x'.repeat(197)} and B0`);
    expect(named.length).toBeLessThanOrEqual(IDENTICAL_ARMS_DISCLOSURE_MAX_CHARS);
    expect(new RegExp(`^(?:${IDENTICAL_ARMS_DISCLOSURE_RE_SRC})$`).test(named)).toBe(true);
  });
});

describe('gate 1 v2 — the Agent reader (Codex #2574 P1)', () => {
  const identical = { code: 'GOAL_FIGURES_OPTIONS_IDENTICAL', severity: 'warning', option_ids: ['carry_on', 'hire_two'],
    message: `Not shown.${BASELINE_LINE}` };
  const block = (...w: Rec[]) => ({ type: 'analysis_result', enrichment: { inference_warnings: w } });

  it('identical arms alone: their own reason and note, scoped to the identical options (Tech Lead keeps its chance)', () => {
    const r = goalChanceWithheldForAgent(block(identical));
    expect(r).toEqual({ withheld: true, say: BASELINE_LINE.trim(), node_ids: [], note: OPTIONS_IDENTICAL_NOTE, option_ids: ['carry_on', 'hire_two'] });
    expect(r?.say).not.toContain('each option reaches');
  });

  it('beside a placeholder path: the placeholder keeps its note and words; the identical reason is added; scopes unite', () => {
    const placeholder = { code: PLACEHOLDER, severity: 'warning', option_ids: ['tech_lead'], node_ids: ['n1'], message: 'Not shown. Its link to revenue is a guess.' };
    const r = goalChanceWithheldForAgent(block(placeholder, identical));
    expect(r?.note).toBe(PLACEHOLDER_PATH_NOTE);
    expect(r?.say).toBe(`Its link to revenue is a guess. ${BASELINE_LINE.trim()}`);
    expect(r?.option_ids).toEqual(['tech_lead', 'carry_on', 'hire_two']);
    expect(r?.node_ids).toEqual(['n1']);
  });

  it('beside an every-option withhold: that note and scope stand (every option), with the identical reason added', () => {
    const everyOption = { code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, severity: 'warning', node_ids: ['g'], message: 'Not shown. The goal is a product this run did not evaluate.' };
    const r = goalChanceWithheldForAgent(block(everyOption, identical));
    expect(r?.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
    expect(r?.option_ids).toBeUndefined();
    expect(r?.say).toContain(BASELINE_LINE.trim());
  });
});

async function runHandler(graph: Rec, options: Rec[], response: Rec) {
  const scenarioId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const plotClient = { run: vi.fn(async () => structuredClone(response) as V2RunResponseEnvelope),
    validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient, scenarioReader: async () => ({ graph, rawPersistedGraph: graph, options, goal_node_id: 'g' }),
  });
  // Copied from the existing run-analysis.test.ts invocation harness.
  const invocation: HandlerInvocation = {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId, request_id: 'req-g1v2',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: scenarioId, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-g1v2', signal: new AbortController().signal, orientationText: '',
  };
  const outcome = await handler(invocation);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  return { outcome, fact, enrichment: fact.result.enrichment as Rec };
}

const graphOf = (options: Rec[], hireEdge?: Rec): Rec => ({
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity', observed_state: { value: 0.5 } },
    { id: 'fac_hire', kind: 'factor', label: 'Hires', observed_state: { value: 0.3 } },
    ...options.map((o) => ({ ...o, kind: 'option' })),
  ],
  edges: [
    { from: 'fac_capacity', to: 'g', strength: 0.8, strength_std: 0.05, confidence: 0.9, provenance: { source: 'user_specified' } },
    { from: 'fac_hire', to: 'g', strength: 0.5, strength_std: 0.1, confidence: 0.5, provenance: { source: 'user_specified' }, ...(hireEdge ?? {}) },
  ],
});

describe('gate 1 v2 — run_analysis path', () => {
  it('(a)+(e) identical arms: every arm stays, every share and the leader are withheld, outcomes kept, said once', async () => {
    const { outcome, fact, enrichment } = await runHandler(graphOf(OPTIONS), OPTIONS, threeArm());
    const rows = readOptionResultSources(enrichment)[0]!;
    expect(rows.map((r) => r.option_id)).toEqual(['carry_on', 'hire_two', 'tech_lead']);
    expect(rows.every((r) => r.win_probability === undefined)).toBe(true);
    expect(rows.every((r) => (r.outcome as Rec | undefined)?.mean !== undefined)).toBe(true);
    expect(fact.result.leading_option_id).toBeNull();
    expect(runWithheldGoalFigures(enrichment)).toBe(true);
    const warning = (enrichment.inference_warnings as Rec[]).find((w) => w.code === GOAL_FIGURES_OPTIONS_IDENTICAL);
    expect(warning?.option_ids).toEqual(['carry_on', 'hire_two']);
    expect(outcome.assistant_text).toContain(BASELINE_LINE);
    expect(outcome.assistant_text).not.toMatch(/currently leads|scored highest/);
  });

  it('DL contrast on the run path: a distinct arm (relative 1e-6) keeps every share and the leader', async () => {
    const { outcome, fact, enrichment } = await runHandler(graphOf(OPTIONS), OPTIONS, threeArm(nudged('mean', 1e-6)));
    const rows = readOptionResultSources(enrichment)[0]!;
    expect(rows.every((r) => typeof r.win_probability === 'number')).toBe(true);
    expect((enrichment.inference_warnings as Rec[] | undefined ?? []).some((w) => w.code === GOAL_FIGURES_OPTIONS_IDENTICAL)).toBe(false);
    expect(fact.result.leading_option_id).toBe('tech_lead');
    expect(outcome.assistant_text).not.toContain('came out identical');
  });

  it('DL placeholder ruling: an identical arm that MOVES a factor through an unsized link keeps that withhold too', async () => {
    const options = [OPTIONS[0]!, opt('hire_two', 'Hire Two', { fac_hire: 0.6 }), OPTIONS[2]!];
    const placeholder = { provenance: { source: 'olumi', magnitude: 'olumi_placeholder' } };
    const withPlaceholder = await runHandler(graphOf(options, placeholder), options, threeArm());
    const codes = (withPlaceholder.enrichment.inference_warnings as Rec[]).map((w) => w.code);
    expect(codes).toContain(GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(codes).toContain(GOAL_FIGURES_OPTIONS_IDENTICAL);
    const hireTwo = readOptionResultSources(withPlaceholder.enrichment).flat().filter((r) => r.option_id === 'hire_two');
    expect(hireTwo.length).toBeGreaterThan(0);
    expect(hireTwo.every((r) => r.probability_of_goal === undefined)).toBe(true);
    // Contrast: the same identical arm over a USER-sized link carries only the identity reason.
    const sized = await runHandler(graphOf(options), options, threeArm());
    const sizedCodes = (sized.enrichment.inference_warnings as Rec[]).map((w) => w.code);
    expect(sizedCodes).toContain(GOAL_FIGURES_OPTIONS_IDENTICAL);
    expect(sizedCodes).not.toContain(GOAL_FIGURES_PLACEHOLDER_PATH);
  });
});
