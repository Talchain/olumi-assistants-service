/**
 * ⭐⭐ THE LADDERS THAT COMBINE PROVENANCE MUST BE TOTAL OVER THE UNION.
 *
 * ## The defect this exists to stop coming back (measured 21 Sep 2026)
 *
 * `structureProvenanceOfEffect`'s "weakest end wins" was three `if`s and a bare
 * `return 'user_stated'`. Total over four members, silently non-total over
 * five: a `user_ratified` end matched no guard and was **promoted to
 * `user_stated`**, so `classifyIssueObligation` stamped
 * `{"provenance":"user_stated","obligation":"required"}` onto
 * `readiness_issues[]` — **byte-identical to a genuinely user-stated control**,
 * and the exact equivalence the 20 Sep ruling forbids
 * (*"AI estimated → user confirmed" is NOT "user originally stated"*). The
 * compiler could not see it: a bare `return` closing a chain is not a default
 * the type system checks. `structureProvenance`'s interventions ladder carried
 * the same shape, resolving `user_ratified` to `unattributed`.
 *
 * ## ⛔ WHY THE ASSERTIONS ARE WRITTEN AS *DIFFERENCES*
 *
 * The harm is an EQUIVALENCE, so the property is that two arms DISAGREE.
 * Asserting only `ratified === 'offered'` would pass against a build that had
 * also broken the user-stated control down to `offered` — a guard agreeing with
 * itself (CLAUDE.md trap 13b). Every arm below is bound to its object by
 * IDENTITY (fixture node id + stamp), never by a value predicate another arm
 * could satisfy (trap 19), and each difference test **pins its own
 * precondition** first: it asserts the fixture really does produce two distinct
 * factor-level provenances before asserting anything downstream, so a rotted
 * fixture REDs here instead of quietly making the arms agree.
 *
 * ## ⛔ AND WHY THE CORPUS IS DERIVED
 *
 * The pair sweeps iterate `STRUCTURE_PROVENANCE_VALUES`, so a SIXTH member
 * enters this corpus automatically rather than by someone remembering to add a
 * case (trap 12). That is the runtime face of the `Record<StructureProvenance,
 * …>` totality the source now relies on; neither supersedes the other
 * (trap 12d) — the `Record` stops a member going unruled, this stops the rule
 * being wrong.
 */
import { describe, expect, it } from 'vitest';

import {
  STRUCTURE_PROVENANCE_VALUES,
  classifyIssueObligation,
  earnsAuthorshipCredit,
  obligationFor,
  reflectsAHumanAct,
  strongestProvenance,
  structureProvenance,
  structureProvenanceOfEffect,
  weakestProvenance,
  type StructureProvenance,
} from '../obligation-provenance.js';
import type { CanonicalReadinessIssue } from '../../../orchestrator/tools/analysis-ready-helper.js';

// ============================================================================
// The wire fixture: exactly the MISSING_OPTION_VALUE shape
// ============================================================================

/**
 * An option with a user-set effect on ONE factor and **no** stamped effect on
 * `fac_churn` — which is what `MISSING_OPTION_VALUE` means. Only `fac_churn`'s
 * own `observed_state.source` varies per arm, so the arms differ in exactly one
 * byte of input and any difference downstream is attributable to it.
 */
function graphWithChurnStamp(churnSource: string | undefined) {
  return {
    nodes: [
      {
        id: 'opt_a',
        kind: 'option',
        interventions: { fac_price: { source: 'user_specified', value: 1 } },
      },
      {
        id: 'fac_churn',
        kind: 'factor',
        ...(churnSource === undefined
          ? {}
          : { observed_state: { source: churnSource, value: 0.2 } }),
      },
      { id: 'fac_price', kind: 'factor', observed_state: { source: 'user_override', value: 10 } },
    ],
    edges: [{ from: 'opt_a', to: 'fac_churn', origin: 'llm_draft' }],
  };
}

const MISSING_OPTION_VALUE_ISSUE: CanonicalReadinessIssue = {
  issue_id: 'iss_churn',
  code: 'MISSING_OPTION_VALUE' as CanonicalReadinessIssue['code'],
  category: 'missing_quantity' as CanonicalReadinessIssue['category'],
  message: 'Factor churn is currently 0.2. What should option A set it to?',
  repairability: 'human_input_required',
  option_id: 'opt_a',
  factor_id: 'fac_churn',
};

/** The factor node itself, found BY ID — never by position or by a predicate. */
function churnNode(graph: ReturnType<typeof graphWithChurnStamp>) {
  const node = graph.nodes.find((n) => n.id === 'fac_churn');
  expect(node, 'fixture must carry a node with id fac_churn').toBeDefined();
  return node;
}

describe('the ends ladder is total: ratification never becomes authorship on the wire', () => {
  it('RATIFIED and USER-STATED arms produce DIFFERENT provenance and DIFFERENT obligation', () => {
    const ratifiedGraph = graphWithChurnStamp('user_confirmed');
    const statedGraph = graphWithChurnStamp('user_override');

    // ⭐ PRECONDITION PIN. If these two ever stop differing at the element level
    // the fixture has rotted, and every assertion below would pass vacuously.
    const ratifiedEnd = structureProvenance(churnNode(ratifiedGraph), ratifiedGraph);
    const statedEnd = structureProvenance(churnNode(statedGraph), statedGraph);
    expect(ratifiedEnd).toBe('user_ratified');
    expect(statedEnd).toBe('user_stated');
    expect(ratifiedEnd).not.toBe(statedEnd);

    const ratified = classifyIssueObligation(MISSING_OPTION_VALUE_ISSUE, ratifiedGraph);
    const stated = classifyIssueObligation(MISSING_OPTION_VALUE_ISSUE, statedGraph);

    // THE DISCRIMINATION. These two were byte-identical before the fix.
    expect(ratified.provenance).not.toBe(stated.provenance);
    expect(ratified.obligation).not.toBe(stated.obligation);

    // And each arm is right in its own terms.
    expect(ratified.provenance).toBe('user_ratified');
    expect(ratified.obligation).toBe('offered');
    expect(stated.provenance).toBe('user_stated');
    expect(stated.obligation).toBe('required');
  });

  it('`user_assumption` is ratification too, and also differs from the user-stated control', () => {
    const assumption = classifyIssueObligation(
      MISSING_OPTION_VALUE_ISSUE,
      graphWithChurnStamp('user_assumption'),
    );
    const stated = classifyIssueObligation(
      MISSING_OPTION_VALUE_ISSUE,
      graphWithChurnStamp('user_override'),
    );
    expect(assumption.provenance).not.toBe(stated.provenance);
    expect(assumption.provenance).toBe('user_ratified');
    expect(assumption.obligation).toBe('offered');
  });

  it('CONTROLS: the machine and unstamped arms are unchanged and still distinct', () => {
    const ai = classifyIssueObligation(
      MISSING_OPTION_VALUE_ISSUE,
      graphWithChurnStamp('cee_inference'),
    );
    const none = classifyIssueObligation(MISSING_OPTION_VALUE_ISSUE, graphWithChurnStamp(undefined));
    expect(ai.provenance).toBe('ai_drafted');
    expect(ai.obligation).toBe('offered');
    expect(none.provenance).toBe('unattributed');
    expect(none.obligation).toBe('offered');
    // Four arms, three distinct provenance answers: the probe is not blind.
    const answers = new Set(
      (['user_confirmed', 'user_override', 'cee_inference', undefined] as const).map(
        (s) => classifyIssueObligation(MISSING_OPTION_VALUE_ISSUE, graphWithChurnStamp(s)).provenance,
      ),
    );
    expect(answers.size).toBe(4);
  });

  it('the WEAKEST end wins: a ratified factor drags a user-stated option down, not up', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          interventions: { fac_price: { source: 'user_specified', value: 1 } },
        },
        { id: 'fac_churn', kind: 'factor', observed_state: { source: 'user_confirmed', value: 1 } },
        { id: 'fac_price', kind: 'factor', observed_state: { source: 'user_override', value: 1 } },
      ],
      edges: [{ from: 'opt_a', to: 'fac_churn', origin: 'llm_draft' }],
    };
    // Precondition: the two ends really do disagree.
    expect(structureProvenance(graph.nodes[0], graph)).toBe('user_stated');
    expect(structureProvenance(graph.nodes[1], graph)).toBe('user_ratified');
    expect(structureProvenanceOfEffect(graph, 'opt_a', 'fac_churn')).toBe('user_ratified');
  });
});

describe('the interventions ladder is total: ratification is not "nobody stamped it"', () => {
  const optionStampedOnlyWith = (source: string) => ({
    id: 'opt_x',
    kind: 'option',
    interventions: { fac_1: { source, value: 1 } },
  });

  it('a ratified-only option is `user_ratified`, and DIFFERS from the unstamped control', () => {
    const ratified = structureProvenance(optionStampedOnlyWith('user_confirmed'));
    const unstamped = structureProvenance({ id: 'opt_x', kind: 'option', interventions: {} });
    expect(unstamped).toBe('unattributed');
    // Before the fix both of these were `unattributed` — a WIRE counter meaning
    // "nobody stamped it", which is false about a value a human acted on.
    expect(ratified).not.toBe(unstamped);
    expect(ratified).toBe('user_ratified');
    expect(structureProvenance(optionStampedOnlyWith('user_assumption'))).toBe('user_ratified');
  });

  it('CONTROLS: the user-specified and hypothesis arms are unchanged', () => {
    expect(structureProvenance(optionStampedOnlyWith('user_specified'))).toBe('user_stated');
    expect(structureProvenance(optionStampedOnlyWith('cee_hypothesis'))).toBe('ai_drafted');
  });

  it('the STRONGEST stated effect wins, and ratification outranks a hypothesis', () => {
    const mixed = {
      id: 'opt_x',
      kind: 'option',
      interventions: {
        fac_1: { source: 'cee_hypothesis', value: 1 },
        fac_2: { source: 'user_confirmed', value: 2 },
      },
    };
    expect(structureProvenance(mixed)).toBe('user_ratified');
    // …and a genuine authorship stamp still outranks ratification.
    expect(
      structureProvenance({
        id: 'opt_x',
        kind: 'option',
        interventions: {
          fac_1: { source: 'user_confirmed', value: 1 },
          fac_2: { source: 'user_specified', value: 2 },
        },
      }),
    ).toBe('user_stated');
  });
});

describe('the order over the union is total and strict — derived, not hand-listed', () => {
  const MEMBERS = STRUCTURE_PROVENANCE_VALUES;

  it('the derived corpus covers the whole union and is not empty', () => {
    expect(MEMBERS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(MEMBERS).size).toBe(MEMBERS.length);
  });

  it('every member is its own weakest and strongest — no member is unranked', () => {
    for (const m of MEMBERS) {
      expect(weakestProvenance([m]), `weakest of [${m}]`).toBe(m);
      expect(strongestProvenance([m]), `strongest of [${m}]`).toBe(m);
    }
  });

  it('⛔ the combinators never INVENT a member that was not an input', () => {
    // This is the original defect stated as a property: `['user_ratified']`
    // returned `'user_stated'`, a value that was never an end.
    for (const a of MEMBERS) {
      for (const b of MEMBERS) {
        expect([a, b], `weakest of [${a},${b}]`).toContain(weakestProvenance([a, b]));
        expect([a, b], `strongest of [${a},${b}]`).toContain(strongestProvenance([a, b]));
      }
    }
  });

  it('the order is STRICT: two distinct members never tie', () => {
    for (const a of MEMBERS) {
      for (const b of MEMBERS) {
        if (a === b) continue;
        // A tie would mean a new member had been given a duplicate rank, which
        // makes "weakest wins" non-deterministic in input order.
        expect(
          weakestProvenance([a, b]),
          `[${a},${b}] must not tie`,
        ).not.toBe(strongestProvenance([a, b]));
      }
    }
  });

  it('empty input yields null rather than a guessed member', () => {
    expect(weakestProvenance([])).toBeNull();
    expect(strongestProvenance([])).toBeNull();
  });

  it('ratification sits strictly between a machine guess and authorship', () => {
    expect(weakestProvenance(['user_ratified', 'user_stated'])).toBe('user_ratified');
    expect(strongestProvenance(['user_ratified', 'ai_drafted'])).toBe('user_ratified');
    // …and the control that proves the pair above is about `user_ratified` and
    // not about the combinator being broken in one direction.
    expect(weakestProvenance(['user_stated', 'user_stated'])).toBe('user_stated');
    expect(strongestProvenance(['ai_drafted', 'ai_drafted'])).toBe('ai_drafted');
  });

  it('the obligation cut lands between ratification and authorship, for EVERY member', () => {
    for (const m of MEMBERS) {
      const expected = m === 'user_stated' ? 'required' : 'offered';
      expect(obligationFor(m as StructureProvenance), `obligationFor(${m})`).toBe(expected);
    }
    // The twin predicates stay named apart (trap 21): ratification is a human
    // act that earns no authorship credit.
    expect(reflectsAHumanAct('user_ratified')).toBe(true);
    expect(earnsAuthorshipCredit('user_ratified')).toBe(false);
  });
});
