/**
 * ⭐ C4 — ONE TYPED NEXT REASONING MOVE PER RUN (build train #70 5855068711, row C4; design 5855041235, accepted by
 * Runtime 5855043957 and AI Conversation 5855047908).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * P3C (#70 5855014136, 5855024189), measured on Paul's three served runs: the run-turn card was chosen by a FIXED
 * precedence of caveat types, so the one card was a limit notice 3/3 — twice "Your limit could not be checked", a
 * system defect the user cannot act on — while the run's value of information was read by no card at all.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * The move is chosen by what it lets the user DO, first match wins:
 *   0 `limit_risk_leader`     — the named leader probably breaks a limit it was scored on. Not a choice: saying it is
 *                               the CONDITION for naming the leader (AI Quality claim permission 5842498806).
 *   1 `missing_level`         — an option the run could not test for want of a level → give its level.
 *   2 `no_option_meets_limit` — a SCORED limit no option meets (F-LIMIT tiers) → change or add an option.
 *     `real_figure`           — a limit checked only against Olumi's estimate / an assumed figure → give the real one.
 *     `missing_value`         — a top-3 driver (PLoT's structural order) the model holds NO value for, and no option
 *                               sets → give its value (PJ-B3; `unvalued-driver-card.ts`): never presented as an
 *                               analysed driver. After the limit moves (DL #2154 CHANGES_REQUIRED item 1).
 *   3 (reserved) value of information — NOT in this selector: AI Quality 5855170731 ruled factor EVPPI structurally
 *                               zero in today's additive engine (a root factor adds the same β·X to every option), so
 *                               it cannot truthfully select anything until B2's identity kinds land. Added then, with AIQ.
 *   4 `link_view`             — the grounded fragile / assumed link (or the no-flagged-link card) → my view of it.
 *                               NEVER a link that is an operand of an identity the model declares on its target
 *                               (`nonlinear_identity.factor_ids`, e.g. MRR = price × subscribers): that relation is a
 *                               definition, not a belief (R&C manual-test review #69 5837270934, F1/A1: the served
 *                               "Pressure-test this link" on price → MRR was the wrong intervention): the next fragile
 *                               link that is not a definition speaks; when every one is, no card (`definitional_link`).
 *                               And NEVER a link the bound graph does not hold (`modelLinks`): the run can report a
 *                               fragile edge its own graph lacks (served hiring, CEE 9bd3747) → no card (`link_not_in_model`).
 *   5 `near_tie`              — a first-pass near tie → which difference matters most.
 * A limit left unchecked for a cause the user cannot close (not scored, no writer) is NEVER the move: its card's
 * words are returned as a CAVEAT, for the reply to say once (`caveats`).
 *
 * The chosen block is the run-turn card, rendered once (AI Conversation's acceptance row); `capability` names the
 * Agent tool the move's action maps to (`agent-lane/runtime/agent-tools.ts`), or `ask_only` — Runtime's guard
 * downgrades any capability not in its table to ask-only (5855043957).
 *
 * Pure: every leg is an existing builder with its own gates, reordered. No clock, no LLM, no telemetry.
 */
import type { CoachingBlock } from '@talchain/schemas/boundary';

import {
  buildFragileLinkChallenge,
  FIRST_PASS_PREFIX,
  readRecord,
  type FragileLinkChallengeInput,
  type RunTurnCoachingEligibility,
} from './fragile-link-challenge.js';
import { buildNoFlaggedLinkCard } from './no-flagged-link-card.js';
import { composeEdgeIdentity } from '../compose/edge-address.js';
import { buildLimitUncheckedCard, everyOptionBreaksALimit, leaderWithheldForALimit } from './limit-unchecked-card.js';
import { buildUntestedOptionCard, untestedOptions } from './untested-option-card.js';
import { everyLimitProvedUnanchored, limitNodeLabels } from './bound-graph.js';
import { buildNearTieCard } from './near-tie-card.js';
import { buildEstimatedLimitCard } from './estimated-limit-card.js';
import { buildLeaderLimitRiskCard } from './leader-limit-risk-card.js';
import { buildUnvaluedDriverCard } from './unvalued-driver-card.js';
import { COACHING_BLOCK_BODY_MAX } from './fragile-edge-offer-text.js';
import { readLimitVerdicts } from '../../orchestrator/context/constraint-feasibility.js';

export type NextMoveKind =
  | 'limit_risk_leader'
  | 'missing_level'
  | 'missing_value'
  | 'no_option_meets_limit'
  | 'real_figure'
  | 'link_view'
  | 'near_tie';

/** The Agent tool each move's action maps to (`agent-tools.ts`), or `ask_only` when the move only asks. */
export const NEXT_MOVE_CAPABILITY: Readonly<Record<NextMoveKind, string>> = Object.freeze({
  limit_risk_leader: 'ask_only',
  missing_level: 'propose_option_interventions',
  missing_value: 'propose_assumptions',
  no_option_meets_limit: 'propose_new_option',
  real_figure: 'propose_starting_point',
  link_view: 'propose_link_strength',
  near_tie: 'ask_only',
});

export interface NextMove {
  readonly kind: NextMoveKind;
  readonly capability: string;
  /** The run-turn card: the move, rendered once. */
  readonly block: CoachingBlock;
  /** The entity ids the move is about, from the card's own typed `target_refs`. */
  readonly target_ids: readonly string[];
}

/** A limit the run could not check for a cause the user cannot close: said once by the reply, never the move. */
export interface NextMoveCaveat {
  readonly kind: 'limit_not_checked';
  /** The limit card's own words (`limit-unchecked-card.ts`), unchanged — no longer rendered as the run-turn card. */
  readonly block: CoachingBlock;
}

export interface NextMoveInputs {
  readonly input: FragileLinkChallengeInput;
  /** The bound run's own `analysis_ready`. */
  readonly analysisReady: unknown;
  /** The READBACK's `analysis_state`. */
  readonly analysisState: unknown;
  /** The READBACK's constraint verdict state (`final.constraintVerdictState`). */
  readonly constraintVerdictState: unknown;
  /** The READBACK's `LeaderLimitRisk[]` (`final.leaderLimitRisks`). */
  readonly leaderLimitRisks: unknown;
  /** The graph proven to be the run's own (`bound-graph.ts` `graphBoundToHash`), else null. */
  readonly boundGraph: Record<string, unknown> | null;
  /** B5 (#2146): the READBACK's per-limit verdicts (`final.limitVerdicts`, the same read); absent → aggregate only. */
  readonly limitVerdicts?: unknown;
}

export interface NextMoveSelection {
  readonly move: NextMove | null;
  /** Why there is no move (the link path's own reason, as before); null when there is one. */
  readonly reason: Extract<RunTurnCoachingEligibility, { eligible: false }>['reason'] | null;
  readonly caveats: readonly NextMoveCaveat[];
}

/**
 * The edge identities (`${fromId}→${toId}`, the card's own composite) the bound graph declares as DEFINITIONS: each
 * operand of a node's `nonlinear_identity.factor_ids`, into that node. No graph → empty (today's selection).
 */
export function definitionalLinks(boundGraph: Record<string, unknown> | null): ReadonlySet<string> {
  const out = new Set<string>();
  const nodes = boundGraph?.nodes;
  if (!Array.isArray(nodes)) return out;
  for (const node of nodes.map(readRecord)) {
    const operands = readRecord(node?.nonlinear_identity)?.factor_ids;
    if (typeof node?.id !== 'string' || !Array.isArray(operands)) continue;
    for (const from of operands) if (typeof from === 'string' && from.length > 0) out.add(composeEdgeIdentity(from, node.id));
  }
  return out;
}

/**
 * The edge identities (`${from}→${to}`) of the bound graph: the only links a link move may name (a fragile edge the
 * run reports but the model does not hold is not a relationship the user can be asked about). No graph → null
 * (today's selection).
 */
export function modelLinks(boundGraph: Record<string, unknown> | null): ReadonlySet<string> | null {
  const edges = boundGraph?.edges;
  if (!Array.isArray(edges)) return null;
  const out = new Set<string>();
  for (const edge of edges.map(readRecord)) {
    const from = edge?.from ?? edge?.from_id;
    const to = edge?.to ?? edge?.to_id;
    if (typeof from === 'string' && from.length > 0 && typeof to === 'string' && to.length > 0) out.add(composeEdgeIdentity(from, to));
  }
  return out;
}

/** The limit card's closing sentence (`limit-unchecked-card.ts`): the one-card form drops it, keeping the finding. */
const ONE_REASON = ' That is one reason no option is put forward yet.';
const FIRST_PASS_SUBJECT = 'This first pass on Olumi\'s estimates ';

/** The limit card's quoted list of limits (`on “A” (v) and “B” (w)`), which the short form drops. */
const NAMED_LIMITS_RE = / on “[^”]+”(?: \([^)]*\))?(?:(?:, | and )“[^”]+”(?: \([^)]*\))?)*/;

/**
 * The limit card's OWN finding as one sentence — "This first pass on Olumi's estimates could not check your limit on
 * “Monthly churn” (10%)." — or null when its words are not that card's known shape (the card is then unchanged).
 */
function caveatSentence(caveat: CoachingBlock): string | null {
  const body = typeof caveat.body === 'string' ? caveat.body : '';
  const subject = body.startsWith(`${FIRST_PASS_PREFIX}it `) ? FIRST_PASS_SUBJECT
    : body.startsWith('This analysis ') ? 'This analysis ' : null;
  if (subject === null || !body.endsWith(ONE_REASON)) return null;
  const rest = body.slice(subject === FIRST_PASS_SUBJECT ? `${FIRST_PASS_PREFIX}it `.length : 'This analysis '.length);
  return `${subject}${rest.slice(0, -ONE_REASON.length)}`;
}

/**
 * ⭐ The caveat said ONCE, on the move card (#70 5859409296; DL 5859428786): until the reply carries `caveats`
 * (Runtime's C1 hook), a limit left unchecked would otherwise reach the user nowhere. The body opens with the limit
 * card's own finding, then the move's words without the shared first-pass opening. Over `body_max` → unchanged.
 */
export function withCaveatSentence(move: NextMove, caveats: readonly NextMoveCaveat[]): NextMove {
  const first = caveats[0];
  if (first === undefined) return move;
  const sentence = caveatSentence(first.block);
  const body = typeof move.block.body === 'string' ? move.block.body : '';
  if (sentence === null || body.length === 0) return move;
  const rest = body.startsWith(FIRST_PASS_PREFIX)
    ? `${body.charAt(FIRST_PASS_PREFIX.length).toUpperCase()}${body.slice(FIRST_PASS_PREFIX.length + 1)}`
    : body;
  // Preferred first: the finding naming the limits; then the same finding without the list (Paul 08bf9a1f's two
  // limits + the link card = 334 chars). Neither fits → unchanged; the caveat stays in `caveats` for the reply.
  const composed = [`${sentence} ${rest}`, `${sentence.replace(NAMED_LIMITS_RE, '')} ${rest}`]
    .find((b) => b.length <= COACHING_BLOCK_BODY_MAX);
  return composed === undefined ? move : { ...move, block: { ...move.block, body: composed } };
}

function moveOf(kind: NextMoveKind, block: CoachingBlock, ids?: readonly string[]): NextMove {
  const refs = Array.isArray(block.target_refs) ? block.target_refs : [];
  return { kind, capability: NEXT_MOVE_CAPABILITY[kind], block, target_ids: ids ?? refs.map((r) => r.id) };
}

/** The one move for this run, and any caveat the reply must say. Total. */
export function selectNextMove(args: NextMoveInputs): NextMoveSelection {
  const { input, analysisReady, analysisState, constraintVerdictState, leaderLimitRisks, boundGraph } = args;
  const leaderClaim = readRecord(readRecord(analysisState)?.leader_claim);
  const runOptions = readRecord(analysisReady)?.options;

  // The limit gate, read FIRST so its caveat rides with whichever move wins: a scored limit no option meets is a move
  // the user can make (F-LIMIT); a limit unchecked for a cause the user cannot close is a caveat, never the move.
  const caveats: NextMoveCaveat[] = [];
  let noOptionMeets: CoachingBlock | null = null;
  const everyOption = everyOptionBreaksALimit(analysisState);
  // B5 (#2146; wire C01 on 08fbba5, DL GO 5861158484): "could not check" is true ONLY for an `unscored` limit (MG
  // 5861148718). When the typed per-limit rows attest that EVERY limit was checked — some only against Olumi's
  // estimate — a withheld leader is not a limit the user cannot check, and saying so would be false.
  const perLimit = readLimitVerdicts(args.limitVerdicts);
  const everyLimitChecked = perLimit !== null && perLimit.per_limit.every((r) => r.state !== 'unscored');
  if (everyOption !== null || (leaderWithheldForALimit(analysisState) && !everyLimitChecked)) {
    const limitLabels = boundGraph !== null ? limitNodeLabels(boundGraph) ?? undefined : undefined;
    const provedUnanchored = everyOption === null && boundGraph !== null && everyLimitProvedUnanchored(boundGraph, runOptions);
    const limit = buildLimitUncheckedCard(input, limitLabels, provedUnanchored, constraintVerdictState, everyOption);
    if (limit.block !== null && everyOption !== null) noOptionMeets = limit.block;
    else if (limit.block !== null) {
      caveats.push({ kind: 'limit_not_checked', block: limit.block });
    }
  }

  // 0 — the condition for naming the leader.
  const risk = buildLeaderLimitRiskCard(input, constraintVerdictState, leaderClaim, leaderLimitRisks, boundGraph);
  if (risk.block !== null) return { move: withCaveatSentence(moveOf('limit_risk_leader', risk.block), caveats), reason: null, caveats };

  // 1 — an option the run could not test.
  const untested = buildUntestedOptionCard(input, analysisReady);
  if (untested !== null) {
    // The card carries no target ref (an option is not a target kind); the move names the option and, when the one
    // missing-level authority names exactly one, the factor it has no level for.
    const ids = untestedOptions(analysisReady, input.analysisResult).flatMap((o) => (o.factorId !== null ? [o.id, o.factorId] : [o.id]));
    return { move: withCaveatSentence(moveOf('missing_level', untested, ids), caveats), reason: null, caveats };
  }

  // 2 — a limit gap the user can close.
  if (noOptionMeets !== null) return { move: moveOf('no_option_meets_limit', noOptionMeets), reason: null, caveats };
  // "Checked against Olumi's estimate" presupposes the limit WAS checked: never beside a "could not be checked" caveat,
  // whatever a disagreeing verdict field says (the readback's typed claim wins, as before C4).
  const estimate = caveats.length === 0
    ? buildEstimatedLimitCard(input, constraintVerdictState, boundGraph, runOptions, perLimit)
    : { block: null };
  if (estimate.block !== null) return { move: moveOf('real_figure', estimate.block), reason: null, caveats };

  // 2c — a factor the result depends on most (PLoT's top 3) that the model holds no value for (PJ-B3, DL 5860325629):
  // never said as an analysed driver — said as the ask it is. AFTER the limit moves (DL #2154 CHANGES_REQUIRED item 1).
  const unvalued = buildUnvaluedDriverCard(input, boundGraph);
  if (unvalued !== null) return { move: withCaveatSentence(moveOf('missing_value', unvalued), caveats), reason: null, caveats };

  // 4 — the user's view of the link the result rests on.
  const built = buildFragileLinkChallenge({
    ...input, definitionalLinks: definitionalLinks(boundGraph), modelLinks: modelLinks(boundGraph),
  });
  const chosen = built.block === null && built.reason === 'no_groundable_fragile_edge' ? buildNoFlaggedLinkCard(input) : built;
  if (chosen.block !== null) return { move: withCaveatSentence(moveOf('link_view', chosen.block), caveats), reason: null, caveats };

  // 5 — a first-pass near tie with no flagged link.
  const tie = buildNearTieCard(input, leaderClaim?.withheld_reason, Array.isArray(runOptions) ? runOptions.length : null);
  if (tie.block !== null) return { move: withCaveatSentence(moveOf('near_tie', tie.block), caveats), reason: null, caveats };
  return { move: null, reason: chosen.reason, caveats };
}
