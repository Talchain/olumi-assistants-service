/**
 * PostgreSQL Prompt Store
 *
 * Database-backed storage for prompt definitions with versioning.
 * Uses postgres.js for type-safe queries and connection pooling.
 */

import postgres from 'postgres';
import type {
  IPromptStore,
  PromptListFilter,
  GetCompiledOptions,
  ActivePromptResult,
  PostgresStoreConfig,
} from './interface.js';
import type {
  PromptDefinition,
  PromptVersion,
  CreatePromptRequest,
  CreateVersionRequest,
  UpdatePromptRequest,
  RollbackRequest,
  ApprovalRequest,
  CompiledPrompt,
  PromptTestCase,
} from '../schema.js';
import { computeContentHash, interpolatePrompt } from '../schema.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';

/**
 * Database row types for type-safe queries
 */
interface PromptRow {
  id: string;
  name: string;
  description: string | null;
  task_id: string;
  status: string;
  active_version: number;
  staging_version: number | null;
  design_version: string | null;
  model_config: { staging?: string; production?: string } | null;
  tags: string[];
  created_at: Date | string;
  updated_at: Date | string;
}

interface VersionRow {
  version: number;
  content: string;
  variables: string | object[];
  created_by: string | null;
  created_at: Date | string;
  change_note: string | null;
  content_hash: string;
  requires_approval: boolean | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  test_cases: string | object[] | null;
}

/**
 * PostgreSQL prompt store with connection pooling
 */
export class PostgresPromptStore implements IPromptStore {
  private sql: postgres.Sql | null = null;
  private config: PostgresStoreConfig;

  constructor(config: Omit<PostgresStoreConfig, 'type'>) {
    this.config = { ...config, type: 'postgres' };
  }

  /**
   * Initialize the store and verify connection
   */
  async initialize(): Promise<void> {
    try {
      this.sql = postgres(this.config.connectionString, {
        max: this.config.poolSize ?? 10,
        ssl: this.config.ssl ? 'require' : false,
        idle_timeout: 20,
        max_lifetime: 60 * 30, // 30 minutes
        connect_timeout: 10,
        onnotice: () => {}, // Suppress NOTICE messages
      });

      // Verify connection
      await this.sql`SELECT 1`;

      log.info(
        { poolSize: this.config.poolSize ?? 10 },
        'PostgreSQL prompt store initialized'
      );
    } catch (error) {
      log.error({ error }, 'Failed to initialize PostgreSQL prompt store');
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'initialize',
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Ensure connection is established
   */
  private ensureInitialized(): postgres.Sql {
    if (!this.sql) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return this.sql;
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
  }

  // =========================================================================
  // IPromptStore Implementation
  // =========================================================================

  async create(request: CreatePromptRequest): Promise<PromptDefinition> {
    const sql = this.ensureInitialized();
    const contentHash = computeContentHash(request.content);
    const now = new Date().toISOString();

    try {
      // Check for existing prompt
      const existing = await sql`
        SELECT id FROM prompts WHERE id = ${request.id}
      `;
      if (existing.length > 0) {
        throw new Error(`Prompt with ID '${request.id}' already exists`);
      }

      // Insert prompt and first version in transaction
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO prompts (id, name, description, task_id, status, active_version, design_version, model_config, tags, created_at, updated_at)
          VALUES (
            ${request.id},
            ${request.name},
            ${request.description ?? null},
            ${request.taskId},
            'draft',
            1,
            ${request.designVersion ?? null},
            ${request.modelConfig ? JSON.stringify(request.modelConfig) : null},
            ${request.tags ?? []},
            ${now},
            ${now}
          )
        `;

        await tx`
          INSERT INTO prompt_versions (prompt_id, version, content, variables, created_by, created_at, change_note, content_hash, requires_approval, test_cases)
          VALUES (
            ${request.id},
            1,
            ${request.content},
            ${JSON.stringify(request.variables ?? [])},
            ${request.createdBy ?? null},
            ${now},
            ${request.changeNote ?? null},
            ${contentHash},
            ${(request as any).requiresApproval ?? false},
            ${JSON.stringify([])}
          )
        `;
      });

      log.info({ promptId: request.id, taskId: request.taskId }, 'Prompt created');

      return this.get(request.id) as Promise<PromptDefinition>;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'create',
        error: String(error),
      });
      throw error;
    }
  }

  async get(id: string): Promise<PromptDefinition | null> {
    const sql = this.ensureInitialized();

    try {
      const prompts = await sql<PromptRow[]>`
        SELECT id, name, description, task_id, status, active_version, staging_version, design_version, model_config, tags, created_at, updated_at
        FROM prompts
        WHERE id = ${id}
      `;

      if (prompts.length === 0) {
        return null;
      }

      const prompt = prompts[0];
      const versions = await sql<VersionRow[]>`
        SELECT version, content, variables, created_by, created_at, change_note, content_hash,
               requires_approval, approved_by, approved_at, test_cases
        FROM prompt_versions
        WHERE prompt_id = ${id}
        ORDER BY version ASC
      `;

      return this.toPromptDefinition(prompt, versions);
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'get',
        error: String(error),
      });
      throw error;
    }
  }

  async list(filter?: PromptListFilter): Promise<PromptDefinition[]> {
    const sql = this.ensureInitialized();

    try {
      // Build query with filters
      let prompts: PromptRow[];
      if (filter?.taskId && filter?.status) {
        prompts = await sql<PromptRow[]>`
          SELECT id, name, description, task_id, status, active_version, staging_version, design_version, model_config, tags, created_at, updated_at
          FROM prompts
          WHERE task_id = ${filter.taskId} AND status = ${filter.status}
          ORDER BY id
        `;
      } else if (filter?.taskId) {
        prompts = await sql<PromptRow[]>`
          SELECT id, name, description, task_id, status, active_version, staging_version, design_version, model_config, tags, created_at, updated_at
          FROM prompts
          WHERE task_id = ${filter.taskId}
          ORDER BY id
        `;
      } else if (filter?.status) {
        prompts = await sql<PromptRow[]>`
          SELECT id, name, description, task_id, status, active_version, staging_version, design_version, model_config, tags, created_at, updated_at
          FROM prompts
          WHERE status = ${filter.status}
          ORDER BY id
        `;
      } else {
        prompts = await sql<PromptRow[]>`
          SELECT id, name, description, task_id, status, active_version, staging_version, design_version, model_config, tags, created_at, updated_at
          FROM prompts
          ORDER BY id
        `;
      }

      // Filter by tags if provided (client-side for now)
      if (filter?.tags?.length) {
        prompts = prompts.filter((p) =>
          filter.tags!.some((tag) => p.tags?.includes(tag))
        );
      }

      // No prompts = early return
      if (prompts.length === 0) {
        return [];
      }

      // Fetch all versions for all prompts in a single query (N+1 → 2 queries)
      const promptIds = prompts.map((p) => p.id);
      const allVersions = await sql<(VersionRow & { prompt_id: string })[]>`
        SELECT prompt_id, version, content, variables, created_by, created_at, change_note, content_hash,
               requires_approval, approved_by, approved_at, test_cases
        FROM prompt_versions
        WHERE prompt_id = ANY(${promptIds})
        ORDER BY prompt_id, version ASC
      `;

      // Group versions by prompt_id
      const versionsByPromptId = new Map<string, VersionRow[]>();
      for (const v of allVersions) {
        const existing = versionsByPromptId.get(v.prompt_id) ?? [];
        existing.push(v);
        versionsByPromptId.set(v.prompt_id, existing);
      }

      // Build results
      const results: PromptDefinition[] = prompts.map((prompt) => {
        const versions = versionsByPromptId.get(prompt.id) ?? [];
        return this.toPromptDefinition(prompt, versions);
      });

      return results;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'list',
        error: String(error),
      });
      throw error;
    }
  }

  async update(id: string, request: UpdatePromptRequest): Promise<PromptDefinition> {
    const sql = this.ensureInitialized();

    try {
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Prompt '${id}' not found`);
      }

      // Validate version numbers
      if (request.activeVersion !== undefined) {
        const versionExists = existing.versions.some((v) => v.version === request.activeVersion);
        if (!versionExists) {
          throw new Error(`Version ${request.activeVersion} does not exist`);
        }
      }

      if (request.stagingVersion !== undefined && request.stagingVersion !== null) {
        const versionExists = existing.versions.some((v) => v.version === request.stagingVersion);
        if (!versionExists) {
          throw new Error(`Version ${request.stagingVersion} does not exist`);
        }
      }

      // Enforce single production prompt per task
      const newStatus = request.status ?? existing.status;
      if (newStatus === 'production') {
        const existingProduction = await sql`
          SELECT id FROM prompts
          WHERE task_id = ${existing.taskId}
            AND status = 'production'
            AND id != ${id}
        `;
        if (existingProduction.length > 0) {
          throw new Error(
            `Cannot set prompt '${id}' to production: task '${existing.taskId}' already has a production prompt ('${existingProduction[0].id}'). ` +
            `Archive or demote the existing production prompt first.`
          );
        }
      }

      // Build update
      // Note: modelConfig can be explicitly set to null/undefined to clear it
      const newModelConfig = request.modelConfig !== undefined
        ? (request.modelConfig ? JSON.stringify(request.modelConfig) : null)
        : (existing.modelConfig ? JSON.stringify(existing.modelConfig) : null);

      await sql`
        UPDATE prompts SET
          name = ${request.name ?? existing.name},
          description = ${request.description ?? existing.description ?? null},
          status = ${request.status ?? existing.status},
          active_version = ${request.activeVersion ?? existing.activeVersion},
          staging_version = ${request.stagingVersion === null ? null : (request.stagingVersion ?? existing.stagingVersion ?? null)},
          design_version = ${request.designVersion ?? existing.designVersion ?? null},
          model_config = ${newModelConfig},
          tags = ${request.tags ?? existing.tags}
        WHERE id = ${id}
      `;

      log.info({ promptId: id }, 'Prompt updated');

      return this.get(id) as Promise<PromptDefinition>;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'update',
        error: String(error),
      });
      throw error;
    }
  }

  async createVersion(id: string, request: CreateVersionRequest): Promise<PromptDefinition> {
    const sql = this.ensureInitialized();

    try {
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Prompt '${id}' not found`);
      }

      const maxVersion = Math.max(...existing.versions.map((v) => v.version));
      const newVersion = maxVersion + 1;
      const contentHash = computeContentHash(request.content);
      const now = new Date().toISOString();

      await sql`
        INSERT INTO prompt_versions (prompt_id, version, content, variables, created_by, created_at, change_note, content_hash, requires_approval, test_cases)
        VALUES (
          ${id},
          ${newVersion},
          ${request.content},
          ${JSON.stringify(request.variables ?? [])},
          ${request.createdBy ?? null},
          ${now},
          ${request.changeNote ?? null},
          ${contentHash},
          ${request.requiresApproval ?? false},
          ${JSON.stringify([])}
        )
      `;

      log.info({ promptId: id, version: newVersion }, 'Prompt version created');

      return this.get(id) as Promise<PromptDefinition>;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'createVersion',
        error: String(error),
      });
      throw error;
    }
  }

  async rollback(id: string, request: RollbackRequest): Promise<PromptDefinition> {
    const sql = this.ensureInitialized();

    try {
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Prompt '${id}' not found`);
      }

      const targetVersion = existing.versions.find((v) => v.version === request.targetVersion);
      if (!targetVersion) {
        throw new Error(`Version ${request.targetVersion} not found`);
      }

      const previousActive = existing.activeVersion;

      await sql`
        UPDATE prompts SET active_version = ${request.targetVersion}
        WHERE id = ${id}
      `;

      log.info(
        {
          promptId: id,
          fromVersion: previousActive,
          toVersion: request.targetVersion,
          reason: request.reason,
        },
        'Prompt rolled back'
      );

      return this.get(id) as Promise<PromptDefinition>;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'rollback',
        error: String(error),
      });
      throw error;
    }
  }

  async approveVersion(id: string, request: ApprovalRequest): Promise<PromptDefinition> {
    const sql = this.ensureInitialized();

    try {
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Prompt '${id}' not found`);
      }

      const version = existing.versions.find((v) => v.version === request.version);
      if (!version) {
        throw new Error(`Version ${request.version} not found for prompt '${id}'`);
      }

      if (!version.requiresApproval) {
        throw new Error(`Version ${request.version} does not require approval`);
      }

      if (version.approvedBy) {
        throw new Error(`Version ${request.version} was already approved by ${version.approvedBy}`);
      }

      const now = new Date().toISOString();

      // Update version in database with approval info
      await sql`
        UPDATE prompt_versions
        SET approved_by = ${request.approvedBy},
            approved_at = ${now}
        WHERE prompt_id = ${id} AND version = ${request.version}
      `;

      // Also update prompt's updated_at
      await sql`
        UPDATE prompts SET updated_at = NOW()
        WHERE id = ${id}
      `;

      log.info(
        {
          promptId: id,
          version: request.version,
          approvedBy: request.approvedBy,
        },
        'Prompt version approved'
      );

      return this.get(id) as Promise<PromptDefinition>;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'approveVersion',
        error: String(error),
      });
      throw error;
    }
  }

  async updateTestCases(id: string, version: number, testCases: PromptTestCase[]): Promise<PromptDefinition> {
    const sql = this.ensureInitialized();

    try {
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Prompt '${id}' not found`);
      }

      const versionData = existing.versions.find((v) => v.version === version);
      if (!versionData) {
        throw new Error(`Version ${version} not found for prompt '${id}'`);
      }

      // Update version in database with new test cases
      await sql`
        UPDATE prompt_versions
        SET test_cases = ${JSON.stringify(testCases)}
        WHERE prompt_id = ${id} AND version = ${version}
      `;

      // Also update prompt's updated_at
      await sql`
        UPDATE prompts SET updated_at = NOW()
        WHERE id = ${id}
      `;

      log.info(
        {
          promptId: id,
          version,
          testCaseCount: testCases.length,
        },
        'Prompt version test cases updated'
      );

      return this.get(id) as Promise<PromptDefinition>;
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'updateTestCases',
        error: String(error),
      });
      throw error;
    }
  }

  async delete(id: string, hard = false): Promise<void> {
    const sql = this.ensureInitialized();

    try {
      const existing = await this.get(id);
      if (!existing) {
        throw new Error(`Prompt '${id}' not found`);
      }

      if (hard) {
        // CASCADE will delete versions too
        await sql`DELETE FROM prompts WHERE id = ${id}`;
      } else {
        // Soft delete - archive
        await sql`UPDATE prompts SET status = 'archived' WHERE id = ${id}`;
      }

      log.info({ promptId: id, hard }, 'Prompt deleted');
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'delete',
        error: String(error),
      });
      throw error;
    }
  }

  async getCompiled(
    taskId: string,
    variables: Record<string, string | number>,
    options?: GetCompiledOptions
  ): Promise<CompiledPrompt | null> {
    const sql = this.ensureInitialized();

    try {
      // Find prompt for this task (exclude archived, allow draft/staging/production)
      // Version selection is controlled by stagingVersion vs activeVersion, not prompt status
      const prompts = await sql`
        SELECT id, active_version, staging_version
        FROM prompts
        WHERE task_id = ${taskId} AND status != 'archived'
      `;

      if (prompts.length === 0) {
        return null;
      }

      const prompt = prompts[0];

      // Determine which version to use
      let versionNum: number;
      if (options?.version !== undefined) {
        versionNum = options.version;
      } else if (options?.useStaging && prompt.staging_version) {
        versionNum = prompt.staging_version;
      } else {
        versionNum = prompt.active_version;
      }

      // Get the version
      const versions = await sql`
        SELECT content, variables
        FROM prompt_versions
        WHERE prompt_id = ${prompt.id} AND version = ${versionNum}
      `;

      if (versions.length === 0) {
        throw new Error(`Version ${versionNum} not found for prompt '${prompt.id}'`);
      }

      const version = versions[0];
      const versionVariables = typeof version.variables === 'string'
        ? JSON.parse(version.variables)
        : version.variables;

      // Interpolate variables
      const content = interpolatePrompt(version.content, variables, versionVariables);

      emit(TelemetryEvents.PromptCompiled, {
        promptId: prompt.id,
        taskId,
        version: versionNum,
      });

      return {
        promptId: prompt.id,
        version: versionNum,
        content,
        compiledAt: new Date().toISOString(),
        variables,
      };
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'getCompiled',
        error: String(error),
      });
      throw error;
    }
  }

  async getActivePromptForTask(taskId: string): Promise<ActivePromptResult | null> {
    const sql = this.ensureInitialized();

    try {
      // Find prompt for this task (exclude archived, allow draft/staging/production)
      const prompts = await sql<PromptRow[]>`
        SELECT id, name, description, task_id, status, active_version, staging_version, design_version, model_config, tags, created_at, updated_at
        FROM prompts
        WHERE task_id = ${taskId} AND status != 'archived'
      `;

      if (prompts.length === 0) {
        return null;
      }

      const prompt = prompts[0];
      const versions = await sql<VersionRow[]>`
        SELECT version, content, variables, created_by, created_at, change_note, content_hash
        FROM prompt_versions
        WHERE prompt_id = ${prompt.id}
        ORDER BY version ASC
      `;

      return {
        prompt: this.toPromptDefinition(prompt, versions),
        version: prompt.active_version,
      };
    } catch (error) {
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'getActivePromptForTask',
        error: String(error),
      });
      throw error;
    }
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  /**
   * Convert database rows to PromptDefinition
   */
  private toPromptDefinition(prompt: PromptRow, versions: VersionRow[]): PromptDefinition {
    return {
      id: prompt.id,
      name: prompt.name,
      description: prompt.description ?? undefined,
      taskId: prompt.task_id as PromptDefinition['taskId'],
      status: prompt.status as PromptDefinition['status'],
      versions: versions.map((v): PromptVersion => ({
        version: v.version,
        content: v.content,
        variables: typeof v.variables === 'string' ? JSON.parse(v.variables) : v.variables,
        createdBy: v.created_by ?? 'unknown',
        createdAt: typeof v.created_at === 'string' ? v.created_at : v.created_at.toISOString(),
        changeNote: v.change_note ?? undefined,
        contentHash: v.content_hash ?? computeContentHash(v.content),
        requiresApproval: (v as any).requires_approval ?? false,
        approvedBy: (v as any).approved_by ?? undefined,
        approvedAt: (v as any).approved_at ?? undefined,
        testCases: (v as any).test_cases ? (typeof (v as any).test_cases === 'string' ? JSON.parse((v as any).test_cases) : (v as any).test_cases) : [],
      })),
      activeVersion: prompt.active_version,
      stagingVersion: prompt.staging_version ?? undefined,
      designVersion: prompt.design_version ?? undefined,
      modelConfig: prompt.model_config ?? undefined,
      tags: prompt.tags ?? [],
      createdAt: typeof prompt.created_at === 'string' ? prompt.created_at : prompt.created_at.toISOString(),
      updatedAt: typeof prompt.updated_at === 'string' ? prompt.updated_at : prompt.updated_at.toISOString(),
    };
  }
}
