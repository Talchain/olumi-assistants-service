/**
 * PR2 L2 — the ATTRIBUTION JOIN for the rerun consequence sentence.
 *
 * Answers exactly one question: **between the run this re-run is being
 * compared against and now, what did the user change?** The rerun coaching
 * sentence (`signals/coaching-signals.ts`) uses the answer to open with a
 * TEMPORAL clause ("Since you adjusted ...") so the user sees the consequence
 * of the act they just performed, rather than a comparison of two runs with no
 * reference to the intervening change.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ TEMPORAL, NEVER CAUSAL — AND THE REASON IS A MEASUREMENT, NOT A STYLE
 * PREFERENCE.
 *
 * Two runs differ in the graph AND in Monte-Carlo sampling. The seed is not
 * pinned on the live path, so the contract's own attribution vocabulary
 * (`RunDeltaSchema.attribution_case`) would classify every pair we can build
 * today as `C2_unpaired` — NOT `C1_attributable`, which requires
 * `pair_provenance.seed_equal`. A "because you did X" clause is therefore
 * UNLICENSED: it would assert a causal link the evidence cannot support.
 *
 * "Since you did X, Y is now true" asserts only SEQUENCE, which this module
 * derives with certainty from the fact log. That is fully honest, needs no new
 * evidence, and is the whole user-visible experience. The causal clause waits
 * for a pinned seed.
 *
 * The connective set is pinned by test over the COMPOSED output, not merely
 * reviewed here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ WHAT THE WIRE CAN ACTUALLY CARRY — derived at the 0.39.0 bytes, because
 * the design this implements assumed more than the schemas hold. NO SINGLE
 * EDIT FACT CARRIES BOTH AN EDGE ID AND AN EDGE LABEL:
 *
 *   - `adjust_edge_strength` / `set_factor_value` / `add_constraint` share
 *     `GraphEditResultBaseSchema` (`handler-results.js:236`, `.strict()`):
 *     `{ target_id, status, before, after }`. `target_id` is a STRUCTURAL id
 *     (`from→to` for an edge); the free-form `before`/`after` records carry a
 *     `label` for a FACTOR or CONSTRAINT but never node labels for an EDGE.
 *     `context/recent-changes.ts` states this in-code and is why its edge
 *     summary is deliberately generic: *"Edge facts do not carry node labels,
 *     only IDs."*
 *   - `edit_graph` — the route a coaching card's natural-language
 *     `action_prompt` actually reaches — carries
 *     `affected_entities: { kind, label }` and that object is `.strict()`
 *     (`handler-results.js:312`). **It has NO id field at all.**
 *
 * Consequences, both deliberate and both recorded in the PR body:
 *
 *   1. **The sentence names the change with `RecentMutation.target_label`, not
 *      with edge endpoint labels.** "the link from A to B" is not groundable
 *      from the fact log; inventing it would fabricate. For an edge the honest
 *      name is the generic one the projection already ships.
 *   2. **There is no recommendation-provenance field here.** The design
 *      proposed `fromRecommendation`, joined by string-equality between the
 *      mutation's target id and the emitted coaching block's
 *      `target_refs[0].id`. On the ratified `edit_graph` route the mutation
 *      fact carries NO id, so that join is not derivable from persisted state.
 *      It is also read by nothing: no branch of the copy deck consumes it. A
 *      write-only field with zero readers is omitted rather than faked.
 *
 * ⭐ SINGLE-SOURCED FROM `projectRecentChanges`, NOT A SECOND DERIVATION.
 * Per-fact-type label extraction, the noop filter, the "which fact types are
 * mutations" dispatch and the raw-identifier scrub all live in
 * `context/recent-changes.ts` and are already conformance-tested there
 * (`MUTATION_RECEIPT_FACT_TYPES ∪ MUTATION_DISPATCH_SKIP` is asserted EQUAL to
 * the schema's `fact_type` union, so a new handler cannot silently become
 * invisible to this module either). Re-implementing any of it here would be
 * the mirror defect (CLAUDE.md trap #12) — and `RecentMutation.target_label`'s
 * own doc-comment declares this exact seam: *"Surfaced separately from
 * `summary` so future deterministic copy paths ... can reference the target
 * without regex-parsing the summary string."* This is that copy path.
 *
 * Pure and total. No I/O, no LLM, no graph lookup.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  projectRecentChanges,
  type RecentChangeAction,
} from '../context/recent-changes.js';

/**
 * The authored change (or changes) that landed between the run being compared
 * against and this one.
 *
 * `kind: 'single'` names the change; `kind: 'several'` deliberately names
 * none — see {@link deriveInterveningChange}.
 */
export type InterveningChange =
  | {
      readonly kind: 'single';
      readonly action: RecentChangeAction;
      /**
       * Decision-language name of what was changed, taken verbatim from
       * `RecentMutation.target_label`. Guaranteed non-empty by
       * {@link deriveInterveningChange}. Never a structural id.
       */
      readonly target_label: string;
    }
  | { readonly kind: 'several' };

/**
 * Derive the intervening authored change, or null when there is nothing that
 * can be honestly attributed.
 *
 * @param priorFacts   the turn's fact window, NEWEST-FIRST (the loader's
 *                     convention, restated across `context/freshness.ts`).
 * @param priorRunIndex  the index within `priorFacts` of the run this re-run
 *                     is being compared against — i.e.
 *                     `selectRunAnalysisFact(priorFacts).index`, the SAME
 *                     selection `buildRerunDelta` diffs against. Passed in
 *                     rather than re-derived so the attribution and the delta
 *                     cannot disagree about which run "before" means
 *                     (CLAUDE.md trap #12).
 *
 * Returns null when:
 *   - the slice before that run holds no surfaceable mutation; or
 *   - a `run_analysis` fact sits INSIDE that slice (see the precondition note
 *     below); or
 *   - the projection produced no usable label.
 */
export function deriveInterveningChange(
  priorFacts: readonly HandlerFact[],
  priorRunIndex: number,
): InterveningChange | null {
  if (priorRunIndex <= 0) return null;

  const between = priorFacts.slice(0, priorRunIndex);

  // ⭐ THE PRECONDITION IS PINNED HERE, NOT ASSUMED (CLAUDE.md trap 13b: a
  // discriminator must pin its own precondition).
  //
  // Two orderings meet at this line and they are NOT the same authority:
  // `priorFacts` arrives in the loader's newest-first delivery order, while
  // `priorRunIndex` comes from a selector that sorts by `computed_at` with
  // untimestamped facts LAST. Mutation facts are UNTIMESTAMPED — the schema's
  // `BaseHandlerFactFields` is `{ fact_version, noop }` and every fact object
  // is `.strict()`, so there is no `computed_at` to order them by and array
  // position is the ONLY sequence signal available.
  //
  // When the two orderings agree, this slice is exactly "what the user did
  // after the run we are comparing against". When they disagree, it is not,
  // and the tell is that another run_analysis fact lands inside the slice. A
  // sentence that says "since you changed X" while a whole other analysis ran
  // in between is a false temporal claim, so this FAILS CLOSED: no
  // attribution rather than a wrong one.
  if (between.some((fact) => fact.fact_type === 'run_analysis')) return null;

  // ⚠ FORWARD RISK, PINNED RATHER THAN REMEMBERED: the projector's
  // `MUTATION_DISPATCH_SKIP` deliberately hides the three judgement receipts
  // (`feedback`, `edge_adjudication`, `prior_range_edit`) because they persist a
  // human judgement WITHOUT touching the graph. That is correct today — they
  // cannot move an analysis, so they are not an intervening change. The day any
  // of them feeds the compute, this join goes blind to it and `several ⇒ name
  // none` would name a single change while a judgement also intervened. Whoever
  // wires that must revisit this call site; the conformance test in
  // `recent-changes.ts` will flag the fact_type, not this consequence.
  //
  // Capped at RECENT_CHANGES_CAP (3) by the projector. Only `> 1` is read
  // below, so the cap cannot change the verdict for any true count.
  const projected = projectRecentChanges(between);
  if (projected.length === 0) return null;

  // ⚠ SEVERAL CHANGES ⇒ NAME NONE. Naming only the most recent of several
  // would imply it was the one that moved the answer — a sole-cause claim,
  // which is the causal assertion this module exists to avoid, smuggled in by
  // omission rather than by a connective. The honest form acknowledges the
  // changes without attributing the movement to any one of them.
  if (projected.length > 1) return { kind: 'several' };

  const only = projected[0]!;
  // Defensive: `target_label` is documented as possibly empty when a fact
  // lacks a clean label. Prefer saying nothing over naming nothing.
  if (only.target_label.length === 0) return null;

  return {
    kind: 'single',
    action: only.action,
    target_label: only.target_label,
  };
}
