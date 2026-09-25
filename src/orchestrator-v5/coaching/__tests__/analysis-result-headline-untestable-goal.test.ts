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
 * THE FIX. When either code is present, the lead clause drops the goal frame
 * ("scored highest in N% of runs of this model", the same statistic and the
 * same scope clause) and the headline adds ONE fixed sentence, chosen by what
 * the run's own data makes true (F3):
 *   - GOAL_THRESHOLD_NOT_CONVERTIBLE present, OR no per-option record carries a
 *     unit-interval `probability_of_goal`:
 *       "The model could not test whether any option reaches your goal."
 *   - otherwise (GOAL_DIRECTION_UNATTESTED alone, attainment data present):
 *       "The analysis was not told which way your goal points, so it assumed a
 *        higher value is better."
 *     No attainment claim: PLoT's own warning says the run "ranked by largest
 *     goal value. That is an assumption", and goal-direction.ts records that
 *     ISL runs the maximiser whenever no direction is sent.
 *
 * WHAT THIS FILE PINS, EXACTLY (the headline builder only):
 *   T1–T3  the served t2 block (both codes, each code alone) withdraws the goal
 *          claim, and its served summary composition is admitted at egress.
 *   T4     CONTROL: no code, no channel, an unrelated code → byte-identical.
 *   T5     LEADER PERMISSION: the six withhold inputs and two synthetic
 *          withholds give null and the same descriptor with and without codes.
 *   F2     LENGTH NEUTRALITY AT ALL EIGHT `leadCap` SITES (Case A, Case B
 *          margin, Case D margin, Case D single option, NT override ≥ 0.40,
 *          NT close, NT override < 0.40, SC margin): at the cap the site is
 *          reached and names the leader either way; 5 characters over, the
 *          outcome (null / non-null), the case and the shed text are the same
 *          with and without codes, for every code variant and both sentences.
 *          Setting any one site's cap back to `lengthCap` turns its row RED.
 *   T6     every goal-claim path, per code variant; the non-claiming shapes.
 *   F3     the sentence choice, both branches, with a `probability_of_goal`
 *          present control and the unit-interval rule; both pass every gate.
 *   F4     NON-MEMBER CONTROL: GOAL_ANCESTOR_DATA_GAP (served PLoT 5039cca)
 *          does NOT withdraw the claim; a "GOAL_* prefix" predicate turns RED.
 *   egress the withdrawn clause and the sentence travel together.
 *   budget the sentence's worst case is a term of MAX_ASSISTANT_TEXT_CHARS.
 *
 * NOT PINNED HERE, AND WHERE IT IS: the COMPOSED summary (headline + the
 * objective-contradiction tail run-analysis.ts appends) is pinned in
 * `tools/handlers/__tests__/run-analysis-untestable-goal-composed-summary.test.ts`.
 * NOT PINNED ANYWHERE (out of scope, a follow-up): the decision-review
 * narrative's lead in `compose/winner-naming-egress-guard.ts` still says
 * "against your goal".
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
  describeGoalFrame,
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
 * The OTHER sentence (F3): GOAL_DIRECTION_UNATTESTED alone on a run that DID
 * carry attainment data. Bound by identity, spelled here, never imported.
 */
const DIRECTION_DISCLOSURE =
  ' The analysis was not told which way your goal points, so it assumed a higher value is better.';

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
  const rest = text.split(DISCLOSURE).join('').split(DIRECTION_DISCLOSURE).join('');
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
});

// ============================================================================
// F2: length neutrality at EVERY lead-clause site
// ============================================================================

/**
 * ⚠ THE LENGTH WINDOW, PINNED PER SITE. The withdrawn opening is 18 characters
 * SHORTER than the goal-framed one. Measured against the unreduced cap, a
 * candidate that overflows by 1–18 characters today would FIT once a code is
 * present: a shed shape would become the stronger one, and a near-tie that
 * overflows (null, no leader) would become a NAMED leader. The builder measures
 * every candidate that carries the lead clause against `leadCap`, which is the
 * cap reduced by exactly those 18 characters.
 *
 * One row per `leadCap` site in `computeHeadline`, eight in all. Each row runs:
 *   AT THE CAP   the goal-framed candidate is exactly MAX_HEADLINE_CHARS, so the
 *                site is REACHED and names the leader with and without codes
 *                (a positive control: the row is testing the site it names);
 *   5 OVER       the same row's outcome, case and shed text are identical with
 *                and without codes. With the site's cap set back to
 *                `lengthCap` the withdrawn candidate fits and the row goes RED.
 * Every code variant runs, including the one that carries the OTHER sentence
 * (GOAL_DIRECTION_UNATTESTED with attainment data), so neutrality is shown for
 * both sentence lengths.
 */
const GOAL_FRAMED_OPENING = 'scored highest against your goal in';
const WITHDRAWN_OPENING = 'scored highest in';

interface LeadCapSiteRow {
  readonly site: string;
  readonly caseAtCap: string;
  /** The goal-framed candidate the site measures (a clean run carries no tails). */
  readonly candidate: (label: string) => string;
  readonly records: (label: string) => Json[];
  readonly extra?: Json;
  /** The CLEAN run's text when the candidate is 5 over: the shed shape, or null (withheld). */
  readonly shed: ((label: string) => string) | null;
  readonly shedCase: string | null;
}

const PROVISIONAL_HIRING = ', but treat this as provisional: the result is sensitive to Hiring and Salary Cost.';
const DRIVER_TECH_LEAD = ' because Technical Leadership in Place is the strongest driver.';
const PROVISIONAL_LAUNCH = ', but treat this as provisional: the result is sensitive to Launch Timing.';

const LEAD_CAP_SITES: readonly LeadCapSiteRow[] = [
  {
    site: 'Case A (margin + provisional caution)',
    caseAtCap: 'A',
    candidate: (l) => `${l} ${GOAL_FRAMED_OPENING} 62% of runs of this model${PROVISIONAL_HIRING}`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.62 },
      { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
    ],
    extra: {
      robustness: {
        level: 'moderate',
        fragile_edges: [{ from_label: 'Hiring and Salary Cost', to_label: 'Outcome', switch_probability: 0.45 }],
      },
    },
    shed: (l) => `${l} currently leads${PROVISIONAL_HIRING}`,
    shedCase: 'C',
  },
  {
    site: 'Case B with margin (driver)',
    caseAtCap: 'B',
    candidate: (l) => `${l} ${GOAL_FRAMED_OPENING} 62% of runs of this model${DRIVER_TECH_LEAD}`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.62 },
      { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
    ],
    extra: {
      factor_sensitivity: [{ label: 'Technical Leadership in Place', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }],
      robustness: { level: 'moderate' },
    },
    shed: (l) => `${l} currently leads${DRIVER_TECH_LEAD}`,
    shedCase: 'B',
  },
  {
    site: 'Case D, margin',
    caseAtCap: 'D',
    candidate: (l) => `${l} ${GOAL_FRAMED_OPENING} 62% of runs of this model.`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.62 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
    ],
    shed: (l) => `${l} currently leads.`,
    shedCase: 'E',
  },
  {
    site: 'Case D, single option',
    caseAtCap: 'D',
    candidate: (l) =>
      `${l} ${GOAL_FRAMED_OPENING} 62% of runs of this model. Run the follow-up checks before treating this as final.`,
    records: (l) => [{ option_id: 'opt_a', option_label: l, win_probability: 0.62 }],
    shed: (l) => `${l} currently leads.`,
    shedCase: 'E',
  },
  {
    site: 'NT override, winner >= 0.40',
    caseAtCap: 'NT',
    candidate: (l) =>
      `${l} ${GOAL_FRAMED_OPENING} 55% of runs of this model, but the analysis treats this as a close call.`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.55 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.45 },
    ],
    extra: { robustness: { near_tie: { is_tie: true } } },
    shed: null,
    shedCase: null,
  },
  {
    site: 'NT close (1pp < margin < 5pp)',
    caseAtCap: 'NT',
    candidate: (l) => `${l} ${GOAL_FRAMED_OPENING} 45% of runs of this model, but the options are close.`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.45 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
    ],
    shed: null,
    shedCase: null,
  },
  {
    site: 'NT override, winner below 0.40',
    caseAtCap: 'NT',
    candidate: (l) =>
      `${l} ${GOAL_FRAMED_OPENING} 38% of runs of this model, but the analysis treats this as a close call.`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.38 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.32 },
      { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.3 },
    ],
    extra: { robustness: { near_tie: { is_tie: true } } },
    shed: null,
    shedCase: null,
  },
  {
    site: 'SC soft confidence, margin',
    caseAtCap: 'SC',
    candidate: (l) => `${l} ${GOAL_FRAMED_OPENING} 33% of runs of this model${PROVISIONAL_LAUNCH}`,
    records: (l) => [
      { option_id: 'opt_a', option_label: l, win_probability: 0.33 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
      { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.22 },
      { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.2 },
    ],
    extra: {
      factor_sensitivity: [{ label: 'Launch Timing', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }],
    },
    shed: (l) => `${l} currently leads${PROVISIONAL_LAUNCH}`,
    shedCase: 'SC',
  },
];

interface CodeVariant {
  readonly name: string;
  readonly codes: readonly string[];
  /** Whether the records carry a unit-interval `probability_of_goal`. */
  readonly attainment: boolean;
  /** The sentence this variant must carry. */
  readonly sentence: string;
}

const CODE_VARIANTS: readonly CodeVariant[] = [
  { name: 'both codes', codes: [DIRECTION, THRESHOLD], attainment: true, sentence: DISCLOSURE },
  { name: `${THRESHOLD} alone`, codes: [THRESHOLD], attainment: true, sentence: DISCLOSURE },
  { name: `${DIRECTION} alone, no attainment data`, codes: [DIRECTION], attainment: false, sentence: DISCLOSURE },
  {
    name: `${DIRECTION} alone, attainment data present`,
    codes: [DIRECTION],
    attainment: true,
    sentence: DIRECTION_DISCLOSURE,
  },
];

/** A label that makes `row.candidate(label)` exactly `target` characters long. */
function labelFor(row: LeadCapSiteRow, target: number): string {
  const fixed = row.candidate('').length;
  const label = `Option ${'L'.repeat(target - fixed - 'Option '.length)}`;
  expect(row.candidate(label).length).toBe(target);
  return label;
}

function siteInputs(
  row: LeadCapSiteRow,
  label: string,
  variant: CodeVariant,
): { clean: AnalysisResultHeadlineInput; warned: AnalysisResultHeadlineInput } {
  const records = row.records(label).map((r, i) =>
    variant.attainment ? { ...r, probability_of_goal: i === 0 ? 0.3 : 0.2 } : r,
  );
  const enrichment: Json = { results: records, ...(row.extra ?? {}) };
  const warnings = SERVED_GOAL_WARNINGS.filter((w) => variant.codes.includes(w['code'] as string));
  expect(warnings.map((w) => w['code'])).toEqual(variant.codes.length === 2 ? [DIRECTION, THRESHOLD] : variant.codes);
  return {
    clean: { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' },
    warned: { enrichment: { ...enrichment, inference_warnings: warnings }, leading_option_id: 'opt_a', status_kind: 'ok' },
  };
}

describe('F2 — every leadCap site gives the same outcome, case and shed with and without the codes', () => {
  it('the table covers the eight sites, once each', () => {
    expect(LEAD_CAP_SITES.map((r) => r.site)).toHaveLength(8);
    expect(new Set(LEAD_CAP_SITES.map((r) => r.site)).size).toBe(8);
  });

  for (const row of LEAD_CAP_SITES) {
    describe(row.site, () => {
      for (const variant of CODE_VARIANTS) {
        it(`${variant.name}: AT THE CAP the site is reached and names the leader either way`, () => {
          const label = labelFor(row, MAX_HEADLINE_CHARS);
          const { clean, warned } = siteInputs(row, label, variant);
          expect(buildAnalysisResultHeadline(clean)).toBe(row.candidate(label));
          expect(describeAnalysisHeadline(clean).case).toBe(row.caseAtCap);
          expect(buildAnalysisResultHeadline(warned)).toBe(
            row.candidate(label).replace(GOAL_FRAMED_OPENING, WITHDRAWN_OPENING) + variant.sentence,
          );
          expect(describeAnalysisHeadline(warned)).toEqual(describeAnalysisHeadline(clean));
        });

        it(`${variant.name}: 5 OVER the cap, the same outcome, case and shed with the codes as without`, () => {
          const label = labelFor(row, MAX_HEADLINE_CHARS + 5);
          const { clean, warned } = siteInputs(row, label, variant);
          const cleanText = buildAnalysisResultHeadline(clean);
          // The clean run is pinned to TODAY's behaviour, so the row proves the
          // window is real: the site itself did not fire.
          expect(cleanText).toBe(row.shed === null ? null : row.shed(label));
          expect(describeAnalysisHeadline(clean).case).toBe(row.shedCase);
          if (row.shed === null) expect(describeAnalysisHeadline(clean).reason).toBe('low_margin');
          // ⭐ THE PIN: nothing about the decision moves when a code is present.
          expect(describeAnalysisHeadline(warned)).toEqual(describeAnalysisHeadline(clean));
          expect(buildAnalysisResultHeadline(warned)).toBe(cleanText === null ? null : `${cleanText}${variant.sentence}`);
        });
      }
    });
  }
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
 * ⚠ NOT COVERED HERE (they are not in this builder):
 *   - objective-contradiction.ts Arms A and B, which run-analysis.ts appends
 *     after the headline. They take the headline builder's goal-frame verdict
 *     (`describeGoalFrame`) and are pinned on the COMPOSED summary, per code
 *     variant and per arm, in
 *     `tools/handlers/__tests__/run-analysis-untestable-goal-composed-summary.test.ts`.
 *   - compose/winner-naming-egress-guard.ts's lead mirror is on the decision-
 *     review narrative, not on this builder's output. Out of scope; a
 *     follow-up. It still says "against your goal".
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
// F3: the sentence is the one the run's own data makes true
// ============================================================================

/**
 * The served t2 records with a `probability_of_goal` added to each. The capture
 * carries none (GOAL_THRESHOLD_NOT_CONVERTIBLE: the level was never converted),
 * so this is the PRESENT control the F3 rule needs.
 */
function withAttainment(enrichment: Json, value: unknown = 0.4): Json {
  const copy = structuredClone(enrichment);
  copy['option_comparison'] = (copy['option_comparison'] as Json[]).map((r) => ({
    ...r,
    probability_of_goal: r['option_id'] === SERVED_LEADING_OPTION_ID ? 0.1 : value,
  }));
  return copy;
}

const LEAD_SENTENCE = 'Raise to £59 scored highest in 81% of runs of this model because Active paid seats is the strongest driver.';

describe('F3 — "could not test" only where it is true; otherwise a sentence with no attainment claim', () => {
  it('PRECONDITION: the served records carry no probability_of_goal, and the variant does', () => {
    for (const r of SERVED_ENRICHMENT['option_comparison'] as Json[]) expect(r['probability_of_goal']).toBeUndefined();
    for (const r of withAttainment(SERVED_ENRICHMENT)['option_comparison'] as Json[]) {
      expect(typeof r['probability_of_goal']).toBe('number');
    }
  });

  const BRANCHES: ReadonlyArray<[string, Json, string, string]> = [
    ['both codes, attainment data present', withAttainment(SERVED_ENRICHMENT), DISCLOSURE, 'attainment_untested'],
    ['both codes, no attainment data', SERVED_ENRICHMENT, DISCLOSURE, 'attainment_untested'],
    [`${THRESHOLD} alone, attainment data present`, withGoalCodes(withAttainment(SERVED_ENRICHMENT), [THRESHOLD]), DISCLOSURE, 'attainment_untested'],
    [`${THRESHOLD} alone, no attainment data`, withGoalCodes(SERVED_ENRICHMENT, [THRESHOLD]), DISCLOSURE, 'attainment_untested'],
    [`${DIRECTION} alone, no attainment data`, withGoalCodes(SERVED_ENRICHMENT, [DIRECTION]), DISCLOSURE, 'attainment_untested'],
    [`⭐ ${DIRECTION} alone, attainment data present`, withGoalCodes(withAttainment(SERVED_ENRICHMENT), [DIRECTION]), DIRECTION_DISCLOSURE, 'direction_assumed'],
  ];

  for (const [name, enrichment, sentence, frame] of BRANCHES) {
    it(`${name}: carries exactly its sentence, makes no goal claim, passes every copy gate`, () => {
      const text = buildAnalysisResultHeadline(served(enrichment));
      expect(text).toBe(`${LEAD_SENTENCE}${sentence}`);
      // Exactly one of the two sentences, never both.
      const other = sentence === DISCLOSURE ? DIRECTION_DISCLOSURE : DISCLOSURE;
      expect(text).not.toContain(other.trim());
      expectNoGoalClaim(text!);
      expectPassesCopyGates(text!);
      expect(describeGoalFrame(served(enrichment))).toBe(frame);
      // The sentence choice never moves the decision.
      expect(describeAnalysisHeadline(served(enrichment))).toEqual(
        describeAnalysisHeadline(served(withGoalCodes(enrichment, []))),
      );
    });
  }

  it('CONTROL: attainment data with NO code is byte-identical to today and the frame stands', () => {
    const enrichment = withGoalCodes(withAttainment(SERVED_ENRICHMENT), []);
    expect(buildAnalysisResultHeadline(served(enrichment))).toBe(TODAY);
    expect(describeGoalFrame(served(enrichment))).toBe('goal_framed');
  });

  it('the attainment test is the UNIT-INTERVAL one: 1.5, -0.1, NaN or a string is not attainment data', () => {
    for (const junk of [1.5, -0.1, Number.NaN, '0.4', null]) {
      const e = withGoalCodes(withAttainment(SERVED_ENRICHMENT, junk), [DIRECTION]);
      // The leader's own record still carries 0.1, so one unit value is present:
      // strip it too, leaving only the junk.
      for (const r of e['option_comparison'] as Json[]) {
        if (r['option_id'] === SERVED_LEADING_OPTION_ID) r['probability_of_goal'] = junk;
      }
      expect(buildAnalysisResultHeadline(served(e)), `junk ${String(junk)}`).toBe(`${LEAD_SENTENCE}${DISCLOSURE}`);
      expect(describeGoalFrame(served(e))).toBe('attainment_untested');
    }
  });

  it('ONE unit-interval value on ANY record is attainment data (0 counts: it is a measured zero)', () => {
    const e = withGoalCodes(SERVED_ENRICHMENT, [DIRECTION]);
    (e['option_comparison'] as Json[])[2]!['probability_of_goal'] = 0;
    expect(buildAnalysisResultHeadline(served(e))).toBe(`${LEAD_SENTENCE}${DIRECTION_DISCLOSURE}`);
  });

  it('the direction sentence rides every emitted case too (Case E floor, with the not-robust tail after it)', () => {
    const enrichment: Json = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.29, probability_of_goal: 0.2 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.1, probability_of_goal: 0.3 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.1 },
      ],
      robustness: { level: 'low' },
      inference_warnings: SERVED_GOAL_WARNINGS.filter((w) => w['code'] === DIRECTION),
    };
    const text = buildAnalysisResultHeadline({ enrichment, leading_option_id: 'opt_a', status_kind: 'ok' });
    expect(text).toBe(
      `Option A currently leads.${DIRECTION_DISCLOSURE} The result is not yet robust — small changes could flip it.`,
    );
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
});

// ============================================================================
// F4: a GOAL_* code that is NOT one of the two does not withdraw the claim
// ============================================================================

/** Served PLoT 5039cca, CEE agent lane (the capture the binding suite pins). */
const CAPTURE_5039CCA = JSON.parse(
  readFileSync(
    new URL('../../agent-lane/__tests__/fixtures/served-run-analysis-fact-for-binding.json', import.meta.url),
    'utf8',
  ),
) as { result: { enrichment: Json; leading_option_id: string } };
const CAPTURE_5039CCA_ENRICHMENT = CAPTURE_5039CCA.result.enrichment;
const ANCESTOR_GAP = (CAPTURE_5039CCA_ENRICHMENT['inference_warnings'] as Json[]).find(
  (w) => w['code'] === 'GOAL_ANCESTOR_DATA_GAP',
);

describe('F4 — NON-MEMBER CONTROL: GOAL_ANCESTOR_DATA_GAP does not withdraw the goal claim', () => {
  it('POSITIVE CONTROL: the served 5039cca capture carries a real GOAL_ANCESTOR_DATA_GAP on the warning channel', () => {
    expect(JSON.stringify(CAPTURE_5039CCA_ENRICHMENT['_meta'])).toContain('"plot_build":"5039cca"');
    expect(ANCESTOR_GAP).toBeDefined();
    expect(ANCESTOR_GAP!['code']).toMatch(/^GOAL_/);
    expect(GOAL_CODES).not.toContain(ANCESTOR_GAP!['code']);
  });

  it('⭐ the served t2 block with its goal codes replaced by the served ANCESTOR entry claims the goal exactly as today', () => {
    const e = withGoalCodes(SERVED_ENRICHMENT, []);
    e['inference_warnings'] = [...(e['inference_warnings'] as Json[]), ANCESTOR_GAP!];
    expect((e['inference_warnings'] as Json[]).map((w) => w['code'])).toContain('GOAL_ANCESTOR_DATA_GAP');
    expect(buildAnalysisResultHeadline(served(e))).toBe(TODAY);
    expect(describeGoalFrame(served(e))).toBe('goal_framed');
  });

  it('CONTRAST: the same envelope PLUS a member code does withdraw it (the probe sees a change)', () => {
    const e = withGoalCodes(SERVED_ENRICHMENT, [DIRECTION]);
    e['inference_warnings'] = [...(e['inference_warnings'] as Json[]), ANCESTOR_GAP!];
    expect(buildAnalysisResultHeadline(served(e))).toBe(UNTESTED);
  });

  it('the 5039cca capture itself: ANCESTOR alone keeps the goal frame; with its served DIRECTION code it is withdrawn', () => {
    const input = (e: Json): AnalysisResultHeadlineInput => ({
      enrichment: e,
      leading_option_id: CAPTURE_5039CCA.result.leading_option_id,
      status_kind: 'ok',
    });
    const ancestorOnly = withGoalCodes(CAPTURE_5039CCA_ENRICHMENT, []);
    expect((ancestorOnly['inference_warnings'] as Json[]).map((w) => w['code'])).toContain('GOAL_ANCESTOR_DATA_GAP');
    const kept = buildAnalysisResultHeadline(input(ancestorOnly));
    expect(kept).toMatch(/^Improve Engineering System scored highest against your goal in 66% of runs of this model/);
    const withdrawn = buildAnalysisResultHeadline(input(CAPTURE_5039CCA_ENRICHMENT));
    expect(withdrawn).toMatch(/^Improve Engineering System scored highest in 66% of runs of this model/);
    expect(withdrawn).toContain(DISCLOSURE.trim());
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

  it('the DIRECTION sentence is bound the same way: admitted with the withdrawn clause, rejected with the goal claim', () => {
    expect(isAllowedRunAnalysisAssistantText(`${LEAD_SENTENCE}${DIRECTION_DISCLOSURE}`)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(`${TODAY}${DIRECTION_DISCLOSURE}`)).toBe(false);
  });

  it('REJECTS both sentences together (the builder emits exactly one)', () => {
    expect(isAllowedRunAnalysisAssistantText(`${LEAD_SENTENCE}${DISCLOSURE}${DIRECTION_DISCLOSURE}`)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`${LEAD_SENTENCE}${DIRECTION_DISCLOSURE}${DISCLOSURE}`)).toBe(false);
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

  it('⭐ the goal-frame sentence is a term of the sum, budgeted at the LONGER of its two sentences', () => {
    expect(SUM_EXPR).toContain('GOAL_FRAME_DISCLOSURE_MAX_CHARS');
    const start = HEADLINE_SRC.indexOf('const GOAL_FRAME_DISCLOSURE_MAX_CHARS');
    expect(start).toBeGreaterThan(0);
    const definition = HEADLINE_SRC.slice(start, HEADLINE_SRC.indexOf(';', start) + 1);
    expect(definition).toContain('Math.max(');
    expect(definition).toContain('GOAL_UNTESTED_DISCLOSURE.length');
    expect(definition).toContain('GOAL_DIRECTION_ASSUMED_DISCLOSURE.length');
  });
});
