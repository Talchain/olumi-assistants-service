import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFrozenRegions, REGIONS_SOURCE, readFrozenContrastive, contrastiveCurrentness, CONTRASTIVE_SOURCE } from './rehearsal.mjs';

const source = readFileSync(new URL('./regions-cases.json', import.meta.url), 'utf8');
const served = JSON.parse(readFileSync(new URL('./rehearsal.json', import.meta.url), 'utf8'));
const contrastive = readFileSync(new URL('./contrastive-vulnerability.json', import.meta.url), 'utf8');
const coaching = readFileSync(new URL('./contrastive-coaching.md', import.meta.url), 'utf8');

test('pinned R3-B gives a hard-constraint boundary and a distinct unavailable control', async () => {
  assert.equal(served.frozen_regions_raw, source);
  const result = await readFrozenRegions(served.frozen_regions_raw);
  assert.equal(result.status, 'FROZEN_R3B_RESEARCH');
  assert.equal(result.cases.length, 2);
  const [threshold, unavailable] = result.cases;
  assert.equal(threshold.flip_kind, 'HARD_CONSTRAINT_FEASIBILITY');
  assert.equal(threshold.crossing_rule, 'GREATER_THAN');
  assert.equal(threshold.flip_threshold, 1.5);
  assert.match(threshold.flip_meaning, /Goal attainment and month-12 MRR preference are separate/);
  assert.match(threshold.provenance.assumption_qualifier, /not evidence-backed plausibility/);
  assert.equal(unavailable.flip_thresholds_status, 'unavailable');
  assert.equal(unavailable.flip_threshold, null);
  assert.equal(unavailable.reason.code, 'OPTION_LEVELS_MISSING');
  assert.match(unavailable.reason.detail, /A missing effect is not zero effect/);
  assert.equal(threshold.provenance.graph_id, unavailable.provenance.graph_id);
});

test('source byte drift and graph or mapping identity mismatch withhold both cases', async () => {
  await assert.rejects(readFrozenRegions(source + ' '), /source changed/);
  await assert.rejects(readFrozenRegions(source, { ...REGIONS_SOURCE, graph_sha256: 'different' }), /binding changed/);
  await assert.rejects(readFrozenRegions(source, { ...REGIONS_SOURCE, mapping_sha256: 'different' }), /binding changed/);
});

test('Science-approved contrastive card stays bound to four evaluated points and its own fixed assumptions', async () => {
  assert.equal(served.frozen_contrastive_raw, contrastive);
  assert.equal(served.frozen_contrastive_copy, coaching);
  const result = await readFrozenContrastive(contrastive, coaching);
  assert.equal(result.status, 'FROZEN_R3B_EXPERIMENTAL');
  assert.equal(result.source.commit, '68e8c8874eed528422db186852d3a5a1da9a27da');
  assert.equal(result.study.source.frozen_graph_id, REGIONS_SOURCE.graph_id);
  assert.equal(result.study.source.fixed_assumptions.some(item => item.id === 'X_feature_competitive_mrr'), false);
  assert.deepEqual(result.study.contrast.points.map(point => point.goal_state),
    ['ATTAINED', 'ATTAINED', 'ATTAINED', 'MISSED']);
  assert.ok(result.study.contrast.points.every(point => point.hard_constraint_state === 'SATISFIED'));
  assert.equal(result.study.contrast.points[3].monthly_churn_percent, 3.35);
  assert.equal(contrastiveCurrentness(result, CONTRASTIVE_SOURCE.graph_sha256), 'frozen_snapshot');
  assert.equal(contrastiveCurrentness(result, 'same-case-edited-graph'), 'stale');
  assert.equal(contrastiveCurrentness(result, undefined), 'stale');
});

test('changed contrastive source, copy or model identity withholds the claim', async () => {
  await assert.rejects(readFrozenContrastive(contrastive + ' ', coaching), /source or coaching changed/);
  await assert.rejects(readFrozenContrastive(contrastive, coaching + ' '), /source or coaching changed/);
  await assert.rejects(readFrozenContrastive(contrastive, coaching,
    { ...CONTRASTIVE_SOURCE, graph_sha256: 'different' }), /graph, assumptions or four-point meaning changed/);
  await assert.rejects(readFrozenContrastive(contrastive, coaching,
    { ...CONTRASTIVE_SOURCE, mapping_sha256: 'different' }), /graph, assumptions or four-point meaning changed/);
});
