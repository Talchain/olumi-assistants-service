/**
 * ⭐ WHICH OPTIONS A RUN LEFT OUT OF THE ORDINARY COMPARISON, AND WHY — the stored fact and its ONE reader (52f8cd; DL
 * #75 5924731600; PANEL 5924723004; AIQ 5924727155).
 *
 * Served `dafdc620`: Olumi's own option "Prioritise angel bridge" was dropped by `filterOlumiProposedOptions` and the
 * Run recorded nothing, so the Reasoning panel said "The analysis returned no result for this option" — false; CEE left
 * it out on purpose. The Run now stores `option_participation` (schemas 0.65, `RunAnalysisResultSchema`), the read
 * carries it as `analysis_option_participation` and the Agent turn as its `option_participation` sidecar — the SAME
 * fact, under the SAME gates, as `analysis_result`, read through THIS one reader (the `goal_certainty` pattern).
 */
import type { z } from 'zod';
import { RunAnalysisResultSchema, RunInputSnapshotSchema, type OptionParticipationEntrySchema } from '@talchain/schemas/orchestrator';

export type OptionParticipationEntry = z.infer<typeof OptionParticipationEntrySchema>;

/** The published contract's own array: one verdict per option; an Olumi option is never a user's unanalysable one. */
const StoredOptionParticipationSchema = RunAnalysisResultSchema.shape.option_participation.unwrap();

export type StoredOptionParticipation = readonly OptionParticipationEntry[];

/**
 * Only an array the contract accepts is carried, `[]` included: `[]` = recorded, nothing left out; absent = NOT recorded
 * (a Run from before this, or a record the contract refuses) — never "every option was the user's" (schemas 0.65).
 */
export function readStoredOptionParticipation(raw: unknown): StoredOptionParticipation | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = StoredOptionParticipationSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface RecordedRunOption {
  readonly option_id: string;
  readonly label?: string;
}
export interface LeftOutRunOption extends RecordedRunOption {
  readonly reason: string;
}
export interface RecordedRunOptionSet {
  readonly leftOut: readonly LeftOutRunOption[];
  readonly sent: readonly RecordedRunOption[];
}

/**
 * Q6: ONE projection of the STORED Run fact's sent/left-out set, for limit words and final reply egress. The snapshot's
 * contract reader owns its complete sent roster; otherwise the existing participation reader owns the exclusion.
 * Graph labels only name recorded ids: today's authorship/status never decides whether the Run left an option out.
 * Unknown/refused records mean no exclusions. A recorded empty snapshot/participation stays empty. The transport
 * analysis_result block omits input_snapshot; the canonical graph reader projects THIS fact into its sidecar once.
 */
export function runOptionSetForCopy(storedRunResult: unknown, participation: unknown, graph: unknown): RecordedRunOptionSet {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const options: RecordedRunOption[] = Array.isArray(nodes) ? nodes.flatMap((value) => {
    const n = value as { id?: unknown; kind?: unknown; label?: unknown } | null;
    return n?.kind === 'option' && typeof n.id === 'string'
      ? [{ option_id: n.id, ...(typeof n.label === 'string' && n.label.trim() !== '' ? { label: n.label.trim() } : {}) }]
      : [];
  }) : [];
  const labels = new Map(options.map((o) => [o.option_id, o.label]));
  const named = (o: RecordedRunOption): RecordedRunOption => {
    const label = typeof o.label === 'string' && o.label.trim() !== '' ? o.label.trim() : labels.get(o.option_id);
    return { option_id: o.option_id, ...(label !== undefined ? { label } : {}) };
  };
  const snapshot = RunInputSnapshotSchema.safeParse((storedRunResult as { input_snapshot?: unknown } | null | undefined)?.input_snapshot);
  if (snapshot.success) {
    return {
      leftOut: snapshot.data.options_not_sent.map((o) => ({ ...named(o), reason: o.reason })),
      sent: snapshot.data.options.map(named),
    };
  }
  const stored = readStoredOptionParticipation(participation);
  const leftOut = (stored ?? []).flatMap((o): LeftOutRunOption[] => {
    switch (o.state) {
      case 'excluded_olumi_proposed': return [{ ...named(o), reason: 'olumi_proposed' }];
      case 'excluded_infeasible': return [{ ...named(o), reason: 'infeasible' }];
      case 'excluded_removed': return [{ ...named(o), reason: 'removed' }];
      default: return [];
    }
  });
  const excludedIds = new Set(leftOut.map((o) => o.option_id));
  // Without a snapshot, retain every other graph label as a conservative figure-alias collision control.
  return { leftOut, sent: options.filter((o) => !excludedIds.has(o.option_id)) };
}

/** The same projection's ids/reasons; limit copy consumes no separate exclusion predicate. */
export function optionsLeftOutOfRun(storedRunResult: unknown, participation: unknown, graph: unknown): readonly LeftOutRunOption[] {
  return runOptionSetForCopy(storedRunResult, participation, graph).leftOut;
}
