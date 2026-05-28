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
    const cleaned = cleanConcept(raw);
    if (cleaned === null) continue;
    let preferredKind: 'risk' | 'factor' | 'either';
    if (entry.preferred_kind === 'capture') {
      const captured = match[2]?.toLowerCase();
      if (captured === 'risk') preferredKind = 'risk';
      else if (captured === 'factor' || captured === 'driver') preferredKind = 'factor';
      else preferredKind = 'either';
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
  // Strip leading articles + leftover whitespace AFTER the forbidden
  // check.
  s = s.replace(/^(?:a|an|the)\s+/i, '');
  if (s.length === 0) return null;
  // Concept must contain at least 2 alphabetic characters. Rejects
  // single-letter captures (e.g. extract regex over-shooting on a
  // truncated proposal: "add X as a factor" → "X") and pure-digit
  // captures. Matches the floor used by `pickClarifierLabels`.
  if (!/[A-Za-z]{2,}/.test(s)) return null;
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
