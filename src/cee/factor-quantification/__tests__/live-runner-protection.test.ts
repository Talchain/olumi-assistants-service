import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { matchesRequiredUnknown, passesStrictQuantificationEvaluation, quantityForWire } from '../../../../scripts/semantic-contract/factor-quantification-live.js';
import { GraphV3, type NodeV3T } from '../../../schemas/cee-v3.js';
import { replayRecordSet } from '../../draft/records/replay.js';
import { projectGraphAndOptionsToV3 } from '../../transforms/schema-v3.js';
import { figurePoor, liveRecordsFigureRichControl } from './fixtures/corpus.js';
import { parseFactorEstimates } from '../estimate-response.js';

const node = (observed: Record<string, unknown>): NodeV3T => ({
  id: 'fac_stated', kind: 'factor', label: 'Stated share', observed_state: observed,
} as NodeV3T);
const stated = () => node({ value: 0.12, unit: 'share', source: 'brief_extraction', baseline: undefined });
const same = (left: NodeV3T, right: NodeV3T) => isDeepStrictEqual(quantityForWire(left), quantityForWire(right));

describe('an ordinal endpoint scale does not calibrate an interior number or spread', () => {
  it('rejects the exact banked model estimate despite valid output syntax, while accepting explicit unknown on the unchanged brief', () => {
    // Saved live-sonnet-banked output at clean 8deefc63f79c6e1afa93da2387e752824a30cf6c.
    // Request hash 591ee04de40dc6cbfb76777c9ae514cccdeaad91818e816df34f34e85d536c80.
    // This is an adverse model output, not evidence supporting its own number.
    const banked = {
      factor_id: 'fac_preparedness',
      reasoning: "The brief gives qualitative evidence: a written manual recovery checklist and an on-call rota exist (indicating some documented process, above 0), but recovery has never been rehearsed (so it is not 'fully rehearsed automatic recovery' at 1). This places readiness above the 'no documented process' floor but below any rehearsed/tested state. This is a provisional qualitative judgment, not a measured probability, so a point estimate with wide uncertainty is more defensible than treating the full 0-1 span as equally likely (a checklist+rota clearly rules out the extremes). I estimate a modest-low value reflecting documented-but-unrehearsed status, with a large std to reflect the lack of any measurement or rehearsal data.",
      estimate_type: 'estimated', basis: ['brief'], value: 0.35, std: 0.15,
    };
    const parsed = parseFactorEstimates({ estimates: [banked] }, ['fac_preparedness']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(matchesRequiredUnknown(parsed.estimates[0])).toBe(false);
    const unknown = parseFactorEstimates({ estimates: [{ factor_id: 'fac_preparedness',
      estimate_type: 'unknown', basis: ['brief'], reasoning: 'The checklist and rota indicate partial preparedness, but the endpoint descriptions provide no interior scoring rubric or calibrated standard deviation. Preserve that qualitative assessment without a numerical claim.' }] }, ['fac_preparedness']);
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) throw new Error(unknown.error);
    expect(matchesRequiredUnknown(unknown.estimates[0])).toBe(true);
    expect(matchesRequiredUnknown(undefined)).toBe(false);
    expect(figurePoor.expected.estimate_candidates).toEqual([]);
    expect(figurePoor.expected.must_remain_unknown).toEqual(['fac_preparedness']);
    // The scientific oracle changed; the user context was not made easier.
    expect(createHash('sha256').update(figurePoor.brief).digest('hex'))
      .toBe('d72383ebaf146af64b182dfcd033075aaca9f05b720c9e1ad09e556797b7892f');
  });
});

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
