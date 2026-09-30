import { describe, expect, it } from 'vitest';
import { admittedOptionKeys } from '../admitted-option-identity.js';
import { canonicalLabel, shortLabel, type CandidateModel } from '../admit-model.js';
import { quoteListedOptions } from '../option-lineage.js';
import { markOlumiOptions } from '../olumi-option-marker.js';

const fullA = 'Move steady production workloads onto reserved cloud instances';
const fullB = 'Move steady production workloads onto a different cloud provider';
const node = (description: string, id = 'option') => ({ id, kind: 'option', label: shortLabel(description), description });

describe('admitted option identity survives label shortening without crossing ownership', () => {
  it('two full identities sharing one display label still map separately', () => {
    expect(shortLabel(fullA)).toBe(shortLabel(fullB));
    const a = node(fullA, 'a');
    const b = node(fullB, 'b');
    const keys = admittedOptionKeys([a, b], [{ label: fullA }, { label: fullB }]);
    expect(keys.get(a)).toBe(canonicalLabel(fullA));
    expect(keys.get(b)).toBe(canonicalLabel(fullB));
  });

  it('duplicate candidate identities or duplicate admitted identities bind neither', () => {
    const a = node(fullA);
    expect(admittedOptionKeys([a], [{ label: fullA }, { label: fullA.toUpperCase() }]).size).toBe(0);
    expect(admittedOptionKeys([a, { ...a, id: 'duplicate' }], [{ label: fullA }]).size).toBe(0);
  });

  it('an arbitrary description cannot rename an option or bind a missing full label', () => {
    const unrelated = { kind: 'option', label: 'Existing option', description: fullA };
    const keys = admittedOptionKeys([unrelated], [{ label: fullA }, { label: 'Existing option' }]);
    expect(keys.get(unrelated)).toBe('existing option');
    const lost = { kind: 'option', label: shortLabel(fullA) };
    expect(admittedOptionKeys([lost], [{ label: fullA }, { label: fullB }]).size).toBe(0);
    expect(admittedOptionKeys([{ ...node(fullA), kind: 'factor' }], [{ label: fullA }]).size).toBe(0);
  });

  it('a shared display label never transfers a user quote to Olumi\'s option or its marker to the user\'s', () => {
    const brief = 'The options are: move steady workloads to reserved instances, or shift batch jobs to spot instances.';
    const candidate = {
      options: [
        { label: fullA, provenance: 'explicit', brief_words: 'move steady workloads to reserved instances', interventions: [] },
        { label: fullB, provenance: 'ai_proposed', brief_words: null, interventions: [{ factor_label: 'Migration share', value: 40, unit: '%', provenance: 'ai_proposed' }] },
      ],
      factors: [{ label: 'Migration share' }],
    } as unknown as CandidateModel;
    const nodes = [node(fullA, 'user'), node(fullB, 'olumi')];
    const marked = markOlumiOptions(quoteListedOptions(nodes, candidate, brief), candidate, brief, true) as readonly (typeof nodes[number] & { source_quote?: string; proposed_by?: string })[];
    expect(marked[0]?.source_quote).toBe('move steady workloads to reserved instances');
    expect(marked[0]?.proposed_by).toBeUndefined();
    expect(marked[1]?.source_quote).toBeUndefined();
    expect(marked[1]?.proposed_by).toBe('olumi');
  });
});
