/**
 * The boot model-registry drift guard's BATCH SEAM.
 *
 * ─────────────────────────────────────────────────────────────────
 * Why this module exists, and why it takes no config argument
 * ─────────────────────────────────────────────────────────────────
 * The first cut of the widened guard assembled the batch INLINE in `server.ts`,
 * pinning only the pure helper (`buildModelRegistryCheckBatch`) with unit tests.
 * A review then proved the wiring was pinned by NOTHING: mutating the server to
 * pass `{}` instead of `config.cee.models` — restoring the exact pre-fix
 * blindness the whole change existed to remove — left the FULL `test:required`
 * suite green. A fix whose removal turns nothing red is theatre (CLAUDE.md trap
 * 11), and the call site was exactly that.
 *
 * The repair is structural rather than one more assertion. This function takes
 * **no config parameter**; it reads the live `config` proxy itself. That makes
 * the reviewer's mutant impossible to write at the call site — there is no
 * argument there to hollow out — and moves the equivalent mutation (swap a
 * config read for `{}`) INSIDE this module, where the env-driven tests in
 * `__tests__/boot-model-registry-batch.test.ts` observe it and go red.
 *
 * `config` is a lazily-parsed Proxy that `vitest.setup.ts` resets before every
 * test, so those tests drive this seam through REAL environment variables and
 * exercise the true path: env var → config parse → batch → registry verdict.
 *
 * ─────────────────────────────────────────────────────────────────
 * What is in the batch, and the coverage argument
 * ─────────────────────────────────────────────────────────────────
 * The EFFECTIVE model for a task is `env ?? checked-in default`. The batch
 * carries every checked-in default AND every set value from every env tier, so
 * it is a strict SUPERSET of the effective set and cannot miss one. Two env
 * tiers are walked, not one (A2):
 *
 *   - `config.cee.models`                      the legacy `CEE_MODEL_*` tier
 *   - `config.cee.modelSelection.taskModels`   the `CEE_MODEL_TASK_*` tier,
 *     ranked ABOVE the legacy tier by `model-resolution-logger.ts`
 *     `resolveTaskModel`
 *
 * The task tier's only ROUTER-side consumer (`selectModel`,
 * `services/model-selector.ts`) currently has zero importers, so it is dead on
 * the request path today — but it is live in the startup LOG, and a dead tier
 * with live env plumbing is exactly the thing that comes back. Walking it costs
 * nothing and cannot produce a false verdict.
 */

import { config } from './index.js';
import { TASK_MODEL_DEFAULTS } from './model-routing.js';
import { buildModelRegistryCheckBatch, type ModelRegistryCheckEntry } from './models.js';

/**
 * Assemble the full boot registry-check batch from LIVE config.
 *
 * @param routerBypassDefaults the checked-in defaults for resolvers that do not
 *   consult `TASK_MODEL_DEFAULTS` (rolling summariser, decision-review
 *   decompose). Passed in rather than imported so this stays a light config
 *   module; their env overrides (`CEE_MODEL_SUMMARY`,
 *   `CEE_MODEL_DECISION_REVIEW_HAIKU`) are already covered by the derived
 *   `env_model:*` rows, so default AND override are both validated.
 */
export function buildBootModelRegistryBatch(
  routerBypassDefaults: ReadonlyArray<ModelRegistryCheckEntry> = [],
): ModelRegistryCheckEntry[] {
  const cee = config.cee;
  const legacyTier = cee.models ?? {};
  return buildModelRegistryCheckBatch(
    TASK_MODEL_DEFAULTS,
    {
      env_model: legacyTier,
      env_task_model: cee.modelSelection?.taskModels ?? {},
    },
    [
      // Effective draft model (env override applied) — preserves the Lane-F
      // check under its original label. Redundant with the derived rows (both
      // `env_model:draft` and `task_default:draft_graph` are covered); kept so
      // the Lane-F locus stays named in the boot log.
      {
        label: 'draft_graph (effective)',
        modelId: legacyTier.draft ?? TASK_MODEL_DEFAULTS.draft_graph,
        kind: legacyTier.draft ? 'operator_override' : 'checked_in_default',
      },
      ...routerBypassDefaults,
    ],
  );
}
