/**
 * V6 Context Management — frame public surface.
 *
 * Re-exports the typed `CanonicalContextFrame` contract (Increment 1), the
 * default-held claim-permission table, and the pure `buildFrame` projection
 * (Increment 2). Still INERT: nothing exported here is imported by an active
 * call site yet — `buildFrame` has zero callers (no wiring, no flag). Consumer
 * migration (the redacted diagnostic-summary projection, then Cap-1) is a
 * later, separately-reviewed increment (state map §6).
 */

export {
  CANONICAL_CONTEXT_FRAME_VERSION,
} from './types.js';

export { buildFrame } from './build-frame.js';

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
  ProjectRecentChangesToFrame,
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
