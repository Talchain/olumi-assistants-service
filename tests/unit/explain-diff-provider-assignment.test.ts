/**
 * explain_diff must resolve to a provider that can actually execute it.
 *
 * ── THE DEFECT THIS PINS ────────────────────────────────────────────────────
 * The explain-diff handler shipped complete, correct and integration-tested,
 * and could not answer a single request on staging.
 *
 * `explain_diff` was not a member of `CeeTask`, so `isValidCeeTask()` returned
 * false, so router.ts computed `taskDefault === undefined` and the task fell
 * through the precedence chain to step 6 — the global LLM_PROVIDER / LLM_MODEL.
 *
 * `LLM_PROVIDER` is UNSET on cee-staging (absent from all 118 service env vars,
 * Render API, fully paginated). So the schema default in src/config/index.ts
 * governs, and it is "openai" — corroborated by DEFAULT_PROVIDER in
 * adapters/llm/router.ts. The OpenAI adapter does not implement explainDiff.
 *
 * Every request therefore failed, from a capability whose server half was done.
 *
 * ── WHY THE FIX IS A PER-TASK DEFAULT, NOT A GLOBAL FLIP ────────────────────
 * Flipping LLM_PROVIDER would move orchestration, drafting, editing, decision
 * review, repair and extraction simultaneously, and drafting/editing are pinned
 * to their providers deliberately for structured-output support. A checked-in
 * task default moves exactly one task, outranks the global fallback (precedence
 * step 4 > step 6), and carries its provider through MODEL_REGISTRY.
 *
 * ── WHY CHECKED-IN AND NOT AN ENV VAR ───────────────────────────────────────
 * A dashboard-only assignment puts the model map in a place version control
 * cannot see — a named, recurring defect in this estate. The registry already
 * supports a code-side default, so it is used.
 */
import { describe, it, expect } from 'vitest';
import {
  TASK_MODEL_DEFAULTS,
  ROUTER_TASK_PROVIDER_CAPABILITIES,
  isValidCeeTask,
} from '../../src/config/model-routing.js';
import { resolveModelAssignment } from '../../src/config/model-assignment.js';

describe('explain_diff provider assignment', () => {
  it('is a first-class CeeTask, so the router applies a checked-in default', () => {
    // The precondition for everything below. If this goes false the task silently
    // returns to the global fallback and the capability dies again — with no
    // other test necessarily noticing.
    expect(isValidCeeTask('explain_diff')).toBe(true);
    expect(TASK_MODEL_DEFAULTS.explain_diff).toBeTruthy();
  });

  it('resolves to a provider declared capable of executing it', () => {
    const assignment = resolveModelAssignment(TASK_MODEL_DEFAULTS.explain_diff);
    const capable = ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff;

    // Bound to the DECLARED capability set, not to the literal string
    // 'anthropic'. If a provider ever gains an explainDiff limb, this keeps
    // passing for the right reason instead of pinning yesterday's answer.
    expect(capable).toContain(assignment.provider);
    expect(assignment.availability).toBe('registry_enabled');
  });

  it('names a model the registry has enabled (not an unknown string)', () => {
    const assignment = resolveModelAssignment(TASK_MODEL_DEFAULTS.explain_diff);
    expect(assignment.registryModelId).toBe(TASK_MODEL_DEFAULTS.explain_diff);
    expect(assignment.declaredProvider).not.toBeNull();
  });

  /**
   * CONTRAST CONTROL. Without this, the assertions above could pass because the
   * capability check is toothless rather than because the assignment is right.
   * An openai model must be REJECTED for this task.
   */
  it('CONTROL: an openai model is rejected for this task', () => {
    const openaiAssignment = resolveModelAssignment('gpt-4.1-2025-04-14');
    expect(openaiAssignment.provider).toBe('openai');
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff).not.toContain(
      openaiAssignment.provider,
    );
  });
});

/**
 * ⚠ SYSTEMIC GAP, PINNED EXACTLY — a declared capability nothing reconciles.
 *
 * `ROUTER_TASK_PROVIDER_CAPABILITIES` declares which providers can execute a
 * task. `TASK_MODEL_DEFAULTS` declares which model — and therefore which
 * provider — a task gets. NOTHING checked that the second satisfies the first,
 * which is precisely how explain-diff shipped unable to answer.
 *
 * This guard derives the check instead of restating it, and pins the remaining
 * violation EXACTLY: it REDs if the set grows (a new task breaks) AND if it
 * shrinks (critique is fixed and this note is now stale). A gap the suite cannot
 * see is how the first one lasted this long.
 *
 * ⚠ critique_graph is NOT fixed here — it is another lane's seam. Its default is
 * `gpt-5.2` (openai) against a declared capability of anthropic|fixtures, so it
 * throws MODEL_PROVIDER_MISMATCH before any call. THE FIX IS THIS SAME
 * MECHANISM: give it a TASK_MODEL_DEFAULTS entry naming an enabled Anthropic
 * model. Two independent estate rankings placed critique first.
 */
const KNOWN_INCAPABLE_TASK_DEFAULTS = ['critique_graph'] as const;

describe('task defaults vs declared provider capabilities', () => {
  it(`exactly ${KNOWN_INCAPABLE_TASK_DEFAULTS.length} task default violates its declared capability`, () => {
    const violations: string[] = [];

    for (const task of Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES)) {
      const model = TASK_MODEL_DEFAULTS[task as keyof typeof TASK_MODEL_DEFAULTS];
      if (!model) {
        violations.push(`${task} (no checked-in default)`);
        continue;
      }
      const capable = ROUTER_TASK_PROVIDER_CAPABILITIES[
        task as keyof typeof ROUTER_TASK_PROVIDER_CAPABILITIES
      ] as readonly string[];
      const assignment = resolveModelAssignment(model);
      if (!capable.includes(assignment.provider)) {
        violations.push(task);
      }
    }

    expect(violations.sort()).toEqual([...KNOWN_INCAPABLE_TASK_DEFAULTS].sort());
  });

  it('CONTROL: the reconciliation actually inspects more than one task', () => {
    // Guards against the loop above passing because it iterated nothing.
    expect(Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES).length).toBeGreaterThan(1);
    expect(Object.keys(ROUTER_TASK_PROVIDER_CAPABILITIES)).toContain('explain_diff');
  });
});
