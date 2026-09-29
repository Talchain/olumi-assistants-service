/**
 * Archive the PMS rows the prompt estate declares retired.
 *
 *   pnpm prompts:archive-retired                      # dry run (default)
 *   pnpm prompts:archive-retired -- --apply           # actually archive
 *   CEE_BASE_URL=https://cee-staging.onrender.com \
 *   ADMIN_API_KEY=… pnpm prompts:archive-retired -- --apply
 *
 * WHY A SCRIPT AND NOT A MIGRATION. PMS rows live in Supabase, not in this
 * repo, so retirement is a DATA change while the estate registry is a CODE
 * change. Keeping them separate is the point: the code declares the intent,
 * this script executes it against one deployment, and
 * `GET /admin/prompts/inventory` measures whether the two agree
 * (`archive_drift`). Nothing here asserts a state it did not just read.
 *
 * ## Safety
 *
 * - **Soft archive only.** `DELETE /admin/prompts/:id` WITHOUT `?hard=true`
 *   flips `status` to `archived` and leaves the full `versions[]` array
 *   untouched — served-version history is never lost. The script refuses to
 *   pass `hard`.
 * - **Inertness is re-derived at run time, not trusted.** An archived row stops
 *   resolving (`getActivePromptForTask` filters `status != 'archived'`), so the
 *   bundled code default takes over. A row is only archived when one of two
 *   proofs holds, checked here against THIS deployment:
 *
 *     1. EMPTY READER MANIFEST — no LLM operation maps to the task, so nothing
 *        can resolve it at all. Content is then irrelevant: a row with zero
 *        readers cannot change any served bytes. This is the case for the
 *        row-level retirements (`RETIRED_PMS_ROWS`), and the drift check
 *        asserts exactly that property of them, so the two cannot disagree.
 *     2. BYTE-IDENTITY — the task IS operation-reachable, but the row's SERVED
 *        version is byte-identical to the registered code default, so the
 *        swap is a no-op.
 *
 *   Anything else is SKIPped with the two hashes printed. Proof (1) is the one
 *   that matters: `enrich_factors` has drifted from its code constant, and
 *   archiving it is still provably safe *because nothing reads it* — that is a
 *   different claim from "the bytes match", and conflating them would either
 *   block a safe archive or bless an unsafe one.
 * - **`archive: 'blocked'` entries are never touched.**
 */

import { createHash } from 'node:crypto';
import { registerAllDefaultPrompts } from '../src/prompts/defaults.js';
import { getDefaultPrompts } from '../src/prompts/loader.js';
import { OPERATION_TASK_IDS } from '../src/prompts/operations.js';
import { ALL_RETIREMENTS, type RetirementEntry } from '../src/prompts/estate.js';

interface PromptVersionRow {
  version: number;
  content: string;
}
interface PromptRow {
  id: string;
  taskId: string;
  status: string;
  activeVersion: number;
  stagingVersion?: number | null;
  versions: PromptVersionRow[];
}

const BASE_URL = (process.env.CEE_BASE_URL ?? 'https://cee-staging.onrender.com').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? '';
const APPLY = process.argv.includes('--apply');

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'X-Admin-Key': ADMIN_KEY, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: T | null = null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Every retirement the estate declares, keyed by PMS row id. */
function declaredRetirements(): Map<string, RetirementEntry> {
  return new Map(ALL_RETIREMENTS.map((r) => [r.promptId, r]));
}

async function main(): Promise<void> {
  if (!ADMIN_KEY) {
    console.error('ADMIN_API_KEY is required (never hard-code it; export it from your env file).');
    process.exit(2);
  }

  registerAllDefaultPrompts();
  const defaults = getDefaultPrompts() as Record<string, string | undefined>;

  const list = await api<{ prompts: PromptRow[] }>('/admin/prompts');
  if (list.status !== 200 || !list.body) {
    console.error(`GET /admin/prompts failed: HTTP ${list.status}`);
    process.exit(1);
  }
  const rows = new Map(list.body.prompts.map((p) => [p.id, p]));
  const declared = declaredRetirements();
  const operationReachable = new Set<string>(OPERATION_TASK_IDS as readonly string[]);

  console.log(`${BASE_URL}  —  ${rows.size} PMS rows, ${declared.size} declared retirements`);
  console.log(APPLY ? 'MODE: APPLY (soft archive)\n' : 'MODE: DRY RUN (pass --apply to execute)\n');

  const plan: Array<{ id: string; action: string; detail: string }> = [];

  for (const [promptId, rec] of declared) {
    const row = rows.get(promptId);
    if (!row) {
      plan.push({ id: promptId, action: 'absent', detail: 'no such row in this deployment' });
      continue;
    }
    if (row.status === 'archived') {
      plan.push({ id: promptId, action: 'already-archived', detail: '' });
      continue;
    }
    if (rec.archive === 'blocked') {
      plan.push({ id: promptId, action: 'BLOCKED', detail: rec.blockedReason ?? '' });
      continue;
    }

    // PROOF 1 — empty reader manifest. No LLM operation maps to this task, so
    // nothing in the codebase can resolve it. Content is irrelevant.
    if (!operationReachable.has(row.taskId)) {
      plan.push({
        id: promptId,
        action: 'archive',
        detail: 'zero readers — no LLM operation maps to this task',
      });
      continue;
    }

    // PROOF 2 — byte-identity, re-derived against THIS deployment, now.
    const servedVersion = row.stagingVersion ?? row.activeVersion;
    const served = row.versions.find((v) => v.version === servedVersion);
    const defaultContent = defaults[row.taskId];

    if (!served) {
      plan.push({ id: promptId, action: 'SKIP', detail: `served version ${servedVersion} not in versions[]` });
      continue;
    }
    if (defaultContent === undefined) {
      plan.push({
        id: promptId,
        action: 'SKIP',
        detail: 'task IS operation-reachable but has no registered code default — archiving would make it unresolvable',
      });
      continue;
    }
    const servedHash = sha256(served.content);
    const defaultHash = sha256(defaultContent);
    if (servedHash !== defaultHash) {
      plan.push({
        id: promptId,
        action: 'SKIP',
        detail: `served v${servedVersion} (${servedHash.slice(0, 16)}) DIFFERS from code default (${defaultHash.slice(0, 16)}) — archiving would change bytes; declare it archive:'blocked' with a reason, or align the default first`,
      });
      continue;
    }
    plan.push({ id: promptId, action: 'archive', detail: `v${servedVersion} byte-identical to code default` });
  }

  for (const p of plan.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${p.action.padEnd(17)} ${p.id.padEnd(38)} ${p.detail}`);
  }

  const toArchive = plan.filter((p) => p.action === 'archive');
  console.log(`\n${toArchive.length} row(s) to archive.`);

  if (!APPLY) {
    console.log('Dry run — nothing changed.');
    return;
  }

  let ok = 0;
  for (const p of toArchive) {
    // Soft archive: NO ?hard=true. Version history is preserved.
    const res = await api(`/admin/prompts/${p.id}`, { method: 'DELETE' });
    if (res.status === 204) {
      ok++;
      console.log(`  archived  ${p.id}`);
    } else {
      console.error(`  FAILED    ${p.id} — HTTP ${res.status}`);
    }
  }

  // Verify at the bytes rather than trusting the 204s.
  const after = await api<{ prompts: PromptRow[] }>('/admin/prompts');
  const stillActive = (after.body?.prompts ?? []).filter((r) => r.status !== 'archived');
  console.log(`\narchived ${ok}/${toArchive.length}`);
  console.log(`rows now non-archived: ${stillActive.length} (${stillActive.map((r) => r.taskId).sort().join(', ')})`);
}

void main();
