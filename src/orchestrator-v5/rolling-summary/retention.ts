/**
 * Context Architecture v2 — S4 rolling summary: the DURABLE-MEMORY WRITE GATES.
 *
 * PURE. Two checks run between `parseSummaryOutput` and the store write
 * (capture.ts). Both reuse the module's existing, already-tested containment
 * verdict — REJECT AND KEEP THE PRIOR SUMMARY — rather than inventing new
 * state. Failing closed costs one pass of summary staleness, which the lag
 * machinery already discloses in-band; failing open writes a permanent
 * falsehood about the user's own history into memory the user cannot see or
 * correct. The asymmetry is why both gates reject.
 *
 * ── Why this file exists (measured on build 8a06563, 2026-07-25) ────────────
 *
 * Fixture: a healthy summary whose RESOLVED slot held eight named decision
 * records; one new turn; the real modules and the real haiku summariser.
 *
 *   neutral / constraint turn (control)  → RESOLVED preserved, 16/16
 *   "I think your last answer was made
 *    up… were you inventing them?"       → RESOLVED erased to (none), 57/57
 *
 * A user expressing DOUBT about their own decision history caused that history
 * to be deleted from durable memory. And the erasure is not a silence: for a
 * non-floor summary the injector documents the bare `(none)` marker as "the
 * summariser looked and found none", so from the next turn onward the pack
 * asserts to the coach that NO settled history exists — the coach then denies
 * holding records the system is still storing.
 *
 * The sibling defect, observed once by the probe lane that found this
 * (parallel-briefs/COACH-RECORD-DENIAL-PROBE-2026-07-25.md): the summariser
 * wrote "The assistant acknowledged it cannot back up those names" when the
 * assistant had said no such thing — a USER's challenge persisted as an
 * ASSISTANT's concession.
 *
 * ── Why the fix is here and not (only) in the prompt ────────────────────────
 *
 * A prompt rule with no test is not a gate, and this estate has repeatedly
 * found prompt-side guarantees that drifted silently. The prompt now states
 * both rules (summariser.ts) so the gates rarely fire — but the GUARANTEE is
 * these two functions, and each has a test that fails when it is removed.
 */

import type { ParsedSummarySlot } from './parse-summary.js';
import { SLOT_RETENTION_REQUIRED } from './summary-types.js';
import type { RollingSummary, RollingSummarySlot, SummarySpeaker } from './summary-types.js';

// ---------------------------------------------------------------------------
// GATE 1 — NON-ERASURE. A slot holding durable fact may not be emptied.
// ---------------------------------------------------------------------------

/**
 * Slots that held content in `prior` and are EMPTY in this pass's output,
 * restricted to the slots whose retention is required (SLOT_RETENTION_REQUIRED
 * — an exhaustive Record, so a new slot cannot skip the decision).
 *
 * This is the exact sibling of the guard parse-summary.ts already carries. Its
 * own comment reads: "a response missing CONSTRAINTS/RESOLVED/OPEN previously
 * parsed OK and the missing slots were stored as '(none)', silently erasing
 * prior memory; now ANY missing slot rejects". A slot the model EMITS but
 * empties produces the byte-identical stored outcome. The existing guard
 * caught the typo case; this one catches the semantic case.
 *
 * OPEN and FRAME are deliberately exempt: an open question getting answered
 * SHOULD empty OPEN, and a missing FRAME already rejects at parse.
 *
 * Derived wholly from `prior` — no hand-maintained list of protected content.
 */
export function findErasedSlots(
  prior: RollingSummary | null,
  parsedSlots: readonly ParsedSummarySlot[],
): RollingSummarySlot[] {
  if (prior === null) return [];
  const emittedText = new Map<RollingSummarySlot, string>();
  for (const p of parsedSlots) emittedText.set(p.slot, p.text.trim());

  const erased: RollingSummarySlot[] = [];
  for (const block of prior.slots) {
    if (!SLOT_RETENTION_REQUIRED[block.slot]) continue;
    const priorHadContent = block.entries.some((e) => e.text.trim().length > 0);
    if (!priorHadContent) continue;
    const now = emittedText.get(block.slot);
    // Absent slot is already a parse reject; here we care about emitted-empty.
    // "(none)" is the contract's explicit empty marker and assemble.ts stores
    // it as ZERO entries, so it erases exactly as a blank does.
    if (now !== undefined && isEmptySlotText(now)) erased.push(block.slot);
  }
  return erased;
}

/**
 * The contract's empty forms: a blank slot, or the literal "(none)" marker the
 * prompt mandates (tolerant of case and surrounding punctuation).
 *
 * ONE definition, shared with assemble.ts. The parser does NOT normalise
 * "(none)" — it hands back the literal string — so a slot that reads as empty
 * to a human is a non-empty `text` to code. Anywhere those two notions drift
 * apart, an erasure is caught by one layer and stored by the other.
 */
export function isEmptySlotText(text: string): boolean {
  if (text.length === 0) return true;
  return /^\(?\s*none\s*\)?\.?$/i.test(text);
}

// ---------------------------------------------------------------------------
// GATE 2 — ATTRIBUTION MUST BE WITNESSED BY PROVENANCE.
// ---------------------------------------------------------------------------

/**
 * An entry whose prose attributes a SPEECH ACT to the assistant must cite at
 * least one ASSISTANT utterance.
 *
 * This is the half of the attribution fix that a structural input alone cannot
 * give: build-input.ts now hands the model speaker-scoped citation units so it
 * cannot conflate roles, and assemble.ts derives each entry's speaker set from
 * the ordinal map — but the model could still write "the assistant conceded X"
 * while citing only the user's utterance. That combination is exactly the
 * observed defect, and it is now detectable WITHOUT trusting the prose:
 * compare the claim against the derived provenance.
 *
 * Narrow by construction, in both directions:
 *  - a TRUE assistant attribution cites the assistant's utterance and passes;
 *  - an entry citing NOTHING resolvable, or citing only carried prior-summary
 *    ordinals (which name a turn, not an utterance, so their speaker is
 *    UNKNOWN), cannot be judged and is NOT rejected. Unknown is not guilt.
 *
 * HONEST RESIDUAL, stated rather than hidden: the trigger — "does this prose
 * assert an assistant speech act" — is lexical, and a lexical matcher is the
 * hand-maintained mirror this estate keeps getting caught by (trap 12). It is
 * used here only to ASK for a witness, never to decide truth, and a miss
 * degrades to today's behaviour rather than to a wrong write. The
 * non-lexical parts (the speaker derivation, the witness requirement) are the
 * load-bearing ones.
 */
/**
 * ONLY `assistant` and `coach`.
 *
 * `model` was in this list and had to come out: measured over the 1,168 live
 * staging scenarios, every single match on `model` was a FALSE POSITIVE —
 * "Lease-to-Own Agreement option was removed from the model", "model structure
 * is confirmed", "Would a model help clarify the decision?". In this product
 * "the model" is the USER'S DECISION GRAPH, not the assistant. Leaving it in
 * would have rejected legitimate summaries on ordinary turns.
 *
 * `it`, `i` and `system` are excluded for the same reason: too loose to name
 * the assistant unambiguously. A narrower trigger misses some inversions and
 * degrades to today's behaviour there; a looser one FREEZES real memory on
 * ordinary turns, which is a harm this gate must not introduce.
 */
const ASSISTANT_SUBJECT = String.raw`(?:the\s+)?(?:assistant|coach)`;
const SPEECH_ACT = String.raw`(?:acknowledg|conced|admitt?|confirm|agree|apolog|retract|accept|clarif|state|said|say|claim|deny|denie|disown|assur|explain|told|answer)`;

/** "the assistant acknowledged…", "the coach agreed…", "the assistant has now
 *  admitted…" — subject, then a speech-act verb within a few words. */
const ASSISTANT_SPEECH_ACT_RE = new RegExp(
  String.raw`\b${ASSISTANT_SUBJECT}\b(?:\s+\w+){0,3}?\s+${SPEECH_ACT}`,
  'i',
);

export interface UnwitnessedAttribution {
  readonly slot: RollingSummarySlot;
  readonly text: string;
}

export function findUnwitnessedAssistantAttributions(
  parsedSlots: readonly ParsedSummarySlot[],
  ordinalMap: ReadonlyMap<
    string,
    { turn_id: string; created_at: string; speaker?: SummarySpeaker }
  >,
): UnwitnessedAttribution[] {
  const out: UnwitnessedAttribution[] = [];
  for (const p of parsedSlots) {
    const text = p.text.trim();
    if (text.length === 0) continue;
    if (!ASSISTANT_SPEECH_ACT_RE.test(text)) continue;

    // What did this entry actually cite? Only ordinals that RESOLVE and carry a
    // speaker can witness anything.
    let sawAssistant = false;
    let sawAnySpeaker = false;
    for (const ref of p.refs) {
      const hit = ordinalMap.get(ref);
      if (!hit?.speaker) continue;
      sawAnySpeaker = true;
      if (hit.speaker === 'assistant') sawAssistant = true;
    }
    // No speaker-scoped citation at all ⇒ UNKNOWN, not guilty. Only an entry
    // that cited speaker-scoped utterances and included NO assistant utterance
    // is making an assistant claim its own provenance contradicts.
    if (sawAnySpeaker && !sawAssistant) out.push({ slot: p.slot, text });
  }
  return out;
}

/** Test seam / documentation: the lexical trigger, exported so its residual is
 *  visible and directly testable rather than buried. */
export { ASSISTANT_SPEECH_ACT_RE };
