/**
 * V5 — deterministic state-query guard for the named "what just changed?"
 * follow-ups.
 *
 * Layered with the `recent_changes` ContextPack projection: that fix
 * (information starvation) lets Sonnet answer state-queries correctly in
 * the general case; this guard is the deterministic floor for the exact
 * named misroute class so it can never recur even if the LLM regresses.
 *
 * Behaviour:
 *   1. Match the user message against a tight allowlist of state-query
 *      phrases — "what changed?", "what update did you make?",
 *      "I can't see it", "did you change it?", "what just changed?", etc.
 *   2. If matched AND `recent_changes` is non-empty, return a
 *      `direct_answer` dispatch with deterministic copy that quotes the
 *      most recent change's summary verbatim (so the answer is grounded
 *      in the persisted handler fact, not a fabricated summary),
 *      ATTRIBUTED TO SAVED MODEL HISTORY ("From the saved model history: …") so that a
 *      past receipt can never read as a claim about the current turn.
 *   3. If matched AND `recent_changes` is empty, return a "no recent
 *      changes" dispatch that owns the state-query without falling to
 *      `edit_graph`. The user gets honest copy — "I haven't applied
 *      anything in this session." — instead of the legacy denial.
 *   4. If not matched, return `{ matched: false }` and the lifecycle
 *      proceeds to the LLM.
 *
 * The guard never touches handlers, never mutates state, never calls an
 * LLM. It only synthesises the assistant text + chips so the
 * TurnExecutor's existing direct-answer compose path can take it from
 * there.
 *
 * British English, no internal terms ("model" not "graph"). The copy
 * is intentionally short and unambiguous so a follow-up after this
 * dispatch ("OK, run the analysis") routes cleanly.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  isBriefAuditQuestion,
  tryBriefAuditAnswer,
} from '../../cee/context-integrity/brief-audit-answer.js';
import {
  findRecentChangeAboutOriginSubject,
  isStructureOriginQuestion,
  tryStructureOriginAnswer,
} from '../../cee/context-integrity/structure-origin-answer.js';
import type { ContextPack } from '../context/context-pack-assembler.js';
import type { RecentMutation } from '../context/recent-changes.js';
import type { RecentChangesHistoryStatus } from '../context/reconcile-recent-mutation-facts.js';
import type { SuggestedAction } from '../compose/types.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';
import type { HandlerValidationRegistry } from './validator.js';

export type StateQueryGuardOutcome =
  | { readonly matched: false }
  | {
      readonly matched: true;
      readonly dispatch: 'with_recent_change';
      readonly assistant_text: string;
      readonly recent_change: RecentMutation;
      readonly recent_change_count: number;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'no_recent_changes';
      readonly assistant_text: string;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'changes_unavailable';
      readonly assistant_text: string;
    }
  /**
   * ROADMAP 2.975 — the user asked what became of THEIR BRIEF, not what
   * changed in this session. Answered from the derived not-modelled manifest;
   * see `cee/context-integrity/brief-audit-answer.ts` for why the two questions
   * must not share an answer.
   */
  | {
      readonly matched: true;
      readonly dispatch: 'brief_audit';
      readonly assistant_text: string;
    }
  /**
   * ⭐⭐ THE USER CHALLENGED A STRUCTURAL ELEMENT — *"why did you add a hybrid
   * option?"* — which is a question about ORIGIN, not about OCCURRENCE.
   *
   * Witnessed live on `585f8dce` being answered by `no_recent_changes` with
   * `llm_calls: 0`: the message matched `did you …add` and the guard returned an
   * edit-history deflection to a provenance challenge. Answered here from the
   * element's own persisted provenance record; see
   * `cee/context-integrity/structure-origin-answer.ts` for why the two questions
   * must not share an answer.
   */
  | {
      readonly matched: true;
      readonly dispatch: 'structure_origin';
      readonly assistant_text: string;
    };

/**
 * Allowlist phrase pattern. Each alternative is anchored loosely to
 * tolerate punctuation and trailing whitespace, but not so loosely that
 * sentences containing these phrases incidentally match. Matching is
 * case-insensitive.
 *
 * Phrases covered — strict subset of the user-brief named follow-up
 * class. Each alternative MUST contain a CHANGE-WORD or VISIBILITY-WORD
 * so that generic session questions ("What did you do?",
 * "show me what you did") do NOT trigger the deterministic floor —
 * those go to the LLM with the `recent_changes` ContextPack projection
 * still grounding the answer.
 *
 * The named-follow-up class (per user brief):
 *   - "what changed?" / "what's changed" / "what has changed" /
 *     "what just changed?"
 *   - "what update did you make?" / "what change did you make?"
 *   - "what did you change/update/add" — change-word anchored
 *   - "did you change/update/apply/add" — change-word anchored
 *   - "I can't see it" / "I can't see this constraint"
 *   - "where is it?" / "where did it go?"
 *   - "show me what you added/changed/updated" — change-word anchored
 *
 * Pattern grammar: each alternative is independent. The "did you" /
 * "what did you" / "show me what you" prefixes REQUIRE a follow-on
 * change-word (`change`, `update`, `add`, `apply`, `added`,
 * `changed`, `updated`). Generic verbs (`do`, `did`) are deliberately
 * NOT in the alternation — keep the gate narrow.
 */
// Shared by both guard admission and consequence classification. Keeping one
// pattern prevents a natural wrapper around the question from being admitted
// as an effect query while later being treated as an ordinary receipt readback.
const EDIT_EFFECT_QUERY_PATTERN =
  /\bwhat\s+did\s+(?:that|the|this|your)\s+(?:update|change|edit|adjustment)\s+do\b/i;

const STATE_QUERY_PATTERNS: readonly RegExp[] = [
  // "what changed", "what's changed", "what has changed", "what just changed"
  /\bwhat(?:'s|\s+(?:has|just))?\s+changed\b/i,
  // "what was updated", "what were changed", "what got applied" — passive
  // readback of a prior mutation. Change-word anchored.
  /\bwhat\s+(?:was|were|got)\s+(?:changed|updated|added|applied)\b/i,
  // "what update did you make", "what updates did you make",
  // "what change did you make", "what changes did you make"
  /\bwhat\s+(?:update|change)s?\s+did\s+you\s+make\b/i,
  // "what did you change/update/add" and "what did you JUST change/update/add"
  // — change-word required. Generic "what did you do" deliberately excluded so
  // generic session questions ("What did you do?") fall through to the LLM.
  /\bwhat\s+did\s+you\s+(?:just\s+)?(?:change|update|add)\b/i,
  // "what did that update do", "what did the change do", "what did that
  // edit do" — asks the effect of a just-applied mutation. The trailing
  // "do" disambiguates from a fresh imperative.
  EDIT_EFFECT_QUERY_PATTERN,
  // "did you change/update/apply/add" — change-word required.
  /\bdid\s+you\s+(?:change|update|apply|add)\b/i,
  // "I can't see it", "I cannot see this", "I can't see this constraint",
  // "I can't see the £50k constraint" (\S+ tolerates currency / unit
  // glyphs after "the").
  /\bi\s+(?:can(?:'t|not)|cant)\s+see\s+(?:it|this|the\s+\S+)\b/i,
  // "where is it", "where's it", "where did it go", "where's the £50k cap"
  /\bwhere(?:'s|\s+is|\s+did)\s+(?:it|this|that|the\s+\S+)\b/i,
  // "show me what you added/changed/updated" — change-word required.
  // Generic "show me what you did" deliberately excluded.
  /\bshow\s+me\s+what\s+you\s+(?:added|changed|updated)\b/i,
];

/**
 * Post-mutation complaint / visibility patterns (V5 WS1 / G6 proof 4).
 *
 * Distinct from the named-follow-up `STATE_QUERY_PATTERNS` allowlist above:
 * these phrases only make sense AFTER a successful mutation, so the guard
 * fires them only when `recent_changes` is non-empty. With no recent
 * mutation they fall through to the LLM (which can ask for context).
 *
 * Worked example backing this set: scenario
 * `425c8c71-ff9d-485d-ac59-cbaa811fe09d` (manual test 2026-05-07) showed a
 * successful `set_factor_value` followed by *"I'm not seeing that update on
 * the factor"* routing to V4 `edit_graph` and failing with
 * `STRUCTURAL_VALIDATION_FAILED`. This pattern set is the deterministic
 * floor that prevents that misroute. See Docs/v5/v5-cordon.md and
 * DL-2026-05-07-15.
 *
 * Negative-control behaviour required by the brief:
 *   - "add a constraint about cost being below 50000" must NOT match here.
 *   - The patterns are intentionally narrow on the structural shape of a
 *     post-mutation complaint, not on edit verbs alone.
 */
const POST_MUTATION_COMPLAINT_PATTERNS: readonly RegExp[] = [
  // "I'm not seeing that update", "I am not seeing the change",
  // "I'm not seeing that update on the factor". Multi-word labels
  // ("the customer churn") work without explicit support because the
  // pattern has no terminator after `\S+` — extra label words trail.
  /\bi(?:'m|\s+am)\s+not\s+seeing\s+(?:the|that|my|this)\s+\S+/i,
  // "did that apply", "did it apply", "did my change apply",
  // "did the update apply". Multi-word labels ("did the total cost
  // apply?") supported via `(?:\s+\S+){0,2}` after the leading noun.
  /\bdid\s+(?:that|it|my\s+\S+(?:\s+\S+){0,2}|the\s+\S+(?:\s+\S+){0,2})\s+apply\b/i,
  // "the value didn't change", "the customer churn didn't apply",
  // "the constraint did not apply"
  /\bthe\s+\S+(?:\s+\S+){0,2}\s+(?:didn'?t|did\s+not)\s+(?:change|update|apply|reflect)\b/i,
  // "is that reflected", "is the change reflected", "is the total cost
  // reflected". Allows up to three label words between determiner and
  // `reflected`.
  /\bis\s+(?:that|the|this|my|it)\s+(?:\S+\s+){0,3}reflected\b/i,
  // "why can't I see the change", "why cannot I see the customer
  // churn". Multi-word labels work because the pattern has no
  // terminator after `\S+`.
  /\bwhy\s+can(?:'t|not)\s+i\s+see\s+(?:the|my|this|that)\s+\S+/i,
  // "the change isn't showing", "the customer churn isn't showing"
  /\bthe\s+\S+(?:\s+\S+){0,2}\s+(?:isn'?t|is\s+not|aren'?t|are\s+not)\s+show(?:ing|n)\b/i,
  // "is the update applied", "is the customer churn applied yet"
  /\bis\s+(?:the|that|my|this)\s+\S+(?:\s+\S+){0,2}\s+applied(?:\s+yet)?\b/i,
  // "that didn't work", "that did not seem to work"
  /\bthat\s+(?:didn'?t|did\s+not)\s+(?:seem\s+to\s+)?work\b/i,
];

/**
 * Compound-edit bail-out gate, applied UNIVERSALLY before any guard
 * match (legacy {@link STATE_QUERY_PATTERNS} OR new
 * {@link POST_MUTATION_COMPLAINT_PATTERNS}).
 *
 * Rationale (P1 review fix, second pass): all guard patterns match
 * substrings, and the primary {@link EDIT_VERB_PATTERN} negative gate
 * deliberately excludes `add` / `change` / `update` so that legitimate
 * state-query phrases ("did you change it?", "what update did you
 * make?") still fire. That exclusion creates a false-positive risk for
 * compound turns regardless of which pattern set hits first:
 *   - *"did that apply? add a constraint below 50000"* (post-mutation +
 *     edit)
 *   - *"what changed? add a constraint below 50000"* (legacy +
 *     edit)
 *   - *"did you add it? add another option"* (legacy + edit)
 *   - *"where did it go? change confidence to 0.9"* (legacy + edit)
 *
 * The guard should claim standalone complaint / readback turns only.
 * If a clearly-imperative fresh-edit signal is present anywhere in the
 * message, fall through to normal routing where the LLM and downstream
 * pre-routes can disambiguate the compound intent.
 *
 * The patterns below detect an unambiguous imperative edit signal:
 * `add/create <article> <noun>` or `change/update/set <noun> to <value>`.
 * Pronouns ("add it", "update it") are intentionally not matched — those
 * appear in legitimate state-query phrases ("did you add it?", "did you
 * update it?") and the legacy patterns own them.
 */
const FRESH_EDIT_BAIL_OUT_PATTERNS: readonly RegExp[] = [
  // "add a constraint", "add another factor", "add the option",
  // "create an option" — and the article-less form "add constraint"
  // / "add risk for capacity" that natural-language users frequently
  // type. The article group is now optional. The negative lookbehind
  // on `did you ` preserves interrogative state-queries such as "did
  // you add a constraint?" — those are owned by the legacy
  // STATE_QUERY_PATTERNS and must keep matching.
  /(?<!did\s+you\s+)\b(?:add|create|make)\s+(?:(?:a|an|another|the|some)\s+)?\S+/i,
  // "change X to Y", "update X to Y", "set X to Y" — value-update
  // imperatives. Supports multi-word noun phrases ("set the budget
  // to 100k", "set total cost to 50k", "set the total cost to 50k")
  // via `(?:\s+\S+){0,2}` after the leading noun. The negative
  // lookbehind preserves the existing refined-gate fixtures where
  // digit-bearing state-queries like "did you change it to £50k?"
  // and "did you set the budget to 100k?" must still match the
  // legacy pattern (the "to <value>" tail is a value reference in
  // an interrogative, not a fresh-edit imperative).
  /(?<!did\s+you\s+)\b(?:change|update|set)\s+\S+(?:\s+\S+){0,2}\s+to\s+\S+/i,
];

/**
 * Negative gate — imperative edit verbs that signal the user wants a
 * NEW change rather than asking about an old one.
 *
 * Deliberately NARROWER than `EDIT_VERB_OR_QUANTITY_PATTERN` in
 * `deterministic-short-confirm.ts`: the words `change`, `update`,
 * `make`, and `add` appear in legitimate state-query phrases ("what
 * update did you make?", "did you change it?"), so they are excluded
 * here. Imperative edit verbs that don't have a state-query reading
 * stay in.
 *
 * **Digits are NOT a negative signal.** A digit alone ("did you change
 * it to £50k?", "I can't see the £50k constraint") is part of a
 * legitimate state-query referring to a prior value. Edit commands
 * with digits ("Set churn to 5%", "Increase budget to £100,000") are
 * caught by the imperative-verb part of this gate, so dropping the
 * standalone digit guard widens the deterministic floor without
 * inviting false-positive matches on actual edit commands.
 */
const EDIT_VERB_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|adjust|replace|simplif|rebuild|remove)\b/i;

/**
 * Pure route-level predicate: does this message have the shape of a named
 * state-query follow-up ("what changed?", "what did you just change?",
 * "what was updated?", "what did that update do?")?
 *
 * Used by `route-v2` to SUPPRESS `edit_graph` routing for question phrases
 * that contain an edit verb (e.g. "what did you just change?" matches
 * `EDIT_GRAPH_POSITIVE_REGEX` on "change") so they fall through to
 * TurnExecutor, where `tryStateQueryGuard` (below) produces the authoritative
 * answer grounded in `recent_changes`. This predicate is intentionally
 * INDEPENDENT of `recent_changes`: at the route the ContextPack is not built
 * yet, and the route's only job is "do not hijack a question into an edit".
 *
 * It mirrors the legacy `STATE_QUERY_PATTERNS` arm of `tryStateQueryGuard`
 * exactly — the imperative-edit-verb negative gate first, the named-pattern
 * allowlist, then the compound fresh-edit bail-out — so the route never
 * suppresses a turn the in-executor guard would not itself claim. The
 * `POST_MUTATION_COMPLAINT_PATTERNS` arm is deliberately excluded here: those
 * require non-empty `recent_changes` and none of them contain an edit verb,
 * so they are never hijacked by edit routing and need no route suppression.
 */
export function isStateQueryQuestionShape(message: string): boolean {
  // ROADMAP 2.975 — A QUESTION MUST NEVER BE ABLE TO CHANGE THE THING IT ASKS
  // ABOUT, FOR ANY VERB.
  //
  // ⚠ ROUND 1 CLOSED THIS ONLY FOR THE `change` CLASS, AND THE HOLE WAS THE
  // ORDERING. `EDIT_VERB_PATTERN` was tested FIRST and returned early, so
  // *"did you remove anything from my brief?"* never reached the brief-audit
  // check: it was classified as an audit by this module's own predicate and was
  // still granted a mutation warrant by `mutation-warrant.ts:221`, which reads
  // this function. `change` happened to be absent from `EDIT_VERB_PATTERN`
  // (deliberately, so session-edit questions could fire), which is the only
  // reason the `change` case ever worked. remove / adjust / replace / lower are
  // all in it.
  //
  // So the audit classification is now AUTHORITATIVE over the edit-verb gate.
  // For every non-audit message this function is byte-identical to before: the
  // same gate, the same allowlist, the same bail-out, in the same order.
  //
  // ⭐ THE SAME RULE, WIDENED ONCE MORE FOR THE ORIGIN CLASS (journey witness,
  // 18 Aug 2026). *"Why did you add a hybrid phased option?"* is a QUESTION about
  // structure, and a question must never be granted a mutation warrant. It
  // already reached here via `did you …add`, but the phrasings that do NOT carry
  // a change-word — *"why is there a hybrid option?"*, *"where did that come
  // from?"* — did not, and nothing else was denying them a warrant. Classifying
  // them here is strictly protective: the caller either answers from provenance
  // or falls through to the reasoning layer, and neither path mutates.
  const briefAudit = isBriefAuditQuestion(message);
  const originQuestion = isStructureOriginQuestion(message);
  if (!briefAudit && !originQuestion) {
    if (EDIT_VERB_PATTERN.test(message)) return false;
    if (!STATE_QUERY_PATTERNS.some((pat) => pat.test(message))) return false;
  }
  // The compound bail-out still applies to BOTH classes: "what did you leave
  // out? add a constraint" carries a real edit and belongs in normal routing.
  if (FRESH_EDIT_BAIL_OUT_PATTERNS.some((pat) => pat.test(message))) return false;
  return true;
}

export interface TryStateQueryGuardInput {
  readonly message: string;
  readonly contextPack: Pick<ContextPack, 'recent_changes'> &
    Partial<Pick<ContextPack, 'recent_changes_status'>>;
  /**
   * ROADMAP 2.975 — the persisted brief and graph, for answering a BRIEF-AUDIT
   * question ("what did you keep from my brief?") rather than a session-edit
   * one.
   *
   * ⚠ MUST BE THE FULL PERSISTED BRIEF (`TurnContext.scenarioBriefText`), NOT
   * `ContextPack.brief`. The pack's copy is hard-sliced at
   * `CONTEXT_PACK_BRIEF_CHAR_CAP` (2,000 chars) — B2 of the trace corpus
   * persists at 2,078 — and a truncated brief would silently shorten the list
   * of figures we claim to have looked for, turning "I could not see it" into
   * "you did not say it". Both fields are loaded in ONE round trip by
   * `loadGraphAndBriefText`, so the untruncated pair is already in hand.
   *
   * Omitted by callers that have no scenario state; the guard then declines the
   * turn rather than answering, and never deflects.
   */
  readonly briefAudit?: {
    readonly briefText: string | null;
    readonly graph: unknown;
  };
}

export function tryStateQueryGuard(
  input: TryStateQueryGuardInput,
): StateQueryGuardOutcome {
  // Production ContextPacks always carry this status. Legacy/direct callers
  // may omit it, and malformed JS callers can still evade the TypeScript
  // boundary; both resolve to the weakest interpretation rather than silently
  // licensing an authoritative "no edits" claim.
  const recentChangesStatus = resolveRecentChangesStatus(
    input.contextPack.recent_changes_status,
  );
  // Set by the origin arm when it defers: the recorded change that is actually
  // ABOUT the element the question named. `null` everywhere else, so the ordinary
  // readback arms keep quoting the head, which is what "what changed?" means.
  let originSubjectChange: RecentMutation | null = null;

  // ROADMAP 2.975 — SEPARATE THE TWO QUESTIONS BEFORE EITHER ARM CLAIMS ONE.
  //
  // This runs BEFORE the session-edit arms, and returns unconditionally, so a
  // brief-audit question can never reach `no_recent_changes`. That ordering is
  // the fix: the measured defect was not bad copy, it was the edit-history arm
  // answering a question about the brief. Whichever way this branch resolves,
  // the user does not get told about edit history.
  //
  // The compound bail-out is checked first so "what did you leave out? add a
  // constraint" still reaches the LLM, which can handle both halves.
  if (isBriefAuditQuestion(input.message)) {
    if (FRESH_EDIT_BAIL_OUT_PATTERNS.some((pat) => pat.test(input.message))) {
      return { matched: false };
    }
    if (input.briefAudit === undefined) return { matched: false };
    const answer = tryBriefAuditAnswer(
      input.briefAudit.briefText,
      input.briefAudit.graph,
    );
    // `null` = the manifest could not look. Falling through hands the turn to
    // the grounded conversational path rather than asserting a zero.
    if (answer === null) return { matched: false };
    return { matched: true, dispatch: 'brief_audit', assistant_text: answer };
  }

  // ⭐⭐ THE ORIGIN ARM — RUNS BEFORE EVERY SESSION-EDIT ARM AND RETURNS
  // UNCONDITIONALLY, so a provenance challenge can never reach
  // `no_recent_changes`. That ordering IS the fix, and it is the same ordering
  // ROADMAP 2.975 established for the brief-audit question: the measured defect
  // was never bad copy, it was the edit-history arm answering a question that
  // was not about edit history.
  //
  // ⚠ NOTE WHAT IS DELIBERATELY *NOT* HERE: there is no fallback sentence. When
  // the provenance answer is `null` — the element cannot be resolved, or carries
  // no stamp — the guard DECLINES and the turn proceeds to the reasoning layer.
  // Substituting boilerplate at this point would rebuild the exact defect the
  // arm exists to remove, one layer further in.
  //
  // ⚠ AND WHY IT DEFERS WHEN A SESSION MUTATION IS ON RECORD: with a recorded
  // change in hand, *"why did you change the cost constraint?"* is genuinely
  // ambiguous between "why did you make that edit" and "why does this exist",
  // and trap 22f is explicit that where direction cannot be determined we do not
  // guess. The `with_recent_change` arm quotes a REAL persisted mutation, so
  // deferring to it leaves the user with grounded copy rather than a coin toss.
  // This mirrors `isBriefAuditQuestion`, which keeps the ambiguous phrasings on
  // the session-edit side for the same reason.
  if (isStructureOriginQuestion(input.message)) {
    if (FRESH_EDIT_BAIL_OUT_PATTERNS.some((pat) => pat.test(input.message))) {
      return { matched: false };
    }
    // ⭐⭐ THE DEFERRAL IS NARROWED TO THE CASE IT WAS WRITTEN FOR — measured on
    // the deployed build, 18 Aug 2026 (`4a513781`), LINK 6 of the composed
    // journey witness, VERBATIM:
    //
    //   user:  "Why did you add a status quo option? I never mentioned one —
    //           where did that come from?"
    //   Olumi: "Updated Enterprise sales headcount and spend"   (`llm_calls: 0`)
    //
    // The blanket `recent_changes.length > 0` test sent a provenance challenge to
    // the readback arm, which answered it with the PREVIOUS turn's receipt. The
    // ambiguity the deferral respects is real, but it is SUBJECT-BOUND: *"why did
    // you add the cost constraint?"* is ambiguous when the cost constraint is what
    // was just changed, and is not ambiguous at all when the recorded change was
    // to something else. Deferring on no subject overlap is not caution, it is the
    // origin arm's own defect class reproduced one branch further in.
    //
    // ⚠ NOTHING IS ADDED TO A PHRASE LIST (trap 22f). The new conjunct is derived
    // from persisted state: the element the question resolves to, against the
    // `target_label` the handler itself wrote. See
    // `originSubjectIsRecentlyChanged` for the failure direction.
    //
    // ⭐⭐ AND THE SCOPE IS THE ONE BROKEN CELL, NOTHING WIDER. Measured by
    // execution at pristine (`4a513781` + this clone), the 2x2 over the two
    // witnessed phrasings is:
    //
    //   |          | recent = EMPTY     | recent = 1, DIFFERENT element        |
    //   |----------|--------------------|--------------------------------------|
    //   | synonym  | structure_origin   | matched:false -> reasoning layer      |
    //   | captured | structure_origin   | with_recent_change  <-- THE ONLY HARM |
    //
    // The reasoning-layer cell is the one the witness graded "the best provenance
    // answer witnessed on either build". So this change makes the broken cell
    // MATCH ITS OWN ROW — it declines — and touches nothing else. It deliberately
    // does NOT extend the deterministic arm rightwards into the reasoning layer's
    // cell: that would substitute a thin canned sentence for a witnessed-good
    // answer, which is the very defect class this lane was sent to remove.
    if (input.contextPack.recent_changes.length === 0) {
      // ROADMAP 2.975 / #1033's path, UNTOUCHED.
      if (input.briefAudit === undefined) return { matched: false };
      const answer = tryStructureOriginAnswer(input.message, input.briefAudit.graph);
      // `null` = we cannot ground an answer. Declining hands the turn to the
      // reasoning layer; it must never become a canned reply.
      return answer === null
        ? { matched: false }
        : { matched: true, dispatch: 'structure_origin', assistant_text: answer };
    }

    // A mutation IS on record. Defer to the grounded session-edit arms only when
    // that mutation concerns the element this question names.
    //
    // ⚠ WITH NO GRAPH IN HAND (`briefAudit` omitted, or a degraded read that left
    // `persistedGraph` null) THE SUBJECT CANNOT BE RESOLVED, SO THE DEFERRAL
    // CANNOT BE JUSTIFIED — and the unjustified fall-through is exactly what
    // emitted the false claim. Fail-closed: decline.
    const subjectMatch =
      input.briefAudit === undefined
        ? null
        : findRecentChangeAboutOriginSubject(
            input.message,
            input.briefAudit.graph,
            input.contextPack.recent_changes.map((change) => change.target_label),
          );
    // ⭐⭐ ANSWER FROM THE MATCHED CHANGE, NEVER FROM THE HEAD. Measured defect
    // (adversarial review of this PR): with recent = [{Total cost}, {Hybrid
    // Phased Approach}], *"Why did you add the Hybrid Phased Approach?"* deferred
    // correctly and was then answered with the receipt for **Total cost** —
    // because the deferral test returned a boolean and threw away WHICH change
    // matched. Honest, and still an answer about the wrong element.
    originSubjectChange =
      subjectMatch === null
        ? null
        : (input.contextPack.recent_changes[subjectMatch.index] ?? null);
    if (subjectMatch === null) {
      // The recorded change is not what was asked about. The session-edit arms
      // must not claim this turn. Hand it to the reasoning layer, which sees
      // `recent_changes` AND the graph in its ContextPack — the same destination
      // the neighbouring phrasing already reaches, and the one that produced the
      // best provenance answer on the witness.
      return { matched: false };
    }
    // Ambiguous: a recorded mutation targets the very element being asked about.
    // Fall through to the session-edit arms, which are grounded in it (trap 22f —
    // where direction cannot be determined, do not guess).
    //
    // ⚠⚠ AND NOTE WHICH AUTHORITY IS CANONICAL HERE, BECAUSE THE OBVIOUS SENTENCE
    // IS WRONG (adversarial review, PR #1036). It is tempting to say "the node's
    // persisted provenance record is THE authority for a provenance question".
    // It is not, and `structure-origin-answer.ts`'s own header concedes it: the
    // V3 enum is canonical for **whose words the content is**, NOT for **why the
    // element is there**. Derived disagreement case: a user says "add an option
    // for partnerships", the handler mints it, and because `provenance` is
    // response-only and referee-denied to the editor it recomputes to
    // `ai_inferred` with no `source_quote` — so the provenance arm would answer
    // *"that was my suggestion, not something you wrote"*, which is false about
    // why it is there. `recent_changes` is the RIGHT authority whenever it holds
    // a record for the subject, which is exactly what this deferral routes to.
  }

  // Negative gate — cheapest of the session-edit arms. A message with an
  // imperative edit verb is almost always a fresh edit request, not a
  // state-query. It runs AFTER the brief-audit check for the reason given in
  // `isStateQueryQuestionShape`: an audit question carrying `remove` is still a
  // question, and returning early here would hand it to the LLM having already
  // let the route treat it as an edit.
  if (EDIT_VERB_PATTERN.test(input.message)) {
    return { matched: false };
  }

  const recent = input.contextPack.recent_changes;
  // Two phrase classes:
  //   - STATE_QUERY_PATTERNS: legacy named follow-ups ("what changed",
  //     "did you update", etc.). Fire regardless of recent_changes — the
  //     `no_recent_changes` dispatch returns honest copy when the user
  //     asks about something that hasn't happened.
  //   - POST_MUTATION_COMPLAINT_PATTERNS: visibility complaints that only
  //     make sense AFTER a mutation ("I'm not seeing that update", "did
  //     that apply"). Fire ONLY when recent_changes is non-empty; with
  //     no recent mutation they fall through to the LLM, which can ask
  //     for context rather than asserting nothing happened.
  const stateQueryMatched = STATE_QUERY_PATTERNS.some((pat) => pat.test(input.message));
  const postMutationCandidate =
    (recent.length > 0 || recentChangesStatus !== 'complete') &&
    POST_MUTATION_COMPLAINT_PATTERNS.some((pat) => pat.test(input.message));
  if (!stateQueryMatched && !postMutationCandidate) {
    return { matched: false };
  }
  // Universal compound-edit bail-out — applies to BOTH the legacy
  // state-query patterns and the new post-mutation complaint patterns
  // (P1 review fix, second pass). If a clearly-imperative fresh-edit
  // signal appears anywhere in the message — "what changed? add a
  // constraint" or "did you add it? add another option" — the guard
  // declines the turn so the LLM can handle the compound intent. The
  // bail-out runs after the positive matches so it only fires on
  // messages the guard would otherwise claim.
  if (FRESH_EDIT_BAIL_OUT_PATTERNS.some((pat) => pat.test(input.message))) {
    return { matched: false };
  }

  if (recent.length === 0) {
    return {
      matched: true,
      dispatch:
        recentChangesStatus === 'complete'
          ? 'no_recent_changes'
          : 'changes_unavailable',
      assistant_text: emptyRecentChangesText(recentChangesStatus),
    };
  }

  // The head is what a bare readback ("what changed?") means. An origin question
  // that deferred names a specific element, and is answered from THAT change.
  const head = originSubjectChange ?? recent[0]!;
  return {
    matched: true,
    dispatch: 'with_recent_change',
    assistant_text: composeRecentChangeAnswer(
      head,
      recent.length,
      recentChangesStatus,
      EDIT_EFFECT_QUERY_PATTERN.test(input.message),
    ),
    recent_change: head,
    recent_change_count: recent.length,
  };
}

/**
 * Deterministic answer copy. A bare readback quotes the persisted mutation
 * summary verbatim. An effect question does the same only when the projection
 * came from a typed transition; free-form `edit_graph` summaries receive a
 * generic saved-edit acknowledgement because neither their prose nor even a
 * value-looking target label can license an exact before/after value or unit.
 *
 * ⭐⭐ AND IT IS ATTRIBUTED TO THE RECORD RATHER THAN TO THIS TURN, WHICH IS THE
 * WHOLE POINT OF THE PREFIX. Emitted BARE, the summary is a perfective mutation
 * receipt ("Updated Enterprise sales headcount and spend") written by a handler
 * at the time of a PAST mutation — so as a whole reply on a turn that wrote
 * nothing it reads as a claim about THIS turn, and it is false. Measured live:
 * composed journey witness 18 Aug 2026, deployed `4a513781`, LINK 6, where a
 * provenance challenge received exactly that sentence at `llm_calls: 0` with the
 * graph hash unchanged.
 *
 * ⚠ THE ATTRIBUTION IS TRUE BY CONSTRUCTION, NOT BY INSPECTION — which is why it
 * is unconditional rather than gated on anything. `TryStateQueryGuardInput`
 * takes `Pick<ContextPack, 'recent_changes'>`, and `recent_changes` is BY TYPE
 * the projection of `prior_facts` (`context/recent-changes.ts`); this guard runs
 * before any handler and never mutates. There is therefore no reachable state in
 * which the quoted change belongs to the turn being answered.
 *
 * ⭐⭐ "CONVERSATION", NOT "SESSION" — AND THE SOURCE IS WHAT BOUNDS THE RECORD.
 * `recent_changes` <- `prior_facts` <- `readRecent`, whose query is
 * `WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 20`
 * (`session/supabase-store.ts`) — bounded by SCENARIO and by COUNT, and by
 * NEITHER time nor sitting. A user returning to the same scenario next week is
 * handed a receipt from a previous sitting, so "earlier in this session" is
 * false for a reachable and entirely ordinary case. This guard's own sibling
 * copy 20-odd lines below (`NO_RECENT_CHANGES_TEXT`) already says "in this
 * conversation" for the same reason; the two now agree.
 *
 * British English; no em dashes; no internal terms.
 */
export const RECENT_CHANGE_RECORD_PREFIX = 'From the saved model history: ';

function composeRecentChangeAnswer(
  head: RecentMutation,
  totalCount: number,
  status: RecentChangesHistoryStatus,
  isEffectQuestion: boolean,
): string {
  const tail =
    status === 'capped'
      ? ' The available history is limited to the latest three recorded edits, so earlier edits may not be shown.'
      : status === 'degraded'
        ? ' I can verify this recorded edit, but I cannot confirm that the recent edit history is complete.'
        : totalCount > 1
          ? ' If you want to see the other saved model edits, just ask.'
          : '';
  // Terminate the receipt so the multi-change tail is a separate sentence rather
  // than being welded onto it ("…and spend If you want…"). `cap()` closes a
  // truncated summary with `…`, which is already terminal.
  const receipt =
    isEffectQuestion && head.action === 'graph_edited'
      ? `Recorded an edit to the saved model. That saved edit does not include a trustworthy before-and-after value and unit, so I can't quantify its effect without guessing.`
      : head.summary.trimEnd();
  const terminated = /[.!?…]$/u.test(receipt) ? receipt : `${receipt}.`;
  return `${RECENT_CHANGE_RECORD_PREFIX}${terminated}${tail}`;
}

// V5 stale-aware explain recovery — neutral honest copy that contains
// no FORBIDDEN_USER_FACING_PHRASES entry. The previous wording
// ("I haven't applied any changes in this session yet…") matched the
// brief's hard-fail phrase verbatim and surfaced as the V5 Golden
// Journey dl7-edit-graph denial-of-edit symptom whenever recent_changes
// was empty (whether from an H5 missed commit or a legitimate
// no-edits state). The replacement is honest about the absence of
// recorded edits without contradicting an upstream mutation the
// runtime might have missed.
const NO_RECENT_CHANGES_TEXT =
  "I don't have a record of recent edits in the saved model history. " +
  "If you'd like to make a change, tell me what to update and I'll do it directly.";

export const CHANGES_UNAVAILABLE_TEXT =
  "I can't verify the recent edit history right now, so I can't confirm what changed. " +
  'This reply does not change the model; please try again.';

function resolveRecentChangesStatus(
  status: ContextPack['recent_changes_status'] | undefined,
): RecentChangesHistoryStatus {
  return status === 'complete' || status === 'capped' || status === 'degraded'
    ? status
    : 'degraded';
}

function emptyRecentChangesText(status: RecentChangesHistoryStatus): string {
  return status === 'complete' ? NO_RECENT_CHANGES_TEXT : CHANGES_UNAVAILABLE_TEXT;
}

/**
 * Compose the state-query continuity chip INLINE for the
 * state-query guard's dispatch path.
 *
 * Why this lives here, not in `chip-generator.ts`: the chip-generator's
 * post-mutation rule is intentionally scoped to the CURRENT turn's
 * `handlerFacts`. Reading `priorFacts` there would surface a stale
 * "Run analysis" chip on EVERY subsequent converse turn until the
 * user reruns analysis — noise the user wouldn't expect.
 *
 * The state-query guard knows it just dispatched a deterministic
 * answer about recent_changes, so it owns the follow-up chip choice:
 *   - Prior successful run_analysis exists AND freshness === 'stale'
 *     (graph hash diverged because the mutation invalidated it) →
 *     "Run analysis again".
 *   - No prior run_analysis fact (model never analysed) AND model is
 *     structurally ready → "Run analysis".
 *   - Otherwise (fresh analysis, or model not ready) → no chip; the
 *     user has the answer and no useful next step requires a chip.
 *
 * Returns at most one chip. Empty array when no chip is appropriate.
 */
export interface ComposeStateQueryChipInput {
  readonly recentChangeCount: number;
  readonly priorFacts: readonly HandlerFact[];
  readonly analysisFreshness: 'fresh' | 'stale' | 'unknown' | 'none' | undefined;
  readonly analysisReadyStatus: string | undefined;
  readonly validationRegistry: HandlerValidationRegistry;
}

export function composeStateQueryChip(
  input: ComposeStateQueryChipInput,
): readonly SuggestedAction[] {
  if (input.recentChangeCount === 0) return [];
  if (input.analysisReadyStatus !== 'ready') return [];
  // The chip points at run_analysis; suppress when that handler is
  // not registered (test overrides, future flag-gated builds).
  if (input.validationRegistry.run_analysis == null) return [];

  const hasPriorRunAnalysis = input.priorFacts.some(isSuccessfulRunAnalysisFact);
  if (hasPriorRunAnalysis && input.analysisFreshness === 'stale') {
    return [
      {
        id: 'chip_action_rerun_analysis_after_state_query',
        label: 'Run analysis again',
        message: 'Run the analysis again.',
        action_type: 'run_analysis',
      },
    ];
  }
  if (!hasPriorRunAnalysis) {
    return [
      {
        id: 'chip_action_run_analysis_after_state_query',
        label: 'Run analysis',
        message: 'Run the analysis.',
        action_type: 'run_analysis',
      },
    ];
  }
  return [];
}
