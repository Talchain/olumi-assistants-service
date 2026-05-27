/**
 * Pure deterministic copy-quality gate for post-draft coaching strings.
 *
 * Two surfaces:
 *   - {@link gateAssumptionFragment} accepts a single short phrase (the
 *     tail of "One assumption worth checking: …").
 *   - {@link gateFullResponse} accepts a whole assistant_text body that
 *     would replace the deterministic five-sentence builder output.
 *
 * Both surfaces are pre-emptive filters on LLM-authored coaching strings
 * coming off `draft_graph` (`coachingSummary`, `strengthenItems[].detail`,
 * `coachingBiasSignals[].detail`). They are independent from the post-hoc
 * egress guard in `src/orchestrator-v5/compose/forbidden-user-facing-
 * phrases.ts`: that module enforces a narrow set of hard bans on every
 * final assistant_text; this module rejects coaching candidates BEFORE
 * they reach the builder, with a wider rule set tuned to coaching
 * context (length caps, decision-framing presence, etc.).
 *
 * Pure: no I/O, no logging, no side effects. Always returns a
 * `GateResult`; never throws.
 */

const FRAGMENT_MIN_CHARS = 5;
const FRAGMENT_MAX_CHARS = 150;
const RESPONSE_MIN_CHARS = 80;
const RESPONSE_MAX_CHARS = 1200;

/**
 * Internal-id prefix tokens that should never reach a user. Matches the
 * coaching-safety scanner taxonomy. Detection is anchored to a word
 * boundary so legitimate snake-case labels like "go_to_market" (no
 * matching prefix) pass through.
 */
const INTERNAL_ID_PREFIX_REGEX =
  /\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9]+/i;

/**
 * Named schema / service / debug terms. These are concrete phrases the
 * pipeline uses internally that have no user-facing meaning. Match is
 * substring-based (case-insensitive) so "model_adjustment" inside
 * a longer sentence still trips.
 */
const FORBIDDEN_SCHEMA_TERMS: readonly string[] = [
  'intervention',
  'schema',
  'payload',
  'analysis_ready',
  'analysisready',
  'model_adjustment',
  'modeladjustment',
  'bias_finding',
  'biasfinding',
  'factor_id',
  'factorid',
  'node_id',
  'nodeid',
  'graph_node',
  'graphnode',
  'graph node',
  'enrichment',
  'envelope',
];

/**
 * Premature-recommendation language. Post-draft coaching runs before
 * any analysis, so the assistant must not declare a winner or
 * preferred option. The regex matches whole-word tokens (case-
 * insensitive) plus a handful of multi-word phrases.
 */
const PREMATURE_RECOMMENDATION_REGEX =
  /\b(?:recommend(?:s|ed|ation|ations)?|winner|winning option|best option|top choice|chosen route|chosen option|favoured option|favored option|preferred option)\b/i;

/**
 * Em dash detection. The existing draft-narrative tests pin this as a
 * hard ban, mirroring the egress guard. En dashes also trip (U+2013).
 */
const EM_DASH_REGEX = /[–—]/;

/**
 * First-word tokens that read as question-shaped, unsuitable as the
 * tail of "One assumption worth checking: …".
 */
const INTERROGATIVE_PREFIXES: ReadonlySet<string> = new Set([
  'what',
  'why',
  'how',
  'when',
  'where',
  'which',
  'who',
  'is',
  'are',
  'does',
  'do',
  'can',
  'should',
  'would',
  'will',
  'could',
  'might',
]);

/**
 * Tokens that signal the response frames a decision. At least one
 * must be present for {@link gateFullResponse} to accept.
 */
const DECISION_FRAMING_TOKENS_REGEX =
  /\b(?:decision|model|option|options|route|routes|path|paths|choice|choices|trade-?off)\b/i;

/**
 * Tokens that signal the response surfaces a trade-off, gap or
 * assumption. At least one must be present for {@link gateFullResponse}
 * to accept.
 */
const TRADEOFF_OR_GAP_TOKENS_REGEX =
  /\b(?:trade-?off|balance|risk|risks|assume|assumes|assumption|assumptions|consider|weigh|weighs|weighed|gap|gaps|unknown|unknowns|uncertain(?:ty)?|tension|constraint|constraints)\b/i;

/**
 * Tokens that signal a next-step nudge. At least one must be present
 * for {@link gateFullResponse} to accept.
 */
const NEXT_STEP_TOKENS_REGEX =
  /\b(?:run|next|then|try|check|explore|review|inspect|validate|stress-?test)\b/i;

/**
 * Reasons a candidate string can fail the gate. Stays small and
 * category-only so it can be emitted as telemetry without risk of
 * leaking text.
 */
export type GateRejectReason =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'em_dash'
  | 'internal_id'
  | 'schema_term'
  | 'premature_recommendation'
  | 'question_shaped'
  | 'trailing_punctuation'
  | 'awkward_grammar'
  | 'no_decision_framing'
  | 'no_tradeoff_or_gap'
  | 'no_next_step';

export interface GateResult {
  readonly accept: boolean;
  readonly rejectReason?: GateRejectReason;
}

const ACCEPT: GateResult = { accept: true };

/** Convenience: build a rejecting result with a category. */
function reject(reason: GateRejectReason): GateResult {
  return { accept: false, rejectReason: reason };
}

/**
 * Shared checks applied to both fragments and full responses.
 * Returns the first failure, or null if none of the shared rules trip.
 */
function checkShared(text: string): GateResult | null {
  if (typeof text !== 'string') return reject('empty');
  const trimmed = text.trim();
  if (trimmed.length === 0) return reject('empty');
  if (EM_DASH_REGEX.test(trimmed)) return reject('em_dash');
  if (INTERNAL_ID_PREFIX_REGEX.test(trimmed)) return reject('internal_id');
  const lower = trimmed.toLowerCase();
  for (const term of FORBIDDEN_SCHEMA_TERMS) {
    if (lower.includes(term)) return reject('schema_term');
  }
  if (PREMATURE_RECOMMENDATION_REGEX.test(trimmed)) return reject('premature_recommendation');
  return null;
}

/**
 * Gate for sentence-4 fragment candidates (strengthen-item detail /
 * label, bias-finding explanation, coaching-bias-signal detail).
 *
 * Accepts only when the string is a clean declarative fragment that
 * reads naturally after the deterministic "One assumption worth
 * checking: " lead-in, with the builder appending a trailing period.
 */
export function gateAssumptionFragment(text: string): GateResult {
  const shared = checkShared(text);
  if (shared) return shared;
  const trimmed = (text as string).trim();

  if (trimmed.length < FRAGMENT_MIN_CHARS) return reject('too_short');
  if (trimmed.length > FRAGMENT_MAX_CHARS) return reject('too_long');

  // Trailing punctuation (the builder appends `.` itself).
  if (/[.!?,;:]$/.test(trimmed)) return reject('trailing_punctuation');

  // Question-shaped first word.
  const firstToken = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  if (INTERROGATIVE_PREFIXES.has(firstToken)) return reject('question_shaped');

  // Reject obvious filler / awkward fragments — too few alphanumeric
  // word characters relative to length suggests a glyph-heavy string.
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < Math.max(FRAGMENT_MIN_CHARS, Math.floor(trimmed.length * 0.4))) {
    return reject('awkward_grammar');
  }

  return ACCEPT;
}

/**
 * Strict whole-response gate. Accepts only when the candidate is
 * a complete coaching paragraph that frames a decision, surfaces
 * a trade-off / gap / assumption, points at a next step, and is
 * free of the premature-recommendation and internal-id pitfalls.
 *
 * Used to decide whether `coachingSummary` can replace the entire
 * deterministic five-sentence builder output.
 */
export function gateFullResponse(text: string): GateResult {
  const shared = checkShared(text);
  if (shared) return shared;
  const trimmed = (text as string).trim();

  if (trimmed.length < RESPONSE_MIN_CHARS) return reject('too_short');
  if (trimmed.length > RESPONSE_MAX_CHARS) return reject('too_long');

  if (!DECISION_FRAMING_TOKENS_REGEX.test(trimmed)) return reject('no_decision_framing');
  if (!TRADEOFF_OR_GAP_TOKENS_REGEX.test(trimmed)) return reject('no_tradeoff_or_gap');
  if (!NEXT_STEP_TOKENS_REGEX.test(trimmed)) return reject('no_next_step');

  return ACCEPT;
}
