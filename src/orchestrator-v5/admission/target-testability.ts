import { linkList } from '../agent-lane/unsized-path-cause.js';
import { evaluatedIdentityCarriers, exactIdentityOperandLinks } from './identity-evaluations.js';
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
import { isPlaceholderLink, linkSizing } from '../../cee/magnitude/link-sizing.js';
import { readHeldGoalComparator, resolveGoalThresholdStrict } from '../goal-target/goal-direction.js';
import { sameUnit, unitsCompose } from '../agent-lane/reconciling-product.js';
import { linkEffectConversionFrames, linkEffectEndUnits, POINTS_STATED, statedInOneOf } from '../system-events/link-effect-edit.js';
import { isTwoStateSource, sayFigure, sourceChangeWords } from '../agent-lane/say-figure.js';
import { edgeStrengthWords } from '../format/edge-strength-words.js';
import { asAnalysed, nodeUnitOf, olumiGuessedGoalLink } from '../../orchestrator/context/placeholder-parts.js';
import { userSizedLevelLessLinks } from '../agent-lane/mediator-reading.js';
import { goalOwnLimitRow, goalTargetRow, statedGoalTargetOf } from '../goal-target/stated-goal-target.js';
import { shareByDateGoalOf } from '../goal-target/goal-kind.js';
import { limitNeedsTodaysLevel, sayGoalChange } from '../agent-lane/limit-frame.js';
import { convertLinkEffect } from '../../cee/magnitude/link-effect.js';

/** R3's preconditions (#77 5912916965). */
export type TargetPrecondition = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
/** AIQ's cases (#77 5912882031): (a) no today's level · (b) an unscorable comparator · (c) no quantified path · (d) a target-derived scale. */
export type TargetCase = 'a' | 'b' | 'c' | 'd';

export interface TargetTestabilityFailure {
  readonly precondition: TargetPrecondition;
  readonly case: TargetCase;
  readonly code: 'missing_goal_baseline' | 'threshold_off_scale' | 'comparator_unscorable' | 'threshold_unit_mismatch'
    | 'goal_path_placeholder' | 'goal_path_unsized' | 'identity_unconfirmed';
  /** For P5: the label of the FAILING link's source node (the lever case (c) names). */
  readonly lever?: string;
  /**
   * For P5: the label of the FAILING link's target node. A guessed link upstream of the goal is not a link into it
   * (Science d5, #2606: d3's `Starter monthly price → Starter-tier monthly recurring revenue`), so (c) names this end.
   */
  readonly link_to?: string;
  /** For P5: the FAILING link's two node ids, so its question sizes that same link in its own ends' units. */
  readonly link?: { readonly from: string; readonly to: string };
  /** R8-6c: every failing P5 link, nearest the goal first; lever remains the first label. */
  readonly links?: Array<{ from: string; to: string }>;
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
 * - (2) ON the path: a placeholder or an Olumi size that cannot convert still fails. Science §(i)'s 8 Oct amendment
 *   admits a current natural estimate in its ends' units; the downstream path/identity carries it into goal units.
 *   Every other precondition remains. A structural link nobody sized carries no guess and is not a failure here.
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
  // Points spelled any way U1's leaf spells them ("pp", "percentage point(s)", "% points", …, plus the bare word) by the
  // writer's own comparator, over the SAME list the writer's arms hold (red team #87 6004429045); never "basis points"
  // (1 bp = 0.01 pp), which the old /point/ regex wrongly admitted. A plain "%" target unit is unchanged (not admitted).
  const isPoints = (u: string): boolean => statedInOneOf(u, POINTS_STATED) || /^(?:percentage\s+)?points?$/i.test(u.trim());
  return ends !== null && ends.target.own.every(isPoints) && statedInOneOf(ne.amount_unit, ends.target.own);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * GOAL-REACH 3b, Science §(i) 1 (8 Oct): once the user has CONFIRMED the goal's product identity (the identity card's
 * Yes: `stated_in_brief: true`) and both factors carry today's level, the goal's level today is DERIVED from them — PLoT
 * measures from it (GOAL_LEVEL_FROM_IDENTITY_INPUTS, labelled by whose figures they are) — so it is not missing (P1).
 * An unconfirmed (Olumi-read) identity never counts: confirming it is the user's step (build 1).
 */
function confirmedProductHasLevels(nodes: readonly unknown[], goal: Rec): boolean {
  const identity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  if (identity?.operation !== 'product' || identity.stated_in_brief !== true || !Array.isArray(identity.factor_ids)
    || identity.factor_ids.length !== 2) return false;
  const levels = identity.factor_ids.map((id) => {
    const n = nodes.find((x) => isRec(x) && x.id === id) as Rec | undefined;
    const os = isRec(n?.observed_state) ? n!.observed_state : undefined;
    return os !== undefined && finite(os.raw_value) ? { unit: os.unit, label: String(id) } : undefined;
  });
  if (levels[0] === undefined || levels[1] === undefined) return false;
  // Codex r2 P1 (#2816): the factors' units must compose into the TARGET's currency and period (a target edited to
  // another currency keeps the confirmed identity; nothing downstream converts it).
  const goalLabel = typeof goal.label === 'string' ? goal.label : '';
  // A confirmed product does not fill an absent rate denominator. The unit reader's `confirm` result leaves that
  // dimensional reading unresolved; deriving today's goal level requires its `proof`, in the target's own unit.
  return unitsCompose(goal.goal_threshold_unit, goalLabel, levels[0], levels[1]).kind === 'proof';
}

/** Science §(i) (A): ONE estimate-conversion predicate for case (c) and its guided-list reader.
 * Read the writer's end units and magnitude converter, including its refused/unreadable frames. A stored natural
 * effect describes only the coefficient it was written for. This licenses no placeholder, user band or accepted size.
 */
export function convertingOlumiEstimate(edge: unknown, graph: unknown): boolean {
  if (!isRec(edge) || linkSizing(edge) !== 'olumi_estimate' || !isRec(graph) || !Array.isArray(graph.nodes)
    || typeof edge.from !== 'string' || typeof edge.to !== 'string') return false;
  const natural = isRec(edge.provenance) && isRec(edge.provenance.natural_effect) ? edge.provenance.natural_effect : undefined;
  const mean = isRec(edge.strength) ? edge.strength.mean : undefined;
  if (natural === undefined || !finite(natural.amount) || !finite(natural.per_source_change)
    || natural.per_source_change === 0 || !finite(mean) || natural.strength_mean !== mean) return false;
  const ends = linkEffectEndUnits(graph, edge.from, edge.to);
  if (ends === null || !statedInOneOf(natural.amount_unit, [...ends.target.own, ends.target.adopted])
    || !statedInOneOf(natural.per_source_change_unit, [...ends.source.own, ends.source.adopted])) return false;
  const frames = linkEffectConversionFrames(graph, edge.from, edge.to);
  if (frames === null) return false;
  const beta = convertLinkEffect(natural.amount, natural.per_source_change, frames.target, frames.source);
  // naturalEffectOf persists BOTH amount and per to six significant figures, while strength_mean keeps beta.
  // Each rounding has <=5e-6 relative error; their ratio differs by <=1e-5 of the larger coefficient.
  return beta !== null && Math.abs(mean) <= 1 && Math.abs(beta - mean) <= 1e-5 * Math.max(Math.abs(beta), Math.abs(mean));
}

/** The goal's own limit row (DECISION-REPRESENTATION row 1): the ONE reader's (`stated-goal-target.ts`). */
const ownLimitRow = goalOwnLimitRow;

const PRECONDITION_ORDER: readonly TargetPrecondition[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/**
 * The failures that withhold the claims made AGAINST the target: the goal chance, the joint chance and (unless the
 * failures leave it in the goal's units) the outcome distribution. One set, so a later ruling is one line.
 *
 * ⛔ RT-10 B′ R2 (Science #87 5999608477; DL e8 CONFIRMED) AMENDS PTL #77 5914383843 for a target the run cannot test:
 * stating a target never removes a finding the Run shows without one. The ordering (shares, leader, brief) needs no level
 * today and no unit — the shared offset cancels on each draw — so these failures no longer cap the analysis mode at
 * `exploratory` nor withhold the shares or the leader. Placeholder paths and an unread product keep their own,
 * target-independent withholds (`placeholderGoalPaths`, Gate 5), exactly as on a run with no target.
 */
export const TARGET_CLAIM_FAILURES: ReadonlySet<TargetTestabilityFailure['code']> = new Set([
  'missing_goal_baseline', 'threshold_off_scale', 'comparator_unscorable', 'threshold_unit_mismatch',
  'goal_path_placeholder', 'goal_path_unsized', 'identity_unconfirmed',
]);

/** True when a verdict withholds the claims made against the target (see {@link TARGET_CLAIM_FAILURES}). */
export function targetVerdictWithholdsTargetClaims(verdict: TargetTestability): boolean {
  return verdict.kind === 'not_testable' && verdict.failures.some((f) => TARGET_CLAIM_FAILURES.has(f.code));
}

/**
 * ⭐ RT-10 B′ R2 AT T1 (Science d5 ruling 5 Oct, on the measured rt10b Run 2): the id of the goal's OWN target row while
 * the target can't be tested — the row the T1/B5 ratified set must not also count as an unchecked limit. That row IS the
 * target (DR row 1), not a feasibility limit: its claims are withheld, and said once, under
 * GOAL_FIGURES_TARGET_NOT_TESTABLE. Counting it in T1 too double-withholds and makes "at most" a precondition for the
 * leader (served Run 2 after "at most 400": `constraint_withheld`, "One limit on your model could not be checked").
 * Bound by IDENTITY, as the row that IS the target ({@link goalTargetRow}: the goal's own non-deadline row, and beside a
 * raw target only the row stating that figure; Codex r1 #2606), never by operator. A deadline row on the goal (DR row 3),
 * a different-figure row beside a raw target, every other node's limit, and a testable target: null, nothing moves.
 */
export function untestableGoalTargetRowId(input: unknown, identityEvaluations?: readonly unknown[]): string | null {
  const verdict = targetTestabilityOf(input, identityEvaluations);
  if (!targetVerdictWithholdsTargetClaims(verdict) || verdict.kind !== 'not_testable' || !isRec(input) || !Array.isArray(input.nodes)) return null;
  const graph = asAnalysed(input as Rec & { nodes: unknown[] });
  const goal = graph.nodes.filter(isRec).find((n) => n.kind === 'goal' && n.id === verdict.goal_id);
  const row = goal === undefined ? undefined : goalTargetRow(graph, goal);
  return typeof row?.constraint_id === 'string' && row.constraint_id !== '' ? row.constraint_id : null;
}

/**
 * The ONE target-independent option reach computation, shared by P5 and the Run's leader licence.
 * `reached` preserves P5's reach set (including off-goal branches); `paths` selects only causal links on a compared
 * option's path to the goal. Options/decisions are never traversed and option set-edges are excluded. Exact operand
 * edges carry no causal size. Callers supply seeds: P5's option nodes, or the licence's actual moved factors.
 * No target, unit, sizing or intervention-level judgement is made by this walk.
 */
export function reachedGoalPaths(graph: unknown, optionIds: readonly string[], seeds: ReadonlyMap<string, readonly unknown[]>, identityEvaluations?: readonly unknown[]): {
  reached: Set<unknown>;
  paths: Array<{ option_id: string; links: Record<string, unknown>[] }>;
  exactLinks: Set<Record<string, unknown>>;
} {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const goal = nodes.find(n => n.kind === 'goal');
  const ids = optionIds;
  const walkable = (id: unknown): boolean => byId.get(id)?.kind !== 'option' && byId.get(id)?.kind !== 'decision';
  const toGoal = new Set<unknown>(goal === undefined ? [] : [goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (toGoal.has(e.to) && walkable(e.from) && walkable(e.to) && !toGoal.has(e.from)) {
      toGoal.add(e.from); grew = true;
    }
  }
  const operands = exactIdentityOperandLinks(nodes, edges, identityEvaluations);
  const exactLinks = new Set(edges.filter(e => (isRec(e.provenance) && e.provenance.definitional === true) || operands.has(e)));
  const reached = new Set<unknown>();
  const paths = ids.map(option_id => {
    const seen = new Set<unknown>(seeds.get(option_id) ?? []);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of edges) if (seen.has(e.from) && !seen.has(e.to) && walkable(e.to)) {
        seen.add(e.to); grew = true;
      }
    }
    for (const id of seen) reached.add(id);
    return { option_id, links: edges.filter(e => seen.has(e.from) && seen.has(e.to) && walkable(e.from)
      && walkable(e.to) && toGoal.has(e.to)) };
  });
  return { reached, paths, exactLinks };
}

/** Stable endpoint de-duplication, ordered by shortest distance of the target from the goal.
 * Guided replies retain the warning's input order for ties; other callers keep their existing graph-edge tie rule. */
export function goalOrderedLinks(graph: unknown, links: readonly { from: string; to: string }[], warningOrderTies = false): Array<{ from: string; to: string }> {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const distance = new Map<unknown, number>(nodes.filter(n => n.kind === 'goal').map(n => [n.id, 0]));
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      const to = distance.get(e.to);
      if (to !== undefined && (distance.get(e.from) ?? Infinity) > to + 1) {
        distance.set(e.from, to + 1); grew = true;
      }
    }
  }
  return [...new Map(links.map(l => [JSON.stringify([l.from, l.to]), { from: l.from, to: l.to }])).values()]
    .sort((a, b) => (distance.get(a.to) ?? Infinity) - (distance.get(b.to) ?? Infinity)
      || (warningOrderTies ? 0 : edges.findIndex(e => e.from === a.from && e.to === a.to) - edges.findIndex(e => e.from === b.from && e.to === b.to)));
}

export function targetTestabilityOf(
  input: unknown,
  /**
   * THIS Run's `identity_evaluations` (ISL via PLoT, top level of the response). An inferred identity the Run evaluated
   * carries its operand links exactly, as the licence's own walk reads them (`reachedGoalPaths` `exactLinks`; Science
   * d5 ruling for #2644). Omitted (before a Run) = none attested: only a confirmed identity counts.
   */
  identityEvaluations?: readonly unknown[],
): TargetTestability {
  if (!isRec(input) || !Array.isArray(input.nodes)) return { kind: 'no_goal' };
  const graph = asAnalysed(input as Rec & { nodes: unknown[] });
  const goal = graph.nodes.filter(isRec).find((n) => n.kind === 'goal' && typeof n.id === 'string');
  if (goal === undefined) return { kind: 'no_goal' };
  const goalId = goal.id as string;
  const stated = statedGoalTargetOf(graph, goal);
  if (stated === null) return { kind: 'no_target', goal_id: goalId };
  // S2a's forecast is sent in delta only after the pure-sum attestation.
  const share = shareByDateGoalOf(input);
  const effectiveFrame = share?.goal.id === goalId ? 'delta' : stated.frame;
  const levelFrame = (effectiveFrame ?? 'level') === 'level';

  const failures: TargetTestabilityFailure[] = [];
  const today = isRec(goal.observed_state) ? goal.observed_state : undefined;
  // P1 — today's level where the frame requires it (`limitNeedsTodaysLevel`), as science reads it
  // (`observed_state.baseline`, the schema-v3 goal limb's condition). Never derived from the target.
  // Codex r2 P1 (#2816): the derived level is a LEVEL frame's only; ISL's relative-change resolver still needs the base.
  const hasToday = (today !== undefined && finite(today.baseline)) || (levelFrame && confirmedProductHasLevels(graph.nodes, goal));
  if (limitNeedsTodaysLevel(effectiveFrame) && !hasToday) failures.push({ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' });
  // P2 — a level target normalises strictly inside (0, 1) (ISL clips at the edges). Change frames normalise elsewhere.
  if (levelFrame && finite(goal.goal_threshold) && !(goal.goal_threshold > 0 && goal.goal_threshold < 1)) {
    failures.push({ precondition: 'P2', case: 'd', code: 'threshold_off_scale' });
  }
  // P3 — a comparator science can score: `>=` / `<=`, and a strict `>` (it travels as `goal_threshold_strict`).
  // A LEVEL goal: the comparator the node HOLDS, else the one its own target row STATES (one reader, Codex r1 #2606;
  // unchanged by W6b: B′ (b) pins a node-held strict `<` as untestable). A CHANGE goal: the stated target's own
  // comparator through `statedGoalTargetOf` (W6b, 7 Oct), the same reader as the words.
  // ⭐ D3 step 1 (Science #87 6006079049 (2); Codex buddy r1 F4 on #2618): a strict `<` is scorable exactly where the run
  // sends it strictly — held on the node, minimised, beside its threshold (`resolveGoalThresholdStrict`). Anywhere else
  // (a `<` only the row states, or no threshold to score) it stays unscorable.
  const heldComparator = levelFrame ? readHeldGoalComparator(graph, goalId) ?? stated.held : stated.held;
  if (heldComparator === '<' && !resolveGoalThresholdStrict(graph, goalId)) failures.push({ precondition: 'P3', case: 'b', code: 'comparator_unscorable' });
  // P5 — the goal's samples arrive in its own unit (see `linkSized`). LEVEL goals only (R3 #75 5914084339): the ruler
  // artefact is `raw / (raw × 1.25) = 0.8` on a level frame; a change frame ("cut by 20%") is left as it was.
  const identity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  const identityForwarded = identity !== undefined && identity.stated_in_brief !== false;
  if (levelFrame) {
    const nodes = (graph.nodes as unknown[]).filter(isRec);
    const kindOf = new Map(nodes.map((n) => [n.id, n.kind] as const));
    const labelOf = new Map(nodes.map((n) => [n.id, typeof n.label === 'string' && n.label.trim() !== '' ? n.label.trim() : String(n.id)] as const));
    const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
    const optionIds = nodes.filter(n => n.kind === 'option' && typeof n.id === 'string').map(n => n.id as string);
    const { reached } = reachedGoalPaths(graph, optionIds, new Map(optionIds.map(id => [id, [id]])));
    const goalUnit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit : today !== undefined && typeof today.unit === 'string' ? today.unit : undefined;
    // (2) a link on an option's path sized only by Olumi (options' own set-edges are not causal links). An operand edge
    // INTO a confirmed identity is exact, not sized (R3 5914745577: `price → mrr`, `subscribers → mrr`).
    const evaluated = evaluatedIdentityCarriers(nodes, identityEvaluations);
    const exactInto = new Set(nodes.filter((n) => isRec(n.nonlinear_identity) && n.nonlinear_identity.stated_in_brief !== false).map((n) => n.id));
    // An inferred identity THIS Run evaluated carries only its OWN operand links exactly, as the licence reads them
    // (`reachedGoalPaths` exactLinks); any other link into it stays a guess (Codex buddy r1 F2, #2644).
    const evaluatedOperand = (e: Record<string, unknown>): boolean => {
      const to = nodes.find((n) => n.id === e.to);
      const identity = isRec(to?.nonlinear_identity) ? to!.nonlinear_identity : undefined;
      return identity !== undefined && evaluated.has(to!.id) && Array.isArray(identity.factor_ids) && identity.factor_ids.includes(e.from);
    };
    // A link Olumi sized (R3 #2371 5914745577: an `olumi_*` magnitude, or a plain `defaulted: true` size — m1's churn →
    // subscribers-at-12-months) that does not hold by definition: B6's ONE test (`olumiGuessedLink`), so the goal and a
    // limit on the same path never disagree (AIQ 5917939324; P0 PARTNER 5918016361).
    const unitOf = nodeUnitOf(nodes);
    const guesses = edges.filter((e) => reached.has(e.from) && reached.has(e.to) && kindOf.get(e.from) !== 'option' && !exactInto.has(e.to)
      && !evaluatedOperand(e) && olumiGuessedGoalLink(e, unitOf) && !convertingOlumiEstimate(e, graph));
    // (1) the links into the goal, unless a confirmed identity carries the goal's samples.
    const into = edges.filter((e) => e.to === goalId && reached.has(e.from) && kindOf.get(e.from) !== 'option');
    // ⭐ T1b (Science d5, 6 Oct, RT-18 class Q1): the user's sizes on both sides of a level-less mediator size the path (M's
    // scale cancels), so its link into the goal is sized: never asked "per a change in" a node with no unit.
    const userChain = userSizedLevelLessLinks(graph);
    const unconverted = identityForwarded ? [] : into.filter((e) => !sizedInGoalUnit(e, goalUnit, graph) && !userChain.has(`${String(e.from)}→${String(e.to)}`));
    const links = goalOrderedLinks(graph, [...unconverted, ...guesses].flatMap(e =>
      typeof e.from === 'string' && typeof e.to === 'string' ? [{ from: e.from, to: e.to }] : []));
    const failing = links.length > 0 ? edges.find(e => e.from === links[0]!.from && e.to === links[0]!.to) : undefined;
    if ((!identityForwarded && into.length === 0) || failing !== undefined) {
      const originalFirst = unconverted[0] ?? guesses[0];
      const placeholderLink = originalFirst !== undefined && isPlaceholderLink(originalFirst);
      failures.push({ precondition: 'P5', case: 'c',
        code: identity !== undefined && !identityForwarded ? 'identity_unconfirmed' : placeholderLink ? 'goal_path_placeholder' : 'goal_path_unsized',
        links, ...(failing !== undefined ? { lever: labelOf.get(failing.from) ?? String(failing.from), link_to: labelOf.get(failing.to) ?? String(failing.to),
          link: { from: String(failing.from), to: String(failing.to) } } : {}) });
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

/** How the target's comparator is said in the B′ tail ("keep them at or below 400"), Science #87 5999608477. */
const TAIL_COMPARATOR_WORDS: Readonly<Record<string, string>> = { '<=': 'at or below', '>=': 'at or above', '<': 'below', '>': 'above' };

/**
 * ⭐ THE ONE SOURCE of the untestable-target words (Science, B′ template edit 1): every sentence about a target the run
 * cannot test — the pre-Run readiness, the "Not shown." withhold and the B′ tail — is composed from these parts.
 * AIQ's rules (#75 5913502854): the reasons name EVERY case measured failing; the one question is the first failing
 * case, in R3's order, that has one ((b) is a capability gap: named, never asked). Science's edits: (c) names the canvas
 * object, the FAILING link by its own two ends ("a size for the link from {failing.from} to {failing.to}", no verb, so a
 * plural label agrees; Science d5 #2606: never "{lever} to {goal}" for a link that is not into the goal), and the level
 * question is "What's today's level of {goal}?" (never "What is {plural} today?").
 */
export interface UntestableTargetParts {
  readonly name: string;
  /** "at most 400 cancellations / month" or "up at least 10% from today": the readiness target words. */
  readonly target: string;
  /** The tail's level or change phrase, or null when no comparator is held. */
  readonly tailTarget: string | null;
  /** One clause per failing case for the readiness sentence ("it needs …", "the model doesn't yet …"). */
  readonly clauses: readonly string[];
  /** One noun phrase per failing case the user can supply, for the tail's "I need …" ((a) is "today's level"). */
  readonly needs: readonly string[];
  /**
   * (b), a CAPABILITY gap ("'< 5%'"), or null. Science d5 (#2606 words check): the user cannot supply it, so it is
   * never in "I need …"; the tail names it in its own sentence (AIQ: named, never asked).
   */
  readonly untestableComparator: string | null;
  readonly question: string | null;
  /**
   * ⭐ Near tie (red team 19; DL #87, 6 Oct): the link `question` asks, when it IS the (c) link question (the failing case's
   * own link, the one the band clause reads); null when the question asks anything else (today's level first) or nothing.
   */
  readonly asked: { readonly from: string; readonly to: string } | null;
  /** The unit the (c) question asks the amount in (the goal's for a link into it, the link's target's upstream); null when unitless. */
  readonly askedIn: string | null;
}

export function untestableTargetParts(graph: unknown, verdict: TargetTestability, namedLinkCount = 3): UntestableTargetParts | null {
  if (verdict.kind !== 'not_testable' || !isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const goal = graph.nodes.filter(isRec).find((n) => n.id === verdict.goal_id);
  const stated = goal === undefined ? null : statedGoalTargetOf(graph, goal);
  if (goal === undefined || stated === null) return null;
  const raw = stated.value;
  const name = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'your goal';
  const unit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit
    : typeof ownLimitRow(graph, goal)?.unit === 'string' ? ownLimitRow(graph, goal)!.unit as string : '';
  const comparator = (stated.frame ?? 'level') === 'level' ? readHeldGoalComparator(graph, verdict.goal_id) ?? stated.held : stated.held;
  const figure = unit !== '' ? sayFigure(raw, unit) : raw.toLocaleString('en-GB');
  // W6: the level card's formatter says a change target, never its raw fraction as a level. Level words stay verbatim.
  const change = sayGoalChange(stated.frame, raw, unit, (value, u) => sayFigure(value, u ?? ''), comparator);
  const target = change ?? [typeof comparator === 'string' ? COMPARATOR_WORDS[comparator] : undefined, figure].filter(Boolean).join(' ');
  const tailWords = typeof comparator === 'string' ? TAIL_COMPARATOR_WORDS[comparator] : undefined;
  const comparatorTarget = change ?? `${typeof comparator === 'string' ? comparator : ''} ${figure}`;
  const failingLink = verdict.failures.find((f) => f.case === 'c');
  const lever = failingLink?.lever;
  const identityCase = verdict.failures.some((f) => f.code === 'identity_unconfirmed');
  const failedLinks = verdict.failures.find(f => f.case === 'c')?.links ?? [];
  const nodes = graph.nodes.filter(isRec);
  const labelOf = (id: string): string => {
    const node = nodes.find(n => n.id === id);
    return typeof node?.label === 'string' && node.label.trim() !== '' ? node.label.trim() : id;
  };
  const link = failedLinks.length > 0
    ? `a size for the ${linkList(failedLinks.map(l => ({ ...l, from_label: labelOf(l.from), to_label: labelOf(l.to) })), Math.min(namedLinkCount, 3, failedLinks.length), false)}`
    : `a size for the link from ${lever ?? 'what the options change'} to ${failingLink?.link_to ?? name}`;
  // The (c) question sizes the SAME link the clause names (Science d5, #2606): a link into the goal keeps AIQ's words, in
  // the goal's unit; an upstream link is asked in its own ends' units (the RT-6 sizing route's reader), never as the
  // lever's whole effect on the goal, which recorded on that link double-counts any non-definitional link after it.
  const upstream = failingLink?.link !== undefined && failingLink.link.to !== verdict.goal_id ? failingLink.link : undefined;
  const linkQuestion = (): string => {
    if (upstream === undefined) return `Roughly how much ${name} in ${unit || 'the goal unit'} does a change in ${lever} bring?`;
    const ends = linkEffectEndUnits(graph, upstream.from, upstream.to);
    const [fromUnit, toUnit] = [ends?.source.own[0], ends?.target.own[0]];
    const to = failingLink?.link_to ?? upstream.to;
    return fromUnit !== undefined && toUnit !== undefined
      ? `Roughly how much does ${to} change, in ${toUnit}, ${sourceChangeWords(lever ?? 'what the options change', fromUnit, isTwoStateSource(Array.isArray((graph as { nodes?: unknown })?.nodes) ? (graph as { nodes: unknown[] }).nodes : [], upstream.from, fromUnit)).when}?`
      : `Roughly how much does ${to} change when ${lever} changes?`;
  };
  /**
   * ⭐ MC D1 (e) (DL 6 Oct; Acceptance rehearsal 15 on CEE 3ee87d3): the user had set this link as a BAND ("moderate",
   * `user_specified`), and the next Run asked for its size as if they had set nothing. A band is not a size in the target's
   * unit (strength-as-size stays banned), so it is still asked — after saying what they set (DL's words).
   */
  const bandTheUserSet = ((): string | null => {
    // The link the question itself asks for (`linkQuestion`: the failing case's own link, else the first one it names).
    const asked = failingLink?.link ?? failedLinks[0];
    if (asked === undefined || !Array.isArray(graph.edges)) return null;
    const edge = graph.edges.filter(isRec).find((e) => e.from === asked.from && e.to === asked.to);
    const mean = isRec(edge?.strength) ? edge.strength.mean : undefined;
    // The band edit's own stamp (`adjust-edge-strength.ts`): `source: 'user_specified'` + `provenance_display: 'user_set'`, and
    // no stated size. A link the user only DREW carries the source but not the display, so it is never "set as" a band.
    const userBand = linkSizing(edge) === 'user' && isRec(edge?.provenance) && edge?.provenance_display === 'user_set'
      && edge.provenance.magnitude !== 'user_stated' && edge.provenance.natural_effect === undefined;
    return userBand && typeof mean === 'number' && Number.isFinite(mean) ? edgeStrengthWords(edge) : null;
  })();
  const askedAfterTheBand = (question: string): string => bandTheUserSet === null ? question
    : `You set this link as ${bandTheUserSet}. To test your ${change === undefined ? `${figure} target` : `target (${change})`} I need it in ${unit || 'the goal unit'}: `
      + `${question[0]!.toLowerCase()}${question.slice(1)}`;
  // [readiness clause, tail noun phrase (null: nothing the user can supply), question]
  const said = (c: TargetCase): readonly [string, string | null, string | null] => c === 'a'
    ? [`it needs today's level of ${name}`, "today's level", `What's today's level of ${name}?`]
    : c === 'c' ? [`it needs ${link}`, link,
      // AIQ (c): the smallest missing link, in natural units; a pending identity has its own card, so no second question.
      identityCase || lever === undefined ? null : askedAfterTheBand(linkQuestion())]
    : c === 'b' ? [`it can't yet test a '${comparatorTarget}' target on ${name}`, null, null]
    : [`your target is in ${unit || 'its own units'}, but the model measures ${name} only relative to that target`,
      `${name} measured in ${unit || 'its own units'}`, `What's today's level of ${name}${unit !== '' ? `, in ${unit}` : ''}?`];
  const cases = [...new Set(verdict.failures.map((f) => f.case))];
  const askingCase = cases.find((c) => said(c)[2] !== null);
  return {
    name,
    target,
    tailTarget: tailWords === undefined ? null : change ?? `${tailWords} ${figure}`,
    clauses: cases.map((c) => said(c)[0]),
    needs: cases.map((c) => said(c)[1]).filter((n): n is string => n !== null),
    untestableComparator: cases.includes('b') ? `'${comparatorTarget}'` : null,
    question: cases.map((c) => said(c)[2]).find((q): q is string => q !== null) ?? null,
    asked: askingCase === 'c' && failingLink?.link !== undefined ? { from: failingLink.link.from, to: failingLink.link.to } : null,
    askedIn: askingCase !== 'c' ? null : upstream === undefined ? (unit !== '' ? unit : null)
      // ⛔ Codex r2 #2659 P1: the writer also takes an end's ADOPTED unit (the link's own stored size), so read it here too.
      : ((ends) => ends?.target.own[0] ?? ends?.target.adopted ?? null)(linkEffectEndUnits(graph, upstream.from, upstream.to)),
  };
}

/**
 * DL guided-path composition: a multi-placeholder reply asks ONLY the missing level before its ONE sizing list.
 * Read the level cases through the existing word producer, so both the ordinary and unit-qualified questions stay
 * byte-identical; case (c)'s separate link clause/question never enters this carrier.
 */
export function targetLevelOnlyQuestion(graph: unknown, verdict: TargetTestability): string | null {
  if (verdict.kind !== 'not_testable') return null;
  const failures = verdict.failures.filter(f => f.case === 'a' || f.case === 'd');
  if (failures.length === 0) return null;
  return untestableTargetParts(graph, { ...verdict, failures })?.question ?? null;
}

/**
 * AIQ's words (#77 5912882031) for a `not_testable` verdict, composed from {@link untestableTargetParts}. `null` otherwise.
 */
const TARGET_TESTABLE_SENTENCE_CAP = 388;

export function notTargetTestableSentence(graph: unknown, verdict: TargetTestability, namedLinkCount = 3): string | null {
  const parts = untestableTargetParts(graph, verdict, namedLinkCount);
  if (parts === null) return null;
  return `Olumi can compare your options, but can't yet test them against your target (${parts.target}), because ${targetBecause(parts)}.${parts.question !== null ? ` ${parts.question}` : ''}`;
}

/** The "because …" of a target sentence: consecutive needs share one "it needs" ("it needs today's level of X and a size
 * for the link from L to X"). Shared by the Run-wide sentence and each option's own (S-E GOALS S6). */
export function targetBecause(parts: Pick<UntestableTargetParts, 'clauses'>): string {
  const clauses = parts.clauses.map((c, i) => (i > 0 && c.startsWith('it needs ') && parts.clauses[i - 1]!.startsWith('it needs ') ? c.slice('it needs '.length) : c));
  return clauses.length === 1 ? clauses[0]! : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
}

/**
 * The B′ WARNING's long form (#2613, DL): only this capped carrier shortens the P5 list (3, 2, then 1 named link +
 * "and N more", the total kept) before it would give up the target, reasons and question. The readiness view keeps
 * {@link notTargetTestableSentence}'s three names unchanged.
 */
export function targetWarningSentence(graph: unknown, verdict: TargetTestability): string | null {
  for (let count = 3; count > 1; count--) {
    const said = notTargetTestableSentence(graph, verdict, count);
    if (said === null || said.length <= TARGET_TESTABLE_SENTENCE_CAP) return said;
  }
  return notTargetTestableSentence(graph, verdict, 1);
}

/**
 * ⭐ RT-10 B′ TAIL (Science #87 5999608477, template approved with edits): what a Run that KEPT the ordering says about
 * the target it cannot test. "I can't yet say how likely any option is to keep {goal} {at or below} {figure}: I need
 * {needs}. {question}". Never "reaches the target", never a recommendation. `null` when the verdict is testable or no
 * comparator is held (no direction to say the target in).
 *
 * (b), a comparator Olumi can't yet test, is a capability gap, never a need (Science d5, #2606 words check): alone,
 * "…: Olumi can't yet test a '{op} {X}' target." with no question; beside needs, "…: I need {A}. Olumi also can't yet
 * test a '{op} {X}' target. {question for A}".
 */
export function untestableTargetTail(graph: unknown, verdict: TargetTestability, optionLabels?: readonly string[]): string | null {
  const parts = untestableTargetParts(graph, verdict);
  if (parts === null || parts.tailTarget === null) return null;
  // Science R3: a scoped spoken sentence must retain a reason and an ask; the panel keeps the original reason.
  if (optionLabels !== undefined && (parts.needs.length === 0 || parts.question === null)) return null;
  const { needs, untestableComparator } = parts;
  const names = optionLabels?.map(label => `‘${label}’`);
  const named = names === undefined ? 'any option' : names.length < 3 ? names.join(' or ')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  const opening = `I can't yet say how likely ${named} is to keep ${parts.name} ${parts.tailTarget}:`;
  const question = parts.question !== null ? ` ${parts.question}` : '';
  if (needs.length === 0) {
    return untestableComparator === null ? null : `${opening} Olumi can't yet test a ${untestableComparator} target.`;
  }
  const need = needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(', ')}, and ${needs[needs.length - 1]}`;
  const gap = untestableComparator === null ? '' : ` Olumi also can't yet test a ${untestableComparator} target.`;
  return `${opening} I need ${need}.${gap}${question}`;
}

/**
 * The `run_analysis` warning for a run whose goal figures are withheld because the target can't be tested yet (AIQ #2371
 * 5914730220). RT-10 B′ R2: only the claims AGAINST the target go; the leader and the shares stay. "Not shown." opens it,
 * as every goal-figure withhold does (its readers key on that opener); the rest is the DR sentence, and `say` is the B′
 * tail the reply says. `null` for a verdict that withholds no target claim.
 */
export function targetNotTestableWarning(
  graph: unknown, verdict: TargetTestability, optionIds: readonly string[], code: string,
): { code: string; message: string; severity: 'warning'; node_ids: string[]; option_ids: string[]; say?: string; level_only_say?: string; first_ask?: { kind: 'link'; from: string; to: string } } | null {
  if (!targetVerdictWithholdsTargetClaims(verdict) || verdict.kind !== 'not_testable') return null;
  const said = targetWarningSentence(graph, verdict);
  const message = said !== null && said.length <= TARGET_TESTABLE_SENTENCE_CAP ? `Not shown. ${said}` : "Not shown. Olumi can compare your options, but can't yet test them against your target.";
  // RT-10 B′ R2: what the reply says about the target, from the same parts (`untestableTargetTail`).
  const tail = untestableTargetTail(graph, verdict);
  const levelOnly = targetLevelOnlyQuestion(graph, verdict);
  // ⭐ Near tie (DL #87, 6 Oct): the link the `say` asks for, typed by id, so the panel names the SAME next step as the chat
  // (as `GOAL_FIGURES_PLACEHOLDER_PATH`'s `first_ask`). Only when the words ask exactly that link; never otherwise.
  const parts = tail === null ? null : untestableTargetParts(graph, verdict);
  // ⛔ Codex r1 #2659 P1: never a typed invitation the door refuses. A % LEVEL goal's question says "in %", but the writer
  // takes a level's change in points only (Science 5993238492), so its answer is `unit_mismatch`: no `first_ask` then.
  // Read through the writer's own end units and comparator, never a second rule.
  const sayAsks = parts?.asked !== undefined && parts.asked !== null && parts.question !== null && tail!.includes(parts.question) ? parts.asked : null;
  const ends = sayAsks === null || parts?.askedIn == null ? null : linkEffectEndUnits(graph, sayAsks.from, sayAsks.to);
  const asked = sayAsks !== null && ends !== null && statedInOneOf(parts!.askedIn, [...ends.target.own, ends.target.adopted]) ? sayAsks : null;
  return { code, message, severity: 'warning', node_ids: [verdict.goal_id], option_ids: [...optionIds], ...(tail !== null ? { say: tail } : {}),
    ...(levelOnly !== null ? { level_only_say: levelOnly } : {}),
    ...(asked !== null ? { first_ask: { kind: 'link' as const, from: asked.from, to: asked.to } } : {}) };
}
