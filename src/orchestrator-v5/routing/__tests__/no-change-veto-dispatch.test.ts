/**
 * THE WIRING TEST. The predicate spec proves the veto CAN see a factor-object
 * prohibition; this proves the production dispatch path actually HANDS it the
 * labels. Without this the fix could be correct and unreachable — which is the
 * exact shape of the harm it exists to close.
 *
 * Journey-witnessed on staging, UI `88cb7e37` / CEE `4e88390`:
 *   "Whatever you do, don't set Rep Adoption Quality to 0.2 — that number is
 *    still disputed. Leave the model as it is and explain what the current
 *    value is doing to the ranking."
 * → graph signature changed, factor 0.7 → 0.2, stamped `provenance: user_set`,
 *   reply "Updated Rep Adoption Quality from 0.7 to 0.2."
 */

import { describe, it, expect } from 'vitest';

import { tryDeterministicValueUpdate } from '../deterministic-value-update.js';
import { buildGraphLookup, type GraphLookupWithOptions } from '../graph-lookup-adapter.js';
import { extractQuantities } from '../../context/cqe/extract-quantities.js';

const NODES = [
  { id: 'fac_adopt', kind: 'factor', label: 'Rep Adoption Quality', observed_state: { value: 0.7 } },
  { id: 'fac_lic', kind: 'factor', label: 'Annual CRM Licensing Cost', observed_state: { value: 0.9 } },
  { id: 'fac_growth', kind: 'factor', label: 'Growth', observed_state: { value: 0.5 } },
  // Non-factor kinds. `set_factor_value` can never target these, so naming one
  // must not cancel an edit to a factor.
  { id: 'risk_churn', kind: 'risk', label: 'Churn' },
  { id: 'out_rev', kind: 'outcome', label: 'Revenue' },
];

function lookupOrThrow(): GraphLookupWithOptions {
  const built = buildGraphLookup({ nodes: NODES, edges: [] } as unknown as Parameters<typeof buildGraphLookup>[0]);
  if (built.kind !== 'ok') throw new Error(`graph lookup ${built.kind}`);
  return built.lookup;
}

const factorIds = new Set(NODES.filter((n) => n.kind === 'factor').map((n) => n.id));

function dispatchFor(message: string) {
  return tryDeterministicValueUpdate(
    message,
    extractQuantities(message),
    lookupOrThrow(),
    [],
    factorIds,
    false,
  );
}

describe('no-change veto reaches the dispatch path', () => {
  it('THE WITNESSED TURN is refused, and refused for the RIGHT REASON', () => {
    const d = dispatchFor(
      "Whatever you do, don't set Rep Adoption Quality to 0.2 — that number is still disputed. Leave the model as it is and explain what the current value is doing to the ranking.",
    );

    expect(d.matched, 'the deterministic path dispatched the edit the user forbade').toBe(false);
    // Bind to the REASON, not just the outcome: a refusal for `no_edit_verb` or
    // `degraded_extraction` would pass a bare `matched === false` while leaving
    // the veto entirely unexercised (trap 19).
    expect(
      !d.matched ? d.skip_reason : null,
      'refused, but not by the no-change veto — this test would prove nothing',
    ).toBe('explicit_no_model_change');
  });

  it('TWIN — the affirmative form of the same edit still dispatches', () => {
    // Opposite direction, same factor, same value. If this regressed, the fix
    // would have stopped the product editing anything.
    const d = dispatchFor('Set Rep Adoption Quality to 0.2.');
    expect(d.matched, 'a plain authorised edit was refused').toBe(true);
  });

  it('TWIN — a prohibition naming a factor that is NOT in this graph does not veto', () => {
    // Binds the veto to the model's own entities by identity. Asserts the EXACT
    // skip_reason rather than `.not.toBe(...)`, which would pass for any
    // unrelated early return (trap 19).
    const d = dispatchFor("Whatever you do, don't set Brand Equity to 0.2.");
    expect(!d.matched ? d.skip_reason : 'matched').toBe('no_candidate_match');
  });

  // ⭐⭐ THE CLASS THAT REGRESSED, and the reason it is a class and not a case.
  // Widening the prohibition's object domain without also making an
  // entity-scoped prohibition defer to the affirmative-edit check turned every
  // negative aside into a whole-turn refusal. Found by adversarial review, not
  // by the first version of this suite — which had no opposite-direction twin
  // for "forbid A, authorise B" at all.
  it.each([
    ["Don't increase Churn — set Growth to 0.9.", 'a risk named in an aside'],
    ['Never touch Revenue. Set Growth to 0.9.', 'an outcome named in a prior sentence'],
    ['Do not change the Rep Adoption Quality. Set Growth to 0.9.', 'a FACTOR named in a prior sentence'],
    ['Set Growth to 0.9, and do not change Rep Adoption Quality.', 'the prohibition trailing the edit'],
  ])('TWIN — forbidding one entity leaves an authorised edit to another intact: %s', (message) => {
    const d = dispatchFor(message);
    expect(
      d.matched,
      'naming one entity in a prohibition cancelled an edit the user plainly authorised on a different entity',
    ).toBe(true);
  });

  it('CONTROL — an UNBOUNDED prohibition beside an affirmative edit still vetoes', () => {
    // The distinction the entity-scoped path must NOT erase. "Do not change the
    // model. Set Growth to 0.9." is self-contradictory on its face; the
    // documented exit for that class is to ask, not to guess, so the
    // conservative veto stands and this stays unchanged from base.
    const d = dispatchFor('Do not change the model. Set Growth to 0.9.');
    expect(!d.matched ? d.skip_reason : 'matched').toBe('explicit_no_model_change');
  });

  it.each([
    ['Do not change Churn.', 'a risk'],
    ['Do not change Revenue.', 'an outcome'],
  ])('CONTROL — a prohibition naming a NON-FACTOR entity is not this path\'s business: %s', (message) => {
    // Pins the factor-kind narrowing in `modelEntityLabels`. `set_factor_value`
    // can never target a risk or an outcome, so handing the veto those labels
    // would give it a domain strictly wider than anything this path can write —
    // the asymmetry, inverted. Without the narrowing this vetoes; with it, the
    // turn is simply not the value-update path's to refuse.
    const d = dispatchFor(message);
    expect(!d.matched ? d.skip_reason : 'matched').not.toBe('explicit_no_model_change');
  });

  it.each([
    ['Never reduce it below 0.3.', 'a node called "It" must not turn a pronoun into a prohibition'],
    ['Do not update me on this. Set Growth to 0.9.', 'a node called "Me" likewise'],
  ])('CONTROL — short/stopword labels cannot become prohibition objects: %s', (message) => {
    const d = dispatchFor(message);
    expect(!d.matched ? d.skip_reason : 'matched').not.toBe('explicit_no_model_change');
  });
});
