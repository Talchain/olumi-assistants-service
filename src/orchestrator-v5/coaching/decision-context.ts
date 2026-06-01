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

// Count caps: how MANY anchors of each kind we retain.
const MAX_MONETARY_FIGURES = 8;
const MAX_NAMED_ENTITIES = 12;
// Per-anchor SIZE caps (chars). A single graph label or money match can be
// arbitrarily long and `DecisionContextSchema` imposes no string limits, so we
// hard-bound every stored anchor to prevent bloat / prompt-like abuse.
const MONETARY_MAX_LEN = 40;
const ENTITY_MAX_LEN = 80;
const METRIC_MAX_LEN = 80;
const TARGET_MAX_LEN = 48;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Defensive guard: entity / metric anchors must never be raw internal IDs.
 * Node labels are human text, but a malformed or abusive graph could place an
 * id-shaped string in a label field. Intentionally broad — catches UUIDs, long
 * hex blobs, underscore/colon identifiers, hyphen-number forms, and compact
 * letter+digit tokens (`n1`, `opt_3`, `node:1`, `factor-2`, `e12`).
 *
 * A token containing ANY whitespace is treated as human text (real option /
 * goal labels are phrases) — that is what keeps legitimate multi-word labels
 * from being filtered.
 *
 * IMPORTANT: applied to entities / metric ONLY, never to `monetary_figures` —
 * money like `£2m` / `$500k` is legitimately a letters+digits token and must
 * not be dropped.
 */
function looksLikeId(value: string): boolean {
  if (/\s/.test(value)) return false; // whitespace → human text, not an ID
  if (UUID_RE.test(value)) return true;
  if (/^[0-9a-f]{16,}$/i.test(value)) return true; // long hex blob
  if (/[_:]/.test(value)) return true; // opt_3, node:1
  if (/-\d/.test(value)) return true; // factor-2
  if (/[a-z]/i.test(value) && /\d/.test(value)) return true; // n1, opt3, e12
  return false;
}

/** Hard length bound for a single stored anchor string. */
function capLen(value: string, maxLen: number): string {
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

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
  // Month-first only: "March 2026", "March 15", "March 15, 2026". A day-first
  // form like "15 March 2026" captures the "March 2026" portion (the leading
  // day is not part of the surface); "15 March" with no year is NOT matched.
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
 * @param rawGraph persisted `scenarios.graph` (read permissively for node
 *   labels — see `readGraphNodes`; null / absent → no graph-derived anchors).
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
  // dropIdLike=false: a currency amount IS a letters+digits token, so the
  // id-filter must never run on money.
  return sanitiseList(
    matches.map((m) => m.trim()),
    MAX_MONETARY_FIGURES,
    MONETARY_MAX_LEN,
    false,
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
    ENTITY_MAX_LEN,
    true,
  );

  const user_scale_metric =
    goalLabel !== null && !looksLikeId(goalLabel)
      ? capLen(goalLabel, METRIC_MAX_LEN)
      : null;

  const user_scale_target =
    goalNode && typeof goalNode.goal_threshold_raw === 'number'
      ? capLen(
          formatTarget(
            goalNode.goal_threshold_raw,
            typeof goalNode.goal_threshold_unit === 'string'
              ? goalNode.goal_threshold_unit
              : undefined,
          ),
          TARGET_MAX_LEN,
        )
      : null;

  return { named_entities, user_scale_metric, user_scale_target };
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
 * Trim, drop empties, optionally drop id-shaped tokens, hard-bound each value's
 * length (`maxLen`), de-duplicate case-insensitively (first occurrence wins —
 * deterministic source order preserved), and cap the count.
 *
 * `dropIdLike` is true for entity anchors (IDs must never leak) and false for
 * monetary figures (a currency amount is itself a letters+digits token).
 */
function sanitiseList(
  values: readonly string[],
  cap: number,
  maxLen: number,
  dropIdLike: boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;
    if (dropIdLike && looksLikeId(trimmed)) continue;
    const bounded = capLen(trimmed, maxLen);
    const key = bounded.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bounded);
    if (out.length >= cap) break;
  }
  return out;
}
