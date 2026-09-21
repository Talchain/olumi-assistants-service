import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  hasFiniteConditionalSwitchProbability,
  orderFragilityPriorityRows,
  readFiniteConditionalSwitchProbability,
  selectFragilityPriorityRow,
} from '../fragile-edge-authority.js';

describe('fragile-edge authority', () => {
  it('selects the maximum finite producer metric from an unsorted array', () => {
    const rows = [
      { id: 'head', switch_probability: 0.11 },
      { id: 'maximum', switch_probability: 0.72 },
      { id: 'middle', switch_probability: 0.4 },
    ] as const;

    expect(selectFragilityPriorityRow(rows)).toBe(rows[1]);
    expect(rows.map((row) => row.id)).toEqual(['head', 'maximum', 'middle']);
  });

  it('uses strict greater-than so producer order breaks finite ties', () => {
    const rows = [
      { id: 'first', switch_probability: 0.5 },
      { id: 'second', switch_probability: 0.5 },
    ] as const;

    expect(selectFragilityPriorityRow(rows)).toBe(rows[0]);
  });

  it('uses the producer head only when every metric is missing or non-finite', () => {
    const rows = [
      { id: 'head', switch_probability: Number.NaN },
      { id: 'infinite', switch_probability: Number.POSITIVE_INFINITY },
      { id: 'missing' },
      { id: 'string', switch_probability: '0.9' },
    ] as const;

    expect(selectFragilityPriorityRow(rows)).toBe(rows[0]);
    expect(hasFiniteConditionalSwitchProbability(rows[0])).toBe(false);
  });

  it('does not let a non-finite head hide a later finite value', () => {
    const rows = [
      { id: 'head', switch_probability: Number.NaN },
      { id: 'finite', switch_probability: -0.2 },
    ] as const;

    expect(selectFragilityPriorityRow(rows)).toBe(rows[1]);
    expect(hasFiniteConditionalSwitchProbability(rows[1])).toBe(true);
  });

  it('orders every finite row by the same authority, with stable ties and fallback tail', () => {
    const rows = [
      { id: 'missing-a' },
      { id: 'low', switch_probability: 0.1 },
      { id: 'tie-a', switch_probability: 0.7 },
      { id: 'missing-b', switch_probability: Number.NaN },
      { id: 'tie-b', switch_probability: 0.7 },
    ] as const;

    expect(orderFragilityPriorityRows(rows).map((row) => row.id)).toEqual([
      'tie-a',
      'tie-b',
      'low',
      'missing-a',
      'missing-b',
    ]);
  });

  it('returns undefined for an empty array and never coerces invalid metrics', () => {
    expect(selectFragilityPriorityRow([])).toBeUndefined();
    expect(readFiniteConditionalSwitchProbability({ switch_probability: '0.8' })).toBeNull();
    expect(readFiniteConditionalSwitchProbability(null)).toBeNull();
  });

  it('SELECTOR-BYPASS MUTANT — every in-scope live single-edge consumer calls the shared authority', () => {
    const consumers = [
      '../../../orchestrator-v5/coaching/grounded-counter-case.ts',
      '../../../orchestrator-v5/coaching/select-fragile-edge.ts',
      '../../deterministic/coaching-context-builder.ts',
      '../../../orchestrator-v5/tools/handlers/explain-results.ts',
      '../../../orchestrator-v5/routing/post-analysis-advice-gate.ts',
      '../../../orchestrator-v5/coaching/analysis-result-headline.ts',
    ] as const;

    for (const relativePath of consumers) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      expect(source, relativePath).toMatch(/(?:select|order)FragilityPriorityRow/);
    }
  });

  it('COPY MUTANT — labels-only surfaces cannot restore arrival-order superlatives', () => {
    const sources = [
      '../../../orchestrator-v5/coaching/grounded-counter-case.ts',
      '../../../orchestrator-v5/coaching/fragile-edge-offer-text.ts',
      '../../../orchestrator-v5/coaching/validation-priority.ts',
      '../../../orchestrator-v5/routing/post-analysis-advice-gate.ts',
    ] as const;
    const unsupportedClaims = [
      'the relationship the result leans on most',
      'the assumption most likely to change the outcome',
      'The most useful thing to check is the link from',
    ] as const;

    for (const relativePath of sources) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      for (const claim of unsupportedClaims) {
        expect(source, `${relativePath}: ${claim}`).not.toContain(claim);
      }
    }

    const groundedSource = readFileSync(
      new URL('../../../orchestrator-v5/coaching/grounded-counter-case.ts', import.meta.url),
      'utf8',
    );
    expect(groundedSource).not.toMatch(/most sensitive|sensitivityClaim/i);
  });

  it('SEMANTIC-ALIAS MUTANT — no consumer names conditional-switch priority as sensitivity', () => {
    const productionSources = [
      '../fragile-edge-authority.ts',
      '../../../orchestrator-v5/coaching/grounded-counter-case.ts',
      '../../../orchestrator-v5/coaching/select-fragile-edge.ts',
      '../../deterministic/coaching-context-builder.ts',
      '../../../orchestrator-v5/tools/handlers/explain-results.ts',
      '../../../orchestrator-v5/routing/post-analysis-advice-gate.ts',
      '../../../orchestrator-v5/coaching/analysis-result-headline.ts',
    ] as const;
    const semanticAliases = [
      'selectMostSensitiveRow',
      'orderMostSensitiveRows',
      'selectionHasMetricProof',
    ] as const;

    for (const relativePath of productionSources) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      for (const alias of semanticAliases) {
        expect(source, `${relativePath}: ${alias}`).not.toContain(alias);
      }
    }
  });
});
