/**
 * Shared Data row 1 — AIQ's ruling on CEE #2273 (#72 5882852814): a chat write that leaves the stored value unchanged
 * is AUTHORSHIP when the user's own words this turn state that figure for that factor ("set customer churn to 4%"),
 * and REVIEW when they do not ("yes, keep it"). One predicate — `figureTheUserWroteFor` under the add-factor/revise
 * door's `newFactorScopeIn` (#2269) — read by both chat node writers: `set_factor_value` and `edit_graph`'s stamp.
 * Mutant (run by hand): drop the typed-figure check (channel-only review) → the authorship rows go RED.
 */
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { stampUserEditProvenance } from '../../../../orchestrator/canonicalise-value-ops.js';
import { userTypedStoredFigure } from '../../../agent-lane/figure-scope.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

type Os = { source?: string; value?: number; reviewed_by_user?: { intent?: string } };

function olumisChurn(): GraphV3T {
  const g = buildD1Fixture();
  const churn = g.nodes.find((n) => n.id === 'f-churn')!;
  (churn.observed_state as Os).source = 'cee_inference';
  return g;
}

const sameValue: ProposalAction = {
  handler_id: 'set_factor_value',
  entity: { id: 'f-churn', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
  parameters: [{ name: 'value', value: { value: 4, unit: '%', cap: 100 }, operator: 'set', source: 'user_explicit' }],
  cited_context_fields: [],
} as ProposalAction;

const churnOf = (g: unknown): Os => ((g as GraphV3T).nodes.find((n) => n.id === 'f-churn')!.observed_state ?? {}) as Os;
const setFactorValue = createSetFactorValueHandler();

describe('chat set_factor_value — the same number is the user\'s when their words state it', () => {
  it('RED: "set customer churn to 4%" on Olumi\'s 4% is AUTHORSHIP — user_override, and the analysis hash MOVES', async () => {
    const base = olumisChurn();
    const out = await setFactorValue(buildHandlerInvocation({ graph: base, proposal: sameValue, message: 'set customer churn to 4%' } as never));
    expect(churnOf(out.mutated_graph).source).toBe('user_override');
    expect(churnOf(out.mutated_graph).reviewed_by_user).toBeUndefined();
    expect(computeAnalysisAffectingGraphHash(out.mutated_graph as GraphV3T)).not.toBe(computeAnalysisAffectingGraphHash(base));
  });

  it('CONTROL: "yes, keep it" (no figure in the user\'s words) is REVIEW — source kept, hash IDENTICAL', async () => {
    const base = olumisChurn();
    const out = await setFactorValue(buildHandlerInvocation({ graph: base, proposal: sameValue, message: 'yes, keep it' } as never));
    expect(churnOf(out.mutated_graph).source).toBe('cee_inference');
    expect(churnOf(out.mutated_graph).reviewed_by_user?.intent).toBe('confirm');
    expect(computeAnalysisAffectingGraphHash(out.mutated_graph as GraphV3T)).toBe(computeAnalysisAffectingGraphHash(base));
  });

  it('CONTROL: a figure written about ANOTHER quantity is not this factor\'s ("our marketing budget is 4%")', () => {
    expect(userTypedStoredFigure(olumisChurn(), 'f-churn', { value: 0.04, raw_value: 4, unit: '%' }, 'our marketing budget is 4%')).toBe(false);
    expect(userTypedStoredFigure(olumisChurn(), 'f-churn', { value: 0.04, raw_value: 4, unit: '%' }, 'our customer churn is 4%')).toBe(true);
  });
});

describe('edit_graph stamp — the same rule', () => {
  const op = () => ({ op: 'update_node', path: 'f-churn', value: { observed_state: { value: 0.04, raw_value: 4, unit: '%', cap: 100, source: 'cee_inference' } } }) as never;

  it('RED: a restatement the user typed is stamped as theirs', () => {
    const g = olumisChurn();
    const [out] = stampUserEditProvenance([op()], [op()], g, (id, o) => userTypedStoredFigure(g, id, o, 'our customer churn is 4%')) as Array<{ value: { observed_state: Os } }>;
    expect(out!.value.observed_state.source).toBe('user_override');
    expect(out!.value.observed_state.reviewed_by_user).toBeUndefined();
  });

  it('CONTROL: a restatement the user did not type is review', () => {
    const g = olumisChurn();
    const [out] = stampUserEditProvenance([op()], [op()], g, (id, o) => userTypedStoredFigure(g, id, o, 'looks right')) as Array<{ value: { observed_state: Os } }>;
    expect(out!.value.observed_state.source).toBe('cee_inference');
    expect(out!.value.observed_state.reviewed_by_user?.intent).toBe('confirm');
  });
});
