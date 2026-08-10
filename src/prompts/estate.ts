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
 * The live set is DERIVED:
 *
 *     resolvable universe   = OPERATION_TASK_IDS ∪ alias logical keys
 *                             (minus alias TARGETS — a logical key and its
 *                             target are one artefact, reported once)
 *     live                  = resolvable universe \ GATED \ RETIRED
 *
 * A prompt cannot be wired up at all without a row in `OPERATION_TO_TASK_ID`
 * (`src/prompts/operations.ts`) — `getSystemPrompt()` throws
 * `Unknown LLM operation` otherwise. So a newly wired prompt lands in the
 * resolvable universe automatically, is in neither exception list, and
 * therefore **appears on `/admin/prompts/status` and `/admin/prompts/inventory`
 * with nobody remembering anything.** Forgetting now over-reports, never
 * under-reports.
 *
 * ## ⚠ EXACTLY HOW FAR THAT GUARANTEE REACHES
 *
 * It covers **PMS-resolved prompts only**. The code-constant half
 * (`CODE_CONSTANT_PROMPTS`) is a DECLARED registry, drift-checked but not
 * complete-by-construction — see the long note on `CodeConstantPrompt`. Quote
 * the two halves separately or not at all; `/admin/prompts/inventory` carries
 * a `derivation` block saying so, so the caveat travels with the number.
 *
 * ## GATE STATE IS MEASURED, NOT RECORDED
 *
 * `GATED_PMS_TASKS` was originally a task → env-var-NAME map, and the drift
 * check only asserted the name existed in config. The adversarial review of
 * PR #753 ran the constructed case: with both gate flags ON, the whole suite
 * passed 33/33 GREEN while the inventory kept reporting `pms_live: 6` and
 * `validate_graph` as `gated` — silently false forever, no RED anywhere. The
 * mirror had not died; it had moved into the subtraction terms.
 *
 * Every gate now carries a `GateDeclaration` with an `isActive()` reader, and
 * `deriveLiveEstate()` re-runs the SAME pure derivation with the gates that
 * are genuinely inactive on this process. A flipped gate moves its prompt into
 * `live` on `/status`, on `/inventory`, and in the totals.
 *
 * `tests/unit/prompt-estate-drift.test.ts` fails loud on every way the
 * remaining hand-declared facts can drift: an entry for a task that no longer
 * exists, a task in both lists, a gate whose reader does not track the env var
 * it names, a gate whose default silently flips, a call site for a task the
 * estate has never heard of, a declared code-constant prompt whose export has
 * gone. What it CANNOT catch is a deployment-level env flip (CI cannot see
 * Render's environment) — which is precisely why `gate_active` is reported at
 * runtime rather than asserted at build time.
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
import { config } from '../config/index.js';

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
 * A named gate on a prompt's call site.
 *
 * ## Why this is not just a string
 *
 * The first version of this registry stored only the env var NAME, and the
 * drift check only asserted that the name appeared in the config schema. That
 * left the gate's actual STATE unmeasured, and the adversarial review's
 * constructed case passed 33/33 GREEN: with both flags flipped ON, the
 * inventory still reported `pms_live: 6` and `validate_graph` as `gated` —
 * silently false, forever, with nothing failing loud. The mirror had not died;
 * it had moved into the subtraction terms.
 *
 * So a gate now carries a READER. `isActive()` reads the live config at call
 * time, which is what turns the estate's gate handling from RECORDED into
 * MEASURED — the same promise `/admin/prompts/inventory` makes about every
 * other number it reports.
 *
 * `defaultsTo` is the value the config schema is expected to yield with the
 * env var unset. It exists so the drift check can assert it BY MEASUREMENT
 * (unset the env, read `isActive()`) rather than by matching source text — and
 * so that flipping a code-level default is loud rather than silent. CI cannot
 * see a deployment's Render env, so this is the only gate drift a test can
 * catch; the runtime `gate_active` field covers the rest.
 */
export interface GateDeclaration {
  /** Env var that gates the call site. */
  readonly env: string;
  /** Reads the CURRENT value from config. Measured at call time, never cached. */
  readonly isActive: () => boolean;
  /** Value expected when the env var is unset. Asserted by measurement in CI. */
  readonly defaultsTo: boolean;
}

/**
 * Tasks whose call site EXISTS and is wired, but sits behind a named,
 * off-by-default gate. They are always REPORTED (so a gate flip can never
 * silently serve an unmonitored prompt) but are not `pms_required` — their PMS
 * rows are deliberately NOT archived, because archiving would change the bytes
 * a gate flip would serve.
 *
 * When a gate is ACTIVE the task is `live`, not `gated`, and the request-time
 * totals say so — see `deriveLiveEstate()`.
 */
export const GATED_PMS_TASKS = {
  /** `src/cee/validation-pipeline/validate-graph.ts` -> `callValidateGraph()` */
  // DEFAULT FLIPPED false → true on 2026-08-03 (ROADMAP 2.146 activation). The
  // call site is unchanged; what changed is that the capability now ships ON, so
  // `validate_graph` is LIVE at defaults and its env var is a kill-switch rather
  // than an enable. It stays in this map — NOT promoted out of it — precisely so
  // `gate_active` keeps being reported on `/status` and `/inventory`: a task with
  // a live kill-switch is exactly the thing an operator needs to see the state of.
  validate_graph: {
    env: 'CEE_VALIDATION_PIPELINE_ENABLED',
    isActive: () => config.cee.validationPipelineEnabled === true,
    defaultsTo: true,
  },
  /** `src/cee/dual-draft/m2-review.ts:108` — registered default is a
   *  fail-closed sentinel (`src/cee/dual-draft/prompt-sentinel.ts`). */
  m2_graph_review: {
    env: 'CEE_V6_DUAL_DRAFT_ENABLED',
    isActive: () => config.features.v6DualDraftEnabled === true,
    defaultsTo: false,
  },
} as const satisfies Partial<Record<OperationTask, GateDeclaration>>;

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

/**
 * Every declared retirement, task-level and row-level, as ONE typed list.
 *
 * Three consumers (the inventory endpoint, the archive script, the drift
 * check) each needed to merge `RETIRED_PMS_TASKS` with `RETIRED_PMS_ROWS`.
 * Three copies of a merge is three chances to merge it differently, so the
 * merge lives here once.
 *
 * The explicit `RetirementRecord` element type matters: the `as const
 * satisfies` above narrows each entry to its own literal shape, so the raw
 * union does not carry `blockedReason` on the members that omit it. Widening
 * here keeps the optional field reachable without an `as` cast at three
 * different call sites.
 */
export interface RetirementEntry extends RetirementRecord {
  /** PMS row id. */
  readonly promptId: string;
  /** The task the row belongs to (may not be a valid CeeTaskId — see orphans). */
  readonly taskId: string;
}

export const ALL_RETIREMENTS: readonly RetirementEntry[] = Object.freeze([
  ...Object.entries(RETIRED_PMS_TASKS).map(
    ([taskId, rec]): RetirementEntry => ({ ...rec, taskId, promptId: `${taskId}_default` }),
  ),
  ...Object.entries(RETIRED_PMS_ROWS).map(
    ([promptId, rec]): RetirementEntry => ({ ...rec, promptId }),
  ),
]);

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

const RETIRED_SET = new Set<string>(Object.keys(RETIRED_PMS_TASKS));

const ALL_GATE_ENVS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(GATED_PMS_TASKS).map(([task, g]) => [task, g.env])),
);

/**
 * The gates that are INACTIVE at their shipped code default — DERIVED from each
 * declaration's own `defaultsTo`, never assumed.
 *
 * ⚠ THIS USED TO BE `ALL_GATE_ENVS`, i.e. "every gate is off at default", and
 * that assumption drifted the moment one wasn't (`CEE_VALIDATION_PIPELINE_ENABLED`
 * shipped ON on 2026-08-03, ROADMAP 2.146). The assumption was invisible because
 * it lived in a variable NAME rather than in a predicate — the same
 * hand-maintained-mirror shape this whole module was built to remove, one level
 * up from where it was removed. The gate-defaults suite caught it, loudly and
 * with the right instruction in its message, which is the mechanism working.
 *
 * Deriving it means a future gate that ships ON needs no edit here.
 */
const GATE_ENVS_INACTIVE_AT_DEFAULT: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(GATED_PMS_TASKS)
      .filter(([, g]) => g.defaultsTo === false)
      .map(([task, g]) => [task, g.env]),
  ),
);

/**
 * The estate inputs AT DEFAULT GATE STATE — each gate at its OWN declared
 * default (not "all off"; see `GATE_ENVS_INACTIVE_AT_DEFAULT`).
 *
 * This is the COMPILE-TIME anchor: it is what gives `LivePmsTask` its literal
 * union, which is what lets `CRITICAL_PMS_TASKS` be compile-checked as a
 * subset. It is NOT the runtime truth — a deployment can flip any gate either
 * way. For that, call `deriveLiveEstate()`.
 */
export const ESTATE_INPUTS: EstateInputs = Object.freeze({
  operationTaskIds: OPERATION_TASK_IDS,
  aliases: PMS_TASK_ALIAS,
  gated: GATE_ENVS_INACTIVE_AT_DEFAULT,
  retired: Object.keys(RETIRED_PMS_TASKS),
});

const DERIVED_AT_DEFAULT_GATES = deriveEstate(ESTATE_INPUTS);

export const RESOLVABLE_PMS_TASKS =
  DERIVED_AT_DEFAULT_GATES.resolvable as readonly ResolvablePmsTask[];

/**
 * PMS prompts on a live path WHEN EVERY GATE IS INACTIVE.
 *
 * ⚠ NOT the runtime live set — the name says `AT_DEFAULT_GATES` because a
 * deployment with `CEE_VALIDATION_PIPELINE_ENABLED=true` is serving one more
 * than this. Use `deriveLiveEstate().live` for anything a human will read as
 * "how many prompts are live". This constant exists to anchor the
 * `LivePmsTask` type and the compile-time `CRITICAL_PMS_TASKS` subset check.
 */
export const LIVE_PMS_TASKS_AT_DEFAULT_GATES =
  DERIVED_AT_DEFAULT_GATES.live as readonly LivePmsTask[];

/**
 * DERIVED: live + gated — everything `/admin/prompts/status` reports.
 *
 * Gate state does NOT affect this set: a gated prompt is reported whether its
 * gate is on or off. That is the invariant that makes "a gate flip can never
 * serve an unmonitored prompt" true.
 */
export const REPORTED_PMS_TASKS =
  DERIVED_AT_DEFAULT_GATES.reported as readonly ResolvablePmsTask[];

// ---------------------------------------------------------------------------
// Measured gate state — the runtime truth
// ---------------------------------------------------------------------------

/** Task ids whose gate is ACTIVE right now (measured from config). */
export function activeGateTasks(): string[] {
  return Object.entries(GATED_PMS_TASKS)
    .filter(([, g]) => g.isActive())
    .map(([task]) => task);
}

/**
 * The estate as it actually is on THIS process, right now.
 *
 * A gate that is ON removes its task from the `gated` subtraction term, so the
 * task lands in `live` — which is the whole point: `deriveEstate()` was already
 * a pure function taking `gated` as an input, and this feeds it the truth
 * instead of the assumption.
 */
export function deriveLiveEstate(): DerivedEstate {
  const active = new Set(activeGateTasks());
  const stillGated = Object.fromEntries(
    Object.entries(ALL_GATE_ENVS).filter(([task]) => !active.has(task)),
  );
  return deriveEstate({ ...ESTATE_INPUTS, gated: stillGated });
}

export type PromptDisposition = 'live' | 'gated' | 'retired';

/**
 * Disposition of any task id, MEASURED — a gated task whose gate is currently
 * active reports `live`, not `gated`. Unknown ids are `undefined`, never
 * guessed.
 *
 * Reads config. That is deliberate: the previous version answered from a
 * static set and was therefore capable of reporting `gated` about a prompt
 * that was serving on every draft turn.
 */
export function dispositionOf(taskId: string): PromptDisposition | undefined {
  if (RETIRED_SET.has(taskId)) return 'retired';
  const gate = (GATED_PMS_TASKS as Record<string, GateDeclaration | undefined>)[taskId];
  if (gate) return gate.isActive() ? 'live' : 'gated';
  if ((RESOLVABLE_PMS_TASKS as readonly string[]).includes(taskId)) return 'live';
  return undefined;
}

/** The env gate NAME for a gated task, or undefined if the task is not gated. */
export function gateOf(taskId: string): string | undefined {
  return (GATED_PMS_TASKS as Record<string, GateDeclaration | undefined>)[taskId]?.env;
}

/**
 * Whether a gated task's gate is ACTIVE right now, or undefined when the task
 * carries no gate. This is the field whose absence let the constructed drift
 * case pass green.
 */
export function gateActiveOf(taskId: string): boolean | undefined {
  return (GATED_PMS_TASKS as Record<string, GateDeclaration | undefined>)[taskId]?.isActive();
}

// ============================================================================
// Criticality — the health-gating subset (deliberately NOT widened)
// ============================================================================

/**
 * The prompts whose PMS resolution gates health: `/healthz` `prompts_ready`
 * and `critical_prompts_pms` (= `getCriticalPromptCoverage().all_pms`, the
 * "safe to arm fail-closed?" signal).
 *
 * A DELIBERATE, JUSTIFIED SUBSET of the live set — every one of these has
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
// ^ `LivePmsTask` is the AT-DEFAULT-GATES union, which is the strictest of the
//   two: a gate flip can only ADD to the live set, never remove from it, so a
//   critical key that compiles here is live under every gate configuration.

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
  decision_review: 'v11.1',
  repair_graph: 'v6',
} as const satisfies Partial<Record<CeeTaskId, string>>;

// ============================================================================
// Code-constant prompts — the four artefacts PMS does not manage
// ============================================================================

/**
 * A prompt that shapes an LLM call but lives as a TypeScript constant, not a
 * PMS row.
 *
 * ## ⚠ THE SCOPE OF THE GUARANTEE — read this before quoting a number
 *
 * The PMS half of the estate is DERIVED: a prompt cannot be resolved through
 * the loader without a row in `OPERATION_TO_TASK_ID`, so it cannot hide.
 * **This half is not.** It is a DECLARED REGISTRY. Each entry is drift-checked
 * (it must load, from a file that exists, and its hash is measured not
 * recorded), but the registry's COMPLETENESS is reviewed, never derived: no
 * static scan can see an inline `client.messages.create({ system: "…" })`, and
 * pretending a grep sweep settles it would be the same guarantee-theatre this
 * file exists to remove.
 *
 * The adversarial review of PR #753 proved the cost of getting that wrong: the
 * first version declared FOUR entries and claimed "it can no longer hide a
 * prompt". Seven artefacts were missing — five of them GATED, so a single flag
 * flip would have served four unmonitored decompose prompts. They are declared
 * below. Adding a code-constant prompt without adding it here is still
 * possible; the honest claim is scoped accordingly, and deriving this half is
 * a rowed follow-up.
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
  /**
   * `live`     — reaches a model on a normal path (subject to `gate`).
   * `fallback` — reached only when a primary source fails.
   */
  readonly disposition: 'live' | 'fallback';
  /**
   * Gate on the call site, if any. Same measured `GateDeclaration` the PMS half
   * uses — so a flag flip reclassifies a code constant exactly as it does a PMS
   * prompt, and `defaultsTo` is asserted by measurement in CI.
   */
  readonly gate?: GateDeclaration;
  /** Why it is not in PMS (yet). */
  readonly note: string;
  /** Resolve the live content. Dynamic import — see above. */
  readonly load: () => Promise<string>;
}

const DECOMPOSE_GATE: GateDeclaration = {
  env: 'CEE_DECISION_REVIEW_DECOMPOSE',
  isActive: () => config.cee.decisionReviewDecompose === true,
  defaultsTo: false,
};

export const CODE_CONSTANT_PROMPTS: readonly CodeConstantPrompt[] = Object.freeze([
  // --- live, ungated ---
  {
    id: 'COACHING_SYSTEM',
    sourceFile: 'src/cee/unified-pipeline/stages/coaching-pass.ts',
    callSite: 'coaching-pass.ts:379 — the coaching pass on every draft turn',
    disposition: 'live',
    note: 'PMS migration rowed; output is gated by the copy-quality lexicon and it has its own COACHING_PROMPT_HASH telemetry.',
    load: async () =>
      (await import('../cee/unified-pipeline/stages/coaching-pass.js')).COACHING_SYSTEM,
  },
  {
    id: 'SUMMARISER_SYSTEM_PROMPT',
    sourceFile: 'src/orchestrator-v5/rolling-summary/summariser.ts',
    callSite: 'summariser.ts:84 — rolling summary at every commit seam (fire-and-forget)',
    disposition: 'live',
    note: 'PMS migration rowed.',
    load: async () =>
      (await import('../orchestrator-v5/rolling-summary/summariser.js')).SUMMARISER_SYSTEM_PROMPT,
  },
  {
    id: 'ENRICH_FACTORS_PROMPT',
    sourceFile: 'src/prompts/enrich-factors.ts',
    callSite: 'services/review/enrichFactors.ts:429 — POST /assist/v1/review enrichment',
    disposition: 'live',
    note:
      'A PMS row `enrich_factors` exists but has ZERO readers and its content has drifted from this constant. The row is retired (see RETIRED_PMS_ROWS); this constant is what is served.',
    load: async () => (await import('./enrich-factors.js')).ENRICH_FACTORS_PROMPT,
  },
  {
    id: 'DRAFT_COMPLIANCE_REMINDER',
    sourceFile: 'src/adapters/llm/anthropic.ts',
    callSite: 'anthropic.ts:429 / openai.ts:571 — appended to the draft user message',
    disposition: 'live',
    gate: {
      env: 'CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED',
      isActive: () => config.cee.draftComplianceReminderEnabled === true,
      // NOTE the direction: this gate defaults ON. `defaultsTo` is asserted by
      // measurement, so a gate that defaults true is stated as true rather than
      // quietly assumed to match the off-by-default ones.
      defaultsTo: true,
    },
    note:
      'Duplicated byte-for-byte in the OpenAI adapter; the drift check asserts the two copies stay identical.',
    load: async () => (await import('../adapters/llm/anthropic.js')).DRAFT_COMPLIANCE_REMINDER,
  },
  // --- live, retry-only fragments. Declared for the same reason the compliance
  // --- reminder is: they are appended to a real draft call. The boundary
  // --- between "prompt" and "fragment" was previously drawn silently, which is
  // --- how two live artefacts stayed invisible.
  {
    id: 'DRAFT_LEAN_RETRY_DIRECTIVE',
    sourceFile: 'src/cee/constants.ts',
    callSite: 'draft retry attempts (lean-draft contract)',
    disposition: 'live',
    note: 'Fires only on a draft retry, so it does not reach a model on every turn — but it does reach one on a normal path.',
    load: async () => (await import('../cee/constants.js')).DRAFT_LEAN_RETRY_DIRECTIVE,
  },
  {
    id: 'STRENGTH_DEFAULT_RETRY_NUDGE',
    sourceFile: 'src/cee/constants.ts',
    callSite: 'draft retry attempts (edge-strength defaults)',
    disposition: 'live',
    note: 'Fires only on a draft retry. Same class as DRAFT_LEAN_RETRY_DIRECTIVE.',
    load: async () => (await import('../cee/constants.js')).STRENGTH_DEFAULT_RETRY_NUDGE,
  },
  // --- gated: a single flag flip serves each of these, and until the review
  // --- caught it the inventory had never heard of any of them.
  {
    id: 'FACTOR_EXTRACTION_SYSTEM_PROMPT',
    sourceFile: 'src/cee/factor-extraction/llm-extractor.ts',
    callSite: 'llm-extractor.ts:154 — LLM-first factor/constraint extraction',
    disposition: 'live',
    gate: {
      env: 'CEE_LLM_FIRST_EXTRACTION_ENABLED',
      isActive: () => config.cee.llmFirstExtractionEnabled === true,
      defaultsTo: false,
    },
    note: 'Regex extraction runs while the gate is off.',
    load: async () =>
      (await import('../cee/factor-extraction/llm-extractor.js')).FACTOR_EXTRACTION_SYSTEM_PROMPT,
  },
  {
    id: 'DECOMPOSE_R1_HEADLINE_PROMPT',
    sourceFile: 'src/cee/decision-review/decompose-prompts.ts',
    callSite: 'decompose.ts 4x-parallel haiku fan-out — R1 headline verdict',
    disposition: 'live',
    gate: DECOMPOSE_GATE,
    note: 'ONE flag serves all four decompose prompts; the byte-identical monolith path runs while it is off.',
    load: async () =>
      (await import('../cee/decision-review/decompose-prompts.js')).DECOMPOSE_R1_HEADLINE_PROMPT,
  },
  {
    id: 'DECOMPOSE_R2_DRIVER_PROMPT',
    sourceFile: 'src/cee/decision-review/decompose-prompts.ts',
    callSite: 'decompose.ts 4x-parallel haiku fan-out — R2 evidence gaps',
    disposition: 'live',
    gate: DECOMPOSE_GATE,
    note: 'See DECOMPOSE_R1_HEADLINE_PROMPT.',
    load: async () =>
      (await import('../cee/decision-review/decompose-prompts.js')).DECOMPOSE_R2_DRIVER_PROMPT,
  },
  {
    id: 'DECOMPOSE_R3_FRAGILITY_PROMPT',
    sourceFile: 'src/cee/decision-review/decompose-prompts.ts',
    callSite: 'decompose.ts 4x-parallel haiku fan-out — R3 stability / flips',
    disposition: 'live',
    gate: DECOMPOSE_GATE,
    note: 'See DECOMPOSE_R1_HEADLINE_PROMPT.',
    load: async () =>
      (await import('../cee/decision-review/decompose-prompts.js')).DECOMPOSE_R3_FRAGILITY_PROMPT,
  },
  {
    id: 'DECOMPOSE_R4_CALIBRATION_PROMPT',
    sourceFile: 'src/cee/decision-review/decompose-prompts.ts',
    callSite: 'decompose.ts 4x-parallel haiku fan-out — R4 calibration layer',
    disposition: 'live',
    gate: DECOMPOSE_GATE,
    note: 'See DECOMPOSE_R1_HEADLINE_PROMPT.',
    load: async () =>
      (await import('../cee/decision-review/decompose-prompts.js')).DECOMPOSE_R4_CALIBRATION_PROMPT,
  },
  // --- fallback only ---
  {
    id: '_DRAFT_SYSTEM_PROMPT',
    sourceFile: 'src/adapters/llm/anthropic.ts',
    callSite: 'last-resort draft system prompt — served only when PMS AND the registered default both fail',
    disposition: 'fallback',
    note: 'Not counted as live: reaching it means two prior sources already failed.',
    load: async () => (await import('../adapters/llm/anthropic.js'))._DRAFT_SYSTEM_PROMPT,
  },
]);

/** A code constant is LIVE now iff its disposition is `live` and its gate (if
 *  any) is currently ACTIVE. Measured, like the PMS half. */
export function isCodeConstantLiveNow(p: CodeConstantPrompt): boolean {
  return p.disposition === 'live' && (p.gate ? p.gate.isActive() : true);
}

/** Every gate declared anywhere in the estate, PMS half and code half. */
export function allGateDeclarations(): Array<{ owner: string; gate: GateDeclaration }> {
  return [
    ...Object.entries(GATED_PMS_TASKS).map(([owner, gate]) => ({ owner, gate })),
    ...CODE_CONSTANT_PROMPTS.filter((p) => p.gate).map((p) => ({
      owner: p.id,
      gate: p.gate as GateDeclaration,
    })),
  ];
}
