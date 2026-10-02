// Apply an exact-base, branch-only patch. This script is tooling, never a runtime loader.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const routePath = 'src/routes/agent-v1-turn.ts';
const loopPath = 'src/orchestrator-v5/agent-lane/runtime/agent-loop.ts';
const routeBefore = readFileSync(routePath, 'utf8');
const loopBefore = readFileSync(loopPath, 'utf8');
const blob = s => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
if (routeBefore.includes('nativeContextTrialEnabled') && loopBefore.includes('readonly nativeContext?:')) {
  console.log('Native context integration already applied; no files changed.');
  process.exit(0);
}
if (blob(routeBefore) !== 'b46bc290eb21411ec416c1d8e7ce612ba6a039d8'
  || blob(loopBefore) !== 'e00fc1a5b95366c73573ca944e341539302d6579') throw new Error('Frozen source changed; inspect before applying this patch.');
function once(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Expected exactly one anchor: ${before.slice(0,100)}`);
  return text.replace(before, after);
}
let route = routeBefore;
route = once(route, "import { runFencedInProcessWrite }", "import { NativeContextStore, NativeContextTrialError, nativeContextTrialEnabled, type NativeContextTurn } from '../orchestrator-v5/agent-lane/runtime/native-context-trial.js';\nimport { runFencedInProcessWrite }");
route = once(route, "  if (config.proxy.agentLaneEnabled !== true) return;", "  if (config.proxy.agentLaneEnabled !== true) return;\n  const nativeContexts = nativeContextTrialEnabled(process.env) ? new NativeContextStore() : undefined;");
route = once(route, '      input: req.input,\n      tools: req.tools,', `      input: req.input,
      ...(req.previous_response_id !== undefined ? { previous_response_id: req.previous_response_id } : {}),
      ...(req.store !== undefined ? { store: req.store } : {}),
      tools: req.tools,`);
route = once(route, "    const breakpoint = alias === 'agent.converse' && !instructionsBreakpointRefused;", "    // Native chains resend top-level instructions; do not accumulate cached developer copies in history.\n    const breakpoint = req.store !== true && alias === 'agent.converse' && !instructionsBreakpointRefused;");
route = once(route, 'const j = (await r.json()) as { output: Record<string, unknown>[];', 'const j = (await r.json()) as { id?: unknown; output: Record<string, unknown>[];');
route = once(route, '      output: j.output,\n', "      output: j.output,\n      ...(typeof j.id === 'string' ? { id: j.id } : {}),\n");
route = once(route, '    const dispatchLedger: DispatchTiming[] = [];', `    // The trial owns only the response-chain cursor; existing ownership checks already ran.
    let nativeTurn: NativeContextTurn | undefined;
    if (nativeContexts !== undefined) {
      try {
        if (turnId === undefined) throw new NativeContextTrialError('NATIVE_CONTEXT_TURN_ID_REQUIRED', 'Use the normal test interface, which supplies a retry-safe turn identifier.');
        nativeTurn = await nativeContexts.begin({ scenarioId, userId, sessionId }, async () => {
          if (typeof store.readRecent !== 'function') throw new Error('Conversation store unavailable.');
          return (await store.readRecent(scenarioId, 1)).length > 0;
        });
      } catch (err) {
        return reply.code(409).send({ error: err instanceof NativeContextTrialError ? err.code : 'NATIVE_CONTEXT_UNAVAILABLE',
          detail: err instanceof NativeContextTrialError ? err.message : 'The trial could not verify a fresh conversation. Nothing was run; try a new test decision.' });
      }
    }
    try {
    const dispatchLedger: DispatchTiming[] = [];`);
route = once(route, '    let writesDispatched = 0;', '    nativeTurn?.startWork();\n    let writesDispatched = 0;');
route = once(route, '          ctx: toolCtx,\n          history,', '          ctx: toolCtx,\n          ...(nativeTurn !== undefined ? { nativeContext: nativeTurn } : {}),\n          history,');
route = once(route, '    const notModelledCarrier = notModelledTurnCarrier(notModelled, graphHash);', `    nativeTurn?.finish(message, String(wireBody.assistant_text ?? text), durability === 'recorded');
    const notModelledCarrier = notModelledTurnCarrier(notModelled, graphHash);`);
route = once(route, '      _agent: {\n        session_id: sessionId,\n        mode,', '      _agent: {\n        session_id: sessionId,\n        mode,\n        ...(nativeTurn !== undefined ? { native_context: nativeTurn.diagnostic() } : {}),');
route = once(route, "  };\n  app.post('/agent/v1/turn'", "    } finally { nativeTurn?.close(); }\n  };\n  app.post('/agent/v1/turn'");
let loop = loopBefore;
loop = once(loop, "import { randomUUID } from 'node:crypto';", "import { randomUUID } from 'node:crypto';\nimport { NativeContextTrialError, type NativeContextTurn } from './native-context-trial.js';");
loop = once(loop, 'export interface ModelCallRequest {', 'export interface ModelCallRequest {\n  readonly previous_response_id?: string;\n  readonly store?: boolean;');
loop = once(loop, 'export interface ModelCallResponse {', 'export interface ModelCallResponse {\n  readonly id?: string;');
loop = once(loop, 'export interface AgentTurnInput {', 'export interface AgentTurnInput {\n  readonly nativeContext?: NativeContextTurn;');
loop = once(loop, '  const items: unknown[] = [', `  if (input.nativeContext !== undefined && stateItem === undefined) {
    throw new NativeContextTrialError('NATIVE_CONTEXT_STATE_UNAVAILABLE', 'Current model state could not be verified. Nothing new was run; start a new test decision.');
  }
  const items: unknown[] = [`);
loop = once(loop, '  const handedOn = (): unknown[] => (stateItem === undefined ? items : items.filter((i) => i !== stateItem));', `  const handedOn = (): unknown[] => {
    input.nativeContext?.capture(items.slice(input.history.length));
    return stateItem === undefined ? items : items.filter((i) => i !== stateItem);
  };`);
loop = once(loop, "      void callModel({ ...request, input: [...items], max_output_tokens: PREWARM_OUTPUT_TOKENS, deadline_ms: PREWARM_DEADLINE_MS, purpose: 'prewarm' })", "      // No detached prewarm in the trial: it cannot advance the native chain or warm its different prefix.\n      if (input.nativeContext === undefined) void callModel({ ...request, input: [...items], max_output_tokens: PREWARM_OUTPUT_TOKENS, deadline_ms: PREWARM_DEADLINE_MS, purpose: 'prewarm' })");
loop = once(loop, '      : await callModel(request);', '      : input.nativeContext !== undefined\n        ? await input.nativeContext.call({ ...request, input: items.slice(input.history.length) }, callModel)\n        : await callModel(request);');
// Validate both files before writing either. No unrelated source or prompt is changed.
writeFileSync(routePath, route);
writeFileSync(loopPath, loop);
console.log('Applied isolated native continuation to route and loop.');
