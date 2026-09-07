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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { findUnsupportedOfferTargetKind } from '../warrant-demotion.js';
import {
  buildNonFactorKindRefusalText,
  buildNonFactorKindRefusalConstraintChips,
} from '../../routing/deterministic-value-update.js';
import { toEntityKind } from '../../routing/graph-lookup-adapter.js';
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


/**
 * ⭐⭐ THE CHIP AND THE PROSE ANSWER ONE QUESTION AND MUST NOT DISAGREE.
 *
 * Found by review at `39474c21`: the first round of this PR gated the refusal
 * PROSE on `isConstraintableKind` and gated the chip in the NEW demotion
 * branch — but left the SIBLING chip in the pre-existing
 * `refuse_non_factor_kind` branch minted unconditionally, nine lines above the
 * prose it now contradicted. On a `decision` or `action` target the assistant
 * text WITHHELD the constraint route while the button beneath it OFFERED it,
 * and that button's message re-enters routing and reaches `add_constraint`,
 * which throws (`add-constraint.ts` ALLOWED_TARGET_KIND_SET). The response
 * contradicted itself inside one turn — CLAUDE.md trap 21.
 *
 * ⚠ SHARPEST FORM, derived here rather than assumed: a `decision` / `action`
 * candidate reaches that branch ONLY through the no-factor fallback
 * (`deterministic-value-update.ts` candidate pool), and the factor-label list
 * beside the chip is built from the SAME source and the SAME `kind === 'factor'`
 * filter as the id set that fallback keys on. So whenever the kind is
 * non-constraintable the factor chips are necessarily EMPTY — the constraint
 * chip was the turn's ONLY exit, and it was the one route guaranteed to refuse.
 *
 * ── WHY ONE PREDICATE IS CORRECT HERE, AND WHERE THE TWO HARMS SEPARATE ────
 * Offering a route that will refuse (a LIE) and withholding one that would
 * have worked (a GAP) are opposite harms and must never share a tuned
 * threshold. They do not share one here: this is exact set membership against
 * the very constant the resumer throws on, so for every KNOWN kind both harms
 * are zero at once — there is nothing to trade off. They separate only on
 * IGNORANCE, which the caller spells with the sentinel `'node'`; that is not
 * in the allowlist, so BOTH channels withhold. Pinned below as its own case.
 *
 * Every case has its opposite-direction twin: each kind that must NOT get the
 * chip is matched by a kind that MUST, and the co-variance sweep runs the
 * whole contract enum so neither channel can drift alone.
 */
describe('the refusal CHIP names only routes that exist', () => {
  const CONSTRAINT_CHIP_ID = 'chip_prompt_refuse_constraint';

  const constraintable = NodeKindV3.options.filter((k) =>
    ADD_CONSTRAINT_ALLOWED_TARGET_KINDS.includes(k),
  );
  const notConstraintable = NodeKindV3.options.filter(
    (k) => !ADD_CONSTRAINT_ALLOWED_TARGET_KINDS.includes(k),
  );

  it('both arms of the sweep are non-empty (neither it.each is vacuous)', () => {
    expect(constraintable.length).toBeGreaterThan(0);
    expect(notConstraintable.length).toBeGreaterThan(0);
  });

  // ── THE LIE: a chip for a route that would refuse ──────────────────────
  it.each(notConstraintable)(
    'mints NO constraint chip for a %s (add_constraint rejects that kind)',
    (kind) => {
      const chips = buildNonFactorKindRefusalConstraintChips('Some Node', kind);
      expect(chips.map((c) => c.id)).not.toContain(CONSTRAINT_CHIP_ID);
      expect(chips).toHaveLength(0);
    },
  );

  // ── THE GAP: the opposite-direction twin of every case above ───────────
  it.each(constraintable)(
    'DOES mint the constraint chip for a %s (that route genuinely exists)',
    (kind) => {
      const chips = buildNonFactorKindRefusalConstraintChips('Engineering Overstretch', kind);
      // Bound by chip ID, not by a substring of the label another chip could carry.
      expect(chips.map((c) => c.id)).toEqual([CONSTRAINT_CHIP_ID]);
      expect(chips[0]?.label).toBe('Add a constraint on Engineering Overstretch');
      expect(chips[0]?.message).toBe('Add a constraint on Engineering Overstretch.');
    },
  );

  // ── THE CO-VARIANCE INVARIANT, swept over the WHOLE contract enum ──────
  it.each(NodeKindV3.options)(
    'prose and chip agree about the constraint route for a %s',
    (kind) => {
      const text = buildNonFactorKindRefusalText('Some Node', kind, ['Delivery Pace']);
      const chips = buildNonFactorKindRefusalConstraintChips('Some Node', kind);
      const proseOffers = text.toLowerCase().includes('constraint');
      const chipOffers = chips.some((c) => c.id === CONSTRAINT_CHIP_ID);
      expect(chipOffers).toBe(proseOffers);
    },
  );

  // ── the corrected domain: which kinds actually REACH this refusal ──────
  it('the reachable non-constraintable kinds are exactly decision and action', () => {
    // `option` and `goal` never arrive in the 'node' bucket the candidate pool
    // scans, so they cannot reach this copy — a narrowing the PR description
    // got wrong by citing `modelEntityLabels` instead of `toEntityKind`.
    const reachable = NodeKindV3.options.filter((k) => toEntityKind(k) === 'node');
    const reachableAndRefusing = reachable.filter(
      (k) => !ADD_CONSTRAINT_ALLOWED_TARGET_KINDS.includes(k),
    );
    expect([...reachableAndRefusing].sort()).toEqual(['action', 'decision']);
  });

  // ── IGNORANCE: the one place the two harms separate ────────────────────
  it('withholds in BOTH channels for the "node" ignorance sentinel', () => {
    // turn-executor spells an unresolvable kind `'node'`. It is not in the
    // allowlist, so both channels withhold — the GAP direction, deliberately
    // shared so the chip cannot fail open while the prose fails closed.
    const text = buildNonFactorKindRefusalText('Some Node', 'node', ['Delivery Pace']);
    const chips = buildNonFactorKindRefusalConstraintChips('Some Node', 'node');
    expect(text.toLowerCase()).not.toContain('constraint');
    expect(chips).toHaveLength(0);
  });

  // ── the derived structural guard: no ungated copy may survive ──────────
  it('the constraint chip id is minted in exactly one place — the gated builder', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const executorSrc = readFileSync(resolve(here, '../../turn-executor.ts'), 'utf8');
    const builderSrc = readFileSync(
      resolve(here, '../../routing/deterministic-value-update.ts'),
      'utf8',
    );
    // Positive control: the probe can see the file, and the builder is wired
    // into it. Without this an unreadable/empty read would pass vacuously.
    expect(executorSrc.length).toBeGreaterThan(1000);
    expect(executorSrc).toContain('buildNonFactorKindRefusalConstraintChips');
    // The claim: every mint of this chip goes through the gated builder.
    const quoted = `'${CONSTRAINT_CHIP_ID}'`;
    expect(executorSrc.split(quoted).length - 1).toBe(0);
    expect(builderSrc.split(quoted).length - 1).toBe(1);
  });
});
