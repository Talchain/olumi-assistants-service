/**
 * The Proposal & Validation Spine entrypoint (ISOLATED SPIKE, off-path).
 *
 * classifyProposal: readable+stale gate (INV-1) -> candidate construction
 *   (V5-owned seam) -> EP2 parity (INV-3) -> verdict
 *   { would_apply | held | clarify_required | stale }.
 *
 * TOTAL over its declared `unknown` graph input AND defensive against malformed
 * proposals: the whole body is wrapped, so any unexpected throw (a Proxy/getter
 * that throws, a malformed proposal) resolves to `held` (CLASSIFY_FAILED) — never
 * an exception. Fail-CLOSED: an unreadable/unhashable graph is `held`
 * (CURRENT_GRAPH_UNREADABLE), never a null-hash match.
 *
 * Outcome by kind:
 *  - rename_node -> would_apply (EP2 parity), or held/stale.
 *  - add_option -> NEVER would_apply. `held` (reason accurate to the graph:
 *    OPTION_ID_COLLISION / OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE /
 *    ADD_OPTION_APPLY_UNWIRED), or `stale` if its base_graph_hash moved (INV-1
 *    applies to every kind — a stale proposal is rejected, not applied).
 */
import { checkBaseHash } from './base-hash-gate.js';
import {
  buildRenameCandidate,
  buildAddOptionCandidate,
  graphHasNodeId,
  graphHasTopLevelOptions,
  topLevelOptionsContainsId,
} from './candidate-graph.js';
import { assessCandidate, ep2VerdictForRepresentable } from './readiness-parity.js';
import {
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  OPTION_ID_COLLISION,
  CURRENT_GRAPH_UNREADABLE,
  CLASSIFY_FAILED,
  type Proposal,
  type ClassificationResult,
} from './proposal-types.js';

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
    //        ACTUALLY true for this graph. Divergence only when a top-level options[]
    //        exists AND does not already contain the id (else applying converges).
    const built = buildAddOptionCandidate(currentPersistedGraph, proposal);
    if (!built.candidate) {
      return { verdict: 'held', kind: proposal.kind, base_hash_check, blocker: built.error };
    }
    const ep2 = assessCandidate(built.candidate);
    const diverges =
      graphHasTopLevelOptions(currentPersistedGraph) &&
      !topLevelOptionsContainsId(currentPersistedGraph, proposal.option.id);
    const blocker = diverges
      ? {
          code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
          message:
            'Applying this option would diverge canonical state: it survives as a graph node ' +
            '(analysable by run-analysis, which derives options from nodes), but the existing ' +
            'top-level options[] — preferred by the context-pack assembler — is kept base-only by ' +
            'the persist-base merge. Holding until the apply-wiring spike fixes the node <-> options[] contract.',
        }
      : {
          code: ADD_OPTION_APPLY_UNWIRED,
          message:
            'No divergence (no top-level options[], or it already contains this id), but this spike ' +
            'does not build the apply path — the canonical node <-> options[] persist contract is ' +
            'unresolved. Held pending the apply-wiring spike.',
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
    // Fail-CLOSED: any uncaught error (throwing Proxy/getter, malformed proposal)
    // resolves to a held verdict so classifyProposal is total.
    return {
      verdict: 'held',
      kind: proposal.kind,
      base_hash_check: { expected: proposal.base_graph_hash, actual: null, match: false, readable: false },
      blocker: {
        code: CLASSIFY_FAILED,
        message: 'Classification failed unexpectedly while reading the proposal or graph.',
      },
    };
  }
}
