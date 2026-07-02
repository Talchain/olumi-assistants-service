/**
 * V6 Context Management — frame public surface.
 *
 * Re-exports the typed `CanonicalContextFrame` contract (Increment 1), the
 * default-held claim-permission table, the pure `buildFrame` projection
 * (Increment 2), and the single recent-changes shape projection (T4 Slice 2).
 *
 * LIVE as of T4 Slice 2: the turn-executor builds the frame once per turn at
 * its finalise seam and threads it to the route, whose flag-gated
 * context-summary diagnostic is the first frame consumer
 * (`../context-summary-from-frame.ts`). The frame itself never reaches the
 * wire; consumers read projections of it.
 */

export {
  CANONICAL_CONTEXT_FRAME_VERSION,
} from './types.js';

export { buildFrame } from './build-frame.js';

export { projectRecentChangesToFrame } from './project-recent-changes.js';

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
