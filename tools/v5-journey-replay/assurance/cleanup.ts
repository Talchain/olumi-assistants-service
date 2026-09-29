/**
 * V5 staging assurance — exact-ID, child-first scenario cleanup.
 *
 * Cleanup correctness is load-bearing: a suite that leaves residual staging
 * data behind is not acceptable. This module deletes ONLY the scenario IDs
 * the run created, child-first, across the seven scenario-keyed tables that
 * exist on cee-staging (verified live, project etmmuzwxtcjipwphdola), then
 * re-counts to prove zero residual.
 *
 * It talks to the database only through the `TableAccess` abstraction
 * (`./supabase.ts`), so the unit tests exercise ordering, exact-ID scoping,
 * zero-residual verification, and cleanup-after-failure with a pure mock —
 * no database required.
 *
 * Tolerances (per the brief): a table may legitimately have zero matching
 * rows, and a table may be absent on a given deploy. Neither is a failure.
 * A non-missing-table error IS a failure and is surfaced.
 */

import type { TableAccess } from './supabase.js';

/**
 * Child-first deletion order. Children before parents so a row is never
 * orphaned even though FKs are ON DELETE CASCADE (explicit deletion is
 * auditable and does not rely on cascade semantics):
 *   v5_handler_facts  → child of v5_conversation_turns (+ scenario)
 *   turn_observations → child of scenario
 *   v5_conversation_turns → child of scenario
 *   conversation_turns (legacy) → child of scenario
 *   scenario_snapshots → child of scenario
 *   shared_briefs → child of scenario
 *   scenarios → the parent, deleted LAST, scoped by `id`
 */
export const CLEANUP_ORDER: ReadonlyArray<{
  readonly table: string;
  readonly scopeColumn: string;
}> = [
  { table: 'v5_handler_facts', scopeColumn: 'scenario_id' },
  { table: 'turn_observations', scopeColumn: 'scenario_id' },
  { table: 'v5_conversation_turns', scopeColumn: 'scenario_id' },
  { table: 'conversation_turns', scopeColumn: 'scenario_id' },
  { table: 'scenario_snapshots', scopeColumn: 'scenario_id' },
  { table: 'shared_briefs', scopeColumn: 'scenario_id' },
  { table: 'scenarios', scopeColumn: 'id' },
];

export interface TableCleanupResult {
  readonly table: string;
  readonly scopeColumn: string;
  readonly deleted: number;
  readonly tableMissing: boolean;
  readonly error?: string;
}

export interface CleanupSummary {
  readonly results: readonly TableCleanupResult[];
  readonly totalDeleted: number;
  /** True when any table op errored for a non-missing-table reason. */
  readonly hadError: boolean;
  readonly scenarioIds: readonly string[];
}

export interface ResidualTableResult {
  readonly table: string;
  readonly scopeColumn: string;
  readonly residual: number;
  readonly tableMissing: boolean;
  readonly error?: string;
}

export interface ResidualSummary {
  readonly results: readonly ResidualTableResult[];
  readonly totalResidual: number;
  /** True when total residual is 0 AND no read errored. */
  readonly clean: boolean;
  readonly hadError: boolean;
  readonly scenarioIds: readonly string[];
}

/**
 * Delete the given scenario IDs child-first across all scenario-keyed
 * tables. Never touches rows outside `scenarioIds`. Missing tables are
 * recorded (tableMissing) and skipped, not failed.
 */
export async function cleanupScenarios(
  access: TableAccess,
  scenarioIds: readonly string[],
): Promise<CleanupSummary> {
  const results: TableCleanupResult[] = [];
  let totalDeleted = 0;
  let hadError = false;

  if (scenarioIds.length === 0) {
    return { results, totalDeleted: 0, hadError: false, scenarioIds };
  }

  for (const { table, scopeColumn } of CLEANUP_ORDER) {
    const op = await access.remove(table, scopeColumn, scenarioIds);
    if (op.error) hadError = true;
    totalDeleted += op.count;
    results.push({
      table,
      scopeColumn,
      deleted: op.count,
      tableMissing: op.tableMissing,
      ...(op.error ? { error: op.error } : {}),
    });
  }

  return { results, totalDeleted, hadError, scenarioIds };
}

/**
 * Count remaining rows for the given scenario IDs across every table. A
 * clean result requires every count to be 0 (missing tables count as 0)
 * and no read error.
 */
export async function verifyZeroResidual(
  access: TableAccess,
  scenarioIds: readonly string[],
): Promise<ResidualSummary> {
  const results: ResidualTableResult[] = [];
  let totalResidual = 0;
  let hadError = false;

  if (scenarioIds.length === 0) {
    return { results, totalResidual: 0, clean: true, hadError: false, scenarioIds };
  }

  for (const { table, scopeColumn } of CLEANUP_ORDER) {
    const op = await access.count(table, scopeColumn, scenarioIds);
    if (op.error) hadError = true;
    totalResidual += op.count;
    results.push({
      table,
      scopeColumn,
      residual: op.count,
      tableMissing: op.tableMissing,
      ...(op.error ? { error: op.error } : {}),
    });
  }

  return {
    results,
    totalResidual,
    clean: totalResidual === 0 && !hadError,
    hadError,
    scenarioIds,
  };
}

/**
 * Cleanup then verify, in one call. This is what the orchestrator runs in
 * its `finally` block so cleanup is attempted even when assertions failed.
 */
export async function cleanupAndVerify(
  access: TableAccess,
  scenarioIds: readonly string[],
): Promise<{ cleanup: CleanupSummary; residual: ResidualSummary }> {
  const cleanup = await cleanupScenarios(access, scenarioIds);
  const residual = await verifyZeroResidual(access, scenarioIds);
  return { cleanup, residual };
}
