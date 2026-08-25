/**
 * Unit tests for `applyStalenessPrefix` (V5 explain-stabilisation Task 2).
 *
 * The helper replaces the old validator-rule-6 ordering check: instead of
 * the validator inspecting Sonnet's prose for a caveat-before-numeric
 * order, the handler prepends a fixed caveat phrase whenever the analysis
 * projection carries a `staleness_reason`. Idempotency keeps the prefix
 * from doubling when text already opens with a recognised caveat.
 */

import { describe, it, expect } from 'vitest';

import {
  applyStalenessPrefix,
  STALENESS_PREFIX,
  UNCONFIRMED_PREFIX,
} from '../staleness-prefix.js';
import {
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
  caveatForPreconditionVerdict,
} from '../no-op-helpers.js';

const SAMPLE_TEXT =
  'Hire Senior Engineer leads at 0.62 probability, 35 percentage points ahead of the runner-up.';

describe('applyStalenessPrefix', () => {
  it('returns text unchanged with prefixed=false when stalenessReason is null', () => {
    const out = applyStalenessPrefix(SAMPLE_TEXT, null);
    expect(out.text).toBe(SAMPLE_TEXT);
    expect(out.prefixed).toBe(false);
  });

  it('returns text unchanged with prefixed=false when stalenessReason is undefined', () => {
    const out = applyStalenessPrefix(SAMPLE_TEXT, undefined);
    expect(out.text).toBe(SAMPLE_TEXT);
    expect(out.prefixed).toBe(false);
  });

  it('prepends the caveat with prefixed=true when stalenessReason is set', () => {
    const out = applyStalenessPrefix(SAMPLE_TEXT, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.text.endsWith(SAMPLE_TEXT)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('idempotent: text opening with STALENESS_PREFIX is not re-prepended', () => {
    const already = `${STALENESS_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(already, 'stale');
    expect(out.text).toBe(already);
    expect(out.prefixed).toBe(false);
  });

  it('idempotent: text opening with "Treat the figures below as directional…" is not re-prepended', () => {
    // Back-compat: prose produced by the legacy deterministic fallback
    // opens with this clause. Keeping it suppresses double-prefixing
    // during the transition window. The fixture body avoids forbidden
    // phrases (FORBIDDEN_USER_FACING_PHRASES) so the finaliser-level
    // egress guard would not rewrite it.
    const already =
      'Treat the figures below as directional rather than definitive. ' +
      SAMPLE_TEXT;
    const out = applyStalenessPrefix(already, 'stale');
    expect(out.text).toBe(already);
    expect(out.prefixed).toBe(false);
  });

  // V5 stale-aware explain recovery: the legacy "loaded from a prior
  // run" idempotency check was removed because the brief now forbids
  // that exact phrase in user-facing prose. Re-prefixing with the new
  // STALENESS_PREFIX in front of legacy text leaves a forbidden phrase
  // downstream, which the finaliser-level egress guard then rewrites.
  // The prefix-helper itself no longer needs to recognise the legacy
  // opener as "already-prefixed".

  it('NOT idempotent on lenient "may not reflect…" prose (avoids false-positive suppression)', () => {
    // Tightening guard: the approved-openings list deliberately requires
    // the canonical STALENESS_PREFIX opener — a bare "These results may
    // not reflect <something else>" must still trigger prepending so a
    // non-staleness disclaimer cannot suppress the canonical caveat.
    const lenient =
      'These results may not reflect every nuance of the decision. ' + SAMPLE_TEXT;
    const out = applyStalenessPrefix(lenient, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent when a number appears BEFORE the caveat (Sonnet figures-first)', () => {
    // The text does NOT open with a caveat — it opens with a figure,
    // followed later by a caveat. The trust contract requires the user
    // reads the caveat first; we always prepend in this case.
    const figuresFirst =
      'Hire Senior Engineer leads at 0.62 probability. From a prior run, with unknown freshness.';
    const out = applyStalenessPrefix(figuresFirst, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.text).toContain(figuresFirst);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent for currency-formatted figures (£300k) before any caveat', () => {
    // Pinning the brittle-numeric-pattern concern: any figure format —
    // currency, comma-separated integers, bare integers — that opens the
    // prose triggers prepending. The check is "starts with caveat", not
    // "no figure before caveat", which makes the helper robust to
    // arbitrary number formats.
    const currencyFirst =
      'Increasing the budget to £300k would shift the leading option, especially as this analysis is from a prior run.';
    const out = applyStalenessPrefix(currencyFirst, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent for caveat buried in middle paragraph regardless of numeric format', () => {
    // Even with no obvious numeric pattern, an opening that does not
    // match the approved-openings list triggers prepending. The buried
    // caveat is not enough to satisfy the trust contract.
    const buried =
      'Looking at the structure, three pathways shape the goal. The strongest pathway has notable influence. As a final note, this analysis is from a prior run with unknown freshness.';
    const out = applyStalenessPrefix(buried, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('STALENESS_PREFIX is a single sentence, not empty, and ends with a full stop', () => {
    expect(STALENESS_PREFIX.length).toBeGreaterThan(40);
    expect(STALENESS_PREFIX.endsWith('.')).toBe(true);
  });

  it('STALENESS_PREFIX matches the V5 stale-aware explain recovery brief wording verbatim', () => {
    // The brief mandates the exact opening sentence on stale-explain
    // turns. Pinning the wording here so future copy-polish cannot
    // drift the runtime out of brief compliance without flipping this
    // test. Drift here MUST be coordinated with the replay harness's
    // assertion for the same phrase.
    expect(STALENESS_PREFIX).toBe(
      'These results may be out of date because the model has changed since the last analysis.',
    );
  });
});

/**
 * S8 — REVIVE THE CAVEAT CHANNEL (approved half (b)).
 *
 * Two defects are closed here, both derived at `5f2e3fd0`:
 *
 *  1. `applyStalenessPrefix` took `stalenessReason`, a field REMOVED from the
 *     projection ("the only consumer was applyStalenessPrefix" —
 *     `context/projection-summaries.ts:62`). It therefore had ZERO live callers
 *     in `src/`, so the estate had no working mechanism to caveat an executed
 *     explanation. It now takes the LIVE precondition verdict.
 *
 *  2. `STALENESS_PREFIX`'s own docstring claims it is the "Single source of
 *     truth ... Used by: buildAnalysisStaleTemplate" — but `no-op-helpers.ts`
 *     RE-TYPED the sentence rather than importing it. One user-facing sentence,
 *     two hand-maintained copies, and a docstring asserting otherwise
 *     (CLAUDE.md trap 12 + trap 14). The templates now compose from the
 *     constants, and the guards below fail loud if a copy reappears.
 *
 * ⚠ THIS CHANGE MUST NOT MOVE A SINGLE USER-VISIBLE BYTE. It is an authority
 * refactor, not a copy change: the byte-preservation test below is the one that
 * matters most, and `compose/__tests__/forbidden-user-facing-phrases.test.ts`
 * pins the same two strings independently.
 */
describe('S8 — the caveat channel is driven by a LIVE verdict, with ONE authority for the wording', () => {
  it('UNCONFIRMED_PREFIX is the non-asserting lead clause and is distinct from STALENESS_PREFIX', () => {
    expect(UNCONFIRMED_PREFIX).toBe(
      "The last analysis may be out of date because I can't confirm it still matches the current model.",
    );
    expect(UNCONFIRMED_PREFIX).not.toBe(STALENESS_PREFIX);
  });

  it('UNCONFIRMED_PREFIX does NOT assert the model changed, while STALENESS_PREFIX does (authority parity)', () => {
    // The whole reason these are two constants: `unknown` freshness may not
    // claim which state is current (t4-spine-policy §1). The second assertion
    // is the CONTRAST CONTROL — without it, a probe that simply never matches
    // would pass this test while proving nothing.
    expect(/\bhas changed\b/i.test(UNCONFIRMED_PREFIX)).toBe(false);
    expect(/\bhas changed\b/i.test(STALENESS_PREFIX)).toBe(true);
  });

  it("applyStalenessPrefix('unconfirmed') prepends UNCONFIRMED_PREFIX, NOT the stale sentence", () => {
    // RED at pristine: the old signature took an opaque reason string, so any
    // truthy value prepended STALENESS_PREFIX. This is the discriminating case.
    const out = applyStalenessPrefix(SAMPLE_TEXT, 'unconfirmed');
    expect(out.text.startsWith(UNCONFIRMED_PREFIX)).toBe(true);
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(false);
    expect(out.text.endsWith(SAMPLE_TEXT)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('idempotent per caveat: text already opening with UNCONFIRMED_PREFIX is not re-prepended', () => {
    const already = `${UNCONFIRMED_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(already, 'unconfirmed');
    expect(out.text).toBe(already);
    expect(out.prefixed).toBe(false);
  });

  it('a STALE caveat is still prepended to text opening with the weaker UNCONFIRMED opener', () => {
    // The two openers are different CLAIMS, not two spellings of one. "I can't
    // confirm" must never suppress the stronger, evidenced "the model has
    // changed" — suppressing it would trade a redundant sentence for a false
    // one, which is the wrong direction for a trust caveat.
    const weakerFirst = `${UNCONFIRMED_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(weakerFirst, 'stale');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('no caveat verdict ⇒ text untouched (the channel never invents a freshness claim)', () => {
    for (const noCaveat of [null, undefined] as const) {
      const out = applyStalenessPrefix(SAMPLE_TEXT, noCaveat);
      expect(out.text).toBe(SAMPLE_TEXT);
      expect(out.prefixed).toBe(false);
    }
  });

  it('caveatForPreconditionVerdict maps ONLY the two currency verdicts', () => {
    expect(caveatForPreconditionVerdict('stale')).toBe('stale');
    expect(caveatForPreconditionVerdict('unconfirmed')).toBe('unconfirmed');
    // CONTRAST CONTROLS — verdicts that make no currency claim must yield no
    // caveat. `missing`/`degraded` mean there is nothing to caveat; `execute`
    // means the analysis is current.
    expect(caveatForPreconditionVerdict('execute')).toBeNull();
    expect(caveatForPreconditionVerdict('missing')).toBeNull();
    expect(caveatForPreconditionVerdict('degraded')).toBeNull();
  });

  it('DERIVED: both templates are composed from the constants, not re-typed', () => {
    // Fails loud if anyone re-inlines the sentence in `no-op-helpers.ts`, which
    // is exactly how the two copies drifted apart in the first place.
    expect(buildAnalysisStaleTemplate().startsWith(STALENESS_PREFIX)).toBe(true);
    expect(buildAnalysisUnconfirmedTemplate().startsWith(UNCONFIRMED_PREFIX)).toBe(true);
  });

  /**
   * ⚠⚠ KNOWN GAP, PINNED RATHER THAN PAPERED OVER (CLAUDE.md trap 22f).
   *
   * The idempotence guard recognises CANONICAL openers only. It does NOT
   * recognise a caveat the MODEL wrote in its own words — so prefixing such a
   * reply yields the caveat TWICE.
   *
   * ⭐ THE CORPUS IS FROM OUTSIDE THIS LANE'S HEAD. Both strings below are
   * VERBATIM model output captured on the deployed quartet (UI `cf61337c` ·
   * CEE `5f2e3fd` · PLoT `3a3bee5` · ISL `28fe0c9`) on a
   * `complete_stale / graph_changed` state, read from disk by the drive lane.
   * They are EVIDENCE, not fixtures: append to this list, never edit it
   * (trap 14b).
   *
   * ⭐⭐ AND THE FIX IS NOT A WIDER REGEX. "Did this arbitrary prose already
   * caveat?" is an unbounded natural-language predicate, and this estate has
   * already burned four consecutive rounds on one of those — each round fixing
   * one direction and opening the inverse under a fully green suite. A pattern
   * broad enough to catch these two would start suppressing the caveat on prose
   * that merely mentions the model, which is the failure this module exists to
   * prevent (a MISSING caveat is a trust defect; a DOUBLED one is only clumsy).
   * The exit is structural — attach the caveat as a block/marker rather than as
   * prose, so it cannot collide with the model's wording at all. That is a
   * design input for the accompany-don't-replace change, NOT a licence to widen
   * `APPROVED_OPENINGS`.
   *
   * This test pins the CURRENT behaviour exactly, so it REDs if the set grows
   * OR shrinks — i.e. if anyone widens the patterns without deciding to.
   */
  const MODEL_AUTHORED_CAVEATS_NOT_RECOGNISED: readonly string[] = [
    'That 89% result predates recent changes to your model, so treat it as a starting point rather than a current answer.',
    'That 89% result is from before your recent changes to cash runway, so re-run the analysis first to see if it still holds.',
  ];

  it('KNOWN GAP: a model-authored caveat is NOT recognised, so the prefix doubles', () => {
    expect(MODEL_AUTHORED_CAVEATS_NOT_RECOGNISED.length).toBeGreaterThan(0);
    for (const modelCaveat of MODEL_AUTHORED_CAVEATS_NOT_RECOGNISED) {
      const out = applyStalenessPrefix(`${modelCaveat} ${SAMPLE_TEXT}`, 'stale');
      // The gap, stated as an assertion rather than as a comment.
      expect(out.prefixed).toBe(true);
      expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
      expect(out.text).toContain(modelCaveat);
    }
  });

  it('CONTRAST CONTROL: the canonical opener IS recognised, so the gap is about wording, not a dead guard', () => {
    // Without this, the test above would pass identically if idempotence were
    // broken outright — an instrument that cannot discriminate is not evidence.
    const out = applyStalenessPrefix(`${STALENESS_PREFIX} ${SAMPLE_TEXT}`, 'stale');
    expect(out.prefixed).toBe(false);
  });

  it('BYTE-PRESERVATION: the shipped user-facing templates are unchanged by this refactor', () => {
    expect(buildAnalysisStaleTemplate()).toBe(
      'These results may be out of date because the model has changed since the last analysis. ' +
        'Would you like to re-run analysis to see how your changes affect the results?',
    );
    expect(buildAnalysisUnconfirmedTemplate()).toBe(
      "The last analysis may be out of date because I can't confirm it still matches the current model. " +
        'Re-run analysis to see the current result.',
    );
  });
});
