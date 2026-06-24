/**
 * The Proposal & Validation Spine entrypoint (ISOLATED SPIKE, off-path).
 *
 * classifyProposal: stale-gate (INV-1) -> candidate construction (V5-owned seam)
 *   -> EP2 parity (INV-3) -> verdict { would_apply | held | clarify_required | stale }.
 *
 * Pinned outcome: add_option is HELD-only (OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE)
 * because a new option cannot enter canonical options[] over the current D1 seam;
 * rename_node reaches would_apply. The add_option candidate is still constructed
 * and EP2-assessed for transparency, but held on the model-state check so an
 * EP2-green node-level reading can never become a false would_apply (INV-4).
 */
import { checkBaseHash } from './base-hash-gate.js';
import {
  buildRenameCandidate,
  buildAddOptionCandidate,
  optionPresentInModelState,
} from './candidate-graph.js';
import { assessCandidate, ep2VerdictForRepresentable } from './readiness-parity.js';
import {
  OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE,
  type Proposal,
  type ClassificationResult,
} from './proposal-types.js';

export function classifyProposal(
  proposal: Proposal,
  currentPersistedGraph: unknown,
): ClassificationResult {
  // 1. INV-1 stale gate — a proposal validated against H is never applied to H2.
  const base_hash_check = checkBaseHash(currentPersistedGraph, proposal.base_graph_hash);
  if (!base_hash_check.match) {
    return { verdict: 'stale', kind: proposal.kind, base_hash_check };
  }

  // 2. rename_node — representable over the seam; EP2 parity decides.
  if (proposal.kind === 'rename_node') {
    const built = buildRenameCandidate(currentPersistedGraph, proposal);
    if (!built.candidate) {
      return { verdict: 'held', kind: proposal.kind, base_hash_check, blocker: built.error };
    }
    const ep2 = assessCandidate(built.candidate);
    return {
      verdict: ep2VerdictForRepresentable(ep2),
      kind: proposal.kind,
      base_hash_check,
      candidate: built.candidate,
      ep2: ep2.result,
      ep2_state: ep2.state,
    };
  }

  // 3. add_option — HELD-only. Build the candidate to PROVE the model-state gap,
  //    run EP2 for transparency, then hold on the canonical options[] check.
  const built = buildAddOptionCandidate(currentPersistedGraph, proposal);
  if (!built.candidate) {
    return { verdict: 'held', kind: proposal.kind, base_hash_check, blocker: built.error };
  }
  const ep2 = assessCandidate(built.candidate);
  if (!optionPresentInModelState(built.candidate, proposal.option.id)) {
    return {
      verdict: 'held',
      kind: proposal.kind,
      base_hash_check,
      candidate: built.candidate,
      ep2: ep2.result,
      ep2_state: ep2.state,
      blocker: {
        code: OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE,
        message:
          'The new option exists only as a graph node; it cannot enter the canonical top-level ' +
          'options[] model-state over the current D1 seam (candidate construction and the ' +
          'persist-base merge both preserve options[] from the base). Requires a future ' +
          'persist-merge extension before add_option can be applied.',
      },
    };
  }

  // Defensive: unreachable over the current seam (a new option is never in
  // options[]). Kept so a future persist-merge extension that DOES carry the
  // new option flows through EP2 parity rather than silently holding.
  return {
    verdict: ep2VerdictForRepresentable(ep2),
    kind: proposal.kind,
    base_hash_check,
    candidate: built.candidate,
    ep2: ep2.result,
    ep2_state: ep2.state,
  };
}
