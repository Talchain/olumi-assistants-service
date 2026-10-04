/**
 * T3 — the STATED-DISSENT offer's text, a PURE LEAF on the same pattern as
 * `fragile-edge-offer-text.ts` and `judgement-offer-text.ts`: one composition,
 * two callers (the selector's eligibility stage and the block mint), so the
 * eligibility question and the composition cannot disagree.
 *
 * ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
 * A user could disagree with a finding, type why, and watch the words reach the
 * server — where they were validated, persisted, and read by nothing. The
 * collection half shipped on both sides (the UI's `buildFindingDissentEvent`,
 * CEE's `finding_dissent` dispatch arm); the consequence half was recorded as
 * deferred — *"compute consequence is a separate design decision"*. This is the
 * smallest honest consequence: what Olumi SAYS next changes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ THE OBJECTION IS MADE VISIBLE, NOT ABSORBED — AND THAT IS THE PRODUCT
 * DECISION, NOT A LIMITATION OF THIS SLICE.
 *
 * The tempting consequence is to move a number: the human disagreed, so soften
 * the finding. That is worse than doing nothing. It removes the disagreement
 * from view, replaces a human's reasoning with a silent adjustment nobody can
 * inspect, and leaves the team with a model that agrees with whoever objected
 * most recently. Olumi is a shared record of a team's REASONING with humans as
 * the authors; an objection that is quietly absorbed is an objection deleted.
 *
 * So: nothing here adjusts anything. The card states that the objection is on
 * the record, that this run does not settle it, and hands back the move that
 * would — naming the evidence or the change that would settle it. The user
 * does the thinking; the product declines to do it for them.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ⚠ THE CARD DOES NOT QUOTE THE USER'S STATEMENT, AND THAT IS DERIVED ─────
 * Three independent reasons, each measured rather than assumed:
 *
 *   1. THE CAP. `COACHING_BLOCK_BODY_MAX` is 300 characters and the contract
 *      bounds `statement` at `MAX_STATED_REASON` (2000). A quote that fits is
 *      the rare case; a quote that does not must either drop the card or be
 *      ELIDED — and an elided quote can invert what someone said ("I do not
 *      think X" → "I do not think…"). Neither is acceptable, so the card names
 *      the ACT and never the words.
 *   2. THE SURFACE ALREADY SHOWS THEM. `StrengthenTheReasoning` keeps the
 *      user's own words beside the finding they object to, durably. Reading
 *      them back would add nothing and spend the entire body cap doing it.
 *   3. R-004's SURVIVING HALF. Paul's ruling of 2026-09-11 authorises
 *      PERSISTING a user's stated reasoning; the schemas 0.55.0 changelog is
 *      explicit that it "does not license re-emitting the text into telemetry
 *      or logs". A coaching body is composed, truncated, prose-scanned and
 *      telemetered by id — keeping free text out of it keeps that half intact
 *      by construction rather than by care.
 *
 * ── ⚠ NO ACTION CHIP IN v1, STATED RATHER THAN DEFAULTED ────────────────────
 * The two sibling judgement lenses shipped their v1 with no chip for the same
 * reason and it is the right one here too: the honest follow-through to "a
 * human thinks this finding is wrong" is NOT a graph mutation — binding a chip
 * to one would invite the user to overwrite the model on the strength of an
 * objection nobody has yet tested, which is the absorption this module exists
 * to refuse. The follow-through is the conversation. The block mint emits
 * `action_label`/`action_prompt` as a pair or not at all, so no chip means no
 * inert chip. A later slice may add a PROBE prompt (never an `edit_graph` one)
 * with its routing MEASURED, exactly as PR2 L1 did for T1/T2.
 *
 * Pure and total. No I/O, no LLM, no graph lookup, no user text.
 */

import { composeOfferBody, namingFitsBodyCap } from './fragile-edge-offer-text.js';

/**
 * The naming sentence.
 *
 * ⚠ SEVERAL OBJECTIONS ⇒ NAME NONE OF THEM INDIVIDUALLY, the same rule
 * `coaching/intervening-change.ts` states for several intervening changes and
 * for the same reason: singling one out would imply it is the one that matters,
 * which is a judgement the product has no grounds for and the user did not make.
 *
 * ⚠ "AN EARLIER RUN", NOT "THE PREVIOUS RUN". True by construction: the bag
 * only holds dissents positioned after the latest claim-bearing analysis in the
 * prior window, so the finding was rendered from that run or an older one.
 * "The previous run" would be a stronger claim than the ordering supports.
 *
 * ⚠ THE FINDING IS NOT NAMED, and cannot honestly be. `finding_id` is an opaque
 * UI-namespaced string (`strengthen:flip:edge_9` — derived at the UI bytes),
 * not a label and not a closed set CEE may respell. Naming it would mean either
 * echoing an id into user-facing prose (which `TargetRefSchema`'s own comment
 * forbids) or inventing a label, which is fabrication.
 */
export function composeStatedDissentNaming(dissentCount: number): string {
  return dissentCount > 1
    ? 'You disagreed with more than one finding from an earlier run, and said why.'
    : 'You disagreed with a finding from an earlier run, and said why.';
}

/** Naming sentence first, the lens's licensed tail second. */
export function composeStatedDissentBody(base: string, dissentCount: number): string {
  return composeOfferBody(composeStatedDissentNaming(dissentCount), base);
}

/**
 * Can this offer be composed inside the body cap?
 *
 * ⭐ TOTAL BY CONSTRUCTION — and the predicate exists ANYWAY, deliberately.
 * Both naming sentences are constants, so this is `true` today for every input,
 * which is exactly the shape of a guard that quietly becomes a tautology
 * (CLAUDE.md: a guard on a literal-typed field is a tautology and `tsc` will not
 * warn). It is kept, asked at both call sites, and pinned by a test that
 * measures the ACTUAL composed length against the ACTUAL cap — so if either
 * sentence or the cap moves, the gate REDs instead of shipping a truncated
 * naming clause. A constant is only constant until someone edits it.
 */
export function isStatedDissentOfferComposable(dissentCount: number): boolean {
  return namingFitsBodyCap(composeStatedDissentNaming(dissentCount));
}
