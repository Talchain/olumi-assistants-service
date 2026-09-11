/**
 * DRAFT-NON-FATAL VALIDATOR CODES — THE SINGLE AUTHORITY.
 *
 * A code in this set is a TRUE finding about the drafted graph that must NOT
 * cost the user the draft. The post-enforcement gate
 * (`graph-enforcement.ts`) subtracts this set before counting blocking
 * errors, so the graph is packaged and shown with the finding carried
 * alongside it instead of being withheld.
 *
 * ── THE MEASURED DEFECT THIS CLOSES ──────────────────────────────────────
 * Paul's session, 11 Sep 2026, on the day the PoC was shared with
 * collaborators. `POST /proxy/v5/turn` returned HTTP 500 in 65.6s —
 * `draft_graph_cee_graph_invalid`, `last_phase: "deterministic_enforcement"`,
 * `validation_error_codes: ["OPTION_NO_OP"]`, `auto_retry: { attempts: 2 }`.
 * Measured at 3 failures in 10 attempts on one brief: the user submits a
 * brief and NO GRAPH APPEARS.
 *
 * `OPTION_NO_OP` (#1446) is CORRECT and is kept exactly as written — an
 * option that sets every factor it touches to the level that factor already
 * has is not an alternative, and shipping one is how the product came to
 * recommend a price rise while modelling no change. Only the CONSEQUENCE was
 * wrong: the finding was pushed into `GraphValidationResult.errors`, and
 * every error there is fatal to the draft pipeline. Options are a list, and
 * one bad member must not kill the list.
 *
 * ── WHY A SET HERE AND NOT A SEVERITY FLIP AT THE VALIDATOR ──────────────
 * `graph-validator.ts`'s assembly does `errors.push(...validateSemantic(...))`
 * — the whole tier lands in `errors` REGARDLESS of each issue's `severity`
 * field. Writing `severity: "warning"` on the push is therefore INERT: it
 * changes a string nobody reads and the draft still 500s. Making it real
 * means moving the predicate into `collectWarnings` and rewriting ~15
 * assertions in #1446's 371-line invariant suite — the one piece of evidence
 * that the predicate is right. The fatality decision belongs to the
 * pipeline, not to the tier function, so it is made here.
 *
 * ── WHY NOT DROP OR RE-MARK THE OFFENDING OPTION ─────────────────────────
 * Both put words in the user's mouth. Dropping asserts *this alternative
 * does not matter* — and in the measured session the no-op option was the
 * one labelled with the user's own question sentence verbatim, so dropping
 * it deletes the alternative the user named. Marking it `is_baseline: true`
 * asserts *these words describe the status quo*, and #1446 already measured
 * that it does not even remove the harm: `analysable-option-gate.ts` HOLDS
 * an `is_baseline` option at its factors' observed values and still submits
 * it, so the same arm would still be compared and could still win, now
 * under a flag saying "current arrangement" while its label says "increase
 * the price". A remedy that relabels the lie is not a remedy.
 *
 * ── SCOPE OF WHAT THIS CHANGES, STATED NARROWLY ──────────────────────────
 * `validateGraph` is called in exactly three places outside its own tests:
 * `deterministic-sweep.ts` twice and `graph-enforcement.ts` once. Nothing on
 * the ANALYSIS path reads it. `OPTION_NO_OP` is in no sweep bucket (A, B or
 * C), so it never routed to a repair and never set `llmRepairNeeded`; the
 * enforcement gate was its only consumer. Subtracting it there is therefore
 * the whole of the behavioural change, and the finding survives on
 * `ctx.remainingViolations` — whose codes reach the client as
 * `remaining_violation_codes` (`stages/package.ts`) with the offending
 * option id on the violation's `context` — and on
 * `ctx.pipelineOutcome.warnings`.
 *
 * ⚠ THIS IS NOT A CLAIM THAT THE OPTION IS RENDERED AS FLAGGED. It is
 * carried, addressably, to the client; no rendered user-visible marker is
 * added by this change and none is claimed.
 *
 * ── WHY ITS OWN LEAF MODULE ──────────────────────────────────────────────
 * The same reasoning `bucket-c-codes.ts` states for itself: a constants
 * module with no behaviour, no imports and no reason to be mocked cannot be
 * hollowed out by a `vi.mock` factory that replaces a behavioural module
 * wholesale, and a set declared once cannot drift from a copy (trap 12).
 */

/**
 * Validator error codes that are reported but never withhold the draft.
 *
 * `ReadonlySet` because this is a shared singleton: a consumer that mutated
 * it would silently re-route every other consumer's fatality decision.
 */
export const DRAFT_NON_FATAL_CODES: ReadonlySet<string> = new Set([
  "OPTION_NO_OP",
]);
