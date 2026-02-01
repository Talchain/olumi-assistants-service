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
 * - POST   /admin/prompts/:id/test     - Test prompt in sandbox
 * - POST   /admin/prompts/:id/approve  - Approve version for production
 * - GET    /admin/prompts/:id/diff     - Compare versions
 *
 * Observation routes (Supabase store only):
 * - GET    /admin/prompts/:id/observations                  - List observations for prompt
 * - GET    /admin/prompts/:id/versions/:version/observations - List observations for version
 * - POST   /admin/prompts/:id/observations                  - Add observation
 * - DELETE /admin/prompts/:id/observations/:obsId           - Remove observation
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
  ApprovalRequestSchema,
  PromptTestCaseSchema,
  getAuditLogger,
  logPromptCreated,
  logPromptUpdated,
  logVersionCreated,
  logVersionRollback,
  logVersionApproved,
  logStatusChanged,
  logExperimentStarted,
  logExperimentEnded,
  interpolatePrompt,
} from '../prompts/index.js';
import type { ObservationType } from '../prompts/stores/supabase.js';
import { SupabasePromptStore } from '../prompts/stores/supabase.js';
import { getBraintrustManager } from '../prompts/braintrust.js';
import { invalidatePromptCache } from '../adapters/llm/prompt-loader.js';
import { log, emit, TelemetryEvents, hashIP } from '../utils/telemetry.js';
import { config } from '../config/index.js';
import { MODEL_REGISTRY } from '../config/models.js';
import {
  verifyAdminKey,
  getActorFromRequest,
  AdminAuthTelemetryEvents,
} from '../middleware/admin-auth.js';

/**
 * Telemetry events (route-specific, extends shared AdminAuthTelemetryEvents)
 */
const AdminTelemetryEvents = {
  ...AdminAuthTelemetryEvents,
  AdminPromptAccess: 'admin.prompt.access',
  AdminExperimentAccess: 'admin.experiment.access',
} as const;

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

/**
 * Test sandbox request schema
 *
 * Accepts both structured input (brief, maxNodes, maxEdges) and a generic
 * variables object for maximum flexibility in testing different prompts.
 */
const TestPromptRequestSchema = z.object({
  version: z.number().int().positive().optional(),
  input: z.object({
    /** Test brief content (tracked for testing purposes, not interpolated unless prompt uses it) */
    brief: z.string().min(1).max(10000).optional(),
    /** Known variables for convenience */
    maxNodes: z.number().int().positive().optional(),
    maxEdges: z.number().int().positive().optional(),
  }).optional(),
  /** Generic variables object - merged with input fields, takes precedence */
  variables: z.record(z.union([z.string(), z.number()])).optional(),
  dry_run: z.boolean().optional().default(true),
});

/**
 * Test cases update schema
 * Allows updating test cases for a specific version
 */
const UpdateTestCasesSchema = z.object({
  /** Version to update test cases for */
  version: z.number().int().positive(),
  /** The test cases array (replaces existing) */
  testCases: z.array(PromptTestCaseSchema),
});

/**
 * Observation request schema
 */
const CreateObservationSchema = z.object({
  /** Version this observation applies to */
  version: z.number().int().positive(),
  /** Type of observation */
  observationType: z.enum(['note', 'rating', 'failure', 'success']),
  /** Content/description (required for note, failure, success) */
  content: z.string().max(10000).optional(),
  /** Rating 1-5 (optional, used with rating type) */
  rating: z.number().int().min(1).max(5).optional(),
  /** Hash of the payload that triggered this observation */
  payloadHash: z.string().max(128).optional(),
  /** Who created this observation */
  createdBy: z.string().max(255).optional(),
});

/**
 * Observation ID params schema
 */
const ObservationIdParamsSchema = z.object({
  id: z.string().min(1),
  obsId: z.string().uuid(),
});

/**
 * Version params schema for observations
 */
const VersionParamsSchema = z.object({
  id: z.string().min(1),
  version: z.coerce.number().int().positive(),
});


// =========================================================================
// Validation Helpers
// =========================================================================

/**
 * Validate modelConfig against MODEL_REGISTRY
 * Returns validation errors if any model IDs are invalid
 */
function validateModelConfig(
  modelConfig: { staging?: string; production?: string } | null | undefined
): string[] {
  const errors: string[] = [];
  if (!modelConfig) return errors;

  if (modelConfig.staging) {
    if (!MODEL_REGISTRY[modelConfig.staging]) {
      errors.push(`Invalid staging model: '${modelConfig.staging}'. Available models: ${Object.keys(MODEL_REGISTRY).join(', ')}`);
    } else if (!MODEL_REGISTRY[modelConfig.staging].enabled) {
      errors.push(`Staging model '${modelConfig.staging}' is disabled`);
    }
  }

  if (modelConfig.production) {
    if (!MODEL_REGISTRY[modelConfig.production]) {
      errors.push(`Invalid production model: '${modelConfig.production}'. Available models: ${Object.keys(MODEL_REGISTRY).join(', ')}`);
    } else if (!MODEL_REGISTRY[modelConfig.production].enabled) {
      errors.push(`Production model '${modelConfig.production}' is disabled`);
    }
  }

  return errors;
}

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

    if (!ensureStoreHealthy(reply)) return;

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

    // Validate modelConfig against MODEL_REGISTRY
    const modelConfigErrors = validateModelConfig(body.data.modelConfig);
    if (modelConfigErrors.length > 0) {
      return reply.status(400).send({
        error: 'validation_error',
        message: modelConfigErrors.join('; '),
        field: 'modelConfig',
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
        ip_hash: hashIP(request.ip),
      });

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'create',
        promptId: prompt.id,
      });

      // Invalidate cache for the task to ensure fresh prompt is loaded
      invalidatePromptCache(prompt.taskId, 'prompt_created');

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

    if (!ensureStoreHealthy(reply)) return;

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

    // Validate modelConfig against MODEL_REGISTRY (if provided)
    if (body.data.modelConfig !== undefined) {
      const modelConfigErrors = validateModelConfig(body.data.modelConfig);
      if (modelConfigErrors.length > 0) {
        return reply.status(400).send({
          error: 'validation_error',
          message: modelConfigErrors.join('; '),
          field: 'modelConfig',
        });
      }
    }

    try {
      const store = getPromptStore();
      const beforePrompt = await store.get(params.data.id);

      if (!beforePrompt) {
        return reply.status(404).send({
          error: 'not_found',
          message: `Prompt '${params.data.id}' not found`,
        });
      }

      // Check for approval requirement when promoting to production
      const isPromotion = body.data.status === 'production' && beforePrompt.status !== 'production';
      if (isPromotion) {
        // Determine which version will be active after the update:
        // - If body.data.activeVersion is provided, that's being promoted
        // - Otherwise, the current activeVersion is being promoted
        const versionBeingPromoted = body.data.activeVersion ?? beforePrompt.activeVersion;
        const versionData = beforePrompt.versions.find(v => v.version === versionBeingPromoted);

        if (versionData?.requiresApproval && !versionData.approvedBy) {
          // Emit approval required telemetry
          emit(TelemetryEvents.PromptApprovalRequired, {
            promptId: params.data.id,
            version: versionBeingPromoted,
            taskId: beforePrompt.taskId,
          });

          return reply.status(403).send({
            error: 'approval_required',
            message: `Version ${versionBeingPromoted} requires approval before promotion to production. Use POST /admin/prompts/${params.data.id}/approve to approve first.`,
            promptId: params.data.id,
            version: versionBeingPromoted,
          });
        }
      }

      const prompt = await store.update(params.data.id, body.data);
      const actor = getActorFromRequest(request);

      // Audit log
      const auditLogger = getAuditLogger();
      await logPromptUpdated(
        auditLogger,
        params.data.id,
        actor,
        { status: beforePrompt.status, activeVersion: beforePrompt.activeVersion },
        { status: prompt.status, activeVersion: prompt.activeVersion }
      );

      // Additional audit for status changes
      if (body.data.status && beforePrompt.status !== body.data.status) {
        await logStatusChanged(auditLogger, params.data.id, beforePrompt.status, body.data.status, actor);

        // Emit structured telemetry for status changes (promotion/demotion)
        const isDemotion = beforePrompt.status === 'production' && body.data.status !== 'production';

        if (isPromotion) {
          emit(TelemetryEvents.PromptVersionPromoted, {
            promptId: params.data.id,
            taskId: prompt.taskId,
            version: prompt.activeVersion,
            fromStatus: beforePrompt.status,
            toStatus: body.data.status,
            actor,
          });
        } else if (isDemotion) {
          emit(TelemetryEvents.PromptVersionDemoted, {
            promptId: params.data.id,
            taskId: prompt.taskId,
            version: prompt.activeVersion,
            fromStatus: beforePrompt.status,
            toStatus: body.data.status,
            actor,
          });
        }
      }

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'update',
        promptId: params.data.id,
      });

      // Invalidate cache for the task to ensure fresh prompt is loaded
      invalidatePromptCache(prompt.taskId, 'prompt_updated');

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

      // Get taskId before deletion for cache invalidation
      const prompt = await store.get(params.data.id);
      const taskId = prompt?.taskId;

      await store.delete(params.data.id, hardDelete);

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: hardDelete ? 'hard_delete' : 'archive',
        promptId: params.data.id,
      });

      // Invalidate cache for the task
      if (taskId) {
        invalidatePromptCache(taskId, hardDelete ? 'prompt_deleted' : 'prompt_archived');
      }

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

      // Invalidate cache for the task to ensure fresh prompt is loaded
      invalidatePromptCache(prompt.taskId, 'version_created');

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

      // Emit structured rollback telemetry
      emit(TelemetryEvents.PromptRollbackExecuted, {
        promptId: params.data.id,
        taskId: prompt.taskId,
        fromVersion,
        toVersion: body.data.targetVersion,
        reason: body.data.reason,
        actor,
      });

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'rollback',
        promptId: params.data.id,
        targetVersion: body.data.targetVersion,
        reason: body.data.reason,
      });

      // Invalidate cache for the task to ensure fresh prompt is loaded
      invalidatePromptCache(prompt.taskId, 'version_rollback');

      return reply.status(200).send(prompt);
    } catch (error) {
      // Emit rollback failure telemetry
      emit(TelemetryEvents.PromptRollbackFailed, {
        promptId: params.data.id,
        targetVersion: body.data.targetVersion,
        error: error instanceof Error ? error.message : String(error),
      });
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
   * POST /admin/prompts/:id/test - Test prompt in sandbox
   *
   * Validates prompt interpolation for a specific version without affecting production.
   * This endpoint performs interpolation-only validation (does not execute CEE pipeline).
   * Rate limited to 10 requests per minute per admin key.
   *
   * Request:
   * - version: (optional) Specific version to test, defaults to active version
   * - input: { brief?: string, maxNodes?: number, maxEdges?: number }
   * - variables: (optional) Generic variables object, merged with input fields
   * - dry_run: (optional) Reserved for future use; currently all tests are interpolation-only
   *
   * Response:
   * - prompt_id: The prompt ID
   * - version: The version tested
   * - task_id: The CEE task ID
   * - compiled_content: The interpolated prompt content
   * - variables: Analysis of provided/defined/missing/defaults_used variables
   * - char_count: Total character count after interpolation
   * - validation: { valid: boolean, issues?: string[] }
   */
  app.post('/admin/prompts/:id/test', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          const adminKey = request.headers['x-admin-key'] as string ?? '';
          return `test:${adminKey.slice(0, 8)}:${request.ip}`;
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    const body = TestPromptRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    const start = Date.now();

    try {
      const store = getPromptStore();
      const prompt = await store.get(params.data.id);

      if (!prompt) {
        return reply.status(404).send({
          error: 'not_found',
          message: `Prompt '${params.data.id}' not found`,
        });
      }

      // Find the requested version or use active version
      const targetVersion = body.data.version ?? prompt.activeVersion;
      const versionData = prompt.versions.find(v => v.version === targetVersion);

      if (!versionData) {
        return reply.status(404).send({
          error: 'version_not_found',
          message: `Version ${targetVersion} not found for prompt '${params.data.id}'`,
        });
      }

      // Build variables from input and explicit variables object
      // Priority: body.data.variables > body.data.input fields
      const variables: Record<string, string | number> = {};

      // Add known input fields first (if input is provided)
      if (body.data.input) {
        if (body.data.input.maxNodes !== undefined) {
          variables.maxNodes = body.data.input.maxNodes;
        }
        if (body.data.input.maxEdges !== undefined) {
          variables.maxEdges = body.data.input.maxEdges;
        }
        if (body.data.input.brief !== undefined) {
          variables.brief = body.data.input.brief;
        }
      }

      // Merge with explicit variables (takes precedence)
      if (body.data.variables) {
        Object.assign(variables, body.data.variables);
      }

      // Analyze variable requirements from version metadata
      const versionVariables = versionData.variables ?? [];
      const variableAnalysis = {
        defined: versionVariables.map(v => ({
          name: v.name,
          required: v.required ?? true,
          hasDefault: v.defaultValue !== undefined,
          defaultValue: v.defaultValue,
        })),
        provided: Object.keys(variables),
        missing: [] as string[],
        defaultsUsed: [] as string[],
      };

      // Check which variables are missing vs using defaults
      for (const varDef of versionVariables) {
        if (variables[varDef.name] === undefined) {
          if (varDef.defaultValue !== undefined) {
            variableAnalysis.defaultsUsed.push(varDef.name);
          } else if (varDef.required !== false) {
            variableAnalysis.missing.push(varDef.name);
          }
        }
      }

      // Interpolate the prompt - ALIGNED WITH RUNTIME: pass version.variables for defaults
      let compiledContent: string;
      const validationIssues: string[] = [];

      try {
        // This matches runtime behavior in FilePromptStore.getCompiled
        compiledContent = interpolatePrompt(versionData.content, variables, versionData.variables);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        validationIssues.push(`Interpolation error: ${errorMessage}`);
        compiledContent = versionData.content; // Return raw content if interpolation fails
      }

      // Check for any unresolved variables ({{variable}})
      const unresolvedVariables = compiledContent.match(/\{\{[^}]+\}\}/g);
      if (unresolvedVariables && unresolvedVariables.length > 0) {
        validationIssues.push(`Unresolved variables: ${unresolvedVariables.join(', ')}`);
      }

      // Check for common prompt issues
      if (compiledContent.length < 100) {
        validationIssues.push('Warning: Prompt content is very short (< 100 chars)');
      }
      if (compiledContent.length > 50000) {
        validationIssues.push('Warning: Prompt content is very long (> 50k chars)');
      }

      const latencyMs = Date.now() - start;
      const isValid = validationIssues.length === 0;

      // Emit structured telemetry events
      emit(TelemetryEvents.PromptTestExecuted, {
        promptId: params.data.id,
        version: targetVersion,
        taskId: prompt.taskId,
        dry_run: body.data.dry_run,
        latency_ms: latencyMs,
        char_count: compiledContent.length,
        variables_count: Object.keys(variables).length,
      });

      if (isValid) {
        emit(TelemetryEvents.PromptTestValidationPassed, {
          promptId: params.data.id,
          version: targetVersion,
        });
      } else {
        emit(TelemetryEvents.PromptTestValidationFailed, {
          promptId: params.data.id,
          version: targetVersion,
          issues: validationIssues,
        });
      }

      // Also emit admin access event for audit trail
      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'test',
        promptId: params.data.id,
        version: targetVersion,
        dry_run: body.data.dry_run,
        latency_ms: latencyMs,
        valid: isValid,
      });

      log.info({
        promptId: params.data.id,
        version: targetVersion,
        taskId: prompt.taskId,
        dry_run: body.data.dry_run,
        latency_ms: latencyMs,
        valid: isValid,
      }, 'Prompt test executed');

      return reply.status(200).send({
        prompt_id: params.data.id,
        version: targetVersion,
        task_id: prompt.taskId,
        status: prompt.status,
        compiled_content: compiledContent,
        char_count: compiledContent.length,
        line_count: compiledContent.split('\n').length,
        // Detailed variable analysis for debugging
        variables: {
          provided: variableAnalysis.provided,
          defined_in_version: variableAnalysis.defined,
          missing_required: variableAnalysis.missing,
          defaults_used: variableAnalysis.defaultsUsed,
        },
        validation: {
          valid: validationIssues.length === 0,
          issues: validationIssues.length > 0 ? validationIssues : undefined,
        },
        test_input: body.data.input,
        dry_run: body.data.dry_run,
        latency_ms: latencyMs,
      });
    } catch (error) {
      log.error({ error, promptId: params.data.id }, 'Prompt test failed');
      return reply.status(500).send({
        error: 'test_failed',
        message: error instanceof Error ? error.message : 'Unknown error during test',
      });
    }
  });

  /**
   * POST /admin/prompts/:id/approve - Approve a version for production promotion
   *
   * Approves a specific version that has `requiresApproval: true`.
   * Once approved, the version can be promoted to production via PATCH.
   *
   * Request:
   * - version: The version number to approve
   * - approvedBy: Who is approving
   * - notes: Optional notes/reason for approval
   */
  app.post('/admin/prompts/:id/approve', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          const adminKey = request.headers['x-admin-key'] as string ?? '';
          return `approve:${adminKey.slice(0, 8)}:${request.ip}`;
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    const body = ApprovalRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    try {
      const store = getPromptStore();

      // Use explicit store method for approval - handles validation and persistence
      const prompt = await store.approveVersion(params.data.id, body.data);

      const actor = getActorFromRequest(request);
      const approvedVersion = prompt.versions.find(v => v.version === body.data.version);
      const approvedAt = approvedVersion?.approvedAt ?? new Date().toISOString();

      // Audit log
      const auditLogger = getAuditLogger();
      await logVersionApproved(
        auditLogger,
        params.data.id,
        body.data.version,
        body.data.approvedBy,
        body.data.notes
      );

      // Emit telemetry
      emit(TelemetryEvents.PromptApprovalGranted, {
        promptId: params.data.id,
        version: body.data.version,
        taskId: prompt.taskId,
        approvedBy: body.data.approvedBy,
        actor,
      });

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'approve',
        promptId: params.data.id,
        version: body.data.version,
      });

      log.info({
        promptId: params.data.id,
        version: body.data.version,
        approvedBy: body.data.approvedBy,
      }, 'Prompt version approved');

      return reply.status(200).send({
        promptId: params.data.id,
        version: body.data.version,
        approvedBy: body.data.approvedBy,
        approvedAt,
        message: 'Version approved successfully. You can now promote to production.',
      });
    } catch (error) {
      log.error({ error, promptId: params.data.id }, 'Prompt approval failed');

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Map store errors to appropriate HTTP responses
      if (errorMessage.includes('not found')) {
        return reply.status(404).send({
          error: 'not_found',
          message: errorMessage,
        });
      }
      if (errorMessage.includes('does not require approval')) {
        return reply.status(400).send({
          error: 'approval_not_required',
          message: errorMessage,
        });
      }
      if (errorMessage.includes('already approved')) {
        return reply.status(400).send({
          error: 'already_approved',
          message: errorMessage,
        });
      }

      emit(TelemetryEvents.PromptApprovalRejected, {
        promptId: params.data.id,
        version: body.data.version,
        error: errorMessage,
      });

      return reply.status(500).send({
        error: 'approval_failed',
        message: errorMessage,
      });
    }
  });

  /**
   * PATCH /admin/prompts/:id/test-cases - Update test cases for a version
   *
   * Updates the test cases array for a specific prompt version.
   * Test cases are used for golden testing during prompt validation.
   */
  app.patch('/admin/prompts/:id/test-cases', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          const adminKey = request.headers['x-admin-key'] as string ?? '';
          return `testcases:${adminKey.slice(0, 8)}:${request.ip}`;
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    const body = UpdateTestCasesSchema.safeParse(request.body);
    if (!body.success) {
      // Extract human-readable error messages from Zod
      const flattened = body.error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors)
        .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
        .join('; ');
      const formErrors = flattened.formErrors.join('; ');
      const errorMessage = fieldErrors || formErrors || 'Invalid request body';

      return reply.status(400).send({
        error: 'validation_error',
        message: errorMessage,
        details: flattened,
      });
    }

    try {
      const store = getPromptStore();
      const prompt = await store.updateTestCases(
        params.data.id,
        body.data.version,
        body.data.testCases
      );

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'update_test_cases',
        promptId: params.data.id,
        version: body.data.version,
        testCaseCount: body.data.testCases.length,
      });

      log.info({
        promptId: params.data.id,
        version: body.data.version,
        testCaseCount: body.data.testCases.length,
      }, 'Test cases updated');

      return reply.status(200).send({
        prompt,
        message: `Updated ${body.data.testCases.length} test cases for version ${body.data.version}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('not found')) {
        return reply.status(404).send({
          error: 'not_found',
          message: errorMessage,
        });
      }

      log.error({ error, promptId: params.data.id }, 'Failed to update test cases');
      return reply.status(500).send({
        error: 'update_failed',
        message: errorMessage,
      });
    }
  });

  /**
   * GET /admin/prompts/:id/diff - Compare versions
   * Permission: read
   */
  app.get('/admin/prompts/:id/diff', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => {
          const adminKey = request.headers['x-admin-key'] as string ?? '';
          return `diff:${adminKey.slice(0, 8)}:${request.ip}`;
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

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

  // =========================================================================
  // Observation Routes
  // =========================================================================

  /**
   * Helper to get Supabase store with observation methods
   * Returns null if store is not Supabase
   */
  function getSupabaseStore(): SupabasePromptStore | null {
    const store = getPromptStore();
    if (store instanceof SupabasePromptStore) {
      return store;
    }
    return null;
  }

  /**
   * GET /admin/prompts/:id/observations - List observations for prompt
   * Permission: read
   *
   * Returns all observations for a prompt with average rating.
   */
  app.get('/admin/prompts/:id/observations', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const supabaseStore = getSupabaseStore();
    if (!supabaseStore) {
      return reply.status(501).send({
        error: 'not_implemented',
        message: 'Observations are only available with Supabase store',
      });
    }

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    try {
      const result = await supabaseStore.getObservations(params.data.id);

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'list_observations',
        promptId: params.data.id,
        count: result.totalCount,
      });

      return reply.status(200).send(result);
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
   * GET /admin/prompts/:id/versions/:version/observations - List observations for specific version
   * Permission: read
   *
   * Returns observations for a specific prompt version with average rating.
   */
  app.get('/admin/prompts/:id/versions/:version/observations', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const supabaseStore = getSupabaseStore();
    if (!supabaseStore) {
      return reply.status(501).send({
        error: 'not_implemented',
        message: 'Observations are only available with Supabase store',
      });
    }

    const params = VersionParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    try {
      const result = await supabaseStore.getObservations(params.data.id, params.data.version);

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'list_version_observations',
        promptId: params.data.id,
        version: params.data.version,
        count: result.totalCount,
      });

      return reply.status(200).send(result);
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
   * POST /admin/prompts/:id/observations - Add observation
   * Permission: write
   *
   * Creates a new observation for a prompt version.
   * Validates that content is provided for note/failure/success types.
   */
  app.post('/admin/prompts/:id/observations', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const supabaseStore = getSupabaseStore();
    if (!supabaseStore) {
      return reply.status(501).send({
        error: 'not_implemented',
        message: 'Observations are only available with Supabase store',
      });
    }

    const params = PromptIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const body = CreateObservationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: body.error.flatten(),
      });
    }

    try {
      const observation = await supabaseStore.addObservation({
        promptId: params.data.id,
        version: body.data.version,
        observationType: body.data.observationType as ObservationType,
        content: body.data.content,
        rating: body.data.rating,
        payloadHash: body.data.payloadHash,
        createdBy: body.data.createdBy ?? getActorFromRequest(request),
      });

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'create_observation',
        promptId: params.data.id,
        version: body.data.version,
        type: body.data.observationType,
      });

      return reply.status(201).send(observation);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            error: 'not_found',
            message: error.message,
          });
        }
        if (error.message.includes('Invalid') || error.message.includes('required') || error.message.includes('must be')) {
          return reply.status(400).send({
            error: 'validation_error',
            message: error.message,
          });
        }
      }
      throw error;
    }
  });

  /**
   * DELETE /admin/prompts/:id/observations/:obsId - Remove observation
   * Permission: write
   *
   * Deletes a specific observation by ID.
   */
  app.delete('/admin/prompts/:id/observations/:obsId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply)) return;

    if (!isPromptManagementEnabled()) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Prompt management is not enabled',
      });
    }

    if (!ensureStoreHealthy(reply)) return;

    const supabaseStore = getSupabaseStore();
    if (!supabaseStore) {
      return reply.status(501).send({
        error: 'not_implemented',
        message: 'Observations are only available with Supabase store',
      });
    }

    const params = ObservationIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    try {
      await supabaseStore.deleteObservation(params.data.obsId);

      emit(AdminTelemetryEvents.AdminPromptAccess, {
        action: 'delete_observation',
        promptId: params.data.id,
        observationId: params.data.obsId,
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
}
