/**
 * ⭐ PROACTIVE ELIGIBILITY FOR DSK-P-002 (Outside view exercise).
 *
 * WHY THIS EXISTS. The product can already EXECUTE the outside view beautifully
 * and it cannot DECIDE TO OFFER IT. The whole live path is reactive: the
 * `outside_view` ExerciseBlock (`belief-elicitation/reference-class-block.ts`)
 * is reachable only after the user spontaneously types a K-of-N base rate and
 * confirms it. Nothing notices that a base rate is MISSING and asks — which is
 * the point of the protocol. `compose/conversation-text-signals.ts` computes
 * DSK-TR-002's text signal, is tested, is attested against the bundle bytes,
 * and has no consumer. This module is that consumer.
 *
 * ⭐⭐ THE BUNDLE IS THE AUTHORITY. Every id, title, strength, stage, required
 * input and question is READ from `data/dsk/v1.json` through the existing
 * verified loaders. Nothing about the science is restated here, so editing the
 * catalogue changes behaviour — which is exactly what was not true before:
 * `queryDsk` has zero production callers and all five live DSK citations came
 * from hand-written id constants.
 *
 * ── ⚠ WHAT THIS DELIBERATELY DOES NOT CLAIM TO DO ──────────────────────────
 * It does NOT identify "this number is an estimate rather than a fact". That
 * was the intended design and it is MEASURED IMPOSSIBLE on this estate's own
 * data, two independent ways:
 *
 *   1. TEXT. Over 388 banked rich models (17 briefs, 2,317 labelled numeric
 *      spans), the SAME span carries opposite labels across runs: "Basic
 *      (£19/mo, 60% of users)" is `user_estimate` in 24 and `current` in 90;
 *      so are "Pro (£49/mo, 30%)", "£49", "30%", "10%". Of the 669 non-estimate
 *      instances that survive the frame filter below, 489 (73%) are spans whose
 *      identical text is labelled `user_estimate` elsewhere. The distinction is
 *      not in the words.
 *   2. STRUCTURE. `ObservedStateV3.extractionType` cannot answer it either, and
 *      the schema says so at `schemas/cee-v3.ts:137-147`: its members "describe
 *      HOW THE PIPELINE READ THE BRIEF, and `explicit` is stamped just as
 *      readily on a ceiling as on a measurement" — measured live 14 Sep 2026,
 *      "keeping monthly churn under 4%" arrived as
 *      `{ value: 0.04, extractionType: "explicit" }`. The field that WOULD
 *      answer it, `observed_state.stated_role`, has exactly ONE member
 *      (`OBSERVED_STATE_STATED_ROLES = ["constraint"]`) and its own contract
 *      forbids reading absence as an observation.
 *
 * So the predicate runs the other way round, and fails closed: it EXCLUDES the
 * quantity frames that ARE well marked, and offers only on what is left. That
 * is a weaker claim than "this is a forecast", and it is the strongest claim the
 * data supports.
 */
import { DskClaimProvenanceSchema } from '@talchain/schemas/boundary';
import type {
  DskClaimProvenance,
  DskProtocolProvenance,
} from '@talchain/schemas/boundary';

import type { DSKProtocol, DSKTrigger } from '../../dsk/types.js';
import { loadVerifiedDskBundle } from '../compose/dsk-bundle-record.js';
import { resolveDskClaimProvenance } from '../compose/dsk-claim-record.js';
import { resolveDskProtocolProvenance } from '../compose/dsk-protocol-record.js';
import type { ConversationTextSignals } from '../compose/conversation-text-signals.js';
import { literalProtocolSteps } from './typed-intent-directive.js';

/** DSK-TR-002 — "Low confidence / planning optimism → outside view". */
export const OUTSIDE_VIEW_TRIGGER_ID = 'DSK-TR-002';
/** DSK-P-002 — the protocol the trigger links to. Asserted against the bundle. */
export const OUTSIDE_VIEW_PROTOCOL_ID = 'DSK-P-002';
/** DSK-T-002 — the technique claim that carries the evidence pack. */
export const OUTSIDE_VIEW_CLAIM_ID = 'DSK-T-002';

/**
 * Quantity frames that MARK a number as something other than a bare point
 * estimate.
 *
 * ⛔ DERIVED FROM THE CORPUS, NOT FROM MY HEAD. Each pattern is traceable to
 * spans in `output/outside-view-20260922/estimate_predicate_corpus.json`, built
 * from 388 banked models over 17 briefs — input the author did not write.
 * Measured on it (1,789 non-estimate instances vs 98 traced user-estimate
 * instances):
 *
 *   negative suppression  62.6% overall — limit 97%, horizon 90%, target 84%,
 *                         current 30%
 *   positive suppression   1.0%  (1 of 98 — the cost of being wrong is low)
 *
 * The weak arm is `current`, and that is the irreducible ambiguity above, not a
 * missing pattern. **A false positive therefore remains possible on a bare
 * current fact** ("the team is 35 people"). It costs one suggested action asking
 * a framing question about the DECISION rather than about that number.
 *
 * ⛔ THIS USED TO SAY "at most once per decision per stage". THAT WAS NOT TRUE and
 * no code implemented it — the Canvas Completion lane's review proved the offer
 * re-attached on every later substantive turn (their probes P3 and P4). What is
 * now enforced is narrower and is stated exactly: a CONFIRM, an ENGAGE or a
 * DECLINE anywhere in the window — including the current turn — settles it. An
 * offer the user simply IGNORED is still re-made, because nothing durable records
 * that it fired, and `assistant_message` excludes block copy so it cannot see
 * itself. Closing that needs a durable per-decision-per-stage record; until one
 * exists this comment must not claim the guarantee.
 *
 * ⚠ A bare worded horizon ("next quarter") is deliberately NOT suppressed:
 * requiring a preposition keeps deadline language out while leaving a forecast
 * that names its period ("we'll land 40 next quarter") eligible, which is the
 * case the protocol is for.
 */
const PERIOD = '(?:day|week|month|quarter|year)s?';
const FRAMES: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'horizon_frame',
    new RegExp(
      `\\b(?:with ?in|over|by|after|for|during)\\s+(?:the\\s+)?(?:next|this|coming|following)?\\s*\\d*\\s*${PERIOD}`,
      'i',
    ),
  ],
  [
    'constraint_op',
    /\b(?:under|above|below|over|at\s+most|at\s+least|no\s+more\s+than|no\s+less\s+than|exceed\w*|cap\w*\s+at|max\w*|min\w*|without\s+pushing|keeping)\b/i,
  ],
  [
    'current_state',
    /\b(?:we\s+have|we\s+currently|currently|current\w*|today\s+we|at\s+present|existing|from\s+£?[\d,]+\w*)/i,
  ],
  [
    // ⭐ ASKING FOR A CALCULATION IS NOT PROVIDING AN ESTIMATE. DSK-TR-002 fires
    // when "user provides point estimates"; a narrow arithmetic request supplies
    // no estimate at all, and interrupting it with a method offer is the
    // interruption-cost failure CTL-11 was written to catch — which it did catch
    // here, on the first run, before this pattern existed.
    //
    // NARROW BY CONSTRUCTION: an explicit operator BETWEEN two numeric tokens.
    // "£59 × 3,200 subscribers" matches; "we'll lose 40 customers if we move to
    // £59" does not, because no operator sits between the two numbers. A broader
    // "is this a question?" test would swallow real estimates phrased as
    // questions, which is the opposite error.
    'computation_request',
    /£?[\d,.]+\s*(?:[×x*/÷+]|times|divided\s+by|multiplied\s+by)\s*£?[\d,.]+/i,
  ],
  [
    'target_frame',
    /\b(?:increas\w+|reach\w*|achiev\w*|grow\w*\s+to|target\b|goal\b|objective\b|need\s+to\s+\w+|get\s+to|hit\w*|aim\w*)\b/i,
  ],
];

/**
 * Range or hedging language — DSK-TR-002 fires only on estimates given
 * "without range or uncertainty acknowledgement", so any of these stands the
 * method down. Checked BEFORE the frames so the verdict names the honest reason.
 */
const RANGE_OR_HEDGE =
  /\b(?:between\s+\S+\s+and|roughly|approx\w*|about|around|circa|±|\+\/-|or\s+so|somewhere|we\s+think|i\s+think|not\s+sure|unsure|could\s+be|might\s+be|maybe|perhaps|best\s+case|worst\s+case|ball ?park|give\s+or\s+take|expect\w*|estimat\w*|assum\w*|project\w*|forecast\w*|reckon\w*|guess\w*|suppos\w*|my\s+sense|gut\s+feel)\b/i;

export type OutsideViewFrame = (typeof FRAMES)[number][0];

export interface QuantityFraming {
  /** The frames that matched, in declaration order. Empty means unframed. */
  readonly frames: readonly string[];
  /** Range or hedging language is present. */
  readonly uncertaintyAcknowledged: boolean;
}

/** Pure, order-free classification of one utterance's quantity framing. */
export function quantityFraming(text: string): QuantityFraming {
  const t = typeof text === 'string' ? text : '';
  return {
    frames: FRAMES.filter(([, re]) => re.test(t)).map(([name]) => name),
    uncertaintyAcknowledged: RANGE_OR_HEDGE.test(t),
  };
}

/**
 * ⭐⭐ THE TWO STAGE VOCABULARIES ARE DIFFERENT, AND THE OVERLAP IS ONLY HALF.
 *
 * Measured: the product's wire `Stage` (schemas `boundary`) is
 * `['frame','analyse','decide','review']`. The DSK bundle's `DecisionStage`
 * (`src/dsk/types.ts:8-13`) is `['frame','ideate','evaluate','decide','optimise']`.
 * They share only `frame` and `decide`.
 *
 * DSK-P-002's `stage_applicability` is `['frame','evaluate']` — and `evaluate` is
 * NOT a product stage. So passing a product stage straight into an exact-token
 * applicability check silently makes HALF of this protocol's declared
 * applicability unreachable: it can only ever match `frame`, and every analysis
 * turn reads as not-applicable for a reason that is really a vocabulary mismatch.
 * That is a declared threshold nothing mounts, and it is invisible in a green
 * suite because the refusal looks like a correct refusal.
 *
 * ⚠ A PRIVATE TWIN OF THIS MAPPING ALREADY EXISTS, unexported, at
 * `handlers/edit-graph-dispatch.ts` (`mapStageToDecisionStage`), and
 * `coaching/typed-intent-directive.ts:117-131` documents choosing exact-token
 * matching precisely BECAUSE it is not exported. The values here are identical to
 * that twin, deliberately, and the accompanying spec pins this map's keys against
 * the product enum and its values against `DECISION_STAGES` — both DERIVED from
 * their own authorities — so the two cannot drift apart in silence.
 */
const PRODUCT_TO_DSK_STAGE: Readonly<Record<string, string>> = {
  frame: 'frame',
  analyse: 'evaluate',
  decide: 'decide',
  review: 'optimise',
};

/**
 * The DSK stage a product stage stands for.
 *
 * ⛔ FAILS CLOSED on an unknown stage: an unmapped product stage returns the
 * input unchanged, so it matches nothing rather than defaulting to an applicable
 * stage. A new product stage therefore costs the offer, never a wrong offer.
 */
export function dskStageForProductStage(stage: string): string {
  return PRODUCT_TO_DSK_STAGE[stage] ?? stage;
}

export type OutsideViewNotApplicableReason =
  | 'protocol_unavailable'
  | 'stage_not_applicable'
  | 'user_states_no_comparable_cases'
  | 'history_window_incomplete'
  | 'reference_class_already_discussed'
  | 'quantity_is_framed_not_estimated'
  | 'uncertainty_already_acknowledged';

/** The protocol's OWN `required_inputs`, mapped to the two things we can check. */
export type OutsideViewMissingInput =
  | 'decision_description'
  | 'user_estimate_or_assumption';

export interface OutsideViewInputs {
  /** From `deriveConversationTextSignals` — carries the fail-closed window gate. */
  readonly signals: ConversationTextSignals;
  /** The user's verbatim message for this turn. */
  readonly userMessage: string;
  /** The turn's decision stage, matched EXACT-TOKEN against the bundle. */
  readonly stage: string;
  /** Does the conversation carry a decision to reason about at all? */
  readonly hasDecisionDescription: boolean;
  /**
   * CANONICAL completion signal: a confirmed reference class exists for this
   * decision. Preferred over scanning prose — a persisted confirmation is
   * stronger evidence than a phrase match, and it avoids a second science ledger.
   */
  readonly confirmedReferenceClassPresent: boolean;
  /**
   * An explicit decline visible in the durable conversation window.
   * ⚠ There is no typed decline ledger in the estate, so cross-session decline
   * persistence is NOT guaranteed. Disclosed, not papered over.
   */
  readonly declineObservedInWindow: boolean;
  /** The user has already taken the offer up in this window (see `declined`). */
  readonly engageObservedInWindow: boolean;
  /**
   * The user has said there are no comparable cases. ⛔ Only ever the user's own
   * claim: deterministic code must never INFER that a decision is unprecedented,
   * because testing whether a useful class exists is what the protocol does.
   */
  readonly userStatesNoComparableCases: boolean;
}

export type OutsideViewVerdict =
  | {
      readonly eligibility: 'eligible';
      readonly protocol: DskProtocolProvenance;
      readonly claim: DskClaimProvenance;
      /** The protocol's own FIRST authored step, verbatim from the bundle. */
      readonly invitation: string;
    }
  | { readonly eligibility: 'needs_input'; readonly missing: readonly OutsideViewMissingInput[] }
  | { readonly eligibility: 'not_applicable'; readonly reason: OutsideViewNotApplicableReason }
  | { readonly eligibility: 'already_completed' }
  | { readonly eligibility: 'declined' };

function na(reason: OutsideViewNotApplicableReason): OutsideViewVerdict {
  return { eligibility: 'not_applicable', reason };
}

/** The protocol record, the trigger record, and the bundle-derived link between them. */
function loadProtocolAndTrigger(): { protocol: DSKProtocol; trigger: DSKTrigger } | null {
  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return null;
  const objects = bundle.objects ?? [];
  const protocol =
    objects.find(
      (o): o is DSKProtocol =>
        o.type === 'protocol' && o.id === OUTSIDE_VIEW_PROTOCOL_ID && o.deprecated !== true,
    ) ?? null;
  const trigger =
    objects.find(
      (o): o is DSKTrigger =>
        o.type === 'trigger' && o.id === OUTSIDE_VIEW_TRIGGER_ID && o.deprecated !== true,
    ) ?? null;
  if (protocol === null || trigger === null) return null;
  // DERIVED, NEVER TRANSCRIBED: the trigger must itself name this protocol.
  // If the bundle is re-authored so the link moves, this REDs rather than
  // citing a protocol the trigger no longer points at.
  if (!(trigger.linked_protocol_ids ?? []).includes(OUTSIDE_VIEW_PROTOCOL_ID)) return null;
  return { protocol, trigger };
}

/**
 * Decide whether to OFFER the outside view on this turn.
 *
 * Precedence is deliberate and tested: settled state (completed, declined) and
 * the user's own statements outrank any signal we derive, and every absence
 * claim is gated on a provably complete window.
 */
export function assessOutsideViewEligibility(input: OutsideViewInputs): OutsideViewVerdict {
  const records = loadProtocolAndTrigger();
  if (records === null) return na('protocol_unavailable');
  const { protocol } = records;

  // 1. Settled state first — never re-open finished or refused work.
  if (input.confirmedReferenceClassPresent) return { eligibility: 'already_completed' };
  // ⛔ ENGAGING SETTLES IT TOO. The user pressing "Take the outside view" has
  // started the protocol; attaching the same offer to the reply that answers them
  // is nagging. Measured as probe P2 by the Canvas Completion lane's review.
  if (input.engageObservedInWindow) return { eligibility: 'already_completed' };
  if (input.declineObservedInWindow) return { eligibility: 'declined' };

  // 2. The user's own claim outranks anything we could infer.
  if (input.userStatesNoComparableCases) return na('user_states_no_comparable_cases');

  // 3. Applicability, exact-token against the bundle's own stage list.
  const dskStage = dskStageForProductStage(input.stage);
  if (!(protocol.stage_applicability ?? []).includes(dskStage as never)) {
    return na('stage_not_applicable');
  }

  // 4. ⭐ THE FAIL-CLOSED GATE. `conversation-text-signals.ts` states the rule:
  //    consumers MUST require `windowComplete` before acting on any
  //    `...VocabularyPresent === false`. An "you never considered a reference
  //    class" nudge over unseen text is a claim we cannot support.
  if (!input.signals.windowComplete) return na('history_window_incomplete');

  // 5. Already covered in conversation — the bundle's first negative condition.
  if (input.signals.referenceClassVocabularyPresent) {
    return na('reference_class_already_discussed');
  }

  // 6. The protocol's OWN required_inputs. ⛔ NOT "a reference class is missing":
  //    identifying one is the protocol's FIRST STEP, never its prerequisite.
  const missing: OutsideViewMissingInput[] = [];
  if (!input.hasDecisionDescription) missing.push('decision_description');
  if (!input.signals.numericEstimatePresent) missing.push('user_estimate_or_assumption');
  if (missing.length > 0) return { eligibility: 'needs_input', missing };

  // 7. Is the quantity a bare point, or is it framed / already hedged?
  const framing = quantityFraming(input.userMessage);
  if (framing.uncertaintyAcknowledged) return na('uncertainty_already_acknowledged');
  if (framing.frames.length > 0) return na('quantity_is_framed_not_estimated');

  // 8. Offer. Provenance comes from the bundle through the existing verified
  //    resolvers; a failure costs the offer, never a partial or invented triple.
  const protocolProvenance = resolveDskProtocolProvenance(OUTSIDE_VIEW_PROTOCOL_ID);
  const claimProvenance = resolveDskClaimProvenance(OUTSIDE_VIEW_CLAIM_ID);
  if (protocolProvenance === null || claimProvenance === null) return na('protocol_unavailable');

  // The claim triple must carry THIS protocol, or the badge would cite a
  // technique claim beside an unrelated protocol.
  const boundClaim = DskClaimProvenanceSchema.safeParse({
    ...claimProvenance,
    protocol_id: OUTSIDE_VIEW_PROTOCOL_ID,
  });
  if (!boundClaim.success) return na('protocol_unavailable');

  // ⭐ steps[0], NOT steps[1]. The first step asks the user to name the broader
  // category; the second already assumes a class exists and asks what typically
  // happened. Offering the second jumps the protocol. Filtered by the existing
  // placeholder-free rule so authoring syntax can never reach a user.
  const invitation = literalProtocolSteps(protocol)[0];
  if (invitation === undefined) return na('protocol_unavailable');

  return {
    eligibility: 'eligible',
    protocol: protocolProvenance,
    claim: boundClaim.data,
    invitation,
  };
}
