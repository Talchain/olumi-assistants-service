/** Real route and real Agent loop; only persistence, identity and HTTP/provider I/O are doubled. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

const db = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return { rows, store: {
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    readRecent: vi.fn(async (sid: string, limit: number) => [...rows.values()].filter((r) => r.scenario_id === sid).slice(-limit)),
    readCommittedTurn: vi.fn(async (sid: string, tid: string) => rows.get(`${sid}:${tid}`) ?? null),
    append: vi.fn(async (r: Record<string, unknown>) => {
      const key = `${r.scenario_id}:${r.turn_id}`;
      if (!rows.has(key)) rows.set(key, { ...r, user_message: r.userMessage ?? null, assistant_message: r.assistantMessage ?? null });
      return { id: String(r.turn_id) };
    }),
    releaseTurnClaim: vi.fn(async (sid: string, tid: string) => { rows.delete(`${sid}:${tid}`); }),
  } };
});
vi.mock('../../session/index.js', () => ({ getSessionStore: () => db.store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...(await original<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('isolated native trial at the real route boundary', () => {
  let app: FastifyInstance;
  let register: (app: FastifyInstance) => Promise<void>;
  const sent: Record<string, unknown>[] = [];
  const script: Record<string, unknown>[] = [];
  const revision = 'b'.repeat(64);
  const say = () => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'We can examine the assumptions in your model.' }] });
  const setup = async (native: boolean) => {
    if (native) process.env.OPENAI_NATIVE_CONTEXT_TRIAL = 'isolated'; else delete process.env.OPENAI_NATIVE_CONTEXT_TRIAL;
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Delivery' }, { id: 'f', kind: 'factor', label: 'Capacity' }],
        edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8 }] },
      graph_hash: revision,
    }));
    a.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    a.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'The analysis could not run.',
      suggested_actions: [], insights: [], blocks: [], graph_hash: revision,
      analysis_ready: { status: 'not_ready', options: [], blockers: [] } }));
    await a.register(register); await a.ready(); return a;
  };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify(script.shift() ?? { id: `resp_wire_${sent.length}`, status: 'completed', output: [say()] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    process.env.OLUMI_ENV = 'staging';
    register = (await import('../../../routes/agent-v1-turn.js')).agentV1TurnRoute;
    app = await setup(true);
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.OPENAI_NATIVE_CONTEXT_TRIAL; delete process.env.AGENT_LANE_ENABLED;
    delete process.env.AGENT_LANE_PREVIEW; delete process.env.OLUMI_ENV;
  });
  const send = (a: FastifyInstance, sid: string, msg: string, extra: Record<string, unknown> = {}) => a.inject({
    method: 'POST', url: '/agent/v1/turn', payload: { scenario_id: sid, message: msg, turn_id: randomUUID(), ...extra },
  });
  const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body.slice(0, 700)).toBe(200);

  it('first/second real turns use native IDs, fresh state and no duplicated history', async () => {
    const sid=randomUUID(); const start=sent.length;
    const a=await send(app,sid,'First unique question');ok(a);
    expect(a.json()._agent.native_context.continuity).toBe('active');
    const b=await send(app,sid,'Second unique question',{previous_response_id:'resp_client_attack'});ok(b);
    expect(sent).toHaveLength(start+2);
    expect(sent[start]!.store).toBe(true);expect(sent[start]!.previous_response_id).toBeUndefined();
    expect(sent[start+1]!.previous_response_id).toBe(`resp_wire_${start+1}`);
    expect(JSON.stringify(sent[start+1]!.input)).not.toContain('First unique question');
    expect(JSON.stringify(sent[start+1]!.input)).toContain('CURRENT MODEL STATE');
    expect(typeof sent[start+1]!.instructions).toBe('string');
    expect(sent[start+1]!.context_management).toBeUndefined();
  });
  it('the existing exact-retry path makes no additional provider call', async () => {
    const sid=randomUUID(),tid=randomUUID();ok(await send(app,sid,'Remember this',{turn_id:tid}));
    const count=sent.length;const retry=await send(app,sid,'Remember this',{turn_id:tid});ok(retry);
    expect(retry.json()._agent.replayed).toBe(true);expect(sent).toHaveLength(count);
    ok(await send(app,sid,'Continue after retry'));
    expect(sent[count]!.previous_response_id).toBe(`resp_wire_${count}`);
  });
  it('a model-chosen tool result is continued, not replayed as another tool call', async () => {
    const sid=randomUUID(),start=sent.length;
    script.push({id:'resp_tool_wire',status:'completed',output:[{type:'function_call',name:'run_analysis',arguments:'{"reason":"requested"}',call_id:'call_real_route'}]});
    const r=await send(app,sid,'Run the analysis');ok(r);
    expect(sent).toHaveLength(start+2);expect(sent[start+1]!.previous_response_id).toBe('resp_tool_wire');
    const items=sent[start+1]!.input as {type?:string;call_id?:string}[];
    expect(items.filter(i=>i.type==='function_call_output'&&i.call_id==='call_real_route')).toHaveLength(1);
    expect(items.some(i=>i.type==='function_call')).toBe(false);
  });
  it('a server restart refuses old conversations without a new provider call', async () => {
    const sid=randomUUID();ok(await send(app,sid,'Before restart'));const count=sent.length;
    const restarted=await setup(true);
    try { const r=await send(restarted,sid,'After restart');expect(r.statusCode).toBe(409);expect(r.json().error).toBe('NATIVE_CONTEXT_RESET_REQUIRED');expect(sent).toHaveLength(count); }
    finally { await restarted.close(); }
  });
  it('changing scenario cannot reuse another scenario session', async () => {
    const sid=randomUUID(),session=`test-${randomUUID()}`;ok(await send(app,sid,'Bound',{agent_session_id:session}));
    const count=sent.length;const r=await send(app,randomUUID(),'Other',{agent_session_id:session});expect(r.statusCode).toBe(404);expect(sent).toHaveLength(count);
  });
  it('an incomplete upstream response invalidates rather than silently truncates memory',async()=>{
    const sid=randomUUID();script.push({id:'resp_incomplete_wire',status:'incomplete',output:[say()]});
    const r=await send(app,sid,'Incomplete');expect(r.statusCode).toBe(502);const count=sent.length;
    const next=await send(app,sid,'Try again');expect(next.statusCode).toBe(409);expect(next.json().error).toBe('NATIVE_CONTEXT_RESET_REQUIRED');expect(sent).toHaveLength(count);
  });
  it('default-OFF mode keeps the original request shape',async()=>{
    const ordinary=await setup(false);const sid=randomUUID(),start=sent.length;
    try {const a=await send(ordinary,sid,'Normal first');ok(a);const b=await send(ordinary,sid,'Normal second');ok(b);
      expect(a.json()._agent.native_context).toBeUndefined();expect(sent[start]!.store).toBeUndefined();
      expect(sent[start+1]!.previous_response_id).toBeUndefined();expect(JSON.stringify(sent[start+1]!.input)).toContain('Normal first');
    }finally{await ordinary.close();}
  });
  it('22 real route turns continue beyond HistoryStore trimming with one current user message per call',async()=>{
    const sid=randomUUID();let previous:string|undefined;
    for(let i=1;i<=22;i++){
      const start=sent.length;const r=await send(app,sid,`Unique continuity probe ${i}`);ok(r);
      expect(sent).toHaveLength(start+1);expect(sent[start]!.previous_response_id).toBe(previous);
      const input=JSON.stringify(sent[start]!.input);
      expect(input).toContain(`Unique continuity probe ${i}`);
      if(i>1)expect(input).not.toContain(`Unique continuity probe ${i-1}\"`);
      previous=`resp_wire_${start+1}`;
    }
  },120_000);
});
