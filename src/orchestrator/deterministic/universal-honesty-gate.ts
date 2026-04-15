/**
 * Universal artefact-truth gate.
 *
 * Last defence before SSE emission. When a tool executed but produced no
 * visible mutation (no graph_patch block, no patch operations), any
 * "I updated it / connected it / set it to X" claim in assistant_text is a
 * lie — even if recovery chips are being offered. Strip sentences that claim
 * completion regardless of the recovery path.
 *
 * Tiering:
 *   mutationEffect  = graph_patch block present OR operations.length > 0
 *   recoveryEffect  = suggested_actions_override.length > 0
 *
 * Strip action-completion sentences whenever !mutationEffect (even when
 * recoveryEffect is true — we must not claim the change happened while
 * offering chips to make it happen). Only when !mutationEffect &&
 * !recoveryEffect and every sentence was stripped do we substitute the
 * fallback text.
 */

export const MATCH_ACTION_LANGUAGE =
  /\b(connecting|connected|adding|added|removing|removed|rewiring|rewired|updating|updated|proposing to|mapping|mapped|setting|set to)\b.{0,30}\b(now|it|them|those|this|the|to)\b/i;

export const HONESTY_FALLBACK_TEXT =
  "I wasn't able to make that change. Tell me what you'd like to change, and I'll try a different route.";

/**
 * Used when every sentence got stripped BUT recovery chips exist. Must be
 * non-empty (response-normaliser replaces empty assistant_text with a generic
 * greeting that discards context) AND must not contradict the chips by
 * claiming the change happened or wasn't possible — the chips ARE the path
 * forward, so we acknowledge them without pre-empting the user's choice.
 */
export const HONESTY_CHIP_FALLBACK_TEXT =
  "I couldn't apply that change directly. Pick one of the options below to proceed.";

export function matchesActionLanguage(text: string): boolean {
  return MATCH_ACTION_LANGUAGE.test(text);
}

export interface StripResult {
  stripped: string;
  strippedCount: number;
  allStripped: boolean;
}

/**
 * Split `text` into sentences on `. ! ?` boundaries. Remove any sentence
 * whose content matches MATCH_ACTION_LANGUAGE; preserve the rest verbatim
 * (including their trailing punctuation).
 */
export function stripActionClaims(text: string): StripResult {
  const parts = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
  const survivors: string[] = [];
  let strippedCount = 0;
  for (const part of parts) {
    if (MATCH_ACTION_LANGUAGE.test(part)) {
      strippedCount += 1;
      continue;
    }
    survivors.push(part);
  }
  const joined = survivors.join('').trim();
  return {
    stripped: joined,
    strippedCount,
    allStripped: joined.length === 0 && strippedCount > 0,
  };
}

export interface GateInput {
  executedAction: string | null;
  assistantText: string;
  mutationEffect: boolean;
  recoveryEffect: boolean;
}

export interface GateOutput {
  changed: boolean;
  assistantText: string;
  strippedCount: number;
  usedFallback: boolean;
}

/**
 * Apply the gate. Returns `changed: false` when no rewrite was needed.
 *
 * - executedAction === null → skip (conversational turn with no tool fired)
 * - mutationEffect → skip (visible graph change is authoritative)
 * - no matching language → skip
 * - !mutationEffect && text matches → strip action-claim sentences
 *   - if every sentence gets stripped:
 *       - !recoveryEffect → substitute fallback text
 *       - recoveryEffect → leave survivors only (may be empty string; chips
 *         carry the recovery meaning, text can be empty). If empty after
 *         strip we still emit an empty string rather than the fallback so
 *         the chips are not contradicted by an "I couldn't" sentence.
 */
export function applyUniversalHonestyGate(input: GateInput): GateOutput {
  if (input.executedAction === null) {
    return { changed: false, assistantText: input.assistantText, strippedCount: 0, usedFallback: false };
  }
  if (input.mutationEffect) {
    return { changed: false, assistantText: input.assistantText, strippedCount: 0, usedFallback: false };
  }
  if (!MATCH_ACTION_LANGUAGE.test(input.assistantText)) {
    return { changed: false, assistantText: input.assistantText, strippedCount: 0, usedFallback: false };
  }
  const { stripped, strippedCount, allStripped } = stripActionClaims(input.assistantText);
  if (strippedCount === 0) {
    return { changed: false, assistantText: input.assistantText, strippedCount: 0, usedFallback: false };
  }
  if (allStripped) {
    // With chips: emit a short contextual fallback that acknowledges the
    // chips and survives response-normaliser's empty-text guard. Without
    // chips: full fallback text.
    return {
      changed: true,
      assistantText: input.recoveryEffect ? HONESTY_CHIP_FALLBACK_TEXT : HONESTY_FALLBACK_TEXT,
      strippedCount,
      usedFallback: true,
    };
  }
  return {
    changed: true,
    assistantText: stripped,
    strippedCount,
    usedFallback: false,
  };
}
