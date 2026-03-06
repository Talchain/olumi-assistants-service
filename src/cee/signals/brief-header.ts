/**
 * BriefSignals context header formatter.
 *
 * Produces a single-line `[BRIEF_SIGNALS v1]` header that is appended to the
 * user message before the LLM draft call. The version prefix enables the LLM
 * system prompt to reference the format without ambiguity.
 *
 * **Sanitisation rules:** All values are stripped of newlines, brackets,
 * quotes, and backticks. Allowed chars: alphanumeric, underscore, currency
 * symbols (£$€), percentage, spaces, and common punctuation (.,;:/-).
 */

import type { BriefSignals } from "./types.js";

/**
 * Sanitise a value for inclusion in the brief signals header.
 * Strips newlines, brackets, quotes, backticks. Truncates to maxLen.
 */
function sanitise(value: string, maxLen: number): string {
  return value
    .replace(/[\n\r\[\]"'`{}]/g, "")
    .replace(/[^\w£$€%\s.,;:/-]/g, "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Format a `BriefSignals` object into a single-line context header.
 *
 * **Format:** `[BRIEF_SIGNALS v1] options=N target=VALUE baseline=STATE constraints=STATE risks=STATE bias=TYPES`
 *
 * The header is already sanitised and bounded — safe to append directly
 * to user message content after the compliance reminder.
 *
 * @param signals - BriefSignals computed by `computeBriefSignals()`
 * @returns Single-line header string including the `[BRIEF_SIGNALS v1]` prefix
 */
export function formatBriefHeader(signals: BriefSignals): string {
  const options = signals.option_count_estimate;

  const target =
    signals.target_markers.length > 0
      ? sanitise(signals.target_markers[0].source_text, 20)
      : "none";

  const baseline =
    signals.baseline_state === "unknown_explicit"
      ? "unknown"
      : signals.baseline_state;

  const constraints =
    signals.constraint_markers.length > 0
      ? sanitise(signals.constraint_markers[0].source_text, 20)
      : "none";

  const risks =
    signals.risk_markers.length > 0
      ? sanitise(signals.risk_markers[0], 20)
      : "none";

  const bias =
    signals.bias_signals.length > 0
      ? signals.bias_signals.map((b) => b.type).join(",")
      : "none";

  return `\n\n[BRIEF_SIGNALS v1] options=${options} target=${target} baseline=${baseline} constraints=${constraints} risks=${risks} bias=${bias}`;
}
