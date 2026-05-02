/**
 * Draft narration count-mismatch guard (Phase 2 workstream B).
 *
 * Background: at draft-graph-dispatch.ts:132 the assistant_text is set
 * via `result.assistantText ?? successFallback`. The fallback is built
 * from the FINAL post-repair graph counts and is therefore correct by
 * construction. The override path uses Sonnet's narration verbatim — and
 * if Sonnet hallucinates a count ("Drafted a decision graph with 3 nodes
 * and 2 edges") that disagrees with the actual rendered graph (e.g. 7
 * nodes, 8 edges), the user sees the wrong number while the canvas
 * renders the right one.
 *
 * This guard inspects the narration for explicit node/edge counts and,
 * on mismatch with the final counts, prefers the deterministic fallback
 * and emits telemetry so ops can chase Sonnet drift. When the narration
 * does not mention counts at all, it is preserved verbatim — the guard
 * does not strip qualitative narration just because it lacks numbers.
 */

import { emit, TelemetryEvents } from '../../utils/telemetry.js';

/**
 * Match the FIRST node/edge count token in the narration. Tolerant of:
 *   - "5 nodes" / "5 node"
 *   - "5  nodes" (extra whitespace)
 * Does NOT match:
 *   - "5K nodes" (non-pure-integer)
 *   - "five nodes" (word numerals)
 *
 * If Sonnet writes anything other than `<integer> node(s)` or
 * `<integer> edge(s)`, the guard skips quantitative comparison and
 * preserves the narration. That is conservative: false negatives accept
 * a less-precise narration, but never reject a valid one.
 */
// Tolerant of optional markdown-bold wrapping (e.g. "**7** nodes") which
// the deterministic fallback at draft-graph-dispatch.ts emits.
const NODE_COUNT_RE = /(?:^|[^\w*])\*{0,2}(\d+)\*{0,2}\s+nodes?\b/i;
const EDGE_COUNT_RE = /(?:^|[^\w*])\*{0,2}(\d+)\*{0,2}\s+edges?\b/i;

export interface NarrationCountCheckInput {
  readonly narration: string | undefined;
  readonly finalNodeCount: number;
  readonly finalEdgeCount: number;
  readonly fallback: string;
  readonly requestId: string;
}

export interface NarrationCountCheckResult {
  readonly chosenText: string;
  /**
   * True when the narration's explicit counts disagreed with the final
   * graph counts. Strict — does NOT include the matched-but-graph-shaped
   * suppression case introduced in brief brief-display-safe-analysis A2;
   * see `wordingSuppressed` for that.
   */
  readonly mismatchDetected: boolean;
  /**
   * True when `chosenText` was replaced with the fallback because the
   * narration carried any node/edge-count wording (whether matched or
   * mismatched). Implies `chosenText === fallback`. Use this when the
   * caller needs to know "was the LLM's text replaced?" rather than
   * "was there a real count error?".
   */
  readonly wordingSuppressed: boolean;
}

/**
 * Decide which assistant_text to ship. Brief brief-display-safe-analysis A2:
 * users don't think in graph terms, so any node/edge-count wording in the
 * narration — matched OR mismatched — is rejected in favour of the
 * decision-language fallback.
 *
 * Telemetry is split so ops dashboards stay clean:
 *   - `DraftNarrationCountMismatch` fires only when narration counts
 *     genuinely disagree with the final graph (its original semantic).
 *   - `DraftNarrationCountSuppressed` fires when the counts match but
 *     the wording itself is being replaced for being graph-shaped.
 * No turn fires both events.
 *
 * When the narration carries no count tokens at all, it ships verbatim — the
 * guard does not strip qualitative narration just because it lacks numbers.
 *
 * Pure function (other than the telemetry emit). Never throws.
 */
export function checkDraftNarrationCounts(
  input: NarrationCountCheckInput,
): NarrationCountCheckResult {
  const { narration, finalNodeCount, finalEdgeCount, fallback, requestId } = input;
  if (!narration || narration.length === 0) {
    return { chosenText: fallback, mismatchDetected: false, wordingSuppressed: false };
  }

  const nodeMatch = narration.match(NODE_COUNT_RE);
  const edgeMatch = narration.match(EDGE_COUNT_RE);

  // Narration carries NEITHER an explicit node count NOR an explicit
  // edge count → no graph-shaped framing to scrub. Accept verbatim.
  if (!nodeMatch && !edgeMatch) {
    return { chosenText: narration, mismatchDetected: false, wordingSuppressed: false };
  }

  const narrationNodeCount = nodeMatch ? Number.parseInt(nodeMatch[1], 10) : null;
  const narrationEdgeCount = edgeMatch ? Number.parseInt(edgeMatch[1], 10) : null;

  const nodeMismatch =
    narrationNodeCount !== null && narrationNodeCount !== finalNodeCount;
  const edgeMismatch =
    narrationEdgeCount !== null && narrationEdgeCount !== finalEdgeCount;
  const isMismatch = nodeMismatch || edgeMismatch;

  const eventPayload = {
    request_id: requestId,
    final_node_count: finalNodeCount,
    final_edge_count: finalEdgeCount,
    narration_node_count: narrationNodeCount,
    narration_edge_count: narrationEdgeCount,
    narration_length: narration.length,
  };
  if (isMismatch) {
    emit(TelemetryEvents.DraftNarrationCountMismatch, eventPayload);
  } else {
    emit(TelemetryEvents.DraftNarrationCountSuppressed, eventPayload);
  }

  return { chosenText: fallback, mismatchDetected: isMismatch, wordingSuppressed: true };
}
