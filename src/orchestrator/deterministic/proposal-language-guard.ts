/**
 * Proposal Language Guard (T5)
 *
 * Detects "applied-language" completion phrases ("Adding now", "I've added")
 * leaking into user-facing text on PROPOSAL turns — turns whose graph_patch
 * block has `auto_apply === false`. The LLM has no enforced contract that
 * separates proposal narration from completion narration; this guard catches
 * the leak after assembly and appends a corrective suffix so the user reads
 * a coherent proposal frame.
 *
 * Scope (CRITICAL):
 *   - Run ONLY when the response will emit a graph_patch block with
 *     `auto_apply === false`. The check must gate on the actual block state,
 *     not on `operations.length > 0` — a future path might emit operations
 *     but auto-apply, in which case completion language is correct.
 *   - Skip on draft_graph (auto_apply true) and on turns without a patch block.
 *
 * Telemetry:
 *   - Emits `v4.proposal_language_leak` on every match. Watch for >20% leak
 *     rate per tool — escalate to a prompt-level fix when that happens.
 *
 * Pattern design:
 *   - Word-boundary anchored, case-insensitive, narrowly targeting completion
 *     idioms. NOT phrases like "adding a factor would" or "I'd suggest adding"
 *     which are legitimate proposal-context usages.
 *   - One leak per scan is sufficient — the suffix is the same regardless of
 *     which exact phrase tripped, and we don't want to spam the log.
 */

import { log } from "../../utils/telemetry.js";

const LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /\badding now\b/i,
  /\badding that\b/i,
  /\bi['’]ve added\b/i,
  /\bi['’]ll add it now\b/i,
  /\bupdating now\b/i,
  /\bi['’]ve updated\b/i,
  /\bdone\b/i,
  /\bapplied\b/i,
  /\bmaking that change\b/i,
];

export interface ProposalLanguageScanResult {
  leaked: boolean;
  /** The exact substring that matched, when leaked === true. */
  matchedPhrase?: string;
  /** The text with the corrective suffix appended, when leaked === true. */
  suffixed?: string;
}

/**
 * Scan an assembled assistant text for proposal-language leaks. When a leak
 * is found, log telemetry and return a corrected version of the text with a
 * "Review the suggested changes above." suffix appended.
 *
 * The caller is responsible for gating this on the actual block state
 * (`auto_apply === false`). This function does not inspect blocks itself.
 *
 * @param text  The assembled assistant text (post-coaching, post-warnings).
 * @param toolName  Tool name for telemetry routing (`edit_graph`, action name, etc.).
 * @returns scan result; callers should use `suffixed` if `leaked === true`.
 */
export function enforceProposalLanguage(
  text: string | null | undefined,
  toolName: string,
): ProposalLanguageScanResult {
  if (!text) return { leaked: false };
  for (const re of LEAK_PATTERNS) {
    const m = text.match(re);
    if (m) {
      log.warn(
        {
          event: 'v4.proposal_language_leak',
          matched_phrase: m[0],
          tool_name: toolName,
        },
        'Proposal turn contained applied-language completion phrase',
      );
      return {
        leaked: true,
        matchedPhrase: m[0],
        suffixed: `${text}\n\nReview the suggested changes above.`,
      };
    }
  }
  return { leaked: false };
}
