import { describe, it, expect } from 'vitest';
import { currentSavedEffectsTiming, currentEffectsTimingOf } from '../saved-effects-timing.js';

const record = { interpretation: 'in_place_by_period', source_status: 'complete', source: 'All options have full effects at the endpoint.', basis: 'The retained timing interpretation.', goal_id: 'goal', option_ids: ['a', 'b'], graph_revision: 'r1' };
const graph = { nodes: [{ id: 'goal', kind: 'goal' }, { id: 'a', kind: 'option' }, { id: 'b', kind: 'option' }], effects_timing_record: record };

describe('approved timing current reader', () => {
  it.each(['in_place_by_period', 'later_or_partial', 'not_stated'])('retains complete-source %s exactly', interpretation => {
    const r = { ...record, interpretation };
    expect(currentSavedEffectsTiming({ ...graph, effects_timing_record: r }, 'r1', 'goal')).toEqual(r);
    expect(currentEffectsTimingOf({ ...graph, effects_timing_record: r }, 'r1', 'goal')).toBe(interpretation);
  });
  it.each(['incomplete', 'unread', 'unknown', 'conflicting'])('does not turn %s source into complete-source absence', source_status => {
    expect(currentSavedEffectsTiming({ ...graph, effects_timing_record: { ...record, source_status, interpretation: 'not_stated' } }, 'r1', 'goal')).toBeNull();
  });
  it('rejects stale revision, different goal, changed option set and absent record', () => {
    expect(currentSavedEffectsTiming(graph, 'r2', 'goal')).toBeNull();
    expect(currentSavedEffectsTiming(graph, 'r1', 'another-goal')).toBeNull();
    expect(currentSavedEffectsTiming({ ...graph, nodes: graph.nodes.slice(0, 2) }, 'r1', 'goal')).toBeNull();
    expect(currentSavedEffectsTiming({ nodes: graph.nodes }, 'r1', 'goal')).toBeNull();
  });
});

 it.each(['source', 'basis'])('T2f complete record rejects empty or unreadable %s', async field => {
   const { SavedEffectsTimingSchema } = await import('../saved-effects-timing.js');
   for (const value of ['', '  ', null, {}, undefined]) {
     const invalid = { ...record, [field]: value };
     expect(SavedEffectsTimingSchema.safeParse(invalid).success).toBe(false);
     expect(currentSavedEffectsTiming({ ...graph, effects_timing_record: invalid }, 'r1', 'goal')).toBeNull();
   }
 });
