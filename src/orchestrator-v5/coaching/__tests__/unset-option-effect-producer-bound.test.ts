/**
 * PRODUCER-BOUND: the disclosure fires on a graph the REAL readiness authority
 * declares, not on a fixture this lane wrote.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND IT IS THE MOST IMPORTANT OF THE THREE.
 *
 * The other two suites feed `collectUnsetOptionEffects` blocker objects THIS
 * LANE AUTHORED. That proves the selection rules, and it proves nothing about
 * whether the real assessor ever emits a blocker of that shape — CLAUDE.md
 * trap 16-inverse: *a fixture you wrote yourself is not evidence about the
 * wire*, because a self-authored input encodes the author's model of the
 * producer rather than the producer. If `assessCanonicalAnalysisReadiness` used
 * a different code, or omitted `option_label`, every other test in this lane
 * would still pass and the disclosure would never fire for a single user.
 *
 * So this file drives the ACTUAL `resolveRunAdmission` over a REAL graph and
 * asserts the sentence comes out with the labels in it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE FIXTURE IS NOT MINE EITHER, AND THAT IS THE POINT.
 *
 * `PARTIAL_PLUS_EMPTY` is lifted verbatim from
 * `tools/handlers/__tests__/run-admission-two-term.test.ts`, where it was built
 * by the compute-discard-waiver lane to pin a DIFFERENT claim. Its shape is
 * exactly the defect measured on staging: `opt_partial` is linked to two
 * factors and valued on ONE, so its interventions are non-empty, the gate
 * SUBMITS it, and it still raises `MISSING_OPTION_VALUE` for the unvalued
 * factor — a blocker the run proceeds past.
 *
 * ⭐⭐ AND THAT SPEC'S OWN DOC COMMENT PREDICTED THIS DEFECT, IN WRITING:
 *
 *   "⚠ WHAT THIS DOES NOT DISCHARGE: the ruling licenses this only where
 *    'uncertainty is represented honestly'. The run now goes out carrying an
 *    option CEE has said is incomplete, and there is no carrier marking it as
 *    such [...] The blockers do remain visible in `assessment.blockingIssues`,
 *    so the gap is in the OFFER COPY, not in whether the user can see the
 *    missing value. Tracked as a follow-up."
 *
 * This lane is that follow-up, and this file is the join between the two.
 */

import { describe, expect, it } from 'vitest';

import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import {
  buildUnsetOptionEffectDisclosure,
  collectUnsetOptionEffects,
  unsetOptionEffectFactorIds,
} from '../unset-option-effect-disclosure.js';
import { isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const baseNodes = () => [
  { id: 'goal', kind: 'goal', label: 'Bridge the sales/engineering gap' },
  { id: 'decision', kind: 'decision', label: 'Hiring' },
  {
    id: 'fac_velocity',
    kind: 'factor',
    label: 'Engineering Delivery Velocity',
    category: 'controllable',
    observed_state: { value: 0.5, cap: 1 },
  },
];

const option = (id: string, label: string, interventions?: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  ...(interventions ? { interventions } : {}),
});

/** Verbatim from run-admission-two-term.test.ts. */
const PARTIAL_PLUS_EMPTY = {
  version: '1',
  nodes: [
    ...baseNodes(),
    {
      id: 'fac_ramp',
      kind: 'factor',
      label: 'Ramp Delay',
      category: 'controllable',
      observed_state: { value: 0.5, cap: 1 },
    },
    option('opt_c0', 'Configured 0', { fac_velocity: 0.4 }),
    option('opt_c1', 'Configured 1', { fac_velocity: 0.8 }),
    option('opt_partial', 'Partial', { fac_velocity: 0.6 }),
    option('opt_empty', 'Empty'),
  ],
  edges: [
    v3Edge('e1', 'decision', 'opt_c0'),
    v3Edge('e2', 'decision', 'opt_c1'),
    v3Edge('e3', 'decision', 'opt_partial'),
    v3Edge('e4', 'decision', 'opt_empty'),
    v3Edge('e5', 'opt_c0', 'fac_velocity'),
    v3Edge('e6', 'opt_c1', 'fac_velocity'),
    v3Edge('e7', 'opt_partial', 'fac_velocity'),
    v3Edge('e8', 'opt_partial', 'fac_ramp'),
    v3Edge('e9', 'opt_empty', 'fac_velocity'),
    v3Edge('e10', 'fac_velocity', 'goal'),
    v3Edge('e11', 'fac_ramp', 'goal'),
  ],
};

/** The options the engine would return — `opt_empty` is excluded by the gate. */
const ANALYSED = new Set(['opt_c0', 'opt_c1', 'opt_partial']);

describe('the disclosure is bound to the REAL readiness producer', () => {
  it('⭐ PRECONDITION — the real assessor emits the blocker this lane claims to read', () => {
    // Pinned IN-TEST rather than assumed. If the assessor stops emitting this
    // shape, this REDs here with a clear cause instead of the disclosure
    // silently never firing in production.
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);
    expect(admission.willProceed).toBe(true); // the run PROCEEDS past the gap

    const blockers = (admission.assessment.blockingIssues ?? []).filter(
      (i) => i.code === 'MISSING_OPTION_VALUE',
    );
    expect(blockers.length).toBeGreaterThan(0);

    const partial = blockers.find((i) => i.option_id === 'opt_partial');
    expect(partial).toBeDefined();
    // The three fields the sentence is composed from, asserted at the producer.
    expect(partial?.option_label).toBe('Partial');
    expect(partial?.factor_label).toBe('Ramp Delay');
    expect(partial?.factor_id).toBe('fac_ramp');
    // And it is NOT answered by the exclusion — the option is submitted, so
    // no other disclosure speaks for it.
    expect(partial?.waived_by_exclusion).not.toBe(true);
  });

  it('⭐ end-to-end: a real admission produces a sentence naming the real option and factor', () => {
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);
    const effects = collectUnsetOptionEffects(
      admission.assessment.blockingIssues,
      ANALYSED,
    );

    expect(effects.length).toBeGreaterThan(0);
    expect(effects.some((e) => e.option_id === 'opt_partial')).toBe(true);

    const sentence = buildUnsetOptionEffectDisclosure(effects);
    expect(sentence).not.toBe('');
    expect(sentence).toContain('Partial');
    expect(sentence).toContain('Ramp Delay');

    // …and it SURVIVES the wire. Composition + egress in one assertion, on
    // producer-derived data rather than a hand-written string.
    expect(
      isAllowedRunAnalysisAssistantText('Ran analysis on your current scenario.' + sentence),
    ).toBe(true);
  });

  it('⭐ the excluded option is NOT double-disclosed', () => {
    // `opt_empty` is wholly unvalued: the gate drops it and
    // `scaffold-disclosure.ts` already tells the user so. It must not also
    // appear here, or one option gets two sentences on one turn.
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);
    const effects = collectUnsetOptionEffects(
      admission.assessment.blockingIssues,
      ANALYSED,
    );
    expect(effects.some((e) => e.option_id === 'opt_empty')).toBe(false);
  });

  it('⭐ the driver key is a REAL factor id from the graph, not an invented string', () => {
    // The named-driver suppression joins on this id against
    // `factor_sensitivity[].node_id ?? factor_id`. If it were a label, or an
    // id from a different space, the suppression would silently never fire.
    const admission = resolveRunAdmission(PARTIAL_PLUS_EMPTY);
    const ids = unsetOptionEffectFactorIds(
      collectUnsetOptionEffects(admission.assessment.blockingIssues, ANALYSED),
    );
    expect(ids.has('fac_ramp')).toBe(true);
    // And it is a node that genuinely exists in the graph.
    expect(PARTIAL_PLUS_EMPTY.nodes.some((n) => n.id === 'fac_ramp')).toBe(true);
  });

  // ⭐ THE OVER-DISCLOSURE CONTROL, at the producer. A fully-valued graph must
  // produce NO sentence — measured through the real assessor, so a disclosure
  // that fires on every run cannot pass this file.
  it('⭐ CONTROL — a fully configured graph produces NO disclosure', () => {
    const ALL_CONFIGURED = {
      ...PARTIAL_PLUS_EMPTY,
      nodes: [
        ...baseNodes(),
        {
          id: 'fac_ramp',
          kind: 'factor',
          label: 'Ramp Delay',
          category: 'controllable',
          observed_state: { value: 0.5, cap: 1 },
        },
        option('opt_c0', 'Configured 0', { fac_velocity: 0.4, fac_ramp: 0.2 }),
        option('opt_c1', 'Configured 1', { fac_velocity: 0.8, fac_ramp: 0.7 }),
      ],
      edges: [
        v3Edge('e1', 'decision', 'opt_c0'),
        v3Edge('e2', 'decision', 'opt_c1'),
        v3Edge('e5', 'opt_c0', 'fac_velocity'),
        v3Edge('e6', 'opt_c1', 'fac_velocity'),
        v3Edge('e8', 'opt_c0', 'fac_ramp'),
        v3Edge('e9', 'opt_c1', 'fac_ramp'),
        v3Edge('e10', 'fac_velocity', 'goal'),
        v3Edge('e11', 'fac_ramp', 'goal'),
      ],
    };
    const admission = resolveRunAdmission(ALL_CONFIGURED);
    // Precondition pinned in-test: this graph really is free of the blocker,
    // so the empty sentence below is the code's doing and not the fixture's.
    expect(
      (admission.assessment.blockingIssues ?? []).filter(
        (i) => i.code === 'MISSING_OPTION_VALUE',
      ),
    ).toHaveLength(0);

    const effects = collectUnsetOptionEffects(
      admission.assessment.blockingIssues,
      new Set(['opt_c0', 'opt_c1']),
    );
    expect(effects).toEqual([]);
    expect(buildUnsetOptionEffectDisclosure(effects)).toBe('');
  });
});
