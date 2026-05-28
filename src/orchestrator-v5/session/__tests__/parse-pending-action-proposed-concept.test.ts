/**
 * V5 P0 — parsePendingAction shape pinning for proposed_concept.
 *
 * Pins the contract:
 *   - kind: 'proposed_concept' is recognised by parsePendingAction
 *   - concept (non-empty string ≤120 chars), preferred_kind (risk|factor|either),
 *     public_label, public_message are REQUIRED
 *   - any missing / malformed field yields null (entry dropped at read time)
 */

import { describe, expect, it } from 'vitest';

import { parsePendingAction } from '../pending-action.js';

const BASE = {
  id: 'pa_proposed_concept_1',
  scenario_id: 'scn_1',
  chip_id: 'pa_proposed_concept_1',
  expires_at_turn_count: 2,
  expires_at_iso: '2099-01-01T00:00:00.000Z',
  emitted_at_iso: '2026-05-28T12:00:00.000Z',
};

describe('parsePendingAction — proposed_concept', () => {
  it('accepts a well-formed proposed_concept entry', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: 'team morale or cultural fit',
        preferred_kind: 'factor',
        public_label: 'Continue with the proposed update',
        public_message: 'Continue with team morale or cultural fit.',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).not.toBeNull();
  });

  it('accepts a proposed_concept entry without graph_hash (optional precondition)', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: 'stakeholder pushback',
        preferred_kind: 'risk',
        public_label: 'Continue with the proposed update',
        public_message: 'Continue with stakeholder pushback.',
      },
      preconditions: {},
    });
    expect(out).not.toBeNull();
  });

  it.each(['risk', 'factor', 'either'])(
    'accepts preferred_kind=%s',
    (preferred_kind) => {
      const out = parsePendingAction({
        ...BASE,
        action: {
          kind: 'proposed_concept',
          concept: 'a concept',
          preferred_kind,
          public_label: 'L',
          public_message: 'M',
        },
        preconditions: {},
      });
      expect(out).not.toBeNull();
    },
  );

  it('rejects missing concept', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        preferred_kind: 'factor',
        public_label: 'L',
        public_message: 'M',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('rejects empty concept', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: '',
        preferred_kind: 'factor',
        public_label: 'L',
        public_message: 'M',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('rejects concept longer than 120 chars', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: 'x'.repeat(121),
        preferred_kind: 'factor',
        public_label: 'L',
        public_message: 'M',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('rejects invalid preferred_kind', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: 'a concept',
        preferred_kind: 'edge', // not in {risk, factor, either}
        public_label: 'L',
        public_message: 'M',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('rejects missing public_label', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: 'a concept',
        preferred_kind: 'factor',
        public_message: 'M',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('rejects empty public_message', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        kind: 'proposed_concept',
        concept: 'a concept',
        preferred_kind: 'factor',
        public_label: 'L',
        public_message: '',
      },
      preconditions: {},
    });
    expect(out).toBeNull();
  });

  it('still parses existing apply_proposed_change entries unchanged (back-compat)', () => {
    const out = parsePendingAction({
      id: 'pa_apc_1',
      scenario_id: 'scn_1',
      chip_id: 'prop_aaaaaaaaaaaa',
      expires_at_turn_count: 2,
      expires_at_iso: '2099-01-01T00:00:00.000Z',
      emitted_at_iso: '2026-05-28T12:00:00.000Z',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop_aaaaaaaaaaaa',
        inline_patch: { handler_id: 'add_constraint', params: {} },
        public_label: 'Add cap',
        public_message: 'Add cap.',
      },
      preconditions: { graph_hash: 'h_abc' },
    });
    expect(out).not.toBeNull();
  });
});
