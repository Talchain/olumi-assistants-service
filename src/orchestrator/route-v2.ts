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
import { parseRequestExtensions } from '../orchestrator-v5/boundary/request-extensions.js';

// Phase 1.5: B1's OrchestratorTurnPayload schema is `strict` (rejects unknown
// keys), so we cannot pass `graph_state` / `analysis_state` straight through
// to `validateIngress`. Extract them first via the Phase 1.5 extension
// validator, then hand a stripped body to B1. Order is deliberate — if the
// extensions parse fails, we want the 422 to name the specific field before
// any other boundary error.
const V5_EXTENSION_FIELDS = ['graph_state', 'analysis_state'] as const;

function stripExtensionFields(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of V5_EXTENSION_FIELDS) delete copy[k];
  return copy;
}

export async function ceeOrchestratorRouteV2(app: FastifyInstance): Promise<void> {
  app.post('/orchestrate/v2/turn', async (req, reply) => {
    const requestId = getOrGenerateRequestId(req);

    // Phase 1.5: parse graph_state + analysis_state FIRST. @talchain's
    // OrchestratorTurnPayload schema is `strict` and would reject these
    // fields as unrecognized keys if we ran B1 first. See
    // Docs/v5/phase1.5-wire-investigation.md for wire rationale.
    const extensions = parseRequestExtensions(req.body, requestId);
    if (!extensions.ok) {
      log.warn(
        {
          request_id: requestId,
          error: extensions.error.error,
          field: (extensions.error.details as { field?: string }).field,
          issue_count: (extensions.error.details as { issues?: unknown[] }).issues?.length ?? 0,
        },
        'V5 request-extensions validation failed',
      );
      return reply.code(422).send(extensions.error);
    }

    // B1 ingress on the base body (graph/analysis stripped to appease strict mode).
    const strippedBody = stripExtensionFields(req.body);
    const ingress = validateIngress(strippedBody, requestId);
    if (!ingress.ok) {
      log.warn(
        { request_id: requestId, error: ingress.error.error, issue_count: (ingress.error.details as { issues?: unknown[] }).issues?.length ?? 0 },
        'V5 B1 ingress validation failed',
      );
      return reply.code(422).send(ingress.error);
    }

    // TurnExecutor produces an OlumiResponse (success or typed error block).
    // It never throws past this boundary — every runtime failure → 200 + envelope.
    const run = await runTurnExecutor(ingress.value, requestId, {
      graphState: extensions.value.graphState,
      analysisState: extensions.value.analysisState,
    });

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
