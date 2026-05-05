/**
 * Unit tests for the clarification-resume pre-route (Wave 5E).
 *
 * The brief evidence #3 closure: a user who types just a factor
 * label after a value-update clarify must dispatch the
 * deterministically reconstructed set_factor_value with the
 * persisted quantity, not fall through to the LLM.
 */

import { describe, expect, it } from 'vitest';

import { tryClarificationResume } from '../clarification-resume.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { GraphLookup } from '../validator.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW_MS = Date.parse('2026-05-06T12:00:00.000Z');

function setFactorValuePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: `pa-${Math.random()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip-clarify-1',
    action: {
      kind: 'set_factor_value',
      factor_id: 'f_eng_time',
      value: 0.3,
      operator: 'set',
    },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeGraphLookup(
  nodes: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  return {
    findEntityById(id: string) {
      const found = nodes.find((n) => n.id === id);
      if (!found) return null;
      return { id: found.id, kind: 'node' as const, label: found.label };
    },
    listEntitiesByKind(_kind) {
      return nodes.map((n) => ({ id: n.id, label: n.label }));
    },
  } as GraphLookup;
}

describe('tryClarificationResume — negative gates', () => {
  it('messages with edit verbs fall through to the value-update detector', () => {
    const r = tryClarificationResume({
      message: 'set engineering time commitment to 30%',
      pendingActions: [setFactorValuePending()],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: false,
      skip_reason: 'message_likely_value_update',
    });
  });

  it('bare confirmation messages fall through to the short-confirm pre-route', () => {
    const r = tryClarificationResume({
      message: 'yes',
      pendingActions: [setFactorValuePending()],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: false,
      skip_reason: 'message_likely_short_confirm',
    });
  });

  it('returns no_pending_clarification when no set_factor_value pending exists', () => {
    const r = tryClarificationResume({
      message: 'engineering time commitment',
      pendingActions: [],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending_clarification' });
  });

  it('returns no_graph when graph lookup is undefined', () => {
    const r = tryClarificationResume({
      message: 'engineering time commitment',
      pendingActions: [setFactorValuePending()],
      graphLookup: undefined,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_graph' });
  });
});

describe('tryClarificationResume — match cases', () => {
  it('matches a single set_factor_value pending by exact label match', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.dispatch).toBe('set_factor_value');
      expect(r.pending.id).toBe(pending.id);
      expect(r.factorLabel).toBe('Engineering Time Commitment');
    }
  });

  it('matches when the message is a label substring', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'the Engineering Time Commitment one',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
  });

  it('matches case-insensitively', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'engineering time commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
  });

  it('returns no_label_match when the message does not match any candidate', () => {
    const r = tryClarificationResume({
      message: 'something completely different',
      pendingActions: [setFactorValuePending()],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_label_match' });
  });

  it('returns multiple_label_matches when more than one candidate label is contained in the message', () => {
    const pending1 = setFactorValuePending({
      id: 'pa-1',
      action: { kind: 'set_factor_value', factor_id: 'f_eng', value: 0.3, operator: 'set' },
    });
    const pending2 = setFactorValuePending({
      id: 'pa-2',
      action: { kind: 'set_factor_value', factor_id: 'f_owner', value: 0.3, operator: 'set' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Owner',
      pendingActions: [pending1, pending2],
      graphLookup: makeGraphLookup([
        { id: 'f_eng', label: 'Engineering' },
        { id: 'f_owner', label: 'Owner' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({
      matched: false,
      skip_reason: 'multiple_label_matches',
    });
  });

  it('returns all_targets_missing when persisted factor is gone from the live graph', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      // Empty graph — the factor_id from the prior pending action is gone.
      graphLookup: makeGraphLookup([]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'all_targets_missing' });
  });

  it('Wave 5F: returns all_expired when pending action wall-clock expiry has passed', () => {
    const expired = setFactorValuePending({
      expires_at_iso: '2026-01-01T00:00:00.000Z', // before NOW_MS
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [expired],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'all_expired' });
  });

  it('Wave 5F: returns all_expired for malformed expires_at_iso (defence-in-depth)', () => {
    const malformed = setFactorValuePending({
      expires_at_iso: 'not-a-date',
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [malformed],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'all_expired' });
  });

  it('Wave 5F: returns graph_hash_changed when persisted hash diverges from live hash', () => {
    const pending = setFactorValuePending({
      preconditions: { graph_hash: 'sha256:before' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: 'sha256:after',
    });
    expect(r).toEqual({ matched: false, skip_reason: 'graph_hash_changed' });
  });

  it('Wave 5F: returns graph_hash_changed when persisted hash exists but live hash is unknown', () => {
    const pending = setFactorValuePending({
      preconditions: { graph_hash: 'sha256:before' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      // currentGraphHash omitted — defence-in-depth treats as conflict
    });
    expect(r).toEqual({ matched: false, skip_reason: 'graph_hash_changed' });
  });

  it('Wave 5F: passes when both persisted and current graph hashes match', () => {
    const pending = setFactorValuePending({
      preconditions: { graph_hash: 'sha256:abc' },
    });
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
      currentGraphHash: 'sha256:abc',
    });
    expect(r.matched).toBe(true);
  });

  it('Wave 5F: fuzzy match catches typos with bigram-Dice ≥ 0.5', () => {
    const pending = setFactorValuePending();
    const r = tryClarificationResume({
      // Typo: missing 'i' in "Engineering" and missing 'm' in "Commitment"
      message: 'Engneering Time Comitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.matchKind).toBe('fuzzy');
    }
  });

  it('Wave 5F: fuzzy match returns multiple_label_matches when more than one candidate clusters above threshold', () => {
    const pending1 = setFactorValuePending({
      id: 'pa-1',
      action: { kind: 'set_factor_value', factor_id: 'f_a', value: 0.3, operator: 'set' },
    });
    const pending2 = setFactorValuePending({
      id: 'pa-2',
      action: { kind: 'set_factor_value', factor_id: 'f_b', value: 0.3, operator: 'set' },
    });
    const r = tryClarificationResume({
      // Typed message that is fuzzy-similar to BOTH labels.
      message: 'time commitment',
      pendingActions: [pending1, pending2],
      graphLookup: makeGraphLookup([
        { id: 'f_a', label: 'Engineering Time Commitment' },
        { id: 'f_b', label: 'Owner Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    // Both labels share "Time Commitment" — substring match fires for
    // BOTH, producing multiple_label_matches.
    expect(r).toEqual({ matched: false, skip_reason: 'multiple_label_matches' });
  });

  it('Wave 5F: matchKind is "exact" for exact-equal label, "substring" for substring, "fuzzy" otherwise', () => {
    const pending = setFactorValuePending();
    const exact = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(exact.matched).toBe(true);
    if (exact.matched) expect(exact.matchKind).toBe('exact');

    const substring = tryClarificationResume({
      message: 'the Engineering Time Commitment one',
      pendingActions: [pending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(substring.matched).toBe(true);
    if (substring.matched) expect(substring.matchKind).toBe('substring');
  });

  it('ignores pending actions of other kinds', () => {
    const runAnalysisPending: PendingAction = {
      id: 'pa-ra',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip-ra',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-05-05T00:00:00.000Z',
    };
    const r = tryClarificationResume({
      message: 'Engineering Time Commitment',
      pendingActions: [runAnalysisPending],
      graphLookup: makeGraphLookup([
        { id: 'f_eng_time', label: 'Engineering Time Commitment' },
      ]),
      nowMs: NOW_MS,
    });
    expect(r).toEqual({ matched: false, skip_reason: 'no_pending_clarification' });
  });
});
