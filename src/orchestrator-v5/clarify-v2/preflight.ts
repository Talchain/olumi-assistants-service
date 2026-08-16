/**
 * Clarify v2 — draft-preflight decision core + response composition
 * (ROADMAP 1.94 Option A replacement; E0-B lane).
 *
 * The PURE half of the capability: given a brief (round 1) or a persisted
 * round state plus the user's reply (resume), decide whether to ASK up to
 * `CLARIFY_V2_MAX_QUESTIONS_PER_ROUND` clarifying questions or PROCEED to
 * the draft. The I/O half (pending-action read, commit, telemetry) lives
 * in `handlers/clarify-v2-dispatch.ts`.
 *
 * Doctrine invariants encoded here (Paul, 16 Jul; clarify-brief-1.94.md §E3):
 *
 *   - QUESTION BUDGET, NOT A CAP: up to 3 questions when the brief is
 *     thin, 0 when it is complete. The retired clarifier's hard-coded
 *     ONE-question cap (`questions[0]`) is structurally gone.
 *   - SEMANTIC NO-REPEAT, BY CONSTRUCTION: a rubric dimension is asked AT
 *     MOST ONCE per scenario (`asked_dimensions` is the REAL asked-history,
 *     persisted on the pending action — the old plumbing always passed
 *     `previous_answers: []`). An ANSWERED question can additionally never
 *     re-fire because its answer satisfies the dimension's detector
 *     (template invariant, `questions.ts`).
 *   - EXPLICIT READY-TO-DRAFT STOP RULE: `decideClarifyV2Resume` PROCEEDS
 *     — never stalls, never re-asks — when (a) the working brief is
 *     complete, (b) every still-missing dimension has already been asked
 *     (the user chose not to answer it; defaults apply), (c) the round
 *     budget (`CLARIFY_V2_MAX_ROUNDS`) is exhausted, or (d) the user says
 *     go-ahead (the default-forward chip, a bare confirmation, or an
 *     explicit-generate turn). Every ask-response's copy names the escape
 *     hatch ("say 'go ahead'…"), so the stop rule is user-visible, not
 *     just internal.
 *   - ANSWERS INCORPORATE VIA THE NORMAL TURN FLOW: candidate chips carry
 *     plain user-voice messages; the resume appends them to the working
 *     brief and the eventual draft runs through the ordinary
 *     `dispatchDraftGraph` with a `briefOverride` — no bespoke
 *     incorporation LLM call (the retired `incorporateAnswer` burned
 *     ~14.6k tokens/round under a contradictory system prompt).
 *
 * Pure and total: no I/O, no Date.now(), no config reads.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import {
  DRAFT_GRAPH_MAX_BRIEF_LENGTH,
  INTERROGATIVE_QUESTION_PATTERN,
} from '../../schemas/assist.js';
import {
  EDIT_GRAPH_POSITIVE_REGEX,
  EDIT_GRAPH_NEGATIVE_REGEX,
} from '../../orchestrator/routing/edit-graph-intent-regex.js';
import type { SuggestedAction } from '../compose/types.js';
import {
  assessBriefCompleteness,
  type ClarifyDimension,
} from './rubric.js';
import { composeClarifyQuestions, type ClarifyQuestion } from './questions.js';

export const CLARIFY_V2_MAX_QUESTIONS_PER_ROUND = 3;
export const CLARIFY_V2_MAX_ROUNDS = 2;

/**
 * The chip budget — D-K ("0–3 chips", ratified 15 Jul) as a PRODUCER
 * contract, not a rendering hint.
 *
 * Why this exists (dress rehearsal, 20 Jul): this module used to emit
 * `[...everyCandidate, proceedChip]` uncapped — 10 chips on a plain thin
 * brief, up to 16 at the full question budget. The UI renders the first
 * three. Because the escape hatch was appended LAST, it was ALWAYS the
 * chip the cap dropped: the one chip the clarify doctrine calls mandatory
 * ("no question is ever a dead end") was the only one guaranteed never to
 * reach the user. Emitting more than the consumer renders does not
 * degrade gracefully — it silently deletes whatever the producer ordered
 * last, so the ORDER decided the doctrine, which is exactly backwards.
 *
 * The producer therefore caps here, and — the load-bearing half — emits
 * the escape hatch FIRST rather than last.
 *
 * Why first and not "in the reserved last slot": the consumer's cap is
 * not ours and it moves. At DGAI staging `42390d7f` the render is
 * `slice(0, 3)` (SuggestedChips.tsx), but the comment on the line above
 * it reads `DS v5 §21.4 "max 2" cap; the DS doc amendment is owned by
 * the DS-1 lane` — i.e. the design system currently says TWO and the
 * code says THREE, with an amendment pending in another lane. A
 * last-slot escape hatch is correct only while the consumer's cap is
 * exactly the number this file assumed; the day DS-1 lands "2", the
 * escape hatch silently dies again in precisely the way it just did.
 * First-position survives ANY cap >= 1, so the guarantee stops being
 * contingent on a number owned by a different repo.
 *
 * (If DS-1 ratifies 3 permanently, moving the hatch back to last for
 * readability is a safe follow-up — but it re-couples us to their cap.)
 *
 * WHY HERE AND NOT IN THE EGRESS FINALIZER: `compose/chip-finalizer.ts`
 * already runs on every V5 response and carries its own `MAX_CHIPS = 3`,
 * but that budget is scoped to the SUGGESTION family
 * (`chip_action_*` / `chip_prompt_*` / `prop_`). Clarification and
 * candidate-pick chips — ours, `cv2_*` — are deliberately EXEMPT there:
 * "Candidate / clarification chips are NOT counted and are never trimmed
 * (their own composers already size them)." That delegation is correct;
 * this composer simply was not holding up its end. Sizing here is the
 * composer keeping the contract the finalizer already assumes, not a
 * second capping mechanism competing with it.
 *
 * NOTE the two 3s are independent constants for independent budgets. If
 * one moves, check the other deliberately — do not assume they track.
 */
export const CLARIFY_V2_MAX_CHIPS = 3;

/**
 * Slots left for candidate answers once the escape hatch has its
 * reserved one. DERIVED, never hand-maintained — the recorded
 * mirror-drift defect class.
 */
export const CLARIFY_V2_CANDIDATE_CHIP_BUDGET = CLARIFY_V2_MAX_CHIPS - 1;

/**
 * The default-forward chip — the explicit "proceed with defaults" escape
 * every clarify response carries. Its `message` is deliberately a stable
 * constant: the resume path recognises it (alongside free-typed
 * equivalents via `CLARIFY_V2_PROCEED_PATTERN`) as the ready-to-draft
 * signal. No `action_type`: it re-submits as a fresh user turn through
 * normal routing, where the live pending action claims it.
 */
export const CLARIFY_V2_PROCEED_CHIP_ID = 'cv2_proceed_default';
/**
 * TRACK-1 INTAKE FIX (2026-08-13) — the chip stops claiming "sensible
 * defaults". INTAKE-FUNNEL §3 measured the truth at the bytes: NO default
 * values exist anywhere in the flow — the proceed resume drafts from the
 * original brief verbatim (trim/cap only) and the drafter fills the gaps
 * with its own assumptions. The old copy implied a defaults table that
 * does not exist. The new message still matches the UNCHANGED
 * CLARIFY_V2_PROCEED_PATTERN, and the pattern deliberately RETAINS the old
 * "with sensible defaults" alternation so in-flight chips minted by the
 * previous build keep resolving after deploy.
 */
export const CLARIFY_V2_PROCEED_MESSAGE = 'Go ahead and draft the model.';

/**
 * Typed go-ahead detection for the resume path. STRONG confirmations
 * ("yes", "go ahead", "draft it") count: the ask-copy explicitly offers
 * "say 'go ahead'", and a bare yes to a question LIST is a proceed
 * signal, not an answer to any single question. Anchored ^…$ so an
 * answer that merely contains "yes" is never mis-claimed.
 *
 * Review fix A4 (1.152): the WEAK acks (ok / okay / sure / fine) are
 * deliberately NOT here — a bare "ok" to a three-question list is an
 * acknowledgement, not consent to skip the questions. They live in
 * `CLARIFY_V2_BARE_ACK_PATTERN` and get a one-time re-offer of the
 * default-forward choice; after that re-offer (a direct yes/no question)
 * the same ack IS consent and proceeds.
 *
 * Review fix A12 (1.152) — why this vocabulary is NOT derived from
 * `SHORT_CONFIRM_PATTERN` (routing/deterministic-short-confirm.ts): the
 * two patterns answer different consent questions. SHORT_CONFIRM
 * confirms a SINGLE concrete offered action ("apply it", "do that"), so
 * weak acks are rightly consent there and its vocabulary carries
 * apply/confirm verbs that would be wrong here; this pattern consents to
 * "skip the remaining questions and draft with defaults", so it carries
 * draft-domain phrases (draft it, use sensible defaults, skip the
 * questions) meaningless to short-confirm — and, after A4, deliberately
 * EXCLUDES the weak acks short-confirm accepts. Deriving either from the
 * other would re-couple two different consent surfaces; the divergence
 * is pinned in clarify-v2.preflight.test.ts (1.152 A12).
 */
export const CLARIFY_V2_PROCEED_PATTERN =
  /^\s*(?:yes|yep|yeah|go ahead(?:\s+and\s+draft(?:\s+the\s+model)?(?:\s+with\s+sensible\s+defaults)?)?|proceed|continue|carry on|just draft(?:\s+it|\s+the\s+model)?|draft (?:it|the model)|use (?:sensible\s+)?defaults|skip(?:\s+the\s+questions)?)\s*[.!]?\s*$/i;

/** Review fix A4 (1.152): weak single-word acks — re-offer, don't assume. */
export const CLARIFY_V2_BARE_ACK_PATTERN = /^\s*(?:ok(?:ay)?|sure|fine)\s*[.!]?\s*$/i;

/**
 * Review fix A1 (1.152): the closed DECLINE cue set (hold off / not now /
 * don't want / stop / cancel / later / wait). Anchored ^…$ with only
 * politeness tails tolerated, so a cue word INSIDE a real answer ("we
 * should wait until Q3…") is never mis-claimed. The don't-want arm only
 * accepts process objects (answer / do this / continue) — "I don't want
 * to expand into Germany" is a statement about the DECISION and must fold
 * into the brief, not release the round.
 *
 * 1.152(i) (#498-review P2) — widened for genuine declines the first cut
 * missed, still anchored, still process-object-only:
 *   - bare no-forms ("no", "No.", "nope", "nah") and "no thanks" /
 *     "no thank you" (the politeness TAIL now carries the whole decline
 *     when the cue is a bare no);
 *   - "cancel it/this/that" (process object on the cancel arm — "the
 *     options are to cancel the contract or…" stays an answer because the
 *     pattern is anchored and 'the contract' is not an accepted object);
 *   - "let's not (do this/that | continue | bother) (now/yet)?" — bare
 *     "let's not" included; "let's not expand into Germany" is about the
 *     DECISION and still folds as an answer (unaccepted object);
 *   - a leading softener adverb ("actually/honestly hold off",
 *     "Actually, no").
 */
export const CLARIFY_V2_DECLINE_PATTERN =
  /^\s*(?:(?:actually|honestly)[,\s]+)?(?:no[,.\s]+)?(?:i\s+)?(?:(?:please\s+)?hold\s+off(?:\s+for\s+now)?|not\s+(?:now|yet|right\s+now)|don'?t\s+want\s+to(?:\s+answer(?:\s+(?:these|those|the|any))?(?:\s+questions?)?|\s+do\s+this(?:\s+(?:now|yet))?|\s+continue)?|let'?s\s+not(?:\s+(?:do\s+(?:this|that)|continue|bother)(?:\s+(?:now|yet|right\s+now))?)?|stop|cancel(?:\s+(?:it|this|that))?|(?:maybe\s+)?later|wait|no|nope|nah)\s*[,.!]?\s*(?:please|thanks|thank\s+you)?\s*[.!]?\s*$/i;

/**
 * 1.152(i) (#498-review P3, decision PINNED here): a HEDGED proceed —
 * "not sure — maybe just draft it?" — is proceed-INTENT without clear
 * consent. It is deliberately:
 *   - NOT a decline (the user is leaning toward drafting, not away);
 *   - NOT an answer-fold (the hedge is about OUR questions, not the
 *     decision — folding it in would pollute the working brief);
 *   - NOT an immediate proceed (a trailing '?' is a request for the
 *     assistant's judgement, not consent to skip the questions).
 * It takes the SAME calibration as the bare ack (A4): one direct yes/no
 * re-offer ("shall I draft with sensible defaults?"), after which the
 * same hedge — or any ack — IS consent and proceeds. Anchored: a hedge
 * opener is REQUIRED and the tail must be a recognised proceed phrase, so
 * "maybe we should expand into France" still folds as an answer.
 */
export const CLARIFY_V2_HEDGED_PROCEED_PATTERN =
  /^\s*(?:(?:i'?m\s+|i\s+am\s+)?not\s+sure|unsure|maybe|perhaps|i\s+guess)[\s,.…—–-]*(?:maybe\s+|perhaps\s+)?(?:just\s+)?(?:draft\s+(?:it|the\s+model)|go\s+ahead|proceed|use\s+(?:sensible\s+)?defaults)\s*[.!?]?\s*$/i;

/**
 * Review fix A1 (1.152), not-an-answer guard: a reply that is itself a
 * question TO the assistant (interrogative opener + trailing '?'). Never
 * folded into the working brief; re-offered once per round, then treated
 * as a decline.
 *
 * ROADMAP 2.715: the pattern itself now lives in `schemas/assist.ts` as
 * `INTERROGATIVE_QUESTION_PATTERN`, so round-1 INTAKE can consult the same
 * discriminator this resume path has always used (the asymmetry named in
 * `process-meta-intake.ts`). Re-exported here under the historical name —
 * this IS that object, not a copy of it.
 */
export const CLARIFY_V2_QUESTION_REPLY_PATTERN = INTERROGATIVE_QUESTION_PATTERN;

/**
 * INV-M (ROADMAP 2.716) — a mutation COMMAND is an IMPERATIVE, and the
 * imperative position is what separates it from an ANSWER.
 *
 * ⚠ THIS ANCHOR IS THE PRECISION TERM, AND IT WAS DERIVED FROM THE ESTATE'S
 * OWN TESTS, NOT FROM A HAND-WRITTEN CORPUS. The first cut of this predicate
 * used `EDIT_GRAPH_POSITIVE_REGEX` unanchored and passed a negative corpus
 * this lane wrote itself. Running the full required gate then turned four
 * existing suites RED on real clarify answers — `"The goal is to increase
 * revenue."` (`clarify-v2.preflight.test.ts`) and `"Yes, add the churn-risk
 * factor."` (a proposal chip's canned message) — because a perfectly ordinary
 * answer mentions an edit verb inside a clause. A self-authored negative
 * corpus could not see that; the suite could.
 *
 * So the verb must be in COMMAND position: at the head of the message, after
 * at most a leading discourse marker. `"Change the price to 90,000"` is an
 * instruction; `"The goal is to increase revenue"` is a statement that
 * happens to contain `increase`.
 *
 * The verb alphabet is NOT re-spelled here — the pattern is composed from
 * `EDIT_GRAPH_POSITIVE_REGEX.source`, so the route's list stays the single
 * source and this anchor cannot drift from it.
 *
 * The marker list is deliberately TINY. It is a recall widener only: a marker
 * this list lacks means the command folds, i.e. today's behaviour, never a new
 * failure mode. `yes`/`ok`/`no` are deliberately absent — `"Yes, add the
 * churn-risk factor."` is a CONSENT chip replay, and claiming it here would
 * break the proposal flow next door.
 */
const MUTATION_IMPERATIVE_PREAMBLE = String.raw`^\s*(?:(?:actually|please|sorry)\b[\s,.:;—–-]*)*`;

const CLARIFY_V2_MUTATION_IMPERATIVE_PATTERN = new RegExp(
  MUTATION_IMPERATIVE_PREAMBLE + EDIT_GRAPH_POSITIVE_REGEX.source,
  'i',
);

/**
 * The correction frame the estate-wide positive regex does not carry.
 *
 * Measured at `8c316b5e`: of the eight mutation commands proven to fold,
 * "Actually, make HubSpot's licence cost 90,000 instead" matches NEITHER
 * `EDIT_GRAPH_POSITIVE_REGEX` (`make` is not a listed edit verb) NOR
 * `isValueUpdatePhrasing`. The derivation's own §3.2 table records it as
 * `edit-lane: no` while its §5.2 asks for 8/8; this closes that gap without
 * widening ESTATE-WIDE edit-dispatch recall, which is rowed separately (§6 R1)
 * precisely because it needs its own precision controls at every edit surface.
 *
 * Same imperative anchor, for the same reason: "we could make the switch
 * instead of waiting" is an answer, not a command.
 */
const CLARIFY_V2_MUTATION_CORRECTION_PATTERN = new RegExp(
  MUTATION_IMPERATIVE_PREAMBLE + String.raw`make\b[^?]*\b(?:instead|rather\s+than)\b`,
  'i',
);

/**
 * INV-M (ROADMAP 2.716) — does this reply read as a command to MUTATE the
 * graph rather than as an answer to the pending clarify question?
 *
 * Uses the route's OWN edit-dispatch gates (`edit-graph-intent-regex.ts`,
 * extracted under ROADMAP 2.308/S2 to be import-clean for exactly this kind of
 * consumer), in imperative position. The negative regex is load-bearing: it is
 * what keeps "Can you explain why you added that factor?" an ordinary question
 * rather than a mutation command.
 *
 * ⚠ NOT `containsMutationLanguage` (`routing/mutation-language.ts`). That
 * module detects the ASSISTANT's own first-person claims ("I'll add…",
 * "Proposing to set…") and matches none of these user imperatives — the row's
 * named instrument is the wrong machine.
 */
export function isGraphMutationCommand(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (EDIT_GRAPH_NEGATIVE_REGEX.test(message)) return false;
  return (
    CLARIFY_V2_MUTATION_IMPERATIVE_PATTERN.test(message) ||
    CLARIFY_V2_MUTATION_CORRECTION_PATTERN.test(message)
  );
}

/**
 * ROADMAP 2.171 (Paul-ratified) — the post-explicit-Stop choice.
 *
 * When a user STOPS a draft and types a NEW brief on the same scenario, the
 * live clarify round claims it as an answer and FOLDS it into the ORIGINAL
 * working brief — correct fence semantics, but the plain ack ("Thanks — I
 * have folded that in") reads as "my stop didn't take" (stop-fence
 * acceptance probe, arm 1). The ratified fix KEEPS the fold and makes it
 * explicit with an escape: the reply in exactly this state disclosures the
 * original topic and offers "fold this in, or start over?".
 *
 * "Start over" routes to the EXISTING new-draft path, no new machinery: the
 * resume re-runs `decideClarifyV2Round1` over the message the disclosure was
 * issued for (persisted as `startOverBrief`, armed for exactly one round —
 * a later ordinary fold rebuilds the state without it, because by then
 * "start over" has no unambiguous referent).
 *
 * The chip's canned message must stay inside the typed pattern — pinned in
 * clarify-v2.post-stop.test.ts the same way A10 pins the proceed constant.
 */
export const CLARIFY_V2_START_OVER_CHIP_ID = 'cv2_start_over';
export const CLARIFY_V2_START_OVER_MESSAGE = 'Start over with my new brief.';
export const CLARIFY_V2_START_OVER_PATTERN =
  /^\s*(?:start\s+(?:over|again|fresh|afresh)(?:\s+with\s+(?:my|the)\s+new\s+(?:brief|decision|topic))?|start\s+a\s+new\s+decision|new\s+decision)\s*[.!]?\s*$/i;

/**
 * 2.171 — consent to the fold, offered as the FIRST arm of the post-Stop
 * choice. The words must never be folded into the working brief as if they
 * were decision content, and they are not consent to draft immediately —
 * so they take the bare-ack calibration (one direct yes/no re-offer, after
 * which an ack proceeds). Recognised only while the post-Stop choice is
 * armed (`startOverBrief` present); in any other round these words fold as
 * an ordinary answer, unchanged.
 */
export const CLARIFY_V2_FOLD_IN_PATTERN =
  /^\s*(?:yes[,\s]+)?(?:please\s+)?fold\s+(?:it|this|that)\s+in\s*[,.!]?\s*(?:please|thanks|thank\s+you)?\s*[.!]?\s*$/i;

/**
 * 2.171 — render the original decision as a short quotable topic for the
 * disclosure copy: first sentence, flattened whitespace, word-boundary cut.
 */
export const CLARIFY_V2_TOPIC_MAX_LENGTH = 90;
export function renderDecisionTopic(brief: string): string {
  const flattened = brief.trim().replace(/\s+/g, ' ');
  const firstSentence = /^[^.?!]*[.?!]/.exec(flattened)?.[0] ?? flattened;
  const base = firstSentence.trim();
  if (base.length <= CLARIFY_V2_TOPIC_MAX_LENGTH) return base;
  const cut = base.slice(0, CLARIFY_V2_TOPIC_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Review fix A2 (1.152) — the REPLACEMENT bar. Wholesale brief
 * replacement is the one destructive move in this flow (it discards the
 * working brief, answers and all), so it demands a genuinely STANDALONE
 * draft-shaped restatement, not any ≥30-char message that clears the
 * route's loose regex (whose bare `\?$` arm lets "What do you mean by
 * timeframe?" through). Bar: route-draft-shaped AND no meta-reference to
 * the assistant/questions AND (≥60 chars OR a standalone decision
 * QUESTION — trailing '?' plus a decision word, so "Should we focus on
 * France instead?" replaces while the 33-char "It depends on whether Sam
 * accepts." appends). Precision bias runs TOWARD append: a false
 * negative costs a slightly redundant brief; a false positive destroys
 * the user's answers.
 */
const CLARIFY_V2_REPLACEMENT_MIN_LENGTH = 60;
const CLARIFY_V2_DECISION_WORD_PATTERN =
  /\b(?:should|shall|whether|versus|vs\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure)\b/i;
const CLARIFY_V2_META_REFERENCE_PATTERN =
  /\b(?:you|your|question|questions|answer|answers|mean|clarify|explain)\b/i;

export function isStandaloneBriefRestatement(
  message: string,
  messageIsDraftShaped: boolean,
): boolean {
  if (!messageIsDraftShaped) return false;
  const trimmed = message.trim();
  if (CLARIFY_V2_META_REFERENCE_PATTERN.test(trimmed)) return false;
  if (trimmed.length >= CLARIFY_V2_REPLACEMENT_MIN_LENGTH) return true;
  return /\?\s*$/.test(trimmed) && CLARIFY_V2_DECISION_WORD_PATTERN.test(trimmed);
}

/** Round state persisted on the `clarify_v2_round` pending action. */
export interface ClarifyV2RoundState {
  /** The working brief (original + incorporated answers), ≤ draft max. */
  readonly brief: string;
  /** Dimensions asked so far — the REAL asked-history. */
  readonly asked: readonly ClarifyDimension[];
  /** Rounds asked so far (1-based after the first ask). */
  readonly round: number;
  /**
   * Review fixes A1/A4 (1.152): true once THIS round has spent its single
   * re-offer (bare-ack calibration or not-an-answer guard). After it, a
   * bare ack proceeds (it answers the re-offer's direct yes/no) and a
   * second question-shaped reply declines. Optional: rows persisted
   * before 1.152 parse as not-reoffered.
   */
  readonly reoffered?: boolean;
  /**
   * 2.171: the NEW brief the post-Stop disclosure was issued for, verbatim
   * (trimmed, draft-max capped). Present exactly while the "fold this in, or
   * start over?" choice is live; "start over" re-runs round 1 over THIS.
   * A later ordinary fold rebuilds the state without it (one-round arming).
   */
  readonly startOverBrief?: string;
}

export type ClarifyV2ProceedReason =
  | 'complete'
  | 'all_missing_already_asked'
  | 'round_budget_exhausted'
  | 'user_proceed'
  | 'explicit_generate'
  /**
   * TRACK-1 INTAKE FIX (2026-08-13, INTAKE-FUNNEL §5b): round 1 found
   * EXACTLY ONE missing dimension on an otherwise draftable brief —
   * proceed to the draft NOW and carry the one composed question as a
   * NON-BLOCKING post-draft coaching ask, with the assumption disclosed
   * as assistant-authored. Round-1 only; resume proceeds never mint it.
   */
  | 'single_gap_draft_first';

/** Why a re-offer / decline fired (also the telemetry `cue` field). */
export type ClarifyV2DeflectionCue =
  | 'bare_ack'
  | 'question_reply'
  | 'decline'
  | 'hedged_proceed'
  /**
   * ROADMAP 2.716 (INV-M): the reply is a command to change the MODEL, not an
   * answer to the pending question. Never folded, never silently routed —
   * routing is frequently not even executable here, because the clarify gate
   * only runs when the ingress graph is unpopulated.
   */
  | 'mutation_intent';

export type ClarifyV2Decision =
  | {
      readonly kind: 'proceed';
      /** The brief the draft should run from. */
      readonly brief: string;
      readonly reason: ClarifyV2ProceedReason;
      /**
       * TRACK-1 INTAKE FIX: present EXACTLY when `reason` is
       * `single_gap_draft_first` — the one composed question for the single
       * missing dimension, deferred to ride the draft response as a
       * non-blocking coaching ask (disclosure composed by
       * `composeDraftFirstDisclosure`). Never persisted as a pending: after
       * the draft a graph exists and the clarify flow is strictly pre-draft;
       * the answer routes through the ordinary post-draft turn flow.
       */
      readonly deferredQuestion?: ClarifyQuestion;
    }
  | {
      readonly kind: 'ask';
      readonly questions: readonly ClarifyQuestion[];
      /** The state to persist for the next turn's resume. */
      readonly state: ClarifyV2RoundState;
      readonly phase: 'initial' | 'follow_up';
      /**
       * 2.171: present when this ask must carry the post-explicit-Stop
       * disclosure — the fold happened right after a user Stop, so the copy
       * names the ORIGINAL decision (the pre-fold working brief) and offers
       * the fold-in / start-over choice. Derived from the SAME branch that
       * decided fold-vs-replace (30 Jul live-probe fix): post-Stop the
       * silent replacement is disabled, so every post-Stop resume ask is a
       * fold and carries this by construction.
       */
      readonly postStop?: { readonly originalBrief: string };
      /**
       * 30 Jul live-probe fix — HOW the resume incorporated the message,
       * from the one fold-vs-replace branch. The composer derives its ack
       * from this: the replace arm must never claim a fold (the probe
       * caught "Thanks — I have folded that in" on a replacement, live —
       * the exact confound copy 2.171 exists to kill). Absent on round-1
       * asks (nothing was incorporated).
       */
      readonly incorporation?: 'fold' | 'replace';
    }
  | {
      /**
       * Review fix A1 (1.152): the user declined the round (explicit cue,
       * or a second deflection after the one re-offer). The round is
       * RELEASED — never a forced draft, never a re-ask — and the working
       * brief is kept for a later resume.
       */
      readonly kind: 'decline';
      /** The working brief to preserve (terminal `brief_text` seed, A9). */
      readonly brief: string;
      readonly cue: Exclude<ClarifyV2DeflectionCue, 'bare_ack'>;
    }
  | {
      /**
       * Review fixes A1/A4 (1.152): the reply was neither an answer nor
       * consent (a bare ack, or a question back to us). Re-present the
       * default-forward choice ONCE per round; the state to persist marks
       * the re-offer as spent (brief / asked / round untouched).
       */
      readonly kind: 'reoffer';
      readonly state: ClarifyV2RoundState;
      readonly cue: Exclude<ClarifyV2DeflectionCue, 'decline'>;
    };

/**
 * Append an answer to the working brief, capped at the draft pipeline's
 * Zod max so the eventual `briefOverride` is guaranteed-valid.
 *
 * ANSWER-PRESERVING under the cap (PR #490 review P1): when the working
 * brief is already at/near the max (a long pasted background capped at
 * round 1), a naive tail-slice of the JOINED string would delete the
 * user's answer — the one thing this function exists to keep. The answer
 * is the newest, highest-signal content, so the BRIEF's tail is truncated
 * to make room instead (a mid-word cut in a >5k background's tail loses
 * nothing meaningful — same rationale as
 * `assemble-explicit-generate-brief.ts`'s `capToDraftMax`).
 */
export function incorporateAnswerIntoBrief(brief: string, answer: string): string {
  const trimmed = answer.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return brief;
  const joined = `${brief.trim()} ${trimmed}`;
  if (joined.length <= DRAFT_GRAPH_MAX_BRIEF_LENGTH) return joined;
  const room = DRAFT_GRAPH_MAX_BRIEF_LENGTH - trimmed.length - 1;
  if (room <= 0) return trimmed.slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  return `${brief.trim().slice(0, room)} ${trimmed}`;
}

/**
 * Round 1 can only proceed or ask — decline / re-offer are resume-only
 * (they need a live round to release or re-present). The narrow type
 * keeps the dispatch's round-1 arm exhaustive without dead branches.
 */
export type ClarifyV2Round1Decision = Extract<
  ClarifyV2Decision,
  { kind: 'proceed' | 'ask' }
>;

/**
 * Round 1: assess the brief at draft preflight.
 *
 * `isExplicitGenerate` — this turn arrived with the explicit-generate wire
 * flag (the Generate action / `generate_model`). That is an EXPLICIT user
 * instruction to draft NOW; clarifying over it is a dead-end class (the
 * user pressed Generate and got a question list instead of a graph — the
 * verified worst-first-impression bug, 19 Jul journey probe). So we RESPECT
 * it unconditionally and PROCEED, exactly as the resume path already does
 * (reason `explicit_generate`), regardless of what the rubric would say
 * about brief completeness. The rubric still governs every NON-generate
 * draft-shaped turn, so genuinely thin briefs typed normally are never
 * lobotomised — they still get their clarifying questions.
 *
 * Optional with a `false` default so the many single-arg call sites (unit
 * fixtures, the eval-floor harness) keep the pre-flag rubric path, and so
 * an omitted argument fails toward "not a generate turn" — the same
 * fail-safe direction as `decideClarifyV2Resume`'s `?? null`.
 */
export function decideClarifyV2Round1(
  brief: string,
  isExplicitGenerate = false,
): ClarifyV2Round1Decision {
  // PRODUCER/READER CONTRACT — cap at the WRITE. The round state persists
  // on a `clarify_v2_round` pending whose reader (`parsePendingAction`)
  // REFUSES briefs over DRAFT_GRAPH_MAX_BRIEF_LENGTH fail-closed; an
  // uncapped round-1 brief (a long pasted background is the common case)
  // would ask questions and then be dropped at the next turn's parse —
  // answers silently ignored, escape chip dead: the exact dead-end class
  // this capability exists to kill. Same convention as
  // `incorporateAnswerIntoBrief` and the resume draft-shaped-replacement
  // branch: trim + hard slice at the draft pipeline's Zod max.
  const workingBrief = brief.trim().slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  // RESPECT the explicit generate instruction before touching the rubric —
  // never clarify over a user who has told us to draft.
  if (isExplicitGenerate) {
    return { kind: 'proceed', brief: workingBrief, reason: 'explicit_generate' };
  }
  const assessment = assessBriefCompleteness(workingBrief);
  if (assessment.complete) {
    return { kind: 'proceed', brief: workingBrief, reason: 'complete' };
  }
  // ── TRACK-1 INTAKE FIX (2026-08-13, INTAKE-FUNNEL §5b) ──────────────────
  // EXACTLY ONE missing dimension → draft FIRST and defer the question to a
  // non-blocking post-draft coaching ask. The trigger is a COUNT over the
  // existing detectors — deliberately not a new natural-language predicate
  // (trap 22 does not attach to the routing change). Measured yield at the
  // wire baseline: 7 of the 13 re-asked briefs (S4, S5, M3, M5, L1–L3)
  // draft first-turn, and the defaults-walk evidence (BASELINE.md) says
  // those drafts come out structurally usable. ≥2 missing keeps the
  // blocking ask below unchanged — the thin-brief asks are the rubric
  // doing its job (INTAKE-FUNNEL: S1–S4 asks are defensible coaching).
  if (assessment.missing.length === 1) {
    const [deferredQuestion] = composeClarifyQuestions(assessment.missing, 1);
    if (deferredQuestion !== undefined) {
      return {
        kind: 'proceed',
        brief: workingBrief,
        reason: 'single_gap_draft_first',
        deferredQuestion,
      };
    }
  }
  const questions = composeClarifyQuestions(
    assessment.missing,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  return {
    kind: 'ask',
    questions,
    state: {
      brief: workingBrief,
      asked: questions.map((q) => q.dimension),
      round: 1,
    },
    phase: 'initial',
  };
}

export interface DecideClarifyV2ResumeInput {
  readonly state: ClarifyV2RoundState;
  /** The user's reply, verbatim off the wire. */
  readonly message: string;
  /**
   * True when the reply is itself a full draft-shaped brief (length +
   * decision-regex, per the route's own heuristic). Necessary but NOT
   * sufficient for replacement — see `isStandaloneBriefRestatement`
   * (review fix A2, 1.152).
   */
  readonly messageIsDraftShaped: boolean;
  /**
   * Review fix A3 (1.152): the server-ASSEMBLED brief when the reply
   * arrived with the explicit-generate wire flag (route C2 assembly);
   * null otherwise. The strongest possible ready-to-draft signal — always
   * proceeds, and the assembled brief is INCORPORATED into the working
   * brief (it may carry content the round never saw, e.g. a draft-shaped
   * message typed alongside the Generate click) rather than discarded.
   */
  readonly explicitGenerateBrief: string | null;
  /**
   * 2.171: true when the scenario is in the post-explicit-Stop state (the
   * newest PRIOR fence row carries a Stop tombstone — read server-side by the
   * dispatch). Optional with a false default: an omitted argument fails
   * toward the ordinary copy, the same fail-safe direction as
   * `explicitGenerateBrief`'s `?? null`.
   */
  readonly postExplicitStop?: boolean;
}

/**
 * Review fix A3 (1.152) — merge the C2-assembled explicit-generate brief
 * into the working brief. Containment first (the assembled brief is
 * usually the persisted seed or the original message, both already inside
 * the working brief — appending would duplicate), superset restatement
 * wins outright, genuinely new content appends via the same
 * answer-preserving cap convention as `incorporateAnswerIntoBrief`.
 */
export function mergeExplicitGenerateBrief(
  workingBrief: string,
  assembled: string,
): string {
  const w = workingBrief.trim();
  const a = assembled.trim();
  if (a.length === 0) return w;
  if (w.includes(a)) return w;
  if (a.includes(w)) return a.slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  return incorporateAnswerIntoBrief(w, a);
}

/** Resume: the user replied while a clarify round was live. */
export function decideClarifyV2Resume(
  input: DecideClarifyV2ResumeInput,
): ClarifyV2Decision {
  const { state, message } = input;

  // `?? null` is deliberate: if a JS caller ever omits the field,
  // `undefined !== null` would silently turn EVERY resume reply into an
  // explicit-generate proceed — fail toward "not a generate turn" instead.
  const assembledGenerateBrief = input.explicitGenerateBrief ?? null;
  if (assembledGenerateBrief !== null) {
    // The wire message on an explicit generate is often canned chip text;
    // draft from the working brief MERGED with the assembled brief (A3),
    // never from the message.
    return {
      kind: 'proceed',
      brief: mergeExplicitGenerateBrief(state.brief, assembledGenerateBrief),
      reason: 'explicit_generate',
    };
  }
  // ── 2.171: the post-Stop choice, while armed ─────────────────────────────
  // "Start over" routes to the EXISTING new-draft path: round 1 over the new
  // brief the disclosure was issued for. The old frame (and its asked
  // history) is discarded WITH the user's explicit consent — that is the
  // point of the choice. Checked before every other cue so the decline set
  // ("stop", "cancel") can never claim it.
  if (state.startOverBrief !== undefined && CLARIFY_V2_START_OVER_PATTERN.test(message)) {
    return decideClarifyV2Round1(state.startOverBrief);
  }
  // "Fold this in" consents to the fold (already incorporated) without
  // consenting to draft — bare-ack calibration, and the literal words must
  // never pollute the working brief. `{...state}` preserves the armed
  // choice, so "start over" still works after an intervening "fold it in".
  if (state.startOverBrief !== undefined && CLARIFY_V2_FOLD_IN_PATTERN.test(message)) {
    if (state.reoffered === true) {
      return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
    }
    return { kind: 'reoffer', state: { ...state, reoffered: true }, cue: 'bare_ack' };
  }
  // Review fix A10: the exact-constant check was dead code — the pattern's
  // 'go ahead…' alternation matches CLARIFY_V2_PROCEED_MESSAGE exactly
  // (pinned in clarify-v2.preflight.test.ts so a pattern edit that breaks
  // the constant's coverage goes RED, not silently dead again).
  if (CLARIFY_V2_PROCEED_PATTERN.test(message)) {
    return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
  }
  // Review fix A4 (1.152): a weak ack is consent only AFTER the re-offer
  // turned the choice into a direct yes/no; before that it gets the
  // one-per-round re-offer.
  if (CLARIFY_V2_BARE_ACK_PATTERN.test(message)) {
    if (state.reoffered === true) {
      return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
    }
    return { kind: 'reoffer', state: { ...state, reoffered: true }, cue: 'bare_ack' };
  }
  // 1.152(i) (P3, pinned): a hedged proceed ("not sure — maybe just draft
  // it?") is proceed-intent without clear consent — same one-per-round
  // re-offer calibration as the bare ack; after the re-offer's direct
  // yes/no, the hedge IS consent. Checked BEFORE decline so the decline
  // set can never claim a leaning-forward reply.
  if (CLARIFY_V2_HEDGED_PROCEED_PATTERN.test(message)) {
    if (state.reoffered === true) {
      return { kind: 'proceed', brief: state.brief, reason: 'user_proceed' };
    }
    return {
      kind: 'reoffer',
      state: { ...state, reoffered: true },
      cue: 'hedged_proceed',
    };
  }
  // Review fix A1 (1.152): an explicit decline releases the round.
  if (CLARIFY_V2_DECLINE_PATTERN.test(message)) {
    return { kind: 'decline', brief: state.brief, cue: 'decline' };
  }

  // Review fix A2 (1.152): replacement only for a genuinely standalone
  // restatement; the bar is checked BEFORE the not-an-answer guard so a
  // standalone decision QUESTION ("Should we focus on France instead?")
  // replaces rather than deflects. (Keyed on the RESTATEMENT verdict, not on
  // `replaces`: post-Stop the restatement folds instead of replacing — see
  // below — but it is still never a question TO us.)
  const standaloneRestatement = isStandaloneBriefRestatement(
    message,
    input.messageIsDraftShaped,
  );
  if (!standaloneRestatement && CLARIFY_V2_QUESTION_REPLY_PATTERN.test(message)) {
    // Review fix A1 (1.152), not-an-answer guard: a question back to us is
    // never folded into the brief. One re-offer per round, then decline.
    if (state.reoffered === true) {
      return { kind: 'decline', brief: state.brief, cue: 'question_reply' };
    }
    return {
      kind: 'reoffer',
      state: { ...state, reoffered: true },
      cue: 'question_reply',
    };
  }

  // ── ROADMAP 2.716 (INV-M) — a mutation command is never an ANSWER ────────
  // The defect this closes is an ABSENT BRANCH, not a wrong predicate: eight
  // anchored guards decline the message and the ninth position is the raw
  // concatenation below, so "Change the price to 90,000" became part of the
  // working brief verbatim and the WHOLE MODEL was redrafted from the run-on
  // string (measured 8/8 at 8c316b5e). The edit lane never gets a say — this
  // seam claims the turn ~800 lines before `editIntentDetected` is computed.
  //
  // ASK, do not route. The clarify gate is entered only when the ingress graph
  // is UNPOPULATED, so there is frequently nothing to route an edit to; asking
  // is the only move correct in both the phantom-model and the genuinely-empty
  // state, and 2.171 ratified this disclose-and-offer shape next door.
  //
  // Placed AFTER the standalone-restatement bar, deliberately and by the same
  // `!standaloneRestatement` term the question guard uses: a genuine new brief
  // that happens to carry an edit verb ("…or add a second warehouse in
  // Poland?") must still REPLACE. Calibration is the ladder's existing one:
  // one re-offer per round, then decline.
  if (!standaloneRestatement && isGraphMutationCommand(message)) {
    if (state.reoffered === true) {
      return { kind: 'decline', brief: state.brief, cue: 'mutation_intent' };
    }
    return {
      kind: 'reoffer',
      state: { ...state, reoffered: true },
      cue: 'mutation_intent',
    };
  }

  // ── 2.171 live-probe fix (30 Jul) — ONE branch, and everything derives ──
  // from it. The acceptance probe (liveproof-post-stop-disclosure.md, Arm
  // 2/3) proved the old shape deterministic-wrong at the copy: post-Stop, a
  // new brief that cleared the A2 bar was SILENTLY REPLACED while the
  // composer claimed a fold ("Thanks — I have folded that in") and the
  // disclosure was suppressed — the exact tester confound 2.171 exists to
  // kill, reproduced by the fix's own replace arm. And which arm a new
  // brief landed on was textual noise: "Completely different question: …"
  // folded (the word "question" trips the meta-reference guard) while
  // "Different topic: …" replaced.
  //
  // Post-Stop, the destructive silent replacement is therefore DISABLED:
  // the restatement FOLDS, discloses, and arms the choice — "start over"
  // IS the consented replacement. Replacement survives post-Stop in exactly
  // one shape (below): nothing left to ask, where the immediate draft of
  // the NEW brief is itself the visible proof the stop took. The disclosure
  // and the ask copy both derive from this ONE `replaces` value — a second
  // authority that could disagree with the branch is the defect class the
  // probe caught.
  const postStopArmed = input.postExplicitStop === true;
  const replaces = standaloneRestatement && !postStopArmed;
  const newBrief = message.trim().slice(0, DRAFT_GRAPH_MAX_BRIEF_LENGTH);

  const workingBrief = replaces
    ? newBrief
    : incorporateAnswerIntoBrief(state.brief, message);

  const assessment = assessBriefCompleteness(workingBrief);
  // NO-REPEAT: a dimension is asked at most once per scenario.
  const askable = assessment.complete
    ? []
    : assessment.missing.filter((d) => !state.asked.includes(d));
  // STOP RULE: bounded rounds, then draft with what we have.
  const canAsk = askable.length > 0 && state.round < CLARIFY_V2_MAX_ROUNDS;

  if (!canAsk) {
    // 2.171 (30 Jul): a post-Stop standalone restatement whose fold has
    // nothing left to ask gets the REPLACEMENT it asked for — the NEW brief
    // alone, never a merged-topic draft. The disclosure has no ask to ride
    // on, and the streaming new-topic draft says the stop took better than
    // any copy could.
    const brief = standaloneRestatement && postStopArmed ? newBrief : workingBrief;
    return {
      kind: 'proceed',
      brief,
      reason: assessment.complete
        ? 'complete'
        : askable.length === 0
          ? 'all_missing_already_asked'
          : 'round_budget_exhausted',
    };
  }

  const questions = composeClarifyQuestions(
    askable,
    CLARIFY_V2_MAX_QUESTIONS_PER_ROUND,
  );
  // 2.171: a post-Stop FOLD must disclose and arm the choice. With the
  // silent replacement disabled above, `!replaces` holds for EVERY post-Stop
  // ask — the disclosure is emitted by construction whenever the fold
  // happens, from the same branch that decided the fold. The armed brief is
  // the user's message verbatim under the draft cap: what "start over"
  // would draft from.
  const disclosePostStop = postStopArmed && !replaces && newBrief.length > 0;
  return {
    kind: 'ask',
    questions,
    state: {
      brief: workingBrief,
      asked: [...state.asked, ...questions.map((q) => q.dimension)],
      round: state.round + 1,
      ...(disclosePostStop ? { startOverBrief: newBrief } : {}),
    },
    phase: 'follow_up',
    // The composer derives its ack from the SAME branch — the replace arm
    // must never claim a fold (the probe's confound copy, live).
    incorporation: replaces ? 'replace' : 'fold',
    ...(disclosePostStop ? { postStop: { originalBrief: state.brief } } : {}),
  };
}

/**
 * TRACK-1 INTAKE FIX — the draft-first disclosure (INTAKE-FUNNEL §5b,
 * honesty constraint i). Composed at DECISION time (pure), appended by
 * route-v2 to the draft response's `assistant_text` AFTER a successful
 * draft commit, and only when a graph actually landed on the canvas.
 *
 * PROVENANCE IS THE LOAD-BEARING COPY: the drafted value for the missing
 * dimension is the ASSISTANT's assumption and must never read as
 * user-stated (the records grammar separates `stated_items` from model
 * claims for exactly this reason; this sentence is the chat-surface
 * counterpart). The per-dimension gap phrases are deterministic templates —
 * no graph text is embedded, so the disclosure cannot leak node ids and
 * needs no label resolution.
 *
 * Surface choice (recorded): `assistant_text` only, NO chips. The draft
 * response carries its own post-draft chip row and the UI renders a
 * bounded row — appending cv2 candidate chips here would silently evict
 * whichever chips land last (the exact defect CLARIFY_V2_MAX_CHIPS was
 * built to kill). The question is answerable by typing (normal post-draft
 * turn flow) or directly on the canvas.
 */
/**
 * ⭐⭐ THE COPY MAKES NO CLAIM ABOUT THE USER'S BRIEF (#928 round 4).
 *
 * **THE GOVERNING RULE: the product may describe what IT did; it may not tell
 * the user what THEY said.** One of those we can always verify; the other we
 * cannot. It generalises well beyond this module.
 *
 * ⚠ WHAT WAS HERE UNTIL ROUND 4, and why it had to go. The copy read *"your
 * brief didn't state the goal…"*. The round-3 reviewer measured that sentence
 * shipping ON THE WIRE against a brief reading *"Our goal is not just cost but
 * speed."* — the product telling a user their brief omitted something their
 * brief plainly contained.
 *
 * DRAFT-FIRST IS WHAT MADE IT SERIOUS, and this is the finding of the round.
 * The rubric's tolerance for over-detection was licensed by one sentence in
 * its own invariant: *"a false MISSING costs one question with a one-tap
 * escape."* Draft-first REMOVES the question and the escape. So the cost model
 * that licensed the tolerance is void, and the tolerance with it — a false
 * MISSING now costs a false assertion about the user's own words, with no way
 * to answer back.
 *
 * ⭐ THE EXIT IS NOT A BETTER DETECTOR. Four rounds of widening the denial
 * predicate each closed one direction and opened the other (trap 22f: when
 * rounds oscillate, the answer is to stop guessing). Because the sentence
 * above claims only what THIS SERVICE DID, it is true when the dimension is
 * genuinely missing AND when the detector over-detected — so over-detection
 * stops being a TRUTH defect and becomes only a QUALITY-OF-ASSUMPTION defect.
 * **The predicate now only has to be good enough, not correct**, which is what
 * ends the oscillation rather than surviving one more round of it.
 *
 * ⚠ RESIDUAL, recorded rather than hidden: on the over-detection branch the
 * DRAFTER still receives the whole brief, so the value in the graph may well
 * have come from the user's own words rather than from us. "I've assumed" then
 * UNDERSTATES our fidelity. That is a quality-of-assumption error in the safe
 * direction — it under-claims about ourselves instead of over-claiming about
 * the user — and it is the trade this round deliberately buys.
 *
 * Same doctrine as ROADMAP 2.972(c) with the instrument changed: there, a
 * "your brief was light on detail" advisory was SUPPRESSED when it could not
 * be established. Here the disclosure must still say something (disclosure is
 * its whole job), so the claim is REPHRASED onto the only subject we can
 * verify — ourselves — rather than withheld.
 *
 * The per-dimension phrases stay deterministic templates with no graph text
 * embedded, so the disclosure cannot leak node ids and needs no label
 * resolution. Pinned in BOTH branches by
 * `tests/unit/clarify-v2.draft-first.test.ts`.
 */
const DRAFT_FIRST_GAP_COPY: Readonly<Record<ClarifyDimension, string>> = {
  goal: "I've assumed the goal in this draft, and I haven't confirmed it with you",
  options:
    "I've assumed the alternatives in this draft, and I haven't confirmed them with you",
  timeframe:
    "I've assumed the horizon in this draft, and I haven't confirmed it with you",
  quantities:
    "I've assumed the figures in this draft, and I haven't confirmed them with you",
};

export function composeDraftFirstDisclosure(question: ClarifyQuestion): string {
  return (
    `One thing to check: ${DRAFT_FIRST_GAP_COPY[question.dimension]}. ` +
    `${question.text} You can answer here, or change it directly on the canvas.`
  );
}

/**
 * Compose the wire response for an ask decision.
 *
 * Copy contract:
 *   - British English, product voice, no graph-shape language.
 *   - Each question is numbered and carries its one-clause impact.
 *   - The escape hatch is ALWAYS named in prose ("answer whichever
 *     matters most… or say 'go ahead'") — the stop rule is user-visible.
 *   - Chips: every question's candidates (labels prefixed by topic so
 *     multi-question chip rows stay legible) + the single default-forward
 *     chip. All conversational (no `action_type`): a tap re-submits as a
 *     fresh user turn, which the live pending action claims — answers
 *     incorporate via the NORMAL turn flow.
 *
 * The response ships through `sendFinalised200` → `sanitiseOlumiResponse
 * ForEgress`, so the universal looping-chip guard (#464) covers these
 * chips BY CONSTRUCTION — pinned by clarify-v2 egress tests, not
 * re-implemented here.
 */
export function composeClarifyV2Response(
  questions: readonly ClarifyQuestion[],
  phase: 'initial' | 'follow_up',
  postStop?: { readonly originalBrief: string },
  incorporation?: 'fold' | 'replace',
): OlumiResponse {
  const singular = questions.length === 1;
  // 2.171: in the post-explicit-Stop state the plain fold ack is the exact
  // copy the acceptance probe caught reading as "my stop didn't take" — the
  // lead instead disclosures the ORIGINAL decision and offers the choice
  // (ratified wording). Ordinary rounds keep the pre-2.171 leads verbatim,
  // EXCEPT the replace arm (30 Jul live-probe fix): claiming a fold on a
  // replacement is a false statement — the ack derives from the branch.
  const followUpAck =
    incorporation === 'replace'
      ? singular
        ? "Thanks — I've switched to your new decision. One more thing would sharpen the draft."
        : "Thanks — I've switched to your new decision. A couple more things would sharpen the draft."
      : singular
        ? 'Thanks — I have folded that in. One more thing would sharpen the draft.'
        : 'Thanks — I have folded that in. A couple more things would sharpen the draft.';
  const lead =
    postStop !== undefined
      ? `Still working on your original decision — “${renderDecisionTopic(postStop.originalBrief)}”. ` +
        'Want me to fold this in, or start over?'
      : phase === 'initial'
        ? singular
          ? 'Before I draft the model, one quick question will make it sharper.'
          : 'Before I draft the model, a few quick questions will make it sharper.'
        : followUpAck;
  // ⚠ 2026-08-16 (P1) — THIS WAS `.join(' ')` AND IT PRODUCED A WALL OF TEXT.
  //
  // The first thing a new user ever reads from Olumi is this response, and it
  // shipped as ONE unbroken paragraph with "1." "2." "3." buried inside it.
  // Paul's manual test: the questions were all there and none of them were
  // legible. Not one word of copy changes here — only the shape.
  //
  // Newlines survive to the wire: `sanitiseOlumiResponseForEgress` (the single
  // V5 chokepoint this response ships through) does not touch them, and
  // `orchestrator-v5/sanitise.ts` — which is on other paths — collapses only
  // `[ \t]+`. Pinned by `__tests__/clarify-question-shape.spec.ts`, which
  // drives the real chokepoint rather than asserting it from this comment.
  const numbered = questions
    .map((q, i) => `${i + 1}. ${q.text} (${q.impact})`)
    .join('\n');
  // TRACK-1 INTAKE FIX: honest escape-hatch copy — there are no stored
  // defaults (INTAKE-FUNNEL §3); on "go ahead" the drafter fills the gaps
  // with its own assumptions, all editable on the canvas.
  const tail =
    'Answer whichever matters most — tap an option below or type your own — ' +
    "or say “go ahead” and I'll draft now, filling any gaps with my own assumptions.";
  const assistantText = `${lead}\n\n${numbered}\n\n${tail}`;

  const proceedChip: SuggestedAction = {
    id: CLARIFY_V2_PROCEED_CHIP_ID,
    label: 'Draft it anyway',
    message: CLARIFY_V2_PROCEED_MESSAGE,
  };
  // 2.171: the choice is tappable. The start-over chip takes one candidate
  // slot (never the escape hatch's), and its canned message is inside
  // CLARIFY_V2_START_OVER_PATTERN so a tap routes exactly like the typed
  // phrase (pinned).
  const startOverChip: SuggestedAction = {
    id: CLARIFY_V2_START_OVER_CHIP_ID,
    label: 'Start over',
    message: CLARIFY_V2_START_OVER_MESSAGE,
  };

  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: assertClarifyChipContract([
      // FIRST, deliberately — see CLARIFY_V2_MAX_CHIPS. Any consumer cap
      // of one or more preserves it, so the escape hatch stops depending
      // on the consumer's cap being exactly the number we assumed.
      proceedChip,
      ...(postStop !== undefined ? [startOverChip] : []),
      ...selectCandidateChips(
        questions,
        postStop !== undefined
          ? CLARIFY_V2_CANDIDATE_CHIP_BUDGET - 1
          : CLARIFY_V2_CANDIDATE_CHIP_BUDGET,
      ),
    ]),
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}

/**
 * Choose which candidate answers get the scarce chip slots.
 *
 * ROUND-ROBIN across questions, not first-question-first: under a budget
 * of two, taking both slots from question 1 leaves questions 2 and 3 with
 * no tap-able answer at all, while round-robin gives each asked question
 * a representative. The prose still names every question and its impact,
 * and typing a free-form answer always works — the chips are a shortcut,
 * never the whole answer space.
 *
 * Deterministic: same questions in, same chips out (the resume path and
 * the supersession-by-chip_id logic both depend on stable ids).
 */
function selectCandidateChips(
  questions: readonly ClarifyQuestion[],
  budget: number,
): SuggestedAction[] {
  const chips: SuggestedAction[] = [];
  if (budget <= 0) return chips;
  const deepest = questions.reduce((n, q) => Math.max(n, q.candidates.length), 0);
  for (let rank = 0; rank < deepest && chips.length < budget; rank += 1) {
    for (const q of questions) {
      if (chips.length >= budget) break;
      const c = q.candidates[rank];
      if (c === undefined) continue;
      chips.push({ id: c.id, label: c.label, message: c.message });
    }
  }
  return chips;
}

/**
 * FAIL LOUD on drift. The cap and the escape hatch's survival are the two
 * properties the UI's 3-chip render silently destroys when a producer
 * gets them wrong — silently, because an over-long row still looks fine
 * on the wire. A throw here turns a future regression into a test
 * failure at the composition site instead of a missing button in a dress
 * rehearsal three weeks later.
 */
function assertClarifyChipContract(chips: readonly SuggestedAction[]): SuggestedAction[] {
  if (chips.length > CLARIFY_V2_MAX_CHIPS) {
    throw new Error(
      `clarify_v2 emitted ${chips.length} chips; the ratified cap (D-K) is ${CLARIFY_V2_MAX_CHIPS}. ` +
        'Chips beyond the cap are dropped by the UI, silently.',
    );
  }
  if (!chips.some((c) => c.id === CLARIFY_V2_PROCEED_CHIP_ID)) {
    throw new Error(
      'clarify_v2 composed a response without the default-forward escape hatch ' +
        `('${CLARIFY_V2_PROCEED_CHIP_ID}') — every clarify response must offer a one-tap exit.`,
    );
  }
  return [...chips];
}

/**
 * Review fix A1 (1.152) — the honest decline reply. The round is released
 * (the dispatch retires the pending via `consumedPendingRefs`), the
 * working brief is preserved server-side (terminal `brief_text` seed,
 * A9), and the copy names the way back in. Deliberately NO chips: the
 * released round means a proceed chip here would replay through round-1
 * preflight where its canned message is not draft-shaped — a dead chip is
 * dishonest, so the escape hatch is named in prose instead.
 */
export const CLARIFY_V2_DECLINE_MESSAGE =
  "Okay — I'll hold off. Say 'draft it' whenever you're ready.";

export function composeClarifyV2DeclineResponse(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: CLARIFY_V2_DECLINE_MESSAGE,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}

/**
 * Review fixes A1/A4 (1.152) — the one-per-round re-offer. Keeps the
 * round alive (the dispatch re-persists the pending with `reoffered`
 * spent; same chip_id → supersession, no zombie twin) and re-presents the
 * default-forward choice. Copy is cue-specific: a bare ack — and a hedged
 * proceed ("not sure — maybe just draft it?", 1.152(i) P3) — gets a direct
 * yes/no ("shall I draft with sensible defaults?") so the NEXT ack is
 * unambiguous consent; a question back to us gets the honest meta-answer
 * (the questions are optional) — this path is deterministic and must not
 * pretend to answer an arbitrary question.
 */
export function composeClarifyV2ReofferResponse(
  cue: Exclude<ClarifyV2DeflectionCue, 'decline'>,
): OlumiResponse {
  const assistantText =
    cue === 'question_reply'
      ? "Happy to clarify — the questions are optional and each one just sharpens the draft. Answer whichever you like above, or say 'go ahead' and I'll draft now, filling any gaps with my own assumptions."
      : cue === 'mutation_intent'
        // ROADMAP 2.716 (INV-M). DISCLOSE, then offer both ways forward. The
        // message is NOT folded, so the copy must tell the user what became of
        // it — a silent drop is the same class of lie as the silent fold. No
        // "change the model" chip: there is no model on this state, and a chip
        // whose consent cannot resume is guarantee-theatre (the same rule that
        // keeps a proceed chip off the decline response).
        ? "That reads like a change to the model, but I have not built the model yet — I am still asking about the decision itself, so I have left your message out of the brief rather than guess. Answer any of the questions above, or say 'go ahead' and I'll draft the model, filling any gaps with my own assumptions; once it is on the canvas you can change any value on it."
        : 'Just to check — shall I draft the model now, filling any gaps with my own assumptions, or would you like to answer any of the questions above first?';
  const proceedChip: SuggestedAction = {
    id: CLARIFY_V2_PROCEED_CHIP_ID,
    label: 'Draft it anyway',
    message: CLARIFY_V2_PROCEED_MESSAGE,
  };
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: assertClarifyChipContract([proceedChip]),
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}
