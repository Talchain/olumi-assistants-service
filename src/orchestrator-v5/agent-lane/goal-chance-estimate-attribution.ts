import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { assembleGuidanceSignals } from './turn-context/guidance-signals.js';
import { olumiEstimatesFeedingResult } from './olumi-estimates-feeding-result.js';

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
    analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
  return olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(analysed),
    goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] }).links.length;
}
