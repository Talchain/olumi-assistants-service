import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, NODE_SIZE_MEANS_LINK_FROM, A_FIGURE_IS_THE_FACTORS_VALUE, THE_BAND_MUST_REACH_THE_OUTCOME, SLIGHT_IS_WEAK } from '../runtime/agent-tools.js';
import packet from './fixtures/t2sm2-tool-text.json';

const tools = new Map(AGENT_TOOLS.map(t => [t.name, t]));
const protectedSegments = [NODE_SIZE_MEANS_LINK_FROM, A_FIGURE_IS_THE_FACTORS_VALUE, THE_BAND_MUST_REACH_THE_OUTCOME, SLIGHT_IS_WEAK];
const property = (parameters: any, path: string): any => path.split('.').reduce((schema, key) => key === '[]' ? schema.items : schema.properties[key], parameters);
describe('T2sm2 delivered AIE bytes at their actual tool sites', () => {
  for (const [name, approved] of Object.entries(packet)) {
    it(`${name}: exact replacement and field descriptions`, () => {
      const tool = tools.get(name)!;
      expect(tool.description).toBe(approved.description + (name === 'propose_link_strength' ? ' ' + protectedSegments.join(' ') : ''));
      for (const [field, description] of Object.entries(approved.fields)) expect(property(tool.parameters, field).description).toBe(description);
    });
  }
  it('single-link protected segments each occur once; absent timing tool stays absent', () => {
    for (const segment of protectedSegments) expect(tools.get('propose_link_strength')!.description.split(segment).length - 1).toBe(1);
    expect(tools.has('propose_effects_timing')).toBe(false);
  });
  it.each([
    ['propose_link_strength', ''], ['propose_goal_target', ''], ['propose_goal_current_level', ''],
    ['propose_link_strengths', 'links.[].'], ['propose_hiring_times', 'options.[].starts.[].'], ['propose_new_factor', 'factors.[].today.'],
  ])('%s: declaration fields use the approved sentences verbatim', (tool, path) => {
    expect(property(tools.get(tool)!.parameters, path + 'user_stated')).toEqual({ type: 'boolean', description: packet.propose_link_strength.fields.user_stated });
    expect(property(tools.get(tool)!.parameters, path + 'basis')).toEqual({ type: 'string', description: packet.propose_goal_current_level.fields.basis });
  });
});
