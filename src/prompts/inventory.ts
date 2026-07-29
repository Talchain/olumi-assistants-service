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
  CODE_CONSTANT_PROMPTS,
  CRITICAL_PMS_TASKS,
  GATED_PMS_TASKS,
  LIVE_PMS_TASKS,
  RETIRED_PMS_ROWS,
  RETIRED_PMS_TASKS,
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
  gate?: string;
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
   * prompts do we have" — artefacts that shape a live LLM call today.
   */
  totals: {
    live_llm_call_prompts: number;
    pms_live: number;
    code_constants: number;
    pms_gated: number;
    pms_retired: number;
    pms_critical: number;
    /** Non-archived rows in the store, or null if the store was unreadable. */
    pms_rows_active: number | null;
    /** Every row in the store regardless of status, or null. */
    pms_rows_total: number | null;
  };
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

/** Hash the four code-constant prompts by loading them for real. */
export async function buildCodeConstantInventory(): Promise<CodeConstantPromptStatus[]> {
  return Promise.all(
    CODE_CONSTANT_PROMPTS.map(async (p): Promise<CodeConstantPromptStatus> => {
      const base = {
        id: p.id,
        source: 'code_constant' as const,
        source_file: p.sourceFile,
        call_site: p.callSite,
        ...(p.gate ? { gate: p.gate } : {}),
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

  const record = (taskId: string, promptId: string, rec: RetirementRecord): void => {
    const storeStatus = storeStatuses ? (storeStatuses.get(promptId)?.status ?? 'absent') : null;
    retired.push({
      task_id: taskId,
      ...(promptId !== `${taskId}_default` ? { prompt_id: promptId } : {}),
      reason: rec.reason,
      archive: rec.archive,
      ...(rec.blockedReason ? { blocked_reason: rec.blockedReason } : {}),
      store_status: storeStatus,
    });
    if (
      rec.archive === 'archived' &&
      storeStatus !== null &&
      storeStatus !== 'archived' &&
      storeStatus !== 'absent'
    ) {
      archiveDrift.push(promptId);
    }
  };

  for (const [taskId, rec] of Object.entries(RETIRED_PMS_TASKS)) {
    record(taskId, `${taskId}_default`, rec);
  }
  for (const [promptId, rec] of Object.entries(RETIRED_PMS_ROWS)) {
    record(rec.taskId, promptId, rec);
  }

  const activeRows = storeStatuses
    ? [...storeStatuses.values()].filter((r) => r.status !== 'archived').length
    : null;

  return {
    totals: {
      live_llm_call_prompts: LIVE_PMS_TASKS.length + CODE_CONSTANT_PROMPTS.length,
      pms_live: LIVE_PMS_TASKS.length,
      code_constants: CODE_CONSTANT_PROMPTS.length,
      pms_gated: Object.keys(GATED_PMS_TASKS).length,
      pms_retired: retired.length,
      pms_critical: CRITICAL_PMS_TASKS.length,
      pms_rows_active: activeRows,
      pms_rows_total: storeStatuses ? storeStatuses.size : null,
    },
    pms,
    code_constants: codeConstants,
    retired,
    archive_drift: archiveDrift,
    store_read_ok: storeStatuses !== null,
    generated_at: new Date().toISOString(),
  };
}
