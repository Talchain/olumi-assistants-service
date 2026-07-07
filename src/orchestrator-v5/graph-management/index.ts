/**
 * Track 3 — Graph Management Core (typed-mutation referee).
 *
 * LIVE-WIRED (lane 8, 2026-07-07): the edit_graph dispatch seam
 * (src/orchestrator-v5/handlers/edit-graph-dispatch.ts) consumes this module
 * behind the env-enforced CEE_GRAPH_MANAGEMENT_MODE flag (off | shadow |
 * live, default off; prod auto-downgrades live → shadow). The module itself
 * remains import-isolated (isolation-guards.test.ts): it never imports
 * commit / turn-executor / persistence / hash-derivation — the referee still
 * only CONSUMES the frame and NEVER applies or persists a mutation.
 */
export * from './reason-codes.js';
export {
  CANDIDATE_KINDS,
  PROPOSAL_CAP,
  MUTATION_VERDICTS,
  CandidateMutationEnvelopeV1,
  type CandidateKind,
  type CandidateMutationEnvelope,
  type MutationVerdict,
  type MutationClass,
  type MutationBlocker,
  type MutationFrame,
  type FrameFreshness,
  type RefereeVerdict,
} from './types.js';
export { parseEnvelope, type ParseEnvelopeResult } from './parse-envelope.js';
export { evaluateFrameGate, type FrameGateResult, type FrameGateOutcome } from './frame-gate.js';
export { classifyMutation } from './classify-mutation.js';
export { checkFieldSafety, type FieldSafetyResult } from './field-safety.js';
export {
  buildRenameCandidate,
  buildAddOptionCandidate,
  graphHasNodeId,
  graphHasTopLevelOptions,
  graphOptionsAreMalformed,
  type CandidateBuildResult,
} from './candidate-graph.js';
export {
  assessCandidate,
  ep2Rank,
  readinessDowngraded,
  representableVerdict,
  type Ep2Assessment,
} from './readiness-parity.js';
export { refereeMutation, refereeMutationBatch } from './referee.js';
export {
  projectHeldToPendingAction,
  appliedLedgerOf,
  idempotencyBlocker,
  type HeldMutationPendingAction,
  type AppliedLedger,
} from './pending-projection.js';
export {
  mutationTelemetryEvent,
  type MutationTelemetryEvent,
  type MutationTelemetryContext,
} from './telemetry.js';
export { graphHasEdge } from './candidate-graph.js';
export {
  mapProposalType,
  dualDraftToCandidateEnvelope,
  DUAL_DRAFT_PROPOSAL_TYPES,
  type DualDraftProposal,
  type DualDraftProposalType,
  type AdapterContext,
} from './adapters/dual-draft.js';
export {
  contextFrameToMutationFrame,
  narrowFrameFreshness,
} from './adapters/context-frame.js';
export {
  editOperationsToCandidateEnvelopes,
  parseEdgeTargetPath,
  type EditPatchOperationLike,
  type EditProducerContext,
} from './adapters/edit-graph-producer.js';
export {
  mutationTargetKey,
  supersedesHeldCandidate,
  collapseSupersededHeld,
} from './pending-projection.js';
