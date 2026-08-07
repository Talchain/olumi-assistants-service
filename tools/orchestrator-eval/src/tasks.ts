/**
 * orchestrator-eval — TASK KEYS.
 *
 * The chassis was built around a single task (`routing`) and hard-wired to it
 * in two places: the PMS candidate resolver (`prompt-source.ts`) and the
 * request builder (`candidate-run.ts`, which assembles a `<TURN_CONTEXT>` from
 * a `ContextPackAnalysis`). Both hard-wires are now parameterised by a TASK
 * KEY, with `routing` as the default so every existing entrypoint, flag, and
 * fixture behaves byte-identically.
 *
 * A task key is the PMS prompt task name — the SAME string the runtime passes
 * to `getSystemPrompt(...)` / `store.getCompiled(...)`, so `pms:<version>`
 * refs resolve the prompt the runtime actually serves for that task.
 *
 * DELIBERATELY NOT AN OPEN STRING: an unknown task key is refused loudly at
 * parse time (`parseEvalTask`) rather than being forwarded to the store, where
 * it would come back as a null compiled prompt and read as "PMS has no version
 * N" — a misattributed error. Adding a task means adding it here AND supplying
 * an adapter (`task-adapter.ts`), so the type system refuses a half-wired task.
 */

/** Every task the eval chassis can evaluate. */
export const EVAL_TASKS = ['routing', 'decision_review'] as const;

export type EvalTaskKey = (typeof EVAL_TASKS)[number];

/**
 * The chassis default. `routing` is the task the pack was built for and the
 * one the required CI gate exercises; leaving it as the default is what keeps
 * every pre-existing entrypoint unchanged.
 */
export const DEFAULT_EVAL_TASK: EvalTaskKey = 'routing';

/** Narrow an arbitrary string to a task key, refusing anything unknown. */
export function parseEvalTask(value: string): EvalTaskKey {
  if ((EVAL_TASKS as readonly string[]).includes(value)) return value as EvalTaskKey;
  throw new Error(
    `unknown --task "${value}" (known tasks: ${EVAL_TASKS.join(', ')}). ` +
      'A task needs both a key here and an adapter in src/task-adapter.ts.',
  );
}
