/**
 * Stage 4 Substep 5: Compound goals
 *
 * Source: Pipeline B lines 1578-1628
 * Extracts compound goals from brief, remaps constraint targets against
 * actual graph nodes, and emits goal_constraints[] for the response.
 *
 * Constraint data lives only in goal_constraints[] — constraints are metadata,
 * not causal factors, so they must NOT be emitted as graph nodes or edges
 * (F.6: CEE generates, PLoT computes, UI displays).
 */

import type { StageContext } from "../../types.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
  remapConstraintTargets,
} from "../../../compound-goal/index.js";
import { partitionRiskFramedInversions } from "../../../compound-goal/risk-polarity.js";
import { deriveStatedTargetBaselinePercent } from "../../../factor-extraction/stated-level.js";
import { log } from "../../../../utils/telemetry.js";

/**
 * ROADMAP 2.349 (ROOT HALF) — a deadline is not a hard constraint, and
 * `goal_constraints[]` is the one array that means "hard constraint".
 *
 * WHAT THIS CLOSES. `extractTemporalConstraints` mints a constraint from any
 * time phrase in the brief ("…within 18 months" → `{operator:'<=', value:18,
 * unit:'months', label:'Delivery deadline', provenance:'inferred'}`), and
 * `remapConstraintTargets` step 0 then force-binds it to the GOAL node — a
 * months-unit limit welded onto a node measured in £. From there it was
 * persisted, forwarded to PLoT on every analysis run, deterministically
 * deleted by PLoT (time is not a modelled dimension, so it cannot be), and
 * finally read BACK by CEE's verdict as "a condition the user set that the
 * engine did not check" — which withheld the leading option on EVERY run of
 * EVERY brief containing a time phrase, unescapably, with three untruths in
 * the copy. Diagnosis: `diagnosis-gap5-leader-null.md`.
 *
 * WHY THE FILTER LIVES HERE AND NOT IN THE EXTRACTOR. Two producers write this
 * array — the regex extractor above and the LLM's own `goal_constraints[]`
 * (`ctx.llmGoalConstraints`, whose schema declares `deadline_metadata`:
 * `src/schemas/assist.ts`). Fixing only the regex path would leave the LLM
 * path minting the identical unevaluable constraint, and the defect would
 * return the first time the model emitted one. This is the single point BOTH
 * sources pass through, so the rule is stated ONCE, over the merged set:
 * a deadline-bearing entry never enters `goal_constraints[]`, whoever made it.
 *
 * WHAT IS NOT LOST. The extraction is untouched — `deadline_metadata` is still
 * produced and still available to `generateConstraintNodes`; the time phrase
 * is still in the brief and in the goal's own text; and the UI reads
 * `goal_constraints` nowhere (audit-2262-model-tab.md: 0 occurrences). What is
 * removed is only the entry's status as a WITHHOLD-TRIGGERING hard constraint
 * — the one effect it had, and a purely destructive one.
 *
 * Detection is by `deadline_metadata` PRESENCE, which is the same signal
 * PLoT's own DROP RULE 1 uses (`normalisation/constraint-filter.ts`). Same
 * signal, same verdict, one hop earlier — so CEE stops asking the engine a
 * question it has already published that it cannot answer.
 *
 * Pure. Exported for direct test.
 */
export function partitionTemporalNonBinding<T>(
  constraints: readonly T[],
): { binding: T[]; temporal: T[] } {
  const binding: T[] = [];
  const temporal: T[] = [];
  for (const c of constraints) {
    const meta =
      c !== null && typeof c === "object"
        ? (c as Record<string, unknown>).deadline_metadata
        : undefined;
    (meta !== undefined && meta !== null ? temporal : binding).push(c);
  }
  return { binding, temporal };
}

/**
 * ROADMAP 2.932 (CEE limb, Codex external review R4 / MF2) — THE FRAME IS
 * PROTECTED PAYLOAD.
 *
 * The merge below dedupes on `node_id::operator` and lets the LLM row win, for
 * a real reason: it carries richer metadata (source_quote, confidence,
 * provenance, better label). But the key says nothing about `value_frame`, so
 * an LLM duplicate that carries none silently DESTROYED the one the regex
 * extractor deterministically minted (#862) — and ISL then refuses the entire
 * `constraint_analysis` block with `CONSTRAINT_FRAME_UNSPECIFIED`. Measured at
 * `ed8aad89` by execution before the fix: brief "Keep churn under 5%" plus an
 * LLM row on the same key ⇒ surviving row unframed.
 *
 * The rule is narrow ON PURPOSE. Reverting precedence wholesale would trade the
 * lost frame for lost enrichment. Only the frame is protected; every other
 * field still comes from the model.
 *
 * ⚠ AND IT FAILS CLOSED, WHICH IS THE HALF THAT MATTERS MOST. Sharing
 * `node_id::operator` does NOT make two rows the same quantity: the regex row
 * may hold `-0.15` from "reduce cost by 15%" (a DELTA) while the model's row
 * holds `0.85` (a LEVEL) under the identical key. Carrying the frame across
 * THAT pair would attest a level as a delta and hand ISL a confident WRONG
 * probability — strictly worse than the gap being closed. So preservation
 * requires the two rows to state the SAME NUMBER IN THE SAME UNIT, and
 * otherwise leaves the model row unframed. No unit reconciliation is attempted:
 * `0.05 fraction` and `5 %` may well be the same quantity, but deciding that is
 * a guess, and the cost of refusing is one unframed constraint while the cost
 * of guessing is a wrong number.
 *
 * A frame the MODEL supplied does not outrank a deterministic one on the same
 * number: the draft LLM's `goal_constraints[]` is prompt-only and unenforced,
 * so a frame appearing there is model prose, not an attestation.
 *
 * Pure. Exported for direct test.
 */
export function mergeWithProtectedFrame<T extends Record<string, unknown>>(
  deterministic: T | undefined,
  model: T,
): T {
  const frame = deterministic?.value_frame;
  if (deterministic === undefined || frame === undefined) return model;

  const detValue = deterministic.value;
  const modelValue = model.value;
  const sameNumber =
    typeof detValue === "number" &&
    typeof modelValue === "number" &&
    Number.isFinite(detValue) &&
    Number.isFinite(modelValue) &&
    // Relative tolerance guards only the float round-trip; both sides are
    // decimal literals in the producers' own units.
    Math.abs(detValue - modelValue) <=
      1e-9 * Math.max(1, Math.abs(detValue), Math.abs(modelValue));

  const sameUnit = (deterministic.unit ?? undefined) === (model.unit ?? undefined);

  if (!sameNumber || !sameUnit) return model;

  return { ...model, value_frame: frame };
}

export function runCompoundGoals(ctx: StageContext): void {
  if (!ctx.graph) return;

  const compoundGoalResult = extractCompoundGoals(ctx.effectiveBrief, { includeProxies: false });

  const graphNodes = (ctx.graph as any).nodes as Array<{ id: string; kind?: string; label?: string }>;
  const existingNodeIds = new Set(graphNodes.map((n) => n.id));
  const existingNodeIdList = [...existingNodeIds];

  // Build label map for label-based fuzzy matching fallback
  const nodeLabels = new Map<string, string>();
  for (const n of graphNodes) {
    if (n.label) nodeLabels.set(n.id, n.label);
  }

  // Find goal node ID for temporal constraint binding
  const goalNode = graphNodes.find((n) => n.kind === "goal");
  const goalNodeId = goalNode?.id;

  // ── Regex-extracted constraints ──────────────────────────────────────
  let regexConstraints: any[] = [];
  if (compoundGoalResult.constraints.length > 0) {
    const remapResult = remapConstraintTargets(
      compoundGoalResult.constraints,
      existingNodeIdList,
      nodeLabels,
      ctx.requestId,
      goalNodeId,
    );
    if (remapResult.constraints.length > 0) {
      const normalised = normaliseConstraintUnits(remapResult.constraints);
      regexConstraints = toGoalConstraints(normalised);
    }

    log.info({
      event: "cee.compound_goal.regex_extracted",
      request_id: ctx.requestId,
      regex_count: regexConstraints.length,
      constraints_remapped: remapResult.remapped,
      constraints_rejected_junk: remapResult.rejected_junk,
      constraints_rejected_no_match: remapResult.rejected_no_match,
      is_compound: compoundGoalResult.isCompound,
    }, `Regex extracted ${regexConstraints.length} constraint(s)`);
  }

  // ── LLM-emitted constraints ─────────────────────────────────────────
  // LLM constraints have richer metadata (source_quote, confidence,
  // provenance) and take precedence when both sources produce a
  // constraint for the same node_id + operator pair.
  const llmEmitted = Array.isArray(ctx.llmGoalConstraints) ? ctx.llmGoalConstraints : [];
  const llmConstraints = llmEmitted.filter(
    (c: any) => c && typeof c === "object" && typeof c.node_id === "string"
      && existingNodeIds.has(c.node_id),
  );
  const llmSkipped = llmEmitted.length - llmConstraints.length;

  // Observability: the node-existence filter above is a SILENT drop. It was
  // previously logged only when `llmConstraints.length > 0`, so a draft where
  // EVERY LLM-emitted constraint failed the filter produced no telemetry at
  // all — and the function then early-returns below, leaving
  // `ctx.goalConstraints` undefined. That made two very different failures
  // indistinguishable in staging logs:
  //   (a) the model never emitted goal_constraints[]           -> prompt problem
  //   (b) the model emitted them against unmatched node_ids    -> binding problem
  // Both surface identically as an absent `draft_graph.goal_constraints`.
  // Log unconditionally on emission, and WARN whenever anything was dropped,
  // carrying the offending node_ids so (b) is diagnosable from logs alone.
  if (llmSkipped > 0) {
    log.warn({
      event: "cee.compound_goal.llm_dropped",
      request_id: ctx.requestId,
      llm_emitted: llmEmitted.length,
      llm_count: llmConstraints.length,
      llm_skipped: llmSkipped,
      skipped_node_ids: llmEmitted
        .filter((c: any) => !llmConstraints.includes(c))
        .map((c: any) => (c && typeof c === "object" ? (c.node_id ?? null) : null)),
      graph_node_ids: existingNodeIdList,
    }, `LLM emitted ${llmEmitted.length} constraint(s); ${llmSkipped} dropped — node_id does not match any graph node`);
  } else if (llmConstraints.length > 0) {
    log.info({
      event: "cee.compound_goal.llm_emitted",
      request_id: ctx.requestId,
      llm_emitted: llmEmitted.length,
      llm_count: llmConstraints.length,
      llm_skipped: 0,
    }, `LLM emitted ${llmConstraints.length} constraint(s) with valid node targets`);
  }

  // ── Merge: LLM wins on duplicate (node_id + operator) ────────────────
  // The semantic identity of a constraint is its target node + operator.
  // constraint_id is an implementation label, not a dedup key — regex and
  // LLM will assign different IDs to the same semantic constraint.
  if (llmConstraints.length === 0 && regexConstraints.length === 0) return;

  const merged = new Map<string, any>();
  const dedupeKey = (c: any) => `${c.node_id}::${c.operator ?? ""}`;

  // Regex first (lower priority)
  for (const c of regexConstraints) {
    merged.set(dedupeKey(c), c);
  }
  // LLM overwrites on same key (higher priority — richer metadata), EXCEPT the
  // deterministic `value_frame`, which is an attestation rather than metadata
  // and survives an unframed duplicate that states the same quantity. See
  // `mergeWithProtectedFrame` for why it fails closed when they do not
  // (ROADMAP 2.932).
  for (const c of llmConstraints) {
    const key = dedupeKey(c);
    merged.set(key, mergeWithProtectedFrame(merged.get(key), c));
  }

  // ROADMAP 2.349 — the single, source-agnostic gate. See
  // `partitionTemporalNonBinding` for why it is here rather than in either
  // producer, and for what it deliberately does NOT remove.
  const { binding: notTemporal, temporal } = partitionTemporalNonBinding([...merged.values()]);

  // ROADMAP 2.653 — THE SECOND source-agnostic gate, on the same merged set and
  // for the same reason: a threshold the user stated as a RISK ("churn could
  // rise above 3%") is not a requirement, and the operator both producers mint
  // for it is the exact inverse of what the sentence means. The regex extractor
  // keys on the word "above"; the draft prompt tells the model the identical
  // comparator-only rule. One gate, both producers, stated once in
  // `risk-polarity.ts` — which is also where the argument for SUPPRESSING
  // rather than flipping is written out.
  const { binding, inverted } = partitionRiskFramedInversions(notTemporal, ctx.effectiveBrief);

  if (temporal.length > 0) {
    // FAIL LOUD, not silent (CLAUDE.md trap 12): a drop that leaves no trace
    // is how the original force-bind survived unexamined for months. Ids and
    // counts only — no labels, no thresholds, no user text.
    log.info({
      event: "cee.compound_goal.temporal_not_binding",
      request_id: ctx.requestId,
      dropped_count: temporal.length,
      dropped_constraint_ids: temporal.map((c: any) => c?.constraint_id ?? null),
      dropped_node_ids: temporal.map((c: any) => c?.node_id ?? null),
      reason: "temporal_not_a_hard_constraint",
    }, `${temporal.length} temporal constraint(s) withheld from goal_constraints[] — a deadline is not evaluable on a static causal graph`);
  }

  if (inverted.length > 0) {
    // FAIL LOUD, same contract as the temporal gate above: ids, counts and the
    // contradicted polarity only — no labels, no thresholds, no user text.
    // A silent suppression here would be indistinguishable from an extractor
    // that simply stopped matching, which is the one thing a reader of these
    // logs must be able to tell apart.
    log.info({
      event: "cee.compound_goal.risk_framed_inversion_withheld",
      request_id: ctx.requestId,
      dropped_count: inverted.length,
      dropped_constraint_ids: inverted.map((e) => (e.constraint as any)?.constraint_id ?? null),
      dropped_node_ids: inverted.map((e) => (e.constraint as any)?.node_id ?? null),
      dropped_operators: inverted.map((e) => (e.constraint as any)?.operator ?? null),
      contradicted_polarities: inverted.map((e) => e.polarity),
      reason: "operator_contradicts_risk_polarity_of_source_phrase",
    }, `${inverted.length} constraint(s) withheld from goal_constraints[] — the operator contradicts the risk framing of the phrase it was minted from`);
  }

  ctx.goalConstraints = binding;

  // ROADMAP 2.877 (link 2) — the DRAFT-path twin of the add_constraint
  // stated-baseline mint. See `mintStatedTargetBaselines` for the rules; it
  // runs HERE because this is the single place that holds the brief, the
  // bound rows WITH their frames, and the mutable V1 graph at once (the
  // enricher — the twin site the 2.877 brief nominated — writes no constraint
  // rows and never sees the constraint→node binding; a corrected premise).
  mintStatedTargetBaselines(
    ctx.effectiveBrief,
    binding,
    ctx.graph as { nodes?: unknown[]; edges?: unknown[] },
    ctx.requestId,
  );

  log.info({
    event: "cee.compound_goal.integrated",
    request_id: ctx.requestId,
    constraint_count: ctx.goalConstraints.length,
    from_regex: regexConstraints.length,
    from_llm: llmConstraints.length,
    temporal_withheld: temporal.length,
    risk_inversion_withheld: inverted.length,
  }, "Compound goal constraints emitted to goal_constraints[]");
}

/**
 * ROADMAP 2.877 (link 2) — mint `observed_state.baseline` carriers for
 * constraint targets whose CURRENT LEVEL the brief actually states.
 *
 * WHY: a level-framed constraint on an outcome/risk target refuses at ISL
 * (`CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline`) because the
 * level→sample-frame conversion reads `observed_state.baseline` on the TARGET
 * node and no producer mints it. The chat path mints in `add_constraint`; this
 * is the draft twin, sharing the SAME extractor
 * (`factor-extraction/stated-level.ts`) so the two paths cannot drift.
 *
 * RELAY-ONLY, NEVER INVENTED: `deriveStatedTargetBaselinePercent` returns a
 * number only for an actual present-state statement in the brief ("Churn is
 * currently 12%."), bound to the target by its label. No statement ⇒ no mint ⇒
 * the honest ISL refusal stands.
 *
 * THE DRAFT CELL — each conjunct derived from a consumer's bytes:
 *   - `value_frame === 'level'`: deltas need no baseline; unframed rows must
 *     keep failing closed at the frame hop;
 *   - row unit 'fraction' with 0 ≤ value ≤ 1 — the pre-divided percent
 *     convention `normaliseConstraintUnits` produces. A draft '%'-unit row
 *     (value ≥ 1, i.e. ≥100%) is EXCLUDED: PLoT's unit_percent rung reads it
 *     as a RAW percent (1.5 → 0.015) while the draft convention means a
 *     fraction (150%) — a pre-existing cross-repo convention skew a baseline
 *     must not convert into a confident wrong probability;
 *   - target kind outcome|risk: factors get a PLoT ParameterUncertainty
 *     (translator-v3.ts:674) that makes the conversion refuse — a baseline is
 *     inert there (2.877 measured arm H). Goals have their own mint (2.273);
 *   - no goal_threshold_cap anywhere on the node (node level or data level,
 *     mirroring PLoT's collectGoalThresholdNodeMeta): that cap outranks the
 *     deriveRange ladder rung this mint's shape relies on;
 *   - NON-ROOT: ISL refuses roots (`root_target`) and reads a root's observed
 *     value as its sample base — a root mint buys nothing and moves the
 *     analysis instead;
 *   - FILL-ONLY: existing `data.baseline` (whoever wrote it) is never
 *     overwritten, and an existing carrier is only extended when its scale
 *     fields agree with the minted shape.
 *
 * THE SHAPE {value: frac, baseline: frac, unit: 'fraction', cap: 1,
 * extractionType: 'explicit'} is the V1 carrier `transformResponseToV3`'s
 * factor-data branch projects into `observed_state` with
 * `source: 'brief_extraction'` (verified by execution at this tip). cap 1
 * declares the IDENTITY scale, so PLoT's deriveRange resolves [0,1] for this
 * node and the 'fraction' row the mint serves normalises to itself — without
 * it, deriveRange's inferred-baseline rung would turn baseline 0.12 into
 * range [0,0.24] and rescale a 0.05 row into 0.208, a confident wrong number.
 *
 * Pure over its inputs (mutates only `graph.nodes[].data`). Exported for
 * direct test. Returns the number of nodes minted.
 */
export function mintStatedTargetBaselines(
  brief: string | null | undefined,
  constraints: readonly unknown[],
  graph: { nodes?: unknown[]; edges?: unknown[] } | null | undefined,
  requestId?: string,
): number {
  if (typeof brief !== "string" || brief.trim() === "") return 0;
  const nodes = Array.isArray(graph?.nodes) ? (graph!.nodes as Array<Record<string, any>>) : [];
  const edges = Array.isArray(graph?.edges) ? (graph!.edges as Array<Record<string, any>>) : [];
  if (nodes.length === 0) return 0;

  let minted = 0;
  for (const raw of constraints) {
    if (raw === null || typeof raw !== "object") continue;
    const row = raw as Record<string, any>;
    if (row.value_frame !== "level") continue;
    if (row.unit !== "fraction") continue;
    if (typeof row.value !== "number" || !(row.value >= 0 && row.value <= 1)) continue;

    const node = nodes.find((n) => n?.id === row.node_id);
    if (!node) continue;
    if (node.kind !== "outcome" && node.kind !== "risk") continue;
    if (node.goal_threshold_cap != null || node.data?.goal_threshold_cap != null) continue;
    if (!edges.some((e) => e?.to === node.id)) continue;

    const data = node.data as Record<string, any> | undefined;
    if (data !== undefined) {
      if ("interventions" in data) continue; // option-shaped carrier — never a mint target
      if (data.baseline !== undefined) continue; // fill-only
      if (data.unit !== undefined && data.unit !== "fraction") continue;
      if (data.cap !== undefined && data.cap !== 1) continue;
    }

    // Review B2, WIDENED by 2.960 R2 — a generic subject ("The rate is 12%")
    // that binds MORE THAN ONE candidate label attests none of them, and the
    // competing population is EVERY other labelled node whatever its kind:
    // the old outcome/risk population mirrored the KIND gate, so a goal 'Win
    // rate' or a factor 'Customer churn' was invisible to the ambiguity rule.
    // Words do not read kinds. Same rule as the chat path so the two passes
    // cannot disagree about ambiguity.
    const statedPercent = deriveStatedTargetBaselinePercent(
      brief,
      typeof node.label === "string" ? node.label : undefined,
      nodes
        .filter((n) => n?.id !== node.id)
        .map((n) => (typeof n?.label === "string" ? n.label : undefined)),
    );
    if (statedPercent === undefined) continue;

    const frac = statedPercent / 100;
    node.data = {
      ...data,
      value: frac,
      baseline: frac,
      unit: "fraction",
      cap: 1,
      raw_value: frac,
      extractionType: "explicit",
    };
    minted += 1;

    // FAIL LOUD, same contract as this stage's other gates: ids and numbers
    // only, no labels, no user text.
    log.info(
      {
        event: "cee.compound_goal.target_baseline_minted",
        request_id: requestId,
        node_id: node.id,
        constraint_id: row.constraint_id ?? null,
        baseline: frac,
      },
      "Stated current level minted as constraint-target baseline carrier",
    );
  }
  return minted;
}
