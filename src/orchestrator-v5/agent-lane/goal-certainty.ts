import { unsizedLinkSentence, unsizedLinkStatement, legacyLinkSentence } from './unsized-path-cause.js';
/**
 * ⭐ IS A GOAL CERTAINTY EARNED? — ONE typed decision the reply and every goal-probability display read (AI Quality
 * 5882366427 + R3 5882389030, ACKed 5882498938; the DL assigns the producer to MG, 5882387398).
 *
 * An option whose P(goal) is exactly 0 or 1 claims a certainty. It is EARNED only if no path from a factor the option
 * moves to the goal, through a link nobody has sized, runs in the direction that could reverse it: for P = 1 a path that
 * can move the goal away from its target, for P = 0 a path that can move it towards. "Unsized" is the R-c test
 * (`sizedLinkTest`: magnitude absent or `olumi_placeholder`, a natural effect in another unit, or written for another
 * mean), except that a link from an identity operand INTO its identity is exact, when THIS run evaluated that identity.
 *
 * An unearned certainty is never said as 100% or certain. It is said as the model-conditional result plus the
 * BREAK-EVEN, exact arithmetic on the user's own figures that the unsized link cannot change:
 *   · product identity, one operand held: fraction = |T ÷ projected-if-held − 1|, counted on the operand's STATED level
 *     ("about 88 of your 1,500", never a figure the user did not give);
 *   · sum identity: the margin |projected-if-held − T|, in the goal's unit;
 *   · no identity: no exact break-even, so "can't yet say how likely: it depends on …, which isn't sized".
 * No exact break-even is typed (`no_break_even`, AI Quality 5883228443), so an audit can tell why.
 *
 * ⛔ THE GOAL'S PARENTS ARE EXACTLY ITS OPERANDS, OR NOTHING IS EARNED THROUGH THE IDENTITY (PR Review 5883209483; R3
 * 5883225699). ISL reads every DECLARED operand, but the walk reaches the goal only along links: an operand with no link
 * into the goal hides every unsized path into it, so a certainty through it is unearned and has no figure (fail closed).
 * No engine run and no new carrier: everything is on CEE's own graph and the run's per-option P(goal). Pure.
 */
import { isPlaceholderLink, linkSizing } from '../../cee/magnitude/link-sizing.js';
import { goalOrderedLinks, reachedGoalPaths } from '../admission/target-testability.js';
export { reachedGoalPaths } from '../admission/target-testability.js';
import { limitUnitsOf, sizedLinkTest } from '../../orchestrator/context/placeholder-parts.js';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';
import { sayFigure } from './say-figure.js';
import { mediatorReadings, type MediatorReading } from './mediator-reading.js';
import { sameUnit } from './same-unit.js';
import { magnitudeNodes, percentLevelIds } from '../../cee/magnitude/frame-defaulted-links.js';
import { resolveMagnitudeFrame, unitOf } from '../../cee/magnitude/link-effect.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export interface GoalCertaintyDecision {
  readonly option_id: string;
  readonly probability_of_goal: 0 | 1;
  readonly earned: boolean;
  /**
   * The first unsized path that could reverse it: the factor the option moves, and the goal's parent it reaches. A real
   * path in the graph. Present on an unearned decision exactly when `identity_mismatch` is not.
   */
  readonly unsized_path?: { readonly from: string; readonly enters_goal_through: string };
  /**
   * The goal's parents are not exactly its evaluated identity's operands, so nothing an option moves is earned (PR Review
   * on 8dd6343b/0d45a267): the node that breaks equality, and how. NOT a path — no link from the moved factor is implied.
   */
  readonly identity_mismatch?: { readonly node_id: string; readonly reason: 'operand_not_parent' | 'extra_goal_parent' };
  readonly break_even?: {
    readonly kind: 'product' | 'sum';
    readonly projected_if_held: number;
    readonly threshold: number;
    /** product: the share of the operand that reverses it. */
    readonly fraction?: number;
    /** sum: the change in the goal's unit that reverses it. */
    readonly margin?: number;
    readonly operand_id: string;
    /** product: `fraction` of the operand's level, only where that level is the user's own figure. */
    readonly operand_count?: number;
  };
  /** Why an UNEARNED certainty has no `break_even` (AI Quality 5883228443). Absent when earned or when it has one. */
  readonly no_break_even?: NoBreakEven;
  /** The one sentence for an UNEARNED certainty. Absent when earned: every surface says the result as it does today. */
  readonly say?: string;
}

/**
 * Why there is no exact break-even: the goal declares no identity · this run did not evaluate it · ISL's level came from
 * the operands, not the stated level (no k) · the identity has addends · the goal has a parent outside its operands ·
 * an operand has no link into the goal · or the figure itself cannot be formed (no stated level, an operand at 0 …).
 */
export type NoBreakEven =
  | 'not_an_identity' | 'identity_not_evaluated' | 'level_from_inputs' | 'addends' | 'extra_goal_parent'
  | 'operand_not_parent' | 'no_exact_figure';

const userOwns = (source: unknown): boolean =>
  typeof source === 'string' && (source === 'brief_extraction' || source.startsWith('user'));

/** +1 / −1 when the goal is held above / below its target; 0 when the comparator is not stated. */
function goodSign(direction: unknown): number {
  return direction === '>' || direction === '>=' ? 1 : direction === '<' || direction === '<=' ? -1 : 0;
}

function linkSign(e: Rec): number {
  if (e.effect_direction === 'positive') return 1;
  if (e.effect_direction === 'negative') return -1;
  const mean = isRec(e.strength) ? num(e.strength.mean) : undefined;
  return mean === undefined || mean === 0 ? 0 : Math.sign(mean);
}

const levelOf = (n: Rec | undefined): { value?: number; raw?: number; source?: unknown; unit?: string } => {
  const os = isRec(n?.observed_state) ? n!.observed_state : {};
  return { value: num(os.value), raw: num(os.raw_value), source: os.source, unit: text(os.unit) };
};

const interventionLevel = (v: unknown): { value?: number; raw?: number } =>
  isRec(v) ? { value: num(v.value), raw: num(v.raw_value) } : { value: num(v) };

const round3 = (x: number): number => Number(x.toPrecision(3));

/**
 * The decision for every option the run reports at P(goal) exactly 0 or 1. Options with an interior P get none.
 * `optionResults` are the run's per-option results (`option_comparison`: `option_id`, `probability_of_goal`).
 */
export function goalCertaintyDecisions(
  graph: unknown,
  optionResults: ReadonlyArray<Record<string, unknown>>,
  /**
   * THIS run's identity evaluations (the stored fact's `identity_evaluations[]`: `node_id`, `evaluated`,
   * `level_source`). A declared identity the run did not evaluate (PLoT's `identities_not_forwarded`, ISL's withheld
   * identity) was walked as ordinary links, so its operand links are read by their own provenance and it gives no
   * break-even (AI Quality 5882734064). Omitted = none attested: a declaration alone never counts.
   */
  identityEvaluations?: ReadonlyArray<unknown>,
): GoalCertaintyDecision[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return [];
  const evaluations = new Map((identityEvaluations ?? []).filter(isRec)
    .filter((e) => e.evaluated === true && typeof e.node_id === 'string')
    .map((e) => [e.node_id as string, e] as const));
  const evaluated = (id: unknown): boolean => typeof id === 'string' && evaluations.has(id);
  const declared = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  const identity = declared !== undefined && evaluated(goal.id) ? declared : undefined;
  const operands = new Set(Array.isArray(identity?.factor_ids) ? identity!.factor_ids.filter((x): x is string => typeof x === 'string') : []);
  // Set EQUALITY, both ways (PR Review 5883209483): the goal's parents (options and the decision aside) and its operands.
  const parents = new Set(edges.filter((e) => e.to === goal.id).map((e) => e.from)
    .filter((f): f is string => typeof f === 'string' && byId.get(f)?.kind !== 'option' && byId.get(f)?.kind !== 'decision'));
  const unlinkedOperand = identity === undefined ? undefined : [...operands].find((id) => !parents.has(id));
  const extraParent = identity === undefined ? undefined : [...parents].find((id) => !operands.has(id));
  // Either inequality fails the earned result closed, not only the break-even (PR Review on 8dd6343b; R3 5883225699).
  const mismatch = unlinkedOperand !== undefined ? { id: unlinkedOperand, reason: 'operand_not_parent' as const }
    : extraParent !== undefined ? { id: extraParent, reason: 'extra_goal_parent' as const } : undefined;
  const evaluation = evaluations.get(goal.id);
  const noExact: NoBreakEven | undefined = declared === undefined ? 'not_an_identity'
    : identity === undefined ? 'identity_not_evaluated'
      : evaluation?.level_source !== 'stated_level' ? 'level_from_inputs'
        : (Array.isArray(identity.addends) ? identity.addends.length > 0 : identity.addends !== undefined) ? 'addends'
          : unlinkedOperand !== undefined ? 'operand_not_parent'
            : extraParent !== undefined ? 'extra_goal_parent'
              : undefined;
  // #2473 CR P2 (CODEX_CLI_OVERFLOW 5937437431): the same unit-less-limit-node reading as every other sized reader.
  const sized = sizedLinkTest(nodes, limitUnitsOf(graph.goal_constraints));
  const exact = (e: Rec): boolean => {
    const to = byId.get(e.to);
    const id = isRec(to?.nonlinear_identity) && evaluated(to!.id) ? to!.nonlinear_identity : undefined;
    return (Array.isArray(id?.factor_ids) && id!.factor_ids.includes(e.from)) || sized(e);
  };
  const good = goodSign(goal.goal_direction);
  const out: GoalCertaintyDecision[] = [];

  for (const r of optionResults) {
    const optionId = text(r.option_id);
    const p = num(r.probability_of_goal);
    if (optionId === undefined || p === undefined) continue;
    // EXACTLY 0 or 1 (PR Review on 0d45a267): the engine's P is a share of draws, so all or none is exact; 0.9999999995
    // is an interior result and gets no decision.
    const certainty: 0 | 1 | undefined = p === 1 ? 1 : p === 0 ? 0 : undefined;
    if (certainty === undefined) continue;
    const option = byId.get(optionId);
    const iv = option !== undefined ? mergeInterventionSourceObjects(option) : {};
    // The goal would move AWAY from its target (P = 1) or TOWARDS it (P = 0) to reverse the certainty.
    const reversing = certainty === 1 ? -good : good;
    let found: { from: string; through: string; move: number } | undefined;
    // The factors the option moves. A factor set at the level it holds moves nothing, so no path from it can reverse
    // anything. An unknown move is read as either way (0: "could reverse").
    const moved = Object.entries(iv).flatMap(([factorId, set]) => {
      if (!byId.has(factorId)) return [];
      const now = levelOf(byId.get(factorId));
      const to = interventionLevel(set);
      const known = to.value !== undefined && now.value !== undefined;
      const move = known ? Math.sign(to.value! - now.value!) : 0;
      return move === 0 && known ? [] : [{ factorId, move }];
    });
    // ⛔ The goal's parents are not exactly its operands: an operand with no link into the goal hides what reaches it,
    // and a parent outside them adds what the identity does not say. Nothing an option moves is earned (fail closed).
    if (mismatch !== undefined && moved.length > 0) {
      out.push({
        option_id: optionId, probability_of_goal: certainty, earned: false,
        identity_mismatch: { node_id: mismatch.id, reason: mismatch.reason },
        no_break_even: mismatch.reason,
        say: sayMismatch(certainty, option, goal, byId, { from: moved[0]!.factorId, through: mismatch.id }, mismatch.reason),
      });
      continue;
    }
    for (const { factorId, move } of moved) {
      if (found !== undefined) break;
      // Every simple path from the moved factor to the goal, through factors, outcomes and risks.
      const walk = (at: string, sign: number, allExact: boolean, seen: Set<string>): void => {
        if (found !== undefined) return;
        for (const e of edges) {
          if (e.from !== at || typeof e.to !== 'string' || seen.has(e.to)) continue;
          const k = byId.get(e.to)?.kind;
          if (k === 'option' || k === 'decision') continue;
          const s = sign * linkSign(e);
          const ok = allExact && exact(e);
          if (e.to === goal.id) {
            const effect = move * s;
            const couldReverse = reversing === 0 || effect === 0 || effect === reversing;
            if (!ok && couldReverse) found = { from: factorId, through: at, move };
            continue;
          }
          walk(e.to, s, ok, new Set([...seen, e.to]));
        }
      };
      walk(factorId, 1, true, new Set([factorId]));
    }
    if (found === undefined) {
      out.push({ option_id: optionId, probability_of_goal: certainty, earned: true });
      continue;
    }
    const breakEven = noExact === undefined ? breakEvenOf(goal, identity, operands, byId, iv, found.through) : undefined;
    out.push({
      option_id: optionId,
      probability_of_goal: certainty,
      earned: false,
      unsized_path: { from: found.from, enters_goal_through: found.through },
      ...(breakEven !== undefined ? { break_even: breakEven } : { no_break_even: noExact ?? 'no_exact_figure' }),
      say: sayUnearned(certainty, reversing, option, goal, byId, found, breakEven),
    });
  }
  return out;
}

/**
 * R3 5882943255 (CODE-READ ISL `robustness_analyzer_v2.py`): ISL evaluates goal = k × Π(operands) + addends + L, with
 * k set from the goal's STATED level. `today × Π(now ÷ was)` is ISL's own projection only when (1) this run evaluated
 * the identity from the stated level (`level_source: 'stated_level'`; `'identity_inputs'` has no k), (2) the identity
 * has no addends, and (3) the goal's parents are EXACTLY the identity's operands (L = 0, and no operand unlinked). Otherwise
 * there is no exact break-even (`noExact`, typed), and the decision says "can't yet say how likely" (fail closed: never a
 * wrong figure).
 */
function breakEvenOf(
  goal: Rec,
  identity: Rec | undefined,
  operands: ReadonlySet<string>,
  byId: ReadonlyMap<unknown, Rec>,
  iv: Record<string, unknown>,
  through: string,
): GoalCertaintyDecision['break_even'] {
  const op = identity?.operation;
  if ((op !== 'product' && op !== 'sum') || !operands.has(through) || through in iv) return undefined;
  const today = levelOf(goal).raw;
  const threshold = num(goal.goal_threshold_raw);
  if (today === undefined || threshold === undefined) return undefined;
  let projected = today;
  for (const id of operands) {
    if (!(id in iv)) continue;
    const was = levelOf(byId.get(id)).raw;
    const now = interventionLevel(iv[id]).raw;
    if (was === undefined || now === undefined || (op === 'product' && was === 0)) return undefined;
    projected = op === 'product' ? projected * (now / was) : projected + (now - was);
  }
  if (op === 'sum') return { kind: 'sum', projected_if_held: projected, threshold, margin: Math.abs(projected - threshold), operand_id: through };
  if (projected === 0) return undefined;
  const fraction = Math.abs(threshold / projected - 1);
  const operand = levelOf(byId.get(through));
  const count = operand.raw !== undefined && userOwns(operand.source) ? Math.round(fraction * operand.raw) : undefined;
  return { kind: 'product', projected_if_held: projected, threshold, fraction, operand_id: through, ...(count !== undefined ? { operand_count: count } : {}) };
}

/** The sentence when the goal's parents are not exactly its operands: the model cannot follow the option through it. */
function sayMismatch(
  certainty: 0 | 1,
  option: Rec | undefined,
  goal: Rec,
  byId: ReadonlyMap<unknown, Rec>,
  found: { from: string; through: string },
  reason: 'operand_not_parent' | 'extra_goal_parent',
): string {
  const label = (id: unknown): string => text(byId.get(id)?.label) ?? String(id);
  const opt = `‘${text(option?.label) ?? String(option?.id ?? '')}’`;
  const head = `Olumi can’t yet say how likely ${opt} is to ${certainty === 1 ? 'meet' : 'miss'} the goal: `;
  return reason === 'operand_not_parent'
    ? `${head}‘${label(goal.id)}’ is worked out from ‘${label(found.through)}’, but the model has no link from it to `
      + `‘${label(goal.id)}’, so it can’t follow what ‘${label(found.from)}’ does through it.`
    : `${head}the model links ‘${label(found.through)}’ into ‘${label(goal.id)}’ beside the parts it is worked out from, so it `
      + `can’t check what ‘${label(found.from)}’ does to it.`;
}

/**
 * ⭐ THE ONE INPUT PATH FROM A STORED RUN (DL 5883245872; PR Review 5883209483): a reply or panel reads a Run's
 * decision from the STORED fact — `result.enrichment`, PLoT's `/v2/run` response kept whole, carries both the per-option
 * `option_comparison[].probability_of_goal` and ISL's `identity_evaluations[]` (with `level_source`) — never from the
 * transport keep-list, which carries neither the evaluations nor their `level_source`. Anything missing fails closed.
 */
export function goalCertaintyOfStoredResult(graph: unknown, result: unknown): GoalCertaintyDecision[] {
  const enrichment = isRec(result) && isRec(result.enrichment) ? result.enrichment : undefined;
  const options = Array.isArray(enrichment?.option_comparison) ? enrichment!.option_comparison.filter(isRec) : [];
  const evaluations = Array.isArray(enrichment?.identity_evaluations) ? enrichment!.identity_evaluations : undefined;
  return goalCertaintyDecisions(graph, options, evaluations);
}

function sayUnearned(
  certainty: 0 | 1,
  reversing: number,
  option: Rec | undefined,
  goal: Rec,
  byId: ReadonlyMap<unknown, Rec>,
  found: { from: string; through: string; move: number },
  be: GoalCertaintyDecision['break_even'],
): string {
  const label = (id: unknown): string => text(byId.get(id)?.label) ?? String(id);
  const opt = `‘${text(option?.label) ?? String(option?.id ?? '')}’`;
  const moved = `‘${label(found.from)}’`;
  const part = `‘${label(found.through)}’`;
  // The unsized link can be the moved factor's own edge into the goal (R3 5887059128): it then moves the goal.
  const moves = found.from === found.through ? `‘${label(goal.id)}’` : part;
  const unsized = `Olumi hasn’t sized how ${moved} moves ${moves}, so it can’t yet say how likely that is.`;
  if (be === undefined) {
    return `Olumi can’t yet say how likely ${opt} is to ${certainty === 1 ? 'meet' : 'miss'} the goal: it depends on how ${moved} moves ${moves}, which isn’t sized.`;
  }
  const unit = text(goal.goal_threshold_unit) ?? levelOf(goal).unit ?? '';
  const target = sayFigure(be.threshold, unit);
  const holds = `${opt} gives about ${sayFigure(round3(be.projected_if_held), unit)} if ${part} holds.`;
  const verb = reversing < 0 ? 'loses' : 'gains';
  // The CHANGE loses or gains, not the option (AI Quality nit 5882734064): "if raising ‘Monthly Pro price’ loses …".
  const change = found.move > 0 ? `raising ${moved}` : found.move < 0 ? `lowering ${moved}` : `the change to ${moved}`;
  const outcome = certainty === 1 ? `It misses ${target} if` : `It reaches ${target} only if`;
  if (be.kind === 'sum') {
    return `${holds} ${outcome} ${part} ${reversing < 0 ? 'falls' : 'rises'} by more than ${sayFigure(round3(be.margin!), unit)}. ${unsized}`;
  }
  const operand = levelOf(byId.get(found.through));
  const count = be.operand_count !== undefined && operand.raw !== undefined
    ? ` (about ${be.operand_count} of your ${sayFigure(operand.raw, operand.unit ?? '')})`
    : '';
  const pct = Math.round(be.fraction! * 1000) / 10;
  return `${holds} ${outcome} ${change} ${verb} more than about ${pct}% of ${part}${count}. ${unsized}`;
}


/** One option whose goal figures move with a link nobody sized, and every such link on its paths into the goal. */
export interface PlaceholderGoalPath {
  readonly option_id: string;
  /** The unsized links (`from` → `to`), in walk order, deduplicated. Never empty. */
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/**
 * R4 leader licence: nobody sized a causal link on a compared option's goal path. Independent of the target and
 * stricter than the legacy placeholder-only coaching reader below. A user size wins over stale stamps; definition
 * and confirmed identity operands are exact. Examples and Olumi's actual estimates keep their existing disclosures.
 */
/** Actual moved factors, using the legacy placeholder reader's held/raw scale rule. Unknown moves fail closed. */
function actualMoveSeeds(graph: unknown, optionIds: readonly string[], scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>): Map<string, string[]> {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  return new Map(optionIds.map(optionId => {
    const option = byId.get(optionId);
    const iv = scoredInterventions?.get(optionId) ?? (option === undefined ? undefined : mergeInterventionSourceObjects(option));
    const moved = Object.entries(iv ?? {}).flatMap(([factorId, set]) => {
      if (!byId.has(factorId)) return [];
      const held = levelOf(byId.get(factorId));
      const to = interventionLevel(set);
      const same = (a: number | undefined, b: number | undefined): boolean => a !== undefined && b !== undefined && a === b;
      return same(to.value, held.value) || same(to.raw, held.raw) || same(to.value, held.raw) ? [] : [factorId];
    });
    return [optionId, moved];
  }));
}

/**
 * The leader licence's ONE "nobody sized it" predicate for a link (P5; R8-2: only the licence reads `mean_projected`): an
 * Olumi placeholder or a mean the producer projected, never the user's. The no-dead-end reader asks THIS, never the field.
 */
export function licenceUnsizedLink(edge: unknown): boolean {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  return linkSizing(edge) !== 'user' && (p?.magnitude === 'olumi_placeholder' || p?.mean_projected === true);
}

export function unsizedLeaderGoalPaths(graph: unknown, optionIds: readonly string[], identityEvaluations?: readonly unknown[], scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>): PlaceholderGoalPath[] {
  const seeds = actualMoveSeeds(graph, optionIds, scoredInterventions);
  const { paths, exactLinks } = reachedGoalPaths(graph, optionIds, seeds, identityEvaluations);
  return paths.flatMap(path => {
    const links = path.links.filter(e => {
      if (exactLinks.has(e) || linkSizing(e) === 'user') return false;
      const p = isRec(e.provenance) ? e.provenance : undefined;
      return p?.magnitude === 'olumi_placeholder' || p?.mean_projected === true;
    }).flatMap(e => typeof e.from === 'string' && typeof e.to === 'string' ? [{ from: e.from, to: e.to }] : []);
    return links.length > 0 ? [{ option_id: path.option_id, links }] : [];
  });
}

/** R8 legacy disclosure uses the same actual-move licence walk; defaulted alone never withholds. */
export function legacyLeaderGoalLinks(graph: unknown, optionIds: readonly string[], identityEvaluations?: readonly unknown[], scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>): Array<{ from: string; to: string }> {
  const { paths, exactLinks } = reachedGoalPaths(graph, optionIds, actualMoveSeeds(graph, optionIds, scoredInterventions), identityEvaluations);
  return goalOrderedLinks(graph, paths.flatMap(path => path.links.filter(e => {
    const p = isRec(e.provenance) ? e.provenance : undefined;
    return !exactLinks.has(e) && linkSizing(e) !== 'user' && p?.mean_projected !== true
      && p?.magnitude === undefined && e.defaulted === true;
  }).flatMap(e => typeof e.from === 'string' && typeof e.to === 'string' ? [{ from: e.from, to: e.to }] : [])));
}

export function legacyGoalWarning(graph: unknown, links: Array<{ from: string; to: string }>): {
  code: 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK'; message: string; severity: 'info'; node_ids: string[]; links: Array<{ from: string; to: string }>;
} {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const label = (id: string): string => text(nodes.find(n => n.id === id)?.label) ?? id;
  return { code: 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK', severity: 'info',
    message: legacyLinkSentence(links.map(l => ({ ...l, from_label: label(l.from), to_label: label(l.to) }))),
    node_ids: links[0] === undefined ? [] : [links[0].from, links[0].to], links };
}

/**
 * ⛔ (S) AN OPTION'S GOAL FIGURES ARE NOT EARNED WHILE ANY PATH FROM WHAT IT MOVES INTO THE GOAL RUNS THROUGH A LINK
 * NOBODY SIZED (DL #75 5902570568; AIQ 5902548598: the ANY-path rule #2323 ships for limits, 5900908629).
 *
 * Served cut-costs on `1f9d769` (10 of 15 drafts, MG 5902531777): the goal card read "Chance 8%" for "Switch fully to
 * GCP" (R3 5902550605) through a savings → spend link that is an `olumi_placeholder`. That figure moves with Olumi's
 * unsized coefficient, not with anything the user said; their "GCP ~25% cheaper" could not move it.
 *
 * THE LINK: one the sizer marked `olumi_placeholder` (AIQ's words, R3's R-PH checker), unless the user stated its strength
 * or it is an operand INTO an identity THIS run evaluated (exact: the goal-certainty rule's `exact`). NOT R-c's broader
 * "not sized" test: a structural link the sizer never marked (no `magnitude`) is not a placeholder here. Measured: R-c's
 * test withholds the DL's signed-in MRR card journey (`520aab46`, churn → paying subscribers carries no magnitude), whose
 * price options must keep their chance (DL 5902570568's positive control). So the MRR card's confirmed
 * `price × subscribers` keeps every figure, and a pre-card MRR run, whose last link into the goal is a placeholder,
 * withholds every mover (AIQ 5902606752: intended). A factor set at the level it already holds moves nothing, so an option
 * with no move (the status quo) keeps its figures (R3 5902591666). Pure.
 */
export function placeholderGoalPaths(
  graph: unknown,
  optionIds: readonly string[],
  identityEvaluations?: ReadonlyArray<unknown>,
  /** The interventions PLoT scored, by option id (the run's final wire options); else the option node's own. */
  scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>,
): PlaceholderGoalPath[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return [];
  const evaluated = new Set((identityEvaluations ?? []).filter(isRec)
    .filter((e) => e.evaluated === true && typeof e.node_id === 'string').map((e) => e.node_id as string));
  // ⛔ THE CARD IS THE ONE ROUTE (AIQ 5902606752): a goal that declares an INFERRED product this run did not evaluate is
  // Olumi's unconfirmed reading of how the goal is made. PLoT never forwards it (variant (d), `translator-v3.ts`) and
  // withholds every goal figure itself (#416, which (S) defers to), and C46 names the leader's cause. (S) stands down, so
  // the one reason said is the product's, and the confirm card is the one way forward.
  const goalIdentity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  if (goalIdentity !== undefined && goalIdentity.stated_in_brief === false && goalIdentity.operation === 'product' && !evaluated.has(goal.id)) return [];
  const placeholder = (e: Rec): boolean => {
    // ONE predicate (L4, `link-sizing.ts`): an accepted Olumi estimate sizes a link for goal figures (DL 5929790081 (i)).
    if (!isPlaceholderLink(e)) return false;
    const to = byId.get(e.to);
    const id = isRec(to?.nonlinear_identity) && evaluated.has(String(to!.id)) ? to!.nonlinear_identity : undefined;
    return !(Array.isArray(id?.factor_ids) && id!.factor_ids.includes(e.from));
  };
  const walkable = (id: unknown): boolean => {
    const k = byId.get(id)?.kind;
    return k !== undefined && k !== 'option' && k !== 'decision';
  };
  // Every node with a path to the goal (options and the decision aside): a link lies on a path into the goal only
  // when it points at one of these, or at the goal.
  const reachesGoal = new Set<unknown>([goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      if (reachesGoal.has(e.to) && !reachesGoal.has(e.from) && walkable(e.from)) { reachesGoal.add(e.from); grew = true; }
    }
  }
  const out: PlaceholderGoalPath[] = [];
  for (const optionId of optionIds) {
    const moved = (actualMoveSeeds(graph, [optionId], scoredInterventions).get(optionId) ?? []).filter(id => reachesGoal.has(id));
    const links: { from: string; to: string }[] = [];
    const seen = new Set<unknown>(moved);
    const queue: unknown[] = [...moved];
    while (queue.length > 0) {
      const at = queue.shift();
      for (const e of edges) {
        if (e.from !== at || !reachesGoal.has(e.to) || typeof e.to !== 'string' || typeof e.from !== 'string') continue;
        if (placeholder(e) && !links.some((l) => l.from === e.from && l.to === e.to)) links.push({ from: e.from, to: e.to });
        if (e.to !== goal.id && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
    }
    if (links.length > 0) out.push({ option_id: optionId, links });
  }
  return out;
}

/** What a placeholder withhold asks FIRST (D3, 6 Oct): the goal's level, one gauge question, or one link. */
export type PlaceholderFirstAsk =
  | { readonly kind: 'goal_level'; readonly node_id: string }
  | { readonly kind: 'gauge'; readonly from: string; readonly through: string; readonly to: string }
  | { readonly kind: 'link'; readonly from: string; readonly to: string };

/**
 * The ONE typed warning for (S) (`GOAL_FIGURES_PLACEHOLDER_PATH`): which options, which links, and the words, in the
 * UI's "Not shown." register (≤ 400 characters). The ask names the links to size: the writer is `propose_link_effect`
 * (AIQ 5902548598). A placeholder INTO an identity the goal declares but this run did not evaluate is sized by the
 * user's Yes on the confirm card, so it gets no link-size ask of its own: one route, not two (AIQ 5902606752).
 */
export function placeholderGoalWarning(
  graph: unknown,
  paths: readonly PlaceholderGoalPath[],
  code: string,
  productBlocks = false,
): { code: string; message: string; severity: 'warning'; node_ids: string[]; option_ids: string[]; links: Array<{ from: string; to: string }>; acceptable_links?: Array<{ from: string; to: string }>; first_ask?: PlaceholderFirstAsk } {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const cardSized = (l: { from: string; to: string }): boolean => {
    const id = byId.get(l.to)?.nonlinear_identity;
    return isRec(id) && Array.isArray(id.factor_ids) && id.factor_ids.includes(l.from);
  };
  const links = [...new Map(paths.flatMap((p) => p.links).map((l) => [`${l.from}->${l.to}`, l] as const)).values()];
  const named = links.filter((l) => !cardSized(l));
  // ⛔ ASK ONLY FOR A SIZE THAT CAN MAKE THE FIGURE RIGHT (AIQ 5902834053; MG successor 5902809244): a link from a node
  // that holds no level would add the same amount to EVERY option once sized ("Stay on AWS" would save too), so it is
  // named but not asked; its figures stay withheld until the model gives that node a level.
  // ⛔ NEVER ASK THE USER TO SIZE A GUESSED LINK OUT OF A NODE THEIR LIMIT WATCHES (AIQ 5903604206 / 5903627210; R3
  // 5903589565): "Give a figure for how 'Migration downtime' moves 'Monthly cloud spend'" presupposes a cause Olumi guessed —
  // downtime does not drive the bill — and the user's answer would turn Olumi's mechanism into a user-stated link. It is said
  // as the guess it is, and not asked; nothing is offered that no writer delivers (no tool removes a link).
  const limitIds = new Set((isRec(graph) && Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [])
    .filter(isRec).map((c) => c.node_id).filter((id): id is string => typeof id === 'string'));
  // Only a link INTO the goal (AIQ 5903874730; P0 PARTNER 5903857287): a placeholder out of limit-watched churn into
  // subscribers is a real mechanism whose size is unknown, so it is asked for as before; downtime → spend is the guess.
  const guessedLink = (l: { from: string; to: string }): boolean => limitIds.has(l.from) && byId.get(l.to)?.kind === 'goal';
  const ordered = goalOrderedLinks(graph, links);
  const labelOf = (id: string): string => text(byId.get(id)?.label) ?? id;
  // ⭐ NO DEAD END (MC 21's chain; Science #87 6006425419, 6006548763, 6006685510): every withheld path gets an ask the
  // user can answer in one sentence. A level-less mediator is asked END TO END (the gauge) or in the unit its sized parent
  // fixes; a goal with no frame is asked its level first. Pure wording + offer: the links and the withhold are unchanged.
  const noDeadEnd = productBlocks ? undefined : placeholderAskWords(graph, ordered);
  const asked = named.filter((l) => !guessedLink(l) && levelOf(byId.get(l.from)).value !== undefined
    && !(noDeadEnd?.gaugeLinks.has(`${l.from}->${l.to}`) ?? false));
  // #2613 CR (b): while Gate 5 withholds every option, sizing a link cannot lift it: state the link, invite nothing, offer nothing.
  // Codex r1 #2635 P1: the same when no named link can be ASKED (only a guessed link, or one from a node with no level): the
  // AIQ rule says those are named, never asked, so the words invite nothing and `first_ask` is absent with them.
  const said = productBlocks || asked.length === 0 ? unsizedLinkStatement : unsizedLinkSentence;
  const message = noDeadEnd?.message ?? said(ordered.map(l => ({ ...l, from_label: labelOf(l.from), to_label: labelOf(l.to) })));
  const firstLink = ordered.find((l) => asked.some((a) => a.from === l.from && a.to === l.to));
  const firstAsk: PlaceholderFirstAsk | undefined = productBlocks ? undefined
    : noDeadEnd?.first ?? (firstLink !== undefined ? { kind: 'link', from: firstLink.from, to: firstLink.to } : undefined);
  return {
    code, message,
    links: ordered,
    severity: 'warning',
    node_ids: [...new Set(links.flatMap((l) => [l.from, l.to]))],
    option_ids: paths.map((p) => p.option_id),
    // ⭐ DL [R2] (5930827933): the links the row may offer as ONE click, "Accept starting strength", through the
    // approval that sizes a placeholder (#2446 `approvalSizes`). Only the ones whose size can make the figure right — the
    // SAME set the sentence asks about (a levelled source, not a guessed mechanism): the offer gate (V4).
    ...(asked.length > 0 && !productBlocks ? { acceptable_links: asked.map((l) => ({ from: l.from, to: l.to })) } : {}),
    // ⭐ D3 (DL 0df0e1, 6 Oct; Integrator 37): what `message` asks FIRST, typed, so every surface names the SAME next step
    // (the panel reads it by identity; it never picks a link of its own): the goal's level (A), the gauge's one end-to-end
    // question (B), a link in its parent's unit (C), else the first link the sentence asks, nearest the goal. Nothing
    // while a product blocks (the words invite nothing).
    ...(firstAsk !== undefined ? { first_ask: firstAsk } : {}),
  };
}

/**
 * The ONE source of a withhold's no-dead-end words, for the warning AND the Agent's withheld reply (R8: one grammar for the
 * warning, summary, reply and P5; Codex/R8-6: the reply re-said the generic sentence). The AIQ guessed-link rule applies.
 */
export function placeholderAskWords(graph: unknown, links: ReadonlyArray<{ from: string; to: string }>): { message: string; gaugeLinks: Set<string>; first: PlaceholderFirstAsk } | undefined {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const limitIds = new Set((isRec(graph) && Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [])
    .filter(isRec).map((c) => c.node_id).filter((id): id is string => typeof id === 'string'));
  const guessed = (l: { from: string; to: string }): boolean => limitIds.has(l.from) && byId.get(l.to)?.kind === 'goal';
  return noDeadEndAsks(graph, links, (id) => text(byId.get(id)?.label) ?? id, guessed);
}

/**
 * ⭐ THE NO-DEAD-END ASKS (MC 21; Science d5): the words a withheld path's links are asked in, when a level-less mediator or
 * a frameless goal would otherwise leave the user nothing they can answer. `undefined` when none applies, so every other
 * withhold keeps its words byte for byte.
 *   (A) a goal with no frame: its level first, with Science's bridge ("To size it, I first need today’s level of …"); the existing card
 *       records it, and the next Run asks the links.
 *   (B) a gauge mediator: ONE end-to-end question (6006425419), never its two links apart; both leave the one-click offer.
 *   (C) a mediator measured in its sized parent's unit: asked in that unit, the estimate named (6006548763).
 * The message keeps the 400-character carrier: whole sentences are dropped from the end, never cut.
 */
export function noDeadEndAsks(
  graph: unknown,
  links: ReadonlyArray<{ from: string; to: string }>,
  labelOf: (id: string) => string,
  /** AIQ 5903604206 / 5903627210: a guessed link out of a node the user's limit watches is said, never asked. */
  guessed: (l: { from: string; to: string }) => boolean = () => false,
): { message: string; gaugeLinks: Set<string>; first: PlaceholderFirstAsk } | undefined {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || links.length === 0) return undefined;
  const nodes = graph.nodes.filter(isRec);
  const edges = graph.edges.filter(isRec);
  // Labels compact (whole sentences kept, never cut) until a sentence fits the 400-character carrier (Codex r1 P2: long
  // labels dropped the whole gauge question and left the withhold with no words).
  let budget = 120;
  const compact = (v: string): string => v.length <= budget ? v : `${v.slice(0, budget - 1).trimEnd()}\u2026`;
  const q = (id: string): string => `\u2018${compact(labelOf(id))}\u2019`;
  const fit = (sentences: readonly string[]): string => {
    let out = '';
    for (const s of sentences) { const next = out === '' ? s : `${out} ${s}`; if (next.length > 400) break; out = next; }
    return out;
  };
  const fitted = (build: () => string): string => {
    for (budget = 120; budget > 12; budget -= 12) { const s = build(); if (s.length <= 400) return s; }
    return build();
  };
  const goal = nodes.find((n) => n.kind === 'goal');
  const view = magnitudeNodes(nodes, percentLevelIds(graph));
  const goalView = typeof goal?.id === 'string' ? view.get(goal.id) : undefined;
  if (goal !== undefined && goalView !== undefined && resolveMagnitudeFrame(goalView) === undefined) {
    const unit = unitOf(goalView);
    const statementOf = (): string => unsizedLinkStatement(links.map((l) => ({ ...l, from_label: compact(labelOf(l.from)), to_label: compact(labelOf(l.to)) })));
    // Science d5 #87 6007354826: the bridge says WHY the level comes first (the link question needs the goal's unit).
    const askOf = (): string => `To size ${links.length > 1 ? 'them' : 'it'}, I first need today\u2019s level of ${q(String(goal.id))}.`
      + ` What is it${unit !== undefined ? `, in ${unit}` : ''}?`;
    // ⛔ THE ASK ALWAYS SURVIVES (Codex r1 #2635 P1): `first` names it, so the statement compacts WITH it and is dropped
    // only when even compacted it leaves no room. Long labels used to keep the statement and drop the question.
    const both = fitted(() => `${statementOf()} ${askOf()}`);
    return { message: both.length <= 400 ? both : fitted(askOf), gaugeLinks: new Set(), first: { kind: 'goal_level', node_id: String(goal.id) } };
  }
  const readings = mediatorReadings(graph);
  const unitOfNode = (id: unknown): string | undefined => { const v = view.get(id as string); return v === undefined ? undefined : unitOf(v); };
  const sentences: string[] = [];
  const covered = new Set<string>();
  const gaugeLinks = new Set<string>();
  const key = (from: unknown, to: unknown): string => `${String(from)}->${String(to)}`;
  // ⭐ D3 (DL 0df0e1, 6 Oct; Integrator 37): the FIRST thing the words ask, typed, so the panel names the same step.
  let first: PlaceholderFirstAsk | undefined;
  for (const [m, r] of readings) {
    if (r.via !== 'gauge' || r.stored === true || !links.some((l) => l.from === m || l.to === m)) continue;
    const lever = gaugeLever(edges, m, r, unitOfNode);
    if (lever === undefined || guessed({ from: lever, to: m }) || guessed({ from: m, to: r.child })) continue;
    const leverUnit = unitOfNode(lever)!;
    // ⛔ NEVER DOUBLE-COUNTED, AND NEVER ANOTHER QUANTITY (Science 6006425419; Codex r1 P2): only the lever's OTHER
    // user-sized links that lie on a goal path are "already given". One stated in the asked unit is quoted; otherwise the
    // link is named, never an unrelated figure ("2 hours per £10").
    const onGoalPath = goalPathNodes(nodes, edges);
    const given = edges.filter((e) => e.from === lever && e.to !== m && onGoalPath.has(e.to) && linkSizing(e) === 'user');
    const sameQuantity = given.map((e) => (isRec(e.provenance) && isRec(e.provenance.natural_effect) ? e.provenance.natural_effect : undefined) as Rec | undefined)
      .find((n) => n !== undefined && typeof n.amount === 'number' && typeof n.amount_unit === 'string' && typeof n.per_source_change === 'number'
        && typeof n.per_source_change_unit === 'string' && sameUnit(n.amount_unit as string, r.unit));
    const onTop = (): string => sameQuantity !== undefined
      ? `, on top of the ${sayFigure(sameQuantity.amount as number, sameQuantity.amount_unit as string)} per ${sayFigure(sameQuantity.per_source_change as number, sameQuantity.per_source_change_unit as string)} you already gave`
      : given.length > 0 ? `, on top of its effect through ${q(String(given[0]!.to))} that you already gave` : '';
    first ??= { kind: 'gauge', from: lever, through: String(m), to: String(r.child) };
    sentences.push(fitted(() => `This comparison turns on how much ${q(lever)} changes ${q(r.child)} through ${q(m)}, which nobody has set yet.`
      + ` Roughly how much would a ${oneOf(leverUnit)} rise in ${q(lever)} change ${q(r.child)} that way${onTop()}, in ${r.unit}?`
      + ' A best guess and a range is fine.'));
    for (const k of [key(lever, m), key(m, r.child)]) { covered.add(k); gaugeLinks.add(k); }
  }
  for (const l of links) {
    const r = readings.get(l.from);
    if (r?.via !== 'sized_parents' || r.child !== l.to || covered.has(key(l.from, l.to)) || guessed(l)) continue;
    const childUnit = unitOfNode(l.to);
    if (childUnit === undefined) continue;
    first ??= { kind: 'link', from: l.from, to: l.to };
    sentences.push(fitted(() => `This comparison turns on how much ${q(l.from)} changes ${q(l.to)}, which nobody has set yet.`
      + ` Olumi measures ${q(l.from)} in ${r.unit}, from its own estimate of the link from ${q(r.parents[0]!)}; correct that if it\u2019s wrong.`
      + ` Roughly how much does each ${oneOf(r.unit)} of ${q(l.from)} change ${q(l.to)}, in ${childUnit}?`));
    covered.add(key(l.from, l.to));
  }
  if (sentences.length === 0) return undefined;
  const rest = links.filter((l) => !covered.has(key(l.from, l.to)));
  if (rest.length > 0) sentences.push(unsizedLinkSentence(rest.map((l) => ({ ...l, from_label: labelOf(l.from), to_label: labelOf(l.to) }))));
  return { message: fit(sentences) || sentences[0]!, gaugeLinks, first: first! };
}

/** One of a unit, said singular ("1 week", never "1 weeks"; "£1" as `sayFigure` says it). */
function oneOf(unit: string): string {
  return sayFigure(1, unit).replace(/^1 (\p{L}+)\b/u, (_, w: string) => `1 ${w.endsWith('ies') ? `${w.slice(0, -3)}y`
    : /(?:ss|sh|ch|x|z)es$/.test(w) ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w}`);
}

/** Every node with a directed path to the goal (options and the decision aside), the goal included. */
function goalPathNodes(nodes: readonly Rec[], edges: readonly Rec[]): Set<unknown> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  const out = new Set<unknown>(goal === undefined ? [] : [goal.id]);
  const walkable = (id: unknown): boolean => { const k = byId.get(id)?.kind; return k !== undefined && k !== 'option' && k !== 'decision'; };
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (e.edge_type !== 'bidirected' && out.has(e.to) && !out.has(e.from) && walkable(e.from)) { out.add(e.from); grew = true; }
  }
  return out;
}

/** The lever a gauge mediator is asked through: the link the answer replaces (brief3), else its one parent with a unit. */
function gaugeLever(edges: readonly Rec[], m: string, r: Extract<MediatorReading, { via: 'gauge' }>, unitOfNode: (id: unknown) => string | undefined): string | undefined {
  if (r.replaces !== undefined) return r.replaces;
  const levers = [...new Set(edges.filter((e) => e.to === m && typeof e.from === 'string' && unitOfNode(e.from) !== undefined)
    .map((e) => e.from as string))];
  return levers.length === 1 ? levers[0] : undefined;
}
