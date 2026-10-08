/** Science goals §(r)(b), FIX-1: derive participation from the CURRENT admitted graph. Pure; never stamps a node. */
import type { CandidateModel } from './admit-model.js';
import { canonicalLabel } from './model-primitives.js';
import { linkSizing } from '../../cee/magnitude/link-sizing.js';

/**
 * Conservative limit veto: any shared metric word protects the risk. We need not prove that the risk IS the limit;
 * ambiguity keeps it in. All declared constraints protect, even when their stated provenance is uncertain.
 * `metric` is accepted for callers with one; the draft risk schema gains no field.
 */
export function riskMatchesLimit(
  risk: { readonly label: string; readonly metric?: string },
  constraints: readonly { readonly metric: string }[],
): boolean {
  const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const names = [risk.label, ...(typeof risk.metric === 'string' ? [risk.metric] : [])];
  const namedWords = new Set(names.flatMap(words));
  return constraints.some(c => {
    const metric = canonicalLabel(c.metric);
    return metric === '' || names.some(name => canonicalLabel(name) === metric)
      || words(c.metric).some(word => namedWords.has(word));
  });
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

// Function words do not establish that the user named a concern. Any shared four-letter content stem DOES:
// deliberately fail closed on a possible match, including singular/plural and inflected labels.
const FUNCTION_WORDS = new Set(`about above after again against also although among another around because before being
  below between both could does doing down during each either else even ever every from further have having here hers
  herself himself into itself just more most much must neither next once only other ours ourselves over same shall
  should since some such than that their theirs them themselves then there these they this those though through thus
  under until upon very were what when where which while whom whose will with within without would your yours yourself
  yourselves`.split(/\s+/));
const contentStems = (text: string): Set<string> => new Set((text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [])
  .filter(word => !FUNCTION_WORDS.has(word)).map(word => word.slice(0, 4)));

/** Existing durable participation remains authoritative for its producer family. */
export function isRetainedExcluded(node: unknown): boolean {
  return rec(node)?.analysis_participation === 'retained_excluded';
}

/**
 * ONE current-graph predicate for Olumi-added unitless risks. A missing brief, unknown authorship, deliberate include,
 * user-named concern, user likelihood, precondition, limit, intervention, definition or any FINAL sized link keeps it in.
 * Node units and draft-time size tags cannot attest the final admitted link's sizing.
 */
export function unitlessOlumiRiskKeptOut(node: unknown, graph: unknown, brief?: string): boolean {
  const n = rec(node), g = rec(graph);
  if (n?.kind !== 'risk' || n.provenance !== 'ai_inferred' || n.analysis_participation === 'included'
    || typeof n.id !== 'string' || n.id.trim() === '' || typeof n.label !== 'string' || n.label.trim() === ''
    || typeof brief !== 'string' || brief.trim() === '' || n.relies_on !== undefined
    || rec(rec(n.event_risk)?.occurrence)?.basis === 'user' || !Array.isArray(g?.nodes) || !Array.isArray(g.edges)) return false;
  const named = contentStems(n.label), stated = contentStems(brief);
  if (named.size === 0 || stated.size === 0 || [...named].some(stem => stated.has(stem))) return false;

  const nodes = g.nodes.map(rec).filter((v): v is Rec => v !== undefined);
  const edges = g.edges.map(rec).filter((v): v is Rec => v !== undefined);
  const byId = new Map(nodes.filter(v => v.kind === 'goal' || !isRetainedExcluded(v)).map(v => [v.id, v]));
  const goals = nodes.filter(v => v.kind === 'goal' && typeof v.id === 'string');
  // An ambiguous goal cannot attest which chance omits the risk.
  if (goals.length !== 1) return false;
  const constraints = [...(Array.isArray(g.goal_constraints) ? g.goal_constraints : []),
    ...(Array.isArray(g.constraints) ? g.constraints : [])].map(rec).filter((v): v is Rec => v !== undefined);
  if (constraints.some(c => {
    if (c.node_id === n.id) return true;
    const metrics = [c.metric, c.label, byId.get(c.node_id)?.label]
      .filter((v): v is string => typeof v === 'string');
    return riskMatchesLimit({ label: n.label as string,
      ...(typeof n.metric === 'string' ? { metric: n.metric } : {}) },
    (metrics.length === 0 ? [''] : metrics).map(metric => ({ metric })));
  })) return false;
  const options = [...nodes.filter(v => v.kind === 'option'),
    ...(Array.isArray(g.options) ? g.options.map(rec).filter((v): v is Rec => v !== undefined) : [])];
  if (options.some(o => {
    const interventions = rec(o.interventions);
    return interventions !== undefined && Object.hasOwn(interventions, n.id as string);
  })) return false;

  // Reverse reach marks only causal paths into the goal. A dead-end link cannot veto or license an omission.
  const toGoal = new Set<unknown>([goals[0]!.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      const from = byId.get(e.from), to = byId.get(e.to);
      if (e.edge_type === 'bidirected' || from === undefined || to === undefined || from.kind === 'option' || from.kind === 'decision'
        || to.kind === 'option' || to.kind === 'decision') continue;
      if (toGoal.has(e.to) && !toGoal.has(e.from)) { toGoal.add(e.from); grew = true; }
    }
  }
  if (!toGoal.has(n.id)) return false;
  const incident = edges.filter(e => e.edge_type !== 'bidirected' && byId.has(e.from) && byId.has(e.to)
    && ((e.from === n.id && toGoal.has(e.to)) || (e.to === n.id && byId.get(e.from)?.kind !== 'decision')));
  return incident.length > 0 && incident.every(e => linkSizing(e) === 'placeholder'
    // holdsByDefinition requires the definitional tag too. Any such tag vetoes conservatively, even if stale.
    && e.definitional !== true && rec(e.provenance)?.definitional !== true);
}

/** The ONE participation decision used by every graph-as-analysed reader. Durable exclusions keep their old meaning. */
export function isExcludedFromAnalysis(node: unknown, graph: unknown, brief?: string): boolean {
  return isRetainedExcluded(node) || unitlessOlumiRiskKeptOut(node, graph, brief);
}

/** @deprecated Unitless-risk participation is derived after final admission and on every Run, never stamped. */
export function excludeAddedUnitlessRisks<M extends CandidateModel>(model: M, _brief?: string): { model: M; excluded: string[] } {
  return { model, excluded: [] };
}

export function sayUnitlessRiskExcluded(label: string): string {
  return `Olumi added ‘${label}’ as a risk but can't size it in your goal's units yet, so it's shown as a risk to weigh and kept out of the chance.`;
}
