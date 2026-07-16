/**
 * Shared optional-metadata fields of the run_analysis scenario snapshot.
 *
 * TWO structurally-mirrored `RunAnalysisScenarioSnapshot` interfaces exist by
 * design — the handler-side contract (tools/handlers/run-analysis.ts) and the
 * reader-side declaration (build-turn-context.ts) — because the
 * handler-ownership invariant (scripts/validate-handler-ownership.sh) forbids
 * importing the RUNTIME handler module outside registry.ts. The mirror was
 * hand-maintained ("Mirrors the field on…" comments) and had already drifted
 * once (`adoptedIngressGraph` landed on the handler side only; the
 * full-tsconfig drift ratchet caught it). This TYPES-ONLY module is the
 * derive-don't-mirror fix: both interfaces now `extend` ONE base for the
 * fields that are semantically the same field on both sides.
 *
 * Zero runtime coupling: `import type` erases at compile time, and the
 * ownership check matches imports of `tools/handlers/run-analysis` exactly —
 * this sibling module is not (and must not be) gated, because it carries no
 * behaviour.
 *
 * Deliberately NOT in this base: the fields whose shapes genuinely diverge
 * between the two declarations — `graph` (GraphV3T on the reader side vs
 * `unknown` on the handler side), the `options` projection, `goal_node_id`,
 * and the handler-only pass-throughs `seed` / `n_samples`. Base = only the
 * genuinely-shared fields; forcing the divergent ones together would trade a
 * visible mirror for an invisible lie about their shapes.
 */
export interface RunAnalysisSnapshotSharedFields {
  /**
   * V5 D1 (P0-2 follow-up): `add_constraint` persists to
   * `graph.goal_constraints` (top-level field on GraphV3). PLoT consumes them
   * via the run payload's top-level `goal_constraints`, not via the graph
   * object — so the handler must explicitly forward them. Surfaced on the
   * snapshot so `runAnalysisHandler` can attach without a second graph parse.
   */
  readonly goal_constraints?: unknown;
  /**
   * V5 state-trust: the RAW graph as stored in `scenarios.graph` BEFORE
   * GraphV3.safeParse (or, on the #343 adoption path, the canonical adopted
   * ingress graph). The V3 parse strips top-level `options` / `goal_node_id`
   * and the loader transforms options to the PLoT projection — hashing either
   * projection would diverge from what the turn-executor freshness derivation
   * computes from the same persisted JSON. This raw form is the single
   * representation both sides hash to a matching value.
   *
   * Optional HERE (the handler-side contract tolerates legacy test snapshots
   * built without it); the reader-side interface narrows it to REQUIRED —
   * production loads always populate it.
   */
  readonly rawPersistedGraph?: unknown;
  /**
   * Lane 28 — brief pipeline: the persisted `scenarios.brief_text`, loaded in
   * the same round trip as the graph. Absent (not null) when no brief is
   * persisted. Forwarded to PLoT only behind `config.cee.sendBriefToPlot`
   * (default OFF — doctrine ask D5, Paul-gated).
   */
  readonly briefText?: string;
  /**
   * #343 CEE half — adopt-on-empty marker. True ONLY when the persisted
   * `scenarios.graph` was GENUINELY null and the loader adopted the
   * request-supplied ingress graph (after the full readiness core passed);
   * `rawPersistedGraph` then carries the canonical ADOPTED graph. The
   * run_analysis handler reads this marker to populate
   * `HandlerOutcome.__adopted_ingress_graph` — the SINGLE channel both commit
   * seams (chip-click dispatch / TurnExecutor STEP 7) consume to persist the
   * adopted graph with the turn (behind the shared
   * `reverifyAdoptedGraphFirstWrite` best-effort re-verify). Omitted (never
   * false) on every non-adopted load.
   */
  readonly adoptedIngressGraph?: true;
}
