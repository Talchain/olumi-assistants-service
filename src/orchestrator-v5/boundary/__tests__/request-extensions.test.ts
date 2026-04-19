/**
 * Unit tests for Phase 1.5 request-extensions parser.
 *
 * Coverage targets from plan D2 (floor 8):
 *   1. valid graph passes
 *   2. missing graph → graphState: null (graceful)
 *   3. null graph → graphState: null (graceful)
 *   4. malformed graph (missing id on a node) → boundary error
 *   5. valid analysis passes
 *   6. missing analysis → analysisState: null
 *   7. malformed analysis (missing analysis_status) → boundary error
 *   8. extra unknown fields in analysis → accepted (passthrough)
 *   9. real fixture from ui-turn-with-graph.json passes end-to-end
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRequestExtensions } from '../request-extensions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'golden', 'ui-turn-with-graph.json');

describe('parseRequestExtensions', () => {
  const REQUEST_ID = 'test-req-1';

  it('accepts a valid graph_state and returns typed graphState', () => {
    const body = {
      graph_state: {
        nodes: [{ id: 'goal_1', kind: 'goal', label: 'Profit' }],
        edges: [],
      },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graphState).not.toBeNull();
      expect(result.value.graphState?.nodes).toHaveLength(1);
      expect(result.value.analysisState).toBeNull();
    }
  });

  it('returns graphState: null when graph_state is absent', () => {
    const result = parseRequestExtensions({ message: 'hi' }, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graphState).toBeNull();
      expect(result.value.analysisState).toBeNull();
    }
  });

  it('returns graphState: null when graph_state is explicitly null', () => {
    const result = parseRequestExtensions({ graph_state: null }, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graphState).toBeNull();
    }
  });

  it('rejects graph with a node missing id (structural failure)', () => {
    const body = {
      graph_state: {
        nodes: [{ kind: 'goal', label: 'No ID' }],
        edges: [],
      },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION');
      expect((result.error.details as { field?: string }).field).toBe('graph_state');
    }
  });

  it('rejects graph with an edge missing from (structural failure)', () => {
    const body = {
      graph_state: {
        nodes: [{ id: 'x', kind: 'goal', label: 'X' }],
        edges: [{ to: 'x' }],
      },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
  });

  it('accepts a valid analysis_state with only analysis_status', () => {
    const body = {
      analysis_state: { analysis_status: 'complete' },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.analysisState).not.toBeNull();
    }
  });

  it('accepts analysis without meta.response_hash (permissive per plan correction #1)', () => {
    const body = {
      analysis_state: { analysis_status: 'failed' }, // no meta at all
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.analysisState).not.toBeNull();
      expect(result.value.analysisState?.analysis_status).toBe('failed');
    }
  });

  it('passes through unknown extra fields on analysis_state', () => {
    const body = {
      analysis_state: {
        analysis_status: 'complete',
        weird_new_field: 'survives',
        meta: { response_hash: 'abc' },
      },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value.analysisState as unknown as { weird_new_field?: string })?.weird_new_field).toBe('survives');
    }
  });

  it('rejects analysis without analysis_status', () => {
    const body = {
      analysis_state: { meta: { response_hash: 'abc' } },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error.details as { field?: string }).field).toBe('analysis_state');
    }
  });

  it('accepts the real UI fixture end-to-end', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const result = parseRequestExtensions(fixture, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graphState).not.toBeNull();
      expect(result.value.graphState?.nodes.length).toBeGreaterThan(0);
      expect(result.value.graphState?.edges.length).toBeGreaterThan(0);
    }
  });

  it('passes through edges with strength details (wire shape)', () => {
    const body = {
      graph_state: {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'goal', label: 'B' },
        ],
        edges: [{ from: 'a', to: 'b', strength: { mean: 0.5, std: 0.1 } }],
      },
    };
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const edge = result.value.graphState?.edges[0] as { strength?: { mean: number } };
      expect(edge?.strength?.mean).toBe(0.5);
    }
  });
});
