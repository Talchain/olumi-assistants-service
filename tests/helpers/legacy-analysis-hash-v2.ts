/**
 * ⛔ FROZEN — the analysis-affecting projection EXACTLY as served before schemas 0.62.0 (CEE staging `e25d0aa03`,
 * `src/orchestrator-v5/context/graph-hash.ts`, copied byte-for-byte below this header apart from import paths and
 * exported names). TEST-ONLY. Never import it from `src/` production code.
 *
 * WHY IT EXISTS (Shared Data row 1, #72 5881225605; projection version 3). Many specs replay a SERVED capture whose
 * Run fact / admission record carries a hash the product computed with THIS projection. Their precondition — "the
 * served graph IS the run's graph" — is a fidelity proof about the capture, so it must be checked with the projection
 * the capture was recorded under. `rebindRecordedAnalysisHash` does that, and only then returns the hash the CURRENT
 * projection gives the same bytes. No recorded value is edited by hand ("re-recording a baseline" is the trap
 * CLAUDE.md §7 names): a capture that the old projection does not reproduce throws, loudly.
 */
import { createHash } from 'node:crypto';

import { stableStringify } from '../../src/orchestrator/context/stable-stringify.js';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';
import {
  computeAnalysisAffectingGraphHash,
  computeAnalysisAffectingGraphHashSha256,
} from '../../src/orchestrator-v5/context/graph-hash.js';

const HASH_HEX_LENGTH = 16;

/** The 16-hex freshness token under the pre-0.62.0 projection. */
export function legacyAnalysisHashV2(graph: GraphStateIngress | null | undefined): string | null {
  const full = legacyAnalysisHashV2Sha256(graph);
  return full === null ? null : full.slice(0, HASH_HEX_LENGTH);
}

/**
 * Asserts the capture's recorded hash is what the pre-0.62.0 projection gives `graph` (16-hex or 64-hex, matched by
 * length), then returns the CURRENT projection's hash of the same bytes in the same form.
 */
export function rebindRecordedAnalysisHash(graph: unknown, recorded: string): string {
  const g = graph as GraphStateIngress;
  const legacy = recorded.length === 64 ? legacyAnalysisHashV2Sha256(g) : legacyAnalysisHashV2(g);
  if (legacy !== recorded) {
    throw new Error(
      `rebindRecordedAnalysisHash: the capture's recorded hash ${recorded} is NOT the pre-0.62.0 projection of these ` +
        `bytes (${String(legacy)}) — the capture is not the run's graph, or it was recorded under another projection.`,
    );
  }
  const current = recorded.length === 64 ? computeAnalysisAffectingGraphHashSha256(g) : computeAnalysisAffectingGraphHash(g);
  if (current === null) throw new Error('rebindRecordedAnalysisHash: the current projection returned null');
  return current;
}

/**
 * A served capture binds its graph to its Run by EQUAL HASH STRINGS (`graph_hash`, a fact's `graph_hash_at_run`,
 * `computed_against_hash`, …). Proves `recorded` is the pre-0.62.0 projection of `graph` (throws otherwise), then
 * returns a deep copy of `capture` with every occurrence of `recorded` (or of its 64-hex form) — whole strings and
 * substrings of derived ids alike — replaced by the current projection's hash of the same bytes. A hash of some OTHER graph in the capture (a stale Run's) is left
 * alone, so stale stays stale.
 */
export function rebindCapture<T>(capture: T, graph: unknown, recorded: string): T {
  const current16 = rebindRecordedAnalysisHash(graph, recorded.slice(0, HASH_HEX_LENGTH));
  const legacy64 = legacyAnalysisHashV2Sha256(graph as GraphStateIngress);
  const current64 = computeAnalysisAffectingGraphHashSha256(graph as GraphStateIngress);
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') {
      // Substrings too: derived ids embed the hash (`coach:limit_unchecked:<graph_hash>:<computed_at>:…`). The 64-hex
      // form goes first — the 16-hex token is its prefix.
      let out = v;
      if (legacy64 !== null && current64 !== null) out = out.split(legacy64).join(current64);
      return out.split(recorded.slice(0, HASH_HEX_LENGTH)).join(current16);
    }
    if (Array.isArray(v)) return v.map(swap);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, swap(x)]));
    }
    return v;
  };
  return swap(capture) as T;
}

// ── frozen copy (e25d0aa03) ─────────────────────────────────────────────────────────────────────────────────────────
export function legacyAnalysisHashV2Sha256(
  graph: GraphStateIngress | null | undefined,
): string | null {
  if (!graph) return null;

  const nodes = graph.nodes;
  const edges = graph.edges;
  const options = (graph as { options?: unknown }).options;
  const goalNodeId = (graph as { goal_node_id?: unknown }).goal_node_id;
  const goalConstraints = (graph as { goal_constraints?: unknown }).goal_constraints;

  if (
    nodes.length === 0 &&
    edges.length === 0 &&
    !Array.isArray(options) &&
    goalNodeId === undefined
  ) {
    return null;
  }

  const canonical = stableStringify({
    nodes: nodes.map(projectNode).sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map(projectEdge)
      .sort((a, b) => {
        const fromCmp = a.from.localeCompare(b.from);
        return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
      }),
    options: Array.isArray(options)
      ? options.map(projectOption).sort((a, b) => a.id.localeCompare(b.id))
      : [],
    goal_node_id: typeof goalNodeId === 'string' ? goalNodeId : null,
    goal_constraints: Array.isArray(goalConstraints) ? goalConstraints : [],
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function pickDefined<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  keys: readonly string[],
): T {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function projectObservedState(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return pickDefined(raw as Record<string, unknown>, ['value', 'baseline', 'cap']);
}

function projectPrior(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return pickDefined(raw as Record<string, unknown>, [
    'distribution',
    'range_min',
    'range_max',
  ]);
}

/**
 * `RawInterventionValue` admits `number | string | boolean`, so one quantity can
 * arrive spelled two ways (`95000` and `"95000"`). Two spellings of the SAME
 * figure must hash alike, or the product reports a change nobody made.
 *
 * ⚠ NUMERIC STRINGS ONLY, AND ONLY ON AN EXACT ROUND TRIP. A categorical raw
 * is a CODE, not a magnitude (`"UK"`, `"enterprise"`), and coercing one would
 * either produce `NaN` or collapse two categories into one identity. Anything
 * that does not round-trip is preserved verbatim.
 */
function normaliseRawValueForIdentity(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed === '') return raw;
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) && String(asNumber) === trimmed ? asNumber : raw;
}

function projectIntervention(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (r.value !== undefined) out.value = r.value;
  if (r.value_type !== undefined) out.value_type = r.value_type;
  if (r.encoding_map !== undefined) out.encoding_map = r.encoding_map;
  // ⭐ THE NATIVE QUANTITY AND ITS UNIT — in the identity because a consumer
  // reads them for a DISPLAYED verdict.
  //
  // Measured before this line existed, with a live positive control in the
  // same run: an option's `raw_value` moving 95,000 -> 250,000 produced a
  // BYTE-IDENTICAL hash (`d4384a59464a5724` both times), while a `value`
  // change 0.7 -> 0.85 moved it. So a cost could cross a £200,000 limit and
  // the product would still report the stored analysis as current.
  //
  // Tolerable only while nothing consumes the native. A limit check does, so
  // the identity has to account for it BEFORE that consumer is enabled rather
  // than after — otherwise the freshness line on screen is asserting over a
  // verdict it cannot see change.
  //
  // ⚠ ONE-TIME COST, DISCLOSED: a stored graph already carrying `raw_value`
  // hashes differently from here on, so those scenarios read STALE once. That
  // is the honest direction; they were being called fresh on an identity that
  // ignored a real field.
  //
  // ⚠⚠ `unit` ENTERS ONLY BESIDE A NATIVE VALUE, AND THE EXISTING SPEC IS WHY.
  // `graph-hash.test.ts` asserts "intervention unit / source / reasoning /
  // display_value / target_match.confidence → hash unchanged", and that
  // decision is CORRECT for the encoded case it was written for: beside an
  // encoded `value: 100`, the unit is metadata ABOUT the number the engine
  // computes on, so GBP→USD changes no result. Beside a NATIVE `raw_value` the
  // unit is part of the quantity itself — 95,000 GBP and 95,000 USD are
  // different amounts to a limit check. Two meanings of one field name
  // (trap 21), so the projection distinguishes them rather than overriding the
  // older rule. A unit with no native beside it still hashes to nothing.
  if (r.raw_value !== undefined) {
    out.raw_value = normaliseRawValueForIdentity(r.raw_value);
    if (r.unit !== undefined) out.unit = r.unit;
  }
  if (r.target_match && typeof r.target_match === 'object') {
    const tm = r.target_match as Record<string, unknown>;
    if (tm.node_id !== undefined) out.target_match = { node_id: tm.node_id };
  }
  return out;
}

function projectInterventionRecord(
  raw: unknown,
): Record<string, Record<string, unknown> | undefined> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, Record<string, unknown> | undefined> = {};
  for (const factorId of Object.keys(r)) {
    const projected = projectIntervention(r[factorId]);
    if (projected !== undefined) out[factorId] = projected;
  }
  return out;
}

interface NodeProjection {
  id: string;
  [key: string]: unknown;
}

function projectNode(raw: unknown): NodeProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: NodeProjection = { id: typeof r.id === 'string' ? r.id : '' };

  for (const key of [
    'kind',
    'category',
    'factor_type',
    'is_baseline',
    'goal_threshold',
    'goal_threshold_raw',
    'goal_threshold_cap',
    'intercept',
    'encoding_map',
    // C46 (#1972): the declaration the leader withhold is judged on. In the identity so `fresh` means the run's own
    // carrier; absent on every graph before #1972, so no stored graph changes hash.
    'nonlinear_identity',
  ] as const) {
    if (r[key] !== undefined) out[key] = r[key];
  }

  const observed = projectObservedState(r.observed_state);
  if (observed !== undefined && Object.keys(observed).length > 0) {
    out.observed_state = observed;
  }

  const prior = projectPrior(r.prior);
  if (prior !== undefined && Object.keys(prior).length > 0) {
    out.prior = prior;
  }

  const interventions = projectInterventionRecord(r.interventions);
  if (interventions !== undefined && Object.keys(interventions).length > 0) {
    out.interventions = interventions;
  }

  return out;
}

interface EdgeProjection {
  from: string;
  to: string;
  [key: string]: unknown;
}

function projectEdge(raw: unknown): EdgeProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: EdgeProjection = {
    from: typeof r.from === 'string' ? r.from : '',
    to: typeof r.to === 'string' ? r.to : '',
  };

  if (r.edge_type !== undefined) out.edge_type = r.edge_type;
  if (r.exists_probability !== undefined) out.exists_probability = r.exists_probability;
  if (r.effect_direction !== undefined) out.effect_direction = r.effect_direction;

  if (r.strength && typeof r.strength === 'object') {
    const s = r.strength as Record<string, unknown>;
    const strength: Record<string, unknown> = {};
    if (s.mean !== undefined) strength.mean = s.mean;
    if (s.std !== undefined) strength.std = s.std;
    if (Object.keys(strength).length > 0) out.strength = strength;
  }

  return out;
}

interface OptionProjection {
  id: string;
  [key: string]: unknown;
}

function projectOption(raw: unknown): OptionProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: OptionProjection = { id: typeof r.id === 'string' ? r.id : '' };

  if (r.status !== undefined) out.status = r.status;
  if (r.is_baseline !== undefined) out.is_baseline = r.is_baseline;

  const interventions = projectInterventionRecord(r.interventions);
  if (interventions !== undefined && Object.keys(interventions).length > 0) {
    out.interventions = interventions;
  }

  // Only include raw_interventions when option is not yet ready — that signals
  // the encoding state still affects analysis preconditions.
  if (r.status !== 'ready' && r.raw_interventions && typeof r.raw_interventions === 'object') {
    out.raw_interventions = r.raw_interventions;
  }

  return out;
}
