/**
 * ⛔ S10: a whole-model `/graph/register` over a SAVED model is only ever CEE's own writer's, never a client's
 * (`assist.v1.scenario-graph-register.ts`, `MODEL_ALREADY_SAVED`). A spec that registers over a stored model to pin one
 * of CEE's writer rules (its compare-and-set, a carry, a held fact), or that stands in for the Agent's in-process
 * dispatch, therefore registers AS that writer: inside the Agent's dispatch mark for that scenario, exactly as
 * `agent-v1-turn.ts` dispatches it (`runAsAgentSubturn`). Every other inject behaves exactly as `app.inject` would.
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { runAsAgentSubturn } from '../../src/orchestrator-v5/session/agent-subturn-context.js';

const REGISTER_URL = /\/scenarios\/([^/?#]+)\/graph\/register(?:[?#]|$)/;

export async function injectAsCeeWriter(app: Pick<FastifyInstance, 'inject'>, opts: InjectOptions | string): Promise<LightMyRequestResponse> {
  const url = typeof opts === 'string' ? opts : opts.url;
  const match = typeof url === 'string' ? REGISTER_URL.exec(url) : null;
  if (match === null) return app.inject(opts);
  // ⚠ AWAITED INSIDE THE MARK: without a callback `inject` returns Light-my-Request's LAZY chain, which only dispatches
  // when `.then` is called, so a chain returned out of the mark would dispatch in the caller's context, unmarked. The
  // served dispatch (`agent-v1-turn.ts` `dispatchFor`) awaits it inside, exactly so.
  return runAsAgentSubturn(decodeURIComponent(match[1]), async () => await app.inject(opts));
}
