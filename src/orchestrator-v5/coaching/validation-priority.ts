/**
 * Shared "what to validate" beat for the post-analysis explain surfaces.
 *
 * Single source of truth for the validation-priority sentence introduced by
 * PR #256 on the deterministic advice-gate path (`composeExplainResults`),
 * now also appended on the LLM `explain_results` handler path so the
 * canonical J1 journey ("Why?") carries the same beat as the J1b free-text
 * phrasings ("Explain the results.") — V5-LANE-B-STRUCTURAL-01.
 *
 * {@link composeStandaloneValidationPriority} names both endpoints explicitly (quoted via `quoteLabel`); the in-flow
 * variant went with the retired advice gate, and the LLM-answer dedup guard with the never-fed explanation path.
 *
 * It follows one degrade ladder (F.6 — existing signals only, no new
 * metric, no invented evidence, no causal/sign claim):
 *
 *   named fragile link → most-weighted factor (top driver) → omit.
 *
 * Omission is the contract on no-signal: never generic "gather more data"
 * filler. The standalone variant additionally rejects ID-shaped labels
 * (`isSlugShapedEntityId`) because its inputs arrive via the handler
 * projection rather than the advice gate's stricter availability checks.
 */

import { quoteLabel } from './robustness-honesty.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';

/**
 * Structural fragile-edge shape shared by `AdviceGateAnalysisFragileEdge`
 * (advice gate) and `AnalysisProjectionFragileEdge` (handler projection) —
 * both are assignable without mapping.
 */
export interface ValidationFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

function hasNonEmptyLabel(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * Per-edge renderability check shared with the advice gate. Both endpoint
 * labels are interpolated into prose ("the link from <from> to <to>"); a
 * blank label on either side would emit a malformed sentence.
 */
export function isRenderableValidationEdge(edge: ValidationFragileEdge): boolean {
  return hasNonEmptyLabel(edge.from_label) && hasNonEmptyLabel(edge.to_label);
}

/**
 * Display-safety check for labels the STANDALONE variant interpolates:
 * non-empty AND not ID-shaped. The in-flow gate variant does not need this
 * (its labels already passed the gate's availability checks), but the
 * handler projection's labels come straight from the context pack, so the
 * slug guard holds the no-raw-IDs invariant by construction.
 */
export function isCleanDisplayLabel(label: string | undefined | null): label is string {
  if (!hasNonEmptyLabel(label)) return false;
  return !isSlugShapedEntityId((label as string).trim());
}

/**
 * Outcome of composing the standalone beat: which rung of the ladder fired
 * and the evidence it names, so the handler can report the mechanism
 * (telemetry) without re-deriving it.
 */
export type ValidationPriorityBeat =
  | {
      readonly variant: 'link';
      readonly text: string;
      readonly from_label: string;
      readonly to_label: string;
    }
  | {
      readonly variant: 'driver';
      readonly text: string;
      readonly driver_label: string;
    };

/**
 * Standalone variant for append-after-LLM use. Same ladder and the same
 * sentence frame as the retired in-flow variant, but the link rung
 * names both endpoints because the surrounding prose (free LLM narrative)
 * carries no guarantee the link was named above.
 */
export function composeStandaloneValidationPriority(
  fragileEdge: ValidationFragileEdge | null,
  topDriverLabel: string | null,
): ValidationPriorityBeat | null {
  if (
    fragileEdge !== null
    && isCleanDisplayLabel(fragileEdge.from_label)
    && isCleanDisplayLabel(fragileEdge.to_label)
  ) {
    const from = fragileEdge.from_label.trim();
    const to = fragileEdge.to_label.trim();
    return {
      variant: 'link',
      from_label: from,
      to_label: to,
      text: `One useful confidence check is real-world support for the link from ${quoteLabel(from)} to ${quoteLabel(to)} rather than the current model estimate, since the robustness check flagged it as fragile.`,
    };
  }
  if (isCleanDisplayLabel(topDriverLabel)) {
    const driver = topDriverLabel.trim();
    return {
      variant: 'driver',
      driver_label: driver,
      text: `The evidence that would most improve confidence is firmer support for ${quoteLabel(driver)}, since it carries the most weight in this result.`,
    };
  }
  return null;
}

/**
 * Decision record for the handler path: exactly one mechanism per turn.
 *
 *  - `appended`      — the standalone beat was composed and should be
 *                      appended as a final paragraph.
 *  - `dedup_skipped` — a beat was available but the existing narrative
 *                      already covers that validation priority (per the
 *                      coarse heuristic above), so it was intentionally
 *                      skipped. Carries the evidence that matched.
 *  - `omitted`       — no renderable fragile link AND no clean top-driver
 *                      label; nothing honest to say, so nothing is said.
 */
export type ValidationBeatDecision =
  | { readonly mechanism: 'appended'; readonly beat: ValidationPriorityBeat }
  | {
      readonly mechanism: 'dedup_skipped';
      readonly variant: 'link' | 'driver';
      readonly from_label?: string;
      readonly to_label?: string;
      readonly driver_label?: string;
    }
  | { readonly mechanism: 'omitted'; readonly reason: 'no_renderable_signal' };
