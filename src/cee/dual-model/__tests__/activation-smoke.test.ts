/**
 * Activation-smoke library self-tests (CI-required scope): every check
 * against green/amber/red fixtures, the plan renderer, exit-code mapping,
 * and the never-live tripwire (plan-mode IO throws on any accessor, and a
 * throwing check surfaces as red — never as silent live access).
 */
import { describe, it, expect } from 'vitest';
import { M2_PROMPT_NOT_PROVISIONED_SENTINEL } from '../../dual-draft/prompt-sentinel.js';
import {
  SMOKE_CHECKS,
  runAllChecks,
  checkPromptProvisioned,
  checkModelStrict,
  checkFailoverAbsent,
  checkM2CallEvidence,
  checkMergedGraphValid,
  checkArtifactsPersisted,
  checkRunAnalysisReadiness,
  checkRollbackPlan,
  FAILOVER_ENV_NAME,
} from '../activation-smoke/checks.js';
import { createFixturesIO, type SmokeFixtures } from '../activation-smoke/fixtures-io.js';
import { createPlanModeIO, renderPlan } from '../activation-smoke/plan.js';
import { renderEvidencePacket, computeExitCode } from '../activation-smoke/report.js';
import { baseGraph } from './adversarial-fixtures.js';

function io(fixtures: SmokeFixtures) {
  return createFixturesIO(fixtures);
}

const NO_PARAMS = {};

describe('prompt_provisioned', () => {
  it('green when real copy is provisioned', async () => {
    const res = await checkPromptProvisioned(io({ promptText: 'You are M2, review the draft…' }), NO_PARAMS);
    expect(res.status).toBe('green');
  });
  it('red while the fail-closed sentinel is present', async () => {
    const res = await checkPromptProvisioned(
      io({ promptText: `prefix ${M2_PROMPT_NOT_PROVISIONED_SENTINEL} suffix` }),
      NO_PARAMS,
    );
    expect(res.status).toBe('red');
    expect(res.evidence.join(' ')).toContain('G17');
  });
  it('red when the slot is unavailable', async () => {
    expect((await checkPromptProvisioned(io({}), NO_PARAMS)).status).toBe('red');
  });
});

describe('model_strict', () => {
  const RESOLUTION = { provider: 'anthropic', resolved_model: 'claude-opus-4-8', resolution_source: 'env_var' };
  it('green on exact match', async () => {
    const res = await checkModelStrict(
      io({ configuredModel: 'claude-opus-4-8', modelResolution: RESOLUTION }),
      NO_PARAMS,
    );
    expect(res.status).toBe('green');
    expect(res.evidence.join('\n')).toContain('resolved=claude-opus-4-8');
  });
  it('red with cause=model_unset when nothing is configured', async () => {
    const res = await checkModelStrict(io({ modelResolution: RESOLUTION }), NO_PARAMS);
    expect(res.status).toBe('red');
    expect(res.evidence[0]).toBe('cause=model_unset');
  });
  it('red with cause=model_mismatch on failover interception', async () => {
    const res = await checkModelStrict(
      io({
        configuredModel: 'claude-opus-4-8',
        modelResolution: { provider: 'anthropic', resolved_model: 'other', resolution_source: 'llm_model_fallback' },
      }),
      NO_PARAMS,
    );
    expect(res.status).toBe('red');
    expect(res.evidence[0]).toBe('cause=model_mismatch');
  });
  it('params.expectedModel overrides the io-configured value', async () => {
    const res = await checkModelStrict(
      io({ configuredModel: 'claude-opus-4-8', modelResolution: RESOLUTION }),
      { expectedModel: 'some-other-model' },
    );
    expect(res.status).toBe('red');
  });
});

describe('failover_absent', () => {
  it('green when the env NAME is not present', async () => {
    expect((await checkFailoverAbsent(io({}), NO_PARAMS)).status).toBe('green');
  });
  it('red when present — and the evidence never contains a value', async () => {
    const res = await checkFailoverAbsent(io({ envPresent: [FAILOVER_ENV_NAME] }), NO_PARAMS);
    expect(res.status).toBe('red');
    expect(res.evidence.join(' ')).toContain('value never read');
  });
});

describe('m2_call_evidence — classification from a supplied export, never from calls', () => {
  it('skipped without an export', async () => {
    expect((await checkM2CallEvidence(io({}), NO_PARAMS)).status).toBe('skipped');
  });
  it('green when the m2_outcome event says ok, with merge accounting attached', async () => {
    const res = await checkM2CallEvidence(
      io({
        telemetryExport: {
          events: [
            { event: 'v6.dual_draft.m2_outcome', outcome: 'ok', model: 'claude-opus-4-8', proposals_count: 3 },
            { event: 'v6.dual_draft.merge_report', proposals_total: 3, applied: 2, artifacts: 1, failures: 0 },
          ],
        },
      }),
      NO_PARAMS,
    );
    expect(res.status).toBe('green');
    expect(res.evidence[0]).toContain('M2 CALLED');
    expect(res.evidence[1]).toContain('applied=2');
  });
  it('amber with the coded skip reason on a degrade outcome', async () => {
    const res = await checkM2CallEvidence(
      io({
        telemetryExport: [
          { event: 'v6.dual_draft.m2_outcome', outcome: 'model_not_resolved', cause: 'model_unset' },
        ],
      }),
      NO_PARAMS,
    );
    expect(res.status).toBe('amber');
    expect(res.evidence[0]).toContain('cause=model_unset');
  });
  it('red when the export has no m2_outcome at all (stage never dispatched)', async () => {
    const res = await checkM2CallEvidence(io({ telemetryExport: { events: [] } }), NO_PARAMS);
    expect(res.status).toBe('red');
  });
});

describe('merged_graph_valid — live-guard parity', () => {
  it('green when both parse and the G12 guards hold', async () => {
    const g = baseGraph();
    const after = structuredClone(g);
    after.nodes.push({ id: 'risk_new', kind: 'risk', label: 'New risk' } as (typeof after.nodes)[number]);
    const res = await checkMergedGraphValid(io({ graphPair: { before: g, after } }), NO_PARAMS);
    expect(res.status).toBe('green');
  });
  it('red when the merged graph mutates the option surface', async () => {
    const g = baseGraph();
    const after = structuredClone(g);
    after.nodes.push({ id: 'opt_new', kind: 'option', label: 'Injected option' } as (typeof after.nodes)[number]);
    const res = await checkMergedGraphValid(io({ graphPair: { before: g, after } }), NO_PARAMS);
    expect(res.status).toBe('red');
    expect(res.evidence.join('\n')).toContain('option surface unchanged: false');
  });
  it('red when either side fails GraphV3', async () => {
    const res = await checkMergedGraphValid(
      io({ graphPair: { before: baseGraph(), after: { nodes: 'nope' } } }),
      NO_PARAMS,
    );
    expect(res.status).toBe('red');
  });
  it('skipped without a pair', async () => {
    expect((await checkMergedGraphValid(io({}), NO_PARAMS)).status).toBe('skipped');
  });
});

describe('artifacts_persisted', () => {
  it('skipped when the store is absent (the pre-wiring normal)', async () => {
    const res = await checkArtifactsPersisted(io({}), { scenarioId: 'scen-1' });
    expect(res.status).toBe('skipped');
    expect(res.evidence[0]).toContain('store absent');
  });
  it('green when rows exist; amber when the store exists but is empty', async () => {
    expect(
      (await checkArtifactsPersisted(io({ artifacts: { 'scen-1': [{ id: 'a' }] } }), { scenarioId: 'scen-1' }))
        .status,
    ).toBe('green');
    expect(
      (await checkArtifactsPersisted(io({ artifacts: { 'scen-1': [] } }), { scenarioId: 'scen-1' })).status,
    ).toBe('amber');
  });
});

describe('run_analysis_readiness', () => {
  it('green with per-option statuses on a ready merged graph', async () => {
    const g = baseGraph();
    const res = await checkRunAnalysisReadiness(io({ graphPair: { before: g, after: g } }), NO_PARAMS);
    expect(res.status).toBe('green');
    expect(res.evidence[0]).toBe('structural status: ready');
    expect(res.evidence.some((e) => e.includes('opt_launch'))).toBe(true);
  });
  it('amber when structurally not ready', async () => {
    const g = baseGraph();
    const after = structuredClone(g);
    after.nodes = after.nodes.filter((n) => n.id !== 'opt_wait'); // 1 option → needs_user_input
    const res = await checkRunAnalysisReadiness(io({ graphPair: { before: g, after } }), NO_PARAMS);
    expect(res.status).toBe('amber');
  });
});

describe('rollback_plan', () => {
  it('prints the exact env-unset → redeploy → proof-test sequence', async () => {
    const res = await checkRollbackPlan(io({}), NO_PARAMS);
    expect(res.status).toBe('green');
    const text = res.evidence.join('\n');
    expect(text).toContain('CEE_V6_DUAL_DRAFT_ENABLED');
    expect(text).toContain('CEE_MODEL_M2_REVIEW');
    expect(text).toContain('dispatch-flag-off.test.ts');
  });
});

describe('never-live tripwire', () => {
  it('plan-mode IO throws on every accessor', async () => {
    const planIO = createPlanModeIO();
    await expect(planIO.getPromptText('m2_graph_review')).rejects.toThrow('plan mode');
    await expect(planIO.getConfiguredModel('m2_graph_review')).rejects.toThrow('plan mode');
    await expect(planIO.getModelResolution('m2_graph_review')).rejects.toThrow('plan mode');
    await expect(planIO.getEnvPresence('X')).rejects.toThrow('plan mode');
    await expect(planIO.getTelemetryExport()).rejects.toThrow('plan mode');
    await expect(planIO.getGraphPair()).rejects.toThrow('plan mode');
    await expect(planIO.readArtifacts('scen')).rejects.toThrow('plan mode');
  });

  it('a check reaching for live data under plan-mode IO surfaces as red, never as silent access', async () => {
    // scenarioId supplied so artifacts_persisted actually reaches the IO
    // (without it the check short-circuits to skipped before any access).
    const results = await runAllChecks(createPlanModeIO(), { scenarioId: 'scen-1' });
    const rollback = results.find((r) => r.id === 'rollback_plan');
    expect(rollback?.status).toBe('green'); // the only input-free check
    for (const r of results) {
      if (r.id === 'rollback_plan') continue;
      expect(r.status).toBe('red');
      expect(r.evidence[0]).toContain('plan mode: live access forbidden');
    }
  });

  it('plan renderer names every registered check and the gating rules', () => {
    const plan = renderPlan();
    for (const { id } of SMOKE_CHECKS) expect(plan).toContain(`- ${id}:`);
    expect(plan).toContain('--operator-confirm');
    expect(plan).toContain('No mode of this tool can make an LLM call');
  });
});

describe('report + exit codes', () => {
  it('renders the packet with verdict table, evidence, remediation and the sufficiency caveat', async () => {
    const results = await runAllChecks(
      io({
        promptText: 'real copy',
        configuredModel: 'claude-opus-4-8',
        modelResolution: { provider: 'anthropic', resolved_model: 'claude-opus-4-8', resolution_source: 'env_var' },
      }),
      NO_PARAMS,
    );
    const md = renderEvidencePacket(results, {
      generatedForMode: 'fixtures',
      servingSha: 'abc1234',
      generatedAt: '2026-07-03T00:00:00Z',
    });
    expect(md).toContain('| prompt_provisioned | 🟢 green |');
    expect(md).toContain('serving build SHA: abc1234');
    expect(md).toContain('necessary but NOT sufficient');
    expect(md).toContain('**remediation:**');
  });

  it('exit code 0 for green/amber/skipped; 1 when any red exists', () => {
    expect(
      computeExitCode([
        { id: 'a', status: 'green', evidence: [], remediation: '' },
        { id: 'b', status: 'amber', evidence: [], remediation: '' },
        { id: 'c', status: 'skipped', evidence: [], remediation: '' },
      ]),
    ).toBe(0);
    expect(
      computeExitCode([
        { id: 'a', status: 'green', evidence: [], remediation: '' },
        { id: 'b', status: 'red', evidence: [], remediation: '' },
      ]),
    ).toBe(1);
  });
});
