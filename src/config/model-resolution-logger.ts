/**
 * Startup Model Resolution Logger
 *
 * Emits one structured log line per CeeTask at service startup showing the
 * resolved model and which precedence tier delivered it.
 *
 * Precedence (highest to lowest, startup-visible only):
 *   env_task_tier   -- CEE_MODEL_TASK_* env var (newer taskModels tier)
 *   env_legacy_tier -- CEE_MODEL_* env var (older per-operation models tier)
 *   code_default    -- TASK_MODEL_DEFAULTS fallback
 *
 * Note: store overrides (per-prompt model_config) apply at parse time, per turn.
 * They are not determinable at startup. Operators needing per-turn store-override
 * visibility should query GET /admin/v1/routing-log/:turn_id.
 *
 * Emits exactly once at startup. Does not re-emit per turn.
 */

import { log } from '../utils/telemetry.js';
import { config } from './index.js';
import {
  AI_TASK_LIFECYCLE,
  TASK_MODEL_DEFAULTS,
  type CeeTask,
} from './model-routing.js';

type ModelSource = 'env_task_tier' | 'env_legacy_tier' | 'code_default';

/**
 * CeeTask -> taskModels config key mapping (camelCase, task tier).
 * Only tasks present in config.cee.modelSelection.taskModels are listed.
 */
const TASK_TO_TASK_MODEL_KEY: Partial<Record<CeeTask, keyof NonNullable<typeof config.cee.modelSelection.taskModels>>> = {
  clarification: 'clarification',
  preflight: 'preflight',
  draft_graph: 'draftGraph',
  bias_check: 'biasCheck',
  evidence_helper: 'evidenceHelper',
  sensitivity_coach: 'sensitivityCoach',
  options: 'options',
  explainer: 'explainer',
  repair_graph: 'repairGraph',
  critique_graph: 'critiqueGraph',
};

/**
 * CeeTask -> config.cee.models config key mapping (legacy tier).
 * Mirrors TASK_TO_CONFIG_KEY in src/adapters/llm/router.ts.
 */
const TASK_TO_LEGACY_MODEL_KEY: Partial<Record<CeeTask, keyof typeof config.cee.models>> = {
  draft_graph: 'draft',
  suggest_options: 'options',
  repair_graph: 'repair',
  critique_graph: 'critique',
  decision_review: 'decision_review',
  orchestrator: 'orchestrator',
  edit_graph: 'edit_graph',
  m2_graph_review: 'm2_review', // V6 dual-draft M2 review (CEE_MODEL_M2_REVIEW)
  // Validation Pass 2 (CEE_MODEL_VALIDATION). Listed for the LOUD FALLBACK below,
  // not for cosmetics: with the pipeline live (ROADMAP 2.146) a dropped or
  // never-set CEE_MODEL_VALIDATION means the independent reviewer is running on
  // the checked-in default, and that must be VISIBLE in startup logs rather than
  // inferred. Mirrors TASK_TO_CONFIG_KEY's 'validate_graph' → 'validation' row.
  validate_graph: 'validation',
};

function resolveTaskModel(task: CeeTask): { model: string; source: ModelSource } {
  // 1. Task tier (CEE_MODEL_TASK_*)
  const taskKey = TASK_TO_TASK_MODEL_KEY[task];
  if (taskKey) {
    const taskModel = config.cee.modelSelection?.taskModels?.[taskKey];
    if (taskModel) {
      return { model: taskModel, source: 'env_task_tier' };
    }
  }

  // 2. Legacy tier (CEE_MODEL_*)
  const legacyKey = TASK_TO_LEGACY_MODEL_KEY[task];
  if (legacyKey) {
    const legacyModel = config.cee.models?.[legacyKey];
    if (legacyModel) {
      return { model: legacyModel, source: 'env_legacy_tier' };
    }
  }

  // 3. Code default
  return { model: TASK_MODEL_DEFAULTS[task], source: 'code_default' };
}

// Derived from TASK_MODEL_DEFAULTS so new tasks are automatically included.
// TASK_MODEL_DEFAULTS is Record<CeeTask, string>, so Object.keys is exhaustive.
// Display-only, deterministic/external, gated-off and inert-compatibility rows
// stay queryable through the lifecycle map but are not logged as resolved live
// calls. This prevents repair_graph/routing/aliases from looking executable.
const ALL_CEE_TASKS = (Object.keys(TASK_MODEL_DEFAULTS) as CeeTask[]).filter(
  (task) => AI_TASK_LIFECYCLE[task].executable,
);

/**
 * Emit one log line per CeeTask showing resolved model and source tier.
 * Call once at startup. Includes a caveat note that store overrides are
 * not visible here and require per-turn inspection.
 */
export function logResolvedTaskModels(): void {
  // Startup resolution is advisory only. Prompt-store model_config overrides
  // are applied per request at parse time (src/cee/unified-pipeline/stages/parse.ts)
  // and are not determinable at boot. The per-request log "model.resolution"
  // and GET /admin/v1/turn-debug/:turn_id are the source of truth for the
  // actually-used model on any given call.
  log.info(
    { event: 'model.startup_resolution_note' },
    'Startup values are advisory. Per-request logs are the source of truth for store overrides applied after boot.',
  );
  for (const task of ALL_CEE_TASKS) {
    const { model, source } = resolveTaskModel(task);
    log.info(
      { event: 'model.task_resolved', task, model, source },
      'Task model resolved',
    );

    // Loud fallback (no throw, no flag): a task that supports a CEE_MODEL_*
    // override (it has a legacy config key) but has NONE set is running on the
    // checked-in TASK_MODEL_DEFAULTS value. Surface it at WARN so a dropped or
    // never-set env var is VISIBLE in startup logs rather than silently landing
    // on a checked-in (possibly stale) default. Tasks with no CEE_MODEL_*
    // mechanism (info-only above) do not warn — they have no var to drop.
    const legacyKey = TASK_TO_LEGACY_MODEL_KEY[task];
    if (source === 'code_default' && legacyKey) {
      log.warn(
        {
          event: 'model.default_fallback',
          task,
          model,
          config_key: legacyKey,
        },
        `No CEE_MODEL_* override set for task "${task}"; serving checked-in ` +
          `default "${model}". If a Render env var was dropped this is the ` +
          `silent-regression signal; otherwise confirm TASK_MODEL_DEFAULTS is ` +
          `current for this task.`,
      );
    }
  }
}
