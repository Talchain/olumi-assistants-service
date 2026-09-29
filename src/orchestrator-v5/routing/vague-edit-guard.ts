/**
 * V5 edit lifecycle recovery v1 — narrow vague-edit guard.
 *
 * Sits in route-v2.ts immediately after the chip-simplify intercept and
 * BEFORE `editIntentDetected` is computed (which means BEFORE
 * `dispatchEditGraph`). Suppresses both the V4 `edit_graph` LLM call
 * AND a Sonnet round-trip for messages that are vague improvement
 * requests — no numeric value, no factor / edge / option label
 * anchor, no add/remove/insert/create construct, no mutation-signal
 * regex hit.
 *
 * The guard MUST include its OWN positive shape check
 * (VAGUE_EDIT_VERB_PATTERN) because it runs early — before the
 * route's edit-positive regex narrows the candidate set. Without
 * that shape gate the guard would over-claim conversational
 * messages like "Hello" or "Tell me a joke" (which satisfy every
 * other check by being non-mutating, non-numeric, etc.). The shape
 * gate keeps the guard scoped to messages that look like an
 * improvement instruction or vague-target edit — even when the
 * verb itself (`make`, `improve`, `try`) is not in route-v2's
 * `EDIT_GRAPH_POSITIVE_REGEX`. This is what catches the brief's
 * explicit examples "Make the model better" and "Try something
 * different" which would otherwise fall through to TurnExecutor.
 *
 * The diagnostic from the 2026-05-22 V5 edit-lifecycle investigation
 * found that this class of message either returns empty operations
 * (`recoveryPathChosen: 'none'` at edit-graph.ts:1869) or burns a
 * 6–35s LLM call producing a structured rejection that the user
 * cannot act on. Both outcomes degrade UX more than a deterministic
 * "tell me what you want to change" reply would.
 *
 * Scope discipline (matches the user's brief explicitly):
 *
 *   MUST match (intercept):
 *     - "Simplify the change"
 *     - "Change this"
 *     - "Edit it to be cleaner"
 *     - "Adjust this somehow"
 *     - "Tweak this for me"
 *
 *   MUST NOT match (let through to existing routes):
 *     - "Set Hiring and Salary Cost to £100,000"  (PR #192 deterministic path)
 *     - "Change Hiring and Salary Cost from £80,000 to £100,000"
 *     - "Add a risk for coordination overhead"    (existing add-risk path)
 *     - "What could change the outcome?"          (analytical question)
 *     - "What if we lowered cost?"                 (hypothetical)
 *     - any message containing a graph factor / edge / option label
 *     - any message with a numeric value or %/£/$ token
 *
 * Privacy / safety contract:
 *  - Pure function. No I/O, no telemetry, no side effects.
 *  - Re-uses `hasMutationSignal`, the canonical mutation-signal regex
 *    set from `analytical-intent.ts`. Does NOT redefine those patterns
 *    (PR #192 round-4 lesson: shared grammar must be imported).
 *  - Re-uses `isValueUpdatePhrasing` from `value-update-gate.ts`.
 *  - Label anchoring is substring-only (case-insensitive). No Dice /
 *    fuzzy matching — the goal is to LET concrete edits through, not
 *    to chase ambiguous near-misses.
 *
 * Out of scope for this PR (per the user's tightened brief):
 *  - No new boundary `action_type` value.
 *  - No CQE quantity extraction. Numeric detection is a narrow regex
 *    that catches digits / % / currency tokens — enough to filter out
 *    "set X to 0.7" / "increase by £100" / "30% lower" without taking
 *    on the CQE attribution surface.
 *  - No deictic / pronoun handling. "Change that" already escapes this
 *    guard because "that" is not a label, so it intercepts cleanly.
 */

import { hasMutationSignal } from './analytical-intent.js';
import { isValueUpdatePhrasing } from '../../orchestrator/routing/value-update-gate.js';

/**
 * Minimal node shape needed for label anchoring. Compatible with both
 * `GraphStateIngress` (passthrough Zod parse) and any caller that has
 * already projected its node list down to id/kind/label triples.
 */
export interface VagueEditGuardNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

export type VagueEditGuardUnmatchedReason =
  | 'empty_message'
  | 'no_vague_edit_shape'
  | 'question_shape'
  | 'mutation_signal_present'
  | 'value_update_phrasing_present'
  | 'structural_keyword_present'
  | 'numeric_token_present'
  | 'graph_label_present';

export type VagueEditGuardResult =
  | { readonly matched: true }
  | { readonly matched: false; readonly reason: VagueEditGuardUnmatchedReason };

/**
 * Positive shape gate — phrase-based grammar (PR #194 review-2
 * correction). The previous gate matched any vague-edit verb OR any
 * comparative modifier anywhere in the message, which produced
 * false positives on benign follow-ups like "Sounds better", "Try
 * again", "Try Option B", "Different". Codex review flagged these
 * as silent-routing regressions.
 *
 * Switch to a table of COMPLETE phrases. Each pattern fixes BOTH
 * the verb and the object together — `try` alone is not enough; it
 * must be `try something different` / `try a simpler version`.
 * `better` / `different` alone are not enough; the verb side must
 * be `make (the model|this|it) better`.
 *
 * Structural verbs (`add`, `remove`, `insert`, `create`, `delete`,
 * `drop`) are intentionally absent from this table — they're
 * handled by the downstream structural-keyword check (which
 * short-circuits with `structural_keyword_present` for messages
 * that DO carry a vague-edit shape and also a structural keyword
 * elsewhere). The V4 add-risk classifier and existing structural-
 * edit paths keep ownership of those messages.
 *
 * Adding a new family: extend this table only — do not relax the
 * grammar to single-verb or single-modifier matching.
 */
const VAGUE_EDIT_PHRASE_PATTERNS: readonly RegExp[] = [
  // "make (the model|this|it|things|stuff) (better|different|cleaner|simpler|nicer|clearer|...)"
  /\bmake\s+(?:the\s+(?:model|graph|setup|thing|whole\s+thing)|this|it|things?|stuff)\s+(?:better|different|cleaner|simpler|nicer|clearer|tidier|smoother|sharper|prettier)\b/i,
  // "try (something|anything) (different|else|simpler|cleaner|another|new|fresh|...)"
  /\btry\s+(?:something|anything)\s+(?:different|else|simpler|cleaner|nicer|smoother|another|new|fresh)\b/i,
  // "try a (simpler|different|cleaner|new|fresh) (version|approach|way|take|angle)"
  /\btry\s+(?:a|another)\s+(?:simpler|different|cleaner|nicer|new|fresh)\s+(?:version|approach|way|take|angle)\b/i,
  // "improve (this|it|the (model|graph|setup|thing|analysis|whole thing|wording|copy))"
  /\bimprove\s+(?:this|it|the\s+(?:model|graph|setup|thing|analysis|whole\s+thing|wording|copy))\b/i,
  // "simplify (this|it|the (change|model|graph|setup|approach|edit|update|modification|adjustment|wording|whole thing)|things|everything|stuff)"
  /\bsimplify\s+(?:this|it|the\s+(?:change|model|graph|setup|thing|approach|edit|update|modification|adjustment|wording|whole\s+thing)|things?|everything|stuff)\b/i,
  // "(change|edit|adjust|tweak|modify|update|alter|amend|tune|fix|polish|refine|revise|rework|redo) (this|it|that|the (thing|stuff|model|graph|setup|whole thing|wording|copy|approach))"
  /\b(?:change|edit|adjust|tweak|modify|update|alter|amend|tune|fix|polish|refine|revise|rework|redo)\s+(?:this|it|that|the\s+(?:thing|stuff|model|graph|setup|whole\s+thing|wording|copy|approach))\b/i,
  // "(clean up|sort out) (this|it|the (model|graph|setup|thing|whole thing|wording|approach))"
  /\b(?:clean\s+up|sort\s+out)\s+(?:this|it|the\s+(?:model|graph|setup|thing|whole\s+thing|wording|approach))\b/i,
];

/**
 * Pure predicate. Returns `true` when the message matches ONE of
 * the complete vague-edit phrase patterns above. Test-only export
 * so calibration suites can assert against the patterns directly
 * without going through `tryVagueEditGuard`'s other checks.
 */
export function __testOnlyMatchesVagueEditShape(message: string): boolean {
  return matchesVagueEditShape(message);
}

function matchesVagueEditShape(message: string): boolean {
  for (const re of VAGUE_EDIT_PHRASE_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

/**
 * Numeric / quantitative token guard. Matches digits, currency symbols,
 * and common large-number suffixes. Narrower than CQE — its job is to
 * REJECT messages that any reasonable reader would see as containing a
 * concrete value, not to attribute quantities to factors.
 *
 * Patterns:
 *   - bare digit run: `100`, `0.7`, `1,500`
 *   - currency symbols: `£`, `$`, `€`, `¥`
 *   - percent: `30%`
 *   - written magnitudes: `100k`, `2m`, `1.5bn`
 */
const NUMERIC_TOKEN_PATTERN =
  /(?:\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|bn|mm|%))?\b|[£$€¥])/i;

/**
 * Structural / add-remove keywords that must NEVER be intercepted as
 * vague. Even without an anchor, "add a risk" / "remove the thing"
 * should reach edit_graph LLM (which knows how to ask for the missing
 * driver via the add-risk classifier or fall through to clarification
 * naturally). Excluding these keeps the guard surgical.
 *
 * PR #194 review-3 correction — bare `new` / `another` determiners
 * REMOVED. They're not structural mutation signals on their own;
 * they're just English articles. With them in this pattern, the
 * vague phrase `try a new approach` / `try another fresh approach`
 * matched the phrase-shape gate, then got rejected here as
 * `structural_keyword_present` — a contradiction between the table
 * and the downstream check. The structural signal lives in the
 * VERB (`add` / `insert` / `create` / `remove` / `delete` / `drop`),
 * so the determiner-only check was redundant and produced false
 * negatives on legitimate vague edits.
 */
const STRUCTURAL_KEYWORD_PATTERN =
  /\b(?:add|insert|create|remove|delete|drop)\b/i;

/**
 * Question-shape detector. We don't want to intercept analytical or
 * exploratory questions even if they contain a positive edit verb
 * (e.g. "what could change the outcome?", "could you update this?").
 *
 * Two signals — either alone is sufficient to treat the message as a
 * question:
 *   1. Ends with `?` (after trimming trailing whitespace).
 *   2. Starts with an interrogative or modal-auxiliary token
 *      (what / how / why / when / where / who / which / can / could /
 *       would / should / does / do / is / are / will).
 */
const QUESTION_LEAD_PATTERN =
  /^(?:what|how|why|when|where|who|which|can|could|would|should|does|do|is|are|will)\b/i;

/**
 * Returns `matched: true` when the message looks like a vague,
 * unanchored edit request that should NOT pay for an `edit_graph` LLM
 * call. Returns `matched: false` with a discriminator reason otherwise
 * so the caller can emit precise telemetry / preserve the existing
 * route.
 *
 * @param message       the user-typed (or chip-submitted) message
 * @param nodes         current graph nodes (passthrough Zod shape).
 *                      Used ONLY for label-anchor detection; an empty
 *                      array is acceptable (skips the anchor check
 *                      gracefully, but other guards still apply).
 */
export function tryVagueEditGuard(
  message: string,
  nodes: readonly VagueEditGuardNode[] | null | undefined,
): VagueEditGuardResult {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { matched: false, reason: 'empty_message' };
  }

  const trimmed = message.trim();

  // Positive shape gate — must fire first so the predicate is not
  // satisfied by every non-edit non-question message. Phrase-based
  // (table of complete `verb + object` phrases) per PR #194 review-2
  // correction.
  if (!matchesVagueEditShape(trimmed)) {
    return { matched: false, reason: 'no_vague_edit_shape' };
  }

  if (trimmed.endsWith('?') || QUESTION_LEAD_PATTERN.test(trimmed)) {
    return { matched: false, reason: 'question_shape' };
  }

  if (hasMutationSignal(trimmed)) {
    return { matched: false, reason: 'mutation_signal_present' };
  }

  if (isValueUpdatePhrasing(trimmed)) {
    return { matched: false, reason: 'value_update_phrasing_present' };
  }

  if (STRUCTURAL_KEYWORD_PATTERN.test(trimmed)) {
    return { matched: false, reason: 'structural_keyword_present' };
  }

  if (NUMERIC_TOKEN_PATTERN.test(trimmed)) {
    return { matched: false, reason: 'numeric_token_present' };
  }

  if (containsGraphLabel(trimmed, nodes)) {
    return { matched: false, reason: 'graph_label_present' };
  }

  return { matched: true };
}

function containsGraphLabel(
  message: string,
  nodes: readonly VagueEditGuardNode[] | null | undefined,
): boolean {
  if (!nodes || nodes.length === 0) return false;
  const lower = message.toLowerCase();
  for (const node of nodes) {
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length < 3) continue;
    if (lower.includes(label.toLowerCase())) return true;
  }
  return false;
}
