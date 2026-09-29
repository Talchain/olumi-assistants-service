/**
 * The Canvas vocabulary must reach the handlers, not a refusal.
 *
 * ⛔ THE MEASURED FAILURE. `/agent/v1/turn` handled only `kind: 'message'` and
 * refused everything else. Setting `PROXY_V5_TARGET=agent` therefore pointed
 * the browser proxy at a route that answered every Canvas action with
 * "That kind of change does not come through this conversation route"
 * (`stopped_reason: unsupported_kind`) — `factor_value_edit`,
 * `structural_rename`, the whole direct-manipulation vocabulary. The entire
 * Canvas surface stopped working on staging, and another lane caught it with a
 * wire witness.
 *
 * The refusal was a choice between refusing and silently dropping. The third
 * option — forward it to the boundary every tool in this lane already writes
 * through — is the correct one. A factor edit is the user's own hand on their
 * own model: there is nothing for an agent to decide.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const ENV = ['AGENT_LANE_ENABLED', 'AGENT_LANE_PREVIEW'] as const;

/**
 * ⛔ ONE APP PER MODE, BUILT ONCE — and the reason is measured, not stylistic.
 *
 * Each test used to build its own app: `vi.resetModules()` plus a COLD import of
 * the whole route module and its dependency tree, five times over. Alone that
 * passes; under the full agent-lane suite it failed 3/3 locally, always on a
 * 5 s timeout in the first test, and an independent review saw the same on
 * pure staging 9c16e8cd. A test that only passes on a quiet machine is a red
 * waiting to land on everyone's required check.
 *
 * The route resolves `mode` from config at REGISTRATION, so full and preview
 * genuinely need separate module instances — two imports, not five — and the
 * cold import gets a hook timeout sized for a cold import instead of the 5 s
 * test default. Assertions are unchanged.
 */
const COLD_IMPORT_MS = 60_000;

/** A real app: the route under test, plus a recorder standing in for the orchestrator. */
async function appWith(preview: boolean): Promise<{ app: FastifyInstance; seen: unknown[] }> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV) saved[k] = process.env[k];
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = preview ? 'true' : 'false';
  try {
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const app = Fastify({ logger: false });
    const seen: unknown[] = [];
    app.post('/orchestrate/v2/turn', async (req) => {
      seen.push(req.body);
      return { response_version: 2, assistant_text: 'Updated.', blocks: [], suggested_actions: [], insights: [], graph_hash: 'h1' };
    });
    // Registration is where the route reads its mode, so it must happen while
    // the env still says what this app is for.
    await app.register(agentV1TurnRoute);
    await app.ready();
    return { app, seen };
  } finally {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const CANVAS_EDIT = {
  kind: 'system_event',
  turn_id: '550e8400-e29b-41d4-a716-446655440000',
  scenario_id: '11111111-1111-1111-1111-111111111111',
  stage: 'frame',
  event: { kind: 'factor_value_edit', target_id: 'pro_plan_price', value: 0.59, raw_value: 59, unit: 'GBP' },
};


describe('direct manipulation is forwarded, not refused', () => {
  let app: FastifyInstance;
  let seen: unknown[];
  beforeAll(async () => { ({ app, seen } = await appWith(false)); }, COLD_IMPORT_MS);
  afterAll(async () => { await app.close(); });
  // Same array the stub pushes into, emptied in place so each test sees only its own posts.
  beforeEach(() => { seen.length = 0; });

  it('delivers the payload to the handlers BYTE-IDENTICALLY', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: CANVAS_EDIT });
    expect(res.statusCode).toBe(200);
    // ⭐ Bound by IDENTITY, not by "a call happened": the handler must receive
    // the user's own event unchanged, or the edit it applies is not theirs.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(CANVAS_EDIT);
    const body = res.json() as Record<string, unknown>;
    expect(body.assistant_text).toBe('Updated.');
    // ⛔ The exact refusal that broke Canvas must be gone.
    expect(JSON.stringify(body)).not.toMatch(/does not come through this conversation route/);
    expect((body._agent as { stopped_reason?: string } | undefined)?.stopped_reason).not.toBe('unsupported_kind');
  });

  it('says plainly that the turn was NOT agent-handled', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: CANVAS_EDIT });
    const trace = (res.json() as { _diagnostic_trace?: Record<string, unknown> })._diagnostic_trace;
    expect(trace?.exit_path).toBe('agent_lane_forwarded');
    expect(trace?.forwarded_kind).toBe('system_event');
  });

  it('forwards every kind in the vocabulary, not just the one that was reported', async () => {
    for (const k of ['structural_rename', 'structural_add_edge', 'chip_click', 'undo', 'patch_accepted']) {
      await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { ...CANVAS_EDIT, kind: k } });
    }
    expect(seen.map((b) => (b as { kind: string }).kind)).toEqual([
      'structural_rename', 'structural_add_edge', 'chip_click', 'undo', 'patch_accepted',
    ]);
  });

  it('CONTRAST CONTROL: a conversational turn is NOT forwarded — it is the Agent’s', async () => {
    await app.inject({
      method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: CANVAS_EDIT.scenario_id, message: 'what is in the model?' },
    });
    // It will fail for want of an OpenAI key, and that is fine: what matters is
    // that it did NOT take the forwarding path.
    expect(seen.filter((b) => (b as { kind?: string }).kind === 'message')).toHaveLength(0);
  });
});

describe('preview still refuses — the hard boundary does not move', () => {
  let app: FastifyInstance;
  let seen: unknown[];
  beforeAll(async () => { ({ app, seen } = await appWith(true)); }, COLD_IMPORT_MS);
  afterAll(async () => { await app.close(); });
  // Same array the stub pushes into, emptied in place so each test sees only its own posts.
  beforeEach(() => { seen.length = 0; });

  it('refuses a canvas edit and writes NOTHING', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: CANVAS_EDIT });
    expect(res.statusCode).toBe(200);
    // ⛔ The whole point of preview: nothing reached the handlers.
    expect(seen).toHaveLength(0);
    const body = res.json() as Record<string, unknown>;
    expect((body._agent as { stopped_reason?: string }).stopped_reason).toBe('read_only_preview');
    expect(String(body.assistant_text)).toMatch(/read-only preview/);
  });
});
