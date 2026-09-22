/**
 * Does the estate's money invariant actually SEE what this lane admits?
 *
 * Executed against the real detector, not reasoned about. The answer is "not
 * yet, and here is exactly why" — which is worth pinning, because the corrected
 * authorship stamp is necessary but NOT sufficient.
 *
 * `detectUnreconciledStatedMagnitudes` has two independent gates
 * (`src/cee/provenance/money-invariant.ts`):
 *   :211  `observed.source !== 'brief_extraction'` -> skip
 *   :234  `cap` absent / non-finite / <= 0        -> skip
 *
 * This lane now satisfies the first. It does NOT set `cap`, and it must not
 * invent one — `cap` feeds `isAmountStatedInBrief` and a wrong cap would produce
 * a confidently wrong reconciliation. So the figure remains unaudited, and that
 * is recorded here rather than left to be discovered later.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { detectUnreconciledStatedMagnitudes } from '../../../cee/provenance/money-invariant.js';

const d = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel;
const widened = JSON.parse(readFileSync(new URL('widened.json', d), 'utf8'));

const BRIEF_AGREES = 'We charge £49 a month for the Pro plan, keeping monthly churn under 4%.';
const BRIEF_DISAGREES = 'We charge £79 a month for the Pro plan, keeping monthly churn under 4%.';

const valuedNodes = () =>
  admitCandidateModel(faithful, widened).nodes.filter((n) => n.observed_state !== undefined);

const run = (nodes: unknown[], briefText: string) =>
  detectUnreconciledStatedMagnitudes({ nodes: nodes as never, options: [], briefText });

describe('money invariant reach', () => {
  it('the lane satisfies the gate the invariant ACTUALLY reads', () => {
    const nodes = valuedNodes();
    expect(nodes).toHaveLength(1);
    // Two different claims, and both are needed.
    expect(nodes[0].provenance, 'node display vocabulary').toBe('from_brief');
    expect(
      (nodes[0].observed_state as Record<string, unknown>).source,
      'where the VALUE came from - the field money-invariant.ts:211 gates on',
    ).toBe('brief_extraction');
  });

  it('LIMITATION, pinned: without `cap` the figure is still unaudited', () => {
    const nodes = valuedNodes();
    expect(nodes[0].observed_state).not.toHaveProperty('cap');
    // Even against a brief that plainly disagrees (£79 vs the model's £49).
    expect(run(nodes, BRIEF_DISAGREES)).toEqual([]);
  });

  it('PROOF the stamp is now right: add a cap and the invariant CATCHES the mismatch', () => {
    const nodes = valuedNodes().map((n) => ({
      ...n,
      observed_state: { ...(n.observed_state as Record<string, unknown>), cap: 100 },
    }));
    const found = run(nodes, BRIEF_DISAGREES);
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe('STATED_MAGNITUDE_UNRECONCILED');
    expect(found[0].affected_node_id).toBe('pro_plan_price');
    // CONTROL: against an agreeing brief it must stay silent, or it would be
    // firing on the stamp rather than on the reconciliation.
    expect(run(nodes, BRIEF_AGREES)).toEqual([]);
  });

  it('CONTROL: with the OLD observed_state stamp, a cap changes nothing', () => {
    const nodes = valuedNodes().map((n) => ({
      ...n,
      observed_state: { ...(n.observed_state as Record<string, unknown>), source: 'user_specified', cap: 100 },
    }));
    expect(run(nodes, BRIEF_DISAGREES)).toEqual([]);
  });
});
