/**
 * Fixtures-mode SmokeIO (quarantined scaffold): a fully deterministic IO
 * over caller-supplied literals — the CLI's --mode fixtures backend and the
 * self-test substrate. No filesystem access here; the CLI owns loading the
 * fixtures JSON and hands the parsed object in.
 */
import type { SmokeIO } from './types.js';

export interface SmokeFixtures {
  readonly promptText?: string | null;
  readonly configuredModel?: string | null;
  readonly modelResolution?: {
    readonly provider: string;
    readonly resolved_model: string;
    readonly resolution_source?: string;
  } | null;
  /** Env NAMES that should read as present. */
  readonly envPresent?: readonly string[];
  readonly telemetryExport?: unknown | null;
  readonly graphPair?: { readonly before: unknown; readonly after: unknown } | null;
  /** Keyed by scenario id. Absent key = store returns null (store absent). */
  readonly artifacts?: Readonly<Record<string, readonly unknown[]>>;
}

export function createFixturesIO(fixtures: SmokeFixtures): SmokeIO {
  return {
    getPromptText: async () => fixtures.promptText ?? null,
    getConfiguredModel: async () => fixtures.configuredModel ?? null,
    getModelResolution: async () => fixtures.modelResolution ?? null,
    getEnvPresence: async (name) => (fixtures.envPresent ?? []).includes(name),
    getTelemetryExport: async () => fixtures.telemetryExport ?? null,
    getGraphPair: async () => fixtures.graphPair ?? null,
    readArtifacts: async (scenarioId) => fixtures.artifacts?.[scenarioId] ?? null,
  };
}
