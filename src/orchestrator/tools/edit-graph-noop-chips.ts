/**
 * V5 edit lifecycle recovery v1 — deterministic chip set for the
 * `edit_graph` no-op branch.
 *
 * Pure helper extracted from edit-graph.ts:1852 (the empty-operations
 * branch). When the LLM returned `operations.length === 0`, the V4
 * handler used to emit zero chips along with `NO_OP_FALLBACK_TEXT`,
 * leaving the user with no actionable next step. The
 * 2026-05-22 edit-lifecycle investigation found this was the source
 * of the `appended_actions: 0` field on staging failure traces.
 *
 * This helper produces 1–3 chips from SAFE anchors only — node IDs
 * that the validator (`PatchValidationResult.referentialErrors[].path`)
 * already proved exist in the input graph. PLoT errors carry only a
 * free-text reason string with no structured anchors, so a no-op
 * preceded only by a PLoT failure yields zero chips (the explicit
 * "no safe anchor → no chips" contract from the user's brief).
 *
 * Privacy / safety contract:
 *  - Pure function. No I/O, no telemetry, no log spam.
 *  - Chip labels come from canonical graph node `label` strings —
 *    no LLM-authored content, no invention. Per
 *    `feedback_no_op_paths_drop_llm_fields.md`, the no-op path drops
 *    all LLM coaching/warnings; this helper does NOT re-introduce
 *    them via a side channel.
 *  - The chip shape mirrors V4 `SuggestedAction` (label, prompt,
 *    role) so downstream consumers
 *    (edit-graph-dispatch.ts:buildBoundarySuggestedActions) wire them
 *    onto the boundary without a new code path.
 *  - Caps the output at 3 chips and dedupes by node_id; with no
 *    new boundary `action_type` (out of scope this PR).
 */

import type { ReferentialIntegrityError } from '../patch-validation.js';
import type { SuggestedAction } from '../types.js';

/**
 * Minimal node shape — only `id` and `label` are read. `kind` is
 * accepted on input for forward compatibility but currently
 * unused (the no-op recovery has no reason to discriminate by kind).
 */
export interface NoOpChipNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
}

export interface BuildNoOpChipsInput {
  /**
   * `PatchValidationResult.referentialErrors` from the most recent
   * validator round. Each entry's `path` field is the structural
   * identifier (node_id for node ops, edge ID for edge ops).
   *
   * Pass undefined / empty when no validator failure preceded the
   * no-op (e.g. the LLM returned empty operations on its first
   * attempt with no validation prelude).
   */
  readonly referentialErrors?: readonly ReferentialIntegrityError[];
  /**
   * Current input graph nodes (canonical V3 shape). Used to map
   * `referentialErrors[].path` (node_id) to a user-facing label and
   * to confirm the node still exists in the graph being edited.
   */
  readonly nodes: readonly NoOpChipNode[];
  /** Max chips to emit. Defaults to 3 per the lifecycle-recovery contract. */
  readonly maxChips?: number;
}

/**
 * Build 0–3 deterministic chips for the no-op recovery surface.
 *
 * Returns the empty array when:
 *   - no validator referential errors are available; OR
 *   - none of the error `path`s match a current graph node; OR
 *   - the graph is empty.
 *
 * Returning `[]` is the intended outcome on the PLoT-only failure
 * mode (no safe anchor → no chips). The caller MUST treat the empty
 * array as a signal to emit no chips at all, not to invent a fallback.
 */
export function buildNoOpRecoveryChips(
  input: BuildNoOpChipsInput,
): readonly SuggestedAction[] {
  const errors = input.referentialErrors ?? [];
  if (errors.length === 0 || input.nodes.length === 0) {
    return [];
  }

  const labelByNodeId = new Map<string, string>();
  for (const node of input.nodes) {
    if (typeof node.id !== 'string' || typeof node.label !== 'string') continue;
    const label = node.label.trim();
    if (label.length < 3) continue;
    labelByNodeId.set(node.id, label);
  }
  if (labelByNodeId.size === 0) return [];

  const maxChips = input.maxChips ?? 3;
  const seen = new Set<string>();
  const chips: SuggestedAction[] = [];

  for (const err of errors) {
    if (chips.length >= maxChips) break;
    const nodeId = typeof err.path === 'string' ? err.path : '';
    if (nodeId.length === 0) continue;
    // Only emit chips for paths that match a node ID in the current
    // graph. Edge IDs (typically "from::to") and unknown paths are
    // intentionally skipped — the chip would have no clear referent
    // for the user.
    const label = labelByNodeId.get(nodeId);
    if (label === undefined) continue;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    chips.push({
      label: `Change ${label}`,
      prompt: `Change ${label} — `,
      role: 'facilitator',
    });
  }

  return chips;
}
