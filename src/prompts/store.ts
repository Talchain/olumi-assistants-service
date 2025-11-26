/**
 * Prompt Store
 *
 * File-based JSON storage for prompt definitions with versioning,
 * atomic writes, and backup support.
 */

import { readFile, writeFile, mkdir, access, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { constants as fsConstants } from 'fs';
import {
  type PromptDefinition,
  type CreatePromptRequest,
  type CreateVersionRequest,
  type UpdatePromptRequest,
  type RollbackRequest,
  type CompiledPrompt,
  PromptDefinitionSchema,
  computeContentHash,
  interpolatePrompt,
} from './schema.js';
import { log, emit } from '../utils/telemetry.js';
import { config } from '../config/index.js';

/**
 * Store configuration
 */
export interface PromptStoreConfig {
  /** Path to the prompts JSON file */
  filePath: string;
  /** Whether to create backups before writes */
  backupEnabled?: boolean;
  /** Maximum number of backups to keep */
  maxBackups?: number;
}

/**
 * Store data structure (persisted as JSON)
 */
interface StoreData {
  version: number;
  prompts: Record<string, PromptDefinition>;
  lastModified: string;
}

const DEFAULT_STORE_PATH = 'data/prompts.json';

/**
 * Telemetry events for prompt operations
 */
const PromptTelemetryEvents = {
  PromptCreated: 'prompt.created',
  PromptUpdated: 'prompt.updated',
  PromptVersionCreated: 'prompt.version_created',
  PromptRolledBack: 'prompt.rolled_back',
  PromptDeleted: 'prompt.deleted',
  PromptLoaded: 'prompt.loaded',
  PromptCompiled: 'prompt.compiled',
  PromptStoreError: 'prompt.store_error',
} as const;

/**
 * File-based prompt store with atomic writes and versioning
 */
export class PromptStore {
  private config: Required<PromptStoreConfig>;
  private data: StoreData | null = null;
  private writeInProgress = false;

  constructor(config?: Partial<PromptStoreConfig>) {
    this.config = {
      filePath: config?.filePath ?? DEFAULT_STORE_PATH,
      backupEnabled: config?.backupEnabled ?? true,
      maxBackups: config?.maxBackups ?? 10,
    };
  }

  /**
   * Initialize the store, creating the file if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.config.filePath);
      await mkdir(dir, { recursive: true });

      // Check if file exists
      try {
        await access(this.config.filePath, fsConstants.R_OK);
        // File exists, load it
        await this.load();
      } catch {
        // File doesn't exist, create empty store
        this.data = {
          version: 1,
          prompts: {},
          lastModified: new Date().toISOString(),
        };
        await this.save();
      }

      log.info({ path: this.config.filePath }, 'Prompt store initialized');
    } catch (error) {
      log.error({ error, path: this.config.filePath }, 'Failed to initialize prompt store');
      emit(PromptTelemetryEvents.PromptStoreError, {
        operation: 'initialize',
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Load store data from file
   */
  private async load(): Promise<void> {
    try {
      const content = await readFile(this.config.filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate all prompts
      const validatedPrompts: Record<string, PromptDefinition> = {};
      let hashMismatchCount = 0;

      for (const [id, prompt] of Object.entries(parsed.prompts ?? {})) {
        const result = PromptDefinitionSchema.safeParse(prompt);
        if (result.success) {
          // Verify content hashes for each version
          for (const version of result.data.versions) {
            if (version.contentHash) {
              const computedHash = computeContentHash(version.content);
              if (computedHash !== version.contentHash) {
                hashMismatchCount++;
                log.warn(
                  {
                    promptId: id,
                    version: version.version,
                    storedHash: version.contentHash.slice(0, 8) + '...',
                    computedHash: computedHash.slice(0, 8) + '...',
                  },
                  'Content hash mismatch detected - possible corruption or tampering'
                );
                emit(PromptTelemetryEvents.PromptStoreError, {
                  operation: 'hash_verification',
                  promptId: id,
                  version: version.version,
                  error: 'hash_mismatch',
                });
              }
            }
          }
          validatedPrompts[id] = result.data;
        } else {
          log.warn({ id, errors: result.error.flatten() }, 'Skipping invalid prompt in store');
        }
      }

      this.data = {
        version: parsed.version ?? 1,
        prompts: validatedPrompts,
        lastModified: parsed.lastModified ?? new Date().toISOString(),
      };

      emit(PromptTelemetryEvents.PromptLoaded, {
        promptCount: Object.keys(validatedPrompts).length,
        hashMismatchCount,
      });

      if (hashMismatchCount > 0) {
        log.warn(
          { hashMismatchCount },
          'Store loaded with hash mismatches - review audit logs for details'
        );
      }
    } catch (error) {
      log.error({ error, path: this.config.filePath }, 'Failed to load prompt store');
      emit(PromptTelemetryEvents.PromptStoreError, {
        operation: 'load',
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Save store data to file with atomic write
   */
  private async save(): Promise<void> {
    if (!this.data) {
      throw new Error('Store not initialized');
    }

    if (this.writeInProgress) {
      throw new Error('Write already in progress');
    }

    this.writeInProgress = true;

    try {
      // Create backup if enabled
      if (this.config.backupEnabled) {
        await this.createBackup();
      }

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.config.filePath}.tmp`;
      this.data.lastModified = new Date().toISOString();

      await writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');

      // Rename temp to actual (atomic on most filesystems)
      const { rename } = await import('fs/promises');
      await rename(tempPath, this.config.filePath);
    } finally {
      this.writeInProgress = false;
    }
  }

  /**
   * Create a backup of the current store file
   */
  private async createBackup(): Promise<void> {
    try {
      await access(this.config.filePath, fsConstants.R_OK);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.config.filePath}.backup.${timestamp}`;

      await copyFile(this.config.filePath, backupPath);

      // Cleanup old backups
      await this.cleanupOldBackups();
    } catch {
      // File doesn't exist yet, no backup needed
    }
  }

  /**
   * Remove old backup files beyond maxBackups limit
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const { readdir, unlink } = await import('fs/promises');
      const dir = dirname(this.config.filePath);
      const basename = this.config.filePath.split('/').pop() ?? 'prompts.json';

      const files = await readdir(dir);
      const backups = files
        .filter(f => f.startsWith(`${basename}.backup.`))
        .sort()
        .reverse();

      // Remove backups beyond the limit
      for (const backup of backups.slice(this.config.maxBackups)) {
        await unlink(join(dir, backup));
      }
    } catch (error) {
      log.warn({ error }, 'Failed to cleanup old backups');
    }
  }

  /**
   * Ensure store is initialized
   */
  private ensureInitialized(): StoreData {
    if (!this.data) {
      throw new Error('Store not initialized. Call initialize() first.');
    }
    return this.data;
  }

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  /**
   * Create a new prompt
   */
  async create(request: CreatePromptRequest): Promise<PromptDefinition> {
    const data = this.ensureInitialized();

    if (data.prompts[request.id]) {
      throw new Error(`Prompt with ID '${request.id}' already exists`);
    }

    const now = new Date().toISOString();
    const contentHash = computeContentHash(request.content);

    const prompt: PromptDefinition = {
      id: request.id,
      name: request.name,
      description: request.description,
      taskId: request.taskId,
      status: 'draft',
      versions: [
        {
          version: 1,
          content: request.content,
          variables: request.variables,
          createdBy: request.createdBy,
          createdAt: now,
          changeNote: request.changeNote,
          contentHash,
        },
      ],
      activeVersion: 1,
      tags: request.tags,
      createdAt: now,
      updatedAt: now,
    };

    // Validate
    const validated = PromptDefinitionSchema.parse(prompt);
    data.prompts[request.id] = validated;

    await this.save();

    emit(PromptTelemetryEvents.PromptCreated, {
      promptId: request.id,
      taskId: request.taskId,
      createdBy: request.createdBy,
    });

    log.info({ promptId: request.id, taskId: request.taskId }, 'Prompt created');

    return validated;
  }

  /**
   * Get a prompt by ID
   */
  async get(id: string): Promise<PromptDefinition | null> {
    const data = this.ensureInitialized();
    return data.prompts[id] ?? null;
  }

  /**
   * Get all prompts, optionally filtered
   */
  async list(filter?: {
    taskId?: string;
    status?: string;
    tags?: string[];
  }): Promise<PromptDefinition[]> {
    const data = this.ensureInitialized();
    let prompts = Object.values(data.prompts);

    if (filter?.taskId) {
      prompts = prompts.filter(p => p.taskId === filter.taskId);
    }

    if (filter?.status) {
      prompts = prompts.filter(p => p.status === filter.status);
    }

    if (filter?.tags?.length) {
      prompts = prompts.filter(p =>
        filter.tags!.some(tag => p.tags.includes(tag))
      );
    }

    return prompts.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Update prompt metadata (not content - use createVersion for that)
   */
  async update(id: string, request: UpdatePromptRequest): Promise<PromptDefinition> {
    const data = this.ensureInitialized();
    const prompt = data.prompts[id];

    if (!prompt) {
      throw new Error(`Prompt '${id}' not found`);
    }

    // Validate version numbers if provided
    if (request.activeVersion !== undefined) {
      const versionExists = prompt.versions.some(v => v.version === request.activeVersion);
      if (!versionExists) {
        throw new Error(`Version ${request.activeVersion} does not exist`);
      }
    }

    if (request.stagingVersion !== undefined && request.stagingVersion !== null) {
      const versionExists = prompt.versions.some(v => v.version === request.stagingVersion);
      if (!versionExists) {
        throw new Error(`Version ${request.stagingVersion} does not exist`);
      }
    }

    // Enforce single production prompt per task
    const newStatus = request.status ?? prompt.status;
    if (newStatus === 'production') {
      const existingProduction = Object.values(data.prompts).find(
        p => p.id !== id && p.taskId === prompt.taskId && p.status === 'production'
      );
      if (existingProduction) {
        throw new Error(
          `Cannot set prompt '${id}' to production: task '${prompt.taskId}' already has a production prompt ('${existingProduction.id}'). ` +
          `Archive or demote the existing production prompt first.`
        );
      }
    }

    // Apply updates
    const updated: PromptDefinition = {
      ...prompt,
      name: request.name ?? prompt.name,
      description: request.description ?? prompt.description,
      status: request.status ?? prompt.status,
      activeVersion: request.activeVersion ?? prompt.activeVersion,
      stagingVersion: request.stagingVersion === null ? undefined : (request.stagingVersion ?? prompt.stagingVersion),
      tags: request.tags ?? prompt.tags,
      updatedAt: new Date().toISOString(),
    };

    const validated = PromptDefinitionSchema.parse(updated);
    data.prompts[id] = validated;

    await this.save();

    emit(PromptTelemetryEvents.PromptUpdated, {
      promptId: id,
      changes: Object.keys(request).filter(k => request[k as keyof UpdatePromptRequest] !== undefined),
    });

    log.info({ promptId: id }, 'Prompt updated');

    return validated;
  }

  /**
   * Create a new version of an existing prompt (immutable, append-only)
   */
  async createVersion(id: string, request: CreateVersionRequest): Promise<PromptDefinition> {
    const data = this.ensureInitialized();
    const prompt = data.prompts[id];

    if (!prompt) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const maxVersion = Math.max(...prompt.versions.map(v => v.version));
    const newVersion = maxVersion + 1;
    const now = new Date().toISOString();
    const contentHash = computeContentHash(request.content);

    const version = {
      version: newVersion,
      content: request.content,
      variables: request.variables,
      createdBy: request.createdBy,
      createdAt: now,
      changeNote: request.changeNote,
      contentHash,
    };

    const updated: PromptDefinition = {
      ...prompt,
      versions: [...prompt.versions, version],
      updatedAt: now,
    };

    const validated = PromptDefinitionSchema.parse(updated);
    data.prompts[id] = validated;

    await this.save();

    emit(PromptTelemetryEvents.PromptVersionCreated, {
      promptId: id,
      version: newVersion,
      createdBy: request.createdBy,
    });

    log.info({ promptId: id, version: newVersion }, 'Prompt version created');

    return validated;
  }

  /**
   * Rollback to a previous version (creates audit trail)
   */
  async rollback(id: string, request: RollbackRequest): Promise<PromptDefinition> {
    const data = this.ensureInitialized();
    const prompt = data.prompts[id];

    if (!prompt) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const targetVersion = prompt.versions.find(v => v.version === request.targetVersion);
    if (!targetVersion) {
      throw new Error(`Version ${request.targetVersion} not found`);
    }

    const previousActive = prompt.activeVersion;

    const updated: PromptDefinition = {
      ...prompt,
      activeVersion: request.targetVersion,
      updatedAt: new Date().toISOString(),
    };

    const validated = PromptDefinitionSchema.parse(updated);
    data.prompts[id] = validated;

    await this.save();

    emit(PromptTelemetryEvents.PromptRolledBack, {
      promptId: id,
      fromVersion: previousActive,
      toVersion: request.targetVersion,
      rolledBackBy: request.rolledBackBy,
      reason: request.reason,
    });

    log.info(
      {
        promptId: id,
        fromVersion: previousActive,
        toVersion: request.targetVersion,
        reason: request.reason,
      },
      'Prompt rolled back'
    );

    return validated;
  }

  /**
   * Delete a prompt (soft delete by archiving, or hard delete)
   */
  async delete(id: string, hard = false): Promise<void> {
    const data = this.ensureInitialized();
    const prompt = data.prompts[id];

    if (!prompt) {
      throw new Error(`Prompt '${id}' not found`);
    }

    if (hard) {
      delete data.prompts[id];
    } else {
      // Soft delete - archive
      data.prompts[id] = {
        ...prompt,
        status: 'archived',
        updatedAt: new Date().toISOString(),
      };
    }

    await this.save();

    emit(PromptTelemetryEvents.PromptDeleted, {
      promptId: id,
      hard,
    });

    log.info({ promptId: id, hard }, 'Prompt deleted');
  }

  // =========================================================================
  // Prompt Resolution
  // =========================================================================

  /**
   * Get compiled prompt content for a task with variables interpolated
   */
  async getCompiled(
    taskId: string,
    variables: Record<string, string | number>,
    options?: {
      version?: number;
      useStaging?: boolean;
    }
  ): Promise<CompiledPrompt | null> {
    const data = this.ensureInitialized();

    // Find production prompt for this task
    const prompt = Object.values(data.prompts).find(
      p => p.taskId === taskId && p.status === 'production'
    );

    if (!prompt) {
      return null;
    }

    // Determine which version to use
    let versionNum: number;
    if (options?.version !== undefined) {
      versionNum = options.version;
    } else if (options?.useStaging && prompt.stagingVersion) {
      versionNum = prompt.stagingVersion;
    } else {
      versionNum = prompt.activeVersion;
    }

    const version = prompt.versions.find(v => v.version === versionNum);
    if (!version) {
      throw new Error(`Version ${versionNum} not found for prompt '${prompt.id}'`);
    }

    // Interpolate variables
    const content = interpolatePrompt(version.content, variables, version.variables);

    const compiled: CompiledPrompt = {
      promptId: prompt.id,
      version: version.version,
      content,
      compiledAt: new Date().toISOString(),
      variables,
    };

    emit(PromptTelemetryEvents.PromptCompiled, {
      promptId: prompt.id,
      taskId,
      version: version.version,
    });

    return compiled;
  }

  /**
   * Get the active prompt for a task (for A/B testing assignment)
   */
  async getActivePromptForTask(taskId: string): Promise<{
    prompt: PromptDefinition;
    version: number;
  } | null> {
    const data = this.ensureInitialized();

    const prompt = Object.values(data.prompts).find(
      p => p.taskId === taskId && p.status === 'production'
    );

    if (!prompt) {
      return null;
    }

    return {
      prompt,
      version: prompt.activeVersion,
    };
  }
}

// =========================================================================
// Singleton instance for convenience
// =========================================================================

let defaultStore: PromptStore | null = null;
let storeInitialized = false;
let storeHealthy = false;

/**
 * Get the default prompt store instance
 * Uses config values for store configuration
 */
export function getPromptStore(overrideConfig?: Partial<PromptStoreConfig>): PromptStore {
  if (!defaultStore) {
    // Use config values with optional overrides
    const storeConfig: PromptStoreConfig = {
      filePath: overrideConfig?.filePath ?? config.prompts?.storePath ?? DEFAULT_STORE_PATH,
      backupEnabled: overrideConfig?.backupEnabled ?? config.prompts?.backupEnabled ?? true,
      maxBackups: overrideConfig?.maxBackups ?? config.prompts?.maxBackups ?? 10,
    };
    defaultStore = new PromptStore(storeConfig);
  }
  return defaultStore;
}

/**
 * Initialize the prompt store
 * Should be called during server startup when prompt management is enabled
 */
export async function initializePromptStore(): Promise<void> {
  if (storeInitialized) {
    return;
  }

  // Only initialize if prompt management is enabled
  if (!config.prompts?.enabled) {
    log.debug('Prompt management disabled, skipping store initialization');
    storeInitialized = true;
    storeHealthy = false; // Not applicable when disabled
    return;
  }

  try {
    const store = getPromptStore();
    await store.initialize();
    storeInitialized = true;
    storeHealthy = true;
    log.info('Prompt store initialized successfully');
  } catch (error) {
    log.error({ error }, 'Failed to initialize prompt store');
    // Don't throw - allow server to start without prompt management
    storeInitialized = true;
    storeHealthy = false;
    emit(PromptTelemetryEvents.PromptStoreError, {
      operation: 'startup_init',
      error: String(error),
    });
  }
}

/**
 * Check if the prompt store has been initialized
 */
export function isPromptStoreInitialized(): boolean {
  return storeInitialized;
}

/**
 * Check if the prompt store is healthy (initialized successfully)
 */
export function isPromptStoreHealthy(): boolean {
  return storeHealthy;
}

/**
 * Get prompt store status for diagnostics
 */
export function getPromptStoreStatus(): {
  initialized: boolean;
  healthy: boolean;
  enabled: boolean;
  storePath: string;
} {
  return {
    initialized: storeInitialized,
    healthy: storeHealthy,
    enabled: config.prompts?.enabled ?? false,
    storePath: config.prompts?.storePath ?? DEFAULT_STORE_PATH,
  };
}

/**
 * Reset the default store (for testing)
 */
export function resetPromptStore(): void {
  defaultStore = null;
  storeInitialized = false;
  storeHealthy = false;
}
