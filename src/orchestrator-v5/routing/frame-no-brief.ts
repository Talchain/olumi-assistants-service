import type { OlumiResponse } from '@talchain/schemas/boundary';

/**
 * Frame-stage no-brief guard COPY (ROADMAP 2.63 C3 / 2.388).
 *
 * EXTRACTED, not written (S6 Step 0, 2026-08-25). Every string and every
 * envelope field below was lifted VERBATIM out of the `isFrameNoBriefShape`
 * block in `src/orchestrator/route-v2.ts`, which is a 6,000-line hot file
 * three lanes routinely touch at once. Nothing here is new: this commit is a
 * pure move, so the "no behaviour change" claim is reviewable on its own.
 *
 * WHY THE MOVE. The literal is USER-FACING LANGUAGE living inside ROUTING
 * CONTROL FLOW, so a language owner and a runtime owner both have a
 * legitimate reason to edit the same if-block. Mirrors
 * `composeProcessMetaIntakeResponse` in `process-meta-intake.ts`, which is
 * the same shape for the same reason.
 *
 * ⚠ THE COPY IS ALSO A HISTORIC RECORD ELSEWHERE (trap 14b). The exact
 * sentence below appears in
 * `src/orchestrator-v5/compose/__tests__/fixtures/live-assistant-text-corpus-2026-08-17/`
 * as a capture of what the product ACTUALLY EMITTED on a dated build. That
 * corpus is append-only evidence: if this copy is ever reworded, the fixture
 * must NOT be rewritten to match.
 */

/**
 * The guard's base copy — the canned framing prompt, byte-identical to the
 * literal it replaces. The C3 draft-offer sentence is appended by the caller
 * (it is conditional on the offer standing alone after the commit), so it is
 * deliberately NOT part of this string.
 */
export const FRAME_NO_BRIEF_ASSISTANT_TEXT =
  'I need a single decision question to start. ' +
  'For example: “Should we hire a tech lead or two developers?” or ' +
  '“Whether to launch in Q3 or hold for Q4?” ' +
  "Include the options you're comparing.";

/**
 * The guard's response envelope.
 *
 * Stays in frame stage so the UI remains on the graph-creation path;
 * `suggested_actions` / `insights` intentionally empty (no analysis to
 * surface pre-graph). Does NOT echo the user's input (no PII leak risk).
 *
 * Returns a FRESH object on every call: the caller spreads it to build the
 * chip-bearing variant, and a shared mutable singleton would let one turn's
 * `suggested_actions` leak into the next.
 */
export function composeFrameNoBriefResponse(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: FRAME_NO_BRIEF_ASSISTANT_TEXT,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}
