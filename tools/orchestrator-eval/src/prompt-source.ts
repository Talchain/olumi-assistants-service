/**
 * orchestrator-eval — SEAM-1 candidate prompt sources.
 *
 * A candidate is named on the CLI as `--prompt <label>=<ref>`. Three ref
 * schemes:
 *
 *   <path>          a file on disk containing the FULL candidate prompt text
 *                   (e.g. a v42.x working copy). Read eagerly — no network.
 *   pms:<version>   a PMS version of the RUN'S TASK (`--task`, default
 *                   `routing`), resolved through the repo's own prompt store
 *                   (src/prompts/store.ts getCompiled(task, {}, {version})).
 *                   The task key is the same string the runtime passes to
 *                   `getSystemPrompt(...)`, so a pms: ref resolves the prompt
 *                   the runtime actually serves for that task.
 *                   LIVE-MODE ONLY: resolution needs the store backend
 *                   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or
 *                   PROMPTS_POSTGRES_URL), i.e. a network call — the offline
 *                   default path must stay zero-network, so a pms: ref outside
 *                   live mode is refused. The store module is imported
 *                   DYNAMICALLY so the default path never loads it.
 *   mock:<label>    offline plumbing proof: instead of producing a response
 *                   from a model, the run PLAYS BACK the fixture's recorded
 *                   candidate with this label (wrapped in the v30.3 JSON
 *                   envelope, so the extraction path is exercised too). This
 *                   is how the end-to-end pipeline is proven green with zero
 *                   paid calls.
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_EVAL_TASK, type EvalTaskKey } from './tasks.js';

export type PromptSourceKind = 'file' | 'pms' | 'mock';

export interface CandidatePromptSpec {
  /** CLI label, e.g. "A" | "B" | "coach-arm". */
  readonly label: string;
  /** The raw ref as given on the CLI. */
  readonly ref: string;
  readonly kind: PromptSourceKind;
  /** For file refs: the prompt text (read eagerly). Null for pms/mock. */
  readonly promptText: string | null;
  /** For mock refs: the recorded-candidate label to play back. */
  readonly mockLabel: string | null;
  /** For pms refs: the requested version number. */
  readonly pmsVersion: number | null;
}

/** Parse one `<label>=<ref>` CLI value into a spec. File refs are read eagerly. */
export function parsePromptSpec(value: string): CandidatePromptSpec {
  const eq = value.indexOf('=');
  if (eq <= 0 || eq === value.length - 1) {
    throw new Error(`--prompt expects <label>=<ref>, got "${value}"`);
  }
  const label = value.slice(0, eq);
  const ref = value.slice(eq + 1);

  if (ref.startsWith('mock:')) {
    const mockLabel = ref.slice('mock:'.length);
    if (!mockLabel) throw new Error(`mock ref needs a recorded-candidate label: "${value}"`);
    return { label, ref, kind: 'mock', promptText: null, mockLabel, pmsVersion: null };
  }

  if (ref.startsWith('pms:')) {
    const version = Number(ref.slice('pms:'.length));
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`pms ref needs a positive integer version: "${value}"`);
    }
    return { label, ref, kind: 'pms', promptText: null, mockLabel: null, pmsVersion: version };
  }

  // Anything else is a file path. Read eagerly so a typo fails before any
  // model call is planned.
  const promptText = readFileSync(ref, 'utf-8');
  if (promptText.trim().length === 0) {
    throw new Error(`prompt file is empty: "${ref}"`);
  }
  return { label, ref, kind: 'file', promptText, mockLabel: null, pmsVersion: null };
}

/**
 * Resolve a pms: ref to prompt text through the repo's own prompt store.
 * LIVE-MODE ONLY (caller enforces). Dynamic import keeps the store — and its
 * config/telemetry import chain — out of the offline default path entirely.
 *
 * `task` defaults to `routing` so every pre-existing call site is unchanged.
 * It is the SAME key the runtime resolves prompts under, so `pms:14` on task
 * `decision_review` is the prompt staging actually serves for a review.
 */
export async function resolvePmsPromptText(
  version: number,
  task: EvalTaskKey = DEFAULT_EVAL_TASK,
): Promise<string> {
  const { getPromptStore } = await import('../../../src/prompts/store.js');
  const store = getPromptStore();
  await store.initialize();
  const compiled = await store.getCompiled(task, {}, { version });
  if (!compiled) {
    throw new Error(
      `PMS has no '${task}' prompt at version ${version} (store returned null). ` +
        'Check the version number against /admin/prompts on the target environment.',
    );
  }
  return compiled.content;
}
