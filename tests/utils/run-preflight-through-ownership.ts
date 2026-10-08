/** Exercise the production admission hook before the remaining payload preflight. */
import Fastify, { type FastifyRequest } from 'fastify';
import type { BoundaryError } from '@talchain/schemas/boundary';
import type { PreFlightOutcome } from '../../src/orchestrator/route-v2-preflight.js';
import { attachCallerContext, getCallerContext } from '../../src/context/index.js';
import { installOwnershipHarness } from './ownership-route-harness.js';

export async function runPreflightThroughOwnership(
  input: Pick<FastifyRequest, 'body' | 'headers'>,
  validate: (request: FastifyRequest) => Promise<PreFlightOutcome>,
): Promise<PreFlightOutcome> {
  const app = Fastify();
  const caller = getCallerContext(input as FastifyRequest);
  if (caller) app.addHook('onRequest', async request => { attachCallerContext(request, caller); });
  await installOwnershipHarness(app);
  app.post('/orchestrate/v2/turn', { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, async request => ({ preflight: await validate(request) }));
  try {
    const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', headers: input.headers, payload: input.body as object });
    if (response.statusCode === 200) return response.json<{ preflight: PreFlightOutcome }>().preflight;
    if (response.statusCode !== 401 && response.statusCode !== 422) throw new Error(`Unexpected preflight response: ${response.statusCode} ${response.payload}`);
    return { ok: false, status: response.statusCode, error: response.json<BoundaryError>() };
  } finally { await app.close(); }
}
