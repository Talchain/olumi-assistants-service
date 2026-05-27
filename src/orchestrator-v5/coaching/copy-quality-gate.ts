import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';

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
// Tightened from 1200 → 800 chars to land closer to the deterministic
// five-sentence budget (~700 chars / 140 words). A coaching summary that
// blows past the deterministic envelope is almost always rambling or a
// list dump in disguise, neither of which reads cleanly as a single
// post-draft paragraph.
const RESPONSE_MAX_CHARS = 800;

/**
 * Internal-id prefix tokens that should never reach a user.
 *
 * Aligned with the central detector at
 * {@link ../../orchestrator/shared/entity-id-pattern.ts:25}: same
 * prefix list, same `[_:-]` separator class.
 *
 * Detection is two-stage:
 *   1. This regex finds *candidate* prefix-shaped tokens (broad
 *      over-match — also catches English compounds like
 *      `risk_adjusted`, `out_of_scope`, `option_value`,
 *      `constraint_based`, `factor_analysis`).
 *   2. {@link isSlugShapedEntityId} (imported from the central
 *      output-safety helper) confirms each candidate against the
 *      slug-shape heuristic: digit anywhere → ID, `fac`/`opt` short
 *      prefix → ID, multi-segment with first segment ≥ 4 chars → ID;
 *      single-segment suffix or short-connector first segment →
 *      English compound, NOT an ID.
 *
 * Result: a sentence like "consider the risk_adjusted return" passes
 * the gate cleanly; a sentence containing `factor_delivery_cost` or
 * `option_launch_now` is rejected as expected.
 *
 * Global flag is required for `matchAll`. `node_*` is intentionally
 * omitted to match the central detector — `node` has no
 * unambiguous-leak prose collisions worth a hard ban here, and the
 * existing `node_id` / `nodeid` schema-term substrings still catch
 * the canonical leak shape inside FORBIDDEN_SCHEMA_TERMS below.
 */
const INTERNAL_ID_CANDIDATE_REGEX =
  /\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-][a-z0-9_:-]+/gi;

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
 * Graph-shape language. The post-draft surface is decision-coaching
 * copy; users never see "nodes", "edges", or "graph" in a working
 * draft. A coaching summary that mentions them is showing graph
 * inventory rather than reasoning about the decision, which is the
 * exact regression PR #207 set out to prevent. Word-boundary anchored
 * so "anode", "wedge", "telegraph" are not false positives.
 */
const GRAPH_SHAPE_REGEX = /\b(?:nodes?|edges?|graphs?)\b/i;

/**
 * Premature-recommendation language. Post-draft coaching runs before
 * any analysis, so the assistant must not declare a winner, name a
 * preferred option, or instruct the user toward a specific choice. The
 * regex covers single-word tokens plus the common multi-word phrases
 * an LLM tends to slip into a "coaching" register.
 *
 * Whole-word anchoring with `\b` so legitimate uses ("the chosen
 * route" inside a summary that is NOT pre-analysis recommendation
 * still gets flagged — there is no innocuous use of these phrases at
 * the post-draft stage).
 */
const PREMATURE_RECOMMENDATION_REGEX = new RegExp(
  [
    '\\brecommend(?:s|ed|ation|ations)?\\b',
    '\\bwinner\\b',
    '\\bwinning (?:option|route|path|choice)\\b',
    '\\bbest (?:option|route|path|choice|approach)\\b',
    '\\btop (?:choice|option|route|path)\\b',
    '\\bchosen (?:route|option|path|choice)\\b',
    '\\bfavou?red (?:option|route|path|choice)\\b',
    '\\bpreferred (?:option|route|path|choice)\\b',
    '\\b(?:you|i) (?:should|would) (?:choose|pick|go with|select)\\b',
    '\\b(?:clear|obvious) (?:choice|winner|favou?rite)\\b',
    '\\b(?:strongest|most promising|leading) (?:option|route|path|choice)\\b',
  ].join('|'),
  'i',
);

/**
 * Em dash detection. The existing draft-narrative tests pin this as a
 * hard ban, mirroring the egress guard. En dashes also trip (U+2013).
 */
const EM_DASH_REGEX = /[–—]/;

/**
 * Markdown / bullet / numbered-list / header formatting. A coaching
 * summary should render as a single paragraph of prose; bullet-shaped
 * input is almost always either an LLM that ignored the format
 * instruction or a debug dump leaking through. Applied only to the
 * whole-response surface — sentence-4 fragments are too short to
 * legitimately contain list formatting.
 */
const MARKDOWN_LIST_REGEX = /(?:^|\n)\s*(?:[-*+]\s|\d+\.\s|#+\s)/;

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
  | 'graph_shape'
  | 'premature_recommendation'
  | 'question_shaped'
  | 'trailing_punctuation'
  | 'awkward_grammar'
  | 'markdown'
  | 'no_decision_framing'
  | 'no_tradeoff_or_gap'
  | 'no_next_step';

export interface GateResult {
  readonly accept: boolean;
  readonly rejectReason?: GateRejectReason;
}

// Frozen singleton — accept results have no per-call state, and freezing
// guards against accidental shared-reference mutation from mixed-JS
// callers that bypass the readonly type-level contract.
const ACCEPT: GateResult = Object.freeze({ accept: true });

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
  if (hasConfirmedInternalId(trimmed)) return reject('internal_id');
  if (GRAPH_SHAPE_REGEX.test(trimmed)) return reject('graph_shape');
  const lower = trimmed.toLowerCase();
  for (const term of FORBIDDEN_SCHEMA_TERMS) {
    if (lower.includes(term)) return reject('schema_term');
  }
  if (PREMATURE_RECOMMENDATION_REGEX.test(trimmed)) return reject('premature_recommendation');
  return null;
}

/**
 * Two-stage internal-id detection: broad regex finds candidates, then
 * the central {@link isSlugShapedEntityId} heuristic confirms each
 * candidate is slug-shaped (real ID) rather than an English compound
 * (`risk_adjusted`, `out_of_scope`, `option_value`, `constraint_based`,
 * `factor_analysis`). Returns true on the first confirmed leak.
 */
function hasConfirmedInternalId(text: string): boolean {
  for (const match of text.matchAll(INTERNAL_ID_CANDIDATE_REGEX)) {
    if (isSlugShapedEntityId(match[0])) return true;
  }
  return false;
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

  // Question-shaped first word. Strip a trailing `'s` contraction
  // before lookup so "What's the issue" / "Where's the data" /
  // "How's the rollout" trip the same as their non-contracted forms.
  const firstToken = (trimmed.split(/\s+/, 1)[0] ?? '')
    .toLowerCase()
    .replace(/['’]s$/, '');
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

  // Bullet- / list- / header-shaped input is rejected outright. A coaching
  // summary must render as a single paragraph of decision-coaching prose.
  if (MARKDOWN_LIST_REGEX.test(trimmed)) return reject('markdown');

  if (!DECISION_FRAMING_TOKENS_REGEX.test(trimmed)) return reject('no_decision_framing');
  if (!TRADEOFF_OR_GAP_TOKENS_REGEX.test(trimmed)) return reject('no_tradeoff_or_gap');
  if (!NEXT_STEP_TOKENS_REGEX.test(trimmed)) return reject('no_next_step');

  return ACCEPT;
}
