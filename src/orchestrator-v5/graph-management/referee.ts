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
  graphHasNodeId,
  graphHasTopLevelOptions,
  graphOptionsAreMalformed,
} from './candidate-graph.js';
import { assessCandidate, representableVerdict } from './readiness-parity.js';
import {
  SCHEMA_INVALID,
  FRAME_UNAVAILABLE,
  BASE_HASH_DIVERGED,
  CURRENT_GRAPH_UNREADABLE,
  OPTION_ID_COLLISION,
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  GRAPH_OPTIONS_MALFORMED,
  GRAPH_INVARIANT_VIOLATED,
  READINESS_DOWNGRADE,
  STRUCTURAL_APPLY_HELD,
  TUNABLE_APPLY_HELD,
  REMOVE_UNCONFIRMED,
  CLASSIFY_FAILED,
} from './reason-codes.js';
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
    return typeof k === 'string' &&
      (
        [
          'add_node',
          'add_edge',
          'update_node_field',
          'update_edge_field',
          'rename_node',
          'add_option',
          'remove_node',
          'remove_edge',
          'flag_uncertainty',
          'clarification',
        ] as const
      ).includes(k as CandidateKind)
      ? (k as CandidateKind)
      : null;
  } catch {
    return null;
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
        return {
          ...meta,
          verdict: 'stale',
          ...(gate.outcome.reason === 'base_hash_diverged'
            ? { blocker: { code: BASE_HASH_DIVERGED, readable: 'The graph has moved since this candidate was generated.' } as MutationBlocker }
            : {}),
        };
      case 'proceed':
        break;
    }

    // Non-mutating kinds never touch the graph.
    if (kind === 'flag_uncertainty' || kind === 'clarification') {
      return { ...meta, verdict: 'clarify_required' };
    }

    // R4 — field-safety (allowlist + engine-claim scan).
    const fs = checkFieldSafety(env);
    if (!fs.ok && fs.code) {
      return {
        ...meta,
        verdict: 'rejected',
        blocker: { code: fs.code, readable: `Field-safety rejected at \`${fs.path ?? 'payload'}\` (${fs.code}).` },
      };
    }

    // General graph-corruption guard: a present-but-non-array top-level `options`
    // corrupts the context view for EVERY mutating kind (PR #300, verified live).
    if (graphOptionsAreMalformed(currentGraph)) {
      return {
        ...meta,
        verdict: 'held',
        blocker: { code: GRAPH_OPTIONS_MALFORMED, readable: 'The current graph top-level `options` is present but not an array (malformed).' },
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
        // NEVER would_apply: candidate built + EP2-assessed for transparency, held on the divergence split.
        assessCandidate(built.candidate);
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
