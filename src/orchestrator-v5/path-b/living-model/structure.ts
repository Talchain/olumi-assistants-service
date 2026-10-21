/**
 * THE DRAFT'S STRUCTURE CHECK (21 Oct 2026; Paul's funding-brief root cause). STRUCTURE ONLY, never meaning: whether the
 * model has a measurable goal, whether every factor, option and risk can reach it, and whether a risk would be hidden from
 * the analysis for want of a chance. A first model with these gaps cannot be analysed and hides what the person said, so the
 * AI repairs them once before it is saved (`draft-tool.ts`), with anything it adds labelled as Olumi's, or asks. PURE.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';

export interface StructureGaps {
  /** No current aim carries a target, so nothing can be measured against it. */
  readonly goal_not_measurable: boolean;
  /** Factors, options and risks with no path to the goal (an option that changes nothing is the status quo, never a gap). */
  readonly unreachable: readonly string[];
  /** Risks with no chance or window: the analysis leaves them out, so the person would not see them. */
  readonly risk_without_chance: readonly string[];
}

/** The gaps the AI can repair itself. A risk's missing chance is the person's to give: asked for, never filled under their name. */
export const needsRepair = (g: StructureGaps): boolean => g.goal_not_measurable || g.unreachable.length > 0;
export const hasGaps = (g: StructureGaps): boolean => needsRepair(g) || g.risk_without_chance.length > 0;

/** What the AI is told when its first draft has gaps it can repair (the refusal's detail). Nothing is saved. */
export const STRUCTURE_REPAIR = 'Nothing was saved: this model cannot be analysed as drafted (see gaps). Repair it once, then call '
  + 'build_model_from_brief again with the complete model. goal_not_measurable: add a measurable aim of Olumi\'s own (source olumi, '
  + 'its own id, status current) with the quantity, unit and horizon that the person\'s aim depends on, its figure null when nobody '
  + 'gave one; keep the person\'s own aim as they said it, and never add a target under their words. unreachable: add the link by '
  + 'which each item acts on the goal, with Olumi\'s provisional direction where nobody stated one; if you cannot say how an item '
  + 'acts on the goal, keep it and ask about it. risk_without_chance: never give a figure under the person\'s name; ask for it. '
  + 'If a gap cannot be repaired, call again unchanged and say plainly what is missing.';

export function structureGaps(model: LivingModelT): StructureGaps {
  const current = model.aims.filter((a) => a.status === 'current');
  const goal = current.find((a) => a.target !== null) ?? current[0];
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
