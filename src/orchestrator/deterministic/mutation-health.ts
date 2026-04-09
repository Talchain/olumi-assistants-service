/**
 * Post-Mutation Health Gate (T3)
 *
 * Advisory check: when a deterministic action emits a graph_patch block, this
 * helper compares the pre- and post-mutation graphs and surfaces issues that
 * would otherwise only show up later via run-gate failure. Issues are
 * surfaced in assistant text + telemetry; the mutation still applies (the
 * gate is advisory, not blocking).
 *
 * What it checks (REUSING existing validators — never re-implementing):
 *   1. validateGraphStructure(postGraph) — orphan nodes, no path to goal,
 *      cycles, limit violations, missing required node kinds.
 *   2. Option readiness degradation: any option that was 'ready' pre-mutation
 *      and is no longer 'ready' post-mutation (compared via
 *      computeStructuralReadiness). Newly added options in proposal flows are
 *      EXEMPT — they may legitimately be needs_encoding while awaiting user
 *      mapping. The option being actively edited is also exempt to avoid
 *      false positives during partial intervention updates.
 *   3. Duplicate option labels created by the mutation (case-insensitive,
 *      whitespace-normalised — same matching contract as findExistingOption).
 *
 * Reused functions:
 *   - validateGraphStructure (graph-structure-validator.ts)
 *   - computeStructuralReadiness (analysis-ready-helper.ts)
 *   - findExistingOption matching pattern (add-option.ts)
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { PatchOperation } from "../types.js";
import { validateGraphStructure, VIOLATION_MESSAGES } from "../graph-structure-validator.js";
import { computeStructuralReadiness } from "../tools/analysis-ready-helper.js";

export interface MutationHealthResult {
  healthy: boolean;
  /**
   * Human-readable issue strings — surfaced verbatim in assistant text.
   * Each entry is a single sentence; callers join with \n- when rendering.
   */
  issues: string[];
}

/**
 * Build the set of option ids that are exempt from readiness-degradation
 * warnings. Exemptions:
 *   - Newly added options (add_node ops with kind === 'option') — they may
 *     be needs_encoding in a proposal flow.
 *   - The option being actively edited (any update_node op whose path is an
 *     option id) — partial proposal flows may temporarily degrade it.
 */
function collectEditedOptionIds(operations: PatchOperation[], preGraph: GraphV3T | null): Set<string> {
  const exempt = new Set<string>();
  const preOptionIds = new Set<string>();
  if (preGraph) {
    for (const n of preGraph.nodes) {
      if ((n as { kind?: string }).kind === 'option') {
        const id = (n as { id?: string }).id;
        if (id) preOptionIds.add(id);
      }
    }
  }
  for (const op of operations) {
    if (op.op === 'add_node') {
      const v = op.value as Record<string, unknown> | undefined;
      if (v?.kind === 'option' && typeof v.id === 'string') exempt.add(v.id);
    } else if (op.op === 'update_node') {
      // If the update target is an option in the pre-graph, exempt it.
      if (typeof op.path === 'string' && preOptionIds.has(op.path)) {
        exempt.add(op.path);
      }
    }
  }
  return exempt;
}

export function assessMutationHealth(
  preGraph: GraphV3T | null,
  postGraph: GraphV3T,
  operations: PatchOperation[],
): MutationHealthResult {
  const issues: string[] = [];

  // 1. Structural validity (delegates to existing validator).
  const struct = validateGraphStructure(postGraph);
  if (!struct.valid) {
    for (const v of struct.violations) {
      // Surface the user-facing message rather than the raw code.
      issues.push(VIOLATION_MESSAGES[v.code] ?? v.detail);
    }
  }

  // 2. Readiness degradation on options that already existed pre-mutation
  //    AND are not in the exemption set (newly added or actively edited).
  if (preGraph) {
    const exempt = collectEditedOptionIds(operations, preGraph);
    const pre = computeStructuralReadiness(preGraph);
    const post = computeStructuralReadiness(postGraph);
    if (pre && post) {
      const preMap = new Map(pre.options.map((o) => [o.option_id, o.status]));
      for (const postOpt of post.options) {
        if (exempt.has(postOpt.option_id)) continue;
        const preStatus = preMap.get(postOpt.option_id);
        if (preStatus === 'ready' && postOpt.status !== 'ready') {
          issues.push(
            `Option "${postOpt.label}" was ready before this change but is now ${postOpt.status.replace(/_/g, ' ')}.`,
          );
        }
      }
    }
  }

  // 3. Duplicate option labels created by the mutation.
  //    Mirrors findExistingOption's normalisation contract: lowercase,
  //    whitespace-normalised, trim. Same matching rules across all dedup checks.
  const seen = new Map<string, string>();
  for (const n of postGraph.nodes) {
    if ((n as { kind?: string }).kind !== 'option') continue;
    const label = (n as { label?: string }).label;
    if (typeof label !== 'string') continue;
    const key = label.toLowerCase().replace(/\s+/g, ' ').trim();
    const prior = seen.get(key);
    if (prior) {
      issues.push(`Two options share the label "${label}". Pick distinct names before running analysis.`);
    } else {
      seen.set(key, (n as { id?: string }).id ?? '');
    }
  }

  return { healthy: issues.length === 0, issues };
}
