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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const ENV = ['AGENT_LANE_ENABLED', 'AGENT_LANE_PREVIEW'] as const;
const saved: Record<string, string | undefined> = {};

/** A real app: the route under test, plus a recorder standing in for the orchestrator. */
async function appWith(preview: boolean): Promise<{ app: FastifyInstance; seen: unknown[] }> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = preview ? 'true' : 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  const seen: unknown[] = [];
  app.post('/orchestrate/v2/turn', async (req) => {
    seen.push(req.body);
    return { response_version: 2, assistant_text: 'Updated.', blocks: [], suggested_actions: [], insights: [], graph_hash: 'h1' };
  });
  await app.register(agentV1TurnRoute);
  await app.ready();
  return { app, seen };
}

const CANVAS_EDIT = {
  kind: 'system_event',
  turn_id: '550e8400-e29b-41d4-a716-446655440000',
  scenario_id: '11111111-1111-1111-1111-111111111111',
  stage: 'frame',
  event: { kind: 'factor_value_edit', target_id: 'pro_plan_price', value: 0.59, raw_value: 59, unit: 'GBP' },
};

beforeEach(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('direct manipulation is forwarded, not refused', () => {
  it('delivers the payload to the handlers BYTE-IDENTICALLY', async () => {
    const { app, seen } = await appWith(false);
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
    await app.close();
  });

  it('says plainly that the turn was NOT agent-handled', async () => {
    const { app } = await appWith(false);
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: CANVAS_EDIT });
    const trace = (res.json() as { _diagnostic_trace?: Record<string, unknown> })._diagnostic_trace;
    expect(trace?.exit_path).toBe('agent_lane_forwarded');
    expect(trace?.forwarded_kind).toBe('system_event');
    await app.close();
  });

  it('forwards every kind in the vocabulary, not just the one that was reported', async () => {
    const { app, seen } = await appWith(false);
    for (const k of ['structural_rename', 'structural_add_edge', 'chip_click', 'undo', 'patch_accepted']) {
      await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { ...CANVAS_EDIT, kind: k } });
    }
    expect(seen.map((b) => (b as { kind: string }).kind)).toEqual([
      'structural_rename', 'structural_add_edge', 'chip_click', 'undo', 'patch_accepted',
    ]);
    await app.close();
  });

  it('CONTRAST CONTROL: a conversational turn is NOT forwarded — it is the Agent’s', async () => {
    const { app, seen } = await appWith(false);
    await app.inject({
      method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: CANVAS_EDIT.scenario_id, message: 'what is in the model?' },
    });
    // It will fail for want of an OpenAI key, and that is fine: what matters is
    // that it did NOT take the forwarding path.
    expect(seen.filter((b) => (b as { kind?: string }).kind === 'message')).toHaveLength(0);
    await app.close();
  });
});

describe('preview still refuses — the hard boundary does not move', () => {
  it('refuses a canvas edit and writes NOTHING', async () => {
    const { app, seen } = await appWith(true);
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: CANVAS_EDIT });
    expect(res.statusCode).toBe(200);
    // ⛔ The whole point of preview: nothing reached the handlers.
    expect(seen).toHaveLength(0);
    const body = res.json() as Record<string, unknown>;
    expect((body._agent as { stopped_reason?: string }).stopped_reason).toBe('read_only_preview');
    expect(String(body.assistant_text)).toMatch(/read-only preview/);
    await app.close();
  });
});
