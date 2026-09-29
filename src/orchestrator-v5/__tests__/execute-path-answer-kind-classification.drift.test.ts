/**
 * ROADMAP 1.132 (F1 review finding, F-2) — FAIL-LOUD DRIFT GUARD for the
 * EXECUTE-PATH answer-kind discriminator.
 *
 * THE LATENT SEAM (F-2): the executor classifies an execute (tool_call) answer
 * via `toolCallAnswerKind = isExplanationHandler ? 'substantive' : 'functional'`
 * (turn-executor.ts), where `isExplanationHandler = EXPLANATION_HANDLER_IDS.has(
 * handlerId)`. So on the EXECUTE path the inversion's principle — "an unclassified
 * answer SHAPES by default" — does NOT hold: an execute handler defaults to
 * 'functional' (ships PLAIN) UNLESS it is hand-listed in EXPLANATION_HANDLER_IDS.
 * A FUTURE answer-carrying execute handler that someone forgets to add to that
 * set would therefore ship its substantive answer UN-SHAPED — the ORIGINAL F1
 * failure mode, relocated to the execute path.
 *
 * WHY THE DEFAULT IS NOT SIMPLY INVERTED HERE: unlike the finalise seam (where a
 * substantive answer has no positive marker and safely defaults to shape), the
 * execute path has NO derivable "is this a substantive answer vs a functional
 * receipt?" signal — handlers carry no answer-carrying metadata, and a mutation
 * receipt tolerates a stray `explanation` field. Flipping the execute default to
 * shape-unless-receipt would risk SHAPING the receipts that must ship plain. So
 * the discriminator stays the `EXPLANATION_HANDLER_IDS` allowlist — but a
 * hand-maintained allowlist is exactly the dominant defect class (CLAUDE.md
 * verification trap #12: derive-not-mirror; where you cannot derive, the mirror
 * must FAIL LOUD on drift, never assume-good).
 *
 * THIS GUARD is that fail-loud net. It enumerates the REAL handler registry (the
 * source of truth for which handlers actually execute) and asserts EVERY
 * registered handler is EXPLICITLY classified as either:
 *   - SUBSTANTIVE (in `EXPLANATION_HANDLER_IDS` → shapes at egress), or
 *   - FUNCTIONAL RECEIPT (in the pinned receipt set → ships plain).
 * A NEW handler registered without a deliberate classification decision lands in
 * NEITHER set → this test goes RED, forcing the author to decide whether its
 * answer must shape — so it can NEVER ship silently un-shaped.
 *
 * POSITIVE CONTROL (CLAUDE.md verification trap #13): the final test proves the
 * detector can SEE an unclassified handler, so the "every handler is classified"
 * assertion is not vacuous.
 */
import { describe, it, expect } from 'vitest';

import { createRegistry } from '../tools/registry.js';
import { EXPLANATION_HANDLER_IDS } from '../routing/types.js';

// The FUNCTIONAL RECEIPT handlers — mutation/computation handlers whose
// `composeToolCallResponse` output is a confirmation RECEIPT (not an authored
// prose answer) and MUST ship PLAIN. Pinned deliberately: adding a handler here
// is a statement that its execute output is a functional receipt. A new
// answer-carrying handler must go in EXPLANATION_HANDLER_IDS instead — and if it
// belongs in neither, this pin plus the enumeration below force the decision.
const FUNCTIONAL_RECEIPT_HANDLER_IDS = new Set<string>([
  'run_analysis',
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
]);

function registeredHandlerIds(): string[] {
  // createRegistry resolves a PLoT client; with ISL_BASE_URL unset it returns a
  // lazy stub (no network) — safe to construct in CI. We only read the KEYS.
  return [...createRegistry().keys()];
}

describe('F1 (F-2) — execute-path answer-kind classification drift guard (ROADMAP 1.132)', () => {
  it('every REGISTERED execute handler is explicitly classified (substantive OR functional-receipt) — no unclassified handler ships un-shaped by default', () => {
    const ids = registeredHandlerIds();
    expect(ids.length).toBeGreaterThan(0);

    const unclassified = ids.filter(
      (id) =>
        !EXPLANATION_HANDLER_IDS.has(id) && !FUNCTIONAL_RECEIPT_HANDLER_IDS.has(id),
    );
    expect(
      unclassified,
      'a newly-registered execute handler is NOT classified as substantive ' +
        '(EXPLANATION_HANDLER_IDS) NOR functional-receipt (FUNCTIONAL_RECEIPT_HANDLER_IDS). ' +
        'It would default to functional and ship its answer UN-SHAPED. Decide its ' +
        'answer-kind and add it to exactly one set.',
    ).toEqual([]);
  });

  it('the two classification sets are DISJOINT (a handler cannot be both substantive and a functional receipt)', () => {
    const overlap = [...EXPLANATION_HANDLER_IDS].filter((id) =>
      FUNCTIONAL_RECEIPT_HANDLER_IDS.has(id),
    );
    expect(overlap, 'a handler id appears in BOTH classification sets').toEqual([]);
  });

  it('neither pin has drifted STALE — every pinned handler id is actually registered', () => {
    const ids = new Set(registeredHandlerIds());
    const staleExplanation = [...EXPLANATION_HANDLER_IDS].filter((id) => !ids.has(id));
    const staleReceipt = [...FUNCTIONAL_RECEIPT_HANDLER_IDS].filter((id) => !ids.has(id));
    // A stale pin is a mirror that has silently diverged from reality (the
    // dominant defect class). Fail loud so the pin is corrected, not tolerated.
    expect(staleExplanation, 'EXPLANATION_HANDLER_IDS lists an unregistered handler').toEqual([]);
    expect(staleReceipt, 'FUNCTIONAL_RECEIPT_HANDLER_IDS lists an unregistered handler').toEqual([]);
  });

  // ── POSITIVE CONTROL (trap #13) ────────────────────────────────────────────
  // Prove the "every handler classified" assertion can SEE an unclassified
  // handler — otherwise it is vacuous.
  it('positive control: an unclassified handler id IS flagged by the classification predicate', () => {
    const fabricatedNewHandler = 'delete_option'; // a plausible future execute handler, in NEITHER set
    const isClassified =
      EXPLANATION_HANDLER_IDS.has(fabricatedNewHandler) ||
      FUNCTIONAL_RECEIPT_HANDLER_IDS.has(fabricatedNewHandler);
    expect(isClassified, 'the predicate must treat an unknown handler as UNCLASSIFIED').toBe(false);

    // …and does NOT false-flag a known-classified handler (so the signal is
    // specific, not always-unclassified).
    expect(
      EXPLANATION_HANDLER_IDS.has('what_would_flip') ||
        FUNCTIONAL_RECEIPT_HANDLER_IDS.has('what_would_flip'),
    ).toBe(true);
  });
});
