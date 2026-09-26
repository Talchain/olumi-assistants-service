/**
 * THE FIRST PASS'S ONE NEXT MOVE WHEN THE OPTIONS COME OUT CLOSE — the run-turn
 * card for a near tie with no flagged link (AI Quality 5841805590, R&C PR-6).
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 * Served 26 Sep (CEE 3829c96, the hiring brief): the automatic first pass came
 * out as a near tie (top-two gap 0.057 < 0.1) with ZERO fragile links, and the
 * user got NO card. The link card had nothing to challenge, and the
 * no-flagged-link card cannot speak on a first pass because the confinement
 * drops `display_verdict` (`edge_sensitivity_not_evidenced`). The one move that
 * directs the user to the deciding criterion was missing.
 *
 * ── WHAT IT READS (AI Quality's five conditions, each a RED row) ───────────
 *   1. The run's OWN typed verdict: `enrichment.robustness.near_tie.is_tie ===
 *      true` with `fragile_edges` an EMPTY array, `option_comparison_status
 *      === 'computed'`, and the result bound to the readback
 *      (`computed_against_hash === graphHash`), so a tie from an earlier graph
 *      never speaks.
 *   2. Scope-matched words: `near_tie` measures the TOP-TWO gap, so with other
 *      than exactly two options the card says "the strongest options", never
 *      "the options". No option is named.
 *   3. Attributed: "On Olumi's estimates…". Never "equally good", "no
 *      difference" or a probability.
 *   4. Not when the comparison itself is void: a failed or partial comparison
 *      (the status above), or a leader withheld because an identity sign is
 *      unproven (`nonlinear_identity_sign_unproven`, C46), whose own copy
 *      already says why the options cannot be separated.
 *   5. No remedy that promises a recompute: the action asks for the user's
 *      criterion.
 * The AUTOMATIC first pass only: the permission covers that pass, where no
 * other card can speak. An explicit Run keeps today's cards.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
import {
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  isAutomaticRun,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
} from './fragile-link-challenge.js';

export const NEAR_TIE_SIGNAL_ID_PREFIX = 'coach:near_tie:';

/** C46 stage 1's withheld reason: its own copy explains why the options cannot be separated. */
export const WITHHELD_IDENTITY_SIGN_UNPROVEN = 'nonlinear_identity_sign_unproven';

/** The card's words. `optionCount` is the model's option count; only exactly two reads "the two options". */
export function composeNearTieCard(optionCount: number): FragileLinkChallengeCopy {
  const who = optionCount === 2 ? 'the two options' : 'the strongest options';
  return {
    title: 'Say what matters most in this choice',
    body: `On Olumi's estimates ${who} come out close, so this first pass cannot separate them. `
      + 'Worth saying which difference between them matters most to you.',
    action_label: 'Say what matters most to me',
    action_prompt: `On Olumi's estimates ${who} come out close on this first pass. Ask me which difference `
      + 'between them matters most to me, and why. Don\'t change the model or re-run anything yet.',
  };
}

export type NearTieCardDecision =
  | { readonly block: CoachingBlock; readonly reason: null }
  | { readonly block: null; readonly reason: 'not_a_first_pass_near_tie' | 'identity_mismatch' | 'copy_gate' };

/**
 * Build the one near-tie card, or say why not. Total. `withheldReason` is the
 * READBACK's `leader_claim.withheld_reason` (condition 4).
 */
export function buildNearTieCard(
  input: FragileLinkChallengeInput,
  withheldReason: unknown,
  /**
   * The model's option count, from `analysis_ready.options` itself — NOT from the label list, which drops a
   * blank label (contract-legal) and would read a 3-option model as "the two options" (#1949 review N1).
   * Unknown → "the strongest options", which is true of any count.
   */
  optionCount: number | null = null,
): NearTieCardDecision {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }
  const enrichment = readRecord(result.enrichment);
  const robustness = readRecord(enrichment?.robustness);
  const nearTie = readRecord(robustness?.near_tie);
  const firstPass = input.trigger === 'auto_first_pass' || isAutomaticRun(enrichment);
  // A VISIBLE normaliser error may have dropped a fragile row, so "0 fragile rows" is not established.
  // (The confinement drops the list on a first pass; the tie itself is read from `near_tie`, not from it.)
  const errors = robustness?.normalization_errors;
  const isNearTie = firstPass
    && nearTie?.is_tie === true
    && Array.isArray(robustness?.fragile_edges) && robustness.fragile_edges.length === 0
    && (errors === undefined || (Array.isArray(errors) && errors.length === 0))
    && enrichment?.option_comparison_status === 'computed'
    && withheldReason !== WITHHELD_IDENTITY_SIGN_UNPROVEN;
  if (!isNearTie) return { block: null, reason: 'not_a_first_pass_near_tie' };

  const copy = composeNearTieCard(optionCount ?? 0);
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };

  const signalId = `${NEAR_TIE_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:auto_first_pass`;
  const parsed = CoachingBlockSchema.safeParse({
    type: 'coaching',
    // 'orientation' ("Getting oriented" in the UI's details line): the card orients the user on the deciding
    // criterion. 'widening' rendered "Widening the options", which misdescribes it (#1949 review N2).
    coaching_kind: 'orientation',
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: input.computedAt,
    source_handler: RUN_TURN_COACHING_CONTRACT.block.source_handler,
    graph_hash_at_generation: input.graphHash,
    freshness: 'fresh',
    source: RUN_TURN_COACHING_CONTRACT.block.source,
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    target_refs: [],
    ...copy,
  });
  return parsed.success ? { block: parsed.data, reason: null } : { block: null, reason: 'copy_gate' };
}
