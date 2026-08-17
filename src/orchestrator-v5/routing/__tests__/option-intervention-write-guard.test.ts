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
import {
  decideOptionInterventionWrite,
  anyInterventionWriteLanded,
  baselineWritesLanded,
  optionLinkedNodeIds,
  formatWithheldWriteNotice,
  resolveNodeLabels,
} from '../option-intervention-write-guard.js';
import { findSuccessClaimHit } from '../../compose/forbidden-user-facing-phrases.js';
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

const PRE = () => graph({ factorBaseline: 0.5 });

function decide(overrides: {
  readonly message?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly appliedMutation?: boolean;
}) {
  return decideOptionInterventionWrite({
    message: overrides.message ?? NAMES_THE_OPTION,
    before: overrides.before ?? PRE(),
    after: overrides.after ?? null,
    appliedMutation: overrides.appliedMutation ?? true,
  });
}

describe('2.1266 — the measured wrong-entity state, and only it, withholds', () => {
  it('WITHHOLDS: the factor baseline moved and no option gained an effect value', () => {
    const verdict = decide({ after: graph({ factorBaseline: 0.12 }) });
    expect(verdict.verdict).toBe('withhold');
    if (verdict.verdict !== 'withhold') return;
    // Identity-bound (trap 19): the option the USER NAMED, and the node whose
    // value would be discarded — not "something changed".
    expect(verdict.optionId).toBe(OPTION_ID);
    expect(verdict.optionLabel).toBe(OPTION_LABEL);
    expect(verdict.baselineNodeIds).toEqual([FACTOR_ID]);
  });
});

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

  it('ALLOWS a correctly-executed edit to a factor the named option is NOT wired to', () => {
    const verdict = decide({
      message: UNRELATED_REQUEST,
      before: graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.2 }),
      after: graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.4 }),
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'baseline_write_unrelated_to_option' });
  });

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

  it('OPPOSITE-DIRECTION TWIN: the same shape on a LINKED factor still withholds', () => {
    // Identical in every respect except WHICH factor moved. If this went green
    // by accident the binding would be watching nothing; if the case above went
    // red the binding would be too tight. The pair is the evidence, not either
    // one alone.
    const verdict = decide({
      message: UNRELATED_REQUEST,
      before: graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.2 }),
      after: graph({ factorBaseline: 0.12, unlinkedFactorBaseline: 1.2 }),
    });
    expect(verdict.verdict).toBe('withhold');
    if (verdict.verdict !== 'withhold') return;
    expect(verdict.baselineNodeIds).toEqual([FACTOR_ID]);
  });

  it('a MIXED move names only the linked node — the unlinked one is not grounds', () => {
    const verdict = decide({
      before: graph({ factorBaseline: 0.5, unlinkedFactorBaseline: 1.2 }),
      after: graph({ factorBaseline: 0.12, unlinkedFactorBaseline: 1.4 }),
    });
    expect(verdict.verdict).toBe('withhold');
    if (verdict.verdict !== 'withhold') return;
    // `fac_fuel` moved too, but it is not what makes this a wrong-entity write.
    expect(verdict.baselineNodeIds).toEqual([FACTOR_ID]);
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
    // And the two readings must genuinely disagree, or there is nothing to
    // discriminate: linked in AFTER, not linked in BEFORE.
    expect(optionLinkedNodeIds(after, OPTION_ID).has(UNLINKED_FACTOR_ID)).toBe(true);
    expect(optionLinkedNodeIds(before, OPTION_ID).has(UNLINKED_FACTOR_ID)).toBe(false);

    expect(decide({ before, after })).toEqual({
      verdict: 'allow',
      reason: 'baseline_write_unrelated_to_option',
    });
  });

  it('optionLinkedNodeIds reads the option own edges, taken from the BEFORE graph', () => {
    const g = graph({ factorBaseline: 0.5 });
    expect([...optionLinkedNodeIds(g, OPTION_ID)]).toEqual([FACTOR_ID]);
    // Resolving against a graph the edit invented would let the suspect write
    // manufacture its own justification.
    expect(optionLinkedNodeIds(g, OPTION_ID).has(UNLINKED_FACTOR_ID)).toBe(false);
    expect([...optionLinkedNodeIds(g, OTHER_OPTION_ID)]).toEqual([FACTOR_ID]);
  });
});

describe('2.1266 — every allow reason is reachable and named', () => {
  it('no_write: the dispatcher applied no mutation', () => {
    expect(decide({ after: graph({ factorBaseline: 0.12 }), appliedMutation: false })).toEqual({
      verdict: 'allow',
      reason: 'no_write',
    });
  });

  it('graph_unparseable: the applied graph does not strict-parse', () => {
    expect(decide({ after: { nodes: 'not a list' } })).toEqual({
      verdict: 'allow',
      reason: 'graph_unparseable',
    });
  });

  it('outcome_not_unhonoured: the message names no option, so no verdict is reached', () => {
    expect(
      decide({
        message: `Set ${FACTOR_LABEL} to 0.12.`,
        after: graph({ factorBaseline: 0.12 }),
      }),
    ).toEqual({ verdict: 'allow', reason: 'outcome_not_unhonoured' });
  });

  it('interventions_write_landed: an effect value landed for ANOTHER option', () => {
    // Deliberately the OTHER option. The named option still missed out, so the
    // outcome verdict is `not_honoured` — and the turn still did real work for
    // an option, which is not the wrong-entity signature. Discarding it would
    // be a new harm.
    expect(
      decide({
        after: graph({ factorBaseline: 0.12, otherOptionInterventions: { [FACTOR_ID]: 0.3 } }),
      }),
    ).toEqual({ verdict: 'allow', reason: 'interventions_write_landed' });
  });

  it('no_baseline_write: a STRUCTURAL-only edit (a rename) is not withheld', () => {
    expect(
      decide({ after: graph({ factorBaseline: 0.5, factorLabel: 'Subcontractor cost share' }) }),
    ).toEqual({ verdict: 'allow', reason: 'no_baseline_write' });
  });
});

describe('2.1266 — the withheld turn says so: nothing was saved', () => {
  it('names one factor', () => {
    expect(formatWithheldWriteNotice(['Fuel price'])).toBe(
      'Note: nothing from this message was saved, so "Fuel price" is unchanged.',
    );
  });

  it('names two, then three, then summarises the remainder', () => {
    expect(formatWithheldWriteNotice(['A', 'B'])).toContain('"A" and "B" are unchanged');
    expect(formatWithheldWriteNotice(['A', 'B', 'C'])).toContain('"A", "B" and "C" are unchanged');
    expect(formatWithheldWriteNotice(['A', 'B', 'C', 'D'])).toContain(
      '"A", "B", "C" and 1 other are unchanged',
    );
    expect(formatWithheldWriteNotice(['A', 'B', 'C', 'D', 'E'])).toContain('and 2 others are');
  });

  it('says the true unqualified thing when no label resolves', () => {
    expect(formatWithheldWriteNotice([])).toBe(
      'Note: nothing from this message was saved, so the model is unchanged.',
    );
    expect(formatWithheldWriteNotice(['   '])).toBe(
      'Note: nothing from this message was saved, so the model is unchanged.',
    );
  });

  it('carries no success claim and makes no offer it cannot honour (P8)', () => {
    for (const text of [
      formatWithheldWriteNotice([]),
      formatWithheldWriteNotice(['Fuel price']),
      formatWithheldWriteNotice(['A', 'B', 'C', 'D']),
    ]) {
      // The finaliser's success-claim backstop does not run on this path
      // (`successfulAppliedMutation` is true), so the copy must be clean by
      // construction rather than by being caught.
      expect(findSuccessClaimHit(text)).toBeNull();
      // No "tell me again and I'll fix it" — the product cannot bind that
      // answer yet, and offering it would be the defect one level along.
      expect(text).not.toMatch(/\b(I'?ll|I will|let me know|tell me|would you like|shall I)\b/i);
    }
  });

  it('resolveNodeLabels binds by id and skips ids the graph does not carry', () => {
    const gr = graph({ factorBaseline: 0.5 });
    expect(resolveNodeLabels(gr, [FACTOR_ID])).toEqual([FACTOR_LABEL]);
    expect(resolveNodeLabels(gr, [UNLINKED_FACTOR_ID, FACTOR_ID])).toEqual([
      UNLINKED_FACTOR_LABEL,
      FACTOR_LABEL,
    ]);
    expect(resolveNodeLabels(gr, ['no_such_node'])).toEqual([]);
  });
});

describe('2.1266 W1 — the KNOWN cost, pinned so it can never become invisible', () => {
  /**
   * ⚠ THIS TEST ASSERTS A DEFECT WE ARE KNOWINGLY SHIPPING, and that is the
   * point (CLAUDE.md trap 22f: the honest way to ship a known gap is to pin it
   * so the suite stays green for the RIGHT reason and REDs if the set changes).
   *
   * The user explicitly and correctly asks to change a factor's own baseline.
   * Because that factor IS wired to the named option, the request is
   * indistinguishable AT THE GRAPH from the witnessed wrong-entity write — same
   * option named, no effect value landed, a linked baseline moved. So it is
   * withheld. Gating on the intent trigger was tested and rejected:
   * `option_value_set` is the assistant's OWN suggested phrasing for a genuine
   * effect request, so gating on it would blind the guard to the product's
   * recommended format.
   *
   * The ambiguity is landed where the graph matches the reply — and the cost is
   * paid OPENLY. If someone later makes this withhold silent, the second
   * assertion goes red.
   */
  const W1_REQUEST = `For the ${OPTION_LABEL} option, our ${FACTOR_LABEL} assumption is stale — change the ${FACTOR_LABEL} baseline to 0.3.`;

  it('is withheld — the known, accepted cost of landing the ambiguity here', () => {
    const verdict = decide({
      message: W1_REQUEST,
      before: graph({ factorBaseline: 0.5 }),
      after: graph({ factorBaseline: 0.3 }),
    });
    expect(verdict.verdict).toBe('withhold');
  });

  it('and the user is TOLD — a silent withhold is the worse defect', () => {
    const verdict = decide({
      message: W1_REQUEST,
      before: graph({ factorBaseline: 0.5 }),
      after: graph({ factorBaseline: 0.3 }),
    });
    if (verdict.verdict !== 'withhold') throw new Error('precondition: expected a withhold');
    const notice = formatWithheldWriteNotice(
      resolveNodeLabels(graph({ factorBaseline: 0.5 }), verdict.baselineNodeIds),
    );
    expect(notice).toContain('nothing from this message was saved');
    expect(notice).toContain(FACTOR_LABEL);
  });
});

describe('2.1266 — the two readers', () => {
  it('anyInterventionWriteLanded sees a gained, a changed and a REMOVED effect value', () => {
    const none = graph({ factorBaseline: 0.5 });
    const gained = graph({ factorBaseline: 0.5, optionInterventions: { [FACTOR_ID]: 0.4 } });
    const changed = graph({ factorBaseline: 0.5, optionInterventions: { [FACTOR_ID]: 0.9 } });
    expect(anyInterventionWriteLanded(none, gained)).toBe(true);
    expect(anyInterventionWriteLanded(gained, changed)).toBe(true);
    // A clear is a real edit too.
    expect(anyInterventionWriteLanded(gained, none)).toBe(true);
    expect(anyInterventionWriteLanded(none, none)).toBe(false);
  });

  it('baselineWritesLanded names the moved nodes and ignores a NEW node', () => {
    expect(baselineWritesLanded(graph({ factorBaseline: 0.5 }), graph({ factorBaseline: 0.12 })))
      .toEqual([FACTOR_ID]);
    expect(baselineWritesLanded(graph({ factorBaseline: 0.5 }), graph({ factorBaseline: 0.5 })))
      .toEqual([]);
    const withNewNode = graph({ factorBaseline: 0.5 });
    withNewNode.nodes.push({
      id: 'fac_added',
      kind: 'factor',
      label: 'Added factor',
      observed_state: { value: 0.9, source: 'user_override' },
    } as GraphV3T['nodes'][number]);
    // A structural ADD is not a rewrite of shared state.
    expect(baselineWritesLanded(graph({ factorBaseline: 0.5 }), withNewNode)).toEqual([]);
  });
});
