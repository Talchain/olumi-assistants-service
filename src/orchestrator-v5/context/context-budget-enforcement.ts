/**
 * O-3 — context-size budget enforcement at the V5 ContextPack assembly seam.
 *
 * Wires the existing budget module (`enforceContextBudget`,
 * src/orchestrator/context/budget.ts — written and tested for the V4
 * pipeline, previously reachable only from the dead V1 routes) into the
 * LIVE assembly path. Before this seam existed, the compacted graph and
 * analysis summary went into the routing prompt uncapped: an oversized
 * context could only fail the turn at the API window, never degrade.
 *
 * Contract (the budget module's own design is the spec — not redesigned
 * here):
 *   - Graph: field-trim ladder (edge `plain_interpretation` → low-value
 *     node metadata → `type`/`category`/`intervention_summary` → external
 *     prior ranges → `source` → edge `exists`). Nodes and edges are NEVER
 *     deleted; `label` is preserved throughout, so graph structure and
 *     counts are stable under trimming.
 *   - Analysis: `top_drivers` reduced to 3, `constraint_tensions` dropped.
 *   - Under budget: inputs are returned by REFERENCE, so an under-budget
 *     pack is byte-identical to an unbudgeted one (positive control).
 *   - Never throws; any internal fault returns the inputs unchanged.
 *
 * Scope guard: the conversation window (5-turn slice, O-2 / S4 rolling
 * summary lane) is deliberately NOT passed to the budget module — this
 * seam budgets the assembled graph/analysis sections only.
 *
 * Disclosure (#536 pattern — a silent drop is the defect class):
 *   - in-band: the assembler stamps `ContextPack.context_budget` with the
 *     per-section `{section, original_chars, kept_chars}` records returned
 *     here; `buildUserMessage` serialises the pack's non-display keys, so
 *     the LLM sees that detail was reduced (the same mechanism that makes
 *     `conversation.window` — "N of M turns included" — visible).
 *   - telemetry: each trimmed section emits `v5.context_truncation` with
 *     `disclosed: true` at the cut site, and the turn-executor's routing
 *     `v5.context_budget` event derives its `truncations` records from the
 *     in-pack marker (derived, never hand-mirrored).
 */

import {
  enforceContextBudget,
  type BudgetEnforcementContext,
} from '../../orchestrator/context/budget.js';
import type { GraphV3Compact } from '../../orchestrator/context/graph-compact.js';
import { log } from '../../utils/telemetry.js';
import type { AnalysisResponseSummaryWithSignals } from './analysis-signals.js';
import { emitContextTruncation } from './context-budget-telemetry.js';

/**
 * One in-pack disclosure record for a budget-trimmed section. Mirrors the
 * shape vocabulary of the existing disclosure markers (`original_chars` on
 * the brief slice; `ContextTruncationRecord` on the telemetry stream) minus
 * the telemetry-only `disclosed` flag — presence in the pack IS the
 * disclosure.
 */
export interface ContextBudgetTrimRecord {
  readonly section: 'graph' | 'analysis';
  readonly original_chars: number;
  readonly kept_chars: number;
}

/**
 * The `ContextPack.context_budget` marker. Present on the pack ONLY when at
 * least one section was trimmed (key-absence doctrine: an under-budget pack
 * carries no marker and stays byte-identical).
 */
export interface ContextBudgetDisclosure {
  readonly truncations: readonly ContextBudgetTrimRecord[];
}

export interface ApplyContextBudgetArgs {
  readonly compactedGraph: GraphV3Compact | null;
  readonly analysis: AnalysisResponseSummaryWithSignals | null;
  /** Join key for the truncation telemetry (null when unknown). */
  readonly scenarioId: string | null;
}

export interface BudgetedAssemblyInputs {
  readonly compactedGraph: GraphV3Compact | null;
  readonly analysis: AnalysisResponseSummaryWithSignals | null;
  /** Null when nothing was trimmed — the pack key must then be ABSENT. */
  readonly disclosure: ContextBudgetDisclosure | null;
}

/**
 * Typed view of the enforcement context so the budget module's generic
 * passthrough preserves the signal-extended analysis type. Runtime-safe:
 * the module trims via object spread, so the additive Lane 21 signal
 * fields survive on a trimmed analysis object.
 */
interface AssemblyEnforcementContext extends BudgetEnforcementContext {
  graph_compact: GraphV3Compact | null;
  analysis_response: AnalysisResponseSummaryWithSignals | null;
}

function jsonChars(value: unknown): number {
  if (value == null) return 0;
  return JSON.stringify(value).length;
}

/**
 * Apply the context-size budget to the assembler's graph/analysis inputs.
 *
 * Trim detection is by reference inequality — `enforceContextBudget` only
 * replaces a section object when it actually trimmed it, so a changed
 * reference is exactly "this section was cut" (derived from the module's
 * behaviour, not a mirrored re-estimate of its thresholds).
 *
 * Never throws: any fault degrades to "inputs unchanged, no disclosure" —
 * the same posture as the budget module itself and every telemetry site in
 * this repo (a budgeting fault must never fail a turn).
 */
export function applyContextBudgetToAssemblyInputs(
  args: ApplyContextBudgetArgs,
): BudgetedAssemblyInputs {
  const { compactedGraph, analysis, scenarioId } = args;
  const unchanged: BudgetedAssemblyInputs = {
    compactedGraph,
    analysis,
    disclosure: null,
  };
  // Fast path: nothing to budget (raw-graph fallback turns, pre-analysis
  // turns). The budget module only understands the compact shapes.
  if (compactedGraph === null && analysis === null) return unchanged;

  try {
    const enforced = enforceContextBudget<AssemblyEnforcementContext>({
      graph_compact: compactedGraph,
      analysis_response: analysis,
      // NO `messages` / `event_log_summary`: the conversation window is the
      // O-2 lane's surface — this seam must never touch it.
    });

    const graphOut = enforced.graph_compact ?? null;
    const analysisOut = enforced.analysis_response ?? null;

    const truncations: ContextBudgetTrimRecord[] = [];
    if (compactedGraph !== null && graphOut !== compactedGraph) {
      truncations.push({
        section: 'graph',
        original_chars: jsonChars(compactedGraph),
        kept_chars: jsonChars(graphOut),
      });
    }
    if (analysis !== null && analysisOut !== analysis) {
      truncations.push({
        section: 'analysis',
        original_chars: jsonChars(analysis),
        kept_chars: jsonChars(analysisOut),
      });
    }

    if (truncations.length === 0) return unchanged;

    for (const record of truncations) {
      emitContextTruncation({
        site: 'context-budget-enforcement.applyContextBudgetToAssemblyInputs',
        section: record.section,
        original_chars: record.original_chars,
        kept_chars: record.kept_chars,
        strategy: record.section === 'graph' ? 'field_trim' : 'detail_trim',
        disclosed: true,
        scenario_id: scenarioId,
      });
    }

    return {
      compactedGraph: graphOut,
      analysis: analysisOut,
      disclosure: { truncations },
    };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'context-budget-enforcement: apply failed — assembling unbudgeted context (turn must not fail)',
    );
    return unchanged;
  }
}
