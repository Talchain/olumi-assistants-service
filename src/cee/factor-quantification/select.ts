import { createHash } from 'node:crypto';
import { DeclaredScale, selectFactorQuantity, type DeclaredScaleType } from '@talchain/schemas';
import { NodeKindV3, type GraphV3T, type NodeV3T } from '../../schemas/cee-v3.js';
import type { QuantificationGap } from './types.js';
import { gateAnalysableOptions } from '../../orchestrator-v5/tools/handlers/analysable-option-gate.js';

export interface FactorInputRequirement {
  factor_id: string;
  operation: 'isl.factor_baseline_sampling' | 'cee.status_quo_hold';
  option_ids: string[];
  target_id: string;
  impact: 'unassessed';
}

export function comparisonFactorRequirements(graph: GraphV3T, options: readonly Record<string, unknown>[], targetId?: string): FactorInputRequirement[] {
  const retained = gateAnalysableOptions({ options, graph, rawPersistedGraph: graph, scaleNetEnabled: true });
  const requirements = requiredFactorInputs(graph, retained.options, targetId);
  const selected = new Set(requirements.map(requirement => requirement.factor_id));
  const excludedEmpty = new Set(retained.excluded.filter(option => option.reason === 'no_interventions').map(option => option.option_id));
  const emptyInterventions = (value: unknown): boolean => value === undefined
    || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
  const recoveryOptions = options.filter(option => {
    const id = option.option_id ?? option.id;
    if (typeof id !== 'string' || !excludedEmpty.has(id) || !emptyInterventions(option.interventions)) return false;
    const canonical = graph.nodes.find(node => node.id === id && node.kind === 'option');
    return canonical?.is_baseline === true && emptyInterventions(canonical.interventions);
  });
  const factorIds = new Set(graph.nodes.filter(node => node.kind === 'factor').map(node => node.id));
  const siblingTargets = new Set(retained.options.flatMap(option => {
    const interventions = option.interventions;
    return typeof interventions === 'object' && interventions !== null && !Array.isArray(interventions)
      ? Object.keys(interventions).filter(id => factorIds.has(id)) : [];
  }));
  const recoveryTargets = new Map(recoveryOptions.map(option => {
    const id = String(option.option_id ?? option.id);
    const ownTargets = graph.edges.filter(edge => edge.from === id && factorIds.has(edge.to)).map(edge => edge.to);
    // Mirror the gate's target choice without requiring a holdable value yet.
    // An explicit edge target never switches to the siblings' comparison basis.
    return [id, ownTargets.length > 0 ? new Set(ownTargets) : siblingTargets] as const;
  }));
  // An excluded status quo may need its current position quantified before CEE
  // can hold it. This is a recovery request, never a claim that ISL currently
  // consumes the excluded option. Use the original empty option, not generated
  // hold interventions; keep every actual retained-option requirement intact.
  for (const requirement of requiredFactorInputs(graph, recoveryOptions, targetId)) {
    if (selected.has(requirement.factor_id)) continue;
    const optionIds = requirement.option_ids.filter(id => recoveryTargets.get(id)?.has(requirement.factor_id));
    if (optionIds.length === 0) continue;
    requirements.push({ ...requirement, operation: 'cee.status_quo_hold', option_ids: optionIds });
    selected.add(requirement.factor_id);
  }
  return requirements;
}

/** Uses the caller's retained option set, never degree as a materiality test.
 * A root baseline is read only on an option's uncut path to the target; do()
 * replaces the intervened node and cuts all paths through its upstream parents.
 * Diagnostic models without a requested comparison do not acquire invented inputs.
 */
export function requiredFactorInputs(
  graph: GraphV3T,
  options: readonly Record<string, unknown>[],
  targetId: string | undefined = graph.nodes.find(n => n.kind === 'goal')?.id,
): FactorInputRequirement[] {
  if (!targetId || options.length === 0) return [];
  // PLoT's runtime NON_CAUSAL_NODE_KINDS removes option and decision nodes
  // before ISL. All other currently supported CEE kinds participate, including
  // action and goal. Derive membership from the canonical CEE enum rather than
  // treating only three familiar parent kinds as causal roots.
  const causalKinds = new Set<string>(NodeKindV3.options.filter(kind => kind !== 'option' && kind !== 'decision'));
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const parents = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!causalKinds.has(byId.get(edge.from)?.kind ?? '') || !causalKinds.has(byId.get(edge.to)?.kind ?? '')) continue;
    const incoming = parents.get(edge.to) ?? [];
    incoming.push(edge.from);
    parents.set(edge.to, incoming);
  }
  const consumedByOption = options.map(option => {
    const interventions = option.interventions as Record<string, unknown> | undefined;
    const ancestors = new Set<string>();
    const pending = [targetId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (ancestors.has(id)) continue;
      const item = interventions?.[id];
      const value = typeof item === 'number' ? item : (item as { value?: unknown } | undefined)?.value;
      // Zero is a do() too. An unreadable/nonfinite carrier never cuts a path.
      if (typeof value === 'number' && Number.isFinite(value)) continue;
      ancestors.add(id);
      pending.push(...(parents.get(id) ?? []));
    }
    return { optionId: String(option.option_id ?? option.id), ancestors };
  });
  return graph.nodes.filter(n => n.kind === 'factor'
    && !graph.edges.some(e => e.to === n.id && causalKinds.has(byId.get(e.from)?.kind ?? '')))
    .flatMap(n => {
      const optionIds = consumedByOption.filter(option => option.ancestors.has(n.id)).map(option => option.optionId);
      return optionIds.length ? [{ factor_id: n.id, operation: 'isl.factor_baseline_sampling' as const,
        option_ids: optionIds, target_id: targetId, impact: 'unassessed' as const }] : [];
    });
}

export const factorSnapshot = (graph: GraphV3T): string => createHash('sha256')
  .update(JSON.stringify(graph)).digest('hex');

export interface SelectedGap extends QuantificationGap {
  readonly snapshot: string;
  readonly node_snapshot: string;
  readonly requirement: FactorInputRequirement;
}

export interface GapSelection {
  gaps: SelectedGap[];
  eligible: SelectedGap[];
  unresolved_origin: string[];
  protected_ids: string[];
}

/** Existing frame metadata, never inferred from a value or label. */
export function knownFactorScale(node: NodeV3T): { unit?: string; cap?: number; declared_scale?: DeclaredScaleType } {
  const selected = selectFactorQuantity(node);
  const quantity = (selected.carrier === 'prior' ? node.prior : node.observed_state) as Record<string, unknown> | undefined;
  const declared = DeclaredScale.safeParse(quantity?.declared_scale);
  return {
    ...(typeof quantity?.unit === 'string' ? { unit: quantity.unit } : {}),
    ...(typeof quantity?.cap === 'number' && Number.isFinite(quantity.cap) ? { cap: quantity.cap } : {}),
    ...(declared.success ? { declared_scale: declared.data } : {}),
  };
}

export function selectQuantificationGaps(
  graph: GraphV3T,
  requirements: readonly FactorInputRequirement[],
  { limit = 8, importantIds = [] }: { limit?: number; importantIds?: readonly string[] } = {},
): GapSelection {
  const snapshot = factorSnapshot(graph);
  const eligible: SelectedGap[] = [];
  const protectedIds: string[] = [];
  const unresolvedOrigin: string[] = [];
  for (const requirement of requirements) {
    const node = graph.nodes.find(n => n.id === requirement.factor_id && n.kind === 'factor');
    if (!node) continue;
    const selection = selectFactorQuantity(node);
    if (selection.protected) {
      protectedIds.push(node.id);
      if (selection.source === null || selection.kind === 'ambiguous') unresolvedOrigin.push(node.id);
      continue;
    }
    if (!['missing', 'unknown', 'fallback'].includes(selection.kind)) continue;
    eligible.push({
      factor_id: node.id, label: node.label, snapshot, node_snapshot: JSON.stringify(node), requirement,
      reason: `Required baseline for ${requirement.operation} in ${requirement.option_ids.join(', ')}; impact unassessed.`,
      requested_by: [requirement.operation],
      unit: knownFactorScale(node).unit,
      category: node.category,
      scale: { ...knownFactorScale(node), scale_frame: node.scale_frame },
      relationships: graph.edges.filter(e => e.from === node.id || e.to === node.id),
    });
  }
  // Connectivity orders an already eligible queue. It cannot admit a factor.
  const degree = (id: string): number => graph.edges.filter(e => e.from === id || e.to === id).length;
  eligible.sort((a, b) => Number(importantIds.includes(b.factor_id)) - Number(importantIds.includes(a.factor_id))
    || degree(b.factor_id) - degree(a.factor_id) || a.factor_id.localeCompare(b.factor_id));
  return { gaps: eligible.slice(0, Math.max(0, Math.min(8, limit))), eligible,
    unresolved_origin: unresolvedOrigin, protected_ids: protectedIds };
}

export function withoutSystemQuantity(node: NodeV3T): NodeV3T {
  const next = { ...node };
  const selected = selectFactorQuantity(node);
  if (selected.protected) return next;
  // Both carriers may contain residue from the same repair. Only enter after
  // the shared authority check, so a supplied prior is never retired here.
  delete next.observed_state;
  delete next.prior;
  delete next.display_value;
  return next;
}
