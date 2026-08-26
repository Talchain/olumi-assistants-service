import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { compactGraphForContextPack } from '../compact-graph-for-contextpack.js';
import { assembleContextPack } from '../context-pack-assembler.js';

function promptForDescription(description: string): string {
  const graph: GraphV3T = {
    nodes: [
      {
        id: 'fac_conversion',
        kind: 'factor',
        label: 'Enterprise conversion',
        description,
      },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ],
    edges: [],
  };
  const outcome = compactGraphForContextPack(graph, { requestId: 'req-description' });
  if (outcome.kind !== 'compacted' || outcome.via !== 'strict_parse') {
    throw new Error(`expected strict compaction, got ${JSON.stringify(outcome)}`);
  }

  const pack = assembleContextPack({
    payload: makeMessagePayload({
      scenario_id: 'scen-description-continuity',
      message: 'What should we explore next?',
    }),
    priorTurns: [],
    priorFacts: [],
    graph,
    compactedGraph: outcome.compact,
  });
  return buildUserMessage(pack, 'What should we explore next?');
}

describe('canonical node-description continuity', () => {
  it('replaces the prior saved rationale with the durable edited consequence on the next turn', () => {
    const before = 'Sales believes procurement delay is the main barrier.';
    const after = 'Pilot evidence now points to security review as the main barrier.';

    const beforePrompt = promptForDescription(before);
    const afterPrompt = promptForDescription(after);

    expect(beforePrompt).toContain(before);
    expect(beforePrompt).not.toContain(after);
    expect(afterPrompt).toContain(after);
    expect(afterPrompt).not.toContain(before);
    expect(afterPrompt).toContain('Enterprise conversion');
  });
});
