/**
 * S12 — the ContextPack must carry FACTOR VALUE STATE.
 *
 * WHY (journey-witnessed 26 Aug 2026, UI 08a30ab9 / CEE 5a2640a, reproduced
 * three times across three phrasings, staleness eliminated as a confound):
 *
 *     user: "Which factors still have no value? Please list them by name."
 *     Olumi: "I don't have a way to see which individual factors are missing a
 *             value from here, so I can't list them by name."
 *
 * That answer was TRUE — nothing model-facing carried the fact — while the
 * Model tab in the same session rendered "3 of 4 have no value yet" and named
 * all three. See `context/factor-value-record.ts` for the full derivation.
 *
 * These tests pin the RELATIONSHIP to the existing authorities as well as the
 * content, so a future divergence REDs instead of shipping two truths.
 */

import { describe, it, expect } from 'vitest';
import {
  projectFactorValueRecord,
  FACTOR_VALUE_RECORD_CAP,
} from '../../../../src/orchestrator-v5/context/factor-value-record.js';
import { ContextPackFactorValuesSchema } from '../../../../src/orchestrator-v5/context/context-pack-schema.js';
import { factorHasExtractedValue } from '../../../../src/cee/provenance/factor-value-provenance.js';
import { structureProvenance } from '../../../../src/cee/graph-readiness/obligation-provenance.js';
import { CONTEXT_POLICY } from '../../../../src/orchestrator-v5/context/context-policy.js';

/**
 * A graph carrying ALL THREE provenance classes plus the witnessed shape —
 * a factor that is valueless AND stamped as an AI estimate.
 */
const MIXED_GRAPH = {
  nodes: [
    { id: 'g1', kind: 'goal', label: 'We Are Losing Repeat Orders' },
    { id: 'o1', kind: 'option', label: 'hold capacity as it is' },
    {
      id: 'f_user',
      kind: 'factor',
      label: 'Delivery Lead Time',
      observed_state: { value: 0.72, source: 'user_edited' },
    },
    {
      id: 'f_ai',
      kind: 'factor',
      label: 'Outsourcing Dependency',
      observed_state: { value: 0.4, source: 'cee_inference' },
    },
    {
      // THE WITNESSED SHAPE: no value, yet stamped as an AI estimate.
      id: 'f_ai_novalue',
      kind: 'factor',
      label: 'Capital Expenditure Committed',
      observed_state: { source: 'cee_inference' },
    },
    {
      id: 'f_none',
      kind: 'factor',
      label: 'Production Capacity Level',
    },
  ],
} as const;

const FULLY_VALUED_GRAPH = {
  nodes: [
    {
      id: 'f_a',
      kind: 'factor',
      label: 'Alpha',
      observed_state: { value: 0.5, source: 'user_edited' },
    },
    {
      id: 'f_b',
      kind: 'factor',
      label: 'Beta',
      observed_state: { value: 0.1, source: 'cee_inference' },
    },
  ],
} as const;

describe('factor value-state record', () => {
  it('enumerates every factor and no non-factor node', () => {
    const rec = projectFactorValueRecord(MIXED_GRAPH);
    expect(rec).toBeDefined();
    expect(rec!.factors).toHaveLength(4);
    expect(rec!.factors.map((f) => f.label)).toEqual([
      'Delivery Lead Time',
      'Outsourcing Dependency',
      'Capital Expenditure Committed',
      'Production Capacity Level',
    ]);
  });

  /** THE RED: the witnessed question must be answerable from the record. */
  it('names the factors that have no value', () => {
    const rec = projectFactorValueRecord(MIXED_GRAPH)!;
    const unvalued = rec.factors.filter((f) => !f.has_value).map((f) => f.label);
    expect(unvalued).toEqual(['Capital Expenditure Committed', 'Production Capacity Level']);
    expect(rec.without_value_count).toBe(2);
  });

  /**
   * ⭐ THE TWO AXES MUST NOT COLLAPSE. This is the exact shape the live model
   * carried and the exact conflation that produced the defect.
   */
  it('keeps has_value and provenance independent', () => {
    const rec = projectFactorValueRecord(MIXED_GRAPH)!;
    const byLabel = new Map(rec.factors.map((f) => [f.label, f]));
    const aiNoValue = byLabel.get('Capital Expenditure Committed')!;
    expect(aiNoValue.has_value).toBe(false);
    expect(aiNoValue.provenance).toBe('ai_drafted');
    const userValued = byLabel.get('Delivery Lead Time')!;
    expect(userValued.has_value).toBe(true);
    expect(userValued.provenance).toBe('user_stated');
  });

  /**
   * ⭐⭐ AGREEMENT WITH THE CANONICAL AUTHORITIES, on a fixture carrying all
   * three provenance classes. If either authority moves, this REDs rather than
   * the record quietly becoming a second truth.
   */
  it('agrees with factorHasExtractedValue and structureProvenance on every factor', () => {
    const rec = projectFactorValueRecord(MIXED_GRAPH)!;
    const factorNodes = MIXED_GRAPH.nodes.filter((n) => n.kind === 'factor');
    expect(rec.factors).toHaveLength(factorNodes.length);
    const classes = new Set<string>();
    for (const node of factorNodes) {
      const entry = rec.factors.find((f) => f.label === node.label)!;
      expect(entry.has_value, `${node.label} value presence diverged`).toBe(
        factorHasExtractedValue(node),
      );
      expect(entry.provenance, `${node.label} provenance diverged`).toBe(
        structureProvenance(node, MIXED_GRAPH),
      );
      classes.add(entry.provenance);
    }
    // The fixture must actually exercise more than one class, or the agreement
    // above is a tautology over a single value.
    expect(classes.size).toBeGreaterThanOrEqual(3);
  });

  /** HONEST AT ZERO — "none missing" is a POSITIVE claim, not an absence. */
  it('is present with without_value_count 0 when every factor has a value', () => {
    const rec = projectFactorValueRecord(FULLY_VALUED_GRAPH);
    expect(rec).toBeDefined();
    expect(rec!.without_value_count).toBe(0);
    expect(rec!.factors).toHaveLength(2);
  });

  /** ABSENCE MEANS UNKNOWN — and must be distinguishable from "none missing". */
  it('is undefined when no graph was read', () => {
    expect(projectFactorValueRecord(null)).toBeUndefined();
    expect(projectFactorValueRecord(undefined)).toBeUndefined();
    expect(projectFactorValueRecord({})).toBeUndefined();
  });

  it('discloses truncation rather than collapsing silently', () => {
    const many = {
      nodes: Array.from({ length: FACTOR_VALUE_RECORD_CAP + 3 }, (_, i) => ({
        id: `f${i}`,
        kind: 'factor',
        label: `Factor ${i}`,
      })),
    };
    const rec = projectFactorValueRecord(many)!;
    expect(rec.factors).toHaveLength(FACTOR_VALUE_RECORD_CAP);
    expect(rec.factors_omitted).toBe(3);
  });

  it('omits the truncation marker when nothing was dropped', () => {
    expect(projectFactorValueRecord(MIXED_GRAPH)!.factors_omitted).toBeUndefined();
  });

  it('validates against the published ContextPack schema', () => {
    for (const graph of [MIXED_GRAPH, FULLY_VALUED_GRAPH]) {
      const parsed = ContextPackFactorValuesSchema.safeParse(projectFactorValueRecord(graph));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  /**
   * ⭐ PIN THE DECLARATION, NOT JUST THE CONTENT. A slice that reaches the
   * prompt without a policy entry is how a budget silently stops meaning
   * anything.
   */
  it('is declared in the coach_converse context policy as a model-facing section', () => {
    const sections = CONTEXT_POLICY.coach_converse.sections;
    // Guard against a vacuous pass if the registry shape ever moves.
    expect(sections.length).toBeGreaterThan(5);
    const section = sections.find((s) => s.name === 'factor_values');
    expect(
      section,
      'factor_values reaches the prompt but is not declared in CONTEXT_POLICY.coach_converse',
    ).toBeDefined();
    expect(section!.model_facing).toBe(true);
    expect(section!.source).toBe('graph');
    expect(section!.projection).toContain('projectFactorValueRecord');
  });
});
