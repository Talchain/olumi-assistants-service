/**
 * Track 3 — structural / tunable classifier (MECHANICAL taxonomy).
 *
 * This labels a mutation kind; it does NOT authorise apply. The D-S ruling
 * (ROADMAP §D, Paul 2026-07-12) signed off the tunable half of §6: the
 * referee's verdict table now makes ALL THREE tunable kinds (rename_node,
 * update_node_field, update_edge_field) would_apply-eligible via
 * candidate-build + R6 readiness parity, while every structural mutation
 * stays HELD (propose-confirm) and removes stay held-unconfirmed. As
 * predicted here pre-D-S, only the verdict table changed; this taxonomy is
 * stable.
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
