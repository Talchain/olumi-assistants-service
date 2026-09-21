/**
 * System B — causal-confidence authority at the ContextPack boundary.
 *
 * The lower compactor may classify a valid GraphV3 edge in isolation. The
 * model may receive that category only when the selected snapshot is both
 * canonical and strict-parsed. These tests bind the authority join, direct
 * caller fail-weak behaviour, prompt bytes, and budget preservation.
 */

import { describe, expect, it } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import type { GraphV3Compact } from '../../../orchestrator/context/graph-compact.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import {
  compactGraphForContextPack,
  compactSelectedGraphForContextPack,
} from '../compact-graph-for-contextpack.js';
import { selectContextGraphSnapshot } from '../context-graph-snapshot.js';

const PAYLOAD = {
  kind: 'message',
  source: 'composer',
  turn_id: '11111111-1111-4111-8111-111111111111',
  scenario_id: '22222222-2222-4222-8222-222222222222',
  message: 'Which relationship should we trust most?',
  turn_class: 'review',
  stage: 'analyse',
} satisfies MessageTurnPayload;

function graphWithStd(std: number, label = 'Canonical demand signal'): GraphStateIngress {
  return {
    nodes: [
      { id: 'factor_demand', kind: 'factor', label },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ],
    edges: [
      {
        from: 'factor_demand',
        to: 'goal_growth',
        strength: { mean: 0.55, std },
        exists_probability: 0.9,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  };
}

function strictCompact(std = 0.07): GraphV3Compact {
  const outcome = compactGraphForContextPack(graphWithStd(std), {
    requestId: `req-confidence-${std}`,
  });
  expect(outcome.kind).toBe('compacted');
  if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
  expect(outcome.via).toBe('strict_parse');
  expect(outcome.compact.edges[0]?.coefficient_confidence).toBeDefined();
  return outcome.compact;
}

function attestedCanonicalCompact(std = 0.07): GraphV3Compact {
  const graph = graphWithStd(std);
  const selection = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph },
    requestGraph: null,
  });
  const outcome = compactSelectedGraphForContextPack(selection, {
    requestId: `req-attested-confidence-${std}`,
  });
  expect(selection.status).toBe('canonical');
  expect(outcome.kind).toBe('compacted');
  if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
  expect(outcome.via).toBe('strict_parse');
  return outcome.compact;
}

function attestedDenseCanonicalCompact(): GraphV3Compact {
  const graph = graphWithStd(0.07);
  graph.nodes = [
    ...graph.nodes,
    ...Array.from({ length: 1_000 }, (_, index) => ({
      id: `factor_dense_${index}`,
      kind: 'factor',
      label: `Dense factor ${index}`,
      description: 'dense canonical context '.repeat(20),
    })),
  ];
  const selection = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph },
    requestGraph: null,
  });
  const outcome = compactSelectedGraphForContextPack(selection, {
    requestId: 'req-attested-dense-confidence',
  });
  expect(selection.status).toBe('canonical');
  expect(outcome.kind).toBe('compacted');
  if (outcome.kind !== 'compacted') throw new Error('expected dense compacted graph');
  expect(outcome.via).toBe('strict_parse');
  return outcome.compact;
}

function assemble(args: {
  status?: 'canonical' | 'provisional' | 'absent' | 'unavailable';
  graph?: GraphV3Compact;
}) {
  const pack = assembleContextPack({
    payload: PAYLOAD,
    priorTurns: [],
    ...(args.status === undefined ? {} : { graphContext: { status: args.status } }),
    compactedGraph: args.graph ?? strictCompact(),
  });
  return { pack, prompt: buildUserMessage(pack, PAYLOAD.message) };
}

interface PromptProjection {
  graph_context: { status: string };
  graph: { edges: ReadonlyArray<Record<string, unknown>> };
}

function promptGraph(prompt: string): PromptProjection {
  const marker = '## ContextPack\n';
  const start = prompt.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const source = prompt.slice(start + marker.length);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      return JSON.parse(source.slice(0, index + 1)) as PromptProjection;
    }
  }
  throw new Error('unterminated ContextPack JSON');
}

describe('canonical coefficient-confidence authority', () => {
  it('retains a strict producer category only for canonical state, through exact prompt bytes', () => {
    const compact = attestedCanonicalCompact(0.07);
    expect(compact.edges[0]?.coefficient_confidence).toBe('high');

    const { pack, prompt } = assemble({
      status: 'canonical',
      graph: compact,
    });

    expect(pack.graph.edges[0]).toHaveProperty('coefficient_confidence', 'high');
    expect(pack.display_graph.edges[0]?.coefficient_confidence).toBe('high');
    expect(promptGraph(prompt).graph.edges[0]?.coefficient_confidence).toBe('high');
    expect(prompt).not.toContain('"std"');
    expect(prompt).not.toContain('"plain_interpretation"');
    expect(prompt).not.toContain('0.07');
  });

  it.each(['provisional', 'absent', 'unavailable'] as const)(
    'strips even an attested category when graph_context=%s while retaining useful structure',
    (status) => {
      const { pack, prompt } = assemble({ status, graph: attestedCanonicalCompact() });
      expect(pack.graph.edges).toHaveLength(1);
      expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
      expect(pack.display_graph.edges[0]?.relationship).toBe('moderate positive link');
      expect(pack.display_graph.edges[0]).not.toHaveProperty('coefficient_confidence');
      expect(promptGraph(prompt).graph.edges[0]).not.toHaveProperty(
        'coefficient_confidence',
      );
      expect(promptGraph(prompt).graph_context.status).toBe(status);
    },
  );

  it('strips a strict but unattested direct compaction even when canonical is claimed', () => {
    const { pack, prompt } = assemble({ status: 'canonical', graph: strictCompact() });
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(prompt).not.toContain('coefficient_confidence');
  });

  it.each(['hand-built', 'cloned'] as const)(
    'cannot mint confidence from a %s canonical-selection lookalike',
    (mode) => {
      const graph = graphWithStd(0.07, 'FORGED REQUEST FACT');
      const realSelection = selectContextGraphSnapshot({
        canonicalRead: { status: 'ok_present', graph },
        requestGraph: null,
      });
      const selection =
        mode === 'hand-built'
          ? ({ status: 'canonical', graph, reason: 'persisted_valid' } as const)
          : structuredClone(realSelection);
      const outcome = compactSelectedGraphForContextPack(selection, {
        requestId: `req-${mode}-selection-lookalike`,
      });
      expect(outcome.kind).toBe('compacted');
      if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
      expect(outcome.via).toBe('strict_parse');
      expect(outcome.compact.edges[0]?.coefficient_confidence).toBe('high');

      const { pack, prompt } = assemble({
        status: 'canonical',
        graph: outcome.compact,
      });
      expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
      expect(prompt).not.toContain('coefficient_confidence');
    },
  );

  it('deep-freezes an attested provisional selection against status and toJSON promotion', () => {
    const graph = graphWithStd(0.07, 'PROVISIONAL REQUEST FACT');
    const selection = selectContextGraphSnapshot({
      canonicalRead: { status: 'ok_absent' },
      requestGraph: graph,
    });
    expect(selection.status).toBe('provisional');
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.graph)).toBe(true);
    expect(Object.isFrozen(graph)).toBe(false);
    const mutable = selection as unknown as Record<string, unknown>;
    expect(() => {
      mutable.status = 'canonical';
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(mutable, 'toJSON', {
        value: () => ({
          status: 'provisional',
          graph: graphWithStd(0.07, 'PROVISIONAL REQUEST FACT'),
          reason: 'persisted_absent_request_valid',
        }),
      });
    }).toThrow(TypeError);

    const outcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-mutated-provisional-selection',
    });
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    const { pack, prompt } = assemble({ status: 'canonical', graph: outcome.compact });
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(prompt).not.toContain('coefficient_confidence');
  });

  it('deep-freezes canonical selection graph bytes without freezing request-first input', () => {
    const graph = graphWithStd(0.07, 'Original canonical fact');
    graph.nodes[0]!.observed_state = {
      value: 0.4,
      source: 'brief_extraction',
      nested_passthrough: { note: 'original node metadata remains mutable' },
    };
    graph.goal_constraints = [
      {
        constraint_id: 'constraint_growth',
        node_id: 'goal_growth',
        operator: '>=',
        value: 0.8,
        provenance: 'explicit',
      },
    ];
    const originalStrength = graph.edges[0]!.strength as Record<string, unknown>;
    const originalProvenance = graph.edges[0]!.provenance as Record<string, unknown>;
    const originalObserved = graph.nodes[0]!.observed_state as Record<string, unknown>;
    const originalObservedNested = originalObserved.nested_passthrough as Record<
      string,
      unknown
    >;
    const originalConstraint = graph.goal_constraints[0] as Record<string, unknown>;
    const selection = selectContextGraphSnapshot({
      canonicalRead: { status: 'ok_present', graph },
      requestGraph: null,
    });
    expect(selection.status).toBe('canonical');
    if (selection.status !== 'canonical') throw new Error('expected canonical selection');
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.graph)).toBe(true);
    expect(Object.isFrozen(selection.graph.edges)).toBe(true);
    expect(Object.isFrozen(selection.graph.edges[0])).toBe(true);
    expect(Object.isFrozen(graph)).toBe(false);
    expect(Object.isFrozen(originalStrength)).toBe(false);
    expect(Object.isFrozen(originalProvenance)).toBe(false);
    expect(Object.isFrozen(originalObserved)).toBe(false);
    expect(Object.isFrozen(originalObservedNested)).toBe(false);
    expect(Object.isFrozen(originalConstraint)).toBe(false);
    expect(selection.graph.edges[0]!.strength).not.toBe(originalStrength);
    expect(selection.graph.edges[0]!.provenance).not.toBe(originalProvenance);
    expect(selection.graph.nodes[0]!.observed_state).not.toBe(originalObserved);
    expect(selection.graph.goal_constraints?.[0]).not.toBe(originalConstraint);
    expect(Object.isFrozen(selection.graph.edges[0]!.strength)).toBe(true);
    expect(Object.isFrozen(selection.graph.edges[0]!.provenance)).toBe(true);
    expect(Object.isFrozen(selection.graph.nodes[0]!.observed_state)).toBe(true);
    expect(Object.isFrozen(selection.graph.goal_constraints?.[0])).toBe(true);
    const edge = selection.graph.edges[0] as Record<string, unknown>;
    expect(() => {
      edge.strength = { mean: 0.55, std: 0.25 };
    }).toThrow(TypeError);
    originalStrength.std = 0.25;
    originalObservedNested.note = 'mutation-side metadata changed safely';
    originalConstraint.value = 0.9;
    expect(
      (selection.graph.edges[0]!.strength as Record<string, unknown>).std,
    ).toBe(0.07);
    expect(
      (
        (selection.graph.nodes[0]!.observed_state as Record<string, unknown>)
          .nested_passthrough as Record<string, unknown>
      ).note,
    ).toBe('original node metadata remains mutable');
    expect(
      (selection.graph.goal_constraints?.[0] as Record<string, unknown>).value,
    ).toBe(0.8);

    const outcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-mutated-canonical-selection-graph',
    });
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.compact.edges[0]?.coefficient_confidence).toBe('high');
    const { pack, prompt } = assemble({ status: 'canonical', graph: outcome.compact });
    expect(pack.graph.edges[0]).toHaveProperty('coefficient_confidence', 'high');
    expect(prompt).toContain('coefficient_confidence');
  });

  it('strips a clone of an attested compact object', () => {
    const clone = structuredClone(attestedCanonicalCompact());
    const { pack, prompt } = assemble({ status: 'canonical', graph: clone });
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(prompt).not.toContain('coefficient_confidence');
  });

  it('deep-freezes an attested compact object against category and toJSON mutation', () => {
    const compact = attestedCanonicalCompact(0.07);
    expect(compact.edges[0]?.coefficient_confidence).toBe('high');
    expect(Object.isFrozen(compact)).toBe(true);
    expect(Object.isFrozen(compact.edges)).toBe(true);
    expect(Object.isFrozen(compact.edges[0])).toBe(true);
    expect(() => {
      compact.edges[0]!.coefficient_confidence = 'uncertain';
    }).toThrow(TypeError);
    expect(() => {
      Object.defineProperty(compact, 'toJSON', {
        value: () => ({ nodes: compact.nodes, edges: compact.edges }),
      });
    }).toThrow(TypeError);

    const { pack, prompt } = assemble({ status: 'canonical', graph: compact });
    expect(pack.graph.edges[0]).toHaveProperty('coefficient_confidence', 'high');
    expect(prompt).toContain('"coefficient_confidence": "high"');
    expect(prompt).not.toContain('"uncertain"');
  });

  it('strips canonical structural fallback confidence canaries', () => {
    const structuralGraph: GraphStateIngress = {
      nodes: [
        { id: 'assumption_demand', kind: 'assumption', label: 'Demand assumption' },
        { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
      ],
      edges: [{ from: 'assumption_demand', to: 'goal_growth' }],
    };
    const selection = selectContextGraphSnapshot({
      canonicalRead: { status: 'ok_present', graph: structuralGraph },
      requestGraph: null,
    });
    const outcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-structural-confidence',
    });
    expect(selection.status).toBe('canonical');
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected structural fallback');
    expect(outcome.via).toBe('structural_fallback');
    outcome.compact.edges[0]!.coefficient_confidence = 'high';
    const { pack, prompt } = assemble({ status: 'canonical', graph: outcome.compact });
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(prompt).not.toContain('coefficient_confidence');
  });

  it('strips confidence injected through the raw graph fallback', () => {
    const raw = graphWithStd(0.07) as GraphStateIngress & {
      edges: Array<Record<string, unknown>>;
    };
    raw.edges[0]!.coefficient_confidence = 'high';
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      graphContext: { status: 'canonical' },
      graph: raw,
    });
    const prompt = buildUserMessage(pack, PAYLOAD.message);
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(pack.display_graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(prompt).not.toContain('coefficient_confidence');
  });

  it('treats direct/legacy graph-context omission as unavailable', () => {
    const { pack, prompt } = assemble({ graph: attestedCanonicalCompact() });
    expect(pack.graph_context).toEqual({ status: 'unavailable' });
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
    expect(promptGraph(prompt).graph_context).toEqual({ status: 'unavailable' });
    expect(prompt).not.toContain('coefficient_confidence');
  });

  it('keeps canonical persisted std authoritative when request std and labels disagree', () => {
    const canonical = graphWithStd(0.07);
    const request = graphWithStd(0.25, 'REQUEST ONLY demand claim');
    const selection = selectContextGraphSnapshot({
      canonicalRead: { status: 'ok_present', graph: canonical },
      requestGraph: request,
    });
    expect(selection.status).toBe('canonical');
    expect(selection.graph).toEqual(canonical);

    const outcome = compactGraphForContextPack(selection.graph, {
      requestId: 'req-canonical-request-disagreement',
    });
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('strict_parse');
    expect(outcome.compact.edges[0]?.coefficient_confidence).toBe('high');

    const attestedOutcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-attested-canonical-request-disagreement',
    });
    expect(attestedOutcome.kind).toBe('compacted');
    if (attestedOutcome.kind !== 'compacted') throw new Error('expected compacted graph');
    const { prompt } = assemble({
      status: selection.status,
      graph: attestedOutcome.compact,
    });
    expect(prompt).toContain('Canonical demand signal');
    expect(prompt).toContain('"coefficient_confidence": "high"');
    expect(prompt).not.toContain('REQUEST ONLY demand claim');
    expect(prompt).not.toContain('"coefficient_confidence": "uncertain"');
    expect(prompt).not.toContain('0.25');
  });

  it('preserves licensed confidence through graph compaction pressure and strips it before pressure otherwise', () => {
    const bulky = attestedDenseCanonicalCompact();

    const canonical = assemble({
      status: 'canonical',
      graph: bulky,
    }).pack;
    const provisionalWithCanary = assemble({
      status: 'provisional',
      graph: bulky,
    }).pack;
    const withoutCanary = structuredClone(bulky);
    delete withoutCanary.edges[0]!.coefficient_confidence;
    const provisionalWithoutCanary = assemble({
      status: 'provisional',
      graph: withoutCanary,
    }).pack;

    expect(canonical.context_budget?.truncations).toContainEqual(
      expect.objectContaining({ section: 'graph' }),
    );
    expect(canonical.graph.edges[0]).toHaveProperty('coefficient_confidence', 'high');
    expect(canonical.display_graph.edges[0]?.coefficient_confidence).toBe('high');
    expect(provisionalWithCanary.graph.edges[0]).not.toHaveProperty(
      'coefficient_confidence',
    );
    expect(provisionalWithCanary.display_graph.edges[0]).not.toHaveProperty(
      'coefficient_confidence',
    );
    expect(provisionalWithCanary.context_budget?.truncations).toContainEqual(
      expect.objectContaining({ section: 'graph' }),
    );
    expect(provisionalWithCanary).toEqual(provisionalWithoutCanary);
  });
});
