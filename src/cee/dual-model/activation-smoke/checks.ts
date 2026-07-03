/**
 * Activation-smoke check registry (quarantined scaffold — built, never run).
 *
 * Each check maps SmokeIO evidence onto a green/amber/red/skipped verdict
 * with operator remediation. Verdict logic reuses the LIVE guards read-only
 * (prompt sentinel, GraphV3, option-surface/readiness guards, structural
 * readiness) so the smoke tool can never disagree with the service about
 * what "valid" means. No check touches an adapter: the model check stops at
 * RESOLUTION; call evidence comes from an operator-supplied telemetry
 * export, never from making calls.
 */
import { isM2PromptProvisioned, M2_PROMPT_NOT_PROVISIONED_SENTINEL } from '../../dual-draft/prompt-sentinel.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { optionSurfaceUnchanged, checkReadinessNoDowngrade } from '../../dual-draft/guards.js';
import { computeStructuralReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { checkModelResolution } from '../model-resolution.js';
import type { CheckResult, SmokeCheck, SmokeIO, SmokeParams } from './types.js';

export const M2_PROMPT_SLOT = 'm2_graph_review';
export const M2_TASK = 'm2_graph_review';
export const FAILOVER_ENV_NAME = 'LLM_FAILOVER_PROVIDERS';
export const M2_MODEL_ENV_NAME = 'CEE_MODEL_M2_REVIEW';
export const DUAL_DRAFT_FLAG_ENV_NAME = 'CEE_V6_DUAL_DRAFT_ENABLED';

const M2_OUTCOME_EVENT = 'v6.dual_draft.m2_outcome';
const MERGE_REPORT_EVENT = 'v6.dual_draft.merge_report';

function result(
  id: string,
  status: CheckResult['status'],
  evidence: readonly string[],
  remediation: string,
): CheckResult {
  return { id, status, evidence, remediation };
}

export const checkPromptProvisioned: SmokeCheck = async (io) => {
  const id = 'prompt_provisioned';
  const remediation =
    'Provision Paul-authored M2 prompt copy via the PMS lane for the m2_graph_review slot (activation gate 1).';
  const text = await io.getPromptText(M2_PROMPT_SLOT);
  if (text === null) {
    return result(id, 'red', ['prompt slot unavailable or loader failed'], remediation);
  }
  if (!isM2PromptProvisioned(text)) {
    return result(
      id,
      'red',
      [`sentinel ${M2_PROMPT_NOT_PROVISIONED_SENTINEL} still present — fail-closed slot (G17)`],
      remediation,
    );
  }
  return result(id, 'green', [`prompt provisioned (${text.length} chars, sentinel absent)`], remediation);
};

export const checkModelStrict: SmokeCheck = async (io, params) => {
  const id = 'model_strict';
  const remediation = `Set ${M2_MODEL_ENV_NAME} explicitly and ensure the router resolves to exactly that model on an Anthropic provider (activation gates 2–3).`;
  const configured = params.expectedModel ?? (await io.getConfiguredModel(M2_TASK));
  const resolution = await io.getModelResolution(M2_TASK);
  const gate = checkModelResolution(configured, resolution);
  if (gate.ok) {
    return result(
      id,
      'green',
      [
        `configured=${configured}`,
        `resolved=${resolution?.resolved_model} (source: ${resolution?.resolution_source ?? 'unknown'}, provider: ${resolution?.provider})`,
      ],
      remediation,
    );
  }
  return result(id, 'red', [`cause=${gate.cause}`, gate.detail], remediation);
};

export const checkFailoverAbsent: SmokeCheck = async (io) => {
  const id = 'failover_absent';
  const remediation = `Unset ${FAILOVER_ENV_NAME} for the M2 activation window — failover interception resolves a different model and the strict gate would leave the stage inert.`;
  const present = await io.getEnvPresence(FAILOVER_ENV_NAME);
  return present
    ? result(id, 'red', [`${FAILOVER_ENV_NAME} is SET (name checked, value never read)`], remediation)
    : result(id, 'green', [`${FAILOVER_ENV_NAME} not set`], remediation);
};

interface TelemetryEventLike {
  readonly event?: unknown;
  readonly [key: string]: unknown;
}

function eventsFrom(exported: unknown): readonly TelemetryEventLike[] {
  if (Array.isArray(exported)) return exported as TelemetryEventLike[];
  if (exported !== null && typeof exported === 'object') {
    const events = (exported as { events?: unknown }).events;
    if (Array.isArray(events)) return events as TelemetryEventLike[];
  }
  return [];
}

/** Classifies M2 called/skipped from an operator-supplied telemetry export — never by making calls. */
export const checkM2CallEvidence: SmokeCheck = async (io) => {
  const id = 'm2_call_evidence';
  const remediation =
    'Supply a telemetry/turn-debug export covering the smoke turn (v6.dual_draft.* events); if the outcome is a degrade code, remediate that condition and re-run the turn.';
  const exported = await io.getTelemetryExport();
  if (exported === null) {
    return result(id, 'skipped', ['no telemetry export supplied'], remediation);
  }
  const events = eventsFrom(exported);
  const outcome = events.find((e) => e.event === M2_OUTCOME_EVENT);
  if (!outcome) {
    return result(id, 'red', [`no ${M2_OUTCOME_EVENT} event in export — M2 stage never dispatched`], remediation);
  }
  const kind = String(outcome.outcome ?? 'unknown');
  if (kind === 'ok') {
    const report = events.find((e) => e.event === MERGE_REPORT_EVENT);
    const evidence = [
      `M2 CALLED: outcome=ok, model=${String(outcome.model ?? 'unrecorded')}, proposals=${String(outcome.proposals_count ?? '?')}`,
    ];
    if (report) {
      evidence.push(
        `merge_report: total=${String(report.proposals_total)}, applied=${String(report.applied)}, artifacts=${String(report.artifacts)}, failures=${String(report.failures)}`,
      );
    }
    return result(id, 'green', evidence, remediation);
  }
  const cause = outcome.cause !== undefined ? `, cause=${String(outcome.cause)}` : '';
  return result(id, 'amber', [`M2 SKIPPED/DEGRADED: outcome=${kind}${cause}`], remediation);
};

export const checkMergedGraphValid: SmokeCheck = async (io) => {
  const id = 'merged_graph_valid';
  const remediation =
    'Supply the before/after graph pair from the smoke turn; a red here means the merged graph violates the same guards the service enforces — do not proceed.';
  const pair = await io.getGraphPair();
  if (pair === null) return result(id, 'skipped', ['no graph pair supplied'], remediation);

  const before = GraphV3.safeParse(pair.before);
  const after = GraphV3.safeParse(pair.after);
  if (!before.success || !after.success) {
    return result(
      id,
      'red',
      [
        `before GraphV3: ${before.success ? 'valid' : 'INVALID'}`,
        `after GraphV3: ${after.success ? 'valid' : 'INVALID'}`,
      ],
      remediation,
    );
  }
  // Guards run on the RAW pair (parity with the live stage, which merges raw).
  const surface = optionSurfaceUnchanged(pair.before as GraphV3T, pair.after as GraphV3T);
  const readiness = checkReadinessNoDowngrade(pair.before as GraphV3T, pair.after as GraphV3T);
  const evidence = [
    'before/after both GraphV3-valid',
    `option surface unchanged: ${surface}`,
    `readiness: ${readiness.before_status} → ${readiness.after_status} (no-downgrade ok: ${readiness.ok})`,
  ];
  return surface && readiness.ok
    ? result(id, 'green', evidence, remediation)
    : result(id, 'red', evidence, remediation);
};

export const checkArtifactsPersisted: SmokeCheck = async (io, params) => {
  const id = 'artifacts_persisted';
  const remediation =
    'Expected only once the artifact-persistence wiring lane has landed; skipped is the normal verdict before that.';
  if (!params.scenarioId) return result(id, 'skipped', ['no scenario id supplied'], remediation);
  const rows = await io.readArtifacts(params.scenarioId);
  if (rows === null) {
    return result(id, 'skipped', ['artifact store absent / not wired'], remediation);
  }
  return result(
    id,
    rows.length > 0 ? 'green' : 'amber',
    [`${rows.length} artifact row(s) for scenario ${params.scenarioId}`],
    remediation,
  );
};

export const checkRunAnalysisReadiness: SmokeCheck = async (io) => {
  const id = 'run_analysis_readiness';
  const remediation =
    'Structural readiness is necessary but NOT sufficient (standing ruling): the activation gate is a real merged-graph run_analysis SUCCESS against PLoT/ISL.';
  const pair = await io.getGraphPair();
  if (pair === null) return result(id, 'skipped', ['no graph pair supplied'], remediation);
  const after = GraphV3.safeParse(pair.after);
  if (!after.success) return result(id, 'red', ['after graph is not GraphV3-valid'], remediation);
  const payload = computeStructuralReadiness(pair.after as GraphV3T);
  if (!payload) return result(id, 'red', ['readiness underivable (no goal node)'], remediation);
  const optionLines = payload.options.map(
    (o) => `option ${o.option_id}: ${o.status}${o.is_baseline ? ' (baseline)' : ''}`,
  );
  return result(
    id,
    payload.status === 'ready' ? 'green' : 'amber',
    [`structural status: ${payload.status}`, ...optionLines],
    remediation,
  );
};

/** Pure printer — the exact rollback sequence, always green. */
export const checkRollbackPlan: SmokeCheck = async () => {
  const id = 'rollback_plan';
  return result(
    id,
    'green',
    [
      `1. Unset ${DUAL_DRAFT_FLAG_ENV_NAME} (or set =false) — code default OFF governs`,
      `2. Unset ${M2_MODEL_ENV_NAME} — the model-resolution gate then holds even if the flag leaks back on`,
      '3. Redeploy / restart the service so env changes take effect',
      '4. Verify: pnpm vitest run src/cee/dual-draft/__tests__/dispatch-flag-off.test.ts src/cee/dual-draft/__tests__/phase4-dispatch-compat.test.ts',
      '5. Confirm telemetry: no further v6.dual_draft.m2_outcome events after the redeploy',
    ],
    'None — informational.',
  );
};

/** Registry in report order. evidence_packet is the report itself (report.ts). */
export const SMOKE_CHECKS: readonly { readonly id: string; readonly run: SmokeCheck }[] = [
  { id: 'prompt_provisioned', run: checkPromptProvisioned },
  { id: 'model_strict', run: checkModelStrict },
  { id: 'failover_absent', run: checkFailoverAbsent },
  { id: 'm2_call_evidence', run: checkM2CallEvidence },
  { id: 'merged_graph_valid', run: checkMergedGraphValid },
  { id: 'artifacts_persisted', run: checkArtifactsPersisted },
  { id: 'run_analysis_readiness', run: checkRunAnalysisReadiness },
  { id: 'rollback_plan', run: checkRollbackPlan },
];

export async function runAllChecks(io: SmokeIO, params: SmokeParams): Promise<readonly CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { id, run } of SMOKE_CHECKS) {
    try {
      results.push(await run(io, params));
    } catch (err) {
      results.push(
        result(
          id,
          'red',
          [`check threw: ${err instanceof Error ? err.message : String(err)}`],
          'Investigate the thrown error; a throwing check is itself a failure.',
        ),
      );
    }
  }
  return results;
}
