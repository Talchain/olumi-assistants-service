/**
 * ⭐ WHY NO OPTION CAN REACH THE GOAL (Science goals §(k) FINAL, 8 Oct; DL lease + 3 conditions; PRINCIPLE-AUDIT item 1).
 *
 * P02 C3 (23b1495c): the journey ended on "less than 1%" for every option with no why. When EVERY licensed option shows
 * the "less than 1%" floor (licensed `pct_by_option` 0, points only, never with a withhold), Olumi says why in the
 * model's own terms and asks the one question. Deterministic, from the licence record and the stored graph only:
 *   · the goal is a confirmed product rate × volume (`stated_in_brief: true`); the options set ONLY the rate operand;
 *   · W-why only when EVERY route from the rate to the volume has a drafted sign ≤ 0 (placeholders by their drafted sign,
 *     and said) and the ceiling (largest licensed option rate × the volume's level) is under the target: a bound, exact
 *     under the model's own signs, needing no growth or horizon assumption;
 *   · W-lever only for a factor IN the graph with a growing route to the volume that no option sets (DL condition 1);
 *   · W-ask names only the volume ("What could grow ‘Pro subscribers’ in this decision?"), never an invented lever;
 *   · Olumi's level is marked where it is read (§(m), DL condition 2).
 * The contract (COPY-SHAPE, workstream A) places it: `visible` on the face, `ask` as the one next step (Suggest options),
 * `detail` under More detail. Null when anything above does not hold. Pure.
 */
import { goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { readMoney } from './same-unit.js';
import { sayFigure } from './say-figure.js';
import { goalLevelWords, symbolOf } from './goal-level-in-goal-units.js';
import { readingTermsOf } from './identity-proposal.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const label = (n: Rec): string => (typeof n.label === 'string' && n.label.trim() !== '' ? n.label.trim() : String(n.id));

export interface OutOfReachWhy {
  /** The face: the short why + the ask, or the ask alone (Science §(k) OK, 8 Oct). */
  readonly visible: string;
  /** The one next step's words (button: Suggest options). */
  readonly ask: string;
  /** More detail: the full why and the lever, when they hold. */
  readonly detail: readonly string[];
}

/** Every licensed option below the floor: points only, none withheld, ≥2 options. */
function allBelowFloor(result: unknown): string[] | null {
  const licence = goalChanceLicenceForAgent(result);
  if (licence === undefined || licence.form !== 'each' || (licence.withheld_option_ids?.length ?? 0) > 0) return null;
  const records = isRec(result) ? [isRec(result.enrichment) ? result.enrichment.inference_warnings : undefined, result.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).filter((w): w is Rec => isRec(w) && w.code === 'GOAL_CHANCE_LICENSED') : [];
  const pct = records.length === 1 && isRec(records[0]!.pct_by_option) ? records[0]!.pct_by_option : undefined;
  if (pct === undefined || licence.option_ids.length < 2 || !licence.option_ids.every((id) => pct[id] === 0)) return null;
  return licence.option_ids;
}

export function outOfReachWhyOf(result: unknown, graph: unknown): OutOfReachWhy | null {
  const optionIds = allBelowFloor(result);
  if (optionIds === null || !isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const nodes = graph.nodes.filter(isRec);
  const edges = graph.edges.filter(isRec);
  const byId = new Map(nodes.flatMap((n) => (typeof n.id === 'string' ? [[n.id, n] as const] : [])));
  const goals = nodes.filter((n) => n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const ni = goal.nonlinear_identity;
  if (!isRec(ni) || ni.operation !== 'product' || ni.stated_in_brief !== true || !Array.isArray(ni.factor_ids) || ni.factor_ids.length !== 2) return null;
  const operands = ni.factor_ids.filter((x): x is string => typeof x === 'string');
  // The options set ONLY one operand (the rate); the other is the volume.
  const options = optionIds.map((id) => byId.get(id));
  if (options.some((o) => o === undefined)) return null;
  const set = new Set(options.flatMap((o) => (isRec(o!.interventions) ? Object.keys(o!.interventions) : [])));
  if (set.size !== 1) return null;
  const rateId = [...set][0]!;
  if (!operands.includes(rateId)) return null;
  const volumeId = operands.find((id) => id !== rateId);
  const volume = volumeId === undefined ? undefined : byId.get(volumeId);
  const rate = byId.get(rateId);
  if (volume === undefined || rate === undefined) return null;
  const volumeName = label(volume);
  const ask = `What could grow ‘${volumeName}’ in this decision?`;
  const detail: string[] = [];

  // W-lever: a factor in the graph, set by no option, with a growing route to the volume (DL condition 1).
  const goalId = goal.id;
  const sign = (e: Rec): number => {
    const m = isRec(e.strength) && finite(e.strength.mean) ? e.strength.mean : undefined;
    return m !== undefined && m !== 0 ? Math.sign(m) : e.effect_direction === 'negative' ? -1 : e.effect_direction === 'positive' ? 1 : 0;
  };
  const out = (id: string) => edges.filter((e) => e.from === id && typeof e.to === 'string' && e.to !== goalId && e.edge_type !== 'bidirected');
  /** Every simple route from `start` to the volume (bounded), as edge lists. */
  const routes = (start: string): Rec[][] => {
    const found: Rec[][] = [];
    const walk = (at: string, path: Rec[], seen: Set<string>) => {
      if (found.length > 64 || path.length > 8) return;
      for (const e of out(at)) {
        const to = e.to as string;
        if (to === volumeId) { found.push([...path, e]); continue; }
        if (seen.has(to) || byId.get(to)?.kind === 'option') continue;
        walk(to, [...path, e], new Set([...seen, to]));
      }
    };
    walk(start, [], new Set([start]));
    return found;
  };
  const routeSign = (r: Rec[]): number => r.reduce((s, e) => s * sign(e), 1);
  const levers = nodes.filter((n) => n.kind === 'factor' && typeof n.id === 'string' && n.id !== rateId && n.id !== volumeId
    && !set.has(n.id) && routes(n.id).some((r) => routeSign(r) > 0));
  const lever = levers.length === 1 ? `‘${label(levers[0]!)}’ would grow ‘${volumeName}’, but no option changes it.` : undefined;

  // W-why: every route from the rate to the volume lowers it, and the ceiling is under the target.
  const rateRoutes = routes(rateId);
  const target = goal.goal_threshold_raw;
  const level = isRec(volume.observed_state) ? volume.observed_state.raw_value : undefined;
  const money = readMoney(goal.goal_threshold_unit, label(goal));
  // An option that sets nothing (the status quo) leaves the rate at today's level.
  const today = isRec(rate.observed_state) ? rate.observed_state.raw_value : undefined;
  const prices = options.map((o) => (isRec(o!.interventions) && isRec(o!.interventions[rateId]) ? o!.interventions[rateId].raw_value
    : !isRec(o!.interventions) || Object.keys(o!.interventions).length === 0 ? today : undefined));
  const why = (() => {
    if (rateRoutes.length === 0 || !rateRoutes.every((r) => routeSign(r) < 0)) return undefined;
    // A "less"/"plus" term of the reading (§(i), #2835) moves the goal outside rate × volume: the product is no ceiling.
    if (readingTermsOf(graph).length > 0) return undefined;
    if (goal.goal_direction !== '>=' || !finite(target) || !finite(level) || level <= 0 || money === null || money.period === null) return undefined;
    if (!prices.every(finite)) return undefined;
    const max = Math.max(...(prices as number[]));
    const ceiling = max * level;
    if (!(ceiling < target)) return undefined;
    const symbol = symbolOf(money.code);
    const amount = (n: number) => `${symbol}${sayFigure(n, '')}`;
    const volumeUnit = isRec(volume.observed_state) && typeof volume.observed_state.unit === 'string' ? volume.observed_state.unit.trim() : '';
    const olumis = classifyValueSource(isRec(volume.observed_state) ? volume.observed_state.source : undefined) !== 'user_stated';
    const via = [...new Set(rateRoutes.map((r) => r[r.length - 1]!.from as string).filter((id) => id !== rateId))].map((id) => `‘${label(byId.get(id)!)}’`);
    const unsized = rateRoutes.flat().filter((e) => isRec(e.provenance) && e.provenance.magnitude === 'olumi_placeholder');
    const ceilingWords = goalLevelWords(ceiling, goal);
    const lost = volumeUnit === '' ? 'nothing lost' : `no ${volumeUnit} lost`;
    return {
      full: `In this model, the options only change ‘${label(rate)}’, and every route from it to ‘${volumeName}’ lowers it`
        + (via.length > 0 ? `, through ${via.join(' and ')}` : '')
        + (unsized.length === 1 ? ' (one of these links has no size yet)' : unsized.length > 1 ? ` (${unsized.length} of these links have no size yet)` : '')
        + `. So even at ${amount(max)} with ${lost}, ${label(goal)} would be ${amount(max)} × ${sayFigure(level, '')}`
        + (olumis ? ` (Olumi's starting figure for ‘${volumeName}’)` : '') + ` = ${ceilingWords}, short of your ${amount(target)}.`,
      face: `No option can reach your ${amount(target)} in this model: even at ${amount(max)} with ${lost}, ${label(goal)} would be ${ceilingWords}`
        + (olumis ? ` (with Olumi's ${sayFigure(level, volumeUnit)})` : '') + '.',
    };
  })();
  if (why !== undefined) detail.push(why.full);
  if (lever !== undefined) detail.push(lever);
  return { visible: why === undefined ? ask : `${why.face} ${ask}`, ask, detail };
}
