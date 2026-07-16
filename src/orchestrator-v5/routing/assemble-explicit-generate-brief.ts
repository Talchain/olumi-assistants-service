/**
 * ROADMAP 2.63 C2 — server-side brief assembly for explicit-generate turns.
 *
 * When a turn arrives with the `generate_model` / `explicit_generate` wire
 * flag set (the stage-2 "Generate model" button / confirm-chip intent), the
 * message on the wire is frequently NOT the decision brief: confirm chips
 * replay their own canned label text ("Yes, build the model now please"),
 * and the accumulated brief lives server-side (persisted
 * `scenarios.brief_text`, or an earlier user turn in the conversation
 * chain). The V4 draft pipeline requires a ≥ DRAFT_GRAPH_MIN_BRIEF_LENGTH
 * brief (Zod min on DraftGraphInput), so dispatching the canned text
 * verbatim would either fail validation or draft a model about the canned
 * phrase itself — the "chip click's canned text becomes the brief"
 * content-loss defect in the 2.63 diagnosis.
 *
 * This pure helper picks the best available brief, in deterministic
 * priority order:
 *
 *   1. `message`         — the turn's own message when it IS brief-shaped
 *                          (≥ min length AND matches the canonical decision
 *                          -brief regex). Covers the Generate button sending
 *                          the composer brief, and the fixed UI (U2) sending
 *                          the accumulated brief on confirm clicks.
 *   2. `pending_seed`    — the brief candidate captured on a `draft_graph`
 *                          pending action at OFFER time (ROADMAP 2.63 C3/C4:
 *                          the frame-guard "Build the model" offer and the
 *                          graph-present "Redraft the model" offer). When the
 *                          user consents to the offer, they consent to
 *                          drafting from what they had just shared — the
 *                          seed — so it outranks the older stored sources.
 *                          Absent (null) on non-resume calls.
 *   3. `persisted_brief` — `scenarios.brief_text` (first-write-wins column,
 *                          seeded by earlier draft attempts or the
 *                          turn-executor's derive-brief-seed commit leg).
 *   4. `recent_turn`     — the most recent prior USER message in the
 *                          conversation chain that is brief-shaped (same
 *                          length + regex gate as 1). Assistant messages
 *                          are never considered.
 *   5. `message_unshaped`— the turn's own message when it meets the length
 *                          floor but fails the shape regex, ONLY for
 *                          non-chip sources. An explicit generate is a
 *                          direct instruction, so a typed ≥ min-length
 *                          message the regex cannot classify still drafts
 *                          (C1: the flag bypasses the brief-keyword regex).
 *                          `chip_click` is excluded because a chip's canned
 *                          confirm text can exceed the length floor while
 *                          carrying zero decision content — for chips, the
 *                          brief must come from 1–3 or the caller declines.
 *
 * Returns `null` when nothing usable exists — the caller must then send the
 * deterministic honest decline (never a silent conversational fall-through).
 *
 * Pure and total: no I/O, never throws. The caller supplies the persisted
 * brief and recent turns (route-v2 owns the session-store reads; the
 * draft dispatcher itself is forbidden from readRecent by the freshness
 * invariant pinned in route-v2-draft-graph-persistence.test.ts).
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import {
  DRAFT_GRAPH_DECISION_BRIEF_REGEX,
  DRAFT_GRAPH_MAX_BRIEF_LENGTH,
  DRAFT_GRAPH_MIN_BRIEF_LENGTH,
} from '../../schemas/assist.js';
import { normaliseBriefText } from '../session/normalise-brief-text.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';

export type ExplicitGenerateBriefSource =
  | 'message'
  | 'pending_seed'
  | 'persisted_brief'
  | 'recent_turn'
  | 'message_unshaped';

export interface AssembledExplicitGenerateBrief {
  /** The brief to draft from — trimmed, capped at DRAFT_GRAPH_MAX_BRIEF_LENGTH. */
  readonly brief: string;
  /** Which source won — surfaced on v5.explicit_generate_received telemetry. */
  readonly source: ExplicitGenerateBriefSource;
}

export interface AssembleExplicitGenerateBriefInput {
  /** The turn's own message, verbatim off the wire. */
  readonly message: string;
  /** The turn's wire source — chip_click is barred from message_unshaped. */
  readonly source: MessageTurnPayload['source'];
  /** Persisted `scenarios.brief_text`, or null when none is stored. */
  readonly persistedBriefText: string | null;
  /**
   * ROADMAP 2.63 C3/C4 — `brief_seed` from the `draft_graph` pending action
   * being resumed, or null/omitted on non-resume calls. Already
   * normaliseBriefText-bounded at capture time; re-normalised here as
   * defence-in-depth against a corrupted persisted row.
   */
  readonly pendingBriefSeed?: string | null;
  /**
   * Prior committed turns, MOST-RECENT-FIRST (the `readRecent` order).
   * Only `user_message` content is consulted. Pass `[]` when the chain
   * was not (yet) read — sources 1/2 do not need it.
   */
  readonly recentTurns: readonly SessionTurnWithContent[];
}

/**
 * Cap an assembled brief at the draft pipeline's Zod max. normaliseBriefText
 * caps at 8000 (the DB column bound) which exceeds DraftGraphInput's 5000;
 * a hard slice keeps the dispatch guaranteed-valid. Word-boundary polish is
 * deliberately omitted — a 5000-char brief loses nothing meaningful at a
 * mid-word cut, and the simple slice is total.
 */
function capToDraftMax(brief: string): string {
  return brief.length > DRAFT_GRAPH_MAX_BRIEF_LENGTH
    ? brief.slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH)
    : brief;
}

function usableLength(value: string): boolean {
  return value.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH;
}

export function assembleExplicitGenerateBrief(
  input: AssembleExplicitGenerateBriefInput,
): AssembledExplicitGenerateBrief | null {
  // Source 1 — the message itself, when brief-shaped.
  const message = normaliseBriefText(input.message).value ?? '';
  const messageMeetsLength = usableLength(message);
  if (messageMeetsLength && DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(message)) {
    return { brief: capToDraftMax(message), source: 'message' };
  }

  // Source 2 — the offer-time brief seed (draft-offer resume only). The
  // capture site already enforces the length floor; a seed that no longer
  // meets it after re-normalisation is skipped, not an error.
  const seed = normaliseBriefText(input.pendingBriefSeed ?? null).value ?? '';
  if (usableLength(seed)) {
    return { brief: capToDraftMax(seed), source: 'pending_seed' };
  }

  // Source 3 — the persisted first-write-wins brief.
  const persisted = normaliseBriefText(input.persistedBriefText).value ?? '';
  if (usableLength(persisted)) {
    return { brief: capToDraftMax(persisted), source: 'persisted_brief' };
  }

  // Source 4 — most recent brief-shaped USER turn.
  for (const turn of input.recentTurns) {
    const userMessage = normaliseBriefText(turn.user_message ?? null).value ?? '';
    if (usableLength(userMessage) && DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(userMessage)) {
      return { brief: capToDraftMax(userMessage), source: 'recent_turn' };
    }
  }

  // Source 5 — unshaped typed message (never a chip's canned text).
  if (messageMeetsLength && input.source !== 'chip_click') {
    return { brief: capToDraftMax(message), source: 'message_unshaped' };
  }

  return null;
}
