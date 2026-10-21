import { describe,expect,it } from 'vitest';

import { runExtraction } from '../../src/orchestrator-v5/context/cqe/extract-quantities.js';

// CQE extraction on the production entry point (`runExtraction`, called by
// clarification-resume and baseline-answer-mutation): quantities are parsed
// from the raw user message, a quantity-free message yields none, and the
// optional value_origin survives JSON serialisation. These rows previously
// reached `runExtraction` through the deleted context-pack assembler, which
// copied `runExtraction(message).results` verbatim into `parsed_quantities`.

describe('CQE extraction via runExtraction', () => {
  it('populates results for a quantity-bearing message', () => {
    const { results } = runExtraction('set churn to 5% and cost to 50000');
    expect(results.length).toBeGreaterThan(0);
    const first = results[0]!;
    expect(first.value).toBeCloseTo(0.05);
    expect(first.unit).toBe('percentage');
    expect(first.operator).toBe('set');
  });

  it('yields empty results for a quantity-free message', () => {
    expect(runExtraction('what about churn?').results).toEqual([]);
  });

  it('preserves value_origin after JSON.stringify (serialisation path)', () => {
    const { results } = runExtraction('the budget is £150k');
    const serialised = JSON.stringify({ parsed_quantities: results }, null, 2);
    const roundTripped = JSON.parse(serialised) as { parsed_quantities: typeof results };
    expect(roundTripped.parsed_quantities[0]?.value_origin).toBe(
      'suffix_expansion',
    );
    expect(serialised).toContain('"value_origin": "suffix_expansion"');
  });
});
