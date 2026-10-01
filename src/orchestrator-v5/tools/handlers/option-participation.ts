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
import { RunAnalysisResultSchema, type OptionParticipationEntrySchema } from '@talchain/schemas/orchestrator';

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
