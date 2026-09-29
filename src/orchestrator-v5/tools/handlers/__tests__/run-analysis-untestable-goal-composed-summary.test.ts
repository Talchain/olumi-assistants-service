/**
 * ⛔ THE COMPOSED SUMMARY MUST NOT SAY "COULD NOT TEST … YOUR GOAL" AND THEN
 * "SCORED HIGHEST AGAINST YOUR GOAL".
 *
 * THE DEFECT (fresh-context coverage verifier on 6c49ab5d, R&C review round 1).
 * The headline builder withdrew "against your goal" when PLoT sent
 * GOAL_DIRECTION_UNATTESTED or GOAL_THRESHOLD_NOT_CONVERTIBLE, but
 * run-analysis.ts then appends the objective-contradiction tail, whose two arms
 * never checked either code:
 *
 *   Arm A  "“{leader}” scored highest against your goal most often without
 *           moving “{factor}” the way your goal asks. …"
 *   Arm B  "… “{leader}” scored highest against your goal most often, but
 *           “{better}” is more likely to reach your stated target (b% against l%). …"
 *
 * The verifier composed headline + Arm A (either code alone) and headline + Arm B
 * (DIRECTION alone), and `isAllowedRunAnalysisAssistantText` ADMITTED all three.
 *
 * THE FIX. The tail takes the headline builder's own goal-frame verdict
 * (`describeGoalFrame`, one derivation, the same enrichment):
 *   goal_framed          no code: both arms exactly as before.
 *   any other frame      a code is present (direction_assumed,
 *                        attainment_untested, or
 *                        direction_assumed_and_attainment_untested): Arm A says
 *                        "scored highest most often" (no goal frame), and Arm B
 *                        is SILENT, attainment claim and "Scoring highest
 *                        counts…" gloss both (R&C round 2, R3-2). Round 1 let
 *                        Arm B ship unframed beside the direction sentence; the
 *                        round-2 verifier ruled that an attainment claim and its
 *                        gloss must not ship at all while the goal frame is
 *                        unattested or untestable.
 * The headline sentence is the one the run's own data makes true, and whenever
 * DIRECTION is present it says the direction was assumed (R3-1).
 * The egress grammar binds each arm shape to its sentence, so the contradicting
 * pairs are REJECTED even if a builder regressed.
 *
 * WHAT THIS PINS, EXACTLY. Every summary below is composed the way the handler
 * composes it at the `const summary = ...` line (`${headline ?? template}` then
 * the scaffold, constraint-gap and intake slots, empty here, then the
 * objective-contradiction tail), from `buildAnalysisResultHeadline`,
 * `describeGoalFrame` and `composeObjectiveContradictionDisclosure` called as
 * run-analysis.ts calls them (the source pin at the bottom binds that). It does
 * NOT execute the handler; `run-analysis-untestable-goal-handler.test.ts` does
 * (R3-3). Both are TESTED, not a wire witness.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeGoalFrame,
  isAllowedRunAnalysisAssistantText,
  type AnalysisResultHeadlineInput,
} from '../../../coaching/analysis-result-headline.js';
import { composeObjectiveContradictionDisclosure } from '../../../coaching/objective-contradiction.js';
import { RUN_ANALYSIS_ASSISTANT_TEMPLATES } from '../run-analysis.js';

type Json = Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));

/** The REAL persisted pricing row (the L60 pull the wiring spec also reads). */
const PRICING_GRAPH = JSON.parse(
  readFileSync(resolve(HERE, '../../../compose/__tests__/fixtures/l60/pricing-persisted-graph.json'), 'utf8'),
) as Json;

/** The same row with a goal that states a direction over the price LEVER, so Arm A can fire. */
const LEVER_AIM_GRAPH: Json = {
  ...PRICING_GRAPH,
  nodes: (PRICING_GRAPH['nodes'] as Json[]).map((n) =>
    n['id'] === 'goal_mrr' ? { ...n, label: 'Increase our subscription price' } : n,
  ),
};

/** The served goal warnings, copied from the t2 c1ddb50 capture (not hand-written). */
const T2 = JSON.parse(
  readFileSync(
    resolve(HERE, '../../../coaching/__tests__/fixtures/t2-c1ddb50.analysis-result-block.trimmed.json'),
    'utf8',
  ),
) as { blocks: Json[] };
const DIRECTION = 'GOAL_DIRECTION_UNATTESTED';
const THRESHOLD = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';
const SERVED_GOAL_WARNINGS = (((T2.blocks[0] as Json)['enrichment'] as Json)['inference_warnings'] as Json[]).filter(
  (w) => w['code'] === DIRECTION || w['code'] === THRESHOLD,
);

// The two headline sentences, spelled here and never imported.
const COULD_NOT_TEST = ' The model could not test whether any option reaches your goal.';
const DIRECTION_ASSUMED =
  ' The analysis was not told which way your goal points, so it assumed a higher value is better.';
const COMBINED =
  ' The analysis was not told which way your goal points, so it assumed a higher value is better,' +
  ' and it could not test whether any option reaches your goal.';
const DIRECTION_CLAUSE = 'The analysis was not told which way your goal points, so it assumed a higher value is better';
const GLOSS = 'Scoring highest counts how often an option scored highest on your goal';

const HOLD = 'Hold at £49 Per Seat (Status Quo)';
const RAISE = 'Raise to £59 Per Seat';
const TIERS = 'Introduce £39 / £69 Two-Tier Pricing';

/** Win shares are the investigation's measured figures for this graph. */
function records(pog: { hold?: number; raise?: number; tiers?: number } | null): Json[] {
  const base: Json[] = [
    { option_id: 'opt_hold', option_label: HOLD, win_probability: 0.7067 },
    { option_id: 'opt_raise', option_label: RAISE, win_probability: 0.2782 },
    { option_id: 'opt_tiers', option_label: TIERS, win_probability: 0.0152 },
  ];
  if (pog === null) return base;
  const values = [pog.hold, pog.raise, pog.tiers];
  return base.map((r, i) => (values[i] === undefined ? r : { ...r, probability_of_goal: values[i] }));
}

/** Arm B fires: the leader has the lowest chance of the target (the banked FINDINGS shape). */
const ATTAINMENT_CONTRADICTED = records({ hold: 0.0, raise: 0.48, tiers: 0.11 });
/** Attainment data present, but the leader already has the best chance: Arm B silent. */
const ATTAINMENT_AGREES = records({ hold: 0.5, raise: 0.2, tiers: 0.1 });
/** No `probability_of_goal` anywhere: the common state. */
const NO_ATTAINMENT = records(null);
/** R3-4: ONLY ISL Channel B's per-option joint attainment (PLoT #204), no Channel A value. */
const JOINT_ONLY: Json[] = records(null).map((r, i) => ({ ...r, probability_of_joint_goal: [0.1, 0.5, 0.2][i] }));

function headlineInput(recs: Json[], codes: readonly string[]): AnalysisResultHeadlineInput {
  return {
    enrichment: {
      option_comparison: recs,
      inference_warnings: SERVED_GOAL_WARNINGS.filter((w) => codes.includes(w['code'] as string)),
    },
    leading_option_id: 'opt_hold',
    status_kind: 'ok',
  };
}

/**
 * Compose EXACTLY what run-analysis.ts composes: the headline, then the tail
 * built from the same persisted graph, the same records, the leader permission
 * and the headline builder's goal-frame verdict for the same input.
 */
function composeAsHandler(recs: Json[], codes: readonly string[], rawGraph: Json): { summary: string; tail: string } {
  const input = headlineInput(recs, codes);
  const headline = buildAnalysisResultHeadline(input);
  const goalFrame = describeGoalFrame(input);
  const objectiveContradictionDisclosure = composeObjectiveContradictionDisclosure(
    rawGraph,
    recs,
    headline !== null,
    goalFrame,
  );
  const template = RUN_ANALYSIS_ASSISTANT_TEMPLATES.DEFAULT;
  return {
    summary: `${headline ?? template}${''}${''}${''}${objectiveContradictionDisclosure}`,
    tail: objectiveContradictionDisclosure,
  };
}

const HOLD_WITHDRAWN = `${HOLD} scored highest in 71% of runs of this model.`;
const HOLD_FRAMED = `${HOLD} scored highest against your goal in 71% of runs of this model.`;

const ARM_B_FRAMED =
  ` Two different questions have two different answers here: “${HOLD}” scored highest against your goal most often,` +
  ` but “${RAISE}” is more likely to reach your stated target (48% against 0%).` +
  ' Scoring highest counts how often an option scored highest on your goal, not whether your target was met.';
const ARM_B_UNFRAMED =
  ` Two different questions have two different answers here: “${HOLD}” scored highest most often,` +
  ` but “${RAISE}” is more likely to reach your stated target (48% against 0%).` +
  ' Scoring highest counts how often an option scored highest on your goal, not whether your target was met.';
const ARM_A_FRAMED =
  ` “${HOLD}” scored highest against your goal most often without moving “Seat Price Level” the way your goal asks.` +
  ` Among the options that do, “${RAISE}” scored highest in 28% of runs.`;
const ARM_A_UNFRAMED =
  ` “${HOLD}” scored highest most often without moving “Seat Price Level” the way your goal asks.` +
  ` Among the options that do, “${RAISE}” scored highest in 28% of runs.`;

/** The claims a composed summary must never make once a code is present. */
function expectNoContradiction(summary: string, codes: readonly string[]): void {
  expect(summary, 'the goal frame survived somewhere in the summary').not.toMatch(/against\s+your\s+goal/i);
  // R3-2: no attainment claim and no gloss under ANY code.
  expect(summary, 'an attainment claim shipped under a goal code').not.toMatch(/more likely to reach your stated target/);
  expect(summary, 'the attainment gloss shipped under a goal code').not.toContain(GLOSS);
  // R3-1: the direction clause rides whenever DIRECTION is present, and only then.
  expect(summary.includes(DIRECTION_CLAUSE)).toBe(codes.includes(DIRECTION));
  expect(isAllowedRunAnalysisAssistantText(summary), `egress rejected: ${summary}`).toBe(true);
}

// ============================================================================
// Controls: no code, the arms are exactly as before
// ============================================================================

describe('CONTROL — with no goal code, both arms keep "against your goal" and are admitted', () => {
  it('Arm B, framed, on the banked shape', () => {
    const { summary } = composeAsHandler(ATTAINMENT_CONTRADICTED, [], PRICING_GRAPH);
    expect(summary).toBe(`${HOLD_FRAMED}${ARM_B_FRAMED}`);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  it('Arm A, framed, on the lever aim', () => {
    const { summary } = composeAsHandler(NO_ATTAINMENT, [], LEVER_AIM_GRAPH);
    expect(summary).toBe(`${HOLD_FRAMED}${ARM_A_FRAMED}`);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  it('PRECONDITION: each fixture fires the arm it is named for (so silence below is the fix, not the fixture)', () => {
    expect(composeAsHandler(ATTAINMENT_CONTRADICTED, [], LEVER_AIM_GRAPH).tail).toBe(ARM_B_FRAMED);
    expect(composeAsHandler(ATTAINMENT_AGREES, [], LEVER_AIM_GRAPH).tail).toBe(ARM_A_FRAMED);
    expect(composeAsHandler(NO_ATTAINMENT, [], PRICING_GRAPH).tail).toBe('');
  });
});

// ============================================================================
// The matrix: every code variant × every arm that can fire
// ============================================================================

interface ComposedRow {
  readonly name: string;
  readonly recs: Json[];
  readonly codes: readonly string[];
  readonly graph: Json;
  readonly expected: string;
}

const ROWS: readonly ComposedRow[] = [
  // ── both codes: the combined sentence (R3-1) ──────────────────────────────
  {
    name: 'both codes · Arm B data, metric goal: Arm B SILENT (it would contradict the headline)',
    recs: ATTAINMENT_CONTRADICTED,
    codes: [DIRECTION, THRESHOLD],
    graph: PRICING_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COMBINED}`,
  },
  {
    name: 'both codes · Arm B data, lever aim: Arm B silent, Arm A unframed',
    recs: ATTAINMENT_CONTRADICTED,
    codes: [DIRECTION, THRESHOLD],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COMBINED}${ARM_A_UNFRAMED}`,
  },
  {
    name: 'both codes · no attainment data, lever aim: Arm A unframed',
    recs: NO_ATTAINMENT,
    codes: [DIRECTION, THRESHOLD],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COMBINED}${ARM_A_UNFRAMED}`,
  },
  // ── THRESHOLD alone ───────────────────────────────────────────────────────
  {
    name: `${THRESHOLD} alone · Arm B data, metric goal: Arm B SILENT`,
    recs: ATTAINMENT_CONTRADICTED,
    codes: [THRESHOLD],
    graph: PRICING_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COULD_NOT_TEST}`,
  },
  {
    name: `${THRESHOLD} alone · Arm B data, lever aim: Arm B silent, Arm A unframed`,
    recs: ATTAINMENT_CONTRADICTED,
    codes: [THRESHOLD],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`,
  },
  {
    name: `${THRESHOLD} alone · no attainment data, lever aim: Arm A unframed`,
    recs: NO_ATTAINMENT,
    codes: [THRESHOLD],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`,
  },
  // ── DIRECTION alone ───────────────────────────────────────────────────────
  {
    name: `⭐ R3-2 ${DIRECTION} alone · Arm B data, metric goal: Arm B SILENT beside the direction sentence (round 1 shipped it unframed)`,
    recs: ATTAINMENT_CONTRADICTED,
    codes: [DIRECTION],
    graph: PRICING_GRAPH,
    expected: `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}`,
  },
  {
    name: `⭐ R3-2 ${DIRECTION} alone · Arm B data, lever aim: Arm B silent, so Arm A (unframed) is the tail`,
    recs: ATTAINMENT_CONTRADICTED,
    codes: [DIRECTION],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}${ARM_A_UNFRAMED}`,
  },
  {
    name: `⭐ R3-4 ${DIRECTION} alone · ONLY Channel B joint attainment, metric goal: the direction sentence, not "could not test"`,
    recs: JOINT_ONLY,
    codes: [DIRECTION],
    graph: PRICING_GRAPH,
    expected: `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}`,
  },
  {
    name: `⭐ R3-1 ${DIRECTION} alone · no attainment data, metric goal: the combined sentence`,
    recs: NO_ATTAINMENT,
    codes: [DIRECTION],
    graph: PRICING_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COMBINED}`,
  },
  {
    name: `${DIRECTION} alone · attainment data, leader already best, lever aim: Arm A unframed`,
    recs: ATTAINMENT_AGREES,
    codes: [DIRECTION],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}${ARM_A_UNFRAMED}`,
  },
  {
    name: `⭐ ${DIRECTION} alone · no attainment data, lever aim: Arm A unframed (the verifier's composition), combined sentence`,
    recs: NO_ATTAINMENT,
    codes: [DIRECTION],
    graph: LEVER_AIM_GRAPH,
    expected: `${HOLD_WITHDRAWN}${COMBINED}${ARM_A_UNFRAMED}`,
  },
];

describe('⭐ every code variant × every arm: no "against your goal", no contradicting pair, admitted at egress', () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const { summary } = composeAsHandler(row.recs, row.codes, row.graph);
      expect(summary).toBe(row.expected);
      expectNoContradiction(summary, row.codes);
    });
  }

  it('the matrix reaches every shape it claims to: Arm A unframed, all three sentences, and NO Arm B', () => {
    const composed = ROWS.map((r) => composeAsHandler(r.recs, r.codes, r.graph).summary);
    expect(composed.some((s) => s.endsWith(ARM_A_UNFRAMED))).toBe(true);
    expect(composed.some((s) => s.endsWith(COULD_NOT_TEST))).toBe(true);
    expect(composed.some((s) => s.endsWith(DIRECTION_ASSUMED))).toBe(true);
    expect(composed.some((s) => s.endsWith(COMBINED))).toBe(true);
    expect(composed.some((s) => s.includes(GLOSS))).toBe(false);
    // …while the SAME Arm B data does fire the arm with no code (the silence is the fix, not the fixture).
    expect(composeAsHandler(ATTAINMENT_CONTRADICTED, [], PRICING_GRAPH).tail).toBe(ARM_B_FRAMED);
  });
});

// ============================================================================
// The grammar binds each arm shape to its sentence
// ============================================================================

describe('egress — each arm shape is admitted only beside the headline it agrees with', () => {
  const PAIRS: ReadonlyArray<[string, string, boolean]> = [
    // Old shapes are still admitted when no code is present.
    ['goal-framed headline + framed Arm B', `${HOLD_FRAMED}${ARM_B_FRAMED}`, true],
    ['goal-framed headline + framed Arm A', `${HOLD_FRAMED}${ARM_A_FRAMED}`, true],
    // The new shapes are admitted beside their sentence.
    ['could-not-test headline + unframed Arm A', `${HOLD_WITHDRAWN}${COULD_NOT_TEST}${ARM_A_UNFRAMED}`, true],
    ['direction headline + unframed Arm A', `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}${ARM_A_UNFRAMED}`, true],
    ['combined headline + unframed Arm A', `${HOLD_WITHDRAWN}${COMBINED}${ARM_A_UNFRAMED}`, true],
    ['combined headline alone', `${HOLD_WITHDRAWN}${COMBINED}`, true],
    // R3-2: Arm B (claim + gloss) is admitted beside NO withdrawn sentence, framed or not.
    ['⭐ R3-2 direction headline + unframed Arm B', `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}${ARM_B_UNFRAMED}`, false],
    ['⭐ R3-2 combined headline + unframed Arm B', `${HOLD_WITHDRAWN}${COMBINED}${ARM_B_UNFRAMED}`, false],
    ['combined headline + FRAMED Arm B', `${HOLD_WITHDRAWN}${COMBINED}${ARM_B_FRAMED}`, false],
    ['combined headline + FRAMED Arm A', `${HOLD_WITHDRAWN}${COMBINED}${ARM_A_FRAMED}`, false],
    // The verifier's three compositions, and every other contradicting pair.
    ['could-not-test headline + FRAMED Arm A', `${HOLD_WITHDRAWN}${COULD_NOT_TEST}${ARM_A_FRAMED}`, false],
    ['could-not-test headline + FRAMED Arm B', `${HOLD_WITHDRAWN}${COULD_NOT_TEST}${ARM_B_FRAMED}`, false],
    ['direction headline + FRAMED Arm A', `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}${ARM_A_FRAMED}`, false],
    ['direction headline + FRAMED Arm B', `${HOLD_WITHDRAWN}${DIRECTION_ASSUMED}${ARM_B_FRAMED}`, false],
    ['⭐ could-not-test headline + unframed Arm B (asserts the attainment it just said was untested)', `${HOLD_WITHDRAWN}${COULD_NOT_TEST}${ARM_B_UNFRAMED}`, false],
    // An unframed arm with no sentence would drop the goal frame without saying why.
    ['goal-framed headline + unframed Arm A', `${HOLD_FRAMED}${ARM_A_UNFRAMED}`, false],
    ['goal-framed headline + unframed Arm B', `${HOLD_FRAMED}${ARM_B_UNFRAMED}`, false],
  ];

  for (const [name, text, admitted] of PAIRS) {
    it(`${admitted ? 'ADMITS' : 'REJECTS'} ${name}`, () => {
      expect(isAllowedRunAnalysisAssistantText(text)).toBe(admitted);
    });
  }
});

// ============================================================================
// The handler calls it this way (source pin)
// ============================================================================

describe('wiring — run-analysis.ts feeds the tail the headline builder\'s own goal-frame verdict', () => {
  const source = readFileSync(resolve(HERE, '../run-analysis.ts'), 'utf8');

  it('derives the frame from the SAME headline input the headline was built from', () => {
    // C46 stage 1: the same input, with the product withhold beside it.
    expect(source).toContain('const headline = nonlinearIdentityWithhold !== null ? null : buildAnalysisResultHeadline(headlineInput);');
    expect(source).toContain('const goalFrame = describeGoalFrame(headlineInput);');
  });

  it('passes it to the composer beside the unchanged leader permission', () => {
    const call = source.slice(source.indexOf('composeObjectiveContradictionDisclosure('));
    const args = call.slice(0, call.indexOf(');') + 2);
    expect(args).toContain('snapshot.rawPersistedGraph');
    expect(args).toContain('resultRecords');
    expect(args).toContain('headline !== null');
    expect(args).toContain('goalFrame');
  });

  it('POSITIVE CONTROL — the needles are really in the source once each', () => {
    expect(source.split('describeGoalFrame(headlineInput)').length - 1).toBe(1);
    expect(source.split('composeObjectiveContradictionDisclosure(').length - 1).toBe(1);
  });
});
