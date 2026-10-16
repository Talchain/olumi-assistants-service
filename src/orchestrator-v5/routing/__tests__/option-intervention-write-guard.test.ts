/**
 * ROADMAP 2.1266 — unit pins for `decideOptionInterventionWrite`.
 *
 * The dispatcher-level replay of the witnessed turn lives in
 * `handlers/__tests__/edit-graph-dispatch-wrong-entity-write-withheld.test.ts`.
 * THIS file pins the decision function's domain: every `allow` reason is
 * reachable and named, so a future change that silently widens the withhold
 * has to move one of these.
 *
 * ⚠ The guard's whole safety argument is that **only the measured state
 * withholds**. A reason that stopped being reachable would mean the withhold
 * had grown a new mouth — which is the direction that destroys a user's edit.
 * Each case below is therefore an opposite-direction twin of the withhold, not
 * a coverage tick.
 */

import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { applyOptionInterventionEdit, optionInterventionPostimageIsScoped } from '../../system-events/option-intervention-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { evaluateConfigureOptionOutcome } from '../configure-option-outcome.js';

const OPTION_ID = 'opt_subcontract';
const OPTION_LABEL = 'Subcontract inner-city runs to a green courier';
const FACTOR_ID = 'fac_sub_cost';
const FACTOR_LABEL = 'Subcontractor cost as share of affected-route revenue';
const OTHER_OPTION_ID = 'opt_electrify';
/** A factor the named option is NOT wired to — the identity-binding control. */
const UNLINKED_FACTOR_ID = 'fac_fuel';
const UNLINKED_FACTOR_LABEL = 'Fuel price';

/** The message shape the witness carried: names the option AND the factor. */
const NAMES_THE_OPTION = `For the ${OPTION_LABEL} option, set the effect value on ${FACTOR_LABEL} to 0.12 — a share, no unit.`;

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.01 },
    exists_probability: 0.9,
    effect_direction: 'positive' as const,
  };
}

function graph(opts: {
  readonly factorBaseline?: number;
  readonly optionInterventions?: Readonly<Record<string, number>>;
  readonly otherOptionInterventions?: Readonly<Record<string, number>>;
  readonly factorLabel?: string;
  /**
   * The baseline of a factor the NAMED option has no edge to. Present in EVERY
   * graph this corpus builds, so the identity binding is exercised by default
   * rather than only by the case written for it.
   */
  readonly unlinkedFactorBaseline?: number;
} = {}): GraphV3T {
  const bundle = (values: Readonly<Record<string, number>>) =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, { value: v, source: 'user_override' }]),
    );
  return {
    nodes: [
      { id: 'goal_fleet', kind: 'goal', label: 'Clean-air compliance' },
      {
        id: FACTOR_ID,
        kind: 'factor',
        label: opts.factorLabel ?? FACTOR_LABEL,
        ...(opts.factorBaseline === undefined
          ? {}
          : { observed_state: { value: opts.factorBaseline, source: 'cee_inference' } }),
      },
      {
        id: UNLINKED_FACTOR_ID,
        kind: 'factor',
        label: UNLINKED_FACTOR_LABEL,
        observed_state: { value: opts.unlinkedFactorBaseline ?? 1.2, source: 'cee_inference' },
      },
      {
        id: OPTION_ID,
        kind: 'option',
        label: OPTION_LABEL,
        ...(opts.optionInterventions ? { interventions: bundle(opts.optionInterventions) } : {}),
      },
      {
        id: OTHER_OPTION_ID,
        kind: 'option',
        label: 'Electrify one-third of the fleet',
        ...(opts.otherOptionInterventions
          ? { interventions: bundle(opts.otherOptionInterventions) }
          : {}),
      },
    ],
    edges: [
      edge(OPTION_ID, FACTOR_ID),
      edge(OTHER_OPTION_ID, FACTOR_ID),
      edge(FACTOR_ID, 'goal_fleet'),
      // ⚠ NOTE WHAT IS ABSENT: no `OPTION_ID → UNLINKED_FACTOR_ID` edge. The
      // unlinked factor reaches the goal directly, so it is a real part of the
      // model that the named option simply does not act on.
      edge(UNLINKED_FACTOR_ID, 'goal_fleet'),
    ],
  } as GraphV3T;
}

describe('2.1266 — the IDENTITY BINDING (trap 19): a moved baseline must belong to the named option', () => {
  /**
   * ⚠ THE FALSE POSITIVE AN ADVERSARIAL REVIEW EXECUTED against the version of
   * this guard that asked "did ANY node's value move?". The user names the
   * option only to give context, then asks for something entirely different —
   * and the applier does exactly as told. The unbound guard threw that edit
   * away and answered with recovery copy about another factor.
   *
   * This is the corpus's whole reason for existing: the original suite had ONE
   * graph shape and ONE message shape, in which the moved node was ALWAYS the
   * named option's own factor, so it was structurally incapable of telling the
   * bound and unbound versions apart. All 20 of its tests stayed green when the
   * binding was added.
   */
  const UNRELATED_REQUEST = `For the ${OPTION_LABEL} option, our ${UNLINKED_FACTOR_LABEL} assumption is stale — change ${UNLINKED_FACTOR_LABEL} to 1.40.`;

  it('PINS ITS OWN PRECONDITION: that message still reaches a not_honoured verdict', () => {
    // Without this the case above could pass for the wrong reason — an
    // `outcome_not_unhonoured` allow would look identical from the outside, and
    // the identity binding would never be exercised (trap 13b).
    const outcome = evaluateConfigureOptionOutcome({
      message: UNRELATED_REQUEST,
      before: graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.2 }),
      after: graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.4 }),
    });
    expect(outcome.status).toBe('not_honoured');
  });

  it('the edit CANNOT wire up its own justification: a new edge does not make the write withholdable', () => {
    // ⚠ THE SELF-JUSTIFYING WITHHOLD. If the neighbourhood were read from the
    // APPLIED graph, an edit could add `option → fac_fuel` and move that
    // factor's baseline, and the guard would treat the edge the suspect write
    // just created as grounds for discarding it. Reading the BEFORE graph — the
    // persisted authority — makes that impossible.
    const before = graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.2 });
    const after = graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.4 });
    (after.edges as Array<ReturnType<typeof edge>>).push(edge(OPTION_ID, UNLINKED_FACTOR_ID));

    // Precondition pinned in-test (trap 13b): the verdict must still be
    // `not_honoured`, or this passes without ever reaching the binding.
    expect(
      evaluateConfigureOptionOutcome({ message: NAMES_THE_OPTION, before, after }).status,
    ).toBe('not_honoured');
  });
});

// The retired prose guard has no live caller. These rows exercise its retained write boundary.
describe('retained scoped writer: approval cannot transfer authorship to another option', () => {
  it.each(['sibling intervention source', 'factor baseline source'])(
    '%s: target approval does not transfer authorship', (surface) => {
      const before = projectGraphForPersistence(graph({
        factorBaseline: 0.5, optionInterventions: { [FACTOR_ID]: 0.2 },
        otherOptionInterventions: { [FACTOR_ID]: 0.7 },
      }));
      for (const node of before.nodes) {
        if (node.kind !== 'option') continue;
        for (const [factorId, cell] of Object.entries(node.interventions ?? {})) {
          cell.source = 'cee_hypothesis';
          cell.target_match = { node_id: factorId, match_type: 'exact_id', confidence: 'high' };
        }
      }
      const target = { optionId: OPTION_ID, factorId: FACTOR_ID, modelValue: 0.3 };
      const candidate = applyOptionInterventionEdit({ persistedGraph: before, ...target,
        expectedGraphHash: computeAnalysisAffectingGraphHash(before)!,
        scenarioId: 'scenario', turnId: 'approved-turn', requestId: 'approved-request',
        freshness: 'fresh', hasExistingAnalysis: false });
      if (candidate.kind !== 'candidate') throw new Error(JSON.stringify(candidate));
      expect(optionInterventionPostimageIsScoped(before, candidate.graph, target)).toBe(true);
      const crossAuthor = structuredClone(candidate.graph);
      if (surface === 'sibling intervention source') {
        crossAuthor.nodes.find(node => node.id === OTHER_OPTION_ID)!.interventions![FACTOR_ID]!.source = 'user_specified';
      } else {
        crossAuthor.nodes.find(node => node.id === FACTOR_ID)!.observed_state!.source = 'user_override';
      }
      expect(optionInterventionPostimageIsScoped(before, crossAuthor, target)).toBe(false);
      expect(before.nodes.find(node => node.id === OTHER_OPTION_ID)!.interventions![FACTOR_ID]!.source)
        .toBe('cee_hypothesis');
    },
  );
});
