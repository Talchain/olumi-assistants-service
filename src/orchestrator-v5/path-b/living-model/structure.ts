/**
 * THE DRAFT'S STRUCTURE FACTS (21 Oct 2026; Paul's funding-brief root cause). STRUCTURE ONLY, never meaning: whether the
 * model has a goal with a target quantity, which factors, options and risks have no path to it, and which risks the analysis
 * leaves out for want of a chance. ADVISORY (buddy, 21 Oct): facts given to the critic and the drafter, never a refusal; context
 * may rightly stay unconnected, and a missing figure is the person's to give. PURE.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import { selectCurrentAim } from './aim-selection.js';

export interface StructureGaps {
  /** No current aim carries a target, so nothing can be measured against it. */
  readonly goal_not_measurable: boolean;
  /** Factors, options and risks with no path to the goal (an option that changes nothing is the status quo, never a gap). */
  readonly unreachable: readonly string[];
  /** Risks with no chance or window: the analysis leaves them out, so the person would not see them. */
  readonly risk_without_chance: readonly string[];
}

export const hasGaps = (g: StructureGaps): boolean =>
  g.goal_not_measurable || g.unreachable.length > 0 || g.risk_without_chance.length > 0;

export function structureGaps(model: LivingModelT): StructureGaps {
  const goal = selectCurrentAim(model).aim;
  // Each edge runs from a cause to what it acts on: links, a definition's parts, a mitigation's step, an option's settings.
  const into = new Map<string, string[]>();
  const edge = (from: string, to: string) => into.set(to, [...(into.get(to) ?? []), from]);
  for (const l of model.links) edge(l.from, l.to);
  for (const item of [...model.aims, ...model.factors]) for (const part of item.defined_as?.of ?? []) edge(part, item.id);
  for (const r of model.risks) for (const m of r.mitigations) edge(m.factor_id, r.id);
  for (const o of model.options) for (const s of o.settings) edge(o.id, s.factor_id);
  const reaches = new Set<string>();
  const queue = goal === undefined ? [] : [goal.id];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const from of into.get(id) ?? []) if (!reaches.has(from)) { reaches.add(from); queue.push(from); }
  }
  const acts = (o: LivingModelT['options'][number]) => o.settings.length > 0 || model.links.some((l) => l.from === o.id);
  return {
    goal_not_measurable: goal?.target == null,
    unreachable: [...model.factors, ...model.options.filter(acts), ...model.risks].map((x) => x.id).filter((id) => !reaches.has(id)),
    risk_without_chance: model.risks
      .filter((r) => r.occurrence.low === null || r.occurrence.high === null || r.horizon_months === null).map((r) => r.id),
  };
}
