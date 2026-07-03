/**
 * Track 3 — the mutation referee. A PURE function
 *   `(rawEnvelope, currentGraph, frame) → RefereeVerdict`
 * implementing the T4.0 ordered rules R1–R7 (first-failure-wins). The referee
 * NEVER applies a mutation and NEVER re-derives freshness/hash/CAS — it consumes
 * the frame. TOTALITY: any malformed/throwing/unknown input resolves to a
 * CLASSIFIED verdict, never an exception.
 *
 * Verdict policy (fail-closed; §3b/§6 PENDING → held; Paul 2026-07-03):
 *  - rename_node  → would_apply-eligible (R6 non-downgrade; the ONLY would_apply case)
 *  - add_option   → always held (divergence split; NEVER un-held here)
 *  - add_node/add_edge         → held STRUCTURAL_APPLY_HELD (§6 pending)
 *  - update_node/edge_field     → held TUNABLE_APPLY_HELD (§6 pending; no tunable auto-apply)
 *  - remove_node/remove_edge    → held REMOVE_UNCONFIRMED (destructive)
 *  - flag_uncertainty/clarification → clarify_required (never mutate)
 *
 * Import boundary (Paul #1): builds candidates via `applyAndValidateMutation`
 * only; imports NO persistence-merge / hash-derivation / commit / turn-executor
 * module.
 */
import { parseEnvelope } from './parse-envelope.js';
import { evaluateFrameGate } from './frame-gate.js';
import { classifyMutation } from './classify-mutation.js';
import { checkFieldSafety } from './field-safety.js';
import {
  buildRenameCandidate,
  buildAddOptionCandidate,
  currentGraphIsParseable,
  graphHasNodeId,
  graphHasTopLevelOptions,
  graphOptionsAreMalformed,
} from './candidate-graph.js';
import { assessCandidate, representableVerdict } from './readiness-parity.js';
import {
  SCHEMA_INVALID,
  FRAME_UNAVAILABLE,
  BASE_HASH_DIVERGED,
  ANALYSIS_NOT_FRESH,
  CURRENT_GRAPH_UNREADABLE,
  OPTION_ID_COLLISION,
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  GRAPH_OPTIONS_MALFORMED,
  GRAPH_INVARIANT_VIOLATED,
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  READINESS_DOWNGRADE,
  STRUCTURAL_APPLY_HELD,
  TUNABLE_APPLY_HELD,
  REMOVE_UNCONFIRMED,
  CLASSIFY_FAILED,
  type MutationReasonCode,
} from './reason-codes.js';
import { CANDIDATE_KINDS } from './types.js';
import type {
  CandidateKind,
  CandidateMutationEnvelope,
  MutationBlocker,
  MutationFrame,
  RefereeVerdict,
} from './types.js';

/** Best-effort read of `kind` from a raw (possibly invalid) candidate — diagnostics only. */
function bestEffortKind(raw: unknown): CandidateKind | null {
  try {
    const k = (raw as { kind?: unknown } | null)?.kind;
    return typeof k === 'string' && (CANDIDATE_KINDS as readonly string[]).includes(k)
      ? (k as CandidateKind)
      : null;
  } catch {
    return null;
  }
}

/** Fixed, REDACTED readable per field-safety code — never echoes the raw field/value. */
function fieldSafetyReadable(code: MutationReasonCode): string {
  switch (code) {
    case FIELD_NOT_ALLOWED:
      return 'The candidate targets a field it may not set.';
    case PIPELINE_OWNED_FIELD:
      return 'The candidate targets an analysis-derived, pipeline-owned field.';
    case ENGINE_CLAIM_IN_TEXT:
      return 'The candidate carries engine-claim prose (EVPI / flip-point / quantified probability).';
    default:
      return 'Field-safety check failed.';
  }
}

function bestEffortId(raw: unknown): string | null {
  try {
    const id = (raw as { candidate_id?: unknown } | null)?.candidate_id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** The add_option hold reason true for THIS graph (divergence vs apply-unwired). */
function addOptionHoldBlocker(hasTopLevelOptions: boolean): MutationBlocker {
  return hasTopLevelOptions
    ? {
        code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
        readable:
          'A top-level options[] array is present; the persist-base merge keeps it base-only while the new ' +
          'option enters the node-derived set run-analysis reads, so the two views can diverge. Held until the ' +
          'node↔options[] consistency workstream lands (out of scope for this core).',
      }
    : {
        code: ADD_OPTION_APPLY_UNWIRED,
        readable:
          'No top-level options[] array is present; the canonical node↔options[] persist contract is unbuilt. ' +
          'Held pending the node↔options[] consistency workstream (out of scope for this core).',
      };
}

/**
 * Referee a single raw candidate. Returns exactly one classified verdict.
 */
export function refereeMutation(
  raw: unknown,
  currentGraph: unknown,
  frame: MutationFrame | null,
): RefereeVerdict {
  // R1 — schema gate (fail-closed).
  const parsed = parseEnvelope(raw);
  if (!parsed.ok) {
    return {
      verdict: 'rejected',
      kind: bestEffortKind(raw),
      candidate_id: bestEffortId(raw),
      mutation_class: null,
      base_hash_match: false,
      blocker: parsed.blocker,
    };
  }

  const env: CandidateMutationEnvelope = parsed.envelope;
  const kind = env.kind;
  const candidate_id = env.candidate_id;
  const mutation_class = classifyMutation(kind);

  try {
    // R2 — frame / stale gate (consumes the frame; never re-derives).
    const gate = evaluateFrameGate(env.base_graph_hash, frame);
    const base_hash_match = gate.baseHashMatch;
    const meta = { kind, candidate_id, mutation_class, base_hash_match } as const;

    switch (gate.outcome.kind) {
      case 'frame_unavailable':
        return {
          ...meta,
          verdict: 'held',
          blocker: { code: FRAME_UNAVAILABLE, readable: 'No frame available — cannot establish current graph authority.' },
        };
      case 'unreadable':
        return {
          ...meta,
          verdict: 'held',
          blocker: { code: CURRENT_GRAPH_UNREADABLE, readable: 'The frame could not read or hash the current graph.' },
        };
      case 'stale':
        // Both stale reasons carry a machine-readable code (no-silent-outcome contract).
        return {
          ...meta,
          verdict: 'stale',
          blocker:
            gate.outcome.reason === 'base_hash_diverged'
              ? { code: BASE_HASH_DIVERGED, readable: 'The graph has moved since this candidate was generated.' }
              : { code: ANALYSIS_NOT_FRESH, readable: 'The analysis is not current (freshness is not fresh); re-run before applying.' },
        };
      case 'proceed':
        break;
    }

    // R4 — field-safety (allowlist + engine-claim scan on prose AND field values).
    // Runs BEFORE the non-mutating short-circuit so an engine claim smuggled into a
    // flag_uncertainty/clarification `question` (or a producer rationale) is rejected.
    const fs = checkFieldSafety(env);
    if (!fs.ok && fs.code) {
      // Redacted: fixed per-code message, never the raw field/value.
      return { ...meta, verdict: 'rejected', blocker: { code: fs.code, readable: fieldSafetyReadable(fs.code) } };
    }

    // Non-mutating kinds never touch the graph — no current-graph guards apply.
    if (kind === 'flag_uncertainty' || kind === 'clarification') {
      return { ...meta, verdict: 'clarify_required' };
    }

    // Current-graph guards (mutating kinds only):
    //  - a present-but-non-array top-level `options` corrupts the context view
    //    (GraphV3 strips `options`, so a parse check alone won't catch it);
    //  - a base graph that does NOT parse as GraphV3 is an ENVIRONMENTAL hold
    //    (CURRENT_GRAPH_UNREADABLE), not a candidate reject — this distinguishes a
    //    malformed BASE from a genuinely invalid CANDIDATE (both otherwise surface as
    //    GRAPH_INVARIANT_VIOLATED from the apply seam's ingress vs post-mutation parse).
    if (graphOptionsAreMalformed(currentGraph)) {
      return {
        ...meta,
        verdict: 'held',
        blocker: { code: GRAPH_OPTIONS_MALFORMED, readable: 'The current graph top-level `options` is present but not an array (malformed).' },
      };
    }
    if (!currentGraphIsParseable(currentGraph)) {
      return {
        ...meta,
        verdict: 'held',
        blocker: { code: CURRENT_GRAPH_UNREADABLE, readable: 'The current graph is not structurally readable (failed schema validation).' },
      };
    }

    // Per-kind posture (R3 / R5 / R6 / R7).
    switch (kind) {
      case 'rename_node': {
        const built = buildRenameCandidate(currentGraph, {
          node_id: env.payload.node_id,
          to_label: env.payload.to_label,
        });
        if (!built.candidate) {
          // R5 invariant violation → rejected; any other build error → held.
          const code = built.error?.code;
          if (code === GRAPH_INVARIANT_VIOLATED) {
            return { ...meta, verdict: 'rejected', blocker: built.error };
          }
          return { ...meta, verdict: 'held', blocker: built.error };
        }
        const rv = representableVerdict(assessCandidate(currentGraph), assessCandidate(built.candidate));
        if (rv.verdict === 'would_apply') {
          return { ...meta, verdict: 'would_apply', candidate: built.candidate };
        }
        if (rv.verdict === 'clarify_required') {
          return { ...meta, verdict: 'clarify_required', candidate: built.candidate };
        }
        return {
          ...meta,
          verdict: 'held',
          candidate: built.candidate,
          blocker: { code: READINESS_DOWNGRADE, readable: 'This candidate would reduce the graph’s analysis-readiness.' },
        };
      }

      case 'add_option': {
        // R3 — id collision (the structural validator does not dedupe node ids).
        if (graphHasNodeId(currentGraph, env.payload.option.id)) {
          return {
            ...meta,
            verdict: 'held',
            blocker: { code: OPTION_ID_COLLISION, readable: 'The proposed option id already exists as a node.' },
          };
        }
        const built = buildAddOptionCandidate(currentGraph, env.payload);
        if (!built.candidate) {
          const code = built.error?.code;
          if (code === GRAPH_INVARIANT_VIOLATED) {
            return { ...meta, verdict: 'rejected', blocker: built.error };
          }
          return { ...meta, verdict: 'held', blocker: built.error };
        }
        // NEVER would_apply: the built candidate is surfaced for transparency, and the
        // verdict is held on the divergence split. (No EP2 assessment here — add_option
        // holds regardless of readiness, so assessing it would be discarded work.)
        return {
          ...meta,
          verdict: 'held',
          candidate: built.candidate,
          blocker: addOptionHoldBlocker(graphHasTopLevelOptions(currentGraph)),
        };
      }

      case 'add_node':
      case 'add_edge':
        return {
          ...meta,
          verdict: 'held',
          blocker: { code: STRUCTURAL_APPLY_HELD, readable: 'Structural mutation held: §6 structural-vs-tunable doctrine is pending sign-off.' },
        };

      case 'update_node_field':
      case 'update_edge_field':
        return {
          ...meta,
          verdict: 'held',
          blocker: { code: TUNABLE_APPLY_HELD, readable: 'Tunable mutation held: §3b/§6 doctrine pending; no tunable auto-apply until sign-off.' },
        };

      case 'remove_node':
      case 'remove_edge':
        return {
          ...meta,
          verdict: 'held',
          blocker: { code: REMOVE_UNCONFIRMED, readable: 'Destructive mutation held pending explicit user confirmation.' },
        };

      default: {
        const _never: never = kind;
        return _never;
      }
    }
  } catch {
    // TOTALITY: any uncaught error resolves to a classified held verdict.
    return {
      verdict: 'held',
      kind,
      candidate_id,
      mutation_class,
      base_hash_match: false,
      blocker: { code: CLASSIFY_FAILED, readable: 'Refereeing failed unexpectedly; held fail-closed.' },
    };
  }
}

/** Fail-closed verdict for a batch slot whose raw value could not even be READ. */
function unreadableElementVerdict(): RefereeVerdict {
  return {
    verdict: 'rejected',
    kind: null,
    candidate_id: null,
    mutation_class: null,
    base_hash_match: false,
    blocker: { code: SCHEMA_INVALID, readable: 'Batch element could not be read.' },
  };
}

/**
 * Referee a batch of raw candidates. Per-envelope verdicts (independent). TOTAL:
 * a non-array batch, a hostile array whose `length` or element reads throw (Proxy /
 * throwing index getter), and every element resolve to a CLASSIFIED verdict — the
 * function never throws (the guarantee `refereeMutation` already honours per-element).
 */
export function refereeMutationBatch(
  rawBatch: unknown,
  currentGraph: unknown,
  frame: MutationFrame | null,
): RefereeVerdict[] {
  if (!Array.isArray(rawBatch)) {
    return [refereeMutation(rawBatch, currentGraph, frame)];
  }
  let len = 0;
  try {
    len = rawBatch.length;
  } catch {
    return [unreadableElementVerdict()];
  }
  const out: RefereeVerdict[] = [];
  for (let i = 0; i < len; i += 1) {
    let raw: unknown;
    try {
      raw = rawBatch[i];
    } catch {
      out.push(unreadableElementVerdict());
      continue;
    }
    out.push(refereeMutation(raw, currentGraph, frame));
  }
  return out;
}
