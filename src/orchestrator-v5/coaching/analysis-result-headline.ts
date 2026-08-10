/**
 * V5 deterministic analysis-result headline builder.
 *
 * Pure helper consumed by the run_analysis handler. Builds a short
 * British-English headline (one or two sentences) from the already-
 * available PLoT V2RunResponseEnvelope fields (leading option label,
 * top driver, fragility) when sufficient data is present. Returns null
 * when data is too thin — the handler then falls back to the locked
 * RUN_ANALYSIS_ASSISTANT_TEMPLATES string.
 *
 * Invariants:
 *  - No LLM call. No I/O. No graph mutation. No telemetry side effects on
 *    the valid path (margin inputs are pre-validated finite probabilities).
 *  - No raw decimals. The leading option's win_probability renders as an
 *    integer % and is the ONLY statistic this headline states.
 *  - ⚠ THE WINNER->RUNNER-UP MARGIN IS NEVER DISPLAYED. It still DECIDES
 *    (hasMeaningfulLead, the near-tie verdict) but it is not shown, because a
 *    difference of two P(argmax) values is not a difference in outcome, cost
 *    or benefit — and it inflates when a THIRD option collapses, so the same
 *    leader can read "leads by 42 points" and "leads by 92 points" on runs it
 *    performed identically in. Decide on the gap; report the leader's own
 *    probability. See `leadClause` in computeHeadline for the full rationale.
 *  - No internal IDs leak (winner / driver / fragility labels are guarded
 *    against ID-shaped strings).
 *  - One short sentence, or one + one status-suffix sentence — never more.
 *    Maximum {@link MAX_HEADLINE_CHARS} characters including any suffix.
 *  - Uses "came out ahead in N% of runs of this model" (numbered bands),
 *    "currently leads" (the number-free floor), "provisional", "sensitive to"
 *    — never "best" / "recommended" / "winner". The scope clause "of this
 *    model" is mandatory on every numbered band: the statistic is arithmetic
 *    over the drafted graph's assumptions, not a measurement of the world.
 *  - "currently leads" is emitted ONLY when the leading option has a
 *    finite win_probability ≥ {@link MIN_LEAD_PROBABILITY} AND, if a
 *    runner-up exists in the same source, the margin is at least
 *    {@link MIN_LEAD_MARGIN}. A plurality leader with a positive but
 *    smaller margin gets an explicit near-tie / close-call line; only
 *    sub-threshold leaders, non-positive margins, and unsanitisable
 *    labels fall back to the locked template by returning null.
 *  - When a fragile assumption exists, the caution copy names ONLY that
 *    reason (never also the driver) so the same factor is never repeated.
 *
 * The registry forwarder ({@link isAllowedRunAnalysisAssistantText})
 * is exported here so the only strings the wire ever sees from
 * run_analysis are either a locked template literal or a string this
 * helper could have emitted. The handler is trusted to call into this
 * module; the registry is the second line of defence.
 */

import {
  readResultsArraySources,
  selectWinner,
  readGraph,
  readRecord,
  readNumber,
  readRobustnessLevel,
  buildNodeLabelMap,
} from './decision-review-enricher.js';
import { readDriverInfluenceScore } from '../../orchestrator/context/driver-influence.js';
import { formatProbabilityMargin } from '../format/format-analysis-value.js';
import { isUsableWinProbability } from '../../orchestrator/context/option-result-source.js';
import { isRecommendableOption } from '../tools/handlers/recommendable-option.js';
import { readRawRobustnessSignals } from './pick-raw-robustness.js';
// NOTE: `NEAR_TIE_PP_THRESHOLD` is deliberately NOT imported any more. Holding
// the constant was what let this file re-derive the near-tie with its own `<=`
// and silently skip the raw `is_tie` override (the round-4 residual). Importing
// only the DECISION FUNCTION makes that regression unrepresentable here.
import { nearTieReasonByMargin } from './robustness-honesty.js';
// Two-argument label guard relocated to the lean context module (single
// source of truth, shared with the projection layer). Distinct from the
// one-argument `sanitiseLabel` in src/utils/label-sanitiser.ts.
import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
// ROADMAP 2.278: the run's own answer to "may this copy claim the result could
// flip?" — the single owner of that rule (see `readFlipClaimPosture`).
import { readFlipClaimPosture } from '../context/flip-threshold-rows.js';
// D-ask-1 (2.11 P0-1): scaffold-disclosure grammar + budget. The suffix copy
// and this allowlist must accept each other or the disclosure is silently
// replaced by the locked-template fallback — the drift pin lives in
// scaffold-disclosure.test.ts.
import {
  SCAFFOLD_ANY_DISCLOSURE_RE_SRC,
  SCAFFOLD_DISCLOSURE_MAX_CHARS,
} from './scaffold-disclosure.js';
// T1 (constraint applied then never evaluated): the gap disclosure is the
// SECOND suffix that may ride on a run_analysis summary, and it needs exactly
// the same three pieces of plumbing as the scaffold one — a published grammar
// (below, in TAIL_PATTERN and TEMPLATE_SUFFIX_ONLY_REGEX), a length budget
// (MAX_ASSISTANT_TEXT_CHARS), and a build-time survival probe in its own
// builder. Shipped without them, it was rejected here and the user received
// only the locked template: the withheld-claim half of the fix survived while
// the "which condition, and how to repair it" half never reached the wire.
import {
  CONSTRAINT_GAP_DISCLOSURE_RE_SRC,
  CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS,
} from './constraint-gap-disclosure.js';
// ROADMAP 2.579: the THIRD suffix that may ride on a run_analysis summary —
// "an option your brief listed is not in the model". Same three pieces of
// plumbing as its two siblings, for the same reason: shipped without them it
// composes correctly and is then rejected here, and the user receives the
// locked template with no error anywhere.
import {
  INTAKE_OPTION_DISCLOSURE_RE_SRC,
  INTAKE_OPTION_DISCLOSURE_MAX_CHARS,
} from './intake-option-disclosure.js';
// P1-3 (derive, don't mirror): the defence-in-depth content rules live in
// their own leaf module so the scaffold-disclosure BUILDER validates its
// composed suffix against the SAME functions this egress allowlist applies
// — a builder-side mirror is exactly the drift class that silently
// swallowed the disclosure for ID-shaped labels ("Plan E_2").
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';

export const MAX_HEADLINE_CHARS = 220;

// ============================================================================
// Lane 3 narration-completeness tails (Mission B — provisional_doctrine_v0)
// ============================================================================

/**
 * Robustness honesty sentence (provisional_doctrine_v0). Appended to the
 * deterministic headline (before any status suffix) when the envelope says
 * the result is not robust: `robustness.is_robust === false` OR
 * `robustness.level === 'low'`. One plain clause — no numbers, no labels.
 */
const NOT_ROBUST_SENTENCE =
  ' The result is not yet robust — small changes could flip it.';

/**
 * ROADMAP 2.278 — the same VERDICT, an honest REASON, for a run whose own flip
 * evidence attests that nothing flips in range.
 *
 * ⚠ THE DEFECT. `isNotRobust` reads `robustness.is_robust` / `.level` — the
 * robustness MARGINALS — and the sentence it selects asserts FLIPPABILITY. The
 * evidence for flippability is `enrichment.flip_thresholds[]`, on the same
 * enrichment object this function already receives whole. It was never read.
 * On the four witnessed staging turns (`witness-2267-raw/`, 2026-08-01)
 * `is_robust` was `false` on every one, so this sentence shipped on every one,
 * while 19 of 19 flip rows came back `structurally_invariant`.
 *
 * ⚠ SCOPE OF WHAT THE EVIDENCE ACTUALLY ATTESTS — the amendment that adversarial
 * review forced, and it is this PR's own defect class turned on its own fix.
 * `flip_thresholds[]` is a PER-FACTOR value sweep: each row attests that THAT
 * factor, moved alone across its tested range, does not change the winner. It
 * does NOT attest that the ranking is invariant to everything. The first draft
 * of this sentence said "the ranking held across everything we varied" — a
 * RUN-LEVEL absolute the same payload refutes: `near_tie.is_tie` is true on 3 of
 * the 4 witnessed turns and `fragile_edges[].switch_probability` reaches 0.663
 * with named alternative winners. A reader holding the enrichment could have
 * falsified the sentence from the object it was derived from. Single-factor
 * scope is the only claim the evidence carries; say exactly that and no more.
 *
 * ⚠ WHY THE VERDICT SURVIVES AND ONLY THE REASON CHANGES. "Not yet robust" is
 * TRUE on those turns: the robustness Monte Carlo really did report an unstable
 * result (`level: very_low`). What is false is the explanation attached to it.
 * Robustness and flip-invariance answer different questions — how big is the
 * lead, versus who holds it — and the witnessed turns are precisely the case
 * where the answers differ. Dropping the sentence entirely would suppress a
 * true caveat; keeping it as written asserts something the engine disproved.
 * So the caveat stays and is re-aimed at the margin.
 *
 * ⚠ NO NUMBERS, NO LABELS — same constraints as its sibling, because it shares
 * the egress grammar and the length budget below, both of which are DERIVED
 * from {@link NOT_ROBUST_SENTENCES} rather than restated. A new variant added
 * to that array is automatically admitted by the grammar and budgeted for; one
 * added anywhere else is silently rejected at egress and the user receives the
 * locked template instead (the failure mode the constraint-gap disclosure hit).
 */
const NOT_ROBUST_NO_FLIP_SENTENCE =
  ' The result is not yet robust — no single factor we tested would change the order on its own, but the margin is not settled.';

/**
 * Every robustness-honesty sentence this module may emit. The grammar
 * (`NOT_ROBUST_RE_SRC`) and the length budget (`MAX_ASSISTANT_TEXT_CHARS`) are
 * both derived from this array — add here, nowhere else.
 */
const NOT_ROBUST_SENTENCES: readonly string[] = [
  NOT_ROBUST_SENTENCE,
  NOT_ROBUST_NO_FLIP_SENTENCE,
];

const NOT_ROBUST_SENTENCE_MAX_CHARS = Math.max(...NOT_ROBUST_SENTENCES.map((s) => s.length));

/**
 * Elimination floor: an option with a finite win_probability strictly below
 * this value is "effectively eliminated". Mirrors the mission wording
 * "<1% win probability".
 */
const ELIMINATED_WIN_PROBABILITY_CEILING = 0.01;

/**
 * Minimum number of effectively-eliminated options before the narration
 * mentions it. One dead option in a two-way race is just the loser; two or
 * more is real information about the field narrowing.
 */
const ELIMINATED_MIN_COUNT = 2;

/**
 * Eliminated-options sentence (provisional_doctrine_v0). Count is always
 * >= ELIMINATED_MIN_COUNT so the plural is fixed. "1%" is an integer
 * percentage (no raw decimal) so the defence-in-depth decimal rule holds.
 */
function eliminatedSentence(count: number): string {
  return ` ${count} options are effectively eliminated (each has less than a 1% chance of winning).`;
}

/**
 * Upper bound for the eliminated-count rendered by the grammar
 * (`\d{1,3}`). An emission with a 4+ digit count would fail the registry
 * grammar and fall back to the locked template — acceptable defence for a
 * pathological >999-option envelope.
 */
const ELIMINATED_SENTENCE_MAX_CHARS = eliminatedSentence(999).length;

// Seam item 3 (CRITIQUE_BUCKETS ruling): honest disclosure when PLoT reduced
// the simulation count for a complex model (SAMPLES_REDUCED_FOR_COMPLEXITY).
// Same voice as the S-bucket replacement in compose/sanitise-enrichment.ts —
// keep the two in sync if either changes. Composes BEFORE the status suffix.
export const REDUCED_SAMPLES_SUFFIX =
  ' Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.';

/**
 * Registry-side maximum length for a deterministic run_analysis
 * assistant_text. The base headline (including any status suffix) is capped
 * at {@link MAX_HEADLINE_CHARS} exactly as before; the Mission B narration
 * tails (robustness honesty + eliminated options) and the seam-item-3
 * reduced-samples disclosure are budgeted on top so honest tails can never
 * force a fallback to a stronger-case shed.
 */
export const MAX_ASSISTANT_TEXT_CHARS =
  MAX_HEADLINE_CHARS +
  // 2.278: derived over EVERY robustness-honesty variant, not just the first.
  NOT_ROBUST_SENTENCE_MAX_CHARS +
  ELIMINATED_SENTENCE_MAX_CHARS +
  REDUCED_SAMPLES_SUFFIX.length +
  // D-ask-1 (2.11 P0-1): the scaffold disclosure suffix rides AFTER every
  // other tail. Budgeted from the builder's own worst case so an honest
  // disclosure can never knock the summary back to the bland fallback.
  SCAFFOLD_DISCLOSURE_MAX_CHARS +
  // T1: the constraint-gap disclosure rides after the scaffold one (matching
  // the handler's append order), and can co-occur with it — a scaffolded run
  // may also have an unevaluated ratified constraint. Same rule: budgeted from
  // the builder's own worst case, never hand-estimated.
  CONSTRAINT_GAP_DISCLOSURE_MAX_CHARS +
  // ROADMAP 2.579: the intake disclosure rides LAST (matching the handler's
  // append order) and can co-occur with both of the above — a scaffolded run
  // with an unevaluated constraint may ALSO be ranking an incomplete candidate
  // set. Same rule: budgeted from the builder's own worst case, never
  // hand-estimated, so an honest disclosure cannot knock the summary back to
  // the locked template on length.
  INTAKE_OPTION_DISCLOSURE_MAX_CHARS;

/**
 * Minimum win_probability for the leading option before the headline may emit a
 * CONFIDENT "currently leads" (cases A–D). A leader below this threshold is too
 * weak to assert a confident lead, regardless of margin. Calibrated against
 * typical 3-way races: 40% is a plausible plurality; below it reads as "no real
 * leader" for a CONFIDENT claim.
 *
 * SOFT-CONFIDENCE BAND (case 'SC', Area F deterministic-copy hardening). The
 * headline now uses a TWO-FLOOR structure:
 *   - >= MIN_LEAD_PROBABILITY (0.40): a CONFIDENT lead may be claimed (A–D).
 *   - [SC_MIN_LEAD_PROBABILITY, MIN_LEAD_PROBABILITY) i.e. [0.30, 0.40): a
 *     "soft confidence" plurality MAY still be named — but ONLY with explicit
 *     provisional caveating ("…but treat this as provisional…") AND only when it
 *     has a real margin (>= MIN_LEAD_MARGIN) AND a driver/fragility. This
 *     increases honest caveating instead of suppressing the lead entirely.
 *   - < SC_MIN_LEAD_PROBABILITY (0.30): too weak to enrich at all — fall back to
 *     the conservative bare Case E floor ("{label} currently leads."), even with
 *     a real margin + driver/fragility. A very weak fragmented plurality (e.g.
 *     0.24 in a 5-way race) technically leads but must not get an enriched
 *     "currently leads by N percentage points" headline.
 */
const MIN_LEAD_PROBABILITY = 0.4;

/**
 * Lower floor of the soft-confidence band (case 'SC'). Inclusive: a winner at
 * exactly 0.30 qualifies; below 0.30 the SC branch is skipped and the headline
 * falls back to the conservative Case E floor. 0.30 preserves the reviewed
 * 0.30/0.25 case while excluding weaker plurality leads.
 */
const SC_MIN_LEAD_PROBABILITY = 0.3;

/**
 * Float tolerance for the inclusive {@link SC_MIN_LEAD_PROBABILITY} floor. The
 * floor is a pure gating threshold with NO displayed probability to match, so —
 * unlike the margin gate, which rounds to whole percentage points to mirror the
 * rendered "<N> percentage points" — it uses a small epsilon to make the
 * `>= 0.30` boundary robust to IEEE-754 representation noise WITHOUT admitting
 * 0.29x values (the next meaningful step down, 0.299, is ~1e-3 below the floor
 * and stays excluded; the epsilon only absorbs ~1e-16 representation drift).
 */
const SC_PROBABILITY_EPSILON = 1e-9;

/**
 * Minimum margin (winner.win_probability − runner_up.win_probability)
 * required before the headline may say "currently leads". Pads above
 * the existing 1pp near-tie threshold used by the advice-gate copy in
 * post-analysis-advice-gate.ts so headline copy is consistently more
 * conservative than free-text follow-ups. When no runner-up entry
 * carries a finite probability (single-option result) the margin
 * check is waived and only {@link MIN_LEAD_PROBABILITY} applies.
 */
const MIN_LEAD_MARGIN = 0.05;

/**
 * Doctrine D-W (ROADMAP 2.52): maximum raw-odds gap (in whole percentage
 * points) between the runner-up and the DECLARED leader for the honest
 * leader-trails disambiguation copy to describe the runner-up as "marginally
 * better". PLoT recommends the declared leader for robustness/stability
 * reasons; that override is credible only across a SMALL raw-odds gap, so
 * "marginally" stays truthful within this bound. A wider gap is not marginal —
 * the copy is suppressed (neutral locked-template floor) rather than assert a
 * false "marginally" or a false "currently leads". 10pp mirrors the
 * `comfortable` margin-bucket ceiling used elsewhere in this file.
 */
const MARGINAL_RAW_ODDS_GAP_PP = 10;

/**
 * Doctrine D-W: minimum raw-odds gap (probability-space) below which the
 * runner-up is a TIE with the declared leader, not "marginally better". A gap
 * under 1pp is effectively no difference, so the copy is suppressed. Kept in
 * probability space (0.01 = 1pp) because the gate compares the UNROUNDED gap —
 * see the branch below for why rounding to whole percentage points was wrong.
 */
const MIN_MARGINAL_RAW_ODDS_GAP = 0.01;

/**
 * IEEE-754 tolerance for the raw-odds gap gate. The gap is a difference of two
 * doubles, so an exactly-on-bound value (e.g. `0.55 − 0.45` evaluates to
 * `0.10000000000000003`, just over 0.10) must not be excluded by
 * floating-point noise. This epsilon is far smaller than the sub-pp resolution
 * the gate needs (it never admits a gap that rounds to a different pp bucket).
 */
const RAW_ODDS_GAP_FLOAT_EPSILON = 1e-9;

const PARTIAL_SUFFIX =
  ' The run was flagged as partial — treat as provisional.';
const UNKNOWN_SUFFIX =
  ' The analysis engine reported an unfamiliar status — treat the result with caution.';

export interface AnalysisResultHeadlineInput {
  readonly enrichment: Record<string, unknown>;
  readonly leading_option_id: string;
  readonly status_kind: 'ok' | 'partial' | 'unknown';
  /**
   * Seam item 3: PLoT reported SAMPLES_REDUCED_FOR_COMPLEXITY for this run.
   * Detection is cage-owned (the presence helper in
   * compose/claim-safety-cage.ts — claim-safety ruling, Option B); this file
   * receives only the boolean and never touches the source field. When true
   * the headline appends {@link REDUCED_SAMPLES_SUFFIX} — a fixed disclosure
   * sentence; no value from the response is interpolated. Budgeted on top of
   * the headline cap (like the Mission B tails) so the disclosure never
   * forces a stronger case to shed information.
   */
  readonly samples_reduced?: boolean;
  /**
   * Spine A backstop: factor_ids an option intervenes on. The top-driver
   * resolver skips these so an option-controlled lever is never named as the
   * strongest sensitivity driver in the run_analysis headline (the headline
   * reads raw `factor_sensitivity`, bypassing `projectTopDrivers`). Keyed on
   * structural `factor_id` only. Omitted / empty ⇒ no suppression.
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  /**
   * Trust-spine board #1 (CEE half). True when the leading option violates a
   * hard constraint (CEE_CONSTRAINT_INFEASIBLE_GATE ON — computed by the
   * run_analysis handler via constraint-feasibility.ts). When true the headline
   * WITHHOLDS the confident "{X} currently leads" claim (returns null → the
   * handler falls back to the neutral template) rather than assert a lead an
   * eligible option cannot back. Omitted / false ⇒ no change (byte-identical).
   * The bespoke honest constraint copy is carried by the coach (compact summary
   * note) + the decision-review winner flag, not by this claim-safety-caged
   * grammar.
   */
  readonly constraint_infeasible?: boolean;
  /**
   * T1. True when a user-ratified hard constraint was applied but never
   * evaluated to decision grade — the `unevaluated` state of the constraint
   * verdict (`deriveConstraintVerdict` in constraint-feasibility.ts, reading
   * PLoT's own `inference_warnings` codes / `constraints_status` / per-option
   * `constraint_probabilities`). When true the headline WITHHOLDS the
   * confident "{X} currently leads" claim — a recommendation must not exist
   * while one of the user's stated conditions is unchecked.
   *
   * DISTINCT FROM {@link constraint_infeasible}: that one means "the leader
   * breaks a limit we DID check"; this one means "we never checked the limit
   * at all". Different claims, different copy, different telemetry reason.
   * Omitted / false ⇒ no change (byte-identical).
   */
  readonly constraint_unevaluated?: boolean;
  /**
   * T1. True for the constraint verdict's `identity_unresolved` state: the
   * producer plainly evaluated constraints, but not one of the ids it returned
   * reconciles with anything the user ratified.
   *
   * THE THIRD ANSWER, and the reason this is not folded into either flag above.
   * We cannot say the condition went unchecked (it may well have been checked
   * under a key we cannot read) and we cannot certify constraint-safety (we
   * cannot tell WHICH condition was checked). So the headline is withheld here
   * too — naming a leader would assert the user's condition holds on evidence
   * CEE has just admitted it cannot reconcile — but under its own reason code,
   * because "we could not tell" must never be logged as either of the two
   * confident verdicts. Omitted / false ⇒ no change (byte-identical).
   */
  readonly constraint_identity_unresolved?: boolean;
  /**
   * ROADMAP 2.579. True when the brief ENUMERATED an option that is not on the
   * graph being ranked — the `options_missing` state of
   * `deriveIntakeOptionReconciliation`
   * (`orchestrator/context/intake-option-reconciliation.ts`), derived by
   * identity-matching the brief's own words against the graph's option labels.
   *
   * WHY THIS WITHHOLDS AND WHAT IT DOES NOT WITHHOLD. "{X} currently leads" is
   * a claim about which option is BEST. It cannot be true over a candidate set
   * that is missing a candidate — the option that was dropped never got a
   * chance to win. The per-option numbers computed on the options that WERE
   * captured are unaffected and stay on screen; only the ranking claim is
   * withheld. That is 2.579's ruling in one line: block the ranking, not the
   * analysis.
   *
   * DISTINCT FROM ALL THREE CONSTRAINT FLAGS ABOVE, and deliberately carried as
   * its own input rather than folded into one of them (CLAUDE.md trap 21).
   * Those answer "was the hard condition the user RATIFIED honoured by this
   * result?" — a question about the RUN. This answers "does the candidate set
   * match what the user ENUMERATED?" — a question about the INTAKE. A run can
   * be `evaluated_feasible` on every ratified constraint and still be ranking
   * four options out of five, and the repair steps have nothing in common:
   * "re-state your condition in the same units" is useless to a user whose
   * option went missing. Own flag, own reason code, own copy.
   *
   * Omitted / false ⇒ no change (byte-identical).
   */
  readonly intake_options_missing?: boolean;
}

/**
 * Which deterministic case the headline builder picked, or `null` when
 * the locked template is the safe fallback.
 *
 *   A — winner + margin + provisional caution naming the fragile reason
 *   B — winner (+ margin) + driver, robust (no fragility)
 *   C — winner + provisional caution (fragile reason), no margin
 *   D — winner + margin, or integer-percent probability (single-option)
 *   E — minimal floor: `{label} currently leads.`
 *   NT — near-tie / close-call: a positive margin below the meaningful-
 *        lead threshold; flags closeness instead of a confident lead
 *   SC — soft-confidence enriched: winner below the absolute confidence
 *        floor BUT with a real margin (>= MIN_LEAD_MARGIN) and a
 *        driver/fragility available; emits a CAUTIOUS provisional headline
 *        (Case A/C copy shapes) instead of collapsing to the bare Case E
 *        floor. Increases honest caveating rather than suppressing it.
 *   null — fall back to locked template
 *
 * Case E is the link-safe response floor (v5/link-safe). It fires when
 * a clean leading-option label exists but the stronger cases failed
 * because of soft confidence (with no usable margin / driver / fragility)
 * or because a length cap forced an A/B/C/D/NT/SC candidate to be dropped.
 */
export type HeadlineCase = 'A' | 'B' | 'C' | 'D' | 'E' | 'NT' | 'SC' | 'LT' | null;

/**
 * Locked reason class for telemetry. Always present on the descriptor
 * (even when a strong case fired) so call sites can branch deterministically.
 *
 *  - `soft_confidence`        — winner probability below MIN_LEAD_PROBABILITY
 *  - `low_margin`             — margin to runner-up below MIN_LEAD_MARGIN
 *  - `no_driver_no_fragility` — meaningful lead but no driver and no fragility data and Case D length-capped out
 *  - `length_cap`             — driver and/or fragility present but the stronger case exceeded MAX_HEADLINE_CHARS
 *  - `unsafe_label`           — leading option label was missing, ID-shaped, UUID, or otherwise rejected by sanitiseLabel
 *  - `unknown`                — a strong case (A/B/C/D) fired; reason is not applicable
 */
export type HeadlineFallbackReason =
  | 'soft_confidence'
  | 'low_margin'
  | 'no_driver_no_fragility'
  | 'length_cap'
  | 'unsafe_label'
  // Trust-spine board #1 (CEE half): the leading option violates a hard
  // constraint, so the confident-lead headline is withheld (see
  // AnalysisResultHeadlineInput.constraint_infeasible).
  | 'constraint_infeasible'
  // T1: a user-ratified hard constraint was applied but never evaluated to
  // decision grade, so the confident-lead headline is withheld (see
  // AnalysisResultHeadlineInput.constraint_unevaluated). Deliberately separate
  // from `constraint_infeasible` — "we never checked your limit" and "the
  // leader breaks your limit" must never be conflated in telemetry.
  | 'constraint_unevaluated'
  // T1: the producer evaluated constraints under ids that reconcile with
  // nothing the user ratified, so neither "your condition was not checked" nor
  // "your condition holds" is assertable and the confident-lead headline is
  // withheld (see AnalysisResultHeadlineInput.constraint_identity_unresolved).
  // Its own reason code, so a seam divergence can never be read off a dashboard
  // as an engine failure to evaluate.
  | 'constraint_identity_unresolved'
  // ROADMAP 2.579: the brief enumerated an option that is not on the graph, so
  // the candidate set being ranked is incomplete and the confident-lead
  // headline is withheld (see AnalysisResultHeadlineInput.intake_options_missing).
  // Deliberately separate from every constraint reason — this is a fact about
  // the INTAKE, not about the run's evidence, and conflating them on the
  // dashboard would hide a drafter defect inside a producer statistic.
  | 'intake_options_missing'
  | 'unknown';

export interface HeadlineDescriptor {
  readonly case: HeadlineCase;
  readonly reason: HeadlineFallbackReason;
  readonly has_leading_option: boolean;
  readonly has_clean_label: boolean;
  readonly has_driver: boolean;
  readonly has_fragility: boolean;
  readonly margin_bucket: 'tight' | 'moderate' | 'comfortable' | null;
}

interface HeadlineResult {
  readonly text: string | null;
  readonly descriptor: HeadlineDescriptor;
}

/**
 * Returns a deterministic headline sentence, or null when fallback to the
 * locked template is the safe choice. The handler should treat null as
 * "use the existing template" — never invent a string from nothing.
 */
export function buildAnalysisResultHeadline(
  input: AnalysisResultHeadlineInput,
): string | null {
  return computeHeadline(input).text;
}

/**
 * Pure introspection helper used by the run_analysis handler to emit
 * `v5.headline.fell_back` telemetry when Case E fires. Shares all
 * internal computation with {@link buildAnalysisResultHeadline}; same
 * pure-function contract (no I/O, no telemetry side effects).
 */
export function describeAnalysisHeadline(
  input: AnalysisResultHeadlineInput,
): HeadlineDescriptor {
  return computeHeadline(input).descriptor;
}

function computeHeadline(input: AnalysisResultHeadlineInput): HeadlineResult {
  const { enrichment, leading_option_id, status_kind, interventionControlledFactorIds } = input;

  // Same-source resolution: the winner label, winner probability, and
  // runner-up probability ALL come from the SAME source array — one of
  // option_comparison[], results[], decision_brief.options[] (and the nested
  // results-object shapes) in the shared CURRENT-first precedence order (see
  // readOptionResultSources). This guards against the round-2 cross-source
  // mixing risk — a clean label from one source paired with stale or
  // inconsistent probability maths from another — and keeps the headline's
  // winner identical to the review/coach surfaces on the same envelope.
  const winner = resolveWinner(enrichment, leading_option_id);
  if (winner === null) {
    // No source produced a winner with a clean label AND a finite
    // probability — fall back to the locked template. Telemetry reports
    // `unsafe_label` as the predominant cause; could also be "no
    // probability anywhere" but that case is rare and the floor is the
    // same.
    return {
      text: null,
      descriptor: {
        case: null,
        reason: 'unsafe_label',
        has_leading_option: false,
        has_clean_label: false,
        has_driver: false,
        has_fragility: false,
        margin_bucket: null,
      },
    };
  }

  // ROADMAP 2.579: the brief enumerated an option that is not on the graph, so
  // the set being ranked is not the set the user asked about. WITHHOLD the
  // confident "{X} currently leads" headline — a "which is best" claim cannot
  // be true over a candidate set missing a candidate. Placed AFTER
  // resolveWinner (so the positive-control winner is still resolved for the
  // descriptor) and BEFORE any "leads" case, exactly like its siblings.
  //
  // FIRST AMONG THE WITHHOLDING CHECKS, and the ordering is a claim, not a
  // convenience: every constraint reason below presupposes there IS a
  // well-formed candidate set for a leader to exist in, and says something
  // about the EVIDENCE gathered on it. When the candidate set itself is
  // incomplete that presupposition fails, so this is the more fundamental
  // answer and the one telemetry should carry. Nothing is lost to the ordering
  // on the USER-FACING side: the run_analysis handler appends the constraint
  // disclosure AND the intake disclosure independently, so a turn that is both
  // constraint-gapped and intake-incomplete still tells the user both things.
  // Only the single `reason` code has to choose.
  if (input.intake_options_missing === true) {
    return {
      text: null,
      descriptor: {
        case: null,
        reason: 'intake_options_missing',
        has_leading_option: true,
        has_clean_label: true,
        has_driver: false,
        has_fragility: false,
        margin_bucket: null,
      },
    };
  }

  // Trust-spine board #1 (CEE half): the leading option violates a hard
  // constraint. WITHHOLD the confident "{X} currently leads" headline — fall
  // back to the neutral template rather than assert a lead an eligible option
  // cannot back. Placed AFTER resolveWinner (so the positive-control winner is
  // still resolved for the descriptor) and BEFORE any "leads" case. Honest
  // constraint copy lives in the coach compact-summary note + the
  // decision-review winner flag, not this claim-safety-caged grammar.
  if (input.constraint_infeasible === true) {
    return {
      text: null,
      descriptor: {
        case: null,
        reason: 'constraint_infeasible',
        has_leading_option: true,
        has_clean_label: true,
        has_driver: false,
        has_fragility: false,
        margin_bucket: null,
      },
    };
  }

  // T1: a user-ratified hard constraint was APPLIED and then never evaluated
  // to decision grade (PLoT CONSTRAINT_OUT_OF_DOMAIN /
  // CONSTRAINT_TARGET_UNRELIABLE / withheld constraint block). A recommendation
  // must not exist while a stated condition is unchecked, so the confident
  // "{X} currently leads" claim is WITHHELD here for the same reason as
  // `constraint_infeasible` — but it is a DIFFERENT claim and carries its own
  // reason code so telemetry can never conflate "the leader breaks your limit"
  // with "we never checked your limit". The copy naming the unchecked
  // condition and its repair step is composed by the run_analysis handler.
  if (input.constraint_unevaluated === true) {
    return {
      text: null,
      descriptor: {
        case: null,
        reason: 'constraint_unevaluated',
        has_leading_option: true,
        has_clean_label: true,
        has_driver: false,
        has_fragility: false,
        margin_bucket: null,
      },
    };
  }

  // T1, the third answer: the producer evaluated constraints, but under ids
  // that reconcile with nothing the user ratified. Withheld for the same
  // claim-safety reason as the two above — naming a leader here asserts that
  // the user's condition holds, on evidence CEE has just admitted it cannot
  // read — but reported under its OWN reason, because conflating "we could not
  // tell" with "the engine did not check" would turn an unenforced-seam
  // divergence into a false accusation against the producer, on the dashboard
  // and in the user-facing copy alike.
  if (input.constraint_identity_unresolved === true) {
    return {
      text: null,
      descriptor: {
        case: null,
        reason: 'constraint_identity_unresolved',
        has_leading_option: true,
        has_clean_label: true,
        has_driver: false,
        has_fragility: false,
        margin_bucket: null,
      },
    };
  }

  const winnerLabel = winner.label;
  const winnerProbability = winner.winnerProb;
  const driverLabel = resolveTopDriverLabel(enrichment, interventionControlledFactorIds);
  // Mission A (provisional_doctrine_v0): the caution candidate replaces the
  // bare fragile label. It is claim-safe by construction — a factor that is
  // option-pinned (sensitivity_score === 0 / zero_reason ===
  // 'intervention_override' / structurally controlled) is never named as
  // "the result is sensitive to X".
  const caution = resolveCautionCandidate(enrichment, interventionControlledFactorIds);
  // Mission B (provisional_doctrine_v0): narration-completeness tail —
  // robustness honesty + eliminated options — appended to EVERY emitted
  // case shape, before the status suffix. The base headline stays within
  // MAX_HEADLINE_CHARS; the tail rides on its own budget (lengthCap) so an
  // honest tail never forces a stronger case to shed information.
  const narrationTail = buildNarrationTail(enrichment, winner);
  // Seam item 3: reduced-samples disclosure rides between the narration
  // tail and the status suffix (mirrored by TAIL_PATTERN in the grammar).
  const reducedSamplesSuffix =
    input.samples_reduced === true ? REDUCED_SAMPLES_SUFFIX : '';
  const suffix = `${narrationTail}${reducedSamplesSuffix}${statusSuffix(status_kind)}`;
  const lengthCap =
    MAX_HEADLINE_CHARS + narrationTail.length + reducedSamplesSuffix.length;
  const marginBucket = computeMarginBucket(winner);
  const hasDriver = driverLabel !== null;
  const hasFragility = caution !== null;

  // Margin fragment (copy priority #2): rendered only when a runner-up
  // probability exists in the SAME source. Uses the SSOT formatter
  // (formatProbabilityMargin) — never a hand-rolled multiply, never a raw
  // decimal. In the meaningful-lead branch the margin is guaranteed
  // ≥ MIN_LEAD_MARGIN (≥ 5pp), so it always renders as a plural integer
  // "<N> percentage points".
  //
  // ⚠ NO LONGER USER-FACING. `marginText` still decides WHETHER a numbered
  // shape is available (a null margin means single-option, which has no
  // meaningful runner-up to have led over) but its TEXT is never emitted —
  // see `leadClause` below for why the pp gap could not stay on screen.
  const marginText = marginPointsText(winner);

  // ==========================================================================
  // The lead clause: the LEADER'S OWN win probability, never the gap
  // ==========================================================================
  //
  // ⚠ WHAT THE OLD COPY CLAIMED, AND WHY IT WAS WITHDRAWN. This slot used to
  // render ` by ${marginText}` — "currently leads by 95 percentage points",
  // the difference between two `P(argmax)` statistics. Three things were wrong
  // with it, and only the third is fixable by wording:
  //
  //  1. CATEGORY ERROR. It is not a difference in outcome, cost or benefit.
  //     "Leads by 95 percentage points" invites "95% better", which it
  //     emphatically is not — nothing about the leader being 95pp clear of the
  //     runner-up says the DECISION is 95% better, or better at all by any
  //     amount the user cares about.
  //  2. IT INFLATES BY CONSTRUCTION, and this is the part no threshold can
  //     repair. The gap is a function of the WHOLE FIELD, so a third option
  //     collapsing widens it with no improvement whatever in the leader. A
  //     92pp headline was measured on a run whose runner-up had itself fallen
  //     to 4%: the number moved because someone else got worse. A statistic
  //     that grows when the field decays cannot be the sentence a user reads
  //     as the strength of their leading option.
  //  3. It was the most confident sentence the product emitted, and confidence
  //     is exactly what a derived-difference statistic has least claim to.
  //
  // WHAT REPLACES IT, and why it is one call away rather than a new
  // computation: `winner.winnerProb` is the leader's own win probability,
  // already resolved from the SAME source array as the label (see
  // resolveWinner), already guaranteed finite and in [0, 1], and already
  // rendered as an integer percentage by the single-option Case D below. So
  // this is a DISPLAY change end to end — no new field, no new derivation, no
  // boundary crossed, and nothing for a consumer on an older schema pin to
  // drop.
  //
  // ⚠ "OF THIS MODEL" IS LOAD-BEARING — DO NOT SHORTEN IT. `win_probability`
  // is the share of Monte Carlo runs OF THE DRAFTED MODEL in which this option
  // came out on top. It is arithmetic over the assumptions in the graph, not a
  // measurement of the world, and the model's numbers are mostly the product's
  // own estimates. Without the scope clause "came out ahead in 72% of runs"
  // reads as a finding; with it, the sentence tells the truth about what was
  // counted. It costs five words and is the difference between a user reading
  // the number as evidence and reading it as a projection of their own inputs.
  //
  // The GATES ARE UNTOUCHED. `hasMeaningfulLead` still gates on the margin
  // (≥ MIN_LEAD_MARGIN) and the near-tie verdict still owns closeness — the
  // margin remains the right thing to DECIDE on, because "is this lead real?"
  // genuinely is a question about the gap. It is only the wrong thing to
  // DISPLAY. Deciding on the gap and reporting the leader's own probability is
  // the whole shape of this change.
  const leadPercent = Math.round(winnerProbability * 100);
  const leadClause = `came out ahead in ${leadPercent}% of runs of this model`;

  // The number-free shed form, kept verbatim for the bands that must not carry
  // a statistic: the Case E floor (every enriching gate declined the run) and
  // the length-shed A→C / B variants, where dropping the clause IS the shed.
  const LEADS_PLAIN = 'currently leads';

  // Doctrine D-W (ROADMAP 2.52): the DECLARED leader (PLoT's leading_option_id)
  // is NOT the highest raw win_probability — a runner-up strictly edges it on
  // raw odds. PLoT can put an option forward OVERALL for robustness/stability
  // reasons even when a rival has marginally better raw odds. Be honest: name
  // the option that leads overall AND disclose the runner-up's better raw
  // probability. NEVER a bare "currently leads" (the declared leader does not
  // lead on raw odds) and never the bland locked template that silently drops
  // the disambiguation. This branch OWNS every leader-trails case: it is
  // entered only when the runner-up's probability is STRICTLY greater than the
  // declared leader's, which cannot happen when leader == argmax (the
  // production run path, where leading_option_id IS the argmax) — so it is
  // byte-identical there and fires only on the genuine declared-leader-≠-argmax
  // residual. Copy/display ONLY: it reads two already-validated probabilities
  // to gate and to name a label; it changes, derives, and emits NO producer
  // number. (Wording note: Paul's ruled copy phrased this "recommended
  // overall"; the run_analysis wire's claim-safety cage bans "recommended" at
  // three layers — the headline forbidden-vocab, the validation-registry
  // allowlist, AND the turn-executor egress FORBIDDEN_USER_FACING_PHRASES guard
  // which REPLACES the whole response on a hit. "leads overall" preserves the
  // ruled MEANING within that cage without weakening the egress guard, which is
  // out of scope for a copy-only change.)
  if (
    winner.runnerUpProb !== null &&
    winner.runnerUpProb > winner.winnerProb
  ) {
    // "marginally better" must be truthful: only a small raw-odds gap, and only
    // when the runner-up label is safe to name. A sub-1pp gap is effectively a
    // tie (not "better"); a gap beyond the marginal bound is not "marginal".
    // In every other leader-trails case return the neutral locked-template
    // floor (null) so we never assert a false "marginally" or a false lead.
    //
    // Gate on the UNROUNDED gap. Rounding the gap to whole percentage points
    // (the prior `Math.round(gap * 100)` bug) admitted BOTH boundaries: a
    // sub-1pp gap that rounds UP to 1pp (0.55 vs 0.5449 → 0.51pp, a tie) and a
    // >10pp gap that rounds DOWN to 10pp (0.55 vs 0.4451 → 10.49pp, not
    // marginal). Compare the true difference against [0.01, 0.10]; the epsilon
    // absorbs IEEE-754 noise so an exactly-10pp gap still qualifies. Rounding is
    // for presentation only (and this copy names no number, so none is needed).
    const rawGap = winner.runnerUpProb - winner.winnerProb;
    if (
      winner.runnerUpLabel !== null &&
      rawGap >= MIN_MARGINAL_RAW_ODDS_GAP - RAW_ODDS_GAP_FLOAT_EPSILON &&
      rawGap <= MARGINAL_RAW_ODDS_GAP_PP / 100 + RAW_ODDS_GAP_FLOAT_EPSILON
    ) {
      const disambig =
        `${winnerLabel} leads overall, though ${winner.runnerUpLabel} has marginally better raw probability.${suffix}`;
      if (disambig.length <= lengthCap) {
        return {
          text: disambig,
          descriptor: buildDescriptor('LT', 'low_margin', { hasDriver, hasFragility, marginBucket }),
        };
      }
    }
    return {
      text: null,
      descriptor: buildDescriptor(null, 'low_margin', { hasDriver, hasFragility, marginBucket }),
    };
  }

  // ---- S4 ROUND 5: the near-tie verdict is decided ONCE, HERE, and it
  // PREEMPTS the confident-lead gate. ----
  //
  // Routing only the inside of the low-margin branch would have been
  // cosmetic: `hasMeaningfulLead` gates purely on `margin >= MIN_LEAD_MARGIN`
  // (5pp), so an upstream-flagged tie with (say) an 8pp margin never REACHED
  // that branch — it took the confident path above and emitted
  // "{X} currently leads by 8 percentage points", which is precisely the
  // headline the round-4 review flagged. The override has to be consulted
  // BEFORE the gate or it cannot bite at all.
  //
  // `enrichment.robustness` is the same raw object `pickLatestRawRobustness`
  // reads out of the prior fact; we already hold the live enrichment here, so
  // no input-contract change is needed to reach it.
  const rawRobustness = readRawRobustnessSignals(enrichment['robustness']);
  const marginPpRounded = winner.runnerUpProb !== null
    ? Math.round((winner.winnerProb - winner.runnerUpProb) * 100)
    : null;
  // Single-option sources (no runner-up) can never be a "tie" — there is
  // nothing to tie WITH. Pass a null margin AND suppress the override so a
  // stray upstream flag cannot manufacture a two-option claim out of one
  // option.
  const tieReason = winner.runnerUpProb !== null
    ? nearTieReasonByMargin(marginPpRounded, rawRobustness)
    : null;

  // Stronger cases only fire when probability/margin gates pass AND the
  // shared verdict does not call this a near-tie.
  if (tieReason === null && hasMeaningfulLead(winner)) {
    if (caution !== null) {
      // Caution shapes (priority #3 + #4): a fragility signal exists, so name
      // ONLY that one validation reason and frame the result as provisional —
      // never also the driver. This follows the copy priority order (leading
      // option, margin, provisional framing, one specific reason) AND makes the
      // "same factor as both driver and caveat" repetition impossible by
      // construction. Case A = with margin; Case C = margin shed under length.
      // provisional_doctrine_v0: the reason body has three claim-safe variants
      // (named factor / fragile link / generic provisional) — see
      // cautionReasonText.
      const cautionTail =
        `, but treat this as provisional: ${cautionReasonText(caution)}.${suffix}`;
      const caseA = `${winnerLabel} ${leadClause}${cautionTail}`;
      if (caseA.length <= lengthCap) {
        return {
          text: caseA,
          descriptor: buildDescriptor('A', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      const caseC = `${winnerLabel} ${LEADS_PLAIN}${cautionTail}`;
      if (caseC.length <= lengthCap) {
        return {
          text: caseC,
          descriptor: buildDescriptor('C', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Both caution candidates exceeded the length cap — fall through to Case E.
    } else if (hasDriver) {
      // Robust (no fragility): name the driver as the notable factor. Makes no
      // direction claim — "strongest driver" is a magnitude / salience
      // statement, so the PR #221 direction-honest path is not engaged here.
      const driverTail = ` because ${driverLabel} is the strongest driver.${suffix}`;
      const caseBMargin = `${winnerLabel} ${leadClause}${driverTail}`;
      if (caseBMargin.length <= lengthCap) {
        return {
          text: caseBMargin,
          descriptor: buildDescriptor('B', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      const caseB = `${winnerLabel} ${LEADS_PLAIN}${driverTail}`;
      if (caseB.length <= lengthCap) {
        return {
          text: caseB,
          descriptor: buildDescriptor('B', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Length cap exceeded — fall through to Case E.
    } else if (marginText !== null) {
      // No driver, no fragility, but a margin is available — surface it
      // (preferred over a bare probability number per the copy priority order).
      const caseDMargin = `${winnerLabel} ${leadClause}.${suffix}`;
      if (caseDMargin.length <= lengthCap) {
        return {
          text: caseDMargin,
          descriptor: buildDescriptor('D', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Length cap exceeded — fall through to Case E.
    } else {
      // No driver, no fragility, no margin (single-option source): keep the
      // existing probability sentence as the most informative honest floor.
      // The probability guard already enforced ≥ MIN_LEAD_PROBABILITY so the
      // rendered integer percentage is always ≥ 40%.
      // ⚠ THIS BAND CARRIED THE SAME CATEGORY ERROR IN A SECOND DIALECT, and
      // it is converted here rather than left alone. "Currently leads with 98%
      // probability" states the right NUMBER with the wrong NOUN: a reader asks
      // "98% probability of WHAT?" and the honest answer — "of being the
      // argmax across simulations of the model we drafted" — is nowhere in the
      // sentence. Left as it was, the product would have shipped two phrasings
      // of one statistic, which is the drift this module's derive-don't-mirror
      // rules exist to prevent. Same clause, same scope, one vocabulary.
      const caseD =
        `${winnerLabel} ${leadClause}.` +
        ` Run the follow-up checks before treating this as final.${suffix}`;
      if (caseD.length <= lengthCap) {
        return {
          text: caseD,
          descriptor: buildDescriptor('D', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Length cap exceeded — fall through to Case E.
    }
  } else if (winnerProbability >= MIN_LEAD_PROBABILITY && winner.runnerUpProb !== null) {
    // Near-tie / close-call branch: a plurality leader (≥ MIN_LEAD_PROBABILITY)
    // whose margin to the runner-up is positive but which did NOT clear the
    // confident-lead gate above. ROUND-5 UPDATE — that is now two populations,
    // not one:
    //   (a) margin < MIN_LEAD_MARGIN (5pp) — the original close-call case; and
    //   (b) ANY margin, however wide, that the shared verdict called a near-tie
    //       via the raw `near_tie.is_tie` override.
    // Population (b) is new here: it used to be swallowed by the confident
    // branch. Never emit a bare confident "{label} currently leads." — flag
    // the closeness honestly so a near-tie does not read as a decisive lead.
    const marginRaw = winnerProbability - winner.runnerUpProb;
    if (marginRaw <= 0) {
      // The designated leading option is not actually ahead of the runner-up —
      // do not claim a lead at all; fall back to the locked template.
      return {
        text: null,
        descriptor: buildDescriptor(null, 'low_margin', { hasDriver, hasFragility, marginBucket }),
      };
    }
    // S4 ROUND 5 — the verdict was decided ONCE above (`tieReason`) and is
    // only CONSUMED here. Round 4 left this site importing the SSOT
    // *constant* (NEAR_TIE_PP_THRESHOLD) and doing its own `<=` compare, so
    // it never consulted the raw `near_tie.is_tie` override. Importing a
    // constant is not routing; only `nearTieReasonByMargin` owns the truth
    // table (threshold AND override).
    if (tieReason !== null) {
      // Two near-tie shapes, because ONE sentence cannot be true of both —
      // this mirrors `closenessLead` in the SSOT exactly:
      //
      //  - 'margin'   => the gap really is ≤ 1pp. "only fractionally ahead"
      //                  is literally true; emit no number.
      //  - 'override' => the raw `near_tie.is_tie` flag fired on a WIDER gap.
      //                  "only fractionally ahead" would be a FALSE claim
      //                  (an 8pp gap is not fractional), so state the real
      //                  margin and let "close call" carry the tie verdict.
      //                  Overclaiming a tie is the mirror-image dishonesty of
      //                  overclaiming a lead; neither is acceptable.
      const caseTied = tieHeadlineText(tieReason, winnerLabel, leadClause, suffix);
      if (caseTied.length <= lengthCap) {
        return {
          text: caseTied,
          descriptor: buildDescriptor('NT', 'low_margin', { hasDriver, hasFragility, marginBucket }),
        };
      }
    } else if (marginText !== null) {
      // 1pp < margin < 5pp: a small but real lead — state it, flag closeness.
      const caseClose =
        `${winnerLabel} ${leadClause}, but the options are close.${suffix}`;
      if (caseClose.length <= lengthCap) {
        return {
          text: caseClose,
          descriptor: buildDescriptor('NT', 'low_margin', { hasDriver, hasFragility, marginBucket }),
        };
      }
    }
    // A near-tie result must NEVER fall through to the Case E confident floor
    // ("{label} currently leads.") — on a long label the near-tie sentence can
    // exceed MAX_HEADLINE_CHARS while the much shorter Case E line still fits,
    // which would turn a genuine ≤5pp near-tie into a confident lead. When the
    // near-tie copy overflows the cap (pathologically long label) or the margin
    // text is unrenderable, return null so the handler uses the neutral locked
    // template (no lead claim) instead of a confident headline.
    return {
      text: null,
      descriptor: buildDescriptor(null, 'low_margin', { hasDriver, hasFragility, marginBucket }),
    };
  }

  // ---- S4 ROUND 6: the raw near_tie.is_tie OVERRIDE preempts the
  // soft-confidence branch AND the Case E floor too. ----
  //
  // Round 5 routed the confident-lead gate and the >= MIN_LEAD_PROBABILITY
  // near-tie branch above, but a tie OVERRIDE on a SUB-0.40 winner reached
  // NEITHER: the meaningful-lead cases require `tieReason === null`, and the
  // near-tie branch above requires `winnerProbability >= MIN_LEAD_PROBABILITY`.
  // So an upstream-flagged tie on a soft-confidence [0.30, 0.40) or weaker
  // plurality — on a margin WIDER than the 1pp near-tie threshold, where the
  // margin alone would not flag a tie — fell straight through to the
  // soft-confidence "leads by N points" enrichment (which reaches the wire) or
  // the Case E "currently leads." floor, both asserting a lead the override
  // denies. Consult the SAME shared verdict here so neither branch can drop it.
  //
  // WHY `'override'` and not `tieReason !== null`: a genuine <= 1pp margin tie
  // at sub-0.40 confidence classifies as `'margin'`, and the existing design
  // DELIBERATELY routes that to the bare Case E "currently leads." floor (its
  // accepted neutral, non-enriching statement for a weak plurality — pinned by
  // the "never reads a tie as a lead / falls back to Case E" tests). Only the
  // override — which fires on a wider gap the margin band cannot see — is the
  // round-5 residual, so ONLY it preempts here; the margin band is untouched.
  //
  // Control-flow proof (exhaustive for the sub-0.40 override): to reach this
  // point with `tieReason === 'override'`, BOTH the meaningful-lead `if`
  // (requires `tieReason === null`) and the `>= MIN_LEAD_PROBABILITY` near-tie
  // `else if` must have been skipped; the latter only when
  // `winnerProbability < MIN_LEAD_PROBABILITY`. `'override'` implies a runner-up
  // exists (tieReason is null for single-option sources) and a rounded margin
  // > 1pp, so a runner-up exists and the numbered lead clause is available.
  if (tieReason === 'override' && winner.runnerUpProb !== null) {
    const marginRaw = winnerProbability - winner.runnerUpProb;
    if (marginRaw > 0) {
      const caseTied = tieHeadlineText(tieReason, winnerLabel, leadClause, suffix);
      if (caseTied.length <= lengthCap) {
        return {
          text: caseTied,
          descriptor: buildDescriptor('NT', 'low_margin', { hasDriver, hasFragility, marginBucket }),
        };
      }
    }
    // A flagged tie must NEVER fall through to the soft-confidence enrichment or
    // the confident Case E floor — return the neutral locked template (no lead
    // claim) when the tie copy does not fit or the leader is not actually ahead.
    return {
      text: null,
      descriptor: buildDescriptor(null, 'low_margin', { hasDriver, hasFragility, marginBucket }),
    };
  }

  // Soft-confidence enriched branch (V5 deterministic-copy hardening, Area F).
  // The winner sits in the soft-confidence BAND [SC_MIN_LEAD_PROBABILITY,
  // MIN_LEAD_PROBABILITY) i.e. [0.30, 0.40): too soft for the confident
  // meaningful-lead cases (A/B/C/D) and below the near-tie branch above (which
  // only handles plurality leaders >= MIN_LEAD_PROBABILITY), BUT strong enough
  // to name provisionally. With a real margin (>= MIN_LEAD_MARGIN) over a
  // runner-up AND a fragility or driver available, surface a CAUTIOUS provisional
  // headline naming the single most-relevant sensitivity (fragility preferred;
  // never both — preserves the no-repetition invariant) rather than collapsing
  // to the bare Case E floor.
  //
  // Honest by construction: "leads by N percentage points" is a factual
  // plurality statement and "treat this as provisional" caveats the soft
  // confidence — this INCREASES honest caveating rather than suppressing the
  // available ingredients into a bare "currently leads.". Deliberate policy
  // change from the prior "drop driver/fragility at soft confidence" behaviour.
  //
  // Honesty guards retained by the entry condition: very weak plurality leads
  // BELOW SC_MIN_LEAD_PROBABILITY (e.g. 0.24 in a fragmented 5-way race),
  // near-ties (margin < MIN_LEAD_MARGIN), and thin data (no driver AND no
  // fragility) all fall through to Case E — a weak/near-tie plurality must never
  // read as an enriched lead, and we never fabricate a sensitivity reason.
  // Single-option sources (runnerUpProb === null) also fall through (no margin to
  // honestly state).
  //
  // Reuses the Case A (with margin) / Case C (no margin) copy shapes verbatim,
  // so the emitted text already satisfies the registry grammar allowlist
  // (isAllowedRunAnalysisAssistantText) with no new pattern.
  // Compare the ROUNDED pp (matching the rendered "<N> percentage points")
  // against the threshold so floating-point noise at the boundary does not
  // flip the verdict — e.g. 0.30 − 0.25 = 0.04999999999999999 in IEEE-754
  // would spuriously fail a raw `>= 0.05` check while the headline still
  // renders "5 percentage points". Mirrors the rounded comparison the
  // near-tie branch uses above.
  const softConfidenceMarginPp =
    winner.runnerUpProb !== null
      ? Math.round((winner.winnerProb - winner.runnerUpProb) * 100)
      : -1;
  if (
    winner.runnerUpProb !== null &&
    // Soft-confidence BAND: [SC_MIN_LEAD_PROBABILITY, MIN_LEAD_PROBABILITY) i.e.
    // [0.30, 0.40). The lower floor is INCLUSIVE and uses a tiny epsilon (not
    // pp-rounding) because it is a pure threshold with no displayed probability:
    // exactly 0.30 qualifies; 0.29x stays excluded; FP representation noise at
    // 0.30 cannot flip the verdict.
    winner.winnerProb >= SC_MIN_LEAD_PROBABILITY - SC_PROBABILITY_EPSILON &&
    winner.winnerProb < MIN_LEAD_PROBABILITY &&
    softConfidenceMarginPp >= Math.round(MIN_LEAD_MARGIN * 100) &&
    (hasFragility || hasDriver)
  ) {
    // provisional_doctrine_v0: fragility candidate preferred (already
    // claim-safe); a genuine (non-pinned, non-zero) driver is the fallback
    // sensitivity target.
    const scReason =
      caution !== null
        ? cautionReasonText(caution)
        : driverLabel !== null
          ? `the result is sensitive to ${driverLabel}`
          : null;
    if (scReason !== null) {
      const cautionTail =
        `, but treat this as provisional: ${scReason}.${suffix}`;
      // Prefer the margin-bearing shape (Case A grammar); shed the margin under
      // the length cap (Case C grammar) before giving up to Case E.
      const scWithMargin = `${winnerLabel} ${leadClause}${cautionTail}`;
      if (marginText !== null && scWithMargin.length <= lengthCap) {
        return {
          text: scWithMargin,
          descriptor: buildDescriptor('SC', 'soft_confidence', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // No-margin SC shape (Case C grammar): fires only when the margin-bearing
      // shape overflowed the length cap (pathologically long label). Even here
      // the winner is within the soft-confidence band [0.30, 0.40) (the entry
      // condition's lower floor already excluded the very weak < 0.30 leads), so
      // it is a caveated, bounded fallback — not a free-for-all sub-40% claim.
      const scNoMargin = `${winnerLabel} ${LEADS_PLAIN}${cautionTail}`;
      if (scNoMargin.length <= lengthCap) {
        return {
          text: scNoMargin,
          descriptor: buildDescriptor('SC', 'soft_confidence', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Both shapes overflow the length cap — fall through to Case E below.
    }
  }

  // Case E (link-safe floor): we have a clean winner label but the
  // stronger cases didn't qualify or didn't fit. Output is the minimum
  // non-overclaiming "{Label} currently leads." (+ status suffix).
  // No "best", "winner", "recommended", "optimal", "preferred". No
  // probability number. No driver/fragility clauses.
  const caseE = `${winnerLabel} ${LEADS_PLAIN}.${suffix}`;
  const reason = deriveCaseEReason(winner, driverLabel, hasFragility);
  if (caseE.length <= lengthCap) {
    return {
      text: caseE,
      descriptor: buildDescriptor('E', reason, { hasDriver, hasFragility, marginBucket }),
    };
  }

  // Even Case E exceeds the length cap (extremely long sanitised label).
  // Fall back to the locked template.
  return {
    text: null,
    descriptor: buildDescriptor(null, 'length_cap', { hasDriver, hasFragility, marginBucket }),
  };
}

/**
 * The two near-tie headline shapes, shared by the >= MIN_LEAD_PROBABILITY
 * near-tie branch and the sub-0.40 tie-override preemption so the copy can never
 * drift between the two emission sites (derive, don't mirror). Mirrors
 * `closenessLead` in the robustness-honesty SSOT:
 *  - 'margin'   => a genuine <= 1pp gap: "only fractionally ahead … effectively
 *                  tied" (emits no number — the gap really is fractional).
 *  - 'override' => a WIDER gap the raw `near_tie.is_tie` flag still calls a tie:
 *                  state the real margin and ATTRIBUTE the verdict ("… but the
 *                  analysis treats this as a close call") rather than overclaim a
 *                  dead heat. Overclaiming a tie is the mirror-image dishonesty
 *                  of overclaiming a lead; neither is acceptable.
 *
 * BOTH shapes are pinned in {@link HEADLINE_GRAMMAR_REGEXES} — the override
 * shape's grammar was the round-5 residual: the branch routed through the shared
 * verdict but the egress allowlist did not recognise its copy, so the honest
 * override headline was silently replaced by the locked template at the wire.
 */
function tieHeadlineText(
  tieReason: 'margin' | 'override',
  winnerLabel: string,
  leadClause: string,
  suffix: string,
): string {
  return tieReason === 'margin'
    ? `${winnerLabel} is currently only fractionally ahead, so the options are effectively tied.${suffix}`
    : `${winnerLabel} ${leadClause}, but the analysis treats this as a close call.${suffix}`;
}

function buildDescriptor(
  caseKind: HeadlineCase,
  reason: HeadlineFallbackReason,
  args: { hasDriver: boolean; hasFragility: boolean; marginBucket: 'tight' | 'moderate' | 'comfortable' | null },
): HeadlineDescriptor {
  return {
    case: caseKind,
    reason,
    has_leading_option: true,
    has_clean_label: true,
    has_driver: args.hasDriver,
    has_fragility: args.hasFragility,
    margin_bucket: args.marginBucket,
  };
}

function deriveCaseEReason(
  winner: ResolvedWinner,
  driverLabel: string | null,
  hasFragility: boolean,
): HeadlineFallbackReason {
  // Soft confidence: absolute probability gate failed.
  if (winner.winnerProb < MIN_LEAD_PROBABILITY) return 'soft_confidence';
  // Low margin: margin gate failed.
  if (winner.runnerUpProb !== null) {
    const margin = winner.winnerProb - winner.runnerUpProb;
    if (margin < MIN_LEAD_MARGIN) return 'low_margin';
  }
  // Meaningful lead but a stronger case failed. The only reasons we
  // reach Case E at this point are: (a) Case D-shape (no driver, no
  // fragility) overshot the length cap, or (b) a Case A/B/C with
  // driver/fragility overshot it.
  if (driverLabel === null && !hasFragility) {
    return 'no_driver_no_fragility';
  }
  return 'length_cap';
}

function computeMarginBucket(
  winner: ResolvedWinner,
): 'tight' | 'moderate' | 'comfortable' | null {
  if (winner.runnerUpProb === null) return null;
  const margin = winner.winnerProb - winner.runnerUpProb;
  if (margin < 0.05) return 'tight';
  if (margin < 0.15) return 'moderate';
  return 'comfortable';
}

/**
 * Render the winner→runner-up margin as the SSOT "<N> percentage points"
 * string, or null when no runner-up probability exists in the same source.
 * Reuses {@link formatProbabilityMargin} (the single source of truth for
 * margin wording); both inputs are pre-validated finite probabilities in
 * {@link resolveWinner}, so the formatter's invalid-input telemetry branch is
 * unreachable on this path. Returns null unless the result matches the
 * canonical "<int> percentage point(s)" shape — defence so a future formatter
 * change can never leak "Not available" (or a decimal) into a headline.
 *
 * MARGIN-OWNERSHIP CONTRACT (follow-up): this composer receives the RAW PLoT
 * envelope before the context-projection path exposes `margin_pp`, so it
 * derives the margin here from same-source PLoT-owned win probabilities. This
 * is an accepted display-only derivation, but `compactAnalysis` computes its
 * own `margin_pp` (rounded to 1 decimal) downstream, so the two can disagree
 * by 1pp at rounding edges. If a canonical `margin_pp` ever becomes available
 * on THIS path, consume it here instead of recomputing.
 */
function marginPointsText(winner: ResolvedWinner): string | null {
  if (winner.runnerUpProb === null) return null;
  const text = formatProbabilityMargin(winner.winnerProb, winner.runnerUpProb);
  return /^\d+ percentage points?$/.test(text) ? text : null;
}

interface ResolvedWinner {
  /** Sanitised label (no ID-shape, trimmed, non-empty). */
  readonly label: string;
  /** Finite winner probability, in [0, 1]. */
  readonly winnerProb: number;
  /**
   * Finite runner-up probability from the SAME source, in [0, 1],
   * or null when no other entry in that source carries a finite
   * probability (e.g., a single-option source, or a runner-up
   * missing its probability field). When null the margin guard is
   * waived; only the absolute probability check applies.
   */
  readonly runnerUpProb: number | null;
  /**
   * Doctrine D-W (ROADMAP 2.52): the sanitised label of the runner-up entry
   * (the SAME-source non-winner option that carries {@link runnerUpProb}), or
   * null when there is no usable runner-up or its label is unsanitisable. Used
   * ONLY by the leader-trails-argmax disambiguation copy (Doctrine D-W) — never
   * a producer value, purely the display label of the option with the best
   * OTHER raw odds.
   */
  readonly runnerUpLabel: string | null;
  /**
   * Mission B (provisional_doctrine_v0): number of NON-winner entries in
   * the SAME accepted source with a finite win_probability strictly below
   * {@link ELIMINATED_WIN_PROBABILITY_CEILING} (i.e. effectively
   * eliminated, <1% chance of winning). Same-source so the count can
   * never mix probabilities across envelope shapes.
   */
  readonly eliminatedCount: number;
}

/**
 * Resolve the leading option's label, its win_probability, AND the
 * runner-up probability — all from the SAME source array in a single
 * pass. Iterates sources in priority order
 * ({@link readResultsArraySources}); a source is accepted only when
 * BOTH the candidate winner has a non-ID-shaped label AND a finite,
 * in-range win_probability. Sources that fail either check are
 * skipped (continue) so a thin/ID-shaped first source can be rescued
 * by a richer subsequent source — but each accepted source provides
 * the full triple, never a label from one and a probability from
 * another.
 *
 * Returns null when no source provides all three signals — the
 * caller treats null as "fall back to the locked template".
 */
function resolveWinner(
  enrichment: Record<string, unknown>,
  leadingOptionId: string,
): ResolvedWinner | null {
  // Status gate (shared across ALL winner surfaces via the ONE
  // isRecommendableOption predicate): a FAILED / skipped option (per-option
  // ISL `status`) is never crowned as the leader AND never counted as the
  // runner-up it is measured against — mirroring the direct receipt
  // (run-analysis.ts selectLeadingOptionId), compactAnalysis, projectAnalysis
  // and the decision-review enricher. Applied per-source BEFORE selection so
  // both the `selectWinner` input below and the runner-up loop only see
  // recommendable records. Absent status stays recommendable, so status-less
  // enrichments (legacy / most current payloads) are byte-for-byte unaffected.
  // A source that filters to empty (all options failed) yields no winner and is
  // skipped, so an all-error set produces the honest null headline instead of
  // crowning the top failed option; a declared `leadingOptionId` pointing at a
  // failed option finds no match in any filtered source and falls through.
  const sources = readResultsArraySources(enrichment).map((source) =>
    source.filter(isRecommendableOption),
  );
  if (sources.length === 0) return null;

  const id = leadingOptionId.trim();
  for (const source of sources) {
    const winner = selectWinner(source, id.length > 0 ? id : null);
    if (winner === null) continue;
    const cleanedLabel = sanitiseLabel(winner.label, winner.id);
    if (cleanedLabel === null) continue;

    // Re-read the winner's probability directly from the source.
    // `selectWinner` calls `projectOptionAsWinner` which coerces a
    // missing/non-finite `win_probability` to 0 — that conceals the
    // difference between "explicitly 0" (a legitimate, finite signal
    // for a dominated option) and "missing entirely" (a thin source
    // that should be skipped so a richer downstream source can carry
    // both label and probability). Reading raw lets the skip path
    // fire when the source can't supply a finite probability at all.
    const winnerRaw = source.find((r) => {
      const rId =
        (typeof r.option_id === 'string' && r.option_id) ||
        (typeof r.id === 'string' && r.id) ||
        '';
      return rId === winner.id;
    });
    // Round-4 review MAJOR-A: per-source acceptance keys on the SINGLE shared
    // predicate (finite AND in [0,1]) — identical to winnerOptionResultSource
    // and the enricher selectWinner, so degenerate envelopes can't diverge.
    // (Preserves the out-of-range fallback: a stray 1.5 is not "usable".)
    if (!isUsableWinProbability(winnerRaw?.win_probability)) continue;
    const winnerProb = winnerRaw!.win_probability as number;

    let runnerUpProb: number | null = null;
    let runnerUpRaw: Record<string, unknown> | null = null;
    let runnerUpId = '';
    let eliminatedCount = 0;
    for (const raw of source) {
      const rId =
        (typeof raw.option_id === 'string' && raw.option_id) ||
        (typeof raw.id === 'string' && raw.id) ||
        '';
      if (rId === winner.id) continue;
      if (!isUsableWinProbability(raw.win_probability)) continue;
      const p = raw.win_probability as number;
      if (runnerUpProb === null || p > runnerUpProb) {
        runnerUpProb = p;
        runnerUpRaw = raw;
        runnerUpId = rId;
      }
      if (p < ELIMINATED_WIN_PROBABILITY_CEILING) eliminatedCount += 1;
    }
    // D-W: sanitise the runner-up's label for the leader-trails copy. A
    // missing / ID-shaped runner-up label yields null (the copy branch then
    // stays silent rather than leak an ID). Display-only; no producer read.
    let runnerUpLabel: string | null = null;
    if (runnerUpRaw !== null) {
      const rawRunnerUpLabel =
        (typeof runnerUpRaw.option_label === 'string' && runnerUpRaw.option_label) ||
        (typeof runnerUpRaw.label === 'string' && runnerUpRaw.label) ||
        '';
      runnerUpLabel = sanitiseLabel(rawRunnerUpLabel, runnerUpId);
    }
    return { label: cleanedLabel, winnerProb, runnerUpProb, runnerUpLabel, eliminatedCount };
  }
  return null;
}

/**
 * Predicate: does the resolved winner support a "currently leads"
 * headline? Two gates:
 *   1. Winner probability ≥ MIN_LEAD_PROBABILITY (an absolute floor —
 *      a leader below 40% is a "no real leader" race regardless of
 *      margin).
 *   2. If a runner-up probability exists in the same source, the
 *      margin must be ≥ MIN_LEAD_MARGIN. Single-option sources
 *      (runnerUpProb === null) waive the margin check.
 */
function hasMeaningfulLead(winner: ResolvedWinner): boolean {
  if (winner.winnerProb < MIN_LEAD_PROBABILITY) return false;
  if (winner.runnerUpProb !== null) {
    const margin = winner.winnerProb - winner.runnerUpProb;
    if (margin < MIN_LEAD_MARGIN) return false;
  }
  return true;
}

function statusSuffix(kind: AnalysisResultHeadlineInput['status_kind']): string {
  if (kind === 'partial') return PARTIAL_SUFFIX;
  if (kind === 'unknown') return UNKNOWN_SUFFIX;
  return '';
}

interface DriverCandidate {
  readonly label: string;
  readonly score: number;
}

function resolveTopDriverLabel(
  enrichment: Record<string, unknown>,
  controlledFactorIds?: ReadonlySet<string>,
): string | null {
  const arr = enrichment.factor_sensitivity;
  if (!Array.isArray(arr)) return null;

  let bestNamed: DriverCandidate | null = null;
  // Track the RAW strongest driver (any control status) so we can omit the
  // driver clause when the genuine strongest is one we suppress — naming a
  // weaker tunable driver as "the strongest driver" would be inaccurate.
  let topScore = -Infinity;
  let topControlled = false;
  for (const raw of arr) {
    const entry = readRecord(raw);
    if (!entry) continue;
    const idGuess =
      (typeof entry.factor_id === 'string' && entry.factor_id) ||
      (typeof entry.id === 'string' && entry.id) ||
      '';
    // Spine A backstop: match on the SAME id the analysis keys factors by —
    // `node_id` first (mirroring compactAnalysis's `node_id ?? factor_id`
    // precedence), so a lever is recognised even when a PLoT entry carries only
    // `node_id`. Structural id only; never the label.
    const controlledMatchId =
      (typeof entry.node_id === 'string' && entry.node_id) || idGuess;
    const isControlled =
      (controlledFactorIds !== undefined &&
        controlledMatchId.length > 0 &&
        controlledFactorIds.has(controlledMatchId)) ||
      // Mission A (provisional_doctrine_v0): an envelope-declared pin is as
      // authoritative as the structural controlled set — an
      // intervention_override lever must never be named a driver even when
      // the caller could not supply interventionControlledFactorIds.
      //
      // DGAI #341: this pin keeps OMIT-NOT-SUBSTITUTE semantics on top of the
      // influence_score ranking. On the live #341 board the influence-TOP
      // factor carried this pin, so the driver clause is OMITTED entirely
      // ("or omit the driver claim when elasticities are suppressed by
      // intervention_override" — the issue's own ruled alternative). It can
      // never re-select the elasticity artifact: the artifact factor ranks
      // LAST on influence, and a suppressed top omits rather than falls
      // through to a weaker candidate.
      entry.zero_reason === 'intervention_override';

    const score = computeDriverScore(entry);
    if (score === null) continue;
    if (score > topScore) {
      topScore = score;
      topControlled = isControlled;
    } else if (score === topScore && isControlled) {
      // Tie at the top: if ANY equally-strongest driver is option-controlled,
      // treat the top as controlled — order-independent and conservative, so we
      // omit rather than present an equally-strong tunable driver as "the
      // strongest".
      topControlled = true;
    }
    if (isControlled) continue; // never NAME an option-controlled lever
    // Mission A (provisional_doctrine_v0): a zero-score factor is not a
    // driver-of-change — never name it as "the strongest driver" (the
    // pre-doctrine code would name a sensitivity_score: 0 factor when all
    // scores were zero).
    if (score === 0) continue;

    const rawLabel =
      (typeof entry.factor_label === 'string' && entry.factor_label) ||
      (typeof entry.label === 'string' && entry.label) ||
      '';
    const label = sanitiseLabel(rawLabel, idGuess);
    if (label === null) continue;
    if (bestNamed === null || score > bestNamed.score) {
      bestNamed = { label, score };
    } else if (score === bestNamed.score && label.localeCompare(bestNamed.label) < 0) {
      bestNamed = { label, score };
    }
  }
  // If the raw strongest driver is option-controlled, omit the driver clause
  // entirely (the headline falls to a no-driver shape) rather than present a
  // weaker tunable driver as "the strongest". Once the producer fix lands,
  // controlled levers are zero-sensitivity and never top, so the clause returns.
  if (topControlled) return null;
  return bestNamed?.label ?? null;
}

/**
 * DGAI #341: driver-claim magnitude comes from the shared influence accessor
 * (`influence_score` only — what ISL ranks and the UI displays). The former
 * `sensitivity_score → |elasticity| × confidence` heuristic named the LEAST
 * influential factor on a board where `intervention_override` zeroed every
 * elasticity except one; it must never be a fallback for driver RANKING.
 * `null` ⇒ the entry is not a driver candidate (claim omitted, never scored
 * from an artifact).
 */
function computeDriverScore(entry: Record<string, unknown>): number | null {
  return readDriverInfluenceScore(entry);
}

// ============================================================================
// Mission A — claim-safe caution candidate (provisional_doctrine_v0)
// ============================================================================

/**
 * The single validation reason the caution shapes may name. Three claim-safe
 * variants:
 *  - `factor`  — a genuinely non-pinned node label: "the result is sensitive
 *                to {label}" (unchanged legacy wording).
 *  - `edge`    — the fragile LINK itself: "the link between {from} and {to}
 *                is fragile". Used when the only nameable node is
 *                option-pinned — the fragility claim is about the edge
 *                (switch_probability), which is truthfully grounded even
 *                when the endpoint factor's sensitivity is zero.
 *  - `generic` — "the result is not highly stable". Used when
 *                fragility exists but pin-suppression removed every safe
 *                named candidate.
 */
type CautionCandidate =
  | { readonly kind: 'factor'; readonly label: string }
  | { readonly kind: 'edge'; readonly fromLabel: string; readonly toLabel: string }
  | { readonly kind: 'generic' };

function cautionReasonText(caution: CautionCandidate): string {
  switch (caution.kind) {
    case 'factor':
      return `the result is sensitive to ${caution.label}`;
    case 'edge':
      return `the link between ${caution.fromLabel} and ${caution.toLabel} is fragile`;
    case 'generic':
      return 'the result is not highly stable';
  }
}

/** Case-insensitive, trimmed key for label-based pin matching. */
function normaliseLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

interface PinnedFactorIndex {
  readonly ids: ReadonlySet<string>;
  readonly labels: ReadonlySet<string>;
}

/**
 * Collect the factors that must NEVER be described as "sensitive" or as a
 * driver-of-change (Mission A claim-safety rule, provisional_doctrine_v0):
 *  - factor_sensitivity entries with sensitivity_score === 0, OR
 *  - zero_reason === 'intervention_override' (option-pinned lever), OR
 *  - ids in the structural interventionControlledFactorIds set.
 * Indexed by structural id (factor_id / node_id / id) AND by normalised
 * label, because fragile-edge entries reference nodes by id while the
 * rendered candidate is a label.
 */
function collectPinnedFactors(
  enrichment: Record<string, unknown>,
  controlledFactorIds?: ReadonlySet<string>,
): PinnedFactorIndex {
  const ids = new Set<string>(controlledFactorIds ?? []);
  const labels = new Set<string>();
  const arr = enrichment.factor_sensitivity;
  if (Array.isArray(arr)) {
    for (const raw of arr) {
      const entry = readRecord(raw);
      if (!entry) continue;
      const sensitivity = readNumber(entry.sensitivity_score);
      const pinned =
        entry.zero_reason === 'intervention_override' || sensitivity === 0;
      if (!pinned) continue;
      for (const key of ['factor_id', 'node_id', 'id'] as const) {
        const v = entry[key];
        if (typeof v === 'string' && v.length > 0) ids.add(v);
      }
      for (const key of ['factor_label', 'label'] as const) {
        const v = entry[key];
        if (typeof v === 'string' && v.length > 0) labels.add(normaliseLabelKey(v));
      }
    }
  }
  return { ids, labels };
}

function isPinnedFactor(
  id: string | null,
  label: string | null,
  pinned: PinnedFactorIndex,
): boolean {
  if (id !== null && id.length > 0 && pinned.ids.has(id)) return true;
  if (label !== null && pinned.labels.has(normaliseLabelKey(label))) return true;
  return false;
}

interface FragileEdgeCandidate {
  readonly prob: number;
  /** Clean label the legacy shape would name (from preferred, then to). */
  readonly namedLabel: string | null;
  /** Structural id of whichever node supplied namedLabel. */
  readonly namedId: string | null;
  readonly fromClean: string | null;
  readonly toClean: string | null;
}

/**
 * Resolve the claim-safe caution candidate from robustness.fragile_edges.
 *
 * Selection order (provisional_doctrine_v0):
 *  1. Highest-switch_probability edge with a resolvable node label, when
 *     that node is NOT pinned → factor wording (bit-identical behaviour to
 *     the legacy resolveFragileLabel for the non-pinned case).
 *  2. The pinned best edge phrased as a LINK when both endpoints resolve →
 *     edge wording. The claim transfers to the edge, which is genuinely
 *     fragile.
 *  3. The next-strongest edge with a non-pinned resolvable label → factor
 *     wording.
 *  4. Any remaining edge with both endpoints resolvable → edge wording.
 *  5. Fragility exists but nothing safely nameable → generic wording.
 *
 * Returns null (no caution clause at all) only on the legacy thin-data
 * paths: robustness high/absent, no fragile edges, or no edge with any
 * resolvable label (unchanged from resolveFragileLabel).
 */
function resolveCautionCandidate(
  enrichment: Record<string, unknown>,
  controlledFactorIds?: ReadonlySet<string>,
): CautionCandidate | null {
  // Robust scenarios skip the fragility clause entirely.
  const level = readRobustnessLevel(enrichment);
  if (level === 'high') return null;

  const rob = readRecord(enrichment.robustness);
  if (!rob) return null;
  const fragile = rob.fragile_edges;
  if (!Array.isArray(fragile) || fragile.length === 0) return null;

  const labelMap = buildNodeLabelMap(readGraph(enrichment));
  const pinned = collectPinnedFactors(enrichment, controlledFactorIds);

  const candidates: FragileEdgeCandidate[] = [];
  for (const raw of fragile) {
    const entry = readRecord(raw);
    if (!entry) continue;
    const prob = readNumber(entry.switch_probability) ?? 0;
    candidates.push({ prob, ...resolveFragileEdgeParts(entry, labelMap) });
  }
  // Stable sort: descending switch_probability, original order on ties —
  // matches the legacy "strictly greater wins, first seen keeps ties" pick.
  candidates.sort((a, b) => b.prob - a.prob);

  const best = candidates.find((c) => c.namedLabel !== null);
  if (!best) return null; // legacy thin-data path: nothing resolvable at all

  // 1. Non-pinned best label → unchanged factor wording.
  if (!isPinnedFactor(best.namedId, best.namedLabel, pinned)) {
    return { kind: 'factor', label: best.namedLabel as string };
  }
  // 2. Pinned best: prefer the SAME strongest edge as a link claim.
  if (best.fromClean !== null && best.toClean !== null) {
    return { kind: 'edge', fromLabel: best.fromClean, toLabel: best.toClean };
  }
  // 3. Next-strongest non-pinned named candidate.
  for (const c of candidates) {
    if (c === best) continue;
    if (c.namedLabel !== null && !isPinnedFactor(c.namedId, c.namedLabel, pinned)) {
      return { kind: 'factor', label: c.namedLabel };
    }
  }
  // 4. Any other edge with both endpoints nameable.
  for (const c of candidates) {
    if (c === best) continue;
    if (c.fromClean !== null && c.toClean !== null) {
      return { kind: 'edge', fromLabel: c.fromClean, toLabel: c.toClean };
    }
  }
  // 5. Fragility is real but no safe named candidate survived suppression.
  return { kind: 'generic' };
}

// ============================================================================
// Mission B — narration-completeness tail (provisional_doctrine_v0)
// ============================================================================

/** True when the envelope plainly reports a non-robust result. */
function isNotRobust(enrichment: Record<string, unknown>): boolean {
  const rob = readRecord(enrichment.robustness);
  if (!rob) return false;
  if (rob.is_robust === false) return true;
  return rob.level === 'low';
}

/**
 * Build the Mission B narration tail: robustness honesty first, then the
 * eliminated-options clause. Empty string when neither applies — the
 * headline is then byte-identical to the pre-doctrine output.
 */
function buildNarrationTail(
  enrichment: Record<string, unknown>,
  winner: ResolvedWinner,
): string {
  let tail = '';
  if (isNotRobust(enrichment)) {
    // 2.278: the run's OWN flip evidence picks the REASON. `permitted` — which
    // includes every run carrying no flip evidence at all — keeps the original
    // sentence byte-identical.
    tail +=
      readFlipClaimPosture(enrichment) === 'attested_no_flip'
        ? NOT_ROBUST_NO_FLIP_SENTENCE
        : NOT_ROBUST_SENTENCE;
  }
  if (winner.eliminatedCount >= ELIMINATED_MIN_COUNT) {
    tail += eliminatedSentence(winner.eliminatedCount);
  }
  return tail;
}

/**
 * Resolve both endpoints of a fragile edge (direct labels first, then the
 * graph label map), sanitised. `namedLabel`/`namedId` reproduce the legacy
 * single-label preference exactly: FROM when clean, else TO.
 */
function resolveFragileEdgeParts(
  edge: Record<string, unknown>,
  labelMap: Map<string, string>,
): Omit<FragileEdgeCandidate, 'prob'> {
  const directFrom =
    typeof edge.from_label === 'string' && edge.from_label.length > 0
      ? edge.from_label
      : null;
  const directTo =
    typeof edge.to_label === 'string' && edge.to_label.length > 0
      ? edge.to_label
      : null;
  const fromId =
    typeof edge.from_node_id === 'string' && edge.from_node_id.length > 0
      ? edge.from_node_id
      : null;
  const toId =
    typeof edge.to_node_id === 'string' && edge.to_node_id.length > 0
      ? edge.to_node_id
      : null;

  const resolvedFrom = directFrom ?? (fromId ? labelMap.get(fromId) ?? null : null);
  const resolvedTo = directTo ?? (toId ? labelMap.get(toId) ?? null : null);

  const cleanFrom =
    resolvedFrom !== null ? sanitiseLabel(resolvedFrom, fromId ?? '') : null;
  const cleanTo =
    resolvedTo !== null ? sanitiseLabel(resolvedTo, toId ?? '') : null;

  if (cleanFrom !== null) {
    return { namedLabel: cleanFrom, namedId: fromId, fromClean: cleanFrom, toClean: cleanTo };
  }
  return { namedLabel: cleanTo, namedId: cleanTo !== null ? toId : null, fromClean: cleanFrom, toClean: cleanTo };
}

// `sanitiseLabel` is imported from ../context/enrichment-graph-labels.ts.

// ============================================================================
// Registry-side allowlist for run_analysis assistant_text
// ============================================================================
//
// The validation-registry forwarder ({@link
// ../routing/validation-registry.ts}) calls into this module so the wire
// only ever sees strings the handler is permitted to emit:
//   1. An exact match for one of the locked RUN_ANALYSIS_ASSISTANT_TEMPLATES
//      values (kept in sync below — see the `RUN_ANALYSIS_LOCKED_TEMPLATES`
//      constant), OR
//   2. A string that satisfies the deterministic headline grammar
//      defined here (single-line, length-capped, no forbidden vocabulary,
//      no internal-ID prefixes, no raw decimals, must contain the
//      "currently leads" anchor, must end with a period).
//
// A regressed handler emitting arbitrary prose — even if the prose
// happens to contain the substring "currently leads" — is rejected by
// the structural rules below and falls back to the locked template.

/**
 * Exact-match set mirroring `RUN_ANALYSIS_ASSISTANT_TEMPLATES` in
 * `../tools/handlers/run-analysis.ts`. Kept here as a frozen
 * compile-time constant so the registry forwarder can do a strict
 * `.has()` membership test without importing the handler module
 * (which would cause an undesirable dependency cycle). The pinned
 * test `analysis-result-headline.test.ts > locked templates kept in
 * sync` verifies these values match the handler's source of truth.
 */
export const RUN_ANALYSIS_LOCKED_TEMPLATES: ReadonlySet<string> = new Set([
  'Ran analysis on your current scenario.',
  'Ran analysis on your current scenario. No options were compared.',
  'Ran analysis on your current scenario. Some results may be incomplete — treat with caution.',
  'Ran analysis on your current scenario. The analysis engine reported an unfamiliar status — treat the result with caution.',
  'Ran analysis on your current scenario. The engine flagged the run as partial and produced no option comparisons — treat with caution.',
  'Ran analysis on your current scenario. Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.',
]);

// The forbidden-vocabulary / internal-ID / raw-decimal content rules now
// live in ./assistant-text-defences.ts (P1-3: single home, shared with the
// scaffold-disclosure builder — derive, don't mirror).

/**
 * Headline grammar regex set — mirrors the exact Case A/B/C/D/E shapes
 * {@link buildAnalysisResultHeadline} can emit, optionally followed
 * by one of the two status-suffix sentences. The placeholders
 * (winner label, driver label, fragility label, integer probability)
 * match any non-newline character sequence; the SURROUNDING tokens
 * are pinned verbatim so improvised prose containing only the
 * "currently leads" anchor (e.g. "Hire A currently leads for reasons
 * outside the deterministic headline grammar.") cannot satisfy the
 * grammar. Case E ("{label} currently leads.") is the link-safe
 * floor — it is the only pattern where the leading "currently leads"
 * anchor is followed immediately by a literal period; cases A/B/C/D
 * all extend with "because", ", but", or "with N% probability" before
 * the terminal period.
 *
 * Defence-in-depth rules (length cap, no newlines, no forbidden
 * vocabulary, no ID prefixes, no raw decimals) still apply on top of
 * the grammar match — a label slot or driver slot that happened to
 * contain forbidden vocabulary would still be rejected after the
 * grammar matches.
 *
 * Each pattern uses lazy `.+?` so the engine prefers shorter slot
 * matches and the trailing `\.${STATUS_SUFFIX}$` anchor pins the
 * terminator. The lazy quantifier prevents the regex from skipping
 * across a legitimate sentence boundary inside an unusual label.
 */
function escapeForRegex(source: string): string {
  return source.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
const PARTIAL_SUFFIX_RE_SRC = escapeForRegex(PARTIAL_SUFFIX);
const UNKNOWN_SUFFIX_RE_SRC = escapeForRegex(UNKNOWN_SUFFIX);
const STATUS_SUFFIX_PATTERN = `(?:${PARTIAL_SUFFIX_RE_SRC}|${UNKNOWN_SUFFIX_RE_SRC})?`;

// Mission B narration tail (provisional_doctrine_v0): optional robustness
// honesty sentence, then optional eliminated-options sentence, then the
// optional seam-item-3 reduced-samples disclosure, then the optional status
// suffix — in exactly that order, mirroring buildNarrationTail +
// reducedSamplesSuffix + statusSuffix composition in computeHeadline.
// 2.278: an alternation over EVERY variant in NOT_ROBUST_SENTENCES, derived —
// a variant emitted but absent from the grammar is rejected at egress and the
// user silently receives the locked template instead.
const NOT_ROBUST_RE_SRC = NOT_ROBUST_SENTENCES.map(escapeForRegex).join('|');
const ELIMINATED_RE_SRC =
  ' \\d{1,3} options are effectively eliminated \\(each has less than a 1% chance of winning\\)\\.';
const REDUCED_SAMPLES_RE_SRC = escapeForRegex(REDUCED_SAMPLES_SUFFIX);
// D-ask-1 (2.11 P0-1): the scaffold disclosure composes LAST — after every
// narration tail and status suffix — mirroring the handler's
// `summary + buildScaffoldDisclosureSuffix(...)` append order.
// T1: the constraint-gap disclosure composes LAST of all — after the scaffold
// disclosure — mirroring `${headline ?? template}${scaffoldDisclosure}${
// constraintGapDisclosure}` in the run_analysis handler.
// ROADMAP 2.579: the intake disclosure composes LAST of all — after the
// constraint-gap disclosure — mirroring
// `${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}${
// intakeDisclosure}` in the run_analysis handler.
const TAIL_PATTERN = `(?:${NOT_ROBUST_RE_SRC})?(?:${ELIMINATED_RE_SRC})?(?:${REDUCED_SAMPLES_RE_SRC})?${STATUS_SUFFIX_PATTERN}(?:${SCAFFOLD_ANY_DISCLOSURE_RE_SRC})?(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})?(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})?`;

/**
 * Anchored form of the DISCLOSURE grammars, for the locked-template branch of
 * {@link isAllowedRunAnalysisAssistantText}: a template-shaped text may carry
 * the scaffold disclosure, the T1 constraint-gap disclosure, or both in the
 * handler's append order — and nothing else.
 *
 * Both slots are optional here, but the caller only reaches this regex when the
 * remainder after the template literal is non-empty (`text.length >
 * template.length`), so an empty match cannot admit a bare template twice.
 */
const TEMPLATE_SUFFIX_ONLY_REGEX = new RegExp(
  `^(?:${SCAFFOLD_ANY_DISCLOSURE_RE_SRC})?(?:${CONSTRAINT_GAP_DISCLOSURE_RE_SRC})?(?:${INTAKE_OPTION_DISCLOSURE_RE_SRC})?$`,
);

// Mission A caution-reason alternation (provisional_doctrine_v0): the three
// claim-safe bodies emitted by cautionReasonText. Pinned verbatim so
// improvised "provisional" prose cannot ride through the caution shapes.
const CAUTION_REASON_PATTERN =
  '(?:the result is sensitive to .+?|the link between .+? and .+? is fragile|the result is not highly stable)';

/**
 * Grammar source for the lead clause emitted by `leadClause` in
 * `computeHeadline` — "{label} came out ahead in {N}% of runs of this model".
 *
 * ⚠ THE OLD ALTERNATIVE IS DELIBERATELY GONE, NOT KEPT AS A TOLERATED LEGACY.
 * This allowlist is the SECOND line of defence: anything it admits, a future
 * regression may emit to the wire unchallenged. Leaving
 * "leads by \\d+ percentage points" in the grammar would leave the retired
 * category error one bug away from shipping again, with the egress guard
 * silently blessing it. Retiring the copy means retiring its grammar in the
 * same commit — the pin for that is in
 * analysis-result-headline-win-probability.test.ts, which asserts the old
 * sentence is REJECTED here rather than merely absent from the builder.
 *
 * The percentage is `\\d{1,3}` — an integer, matching the content defences'
 * no-raw-decimals rule and the `Math.round` at the emission site.
 */
const LEAD_CLAUSE_RE_SRC = 'came out ahead in \\d{1,3}% of runs of this model';

const HEADLINE_GRAMMAR_REGEXES: ReadonlyArray<RegExp> = [
  // Case A: winner + margin + provisional caution naming the fragile reason.
  new RegExp(
    `^.+? ${LEAD_CLAUSE_RE_SRC}, but treat this as provisional: ${CAUTION_REASON_PATTERN}\\.${TAIL_PATTERN}$`,
  ),
  // Case C: provisional caution naming the fragile reason, no margin.
  new RegExp(
    `^.+? currently leads, but treat this as provisional: ${CAUTION_REASON_PATTERN}\\.${TAIL_PATTERN}$`,
  ),
  // Case B (with margin): winner + margin + driver.
  new RegExp(
    `^.+? ${LEAD_CLAUSE_RE_SRC} because .+? is the strongest driver\\.${TAIL_PATTERN}$`,
  ),
  // Case B (no margin): winner + driver.
  new RegExp(
    `^.+? currently leads because .+? is the strongest driver\\.${TAIL_PATTERN}$`,
  ),
  // Case D (margin only): winner + margin.
  new RegExp(
    `^.+? ${LEAD_CLAUSE_RE_SRC}\\.${TAIL_PATTERN}$`,
  ),
  // Case D (probability): winner + integer-percentage probability + nudge.
  new RegExp(
    `^.+? ${LEAD_CLAUSE_RE_SRC}\\. Run the follow-up checks before treating this as final\\.${TAIL_PATTERN}$`,
  ),
  // Case NT (close): small but real lead, flagged as close.
  new RegExp(
    `^.+? ${LEAD_CLAUSE_RE_SRC}, but the options are close\\.${TAIL_PATTERN}$`,
  ),
  // Case NT (tied): effectively tied, no margin number.
  new RegExp(
    `^.+? is currently only fractionally ahead, so the options are effectively tied\\.${TAIL_PATTERN}$`,
  ),
  // Case NT (override tie): a WIDER gap the raw near_tie.is_tie override still
  // flagged as a tie — the winner is nominally ahead but the analysis treats it
  // as a close call. Emitted by both the >= MIN_LEAD_PROBABILITY near-tie
  // branch and the sub-0.40 tie-override preemption via tieHeadlineText.
  //
  // ⚠ THE NUMBER-FREE OVERRIDE FORM IS NO LONGER ADMITTED, AND THAT IS
  // DELIBERATE. This comment used to say the margin fragment was optional "so
  // the rare number-free override form ('… currently leads, but the analysis
  // treats this as a close call.') also survives the egress allowlist". That
  // allowance existed because the OLD margin fragment could be empty. It cannot
  // happen now: `leadClause` is built from the leader's own win probability,
  // which `resolveWinner` guarantees is finite for every winner this module
  // returns, so every override emission carries its number by construction —
  // the number-free form is unreachable from any builder path.
  //
  // It is therefore removed from the grammar rather than tolerated, on the same
  // reasoning that retired the pp phrasing: this allowlist is the SECOND LINE
  // OF DEFENCE, so every shape it admits is a shape some future regression may
  // put on the wire unchallenged. An allowlist should admit exactly what the
  // builder can emit — no less (or honest copy is silently swapped for the
  // locked template) and no more (or the guard stops discriminating). If a
  // number-free override form is ever wanted back, the builder must emit it AND
  // this alternation must be widened to `(?:${LEAD_CLAUSE_RE_SRC}|currently
  // leads)` in the same commit.
  new RegExp(
    `^.+? ${LEAD_CLAUSE_RE_SRC}, but the analysis treats this as a close call\\.${TAIL_PATTERN}$`,
  ),
  // Doctrine D-W (ROADMAP 2.52): leader-trails-argmax honest disambiguation —
  // "{leader} leads overall, though {runner-up} has marginally better raw
  // probability." Two lazy label slots; surrounding tokens pinned. Contains no
  // banned vocabulary, so the ordinary forbidden-vocab / ID / decimal defences
  // (applied after the grammar match) still bite on a leaky slot.
  new RegExp(
    `^.+? leads overall, though .+? has marginally better raw probability\\.${TAIL_PATTERN}$`,
  ),
  // Case E (link-safe floor): minimal "{label} currently leads.{suffix}".
  // MUST stay last — the trailing `\\.${TAIL_PATTERN}$` anchor is
  // strictly less specific than the other cases and would not match their
  // outputs (those extend "leads" with " by N percentage points", "because",
  // ", but", "with N% probability", or " is currently only fractionally
  // ahead" before the terminal period), so ordering is for clarity rather
  // than correctness.
  new RegExp(`^.+? currently leads\\.${TAIL_PATTERN}$`),
];

function matchesHeadlineGrammar(text: string): boolean {
  for (const re of HEADLINE_GRAMMAR_REGEXES) {
    if (re.test(text)) return true;
  }
  return false;
}


/**
 * Returns true when `text` is a string the run_analysis handler is
 * permitted to expose on the wire — either an exact locked-template
 * literal, or a string that satisfies the deterministic headline
 * grammar end-to-end. The validation-registry forwarder uses this as
 * the second line of defence: if a future handler regression emits
 * improvised prose, the forwarder substitutes the locked-template
 * fallback instead of letting the prose through.
 *
 * Rules (in order):
 *   1. Must be a non-empty string.
 *   2. Must be at most {@link MAX_HEADLINE_CHARS}.
 *   3. Must not contain newline characters.
 *   4. Locked-template literals pass exactly (case-sensitive).
 *   5. Otherwise must match one of the five headline grammar regexes
 *      ({@link HEADLINE_GRAMMAR_REGEXES}) — Case A/B/C/D/E with an
 *      optional partial / unknown status suffix. Anchor-only prose
 *      that lacks the surrounding tokens (e.g. "Hire A currently leads
 *      for reasons outside the deterministic grammar.") is rejected by
 *      the case-E literal-period anchor. Cases A/B/C/D extend the
 *      anchor with "because", ", but", or "with N% probability" before
 *      the terminal period.
 *   6. Even when the grammar matches, the following defence-in-depth
 *      rules still apply:
 *        - no forbidden vocabulary (recommend / winner / best / …)
 *        - no ID-prefix tokens (opt_, fac_, …)
 *        - no raw decimal numbers (only integer % allowed)
 */
export function isAllowedRunAnalysisAssistantText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  // Length rule: base headline stays within MAX_HEADLINE_CHARS by
  // construction; the outer registry cap adds the Mission B tail budget
  // (provisional_doctrine_v0) — see MAX_ASSISTANT_TEXT_CHARS.
  if (text.length === 0 || text.length > MAX_ASSISTANT_TEXT_CHARS) return false;
  if (text.includes('\n') || text.includes('\r')) return false;
  if (RUN_ANALYSIS_LOCKED_TEMPLATES.has(text)) return true;
  // D-ask-1 (2.11 P0-1) + T1: a locked template may carry the scaffold
  // disclosure suffix and/or the constraint-gap disclosure suffix (the headline
  // path composes them via TAIL_PATTERN instead). The content defences still
  // bite on the label slots — a disclosure whose label smuggles an internal id
  // / raw decimal / forbidden vocabulary is rejected whole, and each builder's
  // own survival probe (safeScaffoldOptionLabel; buildConstraintDisclosure's
  // degrade-to-count-only) is what keeps honest labels out of that trap.
  for (const template of RUN_ANALYSIS_LOCKED_TEMPLATES) {
    if (
      text.length > template.length &&
      text.startsWith(template) &&
      TEMPLATE_SUFFIX_ONLY_REGEX.test(text.slice(template.length))
    ) {
      return passesAssistantTextContentDefences(text);
    }
  }
  if (!matchesHeadlineGrammar(text)) return false;
  // Defence-in-depth: grammar-shaped but content-leaky strings still
  // fail. A slot filler that happens to contain forbidden vocabulary
  // or an internal ID is caught here even though the surrounding
  // grammar matched.
  return passesAssistantTextContentDefences(text);
}

// `passesAssistantTextContentDefences` is imported from
// ./assistant-text-defences.ts (see the P1-3 note at the import site).
