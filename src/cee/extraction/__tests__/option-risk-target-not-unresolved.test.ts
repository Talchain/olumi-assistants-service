/**
 * ⭐⭐ AN OPTION→RISK EDGE IS A CAUSAL CLAIM, NOT AN INTERVENTION TARGET.
 *
 * MEASURED on deployed staging (3 draft runs, 2 briefs, 11 options, predicate
 * agreeing 11/11): every `unresolved_targets` entry was a `kind: "risk"` node,
 * and ONE such entry blocks the whole option — `computeAnalysisReadyStatusWithReason`
 * returns `needs_user_mapping` on its first line when `unresolvedTargetCount > 0`.
 * On one run that blocked ALL FOUR options: nothing was analysable at all, which
 * is the failure the user reported.
 *
 * The question it produced has no answerable form — "How does Two Developers
 * change Coordination Overhead Risk?" — for the same reason the held-baseline ask
 * did not (`transforms/option-status.ts`, 2026-09-18 ruling): a risk is a
 * CONSEQUENCE, not a lever anyone sets.
 *
 * ⚠ And the reason it survived: the old log line said the target was a
 * "non-existent factor". The node exists — it is a risk. A warning that
 * misdescribes its own condition is one nobody can act on.
 */
import { describe, expect, it } from 'vitest';
import { extractInterventionsForOption } from '../intervention-extractor.js';
import type { EdgeV3T, NodeV3T } from '../../../schemas/cee-v3.js';

const FACTOR = 'fac_capacity';
const RISK = 'risk_coordination';
const GOAL = 'goal_velocity';

const nodes = [
  { id: GOAL, kind: 'goal', label: 'Delivery velocity' },
  { id: FACTOR, kind: 'factor', label: 'Team Technical Capability' },
  { id: RISK, kind: 'risk', label: 'Coordination Overhead Risk' },
  { id: 'opt_two_devs', kind: 'option', label: 'Two Developers' },
] as unknown as NodeV3T[];

const edges = [
  { from: FACTOR, to: GOAL, strength: 0.6 },
  { from: 'opt_two_devs', to: FACTOR, strength: 0.5 },
  { from: 'opt_two_devs', to: RISK, strength: 0.4 },
] as unknown as EdgeV3T[];

const extract = (v4: Record<string, number>) =>
  extractInterventionsForOption(
    'Two Developers', undefined, nodes, edges, GOAL,
    new Set(), [], v4, 'opt_two_devs',
  );

describe('a RISK target does not block the option', () => {
  const out = extract({ [FACTOR]: 0.6, [RISK]: 0.4 });

  it('keeps the factor intervention', () => {
    expect(Object.keys(out.interventions)).toEqual([FACTOR]);
  });

  it('does NOT put the risk in unresolved_targets — one entry would block the option', () => {
    expect(out.unresolved_targets ?? []).not.toContain(RISK);
    expect(out.unresolved_targets).toBeUndefined();
  });

  it('records the risk separately, so nothing is dropped silently', () => {
    expect(out.non_factor_targets).toEqual([RISK]);
  });

  it('is ready — the option says what it does', () => {
    expect(out.status).toBe('ready');
  });
});

describe('a target that is genuinely NOT in the model still blocks', () => {
  // The behaviour that must NOT change: an id nobody can resolve is a real
  // unresolved target and the user does need to be asked about it.
  const out = extract({ [FACTOR]: 0.6, fac_does_not_exist: 0.3 });

  it('keeps it in unresolved_targets', () => {
    expect(out.unresolved_targets).toEqual(['fac_does_not_exist']);
  });

  it('does not misfile it as a non-factor target', () => {
    expect(out.non_factor_targets ?? []).not.toContain('fac_does_not_exist');
  });
});

describe('an option whose ONLY stated effect is a risk', () => {
  // Correct outcome, by a correct route: with no factor intervention we genuinely
  // do not know which factor it sets, so the ask is legitimate — but it must not
  // arrive as "unresolved target", which claims the risk itself needs mapping.
  const out = extract({ [RISK]: 0.4 });

  it('has no interventions', () => {
    expect(Object.keys(out.interventions)).toEqual([]);
  });

  it('is not ready, and not because of a bogus unresolved target', () => {
    expect(out.status).toBe('needs_user_mapping');
    expect(out.unresolved_targets).toBeUndefined();
    expect(out.non_factor_targets).toEqual([RISK]);
  });
});

describe('an OUTCOME target behaves like a risk, not like a missing factor', () => {
  const withOutcome = [
    ...nodes,
    { id: 'out_mrr', kind: 'outcome', label: 'Monthly revenue' } as unknown as NodeV3T,
  ];
  it('is reported, not blocking', () => {
    const out = extractInterventionsForOption(
      'Two Developers', undefined, withOutcome, edges, GOAL,
      new Set(), [], { [FACTOR]: 0.6, out_mrr: 0.2 }, 'opt_two_devs',
    );
    expect(out.unresolved_targets).toBeUndefined();
    expect(out.non_factor_targets).toEqual(['out_mrr']);
    expect(out.status).toBe('ready');
  });
});

describe("⭐ the measured scenario: two options, each wired to the same risk", () => {
  it('both become ready instead of both being blocked', () => {
    for (const label of ['Two Developers', 'Hire a Tech Lead']) {
      const out = extractInterventionsForOption(
        label, undefined, nodes, edges, GOAL, new Set(), [],
        { [FACTOR]: 0.6, [RISK]: 0.4 }, 'opt_two_devs',
      );
      expect(out.status, `${label} must not be blocked by a risk target`).toBe('ready');
      expect(out.unresolved_targets, label).toBeUndefined();
    }
  });
});
