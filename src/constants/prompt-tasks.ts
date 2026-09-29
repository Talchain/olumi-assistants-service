/**
 * Prompt Tasks Registry — DERIVED, not mirrored.
 *
 * `PROMPT_TASKS` is derived from `CeeTaskIdSchema` (src/prompts/schema.ts),
 * which is the single source of truth for CEE prompt task identifiers. This
 * file exists to give the admin UI an ordered, labelled *projection* of that
 * enum — it deliberately holds no task list of its own.
 *
 * ─────────────────────────────────────────────────────────────────
 * Why derived (history — do NOT re-hardcode this list)
 * ─────────────────────────────────────────────────────────────────
 * This file used to carry its own hand-written 16-entry array while
 * `CeeTaskIdSchema` carried 27. The drift was silent and one-directional:
 * the admin dropdowns under-reported what the API would actually accept, so
 * 11 store-backed tasks (`validate_graph`, `turn_classifier`, and the nine
 * `*_narrate` prompts) were unselectable in the UI despite being fully
 * manageable over `POST /admin/prompts`. The drift-prevention test that was
 * supposed to catch this had been `describe.skip`-ed with a comment naming
 * `validate_graph` as the known-failing case — the alarm was disabled rather
 * than the drift fixed.
 *
 * Deriving in this direction is the safe one: the dropdown can never
 * under-report what `CreatePromptRequestSchema` will accept. Deriving the
 * other way (narrowing the Zod enum to this file's list) would make the API
 * start REJECTING task ids that have live rows in the prompt store.
 *
 * ─────────────────────────────────────────────────────────────────
 * Verified consumers (as of this commit)
 * ─────────────────────────────────────────────────────────────────
 *   - Admin UI dropdowns — src/routes/admin.ui.ts (create form + task filter).
 *     This is the ONLY production consumer.
 *   - tests/unit/prompt-tasks-registry.test.ts — cross-registry drift guard.
 *
 * NOT consumers (the previous docblock claimed these; all three were false):
 *   - Prompt schema validation — src/prompts/schema.ts declares its own Zod
 *     enum and imports nothing from here. It is upstream of this file, not
 *     downstream.
 *   - Model routing — src/config/model-routing.ts declares its own `CeeTask`
 *     union with a deliberately different vocabulary (it carries the legacy
 *     `clarification` and `options` aliases, which are not prompt tasks).
 *   - "Drift prevention tests" — they existed, but the registry-SYNC block
 *     (3 of 10 tests) was `describe.skip`-ed with a comment naming
 *     `validate_graph` as the known failure, so the drift this file's docblock
 *     claimed to prevent was precisely what went unchecked. The other 7 tests
 *     ran. Re-enabled and made discriminating in this commit.
 *
 * To add a new prompt task:
 *   1. Add it to `CeeTaskIdSchema` in src/prompts/schema.ts (that is the SSOT;
 *      it appears here, and in the admin dropdowns, automatically).
 *   2. Register a default in src/prompts/defaults.ts.
 *   3. Add a loader operation in src/adapters/llm/prompt-loader.ts if it is
 *      resolved by an LLM call site.
 *   4. Add model routing in src/config/model-routing.ts if it needs a
 *      task-level default model.
 */

import { CeeTaskIdSchema } from '../prompts/schema.js';

/**
 * All available CEE prompt task identifiers, in `CeeTaskIdSchema` declaration
 * order. Derived — adding a task to the Zod enum surfaces it here and in the
 * admin UI with no edit to this file.
 */
export const PROMPT_TASKS = CeeTaskIdSchema.options;

export type PromptTask = (typeof PROMPT_TASKS)[number];

/**
 * Human-friendly display names. Only tasks whose label is NOT a plain
 * title-casing of the id need an entry here; everything else is derived by
 * `toTitleCase`, so a new task never arrives label-less.
 */
const EXPLICIT_TASK_LABELS: Partial<Record<PromptTask, string>> = {
  routing: 'Routing (v5)',
  m2_graph_review: 'M2 Graph Review',
};

function toTitleCase(taskId: string): string {
  return taskId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Task display labels for UI. Fully derived from PROMPT_TASKS — a task can
 * never be missing a label, which is why this is a total Record rather than
 * a hand-maintained one.
 */
export const PROMPT_TASK_LABELS: Record<PromptTask, string> = Object.fromEntries(
  PROMPT_TASKS.map((task) => [task, EXPLICIT_TASK_LABELS[task] ?? toTitleCase(task)]),
) as Record<PromptTask, string>;

/**
 * Validate that a string is a valid prompt task
 */
export function isValidPromptTask(value: string): value is PromptTask {
  return (PROMPT_TASKS as readonly string[]).includes(value);
}
