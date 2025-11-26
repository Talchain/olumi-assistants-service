/**
 * Admin Prompt Management Routes
 *
 * Provides CRUD operations for managed prompts with versioning,
 * rollback, and experiment management.
 *
 * **Security:** Requires admin API key via X-Admin-Key header
 *
 * Routes:
 * - GET    /admin/prompts         - List all prompts
 * - POST   /admin/prompts         - Create new prompt
 * - GET    /admin/prompts/:id     - Get prompt by ID
 * - PATCH  /admin/prompts/:id     - Update prompt metadata
 * - DELETE /admin/prompts/:id     - Delete/archive prompt
 * - POST   /admin/prompts/:id/versions - Create new version
 * - POST   /admin/prompts/:id/rollback - Rollback to version
 * - GET    /admin/prompts/:id/diff     - Compare versions
 *
 * Experiment routes:
 * - GET    /admin/experiments     - List experiments
 * - POST   /admin/experiments     - Start experiment
 * - DELETE /admin/experiments/:name - End experiment
 * - GET    /admin/experiments/:name/stats - Get experiment stats
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  getPromptStore,
  isPromptStoreHealthy,
  CreatePromptRequestSchema,
  CreateVersionRequestSchema,
  UpdatePromptRequestSchema,
  RollbackRequestSchema,
  getAuditLogger,
  logPromptCreated,
  logPromptUpdated,
  logVersionCreated,
  logVersionRollback,
  logStatusChanged,
  logExperimentStarted,
  logExperimentEnded,
} from '../prompts/index.js';
import { getBraintrustManager } from '../prompts/braintrust.js';
import { log, emit } from '../utils/telemetry.js';
import { config } from '../config/index.js';

/**
 * Telemetry events
 */
const AdminTelemetryEvents = {
  AdminAuthFailed: 'admin.auth.failed',
  AdminIPBlocked: 'admin.ip.blocked',
  AdminPromptAccess: 'admin.prompt.access',
  AdminExperimentAccess: 'admin.experiment.access',
} as const;

/**
 * Permission level for admin operations
 */
type AdminPermission = 'read' | 'write';

/**
 * Parse and cache allowed IPs from config
 */
function getAllowedIPs(): Set<string> | null {
  const allowedIPsConfig = config.prompts?.adminAllowedIPs;
  if (!allowedIPsConfig || allowedIPsConfig.trim() === '') {
    return null; // No restriction
  }

  return new Set(
    allowedIPsConfig
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0)
  );
}

/**
 * Check if request IP is allowed
 * Returns true if allowed, sends error response if blocked
 */
function verifyIPAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const allowedIPs = getAllowedIPs();

  // No IP restriction configured
  if (!allowedIPs) {
    return true;
  }

  const requestIP = request.ip;

  // Check if IP is in allowlist
  // Also check for common localhost representations
  const isAllowed =
    allowedIPs.has(requestIP) ||
    (requestIP === '::1' && allowedIPs.has('127.0.0.1')) ||
    (requestIP === '127.0.0.1' && allowedIPs.has('::1'));

  if (!isAllowed) {
    emit(AdminTelemetryEvents.AdminIPBlocked, {
      ip: requestIP,
      path: request.url,
      allowedCount: allowedIPs.size,
    });
    log.warn({ ip: requestIP, path: request.url }, 'Admin access blocked by IP allowlist');
    reply.status(403).send({
      error: 'ip_not_allowed',
      message: 'Your IP address is not authorized for admin access',
    });
    return false;
  }

  return true;
}

/**
 * Verify admin API key with permission level
 *
 * Supports two key types:
 * - ADMIN_API_KEY: Full read/write access
 * - ADMIN_API_KEY_READ: Read-only access (list, get, diff only)
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 * @param requiredPermission - 'read' for read-only ops, 'write' for mutations
 * @returns true if authorized, false if error response sent
 */
function verifyAdminKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredPermission: AdminPermission = 'write'
): boolean {
  // First check IP allowlist
  if (!verifyIPAllowed(request, reply)) {
    return false;
  }

  const adminKey = config.prompts?.adminApiKey;
  const adminKeyRead = config.prompts?.adminApiKeyRead;

  // At least one key must be configured
  if (!adminKey && !adminKeyRead) {
    log.warn('No admin API keys configured, admin routes disabled');
    reply.status(503).send({
      error: 'admin_not_configured',
      message: 'Admin API is not configured',
    });
    return false;
  }

  const providedKey = request.headers['x-admin-key'] as string;

  if (!providedKey) {
    emit(AdminTelemetryEvents.AdminAuthFailed, {
      ip: request.ip,
      path: request.url,
      reason: 'missing_key',
    });
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Missing admin API key',
    });
    return false;
  }

  // Check full access key
  if (adminKey && providedKey === adminKey) {
    return true;
  }

  // Check read-only key
  if (adminKeyRead && providedKey === adminKeyRead) {
    // Read-only key provided - check if operation is read-only
    if (requiredPermission === 'write') {
      emit(AdminTelemetryEvents.AdminAuthFailed, {
        ip: request.ip,
        path: request.url,
        reason: 'insufficient_permission',
      });
      reply.status(403).send({
        error: 'forbidden',
        message: 'Read-only key cannot perform write operations',
      });
      return false;
    }
    return true;
  }

  // Invalid key
  emit(AdminTelemetryEvents.AdminAuthFailed, {
    ip: request.ip,
    path: request.url,
    reason: 'invalid_key',
  });
  reply.status(401).send({
    error: 'unauthorized',
    message: 'Invalid admin API key',
  });
  return false;
}

/**
 * Check if prompt management is enabled
 */
function isPromptManagementEnabled(): boolean {
  return config.prompts?.enabled === true;
}

/**
 * Check if the prompt store is healthy and return appropriate error if not
 * Returns true if healthy, false if error response was sent
 */
function ensureStoreHealthy(reply: FastifyReply): boolean {
  if (!isPromptStoreHealthy()) {
    log.warn('Prompt store is not healthy, admin operation rejected');
    reply.status(503).send({
      error: 'store_unavailable',
      message: 'Prompt store is not available. The store may have failed to initialize.',
    });
    return false;
  }
  return true;
}

/**
 * Get actor identifier from request (admin key ID or IP)
 */
function getActorFromRequest(request: FastifyRequest): string {
  // Could be enhanced to extract key ID from admin key header
  return `admin@${request.ip}`;
}

// =========================================================================
// Request Schemas
// =========================================================================

const ListPromptsQuerySchema = z.object({
  taskId: z.string().optional(),
  status: z.enum(['draft', 'staging', 'production', 'archived']).optional(),
  tags: z.string().optional(), // Comma-separated
});

const PromptIdParamsSchema = z.object({
  id: z.string().min(1),
});

const DiffQuerySchema = z.object({
  versionA: z.coerce.number().int().positive(),
  versionB: z.coerce.number().int().positive(),
});

const StartExperimentSchema = z.object({
  name: z.string().min(1).max(128),
  promptId: z.string().min(1),
  versionA: z.number().int().positive(),
  versionB: z.number().int().positive(),
  trafficSplit: z.number().min(0).max(1).default(0.5),
});

const ExperimentNameParamsSchema = z.object({
  name: z.string().min(1),
});

// =========================================================================
// Routes
// =========================================================================

export async function adminPromptRoutes(app: FastifyInstance): Promise<void> {
  // =========================================================================
  // Rate Limiting
  // =========================================================================

  /**
   * Apply rate limiting to all admin endpoints
   * - 100 requests per 15 minutes per API key/IP combination
   * - Prevents brute-force attacks and abuse
   */
  await app.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000, // 15 minutes
    keyGenerator: (request) => {
      // Rate limit by admin key + IP for granular control
      const adminKey = request.headers['x-admin-key'] as string ?? '';
      return `${adminKey.slice(0, 8)}:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    }),
  });

  // =========================================================================
  // Prompt CRUD
  // =========================================================================

  /**
   * GET /admin/prompts - List all prompts
   * Permission: read
   */
  app.get('/admin/prompts', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    const query = ListPromptsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: query.error.flatten(),
      });
    }

    const store = getPromptStore();
    const prompts = await store.list({
      taskId: query.data.taskId,
      status: query.data.status,
      tags: query.data.tags?.split(','),
    });

    emit(AdminTelemetryEvents.AdminPromptAccess, {
      action: 'list',
      count: prompts.length,
    });

    return reply.status(200).send({
      prompts,
      total: prompts.length,
    });
  });

  /**
   * POST /admin/prompts - Create new prompt
   */
  app.post('/admin/prompts', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const body = CreatePromptRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    try {
      const store = getPromptStore();
      const prompt = await store.create(body.data);
      const actor = getActorFromRequest(request);

      // Audit log
      const auditLogger = getAuditLogger();
      await logPromptCreated(auditLogger, prompt.id, actor, {
        taskId: prompt.taskId,
        name: prompt.name,
        ip: request.ip,
      });

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'create',
        promptId: prompt.id,
      });

      return reply.status(201).send(prompt);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return reply.status(409).send({
          error: 'conflict',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * GET /admin/prompts/:id - Get prompt by ID
   * Permission: read
   */
  app.get('/admin/prompts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const store = getPromptStore();
    const prompt = await store.get(params.data.id);

    if (!prompt) {
      return reply.status(404).send({
        error: 'not_found',
        message: `Prompt '${params.data.id}' not found`,
      });
    }

    emit(AdminTelemetryEvents.AdminPromptAccess, {
      action: 'get',
      promptId: params.data.id,
    });

    return reply.status(200).send(prompt);
  });

  /**
   * PATCH /admin/prompts/:id - Update prompt metadata
   */
  app.patch('/admin/prompts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const body = UpdatePromptRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    try {
      const store = getPromptStore();
      const beforePrompt = await store.get(params.data.id);
      const prompt = await store.update(params.data.id, body.data);
      const actor = getActorFromRequest(request);

      // Audit log
      const auditLogger = getAuditLogger();
      await logPromptUpdated(
        auditLogger,
        params.data.id,
        actor,
        { status: beforePrompt?.status, activeVersion: beforePrompt?.activeVersion },
        { status: prompt.status, activeVersion: prompt.activeVersion }
      );

      // Additional audit for status changes
      if (body.data.status && beforePrompt && beforePrompt.status !== body.data.status) {
        await logStatusChanged(auditLogger, params.data.id, beforePrompt.status, body.data.status, actor);
      }

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'update',
        promptId: params.data.id,
      });

      return reply.status(200).send(prompt);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({
          error: 'not_found',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * DELETE /admin/prompts/:id - Delete/archive prompt
   */
  app.delete('/admin/prompts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    // Check for hard delete query param
    const hardDelete = (request.query as Record<string, string>).hard === 'true';

    try {
      const store = getPromptStore();
      await store.delete(params.data.id, hardDelete);

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: hardDelete ? 'hard_delete' : 'archive',
        promptId: params.data.id,
      });

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({
          error: 'not_found',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * POST /admin/prompts/:id/versions - Create new version
   */
  app.post('/admin/prompts/:id/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const body = CreateVersionRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    try {
      const store = getPromptStore();
      const prompt = await store.createVersion(params.data.id, body.data);
      const newVersion = prompt.versions[prompt.versions.length - 1].version;
      const actor = getActorFromRequest(request);

      // Audit log
      const auditLogger = getAuditLogger();
      await logVersionCreated(auditLogger, params.data.id, newVersion, actor, body.data.changeNote);

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'create_version',
        promptId: params.data.id,
        version: newVersion,
      });

      return reply.status(201).send(prompt);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({
          error: 'not_found',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * POST /admin/prompts/:id/rollback - Rollback to version
   */
  app.post('/admin/prompts/:id/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const body = RollbackRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    try {
      const store = getPromptStore();
      const beforePrompt = await store.get(params.data.id);
      const fromVersion = beforePrompt?.activeVersion ?? 0;
      const prompt = await store.rollback(params.data.id, body.data);
      const actor = getActorFromRequest(request);

      // Audit log
      const auditLogger = getAuditLogger();
      await logVersionRollback(
        auditLogger,
        params.data.id,
        fromVersion,
        body.data.targetVersion,
        actor,
        body.data.reason
      );

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'rollback',
        promptId: params.data.id,
        targetVersion: body.data.targetVersion,
        reason: body.data.reason,
      });

      return reply.status(200).send(prompt);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('not found') || error.message.includes('Version'))) {
        return reply.status(404).send({
          error: 'not_found',
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * GET /admin/prompts/:id/diff - Compare versions
   * Permission: read
   */
  app.get('/admin/prompts/:id/diff', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const query = DiffQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: query.error.flatten(),
      });
    }

    const store = getPromptStore();
    const prompt = await store.get(params.data.id);

    if (!prompt) {
      return reply.status(404).send({
        error: 'not_found',
        message: `Prompt '${params.data.id}' not found`,
      });
    }

    const versionA = prompt.versions.find(v => v.version === query.data.versionA);
    const versionB = prompt.versions.find(v => v.version === query.data.versionB);

    if (!versionA || !versionB) {
      return reply.status(404).send({
        error: 'version_not_found',
        message: `One or both versions not found`,
      });
    }

    // Simple line-by-line diff
    const linesA = versionA.content.split('\n');
    const linesB = versionB.content.split('\n');

    const diff = {
      versionA: {
        version: versionA.version,
        createdAt: versionA.createdAt,
        createdBy: versionA.createdBy,
        lineCount: linesA.length,
        charCount: versionA.content.length,
      },
      versionB: {
        version: versionB.version,
        createdAt: versionB.createdAt,
        createdBy: versionB.createdBy,
        lineCount: linesB.length,
        charCount: versionB.content.length,
      },
      changes: {
        linesDelta: linesB.length - linesA.length,
        charsDelta: versionB.content.length - versionA.content.length,
      },
      contentA: versionA.content,
      contentB: versionB.content,
    };

    emit(AdminTelemetryEvents.AdminPromptAccess, {
      action: 'diff',
      promptId: params.data.id,
      versionA: query.data.versionA,
      versionB: query.data.versionB,
    });

    return reply.status(200).send(diff);
  });

  // =========================================================================
  // Experiment Management
  // =========================================================================

  /**
   * GET /admin/experiments - List experiments
   * Permission: read
   */
  app.get('/admin/experiments', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const manager = getBraintrustManager();

    // Get experiment list from manager (we'll need to expose this)
    emit(AdminTelemetryEvents.AdminExperimentAccess, {
      action: 'list',
    });

    return reply.status(200).send({
      message: 'Experiment listing available through Braintrust dashboard',
      braintrust_available: manager.isAvailable(),
    });
  });

  /**
   * POST /admin/experiments - Start experiment
   */
  app.post('/admin/experiments', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    const body = StartExperimentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    // Verify prompt exists
    if (isPromptManagementEnabled()) {
      const store = getPromptStore();
      const prompt = await store.get(body.data.promptId);

      if (!prompt) {
        return reply.status(404).send({
          error: 'prompt_not_found',
          message: `Prompt '${body.data.promptId}' not found`,
        });
      }

      // Verify versions exist
      const hasVersionA = prompt.versions.some(v => v.version === body.data.versionA);
      const hasVersionB = prompt.versions.some(v => v.version === body.data.versionB);

      if (!hasVersionA || !hasVersionB) {
        return reply.status(400).send({
          error: 'version_not_found',
          message: 'One or both versions do not exist',
        });
      }
    }

    const manager = getBraintrustManager();
    const experimentConfig = {
      name: body.data.name,
      promptId: body.data.promptId,
      versionA: body.data.versionA,
      versionB: body.data.versionB,
      trafficSplit: body.data.trafficSplit,
    };
    manager.startExperiment(experimentConfig);
    const actor = getActorFromRequest(request);

    // Audit log
    const auditLogger = getAuditLogger();
    await logExperimentStarted(auditLogger, experimentConfig.name, actor, {
      promptId: experimentConfig.promptId,
      versionA: experimentConfig.versionA,
      versionB: experimentConfig.versionB,
      trafficSplit: experimentConfig.trafficSplit,
    });

    emit(AdminTelemetryEvents.AdminExperimentAccess, {
      action: 'start',
      name: body.data.name,
      promptId: body.data.promptId,
    });

    return reply.status(201).send({
      name: body.data.name,
      status: 'active',
      braintrust_tracking: manager.isAvailable(),
    });
  });

  /**
   * DELETE /admin/experiments/:name - End experiment
   */
  app.delete('/admin/experiments/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    const params = ExperimentNameParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const manager = getBraintrustManager();
    const stats = manager.getExperimentStats(params.data.name);
    manager.endExperiment(params.data.name);
    const actor = getActorFromRequest(request);

    // Audit log
    const auditLogger = getAuditLogger();
    await logExperimentEnded(auditLogger, params.data.name, actor, stats ?? undefined);

    emit(AdminTelemetryEvents.AdminExperimentAccess, {
      action: 'end',
      name: params.data.name,
    });

    return reply.status(204).send();
  });

  /**
   * GET /admin/experiments/:name/stats - Get experiment stats
   * Permission: read
   */
  app.get('/admin/experiments/:name/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const params = ExperimentNameParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const manager = getBraintrustManager();
    const stats = manager.getExperimentStats(params.data.name);

    if (!stats) {
      return reply.status(404).send({
        error: 'not_found',
        message: `Experiment '${params.data.name}' not found`,
      });
    }

    emit(AdminTelemetryEvents.AdminExperimentAccess, {
      action: 'stats',
      name: params.data.name,
    });

    return reply.status(200).send(stats);
  });
}
