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
 * contain ≥1 baseline AND ≥1 non-baseline.
 *
 * SAFETY RULES
 *
 * 1. Detect baseline using the SAME priority as graph-readiness.ts:206-217
 *    (explicit `is_baseline === true` → label match → id-suffix). This
 *    ensures dedup decisions align with existing baseline-aware code.
 * 2. Within a duplicate-signature group:
 *    - If ≥1 baseline AND ≥1 non-baseline → drop baselines, keep
 *      non-baselines. This is the load-bearing case.
 *    - If all options in the group are baselines → DO NOT dedup (would
 *      drop all options in the group). Fall through to PR #202 bypass.
 *    - If all options in the group are non-baselines → DO NOT dedup
 *      (the user-explicit duplicates are a genuine LLM error worth
 *      raising to the user). Fall through to PR #202 bypass.
 * 3. When a baseline is dropped, ALL edges that reference its node id
 *    are removed (no dangling edges; preserves DAG invariants).
 * 4. ctx.graph is mutated in place. Subsequent substeps see a clean graph.
 *
 * RUN ORDER
 *
 * This substep runs BEFORE the deterministic sweep (substep 1) so the
 * validator inside the sweep never sees the auto-baseline duplicate.
 * If, after dedup, non-baseline duplicates remain, the deterministic
 * sweep still detects OPTIONS_IDENTICAL and the PR #202 bypass fires
 * as before. The user's "Do not loosen graph validation" constraint is
 * honoured — we don't widen the validator, we just clean up a known
 * LLM artefact before it reaches the validator.
 */

import type { StageContext } from "../../types.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";

// Baseline detection — copied verbatim from
// src/routes/assist.v1.graph-readiness.ts:209-217 to keep the heuristic
// aligned with existing baseline-aware surfaces.
const BASELINE_LABELS = new Set(["status quo", "baseline", "do nothing", "no change"]);
const BASELINE_ID_SUFFIXES = ["_status_quo", "_baseline"];

interface OptionLike {
  readonly id?: string;
  readonly kind?: string;
  readonly label?: string;
  // `is_baseline` may live at the node level or under data — both are
  // checked. The Anthropic adapter normalises one to the other at parse
  // time but downstream stages occasionally see either, so be permissive.
  readonly is_baseline?: boolean;
  readonly data?: {
    readonly is_baseline?: boolean;
    readonly interventions?: Record<string, unknown>;
  };
}

interface EdgeLike {
  readonly from?: string;
  readonly to?: string;
}

/**
 * Build a stable intervention signature matching the validator's
 * implementation at src/validators/graph-validator.ts:241-246. Two options
 * with the same signature will trigger OPTIONS_IDENTICAL.
 */
function buildSignature(interventions: Record<string, unknown> | undefined): string | null {
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
 * Detect whether an option is the auto-injected baseline. Mirrors the
 * priority used by graph-readiness.ts:206-217 to keep classification
 * consistent across surfaces.
 *
 * The `anyExplicitBaseline` flag follows the same logic: when ANY option
 * carries an explicit `is_baseline === true`, ONLY explicit flags count;
 * heuristics are then disabled to avoid mis-classifying "Status quo with
 * bridge financing" as a baseline.
 */
function makeBaselineDetector(options: readonly OptionLike[]) {
  const anyExplicitBaseline = options.some((o) => readIsBaseline(o) === true);
  return (o: OptionLike): boolean => {
    if (anyExplicitBaseline) return readIsBaseline(o) === true;
    const id = (o.id ?? "").toLowerCase();
    const label = (o.label ?? "").toLowerCase().trim();
    if (BASELINE_LABELS.has(label)) return true;
    return BASELINE_ID_SUFFIXES.some((s) => id.endsWith(s));
  };
}

function readIsBaseline(o: OptionLike): boolean | undefined {
  // Canonical read path per src/adapters/llm/anthropic.ts:852: prefer
  // data.is_baseline, fall back to node-level.
  if (typeof o.data?.is_baseline === "boolean") return o.data.is_baseline;
  if (typeof o.is_baseline === "boolean") return o.is_baseline;
  return undefined;
}

export interface AutoBaselineDedupReport {
  readonly dropped_option_ids: readonly string[];
  readonly dropped_edge_count: number;
  readonly groups_evaluated: number;
}

/**
 * Stage 4 Substep 0.9: Drops auto-injected baseline options that
 * duplicate an explicit option's intervention signature.
 *
 * No-op when no option duplicates exist or when no duplicate group
 * contains both a baseline and a non-baseline. Records a structured
 * repair trace + telemetry whenever a dedup actually fires.
 */
export function runAutoBaselineDedup(ctx: StageContext): AutoBaselineDedupReport {
  const empty: AutoBaselineDedupReport = {
    dropped_option_ids: [],
    dropped_edge_count: 0,
    groups_evaluated: 0,
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

  const isBaseline = makeBaselineDetector(optionNodes);
  const droppedOptionIds: string[] = [];
  const droppedSignatures: string[] = [];
  let groupsEvaluated = 0;

  for (const [sig, group] of signatureToOptions) {
    if (group.length < 2) continue;
    groupsEvaluated += 1;
    const baselines = group.filter(isBaseline);
    const nonBaselines = group.filter((o) => !isBaseline(o));
    // Only safe to dedup when a non-baseline survives.
    if (baselines.length === 0 || nonBaselines.length === 0) continue;
    for (const b of baselines) {
      if (typeof b.id === "string") {
        droppedOptionIds.push(b.id);
        droppedSignatures.push(sig);
      }
    }
  }

  if (droppedOptionIds.length === 0) {
    return { ...empty, groups_evaluated: groupsEvaluated };
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
    },
  };

  // Record on pipelineOutcome.warnings (informational; the pipeline did
  // not fail — it cleaned up an LLM artefact deterministically). NOT
  // marked degraded — the resulting graph is fully valid.
  ctx.pipelineOutcome.warnings.push({
    stage: "repair",
    error: `auto_baseline_dedup: dropped ${droppedOptionIds.length} baseline option(s) duplicating explicit options`,
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
    `Auto-baseline dedup: dropped ${droppedOptionIds.length} baseline option(s) duplicating explicit options`,
  );
  emit(TelemetryEvents.CeeAutoBaselineDedupApplied, {
    request_id: ctx.requestId,
    dropped_option_ids_count: droppedOptionIds.length,
    dropped_edge_count: droppedEdgeCount,
    groups_evaluated: groupsEvaluated,
  });

  return report;
}
