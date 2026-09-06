/**
 * Validate the stored decision_review against the SAME enrichment and prompt input.
 * The Sept 3 capture contains an inverted coefficient claim and a factor-value
 * claim presented as a coefficient change. The enricher now supplies categorical
 * movement before generation; this seam corrects the stored review afterwards.
 *
 * edge_e_values is a tier-3 structured-gate input: no numeric quantity escapes.
 * Its current wire shape does not bind the search baseline and alternative.
 * A fragile-edge alternative is from a different assessment and cannot fill that
 * gap. Consequently these cards retain a useful conditional challenge, but do
 * not assert a named option reversal. No second reversal is calculated here.
 *
 * Pinned ISL 7781ca4f uses an affine one-edge evaluator: endpoint agreement can
 * support an interval inference for that evaluator. It does not mean every point
 * was probed, and search order is not a versioned wire guarantee. This module
 * therefore makes no opposite-span/no-reversal inference from flip_direction.
 *
 * This seam covers scenario_contexts and VOI superlatives in decision_review.
 * It does not certify story/headline directional prose or conversational
 * assistant_text. The governed prompt and C2 permission policy have separate owners.
 */

import { sanitiseLabel } from '../../orchestrator-v5/context/enrichment-graph-labels.js';
import { replaceAssertingUnits } from '../../orchestrator-v5/compose/redactable-units.js';

/** Movement of the coefficient magnitude, not the value of either factor. */
export type EdgeFlipRequirement = 'stronger' | 'weaker' | 'reversed';

export interface EdgeFlipFact {
  readonly fromId: string;
  readonly toId: string;
  readonly fromLabel: string | null;
  readonly toLabel: string | null;
  readonly requirement: EdgeFlipRequirement | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Separator for the internal endpoint-pair key. Deliberately NEITHER of the
 * producer's two spellings (`->`, `::`), and a printable character (a control
 * byte in source makes the file binary to `grep` — trap 17). Pinned by a test.
 */
export const EDGE_KEY_SEPARATOR = '|';

/** Canonical join key. Edge ids are NOT joined on — see `splitScenarioKey`. */
export function edgeFlipKey(fromId: string, toId: string): string {
  return `${fromId}${EDGE_KEY_SEPARATOR}${toId}`;
}

/**
 * Split the `scenario_contexts` record key into endpoint ids.
 *
 * ⚠ A NAME IS NOT AN ADDRESS. The producer spells the SAME edge two ways in
 * ONE payload: `fragile_edges[].edge_id` and the `scenario_contexts` key use
 * `"from->to"`, while `edge_e_values[].edge_id` uses `"from::to"`. Joining on
 * the id string reads a flat zero for every edge. The join is on
 * `from_id`/`to_id` — the estate's established idiom (`coaching/select-fragile-
 * edge.ts`, `compose/lens-selector.ts`) — and a fixture-bound test asserts the
 * literal-key join finds NOTHING.
 */
function splitScenarioKey(key: string): { fromId: string; toId: string } | null {
  for (const sep of ['->', '::']) {
    const idx = key.indexOf(sep);
    if (idx > 0 && idx + sep.length < key.length) {
      return { fromId: key.slice(0, idx), toId: key.slice(idx + sep.length) };
    }
  }
  return null;
}

/** Derive movement from signed means; reject contradictory directional metadata. */
export function deriveEdgeFlipRequirement(row: unknown): EdgeFlipFact | null {
  const e = asRecord(row);
  if (e === null) return null;
  const fromId = nonEmptyString(e.from_id);
  const toId = nonEmptyString(e.to_id);
  if (fromId === null || toId === null) return null;

  const fromLabel =
    typeof e.from_label === 'string' ? sanitiseLabel(e.from_label, fromId) : null;
  const toLabel = typeof e.to_label === 'string' ? sanitiseLabel(e.to_label, toId) : null;

  const none: EdgeFlipFact = {
    fromId,
    toId,
    fromLabel,
    toLabel,
    requirement: null,
  };

  const current = finiteNumber(e.current_mean);
  const flip = finiteNumber(e.flip_mean);
  const declared = typeof e.flip_direction === 'string' ? e.flip_direction : null;

  if (current === null || flip === null || current === 0) return none;

  // The enum, re-derived from the means so a producer typo cannot pass.
  const observedDirection = flip > current ? 'increase' : flip < current ? 'decrease' : null;
  if (observedDirection === null || (declared !== null && declared !== observedDirection)) {
    return none;
  }

  // The means.
  const crossesZero = flip !== 0 && Math.sign(flip) !== Math.sign(current);
  let requirement: EdgeFlipRequirement | null;
  if (crossesZero) {
    requirement = 'reversed';
  } else if (Math.abs(flip) > Math.abs(current)) {
    requirement = 'stronger';
  } else if (Math.abs(flip) < Math.abs(current)) {
    requirement = 'weaker';
  } else {
    requirement = null;
  }
  if (requirement === null) return none;

  return { fromId, toId, fromLabel, toLabel, requirement };
}

/** Index every readable `edge_e_values` row by endpoint pair. */
export function deriveEdgeFlipFacts(enrichment: unknown): ReadonlyMap<string, EdgeFlipFact> {
  const map = new Map<string, EdgeFlipFact>();
  const envelope = asRecord(enrichment);
  const rows = envelope?.edge_e_values;
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const fact = deriveEdgeFlipRequirement(raw);
    if (fact !== null) {
      const key = edgeFlipKey(fact.fromId, fact.toId);
      const previous = map.get(key);
      // Conflicting duplicate rows cannot be resolved by array order.
      map.set(key, previous === undefined ? fact : {
        ...fact,
        requirement: previous.requirement === fact.requirement &&
          previous.fromLabel === fact.fromLabel && previous.toLabel === fact.toLabel
          ? fact.requirement : null,
      });
    }
  }
  return map;
}

// ============================================================================
// Prose reading 1 — the movement a trigger sentence ASSERTS, and its SUBJECT
// ============================================================================

/**
 * What a `trigger_description` claims about the link's movement, or `null`
 * when this module declines to say.
 *
 * Only the ADJACENT comparative-to-model frame classifies:
 *
 *     <comparative> than <baseline-noun>       e.g. "more than forecast",
 *                                                   "faster than expected",
 *                                                   "weaker than modelled"
 *
 * Anything with a word wedged between the comparative and `than` returns
 * `null` ("more SLOWLY than expected" is a WEAKENING that a `more … than` rule
 * reads as a strengthening). A sentence carrying BOTH polarities also returns
 * `null`. A negated frame returns `null` rather than inverting.
 */
export type AssertedMovement = 'stronger' | 'weaker';

/** Nouns naming the model's own baseline — the thing prose compares against. */
const BASELINE_NOUNS = [
  'forecast',
  'forecasts',
  'forecasted',
  'modelled',
  'modeled',
  'the model',
  'expected',
  'expectations',
  'assumed',
  'assumptions',
  'estimated',
  'estimates',
  'anticipated',
  'planned',
  'projected',
  'predicted',
  'currently assumed',
];

const UP_COMPARATIVES = [
  'more',
  'stronger',
  'higher',
  'bigger',
  'larger',
  'greater',
  'faster',
  'steeper',
  'harder',
  'worse',
  'sharper',
];

const DOWN_COMPARATIVES = [
  'less',
  'weaker',
  'lower',
  'smaller',
  'slower',
  'milder',
  'gentler',
  'better',
  'flatter',
  'softer',
];

function comparativePattern(words: readonly string[]): RegExp {
  // `<comparative> than <baseline>` with NOTHING between the comparative and
  // `than`. Optional determiner/possessive before the baseline noun.
  return new RegExp(
    String.raw`\b(?:${words.join('|')})\s+than\s+(?:the\s+|we\s+|our\s+|you\s+|your\s+|it\s+|is\s+|was\s+|were\s+)*(?:${BASELINE_NOUNS.join(
      '|',
    )})\b`,
    'i',
  );
}

const UP_PATTERN = comparativePattern(UP_COMPARATIVES);
const DOWN_PATTERN = comparativePattern(DOWN_COMPARATIVES);

/**
 * Negation governing the comparative frame within a short window ("not more
 * than forecast", "doesn't drive B more than forecast", "unless it rises faster
 * than expected"). Present ⇒ decline, rather than invert.
 *
 * Contractions are matched as a word ending in `n't` (either apostrophe):
 * `\bn't\b` cannot match inside "doesn't" because `\b` needs a non-word
 * character before the `n`. Each covered form is pinned by a corpus member.
 */
const NEGATION_PATTERN =
  /(?:\b(?:not|no|never|without|unless|fails?\s+to|stops?|no\s+longer)\b|\w+n['’]t\b)[^.!?]{0,40}?\bthan\b/i;

export function classifyAssertedMovement(text: unknown): AssertedMovement | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  if (NEGATION_PATTERN.test(text)) return null;
  const up = UP_PATTERN.test(text);
  const down = DOWN_PATTERN.test(text);
  if (up === down) return null; // neither, or both
  return up ? 'stronger' : 'weaker';
}

/**
 * WHAT the trigger sentence is about, read from LABEL STRUCTURE rather than
 * from more grammar: a scenario is keyed to a link, and the prompt contract
 * asks for a condition "using from_label/to_label". A sentence that names BOTH
 * endpoints is a claim about the link; one that names only ONE endpoint is a
 * claim about that factor's value ("If Customer Acquisition Cost rises faster
 * than expected"). A change in a factor's value and a change in a relationship's
 * coefficient are different claims, and the producer fact here is about the
 * coefficient.
 *
 * `'unknown'` when neither label is found (the model paraphrased). An
 * edge-keyed scenario whose subject cannot be read is treated as a link claim
 * by the caller, because the key itself is the claim about the link.
 */
export type TriggerSubject = 'link' | 'factor_value' | 'unknown';

export function classifyTriggerSubject(
  text: unknown,
  fromLabel: string | null,
  toLabel: string | null,
): TriggerSubject {
  if (typeof text !== 'string' || text.length === 0) return 'unknown';
  const haystack = text.toLowerCase();
  const mentions = (label: string | null): boolean =>
    label !== null && label.length > 0 && haystack.includes(label.toLowerCase());
  const from = mentions(fromLabel);
  const to = mentions(toLabel);
  if (from && to) return 'link';
  if (from !== to) return 'factor_value';
  return 'unknown';
}

// ============================================================================
// The replacement — a sentence composed from the structured fact
// ============================================================================

/**
 * The supported condition, in the link's own terms. Sign- and unit-neutral by
 * design: "weaker" means a smaller coefficient magnitude whatever the sign, so
 * on a negative link it reads as the harm getting smaller — which is what the
 * producer's number says — without this module guessing whether "more delay"
 * or "faster delivery" is the good direction for the affected variable.
 *
 * Returns null when either label is not renderable; the caller then has no
 * honest sentence to write and drops the entry.
 */
export function composeSupportedTrigger(
  fact: Pick<EdgeFlipFact, 'fromLabel' | 'toLabel'>,
  movement: EdgeFlipRequirement | 'unverified',
): string | null {
  if (fact.fromLabel === null || fact.toLabel === null) return null;
  const link = `the link from ${fact.fromLabel} to ${fact.toLabel}`;
  switch (movement) {
    case 'stronger':
      return `If ${link} turns out stronger than the model assumes,`;
    case 'weaker':
      return `If ${link} turns out weaker than the model assumes,`;
    case 'reversed':
      return `If ${link} turns out to run the opposite way to what the model assumes,`;
    case 'unverified':
      return `If ${link} turns out different from what the model assumes,`;
  }
}

// ============================================================================
// Producer fact 2 — the value-of-information licence
// ============================================================================

/** One comparison, retaining factor identity, metric, method and assessed scope. */
export interface VoiLicence {
  readonly licensed: boolean;
  readonly rowsInspected: number;
  readonly readingsCompared: number;
  readonly winnerId: string | null;
  readonly winnerLabel: string | null;
  readonly method: string | null;
  readonly scope: readonly { id: string; label: string }[];
}

export function deriveVoiLicence(invokeInput: unknown): VoiLicence {
  const input = asRecord(invokeInput);
  const gaps = asRecord(input?.deterministic_coaching)?.evidence_gaps;
  const sensitivity = asRecord(input?.isl_results)?.factor_sensitivity;
  const readings = new Map<string, { id: string; label: string; value: number; method: string }>();
  let rowsInspected = 0;
  let invalid = false;
  for (const raw of [...(Array.isArray(gaps) ? gaps : []),
    ...(Array.isArray(sensitivity) ? sensitivity : [])]) {
    const row = asRecord(raw);
    if (row === null || !['voi', 'voi_score', 'evpi_percentage_points'].some(k => k in row)) continue;
    rowsInspected += 1;
    const id = nonEmptyString(row.factor_id);
    const label = id !== null && typeof row.factor_label === 'string'
      ? sanitiseLabel(row.factor_label, id) : null;
    const value = finiteNumber(row.evpi_percentage_points);
    const method = nonEmptyString(row.evpi_method);
    // voi/voi_score is a heuristic priority, not an interchangeable EVPI unit.
    // Missing, negative or below-resolution measurements cannot enter a rank.
    if (id === null || label === null || value === null || value < 0 || method === null ||
      (row.status !== undefined && row.status !== 'resolved')) {
      invalid = true;
      continue;
    }
    const previous = readings.get(id);
    if (previous && (previous.value !== value || previous.method !== method || previous.label !== label)) {
      invalid = true;
    }
    readings.set(id, { id, label, value, method });
  }
  const values = [...readings.values()];
  const maximum = Math.max(0, ...values.map(r => r.value));
  const winners = values.filter(r => r.value === maximum);
  const comparable = !invalid && values.length >= 2 &&
    new Set(values.map(r => r.method)).size === 1 &&
    new Set(values.map(r => r.label.toLowerCase())).size === values.length;
  const licensed = comparable && maximum > 0 && winners.length === 1;
  return {
    licensed, rowsInspected, readingsCompared: values.length,
    winnerId: licensed ? winners[0].id : null,
    winnerLabel: licensed ? winners[0].label : null,
    method: comparable ? values[0].method : null,
    scope: values.map(({ id, label }) => ({ id, label })),
  };
}

/**
 * A deliberately limited affirmative form, composed from the supported scope.
 * Arbitrary prose is not licensed by a global boolean: even a sentence naming
 * the winner can crown another factor, negate the comparison or broaden it.
 * Heuristic estimates remain explicitly heuristic. No restricted magnitude is emitted.
 */
export function composeScopedVoiClaim(licence: VoiLicence): string | null {
  if (!licence.licensed || licence.winnerLabel === null || licence.method === null) return null;
  const scope = licence.scope.map(r => r.label).join(', ');
  return `Among the assessed factors (${scope}), checking ${licence.winnerLabel} has the highest ` +
    `estimated value of information using ${licence.method} estimates.`;
}

// ============================================================================
// Prose reading 2 — superlative value-of-information claims
// ============================================================================

/**
 * Superlative VALUE-OF-LEARNING frames. Each anchors the superlative to an
 * INFORMATION quantity, never to a structural influence quantity:
 *
 *   CAUGHT   "…validating it is the single highest-value check…"
 *   CAUGHT   "…would settle the single largest source of uncertainty here."
 *   ALLOWED  "ICP clarity has the biggest influence on this result"
 *   ALLOWED  "is the second strongest driver"
 *
 * The allowed set is asserted as a NON-matching corpus in the suite.
 */
export const VOI_SUPERLATIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:single\s+)?(?:highest|greatest|best|most)[-\s]value\b/i,
  /\bmost\s+valuable\b/i,
  /\bhighest\s+estimated\s+value\s+of\s+information\b/i,
  /\b(?:single\s+)?(?:largest|biggest|greatest)\s+source\s+of\s+uncertainty\b/i,
  /\bworth\s+(?:the\s+)?most\s+to\s+(?:learn|know|find\s+out|resolve|test|check)\b/i,
  /\b(?:highest|best|greatest)\s+(?:expected\s+)?(?:information\s+)?(?:value|payoff|return)\s+(?:of|from|on)\s+(?:learning|testing|resolving|investigating|research)\b/i,
];

/** How many VOI-superlative frames a string carries (0 when none). */
export function countVoiSuperlativeClaims(text: unknown): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let hits = 0;
  for (const pattern of VOI_SUPERLATIVE_PATTERNS) {
    if (pattern.test(text)) hits += 1;
  }
  return hits;
}

/**
 * A limited subject-seeking question asks WHICH check deserves attention; it
 * does not assert that a named factor wins. Match the complete sentence only.
 * A question mark alone is insufficient: "Why is Alpha the highest-value
 * check?" and "What makes Alpha ...?" still presuppose a ranking. Other
 * ambiguous forms retain the existing qualification rather than claiming
 * general question understanding from this small grammar.
 */
function isOpenVoiEnquiry(unit: string): boolean {
  return /^(?:what|which)\s+(?:is|would\s+be|could\s+be)\s+(?:the\s+)?(?:highest[-\s]value\s+check|most\s+valuable\s+thing\s+to\s+(?:learn|test|resolve))(?:\s+here)?\?$/i
    .test(unit.trim());
}

// ============================================================================
// The seam
// ============================================================================

/** Bounded diagnostics; no raw producer values or user prose. */
export type ProseFactRule =
  | 'directional_claim_corrected'
  | 'directional_claim_unverified'
  | 'scenario_consequence_unverified'
  | 'voi_superlative_without_voi_evidence';
export interface ProseFactViolation {
  readonly rule: ProseFactRule;
  readonly observed: number;
}

// This covers absent evidence, ties and incomparable readings without claiming
// that no comparison was performed. Keep the next action available.
export const VOI_SUPERLATIVE_REPLACEMENT =
  'This evidence does not establish which uncertainty is worth checking first. ' +
  'Consider which uncertainty would most change your next step.';
export const UNVERIFIED_CONSEQUENCE =
  'the comparison may change; this run does not establish which option would overtake another under that condition.';

export interface ProseFactAgreementResult {
  readonly output: Record<string, unknown>;
  readonly violations: readonly ProseFactViolation[];
  readonly correctedTriggers: number;
  readonly qualifiedTriggers: number;
  readonly qualifiedConsequences: number;
  readonly factsUnavailable: boolean;
  readonly voiFieldsRedacted: number;
}

/** Labels from the same enrichment only; no label guessed from model prose. */
function scenarioLabels(enrichment: unknown, fromId: string, toId: string) {
  const env = asRecord(enrichment);
  const fragile = asRecord(env?.robustness)?.fragile_edges;
  if (Array.isArray(fragile)) {
    const rows = fragile.map(asRecord).filter(r => r &&
      (r.from_id ?? r.from_node_id) === fromId && (r.to_id ?? r.to_node_id) === toId);
    if (rows.length === 1) {
      const r = rows[0]!;
      return {
        fromLabel: typeof r.from_label === 'string' ? sanitiseLabel(r.from_label, fromId) : null,
        toLabel: typeof r.to_label === 'string' ? sanitiseLabel(r.to_label, toId) : null,
      };
    }
  }
  return { fromLabel: null, toLabel: null };
}

/**
 * Both arguments come from one selected run_analysis fact at the authoring
 * point. Do not call this with a current graph and a historical enrichment.
 * No new persisted identity or cross-run cache is introduced here.
 */
export function checkProseFactAgreement(
  output: Record<string, unknown>,
  enrichment: unknown,
  invokeInput: unknown = null,
): ProseFactAgreementResult {
  const violations: ProseFactViolation[] = [];
  const facts = deriveEdgeFlipFacts(enrichment);
  const factsUnavailable = ![...facts.values()].some(f => f.requirement !== null);
  let next = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;
  let correctedTriggers = 0;
  let qualifiedTriggers = 0;
  let qualifiedConsequences = 0;
  const scenarios = asRecord(next.scenario_contexts);
  for (const [key, raw] of Object.entries(scenarios ?? {})) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    const endpoints = splitScenarioKey(key);
    const fact = endpoints ? facts.get(edgeFlipKey(endpoints.fromId, endpoints.toId)) : undefined;
    const labels = fact ?? (endpoints ? scenarioLabels(enrichment, endpoints.fromId, endpoints.toId) :
      { fromLabel: null, toLabel: null });
    const supported = fact?.requirement != null;
    // Do not infer scientific agreement from a sentence surviving a classifier.
    // A fixed categorical condition also handles negation/adverbs and keeps
    // factor-value changes distinct from changes in coefficient magnitude.
    const trigger = composeSupportedTrigger(labels, fact?.requirement ?? 'unverified') ??
      'If this relationship differs from what the model assumes,';
    if (entry.trigger_description !== trigger) {
      entry.trigger_description = trigger;
      if (supported) correctedTriggers += 1;
      else qualifiedTriggers += 1;
    }
    // The producer currently does not bind BOTH outcome identities to this
    // coefficient search. A neighbouring fragile-edge alternative is insufficient.
    // Qualify the consequence together with the condition, including no-fact runs.
    if (entry.consequence !== UNVERIFIED_CONSEQUENCE) {
      entry.consequence = UNVERIFIED_CONSEQUENCE;
      qualifiedConsequences += 1;
    }
  }
  const push = (rule: ProseFactRule, observed: number) => {
    if (observed > 0) violations.push({ rule, observed });
  };
  push('directional_claim_corrected', correctedTriggers);
  push('directional_claim_unverified', qualifiedTriggers);
  push('scenario_consequence_unverified', qualifiedConsequences);

  const licence = deriveVoiLicence(invokeInput);
  const supportedVoiClaim = composeScopedVoiClaim(licence);
  let voiFieldsRedacted = 0;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (countVoiSuperlativeClaims(node) === 0) return node;
      const replaced = replaceAssertingUnits(node,
        unit => countVoiSuperlativeClaims(unit) > 0 &&
          !isOpenVoiEnquiry(unit) && unit.trim() !== supportedVoiClaim,
        VOI_SUPERLATIVE_REPLACEMENT);
      if (replaced !== node) voiFieldsRedacted += 1;
      return replaced;
    }
    if (Array.isArray(node)) return node.map(walk);
    const record = asRecord(node);
    return record === null ? node : Object.fromEntries(Object.entries(record).map(([k, v]) => [k, walk(v)]));
  };
  next = walk(next) as Record<string, unknown>;
  push('voi_superlative_without_voi_evidence', voiFieldsRedacted);
  return { output: next, violations, correctedTriggers, qualifiedTriggers,
    qualifiedConsequences, factsUnavailable, voiFieldsRedacted };
}

export interface ProseFactAgreementTelemetry {
  readonly reason: ProseFactRule | 'none';
  readonly reasons: string;
  readonly rule_count: number;
}
export function summariseProseFactViolations(
  violations: readonly ProseFactViolation[],
): ProseFactAgreementTelemetry {
  const codes = [...new Set(violations.map(v => v.rule))].sort();
  return { reason: codes[0] ?? 'none', reasons: codes.join(','), rule_count: codes.length };
}
