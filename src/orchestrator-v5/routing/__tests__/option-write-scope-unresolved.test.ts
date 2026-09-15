/**
 * ⭐⭐ AN OPTION-ANCHORED TURN WHOSE IDENTITY DOES NOT RESOLVE MUST NOT WRITE A
 * MODEL-WIDE BASELINE. It must ASK.
 *
 * ═══ THE MEASURED DEFECT — deployed `a3b0548d`, wire-level, FRESH ═══
 * Banked at `output/core-staging-driver/journey-integrated-a3b0548d/journey-buy-run1/`.
 *
 *   USER    "Change the buy option so the vendor cost is £150,000 per year
 *            instead of £120,000. Keep everything else the same."
 *   RESULT  factor `8f788330` "Vendor Licensing Cost" `observed_state`
 *             null → { value: 1.5, raw_value: 150000, source: "user_override" }
 *           option `c5f4f68e` own intervention: still 60000, UNCHANGED
 *           reply: "Updated Vendor Licensing Cost"
 *           `graph_hash` a0b39d86 → 84013c95 — IT COMMITTED
 *
 * So an option-scoped request MINTED a model-wide value and left the option
 * alone. Contrast control from the same battery: the pricing shape moved ZERO
 * baselines, so this is shape-specific rather than universal.
 *
 * ═══ WHY THE SHIPPED ARMS MISSED IT — executed, not reasoned ═══
 *   evaluateConfigureOptionOutcome -> { status: "not_applicable",
 *                                       reason: "not_configure_intent" }
 *   decideOptionInterventionWrite  -> { verdict: "allow",
 *                                       reason: "outcome_not_unhonoured" }
 * The option ANCHOR matches (the sentence contains "option"); what returns null
 * is `classifyConfigureOptionTrigger`, the effect/value vocabulary. The write
 * arm gated on `matched`, so it permitted the write.
 *
 * ⚠ The fixture below is the REAL pre-edit graph from that run, and the `after`
 * is that graph with the measured mutation applied. Historic capture: append,
 * never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): delete the
 * `decideUnresolvedOptionScope` call from `decideOptionInterventionWrite` and
 * the first test MUST go red. The three contrast tests must stay GREEN through
 * that deletion — they are what prove this is not "every baseline edit is now
 * forbidden".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { decideOptionInterventionWrite } from '../option-intervention-write-guard.js';

const CAPTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./buy-capture-a3b0548d.json', import.meta.url)), 'utf8'),
) as { nodes: Record<string, unknown>[] };

const VENDOR_FACTOR = '8f788330';
const BUY_OPTION = 'c5f4f68e';
const MSG =
  'Change the buy option so the vendor cost is £150,000 per year instead of £120,000. ' +
  'Keep everything else the same.';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The graph as the wire actually returned it: the baseline minted, option untouched. */
function afterBaselineMinted(): unknown {
  const g = clone(CAPTURE);
  for (const n of g.nodes) {
    if (n.id === VENDOR_FACTOR) {
      n.observed_state = { value: 1.5, unit: '£', source: 'user_override', raw_value: 150000 };
    }
  }
  return g;
}

describe('an option-anchored turn with no resolved identity asks instead of writing', () => {
  it('PRECONDITION — the capture really is the buy graph, and the option is wired to the factor', () => {
    // Pinned in-test (trap 13b): if the fixture stopped carrying these, every
    // assertion below would be about a graph that cannot reproduce the defect.
    const option = CAPTURE.nodes.find((n) => n.id === BUY_OPTION);
    expect(option).toBeDefined();
    expect((option as { interventions: Record<string, unknown> }).interventions)
      .toHaveProperty(VENDOR_FACTOR);
    const factor = CAPTURE.nodes.find((n) => n.id === VENDOR_FACTOR);
    expect(factor).toBeDefined();
    // The baseline is genuinely absent BEFORE — the defect MINTS it.
    expect((factor as { observed_state?: unknown }).observed_state ?? null).toBeNull();
  });

  it('THE CLAIM: the measured buy turn is withheld as scope_unresolved', () => {
    const verdict = decideOptionInterventionWrite({
      message: MSG,
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('scope_unresolved');
    if (verdict.verdict !== 'scope_unresolved') throw new Error('narrowing');
    expect(verdict.baselineNodeIds).toContain(VENDOR_FACTOR);
    // The ask needs something to offer.
    expect(verdict.optionLabels.length).toBeGreaterThan(1);
    expect(verdict.optionLabels).toContain('Buy Off-the-Shelf Reporting Tool');
  });

  it('CONTRAST 1: an EXPLICIT model-wide edit still lands — no option anchor', () => {
    // The whole point of anchoring on the message rather than on the write.
    const verdict = decideOptionInterventionWrite({
      message: 'Set Vendor Licensing Cost to £150,000 per year.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('CONTRAST 2: an option-anchored turn that LANDED an intervention still lands', () => {
    // A compound edit that partly did what was asked must not be discarded —
    // the measured false positive the identity-binding note warns about.
    const after = clone(CAPTURE);
    for (const n of after.nodes) {
      if (n.id === VENDOR_FACTOR) {
        n.observed_state = { value: 1.5, unit: '£', source: 'user_override', raw_value: 150000 };
      }
      if (n.id === BUY_OPTION) {
        const iv = (n as { interventions: Record<string, Record<string, unknown>> }).interventions;
        iv[VENDOR_FACTOR] = { ...iv[VENDOR_FACTOR], value: 1.5, raw_value: 150000 };
      }
    }
    const verdict = decideOptionInterventionWrite({
      message: MSG, before: CAPTURE, after, appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('CONTRAST 3: an option-anchored turn that moved NO baseline is untouched', () => {
    const verdict = decideOptionInterventionWrite({
      message: MSG, before: CAPTURE, after: clone(CAPTURE), appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });
});
