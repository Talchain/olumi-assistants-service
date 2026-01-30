/**
 * Supabase Prompt Store
 *
 * Uses @supabase/supabase-js client for database access.
 * Avoids direct PostgreSQL connection issues (SASL, IPv6) on Render.
 *
 * Requires tables:
 * - cee_prompts: id, name, description, task_id, status, active_version, tags, created_at, updated_at
 * - cee_prompt_versions: prompt_id, version, content, variables, created_by, created_at, change_note, content_hash, requires_approval, approved_by, approved_at, test_cases
 * - cee_prompt_observations: id, prompt_id, version, observation_type, content, rating, payload_hash, created_by, created_at
 */

import { Buffer } from 'node:buffer';
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

function getJwtClaim(token: string, claim: string): string | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    // JWT payload is base64url encoded
    const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    const value = payload[claim];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

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
  design_version: string | null;
  model_config: { staging?: string; production?: string } | null;
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

interface ObservationRow {
  id: string;
  prompt_id: string;
  version: number;
  observation_type: string;
  content: string | null;
  rating: number | null;
  payload_hash: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Observation types for prompt feedback
 */
export type ObservationType = 'note' | 'rating' | 'failure' | 'success';

/**
 * Prompt observation for tracking feedback and issues
 */
export interface PromptObservation {
  id?: string;
  promptId: string;
  version: number;
  observationType: ObservationType;
  content?: string;
  rating?: number; // 1-5
  payloadHash?: string;
  createdBy?: string;
  createdAt?: string;
}

/**
 * Result of getObservations including aggregated rating
 */
export interface ObservationsResult {
  observations: PromptObservation[];
  averageRating: number | null;
  totalCount: number;
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
      const role = getJwtClaim(this.config.serviceRoleKey, 'role');
      if (role && role !== 'service_role') {
        throw new Error(
          `SUPABASE_SERVICE_ROLE_KEY is not a service role key (role=${role}). ` +
          `This commonly causes empty reads due to RLS. Please provide the service_role JWT.`
        );
      }

      this.client = createClient(this.config.url, this.config.serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      // Verify connection with a simple query (count helps distinguish empty vs inaccessible)
      const { error, count } = await this.client
        .from('cee_prompts')
        .select('id', { count: 'exact', head: true });
      if (error) {
        throw new Error(`Supabase connection test failed: ${error.message}`);
      }

      log.info({ supabaseHost: new URL(this.config.url).host, role, count }, 'Supabase prompt store connection test');

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
      .from('cee_prompts')
      .select('id')
      .eq('id', request.id)
      .single();

    if (existing) {
      throw new Error(`Prompt with ID '${request.id}' already exists`);
    }

    // Insert prompt
    const { error: promptError } = await client.from('cee_prompts').insert({
      id: request.id,
      name: request.name,
      description: request.description ?? null,
      task_id: request.taskId,
      status: 'draft',
      active_version: 1,
      design_version: request.designVersion ?? null,
      model_config: request.modelConfig ?? null,
      tags: request.tags ?? [],
      created_at: now,
      updated_at: now,
    });

    if (promptError) {
      throw new Error(`Failed to create prompt: ${promptError.message}`);
    }

    // Insert first version
    const { error: versionError } = await client.from('cee_prompt_versions').insert({
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
      await client.from('cee_prompts').delete().eq('id', request.id);
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
      .from('cee_prompts')
      .select('*')
      .eq('id', id)
      .single();

    if (promptError || !prompt) {
      return null;
    }

    const { data: versions, error: versionsError } = await client
      .from('cee_prompt_versions')
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

    let query = client.from('cee_prompts').select('*');

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
      .from('cee_prompt_versions')
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
        .from('cee_prompts')
        .select('id')
        .eq('task_id', existing.taskId)
        .eq('status', 'production')
        .neq('id', id);

      if (prodPrompts && prodPrompts.length > 0) {
        // Demote existing production prompt
        await client
          .from('cee_prompts')
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
    if (request.designVersion !== undefined) updateData.design_version = request.designVersion;
    if (request.modelConfig !== undefined) updateData.model_config = request.modelConfig;

    const { error } = await client.from('cee_prompts').update(updateData).eq('id', id);

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

    const { error: versionError } = await client.from('cee_prompt_versions').insert({
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
      .from('cee_prompts')
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
      .from('cee_prompt_versions')
      .update({
        approved_by: request.approvedBy,
        approved_at: now,
      })
      .eq('prompt_id', id)
      .eq('version', request.version);

    if (error) {
      throw new Error(`Failed to approve version: ${error.message}`);
    }

    await client.from('cee_prompts').update({ updated_at: now }).eq('id', id);

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
      .from('cee_prompt_versions')
      .update({ test_cases: JSON.stringify(testCases) })
      .eq('prompt_id', id)
      .eq('version', version);

    if (error) {
      throw new Error(`Failed to update test cases: ${error.message}`);
    }

    await client.from('cee_prompts').update({ updated_at: new Date().toISOString() }).eq('id', id);

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
      const { error } = await client.from('cee_prompts').delete().eq('id', id);
      if (error) {
        throw new Error(`Failed to delete prompt: ${error.message}`);
      }
      log.info({ promptId: id }, 'Prompt hard deleted');
    } else {
      // Soft delete - archive
      const { error } = await client
        .from('cee_prompts')
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

    // Find prompt for task (exclude archived, allow draft/staging/production)
    // Version selection is controlled by stagingVersion vs activeVersion, not prompt status
    // Deterministic selection: most recently updated non-archived prompt wins
    // This ensures predictable behavior when multiple prompts exist for the same task
    const { data: prompts, error: promptError } = await client
      .from('cee_prompts')
      .select('*')
      .eq('task_id', taskId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false }) // Most recently updated first
      .limit(1);

    if (promptError || !prompts || prompts.length === 0) {
      // Log why we're returning null - this is critical for diagnosing cache warming failures
      log.warn({
        event: 'prompt_store.getCompiled.no_prompt',
        taskId,
        useStaging: options?.useStaging,
        hasError: !!promptError,
        errorMessage: promptError?.message,
        errorCode: (promptError as any)?.code,
        promptCount: prompts?.length ?? 0,
      }, `getCompiled returning null: ${promptError ? 'query error' : 'no prompt found for task'}`);
      return null;
    }

    const prompt = prompts[0] as PromptRow;
    const targetVersion = options?.version ?? (options?.useStaging ? prompt.staging_version : null) ?? prompt.active_version;

    // Get the version
    const { data: versions, error: versionError } = await client
      .from('cee_prompt_versions')
      .select('*')
      .eq('prompt_id', prompt.id)
      .eq('version', targetVersion)
      .single();

    if (versionError || !versions) {
      // Log why version lookup failed
      log.warn({
        event: 'prompt_store.getCompiled.no_version',
        taskId,
        promptId: prompt.id,
        targetVersion,
        useStaging: options?.useStaging,
        stagingVersion: prompt.staging_version,
        activeVersion: prompt.active_version,
        hasError: !!versionError,
        errorMessage: versionError?.message,
        errorCode: (versionError as any)?.code,
      }, `getCompiled returning null: ${versionError ? 'version query error' : 'version not found'}`);
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
      modelConfig: prompt.model_config ?? undefined,
    };
  }

  /**
   * Get active prompt for a task
   */
  async getActivePromptForTask(taskId: string): Promise<ActivePromptResult | null> {
    const client = this.ensureInitialized();

    // Find prompt for task (exclude archived, allow draft/staging/production)
    // Deterministic selection: most recently updated non-archived prompt wins
    const { data: prompts, error } = await client
      .from('cee_prompts')
      .select('*')
      .eq('task_id', taskId)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false }) // Most recently updated first
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
      designVersion: prompt.design_version ?? undefined,
      modelConfig: prompt.model_config ?? undefined,
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

  // =========================================================================
  // Observation Methods
  // =========================================================================

  /**
   * Add an observation to a prompt version
   * @throws Error if prompt or version not found
   * @throws Error if validation fails (invalid type, rating out of range, missing content)
   */
  async addObservation(observation: Omit<PromptObservation, 'id' | 'createdAt'>): Promise<PromptObservation> {
    const client = this.ensureInitialized();

    // Validate prompt exists
    const prompt = await this.get(observation.promptId);
    if (!prompt) {
      throw new Error(`Prompt '${observation.promptId}' not found`);
    }

    // Validate version exists
    const versionExists = prompt.versions.some((v) => v.version === observation.version);
    if (!versionExists) {
      throw new Error(`Version ${observation.version} not found for prompt '${observation.promptId}'`);
    }

    // Validate observation type
    const validTypes: ObservationType[] = ['note', 'rating', 'failure', 'success'];
    if (!validTypes.includes(observation.observationType)) {
      throw new Error(`Invalid observation type: ${observation.observationType}. Must be one of: ${validTypes.join(', ')}`);
    }

    // Validate rating if provided
    if (observation.rating !== undefined && (observation.rating < 1 || observation.rating > 5)) {
      throw new Error('Rating must be between 1 and 5');
    }

    // Validate content for types that require it
    if (['note', 'failure', 'success'].includes(observation.observationType) && !observation.content) {
      throw new Error(`Content is required for observation type '${observation.observationType}'`);
    }

    const now = new Date().toISOString();

    const { data, error } = await client
      .from('cee_prompt_observations')
      .insert({
        prompt_id: observation.promptId,
        version: observation.version,
        observation_type: observation.observationType,
        content: observation.content ?? null,
        rating: observation.rating ?? null,
        payload_hash: observation.payloadHash ?? null,
        created_by: observation.createdBy ?? null,
        created_at: now,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add observation: ${error.message}`);
    }

    const row = data as ObservationRow;
    log.info(
      { promptId: observation.promptId, version: observation.version, type: observation.observationType },
      'Observation added'
    );

    return this.toObservation(row);
  }

  /**
   * Get observations for a prompt, optionally filtered by version
   * Returns observations with aggregated average rating
   */
  async getObservations(promptId: string, version?: number): Promise<ObservationsResult> {
    const client = this.ensureInitialized();

    // Validate prompt exists
    const prompt = await this.get(promptId);
    if (!prompt) {
      throw new Error(`Prompt '${promptId}' not found`);
    }

    // Validate version if specified
    if (version !== undefined) {
      const versionExists = prompt.versions.some((v) => v.version === version);
      if (!versionExists) {
        throw new Error(`Version ${version} not found for prompt '${promptId}'`);
      }
    }

    let query = client
      .from('cee_prompt_observations')
      .select('*')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: false });

    if (version !== undefined) {
      query = query.eq('version', version);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch observations: ${error.message}`);
    }

    const observations = ((data ?? []) as ObservationRow[]).map((row) => this.toObservation(row));

    // Calculate average rating from observations with ratings
    const ratingsForVersion = version !== undefined
      ? observations.filter((o) => o.rating !== undefined)
      : observations.filter((o) => o.rating !== undefined);

    const averageRating = ratingsForVersion.length > 0
      ? ratingsForVersion.reduce((sum, o) => sum + (o.rating ?? 0), 0) / ratingsForVersion.length
      : null;

    return {
      observations,
      averageRating: averageRating !== null ? Math.round(averageRating * 100) / 100 : null,
      totalCount: observations.length,
    };
  }

  /**
   * Get average rating for a specific prompt version
   */
  async getAverageRating(promptId: string, version: number): Promise<number | null> {
    const client = this.ensureInitialized();

    const { data, error } = await client
      .from('cee_prompt_observations')
      .select('rating')
      .eq('prompt_id', promptId)
      .eq('version', version)
      .not('rating', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch ratings: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return null;
    }

    const ratings = data.map((r: { rating: number }) => r.rating);
    const average = ratings.reduce((sum: number, r: number) => sum + r, 0) / ratings.length;
    return Math.round(average * 100) / 100;
  }

  /**
   * Delete an observation by ID
   * @throws Error if observation not found
   */
  async deleteObservation(id: string): Promise<void> {
    const client = this.ensureInitialized();

    // Check if observation exists
    const { data: existing, error: fetchError } = await client
      .from('cee_prompt_observations')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new Error(`Observation '${id}' not found`);
    }

    const { error } = await client
      .from('cee_prompt_observations')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete observation: ${error.message}`);
    }

    log.info({ observationId: id }, 'Observation deleted');
  }

  /**
   * Convert database row to PromptObservation
   */
  private toObservation(row: ObservationRow): PromptObservation {
    return {
      id: row.id,
      promptId: row.prompt_id,
      version: row.version,
      observationType: row.observation_type as ObservationType,
      content: row.content ?? undefined,
      rating: row.rating ?? undefined,
      payloadHash: row.payload_hash ?? undefined,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
    };
  }
}
