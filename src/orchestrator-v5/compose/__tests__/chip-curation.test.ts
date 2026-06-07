/**
 * V5 Lane 2 — deterministic chip-curation contract tests.
 *
 * Covers the full egress policy: malformed drop, copy-unsafe drop (leak tokens,
 * prose jargon, narrow bare-decimal guard with display-format + user-label
 * exemptions), exact + near-duplicate dedupe (action_type-aware, proposal-
 * preferring), category-aware budget with proposal / disambiguation / pending-
 * bearing protection, no-filler, idempotency, content-free suppression records,
 * and strict wire-shape preservation.
 */

import { describe, expect, it } from 'vitest';

import { curateChips, isChipCopyUnsafe, type ChipSuppression } from '../chip-curation.js';
import type { SuggestedAction } from '../types.js';

// ─── chip factories ─────────────────────────────────────────────────────────

function prompt(id: string, label: string, message = `${label}.`): SuggestedAction {
  return { id, label, message };
}
function action(
  id: string,
  label: string,
  action_type: SuggestedAction['action_type'],
  message = `${label}.`,
): SuggestedAction {
  return { id, label, message, action_type };
}
/** A proposal chip (prop_ id, server-only action_type). */
function proposal(idSuffix: string, label: string, message = `${label}.`): SuggestedAction {
  return { id: `prop_${idSuffix}`, label, message, action_type: 'set_factor_value' };
}
/** An entity disambiguation chip (chip_entity_ id, no action_type). */
function entity(idSuffix: string, label: string): SuggestedAction {
  return { id: `chip_entity_${idSuffix}`, label, message: `I meant ${label}.` };
}

function reasons(s: readonly ChipSuppression[]): string[] {
  return s.map((x) => x.reason);
}
function ids(chips: readonly SuggestedAction[]): string[] {
  return chips.map((c) => c.id);
}

// ─── 1. malformed ───────────────────────────────────────────────────────────

describe('curateChips — malformed', () => {
  it('empty in → empty out, no suppressions (no filler)', () => {
    const r = curateChips([]);
    expect(r.chips).toEqual([]);
    expect(r.suppressions).toEqual([]);
  });

  it('drops blank id / label / message', () => {
    const ok = prompt('chip_prompt_ok', 'Explain the result');
    const r = curateChips([
      { id: '', label: 'L', message: 'M' },
      { id: 'a', label: '   ', message: 'M' },
      { id: 'b', label: 'L', message: '' },
      ok,
    ]);
    expect(ids(r.chips)).toEqual(['chip_prompt_ok']);
    expect(reasons(r.suppressions)).toEqual(['malformed', 'malformed', 'malformed']);
  });
});

// ─── 2. copy safety ─────────────────────────────────────────────────────────

describe('curateChips — copy safety', () => {
  it('drops chips leaking a handler id, prop_/chip_ token, graph_hash or JSON', () => {
    const r = curateChips([
      prompt('chip_prompt_h', 'Try run_analysis now'),
      prompt('chip_prompt_p', 'See prop_abc123'),
      prompt('chip_prompt_g', 'graph_hash mismatch'),
      prompt('chip_prompt_j', 'value {"x":1}'),
    ]);
    expect(r.chips).toEqual([]);
    expect(reasons(r.suppressions)).toEqual([
      'copy_unsafe',
      'copy_unsafe',
      'copy_unsafe',
      'copy_unsafe',
    ]);
  });

  it('drops prose jargon (orchestrator / _meta / prescriptive)', () => {
    const r = curateChips([
      prompt('chip_prompt_o', 'the orchestrator decided'),
      prompt('chip_prompt_m', 'open _meta'),
      prompt('chip_prompt_r', 'the recommended option'),
    ]);
    expect(r.chips).toEqual([]);
    expect(r.suppressions.every((s) => s.reason === 'copy_unsafe')).toBe(true);
  });

  it('KEEPS legitimate em-dash chips (regression guard)', () => {
    const cancel: SuggestedAction = {
      id: 'edit_clarify_cancel',
      label: 'Cancel — keep model unchanged',
      message: 'Cancel that change — keep the model as it is.',
    };
    const premortem = prompt(
      'chip_prompt_pm',
      'Run a pre-mortem',
      'Imagine this decision went wrong — what would have caused it?',
    );
    const r = curateChips([cancel, premortem]);
    expect(ids(r.chips)).toEqual(['edit_clarify_cancel', 'chip_prompt_pm']);
    expect(r.suppressions).toEqual([]);
  });
});

describe('curateChips — narrow decimal guard', () => {
  it('drops a bare model-scale decimal on a next-action chip', () => {
    const r = curateChips([prompt('chip_prompt_d', 'Set it to 0.4732')]);
    expect(r.chips).toEqual([]);
    expect(reasons(r.suppressions)).toEqual(['copy_unsafe']);
  });

  it('drops a bare decimal on a proposal chip', () => {
    const r = curateChips([proposal('x', 'Test marketing at 0.4732')]);
    expect(r.chips).toEqual([]);
    expect(reasons(r.suppressions)).toEqual(['copy_unsafe']);
  });

  it('keeps display-formatted decimals (£1.50, $2.00, 12.5%) on next-action & proposal chips', () => {
    const r = curateChips([
      prompt('chip_prompt_pct', 'Cut waste by 12.5%'),
      proposal('cur', 'Test budget at £1.50'),
      proposal('usd', 'Test budget at $2.00'),
    ]);
    expect(ids(r.chips).sort()).toEqual(['chip_prompt_pct', 'prop_cur', 'prop_usd']);
    expect(r.suppressions).toEqual([]);
  });

  it('keeps a user-authored decimal label (Plan 2.5) on a disambiguation chip', () => {
    const r = curateChips([entity('opt-0', 'Plan 2.5'), entity('opt-1', 'Plan 3.0')]);
    expect(ids(r.chips)).toEqual(['chip_entity_opt-0', 'chip_entity_opt-1']);
    expect(r.suppressions).toEqual([]);
  });

  it('still drops a disambiguation chip that leaks an internal token', () => {
    const r = curateChips([entity('bad', 'graph_hash 2.5'), entity('ok', 'Plan 2.5')]);
    expect(ids(r.chips)).toEqual(['chip_entity_ok']);
    expect(reasons(r.suppressions)).toEqual(['copy_unsafe']);
  });

  it('isChipCopyUnsafe: bare decimal flagged only when not decimal-exempt', () => {
    expect(isChipCopyUnsafe('Set it to 0.4732', false)).toBe(true);
    expect(isChipCopyUnsafe('Set it to 0.4732', true)).toBe(false);
    expect(isChipCopyUnsafe('Cut by 12.5%', false)).toBe(false);
    expect(isChipCopyUnsafe('Plan 2.5', true)).toBe(false);
    // leak tokens apply regardless of decimal exemption
    expect(isChipCopyUnsafe('see graph_hash', true)).toBe(true);
  });
});

// ─── 3. dedupe ──────────────────────────────────────────────────────────────

describe('curateChips — dedupe', () => {
  it('drops exact-id duplicates (keep first)', () => {
    const a = prompt('chip_prompt_x', 'Explore options', 'Explore the options now.');
    const aDup = prompt('chip_prompt_x', 'Different label', 'Different message.');
    const r = curateChips([a, aDup]);
    expect(ids(r.chips)).toEqual(['chip_prompt_x']);
    expect(r.chips[0]!.label).toBe('Explore options');
    expect(reasons(r.suppressions)).toEqual(['duplicate']);
  });

  it('drops near-duplicates (normalised label+message), keep first', () => {
    const a = prompt('chip_prompt_a', 'Re-run analysis', 'Please re-run the analysis.');
    const b = prompt('chip_prompt_b', 're-run analysis.', 'Please re-run the analysis.');
    const r = curateChips([a, b]);
    expect(ids(r.chips)).toEqual(['chip_prompt_a']);
    expect(reasons(r.suppressions)).toEqual(['near_duplicate']);
  });

  it('does NOT merge same-copy chips when action_type differs', () => {
    const exec = action('chip_action_ra', 'Run the analysis', 'run_analysis', 'Run the analysis.');
    const promptChip = prompt('chip_prompt_ra', 'Run the analysis', 'Run the analysis.');
    const r = curateChips([exec, promptChip]);
    expect(ids(r.chips).sort()).toEqual(['chip_action_ra', 'chip_prompt_ra']);
    expect(r.suppressions).toEqual([]);
  });

  it('prefers the proposal on a near-dup collision regardless of order', () => {
    const plain = action('chip_action_sf', 'Test marketing at 15', 'set_factor_value', 'Check marketing at 15.');
    const prop = proposal('mk', 'Test marketing at 15', 'Check marketing at 15.');
    const forward = curateChips([plain, prop]);
    expect(ids(forward.chips)).toEqual(['prop_mk']);
    const reverse = curateChips([prop, plain]);
    expect(ids(reverse.chips)).toEqual(['prop_mk']);
  });
});

// ─── 4. budget + protection ─────────────────────────────────────────────────

describe('curateChips — budget & protection', () => {
  it('trims a 4th next-action chip to the 3-chip budget, preserving order', () => {
    const r = curateChips([
      prompt('chip_prompt_1', 'One'),
      prompt('chip_prompt_2', 'Two'),
      prompt('chip_prompt_3', 'Three'),
      prompt('chip_prompt_4', 'Four'),
    ]);
    expect(ids(r.chips)).toEqual(['chip_prompt_1', 'chip_prompt_2', 'chip_prompt_3']);
    expect(reasons(r.suppressions)).toEqual(['budget_trimmed']);
  });

  it('protects a proposal from budget trimming (drops a plain chip instead)', () => {
    const r = curateChips([
      prompt('chip_prompt_1', 'One'),
      prompt('chip_prompt_2', 'Two'),
      prompt('chip_prompt_3', 'Three'),
      proposal('x', 'Test budget at £100'),
    ]);
    expect(r.chips).toHaveLength(3);
    expect(ids(r.chips)).toContain('prop_x');
    expect(ids(r.chips)).not.toContain('chip_prompt_3');
    expect(reasons(r.suppressions)).toEqual(['budget_trimmed']);
  });

  it('never truncates a disambiguation choice-set to the budget', () => {
    const set = [0, 1, 2, 3, 4].map((i) => entity(`opt-${i}`, `Option ${String.fromCharCode(65 + i)}`));
    const r = curateChips(set);
    expect(r.chips).toHaveLength(5);
    expect(r.suppressions).toEqual([]);
  });

  it('divergence-safety: pending-bearing action chips are never budget-trimmed', () => {
    const r = curateChips([
      action('chip_action_ra', 'Run the analysis', 'run_analysis'),
      action('chip_action_wf', 'What could change the outcome?', 'what_would_flip'),
      proposal('p', 'Test budget at £100'),
      prompt('chip_prompt_extra', 'Run a pre-mortem'),
    ]);
    // All three pending-bearing/proposal chips survive; the plain prompt is trimmed.
    expect(ids(r.chips)).toEqual(['chip_action_ra', 'chip_action_wf', 'prop_p']);
    expect(reasons(r.suppressions)).toEqual(['budget_trimmed']);
  });

  it('respects a custom maxChips option', () => {
    const r = curateChips([prompt('a', 'A'), prompt('b', 'B'), prompt('c', 'C')], { maxChips: 2 });
    expect(ids(r.chips)).toEqual(['a', 'b']);
    expect(reasons(r.suppressions)).toEqual(['budget_trimmed']);
  });
});

// ─── 5. unsafe-proposal handling ────────────────────────────────────────────

describe('curateChips — unsafe proposals', () => {
  it('drops an unsafe proposal (copy safety beats protection)', () => {
    const r = curateChips([
      { id: 'prop_bad', label: 'apply_proposed_change now', message: 'do it', action_type: 'set_factor_value' },
    ]);
    expect(r.chips).toEqual([]);
    expect(reasons(r.suppressions)).toEqual(['copy_unsafe']);
  });

  it('an unsafe proposal frees its budget slot for next-action chips', () => {
    const r = curateChips([
      { id: 'prop_bad', label: 'set_factor_value leak', message: 'leak', action_type: 'set_factor_value' },
      prompt('chip_prompt_1', 'One'),
      prompt('chip_prompt_2', 'Two'),
      prompt('chip_prompt_3', 'Three'),
    ]);
    expect(ids(r.chips)).toEqual(['chip_prompt_1', 'chip_prompt_2', 'chip_prompt_3']);
    expect(reasons(r.suppressions)).toEqual(['copy_unsafe']);
  });
});

// ─── 6. idempotency, content-free telemetry, strict shape ───────────────────

describe('curateChips — invariants', () => {
  it('is idempotent: re-running the output yields the same chips and no suppressions', () => {
    const input = [
      prompt('chip_prompt_1', 'One'),
      prompt('chip_prompt_1', 'One dup'),
      prompt('chip_prompt_2', 'Two'),
      prompt('chip_prompt_3', 'Three'),
      prompt('chip_prompt_4', 'Four'),
    ];
    const first = curateChips(input);
    const second = curateChips(first.chips);
    expect(ids(second.chips)).toEqual(ids(first.chips));
    expect(second.suppressions).toEqual([]);
  });

  it('emits content-free suppression records (no chip text)', () => {
    const r = curateChips([
      { id: 'x', label: '', message: 'M' },
      prompt('chip_prompt_h', 'Try run_analysis'),
      action('chip_action_ra', 'Run', 'run_analysis'),
      action('chip_action_ra', 'Run dup', 'run_analysis'),
    ]);
    for (const s of r.suppressions) {
      const keys = Object.keys(s).sort();
      // Only closed-enum / safe fields. Never label/message/user text.
      expect(keys.every((k) => k === 'reason' || k === 'category' || k === 'action_type')).toBe(true);
      expect(s).not.toHaveProperty('label');
      expect(s).not.toHaveProperty('message');
      expect(['proposal', 'disambiguation', 'next_action', 'unknown']).toContain(s.category);
    }
  });

  it('preserves the strict wire shape (no extra keys)', () => {
    const r = curateChips([action('chip_action_ra', 'Run the analysis', 'run_analysis')]);
    expect(r.chips).toHaveLength(1);
    expect(Object.keys(r.chips[0]!).sort()).toEqual(['action_type', 'id', 'label', 'message']);
  });

  it('passes a clean, under-budget set through unchanged', () => {
    const input = [
      action('chip_action_explain_results', 'Explain the result', 'explain_results'),
      action('chip_action_what_would_flip', 'What could change the outcome?', 'what_would_flip'),
    ];
    const r = curateChips(input);
    expect(r.chips).toEqual(input);
    expect(r.suppressions).toEqual([]);
  });
});
