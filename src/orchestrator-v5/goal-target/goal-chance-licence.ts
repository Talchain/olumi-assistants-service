import { goalHorizonVerdict, heldGoalHorizonMonths } from './goal-horizon-verdict.js';
import { shareGoalChanceWords } from './share-goal-chance-words.js';
import { zeroSpreadNoCarrierHorizonLine } from './zero-spread-horizon-line.js';
export { ZERO_SPREAD_NEEDS_MONTHLY_CHANGES } from './zero-spread-horizon-line.js';
/**
 * ⭐ D3 MILESTONE 1, STEP 2 — EACH OPTION'S CHANCE OF MEETING THE GOAL, AND WHAT MAY BE SAID ABOUT IT (DL 0df0e1 #87
 * 6005048156 + plan 6006078553; Science d5 6005138341 / 6005279728 / 6005640764; Wording c6 6005196947 + rulings 6 Oct).
 *
 * The goal chance has its OWN licence, separate from the win-share leader's (`leader_claim`): a withheld win-share leader
 * no longer silences a goal chance the Run computed for every option. CEE decides; the UI renders by identity
 * (`theUiRendersItDoesNotDecide`): the decision rides the Run's own record as ONE `info` entry in `inference_warnings`
 * (the keep-listed carrier — no new field, no schemas release, DL (b)), stored with the Run, so the turn and the reload
 * read the same decision.
 *
 *  · LICENSED — the goal states a level target with its direction and unit, and at least one scored option still carries
 *    a finite goal chance in [0, 1] after every withhold (the seam gate runs first). With no licensed figure, a zero-spread
 *    reason alone may retain an `each` record: empty percentages/message, no licensed chance claim.
 *  · PER OPTION (Science d5 #87 6007421281): an option whose chance was withheld for its OWN path (no figure on its record,
 *    or an exact 0/1 the Run did not earn, which the transport strips) loses only its own line — `withheld_option_ids`.
 *    Only the superlative and every-option forms need every option: with any option withheld the form is `each`.
 *  · `form` — which of c6's ruled sentences applies, decided HERE on the DISPLAYED whole percentages:
 *      `highest`                    the top clears the next by ≥ 10 points (Science's interim rule until each option's
 *                                   informative-draw count arrives, step 2b) and is at least 1%; once the records carry
 *                                   their precision, the top's 95% Wilson interval also overlaps no other option's
 *                                   (G4/G5 ruling 6; otherwise `similar`);
 *      `highest_all_likely_to_miss` that, and every option is at or under 40%;
 *      `all_likely_to_miss`         every option at or under 40%, no superlative;
 *      `similar`                    H2 (DL 0df0e1 6 Oct, d5 interim rule: below 10 points; c6 words "similar chances"):
 *                                   every option quoted, no superlative — `similar_option_ids` names every option within 10
 *                                   displayed points of the top, in the model's order (never ranked);
 *      `each`                       an option withheld for its own path: each option's line, in the model's order.
 *    ORDER COUNTS AS A SUPERLATIVE (d5 6005640764): only the two `highest` forms license an order by goal chance.
 */
import {
  GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_WITHHELD_CODES, GOAL_FIGURES_USER_EFFECT_CLAMPED, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
  readOptionResultSources,
} from '../../orchestrator/context/option-result-source.js';
import { withholdOptionGoalFigures, withholdStatusQuoIntervals, type PerLimitVerdict } from '../../orchestrator/context/constraint-feasibility.js';
import { sayFigure, sayFigureAsWritten } from '../agent-lane/say-figure.js';
import { midSentence } from '../agent-lane/guidance/render.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { sayGoalChange } from '../agent-lane/limit-frame.js';
import { zeroSpread } from '../agent-lane/goal-certainty.js';
import { goalTargetRow, statedGoalTargetOf } from './stated-goal-target.js';
import { readGoalRecord, type GoalRecord } from './goal-record.js';
import { goalChanceTargetCause } from './goal-chance-gate.js';
import { goalChanceHorizonOf } from './goal-chance-range.js';
import { isEventShareForecast } from './event-by-date-model.js';
import { hireLinkLimitedFor, OLUMI_HIRE_LIMIT_NOTE, olumiAssumedRangeLine, olumiAssumedTeamRange, shareByDateGoalForChanceOf, shareChanceInputFailure, sharePartsForOption } from './share-by-date-run.js';
import { goalOwnConstraintChanceRecords, sentRunPairsChange, sentRunScoresHeldChange, withSentTargetWithheld, type SentRunInputs } from './goal-own-constraint-chance.js';
import { effectsTimingOf, periodEndAssumptionNote, type EffectsTiming } from './period-end-assumption.js';
import { endsOfGraph, heldLinkOf, isUserStatedLink } from './held-user-links.js';
import { goalChanceEstimateCounts, olumiEstimateWords, type GoalChanceEstimateCounts } from '../agent-lane/goal-chance-estimate-attribution.js';
import { inputOriginOf, valueProvenanceOf } from '../../cee/provenance/provenance-of.js';
import { resolveGoalDirection } from './goal-direction.js';
import {
  BASIS_ALSO_REQUIRED_MAX, BASIS_CONDITION_MAX, effectsBasisWords, estimateOnlyWords, goalTargetBasisOf, partialGoalWords, periodEndWords, statusQuoAssumptionWords, statusQuoMovedWords,
  statusQuoProjectionWords, statusQuoRowWords,
  targetChanceWords, type GoalTargetBasis,
} from './goal-target-basis.js';
import { goalTargetsBlockOf, readGoalTargetsBlock, GOAL_TARGET_ROLE, type GoalTargetsBlock } from './goal-targets-joint.js';
import {
  displayedPctAt, displayRoundingFor, goalChanceDisplayClass, goalChanceDriverOf, goalChancePrecisionOf, intervalsDistinct, precisionHalfWidthPoints,
  type GoalChanceDisplayRounding, type GoalChanceDriver, type GoalChanceNoDriverReason, type GoalChancePrecision,
} from './goal-chance-driver.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const GOAL_CHANCE_LICENSED = 'GOAL_CHANCE_LICENSED';
/** Science's interim superlative gap, in displayed whole percentage points (d5 6005279728). */
export const SUPERLATIVE_GAP_POINTS = 10;
/** c6's "more likely to miss your goal than meet it" family: every displayed chance at or under this. */
export const MORE_LIKELY_TO_MISS_PCT = 40;

export type GoalChanceForm = 'highest' | 'highest_all_likely_to_miss' | 'all_likely_to_miss' | 'similar' | 'each';
export type GoalChanceComparator = 'at_least' | 'above' | 'at_most' | 'below';

/** Recorded by the Run-input owner only after the scoring frame has been confirmed. */
export interface SentGoalThreshold {
  readonly value: number;
  readonly field: 'goal_threshold' | 'goal_threshold_raw';
  readonly frame: 'level' | 'delta';
  readonly baseline?: number;
  readonly status_quo_option_id?: string;
}

// Science B19 ruling (3), 7 Oct: the "(see its downside)" variant is RETIRED; the note always uses the short words, and the
// goal-relative shortfall line (B19) follows it.
export const SPREAD_NOTE_WITHOUT_DOWNSIDE = 'Its typical result falls short of your target: this chance comes from its wider spread, which also means it could fall further short.';
/** The retired #2775 wording a Run saved before #2786 still carries; read as the short words, never said (Codex r4 on #2783). */
const SPREAD_NOTE_RETIRED = 'Its typical result falls short of your target: this chance comes from its wider spread, which also widens how far short it could fall (see its downside).';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const SHORTFALL_TEMPLATE = 'In its worst 1 in 20 runs of this model, ‘<label>’ falls short of your target by <figure> or more.';
const TYPICAL_SHORTFALL_TEMPLATE = 'In this model, ‘<label>’ falls short of your target in almost every run, typically by about <figure>.';
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortfallPatterns = [SHORTFALL_TEMPLATE, TYPICAL_SHORTFALL_TEMPLATE].map(template =>
  new RegExp(`^${template.split(/(<label>|<figure>)/).map(part =>
    part === '<label>' ? '([^\\r\\n]+)' : part === '<figure>' ? '[^\\r\\n]+' : escapeRegex(part)).join('')}$`));

/** Only the two ruled templates; the screen reader also binds the captured label to this option's graph label. */
export function shortfallNoteLabel(note: unknown): string | undefined {
  if (typeof note !== 'string') return undefined;
  for (const pattern of shortfallPatterns) {
    const match = pattern.exec(note);
    if (match !== null && match[0] === note) return match[1];
  }
  return undefined;
}

/** DOWN to two significant figures, including exact decimal/power-of-ten boundaries without division error. */
export function floorSig2(value: number): number {
  if (!finite(value) || value <= 0) return 0;
  const [mantissa, exponent] = value.toExponential().split('e');
  const digits = mantissa!.replace('.', '').slice(0, 2).padEnd(2, '0');
  return Number(`${digits}e${Number(exponent) - 1}`);
}

export interface GoalChanceZeroSpread {
  readonly reason: 'zero_spread';
  readonly side: 'meets' | 'falls_short';
  readonly line: string;
}

/**
 * AIE status-quo disposition (12 Oct): a Run read on the same-draw reference whose status-quo row does not sit at that
 * reference — a source, transport or currentness disagreement until checked. Withheld with this reason; never a finding.
 */
export interface GoalChanceReferenceMoved {
  readonly reason: 'reference_moved';
  readonly line: string;
}

export type GoalChanceWithheldReason = GoalChanceZeroSpread | GoalChanceReferenceMoved;

export interface GoalChanceLicence {
  readonly code: typeof GOAL_CHANCE_LICENSED;
  readonly severity: 'info';
  readonly message: string;
  readonly form: GoalChanceForm;
  /** Every scored option, in the model's option order (the order the Run's own records carry). */
  readonly option_ids: readonly string[];
  /** Each LICENSED option's DISPLAYED whole percentage — the figure the sentence quotes. */
  readonly pct_by_option: Readonly<Record<string, number>>;
  /** Identity and labels captured on this scored Run; absent only on historical licences. */
  readonly goal_node_id?: string;
  readonly goal_label?: string;
  readonly option_labels_by_option?: Readonly<Record<string, string>>;
  /** RC4's unaccepted link-size count for this scored Run; definitions are excluded. */
  readonly olumi_estimate_link_count?: number;
  /** Amendment 7: Olumi's estimated starting values / option settings on this Run's goal paths (independent check r1 item 6). */
  readonly olumi_estimate_value_count?: number;
  /** Per option: Olumi's own settings in that option (never said on another option's result). */
  readonly olumi_estimate_settings_by_option?: Readonly<Record<string, number>>;
  /** The options whose chance was withheld for their own path (model order); present only when non-empty. Form is `each`. */
  readonly withheld_option_ids?: readonly string[];
  /** `similar` only: the options within 10 displayed points of the top, in the model's order (≥ 2). */
  readonly similar_option_ids?: readonly string[];
  readonly leader_option_id?: string;
  readonly next_option_id?: string;
  /** The Run's unambiguous scoring threshold, retained even when there is no spread reversal. */
  readonly sent_threshold?: SentGoalThreshold;
  readonly spread_note_by_option?: Readonly<Record<string, string>>;
  readonly shortfall_note_by_option?: Readonly<Record<string, string>>;
  /** The target as the user stated it: the UI says it in these words, never re-derives the comparator. */
  readonly target: { readonly comparator: GoalChanceComparator; readonly value: number; readonly unit: string; readonly by_date?: string;
    /** The target's frame as Olumi's VALIDATED reading holds it (`goalTargetBasisOf`): a change from today, or 'level'. Absent
     *  when there is no validated reading — never defaulted (R5 meaning at the producer, DL 12 Oct). */
    readonly frame?: 'level' | 'change_abs' | 'change_rel' };
  /**
   * ⭐ D3 cut 5 (DL 0df0e1; Science d5 #87 6008242694 / 6008252938): present iff a USER-STATED link on a licensed option's
   * path to the goal carries an existence probability below 1 — the chances then also count Olumi's own assumption that
   * the user's link might not hold. `one_in` is N when every such link shares one value p and 1 − p is 1/N (0.8 → 5,
   * 0.9 → 10); absent when they differ (the words then say it is Olumi's estimate for each).
   */
  readonly user_link_existence?: { readonly links: number; readonly one_in?: number };
  /**
   * ⭐ D3 cut 6 INTERIM (Science d5 #87 6009272273 + amendment; DL adopted): present iff a compared option's goal path
   * carries an existence < 1 the user did not set (any link but a held one or an identity). Every summary form (highest,
   * either all-likely-to-miss, similar) can then be produced by Olumi's own existence prior, so the form is `each` and the
   * words say why (c6 owns them, by `form`: never "highest" when what was withheld was `similar`). Per-option chances stay
   * the headline.
   */
  readonly summary_withheld?: { readonly cause: 'olumi_existence_assumption'; readonly form: Exclude<GoalChanceForm, 'each'> };
  /**
   * ⭐ G4/G5 phase 2 (DL ruling 5): the step each LICENSED option's `pct_by_option` was displayed at — `whole` while its 95%
   * Wilson half-width is ≤ 2.5 points, else `nearest_5`. Present only for options whose record carries a well-formed
   * `probability_of_goal_precision`; an option without one is displayed whole, as before.
   */
  readonly display_rounding_by_option?: Readonly<Record<string, GoalChanceDisplayRounding>>;
  /**
   * ⭐ G4/G5 phase 2 (DL rulings 1–4): once the Run's records carry `probability_of_goal_drivers`, every LICENSED option is in
   * exactly ONE of these: its main driver (`goal-chance-driver.ts`), or the typed reason it has none. Never on a withheld
   * option. Absent when no licensed record carries a driver block (today's Runs: the record is unchanged).
   */
  readonly driver_by_option?: Readonly<Record<string, GoalChanceDriver>>;
  readonly no_driver_by_option?: Readonly<Record<string, GoalChanceNoDriverReason>>;
  /**
   * ⛔ Science §(ab)(2): a WITHHELD option whose every draw gave the same result (`zeroSpread`, the goal-certainty
   * producer's own predicate): which side of the target that fixed result falls on, and the face line saying it is
   * conditional. The UI places `line` instead of a %; absent for any other withhold.
   */
  readonly withheld_reason_by_option?: Readonly<Record<string, GoalChanceWithheldReason>>;
  /**
   * ⭐ RECOVERY BATCH C (rulings 18–22): the words after "chance of" for THIS Run's headline, when its target's reference and
   * period are stated (`goal-target-basis.ts`) — "‘productivity’ being at least 10% higher than today at three months" — or,
   * with several targets, the joint's words naming every condition. Absent = the older "chance of meeting your goal".
   */
  readonly chance_words?: string;
  /** Batch C: the disclosures said beside the chance, in order (amendments 1, 2, 4, 7, 10; rulings 6, 8, 14). */
  readonly notes?: readonly string[];
  /** Amendment 1: the status quo row of a change target, by assumption — never a figure or an interval. */
  readonly status_quo?: { readonly option_id: string; readonly line: string };
  /** Ruling 9 / amendments 7, 10: a relative change on Olumi's own starting value. */
  readonly estimate_only?: { readonly base: number; readonly unit: string };
  /** Amendment 7: any Olumi input (a starting value or an effect size) on the path makes the result provisional. */
  readonly provisional?: true;
  /** Batch C, several targets: each target's own chance and the same-draw joint (the headline) or why it is withheld. */
  readonly targets?: GoalTargetsBlock;
  /**
   * ⭐ G (AIE #94 6128697025; amendments 6131950992): present iff these chances are the CONDITIONAL reading of a change target on
   * a static model ({@link periodEndConditionalOf}): OLUMI'S assumption, never the person's, that the estimated effects are in
   * place by the period. The stored basis keeps `effects_at_period_end: false`; the note says the assumption once.
   */
  readonly period_end_assumption?: { readonly origin: 'olumi'; readonly period_months: number; readonly reference: 'today' | 'launch' };
  /** G2: the AI reading belongs to CEE's conditional licence, never the provider envelope. */
  readonly effects_timing?: EffectsTiming;
  readonly effects_timing_origin?: 'olumi';
}

/** What a Run SENT and STORED for its limits and targets, so the several-targets block names exactly the engine's conditions. */
export interface GoalChanceConstraintInputs {
  readonly perLimit?: readonly PerLimitVerdict[];
  readonly storedConstraints?: unknown;
  readonly sentConstraints?: unknown;
  /** What CEE sent PLoT for this Run: binds a deadline goal's engine-read chance (`goal-own-constraint-chance.ts`). */
  readonly sentRun?: SentRunInputs;
  /**
   * G (AIE 6131950992 (d)): the retained source a conditional reading is checked against — the persisted brief as this Run read
   * it. `null` (it could not be read) and absent (not given) both read no conditional chance: never "no contradiction".
   */
  readonly brief?: string | null;
  /** Olumi's AI reading for THIS Run. Missing or invalid readings withhold the conditional chance. */
  readonly effects_timing?: unknown;
}

const COMPARATOR: Readonly<Record<string, GoalChanceComparator>> = { '>=': 'at_least', '>': 'above', '<=': 'at_most', '<': 'below' };

/** The DISPLAYED whole percentage of a chance: the figure the user reads, and the one Science's gap is tested on. */
/**
 * Science §(ab)(2) face words for a zero-spread option (93 @0ecd69e4, ruled (a): never " / month" on the face):
 *  · the goal's level projected from monthly rates (an accumulation carrier): "Meets £20,000 a month by month 12 if today’s
 *    rates hold." / "Falls short of £20,000 a month by month 12 if today’s rates hold.";
 *  · no carrier and no horizon: "Meets £20,000 a month if today’s figures hold." / "Falls short of … if today’s figures hold.";
 *  · no carrier but a stated horizon: §(o′) wins, "Not shown yet: needs month-by-month changes".
 */
/**
 * How a Run reads carrying on as now (AIE status-quo disposition, 12 Oct, #94 6117119450):
 *  · `assumed` — the same-draw reference (ISL b504df27: `B + (option − SQ)`): no change, by assumption, no interval;
 *  · `moved` — that reference, but the Run's own status-quo row does not sit at it: withheld until checked, never relabelled;
 *  · `projection` — a forecast whose status quo legitimately varies: the Run's own projection, with its real uncertainty;
 *  · `unknown` — the checked facts do not say: no assumption is claimed, and the row is the Run's, exactly as before.
 */
type StatusQuoReading = 'assumed' | 'moved' | 'projection' | 'unknown';

/** A node's own label, sayable on one line; else undefined. */
function labelOfNode(nodes: readonly Rec[], id: string): string | undefined {
  const label = nodes.find((n) => n.id === id)?.label;
  return typeof label === 'string' && label.trim() !== '' && !/[\r\n]/.test(label) ? label.trim() : undefined;
}

/**
 * The one timing fact the reading uses (`goalHorizonVerdict`): ordinary = no held month (or the target's own at-period-end
 * basis) and no accumulation carrier anywhere; forecast = a carrier computed the held month, or rates accumulate with no held
 * month (ISL's `per_draw_baseline` path). A held month the Run did not carry, or an attestation, is neither.
 */
function ordinaryTimingOf(graph: unknown, envelope: unknown): { readonly ordinary: boolean; readonly forecast: boolean } {
  const verdict = goalHorizonVerdict(graph, envelope);
  const accumulates = isRec(graph) && Array.isArray(graph.nodes) && graph.nodes.some((n) => isRec(n)
    && isRec(n.nonlinear_identity) && n.nonlinear_identity.operation === 'accumulation');
  return {
    ordinary: !accumulates && (verdict === 'no_horizon' || verdict === 'basis_at_h'),
    forecast: verdict === 'computed_at_h' || (verdict === 'no_horizon' && accumulates),
  };
}

/**
 * The EXISTING checked facts that a LEVEL quantity is read on the same-draw reference (ISL b504df27, ordinary anchored
 * non-root level plans — single-goal chance and constraint series alike): today's level held on the node (anchored), the
 * node reached through links from a quantity (not a root), not set by any option (not directly set), and read from today
 * (not from a launch). The Run's summary statistics are never the proof.
 */
function pairedLevelFacts(graph: unknown, node: Rec, basis: Pick<GoalTargetBasis, 'reference'> | undefined): boolean {
  if (!isRec(graph) || typeof node.id !== 'string') return false;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const kindOf = (id: unknown): unknown => nodes.find((n) => n.id === id)?.kind;
  const anchored = isRec(node.observed_state) && finite(node.observed_state.raw_value);
  const reached = edges.some((e) => e.to === node.id && kindOf(e.from) !== undefined && kindOf(e.from) !== 'option' && kindOf(e.from) !== 'decision');
  const setDirectly = nodes.some((n) => n.kind === 'option'
    && [n.interventions, isRec(n.data) ? n.data.interventions : undefined].some((iv) => isRec(iv) && Object.hasOwn(iv, node.id as string)));
  return anchored && reached && !setDirectly && (basis === undefined || basis.reference === 'today');
}

/**
 * The checked facts decide; the Run's status-quo row only CHECKS them, and never stands in for them (DL re-scope after
 * independent check r2, BLOCKING 3: no "no change" from summary statistics — the equal-decile / zero-spread reading is not
 * used here at all). On the same-draw reference every draw IS the reference, so the row disagrees on ANY sign otherwise:
 * a share strictly between 0 and 1; ANY positive std (equal deciles never excuse it: std 3 with p10 = p90 = 75 is a spread);
 * deciles apart; or any recorded centre or decile not exactly the reference in the Run's frame (D2, exact equality).
 * A row that records none of these (no outcome, or its spread already withheld) agrees.
 */
function statusQuoReadingOf(a: {
  readonly paired: boolean; readonly forecast: boolean; readonly row: Rec | undefined; readonly reference: number | 'unknown' | undefined;
  /** A goal measured AS a change: the chance a ZERO change has against the held target (1 meets it, 0 does not). */
  readonly zeroChange?: 0 | 1;
}): StatusQuoReading {
  if (!a.paired) return a.forecast ? 'projection' : 'unknown';
  const row = a.row;
  if (row === undefined) return 'assumed';
  const p = row.probability_of_goal;
  if (typeof p === 'number' && p !== 0 && p !== 1) return 'moved';
  // ⭐ G (DL ruling 12 Oct: the AIE's D2 exact equality, applied IN THE RUN'S OWN RECORDED FRAME): a goal measured AS a change is
  // scored as the PAIRED change (each option minus carrying on, on the same draw), so carrying on's change is 0 = the
  // reference by construction, and its recorded chance must be exactly what a zero change gives against the held target. The
  // row's `outcome` holds the goal's raw level samples — another frame — and is never compared with the change's reference.
  // A recorded chance at the other extreme is a change that moved: withheld, never relabelled.
  if (a.zeroChange !== undefined) return typeof p === 'number' && p !== a.zeroChange ? 'moved' : 'assumed';
  const o = isRec(row.outcome) ? row.outcome : undefined;
  if (o === undefined) return 'assumed';
  // ⭐ D2 EXACT SAME-FRAME EQUALITY (AIE 6129749753 AMEND, PL 6130375396, 12 Oct; the 16ε tolerance is REJECTED): ANY positive
  // std, ANY deciles apart, and (below) any centre or decile not EXACTLY the reference in the Run's frame, is a reading that
  // moved. The AIE allows one narrow exception (a tiny std that is the arithmetic residue of a producer shown to give a
  // constant result); it is not taken here, so the checking reading stays (the 11 Oct row's own mean is one ulp off too).
  if (finite(o.std) && o.std > 0) return 'moved';
  if (finite(o.p10) && finite(o.p90) && o.p10 !== o.p90) return 'moved';
  // D2: a reference whose frame is not known is never compared, so the row is neither "moved" nor "no change".
  if (a.reference === 'unknown') return ['p10', 'p50', 'p90', 'mean'].some((k) => finite(o[k])) ? 'unknown' : 'assumed';
  const ref = a.reference;
  // D2 (PL 6130375396: AIE833 rejected the 1e-9·max(1, |reference|) floor): exact equality in the Run's frame.
  const away = (v: unknown): boolean => finite(v) && ref !== undefined && v !== ref;
  return ['p10', 'p50', 'p90', 'mean'].some((k) => away(o[k])) ? 'moved' : 'assumed';
}

function zeroSpreadReasons(
  sides: Readonly<Record<string, 'meets' | 'falls_short'>>, value: number, unit: string, goal: Rec | undefined, graph: unknown, envelope: unknown,
): Record<string, GoalChanceZeroSpread> {
  const verdict = goalHorizonVerdict(graph, envelope);
  const rates = ordinaryTimingOf(graph, envelope).forecast;
  const months = heldGoalHorizonMonths(goal);
  // The shared formatter's rate separator (" / month") is the panel's; the face says the period in words.
  const figure = sayFigureAsWritten(value, unit).replace(/ \/ (day|week|month|quarter|year)$/, ' a $1');
  const out: Record<string, GoalChanceZeroSpread> = {};
  for (const [id, side] of Object.entries(sides)) {
    const tail = rates ? `${months !== undefined ? ` by month ${months}` : ''} if today’s rates hold.` : ' if today’s figures hold.';
    const line = verdict === 'withhold' ? zeroSpreadNoCarrierHorizonLine()
      : side === 'meets' ? `Meets ${figure}${tail}` : `Falls short of ${figure}${tail}`;
    out[id] = { reason: 'zero_spread', side, line };
  }
  return out;
}

/** R5-5 (b): whether the Run sent the threshold of the target the goal states (see the guard in `goalChanceLicenceOf`). */
function targetSent(graph: Rec, goal: Rec, constraints: GoalChanceConstraintInputs): boolean {
  if (finite(goal.goal_threshold_raw)) return finite(goal.goal_threshold);
  const row = goalTargetRow(graph, goal);
  const sent = constraints.sentConstraints;
  if (row === undefined || typeof row.constraint_id !== 'string' || !Array.isArray(sent)) return true;
  return sent.some((r) => isRec(r) && r.constraint_id === row.constraint_id);
}

export function displayedGoalPct(p: number): number {
  return displayedPctAt(p, 'whole');
}

/**
 * The licence for the Run's goal chances, or null (nothing may be said beyond today's lines). Pure. An EXACT 0 or 1 counts
 * only where the Run's own goal certainty earned it (`earned`; 0.63.0): the transport strips an unearned one, so a licence
 * over it would quote a figure the user is never shown. No certainty decision ⇒ unearned (fail closed).
 */
function licenceGoalIdentity(goalId: unknown, goal: Rec | undefined) {
  return { ...(typeof goalId === 'string' ? { goal_node_id: goalId } : {}),
    ...(typeof goal?.label === 'string' ? { goal_label: goal.label } : {}) };
}

/** Target-state survives a primary-goal refusal, without reviving any refused percentages. */
function goalTargetStateOf(
  envelope: unknown, graph: unknown, goalId: unknown, earned: (optionId: string, p: 0 | 1) => boolean = () => false,
  sentThreshold?: SentGoalThreshold, horizonGraph: unknown = graph, constraints: GoalChanceConstraintInputs = {},
): GoalChanceLicence | null {
  const primary = goalChanceLicenceOf(envelope, graph, goalId, earned, sentThreshold, horizonGraph, constraints);
  if (primary !== null || !isRec(envelope)) return primary;
  const nodes = isRec(horizonGraph) && Array.isArray(horizonGraph.nodes) ? horizonGraph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId);
  const optionIds = nodes.filter((n) => n.kind === 'option' && typeof n.id === 'string').map((n) => n.id as string);
  const block = goalTargetsBlockOf({ envelope, graph: horizonGraph, optionIds,
    storedConstraints: constraints.storedConstraints, sentConstraints: constraints.sentConstraints,
    basis: goalTargetBasisOf(goal), perLimit: constraints.perLimit, primaryGoalId: goalId, primaryRefused: true });
  const target = block?.conditions.find((c) => c.role === 'target' && c.node_id === goalId);
  if (block === null || target === undefined || optionIds.length === 0) return null;
  // The primary percentage remains empty; secondary targets use the existing per-target guards and attribution.
  const seed: GoalChanceLicence = { code: GOAL_CHANCE_LICENSED, severity: 'info', message: '', form: 'each', option_ids: optionIds,
    pct_by_option: {}, withheld_option_ids: optionIds,
    target: { comparator: COMPARATOR[target.operator]!, value: target.value, unit: target.unit },
    ...licenceGoalIdentity(goalId, goal),
    notes: [], targets: block };
  return withSeveralTargets(seed, { envelope, graph: horizonGraph, goal, basis: goalTargetBasisOf(goal),
    statusQuoId: nodes.find((n) => n.kind === 'option' && n.is_baseline === true)?.id as string | undefined,
    constraints, option_ids: optionIds, alsoRequired: goalTargetBasisOf(goal)?.also_required ?? [],
    sqReading: 'unknown', timingOrdinary: ordinaryTimingOf(horizonGraph, envelope).ordinary,
    estimates: NO_ESTIMATES, estimateOnly: false, jointEstimates: undefined, primaryRefused: true });
}

export function goalChanceLicenceOf(
  envelope: unknown, graph: unknown, goalId: unknown, earned: (optionId: string, p: 0 | 1) => boolean = () => false,
  sentThreshold?: SentGoalThreshold, horizonGraph: unknown = graph, constraints: GoalChanceConstraintInputs = {},
): GoalChanceLicence | null {
  if (!isRec(envelope) || goalChanceTargetCause(graph, goalId) !== null) return null;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const share = shareByDateGoalForChanceOf(graph);
  if (shareChanceInputFailure(graph) !== null) return null;
  if (share === null && isEventShareForecast(graph)) return null;
  const target = goal === undefined ? null : statedGoalTargetOf(graph as Rec, goal);
  // ⭐ RECOVERY BATCH C (rulings 19–21): a target stated as a CHANGE from today now has its ruled sentence — but only on its
  // stated, validated, current basis (reference, denominator, period, effect unit; `goal-target-basis.ts`). A change with
  // no basis stays unlicensed (ruling 11: semantics are explicit or the chance is not said). A target that can be read more
  // than one way is never licensed while its question is open (amendment 3).
  const changeFrame = target?.frame === 'change_abs' || target?.frame === 'change_rel' ? target.frame : undefined;
  if (target === null || (target.frame !== undefined && target.frame !== 'level' && changeFrame === undefined)) return null;
  // ⛔ RE-SCOPE 2 (R5-5 (b); DL ruling): condition 1 — the RIGHT target. A goal that states a target the Run did not send a
  // threshold for has no chance of meeting THAT target: whatever the engine returned was scored on something else (or
  // nothing). Never licensed — on any Run, before or after a reopen. The target's own carrier decides what "sent" means
  // (`targetSent`): a figure the goal node holds is sent as its finite normalised threshold on the graph this Run scored (none:
  // a reading refused for its conditions, or a cap that could not be resolved); a target that is the goal's own limit row is
  // sent as that row (checked where the Run's request is known).
  if (goal === undefined || !targetSent(graph as Rec, goal, constraints)) return null;
  const basis: GoalTargetBasis | undefined = goal === undefined ? undefined : goalTargetBasisOf(goal);
  // ⛔ Ruling 12 / amendment 2: a change's "at three months" needs its effects stated at that month; never steady state.
  // D3: where the basis holds they are NOT stated, the Run says why (`withholdForPeriodEndEffects`), never a silent gap.
  // ⭐ G (AIE #94 6128697025; amendments 6131950992): except the CONDITIONAL reading on a static model — this very Run scored the
  // held target and the brief was read; the AI reads timing as not stated or in place by the period (G2).
  // The result says Olumi's assumption, never a human attestation.
  const conditional = changeFrame !== undefined && basis !== undefined && !basis.effects_at_period_end
    ? periodEndConditionalOf(envelope, graph, goalId, constraints) : undefined;
  if ((changeFrame !== undefined && (basis === undefined || (!basis.effects_at_period_end && conditional === undefined)))
    || basis?.open_question !== undefined) return null;
  // A change carries its direction in its sign; with no comparator held, the run's own sense is the bound ISL scored.
  const held = statedComparatorOf(target.held, changeFrame !== undefined, graph, goalId);
  const comparator = held === undefined ? undefined : COMPARATOR[held];
  if (held === undefined || comparator === undefined || typeof target.unit !== 'string' || target.unit.trim() === '') return null;
  // ⭐ Ruling 21 / amendments 7, 10: a relative change needs today's level; on OLUMI's own starting value it is estimate_only.
  const goalState = isRec(goal?.observed_state) ? goal!.observed_state : undefined;
  const base = changeFrame === 'change_rel' && finite(goalState?.raw_value) ? goalState!.raw_value as number : undefined;
  if (changeFrame === 'change_rel' && base === undefined) return null;
  // Olumi's disclosed reading of the brief's figure keeps its own words (read once, for both rules below).
  const levelReadingHeld = levelReadingHeldOn(goal);
  // ONE PROVENANCE AUTHORITY: "Olumi's assumed starting value" only where the base is Olumi's (origin `ai`, not accepted) —
  // never a human-written figure whose role is unverified (AIE 0825 §2: disclosed by the unverified note instead).
  const goalBase = valueProvenanceOf(goalState);
  const estimateOnly = changeFrame === 'change_rel' && goalBase.origin === 'ai' && !goalBase.accepted && !goalBase.structural && !levelReadingHeld;
  // ⛔ RE-SCOPE 2 (DL AMEND item 2; AIE R5 item 2): the existing stronger rule is kept, never relabelled. Admission never admits
  // Olumi's own estimate of a goal's current level (`admit-model.ts` `goalLevelIsEstimated`: "Olumi's own estimate of the
  // current level … was not used … that figure would rest on a guess"), so a chance of a LEVEL (or an absolute change of a
  // level) is never shown against a starting value of the goal that is Olumi's (a recognised AI source) — a provisional label
  // never licenses that refused result. Not a new human-only rule (AIE item 2): a goal level whose source is UNVERIFIED is
  // disclosed by the unverified note like any other input; an accepted estimate and Olumi's disclosed reading of the brief's
  // figure keep their own words; a relative change keeps `estimate_only`.
  // ONE predicate with the Run's refusal words (`withholdForOlumiGoalLevel`, below: why, and the next step).
  if (goalLevelIsOlumisEstimate(graph, goalId)) return null;
  const statusQuoId = nodes.find((n) => n.kind === 'option' && n.is_baseline === true && typeof n.id === 'string')?.id as string | undefined;
  // The Run's own option records, current-first: the first carrier that has any is the comparison. DL (b1): where PLoT gave
  // no `probability_of_goal` at threshold 1, the goal's OWN constraint, bound by identity, is the figure (never over a withhold).
  const engine = goalOwnConstraintChanceRecords(envelope, graph, goalId, readOptionResultSources(envelope).find((s) => s.length > 0) ?? [],
    constraints.sentRun);
  const records = engine.records;
  // ⭐ AIE status-quo disposition (12 Oct, #94 6117119450; PL 6117155350) — amendment 1 is PARTIAL by design. Whether
  // carrying on is "no change, by assumption" is decided by the EXISTING checked facts about how this Run reads the goal,
  // never by a summary statistic of the Run's row (`statusQuoReadingOf`): the same-draw reference (paired) → by assumption,
  // and a row that disagrees with it is withheld as a source/currentness disagreement; a forecast → carrying on's own
  // projection, kept with its uncertainty; anything else → no assumption is claimed and the row is the Run's, as before.
  const sqRow = statusQuoId === undefined ? undefined
    : records.find((r) => (typeof r.option_id === 'string' ? r.option_id : r.id) === statusQuoId);
  const today = finite(goalState?.raw_value) ? goalState!.raw_value as number : undefined;
  /**
   * ⭐ D2 (DL ruling 12 Oct, recovery Batch D): today's level is compared with the Run's status-quo row IN THE FRAME THE RUN
   * WAS SCORED IN, never across frames. Served run 3 (capacity): the row was on the normalised scale (0.16 = 80/500) and was
   * compared with `raw_value` 80, so a status quo sitting exactly at today read "doesn't match … as it stands today". The
   * Run's own recorded threshold (`SentGoalThreshold`, the samples' frame, checked against the goal it names) decides: its
   * normalised field → the normalised `value`, its raw field → `raw_value`. With no record, only a level both frames hold
   * alike is known; anything else is 'unknown', never 'moved'.
   */
  const levelToday = ((): number | 'unknown' | undefined => {
    if (today === undefined) return undefined;
    const normalised = finite(goalState?.value) ? goalState!.value as number : undefined;
    if (sentThreshold === undefined) return normalised === today ? today : 'unknown';
    if (sentThreshold.frame !== 'delta' || !finite(sentThreshold.value) || goal?.[sentThreshold.field] !== sentThreshold.value) return 'unknown';
    // The record's two fields name the two frames (`SentGoalThreshold['field']`): the raw one, and the normalised one.
    return sentThreshold.field.endsWith('_raw') ? today : normalised ?? 'unknown';
  })();
  // The goal's quantity frame as Olumi's validated reading holds it (`goalTargetBasisOf` keeps a reading only while its frame
  // equals the node's: 'change', else 'level'); read once, here.
  const readingFrame = basis?.quantity_frame;
  const changeQuantity = changeFrame !== undefined && readingFrame === 'change';
  const timing = ordinaryTimingOf(horizonGraph, envelope);
  // ⭐ G / D2 (AIE #94 6133027121): a change goal is read as paired only where the PRODUCER scored this Run's sent goal as the
  // paired change, and that sent goal is the held one — never because the goal's target says change.
  const pairedChange = changeQuantity && sentRunPairsChange(constraints.sentRun, goalId)
    && sentRunScoresHeldChange(constraints.sentRun, graph, goalId, held);
  const sqReading: StatusQuoReading = share !== null || statusQuoId === undefined || goal === undefined ? 'unknown'
    : statusQuoReadingOf({
      paired: timing.ordinary && (changeQuantity ? pairedChange : pairedLevelFacts(graph, goal, basis)),
      forecast: timing.forecast,
      row: sqRow,
      // A quantity measured AS a change is 0 today by construction; a level's reference is its held level today (D2: in
      // the Run's own frame).
      reference: changeQuantity ? 0 : levelToday,
      // G: D2 in the change frame — what a zero change scores against the held target (a level goal: unchanged, undefined).
      ...(changeQuantity ? { zeroChange: zeroChangeMeets(held, target.value) ? 1 as const : 0 as const } : {}),
    });
  const sqByAssumption = sqReading === 'assumed';
  const sqP = sqRow?.probability_of_goal;
  const goalLabel = typeof goal?.label === 'string' && goal.label.trim() !== '' && !/[\r\n]/.test(goal.label) ? goal.label.trim() : undefined;
  const option_ids: string[] = [];
  const licensed: string[] = [];
  const withheld: string[] = [];
  const pct: Record<string, number> = {};
  const recordOf = new Map<string, Rec>();
  const precisionOf = new Map<string, GoalChancePrecision>();
  const rounding: Record<string, GoalChanceDisplayRounding> = {};
  const zeroSpreadSide: Record<string, 'meets' | 'falls_short'> = {};
  for (const r of records) {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    if (id === undefined || option_ids.includes(id)) continue;
    recordOf.set(id, r);
    const p = r.probability_of_goal;
    option_ids.push(id);
    const precision = goalChancePrecisionOf(r);
    const step = precision === null ? 'whole' : displayRoundingFor(precisionHalfWidthPoints(precision));
    // ⭐ AIE 6125204695 (b1), 12 Oct: a deadline chance is the engine's own approximate point, said with its attribution; never
    // an old-law range, exact figure or exact-extreme override (`gate`/`exactChance` are mathematical references only). An
    // option whose parts CEE cannot state (so its attribution cannot be said) is withheld; the range record says why.
    if (share !== null && share.goal.id === goalId && sharePartsForOption(graph, id) === null) { withheld.push(id); continue; }
    // ⭐ Amendment 1: on the same-draw reference the status quo is measured against itself — no change, by assumption, never
    // a finding. One whose row disagrees with that reference is withheld with that reason, never relabelled.
    if ((sqByAssumption || sqReading === 'moved') && id === statusQuoId) { withheld.push(id); continue; }
    // Withheld for its own path: no figure on its record, or an exact 0/1 the Run did not earn (the transport strips it).
    if (typeof p !== 'number' || ((p === 0 || p === 1) && !earned(id, p))) {
      withheld.push(id);
      if ((p === 0 || p === 1) && zeroSpread(r)) zeroSpreadSide[id] = p === 1 ? 'meets' : 'falls_short';
      continue;
    }
    // An unusable figure here means a withhold did not run: fail closed, say nothing.
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    licensed.push(id);
    // ⭐ Ruling 5: the displayed step follows the figure's own precision; no precision block → whole, as before.
    if (precision !== null) {
      precisionOf.set(id, precision);
      rounding[id] = step;
    }
    pct[id] = displayedPctAt(p, step);
  }
  // The status quo's own line is a said row (amendment 1): with nothing else licensed it still reaches the user, as its typed
  // zero-spread reason did before (never a figure; the licence's message stays empty) — but only where the Run's own status-quo
  // row still carries its figure. A row whose figure was already withheld upstream (an untested horizon strips every option's)
  // said nothing before, so no record is added for it (fewer claims, never more).
  const sqSaid = (sqByAssumption || sqReading === 'moved') && statusQuoId !== undefined && withheld.includes(statusQuoId)
    && typeof sqP === 'number' && goalLabel !== undefined;
  if (option_ids.length < 2 || (licensed.length === 0 && Object.keys(zeroSpreadSide).length === 0 && !sqSaid)) return null;

  // Only the superlative and every-option forms need every option (d5 6007421281): any withheld option ⇒ `each`.
  // A status quo withheld by assumption counts as withheld here too, exactly as a change target's always has: no superlative
  // or every-option form is said beside a row that carries no figure (fewer claims, never more).
  const complete = withheld.length === 0;
  const ranked = [...licensed].sort((a, b) => pct[b]! - pct[a]!);
  const [leader, next] = ranked as [string, string];
  // ⭐ Ruling 6 (S1): once the records carry their precision, the leader's Wilson interval must also be DISTINCT from every
  // other option's; one licensed record without a well-formed block when others carry one → no superlative (fail closed).
  // No record carrying a block (today's Runs) keeps the interim 10-point rule alone.
  const precisionCarried = licensed.some((id) => recordOf.get(id)!.probability_of_goal_precision !== undefined);
  const precisionKnown = licensed.every((id) => precisionOf.has(id));
  const indistinct = (a: string, b: string): boolean => precisionKnown && !intervalsDistinct(precisionOf.get(a)!, precisionOf.get(b)!);
  const separated = !precisionCarried || (precisionKnown && licensed.every((id) => id === leader || !indistinct(leader, id)));
  const superlative = complete && pct[leader]! >= 1 && pct[leader]! - pct[next]! >= SUPERLATIVE_GAP_POINTS && separated;
  const allLikelyToMiss = complete && licensed.every((id) => pct[id]! <= MORE_LIKELY_TO_MISS_PCT);
  // H2: every option quoted and no superlative → the options within 10 points of the top, or whose interval overlaps the
  // top's (ruling 6), have similar chances.
  const same = complete && !superlative && !allLikelyToMiss
    ? licensed.filter((id) => pct[leader]! - pct[id]! < SUPERLATIVE_GAP_POINTS || indistinct(leader, id)) : [];
  const summary: GoalChanceForm = superlative
    ? (allLikelyToMiss ? 'highest_all_likely_to_miss' : 'highest')
    : allLikelyToMiss ? 'all_likely_to_miss' : same.length >= 2 ? 'similar' : 'each';
  // ⛔ INTERIM (d5 6009272273, DL adopted): a summary Olumi's own existence prior could have produced is not stated. J4 R17
  // read "highest" at 50/35 with the prior and 46/46 without it; MC draft 7 flipped its leader.
  const priorOnPath = summary !== 'each' && olumiExistenceOnGoalPath(graph, goalId, option_ids);
  const form: GoalChanceForm = priorOnPath ? 'each' : summary;
  const existence = userLinkExistenceOn(graph, goalId, licensed);
  // ⭐ Rulings 1–4: each licensed option's main driver, or why it has none, once the producer emits driver blocks.
  const drivers: Record<string, GoalChanceDriver> = {};
  const noDrivers: Record<string, GoalChanceNoDriverReason> = {};
  if (licensed.some((id) => recordOf.get(id)!.probability_of_goal_drivers !== undefined)) {
    for (const id of licensed) {
      const claim = goalChanceDriverOf(recordOf.get(id)!, id, graph, envelope);
      if ('driver' in claim) drivers[id] = claim.driver;
      else noDrivers[id] = claim.no_driver;
    }
  }
  const spread = spreadNotesOf(sentThreshold, goal, nodes, licensed, pct, recordOf, comparator, form);
  // ⭐ AIE #94 6160376175 (hiring row 3): on the bound percent CHANGE from today (a change quantity this Run scored as the paired
  // change from today), a shortfall is a share of today's level of the goal ("21% of today’s productivity"): never percentage
  // points, never a share of the target. Any other "%" change says no shortfall (it would be ambiguous); other units keep their own.
  const percentChange = changeFrame !== undefined && classifyUnitScaleClass(target.unit) === 'percent';
  const goalWords = typeof goal?.label === 'string' && goal.label.trim() !== '' && !/[\r\n]/.test(goal.label)
    ? midSentence(goal.label.trim()) : undefined;
  const ofToday = percentChange && changeFrame === 'change_abs' && pairedChange && basis?.reference === 'today' && goalWords !== undefined
    ? ` of today’s ${goalWords}` : undefined;
  const shortfall = percentChange && ofToday === undefined ? {}
    : shortfallNotesOf(sentThreshold, goal, nodes, licensed, pct, recordOf, comparator, form, target.unit, graph, envelope, ofToday ?? '');
  // Amendment 7 (independent check r1 item 6): every Olumi input on the goal paths — links, starting values, option settings.
  // ⛔ Re-scope (r2 BLOCKING 4; re-scope r1 BLOCKING 2): over everything upstream of EVERY node of the event this Run sent —
  // each target and each included limit (the joint rests on all of them), by any path — one census (`goalChanceEstimateCounts`).
  // ⛔ RE-SCOPE 2 (DL AMEND item 3): each figure keeps the dependency set of the event it MEASURES — the goal's own figure (and
  // range) the scored goal's upstream set alone; the joint the union over every condition the Run sent (`jointEstimates`,
  // below); each marginal its own condition's (`withSeveralTargets`).
  const eventNodes = eventNodeIdsOf(constraints, goalId);
  const estimates = licensed.length === 0 ? NO_ESTIMATES : goalChanceEstimateCounts(graph, option_ids, goalId);
  const jointEstimates = eventNodes.length === 0 ? undefined : goalChanceEstimateCounts(graph, option_ids, goalId, eventNodes);
  const settingsByOption = Object.fromEntries(Object.entries(estimates.settingsByOption).filter(([id, n]) => licensed.includes(id) && n > 0));
  // ⛔ R5-2: an input whose origin is unverified is never "zero estimates" and never Olumi's: disclosed once, beside the result.
  const unverifiedInputs = unverifiedOn(estimates, licensed);
  const estimateLinks = estimates.links;
  // Science §(ab)(2)'s typed zero-spread reasons, and (AIE disposition) the status quo whose row disagrees with the same-draw
  // reference: withheld with that reason, never relabelled.
  const withheldReasons: Record<string, GoalChanceWithheldReason> = {
    ...(Object.keys(zeroSpreadSide).length > 0 ? zeroSpreadReasons(zeroSpreadSide, target.value, target.unit, goal, horizonGraph, envelope) : {}),
    ...(sqReading === 'moved' && statusQuoId !== undefined && withheld.includes(statusQuoId) && goalLabel !== undefined
      ? { [statusQuoId]: { reason: 'reference_moved' as const, line: statusQuoMovedWords([goalLabel]) } } : {}),
  };
  const single: GoalChanceLicence = {
    code: GOAL_CHANCE_LICENSED,
    severity: 'info',
    message: licensed.length === 0 ? '' : `Each option’s ${share === null ? 'chance of meeting your goal'
      : shareGoalChanceWords(String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, ''), share.deadline)} is licensed on this Run.`,
    form,
    option_ids,
    pct_by_option: pct,
    ...licenceGoalIdentity(goalId, goal),
    option_labels_by_option: Object.fromEntries(option_ids.flatMap(id => {
      const label = nodes.find(n => n.id === id && n.kind === 'option')?.label;
      return typeof label === 'string' && label.trim() !== '' ? [[id, label]] : [];
    })),
    ...(estimateLinks > 0 ? { olumi_estimate_link_count: estimateLinks } : {}),
    ...(estimates.values > 0 ? { olumi_estimate_value_count: estimates.values } : {}),
    ...(Object.keys(settingsByOption).length > 0 ? { olumi_estimate_settings_by_option: settingsByOption } : {}),
    ...(spread === undefined && Object.keys(shortfall).length === 0 ? {} : { sent_threshold: sentThreshold }),
    ...(spread === undefined || Object.keys(spread).length === 0 ? {} : { spread_note_by_option: spread }),
    ...(Object.keys(shortfall).length === 0 ? {} : { shortfall_note_by_option: shortfall }),
    ...(withheld.length > 0 ? { withheld_option_ids: withheld } : {}),
    ...(Object.keys(withheldReasons).length > 0 ? { withheld_reason_by_option: withheldReasons } : {}),
    ...(form === 'similar' ? { similar_option_ids: same } : {}),
    ...(form === 'highest' || form === 'highest_all_likely_to_miss' ? { leader_option_id: leader, next_option_id: next } : {}),
    target: { comparator, value: target.value, unit: target.unit,
      ...(share !== null && share.goal.id === goalId ? { by_date: share.deadline } : {}) },
    ...(existence !== undefined ? { user_link_existence: existence } : {}),
    ...(priorOnPath ? { summary_withheld: { cause: 'olumi_existence_assumption' as const, form: summary as Exclude<GoalChanceForm, 'each'> } } : {}),
    ...(Object.keys(rounding).length > 0 ? { display_rounding_by_option: rounding } : {}),
    ...(Object.keys(drivers).length > 0 ? { driver_by_option: drivers } : {}),
    ...(Object.keys(noDrivers).length > 0 ? { no_driver_by_option: noDrivers } : {}),
    ...(conditional !== undefined ? { period_end_assumption: { origin: 'olumi' as const, period_months: conditional.basis.period_months,
      reference: conditional.basis.reference }, effects_timing: conditional.effects_timing, effects_timing_origin: 'olumi' as const } : {}),
  };
  const worded = withBatchCWords(single, {
    envelope, graph, goal, goalLabel, basis, changeFrame, comparatorHeld: held, target, base, estimateOnly, statusQuoId,
    periodEndNote: conditional?.note,
    sqByAssumption, sqReading, timingOrdinary: timing.ordinary,
    statusQuoLabel: statusQuoId === undefined ? undefined : labelOfNode(nodes, statusQuoId),
    // Acceptance is not authorship (DL 12 Oct, BLOCKING 3): an accepted Olumi value or link is still Olumi's — provisional.
    quantityFrame: readingFrame, olumiInputs: estimates.links + estimates.values + Object.keys(settingsByOption).length
      + estimates.acceptedValues + estimates.acceptedLinks > 0, unverifiedInputs,
    constraints, option_ids,
    estimates, jointEstimates,
  });
  // ⭐ AIE 6125204695 (3): beside a deadline chance on Olumi's range assumed from the user's single forecast, the input time
  // range is said once (the input, never a probability interval), on the licence's own notes.
  const onShare = share !== null && share.goal.id === goalId && licensed.length > 0;
  const assumedRange = onShare ? olumiAssumedTeamRange(graph) : null;
  // ⭐ E-TAIL (b), AIE 6130197656 §2: a licensed option whose hire link rests on Olumi's limit says so once, verbatim.
  const notes = [...(assumedRange === null ? [] : [olumiAssumedRangeLine(assumedRange)]),
    ...(onShare && hireLinkLimitedFor(graph, licensed) ? [OLUMI_HIRE_LIMIT_NOTE] : [])];
  return notes.length === 0 ? worded : { ...worded, notes: [...(worded.notes ?? []), ...notes] };
}

/**
 * ⭐ RECOVERY BATCH C: the ruled sentence (18–22) and its disclosures (amendments 1, 2, 4, 7, 10) on the licence the UI and
 * the Agent already read by identity, and — with several targets — the joint headline that replaces the single target's.
 * Never a figure the Run did not compute; never a parallel licence.
 */
function withBatchCWords(unframed: GoalChanceLicence, c: {
  readonly envelope: unknown; readonly graph: unknown; readonly goal: Rec | undefined; readonly goalLabel: string | undefined;
  readonly basis: GoalTargetBasis | undefined; readonly changeFrame: 'change_abs' | 'change_rel' | undefined;
  readonly comparatorHeld: string; readonly target: { readonly value: number; readonly unit?: string };
  readonly base: number | undefined; readonly estimateOnly: boolean; readonly statusQuoId: string | undefined;
  readonly sqByAssumption: boolean; readonly quantityFrame: 'level' | 'change' | undefined; readonly olumiInputs: boolean;
  /** R5-2: an input on this figure's paths whose origin is unverified (never "zero estimates", never Olumi's). */
  readonly unverifiedInputs: boolean;
  readonly sqReading: StatusQuoReading; readonly timingOrdinary: boolean; readonly statusQuoLabel: string | undefined;
  readonly constraints: GoalChanceConstraintInputs; readonly option_ids: readonly string[];
  readonly estimates: GoalChanceEstimates; readonly jointEstimates: GoalChanceEstimates | undefined;
  /** G: the AIE's note, present only on the conditional reading ({@link periodEndConditionalOf}). */
  readonly periodEndNote?: string;
}): GoalChanceLicence {
  const { goalLabel, changeFrame } = c;
  // ⭐ R5 MEANING AT THE PRODUCER (DL 12 Oct): the target says its frame whenever Olumi's VALIDATED reading holds one — a
  // level as well as a change (a frameless level target fails closed on the UI). No validated reading → no frame: never
  // defaulted to 'level'. `goalTargetBasisOf` keeps a reading only while it still describes this exact target.
  const validatedFrame = c.basis?.target_frame;
  const single: GoalChanceLicence = validatedFrame === undefined ? unframed
    : { ...unframed, target: { ...unframed.target, frame: validatedFrame } };
  // A level target's period is said only on an at-period-end basis (ruling 12); otherwise today's words, unchanged.
  // G: the conditional reading says the same own-target words, at the period it assumes (its note says so).
  const basis = c.basis !== undefined && (c.basis.effects_at_period_end || c.periodEndNote !== undefined) ? c.basis : undefined;
  const alsoRequired = c.basis?.also_required ?? [];
  // Amendment 7: any Olumi input (a starting value, an option setting or an effect size) on the path makes it provisional.
  // ⭐ LABEL, DON'T WITHHOLD (DL 12 Oct): an input whose origin is not established (R5-2) is shown too, never unlabelled —
  // provisional, with its own note saying what it rests on. It is never counted as Olumi's (that is `olumiInputs`).
  const provisional = c.estimateOnly || c.olumiInputs || c.unverifiedInputs || c.periodEndNote !== undefined;
  const unverified = c.unverifiedInputs ? [UNVERIFIED_SOURCES_NOTE] : [];
  // Amendment 1, every frame: the status quo's own line, by assumption — never a figure or an interval.
  const statusQuo = c.sqByAssumption && goalLabel !== undefined && c.statusQuoId !== undefined && single.option_ids.includes(c.statusQuoId)
    ? { status_quo: { option_id: c.statusQuoId, line: statusQuoRowWords(goalLabel) } } : {};
  // AIE disposition: a forecast's status quo is carrying on's own projection, said as such (never "no change").
  const projection = c.sqReading === 'projection' && c.statusQuoLabel !== undefined && c.statusQuoId !== undefined
    && single.option_ids.includes(c.statusQuoId) ? [statusQuoProjectionWords(c.statusQuoLabel)] : [];
  const assumed = [...('status_quo' in statusQuo && goalLabel !== undefined ? [statusQuoAssumptionWords(goalLabel)] : []), ...projection];
  // Amendment 4: what this target leaves out — every limit the Run did not include, and the brief's other stated conditions.
  // ⛔ Re-scope (r2 BLOCKING 2): EVERY retained condition is said, in its kept words, on every path (a stored reading whose
  // effects are not at the period's end, or whose words cannot be formed, keeps its conditions too). No condition is matched
  // away by a figure it shares with a typed limit ("spend within £200,000 and no contractors" is not that limit; "by March
  // 2026" is not "20"): both are said. With several targets the joint says them.
  const covers = (label: string): string[] => {
    if (sentTargetRows(c.constraints)) return [];
    const limits = limitsOutsideTheChance(c.graph, c.constraints);
    const partial = partialGoalWords(label, [...limits, ...alsoRequired]);
    return partial === undefined ? [] : [partial];
  };
  // On the paths that say today's plain sentence, the line is added only where conditions were retained (unchanged otherwise).
  const plainCovers = goalLabel !== undefined && alsoRequired.length > 0 ? covers(goalLabel) : [];
  if (goalLabel === undefined || (basis === undefined && changeFrame === undefined)) {
    // No stated basis: today's single-target sentence ("chance of meeting your goal"), with amendment 1's assumption and the
    // status quo's line where it is shown, and amendment 7's label; plus the several-targets block if the Run sent target rows.
    return withSeveralTargets({
      ...single,
      ...(assumed.length + plainCovers.length + unverified.length > 0 ? { notes: [...assumed, ...plainCovers, ...unverified] } : {}),
      ...statusQuo,
      ...(provisional ? { provisional: true as const } : {}),
    }, { ...c, basis, alsoRequired });
  }
  // Independent check r1 item 1: the goal's quantity frame as the validated reading holds it (admission stores a level with
  // no frame on the node; its reading says "level"). No reading → no frame → a % change is never given a default wording.
  const quantityFrame = c.quantityFrame;
  const words = targetChanceWords({
    label: goalLabel, frame: changeFrame ?? 'level', comparator: c.comparatorHeld, value: c.target.value, unit: c.target.unit ?? '',
    quantityFrame,
    ...(basis !== undefined ? { basis } : {}),
  });
  if (words === undefined) {
    return withSeveralTargets({ ...single, ...(assumed.length + plainCovers.length + unverified.length > 0
      ? { notes: [...assumed, ...plainCovers, ...unverified] } : {}), ...statusQuo,
      ...(provisional ? { provisional: true as const } : {}) }, { ...c, basis, alsoRequired });
  }
  const notes: string[] = [];
  // Ruling 21: the base a relative change is read from is said; on Olumi's value, as Olumi's (amendments 7, 10).
  if (changeFrame === 'change_rel' && c.base !== undefined) {
    notes.push(c.estimateOnly ? estimateOnlyWords(c.base, c.target.unit ?? '')
      : `Using ${sayFigureAsWritten(c.base, c.target.unit ?? '')} as today’s ‘${goalLabel}’.`);
  }
  // Amendment 1, where the Run reads the goal on the same-draw reference (AIE disposition: never assumed where the checked
  // facts do not establish it); a forecast's status quo is said as carrying on's own projection.
  if ('status_quo' in statusQuo) notes.push(statusQuoAssumptionWords(goalLabel, basis));
  notes.push(...projection);
  // Amendment 2 / DL hiring decision: the effects' timing basis and the additive reading — or, G, the conditional reading's
  // own note in the same place (never both: the stored basis says the effects are NOT stated at the period's end).
  const effects = basis === undefined ? undefined : effectsBasisWords(basis) ?? c.periodEndNote;
  if (effects !== undefined) notes.push(effects);
  // Amendment 4 (see `covers`): every limit the Run did not include and every retained condition.
  notes.push(...covers(goalLabel));
  notes.push(...unverified);
  const out: GoalChanceLicence = {
    ...single,
    // G (AIE #94 6133027121): the record the Agent reads says the chance in its own target's words, never "of meeting your goal".
    ...(single.message === '' ? {} : { message: `Each option’s chance of ${words} is licensed on this Run.` }),
    target: { ...single.target, ...(changeFrame !== undefined ? { frame: changeFrame } : {}) },
    chance_words: `chance of ${words}`,
    notes,
    ...statusQuo,
    ...(c.estimateOnly && c.base !== undefined ? { estimate_only: { base: c.base, unit: c.target.unit ?? '' } } : {}),
    ...(provisional ? { provisional: true as const } : {}),
  };
  return withSeveralTargets(out, { ...c, basis, alsoRequired });
}

/** The one census's counts (`goalChanceEstimateCounts`) over every target of this Run's event; settings unfiltered. */
type GoalChanceEstimates = GoalChanceEstimateCounts;
/** Nothing licensed and no event beyond the goal: nothing is said, so nothing is counted (not a census reading). */
const NO_ESTIMATES: GoalChanceEstimates = { links: 0, values: 0, settingsByOption: {}, unverifiedValues: 0, unverifiedSettingsByOption: {}, unread: false,
  acceptedValues: 0, unverifiedLinks: 0, acceptedLinks: 0 };

/**
 * ⛔ RE-SCOPE 2 (R5-2; DL AMEND item 1; AIE R5 handback item 1, its minimal existing-notes wording): an input whose origin is
 * unverified — neither attested as the person's nor a recognised AI source — or a census that could not read the event whole.
 * Said ONCE beside the result; never a count of Olumi's estimates, never "zero estimates". LABEL, DON'T WITHHOLD (DL 12 Oct):
 * the result it stands beside is shown with the provisional label — never withheld for this alone, never unlabelled.
 */
export const UNVERIFIED_SOURCES_NOTE = 'Provisional: this result uses inputs whose sources have not been verified.';

/** Whether the figures said for `said` options rest on any unverified input (shared values, or those options' own settings). */
function unverifiedOn(e: GoalChanceEstimates, said: readonly string[]): boolean {
  return e.unread || e.unverifiedValues > 0 || e.unverifiedLinks > 0 || said.some((id) => (e.unverifiedSettingsByOption[id] ?? 0) > 0);
}

/**
 * ⛔ Re-scope (r2 BLOCKING 4; re-scope r1 BLOCKING 2): every OTHER node of the event this Run sent. With several targets the
 * joint is every condition the engine was sent (`goalTargetsBlockOf`: each target AND each included limit), so each one's
 * node is the event's; with no target row sent the chance is the goal's alone (a limit is outside it, amendment 4): none.
 */
function eventNodeIdsOf(c: GoalChanceConstraintInputs, goalId: unknown): string[] {
  if (!sentTargetRows(c)) return [];
  const stored = Array.isArray(c.storedConstraints) ? c.storedConstraints.filter(isRec) : [];
  const sent = Array.isArray(c.sentConstraints) ? c.sentConstraints.filter(isRec) : [];
  return [...new Set(sent.flatMap((r) => {
    const row = stored.find((x) => x.constraint_id === r.constraint_id);
    const id = typeof row?.node_id === 'string' ? row.node_id : r.node_id;
    return typeof id === 'string' && id !== goalId ? [id] : [];
  }))];
}

const sentTargetRows = (c: GoalChanceConstraintInputs): boolean => {
  const stored = Array.isArray(c.storedConstraints) ? c.storedConstraints.filter(isRec) : [];
  const sent = Array.isArray(c.sentConstraints) ? c.sentConstraints.filter(isRec) : [];
  return sent.some((r) => stored.some((s) => s.constraint_id === r.constraint_id && s.role === GOAL_TARGET_ROLE));
};

/** The labels of the limits the user set that this single-target chance does not include (amendment 4). */
function limitsOutsideTheChance(graph: unknown, c: GoalChanceConstraintInputs): string[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const stored = Array.isArray(c.storedConstraints) ? c.storedConstraints.filter(isRec) : [];
  return stored.flatMap((row) => {
    if (row.role === GOAL_TARGET_ROLE || isRec(row.deadline_metadata)) return [];
    const label = nodes.find((n) => n.id === row.node_id)?.label;
    const bound = row.operator_as_stated ?? row.operator;
    const words = bound === '<' ? 'below' : bound === '<=' ? 'at most' : bound === '>' ? 'above' : bound === '>=' ? 'at least' : undefined;
    if (typeof label !== 'string' || label.trim() === '' || words === undefined || !finite(row.value)) return [];
    return [`‘${label.trim()}’ ${words} ${sayFigureAsWritten(row.value, typeof row.unit === 'string' ? row.unit : '')}`];
  });
}

/**
 * ⭐ Several targets (rulings 15–17, 22; amendments 5–6): the joint is the headline. Licensed → `pct_by_option` IS the joint
 * (the one figure the UI already quotes as "the chance of meeting your goal") and the single target's claims about
 * `probability_of_goal` (spread, shortfall, drivers, superlatives) go. Withheld → no option is quoted; the reason, and the
 * Fréchet bound when it applies, ride `targets.joint`. Each target's own chance is listed below in `targets.per_target`.
 */
function withSeveralTargets(l: GoalChanceLicence, c: {
  readonly envelope: unknown; readonly graph: unknown; readonly basis: GoalTargetBasis | undefined;
  readonly primaryRefused?: boolean;
  readonly statusQuoId: string | undefined; readonly constraints: GoalChanceConstraintInputs; readonly option_ids: readonly string[];
  /** The drafter's retained conditions (`goal_target_basis.also_required`), whatever the basis' timing (AIE C clause 3). */
  readonly alsoRequired: readonly string[];
  /** The goal's own status-quo reading, and the Run's ordinary timing: each other target is read on its OWN facts. */
  readonly goal: Rec | undefined; readonly sqReading: StatusQuoReading; readonly timingOrdinary: boolean;
  /** The goal's own figure's census (its upstream set), and whether the goal's own base is Olumi's. */
  readonly estimates: GoalChanceEstimates; readonly estimateOnly: boolean;
  /** Re-scope (r2 BLOCKING 4; DL AMEND item 3): the joint's census — the union over every condition the Run sent. */
  readonly jointEstimates: GoalChanceEstimates | undefined;
}): GoalChanceLicence {
  // ⭐ AIE status-quo disposition (12 Oct) item 4: a joint and its marginals keep each condition's OWN reference — the
  // primary goal's unchanged reference never attests a secondary target. Each target condition is read on its own checked
  // facts (`pairedLevelFacts`, the Run's ordinary timing); the status quo's own share for that condition only checks them.
  const nodes = isRec(c.graph) && Array.isArray(c.graph.nodes) ? c.graph.nodes.filter(isRec) : [];
  const stored = Array.isArray(c.constraints.storedConstraints) ? c.constraints.storedConstraints.filter(isRec) : [];
  const sent = Array.isArray(c.constraints.sentConstraints) ? c.constraints.sentConstraints.filter(isRec) : [];
  const sqId = c.statusQuoId !== undefined && c.option_ids.includes(c.statusQuoId) ? c.statusQuoId : undefined;
  const sqRecord = sqId === undefined ? undefined : ((isRec(c.envelope) ? readOptionResultSources(c.envelope) : []).find((x) => x.length > 0) ?? [])
    .find((r) => (typeof r.option_id === 'string' ? r.option_id : r.id) === sqId);
  const conditionReading = (row: Rec): StatusQuoReading => {
    if (sqId === undefined || typeof row.constraint_id !== 'string') return 'unknown';
    if (c.goal !== undefined && row.node_id === c.goal.id) return c.sqReading;
    const n = nodes.find((x) => x.id === row.node_id);
    const frame = stored.find((x) => x.constraint_id === row.constraint_id)?.value_frame ?? row.value_frame;
    if (n === undefined || (frame !== undefined && frame !== 'level') || !c.timingOrdinary || !pairedLevelFacts(c.graph, n, c.basis)) return 'unknown';
    const cp = sqRecord?.constraint_probabilities;
    const p = isRec(cp) ? cp[row.constraint_id] : Array.isArray(cp)
      ? cp.filter(isRec).find((x) => x.constraint_id === row.constraint_id)?.probability : undefined;
    return typeof p === 'number' && p !== 0 && p !== 1 ? 'moved' : 'assumed';
  };
  const targetRows = sent.filter((r) => stored.some((x) => x.constraint_id === r.constraint_id && x.role === GOAL_TARGET_ROLE));
  // ⛔ RE-SCOPE 2 (R5-3; AIE open 1): the JOINT is every condition the Run sent — each target AND each included limit
  // (`goalTargetsBlockOf` names them all) — so the status quo's place in it reads every one of those references, never the
  // target rows alone: fixed targets do not make an uncertain budget limit fixed, and a paired limit whose share disagrees
  // with its own reference withholds the status quo's joint with that reason. Each MARGINAL keeps its own target's reading.
  const jointRows = sent.filter((r) => typeof r.constraint_id === 'string');
  const readings = new Map(jointRows.map((r) => [r.constraint_id as string, conditionReading(r)]));
  const targetIds = new Set(targetRows.map((r) => r.constraint_id as string));
  const assumedIds = new Set([...readings].filter(([id, r]) => r === 'assumed' && targetIds.has(id)).map(([id]) => id));
  const movedIds = new Set([...readings].filter(([id, r]) => r === 'moved' && targetIds.has(id)).map(([id]) => id));
  const jointMovedIds = new Set([...readings].filter(([, r]) => r === 'moved').map(([id]) => id));
  const allAssumed = targetRows.length > 0 && jointRows.length > 0 && [...readings.values()].every((r) => r === 'assumed');
  let block = goalTargetsBlockOf({
    envelope: c.envelope, graph: c.graph, storedConstraints: c.constraints.storedConstraints,
    sentConstraints: c.constraints.sentConstraints, optionIds: c.option_ids,
    perLimit: c.constraints.perLimit, primaryGoalId: c.goal?.id, primaryRefused: c.primaryRefused,
    ...(sqId !== undefined ? { statusQuo: { id: sqId, fromJoint: allAssumed || jointMovedIds.size > 0, fromTargets: new Set([...assumedIds, ...movedIds]) } } : {}),
    ...(c.basis !== undefined ? { basis: c.basis } : {}),
  });
  if (block === null) return l;
  const {
    leader_option_id: _leader, next_option_id: _next, similar_option_ids: _similar, spread_note_by_option: _spread,
    shortfall_note_by_option: _shortfall, driver_by_option: _drivers, no_driver_by_option: _noDrivers, sent_threshold: _sent,
    summary_withheld: _summary, display_rounding_by_option: _rounding, withheld_reason_by_option: _zero, user_link_existence: _exists,
    status_quo: _singleStatusQuo, notes: _singleNotes,
    ...kept
  } = l;
  // Amendment 4 does not apply: the joint itself names every condition the Run sent.
  const targetNames = block.conditions.filter((x) => x.role === 'target').map((x) => x.label);
  // ⭐ AIE C clause 3: when the goal's OWN target cannot join the joint (stated as a change), its own licensed chance is kept
  // as one of the targets, said on its own — the same figure and words the single-target licence already licensed.
  const goalAlone = block.joint.status === 'withheld' && block.joint.reason === 'target_not_supported'
    && typeof l.chance_words === 'string' && l.chance_words.startsWith('chance of ') && Object.keys(l.pct_by_option).length > 0
    && typeof l.goal_node_id === 'string' && !block.conditions.some((x) => x.role === 'target' && x.node_id === l.goal_node_id)
    ? [{ constraint_id: `goal:${l.goal_node_id}`, words: l.chance_words.slice('chance of '.length), pct_by_option: l.pct_by_option,
      ...(l.display_rounding_by_option !== undefined ? { display_rounding_by_option: l.display_rounding_by_option } : {}) }]
    : [];
  if (goalAlone.length > 0) block = { ...block, per_target: [...goalAlone, ...block.per_target] };
  // Amendment 1, per condition: the assumption is said of exactly the targets whose own reference is the same-draw one.
  const goalLabel = typeof l.goal_label === 'string' && l.goal_label.trim() !== '' ? l.goal_label.trim() : undefined;
  const namedWhere = (ids: ReadonlySet<string>, reading: StatusQuoReading): string[] => [
    ...(goalAlone.length > 0 && c.sqReading === reading && goalLabel !== undefined ? [goalLabel] : []),
    ...block!.conditions.filter((x) => x.role === 'target' && ids.has(x.constraint_id)).map((x) => x.label),
  ];
  const assumedNames = namedWhere(assumedIds, 'assumed');
  // R5-3: a moved LIMIT is named too — it is why the status quo's joint is withheld.
  const movedNames = [...namedWhere(movedIds, 'moved'),
    ...block.conditions.filter((x) => x.role === 'limit' && jointMovedIds.has(x.constraint_id)).map((x) => x.label)];
  const notes: string[] = [...(block.notes ?? [])];
  let assumptionSaid = false;
  for (const n of l.notes ?? []) {
    if (n.startsWith('This chance covers ') || n === UNVERIFIED_SOURCES_NOTE) continue;
    if (n.startsWith('This assumes carrying on as now')) {
      if (assumedNames.length > 0 && !assumptionSaid) { notes.push(statusQuoAssumptionWords(assumedNames, c.basis)); assumptionSaid = true; }
      continue;
    }
    notes.push(n);
  }
  if (assumedNames.length > 0 && !assumptionSaid) notes.unshift(statusQuoAssumptionWords(assumedNames, c.basis));
  // ⭐ AIE C clause 3 (12 Oct): a condition the drafter RETAINED because this contract cannot represent it (a distinct
  // period or reference) is said beside the joint, never claimed by it. ⛔ Re-scope (r2 BLOCKING 2): EVERY one is said — a
  // retained condition sharing a figure with a target the joint names (the same 15% over a distinct period) is not that target.
  const covers = partialGoalWords(targetNames, c.alsoRequired);
  if (covers !== undefined && targetNames.length > 0 && (block.joint.status === 'licensed' || block.per_target.length > 0)) notes.push(covers);
  // The status quo's own line is said only where EVERY target's reference is the same-draw one (never universal by default);
  // a status quo whose own share disagrees with that reference is withheld with that reason.
  // R5-3: "no change" only where EVERY condition of the joint is on the same-draw reference — and then it names every one.
  const targetLabels = block.conditions.map((x) => `‘${x.label}’`);
  const statusQuo = sqId !== undefined && allAssumed && targetNames.length > 0 && targetLabels.length > 0
    ? { status_quo: { option_id: sqId,
      line: `Doing nothing: no change to ${targetLabels.length === 1 ? targetLabels[0] : `${targetLabels.slice(0, -1).join(', ')} or ${targetLabels[targetLabels.length - 1]}`} in this model, by assumption.` } }
    : {};
  const moved = sqId !== undefined && movedNames.length > 0
    ? { withheld_reason_by_option: { [sqId]: { reason: 'reference_moved' as const, line: statusQuoMovedWords(movedNames) } } } : {};
  // ⛔ RE-SCOPE 2 (DL ruling on marginals, (B)): each target's OWN chance rests on its own condition's upstream inputs (its
  // own census: three provenance states, each option's own settings) and says so — ONE note per marginal resting on any Olumi
  // estimate, in the points' count words (`olumiEstimateWords`); the options are named only where their counts differ. The
  // goal's own figure kept beside a withheld joint (AIE clause 3) is the goal's own census.
  const je = c.jointEstimates ?? c.estimates;
  const optionLabel = (id: string): string | undefined => {
    const recorded = l.option_labels_by_option?.[id];
    const label = typeof recorded === 'string' && recorded.trim() !== '' ? recorded : nodes.find((n) => n.id === id && n.kind === 'option')?.label;
    return typeof label === 'string' && label.trim() !== '' && !/[\r\n]/.test(label) ? label.trim() : undefined;
  };
  let marginalUnverified = false;
  for (const t of block.per_target) {
    const said = Object.keys(t.pct_by_option);
    const condition = block.conditions.find((x) => x.constraint_id === t.constraint_id);
    const e = t.constraint_id === `goal:${String(c.goal?.id)}` ? c.estimates
      : condition === undefined ? undefined : goalChanceEstimateCounts(c.graph, c.option_ids, c.goal?.id, [condition.node_id], { scoredInEvent: false });
    if (said.length === 0 || e === undefined) continue;
    if (unverifiedOn(e, said)) marginalUnverified = true;
    const counts = said.map((id) => olumiEstimateWords({ links: e.links, values: e.values, settings: e.settingsByOption[id] ?? 0 }));
    if (counts.every((x) => x === undefined)) continue;
    if (new Set(counts).size === 1) notes.push(`On its own, the chance of ${t.words} rests on Olumi's estimates: ${counts[0]!}.`);
    else {
      const each = said.flatMap((id, i) => (counts[i] === undefined || optionLabel(id) === undefined ? [] : [`‘${optionLabel(id)!}’: ${counts[i]!}`]));
      if (each.length > 0) notes.push(`On its own, the chance of ${t.words} rests on Olumi's estimates for ${each.join('; for ')}.`);
    }
  }
  if (block.joint.status === 'licensed') {
    const quoted = block.joint.pct_by_option;
    // R5-2: one note, beside the result, when the joint or any marginal said rests on an unverified input — and the joint is
    // then provisional (LABEL, DON'T WITHHOLD, DL 12 Oct).
    const jointUnverified = unverifiedOn(je, Object.keys(quoted)) || marginalUnverified;
    if (jointUnverified) notes.push(UNVERIFIED_SOURCES_NOTE);
    // ⛔ Re-scope (r2 BLOCKING 4): the joint rests on every input feeding ANY of its targets: it is provisional, and says on
    // what, from the one census over the union of their paths — each quoted option's own Olumi settings only.
    const { olumi_estimate_link_count: _k, olumi_estimate_value_count: _v, olumi_estimate_settings_by_option: _s, provisional: _p,
      // R5-3: the joint's own withheld set replaces the single target's (a status quo the joint now quotes is not withheld).
      withheld_option_ids: _singleWithheld, ...jointKept } = kept;
    const settings = Object.fromEntries(Object.entries(je.settingsByOption).filter(([id, n]) => Object.hasOwn(quoted, id) && n > 0));
    const provisional = c.estimateOnly || kept.provisional === true || jointUnverified
      || je.links + je.values + Object.keys(settings).length + je.acceptedValues + je.acceptedLinks > 0;
    return {
      ...jointKept,
      ...(je.links > 0 ? { olumi_estimate_link_count: je.links } : {}),
      ...(je.values > 0 ? { olumi_estimate_value_count: je.values } : {}),
      ...(Object.keys(settings).length > 0 ? { olumi_estimate_settings_by_option: settings } : {}),
      ...(provisional ? { provisional: true as const } : {}),
      form: 'each',
      pct_by_option: quoted,
      ...(c.option_ids.filter((id) => !Object.hasOwn(quoted, id)).length > 0
        ? { withheld_option_ids: c.option_ids.filter((id) => !Object.hasOwn(quoted, id)) } : {}),
      ...(block.joint.display_rounding_by_option !== undefined ? { display_rounding_by_option: block.joint.display_rounding_by_option } : {}),
      chance_words: `chance of ${block.joint.words}`,
      ...(notes.length > 0 ? { notes } : {}),
      ...statusQuo,
      ...moved,
      targets: block,
    };
  }
  // A withheld joint quotes no option: only the marginals (and the goal's own kept figure) are said beside it.
  if (marginalUnverified) notes.push(UNVERIFIED_SOURCES_NOTE);
  const { withheld_option_ids: _w, chance_words: _words, ...rest } = kept;
  return { ...rest, form: 'each', pct_by_option: {}, withheld_option_ids: [...c.option_ids], ...(notes.length > 0 ? { notes } : {}),
    ...statusQuo, ...moved, targets: block };
}

/**
 * One Run-input candidate must agree with every licensed option; ambiguity records nothing.
 * ⛔ Hiring row 3 (14 Oct): the licence it agrees with is the one the Run states, read with the Run's own inputs. A change goal
 * whose effects are not stated at the period end is licensed only on its conditional reading (`periodEndConditionalOf`: the
 * brief and Olumi's timing reading). With `sentRun` alone that licence was null, so no threshold was recorded and the shortfall
 * line (`shortfallNotesOf`) was never said for hiring.
 */
export function sentGoalThresholdOf(
  envelope: unknown, graph: unknown, goalId: unknown, earned?: (optionId: string, p: 0 | 1) => boolean,
  inputs: Pick<GoalChanceConstraintInputs, 'sentRun' | 'brief' | 'effects_timing'> = {},
): SentGoalThreshold | undefined {
  const sentRun = inputs.sentRun;
  const licence = goalChanceLicenceOf(envelope, graph, goalId, earned, undefined, graph, inputs);
  if (licence === null || Object.keys(licence.pct_by_option).length === 0) return undefined;
  const graphNodes: unknown[] = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  const goal = graphNodes.filter(isRec).find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined || !isRec(envelope)) return undefined;
  const records = goalOwnConstraintChanceRecords(envelope, graph, goalId, readOptionResultSources(envelope).find(s => s.length > 0) ?? [], sentRun).records;
  const candidates: SentGoalThreshold[] = [];
  for (const field of ['goal_threshold_raw', 'goal_threshold'] as const) {
    const value = goal[field];
    if (!finite(value)) continue;
    const agrees = Object.keys(licence.pct_by_option).every(id => {
      const record = records.find(r => (r.option_id ?? r.id) === id);
      const outcome = isRec(record?.outcome) ? record.outcome : undefined;
      return thresholdScaleAgrees(value, outcome?.p10, outcome?.p90, record?.probability_of_goal, licence.target.comparator);
    });
    if (agrees) candidates.push({ value, field, frame: 'delta' });
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The same percentile/chance agreement rules apply to candidate selection and the recorded scoring frame. */
function thresholdScaleAgrees(t: number, low: unknown, high: unknown, p: unknown, comparator: GoalChanceComparator): boolean {
  if (!finite(low) || !finite(high) || !finite(p) || low > high || p < 0 || p > 1) return false;
  const upwards = comparator === 'at_least' || comparator === 'above';
  return (t > low || (upwards ? p >= 0.85 : p <= 0.15))
    && (t < high || (upwards ? p <= 0.15 : p >= 0.85))
    && (t <= low || t >= high || (p >= 0.05 && p <= 0.95));
}

/** No frame is inferred from a target, a unit, or a sample magnitude. Missing Run inputs keep the note silent. */
function spreadNotesOf(
  sent: SentGoalThreshold | undefined, goal: Rec | undefined, nodes: Rec[], licensed: string[],
  pct: Record<string, number>, records: Map<string, Rec>, comparator: GoalChanceComparator, form: GoalChanceForm,
): Record<string, string> | undefined {
  if (licensed.length === 0 || sent === undefined || !finite(sent.value) || goal === undefined
    || !['goal_threshold', 'goal_threshold_raw'].includes(sent.field) || goal[sent.field] !== sent.value
    || (sent.frame !== 'level' && sent.frame !== 'delta')) return undefined;
  let offset = 0;
  if (sent.frame === 'level') {
    const statusQuo = nodes.find(n => n.id === sent.status_quo_option_id && n.kind === 'option' && n.is_baseline === true);
    const reference = records.get(sent.status_quo_option_id ?? '');
    const mean = isRec(reference?.outcome) ? reference.outcome.mean : undefined;
    if (!finite(sent.baseline) || goal.goal_baseline !== sent.baseline || statusQuo === undefined || !finite(mean)) return undefined;
    offset = sent.baseline - mean;
  }
  const upwards = comparator === 'at_least' || comparator === 'above';
  const means = new Map<string, number>();
  for (const id of licensed) {
    const r = records.get(id)!;
    const outcome = isRec(r.outcome) ? r.outcome : undefined;
    if (!finite(outcome?.mean) || !finite(outcome?.p10) || !finite(outcome?.p90) || !finite(r.probability_of_goal)) return undefined;
    const mean = outcome.mean + offset;
    const low = outcome.p10 + offset;
    const high = outcome.p90 + offset;
    if (![mean, low, high].every(Number.isFinite) || low > high) return undefined;
    const p = r.probability_of_goal;
    // One failing option silences the whole Run; a normalised threshold against currency samples fails here.
    if (!thresholdScaleAgrees(sent.value, low, high, p, comparator)) return undefined;
    means.set(id, mean);
  }
  const notes: Record<string, string> = {};
  // This is the same visibility condition as goalChanceScreenLinesForAgent's point lines.
  if (form !== 'each') return notes;
  for (const b of licensed) {
    const meanB = means.get(b)!;
    const beyond = upwards ? sent.value > meanB : sent.value < meanB;
    if (!beyond) continue;
    const reversal = licensed.some(a => a !== b && pct[a]! < pct[b]!
      && (upwards ? means.get(a)! > meanB : means.get(a)! < meanB));
    if (!reversal) continue;
    Object.defineProperty(notes, b, { enumerable: true, value: SPREAD_NOTE_WITHOUT_DOWNSIDE });
  }
  return notes;
}

/**
 * B19 ruling (1): downside.p05 is normalised, outcome percentiles are raw. Only a verified zero-offset map in the
 * recorded delta frame licenses a goal-relative difference; each failed option loses only its own line.
 */
function shortfallNotesOf(
  sent: SentGoalThreshold | undefined, goal: Rec | undefined, nodes: Rec[], licensed: string[],
  pct: Record<string, number>, records: Map<string, Rec>, comparator: GoalChanceComparator, form: GoalChanceForm,
  unit: string, graph: unknown, envelope: Rec, reference = '',
): Record<string, string> {
  const notes: Record<string, string> = {};
  // goalChanceScreenLinesForAgent shows no per-option point under `similar` or a superlative.
  if (form !== 'each' || comparator !== 'at_least' || sent === undefined || sent.frame !== 'delta'
    || !finite(sent.value) || goal === undefined || !['goal_threshold', 'goal_threshold_raw'].includes(sent.field)
    || goal[sent.field] !== sent.value || correlationBlockOn(graph) || correlationBlockOn(envelope)) return notes;
  const cap = goal.goal_threshold_cap;
  const raw = goal.goal_threshold_raw;
  const t = goal.goal_threshold;
  if (!finite(cap) || cap <= 0 || !finite(raw) || !finite(t) || !finite(t * cap)
    || Math.abs(t * cap - raw) > 1e-9 * Math.abs(raw)) return notes;
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings.filter(isRec) : [];
  for (const id of licensed) {
    if (!Object.hasOwn(pct, id) || pct[id] === 100 || warnings.some(w =>
      (w.code === 'GOAL_CHANCE_RANGE' && isRec(w.range_by_option) && Object.hasOwn(w.range_by_option, id))
      || (typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
        && (w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED || w.code === GOAL_FIGURES_USER_EFFECT_CLAMPED
          || !Array.isArray(w.option_ids) || w.option_ids.length === 0 || w.option_ids.includes(id))))) continue;
    const r = records.get(id)!;
    const downside = isRec(r.downside) ? r.downside : undefined;
    const outcome = isRec(r.outcome) ? r.outcome : undefined;
    if (!finite(downside?.p05) || !finite(outcome?.p10)) continue;
    const q05 = downside.p05 * cap;
    if (!finite(q05) || q05 > outcome.p10 + 1e-6 * Math.abs(outcome.p10) || q05 >= raw) continue;
    // ⛔ Hiring row 3 (14 Oct): the outcome percentiles are in the frame this Run RECORDED (`sent.field`): raw beside the raw
    // threshold field, normalised beside the normalised one. The tail must also hold in that frame: a negative change in the
    // normalised frame passed the line above by its sign alone. The typical figure is read in that frame too (below).
    const toRaw = sent.field.endsWith('_raw') ? 1 : cap;
    const p10Raw = outcome.p10 * toRaw;
    if (!finite(p10Raw) || q05 > p10Raw + 1e-6 * Math.abs(p10Raw)) continue;
    const label = nodes.find(n => n.id === id && n.kind === 'option')?.label;
    if (typeof label !== 'string' || label.trim() === '' || /[\r\n]/.test(label)) continue;
    const difference = raw - (pct[id] === 0 ? (finite(outcome.p50) ? outcome.p50 * toRaw : NaN) : q05);
    if (!finite(difference) || difference <= 0) continue;
    const amount = pct[id] === 0 ? Number(difference.toPrecision(2)) : floorSig2(difference);
    if (!finite(amount) || amount <= 0) continue;
    // The target's shared formatter keeps four decimal places. Never turn a small positive shortfall into a displayed
    // zero, or round a conservative tail bound UP while saying "or more".
    if (amount < 0.0001 || (pct[id] !== 0 && Math.round(amount * 1e4) / 1e4 > amount)) continue;
    const figure = sayFigureAsWritten(amount, unit);
    // A two-state unit may format a difference as "on"; a shortfall requires a numeric amount.
    if (!/\d/.test(figure)) continue;
    // The caller's reference words follow the amount ("21% of today’s productivity"); empty for a level.
    const said = `${figure}${reference}`;
    const template = pct[id] === 0 ? TYPICAL_SHORTFALL_TEMPLATE : SHORTFALL_TEMPLATE;
    Object.defineProperty(notes, id, { enumerable: true, value: template.replace(/<label>|<figure>/g, part => part === '<label>' ? label : said) });
  }
  return notes;
}

/**
 * The Run's correlation_model is kept verbatim (compose.ts); graph fields survive the sent-graph transformations.
 * A present, non-empty block silences the whole Run, including correlation blocks nested in unknown graph carriers.
 * Empty/null blocks and scalar diagnostic flags (e.g. factor_evppi.correlation_active: false) are not blocks.
 */
function correlationBlockOn(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const found = Object.entries(value).some(([key, child]) =>
    (/correlat/i.test(key) && child !== null && typeof child === 'object' && Object.keys(child).length > 0)
    || (key === 'correlation_model' && child !== undefined && child !== null && !isRec(child))
    || correlationBlockOn(child, seen));
  seen.delete(value);
  return found;
}

/**
 * The user-stated relationships on a licensed option's path to THE SCORED goal that carry `exists_probability` < 1;
 * `undefined` when there are none. A link is on that path when its source is reached from the option's intervened
 * factors and its target reaches the goal (Codex r1 #2637: the goal the Run scored, never the first one).
 *  · USER-STATED is the relationship's AUTHORSHIP, not its size (Codex r1): a link the user sized (`linkSizing` 'user') or
 *    one their brief stated (`brief_extraction`, construction's mapping of an explicit brief relationship). An Olumi
 *    hypothesis the user only accepted is not theirs.
 *  · An IDENTITY edge (into a node whose `nonlinear_identity` lists its source) is fixed by ISL, never Bernoulli-gated
 *    (Codex r1: robustness_analyzer_v2 bypasses the gate), so it never counts.
 */
function userLinkExistenceOn(graph: unknown, goalId: unknown, optionIds: readonly string[]): { links: number; one_in?: number } | undefined {
  const held = userStatedLinksBelowOne(graph, goalId, optionIds);
  if (held.length === 0) return undefined;
  const values = [...new Set(held.map((e) => e.exists_probability as number))];
  const n = values.length === 1 && values[0]! < 1 ? 1 / (1 - values[0]!) : NaN;
  const oneIn = Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) >= 2 ? Math.round(n) : undefined;
  return { links: held.length, ...(oneIn !== undefined ? { one_in: oneIn } : {}) };
}

/**
 * The links `userLinkExistenceOn` counts (exported for its rows). Science d5 #87 6008444863: a `brief_extraction` edge is
 * the user's relationship only WITH its evidence (`source_quote`), so a drafter-invented mediator tagged brief_extraction
 * never becomes "your link".
 */
export function userStatedLinksBelowOne(graph: unknown, goalId: unknown, optionIds: readonly string[]): Rec[] {
  const endsOf = endsOfGraph(graph);
  return goalPathEdges(graph, goalId, optionIds).filter((e) => isUserStatedLink(e) && heldLinkOf(e, endsOf(e)) === null && belowOne(e));
}

/** The interim's predicate: a link on a compared option's goal path whose existence < 1 the user did not set (unheld). */
export function olumiExistenceOnGoalPath(graph: unknown, goalId: unknown, optionIds: readonly string[]): boolean {
  const endsOf = endsOfGraph(graph);
  return goalPathEdges(graph, goalId, optionIds).some((e) => heldLinkOf(e, endsOf(e)) === null && belowOne(e));
}

const belowOne = (e: Rec): boolean =>
  typeof e.exists_probability === 'number' && Number.isFinite(e.exists_probability) && e.exists_probability < 1;

/**
 * The directed, non-identity links on the options' paths to THE SCORED goal: reached from an option's intervened factors
 * or out-links, and reaching the goal. An IDENTITY edge is fixed by ISL, never Bernoulli-gated (Codex r1 #2637).
 */
function goalPathEdges(graph: unknown, goalId: unknown, optionIds: readonly string[]): Rec[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined) return [];
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const walkable = (id: unknown): boolean => { const k = kindOf.get(id); return k !== undefined && k !== 'option' && k !== 'decision'; };
  const directed = edges.filter((e) => e.edge_type !== 'bidirected');
  // Nodes with a directed path to the goal (the goal included).
  const toGoal = new Set<unknown>([goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of directed) if (toGoal.has(e.to) && !toGoal.has(e.from) && walkable(e.from)) { toGoal.add(e.from); grew = true; }
  }
  // Nodes reached from the licensed options: their intervened factors and their own out-links, then forward.
  const reached = new Set<unknown>();
  for (const id of optionIds) {
    const option = nodes.find((n) => n.id === id);
    const seeds = [...(isRec(option?.interventions) ? Object.keys(option!.interventions as Rec) : []),
      ...directed.filter((e) => e.from === id).map((e) => e.to)];
    for (const seed of seeds) if (walkable(seed)) reached.add(seed);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const e of directed) if (reached.has(e.from) && !reached.has(e.to) && walkable(e.to)) { reached.add(e.to); grew = true; }
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const identityEdge = (e: Rec): boolean => {
    const id = byId.get(e.to)?.nonlinear_identity;
    return isRec(id) && Array.isArray(id.factor_ids) && id.factor_ids.includes(e.from);
  };
  // ⭐ Hold-at-1.0 (d5 #87 6008807178): a held link is not Olumi's doubt; callers filter with the SAME `heldLinkOf`.
  return directed.filter((e) => reached.has(e.from) && toGoal.has(e.to) && !identityEdge(e));
}

/** Appends the licence to the Run's `inference_warnings` when there is one; otherwise the envelope itself. Pure. */
export function withGoalChanceLicence<E>(
  envelope: E, graph: unknown, goalId: unknown, earned?: (optionId: string, p: 0 | 1) => boolean,
  sentThreshold?: SentGoalThreshold, horizonGraph: unknown = graph, constraints: GoalChanceConstraintInputs = {},
): E {
  // B2 (check BLOCKING 3): a deadline goal's Run that did not test the HELD target withholds every option's chance, with words.
  const checked = withSentTargetWithheld(envelope, graph, goalId, constraints.sentRun);
  const licence = goalTargetStateOf(checked, graph, goalId, earned, sentThreshold, horizonGraph, constraints);
  if (licence === null || !isRec(checked)) return checked;
  // Recovery Batch C, amendment 1 (DL contract ruling 3): a status quo the licence records as BY ASSUMPTION carries no
  // precision and no Monte Carlo interval on any surface (its standard error is 0 by construction: never "±0").
  const shown = licence.status_quo === undefined ? checked : withholdStatusQuoIntervals(checked, licence.status_quo.option_id);
  const warnings = Array.isArray(shown.inference_warnings) ? shown.inference_warnings : [];
  return { ...shown, inference_warnings: [...warnings, { ...licence, ...goalChanceHorizonOf(checked) }] } as E;
}

/**
 * ⭐ (9) CHAT AND PANEL QUOTE THE SAME FIGURE (DL 0df0e1, 6 Oct): for each option the Run's licence displays at `nearest_5`
 * (ruling 5), its DISPLAYED chance as a fraction (`pct_by_option` / 100). Every place the Agent is handed that option's
 * `probability_of_goal` hands it this instead (`saved_run_options`, the run result's option rows), so it never says 43%
 * beside a panel showing 45%. Read only from a record `goalChanceLicenceForAgent` accepts; a whole-step option is absent
 * (its own figure already rounds to the panel's). Empty when there is nothing to replace.
 */
export function nearestFiveGoalChancesForAgent(result: unknown): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (!isRec(result) || goalChanceLicenceForAgent(result) === undefined) return out;
  const r = [isRec(result.enrichment) ? result.enrichment.inference_warnings : undefined, result.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).find((w): w is Rec => isRec(w) && w.code === GOAL_CHANCE_LICENSED)!;
  const steps = isRec(r.display_rounding_by_option) ? r.display_rounding_by_option : {};
  const pct = isRec(r.pct_by_option) ? r.pct_by_option : {};
  // ⛔ Recovery Batch C (ruling 15): with several targets the headline IS the same-draw joint, never the goal node's own
  // `probability_of_goal` (one target's marginal). EVERY quoted option is handed the joint as displayed, so no Agent row
  // can carry a single target's chance beside the joint's words; a withheld joint quotes nothing (no display, no figure).
  if (isRec(r.targets)) {
    for (const [id, shown] of Object.entries(pct)) {
      if (typeof shown === 'number' && Number.isInteger(shown) && shown >= 0 && shown <= 100) out.set(id, shown / 100);
    }
    return out;
  }
  for (const [id, step] of Object.entries(steps)) {
    const shown = pct[id];
    if (step === 'nearest_5' && typeof shown === 'number' && Number.isInteger(shown) && shown >= 0 && shown <= 100) out.set(id, shown / 100);
  }
  return out;
}

/** Both Agent doors carry the licence's extreme instead of its raw normal point (including retained r3 Runs).
 * A licensed nearest-5 replacement is checked as displayed, preserving the card's deliberate coarse rounding.
 */
export function goalChancePointForAgent(p: number, display: string | undefined, nearestFive?: number): number | undefined {
  if (!Number.isFinite(p) || p < 0 || p > 1) return undefined;
  const projected = nearestFive ?? p;
  if (display === undefined) return projected; // legacy permission remains the caller's existing rule
  const expectedClass = display === 'less than 1%' ? 'less_than_1' : display === 'more than 99%' ? 'more_than_99' : 'interior';
  if (expectedClass === 'less_than_1') return 0;
  if (expectedClass === 'more_than_99') return 1;
  return goalChanceDisplayClass(projected) === expectedClass ? projected : undefined;
}

/** Screen copy (goalChanceCopy.ts): the licence's displayed percentage, including its non-certainty edge words. */
export function goalChanceDisplayForAgent(result: unknown): Readonly<Record<string, string>> | undefined {
  const licence = agentLicenceRecordOf(result);
  return licence === undefined ? undefined : goalChanceDisplayFromLicence(licence);
}

/** Display projection of an already validated licence; shared readers do not re-read the same record. */
export function goalChanceDisplayFromLicence(licence: Rec): Readonly<Record<string, string>> | undefined {
  const pct = isRec(licence.pct_by_option) ? licence.pct_by_option : {};
  const withheld = new Set(Array.isArray(licence.withheld_option_ids) ? licence.withheld_option_ids : []);
  const out: Record<string, string> = {};
  for (const id of licence.option_ids as string[]) {
    const shown = pct[id];
    if (withheld.has(id) || typeof shown !== 'number' || !Number.isInteger(shown) || shown < 0 || shown > 100) continue;
    out[id] = shown === 0 ? 'less than 1%' : shown === 100 ? 'more than 99%' : `about ${shown}%`;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface GoalChanceDriverAvailability {
  readonly scope: 'per_option_goal_chance';
  readonly source: 'GOAL_CHANCE_LICENSED';
  readonly status: 'available' | 'none_licensed' | 'not_recorded';
  readonly options: readonly {
    readonly option_id: string;
    readonly status: 'available' | 'none_licensed' | 'not_recorded';
    readonly reason?: GoalChanceNoDriverReason;
  }[];
}

/** Availability only, never a driver identity/ranking or decision sensitivity; no reconstruction from structural rows. */
export function goalChanceDriverAvailabilityForAgent(result: unknown): GoalChanceDriverAvailability | undefined {
  const licence = agentLicenceRecordOf(result);
  const displays = goalChanceDisplayForAgent(result);
  if (licence === undefined || displays === undefined) return undefined;
  const drivers = isRec(licence.driver_by_option) ? licence.driver_by_option : {};
  const absent = isRec(licence.no_driver_by_option) ? licence.no_driver_by_option : {};
  const reasons: readonly string[] = ['invalid_rows', 'below_resolution', 'correlated', 'set_by_option', 'no_cut_value', 'none'];
  const options = Object.keys(displays).map((option_id): GoalChanceDriverAvailability['options'][number] => {
    const driver = isRec(drivers[option_id]) ? drivers[option_id] : undefined;
    const reason = absent[option_id];
    // Only the stored licence speaks. A conflicting or unreadable entry licenses neither presence nor absence.
    if (driver !== undefined && reason === undefined && isLicensedDriver(driver)) return { option_id, status: 'available' };
    if (drivers[option_id] === undefined && typeof reason === 'string' && reasons.includes(reason)) {
      return { option_id, status: 'none_licensed', reason: reason as GoalChanceNoDriverReason };
    }
    return { option_id, status: 'not_recorded' };
  });
  return {
    scope: 'per_option_goal_chance', source: GOAL_CHANCE_LICENSED,
    status: options.some((o) => o.status === 'available') ? 'available'
      : options.every((o) => o.status === 'none_licensed') ? 'none_licensed' : 'not_recorded',
    options,
  };
}

export function isLicensedDriver(d: Rec): boolean {
  if (typeof d.quantity_id !== 'string' || d.quantity_id === '' || !['user', 'olumi', 'unattributed'].includes(String(d.authored_by))) return false;
  if (d.kind === 'factor_value') return typeof d.factor_id === 'string' && d.factor_id !== ''
    && (d.side === 'low' || d.side === 'high') && typeof d.cut_value === 'number' && Number.isFinite(d.cut_value)
    && typeof d.pct_if_side === 'number' && Number.isInteger(d.pct_if_side) && d.pct_if_side >= 0 && d.pct_if_side <= 100;
  if (typeof d.from !== 'string' || d.from === '' || typeof d.to !== 'string' || d.to === '') return false;
  if (d.kind === 'link_strength') return (d.side === 'low' && d.strength === 'weaker') || (d.side === 'high' && d.strength === 'stronger');
  return d.kind === 'link_existence' && (d.side === 'absent' || d.side === 'present')
    && typeof d.pct_if_side === 'number' && Number.isInteger(d.pct_if_side) && d.pct_if_side >= 0 && d.pct_if_side <= 100;
}

export function agentLicenceRecordOf(result: unknown): Rec | undefined {
  if (!isRec(result) || goalChanceLicenceForAgent(result) === undefined) return undefined;
  return [isRec(result.enrichment) ? result.enrichment.inference_warnings : undefined, result.inference_warnings]
    .flatMap((w) => Array.isArray(w) ? w : []).find((w): w is Rec => isRec(w) && w.code === GOAL_CHANCE_LICENSED);
}

/**
 * ⭐ DL 0df0e1 ruling C (6 Oct): the Run's stored licence as the Agent may read it — `form` and option ids only, read by
 * its code where the Run carries it (`enrichment.inference_warnings`) or where a kept Run moved it (`inference_warnings`).
 * No percentage travels: the Agent quotes each option's `probability_of_goal` from its own row. `undefined` when the Run
 * carries no single well-formed licence.
 */
export function goalChanceLicenceForAgent(result: unknown): {
  form: GoalChanceForm; option_ids: string[]; leader_option_id?: string; similar_option_ids?: string[]; withheld_option_ids?: string[];
  sent_threshold?: SentGoalThreshold; spread_note_by_option?: Readonly<Record<string, string>>;
  shortfall_note_by_option?: Readonly<Record<string, string>>;
  withheld_reason_by_option?: Readonly<Record<string, GoalChanceWithheldReason>>;
  olumi_estimate_link_count?: number;
  olumi_estimate_value_count?: number;
  olumi_estimate_settings_by_option?: Readonly<Record<string, number>>;
  goal_node_id?: string; goal_label?: string; option_labels_by_option?: Readonly<Record<string, string>>;
  /** Recovery Batch C: the stored sentence parts, read only when well formed (a record at odds with itself speaks for nothing). */
  chance_words?: string; notes?: readonly string[]; status_quo?: { option_id: string; line: string };
  estimate_only?: { base: number; unit: string }; provisional?: true; targets?: GoalTargetsBlock;
  period_end_assumption?: GoalChanceLicence['period_end_assumption'];
  /** G (AIE #94 6133027121): the licensed target itself, read only when well formed. */
  target?: GoalChanceLicence['target'];
} | undefined {
  if (!isRec(result)) return undefined;
  const records = [isRec(result.enrichment) ? result.enrichment.inference_warnings : undefined, result.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).filter((w): w is Rec => isRec(w) && w.code === GOAL_CHANCE_LICENSED);
  if (records.length !== 1) return undefined;
  const r = records[0]!;
  const ids = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : undefined);
  const forms: readonly string[] = ['highest', 'highest_all_likely_to_miss', 'all_likely_to_miss', 'similar', 'each'];
  const optionIds = ids(r.option_ids);
  if (typeof r.form !== 'string' || !forms.includes(r.form) || optionIds === undefined) return undefined;
  const similar = ids(r.similar_option_ids);
  const withheld = ids(r.withheld_option_ids);
  // A record at odds with itself speaks for nothing (Codex r2 #2625; DGAI's reader refuses the same records).
  const form = r.form as GoalChanceForm;
  const superlative = form === 'highest' || form === 'highest_all_likely_to_miss';
  const named = (v: unknown): boolean => typeof v === 'string' && optionIds.includes(v);
  if (superlative ? !(named(r.leader_option_id) && named(r.next_option_id) && r.leader_option_id !== r.next_option_id)
    : r.leader_option_id !== undefined || r.next_option_id !== undefined) return undefined;
  if (form === 'similar'
    ? similar === undefined || similar.length < 2 || new Set(similar).size !== similar.length || !similar.every((id) => optionIds.includes(id))
    : r.similar_option_ids !== undefined) return undefined;
  if (r.withheld_option_ids !== undefined
    && (form !== 'each' || withheld === undefined || withheld.length === 0 || !withheld.every((id) => optionIds.includes(id)))) return undefined;
  // This is the producer's stored finding, never reconstructed from a public row whose exact 0/1 was stripped.
  const zeroSpreadReasons: Record<string, GoalChanceWithheldReason> = {};
  for (const [id, reason] of Object.entries(isRec(r.withheld_reason_by_option) ? r.withheld_reason_by_option : {})) {
    if (!withheld?.includes(id) || (isRec(r.pct_by_option) && Object.hasOwn(r.pct_by_option, id))
      || !isRec(reason) || typeof reason.line !== 'string' || reason.line.trim() === '' || /[\r\n]/.test(reason.line)) continue;
    if (reason.reason === 'zero_spread' && (reason.side === 'meets' || reason.side === 'falls_short')) {
      zeroSpreadReasons[id] = { reason: 'zero_spread', side: reason.side, line: reason.line };
    } else if (reason.reason === 'reference_moved' && reason.side === undefined) {
      // AIE status-quo disposition: the status quo's row disagrees with the same-draw reference (a typed reason, no side).
      zeroSpreadReasons[id] = { reason: 'reference_moved', line: reason.line };
    }
  }
  const sent = isRec(r.sent_threshold) ? r.sent_threshold : undefined;
  const notes = isRec(r.spread_note_by_option) ? r.spread_note_by_option : undefined;
  const validSent = sent !== undefined && finite(sent.value)
    && (sent.field === 'goal_threshold' || sent.field === 'goal_threshold_raw')
    && (sent.frame === 'delta' || (sent.frame === 'level' && finite(sent.baseline)
      && typeof sent.status_quo_option_id === 'string' && optionIds.includes(sent.status_quo_option_id)));
  const validSpread = form === 'each' && validSent
    && notes !== undefined && Object.keys(notes).length > 0
    && Object.entries(notes).every(([id, note]) => optionIds.includes(id) && !withheld?.includes(id)
      && isRec(r.pct_by_option) && finite(r.pct_by_option[id])
      && (note === SPREAD_NOTE_WITHOUT_DOWNSIDE || note === SPREAD_NOTE_RETIRED));
  const shortfall = isRec(r.shortfall_note_by_option) ? r.shortfall_note_by_option : undefined;
  const validShortfall = form === 'each' && validSent && sent?.frame === 'delta'
    && isRec(r.target) && r.target.comparator === 'at_least'
    && shortfall !== undefined && Object.keys(shortfall).length > 0
    && Object.entries(shortfall).every(([id, note]) => optionIds.includes(id) && !withheld?.includes(id)
      && isRec(r.pct_by_option) && Number.isInteger(r.pct_by_option[id])
      && (r.pct_by_option[id] as number) >= 0 && (r.pct_by_option[id] as number) < 100
      && shortfallNoteLabel(note) !== undefined);
  return {
    form,
    option_ids: optionIds,
    ...(typeof r.goal_node_id === 'string' ? { goal_node_id: r.goal_node_id } : {}),
    ...(typeof r.goal_label === 'string' ? { goal_label: r.goal_label } : {}),
    ...(isRec(r.option_labels_by_option) ? { option_labels_by_option: Object.fromEntries(
      Object.entries(r.option_labels_by_option).filter((entry): entry is [string, string] => optionIds.includes(entry[0])
        && typeof entry[1] === 'string' && entry[1].trim() !== ''),
    ) } : {}),
    ...(typeof r.olumi_estimate_link_count === 'number' && Number.isSafeInteger(r.olumi_estimate_link_count)
      && r.olumi_estimate_link_count > 0 ? { olumi_estimate_link_count: r.olumi_estimate_link_count } : {}),
    ...(typeof r.olumi_estimate_value_count === 'number' && Number.isSafeInteger(r.olumi_estimate_value_count)
      && r.olumi_estimate_value_count > 0 ? { olumi_estimate_value_count: r.olumi_estimate_value_count } : {}),
    ...(isRec(r.olumi_estimate_settings_by_option) && Object.keys(r.olumi_estimate_settings_by_option).length > 0
      && Object.entries(r.olumi_estimate_settings_by_option).every(([id, n]) => optionIds.includes(id)
        && typeof n === 'number' && Number.isSafeInteger(n) && n > 0)
      ? { olumi_estimate_settings_by_option: r.olumi_estimate_settings_by_option as Record<string, number> } : {}),
    ...(validSent && sent !== undefined ? { sent_threshold: {
      value: sent.value as number,
      field: sent.field as SentGoalThreshold['field'],
      frame: sent.frame as SentGoalThreshold['frame'],
      ...(typeof sent.baseline === 'number' ? { baseline: sent.baseline } : {}),
      ...(typeof sent.status_quo_option_id === 'string' ? { status_quo_option_id: sent.status_quo_option_id } : {}),
    } satisfies SentGoalThreshold } : {}),
    ...(validSpread ? { spread_note_by_option: Object.fromEntries(Object.keys(notes!).map((id) => [id, SPREAD_NOTE_WITHOUT_DOWNSIDE])) } : {}),
    ...(validShortfall ? { shortfall_note_by_option: shortfall as Record<string, string> } : {}),
    ...(typeof r.leader_option_id === 'string' ? { leader_option_id: r.leader_option_id } : {}),
    ...(similar !== undefined ? { similar_option_ids: similar } : {}),
    ...(withheld !== undefined ? { withheld_option_ids: withheld } : {}),
    ...(Object.keys(zeroSpreadReasons).length > 0 ? { withheld_reason_by_option: zeroSpreadReasons } : {}),
    ...batchCPartsOf(r, optionIds, withheld ?? []),
    ...(licensedTargetOf(r.target) !== undefined ? { target: licensedTargetOf(r.target)! } : {}),
  };
}

/** The stored target, only when every member is well formed (G: the Agent is handed the actual target it describes). */
function licensedTargetOf(t: unknown): GoalChanceLicence['target'] | undefined {
  if (!isRec(t) || !['at_least', 'above', 'at_most', 'below'].includes(String(t.comparator)) || !finite(t.value)
    || typeof t.unit !== 'string' || (t.frame !== undefined && !['level', 'change_abs', 'change_rel'].includes(String(t.frame)))
    || (t.by_date !== undefined && typeof t.by_date !== 'string')) return undefined;
  return { comparator: t.comparator as GoalChanceComparator, value: t.value, unit: t.unit,
    ...(typeof t.by_date === 'string' ? { by_date: t.by_date } : {}),
    ...(t.frame !== undefined ? { frame: t.frame as 'level' | 'change_abs' | 'change_rel' } : {}) };
}

/** The longest stored note read back: every retained condition at its full kept length, plus the limits beside them. */
const NOTE_MAX = BASIS_ALSO_REQUIRED_MAX * (BASIS_CONDITION_MAX + 2) + 2000;

/** Batch C's stored sentence parts, each validated on its own; a malformed part is simply not read. */
function batchCPartsOf(r: Rec, optionIds: readonly string[], withheld: readonly string[]): {
  chance_words?: string; notes?: readonly string[]; status_quo?: { option_id: string; line: string };
  estimate_only?: { base: number; unit: string }; provisional?: true; targets?: GoalTargetsBlock;
  period_end_assumption?: GoalChanceLicence['period_end_assumption'];
} {
  const sayable = (v: unknown, max = 600): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\r\n]/.test(v);
  // A note may name every retained condition (up to 20 × 300 characters; re-scope r2 BLOCKING 2): its own, larger bound.
  const notes = Array.isArray(r.notes) && r.notes.length > 0 && r.notes.every((n) => sayable(n, NOTE_MAX)) ? r.notes as string[] : undefined;
  const sq = isRec(r.status_quo) && typeof r.status_quo.option_id === 'string' && withheld.includes(r.status_quo.option_id)
    && sayable(r.status_quo.line) ? { option_id: r.status_quo.option_id, line: r.status_quo.line as string } : undefined;
  const est = isRec(r.estimate_only) && finite(r.estimate_only.base) && typeof r.estimate_only.unit === 'string'
    ? { base: r.estimate_only.base, unit: r.estimate_only.unit } : undefined;
  const targets = r.targets === undefined ? undefined : readGoalTargetsBlock(r.targets, optionIds);
  // G: Olumi's period-end assumption, read only when well formed (its origin is Olumi's, never a person's).
  const pea = isRec(r.period_end_assumption) ? r.period_end_assumption : undefined;
  const assumption = pea !== undefined && pea.origin === 'olumi' && Number.isInteger(pea.period_months) && (pea.period_months as number) > 0
    && (pea.reference === 'today' || pea.reference === 'launch')
    ? { origin: 'olumi' as const, period_months: pea.period_months as number, reference: pea.reference as 'today' | 'launch' } : undefined;
  return {
    ...(sayable(r.chance_words, 600) && r.chance_words.startsWith('chance of ') ? { chance_words: r.chance_words } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(sq !== undefined ? { status_quo: sq } : {}),
    ...(est !== undefined ? { estimate_only: est } : {}),
    ...(r.provisional === true ? { provisional: true as const } : {}),
    ...(targets !== undefined ? { targets } : {}),
    ...(assumption !== undefined ? { period_end_assumption: assumption } : {}),
  };
}

/** Olumi's disclosed reading of the brief's figure is held on the goal (it keeps its own words). The ONE read of it here. */
function levelReadingHeldOn(goal: Rec | undefined): boolean {
  return isRec(goal?.goal_level_reading);
}

/**
 * ⛔ AMEND item 2 (kept; DL 12 Oct "KEEP (a)"): the scored goal's own level is Olumi's estimate (origin ai, never accepted),
 * so no chance of a LEVEL (or an absolute change of one) is shown — admission never admits Olumi's own estimate of a goal's
 * current level (`admit-model.ts` `goalLevelIsEstimated`). Olumi's disclosed reading of the brief's figure keeps its own
 * words; a relative change keeps `estimate_only`. ONE predicate: the licence refuses on it, and the Run says why with the
 * next step ({@link withholdForOlumiGoalLevel}), so the two can never disagree.
 */
export function goalLevelIsOlumisEstimate(graph: unknown, goalId: unknown): boolean {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined || levelReadingHeldOn(goal)) return false;
  // The stated target through the ONE goal record (S5): `raw` is held exactly when a target is stated.
  const target = typeof goalId === 'string' ? readGoalRecord(graph, goalId)?.target : undefined;
  if (target?.raw === undefined || target.frame === 'change_rel') return false;
  const os = isRec(goal.observed_state) ? goal.observed_state : undefined;
  const holds = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  return os !== undefined && (holds(os.value) || holds(os.raw_value)) && inputOriginOf(os) === 'ai';
}

/**
 * ⭐ D3 (AIE #94 6128697025; DL 12 Oct, recovery Batch D): ruling 12 / amendment 2 withholds a change target's chance when its
 * validated basis holds that the effects are NOT stated at the period's end (`effects_at_period_end: false`). The licence
 * returns null, and the Run said nothing: run 3's hiring options showed no figure and no reason. The case read here, from the
 * same basis the licence reads: a change target, its basis held with no open question, saying the effects are not in place
 * by then. The protected field is never written and no chance is computed here.
 */
export function periodEndEffectsUnstatedOf(graph: unknown, goalId: unknown): { readonly record: GoalRecord; readonly basis: GoalTargetBasis } | undefined {
  // The goal through the ONE record (S5): a stated target, stated as a change.
  const record = typeof goalId === 'string' ? readGoalRecord(graph, goalId) : null;
  const frame = record?.target?.frame;
  if (record === null || record.target?.raw === undefined || (frame !== 'change_abs' && frame !== 'change_rel')) return undefined;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const basis = goal === undefined ? undefined : goalTargetBasisOf(goal);
  return basis !== undefined && basis.effects_at_period_end === false && basis.open_question === undefined ? { record, basis } : undefined;
}

/**
 * ⭐ G (AIE #94 6128697025, "S4/S8 — D timing decision"; amendments 6131950992 (a)–(e), 12 Oct): the CONDITIONAL reading of a
 * change target whose basis holds that the effects are NOT stated at the period's end ({@link periodEndEffectsUnstatedOf}).
 * A static model may support the chance under OLUMI'S disclosed assumption that its estimated effects are in place by the
 * period — never by flipping `effects_at_period_end`, never a steady state substituted silently. Every one of these holds,
 * else undefined (and {@link withholdForPeriodEndEffects} says E's sentence):
 *   · (b) the STATIC reading: no held month or deadline, no accumulation carrier, not a deadline-share forecast — a producer
 *     that models when the effects arrive, or sizes them at the period, says its own timing instead (never this note);
 *   · (a) THE Run: what CEE sent for this Run scored the held quantity, target, frame, unit, reference, comparator and period
 *     (`sentRunScoresHeldChange`); a `probability_of_goal` on the wire alone licenses nothing;
 *   · (d) the retained source was read: a brief that is absent or unreadable is never "no contradiction";
 *   · (c) the AI reads effects as in place by the period, or not stated. Later/partial, missing and invalid readings withhold;
 *   · (e) the target's own words can be said ("‘productivity’ being at least 10% higher than today at three months"), so a
 *     chance of this target alone is never worded as the chance of the whole goal (its other conditions stay in the notes).
 * The other guards (target, permission, currentness, condition) are the licence's own and run unchanged around this.
 */
export function periodEndConditionalOf(
  envelope: unknown, graph: unknown, goalId: unknown, inputs: Pick<GoalChanceConstraintInputs, 'sentRun' | 'brief' | 'effects_timing'> = {},
): { readonly record: GoalRecord; readonly basis: GoalTargetBasis; readonly note: string; readonly effects_timing: 'not_stated' | 'in_place_by_period' } | undefined {
  const held = periodEndEffectsUnstatedOf(graph, goalId);
  if (held === undefined) return undefined;
  // Ordinary timing (`ordinaryTimingOf`): no held month (a held month without an at-period basis is the horizon gate's
  // 'withhold'), no deadline, no accumulation carrier — so no forecast either; and not a deadline-share event.
  if (!ordinaryTimingOf(graph, envelope).ordinary || shareByDateGoalForChanceOf(graph) !== null || isEventShareForecast(graph)) return undefined;
  // The comparator the chance is stated with, exactly as the licence reads it (`statedComparatorOf`).
  const target = held.record.target;
  const comparator = statedComparatorOf(target?.comparator, true, graph, goalId);
  if (comparator === undefined || !sentRunScoresHeldChange(inputs.sentRun, graph, goalId, comparator)) return undefined;
  const brief = inputs.brief;
  if (typeof brief !== 'string' || brief.trim() === '') return undefined;
  if (inputs.effects_timing !== 'not_stated' && inputs.effects_timing !== 'in_place_by_period') return undefined;
  // Through the ONE goal record (S5): the label and the stated target the licence's words are formed from.
  const label = held.record.label.trim() !== '' && !/[\r\n]/.test(held.record.label) ? held.record.label.trim() : undefined;
  const frame = target?.frame === 'change_abs' || target?.frame === 'change_rel' ? target.frame : undefined;
  if (target == null || label === undefined || frame === undefined || target.raw === undefined || typeof target.unit !== 'string'
    || targetChanceWords({ label, frame, comparator, value: target.raw, unit: target.unit, quantityFrame: held.basis.quantity_frame,
      basis: held.basis }) === undefined) return undefined;
  return { ...held, note: periodEndAssumptionNote(held.basis), effects_timing: inputs.effects_timing };
}

/** Whether a change of exactly 0 meets the held comparison against the target (`held` is the stated comparator). */
function zeroChangeMeets(held: string, value: number): boolean {
  return held === '>=' ? 0 >= value : held === '>' ? 0 > value : held === '<=' ? 0 <= value : held === '<' ? 0 < value : false;
}

/** The comparator a chance is stated with: the held one, else — a change carries its direction in its sign — the Run's own sense. */
function statedComparatorOf(held: string | undefined, change: boolean, graph: unknown, goalId: unknown): string | undefined {
  return held ?? (change ? (resolveGoalDirection(graph, goalId)?.direction === 'minimise' ? '<=' : '>=') : undefined);
}

/**
 * The AIE's sentence, exactly (#94 6128697025). {target} is the stored target as the readiness words say a change
 * (`sayGoalChange`: "up at least 10% from today"); {period} is the basis' month. No next step: sizing a link does not clear it.
 */
export function periodEndEffectsWords(record: GoalRecord, basis: Pick<GoalTargetBasis, 'reference' | 'period_months'>): string {
  const label = record.label.trim() !== '' && !/[\r\n]/.test(record.label) ? record.label.trim() : undefined;
  const target = record.target;
  const change = target?.raw === undefined ? undefined
    : sayGoalChange(target.frame, target.raw, target.unit, (v, u) => sayFigure(v, u ?? ''), target.comparator);
  const what = `your target${label === undefined ? '' : ` for ‘${label}’`}${change === undefined ? '' : ` (${change})`}`;
  return `The chance of reaching ${what} by ${periodEndWords(basis)} isn’t shown: the model has not established how much of these effects would be in place by then.`;
}

/**
 * The Run says why ({@link periodEndEffectsUnstatedOf}) for each scored option, through the ONE goal-figure seam; the outcome
 * and ordering stay. Carrying on as now changes nothing, so its own row is not given this reason.
 */
/** The withhold's CEE-local reason (`detail.reason`): its sentence says "isn’t shown" itself, so no reader prefixes it. */
export const PERIOD_END_EFFECTS_UNSTATED = 'effects_at_period_end_unstated';

export function withholdForPeriodEndEffects<E>(
  envelope: E, graph: unknown, goalId: unknown, inputs: Pick<GoalChanceConstraintInputs, 'sentRun' | 'brief' | 'effects_timing'> = {},
): E {
  if (!isRec(envelope)) return envelope;
  const held = periodEndEffectsUnstatedOf(graph, goalId);
  // G: the conditional reading is licensed instead (the licence reads the SAME predicate, so the two never disagree).
  if (held === undefined || periodEndConditionalOf(envelope, graph, goalId, inputs) !== undefined) return envelope;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const baseline = new Set(nodes.filter((n) => n.kind === 'option' && n.is_baseline === true).map((n) => n.id));
  const scored = [...new Set(readOptionResultSources(envelope).flat().flatMap((r) => {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    return id === undefined || baseline.has(id) ? [] : [id];
  }))];
  if (scored.length === 0) return envelope;
  // The CEE-owned refusal retains the same AI reading the conditional licence records.
  const effectsTiming = effectsTimingOf(inputs.effects_timing);
  // `detail.reason` is CEE-local (as `target_reading_open`); the UI renders `message` for this code.
  return withholdOptionGoalFigures(envelope, new Set(scored), {
    code: GOAL_FIGURES_TARGET_NOT_TESTABLE, severity: 'warning', message: periodEndEffectsWords(held.record, held.basis),
    node_ids: [String(goalId)], option_ids: scored, detail: { reason: PERIOD_END_EFFECTS_UNSTATED,
      effects_timing: effectsTiming ?? null, effects_timing_origin: effectsTiming === undefined ? null : 'olumi' },
  }, { keepOutcome: true, keepOrdering: true });
}

/** The refusal's words: why, and the next step (DL 12 Oct: "confirm or give today's level"). AIE text check. */
export function olumiGoalLevelWords(label: string): { readonly message: string; readonly say: string } {
  const say = `To see it, confirm Olumi’s estimate of today’s ‘${label}’, or tell me what it is today.`;
  return { message: `Not shown. Today’s ‘${label}’ in this model is Olumi’s estimate, not a figure you gave, so no chance of `
    + `reaching your target is shown. ${say}`, say };
}

/**
 * The Run says why the licence refused ({@link goalLevelIsOlumisEstimate}) and what to do next, through the ONE goal-figure
 * seam — the outcome and the ordering stay; never a figure on a guessed starting level.
 */
export function withholdForOlumiGoalLevel<E>(envelope: E, graph: unknown, goalId: unknown): E {
  if (!isRec(envelope) || !goalLevelIsOlumisEstimate(graph, goalId)) return envelope;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const label = typeof goal?.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'your goal';
  const scored = [...new Set(readOptionResultSources(envelope).flat().flatMap((r) => {
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    return id === undefined ? [] : [id];
  }))];
  if (scored.length === 0) return envelope;
  const words = olumiGoalLevelWords(label);
  // `detail.reason` is CEE-local (as `target_reading_open`); the UI renders `message` for this code.
  return withholdOptionGoalFigures(envelope, new Set(scored), {
    code: GOAL_FIGURES_TARGET_NOT_TESTABLE, severity: 'warning', message: words.message, say: words.say,
    node_ids: [String(goalId)], option_ids: scored, detail: { reason: 'goal_level_olumi_estimate' },
  }, { keepOutcome: true, keepOrdering: true });
}
