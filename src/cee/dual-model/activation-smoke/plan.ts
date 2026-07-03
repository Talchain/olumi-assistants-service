/**
 * Plan mode (the CLI DEFAULT): print what each check WOULD read and exit —
 * zero env/DB/network access, enforced by an IO whose every accessor throws.
 */
import type { SmokeIO } from './types.js';
import {
  SMOKE_CHECKS,
  M2_PROMPT_SLOT,
  M2_TASK,
  FAILOVER_ENV_NAME,
  M2_MODEL_ENV_NAME,
} from './checks.js';

/** What each check would touch in live mode — shown to the operator up front. */
const PLAN_SOURCES: Readonly<Record<string, string>> = {
  prompt_provisioned: `prompt store: system prompt for slot "${M2_PROMPT_SLOT}" (DB read; sentinel verdict via live isM2PromptProvisioned)`,
  model_strict: `config read: ${M2_MODEL_ENV_NAME} + router resolution for task "${M2_TASK}" (adapter constructed, NEVER called)`,
  failover_absent: `env presence: ${FAILOVER_ENV_NAME} (name only — the value is never read or printed)`,
  m2_call_evidence: 'operator-supplied telemetry/turn-debug JSON export (no calls are ever made by this tool)',
  merged_graph_valid: 'operator-supplied before/after graph JSON pair (validated with the live GraphV3 + G12 guards)',
  artifacts_persisted: 'dual-model artifact store query for the supplied scenario (skipped until the wiring lane lands)',
  run_analysis_readiness: 'operator-supplied after-graph (live computeStructuralReadiness; necessary-not-sufficient ruling applies)',
  rollback_plan: 'pure printer — no inputs',
};

export function renderPlan(): string {
  const lines: string[] = [
    '# v6 dual-draft activation smoke — PLAN MODE (default)',
    '',
    'No env var, database, network or LLM access happens in this mode.',
    'Live mode requires BOTH --operator-confirm AND a per-check interactive y/N.',
    'No mode of this tool can make an LLM call: no check invokes an adapter.',
    '',
  ];
  for (const { id } of SMOKE_CHECKS) {
    lines.push(`- ${id}: ${PLAN_SOURCES[id] ?? '(source unspecified)'}`);
  }
  lines.push('');
  lines.push('Run with --mode fixtures --fixtures-file <path> for a deterministic dry run.');
  return lines.join('\n');
}

/**
 * The plan-mode SmokeIO: every accessor throws. Injected in plan mode (and
 * used by the never-live tripwire test) so any check accidentally reaching
 * for live data fails loudly instead of silently touching the world.
 */
export function createPlanModeIO(): SmokeIO {
  const forbid = (accessor: string) => {
    throw new Error(`plan mode: live access forbidden (${accessor})`);
  };
  return {
    getPromptText: async () => forbid('getPromptText'),
    getConfiguredModel: async () => forbid('getConfiguredModel'),
    getModelResolution: async () => forbid('getModelResolution'),
    getEnvPresence: async () => forbid('getEnvPresence'),
    getTelemetryExport: async () => forbid('getTelemetryExport'),
    getGraphPair: async () => forbid('getGraphPair'),
    readArtifacts: async () => forbid('readArtifacts'),
  };
}
