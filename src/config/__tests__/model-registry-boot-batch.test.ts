import { describe, it, expect } from 'vitest';

import {
  buildModelRegistryCheckBatch,
  validateModelsRegistered,
} from '../models.js';
import { TASK_MODEL_DEFAULTS } from '../model-routing.js';

/**
 * ROADMAP — floating-alias finding (assessment-models-prompts.md §1.5).
 *
 * `CEE_MODEL_DECISION_REVIEW`, `CEE_MODEL_REPAIR` and `CEE_MODEL_EXTRACTION`
 * carry the explicit `gpt-4.1` provider alias on staging. The boot guard and
 * request-time resolver consume the same alias declaration, so those exact ids
 * are accepted while undeclared floating strings fail deliberately.
 *
 * These tests pin the WIDENED batch: every operator-supplied `CEE_MODEL_*`
 * value is validated too, DERIVED from `config.cee.models` rather than
 * hand-enumerated (CLAUDE.md trap 12 — a hand-listed task set is a mirror that
 * drifts the moment a new `CEE_MODEL_*` key is added).
 *
 * Coverage argument, stated exactly: the EFFECTIVE model for any task is
 * `env ?? checked-in default`. The batch contains every env value AND every
 * checked-in default, so it is a SUPERSET of the effective set. That is the
 * property these tests hold.
 */
describe('boot model-registry check batch', () => {
  it('accepts the three deployed gpt-4.1 values as one explicit alias', () => {
    // The exact staging posture measured on 2026-07-31 (Render API).
    const envModels = {
      decision_review: 'gpt-4.1',
      repair: 'gpt-4.1',
      extraction: 'gpt-4.1',
      draft: 'claude-sonnet-4-6',
      orchestrator: 'claude-sonnet-5',
      edit_graph: 'claude-sonnet-4-6',
    };

    const batch = buildModelRegistryCheckBatch(TASK_MODEL_DEFAULTS, { env_model: envModels });
    const errors = validateModelsRegistered(batch);

    expect(errors).toEqual([]);
  });

  it('the batch is DERIVED from each env record — a NEW key IN A WALKED RECORD needs no code edit', () => {
    // Trap 12: the guard must not be a hand-maintained task list. A key the
    // batch builder has never heard of must still be validated.
    //
    // ⚠ TITLE NARROWED (A2, review 2026-07-31). This used to read "a NEW
    // CEE_MODEL_* key is covered without a code edit", which was FALSE as
    // stated: it holds for a key added to a record that is already WALKED, not
    // for a key in a record nobody passes. A whole second tier
    // (`CEE_MODEL_TASK_*`) was invisible for exactly that reason. The
    // record-level derivation is pinned at the seam, in
    // `boot-model-registry-batch.test.ts`.
    const batch = buildModelRegistryCheckBatch(TASK_MODEL_DEFAULTS, {
      env_model: { some_future_task: 'not-a-real-model-id' },
    });
    const errors = validateModelsRegistered(batch);
    expect(
      errors.some(
        (e) => e.includes('env_model:some_future_task') && e.includes('"not-a-real-model-id"'),
      ),
    ).toBe(true);
  });

  it('still covers EVERY checked-in task default (the widening did not drop coverage)', () => {
    const batch = buildModelRegistryCheckBatch(TASK_MODEL_DEFAULTS, { env_model: {} });
    const labels = batch.map((entry) => entry.label);
    for (const task of Object.keys(TASK_MODEL_DEFAULTS)) {
      expect(labels).toContain(`task_default:${task}`);
    }
    // And the checked-in estate is itself clean today.
    expect(validateModelsRegistered(batch)).toEqual([]);
  });

  it('unset / empty / whitespace env values are skipped, not reported as empty-model errors', () => {
    // An unset CEE_MODEL_* is the NORMAL posture (the task lands on its
    // checked-in default). Reporting it would make the guard cry wolf, and a
    // guard everyone learns to ignore is a broken alarm (CLAUDE.md trap 7).
    const batch = buildModelRegistryCheckBatch(TASK_MODEL_DEFAULTS, {
      env_model: { decision_review: undefined, repair: '', extraction: '   ' },
    });
    expect(batch.some((entry) => entry.label.startsWith('env_model:'))).toBe(false);
    expect(validateModelsRegistered(batch)).toEqual([]);
  });

  it('extra router-bypass entries are appended verbatim', () => {
    const batch = buildModelRegistryCheckBatch(TASK_MODEL_DEFAULTS, { env_model: {} }, [
      { label: 'rolling_summary_default', modelId: 'claude-haiku-4-5' },
    ]);
    expect(batch).toContainEqual({
      label: 'rolling_summary_default',
      modelId: 'claude-haiku-4-5',
    });
  });
});
