/**
 * Dual-model telemetry event names (quarantined scaffold — not imported by
 * any live path, and deliberately NOT registered in utils/telemetry.ts).
 *
 * emit() accepts arbitrary event-name strings, so these constants are the
 * full contract a future wiring lane needs. Registering them alongside the
 * TelemetryEvents enum (and dashboards) happens at wiring time — keeping this
 * branch free of edits to boot-executed live files.
 *
 * Log-safety rule (same as dual-draft/telemetry.ts): events carry ids,
 * counts, coded reasons and models ONLY — never artifact bodies, questions,
 * rationales or evidence pointers.
 */
export const DualModelTelemetryEvents = {
  /** Artifact rows persisted for a turn (counts + type histogram only). */
  ArtifactsPersisted: 'v6.dual_model.artifacts_persisted',
  /** A worth-checking section was composed (item counts, never text). */
  WorthCheckingComposed: 'v6.dual_model.worth_checking_composed',
  /** Composition failed closed (coded reason: leak-token/claim/empty). */
  WorthCheckingSuppressed: 'v6.dual_model.worth_checking_suppressed',
} as const;

export type DualModelTelemetryEvent =
  (typeof DualModelTelemetryEvents)[keyof typeof DualModelTelemetryEvents];
