/**
 * THE UNVALUED-DRIVER CARD — a run-turn coaching card (contract `run-turn-coaching/v1`), C4's "give its value" move.
 *
 * ── WHY (PJ-B3; R&C root #70 5860314787, DL decision 5860325629) ─────────────
 * PLoT ranks `factor_sensitivity` by graph structure alone (`computeFactorSensitivityFromGraph`, basis
 * `graph_structural`): it never reads whether a factor has a value. On served journeys C and E the top-3 held factors
 * the model has NO value for ("Pro paying subscribers" #1, "Monthly churn" #2; "Current annual salary spend" #3).
 * The DL ruled: keep the TRUE rank (a factor with no value can be a real structural driver), and never SAY it as an
 * analysed driver — say it as the ask it is: this matters, and it has no value yet, so give it.
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 * Two typed facts that must AGREE, both from the bound run: the `factor_sensitivity` row ranks ≤ 3
 * (`importance_rank`, PLoT's one canonical order) and carries NO `value_source` (the valued rows carry one); AND the
 * run's own hash-bound graph holds that factor with no numeric `observed_state.value`. An option-controlled lever
 * (`zero_reason: intervention_override`) is not this card: an option's missing level is the untested-option move.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
import {
  FIRST_PASS_PREFIX,
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
} from './fragile-link-challenge.js';

export const UNVALUED_DRIVER_SIGNAL_ID_PREFIX = 'coach:unvalued_driver:';
/** PLoT's canonical order counts a top-3 driver as one a user would read as "what this result depends on". */
export const UNVALUED_DRIVER_TOP_N = 3;

export interface UnvaluedDriver {
  readonly id: string;
  readonly label: string;
  readonly rank: number;
}

const hasNumericValue = (node: Record<string, unknown>): boolean => {
  const os = readRecord(node.observed_state);
  return [os?.value, os?.raw_value].some((v) => typeof v === 'number' && Number.isFinite(v));
};

/** The top-ranked factors the bound run holds no value for, rank ascending. Pure; empty on anything malformed. */
export function unvaluedTopDrivers(analysisResult: unknown, boundGraph: Record<string, unknown> | null): UnvaluedDriver[] {
  const rows = readRecord(readRecord(analysisResult)?.enrichment)?.factor_sensitivity;
  const nodes = boundGraph?.nodes;
  if (!Array.isArray(rows) || !Array.isArray(nodes)) return [];
  const nodeById = new Map<string, Record<string, unknown>>();
  for (const n of nodes.map(readRecord)) if (n !== null && typeof n.id === 'string') nodeById.set(n.id, n);
  // The mark is read only where the producer attests `value_source` at all (absent everywhere = not attested).
  if (!rows.some((r) => { const v = readRecord(r)?.value_source; return typeof v === 'string' && v.length > 0; })) return [];
  const out: UnvaluedDriver[] = [];
  for (const row of rows.map(readRecord)) {
    if (row === null) continue;
    const id = typeof row.factor_id === 'string' ? row.factor_id : null;
    const rank = typeof row.importance_rank === 'number' ? row.importance_rank : null;
    if (id === null || rank === null || rank > UNVALUED_DRIVER_TOP_N) continue;
    if (typeof row.value_source === 'string' && row.value_source.length > 0) continue;
    if (row.zero_reason === 'intervention_override') continue;
    const node = nodeById.get(id);
    if (node === undefined || node.kind !== 'factor' || hasNumericValue(node)) continue;
    const label = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim()
      : typeof row.factor_label === 'string' ? row.factor_label.trim() : '';
    if (label === '') continue;
    out.push({ id, label, rank });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Wordings, preferred first: the full finding, then the short one when a long label pushes it past body_max. */
export function composeUnvaluedDriverCards(label: string, firstPass: boolean): FragileLinkChallengeCopy[] {
  const findings = [
    `the analysis ranks “${label}” among the three factors this result depends on most, but the model has no value `
      + 'for it yet, so that ranking comes from how the model is built, not from your figures.',
    `the analysis ranks “${label}” in its top three, but the model has no value for it yet.`,
  ];
  return findings.map((finding) => ({
    title: `“${label}” has no value yet`,
    body: firstPass ? `${FIRST_PASS_PREFIX}${finding}` : `T${finding.slice(1)}`,
    action_label: 'Give its value',
    action_prompt: `What is “${label}” today? Ask me for its current value and what that figure rests on.`,
  }));
}

/** The card for the top unvalued driver of the bound run, or null. */
export function buildUnvaluedDriverCard(
  input: FragileLinkChallengeInput,
  boundGraph: Record<string, unknown> | null,
): CoachingBlock | null {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) return null;
  const top = unvaluedTopDrivers(result, boundGraph)[0];
  if (top === undefined) return null;
  const firstPass = input.trigger === 'auto_first_pass';
  const copy = composeUnvaluedDriverCards(top.label, firstPass).find((c) => copyPasses(c));
  if (copy === undefined) return null;
  const signalId = `${UNVALUED_DRIVER_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${input.trigger}:${top.id}`;
  const parsed = CoachingBlockSchema.safeParse({
    type: 'coaching',
    coaching_kind: RUN_TURN_COACHING_CONTRACT.block.coaching_kind,
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: input.computedAt,
    source_handler: RUN_TURN_COACHING_CONTRACT.block.source_handler,
    graph_hash_at_generation: input.graphHash,
    freshness: 'fresh',
    source: RUN_TURN_COACHING_CONTRACT.block.source,
    target_refs: [{ id: top.id, kind: 'factor', label: top.label }],
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    ...copy,
  });
  return parsed.success ? parsed.data : null;
}
