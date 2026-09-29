/**
 * Draft progress scanner — node labels out of the PARTIAL draft token stream.
 *
 * ROADMAP 1.204 M1. The draft adapter already accumulates every text delta into
 * `acc` and already tail-scans it for the first edge (`DRAFT_EDGES_REACHED_RE`,
 * the `time_to_edges_ms` signal). This module reads the SAME character stream to
 * pull out completed `"label": "..."` values so the canvas can show real node
 * labels ~10-16 s into a ~53 s draft instead of a wall-clock fiction.
 *
 * DESIGN CONSTRAINTS (all load-bearing):
 *
 *  - **Pure and separately testable.** The adapter's streaming loop is the most
 *    delicate code in the repo (it carries the runaway detector and the #682
 *    per-string ceiling). All parsing logic lives HERE, behind a 3-line guarded
 *    call there, so it can be exercised without an LLM and without touching the
 *    detector.
 *  - **COMPLETE values only.** The regex requires the CLOSING quote, so a label
 *    still being streamed is never emitted half-written. This is the partial-
 *    content doctrine at the character level: we would rather show nothing than
 *    show a truncated word as if it were the model's output.
 *  - **Never re-emits.** Consumed input is dropped; each label surfaces once.
 *  - **Bounded memory.** The carry buffer is capped well above the #682 per-
 *    string ceiling (1,900 chars), so a pathological unterminated string cannot
 *    grow it without bound — the runaway detector owns that failure, not us.
 *  - **Cannot fail the draft.** Every function here is total: no throws, no
 *    awaits, no I/O.
 */

/**
 * Matches a COMPLETED JSON string value for the `label` key, tolerating
 * escaped characters inside the value (`\"`, `\\`, `\n`, …).
 *
 * Deliberately NOT anchored to node shape: the draft grammar emits `label` on
 * nodes, and matching the key alone keeps this independent of the grammar —
 * which the house rules require to stay unchanged.
 */
const LABEL_RE = /"label"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * Upper bound on retained unconsumed input. Comfortably above the #682 derived
 * per-string ceiling (76 × 25 = 1,900), so a legitimate long label always fits
 * and only a genuine runaway — already the detector's job — can overflow it.
 */
export const DRAFT_PROGRESS_CARRY_CAP_CHARS = 8_192;

/** Retained slice when the cap trips, so a straddling match can still complete. */
const CARRY_RETAIN_CHARS = 4_096;

/** Hard cap on labels reported across one draft attempt (canvas skeleton only). */
export const DRAFT_PROGRESS_MAX_LABELS = 60;

/** Longest label surfaced to a progress frame; longer values are dropped, not cut. */
export const DRAFT_PROGRESS_MAX_LABEL_CHARS = 120;

/**
 * Minimum gap between progress emissions. A draft streams thousands of deltas;
 * without this, a fast generation would emit a frame per label and turn the SSE
 * socket into the bottleneck it exists to remove. Well below the 10 s SSE
 * heartbeat, so progress is visibly live between heartbeats.
 */
export const DRAFT_PROGRESS_MIN_INTERVAL_MS = 250;

export interface DraftLabelScanner {
  /**
   * Feed the next text delta. Returns the labels COMPLETED by this delta, in
   * stream order — empty array when the delta completed none.
   */
  push(chunk: string): string[];
  /** Total labels emitted so far (for telemetry / cap assertions). */
  count(): number;
}

/**
 * Unescape a JSON string body. Total: on any malformed escape it returns the
 * raw body rather than throwing, because a progress frame is never worth
 * failing a draft over.
 */
function decodeJsonStringBody(body: string): string {
  if (!body.includes("\\")) return body;
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return body;
  }
}

export function createDraftLabelScanner(): DraftLabelScanner {
  let carry = "";
  let emitted = 0;

  return {
    count: () => emitted,

    push(chunk: string): string[] {
      if (!chunk || emitted >= DRAFT_PROGRESS_MAX_LABELS) return [];

      carry += chunk;

      const found: string[] = [];
      let consumedTo = 0;

      LABEL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LABEL_RE.exec(carry)) !== null) {
        consumedTo = m.index + m[0].length;

        if (emitted >= DRAFT_PROGRESS_MAX_LABELS) break;

        const label = decodeJsonStringBody(m[1] ?? "").trim();
        // Empty labels carry no signal; over-long ones are dropped whole rather
        // than truncated (a cut label would misrepresent the model's output).
        if (label.length > 0 && label.length <= DRAFT_PROGRESS_MAX_LABEL_CHARS) {
          found.push(label);
          emitted++;
        }
      }

      if (consumedTo > 0) {
        carry = carry.slice(consumedTo);
      } else if (carry.length > DRAFT_PROGRESS_CARRY_CAP_CHARS) {
        // No match and the buffer is past its cap — keep only the tail so a
        // match straddling the drop point can still complete.
        carry = carry.slice(carry.length - CARRY_RETAIN_CHARS);
      }

      return found;
    },
  };
}
