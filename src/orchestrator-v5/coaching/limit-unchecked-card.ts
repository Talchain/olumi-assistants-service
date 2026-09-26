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
 * they say back the USER'S stated threshold ("10% per month") only when
 * `coaching/bound-graph.ts` `statedThreshold` proves it is the user's own (an
 * explicit row, a level frame, a scale the row itself proves — never inferred
 * from magnitude — and the node's only row); a form the copy gates refuse
 * drops the threshold and keeps the name. They name the limits only when the
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
 * ── THE PROVED CAUSE (26 Sep 2026) ─────────────────────────────────────────
 * "Not checked or not met" is the most the leader claim alone licenses. When
 * `coaching/bound-graph.ts` `everyLimitProvedUnanchored` proves that EVERY limit
 * sits on a part of the model Olumi works out from other parts (the estate's one
 * mirror of PLoT's anchor rule, read on its refusal side: such a limit "would
 * certainly not have been scored"), the card says the definite verdict and its
 * cause instead: it could not be checked, because Olumi cannot yet test a limit
 * on a quantity like that. The run's own summary speaks the same arm from the
 * same collector, so on an explicit run the card no longer sits vaguer than the
 * sentence above it. On the automatic first pass the summary is replaced, so the
 * card is the only place the cause is said. Served `4c3b512` (#70 5843612217):
 * without it, the user gave churn's current value and re-ran, and the limit
 * stayed unchecked, as the cause says it must. The cause invites nothing
 * (RC #63 5825683899: no "which part", no "its value today", no "run again"),
 * and the ask carries it, so the explanation turn starts from it. A proved card
 * carries `:unanchored` in its signal_id. If the proved words do not fit, the
 * card falls back to today's words, never to a link card.
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
  signal_id: `${LIMIT_UNCHECKED_SIGNAL_ID_PREFIX}<graph_hash>:<run computed_at>:<effective trigger>[:named][:unanchored]`,
  block_id: 'deterministicBlockId(signal_id)',
  reads: "readback analysis_state.leader_claim: permitted === false && withheld_reason === 'constraint_verdict_withheld'"
    + '; for the cause, bound-graph.ts everyLimitProvedUnanchored(the bound graph, analysis_ready.options)',
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
  /** Every limit PROVED on a part Olumi works out from other parts (`everyLimitProvedUnanchored`). */
  provedUnanchored = false,
): FragileLinkChallengeCopy {
  const named: NamedLimit[] = limits === undefined ? [] : (typeof limits === 'string' ? [limits] : [...limits])
    .map((l) => (typeof l === 'string' ? { label: l, stated: null } : l));
  const { action_prompt_max: promptMax } = RUN_TURN_COACHING_CONTRACT.limits;
  // The body carries "one reason"; a prompt that would not fit with it drops that clause, never the no-write ask.
  const promptOf = (forms: readonly string[]) => forms.find((p) => p.length <= promptMax) ?? forms[forms.length - 1]!;
  const ASK = 'Explain what that means for how far I can rely on this analysis. Don\'t change the model or re-run anything yet.';
  if (provedUnanchored) return composeProvedCause(firstPass, named, ASK);
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

/**
 * The proved-cause words: the definite verdict ("could not check") and its cause, per named count.
 * The cause clause is the card's register of the summary's unanchored arm; it names no remedy. Each
 * field is the first form within its bound: the body drops "one reason" before anything else, and the
 * prompt keeps the names, the cause and the no-write ask in every form.
 */
function composeProvedCause(firstPass: boolean, named: readonly NamedLimit[], ask: string): FragileLinkChallengeCopy {
  const { body_max: bodyMax, action_prompt_max: promptMax } = RUN_TURN_COACHING_CONTRACT.limits;
  const fit = (forms: readonly string[], max: number) => forms.find((f) => f.length <= max) ?? forms[forms.length - 1]!;
  const quoted = named.map((l) => `“${l.label}”${l.stated !== null ? ` (${l.stated})` : ''}`);
  const REASON = ' That is one reason no option is put forward yet.';
  const bodyOf = (finding: string) => fit([`${finding}${REASON}`, finding]
    .map((f) => (firstPass ? `${FIRST_PASS_PREFIX}it ${f}` : `This analysis ${f}`)), bodyMax);
  if (quoted.length >= 2) {
    const list = `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
    return {
      title: 'This model cannot check your limits yet',
      body: bodyOf(`could not check your limits on ${list}: Olumi works those out from other parts of your model `
        + 'and cannot yet test a limit on quantities like those.'),
      action_label: 'What this means for my limits',
      action_prompt: fit([
        `Olumi could not check my limits on ${list}: it works those out from other parts of my model and cannot `
          + `yet test a limit on quantities like those. ${ask}`,
        `Olumi cannot yet check my limits on ${list}: it works those out from other parts of my model. ${ask}`,
      ], promptMax),
    };
  }
  if (quoted.length === 1) {
    return {
      title: 'This model cannot check your limit yet',
      body: bodyOf(`could not check your limit on ${quoted[0]}: Olumi works that out from other parts of your model `
        + 'and cannot yet test a limit on a quantity like that.'),
      action_label: 'What this means for my limit',
      action_prompt: fit([
        `Olumi could not check my limit on ${quoted[0]}: it works that out from other parts of my model and cannot `
          + `yet test a limit on a quantity like that. ${ask}`,
        `Olumi cannot yet check my limit on ${quoted[0]}: it works that out from other parts of my model. ${ask}`,
      ], promptMax),
    };
  }
  return {
    title: 'This model cannot check the limits yet',
    body: bodyOf('could not check the limits on the model: they point at parts Olumi works out from other parts of '
      + 'your model, and it cannot yet test a limit on quantities like those.'),
    action_label: 'What this means for my limits',
    action_prompt: 'Olumi could not check the limits on my model: they point at parts it works out from other parts of '
      + `my model, and it cannot yet test a limit on quantities like those. ${ask}`,
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
  /** `bound-graph.ts` `everyLimitProvedUnanchored` on the SAME bound graph; false → today's words. */
  provedUnanchored = false,
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
  // Cascade: with a proved cause, the cause is kept before the names (it is what stops the dead end);
  // each arm tries names with the user's stated thresholds → names only → the generic words.
  const firstPass = effectiveTrigger === 'auto_first_pass';
  const namedLimits: NamedLimit[] | null = limitLabel === undefined ? null
    : (typeof limitLabel === 'string' ? [limitLabel] : [...limitLabel]).map((l) => (typeof l === 'string' ? { label: l, stated: null } : l));
  const nameForms: (NamedLimit[] | undefined)[] = [
    ...(namedLimits === null ? [] : [namedLimits, namedLimits.map((l) => ({ label: l.label, stated: null }))]),
    undefined,
  ];
  const arms = provedUnanchored ? [true, false] : [false];
  const chosen = arms.flatMap((cause) => nameForms.map((ls) => ({ cause, named: ls !== undefined, copy: composeLimitUncheckedCard(firstPass, ls, cause) })))
    .find((c) => copyPasses(c.copy));
  if (chosen === undefined) return { block: null, reason: 'copy_gate' };
  const { copy } = chosen;

  const signalId = `${LIMIT_UNCHECKED_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${effectiveTrigger}`
    + `${chosen.named ? ':named' : ''}${chosen.cause ? ':unanchored' : ''}`;
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
