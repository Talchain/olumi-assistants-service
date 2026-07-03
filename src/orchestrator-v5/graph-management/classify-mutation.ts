/**
 * Track 3 — structural / tunable classifier (MECHANICAL taxonomy).
 *
 * This labels a mutation kind; it does NOT authorise apply. §6 (structural-vs-
 * tunable doctrine) is PENDING, so the classifier's OUTPUT never un-holds anything
 * — the referee's verdict table keeps every structural mutation and every tunable
 * value-edit HELD (Paul, 2026-07-03: no broad tunable auto-apply). The only
 * `would_apply`-eligible kind is `rename_node` (a label-only, analysis-hash-neutral
 * tunable — T4.0 §1 invariant). When §6 lands, only the verdict table changes; this
 * taxonomy is stable.
 *
 * Floor taxonomy (T4.0 R4 allowlist posture + slice4 packet §4 §6 floor):
 *  - tunable      = node label/metadata + value fields, edge strength/probability
 *                   (rename_node, update_node_field, update_edge_field);
 *  - structural   = node/edge add/remove, option identity
 *                   (add_node, add_edge, add_option, remove_node, remove_edge);
 *  - non_mutating = flag_uncertainty, clarification.
 */
import type { CandidateKind, MutationClass } from './types.js';

export function classifyMutation(kind: CandidateKind): MutationClass {
  switch (kind) {
    case 'rename_node':
    case 'update_node_field':
    case 'update_edge_field':
      return 'tunable';
    case 'add_node':
    case 'add_edge':
    case 'add_option':
    case 'remove_node':
    case 'remove_edge':
      return 'structural';
    case 'flag_uncertainty':
    case 'clarification':
      return 'non_mutating';
    default: {
      // Exhaustiveness: an unmapped kind is a compile error, not a silent gap.
      const _never: never = kind;
      return _never;
    }
  }
}
