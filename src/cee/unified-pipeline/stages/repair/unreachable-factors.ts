/**
 * Unreachable Factor Handling
 *
 * Called from within the deterministic sweep (Task 2, step 7).
 *
 * Identifies factor nodes with zero inbound option→factor edges,
 * reclassifies them as "external", and checks goal reachability.
 * Factors without a path to goal are marked droppable (never removed).
 */

import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
// The single reachability kernel. This module previously carried a private
// byte-duplicate of `status-quo-fix.ts`'s `hasPathToGoal`, and neither filtered
// `edge_type` — so a bidirected edge (an unmeasured confounder, never a causal
// path) counted as a route to the goal, and the wiring decision below disagreed
// with the validators that judge it.
import { canReachAnyGoal as hasPathToGoal } from "../../../../graph/reachability.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { neutralCausalEdge } from "../../utils/edge-format.js";
import { log } from "../../../../utils/telemetry.js";
import { fieldDeletion, type FieldDeletionEvent } from "../../utils/field-deletion-audit.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnreachableFactorRepair {
  code: string;
  path: string;
  action: string;
  /** Set when a prior was synthesised from the original data.value during reclassification */
  prior_synthesised?: boolean;
  /** The synthesised prior range (only present when prior_synthesised is true) */
  synthesised_range?: { range_min: number; range_max: number };
}

export interface UnreachableFactorResult {
  reclassified: string[];
  markedDroppable: string[];
  repairs: UnreachableFactorRepair[];
  edgesAdded: EdgeT[];
  fieldDeletions: FieldDeletionEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a set of factor IDs that have at least one inbound option→factor edge.
 */
function buildReachableFactorSet(
  nodes: readonly NodeT[],
  edges: readonly EdgeT[],
): Set<string> {
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  const reachable = new Set<string>();
  for (const edge of edges) {
    if (
      nodeKindMap.get(edge.from) === "option" &&
      nodeKindMap.get(edge.to) === "factor"
    ) {
      reachable.add(edge.to);
    }
  }
  return reachable;
}

/**
 * Find the most commonly targeted outcome/risk node by other factors.
 */
function _findMostCommonOutcomeRiskTarget(
  nodes: readonly NodeT[],
  edges: readonly EdgeT[],
): string | undefined {
  const outcomeRiskIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "outcome" || node.kind === "risk") {
      outcomeRiskIds.add(node.id);
    }
  }

  const targetCounts = new Map<string, number>();
  for (const edge of edges) {
    if (outcomeRiskIds.has(edge.to)) {
      targetCounts.set(edge.to, (targetCounts.get(edge.to) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [id, count] of targetCounts) {
    if (count > bestCount) {
      bestCount = count;
      best = id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Prior synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesise a uniform prior from a known baseline value when reclassifying
 * a factor from observable/controllable to external.
 *
 * Margin calculation:
 *   margin = max(0.1, value * 0.5)
 *   — gives at least ±0.1 spread, or ±50% of the baseline for larger values.
 *
 * Special cases:
 *   - Binary values (exactly 0 or 1): full uncertainty [0.0, 1.0]
 *   - Values above 1 are RATIO SCALE, not out-of-domain — see below.
 *   - Unit-interval ranges clamped to [0, 1].
 *
 * ⚠⚠ THE INVARIANT THIS FUNCTION MUST NOT BREAK (PR1 / frontier comparison
 * 2026-08-10): A SYNTHESISED PRIOR MUST CONTAIN THE VALUE IT WAS SYNTHESISED
 * FROM. `range_min <= value <= range_max`, always. A distribution whose support
 * EXCLUDES its own baseline is incoherent by construction, whatever the margin
 * doctrine says.
 *
 * It was broken here, and the cost was measured. This function previously
 * short-circuited EVERY `value >= 1` to `[0, 1]`, calling it "out-of-domain"
 * and guarding "defensively" against upstream normalisation failure. But a
 * value above 1 is not a normalisation failure — the LIVE DRAFT PROMPT
 * MANDATES it. `prompts/defaults-v187.ts:299` declares, in its MODEL UNIT
 * TYPES table, "Ratio that can exceed 100% | raw ratio | NRR 110% → 1.10", and
 * repeats it as a contrastive example (:551-553) with the WRONG encoding
 * spelled out as `0.11`. So the drafter emits `1.12` for "our NRR is 112%",
 * exactly as instructed, and this stage then classified that compliant value as
 * out-of-domain and discarded it.
 *
 * The measured consequence on the deployed B1 graph (`fac_nrr`, captured at
 * `cee/context-integrity/__tests__/fixtures/b1-growth.cold-read.json`): the
 * user's stated figure became a MAXIMUM-WIDTH `[0,1]` prior; the widest prior
 * tops ISL's influence ranking; the product then reported NRR as the strongest
 * driver and served an evidence card asking the user to go and collect the
 * number they had already given it. **The loss inverts the analysis: what you
 * told it becomes what it says you don't know.**
 *
 * Two scales, and the difference is the whole fix:
 *   - UNIT-INTERVAL (0 < value < 1): unchanged. Same margin, same [0,1] clamp.
 *     Every computed number on this path is byte-identical to before.
 *   - RATIO (value > 1): the same ±50% margin with NO upper clamp, because
 *     there is no ceiling to clamp to — `DECLARED_SCALE_BOUNDS.ratio` is
 *     `{min: 0, max: null}` in the vendored contract.
 *   - value <= 0: `[0, 1]` is retained. It already SATISFIES containment at
 *     exactly 0, and a negative baseline is a genuine upstream fault this
 *     function must not paper over by inventing a negative support.
 */
function synthesisePriorFromBaseline(value: number): { range_min: number; range_max: number } {
  // Non-positive: [0,1] already contains 0, and a negative baseline is an
  // upstream fault, not something to model.
  if (value <= 0) {
    return { range_min: 0.0, range_max: 1.0 };
  }
  const margin = Math.max(0.1, value * 0.5);
  // RATIO SCALE. No upper clamp — clamping to 1 is what excluded the baseline.
  if (value > 1) {
    return { range_min: Math.max(0, value - margin), range_max: value + margin };
  }
  // UNIT INTERVAL. Unchanged doctrine; `value === 1` keeps its [0,1] band,
  // which contains 1 and therefore already satisfies the invariant.
  if (value === 1) {
    return { range_min: 0.0, range_max: 1.0 };
  }
  return {
    range_min: Math.max(0, value - margin),
    range_max: Math.min(1, value + margin),
  };
}

/**
 * The DECLARED scale of a factor's value — stamped by the producer that knows
 * it, never inferred by a consumer that does not.
 *
 * That ruling is the vendored contract's own (`@talchain/schemas` 0.31.0
 * additive, ROADMAP 2.193, the fix path for 2.159): the #766 review proved no
 * derivation from the CURRENT VALUE can be sound in either direction, because
 * a `0` or a `1` is a legal raw count AND a legal proportion. So a classifier
 * cannot be built from the value alone — but a PRODUCER that also holds the
 * unit and the normalisation cap can declare it, and this stage holds both.
 *
 * ⚠ FAIL OPEN, AND ONLY HERE. Absence means UNDECLARED, which is every graph
 * drafted before the field existed. Where this producer does not know the
 * scale it stamps NOTHING — a defaulted declaration is a manufactured
 * attestation, and the contract is explicit that a consumer must not read
 * absence as `unit_interval`.
 *
 * Returns a `DeclaredScale` literal or undefined. Deliberately NOT typed
 * against a local string union: the vocabulary belongs to the contract.
 */
function declaredScaleOf(
  value: number,
  unit: string | undefined,
  cap: number | undefined,
  rawValue: number | undefined,
): "unit_interval" | "ratio" | undefined {
  if (!Number.isFinite(value)) return undefined;
  // A percentage-style metric carrying a value above 1 is the ratio case the
  // draft prompt mandates ("can this metric meaningfully exceed 100%?").
  if (unit === "%" && value > 1) return "ratio";
  const inUnitInterval = value >= 0 && value <= 1;
  if (!inUnitInterval) return undefined;
  // NORMALISATION EVIDENCE, not a guess about the value. The enricher mints
  // `value = raw_value / cap` and stores all three together
  // (`factor-extraction/enricher.ts`), so EITHER a cap, OR a raw magnitude that
  // differs from the value, is a producer-side fact that this value is a
  // proportion. The contract's warning (2.193) is that the VALUE ALONE cannot
  // be classified — a bare `0` or `1` is a legal count and a legal proportion.
  // The relationship between value and raw_value is different evidence, and it
  // is the evidence this producer actually holds.
  if (cap !== undefined) return "unit_interval";
  if (rawValue !== undefined && rawValue !== value) return "unit_interval";
  // A percentage within the unit interval is a proportion.
  if (unit === "%") return "unit_interval";
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Handle unreachable factors in the graph.
 *
 * 1. Identify factors with zero inbound option→factor edges
 * 2. Reclassify as category: "external"
 * 3. Check if reclassified factor has path to goal
 * 4. If no path: try to wire through existing outcome/risk
 * 5. If still no path: mark as droppable (never remove)
 */
export function handleUnreachableFactors(
  graph: GraphT,
  format: EdgeFormat,
): UnreachableFactorResult {
  const nodes = (graph as any).nodes as NodeT[];
  const edges = (graph as any).edges as EdgeT[];

  const reachableFactors = buildReachableFactorSet(nodes, edges);
  const goalIds = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "goal") goalIds.add(node.id);
  }

  const reclassified: string[] = [];
  const markedDroppable: string[] = [];
  const repairs: UnreachableFactorRepair[] = [];
  const edgesAdded: EdgeT[] = [];
  const deletions: FieldDeletionEvent[] = [];

  // Also consider factors reachable via factor→factor chains from option-connected factors
  const transitivelyReachable = new Set<string>(reachableFactors);
  const factorForward = new Map<string, string[]>();
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    nodeKindMap.set(node.id, node.kind);
  }
  for (const edge of edges) {
    if (
      nodeKindMap.get(edge.from) === "factor" &&
      nodeKindMap.get(edge.to) === "factor"
    ) {
      const list = factorForward.get(edge.from) ?? [];
      list.push(edge.to);
      factorForward.set(edge.from, list);
    }
  }
  // BFS from reachable factors through factor→factor edges
  const queue = [...reachableFactors];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of factorForward.get(current) ?? []) {
      if (!transitivelyReachable.has(next)) {
        transitivelyReachable.add(next);
        queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    if (transitivelyReachable.has(node.id)) continue;

    // This factor is unreachable from options — reclassify as external
    (node as any).category = "external";
    reclassified.push(node.id);

    // Capture original data.value before stripping — needed for prior synthesis.
    const data = (node as any).data;
    const originalValue: number | undefined =
      data && typeof data.value === "number" ? data.value : undefined;

    // Strip data.value when reclassifying to external — that is the only invariant
    // violation. factor_type, uncertainty_drivers, and extractionType are metadata
    // fields that remain useful for downstream enrichment. Promote them to node level
    // (NodeV3 passthrough preserves them) before potentially removing data.
    if (data) {
      if (data.value !== undefined) deletions.push(fieldDeletion('unreachable-factors', node.id, 'data.value', 'UNREACHABLE_FACTOR_RECLASSIFIED'));
      delete data.value;
      if (data.factor_type !== undefined) {
        (node as any).factor_type = data.factor_type;
      }
      if (data.extractionType !== undefined) {
        (node as any).extractionType = data.extractionType;
      }
      if (data.uncertainty_drivers !== undefined) {
        (node as any).uncertainty_drivers = data.uncertainty_drivers;
      }
      if (data.encoding_map !== undefined) {
        (node as any).encoding_map = data.encoding_map;
      }

      // ── THE STATED QUANTITY SURVIVES (PR1 / frontier comparison 2026-08-10) ──
      //
      // `data` is deleted a few lines below, and the user's own figure went
      // with it. Measured on the deployed captures: EVERY reclassified factor
      // in all three trace briefs reached the wire with `unit=undefined
      // raw_value=undefined`, which is why the canvas rendered "Current ARR —
      // Range: 0.28 to 0.84" for a stated £11.2m and "Available Cash — Range
      // 0.31 to 0.93" for a stated £3.1m. A user cannot recognise their own
      // business in a normalised 0–1 factor.
      //
      // These promote to NODE level for the same reason `factor_type` and
      // `uncertainty_drivers` already do: the V1→V3 transform rebuilds the node
      // FIELD BY FIELD (`transforms/schema-v3.ts:197`), so anything left on a
      // deleted `data` is dropped with no error anywhere. `raw_value`, `cap`
      // and `unit` are all declared on the shared node schema, so they survive
      // the strict re-parse.
      //
      // ⚠ NONE OF THIS READS THE BRIEF. Every value here was already extracted
      // by the pipeline and is merely being carried instead of deleted. Reading
      // a number out of free-brief prose and presenting it back as the user's
      // own statement is the ROADMAP 2.714 defect class, reverted 8 Aug 2026
      // and guarded by `transforms/__tests__/no-brief-derived-user-override.writers.test.ts`.
      if (data.raw_value !== undefined) {
        (node as any).raw_value = data.raw_value;
      }
      if (data.cap !== undefined) {
        (node as any).cap = data.cap;
      }

      const scale = declaredScaleOf(originalValue ?? NaN, data.unit, data.cap, data.raw_value);
      if (scale !== undefined) {
        (node as any).declared_scale = scale;
      }

      // ⚠ THE UNIT IS WITHHELD ON RATIO SCALE, DELIBERATELY, AND IT IS RECORDED.
      //
      // `schema-v3.ts:411` reads node-level `unit` to synthesise an external
      // factor's display string, and `factor-extraction/display-value.ts`
      // resolves a '%' bound by MAGNITUDE SNIFF: `n >= 0 && n <= 1 ? n * 100 : n`.
      // On a ratio-scale prior of [0.56, 1.68] that renders "56% to 1.68%" —
      // replacing a silent omission with a confidently wrong number, which is
      // the worse of the two defects. The '%' unit has meant two different
      // things in this estate (fraction vs percentage points) and has already
      // cost real defects; the ruling is producer-side disambiguation, and the
      // producer-side answer is `declared_scale` above.
      //
      // So: stamp the scale, withhold the rendering, and make the withholding
      // VISIBLE as an open modelling issue rather than a blank. The formatter
      // fix belongs in `display-value.ts`, which is frozen for this lane.
      const withholdUnit = scale === "ratio";
      if (data.unit !== undefined && !withholdUnit) {
        (node as any).unit = data.unit;
      } else if (data.unit !== undefined && withholdUnit) {
        repairs.push({
          code: "STATED_UNIT_WITHHELD_RATIO_SCALE",
          path: `nodes[${node.id}].unit`,
          action:
            `Stated unit "${data.unit}" withheld from display on ratio-scale factor ` +
            `"${node.label ?? node.id}" (value ${originalValue}): the '%' formatter ` +
            `resolves bounds by magnitude and would render this range as a fraction. ` +
            `declared_scale="ratio" is stamped; the value is preserved, not dropped.`,
        });
      }
      // If remaining data has no semantically valid union key, remove the property
      // so DraftGraphOutput.parse() doesn't fail on a partial object.
      // Use type+content checks (not key-presence) to prevent sentinel artefacts
      // like interventions: [] from keeping data alive.
      const hasInterventions = data.interventions && typeof data.interventions === 'object'
        && !Array.isArray(data.interventions) && Object.keys(data.interventions).length > 0;
      const hasOperator = typeof data.operator === 'string';
      const hasValue = typeof data.value === 'number';
      if (!hasInterventions && !hasOperator && !hasValue) {
        deletions.push(fieldDeletion('unreachable-factors', node.id, 'data', 'UNREACHABLE_FACTOR_RECLASSIFIED'));
        delete (node as any).data;
      }
    }

    // Synthesise a prior from the original baseline value so the reclassified
    // external factor arrives at ISL with a meaningful distribution instead of
    // intercept=0. Without this, any constraint targeting the node evaluates
    // trivially (P=1.0 or P=0.0 depending on operator).
    const repair: UnreachableFactorRepair = {
      code: "UNREACHABLE_FACTOR_RECLASSIFIED",
      path: `nodes[${node.id}].category`,
      action: `Reclassified unreachable factor "${node.label ?? node.id}" to external`,
    };

    if (originalValue !== undefined) {
      const { range_min, range_max } = synthesisePriorFromBaseline(originalValue);
      (node as any).prior = {
        distribution: "uniform",
        range_min,
        range_max,
      };
      repair.prior_synthesised = true;
      repair.synthesised_range = { range_min, range_max };
      repair.action += ` with synthesised prior [${range_min}, ${range_max}]`;

      log.info({
        event: "cee.repair.prior_synthesised_from_baseline",
        node_id: node.id,
        original_value: originalValue,
        range_min,
        range_max,
      }, `Synthesised prior for reclassified factor "${node.id}" from baseline ${originalValue}`);
    }

    repairs.push(repair);

    // Check if factor has path to goal
    if (hasPathToGoal(node.id, edges, goalIds)) {
      // Factor is valid as external — has path to goal
      continue;
    }

    // Check if any existing outcome/risk is reachable from this factor
    let wiredToGoal = false;
    for (const edge of edges) {
      if (edge.from === node.id && (nodeKindMap.get(edge.to) === "outcome" || nodeKindMap.get(edge.to) === "risk")) {
        // Factor→outcome/risk edge exists. Check if that outcome/risk reaches goal.
        if (!hasPathToGoal(edge.to, edges, goalIds)) {
          // Wire outcome/risk→goal
          const goalId = [...goalIds][0];
          if (goalId) {
            const newEdge = neutralCausalEdge(format, {
              from: edge.to,
              to: goalId,
              sign: nodeKindMap.get(edge.to) === "risk" ? "negative" : "positive",
            });
            (graph as any).edges.push(newEdge);
            edgesAdded.push(newEdge);
            wiredToGoal = true;
            repairs.push({
              code: "UNREACHABLE_FACTOR_WIRED_TO_GOAL",
              path: `edges[${edge.to}→${goalId}]`,
              action: `Wired ${nodeKindMap.get(edge.to)} "${edge.to}" to goal to connect unreachable factor "${node.id}"`,
            });
          }
        } else {
          wiredToGoal = true;
        }
        break;
      }
    }

    if (wiredToGoal) {
      // Re-check after wiring
      if (hasPathToGoal(node.id, (graph as any).edges, goalIds)) {
        continue;
      }
    }

    // Still no path to goal — mark as droppable but do NOT remove
    markedDroppable.push(node.id);
    repairs.push({
      code: "UNREACHABLE_FACTOR_RETAINED",
      path: `nodes[${node.id}]`,
      action: `External factor "${node.label ?? node.id}" has no path to goal — user should connect or remove`,
    });
  }

  return { reclassified, markedDroppable, repairs, edgesAdded, fieldDeletions: deletions };
}
