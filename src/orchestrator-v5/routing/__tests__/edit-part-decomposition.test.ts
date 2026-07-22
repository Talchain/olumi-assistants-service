/**
 * Part-accounting conservation law — decomposition + attribution unit pins.
 *
 * The EXACT rehearsal message (REHEARSAL-DEFECT-TRIAGE-2026-07-20.md,
 * defect A + defect B's CEE half) is the primary fixture, against a
 * redraft-shaped graph that contains NEITHER 'Support cost' NOR
 * 'Gross margin', and the EXACT two operations the live LLM emitted
 * (add_node 'Shipping costs' + add_edge to the existing ARR outcome).
 *
 * Adversarial pins: numeric ranges must not split; verb-ellipsis value
 * compounds stay #549's property; single-part messages must never become
 * compound (the false-compound trap); non-edit clauses are never
 * accounted. Copy builders are swept against BOTH egress detectors.
 */
import { describe, it, expect } from 'vitest';

import {
  accountEditParts,
  buildMultiPartRejectionClarify,
  buildPartAccountingDisclosure,
  buildStructuralRemainderNotice,
  buildSubstitutionClarify,
  decomposeEditMessage,
  type PatchOperationLike,
} from '../edit-part-decomposition.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';

/** The exact compound message from the 2026-07-20 dress rehearsal (wire 012). */
const REHEARSAL_MESSAGE =
  'Change Support cost to 30, and add a new factor called Shipping costs that reduces Gross margin.';

/** Redraft-shaped pre-edit graph: contains neither 'Support cost' nor 'Gross margin'. */
const REDRAFT_NODES = [
  { id: 'goal_arr', kind: 'goal', label: 'ARR Growth' },
  { id: 'out_new_arr', kind: 'outcome', label: 'Incremental ARR Generated' },
  { id: 'fac_eu_demand', kind: 'factor', label: 'EU Market Demand' },
  { id: 'fac_localisation', kind: 'factor', label: 'Localisation' },
  { id: 'opt_eu_expand', kind: 'option', label: 'Expand to EU' },
];

/** The exact two ops the live LLM emitted (Render: operations_count 2). */
const REHEARSAL_OPS: PatchOperationLike[] = [
  {
    op: 'add_node',
    path: '/nodes/-',
    value: { id: 'fac_shipping_costs', kind: 'factor', label: 'Shipping costs' },
  },
  {
    op: 'add_edge',
    path: '/edges/-',
    value: {
      from: 'fac_shipping_costs',
      to: 'out_new_arr',
      strength: { mean: -0.2, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  },
];

describe('decomposeEditMessage — the rehearsal message', () => {
  it('decomposes into a value part (Support cost) and a structural add (Shipping costs -> Gross margin)', () => {
    const d = decomposeEditMessage(REHEARSAL_MESSAGE);
    expect(d.accountableParts).toHaveLength(2);

    const valuePart = d.accountableParts.find((p) => p.kind === 'value');
    expect(valuePart).toBeDefined();
    expect(valuePart!.namedTargets).toEqual(['Support cost']);

    const addPart = d.accountableParts.find((p) => p.kind === 'structural_add');
    expect(addPart).toBeDefined();
    expect(addPart!.newLabels).toEqual(['Shipping costs']);
    expect(addPart!.namedTargets).toEqual(['Gross margin']);

    expect(d.mixedValueStructural).toBe(true);
  });
});

describe('decomposeEditMessage — adversarial / no-false-compound pins', () => {
  it('a single-part value message stays single-part', () => {
    const d = decomposeEditMessage('Change Support cost to 30');
    expect(d.accountableParts).toHaveLength(1);
    expect(d.accountableParts[0]!.kind).toBe('value');
    expect(d.mixedValueStructural).toBe(false);
  });

  it('a numeric range ("between 5 and 10") does not split into parts', () => {
    const d = decomposeEditMessage('Set churn to between 5 and 10');
    expect(d.parts).toHaveLength(1);
  });

  it('verb-ellipsis value compounds ("Set A to 0.6 and B to 0.8") stay out of scope: no structural part, not mixed', () => {
    // #549's tryCompoundValueUpdate owns this shape end-to-end.
    const d = decomposeEditMessage('Set EU Market Demand to 0.6 and Localisation to 0.8');
    expect(d.mixedValueStructural).toBe(false);
    expect(
      d.accountableParts.filter(
        (p) => p.kind === 'structural_add' || p.kind === 'structural_remove',
      ),
    ).toHaveLength(0);
  });

  it('a non-edit second clause ("run the analysis") is never accounted', () => {
    const d = decomposeEditMessage('set churn to 5% and run the analysis');
    expect(d.accountableParts).toHaveLength(1);
    expect(d.accountableParts[0]!.kind).toBe('value');
    expect(d.mixedValueStructural).toBe(false);
  });

  it('figurative removals ("remove any doubt") are not structural parts', () => {
    const d = decomposeEditMessage('Change Support cost to 30 and remove any doubt');
    expect(d.accountableParts.filter((p) => p.kind === 'structural_remove')).toHaveLength(0);
  });

  it('constraint phrasings are deliberately NOT claimed as structural (clause-D routing owns them)', () => {
    const d = decomposeEditMessage('Set churn to 5% and add a hard constraint on churn');
    expect(d.mixedValueStructural).toBe(false);
  });

  it('an N-part mix decomposes into all three accountable parts', () => {
    const d = decomposeEditMessage(
      'Change Support cost to 30, add a factor called Shipping costs that reduces Gross margin, and remove the Localisation factor',
    );
    expect(d.accountableParts).toHaveLength(3);
    expect(d.accountableParts.map((p) => p.kind)).toEqual([
      'value',
      'structural_add',
      'structural_remove',
    ]);
    expect(d.mixedValueStructural).toBe(true);
  });
});

describe('accountEditParts — the rehearsal attribution (defect A + defect B)', () => {
  it('finds the value half uncovered with a missing target, and the Gross-margin link SUBSTITUTED', () => {
    const d = decomposeEditMessage(REHEARSAL_MESSAGE);
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: REHEARSAL_OPS,
      graphNodes: REDRAFT_NODES,
    });

    // Defect A: the value part got NO operation — uncovered, with the
    // user's own name recorded as missing.
    const valueFate = a.fates.find((f) => f.part.kind === 'value');
    expect(valueFate!.covered).toBe(false);
    expect(
      a.missingTargets.some(
        (m) => m.name === 'Support cost' && m.kind === 'value_target_missing',
      ),
    ).toBe(true);

    // The add itself IS covered (add_node landed).
    const addFate = a.fates.find((f) => f.part.kind === 'structural_add');
    expect(addFate!.covered).toBe(true);

    // Defect B: 'Gross margin' absent + edge to the existing ARR outcome =
    // the proven substitution shape.
    expect(a.substitutions).toHaveLength(1);
    expect(a.substitutions[0]!.missingName).toBe('Gross margin');
    expect(a.substitutions[0]!.substitutedLabel).toBe('Incremental ARR Generated');
  });

  it('no substitution when the link target EXISTS (edge to the named node is legitimate)', () => {
    const message =
      'Change Support cost to 30, and add a new factor called Shipping costs that reduces EU Market Demand.';
    const d = decomposeEditMessage(message);
    const ops: PatchOperationLike[] = [
      REHEARSAL_OPS[0]!,
      {
        op: 'add_edge',
        path: '/edges/-',
        value: {
          from: 'fac_shipping_costs',
          to: 'fac_eu_demand',
          strength: { mean: -0.2, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative',
        },
      },
    ];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });
    expect(a.substitutions).toHaveLength(0);
    // The value half is still uncovered + missing — the disclosure path.
    expect(a.uncoveredParts.some((p) => p.kind === 'value')).toBe(true);
  });

  it('fully covered parts produce no uncovered set and no disclosure', () => {
    const message = 'Change EU Market Demand to 0.7 and add a factor called Shipping costs';
    const d = decomposeEditMessage(message);
    const ops: PatchOperationLike[] = [
      { op: 'update_node', path: 'fac_eu_demand', value: { observed_state: { value: 0.7 } } },
      REHEARSAL_OPS[0]!,
    ];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });
    expect(a.uncoveredParts).toHaveLength(0);
    expect(a.substitutions).toHaveLength(0);
    expect(buildPartAccountingDisclosure(a)).toBeNull();
  });

  it('an add_node carrying the requested value COVERS a value part whose factor was missing (LLM created it)', () => {
    const message = 'Change Support cost to 30 and add a factor called Shipping costs';
    const d = decomposeEditMessage(message);
    const ops: PatchOperationLike[] = [
      {
        op: 'add_node',
        path: '/nodes/-',
        value: { id: 'fac_support_cost', kind: 'factor', label: 'Support cost' },
      },
      REHEARSAL_OPS[0]!,
    ];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });
    const valueFate = a.fates.find((f) => f.part.kind === 'value');
    expect(valueFate!.covered).toBe(true);
    expect(a.missingTargets.filter((m) => m.kind === 'value_target_missing')).toHaveLength(0);
  });
});

describe('accountEditParts — removal parts consume removal ops one-to-one (#577 conservation law)', () => {
  // Two removals, ONE removal op: the op covers exactly one part, never both.
  // Pre-fix, `covered = removeOpCount > 0` marked EVERY removal part covered,
  // silently violating the conservation law.
  it('a single remove op covers exactly one of two removal parts (target-resolved)', () => {
    const message = 'remove the Localisation factor and remove the EU Market Demand factor';
    const d = decomposeEditMessage(message);
    const removeParts = d.accountableParts.filter((p) => p.kind === 'structural_remove');
    expect(removeParts).toHaveLength(2);

    const ops: PatchOperationLike[] = [{ op: 'remove_node', path: 'fac_localisation' }];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });

    const covered = a.fates.filter((f) => f.covered);
    const uncovered = a.fates.filter((f) => !f.covered);
    expect(covered).toHaveLength(1);
    expect(uncovered).toHaveLength(1);

    // The op resolves to 'Localisation' — that part is covered; the other is not.
    const locFate = a.fates.find((f) => f.part.namedTargets[0] === 'Localisation');
    const euFate = a.fates.find((f) => f.part.namedTargets[0] === 'EU Market Demand');
    expect(locFate!.covered).toBe(true);
    expect(euFate!.covered).toBe(false);
    expect(a.uncoveredParts).toContain(euFate!.part);
    // The EU target DOES exist in the graph, so this is a plain unaccounted
    // part, not a missing-target issue.
    expect(a.missingTargets).toHaveLength(0);
  });

  // Target-priority, not document order: the op matching the SECOND-mentioned
  // part must claim it, leaving the first uncovered.
  it('the target-matching part claims the op regardless of mention order', () => {
    const message = 'remove the EU Market Demand factor and remove the Localisation factor';
    const d = decomposeEditMessage(message);
    const ops: PatchOperationLike[] = [{ op: 'remove_node', path: 'fac_localisation' }];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });
    const locFate = a.fates.find((f) => f.part.namedTargets[0] === 'Localisation');
    const euFate = a.fates.find((f) => f.part.namedTargets[0] === 'EU Market Demand');
    expect(locFate!.covered).toBe(true);
    expect(euFate!.covered).toBe(false);
  });

  // Generous fallback stays one-to-one: an unresolved removal op (edge removal
  // or unknown id) covers exactly one part, never all of them.
  it('an unresolvable removal op still covers only one removal part', () => {
    const message = 'remove the Localisation factor and remove the EU Market Demand factor';
    const d = decomposeEditMessage(message);
    const ops: PatchOperationLike[] = [{ op: 'remove_node', path: 'fac_unknown_id' }];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });
    expect(a.fates.filter((f) => f.covered)).toHaveLength(1);
    expect(a.fates.filter((f) => !f.covered)).toHaveLength(1);
  });

  // Two removal ops cover two removal parts (no false uncovered).
  it('two removal ops cover both removal parts', () => {
    const message = 'remove the Localisation factor and remove the EU Market Demand factor';
    const d = decomposeEditMessage(message);
    const ops: PatchOperationLike[] = [
      { op: 'remove_node', path: 'fac_localisation' },
      { op: 'remove_node', path: 'fac_eu_demand' },
    ];
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: ops,
      graphNodes: REDRAFT_NODES,
    });
    expect(a.uncoveredParts).toHaveLength(0);
    expect(a.fates.filter((f) => f.covered)).toHaveLength(2);
  });

  // Positive control: zero ops leaves both removal parts uncovered.
  it('zero ops leaves both removal parts uncovered', () => {
    const message = 'remove the Localisation factor and remove the EU Market Demand factor';
    const d = decomposeEditMessage(message);
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: [],
      graphNodes: REDRAFT_NODES,
    });
    expect(a.fates.filter((f) => f.covered)).toHaveLength(0);
    expect(a.uncoveredParts).toHaveLength(2);
  });
});

describe('disclosure copy — DISCLOSED-PARTIAL and fail-closed clarify', () => {
  function rehearsalAccounting() {
    const d = decomposeEditMessage(REHEARSAL_MESSAGE);
    return {
      d,
      a: accountEditParts({
        parts: d.accountableParts,
        operations: REHEARSAL_OPS,
        graphNodes: REDRAFT_NODES,
      }),
    };
  }

  it('buildSubstitutionClarify names BOTH missing targets and every clause, and passes both egress detectors', () => {
    const { d, a } = rehearsalAccounting();
    const text = buildSubstitutionClarify(d.accountableParts, a);
    expect(text).toContain("'Gross margin'");
    expect(text).toContain("'Support cost'");
    expect(text).toContain('Change Support cost to 30');
    expect(text).toContain('Shipping costs');
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(text).not.toContain('—'); // no em dash
  });

  it('buildPartAccountingDisclosure names the missing value target when the other part was served, and passes both egress detectors', () => {
    const message =
      'Change Support cost to 30, and add a new factor called Shipping costs that reduces EU Market Demand.';
    const d = decomposeEditMessage(message);
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: [
        REHEARSAL_OPS[0]!,
        {
          op: 'add_edge',
          path: '/edges/-',
          value: {
            from: 'fac_shipping_costs',
            to: 'fac_eu_demand',
            strength: { mean: -0.2, std: 0.1 },
            exists_probability: 0.9,
            effect_direction: 'negative',
          },
        },
      ],
      graphNodes: REDRAFT_NODES,
    });
    const text = buildPartAccountingDisclosure(a);
    expect(text).not.toBeNull();
    expect(text!).toContain("'Support cost'");
    expect(findForbiddenPhraseHit(text!)).toBeNull();
    expect(findSuccessClaimHit(text!)).toBeNull();
  });

  it('buildPartAccountingDisclosure returns null when NOTHING was covered (full no-op turns keep their own copy)', () => {
    const { d } = rehearsalAccounting();
    const a = accountEditParts({
      parts: d.accountableParts,
      operations: [],
      graphNodes: REDRAFT_NODES,
    });
    expect(buildPartAccountingDisclosure(a)).toBeNull();
  });

  it('buildStructuralRemainderNotice names the structural clause and passes both egress detectors', () => {
    const d = decomposeEditMessage(
      'Set EU Market Demand to 0.7 and add a new factor called Shipping costs',
    );
    const text = buildStructuralRemainderNotice(d);
    expect(text).not.toBeNull();
    expect(text!).toContain('Shipping costs');
    expect(findForbiddenPhraseHit(text!)).toBeNull();
    expect(findSuccessClaimHit(text!)).toBeNull();
  });

  it('buildStructuralRemainderNotice is null for a pure value message (false-compound trap)', () => {
    const d = decomposeEditMessage('Set EU Market Demand to 0.7');
    expect(buildStructuralRemainderNotice(d)).toBeNull();
  });

  it('buildMultiPartRejectionClarify names every accountable part and passes both egress detectors', () => {
    // The verbatim F4 live-probe message (cee-staging build 6a202d7).
    const d = decomposeEditMessage(
      'Set Headcount Cost to 0.5 and remove the option Hire Two Junior Engineers.',
    );
    const text = buildMultiPartRejectionClarify(d);
    expect(text).not.toBeNull();
    expect(text!).toContain('Set Headcount Cost to 0.5');
    expect(text!).toContain('remove the option Hire Two Junior Engineers');
    expect(text!).toMatch(/one at a time/i);
    expect(findForbiddenPhraseHit(text!)).toBeNull();
    expect(findSuccessClaimHit(text!)).toBeNull();
  });

  it('buildMultiPartRejectionClarify is null for a single-part message (false-compound trap)', () => {
    expect(
      buildMultiPartRejectionClarify(
        decomposeEditMessage('remove the option Hire Two Junior Engineers.'),
      ),
    ).toBeNull();
    expect(
      buildMultiPartRejectionClarify(decomposeEditMessage('Set Headcount Cost to 0.5')),
    ).toBeNull();
  });
});
