/**
 * THE ONE DERIVABLE ANSWER to "how many prompts do we have, which, what hash".
 *
 * Serves `GET /admin/prompts/inventory`. Everything here is DERIVED:
 *
 *   - PMS half      → `probeStatusPrompts()` over `STATUS_KEYS`, which is
 *                     `REPORTED_PMS_TASKS` (the operation map minus the two
 *                     drift-guarded exception lists in `estate.ts`).
 *   - code-constant → `CODE_CONSTANT_PROMPTS`, hashed by loading the actual
 *                     exported constant (not a recorded number that can rot).
 *   - store counts  → a live `store.list()`, so the endpoint can report its
 *                     OWN archive drift instead of asserting a state it never
 *                     checked.
 *
 * The last point is the important one. A retirement declared in code but never
 * executed against the store is exactly the kind of claim this programme keeps
 * getting burned by, so the endpoint measures it: `archive_drift` names every
 * row declared retired-and-archived whose store status says otherwise.
 */

import { createHash } from 'node:crypto';
import {
  ALL_RETIREMENTS,
  CODE_CONSTANT_PROMPTS,
  CRITICAL_PMS_TASKS,
  GATED_PMS_TASKS,
  activeGateTasks,
  deriveLiveEstate,
  isCodeConstantLiveNow,
  type RetirementRecord,
} from './estate.js';
import { probeStatusPrompts, type PromptKeyStatus } from './readiness.js';
import { getPromptStore } from './store.js';
import { isPromptManagementEnabled } from './loader.js';
import { log } from '../utils/telemetry.js';

function shortSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export interface CodeConstantPromptStatus {
  id: string;
  source: 'code_constant';
  source_file: string;
  call_site: string;
  /** `live` (subject to `gate_active`) or `fallback`. */
  disposition: 'live' | 'fallback';
  gate?: string;
  /** MEASURED from config at request time, like the PMS half. */
  gate_active?: boolean;
  /** True iff this constant reaches a model on a normal path RIGHT NOW. */
  live_now: boolean;
  note: string;
  content_hash: string | null;
  content_chars: number | null;
  error?: string;
}

export interface RetiredRowStatus {
  task_id: string;
  /** PMS row id, when the retirement is declared per-row rather than per-task. */
  prompt_id?: string;
  reason: string;
  archive: RetirementRecord['archive'];
  blocked_reason?: string;
  /** Live store status, or null when the store could not be read. */
  store_status: string | null;
}

export interface PromptEstateInventory {
  /**
   * The headline. `live_llm_call_prompts` is the honest answer to "how many
   * prompts shape a live LLM call" — and it is computed from the MEASURED gate
   * state on this process, so a deployment with a gate flipped ON reports the
   * larger number rather than a comfortable constant.
   */
  totals: {
    live_llm_call_prompts: number;
    pms_live: number;
    /** Code constants live RIGHT NOW (gate-aware). */
    code_constants_live: number;
    /** Every declared code-constant entry, live or not. */
    code_constants_declared: number;
    /** Gated prompts whose gate is currently OFF (PMS + code halves). */
    gated_inactive: number;
    /** Gated prompts whose gate is currently ON — already counted as live. */
    gated_active: number;
    pms_retired: number;
    pms_critical: number;
    /** Non-archived rows in the store, or null if the store was unreadable. */
    pms_rows_active: number | null;
    /** Every row in the store regardless of status, or null. */
    pms_rows_total: number | null;
  };
  /**
   * The scope of the guarantee, carried IN the payload so it travels with any
   * number quoted from it. The PMS half is derived; the code half is declared.
   */
  derivation: {
    pms_half: string;
    code_constant_half: string;
  };
  /** Env vars measured this request, and what they read. */
  gates: Array<{ owner: string; env: string; active: boolean }>;
  pms: PromptKeyStatus[];
  code_constants: CodeConstantPromptStatus[];
  retired: RetiredRowStatus[];
  /**
   * Rows declared `archive: 'archived'` in code whose store status is NOT
   * `archived`. Empty is the healthy state; non-empty means the code-side
   * retirement was never executed (or was undone) against this deployment.
   */
  archive_drift: string[];
  /** Null when the store could not be read — never silently treated as empty. */
  store_read_ok: boolean;
  generated_at: string;
}

/** Hash every declared code-constant prompt by loading it for real. */
export async function buildCodeConstantInventory(): Promise<CodeConstantPromptStatus[]> {
  return Promise.all(
    CODE_CONSTANT_PROMPTS.map(async (p): Promise<CodeConstantPromptStatus> => {
      const base = {
        id: p.id,
        source: 'code_constant' as const,
        source_file: p.sourceFile,
        call_site: p.callSite,
        disposition: p.disposition,
        ...(p.gate ? { gate: p.gate.env, gate_active: p.gate.isActive() } : {}),
        live_now: isCodeConstantLiveNow(p),
        note: p.note,
      };
      try {
        const content = await p.load();
        if (typeof content !== 'string' || content.length === 0) {
          return {
            ...base,
            content_hash: null,
            content_chars: null,
            error: `export ${p.id} resolved to a non-string or empty value`,
          };
        }
        return { ...base, content_hash: shortSha256(content), content_chars: content.length };
      } catch (err) {
        return {
          ...base,
          content_hash: null,
          content_chars: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

/**
 * Read every store row's status, keyed by prompt id. Returns null (not an
 * empty map) when the store cannot be read, so callers can tell "no rows"
 * apart from "did not look" — the absence-assertion discipline.
 */
async function readStoreStatuses(): Promise<Map<string, { status: string; taskId: string }> | null> {
  if (!isPromptManagementEnabled()) return null;
  try {
    const rows = await getPromptStore().list();
    return new Map(rows.map((r) => [r.id, { status: r.status, taskId: r.taskId }]));
  } catch (err) {
    log.warn({ err }, 'prompt inventory: store list failed');
    return null;
  }
}

export async function buildPromptEstateInventory(): Promise<PromptEstateInventory> {
  const [pms, codeConstants, storeStatuses] = await Promise.all([
    probeStatusPrompts('status'),
    buildCodeConstantInventory(),
    readStoreStatuses(),
  ]);

  const retired: RetiredRowStatus[] = [];
  const archiveDrift: string[] = [];

  for (const rec of ALL_RETIREMENTS) {
    const storeStatus = storeStatuses
      ? (storeStatuses.get(rec.promptId)?.status ?? 'absent')
      : null;
    retired.push({
      task_id: rec.taskId,
      ...(rec.promptId !== `${rec.taskId}_default` ? { prompt_id: rec.promptId } : {}),
      reason: rec.reason,
      archive: rec.archive,
      ...(rec.blockedReason ? { blocked_reason: rec.blockedReason } : {}),
      store_status: storeStatus,
    });
    // Drift is only observable when the store was actually read. A null status
    // means "did not look", which must never be reported as "not archived".
    if (
      rec.archive === 'archived' &&
      storeStatus !== null &&
      storeStatus !== 'archived' &&
      storeStatus !== 'absent'
    ) {
      archiveDrift.push(rec.promptId);
    }
  }

  const activeRows = storeStatuses
    ? [...storeStatuses.values()].filter((r) => r.status !== 'archived').length
    : null;

  // MEASURED, at request time. `deriveLiveEstate()` re-runs the same pure
  // derivation with the gates that are actually inactive on this process, so a
  // flipped gate moves its task from `gated` into `live` here and in the
  // totals — the single fact the endpoint used to record rather than measure.
  const live = deriveLiveEstate();
  const pmsGatesActive = activeGateTasks();
  const codeLiveNow = CODE_CONSTANT_PROMPTS.filter(isCodeConstantLiveNow);
  const codeGates = CODE_CONSTANT_PROMPTS.filter((p) => p.gate);
  const codeGatesActive = codeGates.filter((p) => p.gate!.isActive());

  return {
    totals: {
      live_llm_call_prompts: live.live.length + codeLiveNow.length,
      pms_live: live.live.length,
      code_constants_live: codeLiveNow.length,
      code_constants_declared: CODE_CONSTANT_PROMPTS.length,
      gated_inactive:
        Object.keys(GATED_PMS_TASKS).length -
        pmsGatesActive.length +
        (codeGates.length - codeGatesActive.length),
      gated_active: pmsGatesActive.length + codeGatesActive.length,
      pms_retired: retired.length,
      pms_critical: CRITICAL_PMS_TASKS.length,
      pms_rows_active: activeRows,
      pms_rows_total: storeStatuses ? storeStatuses.size : null,
    },
    derivation: {
      pms_half:
        'DERIVED. A prompt cannot be resolved through the loader without a row in OPERATION_TO_TASK_ID, so it cannot hide from this list.',
      code_constant_half:
        'DECLARED REGISTRY, drift-checked by hash and liveness but NOT complete-by-construction. No static scan can see an inline messages.create({system}) call. Completeness is reviewed, not derived.',
    },
    gates: [
      ...Object.entries(GATED_PMS_TASKS).map(([owner, g]) => ({
        owner,
        env: g.env,
        active: g.isActive(),
      })),
      ...codeGates.map((p) => ({ owner: p.id, env: p.gate!.env, active: p.gate!.isActive() })),
    ],
    pms,
    code_constants: codeConstants,
    retired,
    archive_drift: archiveDrift,
    store_read_ok: storeStatuses !== null,
    generated_at: new Date().toISOString(),
  };
}
