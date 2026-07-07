/**
 * Track 3 — Graph Management Core (isolated typed-mutation referee).
 * OFF-PATH: no live V5 code imports this module (proven by isolation-guards.test.ts).
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
