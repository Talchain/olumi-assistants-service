/**
 * ⭐ THE GOAL'S CURRENT LEVEL, STATED BY THE USER IN CHAT — proposed for approval, then recorded exactly as
 * construction records a brief-stated one.
 *
 * THE DEAD END THIS CLOSES (AI Quality 5843320710; served CEE e26c3d2, OpenAI-only). After Paul's pricing
 * brief and the approve, "Our current MRR is £12,000." called only `get_canonical_state`: no Agent tool could
 * record a goal's level (`propose_assumptions` takes factors only; #1840 writes a goal baseline only at build,
 * from the brief). The goal's `observed_state` stayed null, ISL refused the level frame
 * (`missing_goal_baseline` → `GOAL_THRESHOLD_NOT_CONVERTIBLE`) and the Run had no `probability_of_goal`.
 *
 * ⛔ HELD, NEVER DIRECT. The proposer writes nothing: it stores ONE exact proposal in the lane's own
 * `ProposalStore` (content-hashed, bound to scenario, user and the base revision), and only
 * `authorise_change` on that stored proposal writes — the same consent every factor value goes through.
 *
 * ⭐ THE SAME SHAPE AS #1840 (`admit-model.ts`, the goal limb): `{ value: B, baseline: B, unit, source,
 * raw_value: R, cap }`, B = R / the target's OWN cap (`goal_threshold_cap`). Only `source` differs, because
 * the act differs: a chat statement is not the brief. It is `USER_EDIT_SOURCE` ('user_override', "the
 * observed_state.source literal CEE's chat-edit writers stamp", `canonicalise-value-ops.ts`), which the
 * obligation rule reads as `user_stated` exactly like `brief_extraction` (`obligation-provenance.ts`) while
 * the display keeps "you typed this" apart from "we read this in your brief" (`provenance-display.ts`).
 *
 * ⛔ ADMISSION IS THE BRIEF PATH'S OWN RULE (`admitStatedGoalLevel`), plus the three questions only a chat
 * statement raises, each asked first:
 *   · IS IT THE GOAL? `goal_label` must name the goal node itself — a figure for a factor or another
 *     metric is never written to the goal.
 *   · IS IT THE USER'S? `user_stated: true`, or refused — Olumi's estimate never sets the chance of reaching
 *     the user's target (the brief path withholds an estimate for the same reason). And the flag is only the
 *     Agent's claim: it stands only on a figure the user WROTE, in the currency and frame they wrote it in
 *     (`figureTheUserWrote`, #1978's rule, AND the brief path's `isAmountStatedInBrief`, both read on the figure as
 *     recorded — see "IN THE USER'S OWN WORDS?" below).
 *   · IS IT IN THE GOAL'S OWN UNIT? (`readStatedGoalLevel`, below). "12%" for a GBP goal would pass the scale
 *     rule (12 / 25000 is inside [0, 1]), so the unit check is the one that refuses it — and on this path it
 *     FAILS CLOSED, because the figure feeds the headline chance of reaching the target.
 * The goal's comparator is persisted only beside a target the brief states (`goal_direction`, G1), so the Agent states
 * how the user put the target (`goal_is`) — the same model-read the brief's `operator` is. The held comparator, when
 * there is one, is handed to the shared rule with it: only beside a held `<=` is a `<=` level admitted (the run
 * minimises that goal), and a `>=` reading of a held ceiling is refused.
 *
 * ⭐⭐ A CURRENT LEVEL IS A FACT ABOUT TODAY (DL #85 5930770727, adopting R3 F5 D1 5930715560 (a): "It does NOT depend on
 * the comparator; card it on its own"). Paul's guest replay on 29a37d18 — goal "Quarterly revenue", no target yet:
 * "Our quarterly revenue is £100,000." got NO card (`no_target`), and beside a target an unstated `goal_is` refused
 * it (`goal_is_unstated`). So:
 *   · NO COMPARATOR NEEDED. `goal_is` unstated → the comparator the goal HOLDS; none held → the scale rule alone
 *     (`admitStatedGoalLevelOnScale`: floor, then ceiling; either admits; raw / cap either way). How the user put a
 *     neutral target is a TARGET question, asked on the target's card, never a reason to withhold today's level.
 *   · NO TARGET NEEDED. A level-frame goal with no target yet is carded ON ITS OWN, on the frame the one cap rule gives
 *     the level itself (`resolveGoalThresholdCapWithProvenance(undefined, R, unit, undefined)`), and every other door
 *     stands (the goal, the user's flag, their own words, the goal's unit). The card says today's level only.
 *     The target that arrives later rescales it onto the target's cap in the SAME write (`add-constraint.ts`, the
 *     goal-target stamp: value = baseline = raw_value / goal cap), so the chance of reaching the goal is never read
 *     with today's level on one cap and the target on another.
 *   · A LEVEL RETIRES THE NORMALISING FRAME (F4, R3 #75 5922368144): a £ goal built with no target and no level is read
 *     on a `scale_frame`; the apply below retires it exactly as the target writer does, so the user's own sizes into the
 *     goal are re-derived onto the level's frame, never left on a frame the goal no longer has.
 */
import { isEventShareForecast } from '../goal-target/event-by-date-model.js';
import { goalKindOf, rateUnitInPercent } from '../goal-target/goal-kind.js';
import { USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import { sameUnit } from '../../utils/currency-alphabet.js';
import { admitStatedGoalLevel, admitStatedGoalLevelOnScale, isChangeOwnPercent } from './admit-model.js';
import { readPercentUnit } from './same-unit.js';
import { readHeldGoalComparator } from '../goal-target/goal-direction.js';
import { retireNormalisingGoalFrame, rederiveGoalInLinks } from './normalising-goal-frame.js';
import { frameOf } from './refit-frames.js';
import { figureTheUserWrote, sameWord, wordsOf } from './stated-by-user.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { isAmountStatedInBrief, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { canonicaliseLimitUnit } from './admit-constraint.js';
import { unitPhraseFamily, unitPhraseHead, unitPhraseTail } from './unit-conflict.js';
import { ratePeriodOf, unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { createProposal, type ProposalOperation, type ProposalStore, type ReceiptSummary, type StructuredProposal } from './proposal.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';
import { sayFigure, sayFigureExactly, sayFigureRead } from './say-figure.js';
import { sayGoalChange } from './limit-frame.js';
import { resolveGoalThresholdCapWithProvenance } from '../../utils/goal-threshold-cap.js';
import { isPercentageLevelUnit } from '../../cee/magnitude/link-effect.js';
import { goalCeilingRow, holdsPairableCeiling, pairGoalCeiling } from '../goal-target/goal-ceiling-pair.js';
import { isUnnamedCurrencyUnit, unitAlreadyOnGoal, unitNamingCurrency } from './unnamed-currency.js';
import { scopeOf, identityConflictsWithScope, scopeSourcesAreUserWords, goalScopeCheck, scopeCanRecord, SCOPE_APPROVE_PREFIX } from './goal-scope.js';
import { identityWithdrawalFor, applyIdentityWithdrawalToGoal, type IdentityWithdrawalReading } from '../system-events/identity-confirm-edit.js';
import { goalScopeMeaning } from '../../schemas/goal-scope.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { statedGoalTargetOf } from '../goal-target/stated-goal-target.js';

/** The proposal op: the estate's existing node-update op, carrying the goal's new `observed_state`. */
export const GOAL_CURRENT_LEVEL_OP = 'update_node' as const;

/** How the user stated the goal's target → the comparator the shared rule reads. */
const OPERATOR_OF: Readonly<Record<string, string>> = { at_least: '>=', above: '>', at_most: '<=', below: '<' };

export interface GoalCurrentLevelArgs {
  readonly goal_scope?: unknown;
  readonly reconciliation_key?: string;
  readonly goal_label?: unknown;
  readonly value?: unknown;
  readonly unit?: unknown;
  readonly goal_is?: unknown;
  readonly user_stated?: unknown;
}

/** The slice of a graph read this module needs — `agent-capabilities.ts`'s `GraphRead` satisfies it. */
export interface GoalLevelRead {
  readonly graph_hash: string;
  readonly graph_identity_hash: string;
  readonly nodes: readonly {
    id: string; kind: string; label: string; observed_state?: Record<string, unknown>;
    scale_frame?: unknown; display_value?: unknown; nonlinear_identity?: unknown;
  }[];
  readonly raw: Record<string, unknown>;
}

type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

const norm = (s: unknown): string => String(s ?? '').toLowerCase().trim();
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const refuse = (refusal: string, detail: string, extra: Record<string, unknown> = {}): ToolResult =>
  ({ ok: false, mutated: false, refusal, detail, ...extra });

/** A rescale by a stated magnitude suffix — the admit-constraint M-rung's own stamp, carried verbatim. */
interface UnitNormalised {
  readonly rule: string;
  readonly original_value: number;
  readonly original_unit: string;
}

/** The goal's own observed_state carried on the proposal — what `authorise_change` writes, byte for byte. */
interface GoalObservedState {
  readonly value: number;
  readonly baseline: number;
  readonly unit?: string;
  readonly source: string;
  readonly raw_value: number;
  readonly cap: number;
  readonly provenance_unit_normalised?: UnitNormalised;
}

/**
 * The goal's stated target the level is measured against — its persisted frame, unit, figure and cap. Carried on
 * the proposal and required UNCHANGED at apply time: the frame and the unit are outside the analysis hash the
 * proposal is bound to, so the store's base check alone would let an approval land on a goal that moved to the
 * delta frame or to another unit after the figure was prepared.
 */
interface GoalTarget {
  readonly goal_threshold_frame: unknown;
  readonly goal_threshold_unit: string | null;
  readonly goal_threshold_raw: unknown;
  readonly goal_threshold_cap: unknown;
}

function targetOf(node: Record<string, unknown>): GoalTarget {
  const unit = node.goal_threshold_unit;
  return {
    goal_threshold_frame: node.goal_threshold_frame,
    goal_threshold_unit: typeof unit === 'string' && unit.trim() !== '' ? unit : null,
    goal_threshold_raw: node.goal_threshold_raw,
    goal_threshold_cap: node.goal_threshold_cap,
  };
}

const sameTarget = (a: GoalTarget, b: GoalTarget): boolean =>
  a.goal_threshold_frame === b.goal_threshold_frame && a.goal_threshold_unit === b.goal_threshold_unit &&
  a.goal_threshold_raw === b.goal_threshold_raw && a.goal_threshold_cap === b.goal_threshold_cap;

/**
 * ⭐ OLUMI'S ONE ESTIMATED PART OF THE GOAL, RE-DERIVED FROM THE USER'S OWN FIGURES (MG #72 5864722128; the DL's
 * alternative to withdrawing the identity, 5864468829).
 *
 * Served journey C: construction declared "MRR = Pro plan price × Pro paying subscribers" as Olumi's reading
 * (`stated_in_brief: false`), with the brief's £49 price and Olumi's estimate of 1,000 subscribers. The user then
 * gave their MRR, £72,000, and ISL refused the Run: the parts give £49,000, 31.9% from the figure the user stated
 * (`IDENTITY_NOT_EVALUATED`, `identity_inconsistent`). The one figure in that product that is nobody's but Olumi's
 * is the estimate, so in the SAME approval it becomes the level the user's own figures imply: 72,000 / 49 ≈ 1,469.4
 * subscribers. The product then holds, ISL evaluates it, and the estimate stays Olumi's (`source` unchanged) — the
 * approval text says so.
 *
 * NEVER (null, and the goal's level is recorded alone, as before):
 *   · the product is the user's own (`stated_in_brief` true), malformed, or not a product;
 *   · not exactly ONE part is Olumi's (`classifyValueSource`: `ai_drafted` / `system_repaired`), or any other part
 *     is not the user's (`user_stated` / `user_ratified`) or holds no level above zero;
 *   · the user's figure is not above zero;
 *   · the estimate's frame is not read exactly (its `cap`, else the node's `scale_frame`, and its normalised value
 *     must be raw / frame), or the derived level falls outside it;
 *   · the estimate carries a `display_value`, which would go on saying the old figure;
 *   · the estimate already holds the derived level.
 * Pure: the same read and figure give the same answer, so apply re-runs it and requires the same result.
 */
export interface RederivedPart {
  readonly node_id: string;
  readonly label: string;
  readonly unit?: string;
  readonly was: number;
  readonly now: number;
  /** The user's own parts it is derived from, by label and level, in the product's order. */
  readonly from: readonly { readonly label: string; readonly raw_value: number }[];
  /** The estimate's `observed_state` as it will be written: Olumi's still, at the derived level. */
  readonly observed_state: Record<string, unknown>;
}

const OLUMIS: ReadonlySet<string> = new Set(['ai_drafted', 'system_repaired']);
const USERS: ReadonlySet<string> = new Set(['user_stated', 'user_ratified']);

export function rederivedEstimatedPart(nodes: GoalLevelRead['nodes'], goalId: string, statedRaw: number): RederivedPart | null {
  const goal = nodes.find((n) => n.id === goalId);
  const identity = goal?.nonlinear_identity as { operation?: unknown; factor_ids?: unknown; stated_in_brief?: unknown; addends?: unknown } | undefined;
  if (identity === null || typeof identity !== 'object' || identity.operation !== 'product' || identity.stated_in_brief !== false) return null;
  if (!Array.isArray(identity.factor_ids) || !num(statedRaw) || statedRaw <= 0) return null;
  const parts = identity.factor_ids.map((id) => {
    const matches = nodes.filter((n) => n.id === id);
    return matches.length === 1 && matches[0]!.kind === 'factor' ? matches[0]! : undefined;
  });
  if (parts.length < 2 || parts.some((p) => p === undefined)) return null;
  const whose = (p: (typeof nodes)[number]): string => classifyValueSource(p.observed_state?.source);
  const estimated = parts.filter((p) => OLUMIS.has(whose(p!)));
  if (estimated.length !== 1) return null;
  const part = estimated[0]!;
  const given = parts.filter((p) => p !== part).map((p) => ({ label: p!.label, raw_value: p!.observed_state?.raw_value }));
  if (parts.some((p) => p !== part && !USERS.has(whose(p!)))) return null;
  if (!given.every((g): g is { label: string; raw_value: number } => num(g.raw_value) && g.raw_value > 0)) return null;
  /**
   * ⛔ ADDENDS (AIQ meaning call #72 5867317386, amendment 2): with declared addends the goal is the product PLUS them,
   * so the estimate is (stated − Σ addends) / Π(the user's parts). Every addend must be the user's own figure: an
   * addend that is Olumi's (or unlevelled, or not one node) would make TWO Olumi figures — null, and #385's withdrawal
   * applies. Latent today (CEE's carrier holds no addends), so this is a guard.
   */
  const addendIds = Array.isArray(identity.addends) ? identity.addends : [];
  const addends = addendIds.map((id) => {
    const matches = nodes.filter((n) => n.id === id);
    return matches.length === 1 ? matches[0]! : undefined;
  });
  if (addends.some((a) => a === undefined || !USERS.has(whose(a)) || !num(a.observed_state?.raw_value))) return null;
  const addendSum = addends.reduce((sum, a) => sum + (a!.observed_state!.raw_value as number), 0);

  const os = part.observed_state!;
  if (!num(os.raw_value) || !num(os.value) || part.display_value !== undefined) return null;
  const frame = num(os.cap) && os.cap > 0 ? os.cap : num(part.scale_frame) && part.scale_frame > 0 ? part.scale_frame : undefined;
  if (frame === undefined || Math.abs(os.value * frame - os.raw_value) > 1e-9 * Math.max(1, Math.abs(os.raw_value))) return null;
  const now = (statedRaw - addendSum) / given.reduce((product, g) => product * g.raw_value, 1);
  if (!Number.isFinite(now) || now <= 0 || now > frame || now === os.raw_value) return null;
  return {
    node_id: part.id,
    label: part.label,
    ...(typeof os.unit === 'string' && os.unit.trim() !== '' ? { unit: os.unit.trim() } : {}),
    was: os.raw_value,
    now,
    from: given,
    observed_state: { ...os, raw_value: now, value: now / frame, ...(num(os.baseline) ? { baseline: now / frame } : {}) },
  };
}

/** "about 1,469 subscribers" — a whole figure from 100 up, two decimals below. */
function sayPartLevel(x: number, unit: string | undefined): string {
  const r = Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100;
  return sayFigure(r, unit ?? '');
}

/** What the approval says about the re-derived estimate: whose it stays, what it was, and why it moves. */
function sayRederived(goalLabel: string, part: RederivedPart): string {
  const product = [...part.from.map((g) => `"${g.label}"`), `"${part.label}"`].join(' × ');
  // AIQ meaning call #72 5867317386, amendment 1: the derivation holds only if ALL of the goal is that product — say so.
  return `Olumi's estimate of "${part.label}" becomes about ${sayPartLevel(part.now, part.unit)} (was ` +
    `${sayPartLevel(part.was, part.unit)}), so that ${product} gives your "${goalLabel}"; it stays Olumi's estimate, ` +
    `not your figure — this assumes all of your "${goalLabel}" comes from ${product}; tell me if some comes from elsewhere.`;
}

type StatedLevel =
  | { readonly ok: true; readonly raw: number; readonly normalised?: UnitNormalised }
  | { readonly ok: false; readonly refusal: 'unit_mismatch' | 'unit_unstated' | 'unit_unrecognised'; readonly detail: string };

/**
 * The same unit, spelled either way: the whole phrase on the estate's own same-unit key (`unitComparisonKey`: case,
 * the currency alphabet, rate spellings — "£/month" ≡ "GBP per month"), or the same head with no other measure named
 * after it ("£" or "£ MRR" for "GBP MRR"; never "GBP ARR" or "GBP per year"). Heads are the same on case and one
 * plural ("user" ≡ "users", "month" ≡ "months"; "weeks" ≠ "months"), or both plain percent on the scale-class
 * classifier ("%" ≡ "percent"; "pp" is another class). Nothing here converts.
 */
function sameUnitPhrase(stated: string, goalUnit: string): boolean {
  if (unitComparisonKey(stated) === unitComparisonKey(goalUnit)) return true;
  const sh = unitPhraseHead(stated) ?? '';
  const gh = unitPhraseHead(goalUnit) ?? '';
  const fold = (h: string): string => h.toLowerCase().replace(/s$/, '');
  const sameHead = fold(sh) === fold(gh) ||
    (classifyUnitScaleClass(sh) === 'percent' && classifyUnitScaleClass(gh) === 'percent') ||
    sameUnit(sh, gh);
  const tail = unitPhraseTail(stated);
  return sameHead && (tail === '' || tail === unitPhraseTail(goalUnit));
}

/**
 * ⛔ THE STATED FIGURE, READ IN THE GOAL'S OWN UNIT — or refused. Never relabelled.
 *
 * Verified at 68602637 (DEFECT_FOUND): the family check alone let `12000 USD` through as "12000 GBP MRR" (USD, $,
 * EUR and "GBP MRR" are all the currency family) and `12 £k` through as raw 12 — 1000x too small, so the chance
 * of reaching £20k read as nil. The rungs, in order:
 *   1. A goal with no unit is held to nothing (named residual). A goal whose unit no classifier reads ("customers")
 *      refuses a figure in a unit the classifier DOES read — it cannot be the same unit — and otherwise fails open,
 *      as the lane does.
 *   2. A k/m suffix on the goal's OWN currency is scaled by the admit-constraint M-rung itself
 *      (`canonicaliseLimitUnit`, the node side given as the goal's bare currency head), and its stamp is kept.
 *      The accepted suffixes are therefore exactly the M-rung's; anything else falls to rung 3.
 *   3. FAIL CLOSED: no unit, or one no classifier reads ("subscribers", "$k"), is refused and the user is asked
 *      for the figure in the goal's own unit — the headline goal-fit number is never fed by an unclassified figure.
 *   4. Another kind of unit ("%", "users") is refused (`unitsConflict`'s rule, on the families read as below).
 *   5. Another currency is refused: both heads must be ONE currency (`sameUnit`: £ ≡ GBP). No rate is applied.
 *   6. Another measure or unit of the same kind is refused ("GBP ARR" or "GBP per year" for "GBP MRR", "weeks"
 *      for "months", "pp" for "%"): `sameUnitPhrase`.
 *
 * ⛔ CEE #2468 CHANGES_REQUIRED (CODEX_CLI_OVERFLOW @ f1eda736, P1): typed "¥ per year" for "¥100,000" was stored as the
 * goal's ¥/quarter. The family classifier (`unitPhraseFamily`, the routing table: £ $ € and three codes) reads no family
 * for "¥", so rung 1 fell open. Two rules close it, each typed, neither a word read:
 *   · MONEY IS ALSO READ BY THE ONE SHARED ALPHABET (`readCurrencyUnitWithQualifiers` over `CURRENCY_SYMBOL_TO_CODE`: ¥ ₹ A$
 *     C$ NZ$ CHF kr too) wherever the routing table reads nothing, so a goal in any currency the estate knows never reaches
 *     rung 1's open door, and a figure for it with no unit, or one nobody reads, is refused (rung 3). A stated unit carrying
 *     a magnitude letter the M-rung did not scale ("$k") stays unread, as before.
 *   · A TYPED PERIOD IS THE GOAL'S OWN, before any other rung: when the stated unit is a rate over a period ("¥ per year",
 *     "customers/month"; `ratePeriodOf`, the closed table `unitComparisonKey` folds with), the goal's unit must be per the
 *     SAME period. A unit with no period ("£") is not a period claim and is read by the rungs above as before.
 */
export function readStatedGoalLevel(value: number, statedUnit: unknown, heldGoal: { readonly label: string; readonly unit: string | undefined }): StatedLevel {
  const stated = typeof statedUnit === 'string' ? statedUnit.trim() : '';
  // P17: a rate written in % ("Monthly churn" in "probability (%)") takes today's "5%" as its own unit.
  const goal = { label: heldGoal.label, unit: rateUnitInPercent(heldGoal.unit, stated) ?? heldGoal.unit };
  if (goal.unit === undefined) return { ok: true, raw: value };
  const goalFamily = unitPhraseFamily(goal.unit) ?? (moneyInAlphabet(goal.unit) ? 'currency' : null);
  const goalHead = unitPhraseHead(goal.unit) ?? '';
  const statedFamily = unitPhraseFamily(stated) ?? (moneyInAlphabet(stated) ? 'currency' : null);

  const askInstead =
    `Nothing was prepared; ask the user for the current level of "${goal.label}" in ${goal.unit}, written out in full.`;
  const anotherKind: StatedLevel = {
    ok: false, refusal: 'unit_mismatch',
    detail: `${value} ${stated} is in a different kind of unit from "${goal.label}", which is measured in ${goal.unit}. ` +
      'A figure given for something else is never recorded as the goal’s current level. Nothing was prepared; ask ' +
      `the user for the current level of "${goal.label}" itself.`,
  };
  const anotherMeasure: StatedLevel = {
    ok: false, refusal: 'unit_mismatch',
    detail: `${value} ${stated} is not in ${goal.unit}, the unit "${goal.label}" is measured in, and nothing is ` +
      'converted. If this figure IS the user’s current level of the goal, pass it in the goal’s own unit; if it is ' +
      `another measure or period, it is never recorded as the goal's current level. ${askInstead}`,
  };

  const statedPeriod = ratePeriodOf(stated);
  if (statedPeriod !== null && statedPeriod !== ratePeriodOf(goal.unit)) return anotherMeasure;

  if (goalFamily === null) return statedFamily !== null ? anotherKind : { ok: true, raw: value };

  if (goalFamily === 'currency' && stated !== '') {
    const scaled = canonicaliseLimitUnit(value, stated, { unit: goalHead });
    if (scaled.provenance_unit_normalised !== undefined) return { ok: true, raw: scaled.value, normalised: scaled.provenance_unit_normalised };
  }

  if (stated === '') {
    return {
      ok: false, refusal: 'unit_unstated',
      detail: `${value} was given with no unit, and "${goal.label}" is measured in ${goal.unit}. A figure is never ` +
        `assumed to be in the goal's unit. ${askInstead}`,
    };
  }
  if (statedFamily === null) {
    return {
      ok: false, refusal: 'unit_unrecognised',
      detail: `"${stated}" is not a unit that can be matched to ${goal.unit}, the unit "${goal.label}" is measured in, ` +
        `so ${value} ${stated} is never recorded as its current level. ${askInstead}`,
    };
  }
  if (statedFamily !== goalFamily) return anotherKind;
  if (goalFamily === 'currency' && !sameUnit(unitPhraseHead(stated) ?? '', goalHead)) {
    return {
      ok: false, refusal: 'unit_mismatch',
      detail: `${value} ${stated} is not in the currency of "${goal.label}", which is measured in ${goal.unit}. No ` +
        `exchange rate is ever applied, so it is never recorded as the goal's current level. ${askInstead}`,
    };
  }
  if (!sameUnitPhrase(stated, goal.unit)) return anotherMeasure;
  return { ok: true, raw: value };
}

/**
 * Whether the ONE shared currency alphabet reads `unit` as money at its own scale (`readCurrencyUnitWithQualifiers`):
 * "¥", "¥ per year", "CHF/quarter", "GBP MRR". A magnitude letter ("$k", "£bn") is the M-rung's to scale, never read here.
 */
function moneyInAlphabet(unit: string): boolean {
  const reading = readCurrencyUnitWithQualifiers(unit);
  return reading.kind === 'currency' && reading.multiplier === 1;
}

function goalLevelOf(op: ProposalOperation | undefined): GoalObservedState | undefined {
  if (op?.op !== GOAL_CURRENT_LEVEL_OP) return undefined;
  const os = (op.value as { goal_current_level?: unknown } | undefined)?.goal_current_level;
  return os !== null && typeof os === 'object' ? os as GoalObservedState : undefined;
}

/** Is this stored proposal a goal-current-level change? (`authorise_change` routes it here.) */
export function isGoalCurrentLevelProposal(p: StructuredProposal): boolean {
  return p.operations.length === 1 && goalLevelOf(p.operations[0]) !== undefined;
}

/**
 * ⭐ THE USER'S STATED LEVEL OF THE GOAL, in the goal's own unit AND in their own written words, or why not. ONE rule for
 * the level door (`proposeGoalCurrentLevel`) and for the target card that carries a level stated beside the target
 * (AIQ #75 5913897396: "stated (including 0) → the user's figure, proposed in the SAME card as the target"). `quote` is
 * the sentence the figure was written in: an approval arrives on a later turn, so the apply-time re-check reads it.
 *
 * ── IN THE USER'S OWN WORDS? (Runtime's seam review of #1985, 5845078745; the #1978 class)
 * `user_stated` is the Agent's self-report — the flag that stored a served 0% churn as the user's (#70 5843805457).
 * It stands only when the figure AS RECORDED (a stated k/m suffix already scaled, so "£12k" grounds 12 £k but
 * never a bare 12) is written in what the user TYPED in this conversation (`ctx.user_text`, bound by the route:
 * composer messages only), in the goal's own kind of unit. Otherwise nothing is prepared, and the Agent asks.
 *
 * ⛔ IN THE CURRENCY AND FRAME THE USER WROTE IT IN (verify of f41c3c30, DEFECT_FOUND B1/B2). `figureTheUserWrote`
 * checks a written amount's KIND, never its currency, and a bare number grounds any unit — so "$12,000", "12,000 USD"
 * or "12,000 subscribers" was recorded as the user's £12,000 MRR. It also reads "3%" as 0.03 (a share kept as 0–1),
 * so on a goal measured in "%" a typed 3% was recorded as 0.03%. The figure must ALSO pass the brief path's own rule,
 * `isAmountStatedInBrief` (`stated-amounts.ts`): a money figure needs an amount written in the SAME currency, a
 * percentage one written as a percentage, at the same magnitude — never a fraction of it, never a bare number. The
 * three-argument form: `raw` is already the figure in its unit, so there is no cap to de-normalise by.
 *
 * THE UNIT IS THE ONE THE FIGURE IS RECORDED IN, after any suffix was scaled: the goal's unit head (the M-rung is
 * given `{ unit: goalHead }` and emits exactly that unit), because `readUnit` reads a qualified phrase ("GBP MRR",
 * "£ per month") as plain, and plain refuses every written currency. With no goal unit, the Agent's own unit — the
 * one `raw` is in. Never the unit before scaling: "£k" would read the scaled 12000 as £12m.
 */
export function statedGoalLevelInUsersWords(
  value: number,
  statedUnitArg: unknown,
  goal: { readonly label: string; readonly unit: string | undefined },
  userText: string | undefined,
):
  | { readonly ok: true; readonly raw: number; readonly statedUnit: string; readonly normalised?: UnitNormalised; readonly quote: string | null }
  | { readonly ok: false; readonly refusal: string; readonly detail: string } {
  const stated = readStatedGoalLevel(value, statedUnitArg, goal);
  if (!stated.ok) return stated;
  const raw = stated.raw;
  const statedUnit = typeof statedUnitArg === 'string' ? statedUnitArg.trim() : '';
  const goalUnit = goal.unit;
  const recordedIn = goalUnit !== undefined ? (unitPhraseHead(goalUnit) ?? goalUnit) : statedUnit;
  if (!figureTheUserWrote(raw, goalUnit ?? statedUnit, userText) || !isAmountStatedInBrief(raw, recordedIn, userText)) {
    return {
      ok: false,
      refusal: 'figure_not_in_users_words',
      detail:
        `${value}${statedUnit !== '' ? ` ${statedUnit}` : ''} is not a figure the user wrote in this conversation, so it is ` +
        `never recorded as their current level of "${goal.label}". Nothing was prepared. Say so plainly, and ask the user ` +
        `for today's figure for "${goal.label}" in their own words.` +
        (unitPhraseFamily(goalUnit) === 'percent' ? ' A percentage is passed as the user wrote it: 3% is 3, never 0.03.' : ''),
    };
  }
  return { ok: true, raw, statedUnit, ...(stated.normalised !== undefined ? { normalised: stated.normalised } : {}), quote: writtenIn(userText ?? '', raw)?.quote ?? null };
}

/**
 * ⭐ THE UNIT TODAY'S LEVEL IS RECORDED IN, WHEN THE GOAL'S UNIT NAMES NO CURRENCY (R3 F5 D1, #85 5934208404; served CEE
 * `2166aa0b`, guest 6bc6cae6; owner ruling MG; DL 380e54 (1)–(4)).
 *
 * The brief named no currency, so the drafter copied its own schema placeholder and the goal held "currency/quarter"
 * (`unnamed-currency.ts`). Every spelling of the user's "£100,000" was then "a different kind of unit" (`unitPhraseFamily`
 * reads no family for "currency"), and the goal's own unit failed the words rule (`isAmountStatedInBrief` never lets a £
 * amount ground the unread unit "currency") — three refusals, no card. The placeholder is OUR token, never the user's: the
 * goal's unit is money with its currency ABSENT, so:
 *   · the currency comes ONLY from the level card's TYPED `unit` (DL (1)): ONE currency, read by the estate's strict reader
 *     (`readCurrencyUnitWithQualifiers`: "£", "GBP", "£ per quarter", "£k"; never "pounds", "GBP widgets", "£ and $").
 *     The user's text is never scanned for one here; the level door's own words rule, run next on the ADOPTED unit,
 *     refuses a currency the user did not write ("$" for their "£100,000");
 *   · the level is then read exactly as in a goal already named in that currency, the placeholder head replaced and the
 *     stored tail kept byte for byte ("currency/quarter" + "£" → "£/quarter", DL (3)): the same M-rung, the same period
 *     rule ("£ per year" is refused for "/quarter"), nothing converted;
 *   · no unit → `unit_unstated`; another kind ("%") → `unit_mismatch`; a unit naming no one currency (the goal's own
 *     "currency/quarter" included) → `unit_unrecognised` — a figure is never assumed to be in a currency.
 * A goal whose unit names its currency is untouched (DL (4): "GBP per quarter" + "$" is still refused by the rule above).
 *
 * ⛔ CEE #2468 CHANGES_REQUIRED (CODEX_CLI_OVERFLOW @ f1eda736; DL note to MG: keep it narrow):
 *   · P1 — A UNIT THE GOAL ALREADY HOLDS IS NEVER REPLACED. A level in "USD/quarter" beside the target's "currency/quarter"
 *     was overwritten, with the target's unit, by "£/quarter" on a card that said no currency was set. Any unit on the goal
 *     other than our placeholder (its level's, or a limit row's on it: `unitAlreadyOnGoal`) refuses the card
 *     (`currency_already_named`), here and again at apply.
 *   · P2 — ONLY THE TEMPLATE'S OWN FORMS TAKE A CURRENCY: "currency/<period>" and "<currency>/<period>", the period one the
 *     estate folds (`unitNamingCurrency`). Any other unnamed-currency unit ("currency (USD)/quarter", "currency per year per
 *     quarter", a bare "currency", an unfilled "<period>") refuses the card (`unit_unrecognised`), never adopts.
 */
export function levelUnitForGoal(
  value: number,
  statedUnitArg: unknown,
  goal: { readonly label: string; readonly unit: string | undefined; readonly heldUnit?: string | null },
):
  | { readonly ok: true; readonly unit: string | undefined; readonly adopted: boolean }
  | { readonly ok: false; readonly refusal: 'unit_unstated' | 'unit_mismatch' | 'unit_unrecognised' | 'currency_already_named'; readonly detail: string } {
  if (goal.unit === undefined || !isUnnamedCurrencyUnit(goal.unit)) return { ok: true, unit: goal.unit, adopted: false };
  const stated = typeof statedUnitArg === 'string' ? statedUnitArg.trim() : '';
  if (typeof goal.heldUnit === 'string') {
    return {
      ok: false, refusal: 'currency_already_named',
      detail: `"${goal.label}" already holds a figure in ${goal.heldUnit}, so the unit it is measured in is never replaced by ` +
        `a level card. Nothing was prepared. Say plainly that today's level of "${goal.label}" could not be recorded in ` +
        'another unit, and never record it as if no currency were set.',
    };
  }
  const money = `"${goal.label}" is an amount of money (${goal.unit}) whose currency the model has not named`;
  const ask = 'Nothing was prepared; pass the figure with the currency the user wrote it in (for example "£" or "GBP"), ' +
    `or ask the user for today's figure for "${goal.label}" with its currency.`;
  if (stated === '') {
    return { ok: false, refusal: 'unit_unstated', detail: `${value} was given with no unit, and ${money}. A figure is never assumed to be in a currency. ${ask}` };
  }
  const reading = readCurrencyUnitWithQualifiers(stated);
  const named = reading.kind === 'currency' ? (reading.currencyDisplay ?? reading.currencyCode) : undefined;
  if (named !== undefined) {
    const adopted = unitNamingCurrency(goal.unit, named);
    if (adopted !== null) return { ok: true, unit: adopted, adopted: true };
    return {
      ok: false, refusal: 'unit_unrecognised',
      detail: `${money}, and its unit is not one a currency can be named in, so ${value} ${stated} is never recorded as its ` +
        `current level. Nothing was prepared. Say plainly that the unit of "${goal.label}" has to be set before today's ` +
        'level can be recorded.',
    };
  }
  const family = unitPhraseFamily(stated);
  if (family !== null && family !== 'currency') {
    return {
      ok: false, refusal: 'unit_mismatch',
      detail: `${value} ${stated} is in a different kind of unit from "${goal.label}", which is an amount of money (${goal.unit}). ` +
        'A figure given for something else is never recorded as the goal’s current level. Nothing was prepared; ask the user ' +
        `for the current level of "${goal.label}" itself.`,
    };
  }
  return { ok: false, refusal: 'unit_unrecognised', detail: `"${stated}" names no one currency, and ${money}, so ${value} ${stated} is never recorded as its current level. ${ask}` };
}

/**
 * The card's clause for an adopted unit: the unit the goal is measured in from this approval on. A currency named for an
 * unnamed-currency goal (`levelUnitForGoal`), or (`fromChange`) the unit today's level is stated in, for a goal held only
 * as a percentage change (`levelUnitForChangeGoal`): Olumi's reading of the user's figures, with the user's own sentence.
 */
function sayAdoptedUnit(goalLabel: string, adopted: string | undefined, fromChange?: { readonly quote: string }): string {
  if (adopted === undefined) return '';
  if (fromChange !== undefined) {
    return `, and measure "${goalLabel}" in ${adopted} (Olumi’s reading of your figures in “${fromChange.quote}”; until now ` +
      `"${goalLabel}" held only your change, with no unit of its own)`;
  }
  return `, and measure "${goalLabel}" in ${adopted} (no currency was set for it before)`;
}

/** The Agent's instruction for an adopted unit: say it, as part of what the approval changes. */
function noteAdoptedUnit(goalLabel: string, stored: string | undefined, adopted: string | undefined, fromChange?: { readonly quote: string }): string {
  if (adopted === undefined) return '';
  if (fromChange !== undefined) {
    return `. "${goalLabel}" had no unit of its own (it held only the change${stored !== undefined ? `, typed in ${stored}` : ''}): say ` +
      `plainly that this approval also measures it in ${adopted}, that this unit is Olumi’s reading of the user’s figures (never ` +
      'their own words or weights), and that their target stays exactly as they stated it';
  }
  return `. "${goalLabel}" had no currency set (its unit was ${String(stored)}): say plainly that this approval also measures it in ` +
    `${adopted}, the currency the user wrote`;
}

/**
 * ⭐ A1 — A GOAL HELD ONLY AS A PERCENTAGE CHANGE TAKES THE UNIT TODAY'S LEVEL IS STATED IN (DL 0df0e1 founder trace Q1,
 * Paul's scenario 58bd5e71; AIE review on #87 6016108422 (2)).
 *
 * Served 6 Oct: "increase productivity by at least 10%" was stored as productivity measured in "%" (construction copied the
 * change's "%"; A2 stops that for new builds). Paul then taught a sprint measure, and his "16 small" per sprint was refused
 * `unit_mismatch` ("it currently measures productivity in %"); no tool could change a goal's unit, so it was a dead end.
 * That "%" was only the size of the change, and a relative change is scale-free (+10% of any level is +10%), so the goal
 * held nothing in it. On THIS card, and only here, the goal takes the unit the user's level is stated in:
 *   · IN SCOPE ONLY: a `change_rel` goal whose stored unit is none, or a bare "%" on a quantity that is not a percentage
 *     (`isChangeOwnPercent`, construction's own rule), framed on nothing yet (no cap), and a level stated in a unit that is
 *     not a percent. A level-frame goal, a % metric ("churn rate"), a framed goal or a % level never adopts here: every
 *     rule above stands word for word;
 *   · NEVER A SILENT RESCALE: anything the goal already holds in the old unit refuses the card, typed `unit_in_use` — a
 *     link into the goal the user sized or that holds by definition, a link into it carrying a natural size in %, a limit
 *     row on the goal, or a level already recorded on it. Olumi's placeholder links stay placeholders. The target is the
 *     relative change, kept exactly;
 *   · THE UNIT IS OLUMI'S READING: it names the user's figure as Olumi reads it (Paul's "small-update equivalents per
 *     sprint" rests on S/M/L weights Olumi proposed), so it is written beside the goal as `unit_reading` with source
 *     `olumi_reading` and the user's own sentence (schema 0.67.0) — never `user_stated`. The level is the user's figure;
 *   · A BASELINE IS REQUIRED: the unit is adopted only with today's level, in the same card, because a relative change is
 *     read as a level only from a base. The apply writes the unit, the frame from construction's own rule
 *     (`admitStatedGoalChange`: the cap of the larger of today's level and the target it implies, `goal_threshold` = r),
 *     the level and the reading in ONE registration, each re-derived at apply time.
 * Not in scope → `{ ok: true }` with nothing adopted.
 */
export function levelUnitForChangeGoal(
  statedUnitArg: unknown,
  goal: Readonly<Record<string, unknown>>,
  rawGraph: unknown,
):
  | { readonly ok: true; readonly adopted?: string }
  | { readonly ok: false; readonly refusal: 'unit_in_use' | 'unit_unrecognised'; readonly detail: string } {
  const storedRaw = goal.goal_threshold_unit;
  const stored = typeof storedRaw === 'string' && storedRaw.trim() !== '' ? storedRaw.trim() : undefined;
  const stated = typeof statedUnitArg === 'string' ? statedUnitArg.trim() : '';
  const label = String(goal.label ?? '');
  const inScope = goal.goal_threshold_frame === 'change_rel'
    && (stored === undefined || isChangeOwnPercent({ frame: 'change_rel', unit: stored, metric: label, value: goal.goal_threshold_raw }))
    && (goal.goal_threshold_cap === undefined || goal.goal_threshold_cap === null)
    && stated !== '' && readPercentUnit(stated) === null && unitPhraseFamily(stated) !== 'percent';
  if (!inScope) return { ok: true };
  // The schema's own bound on a unit reading (`NodeV3.unit_reading.unit`): a unit it would drop is never adopted.
  if (stated.length > 40) {
    return { ok: false, refusal: 'unit_unrecognised', detail: `"${stated}" is too long to hold as the unit "${label}" is measured in. ` +
      `Nothing was prepared. Ask the user for a short name for the unit of "${label}".` };
  }
  const old = stored ?? 'no unit';
  const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const graph = rec(rawGraph) ? rawGraph : {};
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(rec) : [];
  const sized = edges.filter((e) => {
    if (e.to !== goal.id) return false;
    const p = rec(e.provenance) ? e.provenance : {};
    const natural = rec(p.natural_effect) ? p.natural_effect : undefined;
    return p.magnitude === 'user_stated' || p.definitional === true || (natural !== undefined && readPercentUnit(natural.amount_unit) !== null);
  });
  const rows = (Array.isArray(graph.goal_constraints) ? graph.goal_constraints.filter(rec) : []).filter((r) => r.node_id === goal.id);
  const level = rec(goal.observed_state) && typeof goal.observed_state.raw_value === 'number';
  const held = [
    ...(sized.length > 0 ? [`${sized.length === 1 ? 'a link' : `${sized.length} links`} into it sized against its change in ${old}`] : []),
    ...(rows.length > 0 ? [`${rows.length === 1 ? 'a limit' : `${rows.length} limits`} on it in ${old}`] : []),
    ...(level ? [`a current level recorded in ${old}`] : []),
  ];
  if (held.length > 0) {
    return {
      ok: false, refusal: 'unit_in_use',
      detail: `"${label}" already holds ${held.join(' and ')}, and measuring it in ${stated} would change what those figures ` +
        'mean. Nothing is ever rescaled silently, so nothing was prepared. Say plainly that today\'s level could not be ' +
        `recorded in ${stated} while they stand, and ask the user whether to restate or remove them first.`,
    };
  }
  return { ok: true, adopted: stated };
}

/** The goal's unit as the USER read it: the NodeV3 `unit_reading` carrier, always theirs here. */
export type UserUnitReading = { readonly unit: string; readonly source: 'user_stated'; readonly source_quote: string };

const DETERMINER = /^(?:the|our|their|its|your|my|all)$/i;
/** Never a word of D: a clause, time or verb word means the phrase is not a plain base ("this week", "become", "today"). */
const NOT_IN_D = /^(?:will|would|could|should|have|has|had|do|does|did|become|becomes|became|get|gets|got|while|and|but|or|which|that|who|when|if|as|so|for|than|to|this|these|those|next|last|each|every|per|a|an|in|on|at|by|with|from|today|now|currently|still|already|week|weeks|month|months|year|years|day|days|quarter|quarters)$/i;

/** The sentence `index` sits in, verbatim with its closing mark (a decimal point never ends one), at most 500 characters. */
function sentenceAt(text: string, index: number): string {
  let start = 0;
  for (const b of text.slice(0, index).matchAll(/[.?!](?=\s)|\n/g)) start = b.index! + 1;
  const endRel = text.slice(index).search(/[.?!](?=\s|$)|\n/);
  const end = endRel === -1 ? text.length : index + endRel + (text[index + endRel] === '\n' ? 0 : 1);
  return text.slice(start, end).trim().slice(0, 500);
}

/** The first `n` label-words of `text` (as `wordsOf` reads them) are the goal's own, in order. */
function opensWithGoal(text: string, goalWords: readonly string[]): boolean {
  const got = wordsOf(text).slice(0, goalWords.length);
  return got.length === goalWords.length && goalWords.every((g, i) => sameWord(g, got[i]!));
}
/** The last `n` label-words of `text` are the goal's own, in order. */
function closesWithGoal(text: string, goalWords: readonly string[]): boolean {
  const got = wordsOf(text).slice(-goalWords.length);
  return got.length === goalWords.length && goalWords.every((g, i) => sameWord(g, got[i]!));
}
const HEDGE_WORD = '(?:about|around|roughly|approximately|nearly|almost|just|the)';
const plainBaseWord = (w: string, goalWords: readonly string[]): boolean => /^[\p{L}][\p{L}'\u2019-]*$/u.test(w) && !NOT_IN_D.test(w)
  && !wordsOf(w).some(x => goalWords.some(g => sameWord(g, x)));

/**
 * ⭐ THE USER'S OWN "OF WHAT" FOR A GOAL KEPT IN "%" (DL 0df0e1 ruling (a′) on RT-18; Science #87 6008791322).
 * "About 8% of appointments are no-shows today" on a goal stored in "%" reads the goal as "% of appointments": the user's
 * words, kept as the goal's `unit_reading`, a READING (schema 0.67.0) where no value, level, target, unit or cap moves.
 * ONLY when every one of these holds; otherwise no reading, never a guess (the binder then asks for the change itself):
 *   · the goal is kept in exactly "%" on the 100 frame (`isPercentageLevelUnit`): the link writer already reads such an
 *     end as a percentage level, so the reading changes nothing it reads (Codex r1/r2 P1 on #2642: "percentage points",
 *     or "%" on a cap of 200, would gain points spellings there);
 *   · the user wrote THIS figure as a percentage exactly ONCE in the conversation (two would leave which one unsaid);
 *   · the figure IS the goal's, in one of two demonstrated shapes, the goal named right beside it (Codex r2: a goal named
 *     elsewhere in the sentence, "No-shows are falling; 8% of patients are late", is not the figure's owner):
 *       A. "8% of D are/is/was/were <goal>", D one to four plain words;
 *       B. "<goal> are/is/was/were [about] 8% of D", D ONE plain word ending the clause (a longer tail may be a predicate:
 *          "8% of patients miss appointments");
 *   · a plain word is never a goal word, a number, or a clause, time or verb word.
 */
export function statedPercentOfReading(goal: { readonly label: string; readonly unit: string | undefined }, raw: number, userText: string | undefined, levelFrame: number | undefined): UserUnitReading | undefined {
  if (goal.unit?.trim() !== '%' || !isPercentageLevelUnit(goal.unit, levelFrame)) return undefined;
  const text = userText ?? '';
  const goalWords = wordsOf(goal.label);
  if (goalWords.length === 0) return undefined;
  const occurrences = [...text.matchAll(/(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b|per\s+cent\b)/giu)]
    .filter(m => Number(m[1]!.replace(/,/g, '')) === raw);
  if (occurrences.length !== 1) return undefined;
  const occ = occurrences[0]!;
  const before = text.slice(0, occ.index!);
  const after = text.slice(occ.index! + occ[0].length);
  let base: string[] | undefined;
  // A. "8% of D are no-shows": D up to the linking verb, the goal named right after it.
  const a = new RegExp(`^\\s+of\\s+([^.,;:!?\\n]*?)\\s+(?:are|is|was|were)\\s+(?:${HEDGE_WORD}\\s+)?([^.,;:!?\\n]+)`, 'iu').exec(after);
  if (a !== null && opensWithGoal(a[2]!, goalWords)) {
    const run = a[1]!.trim().split(/\s+/).filter(w => w !== '' && !DETERMINER.test(w));
    if (run.length >= 1 && run.length <= 4 && run.every(w => plainBaseWord(w, goalWords))) base = run;
  }
  // B. "No-shows are about 8% of appointments.": the goal right before the linking verb, D one word ending the clause.
  if (base === undefined) {
    const lead = new RegExp(`(?:are|is|was|were)\\s+(?:${HEDGE_WORD}\\s+)?$`, 'iu').exec(before);
    const b = /^\s+of\s+(?:(?:the|our|their|its|your|my|all)\s+)?([\p{L}][\p{L}'\u2019-]*)\s*(?:[.,;:!?\n]|$)/iu.exec(after);
    if (lead !== null && b !== null && closesWithGoal(before.slice(0, lead.index), goalWords) && plainBaseWord(b[1]!, goalWords)) base = [b[1]!];
  }
  if (base === undefined) return undefined;
  const unit = `% of ${base.join(' ').toLowerCase()}`;
  return unit.length > 40 ? undefined : { unit, source: 'user_stated', source_quote: sentenceAt(text, occ.index!) };
}

/** The goal's own reading by the USER, if it holds one (an Olumi reading is not theirs). */
function usersReadingOf(goal: unknown): UserUnitReading | undefined {
  const r = (goal as { unit_reading?: unknown } | undefined)?.unit_reading;
  const parsed = NodeV3.shape.unit_reading.safeParse(r);
  return parsed.success && parsed.data !== undefined && parsed.data.source === 'user_stated' ? parsed.data as UserUnitReading : undefined;
}

/**
 * Prepare the change: every admission question, then ONE held proposal. Writes nothing.
 */
export async function proposeGoalCurrentLevel(
  deps: { readonly readGraph: (scenarioId: string) => Promise<GoalLevelRead | null>; readonly proposals: ProposalStore },
  ctx: AgentToolContext,
  args: GoalCurrentLevelArgs,
): Promise<ToolResult> {
  const g = await deps.readGraph(ctx.scenario_id);
  if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
  const goals = g.nodes.filter((n) => n.kind === 'goal');
  const goalNames = goals.map((n) => `"${n.label}"`).join(', ') || 'none';

  // ── IS IT THE GOAL? Identity by the label the Agent read from get_canonical_state.
  const requested = String(args?.goal_label ?? '');
  const named = g.nodes.filter((n) => norm(n.label) === norm(requested));
  const goal = named.length === 1 && named[0]!.kind === 'goal' ? named[0]! : undefined;
  if (goal === undefined) {
    const other = named.find((n) => n.kind !== 'goal');
    return refuse(
      'not_the_goal',
      (other !== undefined
        ? `"${other.label}" is not the goal of this model (it is a ${other.kind}).`
        : `The model has nothing called "${requested}" that is its goal.`) +
      ` This records only the current level of the goal itself (${goalNames}); a figure for anything else is never ` +
      'written to the goal. Nothing was prepared.',
      { goal: goalNames },
    );
  }

  // ⛔ S-E GOALS (Science ruling 7 Oct §2; D-06): a goal measured as a CHANCE has no level to record: that chance is what
  // Olumi works out. Refused by name, before anything else is read.
  if (isEventShareForecast(g.raw)) {
    return refuse('goal_measures_a_forecast',
      'This goal measures the forecast share finished by its deadline, so today’s completion percentage is not its current level. Nothing was prepared. Type the soonest and latest times with your current team, for example "6–10 months".');
  }
  if (goalKindOf(goal) === 'chance_of_event') {
    return refuse('goal_measures_a_chance',
      `"${goal.label}" is measured as a chance of an event, which Olumi works out, so it has no level to record. Nothing was prepared. `
      + 'Never ask the user for it. If they stated a deadline, call propose_goal_deadline with their words.');
  }
  // ── IS IT THE USER'S?
  if (args?.user_stated !== true) {
    return refuse(
      'not_the_users_figure',
      `Only a current level the user stated for "${goal.label}" can be recorded: an estimate would set the chance of ` +
      'reaching their target on a guess. Nothing was prepared. Ask the user for their own figure.',
    );
  }
  const value = args?.value;
  if (!num(value)) return refuse('unparsable_value', 'No usable number was given. Nothing was prepared.');

  // ── A TARGET ON THE LEVEL FRAME TO MEASURE AGAINST (the goal's own persisted trio).
  const node = goal as typeof goal & { goal_threshold_raw?: unknown; goal_threshold_cap?: unknown; goal_threshold_frame?: unknown; goal_threshold_unit?: unknown };
  const target = node.goal_threshold_raw;
  const cap = node.goal_threshold_cap;
  // ⭐ R1 S4-core, the change slice (DL #75 5902318219: journey 2's first failing boundary, "Actually our monthly cloud
  // spend is £50k, not £45k" refused 3/3): a target stated as a CHANGE from today ("cut by 20%") HAS a target, and it
  // is the user's own — it stays exactly as stated, now measured from their corrected level. Below, after the same
  // guards as a level goal (their figure, in their words, in the goal's unit), `changeGoalLevel` writes today's level.
  const isChange = node.goal_threshold_frame === 'change_rel' || node.goal_threshold_frame === 'change_abs';
  if (isChange && !num(target)) {
    return refuse('no_target', `"${goal.label}" has no stated change to measure its current level against. Nothing was prepared.`);
  }
  /**
   * ⭐ NO TARGET YET, ON THE LEVEL FRAME (DL #85 5930770727; R3 5930715560 (a)): today's level is carded on its own. ONLY
   * where the goal holds no target in ANY form — no raw figure, no cap, no normalised threshold — so a level is never
   * framed beside a half-written target. A goal on another frame (`delta`) still has nothing to read a level on.
   */
  const absent = (v: unknown): boolean => v === undefined || v === null;
  const noTargetYet = node.goal_threshold_frame === 'level' && absent(target) && absent(cap) &&
    absent((node as { goal_threshold?: unknown }).goal_threshold);
  // ⭐ RT-10 B′ R3 (Science #87 5999608477): `noTargetYet` decides only the FRAME the level is read on (no target figure on
  // the node). Whether the goal HAS a target is the one reader's answer: "at most 5%" set through the goal panel lives on
  // the goal's own limit row, so the approval never tells the user that goal "has no target yet".
  const targetStated = statedGoalTargetOf(g.raw, goal as Record<string, unknown>) !== null;
  // ⭐ D3 step 1 (Science #87 6005138341): a goal CEILING is scored on the goal's own level frame, so today's level is read
  // on ITS OWN frame here too — the apply then (re)pairs the ceiling on that frame in the same write. A paired ceiling's
  // earlier cap is today's earlier level's frame: a new level renormalises it, never refused against the old one.
  const ceilingTakesTheLevelFrame = !isChange && node.goal_threshold_frame === 'level' && holdsPairableCeiling(g.raw, goal.id);
  const levelOnItsOwnFrame = noTargetYet || ceilingTakesTheLevelFrame;
  if (!isChange && !levelOnItsOwnFrame && (!num(target) || !num(cap) || cap <= 0 || node.goal_threshold_frame !== 'level')) {
    return refuse(
      'no_target',
      `"${goal.label}" has no stated target to measure its current level against, so there is no chance of reaching ` +
      'one to show. Nothing was prepared. Ask the user what level they are aiming for first.',
    );
  }
  const storedUnit = typeof node.goal_threshold_unit === 'string' && node.goal_threshold_unit.trim() !== '' ? node.goal_threshold_unit : undefined;
  // ── A GOAL WHOSE UNIT NAMES NO CURRENCY TAKES THE ONE THE TYPED UNIT NAMES (`levelUnitForGoal`); every other goal keeps
  // its own unit. From here `goalUnit` is the unit the level is read, said and written in.
  const forLevel = levelUnitForGoal(value, args?.unit, { label: goal.label, unit: storedUnit, heldUnit: unitAlreadyOnGoal(goal, g.raw, storedUnit) });
  if (!forLevel.ok) return refuse(forLevel.refusal, forLevel.detail);
  // ── A GOAL HELD ONLY AS A PERCENTAGE CHANGE TAKES THE UNIT ITS LEVEL IS STATED IN (`levelUnitForChangeGoal`, A1).
  const forChange = levelUnitForChangeGoal(args?.unit, node as Record<string, unknown>, g.raw);
  if (!forChange.ok) return refuse(forChange.refusal, forChange.detail);
  const goalUnit = forChange.adopted ?? forLevel.unit;
  const adoptedUnit = forLevel.adopted ? forLevel.unit : forChange.adopted;

  // ── IN THE GOAL'S OWN UNIT, AND IN THE USER'S OWN WORDS? One rule, shared with the target card (`statedGoalLevelInUsersWords`).
  const inWords = statedGoalLevelInUsersWords(value, args?.unit, { label: goal.label, unit: goalUnit }, ctx.user_text);
  if (!inWords.ok) return refuse(inWords.refusal, inWords.detail);
  const stated = inWords;
  const raw = inWords.raw;
  const statedUnit = inWords.statedUnit;
  if (isChange && args.goal_scope !== undefined) return refuse('scope_frame_unresolved', 'Clarify the level of the total goal before recording its scope. Nothing was prepared.');
  // ⛔ An adopted unit is Olumi's reading of the user's figure, quoted from their sentence: none found, nothing is prepared.
  if (forChange.adopted !== undefined && stated.quote === null) {
    return refuse('figure_not_in_users_words', `${value} ${statedUnit} could not be found in a sentence the user wrote, so "${goal.label}" is ` +
      'never measured in it. Nothing was prepared. Ask the user for today\'s figure in their own words.');
  }
  if (isChange) {
    return changeGoalLevel(deps, ctx, g, goal, node, raw, value, statedUnit, stated.normalised, goalUnit, adoptedUnit, storedUnit,
      forChange.adopted !== undefined ? { quote: stated.quote as string } : undefined);
  }


  let normalisedLevel: number;
  let levelCap: number;
  if (levelOnItsOwnFrame) {
    // ⛔ A ceiling the goal holds is never read as a floor (Codex buddy r1 on #2618 (c): the refusal the target path
    // applies, `admitStatedGoalLevel`, kept on the level's own frame): an "at least" reading would score it the wrong way round.
    const said = typeof args?.goal_is === 'string' ? OPERATOR_OF[args.goal_is] : undefined;
    const ceiling = ceilingTakesTheLevelFrame ? goalCeilingRow(g.raw, goal.id) : undefined;
    if (ceiling !== undefined && (said === '>=' || said === '>')) {
      const limit = sayFigureExactly(ceiling.value, goalUnit ?? '') ?? String(ceiling.value);
      return refuse('not_admitted',
        `"${goal.label}" is held as a goal to stay ${ceiling.stated === '<' ? 'below' : 'at or below'} ${limit}, so a current level ` +
        `read as reaching at least ${limit} would be scored the wrong way round, and it was not used. If the goal is to stay ` +
        'under the target, say so and give the current level again.');
    }
    /**
     * ⭐ THE LEVEL ON ITS OWN FRAME (DL #85 5930770727): the one cap rule, given the level as its only figure — the cap a
     * construction would give a goal whose only figure is this one. No comparator and no target are read: there are none.
     * A level the rule cannot frame (0: no positive figure to scale from) still waits for a target, said so.
     */
    const own = resolveGoalThresholdCapWithProvenance(undefined, raw, goalUnit, undefined);
    if (own === null) {
      return refuse(
        'no_target',
        `"${goal.label}" has no stated target yet, and ${sayFigureExactly(raw, goalUnit ?? '') ?? String(raw)} gives no range ` +
        'to read today\'s level on. Nothing was prepared. Ask the user what level they are aiming for; today\'s level can be ' +
        'recorded with it.',
      );
    }
    levelCap = own.cap;
    normalisedLevel = raw / own.cap;
  } else {
    // (Checked above for a level goal; restated so the level path below reads them as numbers.)
    if (!num(target) || !num(cap)) return refuse('no_target', `"${goal.label}" has no stated target to measure its current level against. Nothing was prepared.`);
    /**
     * ── HOW THE USER PUT THE TARGET, WHEN IT IS KNOWN: as the Agent states it from the user's words (`goal_is`), else as the
     * goal HOLDS it (`goal_direction`, G1) — never defaulted. ⭐ Neither known → the scale rule alone (DL #85 5930770727;
     * R3 5930715560 (a)): a level is a fact about today, and a neutral target wording is a question for the TARGET's card,
     * never a reason to withhold today's level (`admitStatedGoalLevelOnScale`: floor, then ceiling; either admits).
     */
    const held = readHeldGoalComparator({ nodes: g.nodes }, goal.id) ?? undefined;
    const operator = (typeof args?.goal_is === 'string' ? OPERATOR_OF[args.goal_is] : undefined) ?? held;
    // ── THE BRIEF PATH'S OWN RULE: operator tail, then scale and direction. The comparator the goal HOLDS (G1) is passed
    // too: beside a held `<=` the run minimises, so a `<=` level is admitted on the mirrored rule, and a `>=` reading
    // contradicts the user's own comparator (`admitStatedGoalLevel`, MG #72 5870097103).
    const verdict = operator !== undefined
      ? admitStatedGoalLevel({
        metric: goal.label, operator, rawTarget: target, rawBaseline: raw, cap, heldComparator: (goal as { goal_direction?: unknown }).goal_direction,
        targetUnit: goalUnit,
      })
      : admitStatedGoalLevelOnScale({ metric: goal.label, rawTarget: target, rawBaseline: raw, cap });
    if (!verdict.admitted) return refuse('not_admitted', verdict.reason);
    levelCap = cap;
    normalisedLevel = verdict.normalised;
  }

  // ── THE USER'S "OF WHAT", kept as the goal's reading (`statedPercentOfReading`), on the frame this level is written on.
  // One they already gave is kept; a different one is never silently replaced.
  const statedReading = statedPercentOfReading({ label: goal.label, unit: goalUnit }, raw, ctx.user_text, levelCap);
  const heldReading = usersReadingOf(goal);
  if (statedReading !== undefined && heldReading !== undefined && heldReading.unit !== statedReading.unit) {
    return refuse('unit_mismatch',
      `"${goal.label}" is already read as ${heldReading.unit}, as the user wrote earlier ("${heldReading.source_quote}"), and ` +
      `${raw}${statedReading.unit.slice(1)} names another base. Nothing was prepared. Ask the user which one "${goal.label}" is a percentage of.`);
  }
  const unitReading = statedReading !== undefined && heldReading === undefined ? statedReading : undefined;

  const existing = goal.observed_state;
  const existingRaw = num(existing?.raw_value) ? existing!.raw_value as number : undefined;
  if (args.goal_scope === undefined && existingRaw === raw && existing?.source === USER_EDIT_SOURCE) {
    return refuse('already_recorded', `${sayFigureExactly(raw, goalUnit ?? '') ?? `${raw}${goalUnit !== undefined ? ` ${goalUnit}` : ''}`} is already recorded as the user’s current level of "${goal.label}". Nothing to change.`);
  }
  const observed: GoalObservedState = {
    value: normalisedLevel,
    baseline: normalisedLevel,
    ...(goalUnit !== undefined ? { unit: goalUnit } : {}),
    source: USER_EDIT_SOURCE,
    raw_value: raw,
    cap: levelCap,
    ...(stated.normalised !== undefined ? { provenance_unit_normalised: stated.normalised } : {}),
  };
  // As the user writes a figure ("£72,000 per month"), from the lane's one formatter (DL #72 5866282787: "72000 £ MRR").
  const withUnit = (x: number) => sayFigureExactly(x, goalUnit ?? '') ?? `${x}${goalUnit !== undefined ? ` ${goalUnit}` : ''}`;
  // ⛔ THE USER'S OWN FIGURE AND UNIT, as they gave it — never relabelled in the goal's unit — plus, when a stated
  // suffix was scaled, what it is recorded as. The target and a replaced record are the goal's own, in its unit.
  // ⭐ THE CARD SHOWS THE PERIOD IT RECORDS (DL 380e54 ruling on #2468): a bare "£" on a goal per quarter is RECORDED per
  // quarter, so the card says "£100,000 per quarter" — the user sees the reading before confirming. That confirm is the
  // structural control for a figure the user meant monthly (never read from their words: a word read is banned).
  const shownUnit = statedUnit !== '' && ratePeriodOf(statedUnit) === null && ratePeriodOf(goalUnit) !== null
    ? `${statedUnit} per ${ratePeriodOf(goalUnit)}` : statedUnit;
  const asStated = sayFigureExactly(value, shownUnit) ?? `${value}${shownUnit !== '' ? ` ${shownUnit}` : ''}`;
  const figure = stated.normalised !== undefined ? `${asStated}, which is ${withUnit(raw)}` : asStated;
  const replaces = existingRaw !== undefined && existingRaw !== raw ? existingRaw : undefined;
  // Carried INSIDE the goal's one op, so this stays one goal-level proposal with one write.
  const scope = args.goal_scope === undefined ? undefined : scopeOf(args.goal_scope);
  if (args.goal_scope !== undefined && (!scope || !scopeSourcesAreUserWords(scope, ctx.user_text ?? '', scopeOf((goal as Record<string, unknown>).goal_scope)))) {
    return refuse('scope_not_grounded', 'The scope is not bound to the user’s stated words. Nothing was prepared.');
  }
  if (scope && !scopeCanRecord(scope, goalScopeCheck(g.raw, goal.id, scope, { value: raw, unit: goalUnit ?? '', source: scope.source }))) return refuse('goal_scope_unresolved', 'Resolve the goal scope and its factor references before approving this reading. Nothing was prepared.');
  const withdrawal = scope ? identityWithdrawalFor(goal as Record<string, unknown>, scope) : undefined;
  if (!scope && identityConflictsWithScope(goal as Record<string, unknown>)) return refuse('goal_scope_unresolved', 'Resolve the goal’s scope before changing its current level. Nothing was prepared.');
  const rederived = withdrawal ? null : rederivedEstimatedPart(g.nodes, goal.id, raw);
  // A figure recorded BEFORE this card is said, and matched on other nodes, in the unit it was recorded in (the stored one).
  const withStoredUnit = (x: number) => sayFigureExactly(x, storedUnit ?? '') ?? `${x}${storedUnit !== undefined ? ` ${storedUnit}` : ''}`;
  const earlierHeld = replaces === undefined ? null
    : sayEarlierFigureHeld(nodesHoldingEarlierFigure(g, goal.id, replaces, storedUnit), withStoredUnit(replaces));
  const proposal = createProposal({
    scenario_id: ctx.scenario_id,
    user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: g.graph_hash,
    operations: [{
      op: GOAL_CURRENT_LEVEL_OP, path: goal.id,
      value: {
        goal_current_level: observed, against: targetOf(node),
        ...(scope ? { goal_scope: scope, reconciliation_key: args.reconciliation_key } : {}),
        ...(withdrawal ? { identity_withdrawal: withdrawal } : {}),
        ...(rederived !== null ? { rederived_part: rederived } : {}),
        ...(adoptedUnit !== undefined ? { adopted_unit: adoptedUnit } : {}),
        ...(unitReading !== undefined ? { unit_reading: unitReading } : {}),
      },
    }],
    provenance: { authored_by: 'user_stated', basis: 'the current level of the goal, as the user stated it' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    // ⭐ With no target yet, the card says today's level only (DL #85 5930770727): there is no target to name.
    public_label:
      (noTargetYet ? `Record today's level of "${goal.label}" as your figure: ` : `Record the current level of "${goal.label}" as your figure: `) +
      (replaces !== undefined ? `${sayFigureRead(replaces, storedUnit ?? '')} → ${figure}` : figure) +
      (num(target) ? ` (target ${withUnit(target)})` : '') +
      sayAdoptedUnit(goal.label, adoptedUnit) +
      (unitReading !== undefined ? `, read as ${unitReading.unit}, as you wrote it` : '') +
      (rederived !== null ? `. ${sayRederived(goal.label, rederived)}` : '') +
      (earlierHeld !== null ? earlierHeld.label : '') +
      (scope ? `. Goal scope: ${scope.modelled}${scope.component?.share !== undefined ? `; ${scope.component.label} contributes ${scope.component.share * 100}%` : ''}${scope.component?.count_basis ? `; count means ${scope.component.count_basis}` : ''}${scope.component ? (scope.component.basis === 'unknown' ? '; the count population and billing basis remain unresolved' : `; revenue share and rate/count are on ${scope.component.basis === 'different' ? 'different' : 'the same'} billing bases`) : ''}.` : '') +
      (withdrawal ? ` ${withdrawal.words}` : ''),
  });
  deps.proposals.put(proposal);
  return {
    ok: true, mutated: false,
    proposal_id: proposal.proposal_id,
    public_label: proposal.public_label,
    base_revision: g.graph_hash,
    goal: goal.label,
    current_level: { value: raw, ...(goalUnit !== undefined ? { unit: goalUnit } : {}) },
    as_stated: { value, ...(statedUnit !== '' ? { unit: statedUnit } : {}) },
    ...(num(target) ? { target: { value: target, ...(goalUnit !== undefined ? { unit: goalUnit } : {}) } } : {}),
    ...(replaces !== undefined ? { replaces } : {}),
    ...(rederived !== null
      ? { rederived: { factor: rederived.label, from: rederived.was, to: rederived.now, ...(rederived.unit !== undefined ? { unit: rederived.unit } : {}), whose: "Olumi's estimate" } }
      : {}),
    note:
      'Nothing has changed. Show the user the figure as they gave it' +
      (stated.normalised !== undefined ? ` and what it is recorded as (${asStated} is ${withUnit(raw)})` : '') +
      ', and that it will be recorded as THEIR current level of the goal, never the id' +
      (rederived !== null
        ? `, and that in the same change Olumi's estimate of "${rederived.label}" becomes about ` +
          `${sayPartLevel(rederived.now, rederived.unit)} (was ${sayPartLevel(rederived.was, rederived.unit)}) so that ` +
          `the product gives their figure — say it stays Olumi's estimate, never the user's`
        : '') +
      (earlierHeld !== null ? earlierHeld.note : '') +
      (noTargetYet && !targetStated
        ? `. "${goal.label}" has no target yet: say this records where it stands today, and that the chance of reaching a ` +
          'target appears once they set one; never name a target they have not given'
        : '') +
      noteAdoptedUnit(goal.label, storedUnit, adoptedUnit) +
      (unitReading !== undefined ? `, and that "${goal.label}" is read as ${unitReading.unit}, in the user's own words` : '') +
      ', and call authorise_change with this proposal_id only once they agree.',
  };
}

/**
 * The amount the user wrote for `raw` in their message ("£50k"), with the sentence it sits in (≤160 characters, the
 * reading's `quote` bound), or null when no written amount reads as `raw`. A k/m/bn suffix scales as the M-rung does.
 */
export function writtenIn(text: string, raw: number): { written: string; quote: string } | null {
  const scale: Record<string, number> = { k: 1e3, m: 1e6, bn: 1e9 };
  for (const m of text.matchAll(/[£$€]?\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn)?\b/gi)) {
    const token = m[0].trim();
    const suffix = (/(k|m|bn)$/i.exec(token)?.[1] ?? '').toLowerCase();
    const n = Number(token.replace(/[£$€,\s]/g, '').replace(/(k|m|bn)$/i, ''));
    if (!Number.isFinite(n) || Math.abs(n * (scale[suffix] ?? 1) - raw) > 1e-9 * Math.max(1, raw)) continue;
    // ⛔ A sentence ends at . ? ! followed by a space (or the text's end), or at a new line — NEVER at a decimal point
    // (MG SUCCESSOR #75 5918338227, measured): "We have secured £0 so far and need at least £1.2m." was quoted as "…at
    // least £1", so the target was not in the level's statement and Paul's own £0 was refused `current_level_not_bound`.
    let start = 0;
    for (const b of text.slice(0, m.index!).matchAll(/[.?!](?=\s)|\n/g)) start = b.index! + 1;
    const tail = m.index! + token.length;
    const endRel = text.slice(tail).search(/[.?!](?=\s|$)|\n/);
    const quote = text.slice(start, endRel === -1 ? text.length : tail + endRel).trim().slice(0, 160);
    return { written: token, quote: quote === '' ? token : quote };
  }
  return null;
}

/**
 * ⛔ THE USER'S EARLIER FIGURE STILL SITS ON OTHER NODES (R3 #75 5902892629 r1; AIQ 5902905975; DL 5902916137 (2c)).
 * Served cut-costs on `f074916` (scenario 2d85ed7f): the brief's "£45k" was the goal's level AND "AWS monthly cost at full
 * workload" (`brief_extraction`), which both GCP options also set at £45k. The user's "£50k, not £45k" corrected the goal
 * alone, so the model held £50k today against £45k on the component, and the reply called that £45k "supplied by Olumi".
 * Every non-goal node that holds the goal's earlier figure as the USER's (the same amount in the goal's unit, a source
 * `classifyValueSource` rules `user_stated`; the unit by `unitComparisonKey`, so "GBP per month" is "£/month"), with the
 * options that set it there. Named on the approval, never changed by it: whether that part moves too is the user's call.
 * ⛔ A RATIFIED source (`user_confirmed`, `user_assumption`) is Olumi's number the user endorsed, never theirs (R3 CR
 * 5903120325; AIQ 5903126944): calling it "THEIR figure" is false authorship the other way round. Pure.
 */
function nodesHoldingEarlierFigure(
  g: GoalLevelRead,
  goalId: string,
  earlier: number,
  goalUnit: string | undefined,
): { label: string; options: string[]; fromBrief: boolean }[] {
  if (goalUnit === undefined) return [];
  const users = (source: unknown): boolean => classifyValueSource(source) === 'user_stated';
  const rawNodes = Array.isArray((g.raw as { nodes?: unknown }).nodes) ? (g.raw as { nodes: Record<string, unknown>[] }).nodes : [];
  const options = rawNodes.filter((n) => n?.kind === 'option');
  return g.nodes
    .filter((n) => n.id !== goalId && n.kind !== 'goal' && n.kind !== 'option' && n.kind !== 'decision')
    .filter((n) => n.observed_state?.raw_value === earlier && users(n.observed_state?.source)
      && typeof n.observed_state?.unit === 'string' && unitComparisonKey(n.observed_state.unit) === unitComparisonKey(goalUnit))
    .map((n) => ({
      label: n.label,
      fromBrief: n.observed_state?.source === 'brief_extraction',
      options: options.filter((o) => {
        const iv = (o.interventions ?? {}) as Record<string, unknown>;
        const set = iv[n.id] as { raw_value?: unknown } | undefined;
        return set !== undefined && set !== null && typeof set === 'object' && set.raw_value === earlier;
      }).map((o) => String(o.label ?? o.id)),
    }));
}

/** The words for `nodesHoldingEarlierFigure`: one clause for the approval, one instruction for the Agent. */
function sayEarlierFigureHeld(held: readonly { label: string; options: string[]; fromBrief: boolean }[], earlier: string): { label: string; note: string } | null {
  if (held.length === 0) return null;
  const names = held.map((h) => `"${h.label}"`).join(' and ');
  const setBy = [...new Set(held.flatMap((h) => h.options))];
  const options = setBy.length === 0 ? '' : ` (${setBy.map((o) => `"${o}"`).join(' and ')} ${setBy.length === 1 ? 'sets it' : 'set it'} there too)`;
  return {
    label: `. ${names} still ${held.length === 1 ? 'holds' : 'hold'} your earlier ${earlier}${options}; this does not change ${held.length === 1 ? 'it' : 'them'}`,
    // "from the brief" only when every part's figure came from it (R3 nit 5903120325): a `user_override` was typed in chat.
    note: `. Say plainly that ${names} still ${held.length === 1 ? 'holds' : 'hold'} their earlier ${earlier}${options}: that is THEIR figure`
      + `${held.every((h) => h.fromBrief) ? ' from the brief' : ''}, never a value Olumi supplied, and this approval does not change it; ask whether it should change too`,
  };
}

/** A goal declared as a product (`nonlinear_identity`) of levelled parts: their names and what they multiply to. */
function productStillGives(nodes: GoalLevelRead['nodes'], goal: GoalLevelRead['nodes'][number]): { parts: string; value: number } | null {
  const identity = goal.nonlinear_identity as { operation?: unknown; factor_ids?: unknown } | undefined;
  if (identity === null || typeof identity !== 'object' || identity.operation !== 'product' || !Array.isArray(identity.factor_ids)) return null;
  const parts = identity.factor_ids.map((id) => nodes.find((n) => n.id === id));
  if (parts.length < 2 || parts.some((p) => p === undefined || !num(p.observed_state?.raw_value))) return null;
  return {
    parts: parts.map((p) => `"${p!.label}"`).join(' × '),
    value: parts.reduce((product, p) => product * (p!.observed_state!.raw_value as number), 1),
  };
}

/**
 * ⭐ TODAY'S LEVEL OF A GOAL STATED AS A CHANGE (DL #75 5902318219; journey 2 on `1f9d769`). The caller has already
 * checked that the figure is the user's, in their words and the goal's unit. The change itself ("down 20% from today")
 * is the user's and is never touched: measured from their corrected level. The frame the level is read on:
 *  · a `change_rel` goal whose cap was derived from today's level (`target_derived_headroom`) gets it re-derived by the
 *    one rule (`resolveGoalThresholdCapWithProvenance`: level × 1.25), carried in the op and written with the level;
 *  · any other cap is kept (a `change_abs` target is stored against it), and a level outside it is refused by name.
 * Olumi's reading of the brief's figure (`goal_level_reading`) is dropped on apply: the user has corrected it.
 */
function changeGoalLevel(
  deps: { readonly proposals: ProposalStore },
  ctx: AgentToolContext,
  g: GoalLevelRead,
  goal: GoalLevelRead['nodes'][number],
  node: Record<string, unknown>,
  raw: number,
  value: number,
  statedUnit: string,
  normalised: UnitNormalised | undefined,
  goalUnit: string | undefined,
  adoptedUnit: string | undefined,
  storedUnit: string | undefined,
  /** A1: the unit is adopted from the stated level (`levelUnitForChangeGoal`), with the user's sentence it was read from. */
  fromChange?: { readonly quote: string },
): ToolResult {
  const cap = node.goal_threshold_cap;
  // Construction's own rule for a change goal (`admit-model.ts`, the brief's level): the frame holds both today's level
  // and the target it implies, so an increase is framed on its target, a cut on today's level.
  const stored = node.goal_threshold_raw as number;
  const reframed = node.goal_threshold_frame === 'change_rel' && node.goal_threshold_cap_provenance === 'target_derived_headroom'
    ? resolveGoalThresholdCapWithProvenance(undefined, Math.max(raw, raw * (1 + stored)), goalUnit, undefined)
    : null;
  /**
   * ⭐ A1: a goal measured for the first time (`levelUnitForChangeGoal`: no cap yet) is framed by construction's own rule
   * (`admitStatedGoalChange`): the one cap of the larger of today's level and the target it implies, and the relative
   * change as its scale-free threshold (r). A level that gives no positive range (0) still has nothing to read it on.
   */
  const firstFrame = fromChange !== undefined && node.goal_threshold_frame === 'change_rel' && raw > 0 && raw * (1 + stored) >= 0
    ? resolveGoalThresholdCapWithProvenance(undefined, Math.max(raw, raw * (1 + stored)), goalUnit, undefined)
    : null;
  const frameCap = reframed?.cap ?? firstFrame?.cap ?? (num(cap) && cap > 0 ? cap : undefined);
  const withUnit = (x: number) => sayFigureExactly(x, goalUnit ?? '') ?? `${x}${goalUnit !== undefined ? ` ${goalUnit}` : ''}`;
  if (frameCap === undefined) {
    return refuse('no_target', `"${goal.label}" has no range to read its current level on, so nothing was prepared.`);
  }
  if (raw < 0 || raw > frameCap) {
    return refuse(
      'level_above_frame',
      `${withUnit(raw)} is outside the range 0 to ${withUnit(frameCap)} the model reads "${goal.label}" on, and that range ` +
      'was not taken from today\'s level, so it is not redrawn here. Nothing was prepared. Tell the user plainly.',
    );
  }
  const existing = goal.observed_state;
  const existingRaw = num(existing?.raw_value) ? existing!.raw_value as number : undefined;
  if (existingRaw === raw && existing?.source === USER_EDIT_SOURCE) {
    return refuse('already_recorded', `${withUnit(raw)} is already recorded as the user’s current level of "${goal.label}". Nothing to change.`);
  }
  const observed: GoalObservedState = {
    value: raw / frameCap,
    baseline: raw / frameCap,
    ...(goalUnit !== undefined ? { unit: goalUnit } : {}),
    source: USER_EDIT_SOURCE,
    raw_value: raw,
    cap: frameCap,
    ...(normalised !== undefined ? { provenance_unit_normalised: normalised } : {}),
  };
  const change = sayGoalChange(node.goal_threshold_frame, node.goal_threshold_raw as number, goalUnit, (x) => withUnit(x),
    (goal as { goal_direction?: unknown }).goal_direction) ?? '';
  // ⭐ THE CARD SHOWS THE PERIOD IT RECORDS (DL 380e54 ruling on #2468): a bare "£" on a goal per quarter is RECORDED per
  // quarter, so the card says "£100,000 per quarter" — the user sees the reading before confirming. That confirm is the
  // structural control for a figure the user meant monthly (never read from their words: a word read is banned).
  const shownUnit = statedUnit !== '' && ratePeriodOf(statedUnit) === null && ratePeriodOf(goalUnit) !== null
    ? `${statedUnit} per ${ratePeriodOf(goalUnit)}` : statedUnit;
  const asStated = sayFigureExactly(value, shownUnit) ?? `${value}${shownUnit !== '' ? ` ${shownUnit}` : ''}`;
  const figure = normalised !== undefined ? `${asStated}, which is ${withUnit(raw)}` : asStated;
  const replaces = existingRaw !== undefined && existingRaw !== raw ? existingRaw : undefined;
  const withStoredUnit = (x: number) => sayFigureExactly(x, storedUnit ?? '') ?? `${x}${storedUnit !== undefined ? ` ${storedUnit}` : ''}`;
  const rederived = rederivedEstimatedPart(g.nodes, goal.id, raw);
  /**
   * ⭐ AIQ 5902364862: the NUMBER is now the user's; the JOIN is not. Where Olumi read the brief's figure as this goal's
   * level (a `goal_level_reading`: the goal's words differ from the user's, the r0 "costs" shape), the reading is
   * REFRESHED from the user's own words — the same lead construction writes — never dropped, or Olumi's reading of the
   * subject would become the user's silently. With no reading (the goal is the user's own words), none is added.
   */
  const prior = (goal as { goal_level_reading?: unknown }).goal_level_reading as { bound?: unknown; level_unit?: unknown } | undefined;
  const words = writtenIn(ctx.user_text ?? '', raw);
  const levelReading = prior !== undefined && prior !== null && typeof prior === 'object' && words !== null
    ? {
      level: raw,
      level_unit: typeof prior.level_unit === 'string' ? prior.level_unit : (goalUnit ?? ''),
      quote: words.quote,
      lead: `Olumi reads your ‘${words.written}’ (‘${words.quote}’) as today's level of ‘${goal.label}’`,
      ...(prior.bound === '<=' || prior.bound === '<' || prior.bound === '>=' || prior.bound === '>' ? { bound: prior.bound } : {}),
    }
    : null;
  // R3 5902346957 row (2): a goal worked out as a product whose parts cannot follow the new level (not exactly one
  // Olumi part to re-derive) still multiplies to the old figure; that is said, and the Run refuses it (ISL
  // `identity_inconsistent`) — never scored silently on the old figure.
  const product = rederived === null ? productStillGives(g.nodes, goal) : null;
  const earlierHeld = replaces === undefined ? null
    : sayEarlierFigureHeld(nodesHoldingEarlierFigure(g, goal.id, replaces, storedUnit), withStoredUnit(replaces));
  const productSaid = product === null ? '' : `"${goal.label}" is worked out as ${product.parts}, and those figures still give ` +
    `${withUnit(product.value)}, so the Run cannot use your ${withUnit(raw)} until one of them changes`;
  const proposal = createProposal({
    scenario_id: ctx.scenario_id,
    user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: g.graph_hash,
    operations: [{
      op: GOAL_CURRENT_LEVEL_OP, path: goal.id,
      value: {
        goal_current_level: observed, against: targetOf(node),
        ...(reframed !== null && reframed.cap !== cap ? { reframed_cap: reframed.cap } : {}),
        ...(prior !== undefined ? { level_reading: levelReading } : {}),
        ...(rederived !== null ? { rederived_part: rederived } : {}),
        ...(adoptedUnit !== undefined ? { adopted_unit: adoptedUnit } : {}),
        // ⭐ A1: the goal's first frame and Olumi's reading of the adopted unit, written with the level (re-derived at apply).
        ...(firstFrame !== null
          ? { first_frame: { goal_threshold_cap: firstFrame.cap, goal_threshold_cap_provenance: firstFrame.provenance, goal_threshold: stored } }
          : {}),
        ...(fromChange !== undefined && adoptedUnit !== undefined
          ? { adopted_from: 'change', adopted_unit_reading: { unit: adoptedUnit, source: 'olumi_reading', source_quote: fromChange.quote } }
          : {}),
      },
    }],
    provenance: { authored_by: 'user_stated', basis: 'the current level of the goal, as the user stated it' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label:
      `Record today's level of "${goal.label}" as your figure: ` +
      (replaces !== undefined ? `${sayFigureRead(replaces, storedUnit ?? '')} → ${figure}` : figure) +
      (change !== '' ? ` (your target: ${change})` : '') +
      sayAdoptedUnit(goal.label, adoptedUnit, fromChange) +
      (rederived !== null ? `. ${sayRederived(goal.label, rederived)}` : '') +
      (productSaid !== '' ? `. ${productSaid}` : '') +
      (earlierHeld !== null ? earlierHeld.label : ''),
  });
  deps.proposals.put(proposal);
  return {
    ok: true, mutated: false,
    proposal_id: proposal.proposal_id,
    public_label: proposal.public_label,
    base_revision: g.graph_hash,
    goal: goal.label,
    current_level: { value: raw, ...(goalUnit !== undefined ? { unit: goalUnit } : {}) },
    as_stated: { value, ...(statedUnit !== '' ? { unit: statedUnit } : {}) },
    target: { change },
    ...(replaces !== undefined ? { replaces } : {}),
    note:
      'Nothing has changed. Show the user the figure as they gave it, that it will be recorded as THEIR level of the goal ' +
      `today, and that their target stays as they stated it (${change}), now measured from this level` +
      (rederived !== null ? `, and that Olumi's estimate of "${rederived.label}" is re-derived with it and stays Olumi's` : '') +
      (productSaid !== '' ? `. Say plainly: ${productSaid}` : '') +
      (levelReading !== null ? `. Reading "${goal.label}" as what they call it stays Olumi's reading; say so` : '') +
      (earlierHeld !== null ? earlierHeld.note : '') +
      noteAdoptedUnit(goal.label, storedUnit, adoptedUnit, fromChange) +
      '. Call authorise_change with this proposal_id only once they agree.',
  };
}

/**
 * Apply an APPROVED goal-current-level proposal: ONE registration of the approved read with the goal's
 * `observed_state` set, CAS-gated on the revision the user approved (`expected_graph_hash`, the analysis
 * space the proposal is bound to) AND the identity of the same read (`expected_graph_identity_hash`) — the
 * pair the frame write sends, so an intervening edit refuses rather than being overwritten by stale bytes.
 * "Saved" only when THIS registration answered 200 and a read afterwards holds exactly what it wrote.
 */
export async function applyGoalCurrentLevel(
  deps: {
    readonly dispatch: InternalDispatch;
    readonly readGraph: (scenarioId: string) => Promise<GoalLevelRead | null>;
    readonly proposals: ProposalStore;
    readonly operationId: (key: string) => string;
  },
  ctx: AgentToolContext,
  proposal: StructuredProposal,
  approved: GoalLevelRead,
): Promise<ToolResult> {
  const op = proposal.operations[0]!;
  const os = goalLevelOf(op)!;
  const notApplied = (detail: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'not_applied', detail });
  const goal = approved.nodes.find((n) => n.id === op.path);
  if (goal === undefined || goal.kind !== 'goal') return notApplied('The goal is no longer in the model, so nothing was written.');
  // ⛔ RE-VALIDATED AT APPLY TIME: the level frame, and the same unit, figure and cap the proposal was prepared against.
  const against = (op.value as { against?: GoalTarget } | undefined)?.against;
  const now = targetOf(goal);
  const changeFrame = now.goal_threshold_frame === 'change_rel' || now.goal_threshold_frame === 'change_abs';
  if (against === undefined || (now.goal_threshold_frame !== 'level' && !changeFrame) || !sameTarget(against, now)) {
    return {
      ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'superseded',
      detail: `The target of "${goal.label}" changed after this was prepared, so nothing was written. Read the model again and propose afresh.`,
    };
  }

  /**
   * ⛔ AN ADOPTED UNIT (`levelUnitForGoal`) IS RE-DERIVED AT APPLY TIME: written only onto a goal whose stored unit still names
   * no currency (the target check above holds it unchanged since the card), only as the unit the level itself carries, and
   * only as that stored unit with its placeholder head replaced and its tail kept byte for byte — and only while the goal
   * holds no other unit, on its level or on a limit row (`unitAlreadyOnGoal`, #2468 P1). Anything else writes nothing.
   */
  const carriedAdopted = (op.value as { adopted_unit?: unknown } | undefined)?.adopted_unit;
  const adoptedUnit = typeof carriedAdopted === 'string' ? carriedAdopted : undefined;
  const carriedChange = op.value as { adopted_from?: unknown; adopted_unit_reading?: unknown; first_frame?: unknown } | undefined;
  const fromChange = carriedChange?.adopted_from === 'change';
  const currencyAdoptionHolds = (unit: string): boolean => now.goal_threshold_unit !== null &&
    unitNamingCurrency(now.goal_threshold_unit, unitPhraseHead(unit) ?? '') === unit &&
    unitAlreadyOnGoal(goal, approved.raw, now.goal_threshold_unit) === null;
  /**
   * ⛔ A1: A UNIT ADOPTED FROM THE STATED LEVEL OF A CHANGE GOAL (`levelUnitForChangeGoal`) IS RE-DERIVED AT APPLY TIME on the
   * approved read: the same rule adopts the same unit (still a change goal held in no unit or the change's "%", framed on
   * nothing, holding nothing in the old unit), construction's rule gives the same first frame for the level as carried, and
   * Olumi's reading is exactly the carried one, `olumi_reading`, in that unit. Anything else writes nothing.
   */
  const firstFrameFor = (unit: string): { goal_threshold_cap: number; goal_threshold_cap_provenance: string; goal_threshold: number } | undefined => {
    const r = os.raw_value;
    const change = now.goal_threshold_raw;
    if (!num(r) || !num(change) || !(r > 0) || r * (1 + change) < 0) return undefined;
    const framed = resolveGoalThresholdCapWithProvenance(undefined, Math.max(r, r * (1 + change)), unit, undefined);
    return framed === null ? undefined : { goal_threshold_cap: framed.cap, goal_threshold_cap_provenance: framed.provenance, goal_threshold: change };
  };
  const changeReading = fromChange ? NodeV3.shape.unit_reading.safeParse(carriedChange?.adopted_unit_reading) : undefined;
  const changeAdoptionHolds = (unit: string): boolean => {
    const again = levelUnitForChangeGoal(unit, goal, approved.raw);
    const frame = firstFrameFor(unit);
    return again.ok && again.adopted === unit && frame !== undefined && os.cap === frame.goal_threshold_cap
      && stableStringify(frame) === stableStringify(carriedChange?.first_frame)
      && changeReading !== undefined && changeReading.success && changeReading.data !== undefined
      && changeReading.data.source === 'olumi_reading' && changeReading.data.unit === unit
      && stableStringify(changeReading.data) === stableStringify(carriedChange?.adopted_unit_reading);
  };
  const changeCarried = carriedChange?.adopted_from !== undefined || carriedChange?.first_frame !== undefined
    || carriedChange?.adopted_unit_reading !== undefined;
  if ((carriedAdopted !== undefined && (adoptedUnit === undefined || os.unit !== adoptedUnit
    || !(fromChange ? changeAdoptionHolds(adoptedUnit) : currencyAdoptionHolds(adoptedUnit))))
    || (changeCarried && !(fromChange && adoptedUnit !== undefined))) {
    return notApplied(`The unit this level of "${goal.label}" was prepared in no longer fits the goal, so nothing was written. Read the model again and propose afresh.`);
  }
  const firstFrame = fromChange && adoptedUnit !== undefined ? firstFrameFor(adoptedUnit) : undefined;
  const changeReadingToWrite = fromChange && changeReading?.success === true ? changeReading.data : undefined;

  /**
   * ⛔ THE USER'S READING (`statedPercentOfReading`) IS RE-CHECKED AT APPLY TIME: the carrier exactly (strict NodeV3), the
   * user's own, on a goal whose unit is still a bare percent, and holding no reading of theirs already. Anything else
   * writes nothing. It is written beside the level, never into it: no unit, value or cap moves.
   */
  const carriedReading = (op.value as { unit_reading?: unknown } | undefined)?.unit_reading;
  const unitReading = carriedReading === undefined ? undefined : NodeV3.shape.unit_reading.safeParse(carriedReading);
  if (carriedReading !== undefined && (unitReading === undefined || !unitReading.success || unitReading.data === undefined
    || unitReading.data.source !== 'user_stated' || stableStringify(unitReading.data) !== stableStringify(carriedReading)
    || now.goal_threshold_unit?.trim() !== '%' || !isPercentageLevelUnit(os.unit, typeof os.cap === 'number' ? os.cap : undefined)
    || usersReadingOf(goal) !== undefined)) {
    return notApplied(`How "${goal.label}" is read changed after this was prepared, so nothing was written. Read the model again and propose afresh.`);
  }
  const readingToWrite = unitReading?.success === true ? unitReading.data : undefined;

  // ⛔ THE RE-DERIVED ESTIMATE IS RE-DERIVED AT APPLY TIME, and must come out exactly as the user approved it — or,
  // when none was approved, still none: the approval text said what would change, and nothing else is written.
  const carried = (op.value as { rederived_part?: RederivedPart } | undefined)?.rederived_part ?? null;
  const scoped = op.value as { goal_scope?: unknown; identity_withdrawal?: IdentityWithdrawalReading };
  const scope = scoped.goal_scope === undefined ? undefined : scopeOf(scoped.goal_scope);
  if (scoped.goal_scope !== undefined && (!scope || ctx.typed_approval_of !== proposal.proposal_id || ctx.typed_approval_words !== SCOPE_APPROVE_PREFIX + proposal.public_label)) {
    return notApplied('Approve the card showing this exact scope and identity correction. Nothing was written.');
  }
  if (scope && !scopeCanRecord(scope, goalScopeCheck(approved.raw, goal.id, scope, { value: os.raw_value, unit: os.unit ?? '', source: scope.source }))) return notApplied('Resolve the scope and its factor references before approving this reading. Nothing was written.');
  const withdrawal = scope ? identityWithdrawalFor(goal as Record<string, unknown>, scope) : undefined;
  if (stableStringify(withdrawal) !== stableStringify(scoped.identity_withdrawal)) return notApplied('The identity changed after this reading was offered. Nothing was written.');
  const part = withdrawal ? null : rederivedEstimatedPart(approved.nodes, goal.id, os.raw_value);
  if (JSON.stringify(part) !== JSON.stringify(carried)) {
    return {
      ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'superseded',
      detail: `The figures "${goal.label}" is the product of changed after this was prepared, so nothing was written. ` +
        'Read the model again and propose afresh.',
    };
  }

  const operationId = deps.operationId(`${proposal.proposal_id}#goal_current_level`);
  // A rescale stamp describes the figure it came with: a new figure without one never inherits the previous one's.
  const { provenance_unit_normalised: _previousStamp, ...kept } = (goal.observed_state ?? {}) as Record<string, unknown>;
  // A change goal (`changeGoalLevel`): the re-derived cap travels with the level, and Olumi's reading of the brief's
  // figure goes, since the user has corrected it.
  const carriedOp = op.value as { reframed_cap?: unknown; level_reading?: unknown } | undefined;
  const reframedCap = num(carriedOp?.reframed_cap) ? carriedOp!.reframed_cap as number : undefined;
  const nodes = approved.nodes.map((n) => {
    if (n.id !== op.path) return part !== null && n.id === part.node_id ? { ...n, observed_state: part.observed_state } : n;
    const written: Record<string, unknown> = {
      ...(scope && withdrawal ? applyIdentityWithdrawalToGoal(n as Record<string, unknown>, scope, withdrawal)! : n), observed_state: { ...kept, ...os },
      ...(scope ? { goal_scope: scope } : {}),
      ...(reframedCap !== undefined ? { goal_threshold_cap: reframedCap } : {}),
      // A1: a change goal measured for the first time is framed, as construction frames it, in the same registration.
      ...(firstFrame !== undefined ? firstFrame : {}),
      // The goal is measured in the adopted unit from this write on — its target too — in the SAME registration as its level.
      ...(adoptedUnit !== undefined ? { goal_threshold_unit: adoptedUnit } : {}),
      ...(readingToWrite !== undefined ? { unit_reading: readingToWrite } : {}),
      ...(changeReadingToWrite !== undefined ? { unit_reading: changeReadingToWrite } : {}),
    };
    // Olumi's reading of the replaced figure is refreshed from the user's words, or goes when they could not be read.
    if (carriedOp !== undefined && 'level_reading' in carriedOp) {
      if (carriedOp.level_reading === null) delete written.goal_level_reading;
      else written.goal_level_reading = carriedOp.level_reading;
    }
    return written;
  });
  /**
   * ⭐ F4 — A LEVEL RETIRES THE NORMALISING FRAME (R3 #75 5922368144; DL 5922465512), in this same write. A level-frame goal
   * with no target was built on a normalising `scale_frame`, and a level now lands on it (DL #85 5930770727: carded on its
   * own). The goal is then read on the level's own frame (its `cap`), and every user-sized or definitional link into it is
   * re-derived onto that frame from its unchanged natural size — exactly as the target writer retires it
   * (`add-constraint.ts`). Without it the goal would carry BOTH frames, CEE reading the `scale_frame` and PLoT the `cap`
   * first, and the user's own sizes into the goal would be read on the wrong one. No `scale_frame` → the graph itself.
   */
  // Read BEFORE this write: the frame every sized link into the goal was sized on.
  const frameBefore = frameOf(approved.nodes.find((n) => n.id === op.path) as Record<string, unknown> | undefined);
  const unretired = { ...approved.raw, nodes } as Record<string, unknown> & { nodes: typeof nodes };
  const retiredOrSame = retireNormalisingGoalFrame(unretired);
  // ⭐ D3 step 1: a goal ceiling is (re)paired on the level this write carries, in this same write (Science #87
  // 6005138341): the ceiling came first (rt10b's order) or an earlier level framed it, so the new level renormalises it.
  const ceilingPaired = holdsPairableCeiling(retiredOrSame, op.path)
    && pairGoalCeiling(retiredOrSame, op.path) === 'paired';
  const retired = retiredOrSame !== unretired;
  // ⭐ …and the renormalised frame carries the links sized on the old one (Codex buddy r1 F3 on #2618): every user-sized or
  // definitional link into the goal is re-derived onto the new frame from its unchanged natural size, as the target
  // writer does when it moves the level frame (`add-constraint.ts`, D1 B). A retirement above has already re-derived.
  const graph = ceilingPaired && !retired && frameBefore !== undefined
    ? rederiveGoalInLinks(retiredOrSame, op.path, frameBefore) : retiredOrSame;
  const writtenGoal = (graph.nodes as readonly Record<string, unknown>[]).find((n) => n.id === op.path);
  const writtenOs = (writtenGoal?.observed_state ?? os) as { baseline?: unknown };
  const reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
    graph,
    ...(approved.graph_hash !== '' ? { expected_graph_hash: approved.graph_hash } : {}),
    ...(approved.graph_identity_hash !== '' ? { expected_graph_identity_hash: approved.graph_identity_hash } : {}),
    operation_id: operationId,
  });
  if (reg.status !== 200) {
    const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
    return code === 'GRAPH_STALE'
      ? { ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'superseded',
        detail: 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.' }
      : notApplied(`The current level could not be saved (http ${reg.status}). Nothing was written.`);
  }
  const receipts: ReceiptSummary[] = [];
  const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
  if (mv !== undefined && typeof mv.version_id === 'string') {
    receipts.push({
      version: Number(mv.version_number), version_id: mv.version_id,
      mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
      source_turn_id: registrationTurnId(ctx.scenario_id, operationId),
    });
  }
  // ⛔ CONFIRMED FROM STATE: the goal as stored now holds exactly the level this write carried.
  const after = await deps.readGraph(ctx.scenario_id);
  const held = after?.nodes.find((n) => n.id === op.path)?.observed_state;
  const partHeld = part === null ? undefined : after?.nodes.find((n) => n.id === part.node_id)?.observed_state;
  // What THIS write carried for the goal: the proposal's level, re-read on the frame the F4 retirement left (a refit may
  // have widened it — `reframed` moves value, baseline, cap and threshold together). Unretired, that is `os` byte for byte.
  const capHeld = (reframedCap === undefined && !retired) ||
    (after?.nodes.find((n) => n.id === op.path) as { goal_threshold_cap?: unknown } | undefined)?.goal_threshold_cap === writtenGoal?.goal_threshold_cap;
  // An adopted unit is read back byte for byte, on the goal and on its level.
  const unitHeld = adoptedUnit === undefined || (held?.unit === adoptedUnit &&
    (after?.nodes.find((n) => n.id === op.path) as { goal_threshold_unit?: unknown } | undefined)?.goal_threshold_unit === adoptedUnit);
  const readingHeld = readingToWrite === undefined
    || stableStringify((after?.nodes.find((n) => n.id === op.path) as { unit_reading?: unknown } | undefined)?.unit_reading) === stableStringify(readingToWrite);
  // A1: the first frame and Olumi's reading of the adopted unit are read back byte for byte.
  const afterGoal = after?.nodes.find((n) => n.id === op.path) as Record<string, unknown> | undefined;
  const changeHeld = (firstFrame === undefined || (Object.keys(firstFrame) as (keyof typeof firstFrame)[]).every((k) => afterGoal?.[k] === firstFrame[k]))
    && (changeReadingToWrite === undefined || stableStringify(afterGoal?.unit_reading) === stableStringify(changeReadingToWrite));
  const scopeHeld = !scope || (after !== null && stableStringify(goalScopeMeaning((after?.nodes.find(n => n.id === op.path) as Record<string, unknown>)?.goal_scope)) === stableStringify(goalScopeMeaning(scope))
    && (!withdrawal || !(after?.nodes.find(n => n.id === op.path) as Record<string, unknown>)?.nonlinear_identity));
  // The ceiling's pair is read back too: its figure, its cap and its threshold, exactly as this write carried them.
  // Its comparator and frame too (Codex buddy r1 F6 on #2618): the same figures under a floor are not this pair.
  type Pair = { goal_threshold_raw?: unknown; goal_threshold_cap?: unknown; goal_threshold?: unknown; goal_direction?: unknown; goal_threshold_frame?: unknown };
  const pairNow = after?.nodes.find((n) => n.id === op.path) as Pair | undefined;
  const pairWritten = writtenGoal as Pair | undefined;
  const pairHeld = !ceilingPaired || (pairNow !== undefined && pairWritten !== undefined
    && (['goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold', 'goal_direction', 'goal_threshold_frame'] as const).every((k) => pairNow[k] === pairWritten[k]));
  const landed = readingHeld && changeHeld && scopeHeld && pairHeld && held !== undefined && held.raw_value === os.raw_value && held.baseline === writtenOs.baseline && held.source === os.source && capHeld && unitHeld &&
    (part === null || (partHeld !== undefined && partHeld.raw_value === part.now && partHeld.source === part.observed_state.source));
  if (!landed) {
    return {
      ok: false, mutated: true, applied: false, proposal_id: proposal.proposal_id, refusal: 'not_verified', receipts,
      detail: 'The current level was saved, but the model changed again straight afterwards, so what it now holds could not be confirmed. Read the model again before saying what it holds.',
    };
  }
  deps.proposals.markApplied(proposal.proposal_id, receipts);
  const unit = os.unit !== undefined ? ` ${os.unit}` : '';
  return {
    ok: true, mutated: true, applied: true,
    proposal_id: proposal.proposal_id,
    receipts,
    goal: goal.label,
    recorded: { value: os.raw_value, ...(os.unit !== undefined ? { unit: os.unit } : {}) },
    ...(part !== null
      ? { rederived: { factor: part.label, from: part.was, to: part.now, ...(part.unit !== undefined ? { unit: part.unit } : {}), whose: "Olumi's estimate" } }
      : {}),
    revision_before: approved.graph_hash,
    revision_after: after?.graph_hash ?? approved.graph_hash,
    not_represented:
      `The current level of "${goal.label}" (${os.raw_value}${unit}) is recorded as the user’s own figure. Say so. ` +
      (part !== null
        ? `Olumi's estimate of "${part.label}" is now about ${sayPartLevel(part.now, part.unit)} (was ` +
          `${sayPartLevel(part.was, part.unit)}), derived from the user's figures so that the product holds; say it is ` +
          "still Olumi's estimate, never the user's. "
        : '') +
      'An analysis the user asks for can now compare it with the target.',
  };
}
