/**
 * `assertWhatChanged` denial-of-recent-edit + factor-label-required
 * regression guard.
 *
 * Background: a `dl7-edit-graph` rerun against staging build `6211789`
 * (2026-05-10/-11) showed the assistant responding to Step 3
 * ("what did you change?") with "I haven't applied any changes in
 * this session yet" — *after* Step 2 had returned `mutation_ack="now
 * has"` / `mutation_ack="Strengthened"`. The pre-existing
 * `assertWhatChanged` logged `mentioned=false` in the evidence row but
 * still returned `ok: true`, producing a false-PASS that survived
 * commit review.
 *
 * The tightened assertion fails on:
 *   1. denial-of-recent-edit phrasing (regex set in `assertions.ts`);
 *   2. `factor_label_not_referenced` — when Step 1 captured a factor
 *      label, the deterministic state-query reply must mention it.
 *
 * These tests lock those behaviours in so a future relaxation cannot
 * silently restore the false-PASS path.
 */

import { describe, it, expect } from 'vitest';

import { assertWhatChanged } from '../../../tools/v5-journey-replay/assertions.js';

const FACTOR = 'Incremental Hiring Cost';

describe('assertWhatChanged — denial-of-recent-edit regression guard', () => {
  // Two of these fixtures ("I haven't applied any changes in this session
  // yet." / "I have not applied any changes in this session yet." / "No
  // changes have been applied so far.") are now ALSO literal entries in
  // the canonical FORBIDDEN_USER_FACING_PHRASES list (src/orchestrator-v5/
  // compose/forbidden-user-facing-phrases.ts), which coreAssertions()'s
  // noForbiddenTerms() scans BEFORE assertWhatChanged's own denialPatterns
  // check ever runs (assertions.ts:564 calls coreAssertions() first). The
  // harness deliberately imports the same constant as the runtime egress
  // guard ("the harness and runtime agree on the contradiction list" —
  // forbidden-terms.ts) precisely so historical incident text like this
  // gets caught even earlier. The end-to-end regression guarantee this
  // test locks in — "the exact text observed on staging build 6211789
  // must fail" — still holds; only WHICH contract reports the failure
  // changed. Fixtures whose exact wording is not on that shared list
  // (e.g. "yet applied", "made any changes", "edits") still reach and
  // exercise assertWhatChanged's own denialPatterns branch directly.
  const FORBIDDEN_LIST_OVERLAP = new Set([
    "I haven't applied any changes in this session yet.",
    'I have not applied any changes in this session yet.',
    'No changes have been applied so far.',
  ]);

  it.each([
    "I haven't applied any changes in this session yet.",
    "I have not applied any changes in this session yet.",
    "I haven't yet applied any changes.",
    "I haven't made any changes in this session.",
    'No changes have been applied so far.',
    'No edits were made in this session.',
    'Nothing has been changed yet.',
    'Nothing has been applied.',
    "I don't see any recent changes to summarise.",
    'I do not see any recent edits.',
  ])('fails when Step 3 text denies a recent edit: %s', (text) => {
    const r = assertWhatChanged(
      { status: 200, body: { assistant_text: text, suggested_actions: [] }, elapsed_ms: 100 },
      { factorLabel: FACTOR },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      if (FORBIDDEN_LIST_OVERLAP.has(text)) {
        expect(r.failing_contract).toMatch(/^forbidden terms in assistant_text:/);
      } else {
        expect(r.failing_contract).toBe('what_changed_denies_recent_edit');
        expect(r.evidence).toMatch(/denial_pattern=/);
        expect(r.evidence).toMatch(/mentioned=false/);
      }
    }
  });

  it('still fails the denial gate when no factor-label context is supplied', () => {
    const r = assertWhatChanged(
      {
        status: 200,
        body: {
          assistant_text:
            "I haven't applied any changes in this session yet. Tell me what to update.",
          suggested_actions: [],
        },
        elapsed_ms: 100,
      },
      undefined,
    );
    expect(r.ok).toBe(false);
    // Same shared-forbidden-list precedence as above — this exact phrase
    // is caught by coreAssertions() before assertWhatChanged's own check.
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/^forbidden terms in assistant_text:/);
    }
  });

  it('fails when the captured factor label is not referenced (and text is not a denial)', () => {
    const r = assertWhatChanged(
      {
        status: 200,
        body: {
          assistant_text:
            'You updated the most recently changed factor and bumped its causal weight slightly.',
          suggested_actions: [],
        },
        elapsed_ms: 100,
      },
      { factorLabel: FACTOR },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toBe('what_changed_factor_label_not_referenced');
      expect(r.evidence).toMatch(/factor_label="Incremental Hiring Cost"/);
      expect(r.evidence).toMatch(/mentioned=false/);
    }
  });

  it('passes when the response mentions the captured factor label and is not a denial', () => {
    const r = assertWhatChanged(
      {
        status: 200,
        body: {
          assistant_text:
            `${FACTOR} was strengthened: its effect on Budget Overrun Risk now uses a stronger causal weight.`,
          suggested_actions: [],
        },
        elapsed_ms: 100,
      },
      { factorLabel: FACTOR },
    );
    expect(r.ok).toBe(true);
    expect(r.evidence).toMatch(/mentioned=true/);
    expect(r.evidence).toMatch(/safe_summary=ok/);
  });

  it('passes when no factor-label context is supplied and the text is not a denial', () => {
    const r = assertWhatChanged(
      {
        status: 200,
        body: {
          assistant_text:
            'Adjusted the staffing-cost edge and noted that only one outbound path is affected.',
          suggested_actions: [],
        },
        elapsed_ms: 100,
      },
      undefined,
    );
    expect(r.ok).toBe(true);
    expect(r.evidence).toMatch(/factor_label=""/);
    expect(r.evidence).toMatch(/mentioned=false/);
  });

  it('still fails on an empty Step 3 body (pre-existing empty-text guard)', () => {
    const r = assertWhatChanged(
      { status: 200, body: { assistant_text: '', suggested_actions: [] }, elapsed_ms: 100 },
      { factorLabel: FACTOR },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toBe('what_changed_empty_text');
    }
  });
});
