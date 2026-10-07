/** Final Run producer seam: scope the target warning after range and point licences exist. */
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../orchestrator/context/option-result-source.js';
import { targetTestabilityOf, targetNotTestableWarning, untestableTargetTail } from '../admission/target-testability.js';
import { goalChanceDisplayForAgent } from './goal-chance-licence.js';
import { goalChanceFactsForAgent } from './goal-chance-range-agent.js';
import { optionPathsOf, perOptionTargetReasons, scopedFailuresFor } from './target-testability-per-option.js';

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
  const scopedWarnings = envelope.inference_warnings.flatMap(w => {
    if (!isRec(w) || w.code !== GOAL_FIGURES_TARGET_NOT_TESTABLE || !Array.isArray(w.option_ids)) return [w];
    // W belongs to this warning, not to every scored option on the Run.
    const remaining = [...new Set(w.option_ids.filter((id): id is string => typeof id === 'string' && !shown.has(id)))];
    if (remaining.length === 0) return [];
    const { say: _say, first_ask: _ask, per_option: _perOption, ...rest } = w;
    if (verdict.kind !== 'not_testable') {
      return [{ ...rest, option_ids: remaining, say: '' }];
    }
    // Keep the original target failures; cut only links outside W's paths, using the admission walk and Run identities.
    // ⭐ S-E GOALS S6: ONE path read and ONE per-option scoping for both surfaces — the chat's `say` below and the panel's
    // `per_option` (the Run producer writes the same `per_option` from the same two functions).
    const pathsByOption = optionPathsOf(graph, remaining, evaluations);
    const perOption = perOptionTargetReasons(graph, verdict, pathsByOption, remaining);
    // Science R3: each named option needs its own failing link, reason and ask. A baseline has no moved path.
    const spoken = [...pathsByOption].flatMap(([optionId, links]) => {
      const label = labelOf(optionId);
      if (label === undefined) return [];
      const failures = scopedFailuresFor(verdict.failures, links, labelOf);
      if (!failures.some(f => f.case === 'c')) return [];
      const scopedVerdict = { ...verdict, failures };
      const say = untestableTargetTail(graph, scopedVerdict, [label]);
      if (say === null) return [];
      // Reuse the writer-compatible ask guard for the newly first link, including its units.
      const ask = targetNotTestableWarning(graph, scopedVerdict, [optionId], GOAL_FIGURES_TARGET_NOT_TESTABLE)?.first_ask;
      return [{ say, ask }];
    });
    const say = spoken.map(s => s.say).join(' ');
    const ask = spoken[0]?.ask;
    // `message` stays the Run-wide reason (the whole-run box); the per-option panel reads `per_option` by option id.
    return [{ ...rest, option_ids: remaining,
      say, ...(ask !== undefined ? { first_ask: ask } : {}),
      ...(Object.keys(perOption).length > 0 ? { per_option: perOption } : {}) }];
  });
  return { ...envelope, inference_warnings: scopedWarnings } as E;
}
