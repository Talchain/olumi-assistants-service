/**
 * V5 — `edit-graph-fact-builder` unit tests (DL-7 PR B).
 *
 * Tests the projection of `EditGraphResult` (CEE V4 dispatch output) into
 * the canonical `EditGraphHandlerFact` (schemas-vendor 0.12.0 contract).
 * Covers:
 *
 *  - Happy path + rejected/noop/zero-ops emission gates.
 *  - `edit_kind` derivation (parameter / option_configuration / structural).
 *  - `affected_entities[].kind` derivation via post-edit graph lookup
 *    (canonical `NodeKind` values + `'edge'`).
 *  - `affected_entities` 8-cap.
 *  - `safe_summary` ≤80-char cap with ellipsis truncation.
 *  - `safe_summary` raw-ID scrub via `sanitiseUserFacingText`.
 *  - `safe_summary` Phase 2A jargon-guard (forbidden tokens fall back to
 *    the safe default).
 *  - `impact` derivation: highest from `operation_meta`; structural
 *    fallback to `'moderate'`; `'low'` only when explicit-low.
 *  - `rerun_recommended` pass-through from `appliedChanges.rerun_recommended`.
 *  - Cross-field invariants: `status='applied'` ⇒ `operations_count >= 1`;
 *    `noop=false` for successful applied mutations.
 *  - Schema validation at emission boundary
 *    (`EditGraphHandlerFactSchema.safeParse` runs internally).
 */

import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';
import type { EditGraphResult } from '../../../../src/orchestrator/tools/edit-graph.js';
import type { AppliedChanges } from '../../../../src/orchestrator/types.js';
import {
  buildEditGraphHandlerFact,
  buildGenericEditGraphHandlerFact,
  isSuccessfulAppliedMutation,
  SAFE_SUMMARY_FALLBACK,
  SAFE_SUMMARY_MAX_CHARS,
  AFFECTED_ENTITIES_MAX,
  GENERIC_SAFE_SUMMARY,
} from '../../../../src/orchestrator-v5/handlers/edit-graph-fact-builder.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'risk_churn', kind: 'risk', label: 'Customer churn' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

const APPLIED_CHANGES_PARAM_UPDATE: AppliedChanges = {
  summary: 'Renamed "Price" to "Price (revised)"',
  changes: [
    {
      label: 'Price',
      description: 'Renamed "Price" to "Price (revised)"',
      element_ref: 'fac_price',
    },
  ],
  rerun_recommended: false,
};

const SUCCESS_RESULT_PARAM_UPDATE: EditGraphResult = {
  blocks: [],
  assistantText: 'Renamed "Price" to "Price (revised)"',
  latencyMs: 100,
  appliedGraph: makeGraph(),
  wasRejected: false,
  appliedChanges: APPLIED_CHANGES_PARAM_UPDATE,
  operations: [
    {
      op: 'update_node',
      path: 'fac_price',
      value: { label: 'Price (revised)' },
    },
  ],
  operation_meta: [{ impact: 'low', rationale: 'Rename for clarity.' }],
};

// ============================================================================
// Group A — Emission gates (do NOT emit a fact for these cases)
// ============================================================================

describe('buildEditGraphHandlerFact — emission gates', () => {
  it('A1 returns null on rejected edit', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, wasRejected: true, appliedGraph: null },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('A2 returns null when appliedGraph is null', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, appliedGraph: null },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('A3 returns null when operations is empty (zero-ops edit)', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, operations: [] },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('A4 returns null when operations is undefined', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, operations: undefined },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('A5 returns null when appliedChanges is undefined', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, appliedChanges: undefined },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('A6 returns null when appliedChanges.summary is empty string', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, summary: '' },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });
});

// ============================================================================
// Group B — Happy path + schema validation
// ============================================================================

describe('buildEditGraphHandlerFact — happy path + schema validation', () => {
  it('B1 parameter-update produces a valid EditGraphHandlerFact', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).not.toBeNull();
    expect(fact!.fact_type).toBe('edit_graph');
    expect(fact!.fact_version).toBe(1);
    expect(fact!.noop).toBe(false);
    expect(fact!.result.status).toBe('applied');
    expect(fact!.result.operations_count).toBe(1);
    expect(fact!.result.edit_kind).toBe('parameter_update');
  });

  it('B2 the produced fact passes EditGraphHandlerFactSchema validation', async () => {
    const { EditGraphHandlerFactSchema } = await import('@talchain/schemas/orchestrator');
    const fact = buildEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).not.toBeNull();
    const r = EditGraphHandlerFactSchema.safeParse(fact);
    expect(r.success).toBe(true);
  });
});

// ============================================================================
// Group C — edit_kind derivation
// ============================================================================

describe('buildEditGraphHandlerFact — edit_kind derivation', () => {
  it('C1 update_node with non-label value → parameter_update', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'fac_price', value: { value: 0.7 } }],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.edit_kind).toBe('parameter_update');
  });

  it('C2 update_node touching an option node → option_configuration', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          {
            op: 'update_node',
            path: 'opt_a',
            value: { data: { interventions: [{ factor_id: 'fac_price', value: 0.5 }] } },
          },
        ],
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [{ label: 'Option A', description: 'Configured Option A.', element_ref: 'opt_a' }],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.edit_kind).toBe('option_configuration');
  });

  it('C3 add_node or remove_node → structural', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          {
            op: 'add_node',
            path: 'fac_new',
            value: { id: 'fac_new', kind: 'factor', label: 'New factor' },
          },
        ],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.edit_kind).toBe('structural');
  });

  it('C4 add_edge → structural', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          {
            op: 'add_edge',
            path: 'fac_price::goal_revenue',
            value: {
              from: 'fac_price',
              to: 'goal_revenue',
              strength: { mean: 0.5, std: 0.1 },
              exists_probability: 0.9,
              effect_direction: 'positive',
            },
          },
        ],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.edit_kind).toBe('structural');
  });
});

// ============================================================================
// Group D — affected_entities[].kind derivation (NodeKind + 'edge')
// ============================================================================

describe('buildEditGraphHandlerFact — affected_entities derivation', () => {
  it('D1 factor target → kind=factor', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].kind).toBe('factor');
    expect(fact!.result.affected_entities[0].label).toBe('Price');
  });

  it('D2 option target → kind=option', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'opt_a', value: { label: 'Option A v2' } }],
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [{ label: 'Option A', description: 'Renamed.', element_ref: 'opt_a' }],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].kind).toBe('option');
  });

  it('D3 risk-kind node target → kind=risk', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'risk_churn', value: { value: 0.1 } }],
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [{ label: 'Customer churn', description: 'Updated.', element_ref: 'risk_churn' }],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].kind).toBe('risk');
  });

  it('D4 edge target (path with ::) → kind=edge', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          {
            op: 'update_edge',
            path: 'fac_price::goal_revenue',
            value: { strength: { mean: 0.7, std: 0.1 } },
          },
        ],
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [
            {
              label: 'Price → Revenue',
              description: 'Strengthened edge.',
              element_ref: 'fac_price::goal_revenue',
            },
          ],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].kind).toBe('edge');
  });

  it('D5a raw-ID label is scrubbed at the fact boundary', () => {
    // Even though buildAppliedChanges upstream uses resolveElementLabel,
    // the fact builder defends-in-depth by scrubbing labels via
    // sanitiseUserFacingText. A label that arrives as the raw entity
    // ID (e.g. resolveElementLabel fell back to the path) gets
    // replaced with the resolved label or a generic fallback.
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [
            { label: 'fac_price', description: 'updated', element_ref: 'fac_price' },
          ],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].label).not.toBe('fac_price');
    // The resolved label or generic fallback must NOT contain the
    // raw ID pattern.
    expect(fact!.result.affected_entities[0].label).not.toMatch(/^fac_/);
  });

  it('D5b jargon-laden label falls back to generic', () => {
    // A label that contains a Phase 2A jargon token is unsafe to
    // surface verbatim; the fact builder swaps it for the generic
    // `'the relevant <kind>'` value.
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [
            { label: 'Repaired the legacy thing', description: 'updated', element_ref: 'fac_price' },
          ],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].label).toBe('the relevant factor');
  });

  it('D5c non-trivial sanitisation: identifier-like tokens within prose are scrubbed', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          changes: [
            {
              label: 'Updated fac_price node',
              description: 'updated',
              element_ref: 'fac_price',
            },
          ],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    // After sanitisation the label must NOT contain the raw ID pattern.
    expect(fact!.result.affected_entities[0].label).not.toContain('fac_price');
  });

  it('D5d post-substitution raw-id-shape: graph node whose label is itself raw-id-shaped triggers fallback', () => {
    // Defence-in-depth scenario: a node has `label: "fac_other"` —
    // raw-id-shaped, but technically a graph label. Without the
    // post-substitution gate, sanitiseUserFacingText could resolve
    // an entity-id substring to this label and surface raw-id-shaped
    // text into the fact. Post-substitution gate must reject and
    // fall back to the generic.
    const graphWithUnsafeLabel = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        // Label IS raw-id-shaped (`fac_other`).
        { id: 'fac_price', kind: 'factor', label: 'fac_other' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    } as unknown as GraphV3T;
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedGraph: graphWithUnsafeLabel,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          // Pass the raw id as label — sanitiser will resolveLabel
          // → returns the unsafe `fac_other` graph label verbatim.
          changes: [
            { label: 'fac_price', description: 'updated', element_ref: 'fac_price' },
          ],
        },
      },
      preEditGraph: graphWithUnsafeLabel,
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities[0].label).toBe('the relevant factor');
    // Critically, the unsafe graph label MUST NOT appear.
    expect(fact!.result.affected_entities[0].label).not.toContain('fac_other');
    expect(fact!.result.affected_entities[0].label).not.toMatch(/^fac_/);
  });

  it('D5 unresolvable label falls back to a generic display-safe value', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'fac_unknown', value: { value: 0.5 } }],
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          // appliedChanges.label is what gets used; if it's empty/blank
          // the builder must fall back to a generic display-safe label
          // rather than emitting an empty string (which would fail the
          // schema's .min(1)).
          changes: [{ label: '', description: 'Updated something.', element_ref: 'fac_unknown' }],
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).not.toBeNull();
    expect(fact!.result.affected_entities[0].label.length).toBeGreaterThan(0);
    // Generic fallback should NOT be the raw ID
    expect(fact!.result.affected_entities[0].label).not.toBe('fac_unknown');
  });

  it('D6 affected_entities capped at 8', () => {
    const ops = Array.from({ length: 12 }, (_, i) => ({
      op: 'update_node' as const,
      path: `fac_${i}`,
      value: { value: i },
    }));
    const changes = ops.map((_, i) => ({
      label: `Factor ${i}`,
      description: 'updated',
      element_ref: `fac_${i}`,
    }));
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: ops,
        operation_meta: ops.map(() => ({ impact: 'low' as const, rationale: '' })),
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, changes },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities.length).toBeLessThanOrEqual(AFFECTED_ENTITIES_MAX);
    expect(fact!.result.operations_count).toBe(12); // count is the truth, not the cap
  });
});

// ============================================================================
// Group E — safe_summary safety
// ============================================================================

describe('buildEditGraphHandlerFact — safe_summary safety', () => {
  it('E1 long summary truncated to ≤80 chars with ellipsis', () => {
    const longSummary = 'A'.repeat(200);
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, summary: longSummary },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.safe_summary.length).toBeLessThanOrEqual(SAFE_SUMMARY_MAX_CHARS);
    expect(fact!.result.safe_summary).toMatch(/…$/);
  });

  it('E2 boundary 80-char summary passes unchanged', () => {
    const eightyChars = 'A'.repeat(SAFE_SUMMARY_MAX_CHARS);
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, summary: eightyChars },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.safe_summary).toBe(eightyChars);
  });

  it('E3 raw entity-ID in summary is scrubbed', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          summary: 'Updated fac_price for the customer.',
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    // The scrubber should replace fac_price with the resolved label or generic fallback
    expect(fact!.result.safe_summary).not.toContain('fac_price');
  });

  it('E4 jargon-laden summary falls back to safe default', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          summary: 'Repaired the legacy envelope.',
        },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.safe_summary).toBe(SAFE_SUMMARY_FALLBACK);
  });

  it.each([
    'normalised the wrapped result',
    'gpt-4o response was repaired',
    'claude reformatted the wrapped output',
  ])('E5 jargon variant rejected: %s', (jargon) => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, summary: jargon },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.safe_summary).toBe(SAFE_SUMMARY_FALLBACK);
  });

  it('E5b post-substitution raw-id-shape: graph label resolved into summary triggers fallback', () => {
    // Defence-in-depth: a graph node has a raw-id-shaped label.
    // sanitiseUserFacingText resolves the entity-id substring in
    // the summary to that label verbatim, so the post-substitution
    // text still contains a confirmed raw-id shape. Without the
    // post-substitution gate the unsafe label would survive into
    // safe_summary; with it the builder falls back.
    const graphWithUnsafeLabel = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        // Unsafe: label is itself raw-id-shaped (slug-shape: 4+ char
        // first segment, multi-segment).
        { id: 'fac_price', kind: 'factor', label: 'fac_other_thing' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    } as unknown as GraphV3T;
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedGraph: graphWithUnsafeLabel,
        appliedChanges: {
          ...APPLIED_CHANGES_PARAM_UPDATE,
          summary: 'Updated fac_price for the customer.',
        },
      },
      preEditGraph: graphWithUnsafeLabel,
      hasExistingAnalysis: false,
    });
    expect(fact!.result.safe_summary).toBe(SAFE_SUMMARY_FALLBACK);
    // Critically, the unsafe label MUST NOT appear.
    expect(fact!.result.safe_summary).not.toContain('fac_other_thing');
    expect(fact!.result.safe_summary).not.toMatch(/\bfac_/);
  });

  it('E6 whitespace-only summary returns null (emission gate, NOT a fallback fact)', () => {
    // Fact emission requires a usable summary at the input boundary.
    // A whitespace-only summary indicates an upstream bug (the
    // emitter shouldn't have produced this) and is treated as a
    // missing fact, not as something to paper over with a fallback.
    // The fallback path covers post-sanitisation degenerate cases
    // (E4 jargon-guard, E5 jargon variants) where the upstream input
    // is real but unsafe to surface verbatim.
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, summary: '   ' },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });
});

// ============================================================================
// Group F — impact derivation
// ============================================================================

describe('buildEditGraphHandlerFact — impact derivation', () => {
  it('F1 highest of operation_meta impacts wins (high beats moderate beats low)', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          { op: 'update_node', path: 'fac_price', value: { value: 0.1 } },
          { op: 'update_node', path: 'fac_price', value: { value: 0.2 } },
          { op: 'update_node', path: 'fac_price', value: { value: 0.3 } },
        ],
        operation_meta: [
          { impact: 'low', rationale: '' },
          { impact: 'high', rationale: '' },
          { impact: 'moderate', rationale: '' },
        ],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.impact).toBe('high');
  });

  it('F2 all-low operation_meta → low (explicit-low is the trigger for low)', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'fac_price', value: { label: 'X' } }],
        operation_meta: [{ impact: 'low', rationale: 'Cosmetic.' }],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.impact).toBe('low');
  });

  it('F3 missing operation_meta + structural ops → moderate (NOT low)', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          {
            op: 'add_node',
            path: 'fac_new',
            value: { id: 'fac_new', kind: 'factor', label: 'New' },
          },
        ],
        operation_meta: undefined,
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.impact).toBe('moderate');
  });

  it('F4 missing operation_meta + non-structural (label-only update_node) → low fallback', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'fac_price', value: { label: 'New' } }],
        operation_meta: undefined,
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.impact).toBe('low');
  });
});

// ============================================================================
// Group G — cross-field invariants (emitter MUST guard)
// ============================================================================

describe('buildEditGraphHandlerFact — cross-field invariants', () => {
  it('G1 successful applied mutation has noop=false', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.noop).toBe(false);
    expect(fact!.result.status).toBe('applied');
  });

  it('G2 successful applied mutation has operations_count >= 1', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.operations_count).toBeGreaterThanOrEqual(1);
    expect(fact!.result.status).toBe('applied');
  });
});

// ============================================================================
// Group H — graph_hash + rerun_recommended pass-through
// ============================================================================

describe('buildEditGraphHandlerFact — graph_hash + rerun_recommended', () => {
  it('H1 graph_hash_before differs from graph_hash_after for applied mutations', () => {
    const preGraph = makeGraph();
    const postGraph = {
      ...preGraph,
      nodes: preGraph.nodes.map((n: any) =>
        n.id === 'fac_price' ? { ...n, label: 'Price (revised)' } : n,
      ),
    } as unknown as GraphV3T;
    const fact = buildEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, appliedGraph: postGraph },
      preEditGraph: preGraph,
      hasExistingAnalysis: false,
    });
    expect(fact!.result.graph_hash_before).not.toBeNull();
    expect(fact!.result.graph_hash_after).not.toBeNull();
    expect(fact!.result.graph_hash_before).not.toBe(fact!.result.graph_hash_after);
  });

  it('H2 rerun_recommended pass-through from appliedChanges', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, rerun_recommended: true },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: true,
    });
    expect(fact!.result.rerun_recommended).toBe(true);
  });
});

// ============================================================================
// Group I — isSuccessfulAppliedMutation predicate
// ============================================================================

describe('isSuccessfulAppliedMutation', () => {
  it('I1 returns true for a successful applied mutation', () => {
    expect(isSuccessfulAppliedMutation(SUCCESS_RESULT_PARAM_UPDATE)).toBe(true);
  });

  it('I2 returns false for rejected edit', () => {
    expect(
      isSuccessfulAppliedMutation({ ...SUCCESS_RESULT_PARAM_UPDATE, wasRejected: true }),
    ).toBe(false);
  });

  it('I3 returns false when appliedGraph is null', () => {
    expect(
      isSuccessfulAppliedMutation({ ...SUCCESS_RESULT_PARAM_UPDATE, appliedGraph: null }),
    ).toBe(false);
  });

  it('I4 returns false when operations is empty', () => {
    expect(
      isSuccessfulAppliedMutation({ ...SUCCESS_RESULT_PARAM_UPDATE, operations: [] }),
    ).toBe(false);
  });

  it('I5 returns true even when appliedChanges is absent (the rich path will fall back)', () => {
    // Key distinction: appliedChanges absent does NOT block emission
    // entirely — the dispatch falls back to the generic builder. So
    // isSuccessfulAppliedMutation is true for this case.
    expect(
      isSuccessfulAppliedMutation({ ...SUCCESS_RESULT_PARAM_UPDATE, appliedChanges: undefined }),
    ).toBe(true);
  });
});

// ============================================================================
// Group J — buildGenericEditGraphHandlerFact (war-room correction)
// ============================================================================

describe('buildGenericEditGraphHandlerFact — generic fallback path', () => {
  it('J1 produces a schema-valid fact with the generic safe summary', async () => {
    const { EditGraphHandlerFactSchema } = await import('@talchain/schemas/orchestrator');
    const fact = buildGenericEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).not.toBeNull();
    expect(fact!.result.safe_summary).toBe(GENERIC_SAFE_SUMMARY);
    expect(fact!.result.safe_summary).toBe('Updated the decision model.');
    const r = EditGraphHandlerFactSchema.safeParse(fact);
    expect(r.success).toBe(true);
  });

  it('J2 affected_entities is empty (no rich projection available)', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.affected_entities).toEqual([]);
  });

  it('J3 status="applied", noop=false, operations_count from operations.length', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          { op: 'update_node', path: 'fac_price', value: { value: 0.7 } },
          { op: 'update_node', path: 'fac_price', value: { value: 0.8 } },
          { op: 'update_node', path: 'fac_price', value: { value: 0.9 } },
        ],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.status).toBe('applied');
    expect(fact!.noop).toBe(false);
    expect(fact!.result.operations_count).toBe(3);
  });

  it('J4 returns null for rejected edit (gate)', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, wasRejected: true, appliedGraph: null },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('J5 returns null for zero-ops edit (gate)', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, operations: [] },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).toBeNull();
  });

  it('J6 succeeds even when appliedChanges is absent (the whole point of the fallback)', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: { ...SUCCESS_RESULT_PARAM_UPDATE, appliedChanges: undefined },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact).not.toBeNull();
    expect(fact!.result.safe_summary).toBe(GENERIC_SAFE_SUMMARY);
  });

  it('J7 impact uses operation_meta when available (highest)', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operation_meta: [{ impact: 'high', rationale: '' }],
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.impact).toBe('high');
  });

  it('J8 impact = "moderate" for structural ops without operation_meta', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          { op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'X' } },
        ],
        operation_meta: undefined,
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.impact).toBe('moderate');
  });

  it('J9 rerun_recommended prefers appliedChanges.rerun_recommended when available', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        appliedChanges: { ...APPLIED_CHANGES_PARAM_UPDATE, rerun_recommended: true },
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false, // even when has_existing_analysis is false
    });
    expect(fact!.result.rerun_recommended).toBe(true);
  });

  it('J10 rerun_recommended falls back to (hasExistingAnalysis && hasSubstantiveOp) without appliedChanges', () => {
    // Substantive op (add_node) + hasExistingAnalysis=true → true
    const factTrue = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          { op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'X' } },
        ],
        appliedChanges: undefined,
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: true,
    });
    expect(factTrue!.result.rerun_recommended).toBe(true);

    // Label-only update (non-substantive) → false even if hasExistingAnalysis
    const factFalse = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [{ op: 'update_node', path: 'fac_price', value: { label: 'X' } }],
        appliedChanges: undefined,
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: true,
    });
    expect(factFalse!.result.rerun_recommended).toBe(false);

    // No prior analysis → false regardless
    const factNoPrior = buildGenericEditGraphHandlerFact({
      editResult: {
        ...SUCCESS_RESULT_PARAM_UPDATE,
        operations: [
          { op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'X' } },
        ],
        appliedChanges: undefined,
      },
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(factNoPrior!.result.rerun_recommended).toBe(false);
  });

  it('J11 graph_hash_before/after computed where graphs are available', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: makeGraph(),
      hasExistingAnalysis: false,
    });
    expect(fact!.result.graph_hash_before).not.toBeNull();
    expect(fact!.result.graph_hash_after).not.toBeNull();
  });

  it('J12 graph_hash_before is null when preEditGraph is null', () => {
    const fact = buildGenericEditGraphHandlerFact({
      editResult: SUCCESS_RESULT_PARAM_UPDATE,
      preEditGraph: null,
      hasExistingAnalysis: false,
    });
    expect(fact!.result.graph_hash_before).toBeNull();
    expect(fact!.result.graph_hash_after).not.toBeNull();
  });
});
