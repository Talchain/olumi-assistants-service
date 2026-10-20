import type { LivingModelT } from '../../../../schemas/living-model.js';

/** The recovery Batch 0 numerical control (ISL `test_recovery_numerical_check.py`), stated as a person would state it. */
export const KNOWN_ANSWER: LivingModelT = {
  aims: [{ id: 'g', text: 'Reach 100 units', status: 'current', source: 'user', party: null, quote: 'we need at least 100 units; today we are at 70',
    target: { quantity: 'units', comparator: '>=', value: 100, low: null, high: null, unit: 'units', by_when: null, baseline: 'today', current: 70 } }],
  options: [
    { id: 'hold', label: 'Hold', settings: [], source: 'user', party: null, quote: 'or we hold' },
    { id: 'push', label: 'Push', source: 'user', party: null, quote: 'push f to 1',
      settings: [{ factor_id: 'f', value: 1, low: null, high: null, unit: null, source: 'user', party: null, quote: 'push f to 1' }] },
  ],
  factors: [{ id: 'f', label: 'f', value: 0.5, low: null, high: null, unit: null, source: 'user', party: null, quote: 'f is at 0.5' }],
  links: [{ id: 'f_g', from: 'f', to: 'g', source: 'user', party: null, quote: 'each +1 in f adds about 50 units, somewhere between 33.55 and 66.45',
    effect: { form: 'range', value: null, low: 33.55, high: 66.45, unit: 'units', sign: '+' } }],
  conditions: [], views: [{ holder: 'Sam', position: 'thinks push is too risky', quote: 'Sam disagrees' }], history: [],
};
