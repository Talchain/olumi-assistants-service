/**
 * `stated_objections` — WHAT THE USER HAS SAID THEY DISAGREE WITH, AND WHY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE QUESTION THIS ANSWERS, written down before anything is named, because
 * two questions under one name is this estate's signature defect (trap 21):
 *
 *   > Which findings has this user stated a disagreement with, and in whose
 *   > words?
 *
 * Named APART from its neighbours, and the separation is the whole design:
 *
 *   | `recent_changes`    | What changed in the MODEL?                      |
 *   | `analysis`          | What did the last run SAY?                      |
 *   | `turn_referents`    | What can be pointed at, and who introduced it?  |
 *   | `stated_objections` | What has the HUMAN said they do not accept?     |
 *
 * ⚠⚠ THIS IS NOT A CORRECTION TO `MUTATION_DISPATCH_SKIP`, AND RECONCILING
 * THE TWO WOULD BE THE WRONG FIX. `context/recent-changes.ts` classifies
 * `finding_dissent` as SKIP, and that classification is RIGHT and stays: a
 * dissent changes nothing in the graph, moves no `graph_hash`, and letting
 * `deriveInterveningChange` say "since you changed X" about it would be a
 * false causal claim. The defect was never the skip. The defect is that SKIP
 * was the ONLY classification available, so "not a model change" collapsed
 * into "not context at all" and the user's stated reasoning reached nothing.
 *
 * ── WHAT THIS CLOSES, MEASURED AT THIS TIP ─────────────────────────────────
 * `finding_dissent` (schemas 0.55.0) has a complete producer chain — the UI's
 * Reasoning tab composes it, `system-events/dispatch.ts` accepts it as
 * `'fact_and_commit'` and persists the statement VERBATIM — and, before this
 * module, ZERO readers. Swept at b53cb78c with a contrast control: the
 * literal `finding_dissent` appears in FOUR non-test `src/` files, all four of
 * which are the WRITER (`system-events/dispatch.ts`), the SKIP declaration
 * (`context/recent-changes.ts`), a forward-risk note (`coaching/
 * intervening-change.ts`) and a log-redaction entry (`utils/logger-config.ts`).
 * Contrast: `set_factor_value` reads 40 files. A producer with no consumer is
 * this estate's chronic failure, and the thing lost here is the most valuable
 * thing the product collects — a human's reason, in their own words.
 *
 * ── WHY THE FACTS ARE IN HAND WITHOUT A NEW READ ───────────────────────────
 * `assembleContextPack` already receives `input.priorFacts`, the turn window's
 * UNFILTERED `HandlerFact[]`. The `MUTATION_RECEIPT_FACT_TYPES` filter that
 * hides judgement receipts lives in `reconcile-recent-mutation-facts.ts` and
 * applies ONLY to the durable recent-changes read — it does not touch
 * `priorFacts`. So this projection needs no query, no new I/O and no schema
 * migration: the facts are already on the turn and were simply never read.
 *
 * Pure and total. No I/O, no LLM, no graph lookup.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { isNoopFact } from '../tools/fact-noop.js';

/**
 * One standing objection: the address it was made against, and the words.
 *
 * ⚠ THE FIELD IS NAMED `statement`, AND THAT IS A SAFETY PROPERTY, NOT A
 * STYLE CHOICE. `utils/logger-config.ts` lists `statement` in
 * `DECISION_CONTENT_FIELDS` precisely because a stated reason may contain PII,
 * and `decisionContentRedactPaths` generates `statement`, `*.statement` and
 * `*.*.statement`. An element of this array serialises at
 * `stated_objections.<index>.statement` — depth 2 — so it is COVERED by the
 * existing boundary. Renaming this key to anything else would silently leave
 * that boundary behind, which is why the name is pinned by test.
 */
export interface StatedObjection {
  /** The finding the user addressed. ID-addressed only; never a label. */
  readonly finding_id: string;
  /** The run the finding was read on. */
  readonly analysis_id: string;
  /**
   * The user's reason, VERBATIM.
   *
   * ⚠ NOT TRUNCATED HERE, and the cap below is on the COUNT instead. The
   * contract already bounds this at `MAX_STATED_REASON` (2000) at the wire,
   * and half a reason is worse than no reason: a model handed "we cannot
   * change suppliers because the contract" would engage with a sentence the
   * user never finished. Bound the number of objections, never the words.
   */
  readonly statement: string;
}

/**
 * How many standing objections reach the model.
 *
 * Deliberately the same number as `RECENT_CHANGES_CAP`, for the same reason:
 * the newest few are what a turn can act on, and an unbounded list is a
 * prompt-budget hazard on a field whose members can each be 2000 characters.
 * It is NOT imported from there — the two caps answer different questions and
 * a shared constant would fuse them, so a future change to one silently moves
 * the other.
 */
export const STATED_OBJECTIONS_CAP = 3;

/**
 * The `finding_dissent` member of the closed `HandlerFact` union.
 *
 * ⚠ `Extract<>`, NOT an intersection. `HandlerFact & { fact_type:
 * 'finding_dissent' }` distributes over the union WITHOUT discarding the other
 * members, so `result` would stay a union of every receipt shape and the
 * destructure below would not compile. `Extract<>` is the idiom this codebase
 * already uses for exactly this (`compose/ui-directive.ts`).
 */
type FindingDissentFact = Extract<HandlerFact, { fact_type: 'finding_dissent' }>;

function isFindingDissentFact(fact: HandlerFact): fact is FindingDissentFact {
  return fact.fact_type === 'finding_dissent';
}

/**
 * Project the turn's facts onto the user's standing objections.
 *
 * ⚠⚠ INPUT ORDER IS NEWEST-FIRST, AND THE WHOLE SUPERSESSION RULE RESTS ON
 * IT. `priorFacts` is documented newest-first throughout this codebase —
 * `reconcile-recent-mutation-facts.ts` ("already newest-first in production")
 * and `selectRunAnalysisFact`, "the canonical newest-first selector the
 * freshness verdict itself is derived from". This function does NOT re-sort:
 * `FindingDissentResultSchema` is `.strict()` and carries no timestamp, so
 * array position is the only sequence signal available, exactly as
 * `deriveInterveningChange` records for the same reason.
 *
 * ⭐ NEWEST WINS, PER FINDING. A user who re-opens the composer and rewrites
 * their objection emits a SECOND fact against the SAME `finding_id`. Handing
 * the model both would put a retracted reason beside the live one and invite
 * it to engage with words the user has already replaced — so the first
 * occurrence (the newest) is kept and older ones for that finding are dropped.
 * This is a SUPERSESSION rule, not a de-duplication of identical rows: the two
 * statements will usually differ, and it is the older one that must go.
 *
 * ⚠ TWO OBJECTIONS TO DIFFERENT FINDINGS ARE BOTH KEPT. Only the finding
 * address collapses; disagreeing with two findings is two objections.
 *
 * @param facts The turn's prior handler facts, newest-first. `undefined` is
 *   read as "no facts were threaded", which yields an empty projection — the
 *   caller distinguishes that from "no objections" by omitting the pack key.
 */
export function projectStatedObjections(
  facts: readonly HandlerFact[] | undefined,
): readonly StatedObjection[] {
  if (facts === undefined) return Object.freeze([]);

  const out: StatedObjection[] = [];
  const seenFindings = new Set<string>();

  for (const fact of facts) {
    if (out.length >= STATED_OBJECTIONS_CAP) break;
    if (!isFindingDissentFact(fact)) continue;
    // A noop judgement receipt is not a standing objection. The shared
    // predicate is used rather than a local one so this cannot drift from what
    // every other projector means by "no change".
    if (isNoopFact(fact)) continue;

    const { finding_id: findingId, analysis_id: analysisId, statement } = fact.result;
    // Defensive against a legacy or partially-written row: every one of the
    // three is REQUIRED by `FindingDissentResultSchema`, so a miss here means
    // the row did not come from this contract and is not evidence of anything.
    // Dropping it is strictly better than putting a blank objection in front of
    // the model, which reads as "the user disagreed and said nothing".
    if (typeof findingId !== 'string' || findingId.trim().length === 0) continue;
    if (typeof analysisId !== 'string' || analysisId.trim().length === 0) continue;
    if (typeof statement !== 'string' || statement.trim().length === 0) continue;

    // SUPERSESSION — see the header. Newest-first input means the first
    // occurrence of a finding is the live one.
    if (seenFindings.has(findingId)) continue;
    seenFindings.add(findingId);

    out.push(Object.freeze({ finding_id: findingId, analysis_id: analysisId, statement }));
  }

  return Object.freeze(out);
}
