/**
 * ROADMAP 2.989 (wave-1 Lane A, PR2 — the scientific reasoning loop).
 *
 * THE HIGHEST-VALUE ISSUE TO RESOLVE NEXT, selected deterministically from the
 * run's own robustness output. Pure: no I/O, no LLM, no clock, no config read —
 * a total function of one `enrichment` object, exactly like `selectLens`, so it
 * can be replayed over a captured enrichment and give the same answer.
 *
 * WHY EDGE FRAGILITY AND NOT VALUE-OF-INFORMATION. Measured reachability over
 * the 56-turn census: `robustness.fragile_edges` and `edge_e_values` are present
 * 56/56 (100%), against 9/56 for a value-of-information selection, 0/56 for
 * `evpi_percentage_points > 0` and 0/56 for a non-null `flip_thresholds.flip_value`.
 * Corroborated inside this repo at `compose.ts:622` (top-level `edge_e_values`
 * non-empty in 773/773 non-noop `run_analysis` turns). VoI is a tier when it
 * resolves; it is never the trigger.
 *
 * ── ⚠ THE JOIN TRAP. READ THIS BEFORE CHANGING ANY LOOKUP HERE ───────────────
 * `robustness.fragile_edges[].edge_id` and `edge_e_values[].edge_id` USE
 * DIFFERENT SEPARATORS for the same edge:
 *     fragile_edges  →  "fac_partner_invest->out_new_arr"   (ASCII arrow)
 *     edge_e_values  →  "fac_partner_invest::out_new_arr"   (double colon)
 * Measured on the two committed live captures
 * (`compose/__tests__/fixtures/dsk-walk/*.enrichment.json`):
 *     join by edge_id string   →  0 of 11  and  0 of 7
 *     join by (from_id,to_id)  →  7 of 11  and  5 of 7
 * An `edge_id` join therefore returns EMPTY, which is indistinguishable from
 * "this run has no e-value data" — so the honest-empty arm would fire on every
 * turn while the census says the data is present 56/56. Undiscriminated output
 * looks exactly like a real result (CLAUDE.md trap 20).
 * **BINDING: join by `(from_id, to_id)`. Never by `edge_id`.** Pinned by the
 * 0-vs-7 arity test in `__tests__/select-fragile-edge.test.ts`.
 *
 * ── WHAT THIS MODULE MAY AND MAY NOT SAY ─────────────────────────────────────
 * `edge_e_values` is a RATIFIED TIER-3 DENY FIELD (`compose/claim-safety-cage.ts`
 * `TIER3_LEAK_BLOCK_FIELDS`). Every quantity this module reads from it —
 * `e_value`, `current_mean`, `flip_mean`, `flip_direction`, the `stability`
 * band — is used ONLY as a STRUCTURED GATE (does this edge join? is its band
 * degenerate?) and is NEVER returned for prose. That is why the selection type
 * below carries the edge's LABELS and its identity and no e-value quantity at
 * all: a field the cage denies cannot be surfaced, so it is not carried where a
 * future caller could surface it by accident. This module's entry in the
 * Tier-3 static guard's allow-list is classified `structured` for that reason.
 *
 * ── PRIORITY COMES FROM THE PRODUCER METRIC, NOT ARRIVAL ORDER ────────────────
 * The estate has measured committed `fragile_edges` arrays that are not sorted,
 * including one staging capture. The canonical shared selector therefore puts
 * the maximum finite producer `switch_probability` first; strict `>` preserves
 * producer order on ties, and the head is used only when no finite metric exists.
 * If that row cannot be acted on, the established fail-soft scan may still find
 * another eligible relationship, but user copy makes no unsupported superlative.
 */

import { orderMostSensitiveRows } from '../../orchestrator/shared/fragile-edge-authority.js';

/** Why no edge was selected. Closed enum — the telemetry payload's `refusal_reason`. */
export type FragileEdgeRefusalReason =
  /** The producer emitted no fragile edges at all (or no robustness object). */
  | 'no_fragile_edges'
  /** Rows exist but none carries the `(from_id, to_id)` identity a join needs. */
  | 'no_edge_identity'
  /** The candidate has no matching `edge_e_values` row, so there is no stability evidence. */
  | 'no_e_value_join'
  /** The candidate's 10-seed band is degenerate (flipped on none of the seeds, or on all of them). */
  | 'degenerate_stability_band'
  /** The candidate's SOURCE factor was computed from degenerate-fallback inputs. */
  | 'degenerate_input_quality'
  /**
   * The candidate carries no USABLE mutation target: `current_mean` or
   * `flip_mean` is absent/non-finite, or `flip_mean` lies outside the settable
   * edge-strength domain. See {@link FragileEdgeSelection.flipMean}.
   */
  | 'no_usable_flip_target';

/** The stability band's usability class. Closed enum — the telemetry payload. */
export type FragileEdgeStabilityBand = 'degenerate' | 'usable';

/**
 * The one selected edge. Identity-bearing and label-bearing; deliberately
 * quantity-FREE (see the Tier-3 note in the module header).
 */
export interface FragileEdgeSelection {
  readonly fromId: string;
  readonly toId: string;
  /**
   * The composite the graph-edit path accepts: `${fromId}→${toId}`.
   * `tools/handlers/adjust-edge-strength.ts::parseEdgeId` accepts `→` or `->`
   * and REJECTS `::`, which is why this is composed from the endpoint pair
   * rather than copied from either producer's `edge_id`.
   */
  readonly edgeIdentity: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  /**
   * ⭐ THE MUTATION QUANTITIES, and the distinction is load-bearing.
   *
   * ⚠ `e_value` IS NOT ONE OF THEM AND IS DELIBERATELY ABSENT FROM THIS TYPE.
   * The shared contract documents it as *"Edge E-value (evidence strength for
   * an edge's causal direction)"* — an EVIDENCE metric, typed `z.ZodNumber`
   * with no bound, and measured at 1.13 / 1.27 / 3.05 / 3.98 on the two live
   * captures. The settable edge strength is bounded `[-1, 1]`
   * (`tools/handlers/adjust-edge-strength.ts` `STRENGTH_CLAMP_MIN/MAX`), so an
   * E-value of 3.98 is not a strength at all — offering it as one would clamp
   * silently to 1.0 and mutate the graph to a number nothing computed. It is
   * therefore not carried here at all: a quantity absent from the type cannot
   * be substituted for the target by a later caller.
   *
   * `currentMean` is where the edge is now; `flipMean` is the strength at which
   * this run's sweep saw the ranking change. Both are STRUCTURED and are never
   * surfaced in prose (`edge_e_values` is a ratified Tier-3 deny field) — they
   * exist so the ACTION the loop offers is bound to a producer-authored
   * quantity rather than to an invented one, and so a run that carries no
   * usable target REFUSES instead of substituting.
   */
  readonly currentMean: number;
  readonly flipMean: number;
  /** ISL-owned open vocabulary (live V2 emits `increase` / `decrease`). */
  readonly flipDirection: string | null;
}

/**
 * The decision, BOTH ARMS. One value covers `selected` and `refused` so the
 * caller emits one telemetry event either way (kin: `selectLens`'s
 * may-recommend-nothing default, which is a first-class outcome and not a
 * fallthrough).
 */
export interface FragileEdgeDecision {
  /** The chosen edge, or `null` — the honest empty. */
  readonly selected: FragileEdgeSelection | null;
  /**
   * Present exactly when `selected === null`. The reason the FIRST
   * identity-bearing candidate in canonical metric-first order was rejected.
   * `no_fragile_edges` / `no_edge_identity` describe the whole input rather
   * than one row.
   */
  readonly refusalReason: FragileEdgeRefusalReason | null;
  /**
   * Did the row this decision is ABOUT (the selected one, or the first
   * identity-bearing candidate when refusing) join an `edge_e_values` row?
   */
  readonly eValueJoined: boolean;
  /** That same row's band class; `null` when it did not join. */
  readonly stabilityBand: FragileEdgeStabilityBand | null;
}

// ============================================================================
// Defensive reads. A missing/ill-typed field becomes absent, never a default.
// ============================================================================

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The endpoint pair, or `null` when either side is absent (never a half identity). */
function readEndpointPair(row: Record<string, unknown>): { from: string; to: string } | null {
  const from = nonEmptyString(row.from_id);
  const to = nonEmptyString(row.to_id);
  return from !== null && to !== null ? { from, to } : null;
}

/**
 * The degenerate-band rule, stated once. A 10-seed sweep that flipped on NONE
 * of the seeds carries no evidence that this edge can move the result; one that
 * flipped on ALL of them carries no evidence that the current strength is what
 * decides it. Either way the band cannot discriminate, so the edge is not the
 * highest-value thing to resolve. Both arms occur on real data (session-a has
 * `10/10` rows and a `9/10` row), so this gate discriminates rather than merely
 * existing.
 */
function classifyStability(stability: Record<string, unknown> | null): FragileEdgeStabilityBand | null {
  if (stability === null) return null;
  const nSeeds = finiteNumberOrNull(stability.n_seeds);
  const nFlipped = finiteNumberOrNull(stability.n_seeds_flipped);
  if (nSeeds === null || nFlipped === null || nSeeds <= 0) return null;
  return nFlipped === 0 || nFlipped === nSeeds ? 'degenerate' : 'usable';
}

/**
 * ⚠ THE `input_quality` GATE IS A CROSS-ARRAY JOIN, NOT AN EDGE FIELD.
 *
 * ROADMAP 2.989 and the design specify refusing `input_quality:
 * 'degenerate_fallback'`. A complete recursive path enumeration over the live
 * captures returns the key at EXACTLY ONE address:
 *     `factor_sensitivity[].confidence_provenance.input_quality`
 * It is on NEITHER `fragile_edges` NOR `edge_e_values`. Written as an edge-field
 * read it would find `undefined` on every row and pass everything — a guard
 * agreeing with itself (CLAUDE.md trap 13b).
 *
 * So the gate is expressed against the edge's SOURCE factor: the
 * `factor_sensitivity` row whose `factor_id` equals the edge's `from_id`. An
 * edge whose source factor was computed from degenerate-fallback inputs is not
 * a thing to ask the user to act on.
 *
 * ABSENT ⇒ NOT REFUSED, deliberately: `degenerate_fallback` occurs 0 times in
 * either live capture, so a fail-closed reading here would refuse every real
 * run. The refusing arm is exercised by an AUTHORED fixture with a `standard`
 * positive control beside it.
 */
function sourceFactorInputQuality(
  factorSensitivity: readonly unknown[],
  fromId: string,
): string | null {
  for (const raw of factorSensitivity) {
    const row = readRecord(raw);
    if (row === null) continue;
    if (nonEmptyString(row.factor_id) !== fromId) continue;
    const provenance = readRecord(row.confidence_provenance);
    if (provenance === null) return null;
    return nonEmptyString(provenance.input_quality);
  }
  return null;
}

const DEGENERATE_INPUT_QUALITY = 'degenerate_fallback';

/**
 * The settable edge-strength domain. AUTHORITY: `STRENGTH_CLAMP_MIN` /
 * `STRENGTH_CLAMP_MAX` in `tools/handlers/adjust-edge-strength.ts` — the
 * handler that actually performs the mutation. Those constants are not
 * exported and that file belongs to another lane, so these are declared here
 * and kept honest by a DERIVED drift guard that reads the handler's bytes
 * (`__tests__/select-fragile-edge.test.ts`) rather than by anyone remembering
 * to sync them — a hand-kept copy with no alarm is the mirror class.
 */
export const EDGE_STRENGTH_MIN = -1;
export const EDGE_STRENGTH_MAX = 1;

/**
 * Is there a producer-authored target this offer could actually be applied to?
 *
 * ⚠ THE REFUSAL HERE IS THE POINT. `flip_mean` is the only quantity in the
 * enrichment that names a strength this edge could be moved to; an edge whose
 * flip target is missing, non-finite, or outside the settable domain has no
 * honest action attached to it. The temptation this gate exists to block is
 * substituting `e_value` — which is an EVIDENCE metric, routinely above 1, and
 * would be silently clamped by the handler into a number nothing computed.
 * A run with no usable target refuses; it never invents one.
 */
function hasUsableFlipTarget(currentMean: number | null, flipMean: number | null): boolean {
  return (
    currentMean !== null &&
    flipMean !== null &&
    flipMean >= EDGE_STRENGTH_MIN &&
    flipMean <= EDGE_STRENGTH_MAX
  );
}

/** The composite separator the graph-edit path accepts (`parseEdgeId`). */
const EDGE_IDENTITY_SEPARATOR = '→'; // →

/** Compose the `${fromId}→${toId}` identity `parseEdgeId` round-trips. */
export function composeEdgeIdentity(fromId: string, toId: string): string {
  return `${fromId}${EDGE_IDENTITY_SEPARATOR}${toId}`;
}

const NO_CANDIDATE: FragileEdgeDecision = Object.freeze({
  selected: null,
  refusalReason: 'no_fragile_edges',
  eValueJoined: false,
  stabilityBand: null,
});

/**
 * Select the one fragile relationship worth offering to resolve, or refuse.
 *
 * @param enrichment the run's `result.enrichment` object, read defensively.
 */
export function selectFragileEdge(enrichment: unknown): FragileEdgeDecision {
  const root = readRecord(enrichment);
  if (root === null) return NO_CANDIDATE;

  const robustness = readRecord(root.robustness);
  const fragileEdges = readArray(robustness?.fragile_edges);
  if (fragileEdges.length === 0) return NO_CANDIDATE;

  // TOP-LEVEL, not under `robustness` — the two arrays sit at different depths
  // and a `robustness.edge_e_values` read finds nothing (§0.3 of the brief).
  const edgeEValues = readArray(root.edge_e_values);
  const factorSensitivity = readArray(root.factor_sensitivity);

  /** The reason the FIRST identity-bearing candidate in canonical order was rejected. */
  let firstRejection: FragileEdgeDecision | null = null;
  let sawIdentityBearingRow = false;

  // Canonical producer-metric priority across every candidate. An ineligible
  // maximum does not unnecessarily darken a valid lower-priority action. The
  // copy is deliberately non-superlative.
  const prioritised = orderMostSensitiveRows(fragileEdges);
  for (const raw of prioritised) {
    const row = readRecord(raw);
    if (row === null) continue;
    const pair = readEndpointPair(row);
    if (pair === null) continue; // never compose a half identity
    sawIdentityBearingRow = true;

    const fromLabel = nonEmptyString(row.from_label);
    const toLabel = nonEmptyString(row.to_label);

    const match = edgeEValues
      .map(readRecord)
      .find((e) => e !== null && e.from_id === pair.from && e.to_id === pair.to);
    const stabilityBand = classifyStability(match === undefined || match === null ? null : readRecord(match.stability));
    const eValueJoined = match !== undefined && match !== null;

    const reject = (reason: FragileEdgeRefusalReason): void => {
      if (firstRejection === null) {
        firstRejection = { selected: null, refusalReason: reason, eValueJoined, stabilityBand };
      }
    };

    if (!eValueJoined || stabilityBand === null) {
      reject('no_e_value_join');
      continue;
    }
    if (stabilityBand === 'degenerate') {
      reject('degenerate_stability_band');
      continue;
    }
    // The mutation target, from the SAME joined row (endpoint identity), never
    // from `e_value`. See `hasUsableFlipTarget`.
    const currentMean = finiteNumberOrNull(match.current_mean);
    const flipMean = finiteNumberOrNull(match.flip_mean);
    if (!hasUsableFlipTarget(currentMean, flipMean)) {
      reject('no_usable_flip_target');
      continue;
    }
    if (sourceFactorInputQuality(factorSensitivity, pair.from) === DEGENERATE_INPUT_QUALITY) {
      reject('degenerate_input_quality');
      continue;
    }
    // An offer names the relationship in the user's own words. Without BOTH
    // labels there is nothing honest to name it with, so the row is skipped
    // rather than named by id (ids never reach user-facing prose — the
    // `scanProse` entity-id guard would drop the whole block anyway).
    if (fromLabel === null || toLabel === null) {
      reject('no_edge_identity');
      continue;
    }

    return {
      selected: {
        fromId: pair.from,
        toId: pair.to,
        edgeIdentity: composeEdgeIdentity(pair.from, pair.to),
        fromLabel,
        toLabel,
        currentMean: currentMean!,
        flipMean: flipMean!,
        flipDirection: nonEmptyString(match.flip_direction),
      },
      refusalReason: null,
      eValueJoined: true,
      stabilityBand,
    };
  }

  if (firstRejection !== null) return firstRejection;
  return sawIdentityBearingRow
    ? { selected: null, refusalReason: 'no_e_value_join', eValueJoined: false, stabilityBand: null }
    : { selected: null, refusalReason: 'no_edge_identity', eValueJoined: false, stabilityBand: null };
}
