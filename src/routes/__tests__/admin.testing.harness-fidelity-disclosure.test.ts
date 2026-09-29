/**
 * HARNESS FIDELITY DISCLOSURE — the harness's most consequential limit must be
 * visible AT THE POINT OF USE, not in a merged pull-request description.
 *
 * THE DEFECT THESE TESTS PIN
 *
 * The live Anthropic draft path composes a `draft_graph` request from TWO system
 * blocks: `buildSystemBlocks(...)` and then, UNCONDITIONALLY — no flag, no env
 * gate — `systemBlocks.push({ type: 'text', text: DRAFT_RECORDS_INSTRUCTION })`
 * (`src/adapters/llm/anthropic.ts:517`). That second block opens with
 * "Do not emit a graph. Emit two lists instead." When structured outputs is on
 * for a capable model with thinking off, it also sends a RECORDS grammar in the
 * `output_config` slot (`anthropic.ts:842`, `:956`), and a deterministic
 * projector turns the records back into a graph after the call.
 *
 * This harness sends ONE system block and NO grammar, and parses the reply as
 * `{nodes, edges}`. So a GREEN `draft_graph` result here is a confident answer
 * about a composition production never runs. That already cost us: a measurement
 * lane read 6 of 9 draws as "clean" through a grammar value that does not exist.
 *
 * A limit that lives only in a PR body is a trap for the next lane — the next
 * lane does not read merged PR bodies, it reads the response. So the disclosure
 * rides the RESPONSE PAYLOAD (every consumer, human or script) and the admin UI
 * renders it FROM that payload.
 *
 * WHY THE COUNTS ARE READ OFF THE INTERCEPTED SDK BODY (trap 12)
 *
 * `system_blocks_sent` is asserted against the body the mocked SDK ACTUALLY
 * received, never against a literal `1`. A restated literal is the
 * hand-maintained mirror this estate keeps paying for: the day someone closes
 * the two-block gap, a literal would keep saying "one" and the disclosure would
 * become the lie it exists to prevent. Read from the wire, it moves on its own.
 *
 * BINDING (trap 19) — the divergence entry is a DISCRIMINATING SET, not a
 * constant banner. The `draft_graph`+Anthropic case must carry it and the
 * non-draft case must NOT, on the same build. Emitting it always would satisfy
 * the first test and RED the second; emitting it never REDs the first. Neither
 * case alone proves the binding — the pair does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test-admin-key-harness-disclosure';

/** Every body handed to `messages.create`, in call order. */
const createCalls: Record<string, unknown>[] = [];
/** Every body handed to `messages.stream`, in call order. */
const streamCalls: Record<string, unknown>[] = [];

/** A minimal, parseable graph so the route reaches its 200 path. */
const GRAPH_JSON = JSON.stringify({
  nodes: [{ id: 'n1', kind: 'goal', label: 'Grow revenue' }],
  edges: [],
});

const LLM_RESPONSE = {
  content: [{ type: 'text', text: GRAPH_JSON }],
  usage: { input_tokens: 10, output_tokens: 20 },
  stop_reason: 'end_turn',
};

/** Flipped by the unparseable-output test to drive the FAILED render path. */
let anthropicText = GRAPH_JSON;

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: async (body: Record<string, unknown>) => {
        createCalls.push(body);
        return { ...LLM_RESPONSE, content: [{ type: 'text', text: anthropicText }] };
      },
      stream: (body: Record<string, unknown>) => {
        streamCalls.push(body);
        return {
          finalMessage: async () => ({
            ...LLM_RESPONSE,
            content: [{ type: 'text', text: anthropicText }],
          }),
        };
      },
    };
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});

/**
 * `importOriginal`-spread, never a bare factory: a `vi.mock` factory REPLACES the
 * module, so a hand-listed set of exports silently drops every other consumer's
 * import (CLAUDE.md trap 12 — this exact pattern killed 51 tests once).
 */
vi.mock('../../prompts/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../prompts/store.js')>()),
  getPromptStore: () => ({
    get: async (id: string) => {
      if (id === 'draft_graph_default') {
        return {
          id: 'draft_graph_default',
          status: 'staging',
          taskId: 'draft_graph',
          versions: [{ version: 1, content: 'You draft decision graphs.' }],
        };
      }
      if (id === 'suggest_options_default') {
        return {
          id: 'suggest_options_default',
          status: 'staging',
          taskId: 'suggest_options',
          versions: [{ version: 1, content: 'You suggest options.' }],
        };
      }
      return null;
    },
  }),
  isPromptStoreHealthy: () => true,
}));

const { adminTestRoutes, HARNESS_FIDELITY_NOTICE } = await import('../admin.testing.js');
const { adminUIRoutes } = await import('../admin.ui.js');

const BRIEF =
  'We are deciding whether to open a second warehouse in Leeds next year or expand the one we have.';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(adminTestRoutes);
  await app.ready();
  return app;
}

function post(
  app: FastifyInstance,
  promptId: string,
  options: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/admin/v1/test-prompt-llm',
    headers: { 'x-admin-key': ADMIN_KEY, 'content-type': 'application/json' },
    payload: { prompt_id: promptId, version: 1, brief: BRIEF, options },
  });
}

/** The single body the harness sent for this call, whichever transport it used. */
function onlySentBody(): Record<string, unknown> {
  const all = [...createCalls, ...streamCalls];
  expect(all, 'the harness must have reached the Anthropic client exactly once').toHaveLength(1);
  return all[0]!;
}

/**
 * The system-block count DERIVED from the body that actually went to the SDK.
 * This is the reference the payload is measured against — never a literal.
 */
function systemBlocksIn(body: Record<string, unknown>): number {
  const system = body.system;
  if (Array.isArray(system)) return system.length;
  if (typeof system === 'string') return 1;
  return 0;
}

/** The draft-path divergence entry, if the payload carries one. */
function draftDivergence(fidelity: { divergences?: string[] }): string | undefined {
  return (fidelity.divergences ?? []).find((d) => d.includes('draft_graph'));
}

/**
 * PIN THE PRECONDITION (trap 13b). Every assertion below compares against
 * `HARNESS_FIDELITY_NOTICE`. If that export ever vanished, an ESM named import
 * of a missing binding yields `undefined` WITHOUT throwing — and
 * `expect(undefined).toBe(undefined)` passes, as does `not.toContain(undefined)`.
 * The whole file would then agree with itself while testing nothing. Assert the
 * needle is real before believing any agreement about it.
 */
describe('the disclosure constant this file measures against', () => {
  it('is a real, non-empty string — not an undefined import agreeing with itself', () => {
    expect(typeof HARNESS_FIDELITY_NOTICE).toBe('string');
    expect(HARNESS_FIDELITY_NOTICE.length).toBeGreaterThan(80);
  });
});

describe('admin test-prompt-llm — harness fidelity disclosure (point of use)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createCalls.length = 0;
    streamCalls.length = 0;
    anthropicText = GRAPH_JSON;
    vi.stubEnv('ADMIN_API_KEY', ADMIN_KEY);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-not-a-real-key');
    // A fresh app per test also resets the in-memory rate-limit counter (10/min).
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('carries a harness_fidelity block on the response — the payload every consumer sees', async () => {
    const res = await post(app, 'draft_graph_default', { model: 'claude-sonnet-5' });

    expect(res.statusCode).toBe(200);
    const fidelity = res.json().harness_fidelity;
    expect(fidelity, 'the response must disclose the harness composition').toBeDefined();
    expect(fidelity.notice).toBe(HARNESS_FIDELITY_NOTICE);
    // The notice must say the two things that stop a result being over-read.
    expect(fidelity.notice).toMatch(/not a replica/i);
    expect(fidelity.notice).toMatch(/never as a prediction of live behaviour/i);
    expect(fidelity.output_parsed_as).toBe('graph_nodes_edges');
  });

  it('reports system_blocks_sent READ OFF the body the SDK received, not a restated literal', async () => {
    const res = await post(app, 'draft_graph_default', { model: 'claude-sonnet-5' });

    expect(res.statusCode).toBe(200);
    const body = onlySentBody();
    const fidelity = res.json().harness_fidelity;

    // Derived, not mirrored: the disclosure must equal the wire, whatever the
    // wire is. If a lane later appends the records block, this moves with it.
    expect(fidelity.system_blocks_sent).toBe(systemBlocksIn(body));
    // And the derivation is only meaningful if it read something real.
    expect(systemBlocksIn(body)).toBeGreaterThan(0);

    // Same rule for the grammar slot: presence on the body, not an assumption.
    expect(fidelity.structured_outputs_grammar_sent).toBe('output_config' in body);
    // Positive control on that comparison — the harness genuinely sends none,
    // so the assertion above is not comparing two coincidentally-equal falses
    // produced by a body that was never inspected.
    expect(Object.keys(body).length).toBeGreaterThan(2);
    expect('output_config' in body).toBe(false);
  });

  it('names the draft-path divergence in plain terms for a draft_graph run on Anthropic', async () => {
    const res = await post(app, 'draft_graph_default', { model: 'claude-sonnet-5' });

    expect(res.statusCode).toBe(200);
    const divergence = draftDivergence(res.json().harness_fidelity);
    expect(divergence, 'a draft_graph run must disclose the composition gap').toBeDefined();

    // The three facts a reader needs, stated plainly.
    expect(divergence).toMatch(/one system block/i);
    expect(divergence).toMatch(/two system blocks/i);
    expect(divergence).toMatch(/does not predict live behaviour/i);
    // Cited at the bytes, so the next lane can check it rather than trust it.
    expect(divergence).toContain('anthropic.ts:517');
    expect(divergence).toContain('Do not emit a graph. Emit two lists instead.');
  });

  it('DISCRIMINATES: a non-draft task keeps the notice but carries NO draft divergence', async () => {
    const res = await post(app, 'suggest_options_default', { model: 'claude-sonnet-5' });

    expect(res.statusCode).toBe(200);
    const fidelity = res.json().harness_fidelity;

    // The unconditional half still fires — every run is disclosed.
    expect(fidelity.notice).toBe(HARNESS_FIDELITY_NOTICE);
    // The established-divergence half does not: it is bound to the task, and a
    // constant banner would be a claim about a path this run never touched.
    expect(draftDivergence(fidelity)).toBeUndefined();
  });

  it('still discloses when the run FAILS — the moment a good prompt gets called broken', async () => {
    // Unparseable output: the harness marks the whole test failed. This is
    // exactly the state the missing disclosure corrupts, because a records-shaped
    // reply fails the graph parse and reads as a bad prompt.
    anthropicText = 'I have listed the stated items and the model additions above.';

    const res = await post(app, 'draft_graph_default', { model: 'claude-sonnet-5' });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
    const fidelity = res.json().harness_fidelity;
    expect(fidelity.notice).toBe(HARNESS_FIDELITY_NOTICE);
    expect(draftDivergence(fidelity), 'a FAILED draft run must still disclose').toBeDefined();
  });
});

describe('admin UI — renders the disclosure FROM the payload, never a copy of it', () => {
  let uiApp: FastifyInstance;

  beforeEach(async () => {
    vi.stubEnv('ADMIN_API_KEY', ADMIN_KEY);
    uiApp = Fastify({ logger: false });
    await uiApp.register(adminUIRoutes);
    await uiApp.ready();
  });

  afterEach(async () => {
    await uiApp.close();
    vi.unstubAllEnvs();
  });

  it('binds the operator-visible notice to harness_fidelity.notice on the response', async () => {
    const res = await uiApp.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(200);
    const html = res.body;

    // Positive control: the probe can see this page's real content.
    expect(html).toContain('llm-results-header');

    // The result panel reads the server's own prose out of the payload.
    expect(html).toContain('harness_fidelity.notice');
    expect(html).toContain('harness_fidelity.divergences');

    // ANTI-MIRROR (trap 12): the UI must NOT restate the notice text. A copy
    // here would drift from the route the first time the route changed, and a
    // stale disclosure is worse than none — it reads as current.
    expect(
      html,
      'the admin UI must render the payload prose, not carry its own copy',
    ).not.toContain(HARNESS_FIDELITY_NOTICE);
  });

  it('surfaces finish_reason, so a truncated draft cannot read as a bad prompt', async () => {
    const res = await uiApp.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(200);
    // The field has been on the response envelope all along and rendered
    // NOWHERE (measured: 0 hits, against token_usage 2 / duration_ms 3 /
    // temperature 7 in the same file). `max_tokens` truncation and a genuinely
    // poor prompt are indistinguishable without it.
    expect(res.body).toContain('finishReason');
  });
});
