/**
 * Goal Inference Utility
 *
 * Provides functions to infer goal nodes from decision briefs when LLM
 * fails to generate them. Used as part of the defence-in-depth strategy
 * for handling missing goal nodes.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { CorrectionCollector } from "../corrections.js";
import { formatEdgeId } from "../corrections.js";
// ⭐ THE ONE SCAFFOLDING-BADGE AUTHORITY, shared with the projector, the
// deterministic sweep and the terminal-bridge repair. A fourth mint site, one
// constructor — see `projector.ts:121` for why this is not a new vocabulary.
import { scaffoldingProvenance, type RecordProvenance } from "../draft/records/projector.js";

/**
 * ⛔ THE BADGE FOR A GOAL CEE CHOSE, AND WHY ITS ABSENCE WAS THE DEFECT.
 *
 * A node minted here with NO provenance is not neutral. `projectNodeProvenance`
 * (`transforms/schema-v3.ts:1158`) reads an unrecognised node as LEGACY and
 * falls through to label containment at `:1193`: `goal` is in
 * `LABEL_BOUND_PROVENANCE_KINDS`, the minted label carries no value and has ≥2
 * tokens, and — for the regex limb — the label IS a case-folded substring of
 * the brief BY CONSTRUCTION, because `inferGoalFromBrief` lifted it from there.
 * So `bindOptionLabelToBrief` returned `verified` and the node was stamped
 * `provenance: "from_brief"`: THE USER'S BADGE ON A GOAL THEY NEVER DESIGNATED
 * AND THE MODEL NEVER AUTHORED.
 *
 * That module's header names this exact hazard — *"an inferred label that
 * happens to repeat brief text is falsely re-attributed to the user"*
 * (`:1153-1155`) — and the typed path exists to stop it. This goal simply never
 * took that path. Carrying a typed record makes `projectNodeProvenance` return
 * at `:1169` BEFORE any label match, so the verdict is `ai_inferred` by class
 * rather than by a string comparison that the regex guarantees will succeed.
 *
 * `label_authored` is the estate's existing node-level signal for "the producer
 * authored this display label rather than carrying the user's own words"
 * (`post-draft-narrative.ts:291`). It is what stops the narrative wrapping this
 * label in quotation marks, which promise "these are your words".
 *
 * ⚠ NOT APPLIED TO THE `explicitGoal` LIMB. `context.goals[0]` is the user's own
 * text; badging it would be the OPPOSITE HARM — stripping a real goal of a real
 * attribution. Both directions are pinned in
 * `tests/unit/cee.goal-inference-attribution.test.ts`.
 */
const MINTED_GOAL_PROVENANCE: RecordProvenance = {
  // `quote` is NEVER user text (max 100) — it describes what the machine did.
  ...scaffoldingProvenance("Goal minted by CEE: the drafted model carried no goal node"),
  label_authored: true,
};

/**
 * Patterns that indicate goal/objective phrases in briefs
 */
const GOAL_PATTERNS = [
  // Explicit goal statements
  /(?:my |our |the )?goal is (?:to )?(.+?)(?:\.|,|$)/i,
  /(?:my |our |the )?objective is (?:to )?(.+?)(?:\.|,|$)/i,
  /(?:my |our |the )?aim is (?:to )?(.+?)(?:\.|,|$)/i,

  // Purpose phrases
  /to achieve (.+?)(?:\.|,|$)/i,
  /to improve (.+?)(?:\.|,|$)/i,
  /to increase (.+?)(?:\.|,|$)/i,
  /to reduce (.+?)(?:\.|,|$)/i,
  /to decrease (.+?)(?:\.|,|$)/i,
  /to maximize (.+?)(?:\.|,|$)/i,
  /to minimize (.+?)(?:\.|,|$)/i,
  /to enable (?:me |us )?to (.+?)(?:\.|,|$)/i,
  /to help (?:me |us )?(.+?)(?:\.|,|$)/i,
  /to allow (?:me |us )?to (.+?)(?:\.|,|$)/i,
  /to focus on (.+?)(?:\.|,|$)/i,

  // Want/need statements
  /(?:I |we )?want to (.+?)(?:\.|,|$)/i,
  /(?:I |we )?need to (.+?)(?:\.|,|$)/i,

  // Success/outcome phrases
  /success (?:means|looks like|is) (.+?)(?:\.|,|$)/i,
  /the outcome (?:I |we )?(?:want|need) is (.+?)(?:\.|,|$)/i,
];

/**
 * ⭐⭐ WHERE THE OBJECTIVE CLAUSE ENDS — the connectives that introduce a trailing
 * QUALIFIER rather than more objective.
 *
 * ⚠ THE LIVE DEFECT. A 15-journey battery captured an objective node reading
 * *"Bring first-response time back under four hours without going over budget"* —
 * the budget CONSTRAINT swallowed into the OBJECTIVE, so the analysis optimised
 * for a compound thing the user never set as their goal. The patterns above use a
 * lazy capture bounded only by sentence end, so with no comma and no full stop
 * before the trailing clause, `(.+?)` runs to `$` and takes the qualifier with it.
 *
 * ⭐ WHY THIS IS TRACTABLE WHERE THE SEMANTIC QUESTION WAS NOT. PR #1214 attacked
 * a different seam by asking *"is this span a limit or an objective?"* — a
 * judgement about MEANING, and a sibling proved by execution that the identical
 * quote is an objective in one brief and a constraint in another with
 * byte-identical inputs. That is unwinnable at the span level and #1214 is parked.
 * This list answers only *"where does the objective clause END?"* — a boundary
 * question about clause STRUCTURE. In `X without Y`, `X while keeping Y`, the
 * objective is X and the trailing clause qualifies it, whatever X and Y mean.
 *
 * ⛔⛔ THIS LIST IS CLOSED, AND EVERY EXCLUSION BELOW WAS MEASURED, NOT ASSUMED.
 * Adding a member is a predicate change over natural language and carries the
 * full risk of one regardless of diff size (CLAUDE.md trap 22d). The exclusions,
 * each run before being rejected:
 *
 *   - `but`  — bought NOTHING on any governed brief and broke two real
 *              constructions: *"eliminate nothing but waste"* → "Eliminate
 *              nothing", *"cut all but essential spend"* → "Cut all". `but` is
 *              both a coordinator and half of a quantifier idiom, with no
 *              structural discriminator at this layer. Trap 22f's "genuinely
 *              ambiguous" condition — the exit is to leave it, NOT to add a
 *              length constant with a hard cliff either side.
 *   - `and`  — drops a CO-EQUAL objective (*"grow revenue and cut churn"* →
 *              "Grow revenue"). This is the exact predicate on which this estate
 *              lost FOUR consecutive rounds. Not reopened.
 *   - `within` / `so that` — a deadline is part of the objective's specification.
 *              Adding `within` re-truncates four of the very governed briefs this
 *              fix repairs (02, 09, 11, 12). Measured.
 *
 * All four exclusions are pinned in `cee.goal-objective-clause-boundary.test.ts`
 * under KNOWN-UNHANDLED, so this set REDs if it grows OR shrinks.
 */
export const TRAILING_QUALIFIER_CONNECTIVES = ["without", "while", "whilst"] as const;

/**
 * ⛔⛔ `a while` IS A NOUN — the determiner guard, and why it is a FIX and not a
 * KNOWN-UNHANDLED entry.
 *
 * The first cut of this fix sliced straight through `a while`. In *"pause the
 * rollout for a while before deciding"*, `while` is a NOUN inside the noun
 * phrase `a while`, not a subordinating conjunction, and the boundary produced
 * *"Pause the rollout for a"* — a label ending on a bare determiner. Five for
 * five, all NEW harms, in the direction this module calls the worse one.
 *
 * ⭐ THE DISTINCTION THAT DECIDES FIX-VS-PIN, because it is easy to get backwards.
 * `but` sits in KNOWN-UNHANDLED because it was MEASURED that no structural
 * discriminator separates the coordinator (*"X but keep Y"*) from the quantifier
 * idiom (*"nothing but"*). Here a discriminator DOES exist — a determiner
 * immediately before the connective — and it fixes 5/5, leaves the live case
 * untouched, and regresses nothing across the 16 governed briefs. Trap 22f's
 * *"genuinely ambiguous, so leave it"* exit is EARNED BY MEASUREMENT, never
 * claimed by analogy from a neighbouring member of the same list.
 */
const DETERMINER_BEFORE_CONNECTIVE = "(?<!\\b(?:a|an|the))";

/**
 * Cut an extracted objective at the first trailing-qualifier connective.
 *
 * ⚠ THE OPPOSITE-DIRECTION HARM, and why the floor below is not decoration.
 * Two harms sit under this one predicate and they cannot share one window: trim
 * too little and a constraint is swallowed into the objective; trim too much and
 * a legitimate objective is TRUNCATED — the WORSE harm, because a truncated
 * objective reads as a complete one.
 *
 * ⚠⚠ THE FLOOR IS STRUCTURAL, NOT A CHARACTER COUNT — corrected under review.
 * This first shipped reusing the module's 5-character minimum, on the reasoning
 * that an existing constant beats an invented one. That was the right instinct
 * and the wrong constant: it made `"Scale"` (5) survive while `"Grow"` (4) did
 * not, so the outcome turned on SPELLING. That is exactly the *"length constant
 * with a hard cliff either side"* this module's own header cites trap 22f to
 * reject — the defect was in the guard written to prevent it. A token count is
 * structural and belongs beside a CLAUSE-boundary question: an objective reduced
 * to one bare token has lost its object, whatever its length.
 *
 * ⚠ ONLY THE TRAILING-PUNCTUATION LIMB MAY RUN AFTER THE TRIM. `cleanGoalText`'s
 * prefix strip is NON-GLOBAL and therefore NOT idempotent, so running the whole
 * cleaner again strips a SECOND prefix and changes labels on briefs carrying no
 * connective at all — a silent change outside this fix's scope.
 */
function trimTrailingQualifier(text: string): string {
  const boundary = new RegExp(
    `${DETERMINER_BEFORE_CONNECTIVE}\\s+(?:${TRAILING_QUALIFIER_CONNECTIVES.join("|")})\\s+\\S.*$`,
    "i",
  );
  const trimmed = text.replace(boundary, "").replace(/[.,;:!?]+$/, "").trim();
  return countTokens(trimmed) >= MIN_GOAL_LABEL_TOKENS ? trimmed : text;
}

function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * A trimmed objective must retain at least a verb and its object. Structural,
 * deliberately not a character threshold — see `trimTrailingQualifier`.
 */
const MIN_GOAL_LABEL_TOKENS = 2;

/**
 * The module's existing viability bounds for an inferred label, named so the
 * acceptance check cannot drift (CLAUDE.md trap 12). UNCHANGED from pristine —
 * these arbitrate whether an extraction is usable at all, which is a different
 * question from where a clause ends.
 */
const MIN_GOAL_LABEL_LENGTH = 5;
const MAX_GOAL_LABEL_LENGTH = 200;

/**
 * Default placeholder goal when no objective can be inferred
 */
export const DEFAULT_GOAL_LABEL = "Achieve the best outcome for this decision";

/**
 * Result of goal inference
 */
export interface GoalInferenceResult {
  /** Whether a goal was found/inferred */
  found: boolean;
  /** The inferred goal label */
  label: string;
  /**
   * ⚠ TELEMETRY ONLY — NOT AN ATTRIBUTION BADGE, AND NEVER PUT ONE ON A NODE.
   *
   * `"brief"` here means only "a regex matched brief text", i.e. WHERE THE
   * CHARACTERS CAME FROM. It does NOT mean the user designated this as their
   * goal, and it is deliberately NOT the field any consumer reads to decide
   * authorship. It reaches exactly two places, both diagnostic: the
   * `CeeGoalInferred` telemetry event and a log line
   * (`unified-pipeline/stages/repair/connectivity.ts:60-75`).
   *
   * The node's authorship badge is {@link MINTED_GOAL_PROVENANCE}, which says
   * `projector_structural` + `label_authored` for BOTH limbs. Wiring this
   * string to a user-facing attribution is the defect
   * `cee.goal-inference-attribution.test.ts` exists to prevent — `"brief"`
   * reads like the user's badge and is not one.
   */
  source: "brief" | "placeholder" | "explicit";
  /** The matched pattern (for debugging) */
  matchedPattern?: string;
}

/**
 * Infer a goal from a decision brief
 *
 * @param brief - The user's decision brief
 * @returns The inferred goal result
 */
export function inferGoalFromBrief(brief: string): GoalInferenceResult {
  if (!brief || typeof brief !== "string") {
    return {
      found: false,
      label: DEFAULT_GOAL_LABEL,
      source: "placeholder",
    };
  }

  // Try each pattern
  for (const pattern of GOAL_PATTERNS) {
    const match = brief.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      // Clean up the extracted text, then cut it at the objective's clause
      // boundary so a trailing qualifier is not carried into the goal.
      const cleaned = trimTrailingQualifier(cleanGoalText(extracted));
      if (cleaned.length >= MIN_GOAL_LABEL_LENGTH && cleaned.length <= MAX_GOAL_LABEL_LENGTH) {
        return {
          found: true,
          label: capitalizeFirst(cleaned),
          source: "brief",
          matchedPattern: pattern.source,
        };
      }
    }
  }

  // No pattern matched, return placeholder
  return {
    found: false,
    label: DEFAULT_GOAL_LABEL,
    source: "placeholder",
  };
}

/**
 * Clean up extracted goal text
 */
function cleanGoalText(text: string): string {
  return text
    // Remove trailing punctuation
    .replace(/[.,;:!?]+$/, "")
    // Remove leading articles/prepositions if they're the whole prefix
    .replace(/^(?:a |an |the |to |for |in |on |by )/i, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Create a goal node with standard structure
 */
export function createGoalNode(
  label: string,
  id: string = "goal_inferred",
  provenance?: RecordProvenance
): {
  id: string;
  kind: "goal";
  label: string;
  provenance?: RecordProvenance;
} {
  return {
    id,
    kind: "goal",
    label,
    ...(provenance ? { provenance } : {}),
  };
}

/**
 * ⭐ THE ONE CONSTRUCTOR FOR AN `outcome|risk → goal` EDGE.
 *
 * Extracted from `wireOutcomesToGoal` (its only caller until now) because
 * `enforceSingleGoal` needs the identical edge when it demotes a non-primary
 * objective to an outcome node (quality bar §8 A3). Two sites building the same
 * edge shape from two literals is the hand-maintained mirror this estate keeps
 * paying for (CLAUDE.md trap 12): the magnitudes would drift and nothing would
 * go red. There is one literal, and both callers read it.
 *
 * The shape is UNCHANGED from what this module has always emitted — this is a
 * pure extraction, asserted by the callers' own suites.
 */
export function buildOutcomeToGoalEdge(
  nodeId: string,
  goalId: string,
  kind: string | undefined,
): Record<string, unknown> {
  const isRisk = kind === "risk";
  return {
    from: nodeId,
    to: goalId,
    // Use flat field names to match V3 transform expectations
    // (edges added here bypass LLM normalisation which flattens strength.mean)
    strength_mean: isRisk ? -0.5 : 0.7,
    strength_std: 0.15,
    belief_exists: 0.9,
    effect_direction: isRisk ? ("negative" as const) : ("positive" as const),
    origin: "default" as const,
    provenance: {
      source: "synthetic",
      quote: `Wired ${kind} to goal (synthetic edge)`,
    },
    provenance_source: "synthetic",
  };
}

/**
 * Wire outcomes and risks to a goal node
 *
 * @param graph - The graph to modify
 * @param goalId - The ID of the goal node to wire to
 * @param collector - Optional correction collector for tracking
 * @returns Modified graph with outcome/risk edges to goal
 */
export function wireOutcomesToGoal(
  graph: GraphV1,
  goalId: string,
  collector?: CorrectionCollector
): GraphV1 {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return graph;
  }

  const outcomeAndRiskIds = new Set<string>();
  for (const node of graph.nodes) {
    const kind = (node as any).kind as string | undefined;
    const id = (node as any).id as string | undefined;
    if (id && (kind === "outcome" || kind === "risk")) {
      outcomeAndRiskIds.add(id);
    }
  }

  // Check which outcomes/risks already have edges to goal
  const alreadyWired = new Set<string>();
  for (const edge of graph.edges as any[]) {
    if (edge.to === goalId && outcomeAndRiskIds.has(edge.from)) {
      alreadyWired.add(edge.from);
    }
  }

  // Add missing edges
  const newEdges = [...(graph.edges as any[])];
  for (const nodeId of outcomeAndRiskIds) {
    if (!alreadyWired.has(nodeId)) {
      // Determine if outcome (positive) or risk (negative)
      const node = graph.nodes.find((n: any) => n.id === nodeId);
      const kind = (node as any)?.kind;

      const newEdge = buildOutcomeToGoalEdge(nodeId, goalId, kind) as {
        strength_mean: number;
      };

      newEdges.push(newEdge);

      // Record correction for added edge (Stage 18: Outcome→Goal Wiring)
      if (collector) {
        collector.addByStage(
          18, // Stage 18: Outcome→Goal Wiring
          "edge_added",
          { edge_id: formatEdgeId(nodeId, goalId) },
          `Wired ${kind} node to goal (missing edge)`,
          undefined,
          { from: nodeId, to: goalId, strength_mean: newEdge.strength_mean }
        );
      }
    }
  }

  return {
    ...graph,
    edges: newEdges,
  } as GraphV1;
}

/**
 * Check if a graph has a goal node
 */
export function hasGoalNode(graph: GraphV1 | undefined): boolean {
  if (!graph || !Array.isArray(graph.nodes)) {
    return false;
  }
  return graph.nodes.some((node: any) => node.kind === "goal");
}

/**
 * Add a goal node to a graph if missing
 *
 * @param graph - The graph to potentially modify
 * @param brief - The user's decision brief (for inference)
 * @param explicitGoal - Optional explicit goal from context.goals
 * @param collector - Optional correction collector for tracking
 * @returns Object with modified graph and metadata about the operation
 */
export function ensureGoalNode(
  graph: GraphV1,
  brief: string,
  explicitGoal?: string,
  collector?: CorrectionCollector
): {
  graph: GraphV1;
  goalAdded: boolean;
  goalNodeId?: string;
  inferredFrom?: "brief" | "placeholder" | "explicit";
} {
  if (!graph || !Array.isArray(graph.nodes)) {
    return { graph, goalAdded: false };
  }

  // Check if goal already exists
  if (hasGoalNode(graph)) {
    return { graph, goalAdded: false };
  }

  // Use explicit goal if provided
  if (explicitGoal && typeof explicitGoal === "string" && explicitGoal.trim().length > 0) {
    const goalNode = createGoalNode(explicitGoal.trim(), "goal_explicit");
    const graphWithGoal = {
      ...graph,
      nodes: [...(graph.nodes as any[]), goalNode],
    } as GraphV1;

    // Record correction for added goal node (Stage 17: Goal Inference)
    if (collector) {
      collector.addByStage(
        17, // Stage 17: Goal Inference
        "node_added",
        { node_id: goalNode.id, kind: "goal" },
        "Goal node added from explicit context",
        undefined,
        { id: goalNode.id, kind: "goal", label: goalNode.label }
      );
    }

    return {
      graph: wireOutcomesToGoal(graphWithGoal, goalNode.id, collector),
      goalAdded: true,
      goalNodeId: goalNode.id,
      inferredFrom: "explicit",
    };
  }

  // Infer goal from brief
  const inference = inferGoalFromBrief(brief);
  // ⛔ BOTH LIMBS ARE CEE'S CHOICE, so both are badged. The regex limb carries
  // the user's WORDS but not their designation — "we want to cut paid
  // acquisition" names an OPTION, and lifting it as the goal is CEE deciding
  // what the user was aiming at. The placeholder limb is pure invention. In
  // neither case did the user author A GOAL, which is the claim the badge makes.
  const goalNode = createGoalNode(inference.label, "goal_inferred", MINTED_GOAL_PROVENANCE);
  const graphWithGoal = {
    ...graph,
    nodes: [...(graph.nodes as any[]), goalNode],
  } as GraphV1;

  // Record correction for added goal node (Stage 17: Goal Inference)
  if (collector) {
    collector.addByStage(
      17, // Stage 17: Goal Inference
      "node_added",
      { node_id: goalNode.id, kind: "goal" },
      `Goal node inferred from ${inference.source}`,
      undefined,
      { id: goalNode.id, kind: "goal", label: goalNode.label }
    );
  }

  return {
    graph: wireOutcomesToGoal(graphWithGoal, goalNode.id, collector),
    goalAdded: true,
    goalNodeId: goalNode.id,
    inferredFrom: inference.source,
  };
}
