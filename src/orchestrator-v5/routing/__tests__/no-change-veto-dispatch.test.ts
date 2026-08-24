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
];

function lookupOrThrow(): GraphLookupWithOptions {
  const built = buildGraphLookup({ nodes: NODES, edges: [] } as unknown as Parameters<typeof buildGraphLookup>[0]);
  if (built.kind !== 'ok') throw new Error(`graph lookup ${built.kind}`);
  return built.lookup;
}

const factorIds = new Set(NODES.map((n) => n.id));

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
    // Binds the veto to the model's own entities by identity.
    const d = dispatchFor("Whatever you do, don't set Brand Equity to 0.2.");
    expect(!d.matched ? d.skip_reason : 'matched').not.toBe('explicit_no_model_change');
  });
});
