import { describe, it, expect, vi, afterEach } from 'vitest';

import { buildBootModelRegistryBatch } from '../boot-model-registry-batch.js';
import { validateModelsRegistered } from '../models.js';
import { TASK_MODEL_DEFAULTS } from '../model-routing.js';

/**
 * A1 (review, BLOCKING — CLAUDE.md trap 11) — THE CALL SITE, NOT THE HELPER.
 *
 * The first cut of this fix pinned `buildModelRegistryCheckBatch` (the pure
 * helper) with three mutants. All three targeted the helper. **None targeted the
 * WIRING**, and the review proved the gap by mutating `server.ts` to pass `{}`
 * instead of `config.cee.models` — restoring the EXACT pre-fix blindness — and
 * watching the full `test:required` stay GREEN. A fix whose removal turns
 * nothing red is theatre (trap 11), and that is precisely what the call site was.
 *
 * The repair is structural, not another assertion: `buildBootModelRegistryBatch`
 * takes **no config argument at all** and reads the live `config` proxy itself.
 * The reviewer's mutant is now IMPOSSIBLE TO WRITE at the call site — there is
 * no argument there to hollow out — and the equivalent mutation (swap the config
 * read for `{}`) now lives INSIDE the seam, where the env-driven tests below see
 * it and go red.
 *
 * These tests drive the seam through REAL environment variables via
 * `vi.stubEnv`, relying on `config` being a lazily-parsed Proxy that
 * `vitest.setup.ts` resets before every test. So they exercise the true path:
 * env var → config parse → batch → registry verdict.
 */
describe('buildBootModelRegistryBatch — the BOOT SEAM, driven by real env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('A1: the seam reads the LIVE config — the three staging aliases surface as boot errors', () => {
    // The exact staging posture measured 2026-07-31 (Render API).
    vi.stubEnv('CEE_MODEL_DECISION_REVIEW', 'gpt-4.1');
    vi.stubEnv('CEE_MODEL_REPAIR', 'gpt-4.1');
    vi.stubEnv('CEE_MODEL_EXTRACTION', 'gpt-4.1');

    const errors = validateModelsRegistered(buildBootModelRegistryBatch());

    expect(errors).toHaveLength(3);
    for (const key of ['decision_review', 'repair', 'extraction']) {
      expect(
        errors.some((e) => e.includes('"gpt-4.1"') && e.includes(`env_model:${key}`)),
        `expected a boot error naming env_model:${key} — got:\n${errors.join('\n')}`,
      ).toBe(true);
    }
  });

  it('A1: with no CEE_MODEL_* set the seam is clean (no false alarm on the normal posture)', () => {
    expect(validateModelsRegistered(buildBootModelRegistryBatch())).toEqual([]);
  });

  it('A1: the seam still carries every checked-in default and the router-bypass extras', () => {
    const batch = buildBootModelRegistryBatch([
      { label: 'rolling_summary_default', modelId: 'claude-haiku-4-5' },
    ]);
    const labels = batch.map((e) => e.label);
    for (const task of Object.keys(TASK_MODEL_DEFAULTS)) {
      expect(labels).toContain(`task_default:${task}`);
    }
    expect(labels).toContain('draft_graph (effective)');
    expect(labels).toContain('rolling_summary_default');
  });

  it('A1: the effective DRAFT model follows the env override, not the checked-in default', () => {
    vi.stubEnv('CEE_MODEL_DRAFT', 'definitely-not-a-registered-model');
    const draftRow = buildBootModelRegistryBatch().find(
      (e) => e.label === 'draft_graph (effective)',
    );
    expect(draftRow?.modelId).toBe('definitely-not-a-registered-model');
  });

  /**
   * A2 (review) — THE SECOND `CEE_MODEL_*` RECORD.
   *
   * The first cut walked only `config.cee.models` (the legacy tier, 14 keys) while
   * claiming "a NEW CEE_MODEL_* key is covered without a code edit". That claim
   * was FALSE: `config.cee.modelSelection.taskModels` is a second record of ten
   * `CEE_MODEL_TASK_*` keys (config/index.ts:1664-1675), and
   * `model-resolution-logger.ts` `resolveTaskModel` ranks it ABOVE the legacy
   * tier (`env_task_tier` is checked before `env_legacy_tier`).
   *
   * Verified independently at the bytes rather than inherited: the tier's only
   * runtime consumer, `selectModel` (`services/model-selector.ts:124`), has
   * ZERO importers — scope `rg -a` for `selectModel(` / `model-selector` over
   * `src/` and `tools/`, one hit, its own definition. So the tier is dead at the
   * ROUTER today. It is NOT dead at the startup LOG: `resolveTaskModel` reads it
   * live, so a `CEE_MODEL_TASK_*` set to an unregistered id already changes what
   * the boot log claims serves a task.
   *
   * Disposition: WALK BOTH RECORDS (the review's preferred option). The dead tier
   * will not stay dead, walking it cannot produce a false verdict, and it makes
   * the derive-don't-mirror claim true rather than nearly true.
   */
  it('A2: the TASK tier (CEE_MODEL_TASK_*) is walked too — the second record is not invisible', () => {
    vi.stubEnv('CEE_MODEL_TASK_DRAFT_GRAPH', 'gpt-4.1');

    const errors = validateModelsRegistered(buildBootModelRegistryBatch());

    expect(
      errors.some((e) => e.includes('env_task_model:draftGraph') && e.includes('"gpt-4.1"')),
      `expected the task tier to be validated — got:\n${errors.join('\n')}`,
    ).toBe(true);
  });

  it('A2: both records are walked in the SAME batch, under distinguishable labels', () => {
    vi.stubEnv('CEE_MODEL_CRITIQUE', 'unregistered-legacy-tier');
    vi.stubEnv('CEE_MODEL_TASK_CRITIQUE_GRAPH', 'unregistered-task-tier');

    const errors = validateModelsRegistered(buildBootModelRegistryBatch());

    expect(errors.some((e) => e.includes('env_model:critique'))).toBe(true);
    expect(errors.some((e) => e.includes('env_task_model:critiqueGraph'))).toBe(true);
    // The labels must not collide — an operator has to know WHICH env var to fix.
    expect(errors.some((e) => e.includes('unregistered-legacy-tier'))).toBe(true);
    expect(errors.some((e) => e.includes('unregistered-task-tier'))).toBe(true);
  });
});

/**
 * A3 (review) — THE GUARD MUST NOT PRINT A FALSE SENTENCE.
 *
 * The widened guard fires three times on every staging boot carrying the legacy
 * copy: *"Requests routed to it would fail at the adapter."* **That sentence is
 * false**, and `gpt-4.1` serving happily on staging today is the empirical proof.
 *
 * Verified independently at the bytes, complete manifest, scope `rg -a` over
 * `src/` excluding `__tests__`:
 *   - `isKnownModel`  → 1 caller: `validateModelRegistered` itself (models.ts:479)
 *   - `isModelEnabled` → 1 caller: `validateModelRegistered` itself (models.ts:484)
 *   - `MODEL_REGISTRY` / `isKnownModel` / `isModelEnabled` in `src/adapters/` → ZERO hits
 * So registry membership is consulted ONLY at boot, by this guard. No adapter
 * ever checks it, and an unregistered-but-real model id serves normally.
 *
 * A guard that cries wolf three times per boot teaches operators to ignore it —
 * the broken-alarm defect this programme keeps paying for (CLAUDE.md trap 7, and
 * trap 7b's lesson that a bad label makes lanes stop looking).
 *
 * The replacement copy states only what IS true, all of it verified above:
 * no registry metadata; `getModelProvider` returns undefined so the router's
 * provider-match step no-ops; `isModelClientAllowed` rejects the same id from a
 * client while the server-side value is accepted (asymmetric — router.ts:818,
 * extraction.ts:405); and a floating alias can be repointed upstream silently.
 */
describe('A3 — operator-override copy tells the truth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT claim the request would fail at the adapter', () => {
    vi.stubEnv('CEE_MODEL_DECISION_REVIEW', 'gpt-4.1');
    const errors = validateModelsRegistered(buildBootModelRegistryBatch());
    const row = errors.find((e) => e.includes('env_model:decision_review'));

    expect(row).toBeDefined();
    expect(row).not.toMatch(/would fail/i);
    expect(row).not.toMatch(/fail at the adapter/i);
  });

  it('states what IS true: unvalidated, no registry metadata, and pin it', () => {
    vi.stubEnv('CEE_MODEL_DECISION_REVIEW', 'gpt-4.1');
    const row = validateModelsRegistered(buildBootModelRegistryBatch()).find((e) =>
      e.includes('env_model:decision_review'),
    );

    expect(row).toMatch(/not in the model registry/i);
    // The actionable instruction — the operator must know what to DO.
    expect(row).toMatch(/pin/i);
    // The honest caveat that stops it reading as an outage.
    expect(row).toMatch(/may still serve/i);
  });

  it('a CHECKED-IN default keeps its own copy — the two classes are not conflated', () => {
    // A drifted checked-in default is a different problem with a different fix,
    // and its message must not be softened into the operator-override wording.
    const errors = validateModelsRegistered([
      { label: 'task_default:draft_graph', modelId: 'totally-made-up', kind: 'checked_in_default' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toMatch(/may still serve/i);
  });
});
