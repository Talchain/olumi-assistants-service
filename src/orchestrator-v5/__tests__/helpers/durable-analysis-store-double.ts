/**
 * Store-double helpers for the durable scenario `run_analysis` authority.
 *
 * WHY THIS EXISTS — AND WHY IT IS NOT A GLOBAL MOCK.
 *
 * `build-turn-context.fetchPriorFacts` derives the hot window from the
 * with-turn read whenever that read is non-empty:
 *
 *   facts = factsWithTurn.length > 0
 *     ? factsWithTurn.map((w) => w.fact)
 *     : await store.readFactsFor(priorTurnRowIds);
 *
 * so in production the two reads return THE SAME OBJECT OCCURRENCES.
 * `reconcile-scenario-analysis-facts.classifyHotFacts` relies on exactly that:
 * it matches each eligible hot fact to its persisted identity with
 * `unmatchedIdentified.indexOf(factObject)` — BY REFERENCE, deliberately, so a
 * caller supplying cloned payloads cannot acquire row identity by payload
 * resemblance. A double that implements only `readFactsFor` therefore yields
 * `candidates=N, withIdentity=0`, the set degrades to
 * `hot_window_contract_invalid`, and every freshness verdict on the turn reads
 * `unknown`. That is CORRECT product behaviour against a defective double.
 *
 * These helpers give a spec the production-shaped pair. Each spec opts in from
 * inside its OWN `vi.mock` factory; nothing here is installed globally, because
 * many suites deliberately override the fact reads to exercise degraded paths
 * and a shared/automatic fix would silently repair the very thing they pin.
 *
 * ⚠ THE OMISSION THAT LOOKS LIKE SUCCESS: `IdentifiedHandlerFact` needs ALL of
 * `{ fact, fact_row_id, fact_created_at }`. Drop `fact_created_at` (or
 * `fact_row_id`) and `parseIdentifiedRunAnalysisFact` returns null, the
 * identified count stays at 0, and the outcome is byte-identical to not having
 * seeded anything at all. Use {@link assertDurableAnalysisSeeded} so the
 * precondition is pinned in-test rather than assumed.
 */

import { expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  reconcileScenarioAnalysisFacts,
  SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
} from '../../context/reconcile-scenario-analysis-facts.js';
import type {
  HandlerFactWithTurn,
  IdentifiedHandlerFact,
} from '../../types/handler-fact.js';

/** Shape of `SessionStore.readScenarioRunAnalysisFactsFor`'s resolution. */
export interface ScenarioRunAnalysisFactPageDouble {
  readonly facts: readonly IdentifiedHandlerFact[];
  readonly total_count: number;
}

/**
 * Fixed base instant for synthetic row timestamps.
 *
 * Both reads derive `fact_created_at` from the fact's index in the SAME hot
 * array, so the durable page and the hot identities always agree —
 * `identifiedSnapshotIncludes` compares them and a disagreement is a
 * `snapshot_conflict`, which degrades just as loudly as a missing field.
 */
const BASE_INSTANT_MS = Date.parse('2026-04-17T11:00:00.000Z');

/** Index 0 is the NEWEST row, matching `readFactsFor`'s `created_at DESC`. */
export function testFactCreatedAt(index: number): string {
  return new Date(BASE_INSTANT_MS - index * 1000).toISOString();
}

/** Stable synthetic persisted identity for the fact at `index`. */
export function testFactRowId(index: number): string {
  return `test-fact-row-${index}`;
}

function isEligibleRunAnalysis(fact: unknown, scenarioId: string): boolean {
  if (fact === null || typeof fact !== 'object' || Array.isArray(fact)) return false;
  const record = fact as Record<string, unknown>;
  if (record.fact_type !== 'run_analysis') return false;
  if (record.noop === true) return false;
  const result = record.result;
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return false;
  }
  return (result as Record<string, unknown>).scenario_id === scenarioId;
}

/**
 * The with-turn read, production-shaped.
 *
 * Returns the SAME fact object occurrences it was handed — never clones.
 * `readFactsFor` on the same double must return the same array so the two
 * reads cannot diverge.
 */
export function hotFactsWithTurn(
  // Deliberately permissive: spec fixtures are plain object literals, often
  // typed `Record<string, unknown>` or `unknown`. The reconciler validates
  // every row at runtime, so forcing `HandlerFact` here would only scatter
  // casts across fifty call sites without adding a single real check.
  facts: readonly unknown[],
  turnId: string,
): readonly HandlerFactWithTurn[] {
  return facts.map((fact, index) => ({
    fact: fact as HandlerFact,
    turn_id: turnId,
    fact_row_id: testFactRowId(index),
    fact_created_at: testFactCreatedAt(index),
  }));
}

/**
 * The durable scenario page, derived from the SAME array and the SAME indices
 * as {@link hotFactsWithTurn}.
 *
 * Only eligible `run_analysis` rows are included: `validateDurableContract`
 * rejects the whole page if any row fails to parse, and a rejected page is
 * `durable_contract_invalid`, i.e. degraded again.
 *
 * `extraOlderFacts` are durable rows that are NOT in the hot window — the
 * "analysis outside the conversation window" case. They are stamped strictly
 * older than every hot row.
 */
export function durableAnalysisPage(
  facts: readonly unknown[],
  scenarioId: string,
  extraOlderFacts: readonly unknown[] = [],
): ScenarioRunAnalysisFactPageDouble {
  const hot: IdentifiedHandlerFact[] = [];
  facts.forEach((fact, index) => {
    if (!isEligibleRunAnalysis(fact, scenarioId)) return;
    hot.push({
      fact: fact as HandlerFact,
      fact_row_id: testFactRowId(index),
      fact_created_at: testFactCreatedAt(index),
    });
  });
  const older: IdentifiedHandlerFact[] = [];
  extraOlderFacts.forEach((fact, index) => {
    if (!isEligibleRunAnalysis(fact, scenarioId)) return;
    older.push({
      fact: fact as HandlerFact,
      fact_row_id: `test-durable-older-row-${index}`,
      fact_created_at: testFactCreatedAt(facts.length + 1 + index),
    });
  });
  const all = [...hot, ...older];
  return { facts: all, total_count: all.length };
}

/**
 * The durable page for a spec that already builds its OWN persisted identities
 * (its own `fact_row_id` / `fact_created_at`).
 *
 * `identifiedSnapshotIncludes` compares the hot identity's `fact_created_at`
 * and stable payload key against the durable row of the same `fact_row_id`, so
 * the two reads MUST be derived from the same source — pass the spec's own
 * with-turn rows here rather than re-stamping them.
 */
export function durablePageFromIdentified(
  rows: readonly {
    readonly fact: unknown;
    readonly fact_row_id?: string;
    readonly fact_created_at: string;
  }[],
  scenarioId: string,
): ScenarioRunAnalysisFactPageDouble {
  const facts = rows
    .filter(
      (row): row is typeof row & { readonly fact_row_id: string } =>
        typeof row.fact_row_id === 'string' &&
        isEligibleRunAnalysis(row.fact, scenarioId),
    )
    .map((row) => ({
      fact: row.fact as HandlerFact,
      fact_row_id: row.fact_row_id,
      fact_created_at: row.fact_created_at,
    }));
  return { facts, total_count: facts.length };
}

/**
 * PIN THE PRECONDITION IN-TEST.
 *
 * Runs the real reconciler over exactly what the double would return and
 * asserts the seeding produced a reasoning-authoritative set with the expected
 * number of facts. Without this a double that silently stops seeding is
 * indistinguishable from one that works — the suite just goes on asserting
 * whatever `unknown` happens to produce.
 */
export function assertDurableAnalysisSeeded(
  facts: readonly unknown[],
  scenarioId: string,
  turnId: string,
  expectedAnalysisFactCount: number,
  extraOlderFacts: readonly unknown[] = [],
): void {
  const page = durableAnalysisPage(facts, scenarioId, extraOlderFacts);
  const reconciled = reconcileScenarioAnalysisFacts({
    scenarioId,
    hotWindowFacts: facts,
    hotWindowFactsWithIdentity: hotFactsWithTurn(facts, turnId),
    durableRead: {
      status: 'ok',
      scenario_id: scenarioId,
      query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
      total_count: page.total_count,
      facts: page.facts,
    },
  });
  expect(
    reconciled.status,
    `durable analysis double must reconcile to a reasoning authority, got ${reconciled.status}${
      reconciled.status === 'degraded' ? ` (${reconciled.reason})` : ''
    }`,
  ).toBe('complete');
  expect(
    reconciled.facts.length,
    'durable analysis double seeded a different number of run_analysis facts than expected',
  ).toBe(expectedAnalysisFactCount);
  expect(expectedAnalysisFactCount).toBeGreaterThan(0);
}
