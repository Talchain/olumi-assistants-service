/**
 * V5 edit lifecycle recovery v1 — deterministic clarification composer.
 *
 * Shared by both pre-LLM intercepts on the edit_graph path:
 *   1. chip-simplify-intercept (legacy "Simplify the change" chip text)
 *   2. vague-edit-guard (free-text edits with no anchor / no value)
 *
 * Output contract (matches the existing wire — no new fields, no new
 * action_type, no new turn-class):
 *   - `assistant_text`: deterministic copy. Lead sentence: "No change
 *     was made to the model yet." If a fresh prior `run_analysis` fact
 *     exists, append: "Your previous analysis is still current."
 *     Closing sentence asks the user for a specific factor / edge /
 *     option / value to change.
 *   - `suggested_actions`: 1–3 text-prompt chips drawn from canonical
 *     graph factor / option labels. No `action_type` — chip clicks
 *     re-submit as fresh user turns and route normally. When the graph
 *     carries fewer than 3 factor+option nodes, falls back to a single
 *     "Cancel — keep model unchanged" chip so the user always has a
 *     terminating action.
 *   - `analysis_ready`: NOT emitted (V5 H5 invariant: no mutation
 *     persisted ⇒ no freshness re-stamp).
 *   - Wire turn-class: `direct_answer` (reuses
 *     `composeDirectAnswerResponse`).
 *
 * Privacy / safety:
 *  - Chip labels come from graph node `label` strings — already
 *    canonical and user-authored. No LLM invention.
 *  - The freshness sentence is gated on a CALLER-SUPPLIED boolean.
 *    This module performs NO fact lookup of its own; the caller is
 *    expected to derive freshness once (typically via the existing
 *    `buildTurnContext` + `deriveAnalysisFreshness` pair) and pass
 *    the verdict in.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import type { SuggestedAction } from './types.js';

export type EditClarifyReason = 'chip_simplify' | 'vague_edit';

export interface EditClarifyComposerNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

export interface ComposeEditClarifyInput {
  readonly reason: EditClarifyReason;
  readonly stage: StageType;
  /**
   * Current graph nodes. Used to deterministically draw chip labels
   * from canonical factor / option names. An empty array is
   * acceptable — the composer falls through to the cancel-only chip
   * in that case.
   */
  readonly nodes: readonly EditClarifyComposerNode[] | null | undefined;
  /**
   * Whether a fresh prior `run_analysis` fact exists for the scenario.
   * When true, the composer appends "Your previous analysis is still
   * current." so the user is not left wondering whether their last
   * analysis survived the non-edit.
   *
   * Pass `false` (or omit) when the freshness derivation is unavailable,
   * stale, or returned `'none'` / `'unknown'`.
   */
  readonly priorAnalysisIsFresh?: boolean;
}

// Copy contract — every string here MUST pass the V5 egress
// `FORBIDDEN_USER_FACING_PHRASES` guard. Specifically:
//   - "no change was made" / "no changes were made" → REWRITTEN.
//     Use "unchanged so far" framing instead.
//   - "previous analysis" / "prior analysis" → REWRITTEN.
//     Use "last analysis" (the brief's canonical phrasing — see
//     forbidden-user-facing-phrases.ts:91–92).
// The composer's own unit test pins this contract via
// `findForbiddenPhraseHit`.
const LEAD_TEXT = 'The model is unchanged so far.';
const FRESHNESS_SUFFIX = 'Your last analysis is still current.';
const CLOSING_TEXT =
  "Tell me the specific factor, edge, option, or value to change, and I'll apply it directly.";

const CANCEL_CHIP: SuggestedAction = Object.freeze({
  id: 'edit_clarify_cancel',
  label: 'Cancel — keep model unchanged',
  message: 'Cancel that change — keep the model as it is.',
});

/**
 * Build the deterministic clarification `OlumiResponse` for the two
 * pre-LLM edit intercepts. Pure function. The output passes egress
 * forbidden-phrase guards (it does NOT contain any of the V5
 * forbidden phrases — no "couldn't", no "let me know", no "i'll take
 * it from there" — see the unit test that asserts this).
 */
export function composeEditClarifyResponse(
  input: ComposeEditClarifyInput,
): OlumiResponse {
  const pieces: string[] = [LEAD_TEXT];
  if (input.priorAnalysisIsFresh === true) {
    pieces.push(FRESHNESS_SUFFIX);
  }
  pieces.push(CLOSING_TEXT);
  const assistant_text = pieces.join(' ');

  const chips = buildClarifyChips(input.nodes ?? []);

  return composeDirectAnswerResponse({
    assistant_text,
    stage: input.stage,
    suggested_actions: chips,
  });
}

/**
 * Pick up to three text-prompt chips from canonical graph labels.
 * Selection order:
 *   1. Factor-kind nodes (the most common edit target), preserving
 *      the order they appear in the graph payload.
 *   2. Option-kind nodes, same order.
 *   3. If fewer than three were collected, append the cancel chip.
 *   4. If zero were collected, the cancel chip is the only result.
 *
 * Labels shorter than 3 chars are skipped — single-letter labels are
 * exceedingly rare in real graphs and a 1-char chip label looks broken
 * to the user.
 */
function buildClarifyChips(
  nodes: readonly EditClarifyComposerNode[],
): readonly SuggestedAction[] {
  const factorChips: SuggestedAction[] = [];
  const optionChips: SuggestedAction[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (factorChips.length + optionChips.length >= 3) break;
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length < 3) continue;
    const dedupKey = label.toLowerCase();
    if (seen.has(dedupKey)) continue;
    if (node.kind === 'factor') {
      seen.add(dedupKey);
      factorChips.push(buildLabelChip(node.id, label));
    } else if (node.kind === 'option' && factorChips.length + optionChips.length < 3) {
      seen.add(dedupKey);
      optionChips.push(buildLabelChip(node.id, label));
    }
  }

  const labelChips = [...factorChips, ...optionChips].slice(0, 3);

  if (labelChips.length === 0) {
    return [CANCEL_CHIP];
  }
  if (labelChips.length < 3) {
    return [...labelChips, CANCEL_CHIP];
  }
  return labelChips;
}

function buildLabelChip(nodeId: string, label: string): SuggestedAction {
  // The submit message must NOT contain any verb in route-v2's
  // `EDIT_GRAPH_POSITIVE_REGEX`
  // (change|update|edit|modify|remove|delete|add|adjust|set|reduce|
  //  increase|decrease|tweak|raise|lower). Otherwise a chip click would
  // re-trigger the V4 edit_graph dispatch with a value-less prompt
  // (the exact closed-loop trap observed on staging
  // `Change Existing Team Size — ` → V4 LLM no-op →
  // ambiguous recovery dead end). Phrased as a question so the click
  // routes to TurnExecutor / Sonnet which can ask for the value.
  // Locked by `__tests__/edit-clarify-response.test.ts`.
  return {
    id: `edit_clarify_${nodeId}`,
    label: `Change ${label}`,
    message: `For ${label}, what value should we use?`,
  };
}
