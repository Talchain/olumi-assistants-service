/**
 * Prompt Store
 *
 * Main entry point for prompt storage.
 * Supports pluggable backends (file, Postgres) via configuration.
 *
 * For backward compatibility, exports the file-based store as the default.
 */

import { FilePromptStore } from './stores/file.js';
import { PostgresPromptStore } from './stores/postgres.js';
import { SupabasePromptStore } from './stores/supabase.js';
import type { IPromptStore, FileStoreConfig, PostgresStoreConfig, SupabaseStoreConfig } from './stores/interface.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';
import { config } from '../config/index.js';

// Re-export types and interfaces for backward compatibility
export { FilePromptStore } from './stores/file.js';
export { PostgresPromptStore } from './stores/postgres.js';
export { SupabasePromptStore } from './stores/supabase.js';
export type { IPromptStore, PromptListFilter, GetCompiledOptions, ActivePromptResult } from './stores/interface.js';

/**
 * @deprecated Use FileStoreConfig from './stores/interface.js'
 * Kept for backward compatibility
 */
export type PromptStoreConfig = Omit<FileStoreConfig, 'type'> | Omit<PostgresStoreConfig, 'type'>;

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
 * Selects implementation based on config.prompts.storeType:
 * - 'file' (default): FilePromptStore with JSON file backend
 * - 'postgres': PostgresPromptStore with database backend
 *
 * @param overrideConfig - Optional configuration overrides (for testing)
 */
export function getPromptStore(overrideConfig?: Partial<PromptStoreConfig>): IPromptStore {
  if (!defaultStore) {
    const storeType = config.prompts?.storeType ?? 'file';

    if (storeType === 'supabase') {
      const url = config.prompts?.supabaseUrl;
      const serviceRoleKey = config.prompts?.supabaseServiceRoleKey;
      if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when PROMPTS_STORE_TYPE=supabase');
      }
      defaultStore = new SupabasePromptStore({
        url,
        serviceRoleKey,
      });
      log.info({ storeType: 'supabase' }, 'Using Supabase prompt store');
    } else if (storeType === 'postgres') {
      const connectionString = config.prompts?.postgresUrl;
      if (!connectionString) {
        throw new Error('PROMPTS_POSTGRES_URL is required when PROMPTS_STORE_TYPE=postgres');
      }
      defaultStore = new PostgresPromptStore({
        connectionString,
        poolSize: config.prompts?.postgresPoolSize ?? 10,
        ssl: config.prompts?.postgresSsl ?? false,
      });
      log.info({ storeType: 'postgres' }, 'Using PostgreSQL prompt store');
    } else {
      // Default to file store
      const storeConfig = {
        filePath: (overrideConfig as Partial<Omit<FileStoreConfig, 'type'>>)?.filePath ?? config.prompts?.storePath ?? DEFAULT_STORE_PATH,
        backupEnabled: (overrideConfig as Partial<Omit<FileStoreConfig, 'type'>>)?.backupEnabled ?? config.prompts?.backupEnabled ?? true,
        maxBackups: (overrideConfig as Partial<Omit<FileStoreConfig, 'type'>>)?.maxBackups ?? config.prompts?.maxBackups ?? 10,
      };
      defaultStore = new FilePromptStore(storeConfig);
      log.info({ storeType: 'file', path: storeConfig.filePath }, 'Using file-based prompt store');
    }
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

  // Only initialize if prompt management or admin access is enabled
  if (!config.prompts?.enabled && !config.prompts?.adminApiKey) {
    log.debug('Prompt management disabled and no admin API key, skipping store initialization');
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
  storeType: string;
  storePath?: string;
  postgresConnected?: boolean;
  supabaseHost?: string;
} {
  const storeType = config.prompts?.storeType ?? 'file';
  const status: ReturnType<typeof getPromptStoreStatus> = {
    initialized: storeInitialized,
    healthy: storeHealthy,
    enabled: config.prompts?.enabled ?? false,
    storeType,
  };

  if (storeType === 'file') {
    status.storePath = config.prompts?.storePath ?? DEFAULT_STORE_PATH;
  } else if (storeType === 'postgres') {
    status.postgresConnected = storeHealthy;
  } else if (storeType === 'supabase') {
    const url = config.prompts?.supabaseUrl;
    if (url) {
      try {
        status.supabaseHost = new URL(url).host;
      } catch {
        // ignore
      }
    }
  }

  return status;
}

/**
 * Reset the default store (for testing)
 */
export function resetPromptStore(): void {
  defaultStore = null;
  storeInitialized = false;
  storeHealthy = false;
}
