import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { compactGraphForContextPack } from '../compact-graph-for-contextpack.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

type OptionId = 'opt_current' | 'opt_change';

function promptForBaselines(baselineIds: readonly OptionId[]): string {
  const graph: GraphV3T = {
    nodes: [
      {
        id: 'opt_current',
        kind: 'option',
        label: 'Continue the current approach',
        is_baseline: baselineIds.includes('opt_current'),
      },
      {
        id: 'opt_change',
        kind: 'option',
        label: 'Adopt the alternative',
        is_baseline: baselineIds.includes('opt_change'),
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
    graphContext: { status: 'canonical' },
    graph,
    compactedGraph: outcome.compact,
  });
  return buildUserMessage(pack, 'Compare the current approach with the alternative.');
}

function promptForBaseline(baselineId: OptionId | null): string {
  return promptForBaselines(baselineId === null ? [] : [baselineId]);
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

function observedOptions(prompt: string): Array<Record<string, unknown>> {
  const pack = observeSerialisedPack(prompt);
  const graph = pack.graph;
  if (typeof graph !== 'object' || graph === null) {
    throw new Error('expected serialised graph context');
  }
  const options = (graph as { options?: unknown }).options;
  if (!Array.isArray(options)) throw new Error('expected serialised graph options');
  return options.filter(
    (option): option is Record<string, unknown> =>
      typeof option === 'object' && option !== null,
  );
}

type GraphContextStatus = 'canonical' | 'provisional' | 'unavailable';

function promptFromConflictingRawOptions(status?: GraphContextStatus): string {
  const graph = {
    nodes: [
      {
        id: 'opt_current',
        kind: 'option',
        label: 'Saved current approach',
        is_baseline: true,
      },
      { id: 'opt_change', kind: 'option', label: 'Alternative' },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ],
    edges: [],
    options: [
      {
        id: 'opt_current',
        label: 'Saved current approach',
        is_baseline: false,
        decision_score: 0.01,
      },
      {
        id: 'opt_change',
        label: 'Alternative',
        is_baseline: true,
        decision_score: 0.99,
        status: 'ready',
        interventions: { fac_cost: 1 },
      },
    ],
  };
  const pack = assembleContextPack({
    payload: makeMessagePayload({
      scenario_id: 'scen-baseline-option-direct',
      message: 'Compare the current approach with the alternative.',
    }),
    priorTurns: [],
    priorFacts: [],
    ...(status === undefined ? {} : { graphContext: { status } }),
    graph,
  });
  return buildUserMessage(pack, 'Compare the current approach with the alternative.');
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
    expect(observeSerialisedPack(beforePrompt).graph_context).toEqual({ status: 'canonical' });
    expect(observeSerialisedPack(afterPrompt).graph_context).toEqual({ status: 'canonical' });
  });

  it('does not infer a baseline from current-approach language', () => {
    expect(
      observedOptionNodes(promptForBaseline(null)).filter((node) => node.is_baseline === true),
    ).toEqual([]);
  });

  it('transports multiple literal producer facts without becoming a baseline adjudicator', () => {
    expect(
      observedOptionNodes(promptForBaselines(['opt_current', 'opt_change']))
        .filter((node) => node.is_baseline === true)
        .map((node) => node.id),
    ).toEqual(['opt_change', 'opt_current']);
  });

  it.each([
    ['canonical', 'canonical'],
    ['provisional', 'provisional'],
    ['unavailable', 'unavailable'],
    ['omitted', 'unavailable'],
  ] as const)(
    'raw/direct %s context cannot create a second baseline or ranking authority',
    (inputStatus, expectedStatus) => {
      const prompt = promptFromConflictingRawOptions(
        inputStatus === 'omitted' ? undefined : inputStatus,
      );
      const pack = observeSerialisedPack(prompt);
      const optionNodes = observedOptionNodes(prompt);
      const options = observedOptions(prompt);

      expect(pack.graph_context).toEqual({ status: expectedStatus });
      expect(optionNodes.filter((node) => node.is_baseline === true)).toEqual([
        expect.objectContaining({ id: 'opt_current', label: 'Saved current approach' }),
      ]);
      expect(options).toEqual([
        { id: 'opt_current', label: 'Saved current approach' },
        { id: 'opt_change', label: 'Alternative' },
      ]);
      expect(JSON.stringify(options)).not.toMatch(
        /is_baseline|decision_score|status|interventions/,
      );
    },
  );
});
