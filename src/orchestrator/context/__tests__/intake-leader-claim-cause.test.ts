/**
 * The INTAKE cause of a withheld leader (Canvas #72 5886223069; AIQ 5886352788): on 4/4 served limit runs the leader was
 * withheld by the intake axis while every limit was `scored`, and the typed reason said `constraint_verdict_withheld`,
 * so the limit card told the user their limit check declined. `intakeLeaderClaimCause` names the real cause, read off
 * the SAME fact on the graph the run analysed and the stored brief. Every "no" keeps today's code.
 */
import { describe, expect, it } from 'vitest';

import { MAY_NAME_LEADING_OPTION } from '../constraint-feasibility.js';
import { deriveIntakeOptionReconciliation, intakeLeaderClaimCause } from '../intake-option-reconciliation.js';

type Rec = Record<string, any>;
const BRIEF = 'Monthly churn must stay at or below 4%. The options are: raise the Pro price to £59, or keep it at £49.';
const HASH = 'a'.repeat(64);

/** The served shape: Olumi's option nodes carry no source binding to the brief (plus an option Olumi added). */
function graph(): Rec {
  return {
    options: [],
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'raise_59', kind: 'option', label: 'Raise to £59' },
      { id: 'keep_49', kind: 'option', label: 'Keep £49' },
      { id: 'moderate_54', kind: 'option', label: 'Moderate rise to £54' },
    ],
    edges: [],
  };
}

function fact(over: { permitted?: boolean; state?: string; hash?: string; compared?: string[] } = {}): Rec {
  return {
    graph_hash_at_run: over.hash ?? HASH,
    leading_option_id: 'raise_59',
    constraint_verdict: {
      may_name_leading_option: over.permitted ?? false,
      constraint_verdict_state: over.state ?? 'evaluated_feasible',
      per_limit: [{ constraint_id: 'agent-lane:monthly_churn:<=', state: 'scored' }],
      joint: { state: 'scored' },
    },
    enrichment: { option_comparison: (over.compared ?? ['raise_59', 'keep_49', 'moderate_54']).map((option_id) => ({ option_id })) },
  };
}

const cause = (result: Rec, g: Rec = graph(), graphHash: string | null = HASH, briefText: string | null = BRIEF) =>
  intakeLeaderClaimCause({ graph: g, graphHash, result, briefText });

describe('intakeLeaderClaimCause — the intake axis named, only when the fact proves it', () => {
  it('PRECONDITIONS: the fixture state permits a leader, and the Run-time intake answer on these options withholds', () => {
    expect(MAY_NAME_LEADING_OPTION.evaluated_feasible).toBe(true);
    const options = graph().nodes.filter((n: Rec) => n.kind === 'option');
    expect(deriveIntakeOptionReconciliation(BRIEF, options, graph()).mayNameLeadingOption).toBe(false);
  });

  it('RED: Canvas\'s served shape — permission false, the constraint state PERMITS, limits scored → the intake cause', () => {
    expect(cause(fact())).toBe(true);
  });

  it('CONTROL: the constraint verdict itself withholds → no intake cause (`constraint_verdict_withheld` stands)', () => {
    expect(cause(fact({ state: 'unevaluated' }))).toBe(false);
  });

  it('CONTROL: the permission is not false → no cause', () => {
    expect(cause(fact({ permitted: true }))).toBe(false);
  });

  it('CONTROL: the graph is not the one the run analysed (edited since) → no cause', () => {
    expect(cause(fact(), graph(), 'b'.repeat(64))).toBe(false);
  });

  it('CONTROL: no stored brief to re-derive from → no cause', () => {
    expect(cause(fact(), graph(), HASH, null)).toBe(false);
  });

  it('CONTROL: an analysed option is missing from this graph → unknown, no cause', () => {
    expect(cause(fact({ compared: ['raise_59', 'keep_49', 'gone'] }))).toBe(false);
  });

  it('CONTROL: the brief enumerates no options (intake not applicable) → no cause', () => {
    expect(cause(fact(), graph(), HASH, 'How should we price the Pro plan?')).toBe(false);
  });
});
