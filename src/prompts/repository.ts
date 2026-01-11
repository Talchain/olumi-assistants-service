/**
 * Prompt Repository
 *
 * Provides read/write separation for prompt storage with:
 * - Read-only interface for hot path (prompt loading)
 * - Write interface for admin operations
 * - In-memory caching with TTL
 * - Fallback to filesystem with cooldown
 * - Observability logging with content hashing
 */

import type { CeeTaskId } from './schema.js';
import type { PromptDefinition, CreatePromptRequest } from './schema.js';
import { computeContentHash } from './schema.js';
import type { IPromptStore } from './stores/interface.js';
import { PostgresPromptStore } from './stores/postgres.js';
import { SupabasePromptStore } from './stores/supabase.js';
import { FilePromptStore } from './stores/file.js';
import { getDefaultPrompts } from './loader.js';
import { log } from '../utils/telemetry.js';
import { config } from '../config/index.js';

/**
 * Fallback cooldown duration in milliseconds (30 seconds)
 */
const FALLBACK_COOLDOWN_MS = 30_000;

/**
 * Cache TTL in milliseconds (5 minutes)
 * Prompts are refreshed on this interval
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Cached prompt entry
 */
interface CachedPrompt {
  prompt: PromptDefinition;
  version: number;
  contentHash: string;
  cachedAt: number;
}

/**
 * Health status for the repository
 */
export interface RepositoryHealthStatus {
  dbHealthy: boolean;
  fallbackActive: boolean;
  cooldownRemaining: number;
  cacheSize: number;
  lastDbError?: string;
}

/**
 * Read-only interface for prompt loading
 */
export interface IPromptReader {
  /**
   * Get the active prompt content for a task
   * Uses caching and falls back to defaults if DB is unavailable
   */
  getActivePrompt(taskId: CeeTaskId): Promise<{
    content: string;
    source: 'database' | 'cache' | 'fallback';
    promptId?: string;
    version?: number;
    contentHash: string;
  } | null>;

  /**
   * Check if the repository is healthy
   */
  getHealth(): RepositoryHealthStatus;

  /**
   * Refresh cache for all tasks (called at startup)
   */
  warmCache(): Promise<void>;
}

/**
 * Write interface for admin operations
 */
export interface IPromptWriter {
  /**
   * Create a new prompt
   */
  create(request: CreatePromptRequest): Promise<PromptDefinition>;

  /**
   * Get a prompt by ID
   */
  get(id: string): Promise<PromptDefinition | null>;

  /**
   * List all prompts with optional filters
   */
  list(filter?: { taskId?: string; status?: string }): Promise<PromptDefinition[]>;

  /**
   * Update prompt metadata or status
   */
  update(id: string, request: Partial<PromptDefinition>): Promise<PromptDefinition>;

  /**
   * Create a new version of an existing prompt
   */
  createVersion(id: string, request: {
    content: string;
    createdBy: string;
    changeNote?: string;
  }): Promise<PromptDefinition>;

  /**
   * Seed default prompts (non-destructive)
   */
  seedDefaults(force?: boolean): Promise<{ seeded: number; skipped: number }>;

  /**
   * Invalidate cache (called after writes)
   */
  invalidateCache(taskId?: CeeTaskId): void;
}

/**
 * Prompt Repository implementation
 */
export class PromptRepository implements IPromptReader, IPromptWriter {
  private store: IPromptStore | null = null;
  private initialized = false;

  // Cache for active prompts by task
  private cache = new Map<CeeTaskId, CachedPrompt>();

  // Fallback state
  private fallbackActive = false;
  private fallbackCooldownUntil = 0;
  private lastDbError: string | undefined;

  constructor(
    private readonly connectionString?: string,
    private readonly fileStorePath?: string
  ) {}

  private getConfiguredStoreType(): 'file' | 'postgres' | 'supabase' {
    // Back-compat: explicit connection string constructor means "use postgres"
    if (this.connectionString) return 'postgres';
    const storeType = config.prompts?.storeType ?? 'file';
    if (storeType === 'postgres' || storeType === 'supabase' || storeType === 'file') return storeType;
    return 'file';
  }

  private createPrimaryStore(): IPromptStore {
    const storeType = this.getConfiguredStoreType();

    if (storeType === 'supabase') {
      const url = config.prompts?.supabaseUrl;
      const serviceRoleKey = config.prompts?.supabaseServiceRoleKey;
      if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when PROMPTS_STORE_TYPE=supabase');
      }
      return new SupabasePromptStore({ url, serviceRoleKey });
    }

    if (storeType === 'postgres') {
      const connStr = this.connectionString ?? config.prompts?.postgresUrl;
      if (!connStr) {
        throw new Error('PROMPTS_POSTGRES_URL is required when PROMPTS_STORE_TYPE=postgres');
      }
      return new PostgresPromptStore({
        connectionString: connStr,
        poolSize: config.prompts?.postgresPoolSize ?? 10,
        ssl: config.prompts?.postgresSsl ?? false,
      });
    }

    const filePath = this.fileStorePath ?? config.prompts?.storePath ?? 'data/prompts.json';
    return new FilePromptStore({
      filePath,
      backupEnabled: config.prompts?.backupEnabled ?? true,
      maxBackups: config.prompts?.maxBackups ?? 10,
    });
  }

  private async initializeStore(): Promise<void> {
    const storeType = this.getConfiguredStoreType();
    const store = this.createPrimaryStore();
    await store.initialize();
    this.store = store;
    this.fallbackActive = false;
    this.lastDbError = undefined;

    log.info({
      event: 'prompt.repository.initialized',
      backend: storeType,
    }, `Prompt repository initialized with ${storeType}`);
  }

  /**
   * Initialize the repository
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.initializeStore();
    } catch (error) {
      this.lastDbError = String(error);
      this.store = null;
      this.activateFallback();

      log.warn({
        event: 'prompt.repository.init_failed',
        store_type: this.getConfiguredStoreType(),
        error: this.lastDbError,
      }, 'Prompt store init failed, activating fallback');
    }

    this.initialized = true;
  }

  /**
   * Activate fallback mode with cooldown
   */
  private activateFallback(): void {
    this.fallbackActive = true;
    this.fallbackCooldownUntil = Date.now() + FALLBACK_COOLDOWN_MS;

    log.info({
      event: 'prompt.repository.fallback_activated',
      cooldown_ms: FALLBACK_COOLDOWN_MS,
    }, 'Fallback mode activated');
  }

  /**
   * Try to recover from fallback mode
   */
  private async tryRecoverFromFallback(): Promise<boolean> {
    if (!this.fallbackActive) return true;
    if (Date.now() < this.fallbackCooldownUntil) return false;

    try {
      await this.initializeStore();

      log.info({
        event: 'prompt.repository.recovered',
      }, 'Recovered from fallback mode');

      return true;
    } catch (error) {
      this.lastDbError = String(error);
      this.fallbackCooldownUntil = Date.now() + FALLBACK_COOLDOWN_MS;

      log.warn({
        event: 'prompt.repository.recovery_failed',
        error: this.lastDbError,
      }, 'Failed to recover from fallback');

      return false;
    }
  }

  // =========================================================================
  // IPromptReader Implementation
  // =========================================================================

  async getActivePrompt(taskId: CeeTaskId): Promise<{
    content: string;
    source: 'database' | 'cache' | 'fallback';
    promptId?: string;
    version?: number;
    contentHash: string;
  } | null> {
    // Check cache first
    const cached = this.cache.get(taskId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const activeVersion = cached.prompt.versions.find(v => v.version === cached.version);
      if (activeVersion) {
        log.debug({
          event: 'prompt.cache.hit',
          task_id: taskId,
          prompt_id: cached.prompt.id,
          version: cached.version,
          content_hash: cached.contentHash,
        }, 'Prompt loaded from cache');

        return {
          content: activeVersion.content,
          source: 'cache',
          promptId: cached.prompt.id,
          version: cached.version,
          contentHash: cached.contentHash,
        };
      }
    }

    // Try database if not in fallback or cooldown expired
    if (!this.fallbackActive || await this.tryRecoverFromFallback()) {
      try {
        const result = await this.store?.getActivePromptForTask(taskId);
        if (result) {
          const activeVersion = result.prompt.versions.find(v => v.version === result.version);
          if (activeVersion) {
            const contentHash = activeVersion.contentHash ?? computeContentHash(activeVersion.content);

            // Update cache
            this.cache.set(taskId, {
              prompt: result.prompt,
              version: result.version,
              contentHash,
              cachedAt: Date.now(),
            });

            log.debug({
              event: 'prompt.database.loaded',
              task_id: taskId,
              prompt_id: result.prompt.id,
              version: result.version,
              content_hash: contentHash,
            }, 'Prompt loaded from database');

            return {
              content: activeVersion.content,
              source: 'database',
              promptId: result.prompt.id,
              version: result.version,
              contentHash,
            };
          }
        }
      } catch (error) {
        this.lastDbError = String(error);
        this.activateFallback();

        log.warn({
          event: 'prompt.database.error',
          task_id: taskId,
          error: this.lastDbError,
        }, 'Database error, falling back');
      }
    }

    // Fallback to defaults
    const defaults = getDefaultPrompts();
    const defaultContent = defaults[taskId];

    if (defaultContent) {
      const contentHash = computeContentHash(defaultContent);

      log.debug({
        event: 'prompt.fallback.loaded',
        task_id: taskId,
        content_hash: contentHash,
      }, 'Prompt loaded from fallback defaults');

      return {
        content: defaultContent,
        source: 'fallback',
        contentHash,
      };
    }

    return null;
  }

  getHealth(): RepositoryHealthStatus {
    return {
      dbHealthy: !this.fallbackActive,
      fallbackActive: this.fallbackActive,
      cooldownRemaining: Math.max(0, this.fallbackCooldownUntil - Date.now()),
      cacheSize: this.cache.size,
      lastDbError: this.lastDbError,
    };
  }

  async warmCache(): Promise<void> {
    if (!this.store) return;

    try {
      const allPrompts = await this.store.list({ status: 'production' });

      for (const prompt of allPrompts) {
        const taskId = prompt.taskId as CeeTaskId;
        const activeVersion = prompt.versions.find(v => v.version === prompt.activeVersion);

        if (activeVersion) {
          const contentHash = activeVersion.contentHash ?? computeContentHash(activeVersion.content);

          this.cache.set(taskId, {
            prompt,
            version: prompt.activeVersion,
            contentHash,
            cachedAt: Date.now(),
          });
        }
      }

      log.info({
        event: 'prompt.cache.warmed',
        count: this.cache.size,
      }, 'Prompt cache warmed');
    } catch (error) {
      log.warn({
        event: 'prompt.cache.warm_failed',
        error: String(error),
      }, 'Failed to warm cache');
    }
  }

  // =========================================================================
  // IPromptWriter Implementation
  // =========================================================================

  async create(request: CreatePromptRequest): Promise<PromptDefinition> {
    this.ensureWritable();
    const result = await this.store!.create(request);
    this.invalidateCache(request.taskId as CeeTaskId);

    log.info({
      event: 'prompt.created',
      prompt_id: result.id,
      task_id: request.taskId,
      content_hash: computeContentHash(request.content),
    }, 'Prompt created');

    return result;
  }

  async get(id: string): Promise<PromptDefinition | null> {
    this.ensureWritable();
    return this.store!.get(id);
  }

  async list(filter?: { taskId?: string; status?: 'draft' | 'staging' | 'production' | 'archived' }): Promise<PromptDefinition[]> {
    this.ensureWritable();
    return this.store!.list(filter);
  }

  async update(id: string, request: Partial<PromptDefinition>): Promise<PromptDefinition> {
    this.ensureWritable();
    const existing = await this.store!.get(id);
    if (!existing) throw new Error(`Prompt '${id}' not found`);

    const result = await this.store!.update(id, request);
    this.invalidateCache(existing.taskId as CeeTaskId);

    log.info({
      event: 'prompt.updated',
      prompt_id: id,
      task_id: existing.taskId,
      status: request.status,
    }, 'Prompt updated');

    return result;
  }

  async createVersion(id: string, request: {
    content: string;
    createdBy: string;
    changeNote?: string;
  }): Promise<PromptDefinition> {
    this.ensureWritable();
    const existing = await this.store!.get(id);
    if (!existing) throw new Error(`Prompt '${id}' not found`);

    const result = await this.store!.createVersion(id, {
      content: request.content,
      variables: [],
      createdBy: request.createdBy,
      changeNote: request.changeNote,
      requiresApproval: false,
    });
    this.invalidateCache(existing.taskId as CeeTaskId);

    const contentHash = computeContentHash(request.content);
    log.info({
      event: 'prompt.version_created',
      prompt_id: id,
      task_id: existing.taskId,
      version: result.versions.length,
      content_hash: contentHash,
    }, 'Prompt version created');

    return result;
  }

  async seedDefaults(force = false): Promise<{ seeded: number; skipped: number }> {
    this.ensureWritable();

    const defaults = getDefaultPrompts();
    const taskIds = Object.keys(defaults) as CeeTaskId[];

    let seeded = 0;
    let skipped = 0;

    for (const taskId of taskIds) {
      const content = defaults[taskId];
      if (!content) continue;

      // Check if prompt already exists for this task
      const existing = await this.store!.list({ taskId });
      const hasProduction = existing.some(p => p.status === 'production');

      if (hasProduction && !force) {
        // Non-destructive: skip if production prompt exists
        log.debug({
          event: 'prompt.seed.skipped',
          task_id: taskId,
          reason: 'production_exists',
        }, 'Skipping seed - production prompt exists');
        skipped++;
        continue;
      }

      // Create or update the default prompt
      const promptId = `${taskId}_default`;
      const existingPrompt = await this.store!.get(promptId);

      if (existingPrompt) {
        // Check if content changed
        const activeVersion = existingPrompt.versions.find(
          v => v.version === existingPrompt.activeVersion
        );
        const existingHash = activeVersion?.contentHash ?? '';
        const newHash = computeContentHash(content);

        if (existingHash === newHash) {
          log.debug({
            event: 'prompt.seed.skipped',
            task_id: taskId,
            reason: 'content_unchanged',
            content_hash: newHash,
          }, 'Skipping seed - content unchanged');
          skipped++;
          continue;
        }

        // Content changed, create new version
        await this.store!.createVersion(promptId, {
          content,
          variables: [],
          createdBy: 'system-seed',
          changeNote: 'Updated from defaults.ts',
          requiresApproval: false,
        });

        log.info({
          event: 'prompt.seed.updated',
          task_id: taskId,
          prompt_id: promptId,
          content_hash: newHash,
        }, 'Seeded prompt updated with new version');
        seeded++;
      } else {
        // Create new prompt
        await this.store!.create({
          id: promptId,
          name: `${taskId} (Default)`,
          description: `Auto-seeded default prompt for ${taskId}`,
          taskId,
          content,
          variables: [],
          tags: ['default', 'seeded'],
          createdBy: 'system-seed',
          changeNote: 'Initial seed from defaults.ts',
        });

        // Set to production
        await this.store!.update(promptId, { status: 'production' });

        const contentHash = computeContentHash(content);
        log.info({
          event: 'prompt.seed.created',
          task_id: taskId,
          prompt_id: promptId,
          content_hash: contentHash,
        }, 'Seeded new prompt');
        seeded++;
      }
    }

    log.info({
      event: 'prompt.seed.complete',
      seeded,
      skipped,
    }, 'Prompt seeding complete');

    return { seeded, skipped };
  }

  invalidateCache(taskId?: CeeTaskId): void {
    if (taskId) {
      this.cache.delete(taskId);
      log.debug({
        event: 'prompt.cache.invalidated',
        task_id: taskId,
      }, 'Cache invalidated for task');
    } else {
      this.cache.clear();
      log.debug({
        event: 'prompt.cache.cleared',
      }, 'Cache cleared');
    }
  }

  private ensureWritable(): void {
    if (this.fallbackActive) {
      throw new Error('Database unavailable - writes not allowed in fallback mode');
    }
    if (!this.store) {
      throw new Error('Repository not initialized');
    }
  }
}

// =========================================================================
// Singleton Instance
// =========================================================================

let repositoryInstance: PromptRepository | null = null;

/**
 * Get the singleton prompt repository instance
 */
export function getPromptRepository(): PromptRepository {
  if (!repositoryInstance) {
    repositoryInstance = new PromptRepository();
  }
  return repositoryInstance;
}

/**
 * Initialize the prompt repository
 * Should be called during server startup
 */
export async function initializePromptRepository(): Promise<void> {
  const repo = getPromptRepository();
  await repo.initialize();
}

/**
 * Reset the repository (for testing)
 */
export function resetPromptRepository(): void {
  repositoryInstance = null;
}
