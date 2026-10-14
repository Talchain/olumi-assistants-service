/**
 * ⛔ DL GATE 1 v2 (Science 0df0e1, 5 Oct 2026): TWO ARMS THE RUN COULD NOT TELL APART SPLIT EACH OTHER'S WINS.
 *
 * ISL scores every draw's winner and splits a tie `1.0 / len(winners)` (`robustness_analyzer_v2.py` :4921-4925); an arm
 * that sets every factor to today's level takes the status quo's OWN draws (B1a-5, :1112-1125), and an arm that moves
 * nothing on a path to the goal changes nothing either. Two such arms share one outcome, so each carries half the wins
 * the pair earned: Tech Lead "leads" 0.4 vs 0.3 / 0.3 while the duplicated choice really wins 0.6. Every comparison claim
 * the Run computed with the duplicate in it — shares, leader, robustness, flips — is distorted, so the Run WITHHOLDS the
 * comparison (`withholdOptionGoalFigures`, code `GOAL_FIGURES_OPTIONS_IDENTICAL`) and says why. Every arm's own outcome
 * distribution stays.
 *
 * Decided on the Run's own RESULT, never a pre-run rule (the wire is projected per request; #2570 failed two reviews).
 * IDENTICAL is the ONE shared rule (`coaching/identical-arms-core.ts`, also SCI-DEEP's): the outcome statistics equal within
 * RELATIVE 1e-12 and the same trusted draw count, each arm usable on its own. Any pair counts, with or without a
 * baseline (DL condition 1). This file adds only the response adapter (submitted identities, labels, baseline). Pure.
 */
import { readOptionResultSources } from '../../../orchestrator/context/option-result-source.js';
import { optionIdOf } from '../../../orchestrator/context/placeholder-parts.js';
import { identicalArmGroups, usableArmsFromRows } from '../../coaching/identical-arms-core.js';

/** One set of arms the Run returned identical outcomes for, in submission order. */
export interface IdenticalArmGroup {
  readonly option_ids: readonly string[];
  readonly labels: readonly string[];
  /** The group's explicit baseline (`is_baseline: true`), when it holds one. */
  readonly baseline_option_id: string | null;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;

/** The Run's identical groups, read from its INTACT response rows for the options it was sent (each id once). */
export function detectIdenticalArms(response: unknown, submittedOptions: readonly RecordValue[]): IdenticalArmGroup[] {
  const envelope = record(response);
  if (envelope === null) return [];
  const results = readOptionResultSources(envelope)[0] ?? [];
  const ids = submittedOptions.map(optionIdOf).filter((id): id is string => id !== undefined && id !== '');
  const unique = ids.filter((id) => ids.indexOf(id) === ids.lastIndexOf(id));
  const optionFor = (id: string) => submittedOptions.find((o) => optionIdOf(o) === id);
  return identicalArmGroups(usableArmsFromRows(results, unique)).map((group) => {
    const baselines = group.filter((id) => optionFor(id)?.is_baseline === true);
    return {
      option_ids: group,
      labels: group.map((id) => {
        const label = optionFor(id)?.label;
        const row = results.find((r) => record(r) !== null && optionIdOf(r as RecordValue) === id) as RecordValue | undefined;
        return typeof label === 'string' && label !== '' ? label : typeof row?.option_label === 'string' ? row.option_label : id;
      }),
      baseline_option_id: baselines.length === 1 ? baselines[0] : null,
    };
  });
}
