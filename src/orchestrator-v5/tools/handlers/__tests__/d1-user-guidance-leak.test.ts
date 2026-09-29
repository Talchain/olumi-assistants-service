/**
 * V5 alpha hardening — D1 user-guidance leak panel.
 *
 * P1.1 follow-up. Drives each D1 mutation handler with real failing
 * inputs that trigger every recoverable cause-kind, captures the
 * `userGuidance` (surfaced as `details.specific_issue` after the D1
 * error boundary translation), and asserts no leak of:
 *
 *   - handler IDs (`add_constraint`, `set_factor_value`, `adjust_edge_strength`)
 *   - quoted parameter names (`"value"`, `"constraint_type"`,
 *     `"strength"`, `"std"`, `"unit"`, `"label"`)
 *   - enum literals (`at_least`, `at_most`, `>=`, `<=`)
 *   - cause-kind / D1ErrorCode strings (`PARAMETER_INVALID`,
 *     `parameter_invalid_at_execute`, etc.)
 *   - other internal field names (`handler_id`, `cause_kind`,
 *     `graph_invariant_violated`)
 *
 * Distinct from synthetic-string composer tests: this file invokes the
 * real handlers with real proposals so the panel reflects what
 * production code actually emits, not what a test author imagines it
 * emits.
 *
 * Cancelled scope: this test does NOT assert the canonical phrases'
 * exact wording (those are pinned by `compose/__tests__/recoverable-handler-response.test.ts`
 * and the per-handler regression tests). Here we assert *absence* of
 * leakage tokens — a single regex panel.
 */

import { describe, expect, it } from 'vitest';

import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import {
  ADD_CONSTRAINT_USER_GUIDANCE,
  ADJUST_EDGE_STRENGTH_USER_GUIDANCE,
  SET_FACTOR_VALUE_USER_GUIDANCE,
} from '../d1-shared/user-guidance.js';
import type { ProposalAction } from '../../../routing/types.js';

// Forbidden substrings, case-insensitive. Anchored generously to catch
// quoted-or-unquoted variants. Each entry is a literal substring; the
// match runs against the lowercased issue text.
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  // Handler IDs
  'add_constraint',
  'set_factor_value',
  'adjust_edge_strength',
  // Quoted parameter names (without quotes — substring match catches both)
  'constraint_type',
  // 'value' is too generic for a substring match (the canonical
  // SET_FACTOR_VALUE_USER_GUIDANCE legitimately contains "that value")
  // — assert via the quoted form below instead.
  '"value"',
  '"strength"',
  '"std"',
  '"label"',
  '"unit"',
  // Enum literals
  'at_least',
  'at_most',
  // Operator literals (these would only appear in leaked debug strings)
  ' >= ',
  ' <= ',
  // Cause-kind / D1ErrorCode strings
  'parameter_invalid_at_execute',
  'entity_not_found_in_graph',
  'entity_kind_mismatch_at_execute',
  'precondition_unmet_at_execute',
  'graph_invariant_violated',
  'parameter_invalid',
  'entity_not_found',
  'entity_kind_mismatch',
  'precondition_unmet',
  // Internal field names
  'cause_kind',
  'handler_id',
  'd1_code',
  'specific_issue',
];

/**
 * Drive the handler with the given proposal/graph and capture the
 * user-facing `specific_issue` from the resulting
 * `HandlerInvocationFailedError`. Throws if the handler unexpectedly
 * succeeds.
 */
async function captureSpecificIssue(args: {
  readonly handler: (i: ReturnType<typeof buildHandlerInvocation>) => Promise<unknown>;
  readonly proposal: ProposalAction;
  readonly graph?: unknown;
}): Promise<string> {
  try {
    await args.handler(
      buildHandlerInvocation({ proposal: args.proposal, graph: args.graph }),
    );
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) {
      const issue = err.details['specific_issue'];
      if (typeof issue === 'string' && issue.length > 0) return issue;
      // No userGuidance set on the throw → recoverable composer would
      // fall back to its hardcoded per-cause copy. Return a sentinel
      // so the test fails loudly with a useful message.
      throw new Error(
        `D1 throw missing userGuidance; cause_kind=${String(err.cause_kind)}, message=${String(err.message)}`,
      );
    }
    throw err;
  }
  throw new Error('expected handler to throw, but it returned successfully');
}

function assertNoLeakage(label: string, issue: string): void {
  const lower = issue.toLowerCase();
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    expect(
      lower.includes(forbidden.toLowerCase()),
      `${label}: user-facing issue must not contain "${forbidden}" — got: ${issue}`,
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// add_constraint — exercise every recoverable D1 throw
// ---------------------------------------------------------------------------

describe('add_constraint — userGuidance leak panel', () => {
  const handler = createAddConstraintHandler();
  const graph = buildD1Fixture();

  function proposal(overrides: Partial<ProposalAction> = {}): ProposalAction {
    return {
      handler_id: 'add_constraint',
      entity: {
        id: 'g-revenue',
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 100, source: 'user_explicit' },
      ],
      cited_context_fields: [],
      ...overrides,
    } as ProposalAction;
  }

  it('PARAMETER_INVALID — missing constraint_type', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({ parameters: [{ name: 'value', value: 1, source: 'user_explicit' }] }),
      graph,
    });
    expect(issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    assertNoLeakage('add_constraint:missing-constraint_type', issue);
  });

  it('PARAMETER_INVALID — invalid constraint_type', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [
          { name: 'constraint_type', value: 'between', source: 'user_explicit' },
          { name: 'value', value: 1, source: 'user_explicit' },
        ],
      }),
      graph,
    });
    expect(issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    assertNoLeakage('add_constraint:invalid-constraint_type', issue);
  });

  it('PARAMETER_INVALID — missing value', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [{ name: 'constraint_type', value: 'at_least', source: 'user_explicit' }],
      }),
      graph,
    });
    expect(issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    assertNoLeakage('add_constraint:missing-value', issue);
  });

  it('PARAMETER_INVALID — non-numeric value', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [
          { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
          { name: 'value', value: 'lots', source: 'user_explicit' },
        ],
      }),
      graph,
    });
    expect(issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    assertNoLeakage('add_constraint:non-numeric-value', issue);
  });

  it('ENTITY_NOT_FOUND — unknown target id', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        entity: {
          id: 'g-does-not-exist',
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph,
    });
    expect(issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    assertNoLeakage('add_constraint:entity-not-found', issue);
  });

  it('PRECONDITION_UNMET — missing graph', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal(),
      graph: null,
    });
    expect(issue).toBe(ADD_CONSTRAINT_USER_GUIDANCE);
    assertNoLeakage('add_constraint:precondition-unmet', issue);
  });
});

// ---------------------------------------------------------------------------
// set_factor_value — exercise every recoverable D1 throw
// ---------------------------------------------------------------------------

describe('set_factor_value — userGuidance leak panel', () => {
  const handler = createSetFactorValueHandler();
  const graph = buildD1Fixture();

  function proposal(overrides: Partial<ProposalAction> = {}): ProposalAction {
    return {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-churn',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value: { value: 5, unit: '%' }, source: 'user_explicit' }],
      cited_context_fields: [],
      ...overrides,
    } as ProposalAction;
  }

  it('ENTITY_NOT_FOUND — unknown factor id', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        entity: {
          id: 'f-does-not-exist',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph,
    });
    expect(issue).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
    assertNoLeakage('set_factor_value:entity-not-found', issue);
  });

  it('ENTITY_KIND_MISMATCH — non-factor target', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        entity: {
          id: 'g-revenue',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph,
    });
    expect(issue).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
    assertNoLeakage('set_factor_value:kind-mismatch', issue);
  });

  it('PARAMETER_INVALID — missing value parameter', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({ parameters: [] }),
      graph,
    });
    expect(issue).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
    assertNoLeakage('set_factor_value:missing-value', issue);
  });

  it('PARAMETER_INVALID — value above cap (via normaliseFactorValue)', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [
          { name: 'value', value: { value: 150, unit: '%' }, source: 'user_explicit' },
        ],
      }),
      graph,
    });
    expect(issue).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
    assertNoLeakage('set_factor_value:cap-exceeded', issue);
  });

  it('PARAMETER_INVALID — bare-number ambiguous value', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [{ name: 'value', value: 5000, source: 'user_explicit' }],
      }),
      graph,
    });
    expect(issue).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
    assertNoLeakage('set_factor_value:ambiguous-bare-number', issue);
  });

  it('PRECONDITION_UNMET — missing graph', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal(),
      graph: null,
    });
    expect(issue).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
    assertNoLeakage('set_factor_value:precondition-unmet', issue);
  });
});

// ---------------------------------------------------------------------------
// adjust_edge_strength — exercise every recoverable D1 throw
// ---------------------------------------------------------------------------

describe('adjust_edge_strength — userGuidance leak panel', () => {
  const handler = createAdjustEdgeStrengthHandler();
  const graph = buildD1Fixture();

  function proposal(overrides: Partial<ProposalAction> = {}): ProposalAction {
    return {
      handler_id: 'adjust_edge_strength',
      entity: {
        id: 'f-budget→g-revenue',
        kind: 'edge',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'strength', value: 0.6, source: 'user_explicit' }],
      cited_context_fields: [],
      ...overrides,
    } as ProposalAction;
  }

  it('PARAMETER_INVALID — malformed edge id', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        entity: {
          id: 'malformed-no-arrow',
          kind: 'edge',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph,
    });
    expect(issue).toBe(ADJUST_EDGE_STRENGTH_USER_GUIDANCE);
    assertNoLeakage('adjust_edge_strength:malformed-edge-id', issue);
  });

  it('ENTITY_NOT_FOUND — unknown edge', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        entity: {
          id: 'f-quality→f-budget',
          kind: 'edge',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
      }),
      graph,
    });
    expect(issue).toBe(ADJUST_EDGE_STRENGTH_USER_GUIDANCE);
    assertNoLeakage('adjust_edge_strength:edge-not-found', issue);
  });

  it('PARAMETER_INVALID — missing strength', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({ parameters: [] }),
      graph,
    });
    expect(issue).toBe(ADJUST_EDGE_STRENGTH_USER_GUIDANCE);
    assertNoLeakage('adjust_edge_strength:missing-strength', issue);
  });

  it('PARAMETER_INVALID — strength out of [-1, 1]', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [{ name: 'strength', value: 5, source: 'user_explicit' }],
      }),
      graph,
    });
    expect(issue).toBe(ADJUST_EDGE_STRENGTH_USER_GUIDANCE);
    assertNoLeakage('adjust_edge_strength:strength-out-of-range', issue);
  });

  it('PARAMETER_INVALID — std out of [0, 0.5]', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal({
        parameters: [
          { name: 'strength', value: 0.5, source: 'user_explicit' },
          { name: 'std', value: 0.9, source: 'user_explicit' },
        ],
      }),
      graph,
    });
    expect(issue).toBe(ADJUST_EDGE_STRENGTH_USER_GUIDANCE);
    assertNoLeakage('adjust_edge_strength:std-out-of-range', issue);
  });

  it('PRECONDITION_UNMET — missing graph', async () => {
    const issue = await captureSpecificIssue({
      handler,
      proposal: proposal(),
      graph: null,
    });
    expect(issue).toBe(ADJUST_EDGE_STRENGTH_USER_GUIDANCE);
    assertNoLeakage('adjust_edge_strength:precondition-unmet', issue);
  });
});

// ---------------------------------------------------------------------------
// Canonical phrase invariants — guard against future drift
// ---------------------------------------------------------------------------

describe('canonical user-guidance phrases — leak invariants', () => {
  it('canonical phrases themselves contain no forbidden tokens', () => {
    for (const [label, phrase] of [
      ['ADD_CONSTRAINT_USER_GUIDANCE', ADD_CONSTRAINT_USER_GUIDANCE],
      ['SET_FACTOR_VALUE_USER_GUIDANCE', SET_FACTOR_VALUE_USER_GUIDANCE],
      ['ADJUST_EDGE_STRENGTH_USER_GUIDANCE', ADJUST_EDGE_STRENGTH_USER_GUIDANCE],
    ] as const) {
      assertNoLeakage(label, phrase);
    }
  });
});
