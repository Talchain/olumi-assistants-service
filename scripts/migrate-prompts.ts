#!/usr/bin/env tsx
/**
 * Prompt Migration Script
 *
 * Migrates hardcoded prompts from src/prompts/defaults.ts into the
 * managed prompt store for admin UI visibility and version control.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-prompts.ts                    # Dry run (default)
 *   pnpm exec tsx scripts/migrate-prompts.ts --execute          # Actually migrate
 *   pnpm exec tsx scripts/migrate-prompts.ts --execute --force  # Overwrite existing
 *
 * Exit codes:
 *   0 - Success (or dry run completed)
 *   1 - Error during migration
 */

import 'dotenv/config';
import { PROMPT_TEMPLATES } from '../src/prompts/defaults.js';
import {
  getPromptStore,
  initializePromptStore,
  isPromptStoreInitialized,
} from '../src/prompts/store.js';
import {
  extractVariables,
  computeContentHash,
  type PromptVariable,
  type CeeTaskId,
} from '../src/prompts/schema.js';

// =============================================================================
// Configuration
// =============================================================================

interface MigrationConfig {
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): MigrationConfig {
  const args = process.argv.slice(2);
  return {
    dryRun: !args.includes('--execute'),
    force: args.includes('--force'),
  };
}

// =============================================================================
// Variable Definitions
// =============================================================================

/**
 * Define variable metadata for prompts that use {{variables}}
 */
const VARIABLE_DEFINITIONS: Partial<Record<CeeTaskId, PromptVariable[]>> = {
  draft_graph: [
    {
      name: 'maxNodes',
      description: 'Maximum number of nodes allowed in the graph',
      required: true,
      defaultValue: '50',
      example: '50',
    },
    {
      name: 'maxEdges',
      description: 'Maximum number of edges allowed in the graph',
      required: true,
      defaultValue: '200',
      example: '200',
    },
  ],
};

/**
 * Human-readable names for each task
 */
const TASK_NAMES: Record<string, string> = {
  draft_graph: 'Draft Graph System Prompt',
  suggest_options: 'Suggest Options Prompt',
  repair_graph: 'Repair Graph Prompt',
  clarify_brief: 'Clarify Brief Prompt',
  critique_graph: 'Critique Graph Prompt',
  explainer: 'Explainer Prompt',
  bias_check: 'Bias Check Prompt',
};

/**
 * Descriptions for each task
 */
const TASK_DESCRIPTIONS: Record<string, string> = {
  draft_graph: 'Converts plain-English briefs into structured decision graphs with goals, decisions, options, and outcomes.',
  suggest_options: 'Generates 3-5 strategic options with pros, cons, and evidence to gather for a decision.',
  repair_graph: 'Fixes graph violations like cycles, isolated nodes, and invalid structures.',
  clarify_brief: 'Generates clarifying questions to refine ambiguous decision briefs.',
  critique_graph: 'Analyzes graphs for structural, completeness, and feasibility issues.',
  explainer: 'Explains why changes were made to a decision graph.',
  bias_check: 'Identifies potential cognitive biases in decision-making.',
};

// =============================================================================
// Migration Logic
// =============================================================================

interface MigrationResult {
  taskId: string;
  status: 'created' | 'skipped' | 'updated' | 'error';
  message: string;
  promptId?: string;
}

async function migratePrompt(
  taskId: CeeTaskId,
  content: string,
  config: MigrationConfig
): Promise<MigrationResult> {
  const promptId = `${taskId}_default`;
  const store = getPromptStore();

  // Check if prompt already exists
  const existing = await store.get(promptId);

  if (existing && !config.force) {
    return {
      taskId,
      status: 'skipped',
      message: `Prompt already exists (use --force to overwrite)`,
      promptId,
    };
  }

  // Extract variables from content
  const variableNames = extractVariables(content);
  const variableDefs = VARIABLE_DEFINITIONS[taskId] ?? [];

  // Ensure all extracted variables have definitions
  const variables: PromptVariable[] = variableNames.map((name) => {
    const existing = variableDefs.find((v) => v.name === name);
    if (existing) return existing;

    // Create a basic definition for undocumented variables
    return {
      name,
      description: `Variable: ${name}`,
      required: true,
    };
  });

  if (config.dryRun) {
    return {
      taskId,
      status: existing ? 'updated' : 'created',
      message: `[DRY RUN] Would ${existing ? 'update' : 'create'} prompt with ${variables.length} variable(s)`,
      promptId,
    };
  }

  try {
    if (existing) {
      // Create a new version
      await store.createVersion(promptId, {
        content,
        variables,
        createdBy: 'migration-script',
        changeNote: 'Re-migrated from defaults.ts',
      });
      return {
        taskId,
        status: 'updated',
        message: `Created new version`,
        promptId,
      };
    }

    // Create new prompt
    await store.create({
      id: promptId,
      name: TASK_NAMES[taskId] ?? `${taskId} Prompt`,
      description: TASK_DESCRIPTIONS[taskId],
      taskId,
      content,
      variables,
      tags: ['migrated', 'default'],
      createdBy: 'migration-script',
      changeNote: 'Initial migration from defaults.ts',
    });

    // Promote to production since these are known-working prompts
    await store.update(promptId, {
      status: 'production',
    });

    return {
      taskId,
      status: 'created',
      message: `Created and promoted to production`,
      promptId,
    };
  } catch (error) {
    return {
      taskId,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      promptId,
    };
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           Prompt Migration Script                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (config.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
    console.log('   Run with --execute to actually migrate prompts\n');
  } else {
    console.log('🚀 EXECUTE MODE - Prompts will be migrated\n');
  }

  // Initialize store
  console.log('📦 Initializing prompt store...');
  try {
    await initializePromptStore();
    if (!isPromptStoreInitialized()) {
      console.error('❌ Failed to initialize prompt store');
      console.error('   Check that PROMPTS_ENABLED=true is set');
      process.exit(1);
    }
    console.log('   ✓ Store initialized\n');
  } catch (error) {
    console.error('❌ Failed to initialize prompt store:', error);
    process.exit(1);
  }

  // Get prompt templates
  const templates = Object.entries(PROMPT_TEMPLATES) as [CeeTaskId, string][];
  console.log(`📝 Found ${templates.length} prompts to migrate:\n`);

  // Show summary before migration
  for (const [taskId, content] of templates) {
    const vars = extractVariables(content);
    const hash = computeContentHash(content).slice(0, 8);
    console.log(`   • ${taskId}`);
    console.log(`     Content: ${content.length} chars, hash: ${hash}...`);
    if (vars.length > 0) {
      console.log(`     Variables: {{${vars.join('}}, {{')}}`);
    }
  }
  console.log('');

  // Migrate each prompt
  console.log('─'.repeat(60));
  console.log('Migration Results:');
  console.log('─'.repeat(60) + '\n');

  const results: MigrationResult[] = [];

  for (const [taskId, content] of templates) {
    const result = await migratePrompt(taskId, content, config);
    results.push(result);

    const icon =
      result.status === 'created'
        ? '✅'
        : result.status === 'updated'
          ? '🔄'
          : result.status === 'skipped'
            ? '⏭️'
            : '❌';

    console.log(`${icon} ${taskId}: ${result.message}`);
  }

  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log('Summary:');
  console.log('─'.repeat(60) + '\n');

  const created = results.filter((r) => r.status === 'created').length;
  const updated = results.filter((r) => r.status === 'updated').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;

  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors:  ${errors}`);

  if (config.dryRun) {
    console.log('\n💡 This was a dry run. Run with --execute to apply changes.\n');
  } else if (errors === 0) {
    console.log('\n✅ Migration complete!\n');
    console.log('   View prompts at: /admin (with ADMIN_API_KEY)\n');
  } else {
    console.log('\n⚠️  Migration completed with errors.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
