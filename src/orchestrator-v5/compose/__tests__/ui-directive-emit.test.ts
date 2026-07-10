/**
 * CEE_UI_DIRECTIVE_EMIT — flag-gated deterministic ui_directive emitter
 * (ROADMAP 2.27 / seamlessness R4, CEE half, slice 1).
 *
 * Contract under test (deliberately minimal first slice):
 *   - Flag OFF (default / unset / explicit false): byte-identical to base
 *     behaviour — zero `ui_directive` blocks; the flag-on response differs
 *     from the flag-off response by EXACTLY the one appended directive
 *     (structural-additivity pin, fake-timer-frozen so the comparison is
 *     literal JSON equality).
 *   - Flag ON + current-turn run_analysis fact with a recommended option
 *     resolvable to an option node in `enrichment.graph.nodes[]`:
 *     exactly ONE `ui_directive` block — verb `highlight`, one TargetRef
 *     for the recommended option, NO `note` (zero LLM authorship, zero
 *     hallucination surface), NO `duration_ms`. Parses under the strict
 *     boundary `UiDirectiveBlockSchema`.
 *   - Fail-closed (flag ON, still zero directives):
 *       - `leading_option_id` null (no recommendation),
 *       - recommended id unresolvable in the graph lookup (no label —
 *         never fall back to id-as-label per §0.1),
 *       - recommended id resolves to a non-option node kind,
 *       - `noop: true` fact,
 *       - missing `graph_hash_at_run` (freshness unverifiable),
 *       - prior-fact lifecycle rebuilds (fresh AND stale) — only a
 *         CURRENT-TURN run_analysis fact emits,
 *       - never more than one directive per turn (multi-fact turn).
 *   - Egress: the directive rides the normal V5 `blocks[]` channel —
 *     survives `sanitiseOlumiResponseForEgress` unchanged and the full
 *     response passes the strict `OlumiResponseSchema` (the route-v2
 *     egress validator).
 *
 * Flag plumbing mirrors CEE_ANSWER_TEXT_REQUIRED
 * (config/index.ts `features.uiDirectiveEmit`, default OFF).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OlumiResponseSchema, UiDirectiveBlockSchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphV3T } from '../../../orchestrator/types.js';

import { composeToolCallResponse } from '../../compose.js';
import { sanitiseOlumiResponseForEgress } from '../output-safety.js';

// ---------------------------------------------------------------------------
// Flag helpers (pattern: tool-schema-answer-text-required.test.ts)
// ---------------------------------------------------------------------------

let priorFlag: string | undefined;

async function setFlag(value: 'true' | 'false' | undefined) {
  priorFlag = process.env.CEE_UI_DIRECTIVE_EMIT;
  if (value === undefined) {
    delete process.env.CEE_UI_DIRECTIVE_EMIT;
  } else {
    process.env.CEE_UI_DIRECTIVE_EMIT = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_UI_DIRECTIVE_EMIT;
  } else {
    process.env.CEE_UI_DIRECTIVE_EMIT = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

// ---------------------------------------------------------------------------
// Fixtures (mirrors compose.test.ts Phase-3A conventions)
// ---------------------------------------------------------------------------

const GRAPH_HASH = 'gh_uidirective_0001';

const STANDARD_GRAPH = {
  nodes: [
    { id: 'goal_launch', label: 'Launch success', kind: 'goal' },
    { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
    { id: 'opt_hire_locally', label: 'Hire locally', kind: 'option' },
    { id: 'opt_outsource', label: 'Outsource', kind: 'option' },
  ],
  edges: [],
};

const BASE_INPUT = {
  orientation: 'Running the analysis.',
  confirmation: 'Ran analysis on your current scenario.',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

interface FactOverrides {
  readonly leadingOptionId?: string | null;
  readonly graphNodes?: ReadonlyArray<Record<string, unknown>> | null;
  readonly graphHash?: string | null;
  readonly noop?: boolean;
}

function runAnalysisFact(overrides: FactOverrides = {}): HandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (overrides.graphNodes !== null) {
    enrichment.graph = { nodes: overrides.graphNodes ?? STANDARD_GRAPH.nodes, edges: [] };
  }
  const result: Record<string, unknown> = {
    scenario_id: 'scen-uidirective',
    leading_option_id:
      overrides.leadingOptionId === undefined ? 'opt_hire_locally' : overrides.leadingOptionId,
    summary: 'Ran analysis on your current scenario.',
    enrichment,
    computed_at: '2026-07-10T09:00:00.000Z',
  };
  if (overrides.graphHash !== null) {
    result.graph_hash_at_run = overrides.graphHash ?? GRAPH_HASH;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides.noop ?? false,
    result,
  } as unknown as HandlerFact;
}

function uiDirectives(response: { blocks: ReadonlyArray<{ type: string }> }) {
  return response.blocks.filter((b) => b.type === 'ui_directive');
}

// ---------------------------------------------------------------------------
// Flag OFF — default behaviour is byte-identical to base
// ---------------------------------------------------------------------------

describe('ui_directive emitter — CEE_UI_DIRECTIVE_EMIT OFF (default)', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('emits zero ui_directive blocks on a run_analysis turn with a recommended option (flag unset)', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('emits zero ui_directive blocks with the flag explicitly false', async () => {
    await setFlag('false');
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('flag-on response == flag-off response + exactly the one appended directive (JSON additivity pin)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T09:30:00.000Z'));
    try {
      const flagOff = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });

      await setFlag('true');
      const flagOn = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });

      expect(uiDirectives(flagOn)).toHaveLength(1);
      // Removing the directive from the flag-on response reproduces the
      // flag-off response byte-for-byte — the flag changes NOTHING else.
      const flagOnMinusDirective = {
        ...flagOn,
        blocks: flagOn.blocks.filter((b) => b.type !== 'ui_directive'),
      };
      expect(JSON.stringify(flagOnMinusDirective)).toBe(JSON.stringify(flagOff));
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Flag ON — deterministic single emission
// ---------------------------------------------------------------------------

describe('ui_directive emitter — CEE_UI_DIRECTIVE_EMIT ON, recommended option present', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('emits exactly one ui_directive block', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    expect(uiDirectives(env)).toHaveLength(1);
  });

  it('the block parses under the strict boundary UiDirectiveBlockSchema', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    const [block] = uiDirectives(env);
    const parsed = UiDirectiveBlockSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });

  it('verb=highlight, one TargetRef for the recommended option, label resolved from the graph', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    const [block] = uiDirectives(env);
    expect(block).toMatchObject({
      type: 'ui_directive',
      verb: 'highlight',
      targets: [{ id: 'opt_hire_locally', label: 'Hire locally', kind: 'option' }],
    });
    expect((block as { targets: unknown[] }).targets).toHaveLength(1);
  });

  it('carries NO free-text note and NO duration_ms (schema-required fields + target only)', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    const [block] = uiDirectives(env);
    expect(Object.keys(block as Record<string, unknown>).sort()).toEqual([
      'targets',
      'type',
      'verb',
    ]);
  });

  it('the composed response passes the strict egress OlumiResponseSchema with the directive on blocks[]', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    const parsed = OlumiResponseSchema.parse(env);
    expect(uiDirectives(parsed)).toHaveLength(1);
  });

  it('survives sanitiseOlumiResponseForEgress unchanged (nothing to scrub: no note)', () => {
    const env = composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [runAnalysisFact()] });
    const graph = {
      nodes: STANDARD_GRAPH.nodes.map(({ id, kind, label }) => ({ id, kind, label })),
      edges: [],
    } as unknown as GraphV3T;
    const before = uiDirectives(env);
    const out = sanitiseOlumiResponseForEgress(OlumiResponseSchema.parse(env), {
      graph,
      requestId: 'req-ui-directive',
      exitPath: 'test',
    });
    const after = uiDirectives(out);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before[0]);
  });
});

// ---------------------------------------------------------------------------
// Flag ON — fail-closed conditions (zero directives)
// ---------------------------------------------------------------------------

describe('ui_directive emitter — CEE_UI_DIRECTIVE_EMIT ON, fail-closed suppression', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('no recommended option (leading_option_id null) → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact({ leadingOptionId: null })],
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('recommended id not resolvable in enrichment.graph.nodes → zero directives (no id-as-label fallback)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact({ leadingOptionId: 'opt_unknown' })],
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('no enrichment.graph at all → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact({ graphNodes: null })],
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('recommended id resolves to a NON-option node kind → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact({ leadingOptionId: 'fac_delivery_risk' })],
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('noop run_analysis fact → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact({ noop: true })],
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('missing graph_hash_at_run (freshness unverifiable) → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact({ graphHash: null })],
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('prior-fact FRESH lifecycle rebuild (no current-turn fact) → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [],
      lifecycle: {
        priorFacts: [runAnalysisFact()],
        freshness: {
          freshness: 'fresh',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: GRAPH_HASH,
          reason: 'hash_match',
        },
        requestId: 'req-prior-fresh',
        scenarioId: 'scen-uidirective',
      },
    });
    // The prior-fact fresh path DOES rebuild analysis_result + Phase-3
    // blocks — assert the suppression is specifically about the directive.
    expect(env.blocks.filter((b) => b.type === 'analysis_result')).toHaveLength(1);
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('prior-fact STALE lifecycle (diverged graph) → zero directives', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [],
      lifecycle: {
        priorFacts: [runAnalysisFact()],
        freshness: {
          freshness: 'stale',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: 'gh_diverged_0002',
          reason: 'hash_mismatch',
        },
        requestId: 'req-prior-stale',
        scenarioId: 'scen-uidirective',
      },
    });
    expect(uiDirectives(env)).toHaveLength(0);
  });

  it('never more than one directive per turn (two run_analysis facts → exactly one)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [runAnalysisFact(), runAnalysisFact({ leadingOptionId: 'opt_outsource' })],
    });
    expect(uiDirectives(env)).toHaveLength(1);
  });
});
