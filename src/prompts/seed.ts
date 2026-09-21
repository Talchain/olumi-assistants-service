/**
 * Prompt Seeding
 *
 * Seeds default prompts to the database on server startup.
 * Non-destructive: will not overwrite existing production prompts.
 *
 * Seeding order:
 * 1. Register in-memory defaults (for fallback)
 * 2. Initialize prompt repository
 * 3. Seed defaults to database (non-destructive)
 * 4. Warm cache
 */

import { registerAllDefaultPrompts } from './defaults.js';
import {
  getPromptRepository,
  initializePromptRepository,
} from './repository.js';
import { computeContentHash } from './schema.js';
import { getDefaultPrompts } from './loader.js';
import { shouldUseStagingPrompts } from '../config/index.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';
import { config } from '../config/index.js';

/**
 * Result of prompt seeding
 */
export interface SeedResult {
  success: boolean;
  seeded: number;
  skipped: number;
  error?: string;
}

/**
 * Initialize prompts system and seed defaults
 *
 * This should be called once during server startup.
 *
 * @param force - If true, will reseed even if content hasn't changed
 * @returns Seeding result
 */
export async function initializeAndSeedPrompts(force = false): Promise<SeedResult> {
  // Step 1: Register in-memory defaults (for fallback)
  registerAllDefaultPrompts();
  log.debug({
    event: 'prompt.seed.defaults_registered',
  }, 'In-memory defaults registered');

  // Check if prompt management is enabled
  if (!config.prompts?.enabled) {
    log.info({
      event: 'prompt.seed.disabled',
    }, 'Prompt management disabled, skipping database seeding');
    return {
      success: true,
      seeded: 0,
      skipped: 0,
    };
  }

  try {
    // Step 2: Initialize repository
    await initializePromptRepository();

    // Step 3: Seed defaults to database (non-destructive)
    const repo = getPromptRepository();
    const health = repo.getHealth();

    if (!health.dbHealthy) {
      log.warn({
        event: 'prompt.seed.db_unhealthy',
        fallback_active: health.fallbackActive,
        error: health.lastDbError,
      }, 'Database unhealthy, skipping seeding');
      return {
        success: true, // Not a failure, just skipped
        seeded: 0,
        skipped: 0,
        error: 'Database unavailable - using fallback',
      };
    }

    const result = await repo.seedDefaults(force);

    // Step 3b: Ensure orchestrator staging version matches registered default
    // Gated behind CEE_PROMPT_AUTO_MIGRATE (default: false) to prevent phantom
    // version creation on every startup when admin-uploaded content differs from
    // the registered default in defaults.ts.
    if (shouldUseStagingPrompts() && config.prompts?.autoMigrateEnabled) {
      await ensureOrchestratorStagingVersion(repo);
    }

    // Step 4: Warm cache
    await repo.warmCache();

    log.info({
      event: 'prompt.seed.complete',
      seeded: result.seeded,
      skipped: result.skipped,
    }, 'Prompt seeding complete');

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    const errorMessage = String(error);
    log.error({
      event: 'prompt.seed.error',
      error: errorMessage,
    }, 'Prompt seeding failed');

    return {
      success: false,
      seeded: 0,
      skipped: 0,
      error: errorMessage,
    };
  }
}

/**
 * Check if prompts are properly seeded
 *
 * Verifies that:
 * 1. In-memory defaults are registered
 * 2. Database has production prompts for all tasks
 *
 * @returns Status check result
 */
export async function checkSeedStatus(): Promise<{
  defaultsRegistered: boolean;
  databaseSeeded: boolean;
  missingTasks: string[];
}> {
  const { getDefaultPrompts } = await import('./loader.js');
  const defaults = getDefaultPrompts();
  const defaultsRegistered = Object.keys(defaults).length > 0;

  const expectedTasks = [
    'draft_graph',
    'suggest_options',
    'repair_graph',
    'clarify_brief',
    'critique_graph',
    'explainer',
    'bias_check',
  ];

  let databaseSeeded = false;
  const missingTasks: string[] = [];

  try {
    const repo = getPromptRepository();
    const health = repo.getHealth();

    if (health.dbHealthy) {
      for (const taskId of expectedTasks) {
        const prompt = await repo.getActivePrompt(taskId as any);
        if (!prompt || prompt.source !== 'database') {
          missingTasks.push(taskId);
        }
      }
      databaseSeeded = missingTasks.length === 0;
    }
  } catch {
    // Database not available
    missingTasks.push(...expectedTasks);
  }

  return {
    defaultsRegistered,
    databaseSeeded,
    missingTasks,
  };
}

// ============================================================================
// Orchestrator staging version migration
// ============================================================================

/**
 * Ensure the orchestrator prompt in the store has a version whose
 * content matches the registered default (cf-v28).
 *
 * Scans ALL existing versions for a hash match before creating a new one,
 * preventing duplicate writes when a previous migration was blocked by
 * the activation guard.
 *
 * Only called when CEE_PROMPT_AUTO_MIGRATE=true (see caller gate).
 * Non-destructive: never modifies the active (production) version.
 */
async function ensureOrchestratorStagingVersion(
  repo: ReturnType<typeof getPromptRepository>,
): Promise<void> {
  const PROMPT_ID = 'orchestrator_default';

  try {
    const defaults = getDefaultPrompts();
    const defaultContent = defaults.orchestrator;
    if (!defaultContent) return;

    const defaultHash = computeContentHash(defaultContent);

    // Get the existing prompt from the store
    const existing = await repo.get(PROMPT_ID);
    if (!existing) {
      log.debug({ prompt_id: PROMPT_ID }, 'Orchestrator prompt not in store, skipping staging migration');
      return;
    }

    // Check if ANY existing version already matches the default hash.
    // This prevents duplicate version creation when the activation guard
    // blocked a previous migration (version exists but was never activated).
    const matchingVer = existing.versions.find(v => v.contentHash === defaultHash);
    if (matchingVer) {
      log.debug(
        { prompt_id: PROMPT_ID, matching_version: matchingVer.version, hash: defaultHash.slice(0, 16) },
        'Existing version already matches default hash — no migration needed',
      );
      return;
    }

    // Create a new version with the default content
    const updated = await repo.createVersion(PROMPT_ID, {
      content: defaultContent,
      createdBy: 'system-migration',
      changeNote: 'Auto-migrated orchestrator prompt from registered default (cf-v28)',
    });

    // Find the newly created version number (highest)
    const newVersionNum = Math.max(...updated.versions.map(v => v.version));

    // Guard: check if automated activation is permitted
    const guardEnabled = config.prompts?.activationGuardEnabled ?? true;

    if (guardEnabled) {
      // Version was created but NOT activated.
      // A human must set stagingVersion via the admin API.
      emit(TelemetryEvents.PromptActivationBlocked, {
        author: 'system-migration',
        prompt_id: PROMPT_ID,
        version: newVersionNum,
        target_environment: 'staging',
        reason: 'automated_activation_not_permitted',
        hash: defaultHash.slice(0, 16),
      });
      log.warn(
        {
          prompt_id: PROMPT_ID,
          new_version: newVersionNum,
          hash: defaultHash.slice(0, 16),
          event: 'prompt.activation.blocked',
        },
        `Prompt activation guard enabled — automated staging activation blocked for ${existing.taskId}. Version ${newVersionNum} created but not activated. Use admin API to set stagingVersion.`,
      );
    } else {
      // Guard disabled: old behavior — activate the version automatically
      await repo.update(PROMPT_ID, { stagingVersion: newVersionNum });
      log.info(
        {
          prompt_id: PROMPT_ID,
          new_version: newVersionNum,
          hash: defaultHash.slice(0, 16),
          event: 'prompt.staging_migration.complete',
        },
        'Orchestrator staging version migrated (guard disabled)',
      );
    }
  } catch (err) {
    // Non-fatal — staging migration failure should not block startup
    log.warn(
      { prompt_id: PROMPT_ID, error: String(err) },
      'Orchestrator staging version migration failed — will use existing store version',
    );
  }
}
