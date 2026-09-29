/**
 * Canonical ContextPack authority at the real persistence boundary.
 *
 * A store-factory/configuration failure used to collapse to `ok_absent` in
 * `buildTurnContext`. That licensed a valid request graph as provisional even
 * though a persisted authenticated model might exist. This drives the actual
 * production read boundary and then the pure selector, so the test fails if
 * either half reintroduces absence-means-permission.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => {
    throw new Error('store configuration unavailable');
  },
}));

import { buildTurnContext } from '../../build-turn-context.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { selectContextGraphSnapshot } from '../context-graph-snapshot.js';

const REQUEST_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Accelerate growth' },
    { id: 'opt_focus', kind: 'option', label: 'Focus the market' },
  ],
  edges: [],
};

describe('canonical graph read boundary', () => {
  it('maps store-factory failure to unavailable and rejects request fallback', async () => {
    const context = await buildTurnContext(
      makeMessagePayload({
        scenario_id: '2d8ab6cb-0e69-4cfb-b0a2-2a7cb28e3975',
        turn_id: 'c1380d35-75b3-42f2-a574-90c1dacbc917',
        message: 'Continue with the current model.',
      }),
      'req-store-boundary',
    );

    expect(context.persistedGraphRead).toEqual({
      status: 'degraded',
      errorCode: 'session_store_unavailable',
    });

    const selected = selectContextGraphSnapshot({
      canonicalRead: context.persistedGraphRead,
      requestGraph: REQUEST_GRAPH,
    });
    expect(selected).toEqual({
      status: 'unavailable',
      graph: null,
      reason: 'canonical_read_degraded',
    });
  });
});
