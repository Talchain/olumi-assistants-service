/**
 * V6 Graph Management — isolated Proposal & Validation Spine (spike barrel).
 * OFF-PATH: no live V5 code imports this module.
 */
export * from './proposal-types.js';
export { checkBaseHash, isStale, currentAnalysisHash, isGraphLike } from './base-hash-gate.js';
export {
  buildRenameCandidate,
  buildAddOptionCandidate,
  graphHasNodeId,
  graphHasTopLevelOptions,
  type CandidateBuildResult,
} from './candidate-graph.js';
export { assessCandidate, ep2VerdictForRepresentable, type Ep2Assessment } from './readiness-parity.js';
export { classifyProposal } from './classify-proposal.js';
