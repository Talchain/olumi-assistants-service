/**
 * ROADMAP 2.1426 — THE MISSING-BASELINE CLARIFY.
 *
 * A user asks for a RELATIVE change on a factor that has no current value
 * ("raise German Price Level by 10%"). The product asks WHICH factor, the
 * user answers, and the resumer reconstructs the held delta against an empty
 * base. `evaluateFactorValueProposal` then correctly refuses it with
 * `delta_no_existing_value` — a dead end, because the ONE question that would
 * have made the request answerable ("from what?") was never asked.
 *
 * This suite pins the resumer's new `recovery_missing_base` dispatch and,
 * just as load-bearing, pins the FOUR ways it must NOT fire:
 *
 *   1. a delta on a factor that HAS a base            → unchanged
 *   2. `set` on a value-less factor                   → unchanged (needs no base)
 *   3. a recorded value of ZERO                       → unchanged (zero IS a base)
 *   4. a lookup with no `findFactorObservedState`     → unchanged (we could not
 *                                                       LOOK; saying "no value"
 *                                                       would be a false
 *                                                       statement about the
 *                                                       model's own contents)
 *
 * The predicate is deliberately the validator's own: `operator !== 'set'`
 * paired with `resolveExistingRawValue` over the identical field projection,
 * so the check and the refusal it prevents cannot disagree.
 */

import { describe, expect, it } from 'vitest';

import { tryClarificationResume } from '../clarification-resume.js';
import { evaluateFactorValueProposal } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { FactorObservedStateSnapshot, GraphLookup } from '../validator.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW_MS = Date.parse('2026-05-06T12:00:00.000Z');
const DEFAULT_GRAPH_HASH = 'sha256:default';

/** The one factor every case in this suite targets, by id and by label. */
const TARGET_ID = 'f_de_price_level';
const TARGET_LABEL = 'German Price Level';

function pendingFor(
  action: Partial<Extract<PendingAction['action'], { kind: 'set_factor_value' }>> = {},
): PendingAction {
  return {
    id: 'pa-missing-base',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip-clarify-1',
    action: {
      kind: 'set_factor_value',
      factor_id: TARGET_ID,
      value: 10,
      unit: '%',
      operator: 'increase',
      ...action,
    },
    preconditions: { graph_hash: DEFAULT_GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-05-05T00:00:00.000Z',
  };
}

/**
 * A lookup that DOES implement the optional observed-state accessor.
 * `observed` is what the accessor returns for TARGET_ID — `null` models the
 * production adapter's answer for a factor carrying no `observed_state` block
 * at all (`graph-lookup-adapter.ts`: `factorObservedById.get(id) ?? null`).
 */
function lookupWithObservedState(
  observed: FactorObservedStateSnapshot | null,
): GraphLookup {
  return {
    findEntityById(id: string) {
      if (id !== TARGET_ID) return null;
      return { id: TARGET_ID, kind: 'node' as const, label: TARGET_LABEL };
    },
    listEntitiesByKind() {
      return [{ id: TARGET_ID, label: TARGET_LABEL }];
    },
    findFactorObservedState(id: string) {
      return id === TARGET_ID ? observed : null;
    },
  } as GraphLookup;
}

/**
 * A lookup WITHOUT the optional accessor — older mocks and simple synthetic
 * graphs. The interface declares `findFactorObservedState?`, so this is a
 * legitimate adapter, and the product must not infer "no value" from it.
 */
function lookupWithoutAccessor(): GraphLookup {
  return {
    findEntityById(id: string) {
      if (id !== TARGET_ID) return null;
      return { id: TARGET_ID, kind: 'node' as const, label: TARGET_LABEL };
    },
    listEntitiesByKind() {
      return [{ id: TARGET_ID, label: TARGET_LABEL }];
    },
  } as GraphLookup;
}

function resume(pendingActions: PendingAction[], graphLookup: GraphLookup) {
  return tryClarificationResume({
    message: TARGET_LABEL,
    pendingActions,
    graphLookup,
    nowMs: NOW_MS,
    currentGraphHash: DEFAULT_GRAPH_HASH,
  });
}

describe('tryClarificationResume — recovery_missing_base (ROADMAP 2.1426)', () => {
  it('claims a delta against a factor with NO observed state and names the target, operator and quantity', () => {
    const r = resume([pendingFor()], lookupWithObservedState(null));

    // Bind by IDENTITY — the exact dispatch member, the exact factor id, and
    // the exact held quantity — never a predicate another dispatch could
    // satisfy.
    expect(r).toMatchObject({
      matched: true,
      dispatch: 'recovery_missing_base',
      factorId: TARGET_ID,
      factorLabel: TARGET_LABEL,
      operator: 'increase',
      value: 10,
      unit: '%',
    });
  });

  it('claims a delta when observed state exists but carries no value at all', () => {
    // A snapshot that survived narrowing on a non-value field only (the
    // adapter indexes a snapshot whenever ANY relevant field is present).
    const r = resume([pendingFor()], lookupWithObservedState({ unit: '%' }));
    expect(r).toMatchObject({ dispatch: 'recovery_missing_base' });
  });

  it.each([
    ['decrease' as const, 10, '%'],
    ['multiply' as const, 1.5, undefined],
  ])('claims %s, the other delta operators', (operator, value, unit) => {
    const r = resume(
      [pendingFor(unit === undefined ? { operator, value } : { operator, value, unit })],
      lookupWithObservedState(null),
    );
    expect(r).toMatchObject({ dispatch: 'recovery_missing_base', operator, value });
  });

  // ─────────────────────────────────────────────────────────────────────
  // CONTRAST ARMS — the four ways it must NOT fire. Each is a door the
  // guard must leave shut; a corpus that tests one direction is a guard
  // watching one door.
  // ─────────────────────────────────────────────────────────────────────

  it('CONTRAST: a delta on a factor that HAS a base still dispatches set_factor_value', () => {
    const r = resume(
      [pendingFor()],
      lookupWithObservedState({ raw_value: 100, unit: '%' }),
    );
    expect(r).toMatchObject({
      matched: true,
      dispatch: 'set_factor_value',
      factorLabel: TARGET_LABEL,
    });
  });

  it('CONTRAST: `set` on a value-less factor is untouched — it needs no base', () => {
    const r = resume(
      [pendingFor({ operator: 'set', value: 120 })],
      lookupWithObservedState(null),
    );
    expect(r).toMatchObject({ matched: true, dispatch: 'set_factor_value' });
  });

  it.each([
    ['raw_value', { raw_value: 0, unit: '%' }],
    ['value', { value: 0, unit: 'people' }],
    ['value with a cap', { value: 0, cap: 500 }],
  ])(
    'CONTRAST: a recorded %s of ZERO is a PRESENT base, not a missing one',
    (_label, observed) => {
      const r = resume([pendingFor()], lookupWithObservedState(observed));
      expect(r).toMatchObject({ matched: true, dispatch: 'set_factor_value' });
    },
  );

  it('CONTRAST: a lookup WITHOUT findFactorObservedState is untouched — we could not look', () => {
    const r = resume([pendingFor()], lookupWithoutAccessor());
    expect(r).toMatchObject({ matched: true, dispatch: 'set_factor_value' });
  });

  it('CONTRAST: an UNREADABLE scale is not claimed — the factor has a value, so saying it has none would be false', () => {
    // `resolveExistingRawValue` returns `ambiguous` for a `%` factor whose
    // stored value sits outside [0,1] with no unambiguous divisor. A value IS
    // recorded; it is its SCALE that cannot be read. That is a different
    // question with its own machinery, and claiming it here would make the
    // product state something false about its own contents.
    const r = resume(
      [pendingFor()],
      lookupWithObservedState({ value: 5, unit: '%', cap: 200 }),
    );
    expect(r).toMatchObject({ matched: true, dispatch: 'set_factor_value' });
  });
});

/**
 * ⛔ THE CARRIED PENDING MUST NOT HIJACK THE ANSWER.
 *
 * This arm re-emits nothing, but `commitTurn`'s Signature-Loop carry-forward
 * keeps the held `increase` alive for one more turn. So when the user does
 * what the copy asks and states an absolute value, a live delta pending for
 * the SAME factor is sitting there — and if the resumer could claim that
 * reply, it would apply its own held quantity in place of the number the user
 * just typed. That is precisely the harm `system-events/scale-ask.ts` names,
 * where the same property is relied on and pinned "by a test rather than left
 * to the pattern's goodwill". Pinned here too, bound to THIS scenario rather
 * than inherited from the generic negative-gate test, because it is what makes
 * leaving the pending carried safe.
 */
describe('the carried delta cannot claim the absolute answer', () => {
  it('the follow-up the copy asks for falls through to the value-update detector, not to the held increase', () => {
    const r = tryClarificationResume({
      message: `set ${TARGET_LABEL} to 120`,
      pendingActions: [pendingFor()], // the carried `increase` 10%
      graphLookup: lookupWithObservedState(null),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    expect(r).toEqual({
      matched: false,
      skip_reason: 'message_likely_value_update',
    });
  });

  it('and so does a bare current value, so the held delta is never silently applied to it', () => {
    const r = tryClarificationResume({
      message: '100',
      pendingActions: [pendingFor()],
      graphLookup: lookupWithObservedState(null),
      nowMs: NOW_MS,
      currentGraphHash: DEFAULT_GRAPH_HASH,
    });
    // Every message carrying a digit is refused by the negative gate, so no
    // live `set_factor_value` pending can ever claim one. The consequence is
    // stated plainly in the copy: a bare number is NOT offered as an answer,
    // because nothing would read it as one.
    expect(r).toEqual({
      matched: false,
      skip_reason: 'message_likely_value_update',
    });
  });
});

/**
 * ⛔⛔ THE INTERLOCK. The copy this dispatch produces tells the user to state
 * an ABSOLUTE value. That sentence is a promise about what the product will
 * accept next, and a message that is true about a state while naming an
 * action the reader cannot take is still a defect — the toast that prescribed
 * a gesture the product had just disabled (UI #1539/#1540) is the same shape,
 * and it is the defect this whole chain began with.
 *
 * So the offer is pinned against the predicate that decides it, on the exact
 * factor shape the dispatch fires for: a factor with NO recorded state. The
 * pair is what makes it evidence — one arm alone proves nothing:
 *
 *   · the DELTA arm must be refused (this is the dead end being removed), and
 *   · the `set` arm on the SAME inputs must be accepted (this is the move
 *     the copy names).
 *
 * If a future guard ever starts refusing `set` on a value-less factor, this
 * REDs and the copy stops being publishable — which is exactly when someone
 * needs to know.
 */
describe('the offered action is executable, not merely true', () => {
  // The projection a value-less factor produces at the validator: every
  // observed-state field absent, so `factorExistingRaw` is omitted.
  const VALUE_LESS_FACTOR = { inputHasUnit: true, unit: '%' } as const;

  it('the DELTA the user asked for is refused — the dead end this dispatch removes', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 10,
        operator: 'increase',
        ...VALUE_LESS_FACTOR,
      }),
    ).toMatchObject({ ok: false, reason: 'delta_no_existing_value' });
  });

  it('the ABSOLUTE value the copy asks for IS accepted on that same value-less factor', () => {
    expect(
      evaluateFactorValueProposal({
        rawInput: 120,
        operator: 'set',
        ...VALUE_LESS_FACTOR,
      }),
    ).toEqual({ ok: true });
  });

  it('and the second step the copy offers — set a current value, then ask again — is reachable end to end', () => {
    // Step 1: state the current value. Accepted (previous case, generalised
    // to a bare unitless factor so the offer holds beyond percentages).
    expect(
      evaluateFactorValueProposal({ rawInput: 100, operator: 'set', unit: '%', inputHasUnit: true }),
    ).toEqual({ ok: true });
    // Step 2: the delta now has a left-hand side, so it is no longer refused.
    expect(
      evaluateFactorValueProposal({
        rawInput: 10,
        operator: 'increase',
        unit: '%',
        inputHasUnit: true,
        factorExistingRaw: 100,
        factorUnit: '%',
        factorObservedRawValue: 100,
      }),
    ).toEqual({ ok: true });
  });
});
