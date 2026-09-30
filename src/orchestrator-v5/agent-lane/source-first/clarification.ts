import type { SourceFirstCompilation } from './compiler.js';
import type { SourceMeaning } from './meaning.js';
import { bindSource } from './source-binding.js';

// These compiler codes name unresolved meaning or missing evidence. All other
// codes remain diagnostics, including parser, storage and representation gaps.
const priorities = {
  definition_current_values_disagree: 0,
  multiple_current_values: 0,
  multiple_targets: 0,
  incompatible_quantity_units: 0,
  definition_unit_mismatch: 0,
  metric_scope_split: 0,
  entity_unit_scope_unverified: 0,
  limit_comparator_missing: 0,
  stated_unknown: 1,
  causal_size_unresolved: 2,
  change_needs_current_level: 2,
  relative_goal_metric_unbound: 2,
} as const;
type UserQuestionCode = keyof typeof priorities;
const currentRequests = (label: string): string[] => [
  `What is the current ${label}?`, `What is current ${label}?`,
  `What is the current value of ${label}?`, `What is ${label} today?`,
];
const normalise = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** Select one ask without modifying the graph, unresolved findings or loss. */
export function selectSourceFirstClarification(
  brief: string, meaning: SourceMeaning, compiled: SourceFirstCompilation,
): string[] {
  const allRefs = [...meaning.entities, ...meaning.quantities, ...(meaning.evidence_ranges ?? []),
    ...meaning.definitions, ...meaning.causal_claims, ...meaning.unknowns, ...meaning.proposals].map((item) => item.ref);
  const unique = (ref: string): boolean => allRefs.filter((item) => item === ref).length === 1;
  const validEntity = (ref: string): boolean => unique(ref) && Boolean(compiled.source_bindings[ref])
    && compiled.graph.nodes.some((node) => node.id === compiled.reference_ids[ref]);
  const currentSupplied = (ref: string): boolean => {
    const node = compiled.graph.nodes.find((item) => item.id === compiled.reference_ids[ref]);
    return typeof node?.observed_state?.raw_value === 'number' && meaning.quantities.some((claim) =>
      claim.entity_ref === ref && claim.role === 'current' && compiled.source_bindings[claim.ref]
      && Number(claim.number.value) === node.observed_state!.raw_value);
  };
  const refsFor = (ref: string): string[] => {
    if (meaning.entities.some((entity) => entity.ref === ref)) return [ref];
    const quantity = meaning.quantities.find((claim) => claim.ref === ref);
    if (quantity) return [quantity.entity_ref];
    const definition = meaning.definitions.find((claim) => claim.ref === ref);
    if (definition) return [definition.target_ref, ...definition.operand_refs];
    const cause = meaning.causal_claims.find((claim) => claim.ref === ref);
    return cause ? [cause.from_ref, cause.to_ref] : [];
  };
  const candidates = compiled.unresolved.flatMap((finding, order) => {
    if (!Object.hasOwn(priorities, finding.code) || !unique(finding.ref)) return [];
    const code = finding.code as UserQuestionCode;
    let refs = refsFor(finding.ref);
    if (code === 'stated_unknown') {
      const unknown = meaning.unknowns.find((item) => item.ref === finding.ref);
      if (!unknown || (unknown.source && !bindSource(brief, unknown.source).ok)) return [];
      refs = unknown.entity_refs;
      // Unknowns have no typed requested role. Suppress only exact direct
      // requests for a supplied entity level; preserve ambiguous scope/effect
      // wording rather than interpreting it as an answered numeric question.
      if (refs.length === 1 && currentSupplied(refs[0])) {
        const entity = meaning.entities.find((item) => item.ref === refs[0]);
        if (entity && currentRequests(entity.label).some((question) => normalise(question) === normalise(finding.question))) return [];
      }
    } else if (code === 'change_needs_current_level' || code === 'relative_goal_metric_unbound') {
      if (refs.length === 1 && currentSupplied(refs[0])) return [];
    }
    if (!refs.length || !refs.every(validEntity) || !finding.question.trim()) return [];
    return [{ question: finding.question, priority: priorities[code], order }];
  });
  candidates.sort((left, right) => left.priority - right.priority || left.order - right.order);
  return candidates.length ? [candidates[0].question] : [];
}
