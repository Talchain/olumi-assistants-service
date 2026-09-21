/**
 * ⭐⭐ UNIT SUFFICIENCY — DO NOT OFFER A LIMIT NO ANSWER COULD APPLY.
 *
 * ── THE WITNESS (deployed staging, 20 Sep 2026) ───────────────────────────
 * Driven through the real interface. The product offered:
 *
 *   "a limit keeping <a risk> at or below 30 … Say the word and I will make
 *    it."
 *
 * The user replied *"Yes, treat it as a 0-1 fraction of revenue at risk, so
 * 30% is 0.3. Please go ahead."* Nothing happened. `graph_hash` was
 * byte-identical across all five turns and the held change lapsed two turns
 * later.
 *
 * ── THE READING THAT WAS WRONG ────────────────────────────────────────────
 * It looks like the confirmation predicate is too narrow, and widening it was
 * recommended in writing. It is not, and widening it would have been WORSE: a
 * held change replays from its STORED parameters and never re-reads the
 * message, so honouring that sentence as a bare "yes" would have written 30
 * and silently discarded the user's 0.3 — with a receipt attached. The
 * confirmation gate's own comment states that rule, and it was right.
 *
 * ── WHAT WAS ACTUALLY WRONG, ONE TURN EARLIER ─────────────────────────────
 * **The offer could not have been honoured by ANY answer.** `add_constraint`
 * throws on a unit-less value outside [0,1] targeting a probability-domain
 * node (goal / outcome / risk) with no declared cap — the target was a risk
 * and the value was 30. And `formatBound` renders a stored unit, so "at or
 * below 30", bare, is itself evidence the stored parameters carried none.
 *
 * So the user supplied the missing unit unprompted, because the offer's own
 * wording left it out. **They were answering a question the product had not
 * asked.** This gate asks it, at the offer, for one sentence and no turn.
 *
 * ── THE ORACLE IS THE HANDLER, NEVER THIS FILE ────────────────────────────
 * The gate calls `isUnitAmbiguousConstraintValue`, IMPORTED from the handler
 * that throws on it — one expression, two callers, no second list. What this
 * file pins is the offer path's own behaviour and, more importantly, the four
 * FAIL-OPENS, because a gate that suppresses legitimate offers would be a
 * worse defect than the one it closes. `OFFER_REQUIRED_PARAMETERS`' comment
 * already records that judgement: `unit` is "deliberately NOT required,
 * because requiring them would suppress legitimate offers". That stands. This
 * is not "unit is missing" — it is the handler's compound precondition, which
 * is false for every one of those legitimate offers.
 */
import { describe, it, expect } from 'vitest';

import { findUnitAmbiguousOffer, type UnitLookupNode } from '../warrant-demotion.js';
import { isUnitAmbiguousConstraintValue } from '../../tools/handlers/add-constraint.js';
import type { ProposalAction } from '../../routing/types.js';

/** The witnessed target: a risk, which `add_constraint` accepts as a kind. */
const RISK_NODE: UnitLookupNode = { id: 'r-cannibalisation', kind: 'risk' };

function action(
  parameters: readonly { name: string; value: unknown }[],
  entityId = 'r-cannibalisation',
): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: {
      id: entityId,
      kind: 'node',
      label: 'Enterprise Revenue Cannibalisation Risk',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: parameters.map((p) => ({ ...p, source: 'user_explicit' })),
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

/** The witnessed offer, verbatim in its parameters: 30, at_most, no unit. */
const WITNESSED = [
  { name: 'constraint_type', value: 'at_most' },
  { name: 'value', value: 30 },
];

describe('the offer the user could not have accepted', () => {
  it('REFUSES the witnessed offer: a unit-less 30 on a risk', () => {
    const found = findUnitAmbiguousOffer(action(WITNESSED), [RISK_NODE]);
    expect(found).not.toBeNull();
    // Bound by IDENTITY — the entity's own label, not "some label".
    expect(found?.label).toBe('Enterprise Revenue Cannibalisation Risk');
    expect(found?.value).toBe(30);
  });

  it('CONTRAST: the SAME offer carrying a unit is fine, and is offered', () => {
    // This is the discriminating twin. Without it, a gate that refused every
    // add_constraint would pass the test above.
    expect(
      findUnitAmbiguousOffer(action([...WITNESSED, { name: 'unit', value: '%' }]), [RISK_NODE]),
    ).toBeNull();
  });

  it("CONTRAST: the user's own answer — 0.3, in band — is fine", () => {
    // The value the user supplied on the next turn. The whole point is that
    // an offer at THIS value would have been honourable.
    expect(
      findUnitAmbiguousOffer(
        action([{ name: 'constraint_type', value: 'at_most' }, { name: 'value', value: 0.3 }]),
        [RISK_NODE],
      ),
    ).toBeNull();
  });

  it('CONTRAST: a unit-less absolute on a FACTOR is legitimate and stays offered', () => {
    // "at most 30" on a headcount. `PROBABILITY_DOMAIN_KIND_SET` excludes
    // `factor` deliberately, and this is the class the rejected
    // "just require a unit" fix would have suppressed.
    expect(
      findUnitAmbiguousOffer(action(WITNESSED, 'f-headcount'), [
        { id: 'f-headcount', kind: 'factor' },
      ]),
    ).toBeNull();
  });

  it('CONTRAST: a declared cap makes the value interpretable, so it stays offered', () => {
    expect(
      findUnitAmbiguousOffer(action(WITNESSED), [
        { id: 'r-cannibalisation', kind: 'risk', observed_state: { cap: 100 } },
      ]),
    ).toBeNull();
    expect(
      findUnitAmbiguousOffer(action(WITNESSED), [
        { id: 'r-cannibalisation', kind: 'risk', goal_threshold_cap: 100 },
      ]),
    ).toBeNull();
  });
});

describe('fail-open on ignorance, never on knowledge', () => {
  it('does not refuse when the target is not in the graph we hold', () => {
    // We do not KNOW the kind. Refusing here would suppress a legitimate
    // offer on the strength of not having looked.
    expect(findUnitAmbiguousOffer(action(WITNESSED), [])).toBeNull();
  });

  it('does not refuse when the value is not a usable number', () => {
    // `findInsufficientOfferParameters` already owns that refusal, with its
    // own copy. Two gates claiming one fact is how the copy starts
    // contradicting itself.
    for (const bad of ['seven', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        findUnitAmbiguousOffer(
          action([{ name: 'constraint_type', value: 'at_most' }, { name: 'value', value: bad }]),
          [RISK_NODE],
        ),
        `value=${String(bad)}`,
      ).toBeNull();
    }
  });

  const GOAL_AT_LEAST = [
    { name: 'constraint_type', value: 'at_least' },
    { name: 'value', value: 30 },
  ];

  it('does not refuse a FRESH GOAL at_least — the value would change, so a cap stamp is still possible', () => {
    expect(
      findUnitAmbiguousOffer(action(GOAL_AT_LEAST, 'g-arr'), [{ id: 'g-arr', kind: 'goal' }]),
    ).toBeNull();
  });

  // ⭐⭐ THE PAIR THE REVIEW REQUIRED. The fail-open above was too wide: the
  // handler exempts goal + `at_least` only when `capToStamp` is non-null, and
  // that is null whenever `stampGoalThreshold` is false — including a
  // VALUE-IDENTICAL RESTATEMENT, where the row or the node's threshold channel
  // already holds this value. The handler then still throws, so an offer built
  // on it is one no confirmation could apply.
  it('REFUSES a GOAL at_least that merely RESTATES an existing unit-less row', () => {
    expect(
      findUnitAmbiguousOffer(
        action(GOAL_AT_LEAST, 'g-arr'),
        [{ id: 'g-arr', kind: 'goal' }],
        [{ node_id: 'g-arr', operator: 'at_least', value: 30, unit: undefined }],
      ),
    ).not.toBeNull();
  });

  it("REFUSES a GOAL at_least that restates the NODE's own unit-less threshold channel", () => {
    // The handler's second limb (`nodeChannelUnchanged`) — a different carrier
    // for the same fact, and it must refuse identically or the gate is
    // half-closed.
    expect(
      findUnitAmbiguousOffer(action(GOAL_AT_LEAST, 'g-arr'), [
        { id: 'g-arr', kind: 'goal', goal_threshold_raw: 30, goal_threshold_unit: undefined },
      ]),
    ).not.toBeNull();
  });

  it('CONTRAST: a restatement at a DIFFERENT value can still stamp, so it stays offered', () => {
    // Without this twin the two refusals above are consistent with a gate that
    // simply stopped exempting goals at all.
    expect(
      findUnitAmbiguousOffer(
        action(GOAL_AT_LEAST, 'g-arr'),
        [{ id: 'g-arr', kind: 'goal' }],
        [{ node_id: 'g-arr', operator: 'at_least', value: 45, unit: undefined }],
      ),
    ).toBeNull();
  });

  it('CONTRAST: an identical restatement WITH a fitting cap is interpretable and stays offered', () => {
    expect(
      findUnitAmbiguousOffer(
        action(GOAL_AT_LEAST, 'g-arr'),
        [{ id: 'g-arr', kind: 'goal', goal_threshold_cap: 100 }],
        [{ node_id: 'g-arr', operator: 'at_least', value: 30, unit: undefined }],
      ),
    ).toBeNull();
  });

  it('CONTRAST to the above: a GOAL with at_MOST has no such exemption and IS refused', () => {
    // The pair is what shows the fail-open is scoped to the case it names,
    // rather than quietly exempting every goal.
    expect(
      findUnitAmbiguousOffer(action(WITNESSED, 'g-arr'), [{ id: 'g-arr', kind: 'goal' }]),
    ).not.toBeNull();
  });

  it('does not touch the other proposable intents', () => {
    const setValue = {
      ...action(WITNESSED),
      handler_id: 'set_factor_value',
    } as unknown as ProposalAction;
    expect(findUnitAmbiguousOffer(setValue, [RISK_NODE])).toBeNull();
  });
});

describe('the predicate is the handler’s own, and covers its stated domain', () => {
  // Executed against the exported predicate rather than re-spelled here, so
  // a change to the handler's rule moves this with it.
  const base = { unit: undefined, observedCap: undefined, goalThresholdCap: undefined };

  it('fires on every probability-domain kind, not just the witnessed one', () => {
    for (const kind of ['goal', 'outcome', 'risk']) {
      expect(isUnitAmbiguousConstraintValue({ ...base, value: 30, targetKind: kind }), kind).toBe(
        true,
      );
    }
  });

  it('is symmetric about the band, which a `> 1`-only rule would not be', () => {
    // A negative is as uninterpretable as a large positive, and the handler's
    // rule says so. Written against the SPEC (outside [0,1]), never against
    // the direction the witness happened to take.
    expect(isUnitAmbiguousConstraintValue({ ...base, value: -5, targetKind: 'risk' })).toBe(true);
    expect(isUnitAmbiguousConstraintValue({ ...base, value: 0, targetKind: 'risk' })).toBe(false);
    expect(isUnitAmbiguousConstraintValue({ ...base, value: 1, targetKind: 'risk' })).toBe(false);
  });
});
