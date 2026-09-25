/**
 * ⛔ THE HEADLINE CLAIMED A GOAL THE ANALYSIS SAYS IT COULD NOT TEST.
 *
 * THE DEFECT, MEASURED ON THE WIRE (AI Quality, olumi-programme-docs #69
 * comment 5830649501). Served CEE c1ddb50, agent lane, the pricing brief's run
 * turn. Its `analysis_result` block said:
 *
 *   "Raise to £59 scored highest against your goal in 81% of runs of this model
 *    because Active paid seats is the strongest driver."
 *
 * The SAME enrichment carries two PLoT warnings on its warning channel that
 * deny the goal frame:
 *
 *   GOAL_DIRECTION_UNATTESTED       "options were ranked by largest goal value.
 *                                    That is an assumption, not the team's
 *                                    stated aim"
 *   GOAL_THRESHOLD_NOT_CONVERTIBLE  the goal node carries no observed_state, so
 *                                    the stated level could not be converted
 *                                    into the samples' frame
 *
 * Nothing on the headline path read either code, so the lead clause asserted
 * "against your goal" for an objective the producer says it did not test.
 *
 * THE FIX, AND ITS BOUNDARY. When either code is present, the lead clause drops
 * the goal frame ("scored highest in N% of runs of this model", the same
 * statistic and the same scope clause) and the headline adds one fixed
 * sentence: "The model could not test whether any option reaches your goal."
 * Nothing else changes:
 *   - which case is chosen, which shape a length shed lands on, and whether a
 *     headline exists at all (the LEADER PERMISSION: `headline !== null` is
 *     what run-analysis.ts passes to the objective-contradiction tail) are
 *     identical with and without the warnings. Pinned below for every path;
 *   - a run WITHOUT either code is byte-identical to today (control T4).
 *
 * ⚠ "YOUR GOAL", NOT A NAMED TARGET, AND THIS IS A CHOICE. The block carries no
 * usable target string. The goal node's label never appears on it as a goal:
 * it appears only as the `to_label` of some fragile edges, and the goal's id
 * appears only inside the warning's own `field`/`message` prose. Recovering a
 * label would mean either a join the block does not state (edge endpoint ⇒
 * goal) or reading Tier-3 warning prose, which the claim-safety cage forbids
 * (presence of the CODE only). So the neutral "your goal" is used.
 *
 * ⚠ WHERE THE CODES ARE READ. `inference_warnings[].code`, PLoT's warning
 * channel, through the cage-owned presence helper (claim-safety-cage.ts), so
 * the headline module never carries the Tier-3 key. NOT
 * `decision_brief.warning_codes`: that is PLoT's projection of the same
 * channel, and reading it because it happens to pass the Tier-3 static guard
 * would be the laundering the guard exists to stop. The binding test below
 * pins that the channel alone is enough.
 *
 * CAPTURE, not invented: `fixtures/t2-c1ddb50.analysis-result-block.trimmed.json`
 * is blocks[0] of the served response, whole (its `_provenance` records the
 * source and its sha256). The synthetic path fixtures in T6 carry the served
 * warning ENTRIES copied from that capture, not hand-written ones.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  isAllowedRunAnalysisAssistantText,
  MAX_ASSISTANT_TEXT_CHARS,
  MAX_HEADLINE_CHARS,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import {
  applyEgressForbiddenPhraseGuard,
  DOCTRINE_FATAL_PATTERNS,
  DOCTRINE_VERDICT_PATTERNS,
  findForbiddenPhraseHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';
import { unitStatesRunnerUpGap } from '../../compose/runner-up-gap-statistic.js';

// ============================================================================
// The capture
// ============================================================================

type Json = Record<string, unknown>;

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/t2-c1ddb50.analysis-result-block.trimmed.json', import.meta.url), 'utf8'),
) as { _provenance: Json; blocks: Json[] };
const BLOCK = FIXTURE.blocks[0] as Json;
const SERVED_ENRICHMENT = BLOCK['enrichment'] as Json;
const SERVED_LEADING_OPTION_ID = BLOCK['leading_option_id'] as string;
const SERVED_SUMMARY = BLOCK['summary'] as string;

// PLoT's two codes, spelled as the WIRE spells them. Deliberately not imported
// from the code under test: a misspelt constant there must fail here.
const DIRECTION = 'GOAL_DIRECTION_UNATTESTED';
const THRESHOLD = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';
const GOAL_CODES: readonly string[] = [DIRECTION, THRESHOLD];

/** The served warning ENTRIES for the two codes, copied from the capture. */
const SERVED_GOAL_WARNINGS = (SERVED_ENRICHMENT['inference_warnings'] as Json[]).filter((w) =>
  GOAL_CODES.includes(w['code'] as string),
);

/** The fixed disclosure sentence, bound by identity. */
const DISCLOSURE = ' The model could not test whether any option reaches your goal.';

/**
 * TODAY'S served headline, captured from the UNCHANGED source (c1ddb50) on this
 * exact enrichment. It is also the first 125 characters of the served summary,
 * which is asserted below, so it is the wire's own text and not a transcription.
 */
const TODAY =
  'Raise to £59 scored highest against your goal in 81% of runs of this model because Active paid seats is the strongest driver.';

/** What the served block must produce once the goal claim is withdrawn. */
const UNTESTED =
  'Raise to £59 scored highest in 81% of runs of this model because Active paid seats is the strongest driver.' +
  DISCLOSURE;

// ============================================================================
// Helpers
// ============================================================================

/**
 * A copy of `enrichment` with the goal-warning codes reduced to `keep`, on BOTH
 * carriers (the warning channel and the decision_brief projection), so a
 * variant is a coherent envelope rather than a half-edited one.
 */
function withGoalCodes(enrichment: Json, keep: readonly string[]): Json {
  const copy = structuredClone(enrichment);
  const iw = copy['inference_warnings'];
  if (Array.isArray(iw)) {
    copy['inference_warnings'] = iw.filter(
      (w: Json) => !GOAL_CODES.includes(w['code'] as string) || keep.includes(w['code'] as string),
    );
  }
  const brief = copy['decision_brief'] as Json | undefined;
  if (brief && Array.isArray(brief['warning_codes'])) {
    brief['warning_codes'] = (brief['warning_codes'] as string[]).filter(
      (c) => !GOAL_CODES.includes(c) || keep.includes(c),
    );
  }
  return copy;
}

function served(enrichment: Json, extra: Partial<AnalysisResultHeadlineInput> = {}): AnalysisResultHeadlineInput {
  return { enrichment, leading_option_id: SERVED_LEADING_OPTION_ID, status_kind: 'ok', ...extra };
}

/**
 * NO GOAL CLAIM. The disclosure itself says "whether any option reaches your
 * goal" — a QUESTION the model could not answer, not an assertion — so it is
 * removed first and everything else must be free of the goal frame.
 */
function expectNoGoalClaim(text: string): void {
  const rest = text.split(DISCLOSURE).join('');
  expect(rest, 'the goal frame survived').not.toMatch(/against\s+your\s+goal/i);
  expect(rest, 'an attainment assertion survived').not.toMatch(
    /\b(?:reach(?:es|ed)?|meets?|met|achiev(?:es|ed)?)\s+your\s+(?:stated\s+)?(?:goal|target)\b/i,
  );
  expect(rest, '"your goal" / "your target" outside the disclosure').not.toMatch(/\byour\s+(?:goal|target)\b/i);
}

/** Every copy gate the module's existing suites apply to an emitted headline. */
function expectPassesCopyGates(text: string): void {
  expect(isAllowedRunAnalysisAssistantText(text), `egress allowlist rejected: ${text}`).toBe(true);
  expect(passesAssistantTextContentDefences(text)).toBe(true);
  expect(findForbiddenPhraseHit(text)).toBeNull();
  expect(applyEgressForbiddenPhraseGuard(text).rewritten).toBe(false);
  for (const re of [...DOCTRINE_FATAL_PATTERNS, ...DOCTRINE_VERDICT_PATTERNS]) {
    expect(re.test(text), `doctrine pattern ${re} hit`).toBe(false);
  }
  expect(text.length).toBeLessThanOrEqual(MAX_ASSISTANT_TEXT_CHARS);
  // The redaction vocabulary must still SEE the leader claim, or a withheld
  // turn would carry it unredacted (goal-framed-outcome-vocabulary.test.ts).
  expect(textNamesLeadingOption(text)).toBe(true);
  // The leader's own share must survive runner-up-gap redaction.
  expect(unitStatesRunnerUpGap(text)).toBe(false);
}

// ============================================================================
// The capture is what it says it is
// ============================================================================

describe('the served t2 capture (positive controls)', () => {
  it('carries both goal codes on the warning channel AND the brief projection', () => {
    const iw = (SERVED_ENRICHMENT['inference_warnings'] as Json[]).map((w) => w['code']);
    expect(iw).toEqual(expect.arrayContaining([DIRECTION, THRESHOLD]));
    expect((SERVED_ENRICHMENT['decision_brief'] as Json)['warning_codes']).toEqual([DIRECTION, THRESHOLD]);
    expect(SERVED_GOAL_WARNINGS.map((w) => w['code'])).toEqual([DIRECTION, THRESHOLD]);
  });

  it('its served summary opens with today\'s goal-claiming headline', () => {
    expect(SERVED_SUMMARY.startsWith(TODAY)).toBe(true);
  });
});

// ============================================================================
// T1–T3: the goal claim is withdrawn
// ============================================================================

describe('T1–T3 — an untestable goal is never claimed', () => {
  it('T1: the served t2 block (both codes) makes NO goal claim and says the goal could not be tested', () => {
    const text = buildAnalysisResultHeadline(served(SERVED_ENRICHMENT));
    expect(text).toBe(UNTESTED);
    expectNoGoalClaim(text!);
    expect(text!).toContain('Raise to £59 scored highest in 81% of runs of this model');
    expectPassesCopyGates(text!);
  });

  it('T1: the served SUMMARY composition (headline + the scaffold sentence it shipped with) is admitted at egress', () => {
    const scaffoldSentence = SERVED_SUMMARY.slice(TODAY.length);
    expect(scaffoldSentence).toContain('was analysed as no change');
    const text = buildAnalysisResultHeadline(served(SERVED_ENRICHMENT));
    const composed = `${text}${scaffoldSentence}`;
    expect(composed).toBe(`${UNTESTED}${scaffoldSentence}`);
    expect(isAllowedRunAnalysisAssistantText(composed)).toBe(true);
    expect(composed.length).toBeLessThanOrEqual(MAX_ASSISTANT_TEXT_CHARS);
  });

  it('T2: GOAL_THRESHOLD_NOT_CONVERTIBLE alone withdraws the goal claim', () => {
    const text = buildAnalysisResultHeadline(served(withGoalCodes(SERVED_ENRICHMENT, [THRESHOLD])));
    expect(text).toBe(UNTESTED);
    expectNoGoalClaim(text!);
  });

  it('T3: GOAL_DIRECTION_UNATTESTED alone withdraws the goal claim', () => {
    const text = buildAnalysisResultHeadline(served(withGoalCodes(SERVED_ENRICHMENT, [DIRECTION])));
    expect(text).toBe(UNTESTED);
    expectNoGoalClaim(text!);
  });

  it('BINDING: the warning CHANNEL alone is enough — the decision_brief projection is not what is read', () => {
    const channelOnly = structuredClone(SERVED_ENRICHMENT);
    (channelOnly['decision_brief'] as Json)['warning_codes'] = [];
    expect(buildAnalysisResultHeadline(served(channelOnly))).toBe(UNTESTED);
  });

  it('the lead sentence without the disclosure stays inside the base headline cap', () => {
    expect(UNTESTED.length - DISCLOSURE.length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
  });
});

// ============================================================================
// T4: the control — no code, no change
// ============================================================================

describe('T4 — CONTROL: a run with NEITHER code is byte-identical to today', () => {
  it('the served block with both codes removed produces today\'s served headline exactly', () => {
    expect(buildAnalysisResultHeadline(served(withGoalCodes(SERVED_ENRICHMENT, [])))).toBe(TODAY);
  });

  it('an enrichment with no warning channel at all is unchanged too', () => {
    const noChannel = structuredClone(SERVED_ENRICHMENT);
    delete noChannel['inference_warnings'];
    expect(buildAnalysisResultHeadline(served(noChannel))).toBe(TODAY);
  });

  it('an unrelated warning code does not withdraw the claim', () => {
    // EDGE_E_VALUE_NON_FINITE_DROPPED rides the same channel on the capture.
    const other = withGoalCodes(SERVED_ENRICHMENT, []);
    expect((other['inference_warnings'] as Json[]).map((w) => w['code'])).toEqual([
      'EDGE_E_VALUE_NON_FINITE_DROPPED',
    ]);
    expect(buildAnalysisResultHeadline(served(other))).toBe(TODAY);
  });
});

// ============================================================================
// T5: the leader permission is unchanged
// ============================================================================

/** The descriptor fields that are NOT the separability payload. */
const WITHHELD = (reason: string, overrides: Json = {}): Json => ({
  case: null,
  reason,
  has_leading_option: true,
  has_clean_label: true,
  has_driver: false,
  has_fragility: false,
  margin_bucket: null,
  separability_withhold: null,
  ...overrides,
});

describe('T5 — LEADER PERMISSION: a withheld leader stays withheld, identically, whatever the warnings', () => {
  // Every descriptor below was captured from the UNCHANGED source (c1ddb50).
  const WITHHELD_INPUTS: ReadonlyArray<[string, Partial<AnalysisResultHeadlineInput>, Json]> = [
    ['intake_options_missing', { intake_options_missing: true }, WITHHELD('intake_options_missing')],
    ['intake_identity_unverified', { intake_identity_unverified: true }, WITHHELD('intake_identity_unverified')],
    ['constraint_infeasible', { constraint_infeasible: true }, WITHHELD('constraint_infeasible')],
    ['constraint_unevaluated', { constraint_unevaluated: true }, WITHHELD('constraint_unevaluated')],
    ['constraint_identity_unresolved', { constraint_identity_unresolved: true }, WITHHELD('constraint_identity_unresolved')],
    [
      'unsafe label (leading option not in the result)',
      { leading_option_id: 'not_an_option' },
      WITHHELD('unsafe_label', { has_leading_option: false, has_clean_label: false }),
    ],
  ];

  for (const [name, extra, descriptor] of WITHHELD_INPUTS) {
    it(`${name}: null and the same descriptor, with and without the goal codes`, () => {
      for (const enrichment of [SERVED_ENRICHMENT, withGoalCodes(SERVED_ENRICHMENT, [])]) {
        expect(buildAnalysisResultHeadline(served(enrichment, extra))).toBeNull();
        expect(describeAnalysisHeadline(served(enrichment, extra))).toEqual(descriptor);
      }
    });
  }

  const SYNTHETIC_WITHHELD: ReadonlyArray<[string, Json, Json]> = [
    [
      'separability withhold (0.34 / 0.33 / 0.33)',
      {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
          { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.33 },
        ],
      },
      WITHHELD('options_not_separable', {
        margin_bucket: 'tight',
        separability_withhold: { separation: 0.009900990099009894, contenders: 3 },
      }),
    ],
    [
      'declared leader trails by a non-marginal gap (0.30 vs 0.60)',
      {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.3 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.6 },
        ],
      },
      WITHHELD('low_margin', { margin_bucket: 'tight' }),
    ],
  ];

  for (const [name, enrichment, descriptor] of SYNTHETIC_WITHHELD) {
    it(`${name}: null and the same descriptor, with and without the goal codes`, () => {
      for (const e of [enrichment, { ...enrichment, inference_warnings: SERVED_GOAL_WARNINGS }]) {
        const input: AnalysisResultHeadlineInput = { enrichment: e, leading_option_id: 'opt_a', status_kind: 'ok' };
        expect(buildAnalysisResultHeadline(input)).toBeNull();
        expect(describeAnalysisHeadline(input)).toEqual(descriptor);
      }
    });
  }

  it('the served block: a headline exists with the codes exactly as it does without them', () => {
    const warned = describeAnalysisHeadline(served(SERVED_ENRICHMENT));
    const clean = describeAnalysisHeadline(served(withGoalCodes(SERVED_ENRICHMENT, [])));
    expect(warned).toEqual(clean);
    expect(buildAnalysisResultHeadline(served(SERVED_ENRICHMENT))).not.toBeNull();
  });

  /**
   * ⚠ THE LENGTH WINDOW. The withdrawn lead clause is 18 characters SHORTER than
   * the goal-framed one. Budgeted naively, a sentence that overflows by fewer
   * than 18 characters today would FIT with the codes present — and a near-tie
   * that overflows returns null (no leader) rather than falling to the Case E
   * floor. So the warnings would turn a withheld leader into a named one. The
   * budget is length-neutral by construction; these two inputs sit inside the
   * window and prove it.
   */
  it('a near-tie that overflows today by a few characters stays WITHHELD with the codes present', () => {
    const fixed = ' scored highest against your goal in 45% of runs of this model, but the options are close.';
    const label = `Option ${'L'.repeat(MAX_HEADLINE_CHARS - fixed.length - 7 + 5)}`;
    const enrichment: Json = {
      results: [
        { option_id: 'opt_a', option_label: label, win_probability: 0.45 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
      ],
    };
    expect(`${label}${fixed}`.length).toBe(MAX_HEADLINE_CHARS + 5);
    for (const e of [enrichment, { ...enrichment, inference_warnings: SERVED_GOAL_WARNINGS }]) {
      const input: AnalysisResultHeadlineInput = { enrichment: e, leading_option_id: 'opt_a', status_kind: 'ok' };
      expect(buildAnalysisResultHeadline(input)).toBeNull();
      expect(describeAnalysisHeadline(input).reason).toBe('low_margin');
    }
  });

  it('a Case A that sheds to Case C today by a few characters sheds to Case C with the codes present', () => {
    const lead = ' scored highest against your goal in 62% of runs of this model';
    const tail = ', but treat this as provisional: the result is sensitive to Hiring and Salary Cost.';
    const label = `Plan ${'L'.repeat(MAX_HEADLINE_CHARS - lead.length - tail.length - 5 + 5)}`;
    expect(`${label}${lead}${tail}`.length).toBe(MAX_HEADLINE_CHARS + 5);
    const enrichment: Json = {
      results: [
        { option_id: 'opt_a', option_label: label, win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
      ],
      robustness: {
        level: 'moderate',
        fragile_edges: [{ from_label: 'Hiring and Salary Cost', to_label: 'Outcome', switch_probability: 0.45 }],
      },
    };
    const clean: AnalysisResultHeadlineInput = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' };
    const warned: AnalysisResultHeadlineInput = {
      enrichment: { ...enrichment, inference_warnings: SERVED_GOAL_WARNINGS },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    };
    expect(buildAnalysisResultHeadline(clean)).toBe(`${label} currently leads${tail}`);
    expect(describeAnalysisHeadline(clean).case).toBe('C');
    expect(describeAnalysisHeadline(warned)).toEqual(describeAnalysisHeadline(clean));
    expect(buildAnalysisResultHeadline(warned)).toBe(`${label} currently leads${tail}${DISCLOSURE}`);
  });
});

// ============================================================================
// T6: every goal-claim path in the headline builder
// ============================================================================

/**
 * One row per goal-claim path the context map lists in
 * `analysis-result-headline.ts`. `today` is the output captured from the
 * UNCHANGED source with no goal code (so it proves the path is reached AND
 * that it claims the goal); `untested` is what the same input must produce
 * with the served goal warnings present.
 *
 * ⚠ NOT COVERED HERE, AND WHY (they are not in this builder):
 *   - objective-contradiction.ts Arm B ("… scored highest against your goal
 *     most often, but … is more likely to reach your stated target") needs a
 *     `probability_of_goal` on at least two records. The served t2 records
 *     carry none: with GOAL_THRESHOLD_NOT_CONVERTIBLE the stated level was
 *     never converted into the samples' frame. Whether PLoT can emit
 *     `probability_of_goal` beside GOAL_DIRECTION_UNATTESTED alone is
 *     UNVERIFIED. If it can, Arm B still claims the goal. Arm A needs a
 *     direction CEE derives from the goal label, and so can co-occur with
 *     GOAL_DIRECTION_UNATTESTED. Both are a separate change to
 *     objective-contradiction.ts, outside this lane's scope (only the lead
 *     clause is in scope, and that tail's permission is `headline !== null`,
 *     which this change leaves alone).
 *   - compose/winner-naming-egress-guard.ts's lead mirror is on the decision-
 *     review narrative, not on this builder's output. Also a separate change.
 */
interface PathRow {
  readonly path: string;
  readonly enrichment: Json;
  readonly expectedCase: string;
  readonly today: string;
  readonly untested: string;
}

const PATHS: readonly PathRow[] = [
  {
    path: 'Case A (margin + provisional caution) :1155',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
      ],
      factor_sensitivity: [{ label: 'Technical Leadership in Place', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }],
      robustness: {
        level: 'moderate',
        fragile_edges: [{ from_label: 'Hiring and Salary Cost', to_label: 'Outcome', switch_probability: 0.45 }],
      },
    },
    expectedCase: 'A',
    today:
      'Hire One Senior Technical Lead scored highest against your goal in 62% of runs of this model, but treat this as provisional: the result is sensitive to Hiring and Salary Cost.',
    untested:
      'Hire One Senior Technical Lead scored highest in 62% of runs of this model, but treat this as provisional: the result is sensitive to Hiring and Salary Cost.' +
      DISCLOSURE,
  },
  {
    path: 'Case B with margin (driver) :1174',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
      ],
      factor_sensitivity: [{ label: 'Technical Leadership in Place', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }],
      robustness: { level: 'moderate' },
    },
    expectedCase: 'B',
    today:
      'Hire One Senior Technical Lead scored highest against your goal in 62% of runs of this model because Technical Leadership in Place is the strongest driver.',
    untested:
      'Hire One Senior Technical Lead scored highest in 62% of runs of this model because Technical Leadership in Place is the strongest driver.' +
      DISCLOSURE,
  },
  {
    path: 'Case D, margin :1193',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
      ],
    },
    expectedCase: 'D',
    today: 'Option A scored highest against your goal in 62% of runs of this model.',
    untested: 'Option A scored highest in 62% of runs of this model.' + DISCLOSURE,
  },
  {
    path: 'Case D, probability / single option :1214',
    enrichment: { results: [{ option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 }] },
    expectedCase: 'D',
    today:
      'Option A scored highest against your goal in 62% of runs of this model. Run the follow-up checks before treating this as final.',
    untested:
      'Option A scored highest in 62% of runs of this model. Run the follow-up checks before treating this as final.' +
      DISCLOSURE,
  },
  {
    path: 'NT override, winner >= 0.40 :1263',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.55 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.45 },
      ],
      robustness: { near_tie: { is_tie: true } },
    },
    expectedCase: 'NT',
    today: 'Option A scored highest against your goal in 55% of runs of this model, but the analysis treats this as a close call.',
    untested: 'Option A scored highest in 55% of runs of this model, but the analysis treats this as a close call.' + DISCLOSURE,
  },
  {
    path: 'NT close (1pp < margin < 5pp) :1272',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.45 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
      ],
    },
    expectedCase: 'NT',
    today: 'Option A scored highest against your goal in 45% of runs of this model, but the options are close.',
    untested: 'Option A scored highest in 45% of runs of this model, but the options are close.' + DISCLOSURE,
  },
  {
    path: 'NT override, winner below 0.40 :1323',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.38 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.32 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.3 },
      ],
      robustness: { near_tie: { is_tie: true } },
    },
    expectedCase: 'NT',
    today: 'Option A scored highest against your goal in 38% of runs of this model, but the analysis treats this as a close call.',
    untested: 'Option A scored highest in 38% of runs of this model, but the analysis treats this as a close call.' + DISCLOSURE,
  },
  {
    path: 'SC soft confidence :1407',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.33 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.22 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.2 },
      ],
      factor_sensitivity: [{ label: 'Launch Timing', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }],
    },
    expectedCase: 'SC',
    today:
      'Option A scored highest against your goal in 33% of runs of this model, but treat this as provisional: the result is sensitive to Launch Timing.',
    untested:
      'Option A scored highest in 33% of runs of this model, but treat this as provisional: the result is sensitive to Launch Timing.' +
      DISCLOSURE,
  },
  {
    // The eliminated tail says "scored highest in less than 1% of runs" and
    // makes no goal claim of its own; it rides AFTER the disclosure.
    path: 'eliminated-options tail (two options < 1%) :314',
    enrichment: {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.37 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.005 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.005 },
      ],
    },
    expectedCase: 'D',
    today:
      'Option A scored highest against your goal in 62% of runs of this model. 2 options are effectively eliminated (each scored highest in less than 1% of runs).',
    untested:
      'Option A scored highest in 62% of runs of this model.' +
      DISCLOSURE +
      ' 2 options are effectively eliminated (each scored highest in less than 1% of runs).',
  },
];

describe('T6 — every goal-claim path withdraws the claim when a goal code is present', () => {
  for (const row of PATHS) {
    describe(row.path, () => {
      const clean: AnalysisResultHeadlineInput = { enrichment: row.enrichment, leading_option_id: 'opt_a', status_kind: 'ok' };

      it('CONTROL: without a goal code the path is reached and claims the goal, exactly as today', () => {
        expect(buildAnalysisResultHeadline(clean)).toBe(row.today);
        expect(row.today).toMatch(/scored highest against your goal in \d+% of runs of this model/);
        expect(describeAnalysisHeadline(clean).case).toBe(row.expectedCase);
      });

      for (const [variant, codes] of [
        ['both codes', [DIRECTION, THRESHOLD]],
        [`${THRESHOLD} alone`, [THRESHOLD]],
        [`${DIRECTION} alone`, [DIRECTION]],
      ] as const) {
        it(`${variant}: no goal claim, the disclosure, same case, passes every copy gate`, () => {
          const warned: AnalysisResultHeadlineInput = {
            ...clean,
            enrichment: {
              ...row.enrichment,
              inference_warnings: SERVED_GOAL_WARNINGS.filter((w) => (codes as readonly string[]).includes(w['code'] as string)),
            },
          };
          const text = buildAnalysisResultHeadline(warned);
          expect(text).toBe(row.untested);
          expectNoGoalClaim(text!);
          expectPassesCopyGates(text!);
          expect(describeAnalysisHeadline(warned)).toEqual(describeAnalysisHeadline(clean));
        });
      }
    });
  }
});

describe('T6 — the shapes that never claimed the goal carry the disclosure and nothing else changes', () => {
  const NON_CLAIMING: ReadonlyArray<[string, Json, string, string]> = [
    [
      'Case E floor (weak plurality, clear of the field)',
      {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.29 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.1 },
          { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.1 },
        ],
      },
      'E',
      'Option A currently leads.',
    ],
    [
      'NT margin (<= 1pp, effectively tied)',
      {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.41 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.4 },
        ],
      },
      'NT',
      'Option A is currently only fractionally ahead, so the options are effectively tied.',
    ],
    [
      'D-W leader trails marginally',
      {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.45 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.5 },
        ],
      },
      'LT',
      'Option A leads overall, though Option B has marginally better raw probability.',
    ],
  ];

  for (const [name, enrichment, expectedCase, today] of NON_CLAIMING) {
    it(`${name}: unchanged without a code; the same sentence plus the disclosure with one`, () => {
      const clean: AnalysisResultHeadlineInput = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' };
      const warned: AnalysisResultHeadlineInput = {
        ...clean,
        enrichment: { ...enrichment, inference_warnings: SERVED_GOAL_WARNINGS },
      };
      expect(buildAnalysisResultHeadline(clean)).toBe(today);
      expect(describeAnalysisHeadline(clean).case).toBe(expectedCase);
      const text = buildAnalysisResultHeadline(warned);
      expect(text).toBe(`${today}${DISCLOSURE}`);
      expectNoGoalClaim(text!);
      expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
      expect(describeAnalysisHeadline(warned)).toEqual(describeAnalysisHeadline(clean));
    });
  }

  it('status and not-robust suffixes still compose, in order, after the disclosure', () => {
    const enrichment: Json = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
      ],
      robustness: { level: 'low' },
      inference_warnings: SERVED_GOAL_WARNINGS,
    };
    const text = buildAnalysisResultHeadline({ enrichment, leading_option_id: 'opt_a', status_kind: 'partial' });
    expect(text).toBe(
      'Option A scored highest in 62% of runs of this model.' +
        DISCLOSURE +
        ' The result is not yet robust — small changes could flip it.' +
        ' The run was flagged as partial — treat as provisional.',
    );
    expectNoGoalClaim(text!);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
});

// ============================================================================
// The egress grammar admits exactly what the builder emits
// ============================================================================

describe('egress grammar — the withdrawn clause and the disclosure travel together', () => {
  it('REJECTS the goal claim WITH the disclosure (a sentence that contradicts itself)', () => {
    expect(isAllowedRunAnalysisAssistantText(`${TODAY}${DISCLOSURE}`)).toBe(false);
  });

  it('REJECTS the withdrawn clause WITHOUT the disclosure (the user is not told why the goal is gone)', () => {
    expect(isAllowedRunAnalysisAssistantText(UNTESTED.slice(0, -DISCLOSURE.length))).toBe(false);
  });

  it('still ADMITS today\'s goal-framed headline with no disclosure', () => {
    expect(isAllowedRunAnalysisAssistantText(TODAY)).toBe(true);
  });

  it('REJECTS the disclosure reworded (the slot is exact)', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Raise to £59 scored highest in 81% of runs of this model because Active paid seats is the strongest driver. The model could not check your goal.',
      ),
    ).toBe(false);
  });
});

// ============================================================================
// The budget term is summed (no behavioural test can see it)
// ============================================================================

describe('the disclosure is budgeted in MAX_ASSISTANT_TEXT_CHARS', () => {
  const HEADLINE_SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../analysis-result-headline.ts'),
    'utf8',
  );
  const SUM_EXPR = (() => {
    const start = HEADLINE_SRC.indexOf('export const MAX_ASSISTANT_TEXT_CHARS');
    return start < 0 ? '' : HEADLINE_SRC.slice(start, HEADLINE_SRC.indexOf(';', start) + 1);
  })();

  it('POSITIVE CONTROL — the extraction found the sum, with a sibling term in it', () => {
    expect(SUM_EXPR.length).toBeGreaterThan(50);
    expect(SUM_EXPR).toContain('MAX_HEADLINE_CHARS');
    expect(SUM_EXPR).toContain('REDUCED_SAMPLES_SUFFIX.length');
  });

  it('NEGATIVE CONTROL — it does not find a term that is not there', () => {
    expect(SUM_EXPR).not.toContain('DEFINITELY_NOT_A_BUDGET_MAX_CHARS');
  });

  it('⭐ the untestable-goal disclosure is a term of the sum', () => {
    expect(SUM_EXPR).toContain('GOAL_UNTESTED_DISCLOSURE.length');
  });
});
