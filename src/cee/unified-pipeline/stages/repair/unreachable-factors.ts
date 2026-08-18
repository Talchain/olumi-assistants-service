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
// The canonical unit classifier — the question "does this unit denote a
// dimension?" already has one answer in this service, and this is it.
import { readUnit } from "../../../provenance/stated-amounts.js";
import {
  factorValueIsFabricated,
  FACTOR_VALUE_TIER_FIELD,
} from "../../../provenance/factor-value-provenance.js";
import { thousands } from "../../../../orchestrator-v5/compose/format-factor-value.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnreachableFactorRepair {
  code: string;
  path: string;
  action: string;
  /** Set when a prior was synthesised from the original data.value during reclassification */
  prior_synthesised?: boolean;
  /**
   * TRUE when the prior is an admission of ignorance rather than an estimate —
   * the baseline it came from was a system default, so the range was left at
   * maximal `[0,1]` instead of being narrowed.
   *
   * ⚠ CORRECTED — this said "Read by any surface that must label the number".
   * NOTHING reads it. It is PIPELINE-INTERNAL and is dropped at the boundary:
   * it is not a member of `ModelAdjustment` (`schemas/analysis-ready.ts`), and
   * `stages/boundary.ts:157-179` projects only `code`, `node_id`, `field`,
   * `reason`, `source` and `before`.
   *
   * ⭐ WHAT DOES REACH THE USER is the prose on `action`, which `boundary.ts:168`
   * copies into `reason` — that is the disclosure, and it is what the tests pin.
   * This flag is the machine-readable twin, kept for the surface that will label
   * the range once one exists (quality bar Q5's HARD render rule), and honestly
   * unread until then.
   */
  prior_is_unquantified?: boolean;
  /** The synthesised prior range (only present when prior_synthesised is true) */
  synthesised_range?: { range_min: number; range_max: number };

  // ── THE PRESERVATION CONTRACT (S2) ───────────────────────────────────────
  // A stage may TRANSFORM a value; it may not DELETE one without declaring
  // what it removed, in a form that reaches the user's receipt.
  //
  // These three fields exist so `boundary.ts` can fill `ModelAdjustment.before`
  // — a field DECLARED at `src/schemas/analysis-ready.ts:200` that this path has
  // never populated. A declared field with no projection line is the estate's
  // named P0 shape, and this is the line.
  //
  // ⚠ `ModelAdjustment` IS CEE-LOCAL, NOT PART OF THE SHARED CONTRACT — an
  // earlier version of this comment said "the shared contract" and that is
  // false. Measured with positive controls: ZERO matches in
  // `@talchain/schemas` 0.39.0 as VENDORED HERE (control: `GraphV3`, 13 files)
  // and ZERO in `olumi-schemas` main (control: `GoalThresholdFrame`, 4 files).
  // The conclusion is unchanged — no contract change is needed — but the REASON
  // matters to the UI lane that has to reconcile this shape: it is reconciling
  // against a CEE-owned type it cannot find in the schemas package.
  /** `data.value` as held at deletion — cap-normalised, NOT a magnitude. */
  deleted_value?: number;
  /** The magnitude the normalised value stood for (e.g. 1800000). */
  deleted_raw_value?: number;
  /** The unit that made the magnitude meaningful (e.g. '£'). */
  deleted_unit?: string;
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
 * Render a magnitude the way the user would recognise it, or NULL.
 *
 * NULL is a first-class answer: with nothing a reader would recognise, the
 * receipt stays quiet. Over-declaring is noise; under-declaring is the defect —
 * but the AUDIT records every deletion regardless, so nothing is lost, only
 * unsaid.
 *
 * ── TWO CONDITIONS, WRITTEN AGAINST THE SPEC ───────────────────────────────
 * The sentence exists to show the user the figure THEY would recognise. That
 * needs a magnitude that is
 *
 *   (1) DISTINCT from the pipeline's normalised value — otherwise `raw_value`
 *       IS the ratio and we are echoing an internal number back; and
 *   (2) DIMENSIONED — a number with no unit that means anything is not a
 *       figure, it is a coordinate.
 *
 * ⚠ AN EARLIER VERSION GUARDED ONLY `raw_value !== undefined && unit !==
 * undefined`, WHICH CONTRADICTED ITS OWN COMMENT. Measured on the deployed
 * captures (17 distinct `(value, raw_value, unit)` triples across seven runs),
 * that guard produced *"The extracted value 0.5 scale is not used in the
 * maths"* — `raw_value === value === 0.5`, literally the case the comment
 * called noise — and *"50 scale"*. Nine of the seventeen have
 * `raw_value === value`, and `scale` is the drafter's marker for a
 * dimensionless factor.
 *
 * Condition (2) is DERIVED, not hand-listed: `readUnit` is the canonical unit
 * classifier this service already uses for exactly this question, and it
 * resolves `scale`, `users` and `""` to `plain` while resolving `£`, `€`, `EUR`
 * and `%` to a dimension. A local list of "units that count" would be the
 * fifteenth such copy and would drift the moment the alphabet moved.
 *
 * ⚠ NO `toLocaleString`. Its grouping depends on the host's ICU data and
 * default locale, so the same input can render `1,800,000` on one box and
 * `1 800 000` on another — a user-visible string that differs by deployment
 * environment is untestable by construction. Grouping is done explicitly.
 */
export function formatStatedMagnitude(
  rawValue: number | undefined,
  normalisedValue: number | undefined,
  unit: string | undefined,
): string | null {
  if (rawValue === undefined || !Number.isFinite(rawValue)) return null;
  if (unit === undefined || unit.length === 0) return null;
  // (1) DISTINCT — `raw_value === value` means nothing was un-normalised.
  if (normalisedValue !== undefined && rawValue === normalisedValue) return null;
  // (2) DIMENSIONED — derived from the canonical classifier, never a local list.
  if (readUnit(unit).kind === "plain") return null;

  const negative = rawValue < 0;
  const abs = Math.abs(rawValue);
  // Keep at most two decimals, then drop a trailing ".00"/".x0".
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace(/\.?0+$/, "");
  const [whole, fraction] = fixed.split(".");
  // The grouping rule is `orchestrator-v5/compose/format-factor-value.ts`'s
  // `thousands` — imported, not re-spelled (CLAUDE.md trap 12). The two-decimal
  // rounding, the sign and the unit dispatch below stay local: those are THIS
  // formatter's rules, not the grouping's.
  const grouped = thousands(Number(whole ?? "0"));
  const digits = `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;

  // '%' is a suffix; a currency SYMBOL is a prefix; an alphabetic unit
  // ('users', 'months') reads as a suffixed word.
  if (unit === "%") return `${digits}%`;
  if (/^[^\p{L}\p{N}\s]{1,3}$/u.test(unit)) return `${unit}${digits}`;
  return `${digits} ${unit}`;
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

    // ⚠⚠ ORDER IS LOAD-BEARING. The fabrication verdict MUST be taken here,
    // while `data.value` still exists. `classifyFactorValueTier` reads the
    // value as one of its two inputs, so asking it after the `delete` at
    // :426 would return `fallback_default` for EVERY node — including a
    // genuinely user-stated baseline — and the "leave real values alone" half
    // of this fix would silently invert. (Uniformity across inputs that ought
    // to differ is the tell: CLAUDE.md trap 20.)
    const baselineIsFabricated = factorValueIsFabricated(node);

    // Strip data.value when reclassifying to external — that is the only invariant
    // violation. factor_type, uncertainty_drivers, and extractionType are metadata
    // fields that remain useful for downstream enrichment. Promote them to node level
    // (NodeV3 passthrough preserves them) before potentially removing data.
    // Everything the deletion is about to destroy, captured BEFORE the delete.
    // Read off the payload only — no brief, no prose, no re-extraction.
    const priorState = {
      previous_value: data?.value as unknown,
      previous_raw_value: typeof data?.raw_value === "number" ? data.raw_value : undefined,
      previous_unit: typeof data?.unit === "string" ? data.unit : undefined,
      previous_cap: typeof data?.cap === "number" ? data.cap : undefined,
      previous_provenance:
        typeof (node as any).provenance === "string" ? (node as any).provenance : undefined,
      // S3 is unbuilt. NULL is the only honest value; a minted id with no
      // referent is a fabrication wearing an identifier.
      stated_item_id: null,
    };

    if (data) {
      if (data.value !== undefined) {
        deletions.push(
          fieldDeletion(
            'unreachable-factors',
            node.id,
            'data.value',
            'UNREACHABLE_FACTOR_RECLASSIFIED',
            priorState,
          ),
        );
      }
      delete data.value;
      if (data.factor_type !== undefined) {
        (node as any).factor_type = data.factor_type;
      }
      if (data.extractionType !== undefined) {
        (node as any).extractionType = data.extractionType;
      }
      // The tier stamp is promoted for the same reason `extractionType` is:
      // `data` is about to lose its value and may be deleted entirely, and the
      // honest fact about WHERE the number came from must outlive the number.
      // Without this the mark dies exactly at the step that laundered it.
      //
      // ⚠⚠ SCOPE, CORRECTED — AND THE FIRST VERSION OF THIS COMMENT WAS FALSE.
      // It said the mark is carried "so the render can label it". It is NOT:
      // this promotion keeps the stamp alive for IN-PIPELINE readers only, and
      // the stamp DIES BEFORE THE WIRE. `transformNodeToV3` (`schema-v3.ts`)
      // does not spread the node — it rebuilds field-by-field and forwards only
      // named fields, and `value_tier` appears ZERO times in that file
      // (positive control: `extractionType` IS forwarded, `schema-v3.ts:371`).
      // The neighbouring line's "NodeV3 passthrough preserves them" is true of
      // Zod `.passthrough()` at PARSE time and false of the V3 TRANSFORM, and
      // conflating the two is what produced the wrong claim.
      // Its only reader today is `factorValueIsFabricated` below. Giving the
      // render a label requires forwarding it in `transformNodeToV3` — named
      // here so the gap is visible rather than assumed closed.
      if (data[FACTOR_VALUE_TIER_FIELD] !== undefined) {
        (node as any)[FACTOR_VALUE_TIER_FIELD] = data[FACTOR_VALUE_TIER_FIELD];
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
      // FIELD BY FIELD, so anything left on a deleted `data` is dropped with no
      // error anywhere.
      //
      // ⚠⚠ BUT THE PROMOTION DOES NOT REACH THE WIRE, AND THE SENTENCE THAT
      // USED TO SIT HERE — "`raw_value`, `cap` and `unit` are all declared on
      // the shared node schema, so they survive the strict re-parse" — IS
      // FALSE. Measured across four deployed captures: ZERO of 29 factors
      // carry node-level `raw_value`, `cap` or `unit`.
      //
      // THE HOP IS LOCATED. `transforms/schema-v3.ts:296-300` builds
      // `observed_state` from `node.data.unit` / `node.data.raw_value` /
      // `node.data.cap` — i.e. from the very object deleted below. The node
      // level is read at `:411` for `synthesiseDisplayValue` ONLY, and never
      // copied into `observed_state`. So this code correctly diagnosed that a
      // field-by-field rebuild drops anything on a deleted `data`, and then
      // moved the fields to a level that rebuild ALSO does not read — the same
      // defect one storey up.
      //
      // NOT FIXED HERE: correcting it means teaching the V3 transform to read
      // node-level values, which is a transform change with its own blast
      // radius and belongs to whoever owns `schema-v3.ts`. Recorded precisely
      // so the next lane starts from a located hop rather than a live claim
      // that the values already survive.
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
      // So: stamp the scale and withhold the rendering. The formatter fix
      // belongs in `display-value.ts`, which is frozen for this lane.
      //
      // ⚠⚠ THE WITHHOLDING IS TELEMETRY-ONLY TODAY — IT IS NOT USER-VISIBLE,
      // AND AN EARLIER VERSION OF THIS COMMENT CLAIMED OTHERWISE.
      //
      // `boundary.ts:104` filters deterministic repairs through
      // `REPAIR_CODE_TO_ADJUSTMENT`, a hand-maintained allowlist carrying
      // exactly one entry (`UNREACHABLE_FACTOR_RECLASSIFIED`). This code is not
      // on it, so it never becomes a `model_adjustments` row and the user never
      // sees it. The channel itself is live (the allowlisted code appears 33x in
      // a real deployed capture); this code simply is not on it.
      //
      // It DOES ride three carriers, and naming only one understates them:
      //   - `ctx.deterministicRepairs` (the in-process array)
      //   - `trace.repair_summary.deterministic_repairs`
      //   - `pipelineOutcome.repair_provenance`
      // All three are TELEMETRY — diagnostic surfaces engineers read — so the
      // class claim ("not user-visible") holds exactly as stated.
      //
      // Putting it on the channel is NOT a local edit: `ModelAdjustmentCode` is
      // a CLOSED 5-value enum in the shared contract, so a new code is a
      // four-repo train. Rowed separately rather than smuggled into this PR.
      //
      // Until then the honest description of this branch is: the value is
      // preserved, the scale is declared, the rendering is suppressed, and the
      // suppression is recorded where engineers can see it and users cannot.
      // `data.unit !== undefined` was tested twice, once in each arm, so the
      // two branches read as independent conditions when they are in fact the
      // two halves of one decision. Nested, the shape says what it does: a
      // stated unit either displays or is withheld-and-recorded.
      const withholdUnit = scale === "ratio";
      if (data.unit !== undefined) {
        if (!withholdUnit) {
          (node as any).unit = data.unit;
        } else {
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
        deletions.push(
          fieldDeletion(
            'unreachable-factors',
            node.id,
            'data',
            'UNREACHABLE_FACTOR_RECLASSIFIED',
            priorState,
          ),
        );
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
      // ═══════════════════════════════════════════════════════════════════════
      // ⭐⭐ WHY IGNORANCE IS NOT A DISTRIBUTION (the founder's ruling, 2026-08-18)
      //
      // THE LAUNDERING PATH THIS CLOSES, end to end:
      //   1. A factor arrives with NO value.
      //   2. A defaulting site stamps `value: 0.5` — `normalisation.ts` (Stage 1)
      //      or `deterministic-sweep.ts`'s two safety nets. The number carries
      //      zero information; it exists only to satisfy a validator.
      //   3. This function then read that 0.5 as a BASELINE and asked
      //      `synthesisePriorFromBaseline(0.5)` for a prior:
      //          margin = max(0.1, 0.5 * 0.5) = 0.25  →  U(0.25, 0.75)
      //   4. `U(0.25, 0.75)` ships to ISL and to the user.
      //
      // Step 4 is the defect, and it is worse than the default it came from. A
      // bare 0.5 at least looks like a placeholder. `U(0.25, 0.75)` asserts two
      // things we have no grounds for — that the value is not below 0.25, and
      // not above 0.75 — so it reads as a considered uncertainty estimate. The
      // pipeline did not merely default; it DRESSED THE DEFAULT UP AS A
      // MEASUREMENT. Narrowing is an information claim, and there was no
      // information.
      //
      // Ruling: "Factors without a defensible value, evidence-backed range or
      // explicit defensible prior … are NOT given invented quantitative values
      // simply so analysis can consume them. Do not disguise ignorance as a
      // 0–1 distribution."
      //
      // ⚠ WHAT THIS DELIBERATELY DOES NOT DO — the third failure mode.
      // It does not delete the factor and it does not withhold the prior. The
      // factor must stay VISIBLY PRESENT and visibly unquantified. Dropping the
      // prior entirely would strip the node of any support and leave any
      // constraint targeting it evaluating trivially (P=1.0/P=0.0 at
      // intercept=0), which is the very failure the original synthesis was
      // written to prevent. MARK, NEVER SUPPRESS (quality bar Q5).
      //
      // So an undefensible baseline collapses to MAXIMAL uncertainty — the one
      // range that asserts nothing — and carries the tier stamp forward so the
      // render can label it ("assumed 0–1 — not yet estimated") instead of
      // printing a bare `Range: 0 to 1`. A genuine baseline is untouched: same
      // margin, same clamps, byte-identical output.
      // ═══════════════════════════════════════════════════════════════════════
      // ⚠⚠ CONTAINMENT IS ENFORCED HERE TOO, NOT ASSUMED (adversarial review B1).
      // `synthesisePriorFromBaseline` declares in bold that a synthesised prior
      // MUST contain the value it came from, and names the measured cost of
      // breaking it. The collapse branch sits OUTSIDE that function, so it
      // inherited none of that protection: any baseline above 1 collapsing to
      // `[0,1]` re-creates the NRR defect exactly.
      // The stampers only ever write 0.5, so a stamped node should always be in
      // range — but "should" is how invariants die. A baseline the ignorance
      // range cannot contain is NOT collapsed; it is narrowed normally, because
      // an incoherent distribution is worse than a fabricated one.
      const collapseContainsBaseline = originalValue >= 0 && originalValue <= 1;
      const { range_min, range_max } = baselineIsFabricated && collapseContainsBaseline
        ? { range_min: 0.0, range_max: 1.0 }
        : synthesisePriorFromBaseline(originalValue);
      (node as any).prior = {
        distribution: "uniform",
        range_min,
        range_max,
      };
      repair.prior_synthesised = true;
      repair.synthesised_range = { range_min, range_max };
      const leftUnquantified = baselineIsFabricated && collapseContainsBaseline;
      repair.prior_is_unquantified = leftUnquantified;
      // ⚠ THIS SENTENCE REACHES THE USER VERBATIM (adversarial review C1).
      // `boundary.ts:168` copies `action` into `model_adjustments[].reason`, and
      // the deployed UI sanitiser only strips the `"with synthesised prior [...]"`
      // form — so an earlier draft of this string passed through intact and
      // printed `[0, 1]`, the word UNQUANTIFIED, and the raw defaulted `0.5` to
      // a user. All three are internal language: the bracket notation is our
      // prior, and the 0.5 is the very number we are disowning. Plain English,
      // no notation, no leaked figure — the honest claim is that we have no
      // estimate, not a description of our own machinery.
      repair.action += leftUnquantified
        ? `, and we have no estimate for it yet — its value was left fully open`
          + ` rather than narrowed to a figure we cannot support`
        : ` with synthesised prior [${range_min}, ${range_max}]`;

      log.info({
        event: leftUnquantified
          ? "cee.repair.prior_left_unquantified"
          : "cee.repair.prior_synthesised_from_baseline",
        node_id: node.id,
        original_value: originalValue,
        baseline_is_fabricated: baselineIsFabricated,
        collapse_contains_baseline: collapseContainsBaseline,
        range_min,
        range_max,
      }, leftUnquantified
        ? `Declined to narrow a prior for "${node.id}": baseline ${originalValue} is a system default`
        : `Synthesised prior for reclassified factor "${node.id}" from baseline ${originalValue}`);
    }

    // ── THE DECLARATION (S2) ─────────────────────────────────────────────
    // What this repair destroyed, carried on the record that already reaches
    // the user (`boundary.ts:100-105` → `analysis_ready.model_adjustments`).
    // Until now that surface said only that the category had moved, while a
    // figure the user recognises was removed from the maths in silence.
    if (originalValue !== undefined) repair.deleted_value = originalValue;
    if (priorState.previous_raw_value !== undefined) {
      repair.deleted_raw_value = priorState.previous_raw_value;
    }
    if (priorState.previous_unit !== undefined) {
      repair.deleted_unit = priorState.previous_unit;
    }

    // The SENTENCE is emitted only when there is a magnitude a reader can
    // recognise. A bare normalised `0.72` told back to a user is noise, and
    // over-declaration that makes the receipt unreadable is a real cost
    // (design §8.2 risk 4) — so the AUDIT records everything and the RECEIPT
    // speaks only when it has something meaningful to say.
    const shownFigure = formatStatedMagnitude(
      priorState.previous_raw_value,
      originalValue,
      priorState.previous_unit,
    );
    if (shownFigure !== null) {
      // ⚠ PHRASING IS LOAD-BEARING TWICE OVER.
      //
      // (1) It must not attribute the figure to the user. The pipeline
      //     extracted it; `provenance: "brief_extraction"` is a DEFAULT stamp
      //     that over-claims (ROADMAP 2.743), and the whole 2.714 revert was
      //     about a surface telling users the system's reading was their own.
      //
      // (2) It must survive the DEPLOYED UI's `sanitiseDetail()`
      //     (`ModelAdjustments.tsx` at UI `7b5992fc`), which strips
      //     parenthesised bare numbers, quoted lowercase tokens and the prior
      //     clause before rendering. A figure written as "(1800000)" would be
      //     DELETED there and the user would read a sentence with a hole in
      //     it — worse than saying nothing. Pinned control in the spec.
      repair.action +=
        `. The extracted value ${shownFigure} is not used in the maths` +
        ` — the range shown is a placeholder`;
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
