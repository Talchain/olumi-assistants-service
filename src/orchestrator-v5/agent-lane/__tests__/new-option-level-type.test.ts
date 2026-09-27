/**
 * The `propose_new_option` capability's TYPE carries each `acts_on[].level`, as the tool schema sends it and as the
 * capability reads it (ChatGPT #70 5858459113, point 2). Type-checked by the ratchet (vitest strips types): with
 * `level` dropped from `NewOptionActsOn`, the literal below is an excess-property error and the ratchet fails.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, type AgentCapabilities } from '../runtime/agent-tools.js';

type ActsOn = NonNullable<Parameters<AgentCapabilities['proposeNewOption']>[1]['acts_on']>[number];

describe('propose_new_option — the capability type carries the level the schema sends', () => {
  it('a stated level and an Olumi estimate both type-check as acts_on entries', () => {
    const stated: ActsOn = { factor_label: 'Price', direction: 'positive', level: { value: 59, unit: 'GBP' } };
    const estimate: ActsOn = { factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP', estimate: true, basis: 'midpoint of the range discussed' } };
    expect([stated.level?.value, estimate.level?.estimate]).toEqual([59, true]);
  });

  it('CONTROL: the tool schema sends `level` on each acts_on item (the field the type now names)', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_new_option') as unknown as { parameters: unknown };
    expect(JSON.stringify(tool.parameters)).toContain('"level"');
  });
});
