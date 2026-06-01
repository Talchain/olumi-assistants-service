/**
 * V5 Coaching State Spine — Stage 1: deterministic `DecisionContext` projection.
 *
 * Projects the already-shipped `@talchain/schemas` `DecisionContext` shape
 * (`DecisionContextSchema`, exported but previously unused in CEE) from
 * canonical, already-structured state:
 *   - `scenarios.brief_text` → monetary figures (via the CQE single-source
 *     currency grammar) + a conservative timeline token;
 *   - `scenarios.graph` → named entities (option + goal labels) and goal
 *     translation (goal label + raw user-scale threshold), via a permissive
 *     node-label read (no strict GraphV3 parse — see `readGraphNodes`).
 *
 * Discipline (F.6 / brief): PROJECTION, NOT INFERENCE. Every field is a
 * verbatim read or a deterministic extraction of an already-structured value.
 * Nothing here classifies stakes, reversibility, timeframe, urgency, category,
 * intent, priority, or any judgement. If a value is not structurally present it
 * is absent (`[]` / `null`) and the `status` reflects that. No LLM calls, no
 * `Date.now()` / randomness; the function is pure and total (never throws —
 * any internal failure collapses to `EMPTY_DECISION_CONTEXT`).
 *
 * The currency grammar is imported from the CQE single source of truth
 * (`CURRENCY_SYMBOL_SOURCE`) rather than duplicated locally — see the
 * row-7 lesson (PR #192) where locally-duplicated currency/number grammar
 * drifted from CQE across four review rounds.
 */

import {
  DecisionContextSchema,
  EMPTY_DECISION_CONTEXT,
  type DecisionContext,
} from '@talchain/schemas/orchestrator';

import { CURRENCY_SYMBOL_SOURCE, NUMERIC_SUFFIX_SOURCE } from '../context/cqe/rules.js';

// Sensible caps so a pathological brief/graph cannot bloat the projection.
const MAX_MONETARY_FIGURES = 8;
const MAX_NAMED_ENTITIES = 12;
// Defensive length cap on the single timeline surface string.
const TIMELINE_MAX_LEN = 40;

// Money matcher composed from the CQE single-source grammar (imported, never
// duplicated locally — the PR #192 row-7 lesson): a currency symbol, a number
// (with optional thousands separators / decimals), and an optional magnitude
// suffix. Global + case-insensitive so every occurrence is collected; the
// matched surface is kept close to verbatim. Conservative by construction —
// only currency-SYMBOL amounts match, so counts and percentages never do.
//
// The integer part is `\d(?:[\d,]*\d)?` — it MUST end on a digit, so a trailing
// separator from prose ("£2,000, or...") is not captured (the match is
// "£2,000", not "£2,000,"). This keeps the sanitised-anchor contract intact.
const MONEY_RE = new RegExp(
  String.raw`(?:${CURRENCY_SYMBOL_SOURCE})\s?\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:${NUMERIC_SUFFIX_SOURCE})?`,
  'gi',
);

// Defensive guard: entity labels must never be raw internal IDs. Labels should
// already be human text, but we drop anything id-shaped just in case.
const LOOKS_LIKE_ID_RE = /^(?:opt|fac|goal|node|edge|risk|con|out|dec|act)_[\w:-]+$/i;

/**
 * Conservative, EXPLICIT timeline tokens only. We deliberately do NOT match a
 * bare four-digit number (e.g. `$2000`) as a year, and we never infer urgency,
 * seasonality, or a planning horizon from vague language ("soon", "urgent",
 * "long term"). Non-global so `.exec` returns the first match; we pick the
 * earliest-occurring match across patterns for determinism.
 */
const TIMELINE_PATTERNS: readonly RegExp[] = [
  // Quarter, optionally with an explicit year: "Q3", "Q3 2026".
  /\bQ[1-4]\b(?:\s*20\d{2})?/i,
  // Month name with an EXPLICIT calendar anchor (a day and/or a year). A bare
  // month name is NOT matched: "May"/"March"/"August" are ordinary English
  // words ("we may hire ...") and matching them would invent a timeline.
  // Matches "March 2026", "March 15", "March 15, 2026".
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?|20\d{2})\b/i,
  // Explicit year only in an unambiguous date-cue context: "by 2026".
  /\b(?:by|in|before|after|until|due(?:\s+by)?|end of)\s+20\d{2}\b/i,
  // Explicit duration: "6 months", "2 weeks", "1 year", "3 quarters", "30 days".
  /\b\d{1,3}\s*(?:days?|weeks?|months?|quarters?|years?)\b/i,
  // Explicit named deadline period.
  /\b(?:end of (?:the )?(?:year|quarter|month)|year[- ]end|quarter[- ]end|month[- ]end)\b/i,
];

/**
 * Derive a typed `DecisionContext` v1 from canonical state. Pure + total.
 *
 * @param briefText persisted `scenarios.brief_text` (null on the first draft
 *   turn — the turn that writes it — or when no brief is persisted).
 * @param rawGraph persisted `scenarios.graph` (parsed defensively as GraphV3;
 *   null / unparseable → no graph-derived anchors).
 */
export function deriveDecisionContext(
  briefText: string | null,
  rawGraph: unknown | null,
): DecisionContext {
  try {
    const brief = typeof briefText === 'string' ? briefText : null;
    if ((brief === null || brief.trim() === '') && rawGraph == null) {
      return EMPTY_DECISION_CONTEXT;
    }

    const monetary_figures = extractMonetaryFigures(brief);
    const timeline = extractTimeline(brief);
    const { named_entities, user_scale_metric, user_scale_target } =
      extractGraphAnchors(rawGraph);

    const candidate: DecisionContext = {
      domain_anchors: { monetary_figures, timeline, named_entities },
      goal_translation: { user_scale_metric, user_scale_target },
      status: deriveStatus({
        monetary_figures,
        timeline,
        named_entities,
        user_scale_metric,
        user_scale_target,
      }),
    };

    // Self-validate against the package schema; on any drift, degrade safely.
    const parsed = DecisionContextSchema.safeParse(candidate);
    return parsed.success ? parsed.data : EMPTY_DECISION_CONTEXT;
  } catch {
    return EMPTY_DECISION_CONTEXT;
  }
}

// ---------------------------------------------------------------------------
// Brief-derived anchors
// ---------------------------------------------------------------------------

function extractMonetaryFigures(briefText: string | null): string[] {
  if (!briefText) return [];
  const matches = briefText.match(MONEY_RE) ?? [];
  return sanitiseList(
    matches.map((m) => m.trim()),
    MAX_MONETARY_FIGURES,
  );
}

function extractTimeline(briefText: string | null): string | null {
  if (!briefText) return null;
  let earliest: { index: number; text: string } | null = null;
  for (const pattern of TIMELINE_PATTERNS) {
    const match = pattern.exec(briefText);
    if (!match) continue;
    const text = match[0].trim();
    if (text === '') continue;
    if (earliest === null || match.index < earliest.index) {
      earliest = { index: match.index, text };
    }
  }
  if (earliest === null) return null;
  return earliest.text.slice(0, TIMELINE_MAX_LEN);
}

// ---------------------------------------------------------------------------
// Graph-derived anchors (structured labels only)
// ---------------------------------------------------------------------------

// Permissive, label-only read. A projection of node labels does NOT need full
// GraphV3 validation, and an all-or-nothing strict parse would drop EVERY
// graph anchor when a persisted graph carries an otherwise-usable node next to
// a single nullable/legacy field. We read `nodes[].{kind,label,goal_threshold_*}`
// defensively from the raw persisted JSON, extracting what is structurally
// present and degrading to empties otherwise. Still pure projection — these are
// declared, structured fields, not inferred ones.
interface RawGraphNode {
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly goal_threshold_raw?: unknown;
  readonly goal_threshold_unit?: unknown;
}

function readGraphNodes(rawGraph: unknown | null): RawGraphNode[] {
  if (!rawGraph || typeof rawGraph !== 'object') return [];
  const nodes = (rawGraph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((n): n is RawGraphNode => n !== null && typeof n === 'object');
}

function nodeLabel(node: RawGraphNode): string | null {
  return typeof node.label === 'string' && node.label.trim() !== ''
    ? node.label.trim()
    : null;
}

function extractGraphAnchors(rawGraph: unknown | null): {
  named_entities: string[];
  user_scale_metric: string | null;
  user_scale_target: string | null;
} {
  const empty = {
    named_entities: [] as string[],
    user_scale_metric: null as string | null,
    user_scale_target: null as string | null,
  };
  const nodes = readGraphNodes(rawGraph);
  if (nodes.length === 0) return empty;

  const optionLabels = nodes
    .filter((n) => n.kind === 'option')
    .map(nodeLabel)
    .filter((l): l is string => l !== null);
  const goalNode = nodes.find((n) => n.kind === 'goal');
  const goalLabel = goalNode ? nodeLabel(goalNode) : null;

  const named_entities = sanitiseList(
    goalLabel ? [...optionLabels, goalLabel] : optionLabels,
    MAX_NAMED_ENTITIES,
  );

  const user_scale_target =
    goalNode && typeof goalNode.goal_threshold_raw === 'number'
      ? formatTarget(
          goalNode.goal_threshold_raw,
          typeof goalNode.goal_threshold_unit === 'string'
            ? goalNode.goal_threshold_unit
            : undefined,
        )
      : null;

  return { named_entities, user_scale_metric: goalLabel, user_scale_target };
}

function formatTarget(raw: number, unit: string | undefined): string {
  const u = typeof unit === 'string' ? unit.trim() : '';
  return u ? `${raw} ${u}` : String(raw);
}

// ---------------------------------------------------------------------------
// Status + sanitisation
// ---------------------------------------------------------------------------

/**
 * Deterministic status (schema author's staging): `not_populated` when nothing
 * was grounded; `populated` only when monetary figures, ≥1 entity, and a goal
 * metric or target are all present; otherwise `partial`.
 */
function deriveStatus(anchors: {
  monetary_figures: readonly string[];
  timeline: string | null;
  named_entities: readonly string[];
  user_scale_metric: string | null;
  user_scale_target: string | null;
}): DecisionContext['status'] {
  const hasMoney = anchors.monetary_figures.length > 0;
  const hasTimeline = anchors.timeline !== null;
  const hasEntities = anchors.named_entities.length > 0;
  const hasMetric = anchors.user_scale_metric !== null;
  const hasTarget = anchors.user_scale_target !== null;

  if (!hasMoney && !hasTimeline && !hasEntities && !hasMetric && !hasTarget) {
    return 'not_populated';
  }
  const fullyGrounded = hasMoney && hasEntities && (hasMetric || hasTarget);
  return fullyGrounded ? 'populated' : 'partial';
}

/**
 * Trim, drop empties + id-shaped tokens, de-duplicate case-insensitively
 * (first occurrence wins — deterministic source order preserved), and cap.
 */
function sanitiseList(values: readonly string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;
    if (LOOKS_LIKE_ID_RE.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}
