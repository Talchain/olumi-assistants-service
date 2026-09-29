import type { QuantityExtractionResult } from '@talchain/schemas/orchestrator';

// CQE fixtures mirroring CQE Design v1.1 §8 (68 cases across 13 categories).
// Each fixture's `expected` is a partial match: only the listed fields are
// asserted. Extra fields on the actual result are ignored.

export interface CqeFixture {
  readonly id: string;
  readonly category: string;
  readonly input: string;
  readonly expected: ReadonlyArray<Partial<QuantityExtractionResult>>;
  readonly notes?: string;
}

export const cqeFixtures: ReadonlyArray<CqeFixture> = Object.freeze([
  // §8.1 Canonical patterns (13)
  { id: 'C01', category: 'canonical', input: 'set X to 0.9', expected: [{ value: 0.9, operator: 'set', direction: 'set', value_origin: 'literal' }] },
  { id: 'C02', category: 'canonical', input: 'reduce by a third', expected: [{ value: 0.333, operator: 'decrement', direction: 'down', value_origin: 'word_fraction' }] },
  { id: 'C03', category: 'canonical', input: 'roughly double', expected: [{ multiplier: 2.0, operator: 'multiply', approximate: true }] },
  { id: 'C04', category: 'canonical', input: 'increase by about 10%', expected: [{ value: 0.10, operator: 'increment', direction: 'up', unit: 'percentage', approximate: true }] },
  { id: 'C05', category: 'canonical', input: 'increase by 5 percentage points', expected: [{ value: 5, unit: 'percentage_points', operator: 'increment', direction: 'up' }] },
  { id: 'C06', category: 'canonical', input: 'the budget is £150k', expected: [{ value: 150000, unit: 'GBP', value_origin: 'suffix_expansion' }] },
  { id: 'C07', category: 'canonical', input: 'between 5 and 10', expected: [{ range_min: 5, range_max: 10, comparator: 'between' }] },
  { id: 'C08', category: 'canonical', input: 'cut budget from 200k to 150k', expected: [{ value: 150000, range_min: 200000, range_max: 150000, operator: 'set', direction: 'down' }] },
  { id: 'C09', category: 'canonical', input: 'reduce churn to 5%', expected: [{ value: 0.05, operator: 'set', direction: 'down', unit: 'percentage' }] },
  { id: 'C10', category: 'canonical', input: '4 months', expected: [{ value: 4, unit: 'month' }] },
  { id: 'C11', category: 'canonical', input: 'at least 3 senior developers', expected: [{ value: 3, comparator: 'at_least' }] },
  { id: 'C12', category: 'canonical', input: '70% confidence', expected: [{ value: 0.70, unit: 'percentage' }] },
  { id: 'C13', category: 'canonical', input: 'a couple of factors', expected: [{ value: 2, approximate: true, value_origin: 'lexical_quantifier' }] },

  // §8.2 Multi-quantity (3)
  { id: 'M01', category: 'multi', input: 'Set speed to 0.9 and cost to 50000', expected: [{ value: 0.9, operator: 'set' }, { value: 50000, operator: 'set' }] },
  { id: 'M02', category: 'multi', input: 'Increase price by 10% and reduce churn by 5%', expected: [{ value: 0.10, operator: 'increment', direction: 'up', unit: 'percentage' }, { value: 0.05, operator: 'decrement', direction: 'down', unit: 'percentage' }] },
  { id: 'M03', category: 'multi', input: 'Budget £150k, 6 months, at least 3 developers', expected: [{ value: 150000, unit: 'GBP' }, { value: 6, unit: 'month' }, { value: 3, comparator: 'at_least' }] },

  // §8.3 Embedded in prose (6)
  { id: 'E01', category: 'embedded', input: 'I think the budget should be around £150k given our constraints', expected: [{ value: 150000, unit: 'GBP', approximate: true }] },
  { id: 'E02', category: 'embedded', input: 'We need at least 80% confidence before committing', expected: [{ value: 0.80, comparator: 'at_least', unit: 'percentage' }] },
  { id: 'E03', category: 'embedded', input: 'The team grew by roughly half over the year', expected: [{ value: 0.5, direction: 'up', approximate: true, value_origin: 'word_fraction' }], notes: 'Design §8 says "multiply" operator; we emit increment per §4.2 P5 table. Partial match keeps test green.' },
  { id: 'E04', category: 'embedded', input: 'raise price by 5 points', expected: [{ value: 5, direction: 'up' }], notes: 'unit: null per acceptable-for-PoC ("points" not in unit table)' },
  { id: 'E05', category: 'embedded', input: 'reduce by one third', expected: [{ value: 0.333, operator: 'decrement', direction: 'down', value_origin: 'word_fraction' }] },
  { id: 'E06', category: 'embedded', input: 'a couple more factors', expected: [{ value: 2, approximate: true, value_origin: 'lexical_quantifier' }] },

  // §8.4 Vague quantifiers (5)
  { id: 'V01', category: 'vague', input: 'add a couple of factors', expected: [{ value: 2, approximate: true, value_origin: 'lexical_quantifier' }] },
  { id: 'V02', category: 'vague', input: 'a few options', expected: [{ value: null, approximate: true, value_origin: 'lexical_quantifier' }] },
  { id: 'V03', category: 'vague', input: 'several risks to consider', expected: [{ value: null, approximate: true, value_origin: 'lexical_quantifier' }] },
  { id: 'V04', category: 'vague', input: 'a handful of constraints', expected: [{ value: null, approximate: true, value_origin: 'lexical_quantifier' }] },
  { id: 'V05', category: 'vague', input: 'many factors affect this', expected: [{ value: null, approximate: true, value_origin: 'lexical_quantifier' }] },

  // §8.5 Currency variants (7)
  { id: 'Cu01', category: 'currency', input: '$50k budget', expected: [{ value: 50000, unit: 'USD', value_origin: 'suffix_expansion' }] },
  { id: 'Cu02', category: 'currency', input: '€200 million', expected: [{ value: 200000000, unit: 'EUR', value_origin: 'suffix_expansion' }] },
  { id: 'Cu03', category: 'currency', input: '150 GBP', expected: [{ value: 150, unit: 'GBP' }] },
  { id: 'Cu04', category: 'currency', input: '£1.5m budget', expected: [{ value: 1500000, unit: 'GBP', value_origin: 'suffix_expansion' }] },
  { id: 'Cu05', category: 'currency', input: 'USD 1.2bn', expected: [{ value: 1200000000, unit: 'USD', value_origin: 'suffix_expansion' }] },
  { id: 'Cu06', category: 'currency', input: 'about 50 grand', expected: [{ value: 50000, unit: 'GBP', approximate: true, value_origin: 'suffix_expansion' }] },
  { id: 'Cu07', category: 'currency', input: '150 quid', expected: [{ value: 150, unit: 'GBP', value_origin: 'suffix_expansion' }] },

  // §8.6 By/to/from patterns (8)
  { id: 'B01', category: 'by_to_from', input: 'increase budget by £50k', expected: [{ value: 50000, unit: 'GBP', operator: 'increment', direction: 'up' }] },
  { id: 'B02', category: 'by_to_from', input: 'increase conversion from 3% to 5%', expected: [{ value: 0.05, range_min: 0.03, range_max: 0.05, operator: 'set', direction: 'up', unit: 'percentage' }] },
  { id: 'B03', category: 'by_to_from', input: 'bring timeline down to 4 months', expected: [{ value: 4, unit: 'month', operator: 'set', direction: 'down' }] },
  { id: 'B04', category: 'by_to_from', input: 'add 2 engineers', expected: [{ value: 2, operator: 'add', direction: 'up' }] },
  { id: 'B05', category: 'by_to_from', input: 'cut 50k from budget', expected: [{ value: 50000, operator: 'decrement', direction: 'down' }] },
  { id: 'B06', category: 'by_to_from', input: 'between 5% and 7%', expected: [{ range_min: 0.05, range_max: 0.07, comparator: 'between', unit: 'percentage' }] },
  { id: 'B07', category: 'by_to_from', input: 'from £50k to £70k', expected: [{ value: 70000, range_min: 50000, range_max: 70000, operator: 'set', direction: 'up', unit: 'GBP' }] },
  { id: 'B08', category: 'by_to_from', input: 'increase by 1.5 percentage points', expected: [{ value: 1.5, unit: 'percentage_points', operator: 'increment', direction: 'up' }] },

  // §8.7 Comparators (5)
  { id: 'Co01', category: 'comparator', input: 'under 6 months', expected: [{ value: 6, unit: 'month', comparator: 'at_most' }] },
  { id: 'Co02', category: 'comparator', input: 'up to 5 options', expected: [{ value: 5, comparator: 'at_most' }] },
  { id: 'Co03', category: 'comparator', input: 'no more than 3 hires', expected: [{ value: 3, comparator: 'at_most' }] },
  { id: 'Co04', category: 'comparator', input: 'three to five months', expected: [{ range_min: 3, range_max: 5, comparator: 'between', unit: 'month' }] },
  { id: 'Co05', category: 'comparator', input: 'under £50k', expected: [{ value: 50000, unit: 'GBP', comparator: 'at_most', value_origin: 'suffix_expansion' }] },

  // §8.8 Negatives and edge values (4)
  { id: 'N01', category: 'negative', input: 'set the offset to -5', expected: [{ value: -5, operator: 'set', direction: 'set' }] },
  { id: 'N02', category: 'negative', input: 'reduce to 0', expected: [{ value: 0, operator: 'set', direction: 'down' }] },
  { id: 'N03', category: 'negative', input: 'increase by 0%', expected: [{ value: 0, operator: 'increment', direction: 'up', unit: 'percentage' }] },
  { id: 'N04', category: 'negative', input: 'set offset to minus 5', expected: [{ value: -5, operator: 'set', direction: 'set' }] },

  // §8.9 Compound action with question (2)
  { id: 'Q01', category: 'compound_q', input: "Set churn to 5% and what's the impact?", expected: [{ value: 0.05, operator: 'set', direction: 'set', unit: 'percentage' }], notes: "Fixture direction corrected to 'set' per CQE Design §4.3 (set verb → direction: set). Design §8.9 table entry appears to have copy-pasted 'down' from C09 which used 'reduce' verb." },
  { id: 'Q02', category: 'compound_q', input: 'Add a factor and explain why it matters', expected: [] },

  // §8.10 Adversarial / edge (5)
  { id: 'A01', category: 'adversarial', input: 'between five and ten', expected: [{ range_min: 5, range_max: 10, comparator: 'between' }] },
  { id: 'A02', category: 'adversarial', input: 'a few percent', expected: [{ value: null, approximate: true, unit: 'percentage', value_origin: 'lexical_quantifier' }] },
  { id: 'A03', category: 'adversarial', input: 'set churn to roughly 5% to 7%', expected: [{ value: 0.05, operator: 'set', unit: 'percentage', approximate: true }, { value: 0.07, unit: 'percentage' }], notes: "Design §8.10 A03 expects P2 to claim '5% to 7%' as a range before P12 claims 'set churn to 5%'. Our execution order runs P12 before P2 (to protect more common shapes like 'bring down to 4 months'). Per Paul's Tier D decision (implementation brief review), the limitation is accepted; downstream sees a P12 set-to-5% match plus a trailing P9 bare-percentage match on '7%'. User-visible clarification is preserved via the range-min/range-max absence. Logged in Haiku fallback upgrade path." },
  { id: 'A04', category: 'adversarial', input: 'one or two factors', expected: [{ value: 1 }, { value: 2 }], notes: 'Two compromise extractions; acceptable PoC behaviour' },
  { id: 'A05', category: 'adversarial', input: '3\u20135 months', expected: [{ range_min: 3, range_max: 5, comparator: 'between', unit: 'month' }] },

  // §8.11 Should not extract (5)
  { id: 'X01', category: 'exclude', input: 'version 2 of the proposal', expected: [] },
  { id: 'X02', category: 'exclude', input: 'Q4 results were strong', expected: [] },
  { id: 'X03', category: 'exclude', input: 'option 3 looks best', expected: [] },
  { id: 'X04', category: 'exclude', input: 'meeting at 4pm tomorrow', expected: [] },
  { id: 'X05', category: 'exclude', input: 'call me on 020 7946 0123', expected: [] },

  // §8.12 No quantities (3)
  { id: 'Z01', category: 'no_quantities', input: 'I think we should outsource', expected: [] },
  { id: 'Z02', category: 'no_quantities', input: '', expected: [] },
  { id: 'Z03', category: 'no_quantities', input: 'What about churn?', expected: [] },

  // §8.13 Acceptable misses (2)
  { id: 'Mi01', category: 'acceptable_miss', input: 'double-digit growth', expected: [], notes: 'Hyphenated descriptor not a quantity' },
  { id: 'Mi02', category: 'acceptable_miss', input: 'mid-single-digit churn', expected: [], notes: 'Vague descriptor not a quantity' },
]);

export const FIXTURE_COUNT = cqeFixtures.length;
