/**
 * POST /orchestrate/v2/turn — V5 orchestrator endpoint (slice A1).
 *
 * A1 scope:
 *   - B1 ingress validator (OrchestratorTurnPayload, strict) → 422 + BoundaryError on failure
 *   - TurnExecutor runs direct_answer only (others → UNHANDLED ErrorBlock)
 *   - B1 egress validator (OlumiResponse) → typed fallback envelope on failure (never 500)
 *   - boundary.validation telemetry on every ingress + egress attempt
 *   - turn_executor.started / completed telemetry around TurnExecutor
 *
 * Route registration is gated on config.features.orchestratorV5. When the flag
 * is off, this route is not registered and the endpoint returns 404.
 *
 * Transport invariant: buffered JSON only (no raw-stream writes, no SSE
 * Content-Type). Enforced by scripts/validate-transport-invariants.sh in CI.
 *
 * No imports from V4 pipeline (pipeline-v4, response-assembler, handlers).
 */

import type { FastifyInstance } from 'fastify';

import { getOrGenerateRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';
import { validateIngress, validateEgress } from '../validators/b1.js';
import { runTurnExecutor } from '../orchestrator-v5/turn-executor.js';

export async function ceeOrchestratorRouteV2(app: FastifyInstance): Promise<void> {
  app.post('/orchestrate/v2/turn', async (req, reply) => {
    const requestId = getOrGenerateRequestId(req);

    const ingress = validateIngress(req.body, requestId);
    if (!ingress.ok) {
      log.warn(
        { request_id: requestId, error: ingress.error.error, issue_count: (ingress.error.details as { issues?: unknown[] }).issues?.length ?? 0 },
        'V5 B1 ingress validation failed',
      );
      return reply.code(422).send(ingress.error);
    }

    // A1: TurnExecutor produces an OlumiResponse (success or typed error block).
    // It never throws past this boundary — every runtime failure → 200 + envelope.
    const run = await runTurnExecutor(ingress.value, requestId);

    const egress = validateEgress(run.response, requestId);
    if (!egress.ok) {
      log.error(
        { request_id: requestId, failure_type: run.telemetry.failure_type },
        'V5 B1 egress validation failed — returning typed fallback envelope',
      );
      return reply.code(200).send(egress.fallback);
    }

    return reply.code(200).send(egress.value);
  });
}
