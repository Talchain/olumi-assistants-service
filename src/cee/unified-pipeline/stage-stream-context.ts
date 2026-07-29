/**
 * Ambient stage-emission context (ROADMAP 2.122 / 1.204 M1 — CEE lane 2).
 *
 * ── THE PROBLEM THIS SOLVES, PRECISELY ──────────────────────────────────────
 * `UnifiedPipelineOpts.onStage` (lane 1, #745) is the emission seam. The staged
 * ASSIST route can pass it directly because it calls `runUnifiedPipeline`
 * itself. The streamed TURN route cannot: it reaches the pipeline through the
 * whole V5 turn — route-v2's handler → `dispatchDraftGraph` → `handleDraftGraph`
 * → `runUnifiedPipeline` — and it reaches that handler via `app.inject()`, the
 * same in-process forwarding `/proxy/v5/turn` has used since it shipped.
 *
 * `app.inject()` carries DATA, not callbacks. `onStage` is a function. So the
 * emitter needs a channel that survives the inject boundary without any of the
 * four intermediate layers growing an `onStage` parameter it would otherwise
 * never use.
 *
 * ── WHY AN ASYNC-CONTEXT STORE, AND NOT THE OBVIOUS ALTERNATIVES ────────────
 *  · **Threading `onStage` through four call layers** would mean editing
 *    `route-v2.ts` (250 KB) and the dispatch chain to carry a parameter for one
 *    caller. It also cannot work at all across `app.inject()`, so it would force
 *    extracting the reply-bound `sendFinalised200` (~740 lines) to get the
 *    assembled turn body as a value — the executor surgery this lane is
 *    explicitly forbidden from performing unreviewed.
 *  · **An internal correlation header + a module-level registry** would work,
 *    but it puts a forgeable token on the wire: an external client could send
 *    that header to `/orchestrate/v2/turn` directly. An async-context store is
 *    unreachable from outside the process by construction.
 *
 * ── THE ONE PROPERTY THIS DEPENDS ON, MEASURED RATHER THAN ASSUMED ──────────
 * `AsyncLocalStorage` must survive `app.inject()`. That is not documented
 * behaviour anyone should take on trust, so it was probed at this repo's own
 * fastify version before a line of route code was written: an emitter stored
 * outside the inject, fired from inside the injected handler across
 * `setTimeout`, `process.nextTick` and a promise chain, delivered both frames.
 * See the lane evidence file for the recorded output.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * The store holds ONE field, a `void`-returning emitter. It cannot be read by
 * anything that does not import this module (complete consumer manifest:
 * `orchestrator/tools/draft-graph.ts`). It is set only for the duration of one
 * streamed turn, so a concurrent buffered turn — which runs in its own async
 * context — reads `undefined` and behaves exactly as it did before this lane.
 * That is the mechanism behind "the buffered route is regression-untouched":
 * not a flag, not a URL check, but the absence of a store to read.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PipelineStageEmitter } from "./types.js";

interface StageStreamContext {
  readonly emit: PipelineStageEmitter;
}

const stageStreamStore = new AsyncLocalStorage<StageStreamContext>();

/**
 * Run `fn` with `emit` installed as the ambient stage emitter.
 *
 * Everything `fn` awaits — including a full `app.inject()` round trip through
 * the Fastify hook chain — observes the emitter via {@link currentStageEmitter}.
 */
export function runWithStageStream<T>(
  emit: PipelineStageEmitter,
  fn: () => Promise<T>,
): Promise<T> {
  return stageStreamStore.run({ emit }, fn);
}

/**
 * The ambient stage emitter, or `undefined` when no streamed turn is in flight.
 *
 * `undefined` is the overwhelmingly common case (every buffered turn, every
 * assist route, every test that does not opt in) and it is the case that must
 * stay free: the caller spreads the result conditionally, so an unwired
 * pipeline receives an `opts` object without the key at all — byte-identical to
 * the object it received before this module existed.
 */
export function currentStageEmitter(): PipelineStageEmitter | undefined {
  return stageStreamStore.getStore()?.emit;
}
