/** Startup logging for the shared adapter-free model-routing projection. */

import { log } from '../utils/telemetry.js';
import {
  buildEffectiveTaskModels,
  type ModelRoutingSnapshot,
} from '../adapters/llm/model-routing-report.js';

/**
 * Emit the exact shared routing snapshot. This function resolves nothing: the
 * admin route and startup pass the same projection, so historical
 * `CEE_MODEL_TASK_*` inventory cannot acquire serving precedence through logs.
 */
export function logResolvedTaskModels(snapshot: ModelRoutingSnapshot): void {
  log.info(
    { event: 'model.startup_resolution_note' },
    'Startup routing is adapter-free; per-request logs remain authoritative for explicit and prompt-store overrides.',
  );

  const effective = buildEffectiveTaskModels(snapshot);
  for (const row of snapshot.tasks) {
    const isEffective = Object.hasOwn(effective, row.task);
    log.info(
      {
        event: isEffective ? 'model.task_resolved' : 'model.task_not_effective',
        ...row,
      },
      isEffective ? 'Task model resolved' : 'Task model is not currently effective',
    );

    if (isEffective && row.source === 'default') {
      log.warn(
        {
          event: 'model.default_fallback',
          task: row.task,
          model: row.model,
          source_key: row.source_key,
        },
        `No higher-precedence live model authority resolved for task "${row.task}"; ` +
          `serving checked-in default "${row.model}" from ${row.source_key}.`,
      );
    }
  }
}
