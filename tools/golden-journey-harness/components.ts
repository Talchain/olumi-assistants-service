/**
 * Golden-Journey Harness v1 — core-component taxonomy + Finding type.
 *
 * The harness exists to make ONE thing visible and repeatable: the AI
 * experience is not reliably grounded in canonical state, context,
 * orchestration, typed actions, and science-backed coaching. Every
 * assertion the harness makes is classified into exactly one of six core
 * components so a reader can answer "which component must fix this next?".
 *
 * This module is the source of truth for that taxonomy. It has no runtime
 * dependencies (pure constants + types) so it can be imported by the pure
 * invariant classifiers, the report writer, and the committed unit tests
 * without pulling in HTTP / product code.
 */

/**
 * The six core components a failure can be attributed to. Order is
 * significant: the lower-numbered component is the tie-break winner when
 * two findings of equal priority compete for "which component must fix
 * this next" (see {@link COMPONENT_NUMBER}).
 */
export const CORE_COMPONENTS = [
  'context_management',
  'canonical_state',
  'ai_orchestration',
  'typed_action_mutation',
  'science_grounded_coaching',
  'observability_recovery',
] as const;

export type CoreComponent = (typeof CORE_COMPONENTS)[number];

/** Stable 1..6 numbering used in reports and for tie-breaking. */
export const COMPONENT_NUMBER: Readonly<Record<CoreComponent, 1 | 2 | 3 | 4 | 5 | 6>> = {
  context_management: 1,
  canonical_state: 2,
  ai_orchestration: 3,
  typed_action_mutation: 4,
  science_grounded_coaching: 5,
  observability_recovery: 6,
};

/** Human-readable labels for report rendering. */
export const COMPONENT_LABEL: Readonly<Record<CoreComponent, string>> = {
  context_management: 'Context management',
  canonical_state: 'Canonical state',
  ai_orchestration: 'AI orchestration',
  typed_action_mutation: 'Typed action/mutation',
  science_grounded_coaching: 'Science-grounded coaching',
  observability_recovery: 'Observability/recovery',
};

export type InvariantId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7';

/** The seven required assertions, in brief order. */
export const INVARIANT_TITLE: Readonly<Record<InvariantId, string>> = {
  A1: 'Analysis state is not contradicted by prose, chips or reload',
  A2: 'AI-facing context contains graph, analysis, blockers, capabilities, recent-turn state',
  A3: 'Actions only count when durable state changed',
  A4: 'Failed/proposed/non-mutating turns never claim success',
  A5: 'Coaching is grounded in actual graph/analysis/science signals',
  A6: 'Debug output explains what happened',
  A7: 'Repairs/recoveries are visible, not silent',
};

/** Primary component each invariant is attributed to (the one that must fix it). */
export const INVARIANT_PRIMARY: Readonly<Record<InvariantId, CoreComponent>> = {
  A1: 'canonical_state',
  A2: 'context_management',
  A3: 'typed_action_mutation',
  A4: 'typed_action_mutation',
  A5: 'science_grounded_coaching',
  A6: 'observability_recovery',
  A7: 'observability_recovery',
};

/** Contributing (secondary) components for cross-cutting findings. */
export const INVARIANT_CONTRIBUTING: Readonly<Record<InvariantId, readonly CoreComponent[]>> = {
  A1: ['context_management', 'observability_recovery'],
  A2: ['canonical_state'],
  A3: ['canonical_state'],
  A4: ['science_grounded_coaching', 'observability_recovery'],
  A5: ['context_management'],
  A6: ['ai_orchestration'],
  A7: ['canonical_state', 'ai_orchestration'],
};

/**
 * pass         — the invariant held for this turn (wire-observable evidence).
 * fail         — the invariant was violated (a real product finding).
 * inconclusive — the invariant could NOT be proven because a required
 *                signal was absent (e.g. diagnostic trace flag off, or
 *                `current_graph_hash` not emitted by a handler path).
 *                Per dispatch guardrail #4, an inconclusive caused by
 *                missing observability is itself a high-priority finding —
 *                it blocks the harness from proving the system.
 */
export type InvariantStatus = 'pass' | 'fail' | 'inconclusive';

export type Severity = 'high' | 'medium' | 'low' | 'none';

export interface Finding {
  readonly invariant_id: InvariantId;
  readonly invariant_title: string;
  readonly component_primary: CoreComponent;
  readonly components_contributing: readonly CoreComponent[];
  readonly status: InvariantStatus;
  readonly severity: Severity;
  /**
   * Dispatch guardrail #1: A1 coherence is provisional until the
   * canonical-state lane finalises the contract. Findings carrying this
   * flag are rendered with a "(provisional)" marker and must be
   * reconciled when that lane lands.
   */
  readonly provisional?: boolean;
  /** The journey step that produced this finding (when turn-scoped). */
  readonly step?: string;
  /** Short, redaction-safe explanation of what was observed. */
  readonly evidence: string;
}

/**
 * Build a Finding for an invariant with its taxonomy pre-filled. Keeps
 * every classifier honest about its primary/contributing components.
 */
export function makeFinding(
  invariant: InvariantId,
  status: InvariantStatus,
  severity: Severity,
  evidence: string,
  extra?: { readonly step?: string; readonly provisional?: boolean },
): Finding {
  return {
    invariant_id: invariant,
    invariant_title: INVARIANT_TITLE[invariant],
    component_primary: INVARIANT_PRIMARY[invariant],
    components_contributing: INVARIANT_CONTRIBUTING[invariant],
    status,
    severity,
    ...(extra?.step !== undefined ? { step: extra.step } : {}),
    ...(extra?.provisional ? { provisional: true } : {}),
    evidence,
  };
}

/**
 * A coverage caveat is NOT a pass/fail of the product — it records a known
 * limitation of what THIS HARNESS RUN proved, surfaced so a reader never
 * mistakes "not exercised" for "verified". Dispatch guardrails #2 and #3
 * are encoded here (A2 in-process-only; mutate validates the V4-style path
 * only, not typed-path coverage).
 */
export interface CoverageCaveat {
  readonly component: CoreComponent;
  readonly title: string;
  readonly detail: string;
}
