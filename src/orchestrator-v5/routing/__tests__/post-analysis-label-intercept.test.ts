/**
 * Unit tests for `tryPostAnalysisLabelIntercept` and
 * `composePostAnalysisLabelInterceptResponse`.
 *
 * Two predicates are under test:
 *  - Predicate A — bare label submission (forward-looking).
 *  - Predicate B — legacy `Change <label> [—|–|-]` fill-in shape
 *    (the EXACT observed staging failure on chip clicks rendered by
 *    the pre-Touch-4 `buildLabelChip` in
 *    `compose/edit-clarify-response.ts`).
 *
 * The two predicates are mutually exclusive by construction; this
 * suite asserts the mutual exclusion explicitly so a future refactor
 * cannot silently double-fire.
 */
import { describe, expect, it } from 'vitest';

import {
  composePostAnalysisLabelInterceptResponse,
  tryPostAnalysisLabelIntercept,
  type PostAnalysisLabelInterceptNode,
} from '../post-analysis-label-intercept.js';
import { findForbiddenPhraseHit, findSuccessClaimHit } from '../../compose/forbidden-user-facing-phrases.js';

const FACTOR_NODE: PostAnalysisLabelInterceptNode = {
  id: 'node_team_size',
  kind: 'factor',
  label: 'Existing Team Size',
};

const OPTION_NODE: PostAnalysisLabelInterceptNode = {
  id: 'node_opt_a',
  kind: 'option',
  label: 'Launch Now',
};

const SHORT_LABEL_NODE: PostAnalysisLabelInterceptNode = {
  id: 'node_x',
  kind: 'factor',
  label: 'AB',
};

const NODES: readonly PostAnalysisLabelInterceptNode[] = [FACTOR_NODE, OPTION_NODE];

describe('tryPostAnalysisLabelIntercept — Predicate A (bare label)', () => {
  it('matches an exact label string', () => {
    const result = tryPostAnalysisLabelIntercept('Existing Team Size', NODES, true);
    expect(result).toEqual({
      matched: true,
      predicate: 'bare_label',
      matchedNode: FACTOR_NODE,
      matchKind: 'exact',
    });
  });

  it('matches case-insensitively', () => {
    const result = tryPostAnalysisLabelIntercept('existing team size', NODES, true);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.predicate).toBe('bare_label');
  });

  it('matches after whitespace normalisation', () => {
    const result = tryPostAnalysisLabelIntercept('  Existing   Team   Size  ', NODES, true);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.predicate).toBe('bare_label');
  });

  it('matches an option-kind label', () => {
    const result = tryPostAnalysisLabelIntercept('Launch Now', NODES, true);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.matchedNode).toEqual(OPTION_NODE);
  });

  it('does NOT match when prior analysis is not fresh', () => {
    const result = tryPostAnalysisLabelIntercept('Existing Team Size', NODES, false);
    expect(result).toEqual({ matched: false, reason: 'no_prior_analysis_fresh' });
  });

  it('does NOT match when no graph nodes are supplied', () => {
    const result = tryPostAnalysisLabelIntercept('Existing Team Size', [], true);
    expect(result).toEqual({ matched: false, reason: 'no_graph_nodes' });
  });

  it('does NOT match when nodes is null', () => {
    const result = tryPostAnalysisLabelIntercept('Existing Team Size', null, true);
    expect(result).toEqual({ matched: false, reason: 'no_graph_nodes' });
  });

  it('does NOT match the empty string', () => {
    const result = tryPostAnalysisLabelIntercept('', NODES, true);
    expect(result).toEqual({ matched: false, reason: 'empty_message' });
  });

  it('does NOT match a whitespace-only message', () => {
    const result = tryPostAnalysisLabelIntercept('   \n  ', NODES, true);
    expect(result).toEqual({ matched: false, reason: 'empty_message' });
  });

  it('does NOT match when the message contains an explicit edit verb', () => {
    // "Change Existing Team Size" without a trailing dash falls
    // through both predicates: Predicate B's regex requires the dash;
    // Predicate A's negative gate rejects the "Change" verb.
    const result = tryPostAnalysisLabelIntercept('Change Existing Team Size', NODES, true);
    expect(result).toEqual({ matched: false, reason: 'explicit_edit_verb_present' });
  });

  it('does NOT match when the message contains "set" (explicit edit verb)', () => {
    const result = tryPostAnalysisLabelIntercept('set Existing Team Size', NODES, true);
    expect(result).toEqual({ matched: false, reason: 'explicit_edit_verb_present' });
  });

  it('does NOT match an obvious mutation message (verb gate fires first)', () => {
    // "Set Existing Team Size to 8" carries an edit verb AND a
    // mutation signal. The negative gates run in order: the verb
    // gate fires first, so the canonical rejection reason is
    // `explicit_edit_verb_present`. This pins the gate order against
    // accidental refactors.
    const result = tryPostAnalysisLabelIntercept(
      'Set Existing Team Size to 8',
      NODES,
      true,
    );
    expect(result).toEqual({ matched: false, reason: 'explicit_edit_verb_present' });
  });

  it('does NOT match when the message carries an analytical-intent phrase', () => {
    const result = tryPostAnalysisLabelIntercept(
      'What drives Existing Team Size?',
      NODES,
      true,
    );
    expect(result.matched).toBe(false);
  });

  it('does NOT match an unknown label', () => {
    const result = tryPostAnalysisLabelIntercept('Made Up Factor', NODES, true);
    expect(result).toEqual({ matched: false, reason: 'no_label_match' });
  });

  it('does NOT match labels shorter than 3 characters (guard against stray keystrokes)', () => {
    const result = tryPostAnalysisLabelIntercept('AB', [SHORT_LABEL_NODE], true);
    expect(result).toEqual({ matched: false, reason: 'no_label_match' });
  });
});

describe('tryPostAnalysisLabelIntercept — Predicate B (legacy fill-in)', () => {
  it('matches the exact observed staging failure', () => {
    // The literal shape rendered by the pre-Touch-4 buildLabelChip:
    //   message: `Change ${label} — ` (with the em-dash + trailing space)
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size — ',
      NODES,
      true,
    );
    expect(result).toEqual({
      matched: true,
      predicate: 'legacy_fill_in',
      matchedNode: FACTOR_NODE,
      matchKind: 'exact',
    });
  });

  it('matches the em-dash variant without trailing whitespace', () => {
    const result = tryPostAnalysisLabelIntercept('Change Existing Team Size —', NODES, true);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.predicate).toBe('legacy_fill_in');
  });

  it('matches the en-dash variant', () => {
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size – ',
      NODES,
      true,
    );
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.predicate).toBe('legacy_fill_in');
  });

  it('matches the hyphen-minus variant (UI fallback)', () => {
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size - ',
      NODES,
      true,
    );
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.predicate).toBe('legacy_fill_in');
  });

  it('matches case-insensitively on the "Change" verb', () => {
    const result = tryPostAnalysisLabelIntercept('change Existing Team Size — ', NODES, true);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.predicate).toBe('legacy_fill_in');
  });

  it('does NOT match when a value follows the dash (real edit attempt)', () => {
    // `"Change Existing Team Size — 100"` is a real edit attempt the V4
    // LLM can handle; do not intercept.
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size — 100',
      NODES,
      true,
    );
    expect(result.matched).toBe(false);
  });

  it('does NOT match when the captured label is unknown', () => {
    const result = tryPostAnalysisLabelIntercept('Change Made Up Factor — ', NODES, true);
    expect(result).toEqual({ matched: false, reason: 'no_label_match' });
  });

  it('does NOT match when prior analysis is not fresh', () => {
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size — ',
      NODES,
      false,
    );
    expect(result).toEqual({ matched: false, reason: 'no_prior_analysis_fresh' });
  });

  it('does NOT match when the captured label segment carries a mutation signal', () => {
    // Belt-and-braces: a malformed shape such as the user typing
    // "Change Existing Team Size to 100 — " carries both a mutation
    // signal and the legacy regex shape. Reject on the mutation
    // signal — the V4 LLM can attempt the real edit.
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size to 100 — ',
      NODES,
      true,
    );
    expect(result.matched).toBe(false);
  });
});

describe('tryPostAnalysisLabelIntercept — mutual exclusion', () => {
  it('a Predicate B match does NOT also match Predicate A', () => {
    // "Change Existing Team Size — " matches Predicate B. After the
    // predicate fires, the result discriminates on `predicate:
    // 'legacy_fill_in'`. The function returns at the first match so
    // there is no double-fire by construction. This test pins that
    // behaviour against accidental refactors that re-order the
    // predicates or run both unconditionally.
    const result = tryPostAnalysisLabelIntercept(
      'Change Existing Team Size — ',
      NODES,
      true,
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.predicate).toBe('legacy_fill_in');
      expect(result.predicate).not.toBe('bare_label' as never);
    }
  });

  it('a Predicate A match does NOT also match Predicate B', () => {
    const result = tryPostAnalysisLabelIntercept('Existing Team Size', NODES, true);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.predicate).toBe('bare_label');
    }
  });
});

describe('composePostAnalysisLabelInterceptResponse', () => {
  it('emits the three deterministic chips with correct action_types', () => {
    const response = composePostAnalysisLabelInterceptResponse('Existing Team Size', 'analyse');
    expect(response.suggested_actions).toHaveLength(3);
    const actionTypes = response.suggested_actions.map((a) => a.action_type ?? null);
    expect(actionTypes).toEqual(['explain_results', 'run_analysis', null]);
  });

  it('emits the three expected chip labels', () => {
    const response = composePostAnalysisLabelInterceptResponse('Existing Team Size', 'analyse');
    const labels = response.suggested_actions.map((a) => a.label);
    expect(labels).toEqual([
      'Walk me through the analysis',
      'Re-run analysis',
      'Run a pre-mortem',
    ]);
  });

  it('interpolates the canonical label into the assistant text', () => {
    const response = composePostAnalysisLabelInterceptResponse('Existing Team Size', 'analyse');
    expect(response.assistant_text).toContain('Existing Team Size');
  });

  it('emits a response_version 2 direct-answer envelope with empty blocks/insights', () => {
    const response = composePostAnalysisLabelInterceptResponse('Existing Team Size', 'analyse');
    expect(response.response_version).toBe(2);
    expect(response.blocks).toEqual([]);
    expect(response.insights).toEqual([]);
    expect(response.stage_indicator).toBe('analyse');
  });

  it('assistant_text passes the egress forbidden-phrase guard', () => {
    const response = composePostAnalysisLabelInterceptResponse('Existing Team Size', 'analyse');
    expect(findForbiddenPhraseHit(response.assistant_text)).toBeNull();
  });

  it('assistant_text passes the success-claim guard (no false-commit language)', () => {
    const response = composePostAnalysisLabelInterceptResponse('Existing Team Size', 'analyse');
    expect(findSuccessClaimHit(response.assistant_text)).toBeNull();
  });

  it('passes guards even for labels containing apostrophes or unusual punctuation', () => {
    const response = composePostAnalysisLabelInterceptResponse(
      "Founder's Equity Split",
      'analyse',
    );
    expect(findForbiddenPhraseHit(response.assistant_text)).toBeNull();
    expect(findSuccessClaimHit(response.assistant_text)).toBeNull();
    expect(response.assistant_text).toContain("Founder's Equity Split");
  });
});
