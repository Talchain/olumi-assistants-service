/**
 * THE DECISION-FREE SHAPE — one predicate, one authority.
 *
 * A user may legitimately bring a brief with nothing being chosen between:
 * *"I want to map out what is going on rather than jump to an answer."* Before
 * this module the platform refused them — `MISSING_DECISION` and
 * `INSUFFICIENT_OPTIONS` fired at `post_enforcement`,
 * `applyDeterministicEnforcement` set `ctx.earlyReturn`, Stage 5 was skipped and
 * the turn came back 422 `CEE_GRAPH_INVALID`. Six of eight probed open briefs
 * were forced into a Decision+Options they had not asked for, and the invented
 * options carried `provenance: "from_brief"` — a truthfulness defect, because
 * the brief did not contain them.
 *
 * ── WHY A COUNT PREDICATE AND NOT A NEW FIELD ──────────────────────────────
 * On the live draft path the model emits RECORDS, not a graph
 * (`adapters/llm/anthropic.ts:517` appends `DRAFT_RECORDS_INSTRUCTION`; a
 * graph-shaped response is the typed failure `graph_shaped_response`,
 * `cee/draft/records/seam.ts:138`). The records grammar has NO `decision` kind —
 * the decision node is MINTED BY THE PROJECTOR, and only when options exist
 * (`cee/draft/records/projector.ts:3207`, `if (optionNodes.length > 0)`). So on
 * that path "zero options" and "zero decisions" are the same fact, and the shape
 * alone identifies the class. No field has to be threaded, persisted, or kept
 * true by anybody.
 *
 * ── WHY IT IS EXACT, AND MUST STAY EXACT ───────────────────────────────────
 * This predicate guards TWO OPPOSITE HARMS and they cannot share a window
 * (platform trap 22b):
 *
 *   - Too WIDE and it becomes a LIE: a graph that lost its decision, or a
 *     decision whose options went missing, would be waved through and the user
 *     would be handed a model the product knows is broken.
 *   - Too NARROW and it is the GAP above: a legitimate open model is refused.
 *
 * `decisions === 0 && options === 0` is the only conjunction that separates
 * them, and every adjacent cell keeps its existing error:
 *
 *   | decisions | options | verdict                                          |
 *   |-----------|---------|--------------------------------------------------|
 *   | 0         | 0       | DECISION-FREE — admitted (the exploratory map)    |
 *   | 0         | >0      | MISSING_DECISION — the graph lost its decision    |
 *   | >=1       | <2      | INSUFFICIENT_OPTIONS — a decision needs a choice  |
 *   | >1        | any     | MISSING_DECISION — plural-decision arm, untouched |
 *
 * `tests/unit/decision-free-model.test.ts` enumerates the WHOLE space
 * ({0,1,2} decisions x {0,1,2,3} options x goal x outcome = 48 cells) and pins
 * every one. Exactly one cell moves.
 *
 * ── WHAT THIS PREDICATE DOES NOT DO ────────────────────────────────────────
 * It does not make a decision-free model ANALYSABLE. Monte Carlo compares
 * options; with none there is nothing to compare, and the four analysis gates
 * stay closed on purpose. That refusal is the honest state the brief asked for,
 * not a defect to route around.
 */

/** The node-kind counts this predicate reads. Nothing else is relevant to it. */
export interface DecisionFreeCounts {
  readonly decisionCount: number;
  readonly optionCount: number;
}

/**
 * TRUE only for the deliberate exploratory-map class: a model with no decision
 * AND no options.
 *
 * Every consumer imports this. It is deliberately a leaf module with no imports
 * and no behaviour, so no test that mocks a sibling module wholesale can
 * accidentally replace it (platform trap 12 — the same reasoning that put
 * `BUCKET_C_CODES` in its own file).
 */
export function isDecisionFreeShape(counts: DecisionFreeCounts): boolean {
  return counts.decisionCount === 0 && counts.optionCount === 0;
}

/** Count decisions and options off any node list carrying a `kind`. */
export function decisionFreeCountsFromNodes(
  nodes: ReadonlyArray<{ readonly kind?: unknown }>,
): DecisionFreeCounts {
  let decisionCount = 0;
  let optionCount = 0;
  for (const node of nodes) {
    if (node.kind === 'decision') decisionCount++;
    else if (node.kind === 'option') optionCount++;
  }
  return { decisionCount, optionCount };
}

/** Convenience for the graph-shaped callers. */
export function isDecisionFreeGraph(graph: {
  readonly nodes: ReadonlyArray<{ readonly kind?: unknown }>;
}): boolean {
  return isDecisionFreeShape(decisionFreeCountsFromNodes(graph.nodes));
}
