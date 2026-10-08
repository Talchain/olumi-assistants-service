import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { EventRiskV1, readOlumiEventRiskBasisText } from '../../schemas/event-risk.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { assembleGuidanceSignals, guidanceModelReadable } from './turn-context/guidance-signals.js';
import { olumiEstimatesFeedingResult, type LikelihoodEstimate } from './olumi-estimates-feeding-result.js';
import { eventRiskCardLine } from './stated-event-risk-draft.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** RC4 alone supplies the attribution stored with this Run's licensed points. */
export function goalChanceEstimateLinkCount(graph: unknown, optionIds?: readonly string[], goalId?: unknown): number {
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return 0;
  const omitted = new Set(stored.nodes.map(rec).filter(n => n?.kind === 'option'
    && optionIds !== undefined && !optionIds.includes(String(n.id))).map(n => n!.id));
  const nodes = stored.nodes.filter(n => !omitted.has(rec(n)?.id));
  // The shared signal reader uses the first goal; place this Run's scored goal there.
  if (typeof goalId === 'string') nodes.sort((a, b) => Number(rec(b)?.id === goalId) - Number(rec(a)?.id === goalId));
  const analysed = asAnalysed({ ...stored, nodes,
    edges: Array.isArray(stored.edges) ? stored.edges.filter(e => !omitted.has(rec(e)?.from) && !omitted.has(rec(e)?.to)) : stored.edges });
  const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph: analysed,
    goalPathEventRootIds: goalChanceEstimateLikelihoods(analysed, goalId).map(l => l.id),
    analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
  return olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(analysed),
    goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] }).links.length;
}

/**
 * Event occurrence is its own estimate kind, never a relationship. Independent root events still feed every option's
 * result when their impact reaches the scored goal. Their roots also extend RC4's existing relationship path census.
 * Use the same analysed graph, so a kept-out risk or impact does not earn an attribution on this Run.
 */
export function goalChanceEstimateLikelihoodCount(graph: unknown, goalId?: unknown): number {
  const likelihoods = goalChanceEstimateLikelihoods(graph, goalId);
  return likelihoods.length === 0 ? 0 : olumiEstimatesFeedingResult({ goalPathFactors: [], goalPathLinks: [],
    goalPathLikelihoods: likelihoods }).likelihoods?.length ?? 0;
}

/** The same occurrence items also explain the Check estimates action the chance line names. */
export function goalChanceEstimateLikelihoods(graph: unknown, goalId?: unknown): LikelihoodEstimate[] {
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return [];
  const analysed = asAnalysed({ ...stored, nodes: stored.nodes, edges: stored.edges });
  if (!guidanceModelReadable(analysed)) return [];
  const nodes = analysed.nodes.map(rec).filter((n): n is Rec => n !== undefined);
  const goal = typeof goalId === 'string' ? nodes.find(n => n.id === goalId && n.kind === 'goal')
    : nodes.find(n => n.kind === 'goal');
  if (goal === undefined) return [];
  const edges = (Array.isArray(analysed.edges) ? analysed.edges : []).map(rec).filter((e): e is Rec => e !== undefined);
  const incoming = new Map<unknown, unknown[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.to) ?? [];
    sources.push(edge.from);
    incoming.set(edge.to, sources);
  }
  const reachesGoal = new Set<unknown>([goal.id]);
  const queue = [goal.id];
  for (let at = 0; at < queue.length; at += 1) {
    for (const source of incoming.get(queue[at]) ?? []) {
      if (reachesGoal.has(source)) continue;
      reachesGoal.add(source);
      queue.push(source);
    }
  }
  return nodes.flatMap(n => {
    if (n.kind !== 'risk' || !reachesGoal.has(n.id)) return [];
    const parsed = EventRiskV1.safeParse(n.event_risk);
    if (!parsed.success || parsed.data.occurrence.basis !== 'olumi') return [];
    const basisText = readOlumiEventRiskBasisText(n);
    if (basisText === undefined) return [];
    // v1 allows declared prevention by root factors; an undeclared driver/cause cannot carry an occurrence.
    const preventers = new Set(parsed.data.mitigations?.map(m => m.factor_id) ?? []);
    if ((incoming.get(n.id) ?? []).some(from => !preventers.has(String(from))
      || nodes.find(source => source.id === from)?.kind !== 'factor'
      || (incoming.get(from) ?? []).some(parent => {
        const kind = nodes.find(source => source.id === parent)?.kind;
        return kind !== 'option' && kind !== 'decision';
      }))) return [];
    return [{ id: String(n.id), label: typeof n.label === 'string' ? n.label : String(n.id),
      words: eventRiskCardLine(parsed.data, basisText) }];
  });
}
