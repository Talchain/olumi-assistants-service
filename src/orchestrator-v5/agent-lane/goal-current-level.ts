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
 * how the user put the target (`goal_is`) — the same model-read the brief's `operator` is — and an unstated one is
 * refused, never defaulted. The held comparator, when there is one, is handed to the shared rule with it: only beside
 * a held `<=` is a `<=` level admitted (the run minimises that goal), and a `>=` reading of a held ceiling is refused.
 */
import { USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import { sameUnit } from '../../utils/currency-alphabet.js';
import { admitStatedGoalLevel } from './admit-model.js';
import { figureTheUserWrote } from './stated-by-user.js';
import { isAmountStatedInBrief } from '../../cee/provenance/stated-amounts.js';
import { canonicaliseLimitUnit } from './admit-constraint.js';
import { unitPhraseFamily, unitPhraseHead, unitPhraseTail, unitsConflict } from './unit-conflict.js';
import { unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { createProposal, type ProposalOperation, type ProposalStore, type ReceiptSummary, type StructuredProposal } from './proposal.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';
import { sayFigure, sayFigureExactly, sayFigureRead } from './say-figure.js';

/** The proposal op: the estate's existing node-update op, carrying the goal's new `observed_state`. */
export const GOAL_CURRENT_LEVEL_OP = 'update_node' as const;

/** How the user stated the goal's target → the comparator the shared rule reads. */
const OPERATOR_OF: Readonly<Record<string, string>> = { at_least: '>=', above: '>', at_most: '<=', below: '<' };

export interface GoalCurrentLevelArgs {
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
 *   4. Another kind of unit ("%", "users") is refused (`unitsConflict`).
 *   5. Another currency is refused: both heads must be ONE currency (`sameUnit`: £ ≡ GBP). No rate is applied.
 *   6. Another measure or unit of the same kind is refused ("GBP ARR" or "GBP per year" for "GBP MRR", "weeks"
 *      for "months", "pp" for "%"): `sameUnitPhrase`.
 */
export function readStatedGoalLevel(value: number, statedUnit: unknown, goal: { readonly label: string; readonly unit: string | undefined }): StatedLevel {
  const stated = typeof statedUnit === 'string' ? statedUnit.trim() : '';
  if (goal.unit === undefined) return { ok: true, raw: value };
  const goalFamily = unitPhraseFamily(goal.unit);
  const goalHead = unitPhraseHead(goal.unit) ?? '';
  const statedFamily = unitPhraseFamily(stated);

  const askInstead =
    `Nothing was prepared; ask the user for the current level of "${goal.label}" in ${goal.unit}, written out in full.`;
  const anotherKind: StatedLevel = {
    ok: false, refusal: 'unit_mismatch',
    detail: `${value} ${stated} is in a different kind of unit from "${goal.label}", which is measured in ${goal.unit}. ` +
      'A figure given for something else is never recorded as the goal’s current level. Nothing was prepared; ask ' +
      `the user for the current level of "${goal.label}" itself.`,
  };

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
  if (unitsConflict(stated, goal.unit) !== null) return anotherKind;
  if (goalFamily === 'currency' && !sameUnit(unitPhraseHead(stated) ?? '', goalHead)) {
    return {
      ok: false, refusal: 'unit_mismatch',
      detail: `${value} ${stated} is not in the currency of "${goal.label}", which is measured in ${goal.unit}. No ` +
        `exchange rate is ever applied, so it is never recorded as the goal's current level. ${askInstead}`,
    };
  }
  if (!sameUnitPhrase(stated, goal.unit)) {
    return {
      ok: false, refusal: 'unit_mismatch',
      detail: `${value} ${stated} is not in ${goal.unit}, the unit "${goal.label}" is measured in, and nothing is ` +
        'converted. If this figure IS the user’s current level of the goal, pass it in the goal’s own unit; if it is ' +
        `another measure or period, it is never recorded as the goal's current level. ${askInstead}`,
    };
  }
  return { ok: true, raw: value };
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
  if (!num(target) || !num(cap) || cap <= 0 || node.goal_threshold_frame !== 'level') {
    return refuse(
      'no_target',
      `"${goal.label}" has no stated target to measure its current level against, so there is no chance of reaching ` +
      'one to show. Nothing was prepared. Ask the user what level they are aiming for first.',
    );
  }
  const goalUnit = typeof node.goal_threshold_unit === 'string' && node.goal_threshold_unit.trim() !== '' ? node.goal_threshold_unit : undefined;

  // ── IN THE GOAL'S OWN UNIT? (scaled by a stated k/m suffix only as the M-rung scales a limit; else refused)
  const stated = readStatedGoalLevel(value, args?.unit, { label: goal.label, unit: goalUnit });
  if (!stated.ok) return refuse(stated.refusal, stated.detail);
  const raw = stated.raw;
  const statedUnit = typeof args?.unit === 'string' ? args.unit.trim() : '';

  /**
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
  const recordedIn = goalUnit !== undefined ? (unitPhraseHead(goalUnit) ?? goalUnit) : statedUnit;
  if (!figureTheUserWrote(raw, goalUnit ?? statedUnit, ctx.user_text) || !isAmountStatedInBrief(raw, recordedIn, ctx.user_text)) {
    return refuse(
      'figure_not_in_users_words',
      `${value}${statedUnit !== '' ? ` ${statedUnit}` : ''} is not a figure the user wrote in this conversation, so it is ` +
      `never recorded as their current level of "${goal.label}". Nothing was prepared. Say so plainly, and ask the user ` +
      `for today's figure for "${goal.label}" in their own words.` +
      (unitPhraseFamily(goalUnit) === 'percent' ? ' A percentage is passed as the user wrote it: 3% is 3, never 0.03.' : ''),
    );
  }

  // ── HOW THE USER PUT THE TARGET (not persisted: stated by the Agent from the user's words, never defaulted).
  const operator = typeof args?.goal_is === 'string' ? OPERATOR_OF[args.goal_is] : undefined;
  if (operator === undefined) {
    return refuse(
      'goal_is_unstated',
      `Say how the user put the target for "${goal.label}" (at least, above, at most or below ${target}). If they have not ` +
      'said, ask them. Nothing was prepared.',
    );
  }

  // ── THE BRIEF PATH'S OWN RULE: operator tail, then scale and direction. The comparator the goal HOLDS (G1) is passed
  // too: beside a held `<=` the run minimises, so a `<=` level is admitted on the mirrored rule, and a `>=` reading
  // contradicts the user's own comparator (`admitStatedGoalLevel`, MG #72 5870097103). None held ⇒ exactly as before.
  const verdict = admitStatedGoalLevel({
    metric: goal.label, operator, rawTarget: target, rawBaseline: raw, cap, heldComparator: (goal as { goal_direction?: unknown }).goal_direction,
    targetUnit: goalUnit,
  });
  if (!verdict.admitted) return refuse('not_admitted', verdict.reason);

  const existing = goal.observed_state;
  const existingRaw = num(existing?.raw_value) ? existing!.raw_value as number : undefined;
  if (existingRaw === raw && existing?.source === USER_EDIT_SOURCE) {
    return refuse('already_recorded', `${sayFigureExactly(raw, goalUnit ?? '') ?? `${raw}${goalUnit !== undefined ? ` ${goalUnit}` : ''}`} is already recorded as the user’s current level of "${goal.label}". Nothing to change.`);
  }
  const observed: GoalObservedState = {
    value: verdict.normalised,
    baseline: verdict.normalised,
    ...(goalUnit !== undefined ? { unit: goalUnit } : {}),
    source: USER_EDIT_SOURCE,
    raw_value: raw,
    cap,
    ...(stated.normalised !== undefined ? { provenance_unit_normalised: stated.normalised } : {}),
  };
  // As the user writes a figure ("£72,000 per month"), from the lane's one formatter (DL #72 5866282787: "72000 £ MRR").
  const withUnit = (x: number) => sayFigureExactly(x, goalUnit ?? '') ?? `${x}${goalUnit !== undefined ? ` ${goalUnit}` : ''}`;
  // ⛔ THE USER'S OWN FIGURE AND UNIT, as they gave it — never relabelled in the goal's unit — plus, when a stated
  // suffix was scaled, what it is recorded as. The target and a replaced record are the goal's own, in its unit.
  const asStated = sayFigureExactly(value, statedUnit) ?? `${value}${statedUnit !== '' ? ` ${statedUnit}` : ''}`;
  const figure = stated.normalised !== undefined ? `${asStated}, which is ${withUnit(raw)}` : asStated;
  const replaces = existingRaw !== undefined && existingRaw !== raw ? existingRaw : undefined;
  // Carried INSIDE the goal's one op, so this stays one goal-level proposal with one write.
  const rederived = rederivedEstimatedPart(g.nodes, goal.id, raw);
  const proposal = createProposal({
    scenario_id: ctx.scenario_id,
    user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: g.graph_hash,
    operations: [{
      op: GOAL_CURRENT_LEVEL_OP, path: goal.id,
      value: { goal_current_level: observed, against: targetOf(node), ...(rederived !== null ? { rederived_part: rederived } : {}) },
    }],
    provenance: { authored_by: 'user_stated', basis: 'the current level of the goal, as the user stated it' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label:
      `Record the current level of "${goal.label}" as your figure: ` +
      (replaces !== undefined ? `${sayFigureRead(replaces, goalUnit ?? '')} → ${figure}` : figure) +
      ` (target ${withUnit(target)})` +
      (rederived !== null ? `. ${sayRederived(goal.label, rederived)}` : ''),
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
    target: { value: target, ...(goalUnit !== undefined ? { unit: goalUnit } : {}) },
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
      ', and call authorise_change with this proposal_id only once they agree.',
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
  if (against === undefined || now.goal_threshold_frame !== 'level' || !sameTarget(against, now)) {
    return {
      ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'superseded',
      detail: `The target of "${goal.label}" changed after this was prepared, so nothing was written. Read the model again and propose afresh.`,
    };
  }

  // ⛔ THE RE-DERIVED ESTIMATE IS RE-DERIVED AT APPLY TIME, and must come out exactly as the user approved it — or,
  // when none was approved, still none: the approval text said what would change, and nothing else is written.
  const carried = (op.value as { rederived_part?: RederivedPart } | undefined)?.rederived_part ?? null;
  const part = rederivedEstimatedPart(approved.nodes, goal.id, os.raw_value);
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
  const nodes = approved.nodes.map((n) => (n.id === op.path
    ? { ...n, observed_state: { ...kept, ...os } }
    : part !== null && n.id === part.node_id ? { ...n, observed_state: part.observed_state } : n));
  const reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
    graph: { ...approved.raw, nodes },
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
  const landed = held !== undefined && held.raw_value === os.raw_value && held.baseline === os.baseline && held.source === os.source &&
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
