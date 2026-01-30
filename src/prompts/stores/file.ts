/**
 * File-based Prompt Store
 *
 * JSON file storage for prompt definitions with versioning,
 * atomic writes, and backup support.
 */

import { readFile, writeFile, mkdir, access, copyFile, readdir, unlink, rename } from 'fs/promises';
import { dirname, join } from 'path';
import { constants as fsConstants } from 'fs';
import type {
  IPromptStore,
  PromptListFilter,
  GetCompiledOptions,
  ActivePromptResult,
  FileStoreConfig,
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
import {
  PromptDefinitionSchema,
  computeContentHash,
  interpolatePrompt,
} from '../schema.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';

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
 * File-based prompt store with atomic writes and versioning
 */
export class FilePromptStore implements IPromptStore {
  private config: Required<Omit<FileStoreConfig, 'type'>>;
  private data: StoreData | null = null;
  private writeInProgress = false;

  constructor(config?: Partial<Omit<FileStoreConfig, 'type'>>) {
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

      log.info({ path: this.config.filePath }, 'File prompt store initialized');
    } catch (error) {
      log.error({ error, path: this.config.filePath }, 'Failed to initialize file prompt store');
      emit(TelemetryEvents.PromptStoreError, {
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
                emit(TelemetryEvents.PromptHashMismatch, {
                  promptId: id,
                  version: version.version,
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

      if (hashMismatchCount > 0) {
        log.warn(
          { hashMismatchCount },
          'Store loaded with hash mismatches - review audit logs for details'
        );
      }
    } catch (error) {
      log.error({ error, path: this.config.filePath }, 'Failed to load file prompt store');
      emit(TelemetryEvents.PromptStoreError, {
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
  // IPromptStore Implementation
  // =========================================================================

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
          requiresApproval: false,
          testCases: [],
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

    log.info({ promptId: request.id, taskId: request.taskId }, 'Prompt created');

    return validated;
  }

  async get(id: string): Promise<PromptDefinition | null> {
    const data = this.ensureInitialized();
    return data.prompts[id] ?? null;
  }

  async list(filter?: PromptListFilter): Promise<PromptDefinition[]> {
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

    log.info({ promptId: id }, 'Prompt updated');

    return validated;
  }

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
      requiresApproval: request.requiresApproval ?? false,
      testCases: [],
    };

    const updated: PromptDefinition = {
      ...prompt,
      versions: [...prompt.versions, version],
      updatedAt: now,
    };

    const validated = PromptDefinitionSchema.parse(updated);
    data.prompts[id] = validated;

    await this.save();

    log.info({ promptId: id, version: newVersion }, 'Prompt version created');

    return validated;
  }

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

  async approveVersion(id: string, request: ApprovalRequest): Promise<PromptDefinition> {
    const data = this.ensureInitialized();
    const prompt = data.prompts[id];

    if (!prompt) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const versionIndex = prompt.versions.findIndex(v => v.version === request.version);
    if (versionIndex === -1) {
      throw new Error(`Version ${request.version} not found for prompt '${id}'`);
    }

    const version = prompt.versions[versionIndex];

    if (!version.requiresApproval) {
      throw new Error(`Version ${request.version} does not require approval`);
    }

    if (version.approvedBy) {
      throw new Error(`Version ${request.version} was already approved by ${version.approvedBy}`);
    }

    const now = new Date().toISOString();

    // Update the version with approval info
    const updatedVersions = [...prompt.versions];
    updatedVersions[versionIndex] = {
      ...version,
      approvedBy: request.approvedBy,
      approvedAt: now,
    };

    const updated: PromptDefinition = {
      ...prompt,
      versions: updatedVersions,
      updatedAt: now,
    };

    const validated = PromptDefinitionSchema.parse(updated);
    data.prompts[id] = validated;

    await this.save();

    log.info(
      {
        promptId: id,
        version: request.version,
        approvedBy: request.approvedBy,
      },
      'Prompt version approved'
    );

    return validated;
  }

  async updateTestCases(id: string, version: number, testCases: PromptTestCase[]): Promise<PromptDefinition> {
    const data = this.ensureInitialized();
    const prompt = data.prompts[id];

    if (!prompt) {
      throw new Error(`Prompt '${id}' not found`);
    }

    const versionIndex = prompt.versions.findIndex(v => v.version === version);
    if (versionIndex === -1) {
      throw new Error(`Version ${version} not found for prompt '${id}'`);
    }

    const now = new Date().toISOString();

    // Update the version with new test cases
    const updatedVersions = [...prompt.versions];
    updatedVersions[versionIndex] = {
      ...updatedVersions[versionIndex],
      testCases,
    };

    const updated: PromptDefinition = {
      ...prompt,
      versions: updatedVersions,
      updatedAt: now,
    };

    const validated = PromptDefinitionSchema.parse(updated);
    data.prompts[id] = validated;

    await this.save();

    log.info(
      {
        promptId: id,
        version,
        testCaseCount: testCases.length,
      },
      'Prompt version test cases updated'
    );

    return validated;
  }

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

    log.info({ promptId: id, hard }, 'Prompt deleted');
  }

  async getCompiled(
    taskId: string,
    variables: Record<string, string | number>,
    options?: GetCompiledOptions
  ): Promise<CompiledPrompt | null> {
    const data = this.ensureInitialized();

    // Find prompt for this task (exclude archived, allow draft/staging/production)
    // Version selection is controlled by stagingVersion vs activeVersion, not prompt status
    const prompt = Object.values(data.prompts).find(
      p => p.taskId === taskId && p.status !== 'archived'
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
      modelConfig: prompt.modelConfig,
    };

    emit(TelemetryEvents.PromptCompiled, {
      promptId: prompt.id,
      taskId,
      version: version.version,
    });

    return compiled;
  }

  async getActivePromptForTask(taskId: string): Promise<ActivePromptResult | null> {
    const data = this.ensureInitialized();

    // Find prompt for this task (exclude archived, allow draft/staging/production)
    const prompt = Object.values(data.prompts).find(
      p => p.taskId === taskId && p.status !== 'archived'
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
