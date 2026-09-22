/**
 * A unit string the estate's reader does not recognise silently disables an
 * invariant. Measured across two real producer configurations.
 *
 * `configB.json` is the verbatim output of W3 configuration B — ONE model
 * (`gpt-5.6-terra`, effort high) producing the whole candidate in a single pass,
 * captured live on 22 Sep. `faithful.json` + `widened.json` are configuration A
 * (gpt-4.1 builder then terra widener).
 *
 * ⭐ THE FINDING. Both configurations state the same fact — the Pro price is 49 —
 * but A writes the unit `"£"` and B writes `"GBP per month"`. `readUnit` in
 * `money-invariant.ts` recognises the first as currency and not the second, so
 * B's figure never reaches the reconciliation at all. The model looks identical
 * in the graph; one is audited and one is not.
 *
 * This is only visible with a DISAGREEING brief. Against an agreeing brief both
 * return zero findings — and "zero" there means "reconciled" for A and "never
 * checked" for B. Reading the agreeing case alone would have scored them equal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { detectUnreconciledStatedMagnitudes } from '../../../cee/provenance/money-invariant.js';

const d = new URL('./fixtures/', import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, d), 'utf8'));
const CONFIG_A = () => admitCandidateModel(load('faithful.json') as CandidateModel, load('widened.json'));
const CONFIG_B = () => admitCandidateModel(load('configB.json') as CandidateModel, {});

const AGREES = 'We charge £49 a month for the Pro plan, keeping monthly churn under 4%.';
const DISAGREES = 'We charge £79 a month for the Pro plan, keeping monthly churn under 4%.';

const findings = (m: ReturnType<typeof admitCandidateModel>, briefText: string) => {
  const nodes = m.nodes
    .filter((n) => n.observed_state !== undefined)
    .map((n) => ({ ...n, observed_state: { ...(n.observed_state as Record<string, unknown>), cap: 100 } }));
  return detectUnreconciledStatedMagnitudes({ nodes: nodes as never, options: [], briefText });
};

describe('unit vocabulary decides whether the money audit runs', () => {
  it('both configurations state the same price, with different units', () => {
    const a = CONFIG_A().nodes.find((n) => n.observed_state !== undefined);
    const b = CONFIG_B().nodes.find((n) => n.observed_state !== undefined);
    expect(a!.observed_state!.value).toBe(49);
    expect(b!.observed_state!.value).toBe(49);
    expect(a!.observed_state!.unit).toBe('£');
    expect(b!.observed_state!.unit).toBe('GBP per month');
  });

  it("config A's unit IS read as currency — fires on mismatch, silent when reconciled", () => {
    expect(findings(CONFIG_A(), DISAGREES)).toHaveLength(1);
    expect(findings(CONFIG_A(), AGREES)).toHaveLength(0);
  });

  it("config B's unit is NOT read as currency — the figure escapes the audit", () => {
    // The discriminator: a working gate MUST fire on a brief that disagrees.
    expect(
      findings(CONFIG_B(), DISAGREES),
      'if this ever becomes non-empty the unit reader has learned this spelling — good, update the note',
    ).toHaveLength(0);
  });

  it('the agreeing brief CANNOT tell them apart — why the control is necessary', () => {
    expect(findings(CONFIG_A(), AGREES)).toHaveLength(0);
    expect(findings(CONFIG_B(), AGREES)).toHaveLength(0);
  });
});
