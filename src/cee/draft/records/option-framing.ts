/**
 * Final-records guard for a decision sentence misclassified as an option.
 * Run after completion selection and before the adapter publishes its graph.
 * Records are evidence and remain unchanged; this corrects their projection.
 */
import type { DraftRecordSet } from './grammar.js';
import type {
  ProjectedEdge,
  ProjectedNode,
  RecordProjection,
  RecordProvenance,
} from './projector.js';
import { boundNodeLabel } from './label-bound.js';
import { canonicalText, sha8 } from './projector.js';

const canonical = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/**
 * Whole-utterance decision framing only. This is deliberately not the label
 * author's refusal predicate: "we could hold prices" and "hire a researcher
 * to figure out demand" are actions, even though that author refuses them.
 * Nor does punctuation alone invalidate an action with a question in its name.
 */
export function isWholeOptionDecisionFraming(text: string): boolean {
  const source = canonical(text);
  return /^(?:should|do)\s+(?:we|i)\s+\S/iu.test(source)
    || /^(?:(?:we|i)\s+(?:(?:need|want|have)\s+to\s+|must\s+|(?:are|am)\s+)?|(?:we're|i'm)\s+)?(?:decide|deciding)\s+(?:whether(?:\s+to)?|between)\b/iu.test(source)
    || /^(?:the\s+)?(?:decision|question)\s+is\s+whether\b/iu.test(source)
    || /^whether\s+to\s+\S/iu.test(source);
}

export interface ResolvedOptionFraming {
  readonly option_id: string;
  readonly label: string;
  readonly source_quote: string;
  readonly claim_index: number;
}

export interface UnresolvedOptionFraming {
  readonly reason: 'decision_framing_not_an_option';
  readonly node_id: string;
  readonly label: string;
  /** Retained for the caller's disclosure/evidence; never an analysis option. */
  readonly original_node: ProjectedNode;
  readonly incident_edges: readonly ProjectedEdge[];
}

export interface DraftOptionFramingResult {
  readonly projection: RecordProjection;
  readonly resolved: readonly ResolvedOptionFraming[];
  readonly unresolved: readonly UnresolvedOptionFraming[];
}

/**
 * Recover only an actual, unique merged refinement that owns a quantified
 * option effect. The raw record supplies its wording; the projector's merge
 * receipt proves the binding. An is_baseline flag cannot supply a name.
 */
function recoverableRefinement(
  records: DraftRecordSet,
  projection: RecordProjection,
  node: ProjectedNode,
  provenance: RecordProvenance,
  sourceQuote: string,
): { label: string; claimIndex: number } | undefined {
  const statedIndices = records.stated_items.flatMap((item, index) =>
    item.kind === 'option' && canonical(item.source_quote) === canonical(sourceQuote) ? [index] : [],
  );
  if (statedIndices.length !== 1) return undefined;
  const parentIndex = statedIndices[0]!;
  const candidates = records.claims.flatMap((claim, index) => {
    if (claim.claim_kind !== 'option_refinement') return [];
    const namedOptions = [...new Set((claim.basis ?? []).filter(
      (basis) => records.stated_items[basis]?.kind === 'option',
    ))];
    return namedOptions.length === 1 && namedOptions[0] === parentIndex
      ? [{ claim, index }] : [];
  });
  // Competing sub-alternatives do not become a label-selection contest.
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0]!;
  const label = canonical(candidate.claim.label);
  if (!label || isWholeOptionDecisionFraming(label)) return undefined;
  const receipt = provenance.merged_refinements ?? [];
  if (receipt.length !== 1 || canonical(receipt[0]!) !== label) return undefined;
  if (typeof candidate.claim.is_baseline === 'boolean'
    && typeof node.is_baseline === 'boolean'
    && candidate.claim.is_baseline !== node.is_baseline) return undefined;
  const interventions = node.data?.interventions;
  const raw = node.data?.raw_interventions;
  if (typeof interventions !== 'object' || interventions === null
    || typeof raw !== 'object' || raw === null
    || Object.keys(interventions).length === 0) return undefined;

  // A refinement's mere mention of a number is not proof that the projector
  // carried it. Match every magnitude to a unique surviving factor and the
  // actual content-addressed edge, then to the selected raw intervention.
  // Ambiguous/dropped targets or extra parent effects make recovery unsafe.
  const effects = records.claims.filter((claim) => claim.claim_kind === 'causal_link'
    && claim.from_claim === candidate.index && claim.from_stated === undefined
    && typeof claim.sets_to === 'number' && Number.isFinite(claim.sets_to));
  const covered = new Set<string>();
  for (const effect of effects) {
    if ((effect.to_claim === undefined) === (effect.to_stated === undefined)) return undefined;
    let targets: ProjectedNode[];
    if (effect.to_claim !== undefined) {
      const targetClaim = records.claims[effect.to_claim];
      if (targetClaim?.claim_kind !== 'factor') return undefined;
      const targetLabel = canonicalText(targetClaim.label);
      if (records.claims.filter((claim) => claim.claim_kind === 'factor'
        && canonicalText(claim.label) === targetLabel).length !== 1) return undefined;
      targets = projection.graph.nodes.filter((target) => target.kind === 'factor'
        && target.label === boundNodeLabel(targetLabel)
        && (projection.provenance[target.id] ?? target.provenance)?.provenance_class === 'ai_inferred');
    } else {
      const targetItem = records.stated_items[effect.to_stated!];
      if (!targetItem) return undefined;
      const quote = canonicalText(targetItem.source_quote);
      if (records.stated_items.filter((item) => canonicalText(item.source_quote) === quote).length !== 1) return undefined;
      targets = projection.graph.nodes.filter((target) => target.kind === 'factor'
        && (projection.provenance[target.id] ?? target.provenance)?.source_quote === quote);
    }
    if (targets.length !== 1) return undefined;
    const target = targets[0]!;
    const edgeId = sha8('edge', canonicalText(effect.label), node.id, target.id);
    if (!projection.graph.edges.some((edge) => edge.id === edgeId
      && edge.from === node.id && edge.to === target.id)) return undefined;
    if ((raw as Record<string, unknown>)[target.id] !== effect.sets_to
      || typeof (interventions as Record<string, unknown>)[target.id] !== 'number'
      || !Number.isFinite((interventions as Record<string, number>)[target.id])) return undefined;
    covered.add(target.id);
  }
  if (covered.size === 0 || Object.keys(interventions).length !== covered.size
    || Object.keys(raw).length !== covered.size) return undefined;
  return { label: boundNodeLabel(label), claimIndex: candidate.index };
}

/**
 * Pure and idempotent. Unrelated nodes/edges and every numerical field are
 * preserved. Unresolved framing is quarantined, not renamed or reclassified
 * as an invented alternative. The caller decides whether the remainder is
 * usable, and carries the returned gap through the established notice path.
 */
export function reconcileDraftOptionFraming(
  records: DraftRecordSet,
  projection: RecordProjection,
): DraftOptionFramingResult {
  const resolved: ResolvedOptionFraming[] = [];
  const unresolved: UnresolvedOptionFraming[] = [];
  const removedIds = new Set<string>();
  const replacements = new Map<string, ProjectedNode>();
  const provenance: Record<string, RecordProvenance> = { ...projection.provenance };

  for (const node of projection.graph.nodes) {
    const prov = projection.provenance[node.id] ?? node.provenance;
    if (node.kind !== 'option') continue;
    // Question-labelled AI options are invalid too. Retaining an original
    // question as evidence does not invalidate an already corrected AI label.
    const framingText = isWholeOptionDecisionFraming(node.label) ? node.label
      : prov?.provenance_class === 'stated' && typeof prov.source_quote === 'string'
        && isWholeOptionDecisionFraming(prov.source_quote) ? prov.source_quote : undefined;
    if (framingText === undefined) continue;
    const candidate = prov?.provenance_class === 'stated' && typeof prov.source_quote === 'string'
      ? recoverableRefinement(records, projection, node, prov, prov.source_quote) : undefined;
    if (candidate) {
      const repairedProvenance: RecordProvenance = {
        ...prov!,
        provenance_class: 'ai_inferred',
        label_authored: true,
      };
      replacements.set(node.id, { ...node, label: candidate.label, provenance: repairedProvenance });
      provenance[node.id] = repairedProvenance;
      resolved.push({ option_id: node.id, label: candidate.label, source_quote: prov!.source_quote!, claim_index: candidate.claimIndex });
    } else {
      removedIds.add(node.id);
      unresolved.push({
        reason: 'decision_framing_not_an_option', node_id: node.id,
        label: framingText, original_node: structuredClone(node),
        incident_edges: structuredClone(projection.graph.edges.filter(
          (edge) => edge.from === node.id || edge.to === node.id,
        )),
      });
    }
  }
  if (resolved.length === 0 && unresolved.length === 0) return { projection, resolved, unresolved };

  const nodes = projection.graph.nodes.filter((node) => !removedIds.has(node.id))
    .map((node) => replacements.get(node.id) ?? node);
  const edges = projection.graph.edges.filter((edge) => {
    if (!removedIds.has(edge.from) && !removedIds.has(edge.to)) return true;
    delete provenance[edge.id];
    return false;
  });
  for (const id of removedIds) delete provenance[id];
  const hasIncoming = new Set(edges.map((edge) => edge.to));
  const hasOutgoing = new Set(edges.map((edge) => edge.from));
  return {
    projection: {
      ...projection,
      graph: {
        ...projection.graph, nodes, edges,
        meta: removedIds.size === 0 ? projection.graph.meta : {
          ...projection.graph.meta,
          roots: nodes.filter((node) => !hasIncoming.has(node.id)).map((node) => node.id),
          leaves: nodes.filter((node) => !hasOutgoing.has(node.id)).map((node) => node.id),
        },
      },
      provenance,
    },
    resolved,
    unresolved,
  };
}
