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
  readonly mismatchDetected: boolean;
}

/**
 * Decide which assistant_text to ship. Returns the original narration
 * when it does not contain explicit node/edge counts OR when those
 * counts agree with the final graph. On mismatch, returns the
 * deterministic fallback and emits `DraftNarrationCountMismatch`
 * telemetry with the offending values.
 *
 * Pure function (other than the telemetry emit). Never throws.
 */
export function checkDraftNarrationCounts(
  input: NarrationCountCheckInput,
): NarrationCountCheckResult {
  const { narration, finalNodeCount, finalEdgeCount, fallback, requestId } = input;
  if (!narration || narration.length === 0) {
    return { chosenText: fallback, mismatchDetected: false };
  }

  const nodeMatch = narration.match(NODE_COUNT_RE);
  const edgeMatch = narration.match(EDGE_COUNT_RE);

  // Narration carries NEITHER an explicit node count NOR an explicit
  // edge count → no quantitative mismatch is detectable. Accept the
  // narration verbatim. (When only one side is present, we still
  // compare it against the corresponding final count below.)
  if (!nodeMatch && !edgeMatch) {
    return { chosenText: narration, mismatchDetected: false };
  }

  const narrationNodeCount = nodeMatch ? Number.parseInt(nodeMatch[1], 10) : null;
  const narrationEdgeCount = edgeMatch ? Number.parseInt(edgeMatch[1], 10) : null;

  const nodeMismatch =
    narrationNodeCount !== null && narrationNodeCount !== finalNodeCount;
  const edgeMismatch =
    narrationEdgeCount !== null && narrationEdgeCount !== finalEdgeCount;

  if (!nodeMismatch && !edgeMismatch) {
    return { chosenText: narration, mismatchDetected: false };
  }

  emit(TelemetryEvents.DraftNarrationCountMismatch, {
    request_id: requestId,
    final_node_count: finalNodeCount,
    final_edge_count: finalEdgeCount,
    narration_node_count: narrationNodeCount,
    narration_edge_count: narrationEdgeCount,
    narration_length: narration.length,
  });

  return { chosenText: fallback, mismatchDetected: true };
}
