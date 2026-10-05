/**
 * ⭐ IS THE GOAL'S TARGET TESTABLE, BEFORE ANY RUN (DECISION-REPRESENTATION-v1 row 4; PTL A #77 5912737934).
 *
 * Paul's test (4276f3f9, 30 Sep): "at least £1.2m within 2 months" was stored, readiness said `may_run: true`, and three
 * Runs then answered with no chance, no leader and "no goal direction was recorded". His goal had no today's level and
 * sat on a scale derived from the target itself (`goal_threshold_cap_provenance: target_derived_headroom`), so no Run
 * could test it. The engine already emits the matching refusals after a Run (R3 #77 5912916965 P1–P6). This verdict
 * computes them BEFORE the Run, over the admitted graph, with no model call.
 *
 * It fails toward saying less:
 * - `not_testable` is said only on a precondition this module actually checks;
 * - it never answers "testable" while any precondition is unchecked (`unchecked` names them).
 * P5, a quantified path from an option into the goal's own unit, is MODEL GENERATION's `sizeLink` question and is not
 * checked here yet. Words: AIQ #77 5912882031. Pure and total.
 */
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';
import { readHeldGoalComparator } from '../goal-target/goal-direction.js';
import { sameUnit } from '../agent-lane/reconciling-product.js';
import { linkEffectEndUnits, statedInOneOf } from '../system-events/link-effect-edit.js';
import { sayFigure } from '../agent-lane/say-figure.js';
import { asAnalysed, nodeUnitOf, olumiGuessedGoalLink } from '../../orchestrator/context/placeholder-parts.js';

/** R3's preconditions (#77 5912916965). */
export type TargetPrecondition = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
/** AIQ's cases (#77 5912882031): (a) no today's level · (b) an unscorable comparator · (c) no quantified path · (d) a target-derived scale. */
export type TargetCase = 'a' | 'b' | 'c' | 'd';

export interface TargetTestabilityFailure {
  readonly precondition: TargetPrecondition;
  readonly case: TargetCase;
  readonly code: 'missing_goal_baseline' | 'threshold_off_scale' | 'comparator_unscorable' | 'threshold_unit_mismatch'
    | 'goal_path_placeholder' | 'goal_path_unsized' | 'identity_unconfirmed';
  /** For P5: the label of the first node whose link into the goal nobody sized (the lever case (c) names). */
  readonly lever?: string;
}

export type TargetTestability =
  /** No goal node (or an unreadable graph): nothing to test. */
  | { readonly kind: 'no_goal' }
  /** A goal with no stated target: this verdict has no subject (the direction question is row 1's). */
  | { readonly kind: 'no_target'; readonly goal_id: string }
  | { readonly kind: 'not_testable'; readonly goal_id: string; readonly failures: readonly TargetTestabilityFailure[] }
  /** Every checked precondition holds; the listed ones are checked only by the Run (a confirmed identity's ISL rules). */
  | { readonly kind: 'unchecked'; readonly goal_id: string; readonly unchecked: readonly TargetPrecondition[] }
  /** P1–P5 hold: the goal's samples arrive in its own unit through sized links. */
  | { readonly kind: 'testable'; readonly goal_id: string };

/**
 * P5 ≡ P6, one check, LEVEL goals only (R3 #75 5914028957 / 5914084339 / 5914418154 / 5914500931; AIQ 5914055238 /
 * 5914435183; under PTL #77 5914383843 P2). The goal's chance answers "how often does this option reach the user's
 * target" only when the goal's samples arrive in its own unit, AND the path there does not rest on Olumi's guesses:
 * - (1) INTO the goal: every link from a node an option moves carries a `natural_effect` whose `amount_unit` is the
 *   goal's unit (R3 5914500931: "strong" is unitless, so it converts nothing), OR the goal's identity is confirmed
 *   (its operands are exact);
 * - (2) ON the path: no link is sized only by Olumi (an `olumi_*` magnitude the user did not state). Served m1 after
 *   the identity card's Yes rested on Olumi's price → churn guess (AIQ 5914435183: `exploratory` until the user sizes
 *   it). A structural link nobody sized carries no guess and is not a failure here.
 * A confirmed identity's ISL rules are checked by the Run, so that pass stays listed as unchecked.
 */
function sizedInGoalUnit(e: Rec, goalUnit: string | undefined, graph?: unknown): boolean {
  const p = isRec(e.provenance) ? e.provenance : undefined;
  const ne = isRec(p?.natural_effect) ? p!.natural_effect as Rec : undefined;
  if (goalUnit === undefined || typeof ne?.amount_unit !== 'string' || !finite(ne.amount)) return false;
  if (sameUnit(ne.amount_unit, goalUnit)) return true;
  // ⭐ RT-6 row 2 (Science RULED YES, #87 5993238492): the points-only rule applies to a % LEVEL target the graph marks
  // `percent_level` from `goal_constraints` (1 point = 1 raw unit of the level, `sizeLink`'s own conversion). Read by the
  // WRITER's own comparator over the goal end's own units. A % goal not so marked keeps the pre-existing comparison
  // (follow-up for Science). A count goal's units hold no "points": unchanged.
  const ends = graph !== undefined && typeof e.from === 'string' && typeof e.to === 'string' ? linkEffectEndUnits(graph, e.from, e.to) : null;
  // Points spelled any way ("pp", "percentage point(s)", "point(s)") by the writer's own comparator; never "basis points"
  // (1 bp = 0.01 pp), which the old /point/ regex wrongly admitted. A plain "%" target unit is unchanged (not admitted).
  const isPoints = (u: string): boolean => statedInOneOf(u, ['percentage points', 'pp', 'points']) || /^(?:percentage\s+)?points?$/i.test(u.trim());
  return ends !== null && ends.target.own.every(isPoints) && statedInOneOf(ne.amount_unit, ends.target.own);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The goal's own limit row: the same statement as its target (DECISION-REPRESENTATION row 1). */
/**
 * The goal's own limit row: the target when the node carries no raw threshold. A DEADLINE on the goal ("within 18
 * months") is DR row 3's time limit, not row 4's target: it is skipped, detected by `deadline_metadata` PRESENCE, the
 * signal `compound-goals.ts` uses for the same split.
 */
function ownLimitRow(graph: Rec, goal: Rec): Rec | undefined {
  const rows = Array.isArray(graph.goal_constraints) ? graph.goal_constraints.filter(isRec) : [];
  return rows.find((c) => c.node_id === goal.id && finite(c.value) && !isRec(c.deadline_metadata));
}

/** The goal's stated target figure: the node's own raw threshold, else the goal's own limit row's value. */
function statedTarget(graph: Rec, goal: Rec): number | null {
  if (finite(goal.goal_threshold_raw)) return goal.goal_threshold_raw;
  const own = ownLimitRow(graph, goal);
  return own !== undefined ? (own.value as number) : null;
}

const PRECONDITION_ORDER: readonly TargetPrecondition[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/**
 * ⭐ WHICH FAILURES ALSO WITHHOLD THE LEADER AND THE SHARES, not only the goal chance: all of them.
 * - AIQ #75 5914209776: an unconfirmed product and a placeholder link into the goal (YES in meaning).
 * - PTL #77 5914383843 ("maturity rule = YES"): no today's level, or a consequential goal path resting only on
 *   defaulted/unsized links, is `exploratory` too: no leader, no win shares, no goal chance, and the one blocking question.
 * One set, so a later ruling is one line.
 */
export const CAPS_THE_ORDERING: ReadonlySet<TargetTestabilityFailure['code']> = new Set([
  'missing_goal_baseline', 'threshold_off_scale', 'comparator_unscorable', 'threshold_unit_mismatch',
  'goal_path_placeholder', 'goal_path_unsized', 'identity_unconfirmed',
]);

/** True when a verdict caps the claim at `exploratory` (see {@link CAPS_THE_ORDERING}). */
export function targetVerdictCapsOrdering(verdict: TargetTestability): boolean {
  return verdict.kind === 'not_testable' && verdict.failures.some((f) => CAPS_THE_ORDERING.has(f.code));
}

export function targetTestabilityOf(input: unknown): TargetTestability {
  if (!isRec(input) || !Array.isArray(input.nodes)) return { kind: 'no_goal' };
  const graph = asAnalysed(input as Rec & { nodes: unknown[] });
  const goal = graph.nodes.filter(isRec).find((n) => n.kind === 'goal' && typeof n.id === 'string');
  if (goal === undefined) return { kind: 'no_goal' };
  const goalId = goal.id as string;
  if (statedTarget(graph, goal) === null) return { kind: 'no_target', goal_id: goalId };

  const failures: TargetTestabilityFailure[] = [];
  const today = isRec(goal.observed_state) ? goal.observed_state : undefined;
  // P1 — today's level on the goal, as science reads it (`observed_state.baseline`, the schema-v3 goal limb's
  // condition). Never derived from the target.
  const hasToday = today !== undefined && finite(today.baseline);
  if (!hasToday) failures.push({ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' });
  // P2 — a level target normalises strictly inside (0, 1) (ISL clips at the edges). Change frames normalise elsewhere.
  if ((goal.goal_threshold_frame ?? 'level') === 'level' && finite(goal.goal_threshold) && !(goal.goal_threshold > 0 && goal.goal_threshold < 1)) {
    failures.push({ precondition: 'P2', case: 'd', code: 'threshold_off_scale' });
  }
  // P3 — a comparator science can score: `>=` / `<=`, and a strict `>` (it travels as `goal_threshold_strict`).
  if (readHeldGoalComparator(graph, goalId) === '<') failures.push({ precondition: 'P3', case: 'b', code: 'comparator_unscorable' });
  // P5 — the goal's samples arrive in its own unit (see `linkSized`). LEVEL goals only (R3 #75 5914084339): the ruler
  // artefact is `raw / (raw × 1.25) = 0.8` on a level frame; a change frame ("cut by 20%") is left as it was.
  const identity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  const identityForwarded = identity !== undefined && identity.stated_in_brief !== false;
  const levelFrame = (goal.goal_threshold_frame ?? 'level') === 'level';
  if (levelFrame) {
    const nodes = (graph.nodes as unknown[]).filter(isRec);
    const kindOf = new Map(nodes.map((n) => [n.id, n.kind] as const));
    const labelOf = new Map(nodes.map((n) => [n.id, typeof n.label === 'string' && n.label.trim() !== '' ? n.label.trim() : String(n.id)] as const));
    const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
    // Every node an option moves, directly or downstream (options and the decision are never walked through).
    const reached = new Set<unknown>(nodes.filter((n) => n.kind === 'option').map((n) => n.id));
    for (let grew = true; grew;) {
      grew = false;
      for (const e of edges) {
        if (reached.has(e.from) && !reached.has(e.to) && kindOf.get(e.to) !== 'option' && kindOf.get(e.to) !== 'decision') { reached.add(e.to); grew = true; }
      }
    }
    const goalUnit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit : today !== undefined && typeof today.unit === 'string' ? today.unit : undefined;
    // (2) a link on an option's path sized only by Olumi (options' own set-edges are not causal links). An operand edge
    // INTO a confirmed identity is exact, not sized (R3 5914745577: `price → mrr`, `subscribers → mrr`).
    const exactInto = new Set(nodes.filter((n) => isRec(n.nonlinear_identity) && n.nonlinear_identity.stated_in_brief !== false).map((n) => n.id));
    // A link Olumi sized (R3 #2371 5914745577: an `olumi_*` magnitude, or a plain `defaulted: true` size — m1's churn →
    // subscribers-at-12-months) that does not hold by definition: B6's ONE test (`olumiGuessedLink`), so the goal and a
    // limit on the same path never disagree (AIQ 5917939324; P0 PARTNER 5918016361).
    const unitOf = nodeUnitOf(nodes);
    const guess = edges.find((e) => reached.has(e.from) && reached.has(e.to) && kindOf.get(e.from) !== 'option' && !exactInto.has(e.to)
      && olumiGuessedGoalLink(e, unitOf));
    // (1) the links into the goal, unless a confirmed identity carries the goal's samples.
    const into = edges.filter((e) => e.to === goalId && reached.has(e.from) && kindOf.get(e.from) !== 'option');
    const unconverted = identityForwarded ? undefined : into.find((e) => !sizedInGoalUnit(e, goalUnit, graph));
    const failing = unconverted ?? guess;
    if ((!identityForwarded && into.length === 0) || failing !== undefined) {
      const placeholderLink = failing !== undefined && isPlaceholderLink(failing);
      failures.push({ precondition: 'P5', case: 'c',
        code: identity !== undefined && !identityForwarded ? 'identity_unconfirmed' : placeholderLink ? 'goal_path_placeholder' : 'goal_path_unsized',
        ...(failing !== undefined ? { lever: labelOf.get(failing.from) ?? String(failing.from) } : {}) });
    }
  }
  // P4 — the target's unit is the goal level's own (currency AND period).
  if (today !== undefined && typeof goal.goal_threshold_unit === 'string' && typeof today.unit === 'string'
    && !sameUnit(goal.goal_threshold_unit, today.unit)) {
    failures.push({ precondition: 'P4', case: 'd', code: 'threshold_unit_mismatch' });
  }
  if (failures.length > 0) {
    return { kind: 'not_testable', goal_id: goalId, failures: [...failures].sort((x, y) => PRECONDITION_ORDER.indexOf(x.precondition) - PRECONDITION_ORDER.indexOf(y.precondition)) };
  }
  return !levelFrame || identityForwarded ? { kind: 'unchecked', goal_id: goalId, unchecked: ['P5'] } : { kind: 'testable', goal_id: goalId };
}

const COMPARATOR_WORDS: Readonly<Record<string, string>> = { '>=': 'at least', '>': 'more than', '<=': 'at most', '<': 'below' };

/**
 * AIQ's words (#77 5912882031) for a `not_testable` verdict, under AIQ's two rules (#75 5913502854): the reason names
 * EVERY case measured failing (naming one would imply answering it makes the target testable), and the one question is
 * the first failing case, in R3's order, that has one ((b) is a capability gap: named, never asked). `null` otherwise.
 */
export function notTargetTestableSentence(graph: unknown, verdict: TargetTestability): string | null {
  if (verdict.kind !== 'not_testable' || !isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const goal = graph.nodes.filter(isRec).find((n) => n.id === verdict.goal_id);
  const raw = goal === undefined ? null : statedTarget(graph, goal);
  if (goal === undefined || raw === null) return null;
  const name = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'your goal';
  const unit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit
    : typeof ownLimitRow(graph, goal)?.unit === 'string' ? ownLimitRow(graph, goal)!.unit as string : '';
  const comparator = readHeldGoalComparator(graph, verdict.goal_id) ?? ownLimitRow(graph, goal)?.operator;
  const figure = unit !== '' ? sayFigure(raw, unit) : raw.toLocaleString('en-GB');
  const target = [typeof comparator === 'string' ? COMPARATOR_WORDS[comparator] : undefined, figure].filter(Boolean).join(' ');
  const lever = verdict.failures.find((f) => f.case === 'c')?.lever;
  const identityCase = verdict.failures.some((f) => f.code === 'identity_unconfirmed');
  const said = (c: TargetCase): readonly [string, string | null] => c === 'a' ? [`it needs today's level of ${name}`, `What is ${name} today?`]
    : c === 'c' ? [`the model doesn't yet say how ${lever ?? 'what the options change'} turns into ${name} in ${unit || 'the goal unit'}`,
      // AIQ (c): the smallest missing link, in natural units; a pending identity has its own card, so no second question.
      identityCase || lever === undefined ? null : `Roughly how much ${name} in ${unit || 'the goal unit'} does a change in ${lever} bring?`]
    : c === 'b' ? [`it can't yet test a '${typeof comparator === 'string' ? comparator : ''} ${figure}' target on ${name}`, null]
    : [`your target is in ${unit || 'its own units'}, but the model measures ${name} only relative to that target`, `What is ${name} today${unit !== '' ? `, in ${unit}` : ''}?`];
  const cases = [...new Set(verdict.failures.map((f) => f.case))];
  const reasons = cases.map((c) => said(c)[0]);
  const question = cases.map((c) => said(c)[1]).find((q): q is string => q !== null);
  const because = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;
  return `Olumi can compare your options, but can't yet test them against your target (${target}), because ${because}.${question !== undefined ? ` ${question}` : ''}`;
}

/**
 * The `run_analysis` warning for a run whose goal figures are withheld because the target can't be tested yet (AIQ #2371
 * 5914730220): the goal chance goes with the leader and the shares. "Not shown." opens it, as every goal-figure withhold
 * does (its readers key on that opener); the rest is the DR sentence. `null` for a verdict that doesn't cap.
 */
export function targetNotTestableWarning(
  graph: unknown, verdict: TargetTestability, optionIds: readonly string[], code: string,
): { code: string; message: string; severity: 'warning'; node_ids: string[]; option_ids: string[] } | null {
  if (!targetVerdictCapsOrdering(verdict) || verdict.kind !== 'not_testable') return null;
  const said = notTargetTestableSentence(graph, verdict);
  const message = said !== null && said.length <= 388 ? `Not shown. ${said}` : "Not shown. Olumi can compare your options, but can't yet test them against your target.";
  return { code, message, severity: 'warning', node_ids: [verdict.goal_id], option_ids: [...optionIds] };
}
