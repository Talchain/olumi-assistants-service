import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { passesStrictQuantificationEvaluation, quantityForWire } from '../../../../scripts/semantic-contract/factor-quantification-live.js';
import { GraphV3, type NodeV3T } from '../../../schemas/cee-v3.js';
import { replayRecordSet } from '../../draft/records/replay.js';
import { projectGraphAndOptionsToV3 } from '../../transforms/schema-v3.js';
import { liveRecordsFigureRichControl } from './fixtures/corpus.js';

const node = (observed: Record<string, unknown>): NodeV3T => ({
  id: 'fac_stated', kind: 'factor', label: 'Stated share', observed_state: observed,
} as NodeV3T);
const stated = () => node({ value: 0.12, unit: 'share', source: 'brief_extraction', baseline: undefined });
const same = (left: NodeV3T, right: NodeV3T) => isDeepStrictEqual(quantityForWire(left), quantityForWire(right));

describe('runner strict-evaluation admission', () => {
  it.each([
    { label: 'resolved input', fallback: 0, strict_evaluation_pass: true, pass: true },
    { label: 'material fallback', fallback: 1, strict_evaluation_pass: false, pass: false },
    { label: 'fallback contradicts claimed strict success', fallback: 1, strict_evaluation_pass: true, pass: false },
    { label: 'operational failure without fallback', fallback: 0, strict_evaluation_pass: false, pass: false },
    { label: 'strict result is absent', fallback: 0, pass: false },
  ])('$label cannot borrow another success signal', ({ pass, ...metrics }) => {
    expect(passesStrictQuantificationEvaluation(metrics)).toBe(pass);
  });
});

describe('live witness compares all representable quantity fields without undefined-property false failures', () => {
  it('reproduces the exact direct-stated records field difference and accepts the equivalent JSON wire quantity', async () => {
    const fixture = liveRecordsFigureRichControl;
    const replay = await replayRecordSet(fixture.records, { brief: fixture.brief });
    if (!replay.ok) throw new Error(replay.reason);
    const graph = GraphV3.parse(projectGraphAndOptionsToV3(
      replay.graph as Parameters<typeof projectGraphAndOptionsToV3>[0], { brief: fixture.brief },
    ).graph);
    const before = graph.nodes.find(item => item.label === fixture.protected_label)!;
    const readback = GraphV3.parse(JSON.parse(JSON.stringify(graph))).nodes.find(item => item.id === before.id)!;
    expect(before.observed_state).toHaveProperty('baseline', undefined);
    expect(readback.observed_state).not.toHaveProperty('baseline');
    expect(isDeepStrictEqual(before.observed_state, readback.observed_state)).toBe(false);
    expect(same(before, readback)).toBe(true);
    expect(readback.observed_state).toMatchObject({ value: 0.12, unit: 'share', source: 'brief_extraction' });
  });

  it.each([
    { change: 'numeric value', after: { value: 0.24, unit: 'share', source: 'brief_extraction' } },
    { change: 'source removed', after: { value: 0.12, unit: 'share' } },
    { change: 'source replaced', after: { value: 0.12, unit: 'share', source: 'cee_inference' } },
    { change: 'unit changed', after: { value: 0.12, unit: '%', source: 'brief_extraction' } },
    { change: 'null added', after: { value: 0.12, unit: 'share', source: 'brief_extraction', baseline: null } },
    { change: 'raw value added', after: { value: 0.12, unit: 'share', source: 'brief_extraction', raw_value: 12 } },
  ])('the protected-value predicate remains RED when $change', ({ after }) => {
    expect(same(stated(), node(after))).toBe(false);
  });

  it('does not hide changed supplied raw values or prior range endpoints', () => {
    expect(same(node({ value: 0.12, raw_value: 12 }), node({ value: 0.12, raw_value: 24 }))).toBe(false);
    const before = { ...stated(), prior: { distribution: 'uniform', range_min: 0.1, range_max: 0.3, source: 'user_assumption' } };
    const after = { ...before, prior: { ...before.prior, range_max: 0.4 } };
    expect(same(before, after)).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])('does not coerce non-finite %s into null like JSON.stringify would', value => {
    // Invalid numeric fixtures verify the measurement itself does not conceal
    // a bad field; the canonical schema separately owns valid quantities.
    expect(same(node({ value }), node({ value: null }))).toBe(false);
  });
});
