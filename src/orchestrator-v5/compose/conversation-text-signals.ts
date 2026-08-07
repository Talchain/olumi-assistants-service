/**
 * `ConversationTextSignals` — the TEXT input class for DSK lens selection.
 *
 * ROADMAP 2.643 slice T1. Design:
 * `parallel-briefs/DSK-SELECTOR-INPUT-CLASSES-DESIGN-2026-08-06.md` §3.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A deterministic, zero-LLM, zero-IO signal bag derived from conversation text
 * CEE ALREADY loads for every turn (`EnrichedTurnContext.prior_turns`, carrying
 * the `user_message` / `assistant_message` sidecar columns). No new DB read, no
 * new persistence, no new wire type — this type never crosses a service
 * boundary.
 *
 * It exists because `selectLens`'s sole input is `RunAnalysisHandlerFact`
 * (ROADMAP 2.614), which carries no conversation content. The DSK bundle's
 * `[signal_type: text]` triggers (TR-002 outside view, TR-004 opportunity cost)
 * are therefore unable to fire at all today — not "unwired" but structurally
 * blind. This module is the missing input class.
 *
 * ── ⚠ IT HAS NO CONSUMER YET, AND THAT IS DELIBERATE ────────────────────────
 * The intended first consumer is TR-002's analysis leg (`outside_view`, design
 * §4). That slice is **NOT SHIPPED and must not be**, because its other
 * conjunct — "factors with low confidence scores" — reads a band that is
 * structurally dark on the live wire:
 *
 *   Measured over the five live captures in `PHASE0-EVIDENCE-2026-07-28/
 *   walk-dsk-raw/` (50 response bodies, 182 `factor_sensitivity` rows):
 *   **0 / 182 rows carry `confidence < 0.3`**, and the observed minimum is
 *   EXACTLY 0.300000 — the band boundary itself.
 *
 *   Producer derivation (not a fixture — the two upstream services at their
 *   deployed tips): PLoT `src/lib/factor-influence.ts` computes
 *   `confidence = 0.5*islConfidence + 0.5*mean(exists_probability)`, and on the
 *   live path passes `[{ exists_probability: structural_certainty }]` when a
 *   factor has no rich incoming edges — `structural_certainty` is 0.5 in all
 *   182 observed rows, so the second term contributes exactly 0.25. ISL
 *   `src/config/stability_thresholds.py` floors `islConfidence` at 0.1
 *   (`STABILITY_CONFIDENCE_MAP.negligible`) whenever the CV refinement is
 *   inactive. Floor = 0.5*0.1 + 0.25 = **0.30 exactly**. Reaching `low`
 *   requires `islConfidence < 0.1`, i.e. CV refinement active with CV > 9 at
 *   negligible stability — never observed.
 *
 * So wiring `outside_view` today would ship a lens that cannot fire, which is
 * the exact defect (`devils_advocacy` shipped structurally dark) that the
 * design's own §4.5 phase-0 gate exists to prevent. The band boundary is a
 * cross-service semantics question queued for a ruling (ROADMAP 2.681: PLoT's
 * user-facing copy calls `< 0.4` "low" while CEE bands `< 0.3`). **This module
 * gains its consumer when that ruling lands — not before.**
 *
 * Nothing here renders, emits, or promises anything to a user; it is a pure
 * function with tests. That is the only form in which an unconsumed capability
 * input is acceptable.
 *
 * ── HEURISTIC QUALITY (the bundle's own label, carried not laundered) ───────
 * Both phrase lists are the DSK bundle's OWN declared PoC operationalisation,
 * quoted from `observable_signal` and attested against those bytes by
 * `__tests__/conversation-text-signals.test.ts`. The bundle labels the rule
 * "Simple keyword scan — not production quality but testable and debuggable".
 * That caveat is the producer's, and it travels with every signal this module
 * produces. A better classifier (an LLM judgement of "has this conversation
 * discussed reference classes?") would beat it on recall but would break
 * replayability, auditability, and the one-derivation discipline — so the
 * deterministic scan stands until a better DETERMINISTIC signal exists.
 *
 * ── SCOPE LIMITS, DISCLOSED (never silently narrowed) ───────────────────────
 * - **Stage scoping is not implemented.** Both triggers scope their scan to
 *   "conversation history for this stage", but the persisted turn row carries
 *   no stage (the vendored `sessionTurnObject` is `.strict()` and has no stage
 *   field), so per-stage history is UNRECONSTRUCTIBLE today. v1 scans the whole
 *   window. For ABSENCE-based triggers a WIDER corpus is strictly conservative
 *   — more chances to find the vocabulary means FEWER fires — so this is a
 *   disclosed under-fire, never an over-fire.
 * - **`assistant_message` is `OlumiResponse.assistant_text` only.** It excludes
 *   block copy — which is where the coach's own DSK exercise instructions
 *   actually live. So a coach that raised reference classes inside an exercise
 *   BLOCK does not suppress via this scan. The design's stated rationale for
 *   scanning the assistant ("if the coach already raised base rates, the nudge
 *   is redundant") therefore holds only for prose answers, not for block-borne
 *   coaching. Recorded so a later reader does not assume wider coverage.
 * - **Numeric detection is digits-only** (`/\d/`). Spelled magnitudes ("five
 *   million") are NOT recognised. A spelled-number recogniser is exactly the
 *   magnitude-alphabet mirror that has bitten this estate before; it gets added
 *   only with a hand-written corpus, never inferred.
 */

import type { SessionTurnWithContent } from '../session/conversation-content.js';

/**
 * TR-002's phrase list, quoted VERBATIM from the trigger's `observable_signal`
 * in `data/dsk/v1.json` ("...contains none of: 'base rate', 'reference class',
 * 'typically', 'historically', 'similar decisions', 'compared to', 'on
 * average'"). Lower-cased at rest; the scan lower-cases the corpus too.
 *
 * Hand-copied by necessity (the bundle states the list inside a prose
 * sentence, so it cannot be parsed out reliably) — and therefore attested
 * against the bundle bytes by the accompanying spec, which REDs on drift
 * instead of letting the rule silently fork.
 */
export const REFERENCE_CLASS_PHRASES: readonly string[] = [
  'base rate',
  'reference class',
  'typically',
  'historically',
  'similar decisions',
  'compared to',
  'on average',
];

/**
 * TR-004's phrase list, quoted VERBATIM from its `observable_signal`. Same
 * attestation obligation as {@link REFERENCE_CLASS_PHRASES}.
 */
export const TRADE_OFF_PHRASES: readonly string[] = [
  'opportunity cost',
  'trade-off',
  'giving up',
  'instead of',
  'alternative use',
  'what else could',
  'other options',
];

/** Digits-only numeric-token rule — see the header's scope limits. */
const NUMERIC_TOKEN = /\d/;

export interface ConversationTextSignals {
  /**
   * Bumped when the derivation rule changes, so telemetry can distinguish
   * signals produced by different rules without re-deriving anything.
   */
  readonly signalVersion: 1;
  /**
   * TRUE only when the scan saw the WHOLE conversation: the store's total turn
   * count is KNOWN, does not exceed the window, and every in-window turn
   * carried both content fields as strings.
   *
   * This is the fail-closed gate for every absence-based trigger. An "the
   * conversation never mentions X" claim over a corpus with unseen text is
   * vacuous — it would fire a coaching nudge on evidence the system does not
   * have. Consumers MUST require `windowComplete` before acting on any
   * `...VocabularyPresent === false`.
   */
  readonly windowComplete: boolean;
  /** How many prior turns the scan actually covered (honesty/telemetry). */
  readonly scannedTurnCount: number;
  /** A TR-002 phrase appears somewhere in the scanned corpus (both speakers). */
  readonly referenceClassVocabularyPresent: boolean;
  /** A TR-004 phrase appears somewhere in the scanned corpus (both speakers). */
  readonly tradeOffVocabularyPresent: boolean;
  /**
   * A digit appears in USER-authored text. Scoped to the user because the
   * bundle's clause is "user provides a numeric estimate" — counting the
   * assistant's numbers would fire on the system's own output.
   */
  readonly numericEstimatePresent: boolean;
}

function containsAny(haystack: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => haystack.includes(p));
}

/**
 * Derive the signal bag for THIS turn.
 *
 * @param currentMessage the user's verbatim message for the turn being composed
 *   (`payload.message`) — part of the corpus, since the user may introduce the
 *   vocabulary on the very turn being judged.
 * @param priorTurns the conversation window as loaded by `buildTurnContext`
 *   (`EnrichedTurnContext.prior_turns`), newest-first; order is irrelevant here
 *   because every predicate is order-free.
 * @param priorTurnsTotal the store's PRE-CAP total turn count
 *   (`EnrichedTurnContext.prior_turns_total`). `null`/`undefined` means UNKNOWN
 *   and forces `windowComplete: false` — an unknown corpus size cannot support
 *   an absence claim.
 */
export function deriveConversationTextSignals(
  currentMessage: string,
  priorTurns: readonly SessionTurnWithContent[],
  priorTurnsTotal: number | null | undefined,
): ConversationTextSignals {
  const userParts: string[] = [currentMessage ?? ''];
  const assistantParts: string[] = [];

  // Fail-closed unless the window provably covers the whole conversation.
  let contentComplete = true;

  for (const t of priorTurns) {
    const u = t.user_message;
    const a = t.assistant_message;
    // `null` = the row genuinely has no content (system/internal-event turns
    // and pre-migration rows are indistinguishable here), `undefined` = the
    // field was never attached. Either way the scan did not see that text, so
    // an absence claim over this window is not supportable.
    if (typeof u !== 'string' || typeof a !== 'string') {
      contentComplete = false;
    }
    if (typeof u === 'string') userParts.push(u);
    if (typeof a === 'string') assistantParts.push(a);
  }

  const totalKnown = typeof priorTurnsTotal === 'number' && Number.isFinite(priorTurnsTotal);
  const notTruncated = totalKnown && (priorTurnsTotal as number) <= priorTurns.length;

  const userCorpus = userParts.join('\n');
  const wholeCorpus = `${userCorpus}\n${assistantParts.join('\n')}`.toLowerCase();

  return {
    signalVersion: 1,
    windowComplete: contentComplete && notTruncated,
    scannedTurnCount: priorTurns.length,
    referenceClassVocabularyPresent: containsAny(wholeCorpus, REFERENCE_CLASS_PHRASES),
    tradeOffVocabularyPresent: containsAny(wholeCorpus, TRADE_OFF_PHRASES),
    numericEstimatePresent: NUMERIC_TOKEN.test(userCorpus),
  };
}
