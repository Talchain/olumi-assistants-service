/**
 * ROADMAP 1.346 — route-level tests for the VALUE-CARRYING inspector edit.
 *
 * THE DEFECT (measured 2026-07-28, UI `92f5406f` / CEE `cb54320e`): two
 * inspector value edits on two factors produced zero network requests, and CEE's
 * `graph_hash` did not move on either. A chat edit on the SAME factor moved it.
 * The user was told the model had changed, reran, and saw identical numbers.
 *
 * These tests assert the three things that were false before:
 *   1. `scenarios.graph` is WRITTEN (the append carries a mutated graph);
 *   2. the wire carries a `graph_patch` block + a moved `graph_hash`;
 *   3. an above-cap edit is REFUSED honestly — never clamped, never a 500.
 *
 * And the one thing that must NOT change: every value-less event keeps its
 * byte-identical silent acknowledgement (reader-first compatibility).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

// ── the persisted model ────────────────────────────────────────────────────
// `f-budget` is capped at 100000 with unit £, currently £40,000 (value 0.4).
// A goal node is present so `computeStructuralReadiness` can produce a payload.
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
let persisted: unknown = buildPersistedGraph();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// TurnExecutor's ORIENT step is the only thing that reaches the LLM. Asserting
// this was never called proves the edit stayed on the deterministic path.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID_BASE = '11111111-1111-4111-8111-11111111111';

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

/** The graph the commit actually handed the store, or undefined if none. */
function committedGraph(): Record<string, unknown> | undefined {
  const call = appendMock.mock.calls.at(-1);
  const arg = call?.[0] as { graph?: Record<string, unknown> } | undefined;
  return arg?.graph;
}

/** The pending actions the commit actually handed the store. */
function committedPendings(): Array<Record<string, unknown>> {
  const arg = appendMock.mock.calls.at(-1)?.[0] as
    | { pending_actions?: Array<Record<string, unknown>> }
    | undefined;
  return arg?.pending_actions ?? [];
}

function budgetObservedState(graph: Record<string, unknown> | undefined) {
  const nodes = (graph?.nodes ?? []) as Array<{ id: string; observed_state?: Record<string, unknown> }>;
  return nodes.find((n) => n.id === 'f-budget')?.observed_state;
}

describe('POST /orchestrate/v2/turn — factor_value_edit (the value-carrying inspector edit)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
  });

  // ── 1. the graph is actually written ─────────────────────────────────────

  it('MUTATES the persisted graph — raw_value and the derived model value both move', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        '0',
      ),
    });

    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock).not.toHaveBeenCalled();

    // THE ASSERTION THE OLD BEHAVIOUR FAILED: a graph reaches the store at all.
    const graph = committedGraph();
    expect(graph).toBeDefined();

    // Canonical top-level state SURVIVES the mutation. The handler mutates the
    // graph it was handed and a projection can drop top-level keys, so the
    // persisted-base re-merge has to put them back. Losing `goal_node_id` would
    // silently un-analysable the scenario on the very turn the user edited it.
    expect(graph?.goal_node_id).toBe('g-revenue');

    const obs = budgetObservedState(graph);
    expect(obs?.raw_value).toBe(50000);
    // The MODEL value is re-derived server-side as raw/cap — not copied from
    // the client's `value`.
    expect(obs?.value).toBeCloseTo(0.5, 10);
    expect(obs?.cap).toBe(100000);
  });

  it('the graph_hash MOVES — the exact measurement that was frozen on the live probe', async () => {
    const before = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never);

    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        '1',
      ),
    });

    const after = computeAnalysisAffectingGraphHash(committedGraph() as never);
    expect(after).not.toBe(before);
  });

  it('the wire carries a graph_patch block, a graph_hash, and analysis_ready', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        '2',
      ),
    });
    const body = JSON.parse(res.body);

    const patch = (body.blocks as Array<Record<string, unknown>>).find(
      (b) => b.type === 'graph_patch',
    );
    expect(patch).toBeDefined();
    expect(patch?.target_id).toBe('f-budget');
    expect(patch?.status).toBe('applied');
    expect(patch?.operation).toBe('set_factor_value');

    // `graph_hash` is stamped from the commit's OWN persisted hash, then the
    // egress sanitiser defers to it.
    //
    // ⚠ THIS ASSERTION DOES NOT CATCH A REGRESSION TO `graph: null`, and an
    // earlier comment here claimed it did. That claim was disproved by this
    // change's own mutation check: forcing `graph: null` left all 13 tests green,
    // precisely BECAUSE the hash is stamped explicitly and no longer needs the
    // graph. The test that actually discriminates `graph` vs `null` is the
    // id-leak one at the bottom of this file.
    expect(typeof body.graph_hash).toBe('string');
    expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(committedGraph() as never));

    expect(body.analysis_ready).toBeDefined();
    // Honest absence: no freshness derivation is threaded on this path, so the
    // block must NOT assert a freshness verdict. Claiming `fresh` here would
    // recreate the exact lie the change exists to remove.
    expect(body.analysis_ready.freshness).toBeUndefined();

    // The receipt is real prose, which is what makes the egress scrub matter.
    expect(body.assistant_text).toContain('Marketing budget');
    expect(body.assistant_text.length).toBeGreaterThan(0);
  });

  it('derives the user-unit input from `value` and the STORED cap when raw_value is absent', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-budget', value: 0.25 }, '3'),
    });
    const obs = budgetObservedState(committedGraph());
    expect(obs?.raw_value).toBe(25000);
    expect(obs?.value).toBeCloseTo(0.25, 10);
  });

  // ── 2. refusals: honest 200, no write, no 500 ────────────────────────────

  it('REFUSES an above-cap edit honestly — no write, no clamp, no 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        // £250,000 against a £100,000 cap — the live probe's headline case.
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 2.5, raw_value: 250000, unit: '£' },
        '4',
      ),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Committed as a turn (the transcript records the refusal) but with NO graph.
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedGraph()).toBeUndefined();

    // NOT SILENTLY CLAMPED: the copy says nothing changed.
    expect(body.assistant_text).toMatch(/haven't changed anything/i);
    expect(body.blocks).toEqual([]);
  });

  it('REFUSES an unknown target id — no write', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-does-not-exist', value: 0.5 },
        '5',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
  });

  it('REFUSES a non-factor target (the goal node) — no write', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'g-revenue', value: 0.5 }, '6'),
    });
    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
  });

  it('REFUSES an inconsistent value/raw_value pair rather than guessing which is meant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        // The LIVE UI DEFECT'S SIGNATURE: a display magnitude in the model-scale
        // field alongside an honest raw_value. Silently picking either one
        // persists a number the user never asked for.
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 300000, raw_value: 30000, unit: '£' },
        '7',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
    expect(JSON.parse(res.body).assistant_text).toMatch(/haven't changed anything/i);
  });

  it('REFUSES when there is no persisted model yet — and does NOT write an empty graph', async () => {
    persisted = null;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5 }, '9'),
    });
    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
  });

  // ── 3. the compatibility guarantee ───────────────────────────────────────

  it('direct_graph_edit is UNCHANGED — still a silent ack, still no graph write', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'direct_graph_edit', target_id: 'f-budget', operation: 'update_value' },
        'a',
      ),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toBe('');
    expect(body.blocks).toEqual([]);
    expect(body.analysis_ready).toBeUndefined();
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedGraph()).toBeUndefined();
  });

  it('undo is UNCHANGED — still client-only, still no commit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'undo' }, 'b'),
    });
    expect(res.statusCode).toBe(200);
    expect(appendMock).not.toHaveBeenCalled();
  });


  // ── the consented rescale chip must not be a dead control ────────────────

  it('above-cap ships the "extend the scale" chip AND persists its backing pending', async () => {
    // ⚠ THE CHIP ALONE IS A DEAD CONTROL. Its replay message deliberately carries
    // no digits and no edit verb, because the structured {value, unit, cap}
    // cannot ride a chip (the boundary Action is strict {id,label,message}). The
    // cap rides the PENDING. Ship the chip without the pending and the click
    // finds nothing to resume, the resumer fails closed on the missing hash, the
    // message falls to the LLM without the cap — and the user gets the same
    // honest refusal again, forever.
    //
    // The original suite asserted the copy and `blocks: []` only, so it could not
    // see this. Found in adversarial review, not by the tests.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 2.5, raw_value: 250000, unit: '£' },
        'd',
      ),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const chip = (body.suggested_actions as Array<Record<string, unknown>>).find(
      (a) => a.id === 'chip_prompt_rescale_extend_cap',
    );
    expect(chip, 'the consented "extend the scale" chip must be on the wire').toBeDefined();

    const pendings = committedPendings();
    const rescale = pendings.find((pa) => pa.chip_id === 'chip_prompt_rescale_extend_cap');
    expect(rescale, 'the chip must have a backing pending or the click cannot resume').toBeDefined();

    // The cap is the whole point of the consent — it is what the chip cannot carry.
    const action = rescale?.action as Record<string, unknown>;
    expect(action.kind).toBe('set_factor_value');
    expect(action.factor_id).toBe('f-budget');
    expect(action.value).toBe(250000);
    expect(action.unit).toBe('£');
    expect(action.operator).toBe('set');
    expect(typeof action.cap).toBe('number');
    expect(action.cap as number).toBeGreaterThanOrEqual(250000);

    // The precondition hash must be the PRE-mutation graph: nothing was written
    // on a refusal, so that is the graph the resumer must find unchanged.
    const pre = (rescale?.preconditions ?? {}) as Record<string, unknown>;
    // The RAW persisted bytes — what the resumer will re-derive from the store.
    // Hashing a Zod-parsed copy instead yields a value that can never match, so
    // the pending would be invalidated on first read: a pending that cannot
    // resume is the same dead control as no pending at all.
    expect(pre.graph_hash).toBe(computeAnalysisAffectingGraphHash(buildPersistedGraph() as never));
    expect(pre.target_entity_ids).toEqual(['f-budget']);

    // Still a refusal: no graph written.
    expect(committedGraph()).toBeUndefined();
  });

  it('a NON-cap refusal mints no pending — the builder stays fail-closed', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-does-not-exist', value: 0.5 },
        'e',
      ),
    });
    expect(committedPendings().filter((pa) => pa.chip_id === 'chip_prompt_rescale_extend_cap')).toEqual([]);
  });

  // ── the id-leak scrub genuinely needs the graph ──────────────────────────

  it('resolves a leak-shaped label via the graph — this is what `graph: null` would break', async () => {
    // The discriminator the original suite lacked. `isLikelyEntityId` treats a
    // SINGLE-SEGMENT suffix under an ambiguous prefix (`goal_`, not `fac_`/`opt_`)
    // as an English compound and leaves it alone WITHOUT a graph; WITH a graph it
    // resolves against the node ids and rewrites to the label. So a receipt
    // naming `goal_revenue`, in a graph that has a node with that id, is scrubbed
    // only when the dispatch hands the sanitiser a real graph.
    //
    // Without this, `graph: null` was a surviving mutant: the wire `graph_hash`
    // is stamped explicitly, so nothing else in the suite could see the field.
    persisted = {
      goal_node_id: 'goal_revenue',
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        {
          id: 'f-budget',
          // The factor's LABEL is another node's ID. The deterministic receipt
          // interpolates the label verbatim, so the id reaches the wire text.
          kind: 'factor',
          label: 'goal_revenue',
          observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
        },
      ],
      edges: [],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        'f',
      ),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(committedGraph(), 'the edit must still have applied').toBeDefined();
    expect(
      body.assistant_text,
      'the raw entity id must not reach the wire — the scrub needs the graph to know it IS one',
    ).not.toContain('goal_revenue');
    expect(body.assistant_text).toContain('Revenue');
  });

  // ── 4. the ingress boundary ──────────────────────────────────────────────

  it('a value-carrying edit with no value is rejected at ingress (422), never half-applied', async () => {
    // Also the shape an OLD CEE (pinned below schemas 0.29.0) produces for the
    // whole event: an unrecognised member fails the discriminated union and the
    // turn is refused at the boundary. That is the reader-first constraint,
    // observable — the writer must not ship before this reader deploys.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-budget' }, 'c'),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(appendMock).not.toHaveBeenCalled();
  });
});
