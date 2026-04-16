/**
 * POST /orchestrate/v2/turn — V5 orchestrator endpoint (slice A0 scaffold).
 *
 * A0 scope:
 *   - B1 ingress validator (OrchestratorTurnPayload, strict) → 422 + BoundaryError on failure
 *   - B1 egress validator (OlumiResponse) → typed fallback envelope on failure (never 500)
 *   - Feature-unavailable happy response (no TurnExecutor, no LLM, no handlers)
 *   - boundary.validation telemetry on every ingress + egress attempt
 *
 * Route registration is gated on config.features.orchestratorV5. When the flag
 * is off, this route is not registered and the endpoint returns 404.
 *
 * No imports from V4 pipeline (pipeline-v4, response-assembler, handlers).
 */

import type { FastifyInstance } from 'fastify';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { getOrGenerateRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';
import { validateIngress, validateEgress } from '../validators/b1.js';

// A0 "feature unavailable" envelope. Returned whenever ingress passes.
// Chosen (over a "not yet implemented" string) so that if the flag accidentally
// flips on in any environment, the client still sees a typed, explainable error.
function buildFeatureUnavailableResponse(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'V5 orchestrator is not enabled.',
    blocks: [
      { type: 'error', error_code: 'FEATURE_NOT_ENABLED', severity: 'info' },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  };
}

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

    // A0: no TurnExecutor. Build the feature-unavailable envelope and still
    // run it through the egress validator to catch shape drift.
    const candidate = buildFeatureUnavailableResponse();
    const egress = validateEgress(candidate, requestId);
    if (!egress.ok) {
      log.error(
        { request_id: requestId },
        'V5 B1 egress validation failed — returning typed fallback envelope',
      );
      return reply.code(200).send(egress.fallback);
    }

    return reply.code(200).send(egress.value);
  });
}
