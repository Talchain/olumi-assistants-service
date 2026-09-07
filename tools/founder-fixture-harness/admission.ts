/**
 * Reading `analysis_ready.analysis_admission` off the wire.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ ABSENCE IS NOT REFUSAL, AND GETTING THAT BACKWARDS SCORES AN OLD PRODUCER
 * AS A PASS.
 *
 * The producer's own contract (`src/schemas/analysis-ready.ts`) says it in
 * terms: "ABSENCE means a pre-`analysis_admission` producer, never 'no' — fall
 * back to existing behaviour, exactly as with `may_run`." The UI honours that:
 * `licensesComparativeLeaderClaim` returns TRUE on null.
 *
 * So a harness that treated a missing admission as "not licensed" would report
 * C1 PASS against a CEE too old to carry the field — a green light from an
 * instrument reading nothing. Every reader here therefore returns an explicit
 * `absent` and the criteria turn that into NOT_ASSESSED, never a verdict.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ AND THE TWO PERMISSIONS ARE DIFFERENT QUESTIONS (CLAUDE.md trap 21).
 * `analysis_admission.permitted_analysis_mode` asks whether THE MODEL licenses
 * a leader claim. `analysis_state.leader_claim.permitted` asks whether THIS
 * RESULT separated the arms. Their absence arms are deliberately OPPOSITE —
 * the first defaults open, the second defaults closed — so a shared default
 * would be the defect. They are read by two functions here and never merged.
 */

import {
  ANALYSIS_MODE_RANK,
  modePermitsAtLeast,
  type PermittedAnalysisMode,
} from '../../src/orchestrator-v5/admission/analysis-admission.js';
import type { WireBody } from '../golden-journey-harness/observation.js';
import { blocksOfType } from './payload-scan.js';

export interface AdmissionReason {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export type AdmissionRead =
  | { readonly kind: 'absent'; readonly why: string }
  | {
      readonly kind: 'present';
      readonly structurally_analysable: boolean;
      readonly semantic_quality_sufficient: boolean;
      readonly permitted_analysis_mode: PermittedAnalysisMode;
      readonly reasons: readonly AdmissionReason[];
      readonly graph_hash: string | null;
    };

/** The four members a reason may name. Imported from the producer, never re-listed. */
export const ADMISSION_FIELDS: readonly string[] = Object.freeze([
  'structurally_analysable',
  'missing_important_inputs',
  'semantic_quality_sufficient',
  'permitted_analysis_mode',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function readAdmission(body: WireBody | undefined): AdmissionRead {
  const ar = (body as Record<string, unknown> | undefined)?.analysis_ready;
  if (!isRecord(ar)) {
    return { kind: 'absent', why: 'no analysis_ready on this turn' };
  }
  const adm = ar.analysis_admission;
  if (!isRecord(adm)) {
    return {
      kind: 'absent',
      why: 'analysis_ready present but analysis_admission absent — a pre-admission producer. Absence is not refusal.',
    };
  }
  const mode = adm.permitted_analysis_mode;
  if (typeof mode !== 'string' || !(mode in ANALYSIS_MODE_RANK)) {
    return {
      kind: 'absent',
      why: `analysis_admission present but permitted_analysis_mode=${JSON.stringify(mode)} is not a member of the producer's lattice`,
    };
  }
  const reasons: AdmissionReason[] = Array.isArray(adm.reasons)
    ? adm.reasons.flatMap((r) =>
        isRecord(r)
          ? [
              {
                field: typeof r.field === 'string' ? r.field : '',
                code: typeof r.code === 'string' ? r.code : '',
                message: typeof r.message === 'string' ? r.message : '',
              },
            ]
          : [],
      )
    : [];
  return {
    kind: 'present',
    structurally_analysable: adm.structurally_analysable === true,
    semantic_quality_sufficient: adm.semantic_quality_sufficient === true,
    permitted_analysis_mode: mode as PermittedAnalysisMode,
    reasons,
    graph_hash: typeof adm.graph_hash === 'string' ? adm.graph_hash : null,
  };
}

/**
 * Does the MODEL license a comparative-leader claim?
 *
 * Rank comparison via the producer's own `modePermitsAtLeast`, never a string
 * test: the lattice's own docstring warns that a new member silently reads as
 * the weakest under `===`.
 */
export function licensesComparativeLeader(read: AdmissionRead): boolean | 'unknown' {
  if (read.kind === 'absent') return 'unknown';
  return modePermitsAtLeast(read.permitted_analysis_mode, 'comparative_leader');
}

/** Does this turn's admission REFUSE? A refusal is what C2 is about. */
export function admissionRefuses(read: AdmissionRead, body: WireBody | undefined): boolean | 'unknown' {
  const status = ((body as Record<string, unknown> | undefined)?.analysis_ready as
    | Record<string, unknown>
    | undefined)?.status;
  if (read.kind === 'absent') {
    // `blocked` is the older, coarser carrier and still decides a refusal.
    return status === 'blocked' ? true : 'unknown';
  }
  return read.permitted_analysis_mode === 'none' || read.structurally_analysable === false || status === 'blocked';
}

/**
 * The OTHER question: did THIS RESULT separate the arms?
 * Absent ⇒ false (fail-closed) — the opposite default from the one above, and
 * deliberately so. Kept in its own function so the two can never share a
 * default by accident.
 */
export function resultSeparatesArms(body: WireBody | undefined): boolean {
  const st = (body as Record<string, unknown> | undefined)?.analysis_state;
  if (!isRecord(st)) return false;
  const lc = st.leader_claim;
  if (!isRecord(lc)) return false;
  return lc.permitted === true;
}

/** `analysis_ready.current_graph_hash` — the 16-hex freshness token. */
export function currentGraphHash(body: WireBody | undefined): string | undefined {
  const ar = (body as Record<string, unknown> | undefined)?.analysis_ready;
  if (!isRecord(ar)) return undefined;
  const v = ar.current_graph_hash;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * ⚠ NEVER STRING-EQUAL `analysis_admission.graph_hash` (64-hex) WITH
 * `freshness.current_graph_hash` (16-hex). The schema says so in terms: "same
 * projection, different truncation". This helper compares only like with like,
 * and is the single place either hash is compared.
 */
export function sameHash(a: string | undefined, b: string | undefined): boolean | 'unknown' {
  if (a === undefined || b === undefined) return 'unknown';
  if (a.length !== b.length) return 'unknown';
  return a === b;
}

/**
 * True when the turn carries a completed analysis result.
 * Reads the WIRE discriminant (`type`), via `blocksOfType` — see the header of
 * `payload-scan.ts` for why `block_type` would read zero on every real turn.
 */
export function carriesAnalysisResult(body: WireBody | undefined): boolean {
  if (blocksOfType(body, 'analysis_result').length > 0) return true;
  const ar = (body as Record<string, unknown> | undefined)?.analysis_ready;
  return isRecord(ar) && ar.status === 'ready' && Array.isArray(ar.options) && ar.options.length > 0;
}

/**
 * The WIRE `graph_patch` block.
 *
 * ⚠ TWO `status` ENUMS, ONE NAME — and only one of them decides C5.
 * `src/orchestrator/types.ts` `GraphPatchBlockData.status` is
 * `proposed|accepted|dismissed|rejected` (the orchestrator-internal patch
 * lifecycle). The BOUNDARY block's `status` is `applied|noop`, alongside
 * `operation`, `target_id`, `before` and `after`. It is the boundary one that
 * says whether the correction REACHED THE OBJECT, and it is the one below.
 *
 * `noop` is the exact shape of "the edit ran and changed nothing" while the
 * turn still looks successful — `src/orchestrator-v5/tools/fact-noop.ts`:
 * "'noop' must never be rendered as 'applied'".
 */
export interface WireGraphPatch {
  readonly index: number;
  readonly status: string | undefined;
  readonly operation: string | undefined;
  readonly target_id: string | undefined;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

export function readGraphPatches(body: WireBody | undefined): readonly WireGraphPatch[] {
  return blocksOfType(body, 'graph_patch').map(({ index, block }) => {
    const scope = isRecord(block.data) ? (block.data as Record<string, unknown>) : block;
    return {
      index,
      status: typeof scope.status === 'string' ? scope.status : undefined,
      operation: typeof scope.operation === 'string' ? scope.operation : undefined,
      target_id: typeof scope.target_id === 'string' ? scope.target_id : undefined,
      before: isRecord(scope.before) ? scope.before : null,
      after: isRecord(scope.after) ? scope.after : null,
    };
  });
}

/** Top-level `graph_hash`, the second durability signal beside `current_graph_hash`. */
export function topLevelGraphHash(body: WireBody | undefined): string | undefined {
  const v = (body as Record<string, unknown> | undefined)?.graph_hash;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
