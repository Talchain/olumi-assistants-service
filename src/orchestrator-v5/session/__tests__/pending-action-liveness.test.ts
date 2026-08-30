/**
 * Track 2 — single liveness authority for pending actions.
 *
 * These tests pin the shared read-time expiry predicate the ContextPack /
 * canonical-frame `pending_confirmation` derivation, the short-confirm
 * resumer, and the route-level proposal-confirm suppressor all rely on.
 * They are deliberately discriminating: a naive "any persisted entry is
 * pending" implementation (`length > 0`) fails the expired cases.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_EXPECTING_ACTION_TYPES,
  derivePendingActivity,
  filterLivePendingActions,
  findSoleLiveElicitBaselinePending,
  isPendingActionExpired,
  PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER,
  RESUMABLE_ACTION_TYPES,
  type PendingAction,
  type PendingActionKind,
} from '../pending-action.js';

const NOW_MS = Date.parse('2026-07-03T12:00:00.000Z');

function makePending(overrides: {
  expires_at_iso?: string;
  expires_at_turn_count?: number;
  kind?: 'run_analysis' | 'what_would_flip';
}): PendingAction {
  return {
    id: 'pa_test_1',
    scenario_id: 'scn_test',
    chip_id: 'chip_test_1',
    action: { kind: overrides.kind ?? 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: overrides.expires_at_turn_count ?? 2,
    expires_at_iso: overrides.expires_at_iso ?? '2026-07-03T12:10:00.000Z',
    emitted_at_iso: '2026-07-03T11:59:00.000Z',
  };
}

describe('isPendingActionExpired — single read-time liveness authority', () => {
  it('a pending action inside both TTLs is live', () => {
    expect(isPendingActionExpired(makePending({}), NOW_MS)).toBe(false);
  });

  it('wall-clock past expires_at_iso → expired', () => {
    const pa = makePending({ expires_at_iso: '2026-07-03T11:59:59.999Z' });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });

  it('exactly at expires_at_iso → still live (nowMs > expiresMs is the cut)', () => {
    const pa = makePending({ expires_at_iso: '2026-07-03T12:00:00.000Z' });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(false);
  });

  it('malformed expires_at_iso → expired (fail-closed)', () => {
    const pa = makePending({ expires_at_iso: 'not-a-timestamp' });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });

  it('expires_at_turn_count of 0 → expired (defence-in-depth against carry-forward bypass)', () => {
    const pa = makePending({ expires_at_turn_count: 0 });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });

  it('negative expires_at_turn_count → expired', () => {
    const pa = makePending({ expires_at_turn_count: -1 });
    expect(isPendingActionExpired(pa, NOW_MS)).toBe(true);
  });
});

describe('filterLivePendingActions', () => {
  it('keeps live entries, drops expired ones, preserves order', () => {
    const live1 = makePending({ kind: 'run_analysis' });
    const wallExpired = makePending({ expires_at_iso: '2026-07-03T11:00:00.000Z' });
    const live2 = makePending({ kind: 'what_would_flip' });
    const turnExpired = makePending({ expires_at_turn_count: 0 });
    const out = filterLivePendingActions([live1, wallExpired, live2, turnExpired], NOW_MS);
    expect(out).toEqual([live1, live2]);
  });

  it('empty input → empty output', () => {
    expect(filterLivePendingActions([], NOW_MS)).toEqual([]);
  });
});

describe('CONFIRMATION_EXPECTING_ACTION_TYPES — propose-then-decide kinds only', () => {
  it('contains exactly the two propose-then-decide kinds', () => {
    expect([...CONFIRMATION_EXPECTING_ACTION_TYPES].sort()).toEqual([
      'apply_proposed_change',
      'proposed_concept',
    ]);
  });

  it('excludes the clarification-continuation kinds (change already decided; target-disambiguation pending)', () => {
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('set_factor_value')).toBe(false);
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('edit_graph_add_risk')).toBe(false);
  });

  it('excludes the chip suggestion offers', () => {
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('run_analysis')).toBe(false);
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has('what_would_flip')).toBe(false);
  });

  it('is a strict subset of the resumable kinds', () => {
    for (const kind of CONFIRMATION_EXPECTING_ACTION_TYPES) {
      expect(RESUMABLE_ACTION_TYPES.has(kind)).toBe(true);
    }
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.size).toBeLessThan(RESUMABLE_ACTION_TYPES.size);
  });
});

/** A minimal valid live PendingAction for any kind (each kind's required fields). */
function pendingOfKind(kind: PendingActionKind): PendingAction {
  const base = {
    id: `pa_${kind}`,
    scenario_id: 'scn_test',
    chip_id: `chip_${kind}`,
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2026-07-03T12:10:00.000Z',
    emitted_at_iso: '2026-07-03T11:59:00.000Z',
  };
  switch (kind) {
    case 'run_analysis':
    case 'what_would_flip':
      return { ...base, action: { kind } };
    case 'draft_graph':
      // C3/C4 (#488): public_label + public_message are REQUIRED on this
      // variant (brief_seed/redraft optional) — mirror route-v2's emitter.
      return { ...base, action: { kind, public_label: 'Build the model', public_message: 'Build the model?' } };
    case 'set_factor_value':
      return { ...base, action: { kind, factor_id: 'fac_x', value: 1, operator: 'set' } };
    case 'edit_graph_add_risk':
      return { ...base, action: { kind, label: 'Risk' } };
    case 'clarify_v2_round':
      return {
        ...base,
        action: { kind, brief: 'Should we expand into the German market?', asked_dimensions: ['goal'], round: 1 },
      };
    case 'elicit_target_baseline':
      // ROADMAP 2.918 — the pending baseline question (server-only; carries
      // the question's target identity + the registered row's replay shape).
      return {
        ...base,
        action: {
          kind,
          target_id: 'out_churn',
          target_label: 'Churn rate',
          constraint_type: 'at_most',
          value: 10,
          unit: '%',
          label: 'Churn rate',
        },
      };
    case 'elicit_option_effect':
      // ROADMAP 2.1352 — the configure-option clarify intercept's asked cell
      // (server-only; carries the (option, factor) identity the question
      // named, so a short reply on the next turn has a referent to bind to).
      return {
        ...base,
        action: {
          kind,
          option_id: 'opt_two_devs',
          option_label: 'Two Developers',
          factor_id: 'fac_dev_throughput',
          factor_label: 'Development throughput',
        },
      };
    case 'elicit_effect_target':
      // ROADMAP 2.1353 — the two value-ask exits' offered cells (server-only;
      // carries the user's own value plus the candidate (option, factor)
      // identities, so a reply of "the first one" has a referent to bind to).
      return {
        ...base,
        action: {
          kind,
          source: 'repair_value_ask',
          value_text: '0.12',
          candidates: [
            {
              option_id: 'opt_sub',
              option_label: 'subcontracting inner-city deliveries',
              factor_id: 'fac_sub_cost',
              factor_label: 'Subcontractor cost',
            },
          ],
        },
      };
    case 'elicit_edit_target':
      // ROADMAP 2.1353 — the two Stage-4A edit-clarify intercepts' offered
      // targets. Weaker than its siblings by design: the copy names no cell,
      // so the referent is WHICH intercept asked plus WHAT it offered.
      return {
        ...base,
        action: {
          kind,
          reason: 'vague_edit',
          offered_targets: [{ node_id: 'fac_hiring_cost', label: 'Hiring and Salary Cost' }],
        },
      };
    case 'proposed_concept':
      return {
        ...base,
        action: { kind, concept: 'morale', preferred_kind: 'factor', public_label: 'Add', public_message: 'Add?' },
      };
    case 'apply_proposed_change':
      return {
        ...base,
        chip_id: 'prop_ref_abcdef',
        preconditions: { graph_hash: 'gh' },
        action: {
          kind,
          proposal_ref: 'prop_ref_abcdef',
          inline_patch: { handler_id: 'set_factor_value', params: {}, target_entity_ids: ['fac_x'] },
          public_label: 'Apply',
          public_message: 'Apply?',
        },
      };
  }
}

describe('derivePendingActivity — single ORIENT-time pending tally, per kind', () => {
  it('empty input → all-zero tally', () => {
    expect(derivePendingActivity([], NOW_MS)).toEqual({
      liveCount: 0,
      expiredCount: 0,
      kinds: {},
      confirmationExpectingLiveCount: 0,
    });
  });

  // Table-test EVERY kind's confirmation-expecting contribution in isolation —
  // the kind-scope decision (propose-then-decide only) is proven here directly,
  // independent of routing / the ContextPack serialisation.
  it.each<[PendingActionKind, number]>([
    ['apply_proposed_change', 1],
    ['proposed_concept', 1],
    ['set_factor_value', 0],
    ['clarify_v2_round', 0],
    ['edit_graph_add_risk', 0],
    // ROADMAP 2.1352 — the asked cell is an ELICITATION, not a proposal: a
    // bare "yes" answers no "give me a number from 0 to 1" question, so it
    // must contribute ZERO to the confirmation-expecting tally even though it
    // is fully live and counted live.
    ['elicit_option_effect', 0],
    // ROADMAP 2.1353 — same reasoning, and it is the reason these two kinds are
    // deliberately absent from CONFIRMATION_EXPECTING_ACTION_TYPES: a bare
    // "yes" answers neither "which of these does your number belong to?" nor
    // "which factor, edge, option or value?". They are elicitations, not
    // proposals, so they must contribute ZERO here while still counting live.
    ['elicit_effect_target', 0],
    ['elicit_edit_target', 0],
    ['run_analysis', 0],
    ['what_would_flip', 0],
  ])('a single live %s → confirmationExpectingLiveCount %d, but always counted live', (kind, expected) => {
    const tally = derivePendingActivity([pendingOfKind(kind)], NOW_MS);
    expect(tally.liveCount).toBe(1);
    expect(tally.kinds[kind]).toBe(1);
    expect(tally.confirmationExpectingLiveCount).toBe(expected);
  });

  it('expired entries are counted as expired, never live or confirmation-expecting', () => {
    const expiredProposal: PendingAction = {
      ...pendingOfKind('apply_proposed_change'),
      expires_at_iso: '2020-01-01T00:00:00.000Z',
    };
    const tally = derivePendingActivity([expiredProposal], NOW_MS);
    expect(tally).toMatchObject({ liveCount: 0, expiredCount: 1, confirmationExpectingLiveCount: 0 });
    expect(tally.kinds).toEqual({});
  });

  it('mixed set: live confirm-expecting + live clarification + expired → correct partition', () => {
    const tally = derivePendingActivity(
      [
        pendingOfKind('proposed_concept'), // live, confirm-expecting
        pendingOfKind('set_factor_value'), // live, NOT confirm-expecting
        { ...pendingOfKind('apply_proposed_change'), expires_at_turn_count: 0 }, // turn-expired
      ],
      NOW_MS,
    );
    expect(tally.liveCount).toBe(2);
    expect(tally.expiredCount).toBe(1);
    expect(tally.confirmationExpectingLiveCount).toBe(1);
    expect(tally.kinds).toEqual({ proposed_concept: 1, set_factor_value: 1 });
  });
});

/**
 * ROADMAP 2.1361 — WHICH PENDING KINDS COMPETE FOR A BARE NUMBER.
 *
 * ⚠ THE DEFECT. `findSoleLiveElicitBaselinePending` filtered to kind
 * `elicit_target_baseline` FIRST and only then checked that exactly one
 * survived, so a live `elicit_option_effect` ("give me a number from 0 to 1")
 * alongside the baseline question blocked nothing: a bare "12%" bound to the
 * baseline ask regardless of which question the user was answering. Widening
 * the gate to "sole among ALL live pendings" would have been the wrong fix —
 * the ask turn's own commit merges the baseline pending with chip-derived
 * pendings, so co-residence with a chip is normal and that gate would never
 * open. The population is therefore narrowed to kinds a BARE NUMBER could
 * plausibly answer.
 */
describe('2.1361 — PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER', () => {
  it('classifies EVERY kind, derived from the record itself (no hand-list to go short)', () => {
    const classified = Object.keys(PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER).sort();
    // The Record<PendingActionKind, boolean> type makes an unclassified NEW
    // kind a compile error; this asserts the runtime shape agrees and that the
    // probe is not reading an empty object (trap 13e — magnitude, not sign).
    expect(classified.length).toBeGreaterThanOrEqual(12);
    for (const kind of classified) {
      expect(typeof PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER[kind as PendingActionKind]).toBe(
        'boolean',
      );
      // Every classified kind must be constructible, i.e. really is a kind.
      expect(pendingOfKind(kind as PendingActionKind).action.kind).toBe(kind);
    }
  });

  it('pins the classification per kind, so a RECLASSIFICATION goes red even though the type still compiles', () => {
    expect(PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER).toEqual({
      elicit_target_baseline: true,
      elicit_option_effect: true,
      elicit_effect_target: true,
      elicit_edit_target: true,
      set_factor_value: true,
      run_analysis: false,
      what_would_flip: false,
      apply_proposed_change: false,
      edit_graph_add_risk: false,
      proposed_concept: false,
      clarify_v2_round: false,
      draft_graph: false,
    });
  });

  it('is a PROPER subset in both directions — neither everything nor nothing competes', () => {
    // Trap 20 — a collapsed classifier (all true / all false) satisfies a
    // one-sided battery. Assert both classes are non-empty.
    const values = Object.values(PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER);
    expect(values.filter(Boolean).length).toBeGreaterThan(0);
    expect(values.filter((v) => !v).length).toBeGreaterThan(0);
  });
});

describe('2.1361 — findSoleLiveElicitBaselinePending, across kinds', () => {
  const baseline = () => pendingOfKind('elicit_target_baseline');

  it('the sole live baseline question is returned', () => {
    const found = findSoleLiveElicitBaselinePending([baseline()], NOW_MS);
    expect(found?.action.kind).toBe('elicit_target_baseline');
  });

  it.each(
    (
      Object.entries(PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER) as Array<
        [PendingActionKind, boolean]
      >
    ).filter(([kind, expects]) => expects && kind !== 'elicit_target_baseline'),
  )('a co-resident live %s also wants a number, so NOTHING is claimed', (kind) => {
    expect(findSoleLiveElicitBaselinePending([baseline(), pendingOfKind(kind)], NOW_MS)).toBeNull();
  });

  it.each(
    (
      Object.entries(PENDING_ACTION_KIND_EXPECTS_NUMERIC_ANSWER) as Array<
        [PendingActionKind, boolean]
      >
    ).filter(([, expects]) => !expects),
  )('CONTRAST CONTROL: a co-resident live %s does NOT block (or the feature is dark)', (kind) => {
    const found = findSoleLiveElicitBaselinePending([baseline(), pendingOfKind(kind)], NOW_MS);
    expect(found?.action.kind).toBe('elicit_target_baseline');
  });

  it('an EXPIRED competitor does not block — liveness runs before the competition check', () => {
    const expired = { ...pendingOfKind('elicit_option_effect'), expires_at_turn_count: 0 };
    expect(
      findSoleLiveElicitBaselinePending([baseline(), expired], NOW_MS)?.action.kind,
    ).toBe('elicit_target_baseline');
  });

  it('a sole live competitor that is NOT the baseline question returns null, never that competitor', () => {
    expect(findSoleLiveElicitBaselinePending([pendingOfKind('elicit_option_effect')], NOW_MS)).toBeNull();
    expect(findSoleLiveElicitBaselinePending([pendingOfKind('set_factor_value')], NOW_MS)).toBeNull();
  });

  it('two live baseline questions stay ambiguous (the original 2.918 rule, unchanged)', () => {
    expect(
      findSoleLiveElicitBaselinePending(
        [baseline(), { ...baseline(), id: 'pa-second' }],
        NOW_MS,
      ),
    ).toBeNull();
  });
});
