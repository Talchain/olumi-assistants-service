/**
 * HARNESS FIDELITY — the admin prompt-test path must answer the "does this model
 * accept the thinking mechanism?" question with the SAME authority, and send the
 * SAME EXPLICIT thinking posture, as the LIVE draft path.
 *
 * THE DEFECT THESE TESTS PIN (both halves are the same root cause — two
 * authorities answering one question, trap 21):
 *
 *  (a) The live draft NEVER omits `thinking`. `adapters/llm/anthropic.ts:974-976`
 *      sends `thinking:{type:'disabled'}` explicitly, and its comment names the
 *      exact failure: a thinking-class model (claude-sonnet-5 has ADAPTIVE
 *      thinking ON BY DEFAULT — MODEL_REGISTRY's own description says so) would
 *      otherwise burn the affordable token budget invisibly. The admin harness
 *      omitted the field entirely, so a `draft_graph` candidate could not be
 *      measured against the model staging actually serves.
 *
 *  (b) The harness decided thinking support from `MODEL_REGISTRY.extendedThinking`.
 *      `anthropic-model-capabilities.ts:47-52` states in terms that that field was
 *      measured WRONG IN BOTH DIRECTIONS on 2026-08-08 and must not be used for
 *      this question: it claims `true` for claude-sonnet-5, which returns HTTP 400
 *      for `thinking.type:'enabled'`, and `false` for claude-sonnet-4-6, which
 *      returns HTTP 200. So `budget_tokens` passed local validation on sonnet-5
 *      and was then 400'd by the API. The live path consults
 *      `THINKING_CAPABLE_MODELS` (via `isThinkingSupported`, anthropic.ts:619-620);
 *      so must this one.
 *
 * BINDING (trap 19): the sonnet-5 and sonnet-4-6 cases are a DISCRIMINATING PAIR.
 * Hard-disabling thinking for every model would satisfy the sonnet-5 case and RED
 * the sonnet-4-6 one; reverting to the registry authority REDs sonnet-5 and passes
 * sonnet-4-6. Neither case alone proves the binding — the pair does. The final
 * test binds the posture to the DERIVED capability set rather than to a restated
 * literal, so it cannot drift from the map the live path reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test-admin-key-harness-fidelity';

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

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: async (body: Record<string, unknown>) => {
        createCalls.push(body);
        return LLM_RESPONSE;
      },
      stream: (body: Record<string, unknown>) => {
        streamCalls.push(body);
        return { finalMessage: async () => LLM_RESPONSE };
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
    get: async (id: string) =>
      id === 'draft_graph_default'
        ? {
            id: 'draft_graph_default',
            status: 'staging',
            taskId: 'draft_graph',
            versions: [{ version: 1, content: 'You draft decision graphs.' }],
          }
        : null,
  }),
  isPromptStoreHealthy: () => true,
}));

const { adminTestRoutes } = await import('../admin.testing.js');
const { THINKING_CAPABLE_MODELS } = await import(
  '../../adapters/llm/anthropic-model-capabilities.js'
);

const BRIEF =
  'We are deciding whether to open a second warehouse in Leeds next year or expand the one we have.';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(adminTestRoutes);
  await app.ready();
  return app;
}

function post(app: FastifyInstance, options: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/admin/v1/test-prompt-llm',
    headers: { 'x-admin-key': ADMIN_KEY, 'content-type': 'application/json' },
    payload: { prompt_id: 'draft_graph_default', version: 1, brief: BRIEF, options },
  });
}

/** The single body the harness sent for this call, whichever transport it used. */
function onlySentBody(): Record<string, unknown> {
  const all = [...createCalls, ...streamCalls];
  expect(all, 'the harness must have reached the Anthropic client exactly once').toHaveLength(1);
  return all[0]!;
}

describe('admin test-prompt-llm — Anthropic thinking posture (harness fidelity)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createCalls.length = 0;
    streamCalls.length = 0;
    vi.stubEnv('ADMIN_API_KEY', ADMIN_KEY);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-not-a-real-key');
    // A fresh app per test also resets the in-memory rate-limit counter (10/min).
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('sends an EXPLICIT thinking:{type:"disabled"} for claude-sonnet-5 — never omits the field', async () => {
    const res = await post(app, { model: 'claude-sonnet-5' });

    expect(res.statusCode).toBe(200);
    const body = onlySentBody();
    expect(body.model).toBe('claude-sonnet-5');
    // The live draft's posture, byte-for-byte (anthropic.ts:976). Omitting the
    // field is what let adaptive thinking burn the budget invisibly.
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('rejects budget_tokens for claude-sonnet-5 LOCALLY, instead of letting the API 400 it', async () => {
    const res = await post(app, { model: 'claude-sonnet-5', budget_tokens: 2048 });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
    expect(res.json().message).toContain('claude-sonnet-5');
    // And it must not have spent a call proving it.
    expect([...createCalls, ...streamCalls]).toHaveLength(0);
  });

  it('STILL sends thinking:{type:"enabled"} for claude-sonnet-4-6, which the live-probed map says accepts it', async () => {
    const res = await post(app, { model: 'claude-sonnet-4-6', budget_tokens: 2048 });

    expect(res.statusCode).toBe(200);
    const body = onlySentBody();
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('sends thinking:{type:"disabled"} for claude-sonnet-4-6 when NO budget is requested', async () => {
    const res = await post(app, { model: 'claude-sonnet-4-6' });

    expect(res.statusCode).toBe(200);
    expect(onlySentBody().thinking).toEqual({ type: 'disabled' });
  });

  it('reports supports_extended_thinking from the live-probed capability map, not MODEL_REGISTRY.extendedThinking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/test-prompt-llm/models',
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const models = res.json().models as { id: string; supports_extended_thinking: boolean }[];
    expect(models.length).toBeGreaterThan(0);

    // Derived, not mirrored: every Anthropic registry model's reported flag must
    // equal its membership of the set the live path consults. A restated literal
    // here would be the hand-maintained mirror this repo keeps paying for.
    const anthropicRows = models.filter((m) => m.id.startsWith('claude-'));
    expect(anthropicRows.length).toBeGreaterThan(0);
    for (const row of anthropicRows) {
      expect(
        row.supports_extended_thinking,
        `reported capability disagrees with THINKING_CAPABLE_MODELS for ${row.id}`,
      ).toBe(THINKING_CAPABLE_MODELS.has(row.id));
    }

    // Positive control on the derivation above: it is only meaningful if the set
    // actually DISCRIMINATES across the rows under test. Both directions of the
    // 2026-08-08 registry error must be represented, or the loop could pass by
    // comparing a constant with itself.
    const byId = new Map(anthropicRows.map((m) => [m.id, m.supports_extended_thinking]));
    expect(byId.get('claude-sonnet-5')).toBe(false);
    expect(byId.get('claude-sonnet-4-6')).toBe(true);
  });
});
