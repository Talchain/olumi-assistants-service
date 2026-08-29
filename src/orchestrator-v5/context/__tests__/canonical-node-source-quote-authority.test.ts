/** Authority matrix for the final source_quote / label_authored overlay. */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import type { GraphV3Compact } from '../../../orchestrator/context/graph-compact.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  SOURCE_QUOTES_INSTRUCTION,
  buildUserMessage,
} from '../../routing/route-with-tool-use.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../context-pack-assembler.js';
import {
  compactGraphForContextPack,
  compactSelectedGraphForContextPack,
  getCanonicalStrictNodeSourceEvidence,
} from '../compact-graph-for-contextpack.js';
import {
  selectContextGraphSnapshot,
  type GraphContextStatus,
} from '../context-graph-snapshot.js';
import { bindCanonicalNodeSourceEvidence } from '../node-source-quote-context.js';

const PAYLOAD = {
  kind: 'message',
  source: 'composer',
  turn_id: '71111111-1111-4111-8111-111111111111',
  scenario_id: '72222222-2222-4222-8222-222222222222',
  message: 'What did we record?',
  turn_class: 'review',
  stage: 'frame',
} satisfies MessageTurnPayload;

function sourceGraph(quote = 'Exact canonical wording'): GraphStateIngress {
  return {
    nodes: [
      {
        id: 'goal',
        kind: 'goal',
        label: 'Canonical goal label',
        source_quote: quote,
        label_authored: true,
      },
    ],
    edges: [],
  } as GraphStateIngress;
}

function selectedCompact(
  canonicalGraph: GraphStateIngress = sourceGraph(),
): GraphV3Compact {
  const selection = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph: canonicalGraph },
    requestGraph: null,
  });
  const outcome = compactSelectedGraphForContextPack(selection, {
    requestId: 'req-authority-positive',
  });
  expect(outcome.kind).toBe('compacted');
  if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
  return outcome.compact;
}

function basePack(
  compactedGraph: GraphV3Compact | null,
  status: GraphContextStatus,
): ContextPack {
  return assembleContextPack({
    payload: PAYLOAD,
    priorTurns: [],
    graphContext: { status },
    compactedGraph,
  });
}

function attempt(
  compactedGraph: GraphV3Compact | null,
  status: GraphContextStatus,
): { readonly base: ContextPack; readonly bound: ContextPack } {
  const base = basePack(compactedGraph, status);
  return {
    base,
    bound: bindCanonicalNodeSourceEvidence({
      basePack: base,
      compactedGraph,
      message: PAYLOAD.message,
    }),
  };
}

describe('canonical node source evidence authority', () => {
  it('keeps the private evidence accessor on its definition plus one final-egress consumer', () => {
    const root = resolve(process.cwd(), 'src');
    const files = [
      'orchestrator-v5/context/compact-graph-for-contextpack.ts',
      'orchestrator-v5/context/node-source-quote-context.ts',
    ];
    const productionSources = (readdirSync(root, {
      recursive: true,
      encoding: 'utf8',
    }) as string[]).filter(
      (file) => file.endsWith('.ts') && !file.includes('/__tests__/'),
    );
    const consumers = productionSources
      .filter((file) =>
        readFileSync(resolve(root, file), 'utf8').includes(
          'getCanonicalStrictNodeSourceEvidence',
        ),
      )
      .sort();
    expect(consumers).toEqual([...files].sort());
  });

  it('licenses only the exact selector-attested canonical strict compaction', () => {
    const compact = selectedCompact();
    expect(getCanonicalStrictNodeSourceEvidence(compact)?.nodes[0]).toEqual({
      id: 'goal',
      kind: 'goal',
      source_quote: 'Exact canonical wording',
      label_authored: true,
    });
    expect(compact.nodes[0]).not.toHaveProperty('source_quote');
    expect(compact.nodes[0]).not.toHaveProperty('label_authored');

    const { base, bound } = attempt(compact, 'canonical');
    expect(bound).not.toBe(base);
    expect(bound.graph.nodes[0]).not.toHaveProperty('source_quote');
    expect(bound.display_graph.nodes[0]).toMatchObject({
      source_quote: 'Exact canonical wording',
      label_authored: true,
    });
    expect(bound.display_graph.goals[0]).toBe(bound.display_graph.nodes[0]);
    expect(buildUserMessage(bound, PAYLOAD.message).split(SOURCE_QUOTES_INSTRUCTION)).toHaveLength(
      2,
    );
  });

  it.each(['provisional', 'absent', 'unavailable'] as const)(
    'returns the exact feature-off pack for graph_context=%s',
    (status) => {
      const result = attempt(selectedCompact(), status);
      expect(result.bound).toBe(result.base);
      expect(buildUserMessage(result.bound, PAYLOAD.message)).not.toContain(
        SOURCE_QUOTES_INSTRUCTION,
      );
    },
  );

  it('rejects direct strict compaction, compact clones, and cloned selector records', () => {
    const directOutcome = compactGraphForContextPack(sourceGraph(), {
      requestId: 'req-direct',
    });
    expect(directOutcome.kind).toBe('compacted');
    if (directOutcome.kind !== 'compacted') throw new Error('expected direct compact');
    const directAttempt = attempt(directOutcome.compact, 'canonical');
    expect(directAttempt.bound).toBe(directAttempt.base);

    const attested = selectedCompact();
    const clonedCompact = structuredClone(attested);
    const cloneAttempt = attempt(clonedCompact, 'canonical');
    expect(cloneAttempt.bound).toBe(cloneAttempt.base);
    expect(getCanonicalStrictNodeSourceEvidence(clonedCompact)).toBeUndefined();

    const selection = selectContextGraphSnapshot({
      canonicalRead: { status: 'ok_present', graph: sourceGraph() },
      requestGraph: null,
    });
    const clonedSelectionOutcome = compactSelectedGraphForContextPack(
      structuredClone(selection),
      { requestId: 'req-cloned-selection' },
    );
    expect(clonedSelectionOutcome.kind).toBe('compacted');
    if (clonedSelectionOutcome.kind !== 'compacted') {
      throw new Error('expected cloned selection compact');
    }
    const clonedSelectionAttempt = attempt(
      clonedSelectionOutcome.compact,
      'canonical',
    );
    expect(clonedSelectionAttempt.bound).toBe(clonedSelectionAttempt.base);
  });

  it('fails weak if the finished display projection does not exact-join the compact label', () => {
    const compact = selectedCompact();
    const base = basePack(compact, 'canonical');
    const mismatched: ContextPack = {
      ...base,
      display_graph: {
        ...base.display_graph,
        nodes: base.display_graph.nodes.map((node, index) =>
          index === 0 ? { ...node, label: 'DIFFERENT DISPLAY LABEL' } : node,
        ),
      },
    };
    const bound = bindCanonicalNodeSourceEvidence({
      basePack: mismatched,
      compactedGraph: compact,
      message: PAYLOAD.message,
    });
    expect(bound).toBe(mismatched);
    expect(buildUserMessage(bound, PAYLOAD.message)).not.toContain(
      'Exact canonical wording',
    );
  });

  it('rejects provisional and structural-fallback compactions', () => {
    const provisional = selectContextGraphSnapshot({
      canonicalRead: { status: 'ok_absent' },
      requestGraph: sourceGraph('REQUEST-CANARY'),
    });
    expect(provisional.status).toBe('provisional');
    const provisionalOutcome = compactSelectedGraphForContextPack(provisional, {
      requestId: 'req-provisional',
    });
    expect(provisionalOutcome.kind).toBe('compacted');
    if (provisionalOutcome.kind !== 'compacted') throw new Error('expected provisional compact');
    const provisionalAttempt = attempt(provisionalOutcome.compact, 'provisional');
    expect(provisionalAttempt.bound).toBe(provisionalAttempt.base);
    expect(buildUserMessage(provisionalAttempt.bound, PAYLOAD.message)).not.toContain(
      'REQUEST-CANARY',
    );

    const malformed = sourceGraph() as unknown as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    malformed.nodes[0]!.kind = 'assumption';
    const canonical = selectContextGraphSnapshot({
      canonicalRead: {
        status: 'ok_present',
        graph: malformed as unknown as GraphStateIngress,
      },
      requestGraph: null,
    });
    const structuralOutcome = compactSelectedGraphForContextPack(canonical, {
      requestId: 'req-structural',
    });
    expect(structuralOutcome.kind).toBe('compacted');
    if (structuralOutcome.kind !== 'compacted') throw new Error('expected structural compact');
    expect(structuralOutcome.via).toBe('structural_fallback');
    const structuralAttempt = attempt(structuralOutcome.compact, 'canonical');
    expect(structuralAttempt.bound).toBe(structuralAttempt.base);
  });

  it('does not promote request evidence when the canonical read is unavailable', () => {
    const selection = selectContextGraphSnapshot({
      canonicalRead: { status: 'degraded', errorCode: 'read_failed' },
      requestGraph: sourceGraph('DEGRADED-REQUEST-CANARY'),
    });
    expect(selection.status).toBe('unavailable');
    expect(selection.graph).toBeNull();
    const outcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-degraded',
    });
    expect(outcome.kind).toBe('absent');
    const result = attempt(null, 'unavailable');
    expect(result.bound).toBe(result.base);
    expect(buildUserMessage(result.bound, PAYLOAD.message)).not.toContain(
      'DEGRADED-REQUEST-CANARY',
    );
  });

  it('does not let a direct raw assembler graph acquire source evidence', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      graphContext: { status: 'canonical' },
      graph: sourceGraph('RAW-DIRECT-CANARY'),
      compactedGraph: null,
    });
    const bound = bindCanonicalNodeSourceEvidence({
      basePack: pack,
      compactedGraph: null,
      message: PAYLOAD.message,
    });
    expect(bound).toBe(pack);
    expect(buildUserMessage(bound, PAYLOAD.message)).not.toContain('RAW-DIRECT-CANARY');
  });
});
