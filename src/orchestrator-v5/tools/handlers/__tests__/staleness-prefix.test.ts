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
} from '../staleness-prefix.js';

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
    const out = applyStalenessPrefix(SAMPLE_TEXT, 'loaded_from_prior_run_freshness_unknown');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.text.endsWith(SAMPLE_TEXT)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('idempotent: text opening with STALENESS_PREFIX is not re-prepended', () => {
    const already = `${STALENESS_PREFIX} ${SAMPLE_TEXT}`;
    const out = applyStalenessPrefix(already, 'loaded_from_prior_run_freshness_unknown');
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
    const out = applyStalenessPrefix(already, 'loaded_from_prior_run_freshness_unknown');
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
    const out = applyStalenessPrefix(lenient, 'loaded_from_prior_run_freshness_unknown');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent when a number appears BEFORE the caveat (Sonnet figures-first)', () => {
    // The text does NOT open with a caveat — it opens with a figure,
    // followed later by a caveat. The trust contract requires the user
    // reads the caveat first; we always prepend in this case.
    const figuresFirst =
      'Hire Senior Engineer leads at 0.62 probability. From a prior run, with unknown freshness.';
    const out = applyStalenessPrefix(figuresFirst, 'loaded_from_prior_run_freshness_unknown');
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
    const out = applyStalenessPrefix(currencyFirst, 'loaded_from_prior_run_freshness_unknown');
    expect(out.text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(out.prefixed).toBe(true);
  });

  it('NOT idempotent for caveat buried in middle paragraph regardless of numeric format', () => {
    // Even with no obvious numeric pattern, an opening that does not
    // match the approved-openings list triggers prepending. The buried
    // caveat is not enough to satisfy the trust contract.
    const buried =
      'Looking at the structure, three pathways shape the goal. The strongest pathway has notable influence. As a final note, this analysis is from a prior run with unknown freshness.';
    const out = applyStalenessPrefix(buried, 'loaded_from_prior_run_freshness_unknown');
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
