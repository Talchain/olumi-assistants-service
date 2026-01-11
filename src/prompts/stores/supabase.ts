/**
 * Supabase Prompt Store
 *
 * Uses @supabase/supabase-js client for database access.
 * Avoids direct PostgreSQL connection issues (SASL, IPv6) on Render.
 *
 * Requires tables:
 * - prompts: id, name, description, task_id, status, active_version, tags, created_at, updated_at
 * - prompt_versions: prompt_id, version, content, variables, created_by, created_at, change_note, content_hash, requires_approval, approved_by, approved_at, test_cases
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  IPromptStore,
  PromptListFilter,
  GetCompiledOptions,
  ActivePromptResult,
} from './interface.js';
import type {
  PromptDefinition,
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
 * Supabase store configuration
 */
export interface SupabaseStoreConfig {
  type: 'supabase';
  url: string;
  serviceRoleKey: string;
}

/**
 * Database row types
 */
interface PromptRow {
  id: string;
  name: string;
  description: string | null;
  task_id: string;
  status: string;
  active_version: number;
  staging_version: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  prompt_id: string;
  version: number;
  content: string;
  variables: string; // JSON string
  created_by: string | null;
  created_at: string;
  change_note: string | null;
  content_hash: string;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  test_cases: string; // JSON string
}

/**
 * Supabase-backed prompt store
 */
export class SupabasePromptStore implements IPromptStore {
  private client: SupabaseClient | null = null;
  private config: SupabaseStoreConfig;

  constructor(config: Omit<SupabaseStoreConfig, 'type'>) {
    this.config = { ...config, type: 'supabase' };
  }

  /**
   * Initialize the store and verify connection
   */
  async initialize(): Promise<void> {
    try {
      this.client = createClient(this.config.url, this.config.serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      // Verify connection with a simple query
      const { error } = await this.client.from('prompts').select('id').limit(1);
      if (error) {
        throw new Error(`Supabase connection test failed: ${error.message}`);
      }

      log.info('Supabase prompt store initialized');
    } catch (error) {
      log.error({ error }, 'Failed to initialize Supabase prompt store');
      emit(TelemetryEvents.PromptStoreError, {
        operation: 'initialize',
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): SupabaseClient {
    if (!this.client) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Create a new prompt
   */
  async create(request: CreatePromptRequest): Promise<PromptDefinition> {
    const client = this.ensureInitialized();
    const contentHash = computeContentHash(request.content);
    const now = new Date().toISOString();

    // Check for existing prompt
    const { data: existing } = await client
      .from('prompts')
      .select('id')
      .eq('id', request.id)
      .single();

    if (existing) {
      throw new Error(`Prompt with ID '${request.id}' already exists`);
    }

    // Insert prompt
    const { error: promptError } = await client.from('prompts').insert({
      id: request.id,
      name: request.name,
      description: request.description ?? null,
      task_id: request.taskId,
      status: 'draft',
      active_version: 1,
      tags: request.tags ?? [],
      created_at: now,
      updated_at: now,
    });

    if (promptError) {
      throw new Error(`Failed to create prompt: ${promptError.message}`);
    }

    // Insert first version
    const { error: versionError } = await client.from('prompt_versions').insert({
      prompt_id: request.id,
      version: 1,
      content: request.content,
      variables: JSON.stringify(request.variables ?? []),
      created_by: request.createdBy ?? null,
      created_at: now,
      change_note: request.changeNote ?? null,
      content_hash: contentHash,
      requires_approval: false,
      test_cases: JSON.stringify([]),
    });

    if (versionError) {
      // Rollback prompt creation
      await client.from('prompts').delete().eq('id', request.id);
      throw new Error(`Failed to create version: ${versionError.message}`);
    }

    log.info({ promptId: request.id, taskId: request.taskId }, 'Prompt created');

    return this.get(request.id) as Promise<PromptDefinition>;
  }

  /**
   * Get a prompt by ID
   */
  async get(id: string): Promise<PromptDefinition | null> {
    const client = this.ensureInitialized();

    const { data: prompt, error: promptError } = await client
      .from('prompts')
      .select('*')
      .eq('id', id)
      .single();

    if (promptError || !prompt) {
      return null;
    }

    const { data: versions, error: versionsError } = await client
      .from('prompt_versions')
      .select('*')
      .eq('prompt_id', id)
      .order('version', { ascending: true });

    if (versionsError) {
      throw new Error(`Failed to fetch versions: ${versionsError.message}`);
    }

    return this.toPromptDefinition(prompt as PromptRow, (versions ?? []) as VersionRow[]);
  }

  /**
   * List all prompts, optionally filtered
   */
  async list(filter?: PromptListFilter): Promise<PromptDefinition[]> {
    const client = this.ensureInitialized();

    let query = client.from('prompts').select('*');

    if (filter?.taskId) {
      query = query.eq('task_id', filter.taskId);
    }
    if (filter?.status) {
      query = query.eq('status', filter.status);
    }

    const { data: prompts, error: promptsError } = await query;

    if (promptsError) {
      throw new Error(`Failed to list prompts: ${promptsError.message}`);
    }

    if (!prompts || prompts.length === 0) {
      return [];
    }

    // Fetch all versions for all prompts
    const promptIds = prompts.map((p: PromptRow) => p.id);
    const { data: allVersions, error: versionsError } = await client
      .from('prompt_versions')
      .select('*')
      .in('prompt_id', promptIds)
      .order('version', { ascending: true });

    if (versionsError) {
      throw new Error(`Failed to fetch versions: ${versionsError.message}`);
    }

    // Group versions by prompt_id
    const versionsByPrompt = new Map<string, VersionRow[]>();
    for (const v of (allVersions ?? []) as VersionRow[]) {
      const existing = versionsByPrompt.get(v.prompt_id) ?? [];
      existing.push(v);
      versionsByPrompt.set(v.prompt_id, existing);
    }

    // Filter by tags if specified
    let filteredPrompts = prompts as PromptRow[];
    if (filter?.tags && filter.tags.length > 0) {
      filteredPrompts = filteredPrompts.filter((p) =>
        filter.tags!.some((tag) => p.tags?.includes(tag))
      );
    }

    return filteredPrompts.map((prompt) =>
      this.toPromptDefinition(prompt, versionsByPrompt.get(prompt.id) ?? [])
    );
  }

  /**
   * Update prompt metadata
   */
  async update(id: string, request: UpdatePromptRequest): Promise<PromptDefinition> {
    const client = this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Prompt '${id}' not found`);
    }

    // If setting to production, check for existing production prompt for same task
    if (request.status === 'production' && existing.status !== 'production') {
      const { data: prodPrompts } = await client
        .from('prompts')
        .select('id')
        .eq('task_id', existing.taskId)
        .eq('status', 'production')
        .neq('id', id);

      if (prodPrompts && prodPrompts.length > 0) {
        // Demote existing production prompt
        await client
          .from('prompts')
          .update({ status: 'staging', updated_at: new Date().toISOString() })
          .eq('id', prodPrompts[0].id);
      }
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (request.name !== undefined) updateData.name = request.name;
    if (request.description !== undefined) updateData.description = request.description;
    if (request.status !== undefined) updateData.status = request.status;
    if (request.tags !== undefined) updateData.tags = request.tags;
    if (request.activeVersion !== undefined) updateData.active_version = request.activeVersion;
    if (request.stagingVersion !== undefined) updateData.staging_version = request.stagingVersion;

    const { error } = await client.from('prompts').update(updateData).eq('id', id);

    if (error) {
      throw new Error(`Failed to update prompt: ${error.message}`);
    }

    log.info({ promptId: id }, 'Prompt updated');
    return this.get(id) as Promise<PromptDefinition>;
  }

  /**
   * Create a new version
   */
  async createVersion(id: string, request: CreateVersionRequest): Promise<PromptDefinition> {
    const client = this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const newVersion = Math.max(...existing.versions.map((v) => v.version)) + 1;
    const contentHash = computeContentHash(request.content);
    const now = new Date().toISOString();

    const { error: versionError } = await client.from('prompt_versions').insert({
      prompt_id: id,
      version: newVersion,
      content: request.content,
      variables: JSON.stringify(request.variables ?? []),
      created_by: request.createdBy ?? null,
      created_at: now,
      change_note: request.changeNote ?? null,
      content_hash: contentHash,
      requires_approval: request.requiresApproval ?? false,
      test_cases: JSON.stringify([]),
    });

    if (versionError) {
      throw new Error(`Failed to create version: ${versionError.message}`);
    }

    log.info({ promptId: id, version: newVersion }, 'Prompt version created');
    return this.get(id) as Promise<PromptDefinition>;
  }

  /**
   * Rollback to a previous version
   */
  async rollback(id: string, request: RollbackRequest): Promise<PromptDefinition> {
    const client = this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const targetVersion = existing.versions.find((v) => v.version === request.targetVersion);
    if (!targetVersion) {
      throw new Error(`Version ${request.targetVersion} not found`);
    }

    const { error } = await client
      .from('prompts')
      .update({
        active_version: request.targetVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to rollback: ${error.message}`);
    }

    log.info(
      { promptId: id, fromVersion: existing.activeVersion, toVersion: request.targetVersion },
      'Prompt rolled back'
    );

    return this.get(id) as Promise<PromptDefinition>;
  }

  /**
   * Approve a version for production
   */
  async approveVersion(id: string, request: ApprovalRequest): Promise<PromptDefinition> {
    const client = this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const version = existing.versions.find((v) => v.version === request.version);
    if (!version) {
      throw new Error(`Version ${request.version} not found`);
    }

    if (!version.requiresApproval) {
      throw new Error(`Version ${request.version} does not require approval`);
    }

    if (version.approvedBy) {
      throw new Error(`Version ${request.version} is already approved`);
    }

    const now = new Date().toISOString();

    const { error } = await client
      .from('prompt_versions')
      .update({
        approved_by: request.approvedBy,
        approved_at: now,
      })
      .eq('prompt_id', id)
      .eq('version', request.version);

    if (error) {
      throw new Error(`Failed to approve version: ${error.message}`);
    }

    await client.from('prompts').update({ updated_at: now }).eq('id', id);

    log.info({ promptId: id, version: request.version, approvedBy: request.approvedBy }, 'Version approved');
    return this.get(id) as Promise<PromptDefinition>;
  }

  /**
   * Update test cases for a version
   */
  async updateTestCases(id: string, version: number, testCases: PromptTestCase[]): Promise<PromptDefinition> {
    const client = this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const versionData = existing.versions.find((v) => v.version === version);
    if (!versionData) {
      throw new Error(`Version ${version} not found`);
    }

    const { error } = await client
      .from('prompt_versions')
      .update({ test_cases: JSON.stringify(testCases) })
      .eq('prompt_id', id)
      .eq('version', version);

    if (error) {
      throw new Error(`Failed to update test cases: ${error.message}`);
    }

    await client.from('prompts').update({ updated_at: new Date().toISOString() }).eq('id', id);

    return this.get(id) as Promise<PromptDefinition>;
  }

  /**
   * Delete a prompt
   */
  async delete(id: string, hard = false): Promise<void> {
    const client = this.ensureInitialized();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Prompt '${id}' not found`);
    }

    if (hard) {
      // Hard delete - cascade will handle versions
      const { error } = await client.from('prompts').delete().eq('id', id);
      if (error) {
        throw new Error(`Failed to delete prompt: ${error.message}`);
      }
      log.info({ promptId: id }, 'Prompt hard deleted');
    } else {
      // Soft delete - archive
      const { error } = await client
        .from('prompts')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        throw new Error(`Failed to archive prompt: ${error.message}`);
      }
      log.info({ promptId: id }, 'Prompt archived');
    }
  }

  /**
   * Get compiled prompt for a task
   */
  async getCompiled(
    taskId: string,
    variables: Record<string, string | number>,
    options?: GetCompiledOptions
  ): Promise<CompiledPrompt | null> {
    const client = this.ensureInitialized();

    // Find production prompt for task
    const { data: prompts, error: promptError } = await client
      .from('prompts')
      .select('*')
      .eq('task_id', taskId)
      .eq('status', 'production')
      .limit(1);

    if (promptError || !prompts || prompts.length === 0) {
      return null;
    }

    const prompt = prompts[0] as PromptRow;
    const targetVersion = options?.version ?? (options?.useStaging ? prompt.staging_version : null) ?? prompt.active_version;

    // Get the version
    const { data: versions, error: versionError } = await client
      .from('prompt_versions')
      .select('*')
      .eq('prompt_id', prompt.id)
      .eq('version', targetVersion)
      .single();

    if (versionError || !versions) {
      return null;
    }

    const version = versions as VersionRow;
    const versionVariables = JSON.parse(version.variables || '[]');
    const content = interpolatePrompt(version.content, variables, versionVariables);

    return {
      promptId: prompt.id,
      version: version.version,
      content,
      compiledAt: new Date().toISOString(),
    };
  }

  /**
   * Get active prompt for a task
   */
  async getActivePromptForTask(taskId: string): Promise<ActivePromptResult | null> {
    const client = this.ensureInitialized();

    const { data: prompts, error } = await client
      .from('prompts')
      .select('*')
      .eq('task_id', taskId)
      .eq('status', 'production')
      .limit(1);

    if (error || !prompts || prompts.length === 0) {
      return null;
    }

    const prompt = prompts[0] as PromptRow;
    const fullPrompt = await this.get(prompt.id);

    if (!fullPrompt) {
      return null;
    }

    return {
      prompt: fullPrompt,
      version: prompt.active_version,
    };
  }

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
      activeVersion: prompt.active_version,
      stagingVersion: prompt.staging_version ?? undefined,
      tags: prompt.tags ?? [],
      createdAt: prompt.created_at,
      updatedAt: prompt.updated_at,
      versions: versions.map((v) => ({
        version: v.version,
        content: v.content,
        variables: JSON.parse(v.variables || '[]'),
        createdBy: v.created_by ?? 'system',
        createdAt: v.created_at,
        changeNote: v.change_note ?? undefined,
        contentHash: v.content_hash,
        requiresApproval: v.requires_approval ?? false,
        approvedBy: v.approved_by ?? undefined,
        approvedAt: v.approved_at ?? undefined,
        testCases: JSON.parse(v.test_cases || '[]'),
      })),
    };
  }
}
