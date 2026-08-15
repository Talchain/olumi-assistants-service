/**
 * SELECTION BECOMES GROUNDABLE CONTEXT — hop 3 of the selection-aware slice.
 *
 * ── WHAT THIS CLOSES ──────────────────────────────────────────────────────
 * The UI now puts the selected node on the wire (DGAI #695). CEE's ingress
 * admitted a selection field but nothing downstream could answer ABOUT the
 * selected element: `build-turn-context.ts` contained zero occurrences of
 * `select`, and the single substantive reader anywhere (turn-executor's
 * value-update tie-breaker) narrows a MUTATION, it does not ground an ANSWER.
 *
 * ── TWO THINGS THIS FILE INSISTS ON, BOTH ABOUT HONESTY ───────────────────
 *  1. **"I could not see it" is not "it does not exist."** A degraded
 *     canonical-graph read and a genuinely absent node both leave an id
 *     unresolved, and a composer that cannot tell them apart will confidently
 *     tell a user their node is gone when the truth is that CEE could not
 *     read the model. `graph_read` carries the discriminated state (the same
 *     `CanonicalGraphReadState` discipline F2 introduced at the commit
 *     chokepoint) so the two can never be conflated downstream.
 *  2. **STABLE MODEL, ADAPTIVE ATTENTION.** Answering about a selection must
 *     be READ-ONLY on the canonical model. That is asserted here against a
 *     deep-frozen persisted graph, not assumed from the absence of an
 *     assignment.
 *
 * ── AND WHAT IT DOES NOT CLAIM ────────────────────────────────────────────
 * Nothing here composes an answer. Hop 4 (the grounded answer in the
 * advice-gate composers) is fenced to another lane at the time of writing, so
 * this context is CARRIED AND NOT YET CONSUMED. The telemetry counts asserted
 * below exist precisely so that landing can be witnessed on staging before a
 * consumer exists — a dark field with no observability is worse than a dark
 * field.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SelectedElementRefSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';
import {
  SelectedElementsIngressSchema,
  parseRequestExtensions,
} from '../boundary/request-extensions.js';

const BASE = makeMessagePayload({
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'Why does this one matter?',
});
const REAL_EDGE_ID = 'factor_price→opt_build';
const OPAQUE_REAL_EDGE_ID = 'e5';

/**
 * A persisted graph in the shape `scenarios.graph` actually stores. Deep-frozen
 * at every level so a write anywhere in the resolution path throws in strict
 * mode rather than passing silently — the read-only claim is enforced by the
 * fixture, not merely asserted after the fact.
 */
function persistedGraph(): unknown {
  return deepFreeze({
    nodes: [
      {
        id: 'factor_price',
        kind: 'factor',
        label: 'Price sensitivity',
        description: 'How much demand moves when we move price.',
        category: 'external',
        display_value: '40%',
        observed_state: { value: 0.4, unit: 'percent', source: 'user_override' },
      },
      {
        id: 'factor_churn',
        kind: 'factor',
        label: 'Churn rate',
        observed_state: { value: 0.12, unit: 'percent', source: 'brief_extraction' },
      },
      { id: 'opt_build', kind: 'option', label: 'Build in-house' },
    ],
    edges: [
      {
        from: 'factor_price',
        to: 'opt_build',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: 'positive',
      },
    ],
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function storeWithGraph(graph: unknown): SessionStore {
  return createNoopSessionStore({ loadGraphResult: graph });
}

/** A store whose canonical read THROWS — the "I could not look" state. */
function storeWithDegradedGraphRead(): SessionStore {
  const base = createNoopSessionStore();
  return {
    ...base,
    loadGraphAndBriefText: async () => {
      throw new Error('supabase unavailable');
    },
  } as SessionStore;
}

function selection(nodeIds: readonly string[], edgeIds: readonly string[] = []) {
  return { node_ids: nodeIds, edge_ids: edgeIds };
}

describe('ingress — the published 0.40.0 selection shape is admitted', () => {
  /**
   * The UI sends what `MessageTurnPayloadSchema.selected_elements` declares:
   * an array of `{id, kind, label?}` refs. CEE's ingress mirror only knew the
   * V4-era `{node_ids, edge_ids}` shape, so the published shape matched
   * neither union branch and was dropped BEST-EFFORT — silently, by design,
   * with the turn continuing exactly as if no selection had been sent.
   */
  it('positive control: the fixture really is the published contract shape', () => {
    // Without this, a widening test could pass against a shape the contract
    // does not actually declare, and the whole file would be measuring a
    // private invention rather than the wire.
    expect(SelectedElementRefSchema.safeParse({ id: 'factor_price', kind: 'factor' }).success).toBe(
      true,
    );
    expect(
      SelectedElementRefSchema.safeParse({
        id: 'factor_price',
        kind: 'factor',
        label: 'Price sensitivity',
      }).success,
    ).toBe(true);
  })

  it('accepts an array of typed refs and normalises the ids to node_ids', () => {
    const parsed = SelectedElementsIngressSchema.safeParse([
      { id: 'factor_price', kind: 'factor', label: 'Price sensitivity' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('a ref-array turn body reaches the parser as node_ids', () => {
    const out = parseRequestExtensions(
      {
        selected_elements: [{ id: 'factor_price', kind: 'factor', label: 'Price sensitivity' }],
      },
      'req-sel-1',
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.selectedElements).toEqual({
      node_ids: ['factor_price'],
      edge_ids: [],
    });
  });

  it('a ref whose kind is edge lands in edge_ids, not node_ids', () => {
    const out = parseRequestExtensions(
      { selected_elements: [{ id: 'e1', kind: 'edge' }, { id: 'factor_price', kind: 'factor' }] },
      'req-sel-2',
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.selectedElements).toEqual({
      node_ids: ['factor_price'],
      edge_ids: ['e1'],
    });
  });

  it('REGRESSION: the legacy V4 object shape is still accepted unchanged', () => {
    const out = parseRequestExtensions(
      { selected_elements: { node_ids: ['factor_price'], edge_ids: ['e1'] } },
      'req-sel-3',
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.selectedElements).toEqual({
      node_ids: ['factor_price'],
      edge_ids: ['e1'],
    });
  });

  it('REGRESSION: the legacy bare string array is still accepted unchanged', () => {
    const out = parseRequestExtensions(
      { selected_elements: ['factor_price'] },
      'req-sel-4',
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.selectedElements).toEqual({ node_ids: ['factor_price'], edge_ids: [] });
  });

  it('a structurally invalid selection is still dropped best-effort, never a 422', () => {
    // Widening must not turn a soft drop into a hard refusal: selection is
    // context, and losing it degrades an answer rather than failing a turn.
    const out = parseRequestExtensions({ selected_elements: 42 }, 'req-sel-5');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.selectedElements).toBeNull();
  });
});

describe('buildTurnContext — the selected element becomes groundable context', () => {
  it('resolves the selected id to label, kind, value, unit and value provenance', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection(['factor_price']),
    });

    expect(ctx.selection).toBeDefined();
    expect(ctx.selection?.requested_ids).toEqual(['factor_price']);
    expect(ctx.selection?.unresolved_ids).toEqual([]);
    expect(ctx.selection?.graph_read).toBe('ok_present');
    expect(ctx.selection?.elements).toEqual([
      {
        id: 'factor_price',
        kind: 'factor',
        label: 'Price sensitivity',
        description: 'How much demand moves when we move price.',
        category: 'external',
        value: 0.4,
        unit: 'percent',
        display_value: '40%',
        value_source: 'user_override',
      },
    ]);
  });

  it('DISCRIMINATING PAIR: a different selected id resolves a different element', async () => {
    // Same graph, same message. If the resolver returned "a node" rather than
    // "the selected node", both halves would still pass on their own.
    const store = storeWithGraph(persistedGraph());
    const a = await buildTurnContext(BASE, 'req-a', {
      sessionStore: store,
      selectedElements: selection(['factor_price']),
    });
    const b = await buildTurnContext(BASE, 'req-b', {
      sessionStore: store,
      selectedElements: selection(['factor_churn']),
    });

    expect(a.selection?.elements[0]?.id).toBe('factor_price');
    expect(a.selection?.elements[0]?.label).toBe('Price sensitivity');
    expect(b.selection?.elements[0]?.id).toBe('factor_churn');
    expect(b.selection?.elements[0]?.label).toBe('Churn rate');
    expect(a.selection?.elements).not.toEqual(b.selection?.elements);
  });

  it('an option node resolves with no value — absence, not a fabricated zero', async () => {
    const ctx = await buildTurnContext(BASE, 'req-2', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection(['opt_build']),
    });
    const el = ctx.selection?.elements[0];
    expect(el?.id).toBe('opt_build');
    expect(el?.kind).toBe('option');
    expect('value' in (el as object)).toBe(false);
    expect('value_source' in (el as object)).toBe(false);
  });

  it('an id absent from a SUCCESSFULLY READ graph is reported unresolved', async () => {
    const ctx = await buildTurnContext(BASE, 'req-3', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection(['ghost_node']),
    });
    expect(ctx.selection?.elements).toEqual([]);
    expect(ctx.selection?.unresolved_ids).toEqual(['ghost_node']);
    expect(ctx.selection?.graph_read).toBe('ok_present');
  });

  it('⭐ A DEGRADED READ IS NOT AN ABSENT NODE — the two are told apart', async () => {
    // The honesty case this file exists for. Both leave the id unresolved; only
    // `graph_read` says whether CEE looked and did not find it, or could not
    // look at all. A composer that conflates them tells a user their node is
    // gone when the model was simply unreadable.
    const ctx = await buildTurnContext(BASE, 'req-4', {
      sessionStore: storeWithDegradedGraphRead(),
      selectedElements: selection(['factor_price']),
    });
    expect(ctx.selection?.elements).toEqual([]);
    expect(ctx.selection?.unresolved_ids).toEqual(['factor_price']);
    expect(ctx.selection?.graph_read).toBe('degraded');
  });

  it('no graph persisted at all reads as ok_absent, distinct from degraded', async () => {
    const ctx = await buildTurnContext(BASE, 'req-5', {
      sessionStore: createNoopSessionStore(),
      selectedElements: selection(['factor_price']),
    });
    expect(ctx.selection?.graph_read).toBe('ok_absent');
    expect(ctx.selection?.unresolved_ids).toEqual(['factor_price']);
  });

  it('a turn with no selection carries no selection key at all', async () => {
    const ctx = await buildTurnContext(BASE, 'req-6', {
      sessionStore: storeWithGraph(persistedGraph()),
    });
    expect(ctx.selection).toBeUndefined();
    expect('selection' in ctx).toBe(false);
    expect('selectionHonesty' in ctx).toBe(false);
  });

  it('an empty selection is the same as no selection', async () => {
    const ctx = await buildTurnContext(BASE, 'req-7', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection([]),
    });
    expect('selection' in ctx).toBe(false);
    expect('selectionHonesty' in ctx).toBe(false);
  });

  it('counts an exact real edge for honesty without making it answer-bearing context', async () => {
    const ctx = await buildTurnContext(BASE, 'req-8', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection([], [REAL_EDGE_ID]),
    });
    // Deliberate: edge existence can prevent a false refusal, but the edge is
    // not put into node focus or any answer-grounding surface in this slice.
    expect('selection' in ctx).toBe(false);
    expect(ctx.selectionHonesty).toEqual({
      requested_count: 1,
      resolved_count: 1,
      unresolved_count: 0,
      unresolved: 'none',
    });
  });

  it('does not treat an opaque UI edge id as canonical honesty authority', async () => {
    const ctx = await buildTurnContext(BASE, 'req-opaque-edge', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection([], [OPAQUE_REAL_EDGE_ID]),
    });

    // React Flow can identify the real fixture edge as `e5`, but GraphV3 has
    // no stable edge.id. Ignoring that opaque token preserves the prior
    // behaviour without making it answer-bearing or falsely declaring it gone.
    expect('selection' in ctx).toBe(false);
    expect('selectionHonesty' in ctx).toBe(false);
  });

  it('STABLE MODEL: resolution does not mutate the persisted graph', async () => {
    const graph = persistedGraph();
    const before = JSON.stringify(graph);
    const ctx = await buildTurnContext(BASE, 'req-9', {
      sessionStore: storeWithGraph(graph),
      selectedElements: selection(['factor_price']),
    });
    expect(ctx.selection?.elements).toHaveLength(1);
    expect(JSON.stringify(graph)).toBe(before);
    // The resolved element must be a COPY, not a live reference into the graph
    // — a consumer that edited it would be editing canonical state.
    const nodes = (graph as { nodes: Array<{ id: string }> }).nodes;
    expect(ctx.selection?.elements[0]).not.toBe(nodes[0]);
  });
});

describe('buildTurnContext — selection telemetry is observable and content-free', () => {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  beforeEach(() => {
    events.length = 0;
    setTestSink((name, data) => events.push({ name, data: data as Record<string, unknown> }));
  });
  afterEach(() => setTestSink(null));

  it('emits resolution counts so hop 3 can be witnessed before a consumer exists', async () => {
    await buildTurnContext(BASE, 'req-t1', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection(['factor_price', 'ghost_node']),
    });
    const evt = events.find((e) => e.name === 'v5.selection.resolved');
    expect(evt).toBeDefined();
    expect(evt?.data).toMatchObject({
      requested_count: 2,
      resolved_count: 1,
      unresolved_count: 1,
      graph_read: 'ok_present',
    });
  });

  it('carries NO node ids and NO labels — the standing privacy contract', async () => {
    await buildTurnContext(BASE, 'req-t2', {
      sessionStore: storeWithGraph(persistedGraph()),
      selectedElements: selection(['factor_price']),
    });
    const evt = events.find((e) => e.name === 'v5.selection.resolved');
    expect(evt).toBeDefined();
    const serialised = JSON.stringify(evt?.data ?? {});
    // Bound by IDENTITY to the exact id and label the fixture selected, so this
    // cannot pass by looking for a generic pattern that never appears anyway.
    expect(serialised).not.toContain('factor_price');
    expect(serialised).not.toContain('Price sensitivity');
  });

  it('emits nothing when the turn carried no selection', async () => {
    await buildTurnContext(BASE, 'req-t3', {
      sessionStore: storeWithGraph(persistedGraph()),
    });
    expect(events.find((e) => e.name === 'v5.selection.resolved')).toBeUndefined();
  });
});
