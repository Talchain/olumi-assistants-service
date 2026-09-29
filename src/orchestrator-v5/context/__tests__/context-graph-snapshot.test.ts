import { describe, expect, it } from 'vitest';

import { selectContextGraphSnapshot } from '../context-graph-snapshot.js';

function graph(revision: number, label = `Graph revision ${revision}`) {
  return {
    revision,
    nodes: [{ id: 'goal-1', kind: 'goal', label }],
    edges: [],
  };
}

describe('selectContextGraphSnapshot', () => {
  describe('canonical persisted authority', () => {
    it.each([
      ['same', 7],
      ['stale', 6],
      ['newer', 8],
    ] as const)(
      'selects the persisted graph when the request appears %s',
      (_relationship, requestRevision) => {
        const persisted = graph(7, 'Saved Living Model');
        const request = graph(requestRevision, 'Caller graph');

        expect(
          selectContextGraphSnapshot({
            canonicalRead: { status: 'ok_present', graph: persisted },
            requestGraph: request,
          }),
        ).toEqual({
          status: 'canonical',
          graph: persisted,
          reason: 'persisted_valid',
        });
      },
    );

    it('keeps an explicitly persisted empty graph canonical', () => {
      const persisted = { revision: 3, nodes: [], edges: [] };

      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'ok_present', graph: persisted },
          requestGraph: graph(4),
        }),
      ).toEqual({
        status: 'canonical',
        graph: persisted,
        reason: 'persisted_valid',
      });
    });
  });

  describe('explicitly absent persisted state', () => {
    it('selects a valid non-empty request graph as provisional', () => {
      const request = graph(1, 'First-touch model');

      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'ok_absent' },
          requestGraph: request,
        }),
      ).toEqual({
        status: 'provisional',
        graph: request,
        reason: 'persisted_absent_request_valid',
      });
    });

    it('reports absent when no request graph is supplied', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'ok_absent' },
          requestGraph: null,
        }),
      ).toEqual({
        status: 'absent',
        graph: null,
        reason: 'persisted_absent_no_request',
      });
    });

    it('reports absent for an empty request graph', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'ok_absent' },
          requestGraph: { nodes: [], edges: [] },
        }),
      ).toEqual({
        status: 'absent',
        graph: null,
        reason: 'persisted_absent_request_empty',
      });
    });

    it('reports absent for a malformed request graph', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'ok_absent' },
          requestGraph: {
            nodes: [{ id: 'goal-1', kind: 'goal' }],
            edges: [],
          },
        }),
      ).toEqual({
        status: 'absent',
        graph: null,
        reason: 'persisted_absent_request_invalid_shape',
      });
    });

    it('reports absent for an out-of-bounds request graph', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'ok_absent' },
          requestGraph: {
            ...graph(1),
            edges: [
              {
                from: 'goal-1',
                to: 'goal-1',
                exists_probability: 1.1,
              },
            ],
          },
        }),
      ).toEqual({
        status: 'absent',
        graph: null,
        reason: 'persisted_absent_request_invalid_numeric',
      });
    });
  });

  describe('unavailable canonical authority', () => {
    it('does not promote a request graph when the canonical read degraded', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: { status: 'degraded', errorCode: 'read_failed' },
          requestGraph: graph(9),
        }),
      ).toEqual({
        status: 'unavailable',
        graph: null,
        reason: 'canonical_read_degraded',
      });
    });

    it('reports unavailable for malformed persisted state', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: {
            status: 'ok_present',
            graph: { nodes: [{ id: 'goal-1', kind: 'goal' }], edges: [] },
          },
          requestGraph: graph(9),
        }),
      ).toEqual({
        status: 'unavailable',
        graph: null,
        reason: 'persisted_invalid_shape',
      });
    });

    it('reports unavailable for out-of-bounds persisted state', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: {
            status: 'ok_present',
            graph: {
              ...graph(7),
              edges: [
                {
                  from: 'goal-1',
                  to: 'goal-1',
                  strength: { mean: 1.1, std: 0.1 },
                },
              ],
            },
          },
          requestGraph: graph(9),
        }),
      ).toEqual({
        status: 'unavailable',
        graph: null,
        reason: 'persisted_invalid_numeric',
      });
    });

    it('treats a missing canonical read state as unavailable', () => {
      expect(
        selectContextGraphSnapshot({
          canonicalRead: undefined,
          requestGraph: graph(1),
        }),
      ).toEqual({
        status: 'unavailable',
        graph: null,
        reason: 'canonical_read_state_missing',
      });
    });
  });
});
