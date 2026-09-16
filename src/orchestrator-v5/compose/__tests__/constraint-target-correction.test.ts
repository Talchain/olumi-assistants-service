/**
 * ⭐⭐ THE PRODUCER FOR `corrects_node_id` — and it is tested THROUGH THE REAL
 * EMITTER, because the emitter can REFUSE.
 *
 * `emitProposedChange` returns `unsafe_copy` for copy carrying internal
 * vocabulary or a raw decimal, and a refusal here would drop the chip while
 * leaving nothing to confirm. Asserting that the filter "would have been happy"
 * is exactly the guard-agreeing-with-itself defect; these run the filter.
 *
 * The end-to-end plumbing was derived at the bytes before any of this was
 * written, so the spec knows what it is entitled to assume:
 *   · `proposed-change-synthesis.ts` projects `inline_patch.params` one
 *     ProposalParameter per top-level key — a FLAT projection, no allowlist;
 *   · `validator.ts:504` does `if (!schema) continue`, so a parameter the
 *     handler does not declare reaches it untouched (a pinned contract).
 * Hence `corrects_node_id` survives the whole way, and the last test proves it
 * rather than trusting the trace.
 */
import { describe, expect, it } from 'vitest';

import { buildConstraintTargetCorrection } from '../constraint-target-correction.js';
import { emitProposedChange } from '../proposed-change.js';
import { getDefaultRegistry } from '../../tools/registry.js';
import type { ProposedChangeContext } from '../../types/proposed-change.js';

/** Paul's 16 Sep case, ids and labels verbatim. */
const MISPLACED = {
  nodeId: 'dac3fdc3',
  nodeLabel: 'Budget Overrun Risk',
  operator: '<=' as const,
  value: 200000,
  unit: '£',
};
const ALTERNATIVE = { nodeId: '7809def4', label: 'Hiring and Onboarding Cost' };

const ctx = (): ProposedChangeContext => ({
  scenario_id: 'scn-1',
  graph_hash: 'sha256:aaaaaaaaaaaa1234',
  emitted_at_iso: '2026-09-16T12:00:00.000Z',
  registry: getDefaultRegistry(),
});

const build = (over: Partial<Parameters<typeof buildConstraintTargetCorrection>[0]> = {}) =>
  buildConstraintTargetCorrection({ misplaced: MISPLACED, alternative: ALTERNATIVE, ...over });

describe('buildConstraintTargetCorrection', () => {
  it('⭐ carries corrects_node_id — without it the confirmation APPENDS a second limit', () => {
    expect(build()?.params).toMatchObject({
      constraint_type: 'at_most',
      value: 200000,
      unit: '£',
      corrects_node_id: 'dac3fdc3',
    });
  });

  it('⭐ names BOTH nodes as targets so the resumer invalidates if either is gone', () => {
    expect(build()?.target_entity_ids).toEqual(['7809def4', 'dac3fdc3']);
  });

  it('⛔ proposes NOTHING when the alternative is the node already targeted', () => {
    expect(build({ alternative: { nodeId: 'dac3fdc3', label: 'Budget Overrun Risk' } })).toBeNull();
  });

  it.each([
    ['no unit', { ...MISPLACED, unit: '  ' }],
    ['a non-finite value', { ...MISPLACED, value: Number.NaN }],
    ['an empty label', { ...MISPLACED, nodeLabel: '' }],
  ])('⛔ proposes NOTHING on %s — never a move it cannot specify completely', (_n, misplaced) => {
    expect(build({ misplaced })).toBeNull();
  });

  it('renders the amount the way a person writes it, symbol hugging the number', () => {
    expect(build()?.message).toContain('£200,000');
  });

  it('renders a UNIT CODE detached from the number', () => {
    const p = build({ misplaced: { ...MISPLACED, unit: 'FTE', value: 12 } });
    expect(p?.message).toContain('12 FTE');
  });
});

describe('it survives the REAL emitter, which can refuse', () => {
  it('⭐ emits — the copy passes the safety and raw-decimal filters', () => {
    const proposal = build();
    if (proposal === null) throw new Error('expected a proposal');
    const result = emitProposedChange(proposal, ctx());
    if (result.status !== 'success') {
      throw new Error(`emit refused: ${JSON.stringify(result)}`);
    }
    expect(result.chip.id).toMatch(/^prop_[0-9a-f]{12}$/);
  });

  it('⭐⭐ corrects_node_id reaches the PENDING, which is what the resume replays', () => {
    // If this is ever dropped, the confirmed proposal appends a second limit
    // and the original un-evaluable row survives — the exact defect the whole
    // chain exists to remove, re-created silently at the last hop.
    const proposal = build();
    if (proposal === null) throw new Error('expected a proposal');
    const result = emitProposedChange(proposal, ctx());
    if (result.status !== 'success') throw new Error('expected success');
    const patch = result.pending.action as { inline_patch?: Record<string, unknown> };
    expect((patch.inline_patch?.params as Record<string, unknown>)?.corrects_node_id).toBe('dac3fdc3');
    expect(patch.inline_patch?.handler_id).toBe('add_constraint');
  });

  it('⛔ the chip copy leaks no node ids', () => {
    const proposal = build();
    if (proposal === null) throw new Error('expected a proposal');
    expect(`${proposal.label} ${proposal.message}`).not.toMatch(/dac3fdc3|7809def4/);
  });
});
