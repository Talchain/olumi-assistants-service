#!/usr/bin/env tsx
/**
 * Admin script: set model_config.{staging,production} on wired prompt
 * store entries.
 *
 * Brief: v5-group2-model-routing-hygiene (Task B). Addresses V5-048.
 *
 * CC authors and runs this script in dry-run only. Paul executes against
 * a live environment after review.
 *
 * Safety:
 *   - Required --target flag; refuses to run without it.
 *   - Environment guard: SUPABASE_URL must match SUPABASE_URL_<TARGET>
 *     if set, and must end with the hardcoded host suffix (.supabase.co).
 *   - MODEL_CANONICAL_ALLOWLIST: the target strings are hard-checked
 *     against a small allowlist before any IO.
 *   - Before-state snapshot AND rollback file are written before any
 *     mutation. If either write fails, the script aborts.
 *   - Per-task allowlist: only the nine wired task ids can be modified.
 *     Unwired tasks (bias_check_default, critique_graph_default,
 *     suggest_options_default) are never referenced.
 *   - Dry-run by default. Requires --execute to apply.
 *   - Idempotent: tasks with current === target are skipped.
 *
 * Usage:
 *   # Dry-run (default)
 *   pnpm exec tsx scripts/admin/set-model-configs.ts --target staging
 *
 *   # Apply
 *   pnpm exec tsx scripts/admin/set-model-configs.ts --target staging --execute
 *
 *   # Rollback (apply a previously written rollback patch set)
 *   pnpm exec tsx scripts/admin/set-model-configs.ts --rollback-file scripts/admin/snapshots/model-config-rollback-staging-<ts>.json --execute
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TASK_MODEL_DEFAULTS } from '../../src/config/model-routing.js';
import { SupabasePromptStore } from '../../src/prompts/stores/supabase.js';
import type { PromptDefinition, ModelConfig } from '../../src/prompts/schema.js';

// ── Constants ───────────────────────────────────────────────────────────

/** Wired prompt store entries to be updated. Hardcoded allowlist. */
export const WIRED_TARGETS: ReadonlyArray<{
  readonly id: string;
  readonly staging: string;
  readonly production: string;
}> = [
  { id: 'orchestrator_default',      staging: 'claude-sonnet-4-6',  production: 'claude-sonnet-4-6' },
  { id: 'draft_graph_default',       staging: 'claude-sonnet-4-6',  production: 'claude-sonnet-4-6' },
  { id: 'edit_graph_default',        staging: 'claude-sonnet-4-6',  production: 'claude-sonnet-4-6' },
  { id: 'repair_graph_default',      staging: 'gpt-4.1-2025-04-14', production: 'gpt-4.1-2025-04-14' },
  { id: 'decision_review_default',   staging: 'gpt-4.1-2025-04-14', production: 'gpt-4.1-2025-04-14' },
  { id: 'explainer_default',         staging: 'claude-sonnet-4-6',  production: 'claude-sonnet-4-6' },
  { id: 'validate_graph_default',    staging: 'gpt-4.1-2025-04-14', production: 'gpt-4.1-2025-04-14' },
  { id: 'repair_edit_graph_default', staging: 'gpt-4.1-2025-04-14', production: 'gpt-4.1-2025-04-14' },
  { id: 'clarify_brief_default',     staging: 'gpt-4.1-2025-04-14', production: 'gpt-4.1-2025-04-14' },
];

/**
 * Exact canonical model strings permitted as target values.
 * Any target string outside this set is rejected before IO.
 */
export const MODEL_CANONICAL_ALLOWLIST: ReadonlyArray<string> = [
  'claude-sonnet-4-6',
  'gpt-4.1-2025-04-14',
];

/** Supabase URL host suffix guard. */
const ALLOWED_SUPABASE_HOST_SUFFIX = '.supabase.co';

// ── Types ───────────────────────────────────────────────────────────────

export type Target = 'staging' | 'production';

export interface RunOptions {
  readonly target?: Target;
  readonly execute: boolean;
  readonly verbose: boolean;
  readonly rollbackFile?: string;
}

export interface SnapshotEntry {
  readonly id: string;
  readonly before: ModelConfig | null;
  readonly target: { readonly staging: string; readonly production: string };
}

export interface RollbackFile {
  readonly target: Target;
  readonly timestamp: string;
  readonly supabaseUrlHost: string;
  readonly patches: ReadonlyArray<{ readonly id: string; readonly modelConfig: ModelConfig | null }>;
}

/**
 * Injectable dependencies. Tests replace `store` and `fs`; production
 * wires real deps.
 */
export interface RunDeps {
  readonly store: Pick<SupabasePromptStore, 'initialize' | 'get' | 'update'>;
  readonly fs: {
    readonly mkdirSync: (path: string, opts?: { recursive: true }) => void;
    readonly writeFileSync: (path: string, content: string) => void;
  };
  readonly now: () => Date;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface RunResult {
  readonly exitCode: 0 | 1 | 2;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly snapshotPath?: string;
  readonly rollbackPath?: string;
}

// ── Pure helpers ────────────────────────────────────────────────────────

/**
 * Validate that every target entry's staging/production strings appear
 * in the canonical allowlist. Returns an array of violations; empty
 * means all strings are canonical.
 */
export function validateTargetStrings(
  targets: ReadonlyArray<{ id: string; staging: string; production: string }>,
  allowlist: ReadonlyArray<string>,
): string[] {
  const violations: string[] = [];
  const set = new Set(allowlist);
  for (const t of targets) {
    if (!set.has(t.staging)) violations.push(`${t.id}.staging='${t.staging}' is not in MODEL_CANONICAL_ALLOWLIST`);
    if (!set.has(t.production)) violations.push(`${t.id}.production='${t.production}' is not in MODEL_CANONICAL_ALLOWLIST`);
  }
  return violations;
}

/**
 * Compare current model_config to target. Returns 'match' when both
 * staging and production equal the target; 'update' otherwise.
 */
export function diffModelConfig(
  current: ModelConfig | null | undefined,
  target: { staging: string; production: string },
): 'match' | 'update' {
  if (!current) return 'update';
  return current.staging === target.staging && current.production === target.production
    ? 'match'
    : 'update';
}

/**
 * Validate the Supabase URL against the target-specific env var (when
 * set) and the hardcoded host suffix. Returns null on success or an
 * error message on failure.
 */
export function checkUrlAllowlist(
  target: Target,
  env: NodeJS.ProcessEnv,
): { host: string } | { error: string } {
  const url = env.SUPABASE_URL;
  if (!url) return { error: 'SUPABASE_URL is not set.' };
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { error: `SUPABASE_URL is not a valid URL: '${url}'` };
  }
  if (!host.endsWith(ALLOWED_SUPABASE_HOST_SUFFIX)) {
    return { error: `SUPABASE_URL host '${host}' does not end with '${ALLOWED_SUPABASE_HOST_SUFFIX}'` };
  }
  const expectedKey = target === 'staging' ? 'SUPABASE_URL_STAGING' : 'SUPABASE_URL_PRODUCTION';
  const expected = env[expectedKey];
  if (expected && expected !== url) {
    return {
      error:
        `SUPABASE_URL mismatch for --target ${target}. ` +
        `SUPABASE_URL='${url}' but ${expectedKey}='${expected}'. ` +
        `Refusing to proceed to prevent cross-environment writes.`,
    };
  }
  return { host };
}

// ── Core runner ─────────────────────────────────────────────────────────

/**
 * Main script logic. Returns a RunResult instead of calling process.exit
 * so tests can assert behaviour. Never mutates anything unless opts.execute
 * is true AND all guards pass.
 */
export async function run(opts: RunOptions, deps: RunDeps): Promise<RunResult> {
  // ── Flag validation ───────────────────────────────────────────────
  if (!opts.target && !opts.rollbackFile) {
    deps.stderr('Error: --target <staging|production> is required (or --rollback-file for rollback).');
    return { exitCode: 2, updated: 0, skipped: 0, failed: 0 };
  }
  if (opts.target && opts.target !== 'staging' && opts.target !== 'production') {
    deps.stderr(`Error: --target must be 'staging' or 'production', got '${opts.target}'`);
    return { exitCode: 2, updated: 0, skipped: 0, failed: 0 };
  }

  // Rollback mode reads patches from a file and applies them; for brevity
  // the forward flow covers both because the apply step is identical.
  // (We defer full rollback UX to a future brief per the plan; the file
  // exists and is loadable but --rollback-file forward-mode is gated off
  // until explicitly wired.)
  if (opts.rollbackFile) {
    deps.stderr('Error: --rollback-file mode is not yet wired in this script. Re-run without it.');
    return { exitCode: 2, updated: 0, skipped: 0, failed: 0 };
  }

  const target = opts.target!;

  // ── Env + allowlist guards ────────────────────────────────────────
  const urlCheck = checkUrlAllowlist(target, deps.env);
  if ('error' in urlCheck) {
    deps.stderr(`Error: ${urlCheck.error}`);
    return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
  }
  const supabaseUrlHost = urlCheck.host;

  if (!deps.env.SUPABASE_SERVICE_ROLE_KEY) {
    deps.stderr('Error: SUPABASE_SERVICE_ROLE_KEY is not set.');
    return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
  }

  // ── Canonical string allowlist ────────────────────────────────────
  const violations = validateTargetStrings(WIRED_TARGETS, MODEL_CANONICAL_ALLOWLIST);
  if (violations.length > 0) {
    deps.stderr('Error: target strings failed canonical allowlist:');
    for (const v of violations) deps.stderr(`  - ${v}`);
    return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
  }

  // ── Store init ────────────────────────────────────────────────────
  try {
    await deps.store.initialize();
  } catch (err) {
    deps.stderr(`Error: store.initialize failed: ${(err as Error).message}`);
    return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
  }

  // ── Read current state ────────────────────────────────────────────
  const snapshot: SnapshotEntry[] = [];
  for (const t of WIRED_TARGETS) {
    let prompt: PromptDefinition | null;
    try {
      prompt = await deps.store.get(t.id);
    } catch (err) {
      deps.stderr(`Error: store.get('${t.id}') failed: ${(err as Error).message}`);
      return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
    }
    if (!prompt) {
      deps.stderr(`Error: wired prompt '${t.id}' not found in store.`);
      return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
    }
    snapshot.push({
      id: t.id,
      before: prompt.modelConfig ?? null,
      target: { staging: t.staging, production: t.production },
    });
  }

  // ── Write snapshot + rollback BEFORE any mutation (hard prerequisite) ──
  const ts = deps
    .now()
    .toISOString()
    .replace(/[:.]/g, '-');
  const snapshotPath = resolve(
    `scripts/admin/snapshots/model-config-before-${target}-${ts}.json`,
  );
  const rollbackPath = resolve(
    `scripts/admin/snapshots/model-config-rollback-${target}-${ts}.json`,
  );
  const rollback: RollbackFile = {
    target,
    timestamp: deps.now().toISOString(),
    supabaseUrlHost,
    patches: snapshot.map((s) => ({ id: s.id, modelConfig: s.before })),
  };

  try {
    deps.fs.mkdirSync(dirname(snapshotPath), { recursive: true });
    deps.fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        { target, timestamp: rollback.timestamp, supabaseUrlHost, entries: snapshot },
        null,
        2,
      ),
    );
    deps.fs.writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2));
  } catch (err) {
    // Hard prerequisite: if either write fails, abort before any mutation.
    deps.stderr(
      `Error: failed to write snapshot or rollback before mutation: ${(err as Error).message}`,
    );
    deps.stderr('Aborting: no store.update calls issued.');
    return { exitCode: 1, updated: 0, skipped: 0, failed: 0 };
  }
  deps.stdout(`Snapshot:  ${snapshotPath}`);
  deps.stdout(`Rollback:  ${rollbackPath}`);

  // ── Comparison table ──────────────────────────────────────────────
  deps.stdout('');
  deps.stdout(`Planned changes (target=${target}, host=${supabaseUrlHost}):`);
  deps.stdout('');
  deps.stdout('  id                           | code_default             | current                           | target                             | action');
  deps.stdout('  -----------------------------+--------------------------+-----------------------------------+------------------------------------+-------');
  for (const s of snapshot) {
    const codeDefault = (TASK_MODEL_DEFAULTS as Record<string, string | undefined>)[stripDefaultSuffix(s.id)] ?? '(unmapped)';
    const current = s.before
      ? `s=${s.before.staging ?? '-'} p=${s.before.production ?? '-'}`
      : '(null)';
    const targetStr = `s=${s.target.staging} p=${s.target.production}`;
    const action = diffModelConfig(s.before, s.target) === 'match' ? 'NO CHANGE' : 'UPDATE';
    const divergenceNote = codeDefault !== s.target.staging ? ' [DIVERGES FROM CODE DEFAULT]' : '';
    deps.stdout(
      `  ${pad(s.id, 28)} | ${pad(codeDefault, 24)} | ${pad(current, 33)} | ${pad(targetStr, 34)} | ${action}${divergenceNote}`,
    );
  }
  deps.stdout('');

  // ── Dry-run exit ─────────────────────────────────────────────────
  if (!opts.execute) {
    deps.stdout('Dry run complete. Pass --execute to apply.');
    return { exitCode: 0, updated: 0, skipped: 0, failed: 0, snapshotPath, rollbackPath };
  }

  // ── Execute mode ─────────────────────────────────────────────────
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const s of snapshot) {
    const action = diffModelConfig(s.before, s.target);
    if (action === 'match') {
      skipped += 1;
      deps.stdout(`  skip   ${s.id}: already matches`);
      continue;
    }
    try {
      await deps.store.update(s.id, {
        modelConfig: { staging: s.target.staging, production: s.target.production },
      });
      updated += 1;
      deps.stdout(`  update ${s.id}: staging=${s.target.staging} production=${s.target.production}`);
    } catch (err) {
      failed += 1;
      deps.stderr(`  FAIL   ${s.id}: ${(err as Error).message}`);
    }
  }
  deps.stdout('');
  deps.stdout(`Done. Updated ${updated}/${WIRED_TARGETS.length}, skipped ${skipped}, failed ${failed}.`);

  return {
    exitCode: failed > 0 ? 1 : 0,
    updated,
    skipped,
    failed,
    snapshotPath,
    rollbackPath,
  };
}

/**
 * Strip '_default' suffix to look up TASK_MODEL_DEFAULTS by CeeTask key.
 * e.g. 'orchestrator_default' -> 'orchestrator'. 'repair_edit_graph_default'
 * has no TASK_MODEL_DEFAULTS entry and returns unmapped.
 */
function stripDefaultSuffix(id: string): string {
  return id.endsWith('_default') ? id.slice(0, -'_default'.length) : id;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// ── CLI entry ───────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      execute: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      'rollback-file': { type: 'string' },
    },
    strict: true,
  });

  const store = new SupabasePromptStore({
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  });

  const opts: RunOptions = {
    target: values.target as Target | undefined,
    execute: Boolean(values.execute),
    verbose: Boolean(values.verbose),
    rollbackFile: values['rollback-file'],
  };

  const result = await run(opts, {
    store,
    fs: { mkdirSync, writeFileSync },
    now: () => new Date(),
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });

  return result.exitCode;
}

// Only run when invoked directly, not when imported by tests.
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('set-model-configs.ts') || process.argv[1].endsWith('set-model-configs.js'));

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('Unhandled error:', err);
      process.exit(1);
    });
}
