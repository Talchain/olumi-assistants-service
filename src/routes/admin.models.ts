/** Admin status route for the shared adapter-free model routing projection. */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import { AI_TASK_LIFECYCLE } from '../config/model-routing.js';
import {
  resolveModelRoutingSnapshot,
  resolveTaskRouting,
} from '../adapters/llm/model-routing-report.js';

// Compatibility export for existing tests/operators. The implementation lives
// below both the admin route and startup, so neither can become a second router.
export { resolveTaskRouting };

export async function adminModelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/models/routing', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const snapshot = resolveModelRoutingSnapshot();
    return reply
      .header('Cache-Control', 'no-store')
      .status(200)
      .send({
        tasks: snapshot.tasks,
        task_lifecycle: AI_TASK_LIFECYCLE,
        default_provider: snapshot.default_provider,
        timestamp: new Date().toISOString(),
      });
  });
}
