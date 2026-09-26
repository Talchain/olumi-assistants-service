/**
 * ⭐ R3-3 — THE EXECUTED WIRING PIN for the untestable-goal summary.
 *
 * `run-analysis-untestable-goal-composed-summary.test.ts` composes the summary
 * from the same three functions the handler calls, and pins the call by source
 * text. A source pin cannot tell a live argument from a wrong one, so this file
 * EXECUTES `createRunAnalysisHandler` with a stubbed PLoT client carrying the
 * SERVED warning entries (copied from the t2 c1ddb50 capture, never
 * hand-written), and reads the summary the handler actually puts on the turn.
 *
 * Shape × code matrix (every row's expected summary is written out, not derived):
 *   graph   metric goal ("Grow MRR to £250,000"), or a goal that states a
 *           direction over the price LEVER ("Increase our subscription price"),
 *           so Arm A can fire;
 *   data    no attainment field · Arm B contradicted (leader 0% vs 48%) ·
 *           attainment agrees with the leader · ONLY Channel B joint attainment
 *           (`probability_of_joint_goal`, R3-4);
 *   codes   none · GOAL_DIRECTION_UNATTESTED · GOAL_THRESHOLD_NOT_CONVERTIBLE · both.
 * The graph and win shares are the round-2 verifier's executed probe
 * (verifier-composed-e924f61b/zz-probe-composed-handler.test.ts), lifted, not
 * re-authored.
 *
 * ⚠ THE MUTANT NAMED IN THE BRIEF IS EQUIVALENT AFTER R3-2, AND THAT IS
 * RECORDED RATHER THAN HIDDEN (trap 13c). The brief asked this file to kill
 *     goalFrame === 'attainment_untested' ? 'direction_assumed' : goalFrame
 * at the tail's call site. At e924f61b that mutant shipped Arm B (unframed)
 * beside "could not test", and the round-2 verifier killed it that way. R3-2
 * makes the tail read the frame as ONE bit (goal_framed or not): every withdrawn
 * frame silences Arm B and unframes Arm A. Mapping one withdrawn frame to
 * another therefore cannot change any output, and no test can kill it. Measured:
 * applied at this head, all rows here stay GREEN; applied together with the
 * pre-R3-2 rule (Arm B allowed under direction_assumed), the THRESHOLD rows with
 * Arm B data go RED here. What this file DOES kill at the call site is the
 * mutant that matters after R3-2: passing 'goal_framed' (or any frame not
 * derived from this run's envelope), which puts "against your goal" back in the
 * tail beside a headline that withdrew it. Mutant log: the commit body.
 *
 * Status ladder: TESTED. A stubbed PLoT and scenario reader is not a wire
 * witness and not a journey witness.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, unknown>;

// ============================================================================
// The served warning entries (capture, not invented)
// ============================================================================

const T2 = JSON.parse(
  readFileSync(
    new URL('../../../coaching/__tests__/fixtures/t2-c1ddb50.analysis-result-block.trimmed.json', import.meta.url),
    'utf8',
  ),
) as { blocks: Json[] };
const DIRECTION = 'GOAL_DIRECTION_UNATTESTED';
const THRESHOLD = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';
const SERVED_WARNINGS = ((T2.blocks[0] as Json)['enrichment'] as Json)['inference_warnings'] as Json[];

// ============================================================================
// The graph and the stub (the round-2 verifier's executed probe)
// ============================================================================

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const METRIC_GOAL = 'Grow MRR to £250,000';
const LEVER_AIM = 'Increase our subscription price';

const edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});
const factor = (id: string, label: string) => ({
  id,
  kind: 'factor',
  label,
  category: 'controllable',
  observed_state: { value: 0.5, cap: 1 },
});

function graph(goalLabel: string): Json {
  return {
    version: '1',
    nodes: [
      { id: 'goal', kind: 'goal', label: goalLabel },
      { id: 'decision', kind: 'decision', label: 'Pricing plan' },
      factor('fac_price', 'Seat Price Level'),
      factor('fac_seats', 'Active paid seats'),
      { id: 'opt_hold', kind: 'option', label: 'Hold at £49 Per Seat', interventions: { fac_price: 0.49, fac_seats: 0.5 } },
      { id: 'opt_raise', kind: 'option', label: 'Raise to £59 Per Seat', interventions: { fac_price: 0.59, fac_seats: 0.45 } },
      { id: 'opt_tiers', kind: 'option', label: 'Two-Tier Pricing', interventions: { fac_price: 0.54, fac_seats: 0.55 } },
    ],
    edges: [
      edge('e1', 'decision', 'opt_hold'),
      edge('e2', 'decision', 'opt_raise'),
      edge('e3', 'decision', 'opt_tiers'),
      edge('e4', 'opt_hold', 'fac_price'),
      edge('e5', 'opt_raise', 'fac_price'),
      edge('e6', 'opt_tiers', 'fac_price'),
      edge('e7', 'opt_hold', 'fac_seats'),
      edge('e8', 'opt_raise', 'fac_seats'),
      edge('e9', 'opt_tiers', 'fac_seats'),
      edge('e10', 'fac_price', 'goal'),
      edge('e11', 'fac_seats', 'goal'),
    ],
  };
}

function scenarioReader(g: Json): ScenarioReader {
  const snapshot = {
    graph: g,
    options: (g['nodes'] as Json[]).filter((n) => n['kind'] === 'option'),
    goal_node_id: 'goal',
    rawPersistedGraph: g,
  } as unknown as RunAnalysisScenarioSnapshot;
  return (() => Promise.resolve(snapshot)) as ScenarioReader;
}

type DataShape = 'none' | 'contradicted' | 'agrees' | 'joint';

function records(data: DataShape): Json[] {
  const base: Json[] = [
    { option_id: 'opt_hold', option_label: 'Hold at £49 Per Seat', win_probability: 0.7067, status: 'computed' },
    { option_id: 'opt_raise', option_label: 'Raise to £59 Per Seat', win_probability: 0.2782, status: 'computed' },
    { option_id: 'opt_tiers', option_label: 'Two-Tier Pricing', win_probability: 0.0151, status: 'computed' },
  ];
  const values: Record<Exclude<DataShape, 'none'>, [string, number[]]> = {
    contradicted: ['probability_of_goal', [0.0, 0.48, 0.11]],
    agrees: ['probability_of_goal', [0.5, 0.2, 0.1]],
    joint: ['probability_of_joint_goal', [0.1, 0.5, 0.2]],
  };
  if (data === 'none') return base;
  const [key, v] = values[data];
  return base.map((r, i) => ({ ...r, [key]: v[i] }));
}

function plotClient(codes: readonly string[], data: DataShape): { client: PLoTClient; run: ReturnType<typeof vi.fn> } {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'untestable-goal-handler' },
    response_hash: 'untestable-goal-handler',
    analysis_status: 'computed',
    option_comparison: records(data),
    factor_sensitivity: [
      { factor_id: 'fac_seats', label: 'Active paid seats', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 },
    ],
    robustness: { level: 'moderate' },
    inference_warnings: SERVED_WARNINGS.filter((w) => codes.includes(w['code'] as string)),
  } as unknown as V2RunResponseEnvelope;
  const run = vi.fn(() => Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope));
  return { client: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, run };
}

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID,
      request_id: 'req-untestable-goal-handler',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: 'req-untestable-goal-handler',
    signal: new AbortController().signal,
    orientationText: '',
  };
}

async function runHandler(
  goalLabel: string,
  codes: readonly string[],
  data: DataShape,
): Promise<{ summary: string; assistantText: string; leadingOptionId: string | null; plotCalls: number }> {
  const { client, run } = plotClient(codes, data);
  const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: scenarioReader(graph(goalLabel)) });
  const outcome = await handler(invocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error(`expected a run_analysis fact, got ${String(fact?.fact_type)}`);
  }
  return {
    summary: fact.result.summary ?? '',
    assistantText: (outcome as unknown as { assistant_text?: string }).assistant_text ?? '',
    leadingOptionId: fact.result.leading_option_id,
    plotCalls: run.mock.calls.length,
  };
}

// ============================================================================
// The user-facing bytes, spelled here (never imported)
// ============================================================================

const FRAMED_LEAD = 'Hold at £49 Per Seat scored highest against your goal in 71% of runs of this model.';
const WITHDRAWN_LEAD = 'Hold at £49 Per Seat scored highest in 71% of runs of this model.';
const COULD_NOT_TEST = ' The model could not test whether any option reaches your goal.';
const DIRECTION_ASSUMED =
  ' The analysis was not told which way your goal points, so it assumed a higher value is better.';
const COMBINED =
  ' The analysis was not told which way your goal points, so it assumed a higher value is better,' +
  ' and it could not test whether any option reaches your goal.';
const ARM_B_FRAMED =
  ' Two different questions have two different answers here: “Hold at £49 Per Seat” scored highest against your goal most often,' +
  ' but “Raise to £59 Per Seat” is more likely to reach your stated target (48% against 0%).' +
  ' Scoring highest counts how often an option scored highest on your goal, not whether your target was met.';
const ARM_A_FRAMED =
  ' “Hold at £49 Per Seat” scored highest against your goal most often without moving “Seat Price Level” the way your goal asks.' +
  ' Among the options that do, “Raise to £59 Per Seat” scored highest in 28% of runs.';
const ARM_A_UNFRAMED =
  ' “Hold at £49 Per Seat” scored highest most often without moving “Seat Price Level” the way your goal asks.' +
  ' Among the options that do, “Raise to £59 Per Seat” scored highest in 28% of runs.';

// ============================================================================
// The matrix: 2 graphs × 4 data shapes × 4 code sets = 32 rows, every one spelled out
// ============================================================================

type Codes = 'none' | 'D' | 'T' | 'D+T';
const CODE_SETS: Readonly<Record<Codes, readonly string[]>> = {
  none: [],
  D: [DIRECTION],
  T: [THRESHOLD],
  'D+T': [DIRECTION, THRESHOLD],
};

const M = METRIC_GOAL;
const L = LEVER_AIM;

const ROWS: ReadonlyArray<[string, DataShape, Codes, string]> = [
  // ── no code: byte-identical to base c1ddb50 (framed lead, framed arms) ─────
  [M, 'none', 'none', FRAMED_LEAD],
  [M, 'contradicted', 'none', `${FRAMED_LEAD}${ARM_B_FRAMED}`],
  [M, 'agrees', 'none', FRAMED_LEAD],
  [M, 'joint', 'none', FRAMED_LEAD],
  [L, 'none', 'none', `${FRAMED_LEAD}${ARM_A_FRAMED}`],
  [L, 'contradicted', 'none', `${FRAMED_LEAD}${ARM_B_FRAMED}`],
  [L, 'agrees', 'none', `${FRAMED_LEAD}${ARM_A_FRAMED}`],
  [L, 'joint', 'none', `${FRAMED_LEAD}${ARM_A_FRAMED}`],
  // ── DIRECTION alone: the direction clause always; combined without data ───
  [M, 'none', 'D', `${WITHDRAWN_LEAD}${COMBINED}`],
  [M, 'contradicted', 'D', `${WITHDRAWN_LEAD}${DIRECTION_ASSUMED}`],
  [M, 'agrees', 'D', `${WITHDRAWN_LEAD}${DIRECTION_ASSUMED}`],
  [M, 'joint', 'D', `${WITHDRAWN_LEAD}${DIRECTION_ASSUMED}`],
  [L, 'none', 'D', `${WITHDRAWN_LEAD}${COMBINED}${ARM_A_UNFRAMED}`],
  [L, 'contradicted', 'D', `${WITHDRAWN_LEAD}${DIRECTION_ASSUMED}${ARM_A_UNFRAMED}`],
  [L, 'agrees', 'D', `${WITHDRAWN_LEAD}${DIRECTION_ASSUMED}${ARM_A_UNFRAMED}`],
  [L, 'joint', 'D', `${WITHDRAWN_LEAD}${DIRECTION_ASSUMED}${ARM_A_UNFRAMED}`],
  // ── THRESHOLD alone: could not test; no direction clause ──────────────────
  [M, 'none', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}`],
  [M, 'contradicted', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}`],
  [M, 'agrees', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}`],
  [M, 'joint', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}`],
  [L, 'none', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`],
  [L, 'contradicted', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`],
  [L, 'agrees', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`],
  [L, 'joint', 'T', `${WITHDRAWN_LEAD}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`],
  // ── both codes: the combined sentence, whatever the data ──────────────────
  [M, 'none', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}`],
  [M, 'contradicted', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}`],
  [M, 'agrees', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}`],
  [M, 'joint', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}`],
  [L, 'none', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}${ARM_A_UNFRAMED}`],
  [L, 'contradicted', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}${ARM_A_UNFRAMED}`],
  [L, 'agrees', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}${ARM_A_UNFRAMED}`],
  [L, 'joint', 'D+T', `${WITHDRAWN_LEAD}${COMBINED}${ARM_A_UNFRAMED}`],
];

describe('⭐ R3-3 — the EXECUTED run_analysis handler composes the untestable-goal summary', () => {
  it('the matrix is complete: 2 graphs × 4 data shapes × 4 code sets, once each', () => {
    expect(ROWS).toHaveLength(32);
    expect(new Set(ROWS.map(([g, d, c]) => `${g}|${d}|${c}`)).size).toBe(32);
  });

  it('PRECONDITION: the stub carries the SERVED entries for exactly the codes asked for', () => {
    for (const set of Object.values(CODE_SETS)) {
      const entries = SERVED_WARNINGS.filter((w) => set.includes(w['code'] as string));
      expect(entries.map((w) => w['code'])).toEqual(set);
      for (const e of entries) expect(typeof e['message']).toBe('string');
    }
  });

  for (const [goal, data, codes, expected] of ROWS) {
    it(`${goal === M ? 'metric goal' : 'lever aim'} · data ${data} · codes ${codes}`, async () => {
      const { summary, assistantText, leadingOptionId, plotCalls } = await runHandler(goal, CODE_SETS[codes], data);
      // Positive controls: PLoT was reached once and a leader was named.
      expect(plotCalls).toBe(1);
      expect(leadingOptionId).toBe('opt_hold');
      expect(summary).toBe(expected);
      expect(assistantText).toBe(summary);
      expect(isAllowedRunAnalysisAssistantText(summary), `egress rejected: ${summary}`).toBe(true);
      if (codes !== 'none') {
        expect(summary).not.toMatch(/against\s+your\s+goal/i);
        expect(summary).not.toMatch(/more likely to reach your stated target/);
        expect(summary).not.toContain('Scoring highest counts how often');
      }
      expect(summary.includes('it assumed a higher value is better')).toBe(codes === 'D' || codes === 'D+T');
    });
  }
});
