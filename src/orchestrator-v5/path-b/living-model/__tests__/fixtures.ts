import type { LivingModelT } from '../../../../schemas/living-model.js';

/** The recovery Batch 0 numerical control (ISL `test_recovery_numerical_check.py`), stated as a person would state it. */
export const KNOWN_ANSWER: LivingModelT = {
  aims: [{ id: 'g', text: 'Reach 100 units', status: 'current', defined_as: null, source: 'user', party: null, quote: 'we need at least 100 units; today we are at 70',
    target: { quantity: 'units', comparator: '>=', value: 100, low: null, high: null, unit: 'units', by_when: null, baseline: 'today', current: 70, current_source: null, current_unit: null, change_kind: null } }],
  options: [
    { id: 'hold', label: 'Hold', settings: [], source: 'user', party: null, quote: 'or we hold' },
    { id: 'push', label: 'Push', source: 'user', party: null, quote: 'push f to 1',
      settings: [{ factor_id: 'f', value: 1, low: null, high: null, unit: null, source: 'user', party: null, quote: 'push f to 1' }] },
  ],
  factors: [{ id: 'f', label: 'f', value: 0.5, low: null, high: null, unit: null, defined_as: null, source: 'user', party: null, quote: 'f is at 0.5' }],
  // The control's explicitly specified law (AIE, 20 Oct): Normal, mean 50 and SD 10 goal units per +1 of f, existence 1.
  links: [{ id: 'f_g', from: 'f', to: 'g', source: 'user', party: null, quote: 'each +1 in f adds 50 units on average, with a standard deviation of 10',
    effect: { form: 'normal', value: 50, sd: 10, low: null, high: null, unit: 'units', sign: '+' } }],
  conditions: [], views: [{ holder: 'Sam', position: 'thinks push is too risky', quote: 'Sam disagrees' }], history: [],
};

/** A synthetic brief where each option states its own exact effect on the goal: today 40, at least 60, A +30, B +19.9. */
export const OPTION_EFFECTS: LivingModelT = {
  aims: [{ id: 'w', text: 'Widgets per hour', status: 'current', defined_as: null, source: 'user', party: null, quote: 'at least 60 widgets per hour; today 40',
    target: { quantity: 'widgets per hour', comparator: '>=', value: 60, low: null, high: null, unit: 'widgets per hour', by_when: null, baseline: 'today', current: 40, current_source: null, current_unit: null, change_kind: null } }],
  options: [
    { id: 'a', label: 'Option A', settings: [], source: 'user', party: null, quote: 'option A' },
    { id: 'b', label: 'Option B', settings: [], source: 'user', party: null, quote: 'option B' },
  ],
  factors: [],
  links: [
    { id: 'a_w', from: 'a', to: 'w', source: 'user', party: null, quote: 'A adds exactly 30', effect: { form: 'exact', value: 30, sd: null, low: null, high: null, unit: 'widgets per hour', sign: '+' } },
    { id: 'b_w', from: 'b', to: 'w', source: 'user', party: null, quote: 'B adds exactly 19.9', effect: { form: 'exact', value: 19.9, sd: null, low: null, high: null, unit: 'widgets per hour', sign: '+' } },
  ],
  conditions: [], views: [], history: [],
};
