/**
 * L16 / walk finding N16 — "the product cannot execute its own `Configure
 * <option>` chip", pinned at the ROUTE, with the walk's own wire bodies.
 *
 * ⭐ THE EVIDENCE THIS FILE ENCODES (journey-rewalk-2026-08-03b, §2b row 1,
 * raw `b-wire-r5-01-configure-chip-{req,res}.txt`, deployed CEE `9a0541b`):
 *
 *   REQUEST  {"kind":"message", …, "message":"Configure Launch Customer
 *             Retention Programme", "source":"composer"}
 *   RESPONSE 200 / 1,540 B — "I wasn't able to make that change safely. Can
 *             you describe what you'd like to add or change in simpler
 *             terms?", blocks[0].details.rejection_code
 *             = "OPERATION_DID_NOT_LAND", `_diagnostic_trace.exit_path`
 *             = "edit_graph", ONE `role:"edit_graph"` LLM call (489 output
 *             tokens, 11.9 s) — **and NO `analysis_ready` field at all**.
 *
 * The routing was never the defect (2.11 / 2.308 fixed that: the persisted
 * label anchor makes `configure_vocab` match and the turn DOES reach the edit
 * lane). The defect is that a BARE configure — "configure {option}" with no
 * factor and no value — carries NOTHING WRITABLE, so the edit LLM must invent
 * an operation, the operation does not survive canonicalisation, and the user
 * gets a generic safety refusal instead of the one thing that would unblock
 * them: which factor, and in what form to say it.
 *
 * Two pins, both defect-shaped:
 *
 *   1. N16 — a bare configure must be answered DETERMINISTICALLY, naming the
 *      option and the factor it is linked to, in the product's own
 *      probe-P1-proven format (`buildConfigureOptionAdvisedFormat`). It must
 *      NOT reach `dispatchEditGraph` to fail there.
 *   2. GATE-REASON INTEGRITY — the response must still carry `analysis_ready`.
 *      On the walk, the two turns that took the edit-lane non-apply path
 *      (r5-01, r5-03) are the ONLY two of seven that shipped no
 *      `analysis_ready`, and they are exactly the two where the tester
 *      watched the gate copy DEGRADE from the specific reason
 *      ("'Launch Customer Retention Programme' has no effect values yet")
 *      to the generic one ("Olumi is not able to run this yet. Ask in the
 *      chat and it will explain what is missing."). A specific reason must
 *      never be replaced by a generic one because a remedy failed.
 *
 * MUTATION SENSITIVITY: delete the clarify intercept from route-v2 and cases
 * 1–3 go RED (the turn reaches the edit lane again). Drop `analysisReady`
 * from the intercept's `sendFinalised200` options and case 4 goes RED.
 *
 * Harness modelled on `route-v2-configure-option-persisted-anchor.test.ts`
 * (same mocks, same telemetry capture, same live-wire request shape: NO
 * `graph_state` on the request — the platform invariant).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const telemetryEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      telemetryEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { buildConfigureOptionChip } = await import(
  '../../../src/orchestrator-v5/configure-option-chip-text.js'
);

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

/** The walk's option label, verbatim. */
const OPTION_LABEL = 'Launch Customer Retention Programme';
/** The factor the walk's add-option transaction minted alongside it. */
const FACTOR_LABEL = 'Customer Retention Investment';

/**
 * The walk's post-add-option graph, reduced to what the routing + readiness
 * decision reads. `opt_retention` is linked to its factor but carries NO
 * interventions — `computeStructuralReadiness` calls that `needs_encoding`,
 * which is the specific reason the gate copy was showing before it degraded.
 * A second, fully-configured option is present so the graph is a realistic
 * multi-option decision rather than a degenerate one.
 */
/**
 * Edge and intervention shapes taken from the walk's OWN persisted graph
 * (`b-wire-r4-02-confirm-option-res.txt` → `draft_graph`): 32 edges, ZERO
 * missing `strength` / `exists_probability` / `effect_direction` on ANY edge
 * including option-sourced ones, and option interventions at TOP LEVEL in the
 * rich InterventionV3 shape.
 *
 * Both details are load-bearing, and both were measured rather than assumed:
 * the remedy strict-parses the persisted graph, strict `GraphV3` requires all
 * three edge fields, and `NodeV3` has no `data` field and is non-passthrough
 * so `data.interventions` is STRIPPED on read (which is exactly why
 * `normalise-option-interventions.ts` merges it onto top-level at the persist
 * chokepoint). A hand-minimised `{from,to}` fixture would silently fail the
 * parse and make every case below pass or fail for a reason that has nothing
 * to do with the behaviour under test.
 */
function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

const PERSISTED_GRAPH = {
  nodes: [
    { id: 'goal_arr', kind: 'goal', label: 'Reach £1,000,000 ARR' },
    { id: 'fac_retention_investment', kind: 'factor', label: FACTOR_LABEL },
    { id: 'fac_content_spend', kind: 'factor', label: 'Content Spend' },
    { id: 'opt_retention', kind: 'option', label: OPTION_LABEL },
    {
      id: 'opt_content',
      kind: 'option',
      label: 'Invest in Content Marketing',
      interventions: {
        fac_content_spend: { value: 1, source: 'brief_extraction', value_confidence: 'high' },
      },
    },
  ],
  edges: [
    edge('opt_retention', 'fac_retention_investment'),
    edge('opt_content', 'fac_content_spend'),
    edge('fac_retention_investment', 'goal_arr'),
    edge('fac_content_spend', 'goal_arr'),
  ],
};

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function payload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111300',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    // THE LIVE WIRE: no `extensions`, no `graph_state`.
    message,
    turn_class: 'frame',
    source: 'composer',
  };
}

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

describe('POST /orchestrate/v2/turn — N16 bare configure-option is executable', () => {
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
    dispatchEditGraphMock.mockReset();
    appendMock.mockClear();
    loadGraphMock.mockReset();
    loadGraphMock.mockResolvedValue(PERSISTED_GRAPH);
    telemetryEvents.length = 0;
  });

  // ─── 1. The walk's exact failing message ──────────────────────────────
  it('the walk\'s wire body — "Configure {option}" — is answered deterministically, not sent to the edit LLM to fail', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Configure ${OPTION_LABEL}`),
    });

    expect(res.statusCode).toBe(200);
    // THE DEFECT: on staging `9a0541b` this turn reached the edit lane and
    // came back OPERATION_DID_NOT_LAND.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    const text = body(res).assistant_text as string;
    // Names the option the user asked about …
    expect(text).toContain(OPTION_LABEL);
    // … names the factor it is actually linked to (from the graph, not
    // invented) …
    expect(text).toContain(FACTOR_LABEL);
    // … and gives the ONE phrasing that is proven to route back to the
    // writer (probe P1 / `buildConfigureOptionAdvisedFormat`).
    expect(text).toContain(`Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to`);
  });

  // ─── 2. The chip's OWN message (the click path, never wire-measured) ──
  it("the configure chip's own message — the click path — is answered the same way", async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    // DERIVED from the chip builder, not retyped: this is byte-for-byte what
    // the UI replays when the user CLICKS the chip CEE offered on the
    // add-option receipt (`b-wire-r4-02-confirm-option-res.txt`
    // suggested_actions[0].message). The walk typed the chip's LABEL; the
    // click path sends its MESSAGE, and both must land here.
    const chipMessage = buildConfigureOptionChip(OPTION_LABEL).message;
    expect(chipMessage).toBe(`Help me configure ${OPTION_LABEL}.`);

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(chipMessage),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const text = body(res).assistant_text as string;
    expect(text).toContain(OPTION_LABEL);
    expect(text).toContain(FACTOR_LABEL);
  });

  // ─── 3. The generic readiness chip ────────────────────────────────────
  it('the "Set values for options" readiness chip reaches the same deterministic remedy', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const { SET_OPTION_VALUES_CHIP } = await import(
      '../../../src/orchestrator-v5/configure-option-chip-text.js'
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(SET_OPTION_VALUES_CHIP.message),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // Only ONE option needs encoding, so the remedy can name it without the
    // user having said which.
    expect(body(res).assistant_text as string).toContain(OPTION_LABEL);
  });

  // ─── 4. Gate-reason integrity ─────────────────────────────────────────
  it('carries analysis_ready with the SPECIFIC per-option reason — the gate must not degrade to generic', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Configure ${OPTION_LABEL}`),
    });

    expect(res.statusCode).toBe(200);
    const ar = body(res).analysis_ready as
      | { status?: string; options?: Array<{ option_id: string; status: string; label: string }> }
      | undefined;

    // On the walk this field was ABSENT on exactly this turn — and the gate
    // copy went generic as a result.
    expect(ar).toBeDefined();
    const retention = ar!.options?.find((o) => o.option_id === 'opt_retention');
    expect(retention).toBeDefined();
    // The SPECIFIC reason, preserved: this named option is what blocks the run.
    expect(retention!.status).toBe('needs_encoding');
    expect(retention!.label).toBe(OPTION_LABEL);
    // Positive control (trap 13): the block is not a blank carrier — the
    // configured sibling is still reported as ready, so "specific" here is
    // load-bearing content and not an empty shell that happens to exist.
    expect(ar!.options?.find((o) => o.option_id === 'opt_content')?.status).toBe('ready');
  });

  // ─── 5. BLAST RADIUS: a configure that DOES carry a value still writes ─
  it('a configure message that carries a factor AND a value still reaches the edit lane (walk remedy #5, the one that worked)', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Under ${OPTION_LABEL}, set ${FACTOR_LABEL} to 1`),
    });

    expect(res.statusCode).toBe(200);
    // This is the path that SUCCEEDED on the walk (200 / 33,756 B,
    // interventions written, analysis_ready → "ready"). The intercept must
    // not claim it: there is something writable here.
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });

  // ─── 6. BLAST RADIUS: no unconfigured option ⇒ no intercept ───────────
  it('does not intercept when every option is already configured', async () => {
    loadGraphMock.mockResolvedValue({
      ...PERSISTED_GRAPH,
      nodes: PERSISTED_GRAPH.nodes.map((n) =>
        n.id === 'opt_retention'
          ? {
              ...n,
              interventions: {
                fac_retention_investment: {
                  value: 1,
                  source: 'user_specified',
                  value_confidence: 'high',
                },
              },
            }
          : n,
      ),
    });
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Configure ${OPTION_LABEL}`),
    });

    expect(res.statusCode).toBe(200);
    // Nothing to remedy — the pre-existing route keeps the turn.
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });

  // ─── 7. BLAST RADIUS: a question must never be claimed ────────────────
  it('does not intercept a question about configuring', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`What does configuring the ${OPTION_LABEL} option do?`),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // …and it did NOT get the remedy copy either — it fell through to the
    // normal conversational route.
    expect(body(res).assistant_text as string).not.toContain(
      `Set the ${OPTION_LABEL} option's effect on`,
    );
  });
});
