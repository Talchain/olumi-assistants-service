/**
 * V5 G7/G8 — proposal ordinal / label select unit tests.
 */

import { describe, expect, it } from 'vitest';

import { tryProposalOrdinalSelect } from '../proposal-ordinal-select.js';
import type { PendingAction } from '../../session/pending-action.js';

function pa(id: string): PendingAction {
  return {
    id,
    scenario_id: 'scn',
    chip_id: id,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: id,
      inline_patch: { handler_id: 'add_constraint', params: {}, target_entity_ids: [] },
      // Pass-10 P2-1: include the standard-variant required fields so
      // fixtures match the tightened type union (and a future tsc
      // run on tests does not flag this helper).
      public_label: `Label for ${id}`,
      public_message: `Message for ${id}`,
    },
    preconditions: { graph_hash: 'h' },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-05-07T12:00:00.000Z',
  };
}

const A = pa('prop_aaaaaaaaaaaa');
const B = pa('prop_bbbbbbbbbbbb');
const C = pa('prop_cccccccccccc');

describe('tryProposalOrdinalSelect — ordinals', () => {
  it.each([
    ['the first one', 0],
    ['first one', 0],
    ['first', 0],
    ['option 1', 0],
    ['#1', 0],
    ['the first', 0],
    ['1', 0],
  ])('%s with three candidates resolves index 0', (msg, idx) => {
    const out = tryProposalOrdinalSelect({
      message: msg,
      candidates: [A, B, C],
      candidateRenderCopy: [{ label: 'Add cost cap', message: 'Add cost cap.' }, { label: 'Add time cap', message: 'Add time cap.' }, { label: 'Add scope cap', message: 'Add scope cap.' }],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.index).toBe(idx);
  });

  it.each([
    ['second', 1],
    ['the second one', 1],
    ['option 2', 1],
    ['#2', 1],
    ['third', 2],
    ['option 3', 2],
    ['#3', 2],
  ])('%s with three candidates resolves index %d', (msg, idx) => {
    const out = tryProposalOrdinalSelect({
      message: msg,
      candidates: [A, B, C],
      candidateRenderCopy: [{ label: 'Add cost cap', message: 'Add cost cap.' }, { label: 'Add time cap', message: 'Add time cap.' }, { label: 'Add scope cap', message: 'Add scope cap.' }],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.index).toBe(idx);
  });

  it('resolves the first one with one candidate', () => {
    const out = tryProposalOrdinalSelect({
      message: 'the first one',
      candidates: [A],
      candidateRenderCopy: [{ label: 'Add cost cap', message: 'Add cost cap.' }],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.pending).toBe(A);
  });

  it('rejects ordinals beyond the candidate count', () => {
    const out = tryProposalOrdinalSelect({
      message: 'option 5',
      candidates: [A, B],
      candidateRenderCopy: [{ label: 'x', message: 'x.' }, { label: 'y', message: 'y.' }],
    });
    expect(out.matched).toBe(false);
  });
});

describe('tryProposalOrdinalSelect — exact match also works against the rendered message (P1-1)', () => {
  it('resolves when the user types the rendered message text instead of the label', () => {
    const out = tryProposalOrdinalSelect({
      message: 'Add the cost cap.',
      candidates: [A, B],
      candidateRenderCopy: [
        { label: 'Add cost cap', message: 'Add the cost cap.' },
        { label: 'Add time cap', message: 'Add the time cap.' },
      ],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.index).toBe(0);
  });
});

describe('tryProposalOrdinalSelect — exact-label/message match must be unambiguous (P1-2)', () => {
  it('two candidates with identical rendered LABEL and the user types it: NO match', () => {
    const out = tryProposalOrdinalSelect({
      message: 'Apply this change',
      candidates: [A, B],
      candidateRenderCopy: [
        { label: 'Apply this change', message: 'A unique message' },
        { label: 'Apply this change', message: 'B unique message' },
      ],
    });
    expect(out.matched).toBe(false);
  });

  it('two candidates with identical rendered MESSAGE and the user types it: NO match', () => {
    const out = tryProposalOrdinalSelect({
      message: 'Apply the proposed change',
      candidates: [A, B],
      candidateRenderCopy: [
        { label: 'A unique label', message: 'Apply the proposed change' },
        { label: 'B unique label', message: 'Apply the proposed change' },
      ],
    });
    expect(out.matched).toBe(false);
  });

  it('different candidates matching the same string by different fields: NO match', () => {
    const out = tryProposalOrdinalSelect({
      message: 'shared text',
      candidates: [A, B],
      candidateRenderCopy: [
        { label: 'shared text', message: 'A unique message' },
        { label: 'B unique label', message: 'shared text' },
      ],
    });
    expect(out.matched).toBe(false);
  });

  it('a candidate whose label AND message both equal the user input is still ONE match (resolves)', () => {
    const out = tryProposalOrdinalSelect({
      message: 'Apply',
      candidates: [A, B],
      candidateRenderCopy: [
        { label: 'Apply', message: 'Apply' },
        { label: 'Different', message: 'Different.' },
      ],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.index).toBe(0);
  });
});

describe('tryProposalOrdinalSelect — exact label match', () => {
  it('resolves an exact label (case-insensitive)', () => {
    const out = tryProposalOrdinalSelect({
      message: 'Add Time Cap',
      candidates: [A, B],
      candidateRenderCopy: [{ label: 'Add cost cap', message: 'Add cost cap.' }, { label: 'Add time cap', message: 'Add time cap.' }],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.index).toBe(1);
  });

  it('exact label takes priority over a coincidental ordinal word', () => {
    // Label "First quarter" should not silently resolve as ordinal "first".
    const out = tryProposalOrdinalSelect({
      message: 'First quarter',
      candidates: [A, B],
      candidateRenderCopy: [{ label: 'Lock pricing', message: 'Lock pricing.' }, { label: 'First quarter', message: 'First quarter.' }],
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.index).toBe(1);
  });

  it('does not match a partial label', () => {
    const out = tryProposalOrdinalSelect({
      message: 'cost',
      candidates: [A],
      candidateRenderCopy: [{ label: 'Add cost cap', message: 'Add cost cap.' }],
    });
    expect(out.matched).toBe(false);
  });
});

describe('tryProposalOrdinalSelect — negative gates', () => {
  it('rejects messages containing edit verbs', () => {
    const out = tryProposalOrdinalSelect({
      message: 'set 2',
      candidates: [A, B],
      candidateRenderCopy: [{ label: 'x', message: 'x.' }, { label: 'y', message: 'y.' }],
    });
    expect(out.matched).toBe(false);
  });

  it('rejects messages containing add / change / update verbs', () => {
    const out = tryProposalOrdinalSelect({
      message: 'add 1',
      candidates: [A],
      candidateRenderCopy: [{ label: 'x', message: 'x.' }],
    });
    expect(out.matched).toBe(false);
  });

  it('returns false when candidates and labels arrays diverge in length', () => {
    const out = tryProposalOrdinalSelect({
      message: 'first',
      candidates: [A, B],
      candidateRenderCopy: [{ label: 'only one', message: 'only one.' }],
    });
    expect(out.matched).toBe(false);
  });

  it('returns false when there are no candidates', () => {
    const out = tryProposalOrdinalSelect({
      message: 'first',
      candidates: [],
      candidateRenderCopy: [],
    });
    expect(out.matched).toBe(false);
  });
});
