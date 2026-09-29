import { describe, expect, it } from 'vitest';
import { registerConstructedGraph } from '../runtime/construction-registration.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const scenarioId = '550e8400-e29b-41d4-a716-446655440000';
const brief = 'What matters here?';

describe('shared constructor registration boundary', () => {
  it('refuses an empty but schema-valid graph before any canonical write', async () => {
    const calls: string[] = [];
    const dispatch: InternalDispatch = async (path) => {
      calls.push(path);
      return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    };

    const result = await registerConstructedGraph({ scenarioId, brief, graph: { nodes: [], edges: [] }, dispatch });

    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_empty' });
    expect(calls).toEqual([]);
  });

  it('still writes a nonempty GraphV3 through canonical registration', async () => {
    const calls: string[] = [];
    const dispatch: InternalDispatch = async (path) => {
      calls.push(path);
      if (path.endsWith('/graph/register')) return { status: 200, json: { model_version: { version_number: 1 } } };
      return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    };
    const graph = { nodes: [{ id: 'a', kind: 'factor', label: 'A' }], edges: [] };

    const result = await registerConstructedGraph({ scenarioId, brief, graph, dispatch });

    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(calls.filter((path) => path.endsWith('/graph/register'))).toHaveLength(1);
  });
});
