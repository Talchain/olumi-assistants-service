/**
 * ⭐⭐ THE OFFER MUST NOT PROMISE AN EDIT THE RESUMER CANNOT MAKE.
 *
 * ── THE WITNESS (deployed staging, 1 Sep 2026) ────────────────────────────
 *   user:  "Engineering Overstretch at 45% is far too low… make it 75%."
 *   turn 1: "Nothing has been changed. I want to confirm this with you before
 *            I edit the model…"  + a **"Set this value"** chip.
 *   turn 2: (user confirms) "I could not update that value because the target
 *            or value was not valid."   ← names neither target nor reason
 *   turn 3: "Engineering Overstretch is a risk, not a factor, and I can't set
 *            a value on a risk directly."   ← the truth, two turns late
 *
 * THE FIRST DIVERGENCE IS TURN 1, NOT TURN 2. `Engineering Overstretch` is a
 * `risk` node, and `set_factor_value` accepts `['factor']` and nothing else
 * (`tools/handlers/set-factor-value.ts` SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS).
 * The node's kind was knowable BEFORE the chip was minted — the demotion
 * branch already holds the graph. Turn 2's opaque error and turn 3's late
 * truth are both DOWNSTREAM of an offer that could never have been honoured:
 * the user only ever reached the handler because the product invited them to.
 *
 * ⭐ THE PRECEDENT IS IN THE SAME BRANCH. `turn-executor.ts`'s demotion gate
 * already carries a REGISTRY-EXECUTABLE precondition whose stated reason is
 * that "a chip would promise a change the resumer could never honour". That is
 * exactly this defect; the precondition simply asked whether the HANDLER
 * exists and never whether the TARGET is one it accepts.
 *
 * ── WHAT THESE TESTS BIND TO ──────────────────────────────────────────────
 * By IDENTITY (the node id under test), never by a value predicate another
 * node in the fixture could satisfy — every graph here carries a factor AND a
 * non-factor with distinct ids, so a guard that refused indiscriminately would
 * fail TWIN A just as loudly as an absent guard fails TWIN B.
 *
 * The domain sweep is DERIVED from `NodeKindV3` and
 * `SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS` rather than from a hand-listed set
 * of kinds, so a new node kind added to the contract is covered the day it
 * lands (CLAUDE.md trap 12 — a hand-maintained mirror drifts green).
 */
import { describe, it, expect } from 'vitest';

import { findUnsupportedOfferTargetKind } from '../warrant-demotion.js';
import { buildNonFactorKindRefusalText } from '../../routing/deterministic-value-update.js';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';
import { ALLOWED_TARGET_KINDS as ADD_CONSTRAINT_ALLOWED_TARGET_KINDS } from '../../tools/handlers/add-constraint.js';
import { NodeKindV3 } from '../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../routing/types.js';

/** The witnessed graph, reduced: one risk (the target) and one real factor. */
const GRAPH = [
  { id: 'risk_eng_overstretch', kind: 'risk', label: 'Engineering Overstretch' },
  { id: 'fac_delivery_pace', kind: 'factor', label: 'Delivery Pace' },
] as const;

function setFactorValueOn(id: string, label: string): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id,
      kind: 'node',
      label,
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [
      {
        name: 'value',
        value: { value: 75, unit: '%', cap: 100 },
        source: 'user_explicit',
        operator: 'set',
      },
    ],
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

describe('the offer precondition: a chip is never minted for a target the handler rejects', () => {
  // ── TWIN A: the witnessed harm ──────────────────────────────────────────
  it('refuses to offer "Set this value" on the RISK node the witness named', () => {
    const found = findUnsupportedOfferTargetKind(
      setFactorValueOn('risk_eng_overstretch', 'Engineering Overstretch'),
      GRAPH,
    );
    expect(found).not.toBeNull();
    expect(found?.nodeKind).toBe('risk');
    expect(found?.label).toBe('Engineering Overstretch');
  });

  // ── TWIN B: the opposite direction — the offer must SURVIVE ─────────────
  // Confirm-before-write is hard-won behaviour. A guard that suppressed the
  // offer for a legitimate factor would be a worse defect than the one being
  // fixed, and it would pass TWIN A.
  it('still offers on a FACTOR in the same graph (the confirm channel survives)', () => {
    const found = findUnsupportedOfferTargetKind(
      setFactorValueOn('fac_delivery_pace', 'Delivery Pace'),
      GRAPH,
    );
    expect(found).toBeNull();
  });

  // ── THE WHOLE DOMAIN, DERIVED ───────────────────────────────────────────
  // A guard that special-cased 'risk' would pass TWIN A and leave the same
  // defect one node-kind along.
  const unsupportedKinds = NodeKindV3.options.filter(
    (k) => !SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS.includes(k),
  );

  it('covers every non-factor kind the contract defines (sweep is non-empty)', () => {
    // Guards the sweep itself: if the filter ever returned [], the it.each
    // below would silently assert nothing (CLAUDE.md trap 13).
    expect(unsupportedKinds.length).toBe(NodeKindV3.options.length - 1);
    expect(unsupportedKinds).toContain('risk');
  });

  it.each(unsupportedKinds)('refuses to offer a value edit on a %s node', (kind) => {
    const nodes = [
      { id: 'n_target', kind, label: 'Some Node' },
      { id: 'fac_delivery_pace', kind: 'factor', label: 'Delivery Pace' },
    ];
    const found = findUnsupportedOfferTargetKind(
      setFactorValueOn('n_target', 'Some Node'),
      nodes,
    );
    expect(found).not.toBeNull();
    expect(found?.nodeKind).toBe(kind);
  });

  it.each(SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS)(
    'still offers on an accepted %s target',
    (kind) => {
      const nodes = [{ id: 'n_target', kind, label: 'Some Node' }];
      expect(
        findUnsupportedOfferTargetKind(setFactorValueOn('n_target', 'Some Node'), nodes),
      ).toBeNull();
    },
  );

  // ── FAIL-OPEN ON IGNORANCE, NEVER ON KNOWLEDGE ──────────────────────────
  // The guard refuses only on POSITIVE knowledge that the kind is rejected.
  // Refusing when the graph cannot resolve the target would suppress
  // legitimate edits — the failure direction this branch exists to avoid.
  it('does NOT refuse when the target is absent from the graph', () => {
    expect(
      findUnsupportedOfferTargetKind(setFactorValueOn('n_missing', 'Ghost'), GRAPH),
    ).toBeNull();
  });

  it('does NOT refuse when no graph is available at all', () => {
    expect(
      findUnsupportedOfferTargetKind(
        setFactorValueOn('risk_eng_overstretch', 'Engineering Overstretch'),
        [],
      ),
    ).toBeNull();
  });

  it('does NOT refuse an edge-targeting intent whose id is not a node', () => {
    const edgeAction = {
      handler_id: 'adjust_edge_strength',
      entity: {
        id: 'fac_delivery_pace->risk_eng_overstretch',
        kind: 'edge',
        label: 'Delivery Pace to Engineering Overstretch',
        resolution_status: 'resolved',
        resolution_method: 'label_match',
      },
      parameters: [{ name: 'strength', value: 0.6, source: 'user_explicit' }],
      cited_context_fields: [],
    } as unknown as ProposalAction;
    expect(findUnsupportedOfferTargetKind(edgeAction, GRAPH)).toBeNull();
  });

  it('does NOT refuse add_constraint on a risk — that handler genuinely accepts it', () => {
    // Derived, not asserted: the route the refusal recommends must be real.
    expect(ADD_CONSTRAINT_ALLOWED_TARGET_KINDS).toContain('risk');
    const addConstraint = {
      handler_id: 'add_constraint',
      entity: {
        id: 'risk_eng_overstretch',
        kind: 'node',
        label: 'Engineering Overstretch',
        resolution_status: 'resolved',
        resolution_method: 'label_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 75, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    } as unknown as ProposalAction;
    expect(findUnsupportedOfferTargetKind(addConstraint, GRAPH)).toBeNull();
  });
});

/**
 * ⚠ THE REFUSAL MUST NAME SOMETHING THAT WORKS.
 *
 * The existing copy closes with "If you want to hold X to a limit, ask me to
 * add a constraint on it." That sentence is TRUE for the four kinds
 * `add_constraint` accepts (factor / outcome / goal / risk) and FALSE for the
 * three it does not (decision / action / option) — and those three are
 * reachable here, because `deterministic-value-update.ts::modelEntityLabels`
 * buckets decision and action alongside factors when scanning candidates.
 *
 * Routing the turn-1 offer into this refusal widens the set of kinds that see
 * it, so the sentence must be gated on the recommending handler's OWN
 * authority — otherwise the fix recreates the defect one turn along: a refusal
 * pointing at an action that also fails.
 */
describe('the refusal names only routes that exist', () => {
  const constraintable = ADD_CONSTRAINT_ALLOWED_TARGET_KINDS.filter((k) => k !== 'factor');
  const notConstraintable = NodeKindV3.options.filter(
    (k) => !ADD_CONSTRAINT_ALLOWED_TARGET_KINDS.includes(k),
  );

  it('both arms of the sweep are non-empty', () => {
    expect(constraintable.length).toBeGreaterThan(0);
    expect(notConstraintable.length).toBeGreaterThan(0);
  });

  it.each(constraintable)('offers the constraint route for a %s (it is accepted)', (kind) => {
    const text = buildNonFactorKindRefusalText('Engineering Overstretch', kind, [
      'Delivery Pace',
    ]);
    // Article-agnostic: `articleFor` correctly emits "an outcome".
    expect(text).toMatch(new RegExp(`is an? ${kind}, not a factor`));
    expect(text.toLowerCase()).toContain('constraint');
  });

  it.each(notConstraintable)(
    'does NOT offer the constraint route for a %s (that handler rejects it)',
    (kind) => {
      const text = buildNonFactorKindRefusalText('Some Node', kind, ['Delivery Pace']);
      expect(text.toLowerCase()).not.toContain('constraint');
      // The turn must still have an exit: the factor route is always named.
      expect(text).toContain('Delivery Pace');
    },
  );
});
