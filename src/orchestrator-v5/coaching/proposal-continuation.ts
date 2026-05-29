import { randomUUID } from 'node:crypto';

import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from '../session/pending-action.js';
import { derivePendingActionsFromChips } from '../compose/derive-pending-actions.js';
import type { SuggestedAction } from '../compose/types.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

/**
 * V5 P0 — Post-analysis proposal-memory continuation.
 *
 * Pure helpers that detect a Sonnet-emitted "add X as a factor/risk?" style
 * proposal in the prior assistant turn, detect a user agreement / "add as
 * factor" intent on the next user turn, and build deterministic clarification
 * responses. The orchestration that calls these helpers lives in
 * `turn-executor.ts` (emit-time hook) and `handlers/edit-graph-dispatch.ts`
 * (next-turn resume hook).
 *
 * NO LLM CALLS. NO PROMPT EDITS. NO SCHEMA CHANGES. CEE-only.
 *
 * Why this module exists
 *   When a user free-text question falls through the deterministic V5 gates
 *   and the LLM emits a useful coaching proposal — for example "the most
 *   useful next step would be to add team morale or cultural fit as a
 *   factor… would you like me to add that?" — the proposal text reaches the
 *   user but evaporates between turns. If the user then agrees ("yes, let's
 *   do that"), `edit_graph` dispatches, finds no concrete mutation signal,
 *   and emits the bland vague-edit recovery ("I haven't changed the model
 *   yet. Tell me which factor or edge…"). The proposal is forgotten and the
 *   user is asked to re-state it in vocabulary they should never see.
 *
 * Mechanism
 *   `extractProposedConcept` mines the emitted assistant_text for a
 *   conservative set of proposal patterns. If a match lands, the caller
 *   persists a `proposed_concept` pending action (see `pending-action.ts`)
 *   alongside the turn commit. On the next turn,
 *   `detectsContinuationAgreement` / `detectsAddAsFactorIntent` decide
 *   whether the user agreed to the proposal or chose the "as a factor"
 *   chip; the no-op recovery layer then upgrades the response to a
 *   deterministic two-stage clarifier:
 *
 *     Stage 1 (agreement) — three chips: "Add as risk", "Add as factor",
 *     "Keep as note". "Add as risk" routes through the existing add-risk
 *     clarification path (which itself is a safe clarifier, not a fake
 *     apply). "Add as factor" comes back to Stage 2 on the next turn.
 *     "Keep as note" yields a deterministic acknowledgement.
 *
 *     Stage 2 ("add as factor" intent) — up to 4 chips listing the
 *     existing model's outcome/goal labels. Click sends "Add {concept}
 *     as a factor affecting {label}.", which then routes through the
 *     existing edit_graph dispatch with both subject and target named.
 *
 * Copy contract (enforced by tests)
 *   British English. No em-dashes. No emoji. No internal vocabulary —
 *   forbidden in user-facing copy: "factor or edge", "node", "edge",
 *   "graph", "schema", "validator", "patch". The chip messages use
 *   the words "risk", "factor", "model", "outcome" deliberately because
 *   those are the user-facing nouns the rest of the product uses.
 */

const MAX_CONCEPT_LENGTH = 80;
const MAX_CONCEPT_WORDS = 8;
const MAX_AGREEMENT_MESSAGE_LENGTH = 400;

/**
 * Regexes that detect a proposal in the prior assistant text. Order is
 * deliberate — the first match wins, and the kind-bearing pattern runs
 * before the generic "would you like me to add …" pattern so concrete
 * proposals carry their `preferred_kind` through.
 */
const CONCEPT_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly preferred_kind: 'risk' | 'factor' | 'either' | 'capture';
}> = [
  {
    pattern: /\b(?:add(?:ing)?|include|introduce)\s+(.+?)\s+as\s+(?:a\s+|an\s+)?(risk|factor|driver)\b/i,
    preferred_kind: 'capture',
  },
  {
    pattern: /\bwould\s+you\s+like\s+(?:me\s+)?to\s+add\s+(.+?)(?:[?.]|$)/i,
    preferred_kind: 'either',
  },
  {
    pattern: /\b(?:adding|including|introducing)\s+(.+?)\s+(?:to|in)\s+the\s+(?:model|decision)\b/i,
    preferred_kind: 'either',
  },
];

/**
 * Phrases that disqualify a downstream-matched concept noun phrase. The
 * concept is reflected verbatim in the Stage 1 / Stage 2 chip messages
 * ("Add {concept} as a risk.") which then pass through the finaliser-level
 * `applyEgressForbiddenPhraseGuard` in edit-graph-dispatch — if a concept
 * triggers that guard, the entire response is rewritten to the bland
 * fallback and the proposal-continuation effect is lost.
 *
 * The two groups below are kept as a single list because the rejection
 * semantics are identical (any hit → return null from extract):
 *   1. Internal-vocabulary leaks (validator, schema, patch, node, edge,
 *      graph). These reach extract only via a malformed LLM emit; we
 *      reject defensively.
 *   2. Egress-banned prescriptive vocabulary (recommendation*, winner,
 *      winning option/probability/side/choice/outcome). Mirrors
 *      `FORBIDDEN_USER_FACING_PHRASES` in
 *      `compose/forbidden-user-facing-phrases.ts` so a concept that
 *      would trip the egress guard never gets persisted.
 *
 * Match is case-insensitive.
 */
const FORBIDDEN_CONCEPT_TOKENS: ReadonlyArray<RegExp> = [
  // Internal-vocabulary class.
  /\bvalidator\b/i,
  /\bdispatch(?:er)?\b/i,
  /\bschema\b/i,
  /\bpatch\b/i,
  /\bedge\b/i,
  /\bnode\b/i,
  /\bgraph\b/i,
  // Egress-banned prescriptive vocabulary (mirrors the egress guard so
  // the concept never produces a downstream chip message that erases
  // the whole response). "winner" and "winning ..." are matched only
  // in prescriptive phrasings the egress guard targets, mirroring its
  // narrowed forms.
  /\brecommendations?\b/i,
  /\brecommended\b/i,
  /\bthe\s+winners?\b/i,
  /\bwinning\s+(?:option|probability|side|choice|outcome)\b/i,
];

/** ID-shape prefixes that must never reach user-facing copy. */
const ID_SHAPE = /(?:opt|fac|goal|node|edge|n|e)_[A-Za-z0-9_-]+/i;

/**
 * Clause-boundary patterns that terminate the raw concept capture. The
 * staging smoke after PR #212 surfaced real Sonnet prose that chained
 * multiple clauses inside a single question — without an intermediate
 * `?`/`.`, the non-greedy regex captured the whole tail. These
 * boundary patterns truncate the capture at the first qualifying
 * boundary so the concept is bounded by sentence semantics, not just
 * sentence terminators.
 *
 * Order is not significant — `truncateAtClauseBoundary` finds the
 * earliest match across all patterns and cuts there.
 *
 * Boundaries deliberately preserve a bare `or` inside the concept (so
 * "team sentiment or change resistance" survives) but stop at `, or`
 * and at any of the explicit question-tail phrasings the smoke
 * surfaced.
 */
const CLAUSE_BOUNDARY_PATTERNS: ReadonlyArray<RegExp> = [
  // Sentence / clause terminators.
  /[.!?;]/,
  // Question-continuation patterns observed in real Sonnet output.
  /\bor\s+would\s+you\s+rather\b/i,
  /\bwould\s+you\s+rather\b/i,
  // "what's most likely" / "what is most likely". The apostrophe class
  // `['\u2019]` covers both the straight (U+0027) and curly (U+2019)
  // forms — LLM prose routinely uses the curly variant, which a bare
  // `'?` would miss. The curly char is written as a `\u2019` escape so
  // the source stays ASCII and no editor can silently re-normalise it
  // to a straight quote (which happened during the first attempt).
  // (PR #216 review NICE-TO-HAVE.)
  /\bwhat(?:['\u2019]?s|\s+is)\s+most\s+likely\b/i,
  // Comma-bridged continuation: `, or X` / `, and X` / `, but X`.
  /,\s*or\s+(?=\w)/i,
  /,\s*(?:and|but)\s+/i,
];

/**
 * Proposal-kind words that may appear at the end of a concept capture
 * when the LLM phrases the kind inline ("add a {concept} factor as a
 * factor"). Stripped from the trailing edge so the persisted concept
 * is the noun phrase only; the inferred kind is returned to the
 * caller as a fallback when the capturing pattern did not extract one
 * itself.
 *
 * Plural forms accepted because LLM output occasionally pluralises
 * ("add team morale factors as factors").
 */
const TRAILING_KIND_STRIP: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly kind: 'risk' | 'factor';
}> = [
  { pattern: /\s+factors?\s*$/i, kind: 'factor' },
  { pattern: /\s+drivers?\s*$/i, kind: 'factor' },
  { pattern: /\s+risks?\s*$/i, kind: 'risk' },
];

/**
 * Generic decision-model element types and structural nouns. After
 * article stripping, a concept that is EXACTLY one of these (singular
 * or plural) carries no specific meaning — the LLM proposed adding an
 * element *type*, not a concept. Rendering "Add {noun} as a risk." is
 * meaningless, so extraction rejects it and the turn falls through to
 * normal handling.
 *
 * PR #216 round-3 review (SHOULD-FIX): the first pass closed only
 * factor/risk/driver; "Would you like me to add a goal? / an option? /
 * an outcome? / a constraint?" still produced bare-noun proposals.
 * Round-4 review added `target` and `model` (both meaningless as bare
 * concepts: "add a target?" / "add a model?").
 *
 * Matched as an EXACT single token (after article stripping), so it
 * never touches multi-word concepts ("delivery goal", "sales target",
 * "business model"). `node` / `edge` / `graph` are already rejected
 * upstream as internal vocabulary (FORBIDDEN_CONCEPT_TOKENS), so they
 * are omitted here.
 */
const GENERIC_BARE_CONCEPT =
  /^(?:factors?|risks?|drivers?|goals?|options?|outcomes?|constraints?|decisions?|objectives?|assumptions?|levers?|scenarios?|criteri(?:on|a)|metrics?|variables?|targets?|models?)$/i;

/**
 * Tokens that should never appear inside a clean concept — they are
 * question-tail vocabulary from the prior LLM clause. Run AFTER
 * clause-boundary truncation; if any of these survive the truncation
 * the capture was bad and the concept is rejected entirely.
 *
 * Conservative list — the staging smoke surfaced "would you rather
 * explore what's most likely to drive disengagement first" as a tail
 * that slipped past the bare `?`/`.` non-greedy bound.
 *
 * `would you` / `rather` / `explore` / `what's` have no legitimate use
 * inside a decision-model concept noun phrase, so they reject on a
 * bare word-boundary match anywhere in the capture.
 *
 * `first` is matched ONLY in trailing position (`first$`). The
 * question-tail form is adverbial and trailing ("...drive
 * disengagement first"), whereas "first" leads several legitimate
 * concepts ("first-mover advantage", "first principles thinking",
 * "first-quarter targets"). A bare `\bfirst\b` rejected those
 * false-positively; the trailing anchor catches the question-tail
 * use while preserving leading legitimate uses. (In the staging-smoke
 * prose the "...most likely" clause boundary already truncates before
 * "first" is reached, so this anchor only changes the backstop
 * behaviour for prose without an earlier boundary.)
 */
const QUESTION_TAIL_TOKENS: ReadonlyArray<RegExp> = [
  /\bwould\s+you\b/i,
  /\brather\b/i,
  /\bexplore\b/i,
  // `what's` (straight U+0027 or curly U+2019 apostrophe) and bare
  // `what is` — LLM prose uses the curly form a bare `'?` would miss.
  /\bwhat(?:['\u2019]?s|\s+is)\b/i,
  /\bfirst\s*$/i,
];

function truncateAtClauseBoundary(s: string): string {
  let earliest = s.length;
  for (const p of CLAUSE_BOUNDARY_PATTERNS) {
    const m = p.exec(s);
    if (m && m.index < earliest) {
      earliest = m.index;
    }
  }
  return s.slice(0, earliest).trim();
}

function stripTrailingKindWord(
  s: string,
): { readonly text: string; readonly kind: 'risk' | 'factor' | null } {
  for (const entry of TRAILING_KIND_STRIP) {
    const m = entry.pattern.exec(s);
    if (m) {
      const candidate = s.slice(0, m.index).trim();
      // Require post-strip text to have ≥2 alpha chars so we don't
      // strip "factor" or "risk" down to "".
      if (/[A-Za-z]{2,}/.test(candidate)) {
        return { text: candidate, kind: entry.kind };
      }
    }
  }
  return { text: s, kind: null };
}

/** Standalone affirmatives that don't carry topical content. */
const STANDALONE_AGREEMENT = /^\s*(?:yes|yeah|yep|sure|ok|okay|please|absolutely)\s*[.!?]?\s*$/i;

const AGREEMENT_PHRASES: ReadonlyArray<RegExp> = [
  /\b(?:that'?s|that is)\s+(?:a\s+)?good\s+idea\b/i,
  /\b(?:let'?s|lets)\s+(?:do|involve|add|include|try|go)\b/i,
  /\bhow\s+(?:should|do|could|would)\s+(?:we|i|you)\s+(?:update|modify|change|adjust)\s+the\s+(?:model|decision)\b/i,
  /\bfor\s+that\s+(?:risk|factor|item)\b/i,
  /\bgo\s+ahead\b/i,
  /\bplease\s+(?:do|add)\b/i,
];

const NEGATION_TOKENS: ReadonlyArray<RegExp> = [
  /\bno\b/i,
  /\bnot\b/i,
  /\bdon'?t\b/i,
  /\bdo\s+not\b/i,
  /\bskip\b/i,
  /\bignore\b/i,
  /\binstead\s+of\b/i,
  /\bnever\b/i,
];

const ADD_AS_FACTOR_PATTERNS: ReadonlyArray<RegExp> = [
  /\badd(?:ing)?\s+.+?\s+as\s+(?:a\s+|an\s+)?factor\b/i,
  // Chip-replay shape from Stage 1's "Add {concept} as a factor." chip —
  // when concept is empty/short the prefix above may not match, so accept
  // the bare "as a factor" tail too.
  /\bas\s+(?:a\s+|an\s+)?factor\b\s*[.!?]?\s*$/i,
];

/**
 * Already-disambiguated factor messages — these carry an explicit affect
 * target ("affecting X") so they should NOT be intercepted by Stage 2.
 * They route through the existing edit_graph path with full context.
 */
const ADD_AS_FACTOR_DISAMBIGUATED = /\bas\s+(?:a\s+|an\s+)?factor\s+affecting\b/i;

export interface ProposedConcept {
  readonly concept: string;
  readonly preferred_kind: 'risk' | 'factor' | 'either';
}

/**
 * Inspect the prior assistant turn's text for a proposal of the form
 * "add X as a factor/risk", "would you like me to add X", "adding X to the
 * model". Returns the noun phrase X and the preferred kind hint when a
 * conservative match lands; returns null otherwise.
 *
 * The function is intentionally cautious: if the regex cannot pin down a
 * crisp noun phrase, or the phrase fails the post-match filters, it
 * declines rather than guessing. Telemetry at the call site surfaces the
 * capture rate so production drift is observable.
 */
export function extractProposedConcept(
  assistantText: string | null | undefined,
): ProposedConcept | null {
  if (typeof assistantText !== 'string') return null;
  const text = assistantText.trim();
  if (text.length === 0) return null;

  for (const entry of CONCEPT_PATTERNS) {
    const match = entry.pattern.exec(text);
    if (!match) continue;
    const raw = match[1];
    if (typeof raw !== 'string') continue;

    // Three-pass hardening (PR #212 staging-smoke follow-up):
    //   1. Truncate at clause / question-tail boundaries so a chained
    //      Sonnet question ("...factor, or would you rather explore...")
    //      does not bleed into the concept.
    //   2. Strip a trailing proposal-kind word ("factor", "risk",
    //      "driver") so "team morale factor" → "team morale" and the
    //      stripped kind is offered back as a fallback when the
    //      capturing pattern itself did not extract one.
    //   3. Run `cleanConcept` for the remaining defences (ID-shape
    //      rejection, forbidden-vocabulary rejection, question-tail
    //      vocabulary rejection, article stripping, word-count cap,
    //      length cap).
    const rawTrimmed = raw.trim();
    const truncated = truncateAtClauseBoundary(rawTrimmed);
    const { text: afterTrailingStrip, kind: inferredKind } = stripTrailingKindWord(truncated);
    const cleaned = cleanConcept(afterTrailingStrip);
    if (cleaned === null) continue;

    let preferredKind: 'risk' | 'factor' | 'either';
    if (entry.preferred_kind === 'capture') {
      const captured = match[2]?.toLowerCase();
      if (captured === 'risk') preferredKind = 'risk';
      else if (captured === 'factor' || captured === 'driver') preferredKind = 'factor';
      else preferredKind = 'either';
    } else if (inferredKind !== null) {
      preferredKind = inferredKind;
    } else {
      preferredKind = entry.preferred_kind;
    }
    return { concept: cleaned, preferred_kind: preferredKind };
  }
  return null;
}

/**
 * Decide whether the user's current turn message is an affirmative
 * continuation of the prior proposal. Returns true for short standalone
 * affirmatives ("yes", "ok") and for richer continuations ("that's a good
 * idea, let's add it", "how should we update the model?", "for that
 * risk…"). A negation token within 30 characters before any phrase match
 * disqualifies the match — "no, not a good idea" must not resume.
 */
export function detectsContinuationAgreement(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_AGREEMENT_MESSAGE_LENGTH) return false;

  if (STANDALONE_AGREEMENT.test(trimmed)) {
    return true;
  }

  for (const phrase of AGREEMENT_PHRASES) {
    const m = phrase.exec(trimmed);
    if (!m) continue;
    if (hasLeadingNegation(trimmed, m.index)) continue;
    return true;
  }
  return false;
}

/**
 * Decide whether the user's current turn message is the Stage 2 "Add as
 * factor" intent — typed freely or replayed from the Stage 1 chip. Already-
 * disambiguated factor messages ("Add X as a factor affecting Y.") are
 * intentionally NOT intercepted; they fall through to existing edit_graph
 * dispatch with full context.
 */
export function detectsAddAsFactorIntent(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_AGREEMENT_MESSAGE_LENGTH) return false;
  if (ADD_AS_FACTOR_DISAMBIGUATED.test(trimmed)) return false;
  return ADD_AS_FACTOR_PATTERNS.some((p) => p.test(trimmed));
}

export interface DeterministicResponse {
  readonly assistantText: string;
  readonly suggestedActions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
  }>;
}

/**
 * Stage 1 — assistant proposed, user agreed. Offer three deterministic
 * choices: "Add as risk" (routes through existing add-risk clarification),
 * "Add as factor" (intercepted on next turn by Stage 2), "Keep as note"
 * (no model mutation).
 */
export function buildProposalStageOneResponse(
  input: ProposedConcept,
): DeterministicResponse {
  const concept = input.concept;
  const lines = [
    'I can carry that forward in one of three ways.',
    '',
    'Suggested addition',
    `• ${concept}`,
    '',
    'Choose how to apply it.',
  ];
  return {
    assistantText: lines.join('\n'),
    suggestedActions: [
      {
        id: 'chip_proposal_apply_risk',
        label: 'Add as risk',
        message: `Add ${concept} as a risk.`,
      },
      {
        id: 'chip_proposal_apply_factor',
        label: 'Add as factor',
        message: `Add ${concept} as a factor.`,
      },
      {
        id: 'chip_proposal_keep_note',
        label: 'Keep as note',
        message: 'Just note this for now and keep the model unchanged.',
      },
    ],
  };
}

export interface FactorAffectClarifierInput {
  readonly concept: string;
  readonly candidateAffects: readonly string[];
}

/**
 * Stage 2 — user signalled "Add as factor". Before routing into the edit
 * pipeline we ask what the factor most affects, populating chips from
 * existing model outcome/goal labels. When the model is too sparse to
 * suggest cleanly, fall back to a single free-text prompt and let the
 * user name the target.
 */
export function buildFactorAffectClarifierResponse(
  input: FactorAffectClarifierInput,
): DeterministicResponse {
  const concept = input.concept;
  const labels = pickClarifierLabels(input.candidateAffects);

  if (labels.length === 0) {
    return {
      assistantText:
        `Before I add ${concept}, I'll need to know what it most affects. `
        + 'Tell me which outcome or factor it most affects.',
      suggestedActions: [],
    };
  }

  const lines = [
    `Before I add ${concept}, I'll need to know what it most affects.`,
    '',
    'Choose one:',
  ];

  return {
    assistantText: lines.join('\n'),
    suggestedActions: labels.map((label) => ({
      id: `chip_factor_affect_${slugify(label)}`,
      label,
      message: `Add ${concept} as a factor affecting ${label}.`,
    })),
  };
}

/**
 * Return up to 4 candidate affect-target labels from the current model,
 * preferring goal/outcome/objective kinds where available. Empty array
 * when the model is too sparse to suggest cleanly. Order matches the
 * input ordering for tested kinds; labels with fewer than 2 alpha chars
 * are dropped.
 */
export function pickCandidateAffectLabels(
  nodes: ReadonlyArray<{ readonly label?: string; readonly kind?: string }> | null | undefined,
): string[] {
  if (!nodes || nodes.length === 0) return [];
  const goalLike: string[] = [];
  const otherFactors: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const label = typeof n.label === 'string' ? n.label.trim() : '';
    if (label.length === 0) continue;
    if (!/[A-Za-z]{2,}/.test(label)) continue;
    if (label.length > 60) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = typeof n.kind === 'string' ? n.kind.toLowerCase() : '';
    if (kind === 'goal' || kind === 'outcome' || kind === 'objective' || kind === 'target') {
      goalLike.push(label);
    } else if (kind === 'factor' || kind === 'driver' || kind === '') {
      otherFactors.push(label);
    }
  }
  const picked = [...goalLike, ...otherFactors].slice(0, 4);
  return picked;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function cleanConcept(raw: string): string | null {
  let s = raw.trim().replace(/\s+/g, ' ');
  s = s.replace(/[.,;:!?\s]+$/g, '');
  if (s.length === 0) return null;
  // Forbidden-token rejection runs BEFORE article stripping so the
  // egress guard's article-aware patterns (e.g. `\bthe\s+winners?\b`)
  // can match in their natural form. Without this order, "the winner"
  // would be stripped to "winner" and slip past the bare-word filter.
  if (ID_SHAPE.test(s)) return null;
  for (const forbidden of FORBIDDEN_CONCEPT_TOKENS) {
    if (forbidden.test(s)) return null;
  }
  // Reject any concept that still carries question-tail vocabulary
  // after upstream clause-boundary truncation. PR #212 staging-smoke
  // follow-up: real Sonnet output can chain multiple clauses inside
  // one question without an intermediate `?`/`.`, and although the
  // upstream `truncateAtClauseBoundary` cuts most of the chain off,
  // any residual fragment containing these tokens is a strong signal
  // the capture was bad. Failing closed is preferable to renders
  // like "Add team morale rather than as a risk." reaching the user.
  for (const tail of QUESTION_TAIL_TOKENS) {
    if (tail.test(s)) return null;
  }
  // Strip leading articles + leftover whitespace AFTER the forbidden
  // check.
  s = s.replace(/^(?:a|an|the)\s+/i, '');
  if (s.length === 0) return null;
  // Reject a concept that reduced to a bare proposal-kind word after
  // article stripping. PR #216 review (SHOULD-FIX): "Would you like me
  // to add a factor?" captures "a factor"; `stripTrailingKindWord`
  // declines (the residue "a" is < 2 alpha chars), and the article
  // strip above then leaves the generic "factor". Rendering "Add
  // factor as a risk." is meaningless — there is no concept to add.
  // The set spans all generic decision-model element types (see
  // GENERIC_BARE_CONCEPT) so "a goal" / "an option" / "an outcome" /
  // "a constraint" are rejected too (round-3 review). Reject so
  // extraction returns null and the turn falls through to its normal
  // (non-proposal) handling.
  if (GENERIC_BARE_CONCEPT.test(s)) return null;
  // Concept must contain at least 2 alphabetic characters. Rejects
  // single-letter captures (e.g. extract regex over-shooting on a
  // truncated proposal: "add X as a factor" → "X") and pure-digit
  // captures. Matches the floor used by `pickClarifierLabels`.
  if (!/[A-Za-z]{2,}/.test(s)) return null;
  // Word-count cap mirrors the char-length cap as a second-axis
  // bound: a 79-char concept that happens to be 20 short words is
  // still too long for a chip message. PR #212 staging-smoke
  // follow-up. Truncates at the word boundary rather than rejecting
  // outright — most over-length captures are an extra clause the
  // upstream truncation missed, not a malformed extract.
  const words = s.split(/\s+/);
  if (words.length > MAX_CONCEPT_WORDS) {
    s = words.slice(0, MAX_CONCEPT_WORDS).join(' ');
  }
  if (s.length > MAX_CONCEPT_LENGTH) {
    const cut = s.lastIndexOf(' ', MAX_CONCEPT_LENGTH);
    s = cut > 20 ? s.slice(0, cut).trim() : s.slice(0, MAX_CONCEPT_LENGTH).trim();
    if (s.length === 0) return null;
  }
  return s;
}

function hasLeadingNegation(message: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - 30);
  const window = message.slice(windowStart, matchIndex);
  return NEGATION_TOKENS.some((p) => p.test(window));
}

function pickClarifierLabels(input: readonly string[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim().replace(/\s+/g, ' ');
    if (label.length === 0) continue;
    if (!/[A-Za-z]{2,}/.test(label)) continue;
    if (label.length > 60) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 4) break;
  }
  return out;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Shared decision helper — single source of truth for the Stage 1 / Stage 2
// ladder. Used by both `decideNoOpRecovery` (post-LLM defence-in-depth) and
// the pre-LLM intercept in `dispatchEditGraph` so the two paths cannot
// diverge.
// ---------------------------------------------------------------------------

export type ProposalContinuationStage = 'stage_one' | 'stage_two';

export interface ProposalContinuationDecision {
  readonly stage: ProposalContinuationStage;
  readonly assistantText: string;
  readonly suggestedActions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
  }>;
}

export interface DecideProposalContinuationInput {
  readonly message: string;
  readonly pendingProposedConcept: {
    readonly concept: string;
    readonly preferred_kind: 'risk' | 'factor' | 'either';
  } | null;
  readonly nodes?:
    | ReadonlyArray<{ readonly label?: string; readonly kind?: string }>
    | null;
}

/**
 * Decide whether to emit a Stage 1 / Stage 2 proposal-continuation response.
 *
 * Returns null when no pending concept exists or when the user's message
 * matches neither agreement nor the add-as-factor intent. The caller falls
 * through to its existing branches in that case.
 *
 * Stage precedence: when the user message matches both agreement AND
 * add-as-factor (rare but possible — e.g. "Yes, add team morale as a
 * factor."), Stage 2 wins. Going straight to the affect-target clarifier
 * is more useful than re-asking which kind of addition to make.
 *
 * The `nodes` argument is read only on the Stage 2 branch; pass an empty
 * array when no graph is available. Stage 1 ignores it.
 */
export function decideProposalContinuation(
  input: DecideProposalContinuationInput,
): ProposalContinuationDecision | null {
  if (input.pendingProposedConcept === null) return null;
  if (detectsAddAsFactorIntent(input.message)) {
    const candidateAffects = pickCandidateAffectLabels(input.nodes ?? null);
    const built = buildFactorAffectClarifierResponse({
      concept: input.pendingProposedConcept.concept,
      candidateAffects,
    });
    return {
      stage: 'stage_two',
      assistantText: built.assistantText,
      suggestedActions: built.suggestedActions,
    };
  }
  if (detectsContinuationAgreement(input.message)) {
    const built = buildProposalStageOneResponse({
      concept: input.pendingProposedConcept.concept,
      preferred_kind: input.pendingProposedConcept.preferred_kind,
    });
    return {
      stage: 'stage_one',
      assistantText: built.assistantText,
      suggestedActions: built.suggestedActions,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Emit-time helper — used by turn-executor.ts and edit-graph-dispatch.ts
// ---------------------------------------------------------------------------

export interface BuildProposalPendingActionInput {
  readonly concept: string;
  readonly preferred_kind: 'risk' | 'factor' | 'either';
  readonly scenario_id: string;
  readonly emitted_at_iso: string;
  readonly graph_hash?: string;
  readonly wall_ttl_ms?: number;
  readonly turn_ttl?: number;
}

/**
 * Build a `proposed_concept` pending action ready to be persisted alongside
 * the current turn's commit. The caller is responsible for passing the
 * current graph hash (used as the precondition for invalidation on graph
 * mutation) and for combining this entry with any chip-derived entries
 * before passing the list to `commitDirectAnswer`.
 *
 * `chip_id` is set to the same UUID as `id` because no user-facing chip
 * carries this pending action — it is server-only state. The parser does
 * not require chip_id to match anything for this kind.
 *
 * `public_label` and `public_message` carry user-safe strings so the
 * resumer can render them even if the helper module changes shape later.
 */
export function buildProposalPendingAction(
  input: BuildProposalPendingActionInput,
): PendingAction {
  const id = randomUUID();
  const wallMs = input.wall_ttl_ms ?? PENDING_ACTION_DEFAULT_WALL_TTL_MS;
  const turnTtl = input.turn_ttl ?? PENDING_ACTION_DEFAULT_TURN_TTL;
  const expiresAtIso = new Date(Date.parse(input.emitted_at_iso) + wallMs).toISOString();
  return {
    id,
    scenario_id: input.scenario_id,
    chip_id: id,
    action: {
      kind: 'proposed_concept',
      concept: input.concept,
      preferred_kind: input.preferred_kind,
      public_label: 'Continue with the proposed update',
      public_message: `Continue with ${input.concept}.`,
    },
    preconditions: input.graph_hash !== undefined
      ? { graph_hash: input.graph_hash }
      : {},
    expires_at_turn_count: turnTtl,
    expires_at_iso: expiresAtIso,
    emitted_at_iso: input.emitted_at_iso,
  };
}

/**
 * Locate the most recent `proposed_concept` action in a list of pending
 * actions from the prior turn. Returns null if none is present or if the
 * action shape is unexpected (defensive — parsePendingAction has already
 * validated, but this lets the resumer narrow without an `as` cast).
 */
export function findProposedConceptAction(
  pendingActions: readonly PendingAction[] | null | undefined,
): { concept: string; preferred_kind: 'risk' | 'factor' | 'either' } | null {
  if (!pendingActions || pendingActions.length === 0) return null;
  for (let i = pendingActions.length - 1; i >= 0; i--) {
    const pa = pendingActions[i];
    if (!pa) continue;
    if (pa.action.kind !== 'proposed_concept') continue;
    return {
      concept: pa.action.concept,
      preferred_kind: pa.action.preferred_kind,
    };
  }
  return null;
}

/**
 * Locate the most recent `proposed_concept` pending action entry (full
 * object, not the narrowed concept). Used by the resume sites that also
 * need to inspect `preconditions.graph_hash` for divergence and
 * `expires_at_iso` for wall-clock expiry.
 *
 * Returns null when no `proposed_concept` entry is present.
 */
export function findProposedConceptEntry(
  pendingActions: readonly PendingAction[] | null | undefined,
): PendingAction | null {
  if (!pendingActions || pendingActions.length === 0) return null;
  for (let i = pendingActions.length - 1; i >= 0; i--) {
    const pa = pendingActions[i];
    if (!pa) continue;
    if (pa.action.kind !== 'proposed_concept') continue;
    return pa;
  }
  return null;
}

/**
 * Wall-clock TTL check for a `proposed_concept` pending action. Mirrors
 * the `isExpired` rule used by `tryClarificationResume` and
 * `tryShortConfirmResume` so all three resume paths agree on what
 * "expired" means.
 *
 * Returns true when:
 *   - `expires_at_iso` is not a parseable timestamp (defensive — the
 *     parser should already reject malformed entries, but we treat any
 *     unparseable timestamp as expired so the resume fails closed);
 *   - the current wall-clock time is after `expires_at_iso`.
 *
 * Turn-count TTL is NOT checked here because it is effectively enforced
 * by `readMostRecentPendingActions`'s most-recent-only read pattern
 * (proposals from more than one turn back are not in the prior turn's
 * pending_actions row by the time the next-turn resumer queries).
 */
export function isProposedConceptExpired(pa: PendingAction, nowMs: number): boolean {
  const expiresMs = Date.parse(pa.expires_at_iso);
  if (!Number.isFinite(expiresMs)) return true;
  if (nowMs > expiresMs) return true;
  return false;
}

export type ProposalResumeRejection =
  | 'no_pending'
  | 'expired_wall'
  | 'graph_hash_changed';

export interface ResolveProposalResumeInput {
  readonly message: string;
  readonly pendingActions: readonly PendingAction[] | null | undefined;
  readonly nodes?:
    | ReadonlyArray<{ readonly label?: string; readonly kind?: string }>
    | null;
  readonly currentGraphHash: string | null;
  readonly nowMs: number;
}

export interface ResolveProposalResumeResult {
  readonly decision: ProposalContinuationDecision | null;
  /**
   * When `decision === null`, why the gate rejected. `null` means the
   * pending was safe and `decideProposalContinuation` simply returned
   * null (neither agreement nor add-as-factor matched). Callers use the
   * rejection reason to emit telemetry; a `null` reason emits nothing.
   */
  readonly rejection: ProposalResumeRejection | null;
}

/**
 * Single source of truth for the proposal-continuation resume gate.
 *
 * Composition of the four safety checks called out by review:
 *   1. No prior `proposed_concept` entry → reject `no_pending` (no
 *      telemetry — this is the steady-state on most turns).
 *   2. Wall-clock TTL elapsed → reject `expired_wall`. Mirrors the
 *      `isExpired` rule used by `tryClarificationResume` / `tryShort
 *      ConfirmResume` so all three resumers agree on what "expired"
 *      means.
 *   3. Graph hash diverged since emit → reject `graph_hash_changed`.
 *      Defensive check against a graph mutation between proposal and
 *      agreement.
 *   4. Otherwise → return the Stage 1 / Stage 2 decision from
 *      `decideProposalContinuation` (which may itself return null when
 *      neither agreement nor add-as-factor matches).
 *
 * The wall-clock check runs BEFORE the hash check so a stale-by-time
 * proposal is dropped before we waste compute. The dispatch call sites
 * use `rejection` to emit `v5.proposal_continuation.invalidated` with
 * the specific reason.
 *
 * Turn-count TTL is NOT enforced here — it is implicitly handled by
 * `readMostRecentPendingActions`'s most-recent-only read pattern.
 * Proposals from more than one turn back are not in the prior turn's
 * pending_actions row by the time the next-turn resumer queries.
 */
export function resolveProposalResume(
  input: ResolveProposalResumeInput,
): ResolveProposalResumeResult {
  const entry = findProposedConceptEntry(input.pendingActions);
  const proposed = findProposedConceptAction(input.pendingActions);
  if (entry === null || proposed === null) {
    return { decision: null, rejection: 'no_pending' };
  }
  if (isProposedConceptExpired(entry, input.nowMs)) {
    return { decision: null, rejection: 'expired_wall' };
  }
  const persistedHash = entry.preconditions.graph_hash;
  const hashDiverged =
    persistedHash !== undefined
    && input.currentGraphHash !== null
    && input.currentGraphHash !== persistedHash;
  if (hashDiverged) {
    return { decision: null, rejection: 'graph_hash_changed' };
  }
  const decision = decideProposalContinuation({
    message: input.message,
    pendingProposedConcept: proposed,
    nodes: input.nodes ?? null,
  });
  return { decision, rejection: null };
}

export interface CaptureProposalForCommitInput {
  readonly assistantText: string | null | undefined;
  readonly chips: readonly SuggestedAction[];
  readonly scenarioId: string;
  readonly graphHash: string | null;
  readonly requestId: string;
  /**
   * Telemetry-only label for the commit-site path so dashboards can
   * attribute capture rate to the originating composer (e.g.
   * `llm_sonnet`, `advice_gate`). Free-form; mirrors the
   * `dispatch_path` field on the freshness telemetry.
   */
  readonly originPath: string;
}

const PENDING_ACTIONS_CAP = 3;

/**
 * Emit-time helper used at multiple commit sites in turn-executor.ts.
 *
 * Inspects `assistantText` for a Sonnet/composer-emitted proposal pattern.
 * When a concept is captured:
 *   1. Build a `proposed_concept` PendingAction with current graph hash
 *      as the precondition (resumer skips when hash diverges next turn).
 *   2. Derive the standard chip-derived pending actions for the same
 *      turn so chip-click resumption still works (atomic-emit contract).
 *   3. Combine, putting the proposal entry FIRST so the per-turn cap
 *      doesn't drop it when chip-derived already has the maximum.
 *   4. Emit `v5.proposal_continuation.captured` telemetry.
 *
 * Returns the combined pending-action list when a proposal is captured,
 * or `undefined` when no proposal is found — the caller leaves
 * `metadata.pending_actions` unset and the commit path falls back to its
 * existing chip-derived implicit behaviour.
 *
 * Best-effort: extraction or derivation failures degrade silently to
 * `undefined`. The commit must never be blocked by capture failure.
 */
export function buildPendingActionsWithProposalCapture(
  input: CaptureProposalForCommitInput,
): readonly PendingAction[] | undefined {
  try {
    const proposedConcept = extractProposedConcept(input.assistantText);
    if (proposedConcept === null) return undefined;
    const emittedAtIso = new Date().toISOString();
    const proposalEntry = buildProposalPendingAction({
      concept: proposedConcept.concept,
      preferred_kind: proposedConcept.preferred_kind,
      scenario_id: input.scenarioId,
      emitted_at_iso: emittedAtIso,
      ...(input.graphHash ? { graph_hash: input.graphHash } : {}),
    });
    const chipDerived = derivePendingActionsFromChips(input.chips, {
      scenario_id: input.scenarioId,
      emitted_at_iso: emittedAtIso,
      ...(input.graphHash ? { graph_hash: input.graphHash } : {}),
    });
    // Proposal first so the cap never drops it when chip-derived is
    // already at maximum. derivePendingActionsFromChips already enforces
    // PENDING_ACTIONS_PER_TURN_CAP; the slice here is defence-in-depth.
    const combined = [proposalEntry, ...chipDerived].slice(0, PENDING_ACTIONS_CAP);
    emit(TelemetryEvents.V5ProposalContinuationCaptured, {
      request_id: input.requestId,
      scenario_id: input.scenarioId,
      concept_length: proposedConcept.concept.length,
      preferred_kind: proposedConcept.preferred_kind,
      chip_derived_count: chipDerived.length,
      origin_path: input.originPath,
    });
    return combined;
  } catch (err) {
    log.warn(
      {
        event: 'v5.proposal_continuation.capture_failed',
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        origin_path: input.originPath,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 proposal-continuation capture failed; falling back to default pending actions',
    );
    return undefined;
  }
}
