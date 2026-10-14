import { describe, expect, it } from 'vitest';
import { parse, revisionDoors } from './graph-writer-revision-guard-utils.js';

const variants = [
  ['assignment', 'let edited; edited = merge({ persistedBase: original.graph, mutatedGraph: patch });'],
  ['spread', 'const edited = { ...original.graph, nodes: patch };'],
] as const;
const fixture = (transform: string, revision: string) => parse('origin-fixture.ts', `
  async function edit() {
    const original = await store.loadGraphAndBriefText(scenario);
    ${transform}
    const later = await store.loadGraphAndBriefText(scenario);
    commitDirectAnswer(response, { graph: edited, expectedRevision: ${revision}.revision });
  }
`);

describe('origin guard assignment and spread fixtures', () => {
  it.each(variants)('PLANTED %s later-read mutant is RED', (_name, transform) => {
    expect(revisionDoors(fixture(transform, 'later')).map(door => door.hasRevision)).toEqual([false]);
  });
  it.each(variants)('%s same-read control is GREEN', (_name, transform) => {
    expect(revisionDoors(fixture(transform, 'original')).map(door => door.hasRevision)).toEqual([true]);
  });
  it('keeps unknown-origin behaviour unchanged', () => {
    expect(revisionDoors(parse('unknown.ts', 'commitDirectAnswer(response, { graph: opaque, expectedRevision: state.revision });'))
      .map(door => door.hasRevision)).toEqual([true]);
  });
});
