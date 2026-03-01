/**
 * Stuck Detector
 *
 * Detects when a user is "stuck" — 3 consecutive user-initiated turns
 * with no progress and no tools invoked.
 *
 * A user asking three "why" questions in a row isn't stuck — they're learning.
 * Only count turns where the user was trying to move forward but nothing changed.
 *
 * Pure function — no LLM calls, no I/O.
 */

import type {
  ConversationMessage,
  ProgressKind,
  SuggestedAction,
  StuckState,
} from "../types.js";
import { classifyUserIntent } from "./intent-classifier.js";

const STUCK_THRESHOLD = 3;

/**
 * Rescue routes offered when the user is stuck.
 */
const RESCUE_ROUTES: SuggestedAction[] = [
  {
    label: 'Calibrate top 3 uncertainties',
    prompt: 'Help me calibrate the three most uncertain assumptions in my model',
    role: 'facilitator',
  },
  {
    label: 'Add the missing causal path',
    prompt: 'What causal paths might be missing from my model?',
    role: 'facilitator',
  },
  {
    label: 'Run a quick analysis now',
    prompt: 'Run the analysis with the current model',
    role: 'challenger',
  },
];

/**
 * Detect whether the user is stuck.
 *
 * Rules:
 * - Consider the last 3 user-initiated turns (not system events)
 * - Exclude turns with intent_classification === 'explain' (learning, not stuck)
 * - All qualifying turns must have progress_kind: 'none' AND no tools invoked
 * - If fewer than 3 qualifying turns exist → not stuck
 */
export function detectStuck(
  conversationHistory: ConversationMessage[],
  progressMarkers: ProgressKind[],
): StuckState {
  // Extract user messages (not assistant responses, not system events)
  const _userMessages = conversationHistory.filter(m => m.role === 'user');

  // We need to correlate user messages with progress markers.
  // Progress markers are computed from assistant turns (which carry tool_calls).
  // For stuck detection, we pair each user turn with the subsequent assistant turn's progress.

  // Build pairs: (user_message, following_assistant_progress)
  const pairs: Array<{ message: string; progress: ProgressKind; hadTools: boolean }> = [];

  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    if (msg.role !== 'user') continue;

    // Find the next assistant message
    const nextAssistant = conversationHistory[i + 1];
    const hadTools = nextAssistant?.role === 'assistant'
      && (nextAssistant.tool_calls?.length ?? 0) > 0;

    // Find corresponding progress marker
    // progressMarkers are indexed by assistant turn order
    const assistantIndex = conversationHistory
      .slice(0, i + 2) // up to and including next assistant
      .filter(m => m.role === 'assistant').length - 1;

    const progress: ProgressKind = assistantIndex >= 0 && assistantIndex < progressMarkers.length
      ? progressMarkers[assistantIndex]
      : 'none';

    pairs.push({ message: msg.content, progress, hadTools });
  }

  // Take last N user turns, exclude explain-intent turns
  const qualifying = pairs
    .filter(p => classifyUserIntent(p.message) !== 'explain')
    .slice(-STUCK_THRESHOLD);

  if (qualifying.length < STUCK_THRESHOLD) {
    return { detected: false, rescue_routes: [] };
  }

  // Check if all qualifying turns have no progress and no tools
  const allStuck = qualifying.every(p => p.progress === 'none' && !p.hadTools);

  if (allStuck) {
    return { detected: true, rescue_routes: [...RESCUE_ROUTES] };
  }

  return { detected: false, rescue_routes: [] };
}
