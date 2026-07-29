/**
 * THE PROMPT ESTATE — one governance home, one derivable answer.
 *
 * ## The problem this file exists to kill
 *
 * "How many prompts do we have?" had three true answers, none derivable from
 * the others:
 *   - **23** — PMS rows registered in the store (`GET /admin/prompts`)
 *   - **5**  — what `/admin/prompts/status` tracked (a HAND-LISTED allowlist)
 *   - **10** — artefacts that actually shape a live LLM call
 *
 * The 5-key allowlist was a textbook hand-maintained mirror: `repair_edit_graph`
 * is PMS-registered AND live-callable (`orchestrator/tools/edit-graph.ts`, the
 * attempt-≥2 retry) and was invisible to the status endpoint because nobody
 * remembered to add it. The mirror failed toward INVISIBILITY, which is the
 * failure direction that never announces itself.
 *
 * ## The fix: derive, and make forgetting fail toward visibility
 *
 * `LIVE_PMS_TASKS` is DERIVED:
 *
 *     resolvable universe   = OPERATION_TASK_IDS ∪ alias logical keys
 *                             (minus alias TARGETS — a logical key and its
 *                             target are one artefact, reported once)
 *     LIVE_PMS_TASKS        = resolvable universe \ GATED \ RETIRED
 *
 * A prompt cannot be wired up at all without a row in `OPERATION_TO_TASK_ID`
 * (`src/prompts/operations.ts`) — `getSystemPrompt()` throws
 * `Unknown LLM operation` otherwise. So a newly wired prompt lands in the
 * resolvable universe automatically, is in neither exception list, and
 * therefore **appears on `/admin/prompts/status` and `/admin/prompts/inventory`
 * with nobody remembering anything.** Forgetting now over-reports, never
 * under-reports.
 *
 * The two exception lists (`GATED_PMS_TASKS`, `RETIRED_PMS_TASKS`) are the
 * only hand-declared facts left, and `tests/unit/prompt-estate-drift.test.ts`
 * fails loud on every way they can drift: an entry for a task that no longer
 * exists, a task in both lists, a gate naming an env var the config schema
 * does not define, a call site for a task the estate has never heard of, a
 * declared code-constant prompt whose export has gone.
 *
 * ## Two axes, deliberately kept apart
 *
 *  - **Disposition** (`live` / `gated` / `retired`) — what the estate REPORTS.
 *  - **Criticality** (`CRITICAL_PMS_TASKS`) — what `/healthz` GATES on
 *    (`prompts_ready`, `critical_prompts_pms`). A strict subset of live,
 *    compile-enforced by `satisfies readonly LivePmsTask[]`.
 *
 * Reporting is widened here; gating is NOT. Widening `all_pms` would change a
 * live health surface, which this slice deliberately does not do.
 */

import type { CeeTaskId } from './schema.js';
import { OPERATION_TASK_IDS, type OperationTask } from './operations.js';

// ============================================================================
// Alias
// ============================================================================

/**
 * PMS task-id alias for prompt RESOLUTION (the store lookup key).
 *
 * The CEE/V5 routing prompt IS the operator-managed `orchestrator` system
 * prompt (`olumi_orchestrator_system_prompt_v…`) — not a separate
 * user-managed prompt. The runtime logical key stays `routing` (so its
 * bundled default, size guard, and tracked-key reporting are unchanged),
 * but its PMS lookup resolves the `orchestrator` task so CEE serves the
 * prompt Paul manages. This mirrors the routing path's MODEL resolution,
 * which already uses `task_id='orchestrator'` (route-with-tool-use.ts).
 *
 * Resolution-only: the DEFAULT fallback deliberately stays the aliased
 * key's own registered default (`routing` → guard-safe v40), NEVER the
 * ~57k `orchestrator` v28 default, so a PMS-unavailable boot still passes
 * the routing [18.5k–22k] size guard.
 *
 * ESTATE CONSEQUENCE: `routing` and `orchestrator` are ONE artefact. The
 * estate reports the LOGICAL key (`routing`) and excludes the alias TARGET
 * (`orchestrator`) so the count is not inflated by the indirection.
 */
export const PMS_TASK_ALIAS = {
  routing: 'orchestrator',
} as const satisfies Partial<Record<CeeTaskId, CeeTaskId>>;

/** Logical keys that resolve a differently-named PMS task. */
export type AliasLogicalKey = keyof typeof PMS_TASK_ALIAS;
/** PMS tasks that exist only as the target of an alias. */
export type AliasTargetTask = (typeof PMS_TASK_ALIAS)[AliasLogicalKey];

/** The PMS task id used to RESOLVE a prompt for `key` (alias-aware). */
export function pmsResolveTaskId(key: CeeTaskId): CeeTaskId {
  return (PMS_TASK_ALIAS as Partial<Record<CeeTaskId, CeeTaskId>>)[key] ?? key;
}

// ============================================================================
// Disposition — the only hand-declared facts, both drift-guarded
// ============================================================================

/**
 * Tasks whose call site EXISTS and is wired, but sits behind a named,
 * off-by-default gate. They are REPORTED (so a gate flip can never silently
 * serve an unmonitored prompt) but are not `pms_required` — their PMS rows
 * are deliberately NOT archived, because archiving would change the bytes a
 * gate flip would serve.
 *
 * Value = the env var that gates the call site. The drift check asserts each
 * one is a real key in the config env schema, so a rename cannot rot this
 * into a lie.
 */
export const GATED_PMS_TASKS = {
  /** `src/cee/validation-pipeline/validate-graph.ts:52` */
  validate_graph: 'CEE_VALIDATION_PIPELINE_ENABLED',
  /** `src/cee/dual-draft/m2-review.ts:108` — registered default is a
   *  fail-closed sentinel (`src/cee/dual-draft/prompt-sentinel.ts`). */
  m2_graph_review: 'CEE_V6_DUAL_DRAFT_ENABLED',
} as const satisfies Partial<Record<OperationTask, string>>;

export type GatedPmsTask = keyof typeof GATED_PMS_TASKS;

/** Why a retired task is retired, and whether its PMS row can be archived. */
export interface RetirementRecord {
  /** Human-readable reason. Shown on `/admin/prompts/inventory`. */
  readonly reason: string;
  /**
   * `'archived'`  — the PMS row is archived (or safe to archive): resolving it
   *                 would return the same bytes as the bundled code default,
   *                 or the row has a proven-empty reader manifest.
   * `'blocked'`   — retirement is agreed but the PMS row is KEPT, because the
   *                 row's served content differs from the code default and its
   *                 call site is still registered. Archiving would change bytes
   *                 on a reachable (if uncalled) path. Declared, not silent.
   */
  readonly archive: 'archived' | 'blocked';
  /** Required when `archive === 'blocked'`. */
  readonly blockedReason?: string;
}

/**
 * PMS tasks with no live path. Their rows are archived (soft-archive: status
 * flips to `archived`, the version history is preserved in full — see
 * `stores/postgres.ts` / `stores/supabase.ts` `delete()`), except where
 * `archive: 'blocked'` records why not.
 *
 * NOTE ON `archived` STATUS SEMANTICS: `getActivePromptForTask()` filters
 * `status != 'archived'`, so an archived row stops resolving and the bundled
 * code default takes over. Every entry marked `archive: 'archived'` was
 * checked at the bytes on 2026-07-29: its served content hash equals the
 * registered code default's hash (so the swap is a no-op), or it has zero
 * readers.
 */
export const RETIRED_PMS_TASKS = {
  // --- Pre-V5 narrate architecture. V5 authors the answer INSIDE the routing
  // --- tool call (`answer_text`); there is no separate narrate call. Zero
  // --- call sites; all seeded v1 rows byte-identical to their code defaults.
  direct_answer_narrate: { reason: 'pre-V5 narrate architecture; V5 authors answers inside the routing tool call', archive: 'archived' },
  run_analysis_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  set_factor_value_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  add_constraint_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  adjust_edge_strength_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  explain_result_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  compare_options_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  what_would_flip_narrate: { reason: 'pre-V5 narrate architecture; never dispatched', archive: 'archived' },
  turn_classifier: { reason: 'pre-narrate turn classifier; V5 routing classifies inside the tool call', archive: 'archived' },

  // --- Dead /assist/* routes: registered, zero UI/V5 callers.
  suggest_options: { reason: 'only caller is POST /assist/suggest-options — zero UI/V5 callers', archive: 'archived' },
  clarify_brief: { reason: 'in-pipeline clarifier retired 2026-07-16; V5 clarify is deterministic', archive: 'archived' },
  critique_graph: {
    reason: 'only caller is POST /assist/critique-graph — zero UI/V5 callers',
    archive: 'blocked',
    blockedReason:
      'PMS v1 content (sha16 61af72978b498e56) DIFFERS from the bundled code default (eccb92d4b77cecb8), and the /assist/critique-graph route is still registered. Archiving would change the bytes that route serves. Row kept until the dead route is deleted.',
  },

  // --- Registered defaults with no call site at all.
  explainer: { reason: 'no call site; the /assist/explain-diff path uses a code-constant prompt', archive: 'archived' },
  bias_check: { reason: 'no call site; the bias_check route calls detectBiases() directly', archive: 'archived' },
} as const satisfies Partial<Record<OperationTask, RetirementRecord>>;

export type RetiredPmsTask = keyof typeof RETIRED_PMS_TASKS;

/**
 * PMS rows that are retired but sit OUTSIDE the resolvable universe: the code
 * cannot name them through an LLM operation, so they can never be resolved.
 * Keyed by PMS row id (not task id) because one of them is a schema orphan.
 */
export const RETIRED_PMS_ROWS: Readonly<Record<string, RetirementRecord & { readonly taskId: string }>> = Object.freeze({
  enrich_factors_default: {
    taskId: 'enrich_factors',
    reason:
      'zero-reader mirror: no operation maps to enrich_factors and no prompt-resolution call site names it. The live path reads the ENRICH_FACTORS_PROMPT code constant directly (services/review/enrichFactors.ts:429), which is why the row content has drifted from it.',
    archive: 'archived',
  },
  clarify_narrate_default: {
    taskId: 'clarify_narrate',
    reason:
      'SCHEMA ORPHAN: task_id "clarify_narrate" was removed from CeeTaskIdSchema on 2026-07-16 with the Stage-4 clarifier retirement, but the store row survived. Unreachable by construction — no CeeTaskId can name it.',
    archive: 'archived',
  },
});

// ============================================================================
// The derivation
// ============================================================================

/** Every task the code can resolve, reported once (alias targets folded in). */
export type ResolvablePmsTask = Exclude<OperationTask, AliasTargetTask> | AliasLogicalKey;

/**
 * DERIVED: PMS prompts on a live path.
 *
 * The `Exclude<>` keeps this a literal union, which is what lets
 * `CRITICAL_PMS_TASKS` be compile-checked as a subset — turn this into
 * `CeeTaskId[]` and that guarantee silently evaporates.
 */
export type LivePmsTask = Exclude<ResolvablePmsTask, GatedPmsTask | RetiredPmsTask>;

export interface EstateInputs {
  /** Task ids reachable through an LLM operation. */
  readonly operationTaskIds: readonly string[];
  /** Logical key → PMS task it resolves. */
  readonly aliases: Readonly<Record<string, string>>;
  /** Task id → env var gating its call site. */
  readonly gated: Readonly<Record<string, string>>;
  /** Task ids with no live path. */
  readonly retired: readonly string[];
}

export interface DerivedEstate {
  /** Everything reportable before the exception lists are applied. */
  readonly resolvable: readonly string[];
  /** resolvable \ gated \ retired. */
  readonly live: readonly string[];
  /** resolvable \ retired — what the status surface reports. */
  readonly reported: readonly string[];
}

/**
 * THE DERIVATION, as a pure function of its inputs.
 *
 * Exposed (rather than inlined) so the drift check can feed it a SYNTHETIC
 * operation map and prove the property that matters: a newly wired prompt
 * appears in `live` without being named anywhere. A test that only inspected
 * the frozen module-level constants could not distinguish "derived" from
 * "hand-listed and currently correct" — which is precisely the mistake the
 * old five-key allowlist embodied.
 */
export function deriveEstate(inputs: EstateInputs): DerivedEstate {
  const aliasTargets = new Set(Object.values(inputs.aliases));
  const gated = new Set(Object.keys(inputs.gated));
  const retired = new Set(inputs.retired);

  const resolvable = [
    ...inputs.operationTaskIds.filter((t) => !aliasTargets.has(t)),
    ...Object.keys(inputs.aliases),
  ];

  return Object.freeze({
    resolvable: Object.freeze(resolvable),
    live: Object.freeze(resolvable.filter((t) => !gated.has(t) && !retired.has(t))),
    reported: Object.freeze(resolvable.filter((t) => !retired.has(t))),
  });
}

const GATED_SET = new Set<string>(Object.keys(GATED_PMS_TASKS));
const RETIRED_SET = new Set<string>(Object.keys(RETIRED_PMS_TASKS));

/** The real estate, derived from the real inputs. */
export const ESTATE_INPUTS: EstateInputs = Object.freeze({
  operationTaskIds: OPERATION_TASK_IDS,
  aliases: PMS_TASK_ALIAS,
  gated: GATED_PMS_TASKS,
  retired: Object.keys(RETIRED_PMS_TASKS),
});

const DERIVED = deriveEstate(ESTATE_INPUTS);

export const RESOLVABLE_PMS_TASKS = DERIVED.resolvable as readonly ResolvablePmsTask[];
export const LIVE_PMS_TASKS = DERIVED.live as readonly LivePmsTask[];
/** DERIVED: live + gated — everything `/admin/prompts/status` reports. */
export const REPORTED_PMS_TASKS = DERIVED.reported as readonly ResolvablePmsTask[];

export type PromptDisposition = 'live' | 'gated' | 'retired';

/** Disposition of any task id. Unknown ids are `undefined`, never guessed. */
export function dispositionOf(taskId: string): PromptDisposition | undefined {
  if (RETIRED_SET.has(taskId)) return 'retired';
  if (GATED_SET.has(taskId)) return 'gated';
  if ((RESOLVABLE_PMS_TASKS as readonly string[]).includes(taskId)) return 'live';
  return undefined;
}

/** The env gate for a gated task, or undefined if the task is not gated. */
export function gateOf(taskId: string): string | undefined {
  return (GATED_PMS_TASKS as Record<string, string | undefined>)[taskId];
}

// ============================================================================
// Criticality — the health-gating subset (deliberately NOT widened)
// ============================================================================

/**
 * The prompts whose PMS resolution gates health: `/healthz` `prompts_ready`
 * and `critical_prompts_pms` (= `getCriticalPromptCoverage().all_pms`, the
 * "safe to arm fail-closed?" signal).
 *
 * A DELIBERATE, JUSTIFIED SUBSET of `LIVE_PMS_TASKS` — every one of these has
 * an operator-managed PMS row that MUST be what is served. `repair_edit_graph`
 * is live and is now REPORTED, but is not critical: it is a retry-only prompt
 * whose PMS content is currently byte-identical to its bundled default, so
 * gating boot health on it would add a failure mode without adding a signal.
 *
 * `satisfies readonly LivePmsTask[]` is the guarantee: if any key here is
 * ever moved to GATED or RETIRED, this line stops compiling.
 */
export const CRITICAL_PMS_TASKS = [
  'routing',
  'edit_graph',
  'draft_graph',
  'decision_review',
  'repair_graph',
] as const satisfies readonly LivePmsTask[];

export type CriticalPmsTask = (typeof CRITICAL_PMS_TASKS)[number];

// ============================================================================
// Canonical default versions — one map, was two
// ============================================================================

/**
 * Canonical version string for each task's REGISTERED CODE DEFAULT (the
 * bundled fallback served when PMS has no row / is unreachable).
 *
 * Collapses two hand-lists that mirrored the same fact with different keying:
 *   - `DEFAULT_VERSIONS` (src/prompts/tracked.ts) — keyed by tracked key
 *   - `FALLBACK_VERSIONS` (src/adapters/llm/prompt-loader.ts) — keyed by operation
 *
 * They are consistent, not redundant: `routing` and `orchestrator` are aliased
 * for RESOLUTION but have DIFFERENT registered defaults (routing → the
 * guard-safe v40; orchestrator → the legacy cf-v28 V4 mega-prompt), so both
 * belong here as separate entries. Keep in sync with `src/prompts/defaults*.ts`.
 */
export const DEFAULT_PROMPT_VERSIONS = {
  routing: 'v40',
  orchestrator: 'cf-v28',
  edit_graph: 'v6',
  draft_graph: 'v187',
  decision_review: 'v11',
  repair_graph: 'v6',
} as const satisfies Partial<Record<CeeTaskId, string>>;

// ============================================================================
// Code-constant prompts — the four artefacts PMS does not manage
// ============================================================================

/**
 * A prompt that shapes a live LLM call but lives as a TypeScript constant, not
 * a PMS row. Declared here so "how many prompts, which, what hash" has ONE
 * answer covering both halves of the estate.
 *
 * `load()` is a dynamic import ON PURPOSE: `coaching-pass.ts` and
 * `anthropic.ts` are heavy modules that transitively import the prompt loader.
 * A static import here would close the very cycle `operations.ts` was
 * extracted to break. The inventory endpoint is admin-only and cold, so
 * paying an import at request time costs nothing.
 */
export interface CodeConstantPrompt {
  /** Stable id. Matches the exported constant's name. */
  readonly id: string;
  /** Source module, for the drift check and for humans. */
  readonly sourceFile: string;
  /** Where it is sent to a model. */
  readonly callSite: string;
  /** Env var that can switch it off, if any. */
  readonly gate?: string;
  /** Why it is not in PMS (yet). */
  readonly note: string;
  /** Resolve the live content. Dynamic import — see above. */
  readonly load: () => Promise<string>;
}

export const CODE_CONSTANT_PROMPTS: readonly CodeConstantPrompt[] = Object.freeze([
  {
    id: 'COACHING_SYSTEM',
    sourceFile: 'src/cee/unified-pipeline/stages/coaching-pass.ts',
    callSite: 'coaching-pass.ts:379 — the coaching pass on every draft turn',
    note: 'PMS migration rowed; content is gated by the copy-quality lexicon and has its own COACHING_PROMPT_HASH telemetry.',
    load: async () =>
      (await import('../cee/unified-pipeline/stages/coaching-pass.js')).COACHING_SYSTEM,
  },
  {
    id: 'SUMMARISER_SYSTEM_PROMPT',
    sourceFile: 'src/orchestrator-v5/rolling-summary/summariser.ts',
    callSite: 'summariser.ts:84 — rolling summary at every commit seam (fire-and-forget)',
    note: 'PMS migration rowed.',
    load: async () =>
      (await import('../orchestrator-v5/rolling-summary/summariser.js')).SUMMARISER_SYSTEM_PROMPT,
  },
  {
    id: 'ENRICH_FACTORS_PROMPT',
    sourceFile: 'src/prompts/enrich-factors.ts',
    callSite: 'services/review/enrichFactors.ts:429 — POST /assist/v1/review enrichment',
    note:
      'A PMS row `enrich_factors` exists but has ZERO readers and its content has drifted from this constant. The row is retired (see RETIRED_PMS_ROWS); this constant is what is served.',
    load: async () => (await import('./enrich-factors.js')).ENRICH_FACTORS_PROMPT,
  },
  {
    id: 'DRAFT_COMPLIANCE_REMINDER',
    sourceFile: 'src/adapters/llm/anthropic.ts',
    callSite: 'anthropic.ts:425 / openai.ts:568 — appended to the draft user message',
    gate: 'CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED',
    note:
      'Duplicated byte-for-byte in the OpenAI adapter; the drift check asserts the two copies stay identical.',
    load: async () => (await import('../adapters/llm/anthropic.js')).DRAFT_COMPLIANCE_REMINDER,
  },
]);
