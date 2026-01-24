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
/** Tracks the actual store type used (after auto-detection) - set when store is created */
let actualStoreType: 'file' | 'postgres' | 'supabase' | null = null;

/**
 * Check if a database-backed store is configured via environment variables.
 * Returns true ONLY if database credentials are present (Supabase or Postgres).
 * File store returns false - it should use defaults unless explicitly enabled.
 *
 * Also detects credential/storeType mismatches and logs warnings.
 */
export function isStoreBackendConfigured(): boolean {
  const storeType = config.prompts?.storeType ?? 'file';
  const hasSupabaseCreds = Boolean(config.prompts?.supabaseUrl && config.prompts?.supabaseServiceRoleKey);
  const hasPostgresCreds = Boolean(config.prompts?.postgresUrl);

  // Detect misconfigurations: credentials present but storeType doesn't match
  if (storeType === 'file') {
    if (hasSupabaseCreds) {
      log.warn({
        event: 'prompt.store.config_mismatch',
        storeType,
        hasSupabaseCreds: true,
      }, 'Supabase credentials found but PROMPTS_STORE_TYPE is not "supabase". Set PROMPTS_STORE_TYPE=supabase to use database store.');
      // Still return true since credentials ARE configured
      return true;
    }
    if (hasPostgresCreds) {
      log.warn({
        event: 'prompt.store.config_mismatch',
        storeType,
        hasPostgresCreds: true,
      }, 'Postgres credentials found but PROMPTS_STORE_TYPE is not "postgres". Set PROMPTS_STORE_TYPE=postgres to use database store.');
      // Still return true since credentials ARE configured
      return true;
    }
    // File store with no DB credentials - not a "configured" database backend
    return false;
  }

  if (storeType === 'supabase') {
    return hasSupabaseCreds;
  }

  if (storeType === 'postgres') {
    return hasPostgresCreds;
  }

  return false;
}

/**
 * Get the default prompt store instance
 * Selects implementation based on config.prompts.storeType:
 * - 'file' (default): FilePromptStore with JSON file backend
 * - 'postgres': PostgresPromptStore with database backend
 * - 'supabase': SupabasePromptStore with Supabase backend
 *
 * Auto-detection: When storeType is 'file' (default) but database credentials
 * are present, automatically selects the appropriate database store.
 *
 * @param overrideConfig - Optional configuration overrides (for testing)
 */
export function getPromptStore(overrideConfig?: Partial<PromptStoreConfig>): IPromptStore {
  if (!defaultStore) {
    let storeType = config.prompts?.storeType ?? 'file';

    // Auto-detect store type from credentials if using default 'file'
    if (storeType === 'file') {
      const hasSupabaseCreds = Boolean(config.prompts?.supabaseUrl && config.prompts?.supabaseServiceRoleKey);
      const hasPostgresCreds = Boolean(config.prompts?.postgresUrl);

      if (hasSupabaseCreds) {
        log.info({
          event: 'prompt.store.type_inferred',
          inferred: 'supabase',
          reason: 'credentials_detected',
        }, 'Auto-selecting Supabase store - credentials detected but PROMPTS_STORE_TYPE not set');
        storeType = 'supabase';
      } else if (hasPostgresCreds) {
        log.info({
          event: 'prompt.store.type_inferred',
          inferred: 'postgres',
          reason: 'credentials_detected',
        }, 'Auto-selecting Postgres store - credentials detected but PROMPTS_STORE_TYPE not set');
        storeType = 'postgres';
      }
    }

    // Track the actual store type used (after auto-detection)
    actualStoreType = storeType as 'file' | 'postgres' | 'supabase';

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
      log.info({ storeType: 'supabase', actualStoreType }, 'Using Supabase prompt store');
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
      log.info({ storeType: 'postgres', actualStoreType }, 'Using PostgreSQL prompt store');
    } else {
      // Default to file store
      const storeConfig = {
        filePath: (overrideConfig as Partial<Omit<FileStoreConfig, 'type'>>)?.filePath ?? config.prompts?.storePath ?? DEFAULT_STORE_PATH,
        backupEnabled: (overrideConfig as Partial<Omit<FileStoreConfig, 'type'>>)?.backupEnabled ?? config.prompts?.backupEnabled ?? true,
        maxBackups: (overrideConfig as Partial<Omit<FileStoreConfig, 'type'>>)?.maxBackups ?? config.prompts?.maxBackups ?? 10,
      };
      defaultStore = new FilePromptStore(storeConfig);
      log.info({ storeType: 'file', actualStoreType, path: storeConfig.filePath }, 'Using file-based prompt store');
    }
  }
  return defaultStore;
}

/**
 * Initialize the prompt store
 * Should be called during server startup when prompt management is enabled
 * or when a database-backed store is configured (Supabase/Postgres).
 */
export async function initializePromptStore(): Promise<void> {
  if (storeInitialized) {
    return;
  }

  const storeType = config.prompts?.storeType ?? 'file';
  // Use isStoreBackendConfigured() which handles auto-detection of credentials
  // even when storeType is 'file' (the default). This ensures we initialize
  // if Supabase/Postgres credentials are present, regardless of PROMPTS_STORE_TYPE.
  const hasDbCredentials = isStoreBackendConfigured();

  // Skip initialization only if:
  // 1. Prompt management is disabled AND
  // 2. No admin API key AND
  // 3. No database credentials configured
  if (!config.prompts?.enabled && !config.prompts?.adminApiKey && !hasDbCredentials) {
    log.debug({
      event: 'prompt.store.disabled',
      reason: 'no_credentials_or_flags',
      storeType,
    }, 'Prompt store disabled - no credentials configured and PROMPTS_ENABLED=false');
    storeInitialized = true;
    storeHealthy = false;
    return;
  }

  try {
    const store = getPromptStore();
    await store.initialize();
    storeInitialized = true;
    storeHealthy = true;
    log.info({
      event: 'prompt.store.initialized',
      storeType,
      enabled: config.prompts?.enabled ?? false,
    }, 'Prompt store initialized successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn({
      event: 'prompt.store.init_failed',
      storeType,
      error: errorMessage,
    }, 'Failed to initialize prompt store - using defaults');
    // Don't throw - allow server to start without prompt management
    storeInitialized = true;
    storeHealthy = false;
    emit(TelemetryEvents.PromptStoreError, {
      operation: 'startup_init',
      storeType,
      error: errorMessage,
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
 * Check if a database-backed store is healthy.
 * Returns true only when store is healthy AND using Supabase or Postgres.
 * File store returns false even if healthy - use isPromptStoreHealthy() for that.
 *
 * IMPORTANT: Uses actualStoreType (set when store is created) rather than config,
 * because getPromptStore() may auto-detect the store type from credentials.
 */
export function isDbBackedStoreHealthy(): boolean {
  if (!storeHealthy) {
    return false;
  }
  // Use actual store type (determined at creation time with auto-detection),
  // not config value which may differ from what's actually being used
  return actualStoreType === 'supabase' || actualStoreType === 'postgres';
}

/**
 * Get prompt store status for diagnostics
 */
export function getPromptStoreStatus(): {
  initialized: boolean;
  healthy: boolean;
  enabled: boolean;
  storeType: string;
  /** Actual store type used after auto-detection (may differ from storeType config) */
  actualStoreType?: string;
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
    actualStoreType: actualStoreType ?? undefined,
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
  actualStoreType = null;
}
