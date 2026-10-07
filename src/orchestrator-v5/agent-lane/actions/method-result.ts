/**
 * ⭐ `_method_result` v:1 — the typed rows behind a probe's reply (accel P24 / SCI-10; carrier: DL §7.3, a VERSIONED
 * sidecar with a local zod check in DGAI `readMethodResult.ts`, NO schemas release).
 *
 * "Test without this link" and "What would change this?" answer from typed results with no model call. This module
 * turns those turns into rows bound to the model items they are about, so DGAI can show them as a card under the reply
 * and the canvas can mark the tested link. It is PURE: it reads the turn the method already built and never re-words it.
 *
 * Science 393023 (7 Oct 20:4xZ), binding here:
 *   (1) a row is a line of the reply, verbatim; a figure is CEE's display string (`methodResultForEgress` enforces both
 *       against the FINAL reply, so a sidecar that drifted from the words is never sent);
 *   (2) no line that names the option most runs support reaches a row (the lead lines, the headline, `no_change`);
 *   (3) rows only for a `completed` / `measured` answer about the shown Run;
 *   (4) SCI-CHANGE rows only when the option most runs support is the option with the hero's highest displayed POINT
 *       goal chance, or when the hero shows no goal chance at all — otherwise no rows (fail-closed; chat unchanged).
 *       SCI-DEEP rows are exempt: they ARE goal-chance figures, from a same-seed recompute.
 */
import { goalChanceSideOf } from '../../goal-target/goal-chance-sides.js';
import { structuralChallengeRowsOf, type StructuralChallengeTurn } from '../method-turn/structural-challenge-turn.js';
import type { WhatChangesTurn } from '../method-turn/what-changes-turn.js';
import type { ItemRef } from './rank.js';

export type MethodResultOutcome =
  | 'completed' | 'measured' | 'stale' | 'honest_limit' | 'refused' | 'unsupported' | 'unavailable' | 'timed_out' | 'withheld';

export interface MethodResultRowV1 {
  readonly row_id: string;
  readonly item_refs: readonly ItemRef[];
  readonly text: string;
  readonly provenance: 'server_built' | 'olumi_drafted';
  readonly figures?: readonly string[];
}

export interface MethodResultV1 {
  readonly v: 1;
  readonly action_id: 'test_link' | 'what_changes';
  readonly outcome: MethodResultOutcome;
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly run: { readonly graph_hash_at_run: string; readonly run_id?: string; readonly computed_at?: string };
  readonly rows: readonly MethodResultRowV1[];
}

export interface MethodResultContext {
  readonly scenarioId: string;
  readonly turnId: string;
}

const linkRef = (from_id: string, to_id: string): ItemRef => ({ kind: 'link', from_id, to_id });

/**
 * Ruling 4. True when the SCI-CHANGE rows may stand beside the hero: every option's displayed goal chance is a POINT and
 * the single highest one is `runShareTopId`, or no option shows a goal chance at all. A range, a withheld figure, a mix
 * of shown and unshown options, a tie at the top or an unreadable result: false.
 */
export function changeRowsAgreeWithHero(analysisResult: unknown, optionIds: readonly string[], runShareTopId: string): boolean {
  if (optionIds.length === 0 || !optionIds.includes(runShareTopId)) return false;
  let sides;
  try {
    sides = optionIds.map((id) => ({ id, side: goalChanceSideOf(analysisResult, id) }));
  } catch {
    return false;
  }
  if (sides.every(({ side }) => side.kind === 'not_recorded')) return true;
  if (!sides.every(({ side }) => side.kind === 'point')) return false;
  const pct = (s: (typeof sides)[number]) => (s.side.kind === 'point' ? s.side.pct : -1);
  const top = Math.max(...sides.map(pct));
  const atTop = sides.filter((s) => pct(s) === top);
  return atTop.length === 1 && atTop[0]!.id === runShareTopId;
}

const WHAT_CHANGES_OUTCOME: Record<WhatChangesTurn['outcome'], MethodResultOutcome> = {
  measured: 'measured', honest_limit: 'honest_limit', stale: 'stale', model_unread: 'unavailable',
};

/**
 * "What would change this?" as v:1. Rows: RC's `quoted` / `below_a_tenth` sentences only (never `no_change`), each bound
 * to its link and the option it names, and only when ruling 4 holds. `run` is the Run on screen; without one, no sidecar.
 */
export function whatChangesMethodResult(
  turn: WhatChangesTurn,
  ctx: MethodResultContext & { readonly run: MethodResultV1['run'] | null; readonly analysisResult: unknown },
): MethodResultV1 | null {
  const measured = turn.outcome === 'measured' ? turn.measured : undefined;
  const run = measured ? { graph_hash_at_run: measured.run.graph_hash_at_run, computed_at: measured.run.computed_at } : ctx.run;
  if (run === null || run === undefined) return null;
  const base = { v: 1 as const, action_id: 'what_changes' as const, scenario_id: ctx.scenarioId, turn_id: ctx.turnId, run };
  if (measured === undefined) return { ...base, outcome: WHAT_CHANGES_OUTCOME[turn.outcome], rows: [] };
  if (!changeRowsAgreeWithHero(ctx.analysisResult, measured.optionIds, measured.leaderId)) return { ...base, outcome: 'withheld', rows: [] };
  const rows = measured.rows
    .filter((row) => row.kind === 'quoted' || row.kind === 'below_a_tenth')
    .map((row): MethodResultRowV1 => ({
      row_id: `flip:${row.link.from_id}->${row.link.to_id}`,
      item_refs: [linkRef(row.link.from_id, row.link.to_id), { kind: 'option', id: row.option_id }],
      text: row.text,
      provenance: 'server_built',
    }));
  return { ...base, outcome: 'measured', rows };
}

const TEST_LINK_OUTCOME: Record<string, MethodResultOutcome> = {
  completed: 'completed', stale: 'stale', unsupported: 'unsupported', timed_out: 'timed_out', withheld: 'withheld',
};

/**
 * "Test without this link" as v:1, from the turn AS PRESENTED (after `structuralChallengeTurnUnderLicence`). Every row is
 * bound to the tested link; goal and limit rows also to their option. `run` is the baseline Run the test recomputed.
 */
export function testLinkMethodResult(turn: StructuralChallengeTurn, ctx: MethodResultContext): MethodResultV1 | null {
  const result = turn.result;
  if (result === null) return null;
  const run = { graph_hash_at_run: result.baseline.graph_hash_at_run, run_id: result.baseline.run_id };
  const base = { v: 1 as const, action_id: 'test_link' as const, scenario_id: ctx.scenarioId, turn_id: ctx.turnId, run };
  if (result.status !== 'completed') return { ...base, outcome: TEST_LINK_OUTCOME[result.status] ?? 'unavailable', rows: [] };
  const link = linkRef(result.alternative.from_id, result.alternative.to_id);
  const rows = structuralChallengeRowsOf(turn).map((row): MethodResultRowV1 => ({
    row_id: row.option_id === undefined ? row.kind
      : row.constraint_id !== undefined ? `${row.kind}:${row.option_id}:${row.constraint_id}` : `${row.kind}:${row.option_id}`,
    item_refs: row.kind === 'provisional' || row.kind === 'not_saved' ? []
      : row.option_id !== undefined ? [{ kind: 'option', id: row.option_id }, link] : [link],
    text: row.text,
    provenance: 'server_built',
    ...(row.figures.length > 0 ? { figures: row.figures } : {}),
  }));
  return { ...base, outcome: 'completed', rows };
}

/**
 * The egress rule (the `_premortem_worksheet` precedent): the sidecar is sent only when every row and every figure is
 * found verbatim in the FINAL `assistant_text`. Anything else — a reply re-worded after the rows were built — sends none.
 */
export function methodResultForEgress(m: MethodResultV1 | null, assistantText: string): MethodResultV1 | null {
  if (m === null) return null;
  return m.rows.every((row) => assistantText.includes(row.text) && (row.figures ?? []).every((f) => assistantText.includes(f))) ? m : null;
}
