/**
 * THE RUN-TURN LIMIT CARD — the third run-turn coaching card (contract
 * `run-turn-coaching/v1`, beside `fragile-link-challenge.ts` and
 * `no-flagged-link-card.ts`).
 *
 * For a run whose leader is withheld FOR A LIMIT. It says that the run could
 * not confirm the options stay within the limits on the model, and hands the
 * user one question turn: what that means for relying on it.
 *
 * ── WHY IT OUTRANKS THE LINK CARDS ─────────────────────────────────────────
 * Paul's manual test 1a298d6d (scenario cbd15f83, CEE bdd43f4a; R&C review
 * #69 5837270934): the automatic first pass could not check his churn limit
 * (CONSTRAINT_TARGET_UNRELIABLE), so the leader was withheld — yet the one next
 * action on screen was "Pressure-test this link" on a link whose strength
 * Olumi had assumed. A limit the run could not check or found unmet is the
 * decisive caveat; challenging a link beside it is the wrong next action.
 * `runTurnCoaching` therefore calls this card INSTEAD of the link cards, never
 * beside them (one next action).
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 * ONE typed fact, the READBACK's `analysis_state.leader_claim`:
 * `permitted === false` with `withheld_reason === 'constraint_verdict_withheld'`.
 * That code is emitted only when the run's constraint verdict denies naming a
 * leader (`composeLeaderClaim`, compose/analysis-state-v1.ts), and a verdict
 * denies only in `evaluated_infeasible`, `unevaluated` or `identity_unresolved`
 * (`MAY_NAME_LEADING_OPTION`, orchestrator/context/constraint-feasibility.ts;
 * `not_applicable`, the state with no ratified limit, permits). So "at least
 * one limit was not checked or not met" is true in every state it fires on.
 * Olumi's own words name no threshold or number of their own. Beside a named limit
 * they say back the USER'S stated threshold ("at most 10% per month") only when
 * `coaching/bound-graph.ts` `statedThreshold` proves it is the user's own (an
 * explicit row, a level frame, the user's units, the node's only row); a form
 * the copy gates refuse drops the threshold and keeps the name. They name the limits only when the
 * caller proved the graph is the run's own (`coaching/bound-graph.ts`: hash
 * bound), joined by `goal_constraints[].node_id` → each node's label: one node
 * reads "your limit on “A”", two or three read "your limits on “A” and “B”"
 * (`limitNodeLabels`; more than three, a missing or duplicated node, or two
 * nodes sharing a label → the generic words). Naming every limit keeps "at least
 * one was not checked or not met" true without claiming WHICH one: no typed
 * per-limit verdict reaches this card. The labels are the user's own, quoted
 * verbatim: when a label carries a figure the copy gates pass ("Churn ≤ 4%"),
 * the card quotes that figure inside the quotes and adds none of its own. A
 * named card carries `:named` in its signal_id, so one block_id never names two
 * bodies (the bound graph fixes the labels for one run).
 *
 * The prose summary is NOT an input. The automatic first pass replaces it
 * wholesale (compose/unrequested-analysis-confinement.ts), which is why the
 * #1922 prose gate (`summaryAsksUserToRepairALimit`) never saw Paul's limit.
 *
 * ── ITS ACTION ─────────────────────────────────────────────────────────────
 * A plain question turn, self-contained: the Agent's state tool does not return
 * the model's limits or their verdicts, so the prompt carries the fact itself.
 * It asks for an explanation only — it promises no write and asks for no figure
 * (a missing baseline is not automatically something the engine could use).
 *
 * ── NO SCIENCE BADGE ───────────────────────────────────────────────────────
 * No `dsk_claim_provenance`: this card reports the run's own limit verdict; it
 * runs no decision-science protocol.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
import type { NamedLimit } from './bound-graph.js';
import { WITHHELD_CONSTRAINT_VERDICT } from '../compose/analysis-state-v1.js';
import {
  FIRST_PASS_PREFIX,
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  isAutomaticRun,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
  type RunTurnCoachingReason,
  type RunTurnTrigger,
} from './fragile-link-challenge.js';

export const LIMIT_UNCHECKED_SIGNAL_ID_PREFIX = 'coach:limit_unchecked:';

/** The card's block contract, as data (the shared bounds live on RUN_TURN_COACHING_CONTRACT). */
export const LIMIT_UNCHECKED_CARD_CONTRACT = Object.freeze({
  signal_id: `${LIMIT_UNCHECKED_SIGNAL_ID_PREFIX}<graph_hash>:<run computed_at>:<effective trigger>[:named]`,
  block_id: 'deterministicBlockId(signal_id)',
  reads: "readback analysis_state.leader_claim: permitted === false && withheld_reason === 'constraint_verdict_withheld'",
  target_refs: '[]',
  dsk_claim_provenance: 'absent',
  action_intent: 'absent',
});

/**
 * Does the READBACK's typed leader claim say the run withheld the leader for a
 * limit? Exact match on both fields; anything else (permitted, a near tie, an
 * unrequested first pass, an unknown code, a missing claim) is `false`.
 */
export function leaderWithheldForALimit(analysisState: unknown): boolean {
  const claim = readRecord(readRecord(analysisState)?.leader_claim);
  return claim?.permitted === false && claim.withheld_reason === WITHHELD_CONSTRAINT_VERDICT;
}

/**
 * The card's words, fixed per effective trigger and per named limit (so one block_id always
 * carries one body). `limitLabel` is the one limit node's label from a hash-bound graph, or
 * absent for the generic words.
 */
export function composeLimitUncheckedCard(
  firstPass: boolean,
  limits?: string | readonly (string | NamedLimit)[],
): FragileLinkChallengeCopy {
  const named: NamedLimit[] = limits === undefined ? [] : (typeof limits === 'string' ? [limits] : [...limits])
    .map((l) => (typeof l === 'string' ? { label: l, stated: null } : l));
  const { action_prompt_max: promptMax } = RUN_TURN_COACHING_CONTRACT.limits;
  // The body carries "one reason"; a prompt that would not fit with it drops that clause, never the no-write ask.
  const promptOf = (forms: readonly string[]) => forms.find((p) => p.length <= promptMax) ?? forms[forms.length - 1]!;
  const ASK = 'Explain what that means for how far I can rely on this analysis. Don\'t change the model or re-run anything yet.';
  if (named.length >= 2) {
    const quoted = named.map((l) => `“${l.label}”${l.stated !== null ? ` (${l.stated})` : ''}`);
    const list = `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
    const finding = `could not confirm that the options stay within your limits on ${list}: at least one was not `
      + 'checked or not met. That is one reason no option is put forward yet.';
    return {
      title: 'Check your limits before relying on this',
      body: firstPass ? `${FIRST_PASS_PREFIX}it ${finding}` : `This analysis ${finding}`,
      action_label: 'What this means for my limits',
      action_prompt: promptOf([
        `Olumi could not confirm the options stay within my limits on ${list}: at least one was not checked or was `
          + `not met, which is one reason no option is put forward yet. ${ASK}`,
        `Olumi could not confirm the options stay within my limits on ${list}: at least one was not checked or was `
          + `not met. ${ASK}`,
      ]),
    };
  }
  const one = named[0];
  if (one !== undefined) {
    const limit = `“${one.label}”${one.stated !== null ? ` (${one.stated})` : ''}`;
    const finding = `could not confirm that the options stay within your limit on ${limit}: it was not `
      + 'checked or not met. That is one reason no option is put forward yet.';
    return {
      title: 'Check your limit before relying on this',
      body: firstPass ? `${FIRST_PASS_PREFIX}it ${finding}` : `This analysis ${finding}`,
      action_label: 'What this means for my limit',
      action_prompt: promptOf([
        `Olumi could not confirm the options stay within my limit on ${limit}: it was not checked or was not `
          + `met, which is one reason no option is put forward yet. ${ASK}`,
        `Olumi could not confirm the options stay within my limit on ${limit}: it was not checked or was not met. ${ASK}`,
      ]),
    };
  }
  const finding = 'could not confirm that the options stay within the limits on the model: at least one was not '
    + 'checked or not met. That is one reason no option is put forward yet.';
  return {
    title: 'Check the limits before relying on this',
    body: firstPass ? `${FIRST_PASS_PREFIX}it ${finding}` : `This analysis ${finding}`,
    action_label: 'What this means for my limits',
    action_prompt:
      'Olumi could not confirm the options stay within the limits on my model: at least one was not checked or was '
      + `not met, which is one reason no option is put forward yet. ${ASK}`,
  };
}

export type LimitUncheckedCardDecision =
  | { readonly block: CoachingBlock; readonly reason: null }
  | { readonly block: null; readonly reason: Exclude<RunTurnCoachingReason, 'no_run_this_turn'> };

/**
 * Build the one limit card, or say which gate refused it. Total. The caller has
 * already established that the leader is withheld for a limit
 * ({@link leaderWithheldForALimit}); this builder repeats only the identity gate.
 */
export function buildLimitUncheckedCard(
  input: FragileLinkChallengeInput,
  /** The limits from a HASH-BOUND graph (`coaching/bound-graph.ts` `limitNodeLabels`); absent → generic words. */
  limitLabel?: string | readonly (string | NamedLimit)[],
): LimitUncheckedCardDecision {
  // (0) identity, repeated so the builder is total on its own.
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }

  // (1) the words: fixed per effective trigger, gated, bounded.
  const enrichment = readRecord(result.enrichment);
  const effectiveTrigger: RunTurnTrigger =
    input.trigger === 'auto_first_pass' || isAutomaticRun(enrichment) ? 'auto_first_pass' : 'explicit_run';
  // A label the copy gates refuse (a raw decimal, an id-shaped token, leader words, too long) is dropped for
  // the generic words — the card still ships; it never falls back to a link card. The gates pass a whole
  // number or percentage in the user's own label ("Churn ≤ 4%"): the user's figure, quoted, never Olumi's.
  // Cascade: names with the user's stated thresholds → names only → the generic words.
  const firstPass = effectiveTrigger === 'auto_first_pass';
  const namedLimits: NamedLimit[] | null = limitLabel === undefined ? null
    : (typeof limitLabel === 'string' ? [limitLabel] : [...limitLabel]).map((l) => (typeof l === 'string' ? { label: l, stated: null } : l));
  const candidates = namedLimits === null ? []
    : [namedLimits, namedLimits.map((l) => ({ label: l.label, stated: null }))].map((ls) => composeLimitUncheckedCard(firstPass, ls));
  const named = candidates.find((c) => copyPasses(c)) ?? null;
  const useNamed = named !== null;
  const copy = named ?? composeLimitUncheckedCard(firstPass);
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };

  const signalId = `${LIMIT_UNCHECKED_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${effectiveTrigger}${useNamed ? ':named' : ''}`;
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
    ...copy,
  });
  if (!parsed.success) return { block: null, reason: 'copy_gate' };
  return { block: parsed.data, reason: null };
}
