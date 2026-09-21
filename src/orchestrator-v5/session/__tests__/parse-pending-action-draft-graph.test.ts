/**
 * ROADMAP 2.63 C3/C4 — parsePendingAction shape pinning for draft_graph.
 *
 * Pins the contract:
 *   - kind: 'draft_graph' is recognised by parsePendingAction
 *   - public_label / public_message are REQUIRED (the route-level resume
 *     exact-matches the persisted copy; an entry without it is unresumable)
 *   - brief_seed is OPTIONAL; when present it must be a non-empty string
 *     bounded at 8000 chars (the normaliseBriefText / DB bound)
 *   - redraft is OPTIONAL; when present it must be a boolean
 *   - any malformed field yields null (entry dropped at read time)
 */

import { describe, expect, it } from 'vitest';

import { parsePendingAction } from '../pending-action.js';

const BASE = {
  id: 'pa_draft_offer_1',
  scenario_id: 'scn_1',
  chip_id: 'draft-offer-chip-1',
  expires_at_turn_count: 2,
  expires_at_iso: '2099-01-01T00:00:00.000Z',
  emitted_at_iso: '2026-07-16T12:00:00.000Z',
};

const GOOD_ACTION = {
  kind: 'draft_graph',
  public_label: 'Build the model',
  public_message: 'Yes, build the model from what I have shared.',
};

describe('parsePendingAction — draft_graph (2.63 C3/C4)', () => {
  it('accepts a well-formed build offer (no seed, no redraft)', () => {
    const out = parsePendingAction({ ...BASE, action: { ...GOOD_ACTION }, preconditions: {} });
    expect(out).not.toBeNull();
  });

  it('accepts a seeded build offer', () => {
    const out = parsePendingAction({
      ...BASE,
      action: {
        ...GOOD_ACTION,
        brief_seed: 'Three pricing tiers for the new analytics product, mid-market focus.',
      },
      preconditions: {},
    });
    expect(out).not.toBeNull();
  });

  it('accepts a redraft offer with a graph_hash precondition', () => {
    const out = parsePendingAction({
      ...BASE,
      action: { ...GOOD_ACTION, redraft: true },
      preconditions: { graph_hash: 'abcd1234abcd1234' },
    });
    expect(out).not.toBeNull();
  });

  it.each([
    ['missing public_label', { ...GOOD_ACTION, public_label: undefined }],
    ['empty public_label', { ...GOOD_ACTION, public_label: '' }],
    ['missing public_message', { ...GOOD_ACTION, public_message: undefined }],
    ['empty public_message', { ...GOOD_ACTION, public_message: '' }],
    ['empty brief_seed', { ...GOOD_ACTION, brief_seed: '' }],
    ['non-string brief_seed', { ...GOOD_ACTION, brief_seed: 42 }],
    ['over-bound brief_seed', { ...GOOD_ACTION, brief_seed: 'x'.repeat(8001) }],
    ['non-boolean redraft', { ...GOOD_ACTION, redraft: 'yes' }],
  ])('rejects %s', (_name, action) => {
    const out = parsePendingAction({ ...BASE, action, preconditions: {} });
    expect(out).toBeNull();
  });
});
