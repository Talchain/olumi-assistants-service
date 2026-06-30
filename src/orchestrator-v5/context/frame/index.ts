/**
 * V6 Context Management — frame public surface (Increment 1, types only).
 *
 * Re-exports the typed `CanonicalContextFrame` contract and the default-held
 * claim-permission table. No runtime wiring; nothing exported here is imported
 * by an active call site yet. The frame BUILDER and any consumer migration are
 * later, separately-reviewed increments (state map §6).
 */

export {
  CANONICAL_CONTEXT_FRAME_VERSION,
} from './types.js';

export type {
  CanonicalContextFrame,
  CanonicalContextFrameVersion,
  CanonicalStateSource,
  BuildFrame,
  BuildFrameInput,
  FrameModel,
  FrameGraphCounts,
  FrameFreshness,
  FrameFreshnessVerdict,
  FrameFreshnessReason,
  FrameAnalysis,
  FrameAnalysisStatus,
  FrameChange,
  FrameChanges,
  FrameChangeAction,
  FrameConversation,
  FrameIntent,
  FrameEvidence,
  FrameActions,
  FrameCommittedRef,
  FrameProposedRef,
  FrameRejectedRef,
  FramePendingRef,
  FrameUiTargets,
  FrameDiagnostics,
} from './types.js';

export { DEFAULT_CLAIM_PERMISSIONS } from './claim-permissions.js';

export type {
  ClaimPermissionState,
  HeldScienceClaimClass,
  ClaimPermissionTable,
} from './claim-permissions.js';
