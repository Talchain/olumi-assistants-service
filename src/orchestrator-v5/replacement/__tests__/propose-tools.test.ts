/**
 * The change tools. Each refusal is checked for naming a next move, because
 * the measured failure was a dead end, not an exception.
 */

import { describe, expect, it } from 'vitest';

import { createSetOptionEffectTool } from '../propose-tools.js';
import type { EffectGraph } from '../set-option-effect.js';

const GRAPH = {
  nodes: [
    { id: 'd1', kind: 'decision', label: 'Question' },
    { id: 'o1', kind: 'option', label: 'Full Parity' },
    { id: 'f1', kind: 'factor', label: 'Monthly Churn Rate' },
    { id: 'f2', kind: 'factor', label: 'Gross Margin' },
  ],
  edges: [{ from: 'o1', to: 'f1' }],
} as unknown as EffectGraph;

const tool = createSetOptionEffectTool({ getGraph: () => GRAPH });

describe('the operation whose absence ended a session', () => {
  it('proposes, and does not apply', async () => {
    const out = await tool.execute({ option_id: 'o1', factor_id: 'f1', value: 0.4 });
    expect(out.type).toBe('proposed');
    if (out.type !== 'proposed') return;
    expect(out.summary).toBe('Set what Full Parity does to Monthly Churn Rate to 0.4');
    expect(out.operations).toHaveLength(1);
  });

  it('is declared a proposal tool, so the loop will not let it write', () => {
    expect(tool.kind).toBe('propose');
  });

  it('tells the model to say what the change MEANS, not just that it offered one', async () => {
    const out = await tool.execute({ option_id: 'o1', factor_id: 'f1', value: 0.4 });
    if (out.type !== 'proposed') throw new Error('expected a proposal');
    expect(out.content).toContain('affects the comparison');
    expect(out.content).toContain('what it means for their decision');
  });
});

describe('every refusal names the next move', () => {
  it('an unlinked factor is answered with what the option DOES affect', async () => {
    const out = await tool.execute({ option_id: 'o1', factor_id: 'f2', value: 0.4 });
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toContain('does not currently affect Gross Margin');
    expect(out.content).toContain('It does affect: Monthly Churn Rate');
  });

  it('a value outside the range says what the number means, not "invalid"', async () => {
    const out = await tool.execute({ option_id: 'o1', factor_id: 'f1', value: 40 });
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain("share of the factor's range");
    expect(out.content).not.toMatch(/invalid|error/i);
  });

  it('a non-option target says which operation the caller wanted instead', async () => {
    const out = await tool.execute({ option_id: 'f1', factor_id: 'f2', value: 0.4 });
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain('is a factor, not an option');
    expect(out.content).toContain('a different operation');
  });

  it('refuses rather than throws when there is no model yet', async () => {
    const empty = createSetOptionEffectTool({ getGraph: () => null });
    const out = await empty.execute({ option_id: 'o1', factor_id: 'f1', value: 0.4 });
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toContain('Talk the decision through first');
  });

  it('no refusal leaks a node list — the failure this replaces listed every node in the graph', async () => {
    for (const args of [
      { option_id: 'o1', factor_id: 'f2', value: 0.4 },
      { option_id: 'nope', factor_id: 'f1', value: 0.4 },
      { option_id: 'f1', factor_id: 'f2', value: 0.4 },
    ]) {
      const out = await tool.execute(args);
      if (out.type !== 'refused') throw new Error('expected a refusal');
      // "Question" is the decision node's label. It appeared in the live
      // chip list and meant nothing to the user.
      expect(out.content).not.toContain('Question');
    }
  });
});

describe('the description is a prompt and carries the rule the model kept breaking', () => {
  it('says not to invent a value the user has not given', () => {
    const d = tool.definition.description;
    expect(d).toContain('not to fill in a number they have not given you');
    expect(d).toContain('do not estimate one and offer it as theirs');
    expect(d).toContain('nothing is saved until they agree');
  });
});
