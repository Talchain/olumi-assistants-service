import assert from 'node:assert/strict';
import test from 'node:test';
import { manifest, scoreRecord } from './score.mjs';

const brief = manifest.briefs.find((item) => item.id === 'paul-mrr');
const record = (sourceQuote) => ({
  brief: brief.id,
  source_sha256: brief.source_sha256,
  graph: {
    nodes: [{ id: 'raise', kind: 'option', label: 'Raise the Pro plan price to £59', provenance: 'from_brief', ...(sourceQuote === undefined ? {} : { source_quote: sourceQuote }) }],
    edges: [],
  },
});

test('an exact option quote earns option lineage credit', () => {
  const score = scoreRecord(record('raise our Pro plan price from £49 to £59 a month'));
  assert.equal(score.fidelity.user_options_retained, 1);
  assert.equal(score.fidelity.user_options_source_bound, 1);
  assert.equal(score.fidelity.failures.some((failure) => failure.kind === 'option_source_unbound'), false);
});

test('a retained label without a bound quote is a fidelity finding', () => {
  const score = scoreRecord(record(undefined));
  assert.equal(score.fidelity.user_options_retained, 1);
  assert.equal(score.fidelity.user_options_source_bound, 0);
  assert.equal(score.fidelity.failures.filter((failure) => failure.kind === 'option_source_unbound').length, 1);
});

test('a quote from another source item cannot bind the option', () => {
  const score = scoreRecord(record('£75k MRR'));
  assert.equal(score.fidelity.user_options_source_bound, 0);
  assert.equal(score.fidelity.failures.some((failure) => failure.kind === 'option_source_unbound'), true);
});
