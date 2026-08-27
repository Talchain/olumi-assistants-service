import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { readIsBaseline } from '../../../cee/baseline-identity.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { projectContextPackReadiness } from '../../routing/readiness-summary.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { ContextGraphSelection } from '../context-graph-snapshot.js';
import {
  compactGraphForContextPack,
  compactSelectedGraphForContextPack,
} from '../compact-graph-for-contextpack.js';
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

function promptFromRawNodes(
  nodes: GraphStateIngress['nodes'],
  readiness?: NonNullable<ReturnType<typeof projectContextPackReadiness>>,
): string {
  const graph = { nodes, edges: [] } as GraphStateIngress;
  const outcome = compactGraphForContextPack(graph, { requestId: 'req-raw-baseline-option' });
  if (outcome.kind !== 'compacted' || outcome.via !== 'strict_parse') {
    throw new Error(`expected strict compaction, got ${JSON.stringify(outcome)}`);
  }
  const pack = assembleContextPack({
    payload: makeMessagePayload({
      scenario_id: 'scen-raw-baseline-option',
      message: 'What blocks the current approach?',
    }),
    priorTurns: [],
    priorFacts: [],
    graphContext: { status: 'canonical' },
    graph,
    compactedGraph: outcome.compact,
    ...(readiness === undefined ? {} : { readiness }),
  });
  return buildUserMessage(pack, 'What blocks the current approach?');
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
  it.each([
    ['node false, producer data true', false, true],
    ['node true, producer data false', true, false],
  ] as const)(
    'resolves %s through the single producer authority before strict parsing',
    (_case, nodeFlag, dataFlag) => {
      const rawOption = {
        id: 'opt_current',
        kind: 'option',
        label: 'Current arrangement',
        is_baseline: nodeFlag,
        data: { is_baseline: dataFlag },
      };
      expect(readIsBaseline(rawOption)).toBe(true);

      const prompt = promptFromRawNodes([
        rawOption,
        { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
      ] as GraphStateIngress['nodes']);
      expect(observedOptionNodes(prompt).filter((node) => node.is_baseline === true)).toEqual([
        expect.objectContaining({ id: 'opt_current' }),
      ]);
      expect(prompt).not.toContain('"data"');
      expect(prompt).not.toContain('"is_baseline": false');
    },
  );

  it('leaves structural-fallback baseline transport byte-equivalent to the prior path', () => {
    const outcome = compactGraphForContextPack(
      {
        nodes: [
          {
            id: 'opt_current',
            kind: 'option',
            label: 'Current arrangement',
            is_baseline: false,
            data: { is_baseline: true },
          },
          { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
        ],
        // Missing strict GraphV3 edge fields deliberately selects the legacy
        // structural fallback. That path must not acquire the strict-parser
        // recovery introduced by this change.
        edges: [{ from: 'opt_current', to: 'goal_growth' }],
      } as GraphStateIngress,
      { requestId: 'req-baseline-structural-fallback' },
    );
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('structural_fallback');
    expect(outcome.compact.nodes.find((node) => node.id === 'opt_current')).not.toHaveProperty(
      'is_baseline',
    );
  });

  // The pin above calls the inner compactor directly. Post-#1147 the production
  // ContextPack entrypoint is the selector-aware wrapper, which owns the freeze
  // and attestation, so a change that re-derives or bypasses the inner fallback
  // at that boundary would leave the pin above green. Fixture carries a literal
  // top-level `is_baseline: true` on an option node so the strip genuinely fires
  // rather than passing vacuously.
  it('keeps the production ContextPack entrypoint baseline-neutral on the structural fallback', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_current',
          kind: 'option',
          label: 'Current arrangement',
          is_baseline: true,
        },
        { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
      ],
      // Missing strict GraphV3 edge fields deliberately selects the legacy
      // structural fallback through the wrapper as well.
      edges: [{ from: 'opt_current', to: 'goal_growth' }],
    } as unknown as GraphStateIngress;

    const selection: ContextGraphSelection = {
      status: 'canonical',
      graph,
      reason: 'persisted_valid',
    };

    const outcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-baseline-structural-fallback-entrypoint',
    });

    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('structural_fallback');
    expect(outcome.compact.nodes.find((node) => node.id === 'opt_current')).not.toHaveProperty(
      'is_baseline',
    );
  });

  it('pins the exact pre-feature structural-fallback bytes for every marker source', () => {
    const outcome = compactGraphForContextPack(
      {
        nodes: [
          {
            id: 'dup',
            kind: 'option',
            label: 'First',
            is_baseline: false,
            data: { is_baseline: true },
          },
          {
            id: 'dup',
            kind: 'option',
            label: 'Second',
            is_baseline: true,
            data: { is_baseline: false },
          },
          {
            id: 'factor',
            kind: 'factor',
            label: 'Factor',
            data: { is_baseline: true },
          },
        ],
        // Deliberately malformed for strict GraphV3: fallback authority must
        // not change even with duplicate IDs and conflicting marker sources.
        edges: [{ from: 'dup', to: 'factor' }],
        options: [
          {
            id: 'dup',
            label: 'Raw winner',
            is_baseline: true,
            rank: 1,
          },
        ],
      } as GraphStateIngress,
      { requestId: 'req-baseline-fallback-exact-bytes' },
    );

    expect(outcome).toEqual({
      kind: 'compacted',
      compact: {
        nodes: [
          {
            id: 'dup',
            kind: 'option',
            label: 'First',
            source: 'system',
            provenance: 'ai_inferred',
          },
          {
            id: 'dup',
            kind: 'option',
            label: 'Second',
            source: 'system',
            provenance: 'ai_inferred',
          },
          {
            id: 'factor',
            kind: 'factor',
            label: 'Factor',
            source: 'system',
            provenance: 'ai_inferred',
          },
        ],
        edges: [
          {
            from: 'dup',
            to: 'factor',
            strength: 0,
            exists: 1,
            provenance: 'ai_inferred',
          },
        ],
        _node_count: 3,
        _edge_count: 1,
      },
      via: 'structural_fallback',
    });
  });

  it('does not let one nested marker contaminate a duplicate-ID sibling', () => {
    const prompt = promptFromRawNodes([
      {
        id: 'opt_same',
        kind: 'option',
        label: 'Marked sibling',
        is_baseline: false,
        data: { is_baseline: true },
      },
      {
        id: 'opt_same',
        kind: 'option',
        label: 'Unmarked sibling',
        is_baseline: false,
        data: { is_baseline: false },
      },
    ] as GraphStateIngress['nodes']);
    expect(
      observedOptionNodes(prompt).map((node) => [node.label, node.is_baseline]),
    ).toEqual([
      ['Marked sibling', true],
      ['Unmarked sibling', undefined],
    ]);
  });

  it('fails weak when the raw and parsed positions no longer identify the same node', () => {
    const first = [
      {
        id: 'opt_marked',
        kind: 'option',
        label: 'Marked option',
        is_baseline: false,
        data: { is_baseline: true },
      },
      { id: 'opt_other', kind: 'option', label: 'Other option' },
    ];
    const reversed = [...first].reverse();
    let reads = 0;
    const graph = {
      get nodes() {
        reads += 1;
        return reads === 1 ? first : reversed;
      },
      edges: [],
    } as unknown as GraphStateIngress;
    const outcome = compactGraphForContextPack(graph, {
      requestId: 'req-baseline-position-mismatch',
    });
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('strict_parse');
    expect(outcome.compact.nodes.every((node) => node.is_baseline !== true)).toBe(true);
  });

  it('does not infer baseline identity from a status-quo label or a non-option marker', () => {
    const prompt = promptFromRawNodes([
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo alternative' },
      {
        id: 'factor_marked',
        kind: 'factor',
        label: 'Marked factor',
        is_baseline: true,
        data: { is_baseline: true },
      },
    ] as GraphStateIngress['nodes']);

    expect(observedOptionNodes(prompt).filter((node) => node.is_baseline === true)).toEqual([]);
    expect(prompt).not.toContain('"is_baseline":true');
  });

  it('preserves every producer-attested marker and leaves #1148 readiness bytes unchanged', () => {
    const readinessPayload = {
      status: 'needs_user_input',
      options: [],
      repair_proposal: { kind: 'noop' },
      readiness_issues: [
        {
          code: 'OPTION_VALUE_MISSING',
          category: 'option_values',
          repairability: 'human_input_required',
          message: 'Producer-only blocker wording must not be re-authored here',
          option_id: 'opt_a',
          option_label: 'Current A',
          factor_id: 'fac_cost',
          factor_label: 'Cost',
        },
      ],
    } as unknown as Parameters<typeof projectContextPackReadiness>[0];
    const readiness = projectContextPackReadiness(readinessPayload)!;
    const prompt = promptFromRawNodes(
      [
        {
          id: 'opt_a',
          kind: 'option',
          label: 'Current A',
          is_baseline: false,
          data: { is_baseline: true },
        },
        { id: 'opt_b', kind: 'option', label: 'Current B', is_baseline: true },
      ] as GraphStateIngress['nodes'],
      readiness,
    );
    const pack = observeSerialisedPack(prompt);

    expect(
      observedOptionNodes(prompt)
        .filter((node) => node.is_baseline === true)
        .map((node) => node.id),
    ).toEqual(['opt_a', 'opt_b']);
    expect(pack.readiness).toEqual(readiness);
  });

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
