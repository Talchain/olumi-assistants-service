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
import { decideProposedChangeSynthesis } from '../../routing/proposed-change-synthesis.js';
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

/**
 * ⭐⭐⭐ THE REAL BUILDER → EMITTER → SYNTHESIS CHAIN, with a real
 * post-emission creation fact (Codex CX-210, who found this by executing it).
 *
 * THE DEFECT: a correction proposal lists BOTH endpoints in
 * `target_entity_ids`, and it must — that is what invalidates the offer if
 * either node disappears. But the completion matcher then accepted a fact at
 * EITHER end, and the fact that CREATED the wrong row is committed AFTER the
 * proposal is emitted, so it also passes the timestamp filter. Its node_id,
 * operator, value and unit all match, because the proposal is offering to move
 * exactly that limit. Result: `already_applied`, and the limit never moves.
 *
 * ⚠ THE SHORTCUT WOULD BE TO DROP THE SOURCE FROM `target_entity_ids`. That
 * hides the symptom and removes the source-side freshness protection. Both
 * protections stay; the COMPLETION test is what became move-aware. The stale-
 * hash arm below is here to prove the freshness protection still bites.
 */
describe('the real chain: a same-turn source fact must not complete the move', () => {
  const SOURCE = 'dac3fdc3';
  const DEST = '7809def4';
  const HASH = 'sha256:aaaaaaaaaaaa1234';
  const EMITTED_AT = '2026-09-16T12:00:00.000Z';

  const emitOffer = () => {
    const proposal = buildConstraintTargetCorrection({
      misplaced: MISPLACED, alternative: ALTERNATIVE,
    });
    if (proposal === null) throw new Error('expected a proposal');
    const result = emitProposedChange(proposal, {
      scenario_id: 'scn-1', graph_hash: HASH,
      emitted_at_iso: EMITTED_AT, registry: getDefaultRegistry(),
    });
    if (result.status !== 'success') throw new Error(`emit refused: ${JSON.stringify(result)}`);
    return result;
  };

  /** The row-creation fact for the ORIGINAL wrong bind — committed AFTER emit. */
  const sourceCreationFact = () => ({
    fact: {
      fact_type: 'add_constraint', fact_version: 1, noop: false,
      result: {
        status: 'applied', target_id: 'gc-wrong', before: null,
        after: { constraint_id: 'gc-wrong', node_id: SOURCE, operator: '<=', value: 200000, unit: '£' },
      },
    },
    turn_id: 't1',
    fact_created_at: '2026-09-16T12:00:05.000Z', // AFTER emission — passes the filter
  });

  /** A genuine move: written at the DESTINATION, displacing the source row. */
  const moveFact = () => ({
    fact: {
      fact_type: 'add_constraint', fact_version: 1, noop: false,
      result: {
        status: 'applied', target_id: 'gc-moved',
        before: { constraint_id: 'gc-wrong', node_id: SOURCE, operator: '<=', value: 200000, unit: '£' },
        after: { constraint_id: 'gc-moved', node_id: DEST, operator: '<=', value: 200000, unit: '£' },
      },
    },
    turn_id: 't2',
    fact_created_at: '2026-09-16T12:00:09.000Z',
  });

  const decide = (facts: unknown[]) =>
    decideProposedChangeSynthesis({
      pending: emitOffer().pending,
      currentGraphHash: HASH,
      priorFactsWithTurn: facts as never,
    });

  it('⛔ THE DEFECT: the original wrong-source fact must NOT read as already applied', () => {
    expect(decide([sourceCreationFact()]).status).toBe('execute');
  });

  it('⭐ a genuine MOVE fact DOES complete it — the matcher still matches something', () => {
    // Without this arm the test above could pass because the matcher now
    // matches nothing at all, which would be a different defect wearing the
    // same green tick.
    expect(decide([moveFact()]).status).toBe('already_applied');
  });

  it('⛔ an IN-PLACE UPDATE of the wrong row is not a move either', async () => {
    // ⚠ FOUND BY A SURVIVING MUTANT, not by design. Dropping the
    // `after.node_id !== corrects_node_id` conjunct left every other test
    // green, so it was an untested claim — and a surviving mutant is a claim
    // either way.
    //
    // This is the case that makes it load-bearing: the user restates the limit
    // on the WRONG node, so the fact carries before.node_id === after.node_id
    // === the source. That satisfies "before names the row we meant to
    // displace" while displacing nothing, and would retire an offer whose work
    // has not been done.
    const inPlaceUpdate = {
      fact: {
        fact_type: 'add_constraint', fact_version: 1, noop: false,
        result: {
          status: 'applied', target_id: 'gc-wrong',
          before: { constraint_id: 'gc-wrong', node_id: SOURCE, operator: '<=', value: 180000, unit: '£' },
          after: { constraint_id: 'gc-wrong', node_id: SOURCE, operator: '<=', value: 200000, unit: '£' },
        },
      },
      turn_id: 't1b',
      fact_created_at: '2026-09-16T12:00:07.000Z',
    };
    expect(decide([inPlaceUpdate]).status).toBe('execute');
  });

  it('⭐ no facts at all — execute', () => {
    expect(decide([]).status).toBe('execute');
  });

  it('⛔ FRESHNESS STILL BITES: a moved graph supersedes the offer', () => {
    // Proves the fix did not buy move-awareness by weakening the endpoint
    // protections, which was the available shortcut.
    const decision = decideProposedChangeSynthesis({
      pending: emitOffer().pending,
      currentGraphHash: 'sha256:bbbbbbbbbbbb9999',
      priorFactsWithTurn: [],
    });
    expect(decision.status).toBe('superseded');
  });

  it('⭐ the VISIBLE chip corresponds to the persisted pending', () => {
    // The offer was armed with a hidden pending and no chip: nothing for the
    // user to click, and commit does not reconstruct one.
    const { chip, pending } = emitOffer();
    expect(chip.id).toBe(pending.chip_id);
    expect((pending.action as { proposal_ref?: string }).proposal_ref).toBe(chip.id);
  });

  it('⭐ BOTH endpoints stay in the proposal — the freshness protection is intact', () => {
    const pending = emitOffer().pending;
    const targets = (pending.preconditions as { target_entity_ids?: string[] }).target_entity_ids;
    expect(targets).toEqual(expect.arrayContaining([DEST, SOURCE]));
  });
});
