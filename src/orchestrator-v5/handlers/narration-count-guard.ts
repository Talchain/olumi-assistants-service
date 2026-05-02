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
 * Match the FIRST DIGIT-PREFIXED node/edge count token in the narration.
 * Tolerant of:
 *   - "5 nodes" / "5 node"
 *   - "5  nodes" (extra whitespace)
 *   - "**5** nodes" (markdown bold wrapping emitted by the legacy fallback)
 * Does NOT match:
 *   - "5K nodes" (non-pure-integer)
 *   - "five nodes" (word numerals)
 *
 * Used to extract numeric counts from the narration so we can tell ops
 * whether the narration's numbers AGREED with the final graph
 * (`DraftNarrationCountSuppressed`) or DISAGREED
 * (`DraftNarrationCountMismatch`). For the digit-less cases we still
 * suppress via WORDING_RE below — see `containsGraphShapedWording`.
 */
const NODE_COUNT_RE = /(?:^|[^\w*])\*{0,2}(\d+)\*{0,2}\s+nodes?\b/i;
const EDGE_COUNT_RE = /(?:^|[^\w*])\*{0,2}(\d+)\*{0,2}\s+edges?\b/i;

/**
 * Brief brief-display-safe-analysis A2 — keyword detector for any
 * count-shaped graph wording, regardless of how it's prefixed (digits,
 * word numerals, K-suffixes, or no number at all). Catches:
 *   - "7 nodes" / "five nodes" / "5K nodes" / "many nodes"
 *   - "edge / edges" similarly
 *
 * Word boundary anchored so unrelated uses ("hiring nodes" — unlikely
 * in a decision-graph product but technically possible) match too.
 * In a decision-graph product context the false-positive rate is
 * effectively zero — the bare word "nodes"/"edges" reads as graph-shaped
 * framing the brief forbids.
 */
const GRAPH_WORDING_RE = /\b(?:nodes?|edges?)\b/i;

function containsGraphShapedWording(text: string): boolean {
  return GRAPH_WORDING_RE.test(text);
}

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
   * True when the narration's explicit DIGIT counts disagreed with the
   * final graph counts. Strict — does NOT include the
   * matched-but-graph-shaped suppression case or the
   * digit-less-but-graph-shaped suppression case introduced in brief
   * brief-display-safe-analysis A2 (see `wordingSuppressed`).
   */
  readonly mismatchDetected: boolean;
  /**
   * True when `chosenText` was replaced with the fallback BECAUSE THE
   * NARRATION CONTAINED GRAPH-SHAPED WORDING (any of `node(s)` or
   * `edge(s)`, with or without a numeric prefix). Implies
   * `chosenText === fallback`.
   *
   * NOT a general "did chosenText change?" flag — empty/missing
   * narration also returns the fallback but with `wordingSuppressed: false`,
   * because there was no wording to suppress (the fallback was used
   * because there was nothing else to ship). Callers that need
   * "was the original LLM text replaced?" should check
   * `chosenText !== narration` directly.
   */
  readonly wordingSuppressed: boolean;
}

/**
 * Decide which assistant_text to ship. Brief brief-display-safe-analysis A2:
 * users don't think in graph terms, so any node/edge wording in the
 * narration — digit-prefixed, word-numeral-prefixed, K-suffixed, or
 * unprefixed — is replaced by the decision-language fallback.
 *
 * Telemetry is split so ops dashboards stay clean:
 *   - `DraftNarrationCountMismatch` fires only when narration's DIGIT
 *     counts genuinely disagree with the final graph counts (its
 *     original semantic — preserved so existing alerts keep working).
 *   - `DraftNarrationCountSuppressed` fires for every other suppression
 *     case: matched digit counts, word numerals, K-suffixed counts,
 *     digit-less wording. Carries `narration_node_count` /
 *     `narration_edge_count` as null when no digit counts were parseable.
 * No turn fires both events.
 *
 * When the narration carries no graph-shaped wording at all, it ships
 * verbatim — the guard does not strip qualitative narration ("I drafted
 * a graph capturing your hiring options.") just because it lacks
 * numbers.
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

  // Single keyword test triggers suppression. Then digit extraction
  // (best-effort) classifies into mismatch vs suppressed for telemetry.
  if (!containsGraphShapedWording(narration)) {
    return { chosenText: narration, mismatchDetected: false, wordingSuppressed: false };
  }

  const nodeMatch = narration.match(NODE_COUNT_RE);
  const edgeMatch = narration.match(EDGE_COUNT_RE);
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
