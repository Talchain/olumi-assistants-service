/**
 * THE UNTESTED-OPTION CARD — a run-turn coaching card (contract `run-turn-coaching/v1`, beside
 * `limit-unchecked-card.ts` and `fragile-link-challenge.ts`).
 *
 * For an explicit run that could NOT test one of the options the user holds. It names the option and hands the
 * user one question turn: the level it sets, offered for approval.
 *
 * ── WHY IT OUTRANKS THE OTHER CARDS ────────────────────────────────────────
 * Served dloop2x-1 (27 Sep, CEE 3c4d9cc, R&C #70 5851938869): after the limit card's "Change or add an option", the
 * user added "Keep the price at £49 and launch a retention programme" and approved it. The re-run left it out — it
 * set no level for what it changes — and the one card still said "No option meets your limit" → "Change or add an
 * option", the move the user had just made. The verdict is about the options the run could test; the untested one
 * is the one that could change it, and the move that tests it is its level.
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 * Two typed facts that must AGREE, both from the bound run: the option is not ready — its `status` in the run's own
 * `analysis_ready.options` is not `ready` (`ProductReadiness`, @talchain/schemas: `needs_encoding` |
 * `needs_user_mapping`), or a `missing_value` blocker in the same `analysis_ready.blockers` names it (Paul-hit B1) —
 * AND its label is not a key of the bound result's `win_probabilities` (the result is keyed by option label). Either alone is not enough: a `ready` status quo is absent from `win_probabilities` too.
 * Explicit runs only: the automatic first pass carries its own approval step for missing figures.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
import {
  ELICITATION_CLOSE,
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  isAutomaticRun,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
} from './fragile-link-challenge.js';

export const UNTESTED_OPTION_SIGNAL_ID_PREFIX = 'coach:untested_option:';

export interface UntestedOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The option ids CEE's readiness authority names as MISSING A LEVEL: `analysis_ready.blockers[]` entries with
 * `blocker_type: 'missing_value'` (the typed "Factor X needs a numeric value for option Y"). Pure.
 */
function optionsMissingALevel(analysisReady: unknown): ReadonlySet<string> {
  const blockers = readRecord(analysisReady)?.blockers;
  if (!Array.isArray(blockers)) return new Set();
  return new Set(blockers.flatMap((b) => {
    const r = readRecord(b);
    return r?.blocker_type === 'missing_value' && typeof r.option_id === 'string' && r.option_id.length > 0 ? [r.option_id] : [];
  }));
}

/**
 * The options the bound run could not test, in `analysis_ready` order. Pure; empty on anything malformed.
 *
 * Untested = the bound result does not score it AND (its status is not `ready` OR a `missing_value` blocker names it).
 * ⭐ The blocker limb (Paul-hit B1, AIC #70 5854805501, Paul's export `90b8f080`): an added option whose new factor's
 * level was never recorded carries only the price intervention it shares with another option, so it reads `ready` —
 * yet the run left it out, and CEE's readiness authority had already typed why.
 */
export function untestedOptions(analysisReady: unknown, analysisResult: unknown): UntestedOption[] {
  const options = readRecord(analysisReady)?.options;
  const scored = readRecord(readRecord(analysisResult)?.win_probabilities);
  if (!Array.isArray(options) || scored === null) return [];
  const missingALevel = optionsMissingALevel(analysisReady);
  return options.flatMap((o): UntestedOption[] => {
    const r = readRecord(o);
    const id = typeof r?.option_id === 'string' && r.option_id.length > 0 ? r.option_id : null;
    const label = typeof r?.label === 'string' ? r.label.trim() : '';
    if (r === null || id === null || label === '' || typeof r.status !== 'string') return [];
    if (r.status === 'ready' && !missingALevel.has(id)) return [];
    return Object.prototype.hasOwnProperty.call(scored, label) ? [] : [{ id, label }];
  });
}

/** The card's words: one named option, or the generic words for two or more (or a label the gates refuse). */
export function composeUntestedOptionCard(label: string | null, count: number): FragileLinkChallengeCopy {
  const one = count === 1;
  const which = label !== null ? `“${label}”` : one ? 'one of your options' : 'some of your options';
  const it = one ? 'it does' : 'they do';
  return {
    title: one ? 'One option was not tested' : 'Some options were not tested',
    body: `This analysis did not test ${which}: ${it} not yet set a level for what ${one ? 'it changes' : 'they change'}, `
      + 'so the result does not cover ' + (one ? 'it.' : 'them.'),
    action_label: one ? 'Give its level' : 'Give their levels',
    action_prompt: `This analysis did not test ${which} because ${it} not yet set a level for what ${one ? 'it changes' : 'they change'}. `
      + `Ask me what level ${one ? 'it sets' : 'each sets'} and what that rests on. ${ELICITATION_CLOSE}`,
  };
}

/**
 * The one untested-option card for this run, or `null` (the caller's next card speaks). Total. Repeats the
 * identity gate so it is safe on its own.
 */
export function buildUntestedOptionCard(input: FragileLinkChallengeInput, analysisReady: unknown): CoachingBlock | null {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) return null;
  if (input.trigger === 'auto_first_pass' || isAutomaticRun(readRecord(result.enrichment))) return null;
  const untested = untestedOptions(analysisReady, result);
  if (untested.length === 0) return null;
  const forms = [
    ...(untested.length === 1 ? [{ named: true, copy: composeUntestedOptionCard(untested[0]!.label, 1) }] : []),
    { named: false, copy: composeUntestedOptionCard(null, untested.length) },
  ];
  const chosen = forms.find((f) => copyPasses(f.copy));
  if (chosen === undefined) return null;
  const signalId = `${UNTESTED_OPTION_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:explicit_run`
    + `${chosen.named ? ':named' : ''}:${untested.map((o) => o.id).join(',')}`;
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
    target_refs: [],
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    ...chosen.copy,
  });
  return parsed.success ? parsed.data : null;
}
