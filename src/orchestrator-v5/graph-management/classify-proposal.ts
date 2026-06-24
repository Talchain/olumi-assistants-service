/**
 * The Proposal & Validation Spine entrypoint (ISOLATED SPIKE, off-path).
 *
 * classifyProposal: readable+stale gate (INV-1) -> candidate construction
 *   (V5-owned seam) -> EP2 parity (INV-3) -> verdict
 *   { would_apply | held | clarify_required | stale }.
 *
 * TOTAL: the ENTIRE body is wrapped, and the catch reads fallback metadata through
 * a guarded helper, so ANY input — a throwing Proxy/getter on the proposal OR the
 * graph, a malformed or null/undefined proposal — resolves to `held`
 * (CLASSIFY_FAILED) and never throws. Fail-CLOSED: an unreadable/unhashable graph
 * is `held` (CURRENT_GRAPH_UNREADABLE), never a null-hash match.
 *
 * Outcome by kind:
 *  - rename_node -> would_apply (EP2 parity), or held/stale.
 *  - add_option -> NEVER would_apply. `held` (OPTION_ID_COLLISION; or
 *    OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE when a top-level options[] ARRAY exists —
 *    the merge keeps it base-only while the new option enters the node-derived set,
 *    so the two views can diverge; else ADD_OPTION_APPLY_UNWIRED), or `stale` if its
 *    base_graph_hash moved (INV-1 applies to every kind). The held reason does NOT
 *    infer content-convergence from id equality.
 */
import { checkBaseHash } from './base-hash-gate.js';
import {
  buildRenameCandidate,
  buildAddOptionCandidate,
  graphHasNodeId,
  graphHasTopLevelOptions,
} from './candidate-graph.js';
import { assessCandidate, ep2VerdictForRepresentable } from './readiness-parity.js';
import {
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  OPTION_ID_COLLISION,
  CURRENT_GRAPH_UNREADABLE,
  CLASSIFY_FAILED,
  type Proposal,
  type ProposalKind,
  type ClassificationResult,
} from './proposal-types.js';

/**
 * Fail-closed result. Reads `kind`/`base_graph_hash` defensively (its own
 * try/catch) so it never throws — even when the proposal is a Proxy / throwing
 * getter. Keeps best-effort metadata when safely readable, hard fallbacks otherwise.
 */
function failClosed(proposal: Proposal): ClassificationResult {
  let kind: ProposalKind = 'rename_node';
  let expected: string | null = null;
  try {
    const k = (proposal as { kind?: unknown } | null | undefined)?.kind;
    if (k === 'add_option' || k === 'rename_node') kind = k;
    const h = (proposal as { base_graph_hash?: unknown } | null | undefined)?.base_graph_hash;
    if (typeof h === 'string' || h === null) expected = h;
  } catch {
    /* proposal unreadable (throwing getter / Proxy); keep hard fallbacks */
  }
  return {
    verdict: 'held',
    kind,
    base_hash_check: { expected, actual: null, match: false, readable: false },
    blocker: {
      code: CLASSIFY_FAILED,
      message: 'Classification failed unexpectedly while reading the proposal or graph.',
    },
  };
}

export function classifyProposal(
  proposal: Proposal,
  currentPersistedGraph: unknown,
): ClassificationResult {
  try {
    // 1. INV-1 stale gate (readable-aware). Unreadable/unhashable -> held, never a
    //    null-hash match. Stale (readable but mismatch) applies to EVERY kind.
    const base_hash_check = checkBaseHash(currentPersistedGraph, proposal.base_graph_hash);
    if (!base_hash_check.readable) {
      return {
        verdict: 'held',
        kind: proposal.kind,
        base_hash_check,
        blocker: {
          code: CURRENT_GRAPH_UNREADABLE,
          message: 'The current graph could not be read or hashed (not graph-like, or an unhashable analysis value).',
        },
      };
    }
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

    // 3. add_option — NEVER would_apply.
    //    (a) id collision: the structural validator does not dedupe node ids.
    if (graphHasNodeId(currentPersistedGraph, proposal.option.id)) {
      return {
        verdict: 'held',
        kind: proposal.kind,
        base_hash_check,
        blocker: {
          code: OPTION_ID_COLLISION,
          message: `An entity with id "${proposal.option.id}" already exists in the graph; add_option cannot reuse it.`,
        },
      };
    }
    //    (b) build + EP2-assess for transparency, then hold with the reason that is
    //        true for this graph. Divergence iff a top-level options[] ARRAY is
    //        present (the merge keeps it base-only; an id match does NOT prove
    //        content convergence, so we never claim convergence).
    const built = buildAddOptionCandidate(currentPersistedGraph, proposal);
    if (!built.candidate) {
      return { verdict: 'held', kind: proposal.kind, base_hash_check, blocker: built.error };
    }
    const ep2 = assessCandidate(built.candidate);
    const blocker = graphHasTopLevelOptions(currentPersistedGraph)
      ? {
          code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
          message:
            'A top-level options[] array is present and the persist-base merge keeps it base-only, ' +
            'while the new option enters the node-derived set run-analysis reads — so the two views ' +
            'can diverge (an id match does not prove their content converges). Holding until the ' +
            'apply-wiring spike fixes the node <-> options[] contract.',
        }
      : {
          code: ADD_OPTION_APPLY_UNWIRED,
          message:
            'No top-level options[] array is present; held because this spike does not build the ' +
            'apply path (the canonical node <-> options[] persist contract is unresolved). Pending ' +
            'the apply-wiring spike.',
        };
    return {
      verdict: 'held',
      kind: proposal.kind,
      base_hash_check,
      candidate: built.candidate,
      ep2: ep2.result,
      ep2_state: ep2.state,
      blocker,
    };
  } catch {
    // Fail-CLOSED: any uncaught error resolves to a held verdict via the guarded
    // helper (which itself never throws, even on a throwing-getter proposal).
    return failClosed(proposal);
  }
}
