/**
 * Wave-4 δ2 / 1.135 — clickable coach copy: coaching blocks populate their
 * existing `target_refs` from the shared δ1 resolver so the UI (A2-U2) can render
 * entity names as links. Reuses `target_refs` — ZERO schema change (D-53-3).
 *
 * Fail-closed: a bare-generic ("cost") or ambiguous (duplicate label) mention is
 * NOT linked; only a distinctively-named node links.
 */
import { describe, expect, it } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import {
  buildCoachingBlocks,
  buildGraphNodeLookupFromGraph,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

const CTX: BlockBuildCtx = {
  created_at: '2026-07-23T00:00:00.000Z',
  graph_hash_at_generation: 'gh_clickable_0001',
};

function factWithAssumptions(assumptions: string[]): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-clickable',
      leading_option_id: null,
      summary: 'x',
      graph_hash_at_run: 'gh_clickable_0001',
      enrichment: { decision_review: { key_assumptions: assumptions } },
    },
  } as unknown as RunAnalysisHandlerFact;
}

const LOOKUP = buildGraphNodeLookupFromGraph({
  nodes: [
    { id: 'fac_ttm', label: 'Time to market', kind: 'factor' },
    { id: 'fac_cost', label: 'Cost', kind: 'factor' }, // bare-generic single word
    { id: 'opt_k8s', label: 'Kubernetes migration', kind: 'option' },
  ],
  edges: [],
});

describe('1.135 — coaching-block target_refs are populated from named entities', () => {
  it('POSITIVE CONTROL: an assumption naming a distinctive node links it', () => {
    const blocks = buildCoachingBlocks(
      factWithAssumptions(['We assume the Kubernetes migration completes before launch.']),
      LOOKUP,
      CTX,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.target_refs).toEqual([
      { id: 'opt_k8s', label: 'Kubernetes migration', kind: 'option' },
    ]);
  });

  it('does NOT link a bare-generic single word ("cost") — fail-closed', () => {
    const blocks = buildCoachingBlocks(
      factWithAssumptions(['The cost estimates carry a wide margin of error.']),
      LOOKUP,
      CTX,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.target_refs).toEqual([]);
  });

  it('does NOT link EITHER node when the named label is ambiguous (duplicate)', () => {
    const dupLookup = buildGraphNodeLookupFromGraph({
      nodes: [
        { id: 'fac_price_a', label: 'Selling price', kind: 'factor' },
        { id: 'fac_price_b', label: 'selling price', kind: 'factor' },
      ],
      edges: [],
    });
    const blocks = buildCoachingBlocks(
      factWithAssumptions(['The selling price assumption is load-bearing.']),
      dupLookup,
      CTX,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.target_refs).toEqual([]);
  });
});
