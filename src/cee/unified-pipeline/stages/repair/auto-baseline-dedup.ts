/**
 * Stage 4 Substep 0.9: Deterministic auto-baseline option dedup.
 *
 * RATIONALE
 *
 * The draft_graph LLM prompt (defaults-vNNN.ts) MANDATES a status-quo option
 * on briefs with 3+ explicit options. The model is instructed to set the
 * status-quo's interventions to "baseline values (match each factor's
 * data.value)". For pricing-shaped briefs where one explicit option happens
 * to have the same intervention signature as the auto-injected baseline,
 * the validator's OPTIONS_IDENTICAL check fires (graph-validator.ts:241-246
 * + 834-855) and the PR #202 bypass returns a fail-fast clarification —
 * even though the duplicate is a known auto-injected baseline whose
 * presence adds no information beyond the explicit option.
 *
 * Worked example from staging:
 *   opt_selfserve     interventions = { fac_onboarding_friction: 0.2,
 *                                       fac_price_point: 0.32,
 *                                       fac_sales_effort: 0.1 }   (explicit)
 *   opt_status_quo    interventions = { fac_onboarding_friction: 0.2,
 *                                       fac_price_point: 0.32,
 *                                       fac_sales_effort: 0.1 }   (auto, is_baseline=true)
 *
 * In that case there is no semantic difference — keeping the auto-baseline
 * adds nothing. Drop it; keep the explicit option; let the rest of the
 * pipeline produce a valid graph.
 *
 * IMPORTANT NEGATIVE CASE (verified by staging traffic)
 *
 * The hiring brief ("Should we hire a tech lead or two developers...")
 * ALSO emits an opt_status_quo, but its interventions are distinct from
 * the explicit options (a true no-action baseline). That graph passes
 * OPTIONS_IDENTICAL today and must continue to pass. This dedup ONLY
 * fires inside groups whose intervention signatures collide AND that
 * contain ≥1 explicit-baseline option AND ≥1 non-explicit option.
 *
 * SAFETY RULES (round-2 review: strict-flag-only deletion)
 *
 * 1. Deletion requires an EXPLICIT `is_baseline === true` marker —
 *    either `node.data.is_baseline === true` (canonical) or
 *    `node.is_baseline === true` (legacy). See `isExplicitBaseline`.
 *    Heuristic detection (label match / id-suffix) is NOT used for
 *    deletion — it would risk silently removing a user-explicit
 *    "Status Quo" / "No Change" / `_status_quo`-id option supplied
 *    deliberately as a decision alternative.
 *
 * 2. Within a duplicate-signature group:
 *    - If ≥1 EXPLICIT baseline AND ≥1 non-explicit option → drop the
 *      explicit baselines, keep the non-explicit options. Load-bearing
 *      case (the staging pricing-brief failure).
 *    - If all options are explicit baselines → DO NOT dedup (would
 *      drop all options). Fall through to PR #202 bypass.
 *    - If no option has the explicit flag, BUT one or more options
 *      heuristically look like baselines (label / id-suffix) →
 *      DO NOT dedup; emit a diagnostic-only
 *      `cee.auto_baseline_dedup.heuristic_only_collision` telemetry
 *      event so operators can see LLM prompt drift (missing
 *      is_baseline=true on a status-quo-shaped option). Collision
 *      flows to PR #202 bypass for a typed user-facing clarification.
 *    - If no explicit baseline AND no heuristic match → DO NOT dedup
 *      (the user-explicit duplicates are a genuine LLM error worth
 *      raising to the user). Fall through to PR #202 bypass.
 *
 * 3. When an explicit baseline is dropped, ALL edges that reference
 *    its node id are removed (no dangling edges; preserves DAG
 *    invariants).
 *
 * 4. ctx.graph is mutated in place. Subsequent substeps see a clean
 *    graph. The deterministic sweep's OPTIONS_IDENTICAL validator
 *    then sees no collision (for the dedup'd case) and the rest of
 *    the pipeline produces a valid persisted graph.
 *
 * RUN ORDER
 *
 * This substep runs BEFORE the deterministic sweep (substep 1) so the
 * validator inside the sweep never sees the auto-baseline duplicate.
 * If, after dedup, OPTIONS_IDENTICAL collisions remain (e.g. the LLM
 * forgot to set is_baseline=true, or two user-explicit options have
 * identical interventions), the deterministic sweep still detects
 * OPTIONS_IDENTICAL and the PR #202 bypass fires as before. The
 * user's "Do not loosen graph validation" constraint is honoured —
 * we don't widen the validator, we just clean up a known LLM artefact
 * (an explicit-baseline-flagged duplicate) before it reaches the
 * validator.
 */

import type { StageContext } from "../../types.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";

// Heuristic baseline tokens — used ONLY by `looksHeuristicallyLikeBaseline`
// (diagnostic-only path) so operators can see when the LLM produces an
// option that LOOKS like a baseline but lacks the explicit is_baseline
// flag (prompt drift signal). Vocabulary is copied from
// src/routes/assist.v1.graph-readiness.ts:209-217 to keep dashboards
// aligned with existing baseline-aware surfaces — but, critically,
// these tokens NEVER authorise deletion. Deletion requires explicit
// is_baseline === true (see `isExplicitBaseline`).
const BASELINE_LABELS = new Set(["status quo", "baseline", "do nothing", "no change"]);
const BASELINE_ID_SUFFIXES = ["_status_quo", "_baseline"];

export interface OptionLike {
  readonly id?: string;
  readonly kind?: string;
  readonly label?: string;
  // `is_baseline` may live at the node level or under data — both are
  // checked. The Anthropic adapter normalises one to the other at parse
  // time but downstream stages occasionally see either, so be permissive.
  readonly is_baseline?: boolean;
  /** `extractionType` may live at the node level (repaired factors) or
   *  under data — read by the graceful-dedup consumer to detect
   *  from_brief-marked options. */
  readonly extractionType?: string;
  readonly data?: {
    readonly is_baseline?: boolean;
    readonly interventions?: Record<string, unknown>;
    readonly extractionType?: string;
  };
}

export interface EdgeLike {
  readonly from?: string;
  readonly to?: string;
}

/**
 * Build a stable intervention signature matching the validator's
 * implementation at src/validators/graph-validator.ts:241-246. Two options
 * with the same signature will trigger OPTIONS_IDENTICAL.
 *
 * Exported for reuse by the OPTIONS_IDENTICAL graceful dedup
 * (options-identical-graceful-dedup.ts) so both dedup substeps group by
 * the SAME signature the validator uses.
 */
export function buildSignature(interventions: Record<string, unknown> | undefined): string | null {
  if (!interventions) return null;
  const entries: [string, number][] = [];
  for (const [factorId, raw] of Object.entries(interventions)) {
    const num =
      typeof raw === "number"
        ? raw
        : raw != null &&
            typeof raw === "object" &&
            typeof (raw as { value?: unknown }).value === "number"
          ? ((raw as { value: number }).value)
          : null;
    if (num === null) return null; // skip options with non-numeric interventions
    entries.push([factorId, num]);
  }
  if (entries.length === 0) return ""; // empty-interventions options collide on ""
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}:${v.toFixed(4)}`).join("|");
}

/**
 * Strict baseline detection: ONLY an explicit `is_baseline === true`
 * marker (data.is_baseline or node-level is_baseline) is sufficient to
 * authorise deletion. Heuristic detection (label match / id-suffix) is
 * NOT used as a deletion predicate — see `looksHeuristicallyLikeBaseline`
 * below for the diagnostic-only path.
 *
 * SAFETY CONTRACT (round-2 review fix)
 *
 * A user can legitimately type "Status Quo", "No Change", "Baseline" or
 * use an id like `opt_status_quo` as a deliberate, distinct option they
 * want modelled. If the LLM happens to give that option the same
 * intervention signature as another option, the failure mode is a real
 * LLM contract violation — the user is asking for two genuinely distinct
 * options that the model failed to differentiate. Silently deleting the
 * "Status Quo" option in that case would be unsafe: it loses information
 * the user explicitly supplied.
 *
 * The safe rule is: ONLY when the LLM (or some upstream marker) has
 * explicitly tagged a node as a baseline via `is_baseline === true` may
 * we infer that the node was auto-injected and is safe to drop on
 * collision. Heuristic-only collisions flow to PR #202's OPTIONS_IDENTICAL
 * bypass, which emits a typed clarification the user can act on.
 *
 * Canonical read path per src/adapters/llm/anthropic.ts:852: prefer
 * `data.is_baseline`, fall back to node-level. Both surfaces are checked
 * because the Anthropic adapter normalisation occasionally leaves the
 * flag at one level or the other depending on schema version.
 */
export function isExplicitBaseline(o: OptionLike): boolean {
  return readIsBaseline(o) === true;
}

/**
 * Diagnostic-only baseline heuristic. Returns true when an option's
 * label or id looks like a baseline but the explicit `is_baseline` flag
 * is absent. This is NOT used for deletion — only for telemetry so
 * operators can spot LLM contract violations (the prompt mandates
 * `is_baseline: true` on status-quo options; missing flags indicate
 * prompt drift or model regression).
 *
 * Mirrors the heuristic logic in src/routes/assist.v1.graph-readiness.ts
 * to keep the classification vocabulary aligned across surfaces.
 */
export function looksHeuristicallyLikeBaseline(o: OptionLike): boolean {
  if (readIsBaseline(o) === true) return false; // explicit flag wins; heuristic only relevant when flag absent
  const id = (o.id ?? "").toLowerCase();
  const label = (o.label ?? "").toLowerCase().trim();
  if (BASELINE_LABELS.has(label)) return true;
  return BASELINE_ID_SUFFIXES.some((s) => id.endsWith(s));
}

function readIsBaseline(o: OptionLike): boolean | undefined {
  if (typeof o.data?.is_baseline === "boolean") return o.data.is_baseline;
  if (typeof o.is_baseline === "boolean") return o.is_baseline;
  return undefined;
}

export interface AutoBaselineDedupReport {
  readonly dropped_option_ids: readonly string[];
  readonly dropped_edge_count: number;
  readonly groups_evaluated: number;
  readonly heuristic_only_collisions: number;
}

/**
 * Stage 4 Substep 0.9: Drops auto-injected baseline options that
 * duplicate an explicit option's intervention signature.
 *
 * SAFETY: Deletion requires an EXPLICIT `is_baseline === true` flag on
 * the duplicated option (see `isExplicitBaseline`). Heuristic-only
 * matches (label like "Status Quo", id ending `_status_quo`, etc.) are
 * NOT sufficient to delete — those options may have been provided
 * deliberately by the user as a distinct decision option. When a
 * duplicate group is detected with only heuristic baselines, this
 * substep emits a diagnostic telemetry event so operators can see the
 * LLM contract drift (the prompt mandates `is_baseline: true` on
 * status-quo options; missing flags indicate prompt regression) but
 * does NOT mutate the graph. The downstream PR #202 OPTIONS_IDENTICAL
 * bypass surfaces a typed clarification to the user for that case.
 *
 * No-op when no option duplicates exist or when no duplicate group
 * contains both an EXPLICIT baseline and a non-baseline. Records a
 * structured repair trace + telemetry whenever a dedup actually fires.
 */
export function runAutoBaselineDedup(ctx: StageContext): AutoBaselineDedupReport {
  const empty: AutoBaselineDedupReport = {
    dropped_option_ids: [],
    dropped_edge_count: 0,
    groups_evaluated: 0,
    heuristic_only_collisions: 0,
  };
  if (!ctx.graph) return empty;
  const graph = ctx.graph as { nodes?: OptionLike[]; edges?: EdgeLike[] };
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const optionNodes = nodes.filter((n) => n.kind === "option");
  if (optionNodes.length < 2) return empty;

  // Group options by intervention signature. Options whose interventions
  // are missing or non-numeric get null signatures and are skipped.
  const signatureToOptions = new Map<string, OptionLike[]>();
  for (const opt of optionNodes) {
    const sig = buildSignature(opt.data?.interventions);
    if (sig === null) continue;
    const existing = signatureToOptions.get(sig) ?? [];
    existing.push(opt);
    signatureToOptions.set(sig, existing);
  }

  const droppedOptionIds: string[] = [];
  let groupsEvaluated = 0;
  let heuristicOnlyCollisions = 0;
  const heuristicOnlyOptionIds: string[] = [];

  for (const [, group] of signatureToOptions) {
    if (group.length < 2) continue;
    groupsEvaluated += 1;

    // STRICT predicate: only options with an explicit `is_baseline === true`
    // marker are candidates for deletion.
    const explicitBaselines = group.filter(isExplicitBaseline);
    const nonExplicitBaselines = group.filter((o) => !isExplicitBaseline(o));

    if (explicitBaselines.length > 0 && nonExplicitBaselines.length > 0) {
      // Safe: drop the explicit baselines. The non-explicit options
      // survive — they're either real user options or other baselines
      // without the explicit flag, which is itself worth surfacing.
      for (const b of explicitBaselines) {
        if (typeof b.id === "string") droppedOptionIds.push(b.id);
      }
      continue;
    }

    // Diagnostic-only path: no explicit baseline flag present in the
    // duplicate group. Check if heuristics would have matched, log it
    // for operator visibility, but DO NOT delete. The downstream
    // OPTIONS_IDENTICAL bypass (PR #202) will surface a typed
    // clarification to the user.
    const heuristicBaselines = group.filter(looksHeuristicallyLikeBaseline);
    if (heuristicBaselines.length > 0 && heuristicBaselines.length < group.length) {
      heuristicOnlyCollisions += 1;
      for (const h of heuristicBaselines) {
        if (typeof h.id === "string") heuristicOnlyOptionIds.push(h.id);
      }
    }
  }

  // Emit a diagnostic-only event when heuristic-only collisions were
  // detected, regardless of whether any explicit-flag dedup also fired.
  if (heuristicOnlyCollisions > 0) {
    log.warn(
      {
        event: "cee.auto_baseline_dedup.heuristic_only_collision",
        request_id: ctx.requestId,
        heuristic_only_option_ids: heuristicOnlyOptionIds,
        heuristic_only_groups: heuristicOnlyCollisions,
      },
      `Auto-baseline dedup: ${heuristicOnlyCollisions} duplicate group(s) contained options that LOOK like baselines (by label or id suffix) but lack the explicit is_baseline flag — declining to delete and falling through to OPTIONS_IDENTICAL bypass. This signals LLM prompt drift (prompt mandates is_baseline=true on status-quo options).`,
    );
    emit(TelemetryEvents.CeeAutoBaselineHeuristicOnlyCollision, {
      request_id: ctx.requestId,
      heuristic_only_option_ids_count: heuristicOnlyOptionIds.length,
      heuristic_only_groups: heuristicOnlyCollisions,
    });
  }

  if (droppedOptionIds.length === 0) {
    return {
      dropped_option_ids: [],
      dropped_edge_count: 0,
      groups_evaluated: groupsEvaluated,
      heuristic_only_collisions: heuristicOnlyCollisions,
    };
  }

  // Mutate graph: remove dropped option nodes AND any edges that touch them.
  const droppedSet = new Set(droppedOptionIds);
  const edgesBefore = Array.isArray(graph.edges) ? graph.edges : [];
  const edgesAfter = edgesBefore.filter(
    (e) => !droppedSet.has(e.from ?? "") && !droppedSet.has(e.to ?? ""),
  );
  const droppedEdgeCount = edgesBefore.length - edgesAfter.length;
  graph.nodes = nodes.filter((n) => !droppedSet.has(n.id ?? ""));
  graph.edges = edgesAfter;

  const report: AutoBaselineDedupReport = {
    dropped_option_ids: droppedOptionIds,
    dropped_edge_count: droppedEdgeCount,
    groups_evaluated: groupsEvaluated,
    heuristic_only_collisions: heuristicOnlyCollisions,
  };

  // Surface on repairTrace so the downstream sweep / package stages see
  // that a deterministic dedup ran. Visible in debug bundles.
  ctx.repairTrace = {
    ...(ctx.repairTrace ?? {}),
    auto_baseline_dedup: {
      ran: true,
      dropped_option_ids: droppedOptionIds,
      dropped_edge_count: droppedEdgeCount,
      groups_evaluated: groupsEvaluated,
      heuristic_only_collisions: heuristicOnlyCollisions,
    },
  };

  // Record on pipelineOutcome.warnings (informational; the pipeline did
  // not fail — it cleaned up an LLM artefact deterministically). NOT
  // marked degraded — the resulting graph is fully valid.
  ctx.pipelineOutcome.warnings.push({
    stage: "repair",
    error: `auto_baseline_dedup: dropped ${droppedOptionIds.length} explicit-baseline option(s) duplicating explicit options`,
    degraded: false,
  });

  log.info(
    {
      event: "cee.auto_baseline_dedup.applied",
      request_id: ctx.requestId,
      dropped_option_ids: droppedOptionIds,
      dropped_edge_count: droppedEdgeCount,
      groups_evaluated: groupsEvaluated,
    },
    `Auto-baseline dedup: dropped ${droppedOptionIds.length} explicit-baseline option(s) duplicating explicit options`,
  );
  emit(TelemetryEvents.CeeAutoBaselineDedupApplied, {
    request_id: ctx.requestId,
    dropped_option_ids_count: droppedOptionIds.length,
    dropped_edge_count: droppedEdgeCount,
    groups_evaluated: groupsEvaluated,
  });

  return report;
}
