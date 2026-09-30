import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ILLUSTRATIVE_SECOND_VIEW, projectSecondView } from './rehearsal-ui.mjs';

test('shows separately supplied example views and comparison words for the same input', () => {
  const view = projectSecondView(ILLUSTRATIVE_SECOND_VIEW, ILLUSTRATIVE_SECOND_VIEW.input_identity);
  assert.equal(view.state, 'illustrative');
  assert.match(view.primary, /retention/);
  assert.match(view.second, /acquisition/);
  assert.deepEqual(view.comparison.map(row => row.label), ['Agreement', 'Difference in emphasis', 'Evidence to examine next']);
});

test('model change or unequal view inputs withhold both views and their comparison', () => {
  const stale = projectSecondView(ILLUSTRATIVE_SECOND_VIEW, 'illustrative-pricing-model-v2');
  assert.deepEqual(stale, { state: 'withheld', primary: null, second: null, comparison: [] });
  const unequal = structuredClone(ILLUSTRATIVE_SECOND_VIEW);
  unequal.second.input_identity = 'another-input';
  assert.deepEqual(projectSecondView(unequal, unequal.input_identity), stale);
});

test('comparison rows appear only when words are explicitly supplied', () => {
  const withoutComparison = structuredClone(ILLUSTRATIVE_SECOND_VIEW);
  delete withoutComparison.supplied_comparison;
  const view = projectSecondView(withoutComparison, withoutComparison.input_identity);
  assert.equal(view.state, 'illustrative');
  assert.deepEqual(view.comparison, []);
});
