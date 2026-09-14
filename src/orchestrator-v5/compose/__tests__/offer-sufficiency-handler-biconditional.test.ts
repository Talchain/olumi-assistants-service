/**
 * ⭐⭐ THE ORACLE FOR `OFFER_REQUIRED_PARAMETERS`, PINNED BY EXECUTION.
 *
 * `OFFER_REQUIRED_PARAMETERS` states which parameters each proposable handler
 * REQUIRES. That is the one genuinely new fact the offer-sufficiency gate
 * adds, and a table of it is a hand-maintained mirror of the handlers' own
 * `resolveParams` throw sites (CLAUDE.md trap 12). A mirror that nobody
 * checks drifts silently, and the drift reads as green in BOTH directions:
 *
 *   - a handler GAINS a required parameter → the gate keeps offering a change
 *     the resumer now refuses (the defect this gate was written to close,
 *     reopened one parameter along);
 *   - a handler DROPS a requirement → the gate suppresses an offer the
 *     product could have made, which is the WORSE direction: a silent loss of
 *     capability, invisible to every user-facing test.
 *
 * ⚠ A DERIVED GUARD CANNOT HELP HERE: there is nothing to derive from. No
 * handler declares its required parameters; the requirement is expressed as
 * control flow inside `resolveParams`. So the only instrument that can settle
 * it is EXECUTION against the real handler, in BOTH directions — which is
 * what this file does. It is deliberately NOT a mutation kit: a mutant kit
 * measures whether a test can DETECT a change, never whether the EXPECTATION
 * is right (trap 13c), and the expectation is exactly what is at stake here.
 *
 * ⛔⛔ THE FIRST VERSION OF THIS FILE HAD THE DEFECT IT WAS WRITTEN TO
 * PREVENT, AND A MUTANT CAUGHT IT. It generated its cases by iterating
 * `OFFER_REQUIRED_PARAMETERS`. Deleting the `value` entry from the table
 * therefore deleted that entry's OWN test case: the suite went from 8 cases
 * to 7 and stayed fully GREEN, so the table could silently go SHORT — which
 * is the direction that reopens the defect. The mirror-checking guard was
 * itself derived from the mirror (CLAUDE.md trap 12d: a derived guard proves
 * agreement and can never prove completeness). The too-STRICT mutant bit
 * correctly, which is exactly how an asymmetric guard flatters itself: one
 * door watched, the other open, and a green run for both.
 *
 * ⭐ THE REPAIR: the required set is now DERIVED FROM THE HANDLER, by probing
 * it — drop each parameter of a complete proposal in turn and ask the real
 * handler whether it refuses for a missing parameter. That yields
 * `derivedRequired` WITHOUT consulting the table, and the table is then
 * asserted EQUAL to it. A short table REDs; a long one REDs. The case list
 * comes from `COMPLETE`, never from the thing under test.
 *
 * And `COMPLETE`'s own adequacy is pinned rather than assumed: if it omitted
 * a parameter the handler requires, the handler would refuse `COMPLETE`
 * itself and the SUFFICIENT arm would RED. So there is no unchecked fixture
 * left holding the result up.
 *
 * Each intent gets a PAIR, and both halves must hold:
 *   SUFFICIENT   — params the gate passes must NOT raise PARAMETER_INVALID
 *                  naming a missing parameter at the real handler.
 *   INSUFFICIENT — dropping any parameter the HANDLER requires must make both
 *                  the handler and the gate refuse.
 * Neither half alone shows anything: the first proves the table is not too
 * strict, the second that it is not too slack.
 */
import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../routing/types.js';
import {
  OFFER_REQUIRED_PARAMETERS,
  findInsufficientOfferParameters,
} from '../warrant-demotion.js';
import { createAddConstraintHandler } from '../../tools/handlers/add-constraint.js';
import { createSetFactorValueHandler } from '../../tools/handlers/set-factor-value.js';
import { createAdjustEdgeStrengthHandler } from '../../tools/handlers/adjust-edge-strength.js';
import {
  buildD1Fixture,
  buildHandlerInvocation,
} from '../../tools/handlers/d1-shared/__tests__/fixtures.js';

type Param = { readonly name: string; readonly value: unknown };

/**
 * A COMPLETE proposal per intent — every required parameter present and
 * usable. `f-churn` is a factor with an observed state, `f-budget→g-revenue`
 * is a real edge in the shared fixture.
 */
const COMPLETE: Readonly<
  Record<string, { readonly entity: ProposalAction['entity']; readonly parameters: readonly Param[] }>
> = {
  add_constraint: {
    entity: {
      id: 'f-churn',
      kind: 'node',
      label: 'Customer churn',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_most' },
      { name: 'value', value: 7 },
      { name: 'unit', value: '%' },
    ],
  },
  set_factor_value: {
    entity: {
      id: 'f-churn',
      kind: 'node',
      label: 'Customer churn',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value: { value: 7, unit: '%' } }],
  },
  adjust_edge_strength: {
    entity: {
      id: 'f-budget→g-revenue',
      kind: 'edge',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'strength', value: 0.7 }],
  },
};

const HANDLERS: Readonly<Record<string, () => ReturnType<typeof createAddConstraintHandler>>> = {
  add_constraint: createAddConstraintHandler,
  set_factor_value: createSetFactorValueHandler as never,
  adjust_edge_strength: createAdjustEdgeStrengthHandler as never,
};

function proposal(intent: string, parameters: readonly Param[]): ProposalAction {
  return {
    handler_id: intent,
    entity: COMPLETE[intent]!.entity,
    parameters: parameters.map((p) => ({ ...p, source: 'user_explicit' as const })),
    cited_context_fields: [],
  } as unknown as ProposalAction;
}

function graph(): GraphV3T {
  return buildD1Fixture();
}

/**
 * Run the REAL handler and report whether it refused for a MISSING required
 * parameter specifically.
 *
 * ⚠ Scoped narrowly on purpose. A handler can refuse a complete proposal for
 * reasons that have nothing to do with parameter sufficiency (an
 * unevaluable target, a graph invariant, a unit-ambiguity backstop). Treating
 * any refusal as "insufficient" would make the SUFFICIENT arm pass for the
 * wrong reason — a guard agreeing with itself (trap 13b). The discriminator
 * is the handler's own "requires a ... parameter" sentence.
 */
async function refusedForMissingParameter(
  intent: string,
  parameters: readonly Param[],
): Promise<boolean> {
  const handler = HANDLERS[intent]!();
  try {
    await handler(
      buildHandlerInvocation({
        graph: graph(),
        proposal: proposal(intent, parameters),
        message: 'do it',
      }),
    );
    return false;
  } catch (err) {
    const message = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
    return /requires a "?[a-z_]+"? parameter|must be a number|constraint_type must be/i.test(
      message,
    );
  }
}

/**
 * Ask the HANDLER which of a complete proposal's parameters it requires, by
 * dropping each one in turn. Deliberately does NOT read the table under test.
 */
async function deriveRequiredFromHandler(intent: string): Promise<string[]> {
  const complete = COMPLETE[intent]!.parameters;
  const required: string[] = [];
  for (const candidate of complete) {
    const without = complete.filter((p) => p.name !== candidate.name);
    // Precondition pinned IN-TEST: the drop must actually have removed
    // something, or this probe asserts nothing (trap 13b).
    expect(without.length, `${intent}: dropping ${candidate.name}`).toBe(complete.length - 1);
    if (await refusedForMissingParameter(intent, without)) required.push(candidate.name);
  }
  return required.sort();
}

describe('OFFER_REQUIRED_PARAMETERS — the biconditional against the real handlers', () => {
  // NOTE: the case list is `COMPLETE`, never `OFFER_REQUIRED_PARAMETERS`. A
  // loop over the table cannot see the table go short.
  for (const intent of Object.keys(COMPLETE)) {
    const complete = COMPLETE[intent]!.parameters;

    it(`${intent}: SUFFICIENT — the gate passes the complete proposal, and so does the handler`, async () => {
      // The gate must not be stricter than the handler.
      expect(findInsufficientOfferParameters(proposal(intent, complete))).toBeNull();
      // And the handler must not refuse it for a missing parameter. This is
      // also what pins COMPLETE itself: if it omitted a required parameter,
      // the handler would refuse it here.
      await expect(refusedForMissingParameter(intent, complete)).resolves.toBe(false);
    });

    it(`${intent}: the table states EXACTLY what the handler requires, derived by probing it`, async () => {
      const derived = await deriveRequiredFromHandler(intent);
      // The probe must find something, or an empty-equals-empty comparison
      // would pass while measuring nothing (trap 13: an absence assertion
      // needs to prove it can see a presence).
      expect(derived.length, `${intent}: probe found no required parameter`).toBeGreaterThan(0);

      const declared = (
        OFFER_REQUIRED_PARAMETERS[intent as keyof typeof OFFER_REQUIRED_PARAMETERS] ?? []
      )
        .map((r) => r.name)
        .sort();
      // Equality, not containment: a SHORT table reopens the defect, a LONG
      // one silently suppresses legitimate offers. Both must RED.
      expect(declared).toEqual(derived);
    });

    it(`${intent}: INSUFFICIENT — dropping any parameter the handler requires is refused by the gate too`, async () => {
      const derived = await deriveRequiredFromHandler(intent);
      expect(derived.length).toBeGreaterThan(0);
      for (const name of derived) {
        const without = complete.filter((p) => p.name !== name);
        expect(findInsufficientOfferParameters(proposal(intent, without)), name).toEqual({
          parameterName: name,
        });
      }
    });
  }

  it('the table names only parameters the proposal channel can actually carry', () => {
    // A required parameter no proposal can carry would make the gate refuse
    // every offer for that intent — a silent capability loss.
    for (const [intent, required] of Object.entries(OFFER_REQUIRED_PARAMETERS)) {
      const carried = new Set(COMPLETE[intent]!.parameters.map((p) => p.name));
      for (const r of required) {
        expect(carried.has(r.name), `${intent}.${r.name}`).toBe(true);
      }
    }
  });

  it('covers every intent the gate has authority over, so none is silently unprobed', () => {
    expect(Object.keys(COMPLETE).sort()).toEqual(Object.keys(OFFER_REQUIRED_PARAMETERS).sort());
  });
});
