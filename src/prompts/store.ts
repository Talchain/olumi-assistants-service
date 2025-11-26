/**
 * Prompt Store
 *
 * Main entry point for prompt storage.
 * Supports pluggable backends (file, Postgres) via configuration.
 *
 * For backward compatibility, exports the file-based store as the default.
 */

import { FilePromptStore } from './stores/file.js';
import type { IPromptStore, FileStoreConfig } from './stores/interface.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';
import { config } from '../config/index.js';

// Re-export types and interfaces for backward compatibility
export { FilePromptStore } from './stores/file.js';
export type { IPromptStore, PromptListFilter, GetCompiledOptions, ActivePromptResult } from './stores/interface.js';

/**
 * @deprecated Use FileStoreConfig from './stores/interface.js'
 * Kept for backward compatibility
 */
export type PromptStoreConfig = Omit<FileStoreConfig, 'type'>;

/**
 * @deprecated Use FilePromptStore directly
 * Alias for backward compatibility
 */
export const PromptStore = FilePromptStore;

const DEFAULT_STORE_PATH = 'data/prompts.json';

// =========================================================================
// Singleton instance and health tracking
// =========================================================================

let defaultStore: IPromptStore | null = null;
let storeInitialized = false;
let storeHealthy = false;

/**
 * Get the default prompt store instance
 * Currently always returns FilePromptStore.
 * Future: will select implementation based on config.prompts.storeType
 *
 * @param overrideConfig - Optional configuration overrides
 */
export function getPromptStore(overrideConfig?: Partial<PromptStoreConfig>): IPromptStore {
  if (!defaultStore) {
    // Future: check config.prompts.storeType to select implementation
    // For now, always use FilePromptStore
    const storeConfig = {
      filePath: overrideConfig?.filePath ?? config.prompts?.storePath ?? DEFAULT_STORE_PATH,
      backupEnabled: overrideConfig?.backupEnabled ?? config.prompts?.backupEnabled ?? true,
      maxBackups: overrideConfig?.maxBackups ?? config.prompts?.maxBackups ?? 10,
    };
    defaultStore = new FilePromptStore(storeConfig);
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
    emit(TelemetryEvents.PromptStoreError, {
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
  storeType: string;
} {
  return {
    initialized: storeInitialized,
    healthy: storeHealthy,
    enabled: config.prompts?.enabled ?? false,
    storePath: config.prompts?.storePath ?? DEFAULT_STORE_PATH,
    storeType: 'file', // Future: read from config
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
