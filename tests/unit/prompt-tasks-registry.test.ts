/**
 * Prompt Task Registry — Drift Prevention
 *
 * `CeeTaskIdSchema` (src/prompts/schema.ts) is the single source of truth for
 * CEE prompt task identifiers. Everything that can be derived from it IS
 * derived; this file guards the seams that cannot be.
 *
 * Anchoring status of every prompt-task list in the repo:
 *
 *   | list                             | file                              | anchoring          |
 *   |----------------------------------|-----------------------------------|--------------------|
 *   | CeeTaskIdSchema                  | src/prompts/schema.ts             | SSOT               |
 *   | PROMPT_TASKS                     | src/constants/prompt-tasks.ts     | DERIVED (guarded)  |
 *   | PROMPT_TASK_LABELS               | src/constants/prompt-tasks.ts     | DERIVED (guarded)  |
 *   | OPERATION_TO_TASK_ID             | src/adapters/llm/prompt-loader.ts | typed Record<string, CeeTaskId> — invalid values are a COMPILE error |
 *   | registerDefaultPrompt(...) calls | src/prompts/defaults.ts           | typed CeeTaskId — invalid ids are a COMPILE error; COVERAGE guarded below |
 *   | TRACKED_KEYS                     | src/prompts/tracked.ts            | `satisfies readonly CeeTaskId[]` — deliberate subset, COMPILE-guarded |
 *   | CeeTask / TASK_MODEL_DEFAULTS    | src/config/model-routing.ts       | separate vocabulary — guarded below |
 *
 * History: this suite previously existed but its entire sync block was
 * `describe.skip`-ed, with a comment naming `validate_graph` as the known
 * failure. The alarm was disabled instead of the drift being fixed, and the
 * admin UI silently under-reported 11 store-backed tasks for months. Every
 * assertion below is mutation-checked in both directions (extra entry → RED,
 * missing entry → RED). If you find yourself skipping one of these, fix the
 * drift instead.
 */

import { describe, it, expect } from 'vitest';
import { PROMPT_TASKS, PROMPT_TASK_LABELS, type PromptTask } from '../../src/constants/prompt-tasks.js';
import { CeeTaskIdSchema } from '../../src/prompts/schema.js';
import { TASK_MODEL_DEFAULTS } from '../../src/config/model-routing.js';
import { TRACKED_KEYS } from '../../src/prompts/tracked.js';
import { getDefaultPrompts } from '../../src/prompts/loader.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { generateTaskOptions } from '../../src/routes/admin.ui.js';

/**
 * Schema tasks that intentionally have NO registered default prompt.
 *
 * These three are legacy slots: they sit in the Zod enum and in model routing
 * but have no default, no loader operation, and no row in the prompt store.
 * They are kept (rather than deleted) because removing them from the enum
 * would make the API start rejecting task ids it currently accepts — a
 * separate, deliberate decision.
 *
 * This is an EXACT-set assertion, not an allowlist: adding a fourth
 * default-less task goes RED (you must justify it), and registering a default
 * for one of these ALSO goes RED (you must delete it from this set). It
 * cannot silently assume-good in either direction.
 */
const SCHEMA_TASKS_WITHOUT_DEFAULTS = ['evidence_helper', 'sensitivity_coach', 'preflight'] as const;

/**
 * Model-routing keys that are deliberately NOT prompt task ids.
 *
 * `src/config/model-routing.ts` keys a model per *routing* task, and its
 * vocabulary predates the prompt registry: `clarification` and `options` are
 * legacy aliases of `clarify_brief` and `suggest_options`. They are real
 * routing entries, not drift. Exact-set assertion, same rationale as above.
 */
const MODEL_ROUTING_NON_PROMPT_TASKS = ['clarification', 'options'] as const;

describe('prompt task registry', () => {
  describe('PROMPT_TASKS is derived from CeeTaskIdSchema', () => {
    it('is exactly CeeTaskIdSchema.options, in order', () => {
      // Guards against anyone re-introducing a hand-written array here.
      expect([...PROMPT_TASKS]).toEqual([...CeeTaskIdSchema.options]);
    });

    it('accepts every task the create endpoint accepts', () => {
      // The one-directional failure that caused the original bug: the UI must
      // never under-report what CreatePromptRequestSchema will validate.
      for (const taskId of CeeTaskIdSchema.options) {
        expect(
          (PROMPT_TASKS as readonly string[]).includes(taskId),
          `Task '${taskId}' validates against CeeTaskIdSchema but is missing from PROMPT_TASKS — the admin UI cannot offer it`,
        ).toBe(true);
      }
    });

    it('has no duplicates', () => {
      expect(new Set(PROMPT_TASKS).size).toBe(PROMPT_TASKS.length);
    });

    it('uses lower_snake_case ids throughout', () => {
      for (const task of PROMPT_TASKS) {
        expect(task).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe('PROMPT_TASK_LABELS is total over PROMPT_TASKS', () => {
    it('labels every task with a non-empty string', () => {
      for (const task of PROMPT_TASKS) {
        expect(PROMPT_TASK_LABELS[task], `Task '${task}' has no display label`).toBeTruthy();
      }
    });

    it('carries no label for a task that does not exist', () => {
      for (const labelled of Object.keys(PROMPT_TASK_LABELS)) {
        expect(
          (PROMPT_TASKS as readonly string[]).includes(labelled),
          `Label declared for unknown task '${labelled}'`,
        ).toBe(true);
      }
    });
  });

  describe('admin UI dropdown covers the registry', () => {
    it('renders an <option> for every prompt task', () => {
      // Closes the loop at the real consumer: this is the surface where the
      // original drift was user-visible.
      const html = generateTaskOptions();
      for (const task of PROMPT_TASKS) {
        expect(
          html.includes(`<option value="${task}">`),
          `Admin task dropdown is missing '${task}' — it cannot be selected when creating a prompt`,
        ).toBe(true);
      }
    });

    it('renders exactly as many options as there are tasks', () => {
      const optionCount = (generateTaskOptions().match(/<option /g) ?? []).length;
      expect(optionCount).toBe(PROMPT_TASKS.length);
    });
  });

  describe('registered defaults cover the schema', () => {
    it('registers a default for every schema task except the documented legacy slots', () => {
      registerAllDefaultPrompts();
      const withDefaults = new Set(Object.keys(getDefaultPrompts()));

      const missing = CeeTaskIdSchema.options.filter((t) => !withDefaults.has(t)).sort();
      expect(
        missing,
        'Schema tasks without a registered default changed. Either register a default, ' +
          'or update SCHEMA_TASKS_WITHOUT_DEFAULTS with a justification.',
      ).toEqual([...SCHEMA_TASKS_WITHOUT_DEFAULTS].sort());
    });

    it('registers no default for a task the schema does not know', () => {
      registerAllDefaultPrompts();
      for (const taskId of Object.keys(getDefaultPrompts())) {
        expect(
          CeeTaskIdSchema.safeParse(taskId).success,
          `Default registered for '${taskId}', which is not in CeeTaskIdSchema`,
        ).toBe(true);
      }
    });
  });

  describe('model routing vocabulary', () => {
    it('diverges from the schema only by the documented legacy aliases', () => {
      const nonPromptTasks = Object.keys(TASK_MODEL_DEFAULTS)
        .filter((task) => !CeeTaskIdSchema.safeParse(task).success)
        .sort();
      expect(
        nonPromptTasks,
        'model-routing keys that are not prompt tasks changed. Either use the canonical ' +
          'task id, or update MODEL_ROUTING_NON_PROMPT_TASKS with a justification.',
      ).toEqual([...MODEL_ROUTING_NON_PROMPT_TASKS].sort());
    });
  });

  describe('TRACKED_KEYS is a deliberate subset', () => {
    it('contains only real prompt tasks', () => {
      // Compile-time guarded by `satisfies readonly CeeTaskId[]`; asserted at
      // runtime too so a future `as` cast cannot slip past.
      for (const key of TRACKED_KEYS) {
        expect(
          (PROMPT_TASKS as readonly string[]).includes(key),
          `TRACKED_KEYS entry '${key}' is not a valid prompt task`,
        ).toBe(true);
      }
    });

    it('is a strict subset (it reports a chosen few, not everything)', () => {
      expect(TRACKED_KEYS.length).toBeLessThan(PROMPT_TASKS.length);
    });
  });

  describe('type safety', () => {
    it('exports a usable PromptTask type', () => {
      const task: PromptTask = 'draft_graph';
      expect((PROMPT_TASKS as readonly string[]).includes(task)).toBe(true);
    });
  });
});
