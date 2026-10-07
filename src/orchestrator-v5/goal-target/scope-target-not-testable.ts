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
    const { say: _say, first_ask: _ask, ...rest } = w;
    if (verdict.kind !== 'not_testable') {
      return [{ ...rest, option_ids: remaining, say: '' }];
    }
    // Keep the original target failures; cut only links outside W's paths, using the admission walk and Run identities.
    const { paths } = reachedGoalPaths(analysed, remaining, new Map(remaining.map(id => {
      const option = nodes.find(n => n.kind === 'option' && n.id === id);
      return [id, isRec(option?.interventions) ? Object.keys(option.interventions) : []];
    })), evaluations);
    // Science R3: each named option needs its own failing link, reason and ask. A baseline has no moved path.
    const spoken = paths.flatMap(path => {
      const label = labelOf(path.option_id);
      if (label === undefined) return [];
      const onPath = new Set(path.links.map(l => JSON.stringify([l.from, l.to])));
      const failures = verdict.failures.flatMap(f => {
        if (f.case !== 'c') return [f];
        const links = (f.links ?? (f.link === undefined ? [] : [f.link])).filter(l => onPath.has(JSON.stringify([l.from, l.to])));
        if (links.length === 0) return [];
        const link = links[0]!;
        return [{ ...f, links, link, lever: labelOf(link.from), link_to: labelOf(link.to) }];
      });
      if (!failures.some(f => f.case === 'c')) return [];
      const scopedVerdict = { ...verdict, failures };
      const say = untestableTargetTail(graph, scopedVerdict, [label]);
      if (say === null) return [];
      // Reuse the writer-compatible ask guard for the newly first link, including its units.
      const ask = targetNotTestableWarning(graph, scopedVerdict, [path.option_id], GOAL_FIGURES_TARGET_NOT_TESTABLE)?.first_ask;
      return [{ say, ask }];
    });
    const say = spoken.map(s => s.say).join(' ');
    const ask = spoken[0]?.ask;
    // The per-option panel owns the producer's original message; only the spoken tail is scoped here.
    return [{ ...rest, option_ids: remaining,
      say, ...(ask !== undefined ? { first_ask: ask } : {}) }];
  });
  return { ...envelope, inference_warnings: scopedWarnings } as E;
}
