/**
 * M1-NOW (programme-docs `output/reasoning-coach/CODEX-M1-NOW-BRIEF.md` @28cbdc2b; DL ruling 5933929583): the ONE link a
 * "Strengthen" press opens a card for, with no model call. RC-STRENGTHEN-ITEM variant S1 only: a link nobody sized,
 * on a goal path of an option the CURRENT Run analysed.
 *
 * - The candidates are F1b's own rule (`placeholderGoalPaths`), over the options the caller passes. A link that lies only
 *   on an excluded or un-analysed option's path is never offered, and an identity operand this Run evaluated is exempt.
 * - Pick order is the reasoning-coach contract's: nearest the goal (fewest links from the link's target to the goal),
 *   then link id `from->to` (`tools/select_ref.py` `strengthen_candidates`).
 * - Never S1: a user-sized, accepted (`olumi_accepted`) or ordinary `olumi_estimate` link: `placeholderGoalPaths` walks
 *   only links `linkSizing` calls `placeholder` (the one predicate, `isPlaceholderLink`).
 * - `band` and both labels come from `linkTargetOf` (below): the writer's own band rule. A link with no readable mean is
 *   skipped (the writer refuses it).
 * - No leader dependency: it reads no analysis, so it answers the same while leader naming is withheld.
 *
 * It returns a target only. It builds no proposal, writes nothing and authors no copy: AI HARNESS turns the target into
 * ONE `propose_link_strengths` call (one link, this band, no `from_words`). Null → the press keeps today's answer.
 */
import { edgeBandFromMagnitude } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { placeholderGoalPaths } from '../goal-certainty.js';

export interface LinkTarget {
  readonly from_id: string;
  readonly to_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly band: InfluenceBand;
}
export interface StrengthenPlaceholderTarget extends LinkTarget {
  readonly variant: 'S1';
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * ONE link's card target: both labels and the band the writer compares against, `edgeBandFromMagnitude(|strength.mean|)`
 * (as `propose_link_strengths` computes `currentBand`). Null when the link, either label or a readable mean is missing:
 * the writer would refuse it. Any link, whatever its sizing: the S1 picker below and T3's method-turn card both read a
 * link through here, so there is one read of the mean and one band rule (SCIENCE/DSK 5938284906).
 */
export function linkTargetOf(graph: unknown, from_id: string, to_id: string): LinkTarget | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const edge = graph.edges.filter(isRec).find((e) => e.from === from_id && e.to === to_id);
  const mean = isRec(edge?.strength) ? edge!.strength.mean : undefined;
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return null;
  const nodes = graph.nodes.filter(isRec);
  const from = nodes.find((n) => n.id === from_id);
  const to = nodes.find((n) => n.id === to_id);
  if (typeof from?.label !== 'string' || typeof to?.label !== 'string') return null;
  return { from_id, to_id, from_label: from.label, to_label: to.label, band: edgeBandFromMagnitude(Math.abs(mean)) };
}

export function selectStrengthenPlaceholder(
  graph: unknown,
  currentRunOptionIds: readonly string[],
  identityEvaluations?: ReadonlyArray<unknown>,
  scoredInterventions?: ReadonlyMap<string, Record<string, unknown>>,
): StrengthenPlaceholderTarget | null {
  const paths = placeholderGoalPaths(graph, currentRunOptionIds, identityEvaluations, scoredInterventions);
  if (paths.length === 0 || !isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const nodes = graph.nodes.filter(isRec);
  const edges = graph.edges.filter(isRec);
  const goal = nodes.find((n) => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return null;

  // Goal distance by reverse BFS over every link, as the guidance signals compute `goal_distance` (#2465).
  const into = new Map<unknown, unknown[]>();
  for (const e of edges) into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  const distance = new Map<unknown, number>([[goal.id, 0]]);
  for (const queue: unknown[] = [goal.id]; queue.length > 0;) {
    const at = queue.shift();
    for (const from of into.get(at) ?? []) {
      if (!distance.has(from)) { distance.set(from, distance.get(at)! + 1); queue.push(from); }
    }
  }

  const seen = new Set<string>();
  const candidates = paths.flatMap((p) => p.links).filter((l) => !seen.has(`${l.from}->${l.to}`) && seen.add(`${l.from}->${l.to}`))
    .map((l) => ({ ...l, id: `${l.from}->${l.to}`, distance: distance.get(l.to) ?? 99 }))
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const c of candidates) {
    const target = linkTargetOf(graph, c.from, c.to);
    if (target !== null) return { variant: 'S1', ...target };
  }
  return null;
}
