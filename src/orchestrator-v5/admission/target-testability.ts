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
import { linkEffectEndUnits, POINTS_STATED, statedInOneOf } from '../system-events/link-effect-edit.js';
import { sayFigure } from '../agent-lane/say-figure.js';
import { asAnalysed, nodeUnitOf, olumiGuessedGoalLink } from '../../orchestrator/context/placeholder-parts.js';
import { goalOwnLimitRow, goalTargetRow, statedGoalTargetOf } from '../goal-target/stated-goal-target.js';

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
  // Points spelled any way U1's leaf spells them ("pp", "percentage point(s)", "% points", …, plus the bare word) by the
  // writer's own comparator, over the SAME list the writer's arms hold (red team #87 6004429045); never "basis points"
  // (1 bp = 0.01 pp), which the old /point/ regex wrongly admitted. A plain "%" target unit is unchanged (not admitted).
  const isPoints = (u: string): boolean => statedInOneOf(u, POINTS_STATED) || /^(?:percentage\s+)?points?$/i.test(u.trim());
  return ends !== null && ends.target.own.every(isPoints) && statedInOneOf(ne.amount_unit, ends.target.own);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The goal's own limit row (DECISION-REPRESENTATION row 1): the ONE reader's (`stated-goal-target.ts`). */
const ownLimitRow = goalOwnLimitRow;

/** The goal's stated target figure, read by the ONE target reader every surface shares (RT-10 B′ R3). */
function statedTarget(graph: Rec, goal: Rec): number | null {
  return statedGoalTargetOf(graph, goal)?.value ?? null;
}

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
export function untestableGoalTargetRowId(input: unknown): string | null {
  const verdict = targetTestabilityOf(input);
  if (!targetVerdictWithholdsTargetClaims(verdict) || verdict.kind !== 'not_testable' || !isRec(input) || !Array.isArray(input.nodes)) return null;
  const graph = asAnalysed(input as Rec & { nodes: unknown[] });
  const goal = graph.nodes.filter(isRec).find((n) => n.kind === 'goal' && n.id === verdict.goal_id);
  const row = goal === undefined ? undefined : goalTargetRow(graph, goal);
  return typeof row?.constraint_id === 'string' && row.constraint_id !== '' ? row.constraint_id : null;
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
  // The comparator the node HOLDS, else the one its own target row STATES (one reader, Codex r1 #2606).
  const heldComparator = readHeldGoalComparator(graph, goalId) ?? statedGoalTargetOf(graph, goal)?.held;
  if (heldComparator === '<') failures.push({ precondition: 'P3', case: 'b', code: 'comparator_unscorable' });
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
        ...(failing !== undefined ? { lever: labelOf.get(failing.from) ?? String(failing.from), link_to: labelOf.get(failing.to) ?? String(failing.to),
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
  /** "at most 400 cancellations / month": the readiness sentence's target words. */
  readonly target: string;
  /** "at or below 400 cancellations / month" for the tail, or null when no comparator is held. */
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
}

export function untestableTargetParts(graph: unknown, verdict: TargetTestability): UntestableTargetParts | null {
  if (verdict.kind !== 'not_testable' || !isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const goal = graph.nodes.filter(isRec).find((n) => n.id === verdict.goal_id);
  const raw = goal === undefined ? null : statedTarget(graph, goal);
  if (goal === undefined || raw === null) return null;
  const name = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'your goal';
  const unit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit
    : typeof ownLimitRow(graph, goal)?.unit === 'string' ? ownLimitRow(graph, goal)!.unit as string : '';
  const comparator = readHeldGoalComparator(graph, verdict.goal_id) ?? statedGoalTargetOf(graph, goal)?.held;
  const figure = unit !== '' ? sayFigure(raw, unit) : raw.toLocaleString('en-GB');
  const target = [typeof comparator === 'string' ? COMPARATOR_WORDS[comparator] : undefined, figure].filter(Boolean).join(' ');
  const tailWords = typeof comparator === 'string' ? TAIL_COMPARATOR_WORDS[comparator] : undefined;
  const failingLink = verdict.failures.find((f) => f.case === 'c');
  const lever = failingLink?.lever;
  const identityCase = verdict.failures.some((f) => f.code === 'identity_unconfirmed');
  const link = `a size for the link from ${lever ?? 'what the options change'} to ${lever === undefined ? name : failingLink?.link_to ?? name}`;
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
      ? `Roughly how much does ${to} change, in ${toUnit}, when ${lever} rises by ${sayFigure(1, fromUnit)}?`
      : `Roughly how much does ${to} change when ${lever} changes?`;
  };
  // [readiness clause, tail noun phrase (null: nothing the user can supply), question]
  const said = (c: TargetCase): readonly [string, string | null, string | null] => c === 'a'
    ? [`it needs today's level of ${name}`, "today's level", `What's today's level of ${name}?`]
    : c === 'c' ? [`it needs ${link}`, link,
      // AIQ (c): the smallest missing link, in natural units; a pending identity has its own card, so no second question.
      identityCase || lever === undefined ? null : linkQuestion()]
    : c === 'b' ? [`it can't yet test a '${typeof comparator === 'string' ? comparator : ''} ${figure}' target on ${name}`, null, null]
    : [`your target is in ${unit || 'its own units'}, but the model measures ${name} only relative to that target`,
      `${name} measured in ${unit || 'its own units'}`, `What's today's level of ${name}${unit !== '' ? `, in ${unit}` : ''}?`];
  const cases = [...new Set(verdict.failures.map((f) => f.case))];
  return {
    name,
    target,
    tailTarget: tailWords === undefined ? null : `${tailWords} ${figure}`,
    clauses: cases.map((c) => said(c)[0]),
    needs: cases.map((c) => said(c)[1]).filter((n): n is string => n !== null),
    untestableComparator: cases.includes('b') ? `'${typeof comparator === 'string' ? comparator : ''} ${figure}'` : null,
    question: cases.map((c) => said(c)[2]).find((q): q is string => q !== null) ?? null,
  };
}

/**
 * AIQ's words (#77 5912882031) for a `not_testable` verdict, composed from {@link untestableTargetParts}. `null` otherwise.
 */
export function notTargetTestableSentence(graph: unknown, verdict: TargetTestability): string | null {
  const parts = untestableTargetParts(graph, verdict);
  if (parts === null) return null;
  // Consecutive needs share one "it needs" ("it needs today's level of X and a size for the link from L to X").
  const clauses = parts.clauses.map((c, i) => (i > 0 && c.startsWith('it needs ') && parts.clauses[i - 1]!.startsWith('it needs ') ? c.slice('it needs '.length) : c));
  const because = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
  return `Olumi can compare your options, but can't yet test them against your target (${parts.target}), because ${because}.${parts.question !== null ? ` ${parts.question}` : ''}`;
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
export function untestableTargetTail(graph: unknown, verdict: TargetTestability): string | null {
  const parts = untestableTargetParts(graph, verdict);
  if (parts === null || parts.tailTarget === null) return null;
  const { needs, untestableComparator } = parts;
  const opening = `I can't yet say how likely any option is to keep ${parts.name} ${parts.tailTarget}:`;
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
): { code: string; message: string; severity: 'warning'; node_ids: string[]; option_ids: string[]; say?: string } | null {
  if (!targetVerdictWithholdsTargetClaims(verdict) || verdict.kind !== 'not_testable') return null;
  const said = notTargetTestableSentence(graph, verdict);
  const message = said !== null && said.length <= 388 ? `Not shown. ${said}` : "Not shown. Olumi can compare your options, but can't yet test them against your target.";
  // RT-10 B′ R2: what the reply says about the target, from the same parts (`untestableTargetTail`).
  const tail = untestableTargetTail(graph, verdict);
  return { code, message, severity: 'warning', node_ids: [verdict.goal_id], option_ids: [...optionIds], ...(tail !== null ? { say: tail } : {}) };
}
