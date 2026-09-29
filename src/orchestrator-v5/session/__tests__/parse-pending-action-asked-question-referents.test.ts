/**
 * ⭐ ROADMAP 2.1353 — the asked-question referents must SURVIVE THE ROUND TRIP.
 *
 * ⚠⚠ THE TRAP THIS FILE EXISTS FOR, and it is silent in both directions.
 *
 * (a) `parsePendingAction` gates EVERY read on `RESUMABLE_ACTION_TYPES`. A kind
 *     omitted from that set is WRITE-ONLY: it round-trips to the JSONB column
 *     and is then dropped on the way back out, which is INDISTINGUISHABLE from
 *     never having persisted it. Everything else about the fix would look
 *     correct — the write assertions in the route specs would pass, and the
 *     referent would still never reach a reader.
 *
 * (b) `parsePendingAction` is a flat `if` chain, NOT a switch. A kind admitted
 *     to the set with no validation block clears the envelope checks and is
 *     returned by a CAST — so a corrupted row would reach the readers with ZERO
 *     field validation and no error anywhere.
 *
 * The two failure modes are opposites and neither is visible from the emit side,
 * so both are asserted here, at the read, with the same fixtures.
 *
 * ⚠ AND THE EMPTY-COLLECTION CASES ARE NOT PEDANTRY. Both kinds exist to name
 * the set a reply can choose from. A row naming NONE can neither restate the
 * question nor bind an answer, and would surface as a live pending that means
 * nothing — so it is refused at the read as well as declined at the emit sites.
 * The option-effect ask can genuinely produce an empty candidate list
 * (`ComposeOptionEffectAskInput.candidates`: "may be empty when no chip is
 * honest"), so this is a reachable state, not a theoretical one.
 */

import { describe, expect, it } from 'vitest';

import { parsePendingAction, RESUMABLE_ACTION_TYPES } from '../pending-action.js';

const BASE = {
  id: 'pa_referent',
  scenario_id: 'scn',
  chip_id: 'chip_referent',
  preconditions: { graph_hash: 'h_abc' },
  expires_at_turn_count: 2,
  expires_at_iso: '2099-01-01T00:00:00.000Z',
  emitted_at_iso: '2026-08-29T12:00:00.000Z',
};

const GOOD_CANDIDATE = {
  option_id: 'opt_sub',
  option_label: 'subcontracting inner-city deliveries to a green courier',
  factor_id: 'fac_sub_cost',
  factor_label: 'Subcontractor cost as share of affected revenue',
};

function effectTarget(action: Record<string, unknown>) {
  return parsePendingAction({ ...BASE, action: { kind: 'elicit_effect_target', ...action } });
}

function editTarget(action: Record<string, unknown>) {
  return parsePendingAction({ ...BASE, action: { kind: 'elicit_edit_target', ...action } });
}

describe('the asked-question referents are READABLE, not write-only', () => {
  // ─── (a) THE GATING SET ──────────────────────────────────────────────────
  it('both kinds are in RESUMABLE_ACTION_TYPES — a kind outside it can never be read back', () => {
    expect(
      RESUMABLE_ACTION_TYPES.has('elicit_effect_target'),
      'omitted from the read gate, this referent would persist and then vanish on every read — ' +
        'identical from the outside to never having written it',
    ).toBe(true);
    expect(RESUMABLE_ACTION_TYPES.has('elicit_edit_target')).toBe(true);
  });

  it('elicit_effect_target survives the round trip with every field intact, by identity', () => {
    const parsed = effectTarget({
      source: 'repair_value_ask',
      value_text: '0.12',
      candidates: [GOOD_CANDIDATE],
    });
    expect(parsed).not.toBeNull();
    const action = parsed!.action as Record<string, unknown>;
    expect(action.source).toBe('repair_value_ask');
    // The user's own bytes, as the copy quoted them.
    expect(action.value_text).toBe('0.12');
    const candidates = action.candidates as ReadonlyArray<Record<string, unknown>>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.option_id).toBe('opt_sub');
    expect(candidates[0]!.factor_id).toBe('fac_sub_cost');
  });

  it('elicit_edit_target survives the round trip with every field intact, by identity', () => {
    const parsed = editTarget({
      reason: 'vague_edit',
      offered_targets: [{ node_id: 'fac_hiring_cost', label: 'Hiring and Salary Cost' }],
    });
    expect(parsed).not.toBeNull();
    const action = parsed!.action as Record<string, unknown>;
    expect(action.reason).toBe('vague_edit');
    const offered = action.offered_targets as ReadonlyArray<Record<string, unknown>>;
    expect(offered[0]!.node_id).toBe('fac_hiring_cost');
    expect(offered[0]!.label).toBe('Hiring and Salary Cost');
  });

  // ─── (b) THE VALIDATION BLOCK ────────────────────────────────────────────
  // Each case removes or corrupts exactly ONE field, so a `null` here is
  // attributable to that field and to nothing else. Without these, deleting the
  // whole `if (a.kind === …)` block from `parsePendingAction` would leave every
  // test above GREEN — the kind is in the gating set, so it would simply be
  // cast and returned.
  it.each([
    ['an unknown source', { source: 'invented_ask', value_text: '0.12', candidates: [GOOD_CANDIDATE] }],
    ['a missing source', { value_text: '0.12', candidates: [GOOD_CANDIDATE] }],
    ['an empty value_text', { source: 'repair_value_ask', value_text: '', candidates: [GOOD_CANDIDATE] }],
    ['a non-string value_text', { source: 'repair_value_ask', value_text: 0.12, candidates: [GOOD_CANDIDATE] }],
    ['candidates that are not an array', { source: 'repair_value_ask', value_text: '0.12', candidates: GOOD_CANDIDATE }],
    [
      'a candidate missing its option_id',
      {
        source: 'repair_value_ask',
        value_text: '0.12',
        candidates: [{ ...GOOD_CANDIDATE, option_id: undefined }],
      },
    ],
    [
      'a candidate with an empty factor_label',
      {
        source: 'repair_value_ask',
        value_text: '0.12',
        candidates: [{ ...GOOD_CANDIDATE, factor_label: '' }],
      },
    ],
  ])('elicit_effect_target with %s is REFUSED at the read', (_name, action) => {
    expect(effectTarget(action as Record<string, unknown>)).toBeNull();
  });

  it('elicit_effect_target with an EMPTY candidate list is refused — it would name nothing', () => {
    expect(
      effectTarget({ source: 'option_effect_ask', value_text: '0.4', candidates: [] }),
      'the option-effect ask can genuinely produce no honest candidate; a pending recording that ' +
        'state could neither restate the question nor bind an answer',
    ).toBeNull();
  });

  it.each([
    ['an unknown reason', { reason: 'some_other_intercept', offered_targets: [{ node_id: 'n', label: 'L' }] }],
    ['a missing reason', { offered_targets: [{ node_id: 'n', label: 'L' }] }],
    ['offered_targets that are not an array', { reason: 'vague_edit', offered_targets: { node_id: 'n', label: 'L' } }],
    ['a target missing its node_id', { reason: 'vague_edit', offered_targets: [{ label: 'L' }] }],
    ['a target with an empty label', { reason: 'chip_simplify', offered_targets: [{ node_id: 'n', label: '' }] }],
  ])('elicit_edit_target with %s is REFUSED at the read', (_name, action) => {
    expect(editTarget(action as Record<string, unknown>)).toBeNull();
  });

  it('elicit_edit_target with an EMPTY offered list is refused — it would name nothing', () => {
    expect(editTarget({ reason: 'vague_edit', offered_targets: [] })).toBeNull();
  });

  // ─── OPPOSITE-DIRECTION TWIN ─────────────────────────────────────────────
  // Without this, every refusal above would pass on a parser that returned null
  // for EVERY input of these kinds — i.e. a fix that reintroduced (a).
  it('TWIN: both other valid `source` / `reason` values still parse', () => {
    expect(
      effectTarget({ source: 'option_effect_ask', value_text: '0.4', candidates: [GOOD_CANDIDATE] }),
    ).not.toBeNull();
    expect(
      editTarget({ reason: 'chip_simplify', offered_targets: [{ node_id: 'n', label: 'Label' }] }),
    ).not.toBeNull();
  });
});
