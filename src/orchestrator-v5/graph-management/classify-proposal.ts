/**
 * The Proposal & Validation Spine entrypoint (ISOLATED SPIKE, off-path).
 *
 * classifyProposal: readable-graph guard -> stale-gate (INV-1) -> candidate
 *   construction (V5-owned seam) -> EP2 parity (INV-3) -> verdict
 *   { would_apply | held | clarify_required | stale }.
 *
 * Total over its declared `unknown` graph input: an unreadable graph returns a
 * typed `held` rather than throwing.
 *
 * Outcome by kind:
 *  - rename_node -> would_apply (EP2 parity), or held/stale.
 *  - add_option -> ALWAYS held. A new option survives as a node and is analysable
 *    by run-analysis, but applying it diverges the top-level options[] (preferred
 *    by the context-pack assembler) from the node-derived set. The candidate is
 *    still built and EP2-assessed for transparency; the verdict never escapes
 *    `held` (id collisions held distinctly).
 */
import { checkBaseHash, isGraphLike } from './base-hash-gate.js';
import {
  buildRenameCandidate,
  buildAddOptionCandidate,
  graphHasNodeId,
} from './candidate-graph.js';
import { assessCandidate, ep2VerdictForRepresentable } from './readiness-parity.js';
import {
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  OPTION_ID_COLLISION,
  CURRENT_GRAPH_UNREADABLE,
  type Proposal,
  type ClassificationResult,
} from './proposal-types.js';

export function classifyProposal(
  proposal: Proposal,
  currentPersistedGraph: unknown,
): ClassificationResult {
  // 0. Totality guard — never throw on the declared `unknown` input.
  if (!isGraphLike(currentPersistedGraph)) {
    return {
      verdict: 'held',
      kind: proposal.kind,
      base_hash_check: { expected: proposal.base_graph_hash, actual: null, match: false },
      blocker: {
        code: CURRENT_GRAPH_UNREADABLE,
        message: 'The current graph could not be read (expected an object with a nodes array).',
      },
    };
  }

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

  // 3. add_option — ALWAYS held in this spike.
  //    (a) id collision: the structural validator does not dedupe node ids, so a
  //        reused id would otherwise yield a duplicate node and could even fall
  //        through to would_apply. Reject it up front.
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
  //    (b) genuine new option: build + EP2-assess for transparency, then hold on
  //        the top-level options[] divergence. The verdict NEVER reaches
  //        would_apply (an EP2-green node-level reading does not override the
  //        divergence — that is the point).
  const built = buildAddOptionCandidate(currentPersistedGraph, proposal);
  if (!built.candidate) {
    return { verdict: 'held', kind: proposal.kind, base_hash_check, blocker: built.error };
  }
  const ep2 = assessCandidate(built.candidate);
  return {
    verdict: 'held',
    kind: proposal.kind,
    base_hash_check,
    candidate: built.candidate,
    ep2: ep2.result,
    ep2_state: ep2.state,
    blocker: {
      code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
      message:
        'Applying this option would diverge canonical state: it survives as a graph node ' +
        '(analysable by run-analysis, which derives options from nodes), but the top-level ' +
        'options[] — preferred by the context-pack assembler — is kept base-only by the ' +
        'persist-base merge. Holding until the apply-wiring spike fixes the node <-> options[] contract.',
    },
  };
}
