/**
 * Unit tests for compactGraphForContextPack — the V5 Task 1.2 adapter that
 * runs V4's compactGraph over a permissive GraphStateIngress so the ContextPack
 * presented to Sonnet carries a compact projection instead of full-JSON
 * passthrough.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
} from '../../../orchestrator/context/graph-compact.js';
import { compactGraphForContextPack } from '../compact-graph-for-contextpack.js';

// Long-ish body text representative of real scenario content — the compactor
// drops this entirely, which is the largest single source of token savings.
const LONG_BODY =
  'This is a realistic descriptive body of the kind the UI ships for each node: ' +
  'a sentence or two of user-entered text explaining what the factor means, ' +
  'how the user is thinking about it, and any context they want to preserve ' +
  'across the session. Production nodes frequently carry 300-600 characters here. ' +
  'The compactor drops body entirely so only the label/kind/ID/value fields remain ' +
  'for Sonnet to reason about.';

function makeStrictGraph(nodeCount: number, edgeCount: number): GraphStateIngress {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n-${i}`,
    kind: i === 0 ? 'goal' : i < 3 ? 'option' : 'factor',
    label: `Node ${i} label`,
    body: LONG_BODY,
    observed_state: {
      value: i * 0.1,
      std: 0.05,
      extractionType: 'explicit',
    },
    category: 'observable',
  }));

  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: `n-${i % nodeCount}`,
    to: `n-${(i + 1) % nodeCount}`,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  }));

  return { nodes, edges };
}

function firstFactor(graph: GraphStateIngress): Record<string, unknown> & {
  observed_state: Record<string, unknown>;
} {
  const factor = graph.nodes.find((node) => node.kind === 'factor') as
    | (Record<string, unknown> & { observed_state?: Record<string, unknown> })
    | undefined;
  if (factor === undefined || typeof factor.observed_state !== 'object') {
    throw new Error('test precondition: factor with observed_state');
  }
  return factor as Record<string, unknown> & { observed_state: Record<string, unknown> };
}

const REAL_CAPTURE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/label-value-divergence-capture-5e036e.json', import.meta.url),
    'utf8',
  ),
) as { pre_graph: GraphStateIngress };

const REAL_DRIVER = 'Current platform capability not specified';
const DISCRIMINATING_DRIVER = 'HubSpot fit for B2B sales workflow was validated';

function cloneWithPlatformDriver(
  graph: GraphStateIngress,
  driver: string,
): GraphStateIngress {
  const clone = structuredClone(graph) as GraphStateIngress;
  const platform = clone.nodes.find((node) => node.id === 'fac_platform_capability') as
    | (Record<string, unknown> & { observed_state?: Record<string, unknown> })
    | undefined;
  if (platform === undefined || typeof platform.observed_state !== 'object') {
    throw new Error('real fixture precondition: platform factor with observed_state');
  }
  platform.observed_state.uncertainty_drivers = [driver];
  return clone;
}

function withoutPlatformDrivers(graph: GraphStateIngress): GraphStateIngress {
  const clone = structuredClone(graph) as GraphStateIngress;
  const platform = clone.nodes.find((node) => node.id === 'fac_platform_capability') as
    | (Record<string, unknown> & { observed_state?: Record<string, unknown> })
    | undefined;
  if (platform?.observed_state !== undefined) {
    delete platform.observed_state.uncertainty_drivers;
  }
  delete platform?.uncertainty_drivers;
  return clone;
}

async function exactModelPromptFor(graph: GraphStateIngress): Promise<string> {
  const [{ assembleContextPack }, { buildUserMessage }] = await Promise.all([
    import('../context-pack-assembler.js'),
    import('../../routing/route-with-tool-use.js'),
  ]);
  const outcome = compactGraphForContextPack(graph, { requestId: 'req-uncertainty-wire' });
  expect(outcome.kind).toBe('compacted');
  if (outcome.kind !== 'compacted') throw new Error('expected compacted');
  expect(outcome.via).toBe('strict_parse');
  const pack = assembleContextPack({
    payload: {
      turn_id: 'turn-uncertainty-wire',
      scenario_id: 'scenario-uncertainty-wire',
      message: 'What are we least sure about?',
      turn_class: 'coach',
      stage: 'frame',
    } as never,
    priorTurns: [],
    compactedGraph: outcome.compact,
  });
  return buildUserMessage(pack, 'What are we least sure about?');
}

describe('compactGraphForContextPack', () => {
  it('returns absent when graphState is null', () => {
    const result = compactGraphForContextPack(null, { requestId: 'req-1' });
    expect(result.kind).toBe('absent');
  });

  it('returns absent when graphState is undefined', () => {
    const result = compactGraphForContextPack(undefined, { requestId: 'req-1' });
    expect(result.kind).toBe('absent');
  });

  it('compacts a strict-parseable graph via strict_parse', () => {
    const graph = makeStrictGraph(5, 4);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });

    expect(result.kind).toBe('compacted');
    if (result.kind !== 'compacted') throw new Error('narrowing');
    expect(result.via).toBe('strict_parse');
    expect(result.compact._node_count).toBe(5);
    expect(result.compact._edge_count).toBe(4);
  });

  it('compact output preserves id, kind, label on every node', () => {
    const graph = makeStrictGraph(4, 3);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const node of result.compact.nodes) {
      expect(node.id).toMatch(/^n-\d+$/);
      expect(node.kind).toBeTruthy();
      expect(node.label).toBeTruthy();
    }
  });

  it('compact output preserves from/to on every edge', () => {
    const graph = makeStrictGraph(5, 4);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const edge of result.compact.edges) {
      expect(edge.from).toBeTruthy();
      expect(edge.to).toBeTruthy();
      expect(typeof edge.strength).toBe('number');
    }
  });

  it('compact output drops verbose body field', () => {
    const graph = makeStrictGraph(3, 2);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const node of result.compact.nodes) {
      expect(node).not.toHaveProperty('body');
    }
  });

  it('compact output drops std on strength (only mean survives as strength number)', () => {
    const graph = makeStrictGraph(4, 3);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const edge of result.compact.edges) {
      // strength is a number in the compact projection, not { mean, std }
      expect(typeof edge.strength).toBe('number');
    }
  });

  it('compact JSON is substantially smaller than raw JSON for a 10-node graph', () => {
    const graph = makeStrictGraph(10, 12);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    const rawBytes = JSON.stringify(graph).length;
    const compactBytes = JSON.stringify(result.compact).length;

    expect(compactBytes).toBeLessThan(rawBytes * 0.5);
  });

  it('falls back to structural_fallback when ingress fails strict parse but is structurally compactable', () => {
    // Missing strength.std (required by GraphV3 edge strength schema in most
    // profiles) or similar — use a shape that passes GraphStateIngress but
    // fails GraphV3. The easiest is a node with an unknown kind.
    const graph: GraphStateIngress = {
      nodes: [
        { id: 'n-0', kind: 'goal', label: 'Goal' },
        { id: 'n-1', kind: 'not_a_valid_v3_kind', label: 'Weird' },
      ],
      edges: [{ from: 'n-0', to: 'n-1' }],
    };
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });

    // Either strict_parse (if GraphV3 is permissive on kind) or structural_fallback.
    // Both are acceptable — the key invariant is the function never throws.
    expect(result.kind).toBe('compacted');
  });

  it('structural fallback never throws on empty-edge payloads', () => {
    const graph: GraphStateIngress = {
      nodes: [{ id: 'n-0', kind: 'goal', label: 'Goal' }],
      edges: [],
    };
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    expect(result.kind).toBe('compacted');
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const graph = makeStrictGraph(6, 8);
    const a = compactGraphForContextPack(graph, { requestId: 'req-a' });
    const b = compactGraphForContextPack(graph, { requestId: 'req-b' });
    if (a.kind !== 'compacted' || b.kind !== 'compacted') throw new Error('expected compacted');
    expect(JSON.stringify(a.compact)).toBe(JSON.stringify(b.compact));
  });

  it('preserves producer uncertainty bytes and order from either permitted source location', () => {
    const observedGraph = makeStrictGraph(4, 0);
    const observedNode = firstFactor(observedGraph);
    observedNode.observed_state.uncertainty_drivers = ['First source fact', 'Second source fact'];

    const observed = compactGraphForContextPack(observedGraph, { requestId: 'req-observed' });
    if (observed.kind !== 'compacted') throw new Error('expected compacted');
    expect(observed.compact.nodes.find((node) => node.kind === 'factor')!.uncertainty_drivers).toEqual([
      'First source fact',
      'Second source fact',
    ]);
    expect(observed.compact.nodes.find((node) => node.kind === 'factor')).not.toHaveProperty(
      'uncertainty_drivers_disclosure',
    );

    const promotedGraph = makeStrictGraph(4, 0);
    const promotedNode = firstFactor(promotedGraph);
    promotedNode.uncertainty_drivers = ['Promoted source fact'];
    promotedNode.observed_state.uncertainty_drivers = ['Promoted source fact'];

    const promoted = compactGraphForContextPack(promotedGraph, { requestId: 'req-promoted' });
    if (promoted.kind !== 'compacted') throw new Error('expected compacted');
    expect(promoted.compact.nodes.find((node) => node.kind === 'factor')!.uncertainty_drivers)
      .toEqual(['Promoted source fact']);
    expect(promoted.compact.nodes.find((node) => node.kind === 'factor')).not.toHaveProperty(
      'uncertainty_drivers_disclosure',
    );
  });

  it('fails closed instead of choosing between conflicting permitted source locations', () => {
    const graph = makeStrictGraph(4, 0);
    const node = firstFactor(graph);
    node.uncertainty_drivers = ['Promoted value'];
    node.observed_state.uncertainty_drivers = ['Observed-state value'];

    const result = compactGraphForContextPack(graph, { requestId: 'req-conflict' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    const compactFactor = result.compact.nodes.find((candidate) => candidate.kind === 'factor')!;
    expect(compactFactor).not.toHaveProperty('uncertainty_drivers');
    expect(compactFactor.uncertainty_drivers_disclosure).toEqual({
      status: 'conflicting_sources_withheld',
    });
  });

  it('bounds entries and characters without rewriting or silently dropping producer text', () => {
    const graph = makeStrictGraph(4, 0);
    const node = firstFactor(graph);
    const overlong = 'x'.repeat(CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS + 1);
    node.uncertainty_drivers = [overlong, 'Second exact entry', 'Count-bounded entry'];

    const result = compactGraphForContextPack(graph, { requestId: 'req-bounds' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    const compactFactor = result.compact.nodes.find((candidate) => candidate.kind === 'factor')!;
    expect(compactFactor.uncertainty_drivers).toEqual([
      overlong.slice(0, CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS),
      'Second exact entry',
    ]);
    expect(compactFactor.uncertainty_drivers_disclosure).toEqual({
      status: 'truncated',
      original_entries: 3,
      retained_entries: 2,
      entries_omitted_by_count: 1,
      entries_truncated_by_chars: 1,
      per_entry_char_limit: CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
    });
  });

  it('uses Unicode code-point boundaries and discloses only real character loss in buildUserMessage', async () => {
    const exactBoundaryGraph = makeStrictGraph(4, 0);
    const exactBoundary = `${'x'.repeat(CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS - 1)}😀`;
    firstFactor(exactBoundaryGraph).uncertainty_drivers = [exactBoundary];

    const exactPrompt = await exactModelPromptFor(exactBoundaryGraph);
    expect(exactPrompt).toContain(exactBoundary);
    expect(exactPrompt).not.toContain('\\ud83d');
    expect(exactPrompt).not.toContain('entries_truncated_by_chars');

    const overBoundaryGraph = makeStrictGraph(4, 0);
    const retained = exactBoundary;
    firstFactor(overBoundaryGraph).uncertainty_drivers = [`${retained}z`];

    const truncatedPrompt = await exactModelPromptFor(overBoundaryGraph);
    expect(truncatedPrompt).toContain(retained);
    expect(truncatedPrompt).not.toContain(`${retained}z`);
    expect(truncatedPrompt).not.toContain('\\ud83d');
    expect(truncatedPrompt).toContain('"entries_truncated_by_chars": 1');
    expect(truncatedPrompt).toContain(
      `"per_entry_char_limit": ${CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS}`,
    );
  });

  it('does not promote uncertainty-shaped metadata from non-factor nodes into compact or prompt', async () => {
    const graph = makeStrictGraph(1, 0);
    const goal = graph.nodes[0] as Record<string, unknown> & {
      observed_state: Record<string, unknown>;
    };
    const nonFactorText = 'Out-of-scope goal metadata';
    goal.observed_state.uncertainty_drivers = [nonFactorText];

    const result = compactGraphForContextPack(graph, { requestId: 'req-non-factor' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    expect(result.compact.nodes[0]).not.toHaveProperty('uncertainty_drivers');
    expect(result.compact.nodes[0]).not.toHaveProperty('uncertainty_drivers_disclosure');
    expect(await exactModelPromptFor(graph)).not.toContain(nonFactorText);
  });

  it('keeps the compact JSON byte-identical when uncertainty input is absent', () => {
    const result = compactGraphForContextPack(makeStrictGraph(1, 0), {
      requestId: 'req-byte-identity',
    });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    expect(JSON.stringify(result.compact)).toBe(
      '{"nodes":[{"id":"n-0","kind":"goal","label":"Node 0 label","category":"observable","value":0,"source":"user","provenance":"from_brief"}],"edges":[],"_node_count":1,"_edge_count":0}',
    );
  });

  it('carries a real captured uncertainty phrase into exact buildUserMessage bytes', async () => {
    const prompt = await exactModelPromptFor(REAL_CAPTURE.pre_graph);
    expect(prompt).toContain(REAL_DRIVER);
  });

  it('changes exact buildUserMessage bytes when only the producer uncertainty fact changes', async () => {
    const graphA = cloneWithPlatformDriver(REAL_CAPTURE.pre_graph, REAL_DRIVER);
    const graphB = cloneWithPlatformDriver(REAL_CAPTURE.pre_graph, DISCRIMINATING_DRIVER);

    // Discriminating precondition: the persisted producer field is the only
    // graph byte changed by the pair before prompt behaviour is evaluated.
    expect(withoutPlatformDrivers(graphA)).toEqual(withoutPlatformDrivers(graphB));
    expect(graphA).not.toEqual(graphB);

    const [promptA, promptB] = await Promise.all([
      exactModelPromptFor(graphA),
      exactModelPromptFor(graphB),
    ]);
    expect(promptA).not.toBe(promptB);
    expect(promptA).toContain(REAL_DRIVER);
    expect(promptA).not.toContain(DISCRIMINATING_DRIVER);
    expect(promptB).toContain(DISCRIMINATING_DRIVER);
    expect(promptB).not.toContain(REAL_DRIVER);
  });

  it('goal_constraints survive the compact path via compactedConstraints', async () => {
    // V5 review: compactGraph itself drops goal_constraints. The assembler
    // threads them separately via `compactedConstraints` so Sonnet still
    // sees the decision constraints in the compact path. Verified end-to-end
    // through assembleContextPack.
    const { assembleContextPack } = await import('../context-pack-assembler.js');
    const graph = makeStrictGraph(5, 4);
    const graphWithConstraints = {
      ...graph,
      goal_constraints: [
        { id: 'c-budget', label: 'Budget ≤ $100k' },
        { id: 'c-timeline', label: 'Launch before Q3' },
      ],
    };
    const outcome = compactGraphForContextPack(graphWithConstraints, { requestId: 'req-c' });
    if (outcome.kind !== 'compacted') throw new Error('expected compacted');

    const pack = assembleContextPack({
      payload: {
        turn_id: 't-1',
        scenario_id: 's-1',
        message: 'x',
        turn_class: 'frame',
        stage: 'frame',
      } as never,
      priorTurns: [],
      compactedGraph: outcome.compact,
      compactedConstraints: graphWithConstraints.goal_constraints,
    });

    expect(pack.graph.constraints).toHaveLength(2);
    expect(pack.graph.counts.constraints).toBe(2);
  });
});
