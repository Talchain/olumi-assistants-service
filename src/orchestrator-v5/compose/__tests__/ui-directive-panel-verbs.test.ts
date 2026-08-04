/**
 * Lane 2 (P3 UI agency) — ui_directive PANEL verbs, §2.1 rows 5–6.
 * "The assistant opens the surface it is talking about." Deterministic ladder
 * extension, ZERO LLM authorship, N=1 latch unchanged, schemas 0.32.0.
 *
 * Trigger rows under test (facts DERIVED from the live V5 registry — the
 * originally-proposed compare_options row was WITHDRAWN because no V5 handler
 * produces a compare_options fact; a row against it would be a wired gesture
 * nothing can ever trigger, the guarantee-theatre class):
 *   5 · explain_results, ANSWERED (`precondition_unmet` false) → `open_panel`
 *       @ ui_target {kind:'tab', id:'results'} — the explanation opens the
 *       results surface it explains. NOTE the gate is precondition_unmet, NOT
 *       `noop`: the live handler stamps `noop: true` on EVERY explain fact
 *       (it is a no-op handler — byte-derived at explain-results.ts:124/215),
 *       so a noop:false gate would be dead on arrival.
 *   6 · explain_from_structure + ≥1 CONTESTED edge in the turn's persisted
 *       graph (`edges[].validation.status === 'contested'`, the two-pass
 *       validation verdict the Model tab's relationships section renders) →
 *       `open_section` @ ui_target {kind:'model_section', id:'relationships'}.
 *       Zero contested edges / absent / malformed graph → suppressed
 *       (`no_contested_edges`) — never open a section with nothing remarkable.
 *
 * Positive control (trap-13): every absence assertion sits beside a presence
 * proof on the same fixture family. Determinism pin: same input twice →
 * deep-equal directive bytes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  OlumiResponseSchema,
  UiDirectiveBlockSchema,
} from '@talchain/schemas/boundary';

import { composeToolCallResponse } from '../../compose.js';
import { countContestedEdges } from '../ui-directive.js';
import { sanitiseOlumiResponseForEgress } from '../output-safety.js';
import { setTestSink } from '../../../utils/telemetry.js';

const BASE_INPUT = {
  answerKind: 'substantive' as const,
  orientation: 'Here is the explanation.',
  confirmation: '',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

// Persisted-graph shape mirrors the live snapshot (schema_version / nodes /
// edges with two-pass validation verdicts — see the l60 fixture family).
function persistedGraph(contestedCount: number, agreedCount = 1): unknown {
  const edges: unknown[] = [];
  for (let i = 0; i < contestedCount; i += 1) {
    edges.push({
      from: `fac_c${i}`,
      to: 'goal_g',
      validation: { status: 'contested', contested_reasons: ['sign_flip'] },
    });
  }
  for (let i = 0; i < agreedCount; i += 1) {
    edges.push({
      from: `fac_a${i}`,
      to: 'goal_g',
      validation: { status: 'agreed', contested_reasons: [] },
    });
  }
  return {
    schema_version: '1',
    goal_node_id: 'goal_g',
    nodes: [
      { id: 'goal_g', label: 'Launch success', kind: 'goal' },
      { id: 'fac_c0', label: 'Delivery risk', kind: 'factor' },
    ],
    edges,
  };
}

function explainResultsFact(opts: { preconditionUnmet?: boolean } = {}): HandlerFact {
  // noop is ALWAYS true on the live handler (no-op explanation handler) —
  // byte-derived; the discriminator is precondition_unmet.
  return {
    fact_type: 'explain_results',
    fact_version: 1,
    noop: true,
    result: {
      precondition_unmet: opts.preconditionUnmet ?? false,
      option_count: 2,
      answer_source: opts.preconditionUnmet ? 'precondition_template' : 'sonnet',
    },
  } as unknown as HandlerFact;
}

function explainFromStructureFact(): HandlerFact {
  return {
    fact_type: 'explain_from_structure',
    fact_version: 1,
    noop: true,
    result: {
      option_count: 2,
      answer_source: 'deterministic_fallback',
      fallback_reason: 'no_answer_text',
    },
  } as unknown as HandlerFact;
}

function appliedSetFactorValueFact(targetId: string): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: { target_id: targetId, status: 'applied', before: { value: 0.4 }, after: { value: 0.5 } },
  } as unknown as HandlerFact;
}

interface DirectiveBlock {
  type: string;
  verb: string;
  targets: ReadonlyArray<unknown>;
  ui_target?: { kind: string; id: string };
}

function directives(env: { blocks: ReadonlyArray<{ type: string }> }): DirectiveBlock[] {
  return env.blocks.filter((b) => b.type === 'ui_directive') as unknown as DirectiveBlock[];
}

interface SinkEvent { readonly event: string; readonly data: Record<string, unknown>; }
let sink: SinkEvent[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => sink.push({ event, data }));
});
afterEach(() => setTestSink(null));

const emitted = () => sink.filter((e) => e.event === 'v5.ui_directive.emitted');
const suppressed = (reason: string) =>
  sink.filter(
    (e) => e.event === 'v5.ui_directive.suppressed' && e.data.reason === reason,
  );

// ===========================================================================
// Row 5 — explain_results → open_panel @ results
// ===========================================================================
describe('§2.1 row 5 — explain_results opens the results panel', () => {
  it('an ANSWERED explain_results turn emits exactly ONE open_panel directive at the results tab', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [explainResultsFact()],
    });
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    expect(ds[0].verb).toBe('open_panel');
    expect(ds[0].ui_target).toEqual({ kind: 'tab', id: 'results' });
    expect(ds[0].targets).toEqual([]);
    // Strict boundary validation — the emitted block IS wire-legal 0.32.0.
    expect(UiDirectiveBlockSchema.safeParse(ds[0]).success).toBe(true);
    // Telemetry names the fact class and the ui_target kind.
    expect(emitted()).toHaveLength(1);
    expect(emitted()[0].data.fact_type).toBe('explain_results');
    expect(emitted()[0].data.verb).toBe('open_panel');
    expect(emitted()[0].data.target_kind).toBe('tab');
  });

  it('a PRECONDITION-UNMET explain_results turn emits NOTHING (there are no results to open), telemetered', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [explainResultsFact({ preconditionUnmet: true })],
    });
    expect(directives(env)).toHaveLength(0);
    expect(suppressed('precondition_unmet').some((e) => e.data.fact_type === 'explain_results')).toBe(true);
  });

  it('determinism pin: the same input twice produces deep-equal directive bytes (zero LLM authorship)', () => {
    const a = directives(composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [explainResultsFact()] }));
    const b = directives(composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [explainResultsFact()] }));
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// Row 6 — explain_from_structure + contested edges → open_section @ relationships
// ===========================================================================
describe('§2.1 row 6 — explain_from_structure opens the contested relationships section', () => {
  it('with ≥1 contested edge in the persisted graph: exactly ONE open_section directive at relationships', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [explainFromStructureFact()],
      persistedGraph: persistedGraph(2),
    });
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    expect(ds[0].verb).toBe('open_section');
    expect(ds[0].ui_target).toEqual({ kind: 'model_section', id: 'relationships' });
    expect(ds[0].targets).toEqual([]);
    expect(UiDirectiveBlockSchema.safeParse(ds[0]).success).toBe(true);
    expect(emitted()[0].data.fact_type).toBe('explain_from_structure');
    expect(emitted()[0].data.target_kind).toBe('model_section');
  });

  it('with ZERO contested edges: emits NOTHING, suppressed as no_contested_edges (positive control above)', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [explainFromStructureFact()],
      persistedGraph: persistedGraph(0, 3),
    });
    expect(directives(env)).toHaveLength(0);
    expect(
      suppressed('no_contested_edges').some((e) => e.data.fact_type === 'explain_from_structure'),
    ).toBe(true);
  });

  it('with NO persisted graph at all: fail-closed, suppressed as no_contested_edges', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [explainFromStructureFact()],
    });
    expect(directives(env)).toHaveLength(0);
    expect(suppressed('no_contested_edges').length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// countContestedEdges — the derivation is exact and fail-closed
// ===========================================================================
describe('countContestedEdges', () => {
  it('counts exactly the edges whose validation.status === "contested"', () => {
    expect(countContestedEdges(persistedGraph(3, 2))).toBe(3);
    expect(countContestedEdges(persistedGraph(0, 4))).toBe(0);
  });

  it('returns 0 on malformed input (never throws, never guesses)', () => {
    expect(countContestedEdges(undefined)).toBe(0);
    expect(countContestedEdges(null)).toBe(0);
    expect(countContestedEdges('graph')).toBe(0);
    expect(countContestedEdges({})).toBe(0);
    expect(countContestedEdges({ edges: 'nope' })).toBe(0);
    expect(countContestedEdges({ edges: [null, 42, { validation: null }, { validation: {} }] })).toBe(0);
    // a status that is not the exact literal does not count
    expect(countContestedEdges({ edges: [{ validation: { status: 'CONTESTED' } }] })).toBe(0);
  });
});

// ===========================================================================
// N=1 latch across old and new rows + egress
// ===========================================================================
describe('panel rows respect the N=1 latch and ride the wire', () => {
  it('a mutation fact earlier in the turn wins the latch; the explain row stays silent', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [appliedSetFactorValueFact('fac_c0'), explainResultsFact()],
      persistedGraph: persistedGraph(1),
    });
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    // Row 1 (open_inspector @ the mutated node) is the one that fired.
    expect(ds[0].verb).toBe('open_inspector');
  });

  it('the open_panel directive survives egress sanitisation unchanged and the full response is wire-legal', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [explainResultsFact()],
    });
    const sanitised = sanitiseOlumiResponseForEgress(OlumiResponseSchema.parse(env), {
      graph: undefined,
      requestId: 'req-panel-verbs',
      exitPath: 'test',
      userMessage: null,
      mayNameLeadingOption: true,
    });
    const ds = directives(sanitised as never);
    expect(ds).toHaveLength(1);
    expect(ds[0].ui_target).toEqual({ kind: 'tab', id: 'results' });
    const parsed = OlumiResponseSchema.safeParse(sanitised);
    expect(parsed.success).toBe(true);
  });
});
