import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { compactGraphForContextPack } from '../compact-graph-for-contextpack.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

function promptForBaseline(baselineId: 'opt_current' | 'opt_change' | null): string {
  const graph: GraphV3T = {
    nodes: [
      {
        id: 'opt_current',
        kind: 'option',
        label: 'Continue the current approach',
        is_baseline: baselineId === 'opt_current',
      },
      {
        id: 'opt_change',
        kind: 'option',
        label: 'Adopt the alternative',
        is_baseline: baselineId === 'opt_change',
      },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ],
    edges: [],
  };
  const outcome = compactGraphForContextPack(graph, { requestId: 'req-baseline-option' });
  if (outcome.kind !== 'compacted' || outcome.via !== 'strict_parse') {
    throw new Error(`expected strict compaction, got ${JSON.stringify(outcome)}`);
  }

  const pack = assembleContextPack({
    payload: makeMessagePayload({
      scenario_id: 'scen-baseline-option-continuity',
      message: 'Compare the current approach with the alternative.',
    }),
    priorTurns: [],
    priorFacts: [],
    graph,
    compactedGraph: outcome.compact,
  });
  return buildUserMessage(pack, 'Compare the current approach with the alternative.');
}

function observedOptionNodes(prompt: string): Array<Record<string, unknown>> {
  const pack = observeSerialisedPack(prompt);
  const graph = pack.graph;
  if (typeof graph !== 'object' || graph === null) {
    throw new Error('expected serialised graph context');
  }
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) throw new Error('expected serialised graph nodes');
  return nodes.filter(
    (node): node is Record<string, unknown> =>
      typeof node === 'object' && node !== null && node.kind === 'option',
  );
}

describe('canonical baseline-option continuity', () => {
  it('moves the sole saved current-approach marker with the durable model fact', () => {
    const beforePrompt = promptForBaseline('opt_current');
    const afterPrompt = promptForBaseline('opt_change');
    const beforeOptions = observedOptionNodes(beforePrompt);
    const afterOptions = observedOptionNodes(afterPrompt);

    expect(beforeOptions.filter((node: Record<string, unknown>) => node.is_baseline === true)).toEqual([
      expect.objectContaining({ id: 'opt_current', label: 'Continue the current approach' }),
    ]);
    expect(afterOptions.filter((node: Record<string, unknown>) => node.is_baseline === true)).toEqual([
      expect.objectContaining({ id: 'opt_change', label: 'Adopt the alternative' }),
    ]);
    expect(beforePrompt).not.toContain('"is_baseline": false');
    expect(afterPrompt).not.toContain('"is_baseline": false');
  });

  it('does not infer a baseline from current-approach language', () => {
    expect(
      observedOptionNodes(promptForBaseline(null)).filter((node) => node.is_baseline === true),
    ).toEqual([]);
  });
});
