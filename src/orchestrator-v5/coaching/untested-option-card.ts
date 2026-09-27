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
 * Two typed facts that must AGREE, both from the bound run: the option is not complete — its `status` in the run's
 * own `analysis_ready.options` is not `ready` (`ProductReadiness`, @talchain/schemas: `needs_encoding` |
 * `needs_user_mapping`), OR the ONE authority for unset option×factor levels, `deriveMissingEffectPairs`
 * (`routing/repair-value-binding.ts`), names it — AND its label is not a key of the bound result's
 * `win_probabilities` (the result is keyed by option label). Either alone is not enough: a `ready` status quo is
 * absent from `win_probabilities` too, and a missing level on an option the result DID score is not "untested".
 * Explicit runs only: the automatic first pass carries its own approval step for missing figures.
 *
 * ⭐ Paul-hit B1 (#70 5854812811, export `90b8f080`): his added option read `ready` — `ready` means "the levels it
 * HAS are encoded" (`cee/transforms/option-status.ts:258`), so it cannot see a linked factor with no level — while
 * the same `analysis_ready` carried the typed `missing_value` blocker for it. `status` alone let the Run's one card
 * say "Your limit could not be checked" and nothing asked for the level. Canonical 5854902847: read the one spelling.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
import { deriveMissingEffectPairs } from '../routing/repair-value-binding.js';
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
  /** The factor it has no level for, when the one missing-level authority names exactly one. */
  readonly factorId: string | null;
  readonly factorLabel: string | null;
}

/** The options the bound run could not test, in `analysis_ready` order. Pure; empty on anything malformed. */
export function untestedOptions(analysisReady: unknown, analysisResult: unknown): UntestedOption[] {
  const ready = readRecord(analysisReady);
  const options = ready?.options;
  const scored = readRecord(readRecord(analysisResult)?.win_probabilities);
  if (!Array.isArray(options) || scored === null) return [];
  const missing = deriveMissingEffectPairs(ready ?? null);
  return options.flatMap((o): UntestedOption[] => {
    const r = readRecord(o);
    const id = typeof r?.option_id === 'string' && r.option_id.length > 0 ? r.option_id : null;
    const label = typeof r?.label === 'string' ? r.label.trim() : '';
    if (r === null || id === null || label === '' || typeof r.status !== 'string') return [];
    const factors = missing.filter((p) => p.optionId === id);
    if (r.status === 'ready' && factors.length === 0) return [];
    if (Object.prototype.hasOwnProperty.call(scored, label)) return [];
    const only = factors.length === 1 ? factors[0]! : null;
    return [{ id, label, factorId: only?.factorId ?? null, factorLabel: only?.factorLabel ?? null }];
  });
}

/** The card's words: one named option, or the generic words for two or more (or a label the gates refuse). */
export function composeUntestedOptionCard(label: string | null, count: number, factorLabel: string | null = null): FragileLinkChallengeCopy {
  const one = count === 1;
  const which = label !== null ? `“${label}”` : one ? 'one of your options' : 'some of your options';
  const it = one ? 'it does' : 'they do';
  // The title stands alone (a surface may show it without the body): it names the option when one is named.
  const named = one && label !== null ? `“${label}” was not tested` : null;
  // Naming the factor it has no level for; the shorter "has no level yet" keeps the basis clause within the bound.
  const lacks = one && factorLabel !== null
    ? `it has no level yet for “${factorLabel}”`
    : `${it} not yet set a level for what ${one ? 'it changes' : 'they change'}`;
  return {
    title: named !== null && named.length <= RUN_TURN_COACHING_CONTRACT.limits.title_max
      ? named : one ? 'One option was not tested' : 'Some options were not tested',
    body: `This analysis did not test ${which}: ${lacks}, `
      + 'so the result does not cover ' + (one ? 'it.' : 'them.'),
    action_label: one ? 'Give its level' : 'Give their levels',
    // The basis clause is the one that yields, so a long label shortens the ask rather than refusing the card.
    action_prompt: [
      `This analysis did not test ${which} because ${lacks}. `
        + `Ask me what level ${one ? 'it sets' : 'each sets'} and what that rests on. ${ELICITATION_CLOSE}`,
      `This analysis did not test ${which} because ${lacks}. `
        + `Ask me what level ${one ? 'it sets' : 'each sets'}. ${ELICITATION_CLOSE}`,
    ].find((f, i, all) => f.length <= RUN_TURN_COACHING_CONTRACT.limits.action_prompt_max || i === all.length - 1)!,
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
    ...(untested.length === 1 ? [{ named: true, copy: composeUntestedOptionCard(untested[0]!.label, 1, untested[0]!.factorLabel) }] : []),
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
