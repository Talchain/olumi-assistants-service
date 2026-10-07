/** Final Run producer seam: scope the target warning after range and point licences exist. */
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../orchestrator/context/option-result-source.js';
import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { reachedGoalPaths, targetTestabilityOf, targetNotTestableWarning, untestableTargetTail } from '../admission/target-testability.js';
import { goalChanceDisplayForAgent } from './goal-chance-licence.js';
import { goalChanceFactsForAgent } from './goal-chance-range-agent.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The same Agent display entitlement decides R. No shown range means the original Run is untouched. */
export function scopeTargetNotTestableWithRanges<E>(envelope: E, graph: unknown): E {
  if (!isRec(envelope) || !Array.isArray(envelope.inference_warnings)) return envelope;
  const facts = goalChanceFactsForAgent(envelope, graph, true);
  const ranged = Object.keys(facts.goal_chance_range_display ?? {});
  if (ranged.length === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return envelope;
  const shown = new Set([...ranged, ...Object.keys(goalChanceDisplayForAgent(envelope) ?? {})]);
  const nodes = graph.nodes.filter(isRec);
  const labelOf = (id: string): string | undefined => {
    const node = nodes.find(n => n.id === id);
    return typeof node?.label === 'string' && node.label.trim() !== '' ? node.label.trim() : undefined;
  };
  const evaluations = Array.isArray(envelope.identity_evaluations) ? envelope.identity_evaluations : undefined;
  const verdict = targetTestabilityOf(graph, evaluations);
  const analysed = asAnalysed({ ...graph, nodes: graph.nodes });
  const scopedWarnings = envelope.inference_warnings.flatMap(w => {
    if (!isRec(w) || w.code !== GOAL_FIGURES_TARGET_NOT_TESTABLE || !Array.isArray(w.option_ids)) return [w];
    // W belongs to this warning, not to every scored option on the Run.
    const remaining = [...new Set(w.option_ids.filter((id): id is string => typeof id === 'string' && !shown.has(id)))];
    if (remaining.length === 0) return [];
    const labels = remaining.map(labelOf);
    const { say: _say, message: _message, first_ask: _ask, ...rest } = w;
    if (verdict.kind !== 'not_testable' || labels.some(label => label === undefined)) {
      return [{ ...rest, option_ids: remaining, message: 'Not shown.' }];
    }
    // Keep the original target failures; cut only links outside W's paths, using the admission walk and Run identities.
    const { paths } = reachedGoalPaths(analysed, remaining, new Map(remaining.map(id => {
      const option = nodes.find(n => n.kind === 'option' && n.id === id);
      return [id, isRec(option?.interventions) ? Object.keys(option.interventions) : []];
    })), evaluations);
    const onPath = new Set(paths.flatMap(p => p.links.map(l => JSON.stringify([l.from, l.to]))));
    const failures = verdict.failures.flatMap(f => {
      if (f.case !== 'c' || f.links === undefined) return [f];
      const links = f.links.filter(l => onPath.has(JSON.stringify([l.from, l.to])));
      if (links.length === 0) return [];
      const link = links[0]!;
      return [{ ...f, links, link, lever: labelOf(link.from), link_to: labelOf(link.to) }];
    });
    const scopedVerdict = { ...verdict, failures };
    const say = untestableTargetTail(graph, scopedVerdict, labels as string[]);
    // Reuse the writer-compatible ask guard for the newly first link, including its units.
    const ask = targetNotTestableWarning(graph, scopedVerdict, remaining, GOAL_FIGURES_TARGET_NOT_TESTABLE)?.first_ask;
    return [{ ...rest, option_ids: remaining, message: say === null ? 'Not shown.' : `Not shown. ${say}`,
      ...(say !== null ? { say } : {}), ...(ask !== undefined ? { first_ask: ask } : {}) }];
  });
  return { ...envelope, inference_warnings: scopedWarnings } as E;
}
