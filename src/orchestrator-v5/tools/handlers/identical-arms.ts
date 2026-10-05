/**
 * ⛔ DL GATE 1 v2 (Science 0df0e1, 5 Oct 2026): TWO ARMS THE RUN COULD NOT TELL APART SPLIT EACH OTHER'S WINS.
 *
 * ISL scores every draw's winner and splits a tie `1.0 / len(winners)` (`robustness_analyzer_v2.py` :4921-4925); an arm
 * that sets every factor to today's level takes the status quo's OWN draws (B1a-5, :1112-1125), and an arm that moves
 * nothing on a path to the goal changes nothing either. Two such arms share one outcome, so each carries half the wins
 * the pair earned: Tech Lead "leads" 0.4 vs 0.3 / 0.3 while the duplicated choice really wins 0.6. Every comparison claim
 * the Run computed with the duplicate in it — shares, leader, robustness, flips — is distorted, so the Run WITHHOLDS the
 * comparison (`withholdOptionGoalFigures`, code `OPTION_IDENTICAL_TO_BASELINE`) and says why. Every arm's own outcome
 * distribution stays.
 *
 * Decided on the Run's own RESULT, never a pre-run rule (the wire is projected per request; #2570 failed two reviews).
 * IDENTICAL = all eight statistics (`outcome` p10/p50/p90/mean/std, `downside` p05/cvar_10/expected_regret) equal within
 * RELATIVE 1e-12, and the same `n_valid_samples`. Anything missing or non-finite is NOT identical (fail toward keeping
 * the comparison). Any pair counts, with or without a baseline (DL condition 1). Pure.
 */
import { readOptionResultSources } from '../../../orchestrator/context/option-result-source.js';
import { optionIdOf } from '../../../orchestrator/context/placeholder-parts.js';

/** One set of arms the Run returned identical outcomes for, in submission order. */
export interface IdenticalArmGroup {
  readonly option_ids: readonly string[];
  readonly labels: readonly string[];
  /** The group's explicit baseline (`is_baseline: true`), when it holds one. */
  readonly baseline_option_id: string | null;
}

type RecordValue = Record<string, unknown>;
const OUTCOME_FIELDS = ['p10', 'p50', 'p90', 'mean', 'std'] as const;
const DOWNSIDE_FIELDS = ['p05', 'cvar_10', 'expected_regret'] as const;
export const IDENTICAL_RELATIVE_TOLERANCE = 1e-12;

const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const equalNumber = (a: unknown, b: unknown): boolean => finite(a) && finite(b)
  && Math.abs(a - b) <= IDENTICAL_RELATIVE_TOLERANCE * Math.max(1e-300, Math.abs(a), Math.abs(b));

export function sameOutcome(a: RecordValue, b: RecordValue): boolean {
  const ao = record(a.outcome), bo = record(b.outcome);
  const ad = record(a.downside), bd = record(b.downside);
  return ao !== null && bo !== null && ad !== null && bd !== null
    && finite(ao.n_valid_samples) && ao.n_valid_samples === bo.n_valid_samples
    && OUTCOME_FIELDS.every((key) => equalNumber(ao[key], bo[key]))
    && DOWNSIDE_FIELDS.every((key) => equalNumber(ad[key], bd[key]));
}

/**
 * Every group of two or more submitted arms whose returned outcomes are identical. Reads the Run's current-first result
 * source (the one every winner surface reads); an arm with no single unambiguous result entry is never grouped.
 */
export function detectIdenticalArms(response: unknown, submittedOptions: readonly RecordValue[]): IdenticalArmGroup[] {
  const envelope = record(response);
  if (envelope === null) return [];
  const results = readOptionResultSources(envelope)[0] ?? [];
  const arms: { id: string; label: string; baseline: boolean; result: RecordValue }[] = [];
  for (const option of submittedOptions) {
    const id = optionIdOf(option);
    if (id === undefined || id === '') continue;
    if (submittedOptions.filter((o) => optionIdOf(o) === id).length !== 1) continue;
    const entries = results.filter((r) => optionIdOf(r) === id);
    if (entries.length !== 1) continue;
    const result = entries[0]!;
    const label = typeof option.label === 'string' && option.label !== '' ? option.label
      : typeof result.option_label === 'string' ? result.option_label : id;
    arms.push({ id, label, baseline: option.is_baseline === true, result });
  }
  const grouped = new Set<number>();
  const groups: IdenticalArmGroup[] = [];
  for (let i = 0; i < arms.length; i += 1) {
    if (grouped.has(i)) continue;
    const members = [i];
    for (let j = i + 1; j < arms.length; j += 1) {
      if (!grouped.has(j) && sameOutcome(arms[i]!.result, arms[j]!.result)) members.push(j);
    }
    if (members.length < 2) continue;
    members.forEach((m) => grouped.add(m));
    const baselines = members.filter((m) => arms[m]!.baseline);
    groups.push({
      option_ids: members.map((m) => arms[m]!.id),
      labels: members.map((m) => arms[m]!.label),
      baseline_option_id: baselines.length === 1 ? arms[baselines[0]!]!.id : null,
    });
  }
  return groups;
}
