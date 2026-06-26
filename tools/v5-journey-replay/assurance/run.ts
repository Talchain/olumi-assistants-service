/**
 * V5 staging assurance — orchestrator.
 *
 * Two-scenario, DB-interleaved journey that REUSES the journey-replay spine
 * primitives (client.postTurn / getHealthz, evaluateDeployGate, redact,
 * forbidden-terms via journey.ts) and adds Supabase fact/hash reads
 * (facts.ts) + exact-ID cleanup (cleanup.ts) + a red/amber/green report
 * (report.ts). This is the engine behind `pnpm assurance:v5:staging`.
 *
 * Scenarios:
 *   sA (graphless)  — forced run_analysis with NO draft → analysis_not_ready.
 *   sB (draft-first)— draft → run_analysis → mutate → stale Q → rerun.
 *
 * Cleanup of BOTH scenarios runs in `finally`, so staging is never left
 * dirty even if an assertion throws.
 */

import { randomUUID } from 'node:crypto';

import { getHealthz, postTurn, preflightAuth, type FetchResult, type TurnPayload } from '../client.js';
import { evaluateDeployGate } from '../index.js';
import { isLocalHost } from '../localhost.js';
import { createRedactor } from '../redact.js';
import type { TurnResponse } from '../types.js';

import {
  loadStagingEnv,
  resolveEnv,
  createSupabaseClient,
  makeSupabaseTableAccess,
} from './supabase.js';
import {
  summariseHandlerFacts,
  latestRunAnalysisHash,
  readPersistedGraph,
  pickFactorTargets,
  readFactorValue,
  chooseMutationValue,
  formatMutationValue,
  type FactorTarget,
} from './facts.js';
import { cleanupAndVerify } from './cleanup.js';
import {
  classifyGraphless,
  classifyDraftPersisted,
  classifyRealAnalysis,
  classifyMutation,
  classifyStaleDegrade,
  classifyRerunFresh,
  classifyFieldSafety,
  scanLeaks,
  freshnessOf,
} from './journey.js';
import {
  renderReport,
  countRag,
  type CheckResult,
  type FlagCapture,
  type ReportHeader,
} from './report.js';

const ASSURANCE_BRIEF =
  'We are a 15-person engineering team weighing three options for scaling ' +
  'delivery over the next six months: hire two senior engineers locally, ' +
  'engage an offshore partner, or introduce tiered pricing to hire more ' +
  'gradually. Decision matters for Q3 roadmap commitments.';

const TURN_TIMEOUT_MS = 120_000;

export interface AssuranceConfig {
  readonly baseUrl: string;
  readonly scenarioPrefix: string;
  readonly outPath: string;
  readonly envFile: string;
  readonly expectedBuild?: string;
  readonly allowStaleDeploy?: boolean;
}

export interface AssuranceOutcome {
  readonly exitCode: number;
  /** 'blocked' = could not start (missing secrets / deploy halt); 'ran' = checks executed. */
  readonly phase: 'blocked' | 'ran';
  readonly reportMarkdown: string;
  readonly checks: readonly CheckResult[];
  readonly scenarioIds: readonly string[];
  readonly blockedReason?: string;
}

function mkTurnId(): string {
  return randomUUID();
}

/** Attribution record per turn (turn_id + scenario_id ARE the telemetry correlation keys). */
interface Attribution {
  readonly step: string;
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly request_id?: string;
}

export async function runAssurance(cfg: AssuranceConfig): Promise<AssuranceOutcome> {
  const startedAt = new Date().toISOString();
  const fileEnv = loadStagingEnv(cfg.envFile);
  const supabaseUrl = resolveEnv(fileEnv, 'SUPABASE_URL');
  const serviceKey = resolveEnv(fileEnv, 'SUPABASE_SERVICE_ROLE_KEY');
  const apiKey =
    resolveEnv(fileEnv, 'OLUMI_REPLAY_API_KEY') ?? resolveEnv(fileEnv, 'ASSIST_API_KEY');

  let local = false;
  try {
    local = isLocalHost(cfg.baseUrl);
  } catch {
    local = false;
  }

  // ── Fail fast on missing credentials BEFORE creating any scenario ──
  // (so we never leave staging rows behind because cleanup creds are absent).
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!local && !apiKey) missing.push('OLUMI_REPLAY_API_KEY (or ASSIST_API_KEY)');
  if (missing.length > 0) {
    const reason =
      `Missing required credentials in ${cfg.envFile} (names only): ${missing.join(', ')}. ` +
      `The manual command needs Supabase service-role for cleanup; nothing was created.`;
    return blockedOutcome(reason);
  }

  const redact = createRedactor(apiKey);
  const client = createSupabaseClient(supabaseUrl!, serviceKey!);
  const access = makeSupabaseTableAccess(client);

  // ── Deploy gate (reuse spine) ──
  let healthz;
  try {
    healthz = await getHealthz(cfg.baseUrl);
  } catch (err) {
    return blockedOutcome(`/healthz unreachable: ${redact(err)}`);
  }
  const gate = evaluateDeployGate(cfg.baseUrl, healthz, cfg.expectedBuild);
  if (gate.halt && !cfg.allowStaleDeploy) {
    return blockedOutcome(`deploy gate halted: ${gate.reason ?? 'unknown'}`);
  }

  // ── Preflight auth (reuse spine) ──
  try {
    const probe = await preflightAuth(cfg.baseUrl, apiKey);
    if (probe.status === 401 || probe.status === 403) {
      return blockedOutcome(`auth rejected on preflight (HTTP ${probe.status}) — check the assist key`);
    }
    if (probe.status >= 500) {
      return blockedOutcome(`server error on preflight (HTTP ${probe.status}) — staging unhealthy`);
    }
  } catch (err) {
    return blockedOutcome(`preflight exception: ${redact(err)}`);
  }

  // ── Flag + SHA capture (captured, never set) ──
  const servingSha = healthz.body?.build ?? 'unknown';
  const flags = await captureFlags(cfg.baseUrl, apiKey);

  // ── Run checks ──
  const sA = randomUUID(); // graphless scenario
  const sB = randomUUID(); // draft-first scenario
  const scenarioIds = [sA, sB];
  const checks: CheckResult[] = [];
  const attributions: Attribution[] = [];
  const allBlocked: string[] = [];
  let turnsScanned = 0;
  // Cleanup lines are produced in `finally` and consumed by report rendering
  // after the try/finally — kept in function scope (reentrant; no globals).
  let cleanupLinesOut: string[] = [];
  let residualLinesOut: string[] = [];

  const post = async (
    step: string,
    scenarioId: string,
    build: (turnId: string) => TurnPayload,
  ): Promise<FetchResult> => {
    const turnId = mkTurnId();
    const result = await postTurn(cfg.baseUrl, build(turnId), TURN_TIMEOUT_MS, apiKey);
    turnsScanned += 1;
    const leaks = scanLeaks(result.body);
    allBlocked.push(...leaks.blocked);
    attributions.push({
      step,
      scenario_id: scenarioId,
      turn_id: turnId,
      ...(typeof result.body?.request_id === 'string' ? { request_id: result.body.request_id } : {}),
    });
    return result;
  };

  try {
    // ── C1: graphless forced run_analysis → analysis_not_ready + 0 facts ──
    const c1 = await post('graphless_run_analysis', sA, (turn_id) => ({
      kind: 'message',
      turn_id,
      scenario_id: sA,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }));
    const factsA = await safeFactTotal(client, sA);
    checks.push(withScenario(classifyGraphless({ httpStatus: c1.status, body: c1.body, factTotal: factsA }), sA));

    // ── C2: draft-first graph creation ──
    const c2 = await post('draft', sB, (turn_id) => ({
      kind: 'message',
      turn_id,
      scenario_id: sB,
      stage: 'frame',
      message: ASSURANCE_BRIEF,
      turn_class: 'frame',
      source: 'composer',
    }));
    const graphAfterDraft = await safeReadGraph(client, sB);
    const nodeCount = graphAfterDraft ? (graphAfterDraft.nodes?.length ?? 0) : null;
    checks.push(withScenario(classifyDraftPersisted({ httpStatus: c2.status, body: c2.body, graphNodeCount: nodeCount }), sB));

    const candidates = pickFactorTargets(graphAfterDraft);

    // ── C3: forced run_analysis on the persisted graph → real PLoT + fact ──
    const c3 = await post('run_analysis', sB, (turn_id) => ({
      kind: 'message',
      turn_id,
      scenario_id: sB,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }));
    const runFacts1 = await safeRunAnalysisCount(client, sB);
    const hashAtRun = await safeHash(client, sB);
    checks.push(
      withScenario(
        classifyRealAnalysis({
          httpStatus: c3.status,
          body: c3.body,
          runAnalysisFactCount: runFacts1,
          graphHashAtRun: hashAtRun,
        }),
        sB,
      ),
    );

    // ── C4: deterministic set_factor_value mutation → value changes ──
    // Try ranked candidates until one actually changes (robust to LLM-draft
    // nondeterminism where a given draft mints a malformed factor value).
    let mutationGreen = false;
    let mutatedTarget: FactorTarget | null = null;
    if (candidates.length > 0) {
      let lastCheck: CheckResult | null = null;
      for (const cand of candidates.slice(0, 3)) {
        const mutated = await applyMutation(post, sB, cand, client);
        const check = withScenario(classifyMutation({
          httpStatus: mutated.httpStatus,
          body: mutated.body,
          valueBefore: mutated.valueBefore,
          valueAfter: mutated.valueAfter,
          factorLabel: cand.label,
          nodeId: cand.id,
        }), sB);
        lastCheck = check;
        if (check.status === 'green') {
          mutationGreen = true;
          mutatedTarget = cand;
          break;
        }
      }
      checks.push(lastCheck!);
    } else {
      checks.push({
        id: 'mutation',
        title: 'Deterministic mutation → graph value changes',
        status: 'red',
        detail: 'no mutable factor node (with numeric observed_state) found in the drafted graph',
        scenario_id: sB,
      });
    }

    // ── C5: stale coaching question → safe degrade (no confident advice) ──
    const staleQuestion = 'Based on the current analysis, which option should we go with?';
    let c5 = await post('stale_question', sB, (turn_id) => ({
      kind: 'message',
      turn_id,
      scenario_id: sB,
      stage: 'decide',
      message: staleQuestion,
      turn_class: 'decide',
      source: 'composer',
    }));
    // Guard: if state unexpectedly reads fresh, re-establish stale with a 2nd
    // mutation (on the factor that worked) before testing rerun (per the brief).
    if (mutatedTarget && freshnessOf(c5.body) === 'fresh') {
      await applyMutation(post, sB, mutatedTarget, client, /*second*/ true);
      c5 = await post('stale_question_retry', sB, (turn_id) => ({
        kind: 'message',
        turn_id,
        scenario_id: sB,
        stage: 'decide',
        message: staleQuestion,
        turn_class: 'decide',
        source: 'composer',
      }));
    }
    checks.push(withScenario(classifyStaleDegrade({ httpStatus: c5.status, body: c5.body, knownStale: mutationGreen }), sB));

    // ── C6: forced rerun clears stale → fresh ──
    const c6 = await post('rerun', sB, (turn_id) => ({
      kind: 'message',
      turn_id,
      scenario_id: sB,
      stage: 'analyse',
      message: 'Run analysis.',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    }));
    const runFacts2 = await safeRunAnalysisCount(client, sB);
    checks.push(withScenario(classifyRerunFresh({ httpStatus: c6.status, body: c6.body, runAnalysisFactCount: runFacts2 }), sB));

    // ── Field-safety aggregate (Tier-2/3 absence across ALL turns) ──
    checks.push(classifyFieldSafety({ allBlocked, turnsScanned }));

    // ── Telemetry / attribution ──
    checks.push(buildAttributionCheck(attributions));
  } finally {
    // ── Cleanup (always) ── wrapped so a throw here cannot replace the
    // original error or skip the report render. withRetry returns errors as
    // values, but defend the whole chain anyway.
    try {
      const { cleanup, residual } = await cleanupAndVerify(access, scenarioIds);
      const cleanupLines = cleanup.results.map(
        (r) =>
          `${r.table} (${r.scopeColumn}): deleted ${r.deleted}` +
          (r.tableMissing ? ' [table absent]' : '') +
          (r.error ? ` [ERROR: ${r.error}]` : ''),
      );
      const residualLines = residual.results.map(
        (r) =>
          `${r.table}: residual ${r.residual}` +
          (r.tableMissing ? ' [table absent]' : '') +
          (r.error ? ` [ERROR: ${r.error}]` : ''),
      );
      checks.push({
        id: 'cleanup',
        title: 'Exact-ID cleanup → zero residual',
        status: residual.clean && !cleanup.hadError ? 'green' : 'red',
        detail: residual.clean && !cleanup.hadError
          ? `deleted ${cleanup.totalDeleted} row(s); 0 residual across all scenario-keyed tables`
          : `cleanup incomplete: residual=${residual.totalResidual}, cleanupError=${cleanup.hadError}, residualError=${residual.hadError}`,
        evidence: [...cleanupLines, '— residual —', ...residualLines],
      });
      cleanupLinesOut = cleanupLines;
      residualLinesOut = residualLines;
    } catch (err) {
      const msg = redact(err);
      checks.push({
        id: 'cleanup',
        title: 'Exact-ID cleanup → zero residual',
        status: 'red',
        detail: `cleanup threw — MANUAL CLEANUP REQUIRED for scenarios ${scenarioIds.join(', ')}: ${msg}`,
        evidence: [`error: ${msg}`],
      });
      cleanupLinesOut = [`cleanup threw: ${msg}`];
      residualLinesOut = [`UNKNOWN — verify/clean manually for ${scenarioIds.join(', ')}`];
    }
  }

  const finishedAt = new Date().toISOString();
  const header: ReportHeader = {
    command: 'pnpm assurance:v5:staging',
    runId: cfg.scenarioPrefix,
    startedAt,
    finishedAt,
    baseUrl: cfg.baseUrl,
    environment: local ? 'localhost' : 'cee-staging',
    servingSha,
    healthzOk: healthz.body?.ok,
    degraded: healthz.body?.degraded,
    version: healthz.body?.version,
    ...(cfg.expectedBuild ? { expectedBuild: cfg.expectedBuild } : {}),
    flags,
    scenarioIds,
  };

  const reportMarkdown = renderReport(header, checks, cleanupLinesOut, residualLinesOut);
  const counts = countRag(checks);
  const exitCode = counts.red > 0 ? 1 : 0;
  return { exitCode, phase: 'ran', reportMarkdown, checks, scenarioIds };

  // ── locals ──
  function blockedOutcome(reason: string): AssuranceOutcome {
    const finished = new Date().toISOString();
    const blockedCheck: CheckResult = {
      id: 'blocked',
      title: 'Assurance run could not start',
      status: 'red',
      detail: reason,
    };
    const header: ReportHeader = {
      command: 'pnpm assurance:v5:staging',
      runId: cfg.scenarioPrefix,
      startedAt,
      finishedAt: finished,
      baseUrl: cfg.baseUrl,
      environment: 'unknown',
      servingSha: 'unknown',
      healthzOk: undefined,
      degraded: undefined,
      version: undefined,
      flags: [],
      scenarioIds: [],
    };
    const md = renderReport(header, [blockedCheck], ['(no scenarios created)'], ['(no scenarios created)']);
    return { exitCode: 3, phase: 'blocked', reportMarkdown: md, checks: [blockedCheck], scenarioIds: [], blockedReason: reason };
  }
}

function withScenario(check: CheckResult, scenarioId: string): CheckResult {
  return { ...check, scenario_id: scenarioId };
}

async function applyMutation(
  post: (step: string, sid: string, build: (turnId: string) => TurnPayload) => Promise<FetchResult>,
  scenarioId: string,
  target: FactorTarget,
  client: ReturnType<typeof createSupabaseClient>,
  second = false,
): Promise<{ httpStatus: number; body: TurnResponse | undefined; valueBefore: number | null; valueAfter: number | null }> {
  // Read `before` fresh so a second mutation compares against the real
  // current value (after the first), not the stale original.
  const before = (await safeFactorValue(client, scenarioId, target.id)) ?? target.currentValue;
  const mutValue = chooseMutationValue(before, target.cap);
  const formatted = formatMutationValue(mutValue, target.unit);
  const step = second ? 'set_factor_value_2' : 'set_factor_value';
  const r = await post(step, scenarioId, (turn_id) => ({
    kind: 'message',
    turn_id,
    scenario_id: scenarioId,
    stage: 'frame',
    message: `Set the ${target.label} factor to ${formatted}.`,
    turn_class: 'frame',
    source: 'composer',
    selected_elements: { node_ids: [target.id] },
  }));
  let after = await safeFactorValue(client, scenarioId, target.id);
  // One retry with a more explicit instruction (same scale-correct value) if
  // the value didn't move — covers a phrasing-fragile deterministic pre-route.
  if (after !== null && before !== null && after === before) {
    await post(`${step}_retry`, scenarioId, (turn_id) => ({
      kind: 'message',
      turn_id,
      scenario_id: scenarioId,
      stage: 'frame',
      message: `Update the ${target.label} factor: set its value to ${formatted}.`,
      turn_class: 'frame',
      source: 'composer',
      selected_elements: { node_ids: [target.id] },
    }));
    after = await safeFactorValue(client, scenarioId, target.id);
  }
  return { httpStatus: r.status, body: r.body, valueBefore: before, valueAfter: after };
}

// ── Safe DB read wrappers (return null on failure so a DB hiccup degrades a
//    check to amber/red rather than crashing the whole run before cleanup) ──

async function safeFactTotal(client: ReturnType<typeof createSupabaseClient>, sid: string): Promise<number | null> {
  try {
    return (await summariseHandlerFacts(client, sid)).total;
  } catch {
    return null;
  }
}
async function safeRunAnalysisCount(client: ReturnType<typeof createSupabaseClient>, sid: string): Promise<number | null> {
  try {
    return (await summariseHandlerFacts(client, sid)).byActionType['run_analysis'] ?? 0;
  } catch {
    return null;
  }
}
async function safeHash(client: ReturnType<typeof createSupabaseClient>, sid: string): Promise<string | null> {
  try {
    return await latestRunAnalysisHash(client, sid);
  } catch {
    return null;
  }
}
async function safeReadGraph(client: ReturnType<typeof createSupabaseClient>, sid: string) {
  try {
    return await readPersistedGraph(client, sid);
  } catch {
    return null;
  }
}
async function safeFactorValue(
  client: ReturnType<typeof createSupabaseClient>,
  sid: string,
  nodeId: string,
): Promise<number | null> {
  try {
    return readFactorValue(await readPersistedGraph(client, sid), nodeId);
  } catch {
    return null;
  }
}

function buildAttributionCheck(attributions: readonly Attribution[]): CheckResult {
  const allHaveKeys = attributions.every((a) => a.turn_id && a.scenario_id);
  const withReqId = attributions.filter((a) => a.request_id).length;
  const lines = attributions.map(
    (a) => `${a.step}: scenario_id=${a.scenario_id} turn_id=${a.turn_id}${a.request_id ? ` request_id=${a.request_id}` : ''}`,
  );
  return {
    id: 'attribution',
    title: 'Request-ID / telemetry attribution captured',
    status: allHaveKeys ? 'green' : 'amber',
    detail: allHaveKeys
      ? `captured turn_id + scenario_id for all ${attributions.length} turns (telemetry correlation keys)` +
        (withReqId > 0 ? `; ${withReqId} carried a wire request_id` : '; wire request_id not on success envelopes — correlate by turn_id/scenario_id')
      : 'some turns missing correlation keys',
    evidence: lines,
  };
}

/**
 * Capture flag/serving state. /healthz gives build/ok/degraded/version (wire).
 * /diagnostics (best-effort, may require diagnostics auth) gives
 * grounding/critique/clarifier. The V5 coaching / null-graph flags are NOT
 * wire-exposed — recorded as deploy-config with the behavioural check that
 * confirms them.
 */
async function captureFlags(baseUrl: string, apiKey: string | undefined): Promise<FlagCapture[]> {
  const flags: FlagCapture[] = [];
  // Best-effort /diagnostics.
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/diagnostics`, {
      method: 'GET',
      headers: apiKey ? { 'x-olumi-assist-key': apiKey } : {},
    });
    if (res.ok) {
      const body = (await res.json()) as { feature_flags?: Record<string, unknown> };
      const ff = body.feature_flags ?? {};
      for (const k of ['grounding', 'critique', 'clarifier']) {
        if (k in ff) flags.push({ name: k, value: String(ff[k]), source: 'wire' });
      }
    } else {
      flags.push({ name: 'feature_flags(/diagnostics)', value: `unavailable (HTTP ${res.status})`, source: 'unavailable' });
    }
  } catch {
    flags.push({ name: 'feature_flags(/diagnostics)', value: 'unavailable (fetch failed)', source: 'unavailable' });
  }
  // Not wire-exposed — captured as deploy-config; behaviour is verified by the checks.
  flags.push({
    name: 'CEE_COACHING_CONTEXT_PROMPT_ENABLED',
    value: 'not wire-exposed (behaviour verified by stale-degrade check)',
    source: 'deploy-config',
  });
  flags.push({
    name: 'CEE_RUN_ANALYSIS_NULL_GRAPH_RECOVERABLE',
    value: 'not wire-exposed (behaviour verified by graphless check)',
    source: 'deploy-config',
  });
  flags.push({
    name: 'CEE_RUN_ANALYSIS_READY_GUARD',
    value: 'not wire-exposed',
    source: 'deploy-config',
  });
  return flags;
}
