/**
 * The lens a run_analysis turn SELECTED, recorded on that turn's own fact.
 *
 * ── WHY THIS IS A RECORD AND NOT A RE-DERIVATION ────────────────────────────
 * `phase3-blocks.ts` mints the lens block's `signal_id` as
 * `coach:lens:${selection.lens}` and its `block_id` as a UUID v5 of that
 * string. THE LENS ID IS INSIDE THE BLOCK IDENTITY. So any later turn that
 * rebuilds Phase-3 blocks and lands on a different lens mints a different
 * `block_id`, its match loop falls through, and the user is told a finding
 * they selected is `not_in_model` when nothing about their model changed.
 *
 * The selection is a function of the fact PLUS `previousAnalysisLens` (the
 * no-immediate-repeat tie-break, ROADMAP 2.211). `compose`'s prior-fact
 * lifecycle branch DELIBERATELY omits that input — by design, so that
 * re-presenting an already-seen analysis cannot show two different lenses on
 * two turns. The consequence is that the input is genuinely NOT RECOVERABLE
 * at rebuild time: a rebuild cannot re-derive the selection, it can only
 * guess at it.
 *
 * ── ⭐ IDENTITY, NOT AGREEMENT ───────────────────────────────────────────────
 * The rejected alternative was to rebuild across all nine lens candidates and
 * match any. That creates a SECOND AUTHORITY on "which lens was selected" —
 * two computations of one thing that must agree — which is the
 * hand-maintained-mirror class (CLAUDE.md trap 12), this estate's dominant
 * defect. This module writes ONE value at the ONE site that selects it, and
 * later turns READ it. One derivation, two read points.
 *
 * ── WHY `lens-history.ts` SAYS THE OPPOSITE, AND WHY BOTH ARE RIGHT ─────────
 * `lens-history.ts` answers a DIFFERENT QUESTION and correctly refuses to
 * persist for it: "which lens did the PREVIOUS analysis turn select?" is an
 * INPUT to a fresh selection, and re-deriving it by replaying the pure
 * selector over facts already in hand is strictly better than storing a copy.
 * This module answers "which lens did THIS analysis turn select?" — the
 * OUTPUT, read back after the input that produced it has gone. Naming them
 * apart rather than reconciling them is deliberate (CLAUDE.md trap 21).
 * `lens-history.ts` names "a persisted emitted-lens record" as one of the two
 * durable fixes for its own window-bounded degradation; this is that record.
 *
 * ── PLACEMENT: enrichment, not a top-level fact field ───────────────────────
 * `RunAnalysisHandlerFactSchema` is `.strict()` (@talchain/schemas 0.55.0,
 * `dist/orchestrator/handler-fact.js:22-26`), so a new TOP-LEVEL `selected_lens`
 * would FAIL validation at `run-analysis.ts`'s `safeParse` and would need a
 * schemas release in every consumer. `result.enrichment` is
 * `z.record(z.string(), z.unknown())` — optional and open — and is already a
 * multi-writer record that CEE injects into (`coaching_signal_id` and its two
 * siblings, `coaching-signal-application.ts`). An unknown FIELD there drops
 * silently at a consumer pinned to an older contract; it is never a validation
 * failure. This is the additive-optional seam, not a new enum member.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { LensId } from './lens-selector.js';

/**
 * The enrichment key. Exported so the producer and every reader share ONE
 * constant rather than two copies of a string literal.
 */
export const SELECTED_LENS_ENRICHMENT_KEY = 'selected_lens';

/**
 * Record `lens` on the turn's run_analysis fact, returning a new fact array.
 *
 * ⚠ ABSENCE MUST NOT SILENTLY IMPLY A VALUE. When the producer selected
 * NOTHING — a first-class outcome of this loop, not an error — the key is not
 * written at all and the facts are returned UNCHANGED. A reader therefore
 * distinguishes "this turn chose no lens" (key absent) from "this turn chose
 * pre-mortem" (key present), and can never mistake a default for a decision.
 * A fact committed before this record existed is indistinguishable from a
 * turn that chose nothing, which is the honest reading of both.
 */
export function attachSelectedLensToRunAnalysisFact(
  facts: readonly HandlerFact[],
  lens: LensId | null,
): readonly HandlerFact[] {
  if (lens === null) return facts;
  const idx = facts.findIndex((f) => f.fact_type === 'run_analysis');
  if (idx < 0) return facts;
  const fact = facts[idx];
  if (fact === undefined || fact.fact_type !== 'run_analysis') return facts;
  const base = fact.result.enrichment ?? {};
  const next: HandlerFact = {
    ...fact,
    result: {
      ...fact.result,
      enrichment: {
        ...base,
        [SELECTED_LENS_ENRICHMENT_KEY]: lens,
      },
    },
  };
  const out = facts.slice();
  out[idx] = next;
  return out;
}

/**
 * The lens a run_analysis fact recorded, or `null` when it recorded none.
 *
 * Shape-blind on purpose: facts arrive back through the store as JSON, and a
 * fact written before this record existed carries no key. Both read as `null`
 * — "this turn is not telling us a lens" — which is the only claim the data
 * supports. The cast is narrow: the value can only have been written by
 * {@link attachSelectedLensToRunAnalysisFact} from a `LensId`.
 */
export function readSelectedLensFromFact(fact: HandlerFact | undefined): LensId | null {
  if (fact === undefined || fact.fact_type !== 'run_analysis') return null;
  const enrichment = fact.result.enrichment;
  if (enrichment === null || typeof enrichment !== 'object' || Array.isArray(enrichment)) return null;
  const raw = (enrichment as Record<string, unknown>)[SELECTED_LENS_ENRICHMENT_KEY];
  return typeof raw === 'string' && raw.length > 0 ? (raw as LensId) : null;
}
