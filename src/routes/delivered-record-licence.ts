/**
 * 0.79 SD-1 Slice R (DL ruling #87, option A): may the scenario read serve a Run's DELIVERED record, as far as leader
 * claims go?
 *
 * The final-egress licence gate (`enforceLeaderLicenceAtFinalEgress`) rewrites only its own prose fields, and a record
 * is served verbatim or not at all after the measured-threshold correction below. So, unless this read's licence is fully `'permitted'`, a record with a leader claim
 * ANYWHERE is not served: every string and every object KEY of its blocks and options, at any depth (Codex r1/r2 on
 * #2654: a coaching `action_prompt`, an option's strings, and an `interventions` key each passed the field gate). Read
 * bare and against every roster the read knows: the graph's options, the read's `analysis_ready` options, and the
 * record's own option labels.
 *
 * TWO VOCABULARIES, either one omits (Review Desk 6b on #2654): the v5 leader patterns (`textAssertsLeadingOption`) and
 * the AGENT lane's own withheld fail-closed (`dropRankingSentences`: bare `highest`, share splits, `lowest` verbs, a
 * place in an order). Every record is composed on the agent lane, so a reload must never serve under a non-permitted
 * licence what that lane itself would have withheld.
 */
import type { RunDeliveredRecord } from '@talchain/schemas/boundary';

import type { LeaderLicence } from '../orchestrator-v5/compose/leader-licence.js';
import { dropRankingSentences, rankingLabelContext } from '../orchestrator-v5/agent-lane/withheld-leader-fail-closed.js';
import { textAssertsLeadingOption } from '../orchestrator-v5/compose/leading-option-egress-guard.js';
import { optionRosterFromAnalysisReady, optionRosterFromGraph } from '../orchestrator-v5/compose/leading-option-wire-enforcement.js';
import { DOMINANT_DRIVER_MEASURED_TAIL, hasMeasuredFlipThresholdFor } from '../orchestrator-v5/compose/lens-selector.js';

/**
 * Legacy DOMINANT_DRIVER bodies can predate the selector's measured-threshold
 * licence. Remove only its exact measured tail, under that SAME predicate and
 * the selected saved Run's own enrichment. The saved subject is the sole typed
 * factor target (`target_refs[0].id`); missing/ambiguous targets fail closed.
 * Prose identifies the historical copy to correct, never the subject identity.
 * Licensed records return by reference; stored bytes are never mutated.
 */
export function deliveredRecordWithThresholdLicence(
  rec: RunDeliveredRecord,
  enrichment: Record<string, unknown>,
): RunDeliveredRecord {
  const tail = ` ${DOMINANT_DRIVER_MEASURED_TAIL}`;
  let changed = false;
  const phase3_blocks = rec.phase3_blocks.map((block) => {
    if (block.type !== 'coaching' || !block.body.endsWith(tail)) return block;
    const qualitative = block.body.slice(0, -tail.length);
    if (!qualitative.endsWith(' is doing most of the work in this result.')) return block;
    const subject = block.target_refs.length === 1 && block.target_refs[0].kind === 'factor'
      ? block.target_refs[0].id : null;
    if (hasMeasuredFlipThresholdFor(enrichment, subject)) return block;
    changed = true;
    return { ...block, body: qualitative };
  });
  return changed ? { ...rec, phase3_blocks } : rec;
}

export function deliveredRecordAssertsLeader(rec: RunDeliveredRecord, graph: unknown, analysisReady: unknown): boolean {
  const rosters = [
    optionRosterFromGraph(graph),
    optionRosterFromAnalysisReady(analysisReady),
    (rec.analysis_ready_options ?? []).map((o) => o.label),
  ].filter((r) => r.length > 0);
  const readyOptions = (analysisReady as { options?: unknown } | null | undefined)?.options;
  const rankingLabels = rankingLabelContext(graph, {
    options: [...(Array.isArray(readyOptions) ? readyOptions : []), ...(rec.analysis_ready_options ?? [])],
  });
  const asserts = (value: string): boolean =>
    textAssertsLeadingOption(value)
    || rosters.some((optionLabels) => textAssertsLeadingOption(value, { optionLabels }))
    || dropRankingSentences(value, rankingLabels).droppedSentences > 0;
  const walk = (value: unknown): boolean => {
    if (typeof value === 'string') return asserts(value);
    if (Array.isArray(value)) return value.some(walk);
    if (value !== null && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).some(([key, inner]) => asserts(key) || walk(inner));
    }
    return false;
  };
  return walk(rec.phase3_blocks) || walk(rec.analysis_ready_options ?? []);
}

/** Leader gate: false omits the record; it never rewrites a leader claim. */
export function deliveredRecordWithinLicence(
  rec: RunDeliveredRecord,
  opts: { readonly licence: LeaderLicence; readonly graph: unknown; readonly analysisReady: unknown },
): boolean {
  return opts.licence === 'permitted' || !deliveredRecordAssertsLeader(rec, opts.graph, opts.analysisReady);
}
