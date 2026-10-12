/**
 * ⭐ SHARE WORDING AT THE PRODUCERS — ONE GENERATIVE PROPERTY OVER THE PRODUCERS' INPUTS (DL re-scope after #2976's check,
 * 12 Oct; AIE #94 6133633297: "repair producers; no egress filter"). A share of model runs is never a result's headline or
 * the chance of meeting the goal, and no result surface names a leader from it. Each producer is driven over generated
 * inputs (licensed / withheld / no goal / several options, and each producer's own branch inputs), never a hand-picked
 * handful, and judged against the rule, never against what the producer itself computed:
 *
 *   P1  the run_analysis handler's summary (= the Run reply on both Run exits): never blank; it is a locked template plus
 *       disclosures; it states no share of runs and names no leader; it keeps the lead ladder's leader-free tails (the
 *       goal-frame and robustness sentences) wherever their inputs say so; the real egress grammar admits it.
 *   P2  the objective-contradiction composer: a NEW Run composes neither arm, on any frame, records or permission.
 *   P4  the Run reply's coaching paragraph (first run and every re-run arm): no share, no leader, no option label.
 *   P5  the explain_results fallback (an ordinary result reply) states NO share; the what_would_flip fallback (reasoning)
 *       states a share only in the AIE's exact credit label, for the options it names, with the qualifier exactly once.
 * The cases are seeded, so a failure names a reproducible case.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import {
  createRunAnalysisHandler,
  RUN_ANALYSIS_ASSISTANT_TEMPLATES,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  isAllowedRunAnalysisAssistantText,
  NOT_ROBUST_NO_FLIP_SENTENCE,
  NOT_ROBUST_SENTENCE,
  RUN_ANALYSIS_LOCKED_TEMPLATES,
} from '../../coaching/analysis-result-headline.js';
import { composeObjectiveContradictionDisclosure, type GoalFrame } from '../../coaching/objective-contradiction.js';
import { storedObjectiveContradictionDisclosure } from '../../coaching/__tests__/support/stored-objective-contradiction.support.js';
import { COACHING_TEXT } from '../../signals/coaching-signals.js';
import { composeExplainResultsFallback, composeWhatWouldFlipFallback } from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';
import { RUN_SHARE_QUALIFIER } from '../run-share-label.js';

type Json = Record<string, unknown>;

/** A share of runs, or a leader named from one, in any of the product's own phrasings (the DL's census, widened). */
const SHARE_OR_LEADER = new RegExp([
  String.raw`\d+\s*% of (?:model )?runs`, String.raw`\bof runs\b`, String.raw`supported by [^.]* runs`, String.raw`\bmost runs\b`,
  String.raw`\bmore runs\b`, String.raw`share of model runs`, String.raw`scor(?:ed|es) highest`,
  String.raw`came out (?:ahead|lowest|highest|top)`, String.raw`comes? out ahead`, String.raw`out on top`, String.raw`most-supported`,
  String.raw`\bstill leads\b`, String.raw`\bcurrently leads\b`, String.raw`\bleads (?:after|now)\b`, String.raw`\bits lead\b`,
  String.raw`\bthe lead\b`, String.raw`gave the (?:highest|lowest)`,
].join('|'), 'i');

/** Seeded PRNG (mulberry32), so every generated case is reproducible from its index. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const LABELS = ['Zeta Plan Seven', 'Hold Pricing Steady', 'Hire Two Analysts', 'Open Northern Office', 'Pilot Tiered Seats'];

// ============================================================================
// P1 — the run_analysis handler's summary
// ============================================================================

const T2 = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/t2-c1ddb50.analysis-result-block.trimmed.json', import.meta.url), 'utf8')) as { blocks: Json[] };
const SERVED_WARNINGS = (((T2.blocks[0] as Json).enrichment as Json).inference_warnings as Json[]);
const DIRECTION = 'GOAL_DIRECTION_UNATTESTED';
const THRESHOLD = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';

interface RunCase {
  readonly k: number;
  readonly shares: readonly number[];
  readonly goal: 'metric' | 'lever';
  readonly codes: readonly string[];
  readonly chance: boolean;
  readonly robustness: Json;
  readonly status: 'computed' | 'partial' | 'still_thinking';
  readonly withheld: boolean;
}

function runCase(i: number): RunCase {
  const r = rng(1000 + i);
  const k = 1 + Math.floor(r() * 4);
  const shape = pick(r, ['random', 'tie', 'edge'] as const);
  const raw = Array.from({ length: k }, (_, j) => shape === 'tie' ? 1 : shape === 'edge' ? (j === 0 ? 999 : 1) : 0.05 + r());
  const total = raw.reduce((a, b) => a + b, 0);
  return {
    k, shares: raw.map((x) => x / total),
    goal: pick(r, ['metric', 'lever'] as const),
    codes: pick(r, [[], [DIRECTION], [THRESHOLD], [DIRECTION, THRESHOLD]] as const),
    chance: r() < 0.5,
    robustness: pick(r, [{ level: 'moderate' }, { level: 'low' }, { is_robust: false }, { level: 'high' }]),
    status: pick(r, ['computed', 'computed', 'partial', 'still_thinking'] as const),
    withheld: r() < 0.35,
  };
}

function graphOf(c: RunCase): Json {
  const factor = (id: string, label: string) => ({ id, kind: 'factor', label, category: 'controllable', observed_state: { value: 0.5, cap: 1 } });
  const edge = (id: string, from: string, to: string) => ({ id, from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' });
  const options = LABELS.slice(0, c.k).map((label, j) => ({ id: `opt_${j}`, kind: 'option', label, interventions: { fac_price: 0.4 + j * 0.05, fac_seats: 0.5 } }));
  return {
    version: '1',
    nodes: [
      { id: 'goal', kind: 'goal', label: c.goal === 'lever' ? 'Increase our subscription price' : 'Grow MRR to £250,000' },
      { id: 'decision', kind: 'decision', label: 'Pricing plan' },
      factor('fac_price', 'Seat Price Level'), factor('fac_seats', 'Active paid seats'),
      ...options,
    ],
    edges: [
      ...options.map((o, j) => edge(`d${j}`, 'decision', o.id)),
      ...options.flatMap((o, j) => [edge(`p${j}`, o.id, 'fac_price'), edge(`s${j}`, o.id, 'fac_seats')]),
      edge('e_price', 'fac_price', 'goal'), edge('e_seats', 'fac_seats', 'goal'),
    ],
    ...(c.withheld ? { goal_constraints: [{ constraint_id: 'constraint_out_total_cost_max', node_id: 'out_total_cost', operator: '<=', value: 2500, label: 'Total three-year cost', unit: '£', provenance: 'explicit' }] } : {}),
  };
}

function plotOf(c: RunCase): PLoTClient {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'share-producers' },
    response_hash: 'share-producers',
    analysis_status: c.status,
    option_comparison: LABELS.slice(0, c.k).map((label, j) => ({
      option_id: `opt_${j}`, option_label: label, win_probability: c.shares[j], status: 'computed',
      ...(c.chance ? { probability_of_goal: [0, 0.48, 0.11, 0.3, 0.2][j] } : {}),
    })),
    factor_sensitivity: [{ factor_id: 'fac_seats', label: 'Active paid seats', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }],
    robustness: c.robustness,
    inference_warnings: SERVED_WARNINGS.filter((w) => c.codes.includes(w.code as string)),
  } as unknown as V2RunResponseEnvelope;
  return { run: vi.fn(async () => structuredClone(response)), validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
}

function invocation(): HandlerInvocation {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: id, request_id: 'req-share-producers',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: id, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-share-producers', signal: new AbortController().signal, orientationText: '',
  };
}

async function summaryOf(c: RunCase): Promise<{ summary: string; assistantText: string }> {
  const g = graphOf(c);
  const snapshot = {
    graph: g, options: (g.nodes as Json[]).filter((n) => n.kind === 'option'), goal_node_id: 'goal', rawPersistedGraph: g,
    ...(c.withheld ? { goal_constraints: g.goal_constraints } : {}),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient: plotOf(c), scenarioReader: (() => Promise.resolve(snapshot)) as ScenarioReader });
  const outcome = await handler(invocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') throw new Error('expected a run_analysis fact');
  return { summary: fact.result.summary ?? '', assistantText: outcome.assistant_text };
}

/** Every way a Run summary breaks P1 (empty when it holds). */
function p1Violations(c: RunCase, summary: string, assistantText: string): string[] {
  const v: string[] = [];
  if (summary.trim() === '') v.push('blank summary');
  if (assistantText !== summary) v.push('reply differs from the summary');
  if (![...RUN_ANALYSIS_LOCKED_TEMPLATES].some((t) => summary.startsWith(t))) v.push('does not lead with a locked template');
  if (SHARE_OR_LEADER.test(summary)) v.push(`share or leader words: ${SHARE_OR_LEADER.exec(summary)?.[0]}`);
  if (textAssertsLeadingOption(summary)) v.push('a leader claim the egress guard sees');
  for (const label of LABELS.slice(0, c.k)) if (summary.includes(label)) v.push(`names option "${label}"`);
  if (!isAllowedRunAnalysisAssistantText(summary)) v.push('the egress grammar rejects it');
  const tail = (s: string) => summary.includes(s);
  if (c.codes.includes(THRESHOLD) && !tail('could not test whether any option reaches your goal')) v.push('goal-frame tail missing (threshold)');
  if (c.codes.includes(DIRECTION) && !tail('assumed a higher value is better for your goal')) v.push('goal-frame tail missing (direction)');
  const notRobust = c.robustness.is_robust === false || c.robustness.level === 'low';
  if (notRobust !== (tail(NOT_ROBUST_SENTENCE.trim()) || tail(NOT_ROBUST_NO_FLIP_SENTENCE.trim()))) v.push('robustness tail wrong');
  return v;
}

const RUN_CASES = Array.from({ length: 48 }, (_, i) => runCase(i));

describe('P1 — the Run summary (generated over options, shares, goal, codes, chance data, robustness, status, withholding)', () => {
  it('the generator covers every dimension it claims (so a green sweep is not a narrow one)', () => {
    expect(new Set(RUN_CASES.map((c) => c.k))).toEqual(new Set([1, 2, 3, 4]));
    expect(RUN_CASES.some((c) => c.withheld) && RUN_CASES.some((c) => !c.withheld)).toBe(true);
    for (const codes of [[], [DIRECTION], [THRESHOLD], [DIRECTION, THRESHOLD]]) {
      expect(RUN_CASES.some((c) => c.codes.join() === codes.join()), `codes ${codes.join()}`).toBe(true);
    }
    expect(new Set(RUN_CASES.map((c) => c.status)).size).toBe(3);
    expect(RUN_CASES.some((c) => c.chance) && RUN_CASES.some((c) => !c.chance)).toBe(true);
    expect(RUN_CASES.some((c) => c.goal === 'lever') && RUN_CASES.some((c) => c.goal === 'metric')).toBe(true);
  });

  it.each(RUN_CASES.map((c, i) => [i, c] as const))('case %i holds P1', async (_i, c) => {
    const { summary, assistantText } = await summaryOf(c);
    expect(p1Violations(c, summary, assistantText), summary).toEqual([]);
  });

  it('a withheld Run keeps its tails and states the unchecked limit (the DL\'s withheld-Run row)', async () => {
    const c: RunCase = { k: 3, shares: [0.7, 0.2, 0.1], goal: 'metric', codes: [THRESHOLD], chance: false,
      robustness: { level: 'low' }, status: 'computed', withheld: true };
    const { summary, assistantText } = await summaryOf(c);
    expect(p1Violations(c, summary, assistantText)).toEqual([]);
    expect(summary.startsWith(`${RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT} The model could not test whether any option reaches your goal.`)).toBe(true);
    expect(summary).toContain('Total three-year cost');
  });
});

// ============================================================================
// P2 — the objective-contradiction composer
// ============================================================================

describe('P2 — a new Run composes no objective-contradiction arm (generated records × frames × permission × graph)', () => {
  const FRAMES: readonly GoalFrame[] = ['goal_framed', 'direction_assumed', 'attainment_untested', 'direction_assumed_and_attainment_untested'];
  const cases = Array.from({ length: 64 }, (_, i) => {
    const r = rng(5000 + i);
    const k = 2 + Math.floor(r() * 3);
    const records = LABELS.slice(0, k).map((label, j) => ({
      option_id: `opt_${j}`, option_label: label, win_probability: r(),
      ...(r() < 0.6 ? { probability_of_goal: Math.round(r() * 100) / 100 } : {}),
    }));
    const c = { k, shares: [], goal: pick(r, ['metric', 'lever'] as const), codes: [], chance: false, robustness: {}, status: 'computed', withheld: false } as RunCase;
    return { records, frame: pick(r, FRAMES), named: r() < 0.7, graph: r() < 0.2 ? null : graphOf(c) };
  });

  it('never composes, and the same inputs DO build a stored arm somewhere (so the silence is the fix)', () => {
    let stored = 0;
    for (const { records, frame, named, graph } of cases) {
      expect(composeObjectiveContradictionDisclosure(graph, records, named, frame)).toBe('');
      if (storedObjectiveContradictionDisclosure(graph, records, named, frame) !== '') stored += 1;
    }
    expect(stored).toBeGreaterThan(0);
  });
});

// ============================================================================
// P4 — the Run reply's coaching paragraph
// ============================================================================

describe('P4 — the coaching paragraph names no leader (generated deltas × licences × changes × flags)', () => {
  const ACTIONS = ['constraint_added', 'factor_value_updated', 'link_strength_updated', 'graph_edited'] as const;
  const cases = Array.from({ length: 240 }, (_, i) => {
    const r = rng(9000 + i);
    const [prior, current] = [pick(r, LABELS), pick(r, LABELS)];
    const runDelta = r() < 0.1 ? null : {
      comparable: r() < 0.9,
      leading_option_changed: prior !== current && r() < 0.8,
      leader_identity_basis: r() < 0.8 ? 'option_id' : 'label',
      prior_leading_label: prior,
      current_leading_label: current,
      margin_direction: pick(r, ['widened', 'narrowed', 'unchanged', 'unavailable'] as const),
      margin_shift_pp: Math.round(r() * 30),
      driver_rank_changes: [], robustness_changed: false, prior_band: 'moderate', current_band: 'moderate',
    };
    const interveningChange = pick(r, [null, { kind: 'several' },
      { kind: 'single', action: pick(r, ACTIONS), target_label: 'Customer churn' }] as const);
    return {
      runDelta, interveningChange,
      movementLicence: pick(r, [{ kind: 'licensed' }, { kind: 'within_noise' }, { kind: 'indeterminate', reason: 'no_identity_bound_pair' }] as const),
      interveningChangeIsInert: r() < 0.25, sameRecordedModel: r() < 0.25,
    };
  });

  it('first run: no share, no leader', () => {
    const text = COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({});
    expect(text.trim()).not.toBe('');
    expect(SHARE_OR_LEADER.test(text)).toBe(false);
    expect(textAssertsLeadingOption(text)).toBe(false);
  });

  it('every re-run arm: no share, no leader, no option label, no stray spacing; some arms still speak', () => {
    let spoke = 0;
    for (const c of cases) {
      const text = COACHING_TEXT.RERUN_ANALYSIS_COMPLETE(c as never);
      const where = JSON.stringify(c);
      expect(SHARE_OR_LEADER.test(text), `${text} @ ${where}`).toBe(false);
      expect(textAssertsLeadingOption(text), `${text} @ ${where}`).toBe(false);
      for (const label of LABELS) expect(text.includes(label), `${text} @ ${where}`).toBe(false);
      expect(text).toBe(text.trim());
      expect(text).not.toMatch(/ {2}/);
      if (text !== '') spoke += 1;
    }
    expect(spoke).toBeGreaterThan(0);
  });
});

// ============================================================================
// P5 — the explain_results and what_would_flip fallbacks
// ============================================================================

const SHARE_ANY = /\d+\s*% of (?:model )?runs|\bof runs\b|supported by [^.]* runs|next most runs|\bmost runs\b|share of model runs/i;
const LABEL_LINE = /'([^']+)': Share of model runs credited to this option: (?:<1|>99|\d{1,3})%\./g;

function projectionCase(i: number): { p: AnalysisProjectionSummary; raw: { level: string | null; near_tie_is_tie: boolean } | null } {
  const r = rng(13000 + i);
  const lead = r();
  const runnerP = lead * r();
  const hasRunner = r() < 0.85;
  return {
    p: {
      status: 'complete',
      leading_option: { label: pick(r, LABELS.slice(0, 2)), probability: 0.3 + lead * 0.7 },
      runner_up: hasRunner ? { label: pick(r, LABELS.slice(2)), probability: runnerP } : null,
      margin_pp: r() < 0.2 ? null : Math.round(r() * 40),
      robustness_band: pick(r, ['stable', 'highly_stable', 'moderate', 'fragile', 'unknown', null]),
      top_drivers: r() < 0.3 ? [] : [{ factor_label: 'Engineering Capacity', sensitivity_value: r() - 0.5 }],
    } as unknown as AnalysisProjectionSummary,
    raw: r() < 0.3 ? { level: pick(r, ['low', 'high']), near_tie_is_tie: r() < 0.5 } : null,
  };
}

describe('P5 — explain_results omits shares; what_would_flip says them only in the credit label (generated projections)', () => {
  const cases = Array.from({ length: 160 }, (_, i) => projectionCase(i));

  it('explain_results: never blank, no share of runs in any form, no qualifier', () => {
    for (const { p, raw } of cases) {
      const text = composeExplainResultsFallback(p, null, raw as never);
      expect(text.trim()).not.toBe('');
      expect(SHARE_ANY.test(text), text).toBe(false);
      expect(text).not.toContain(RUN_SHARE_QUALIFIER);
      // A near tie names both options as tied (no share, no leader); otherwise the leader is never named.
      if (!text.includes('effectively tied')) expect(text.includes(p.leading_option!.label), text).toBe(false);
    }
  });

  it('what_would_flip: every share is the credit label for a named option, with the qualifier exactly once after them', () => {
    let labelled = 0;
    for (const { p, raw } of cases) {
      const text = composeWhatWouldFlipFallback(p, raw as never, null);
      const named = [p.leading_option!.label, p.runner_up?.label].filter((l): l is string => l !== undefined);
      const lines = [...text.matchAll(LABEL_LINE)];
      for (const m of lines) expect(named, text).toContain(m[1]);
      labelled += lines.length;
      expect(text.split(RUN_SHARE_QUALIFIER), text).toHaveLength(2);
      expect(text.indexOf(RUN_SHARE_QUALIFIER)).toBeGreaterThan(Math.max(...lines.map((m) => m.index!)));
      const rest = text.replace(LABEL_LINE, '').replace(RUN_SHARE_QUALIFIER, '');
      expect(SHARE_ANY.test(rest), rest).toBe(false);
    }
    expect(labelled).toBeGreaterThanOrEqual(cases.length);
  });
});
