/**
 * Activation-smoke check contracts (quarantined scaffold — the CLI wrapper
 * in tools/v6-dual-draft-activation is built but NEVER RUN on this branch).
 *
 * EFFECT-CHANNEL RULE: SmokeIO is the ONLY way a check reaches the outside
 * world. Checks are pure over what SmokeIO hands them; no check can invoke
 * adapter.chat by construction (nothing here imports an adapter), so no mode
 * of this tooling can make an LLM call. Plan mode injects an IO that throws
 * on every accessor; fixtures mode injects literals; live mode (operator-
 * confirmed, y/N-gated in the CLI) injects config/DB readers.
 */

export type CheckStatus = 'green' | 'amber' | 'red' | 'skipped';

export interface CheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  /** Human-readable evidence lines: ids, coded reasons, statuses — no secret VALUES. */
  readonly evidence: readonly string[];
  /** What the operator should do when not green. */
  readonly remediation: string;
}

/**
 * The single effect channel. Every accessor is async so live implementations
 * can query config/DB; fixtures return literals; plan mode throws.
 */
export interface SmokeIO {
  /** Prompt text for a slot (prompt store in live mode). Null = unavailable. */
  getPromptText(slot: string): Promise<string | null>;
  /** Configured expectation for a model slot (env/config read; VALUE is a model id, safe to print). */
  getConfiguredModel(task: string): Promise<string | null>;
  /** Router resolution for a task — resolution metadata only, adapter discarded. */
  getModelResolution(task: string): Promise<{
    readonly provider: string;
    readonly resolved_model: string;
    readonly resolution_source?: string;
  } | null>;
  /** Whether an env var NAME is set. The VALUE is never read. */
  getEnvPresence(name: string): Promise<boolean>;
  /** Operator-supplied telemetry/turn-debug export (JSON). Null = not provided. */
  getTelemetryExport(): Promise<unknown | null>;
  /** Operator-supplied before/after graph pair (JSON). Null = not provided. */
  getGraphPair(): Promise<{ readonly before: unknown; readonly after: unknown } | null>;
  /** Persisted M2 artifacts for a scenario. Null = store absent/not wired. */
  readArtifacts(scenarioId: string): Promise<readonly unknown[] | null>;
}

export interface SmokeParams {
  /** Expected M2 model id (what CEE_MODEL_M2_REVIEW should hold). */
  readonly expectedModel?: string;
  /** Scenario used for artifact-persistence evidence. */
  readonly scenarioId?: string;
  /** Serving build SHA, if the operator supplied one for the packet. */
  readonly servingSha?: string;
}

export type SmokeCheck = (io: SmokeIO, params: SmokeParams) => Promise<CheckResult>;
