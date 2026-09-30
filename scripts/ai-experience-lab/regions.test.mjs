import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFrozenRegions, REGIONS_SOURCE } from './rehearsal.mjs';

const source = readFileSync(new URL('./regions-cases.json', import.meta.url), 'utf8');
const served = JSON.parse(readFileSync(new URL('./rehearsal.json', import.meta.url), 'utf8'));

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
