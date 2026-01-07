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
import { log } from '../utils/telemetry.js';
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
