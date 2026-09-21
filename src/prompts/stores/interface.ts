/**
 * Prompt Store Interface
 *
 * Abstract interface for prompt storage backends.
 * Enables pluggable storage (file, Postgres, Redis, etc.)
 * with consistent API across implementations.
 */

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

/**
 * Filter options for listing prompts
 */
export interface PromptListFilter {
  /** Filter by task ID */
  taskId?: string;
  /** Filter by status */
  status?: 'draft' | 'staging' | 'production' | 'archived';
  /** Filter by tags (any match) */
  tags?: string[];
}

/**
 * Options for getting compiled prompts
 */
export interface GetCompiledOptions {
  /** Specific version to use */
  version?: number;
  /** Use staging version if available */
  useStaging?: boolean;
}

/**
 * Result of getting active prompt for a task
 */
export interface ActivePromptResult {
  /** The prompt definition */
  prompt: PromptDefinition;
  /** The active version number */
  version: number;
}

/**
 * Optimistic concurrency token captured by the governed store before it
 * evaluates a served-byte change. Backends must apply this predicate in the
 * same write/delete statement as the mutation so evidence cannot be checked
 * against one row and committed over a newer row.
 */
export interface PromptMutationPrecondition {
  readonly expectedUpdatedAt: string;
}

export class PromptMutationConflictError extends Error {
  readonly name = 'PromptMutationConflictError';
  readonly code = 'PROMPT_MUTATION_CONFLICT';

  constructor(readonly promptId: string) {
    super(
      `Prompt '${promptId}' changed while the mutation was being validated. ` +
      'Reload the prompt and retry the complete mutation.',
    );
  }
}

/**
 * Abstract interface for prompt storage backends
 *
 * All methods are async to support both local and remote stores.
 * Implementations must handle their own initialization and cleanup.
 */
export interface IPromptStore {
  /**
   * Initialize the store
   * Called once during server startup
   */
  initialize(): Promise<void>;

  /**
   * Create a new prompt
   * @throws Error if prompt with same ID exists
   */
  create(request: CreatePromptRequest): Promise<PromptDefinition>;

  /**
   * Get a prompt by ID
   * @returns null if not found
   */
  get(id: string): Promise<PromptDefinition | null>;

  /**
   * List all prompts, optionally filtered
   */
  list(filter?: PromptListFilter): Promise<PromptDefinition[]>;

  /**
   * Update prompt metadata (not content)
   * @throws Error if prompt not found
   * @throws Error if setting to production when another production prompt exists for task
   */
  update(
    id: string,
    request: UpdatePromptRequest,
    precondition?: PromptMutationPrecondition,
  ): Promise<PromptDefinition>;

  /**
   * Create a new version of an existing prompt
   * @throws Error if prompt not found
   */
  createVersion(id: string, request: CreateVersionRequest): Promise<PromptDefinition>;

  /**
   * Rollback to a previous version
   * @throws Error if prompt or version not found
   */
  rollback(
    id: string,
    request: RollbackRequest,
    precondition?: PromptMutationPrecondition,
  ): Promise<PromptDefinition>;

  /**
   * Approve a version for production promotion
   * @throws Error if prompt or version not found
   * @throws Error if version does not require approval
   * @throws Error if version is already approved
   */
  approveVersion(id: string, request: ApprovalRequest): Promise<PromptDefinition>;

  /**
   * Update test cases for a specific version
   * @throws Error if prompt or version not found
   */
  updateTestCases(id: string, version: number, testCases: PromptTestCase[]): Promise<PromptDefinition>;

  /**
   * Delete a prompt (soft delete by default, hard delete optional)
   * @param hard - If true, permanently delete; if false, archive
   * @throws Error if prompt not found
   */
  delete(
    id: string,
    hard?: boolean,
    precondition?: PromptMutationPrecondition,
  ): Promise<void>;

  /**
   * Get compiled prompt content for a task with variables interpolated.
   *
   * Finds the canonical, non-archived prompt for the task. Canonical election
   * must never depend on mutable metadata such as updatedAt.
   *
   * Version selection:
   * - If options.version is specified, uses that exact version
   * - If options.useStaging is true and staging_version exists, uses staging_version
   * - Otherwise uses active_version
   *
   * @returns null if no non-archived prompt exists for task, or if the target version doesn't exist
   */
  getCompiled(
    taskId: string,
    variables: Record<string, string | number>,
    options?: GetCompiledOptions
  ): Promise<CompiledPrompt | null>;

  /**
   * Get the active prompt for a task.
   *
   * Finds the canonical, non-archived prompt for the task. Canonical election
   * must never depend on mutable metadata such as updatedAt.
   *
   * @returns null if no non-archived prompt exists for task
   */
  getActivePromptForTask(taskId: string): Promise<ActivePromptResult | null>;
}

/**
 * Store type identifiers
 */
export type PromptStoreType = 'file' | 'postgres' | 'supabase' | 'memory';

/**
 * Base configuration shared by all store types
 */
export interface BaseStoreConfig {
  /** Store type */
  type: PromptStoreType;
}

/**
 * File store configuration
 */
export interface FileStoreConfig extends BaseStoreConfig {
  type: 'file';
  /** Path to the prompts JSON file */
  filePath: string;
  /** Whether to create backups before writes */
  backupEnabled?: boolean;
  /** Maximum number of backups to keep */
  maxBackups?: number;
}

/**
 * Postgres store configuration
 */
export interface PostgresStoreConfig extends BaseStoreConfig {
  type: 'postgres';
  /** Database connection string */
  connectionString: string;
  /** Connection pool size */
  poolSize?: number;
  /** SSL mode */
  ssl?: boolean;
}

/**
 * Supabase store configuration
 */
export interface SupabaseStoreConfig extends BaseStoreConfig {
  type: 'supabase';
  /** Supabase project URL */
  url: string;
  /** Supabase service role key */
  serviceRoleKey: string;
}

/**
 * Memory store configuration (for testing)
 */
export interface MemoryStoreConfig extends BaseStoreConfig {
  type: 'memory';
}

/**
 * Union of all store configurations
 */
export type PromptStoreConfig = FileStoreConfig | PostgresStoreConfig | SupabaseStoreConfig | MemoryStoreConfig;
