/**
 * Opt-in, six-case Factor Quantification witness. Example (credentials/model
 * must already be supplied by the caller; this script never reads env files):
 *   node --import tsx scripts/semantic-contract/factor-quantification-live.ts \
 *     --live --out /absolute/path/to/a-new-evidence-directory
 *
 * Real estimation adapter/parser/adoption and commitDirectAnswer execute.
 * Rich input uses records replay + the live graph/options projection. Other
 * inputs are authored controls. Persistence is a local atomic JSON file,
 * NOT Supabase, model-version history, the deployed pipeline, or a UI witness.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual, promisify } from 'node:util';
import type { GraphV3T, NodeV3T } from '../../src/schemas/cee-v3.js';
import type { SessionStore, SessionTurnWrite } from '../../src/orchestrator-v5/session/store.js';
import type { FactorEstimate } from '../../src/cee/factor-quantification/types.js';

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const USAGE = 'Use --live --out <new-directory>. Supply ANTHROPIC_API_KEY and CEE_MODEL_FACTOR_QUANTIFICATION in the process environment; do not provide Supabase credentials.';

/** A recorded strict failure is a FAILED case, even when fallback is zero. */
export function passesStrictQuantificationEvaluation(metrics: { fallback: number; strict_evaluation_pass?: boolean }): boolean {
  return metrics.strict_evaluation_pass === true && metrics.fallback === 0;
}

/** This scientific expectation is stricter than structured-output validity. */
export function matchesRequiredUnknown(answer: FactorEstimate | undefined): boolean {
  return answer?.estimate_type === 'unknown';
}

/** Read-only binding. No shell, credential discovery, or raw diff output. */
export async function captureSourceIdentity() {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const run = promisify(execFile);
  const opts = { cwd: repoRoot, encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 };
  const [head, status, diff, untracked] = await Promise.all([
    run('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], opts),
    run('git', ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], opts),
    run('git', ['--no-optional-locks', 'diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--'], opts),
    run('git', ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard', '-z', '--', 'src', 'scripts'], opts),
  ]);
  const schemaPath = join(repoRoot, 'node_modules/@talchain/schemas');
  const packageBytes = await readFile(join(schemaPath, 'package.json'));
  const installed = JSON.parse(packageBytes.toString('utf8')) as { name: string; version: string };
  if (installed.name !== '@talchain/schemas' || installed.version !== '0.53.0') {
    throw new Error('The installed shared schema must be @talchain/schemas 0.53.0 for this witness.');
  }
  const vendorPath = 'vendor/talchain-schemas-0.53.0.tgz';
  // Untracked source needs its own content binding: git diff HEAD omits it.
  // Non-source untracked paths are still visible in the complete status below.
  const untrackedSources = await Promise.all(untracked.stdout.split('\0')
    .filter(path => /\.(?:ts|js|mjs|cjs)$/.test(path)).sort()
    .map(async path => ({ path, sha256: sha256(await readFile(join(repoRoot, path))) })));
  const dirty = status.stdout.length > 0;
  return {
    captured_at: new Date().toISOString(), git_head: head.stdout.trim(),
    source_state: dirty ? 'dirty_worktree_snapshot_not_commit_only' : 'clean_committed_checkout',
    git_status_porcelain: status.stdout.split('\0').filter(Boolean),
    tracked_diff_sha256: sha256(diff.stdout), tracked_diff_bytes: Buffer.byteLength(diff.stdout, 'utf8'),
    tracked_diff_scope: 'git diff HEAD, staged and unstaged tracked changes; raw diff is not persisted',
    untracked_source_hash_scope: '.ts/.js/.mjs/.cjs beneath src and scripts', untracked_source_files: untrackedSources,
    runner_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    installed_schema: { name: installed.name, version: installed.version,
      package_json_sha256: sha256(packageBytes),
      factor_quantification_module_sha256: sha256(await readFile(join(schemaPath, 'dist/factor-quantification.js'))),
      graph_module_sha256: sha256(await readFile(join(schemaPath, 'dist/graph.js'))) },
    vendor_schema: { path: vendorPath, sha256: sha256(await readFile(join(repoRoot, vendorPath))) },
  };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

/** JSON has no representation for an undefined object property. Ignore ONLY
 * that distinction; do not JSON-roundtrip the comparison, which could also
 * coerce NaN/Infinity to null and conceal a real transport change. */
export function quantityForWire(node: NodeV3T | undefined): unknown {
  const omitUndefined = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(omitUndefined);
    if (value !== null && typeof value === 'object'
      && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefined(item)]));
    }
    return value;
  };
  return omitUndefined({ observed_state: node?.observed_state, prior: node?.prior });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    live: { type: 'boolean' }, out: { type: 'string' }, help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (values.help) { console.log(USAGE); return; }
  if (!values.live || !values.out) throw new Error(USAGE);
  // Presence checks only. Never print, discover, source, or persist a credential.
  if (!process.env.ANTHROPIC_API_KEY || !process.env.CEE_MODEL_FACTOR_QUANTIFICATION) {
    throw new Error('Explicit Anthropic credential and quantification model are required. No env file is loaded.');
  }
  if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Refusing live witness with Supabase configuration present: this runner writes local evidence only.');
  }
  if (process.env.LLM_FAILOVER_PROVIDERS?.trim()) {
    throw new Error('Refusing live witness with provider failover: this corpus must use one explicitly selected model.');
  }
  const out = resolve(values.out);
  try { await stat(out); throw new Error('Output directory already exists; choose a new directory.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  // These process-local settings name the scope of this witness. They neither
  // edit any env file nor activate the capability in a deployed service.
  process.env.OLUMI_ENV = 'staging';
  process.env.CEE_FACTOR_QUANTIFICATION_ENABLED = 'true';
  process.env.CEE_MODEL_VERSIONS_ENABLED = 'false';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  process.env.LOG_LEVEL = 'error';

  const sourceIdentity = await captureSourceIdentity();

  const { GraphV3 } = await import('../../src/schemas/cee-v3.js');
  const { selectFactorQuantity } = await import('@talchain/schemas');
  const { getAdapterWithResolution } = await import('../../src/adapters/llm/router.js');
  const { STRUCTURED_OUTPUTS_CAPABLE_MODELS } = await import('../../src/adapters/llm/anthropic-model-capabilities.js');
  const { quantifyDraftFactors } = await import('../../src/cee/factor-quantification/index.js');
  const { comparisonFactorRequirements, selectQuantificationGaps } = await import('../../src/cee/factor-quantification/select.js');
  const { buildFactorQuantificationPrompt, FACTOR_QUANTIFICATION_SYSTEM_PROMPT } = await import('../../src/cee/factor-quantification/prompt.js');
  const { buildCanonicalAnalysisReadyFromGraph } = await import('../../src/orchestrator/tools/analysis-ready-helper.js');
  const { replayRecordSet } = await import('../../src/cee/draft/records/replay.js');
  const { projectGraphAndOptionsToV3 } = await import('../../src/cee/transforms/schema-v3.js');
  const { createNoopSessionStore } = await import('../../src/orchestrator-v5/session/__tests__/fixtures.js');
  const { commitDirectAnswer } = await import('../../src/orchestrator-v5/commit.js');
  const { liveRecordsFigureRichControl, liveRecordsPlanningDayControl, figurePoor, diagnostic, insufficientInformation, suppliedValueControl } =
    await import('../../src/cee/factor-quantification/__tests__/fixtures/corpus.js');

  // Resolve with the SAME configured router as the wrapper, without making a
  // model call. A fixture adapter or another model cannot earn a live witness.
  const { resolution } = getAdapterWithResolution('factor_quantification');
  if (resolution.provider !== 'anthropic'
    || resolution.resolved_model !== process.env.CEE_MODEL_FACTOR_QUANTIFICATION
    || !STRUCTURED_OUTPUTS_CAPABLE_MODELS.has(resolution.resolved_model)) {
    throw new Error('The configured quantification task must resolve to the explicitly supplied supported Anthropic model.');
  }
  await mkdir(out, { recursive: true });

  function fileStore(path: string): SessionStore {
    const load = async () => {
      const saved = JSON.parse(await readFile(path, 'utf8')) as {
        graph: unknown; briefText: string | null;
      };
      return { graph: saved.graph, briefText: saved.briefText };
    };
    return {
      ...createNoopSessionStore(),
      async append(write: SessionTurnWrite) {
        const id = randomUUID();
        await atomicJson(path, { storage: 'local_file_session_fixture', source_identity: sourceIdentity, id,
          graph: write.graph ?? null, briefText: write.briefText ?? null, write });
        return { id };
      },
      async loadGraphAndBriefText() { return load(); },
      async loadGraph() { return (await load()).graph; },
    };
  }

  type Case = {
    id: string; input_kind: 'records_replay' | 'authored_control'; brief: string;
    build(): Promise<{ graph: GraphV3T; replay?: unknown }>;
    expected: 'planning_point' | 'unknown' | 'no_call_diagnostic' | 'no_call_protected';
    protected_label?: string;
    target_label?: string; target_id?: string;
  };
  const suppliedGraph = GraphV3.parse(structuredClone(suppliedValueControl.graph));
  // Unlike the diagnostic, this opposite control actually reads the protected
  // churn baseline in a comparison. The options act on a DIFFERENT factor.
  const policyFactor = GraphV3.parse(structuredClone(figurePoor.graph)).nodes.find(n => n.id === 'fac_automation')!;
  suppliedGraph.nodes.push({ ...policyFactor, id: 'fac_followup', label: 'Additional follow-up',
    observed_state: { value: 0, source: 'brief_extraction', extractionType: 'explicit' } });
  for (const [id, label, value] of [['opt_keep', 'Keep current contact cadence', 0], ['opt_followup', 'Add follow-up', 1]] as const) {
    suppliedGraph.nodes.push({ id, kind: 'option', label, is_baseline: value === 0,
      interventions: { fac_followup: { value, source: 'brief_extraction',
        target_match: { node_id: 'fac_followup', match_type: 'exact_id', confidence: 'high' } } } });
    suppliedGraph.edges.push({ ...structuredClone(figurePoor.graph.edges[0]!), from: id, to: 'fac_followup' });
  }
  suppliedGraph.edges.push({ ...structuredClone(figurePoor.graph.edges[2]!), from: 'fac_followup', to: 'goal_retention' });
  const authored = (graph: GraphV3T) => async () => ({ graph: GraphV3.parse(structuredClone(graph)) });
  const cases: Case[] = [
    { id: 'records_figure_rich', input_kind: 'records_replay', brief: liveRecordsFigureRichControl.brief,
      expected: 'unknown', target_label: liveRecordsFigureRichControl.missing_label,
      protected_label: liveRecordsFigureRichControl.protected_label,
      async build() {
        const replay = await replayRecordSet(liveRecordsFigureRichControl.records, { brief: liveRecordsFigureRichControl.brief });
        if (!replay.ok) throw new Error('Records replay failed');
        const projection = projectGraphAndOptionsToV3(replay.graph as Parameters<typeof projectGraphAndOptionsToV3>[0],
          { brief: liveRecordsFigureRichControl.brief });
        return { graph: GraphV3.parse(projection.graph), replay };
      } },
    { id: 'records_planning_day', input_kind: 'records_replay', brief: liveRecordsPlanningDayControl.brief,
      expected: 'planning_point', target_label: liveRecordsPlanningDayControl.missing_label,
      protected_label: liveRecordsPlanningDayControl.protected_label,
      async build() {
        const fixture = liveRecordsPlanningDayControl;
        const replay = await replayRecordSet(fixture.records, { brief: fixture.brief });
        if (!replay.ok) throw new Error('Records replay failed');
        return { graph: GraphV3.parse(projectGraphAndOptionsToV3(
          replay.graph as Parameters<typeof projectGraphAndOptionsToV3>[0], { brief: fixture.brief },
        ).graph), replay };
      } },
    { id: figurePoor.id, input_kind: 'authored_control', brief: figurePoor.brief,
      expected: 'unknown', target_id: 'fac_preparedness', build: authored(figurePoor.graph) },
    { id: diagnostic.id, input_kind: 'authored_control', brief: diagnostic.brief,
      expected: 'no_call_diagnostic', build: authored(diagnostic.graph) },
    { id: insufficientInformation.id, input_kind: 'authored_control', brief: insufficientInformation.brief,
      expected: 'unknown', target_id: 'fac_conversion', build: authored(insufficientInformation.graph) },
    { id: suppliedValueControl.id, input_kind: 'authored_control',
      brief: `${suppliedValueControl.brief} Compare keeping current contact cadence (additional follow-up 0) with adding follow-up (additional follow-up 1). These options do not set the current churn rate.`,
      expected: 'no_call_protected', target_id: 'fac_churn', build: authored(suppliedGraph) },
  ];
  const scope = {
    witness: 'live_estimator_with_local_file_commit_reload',
    first_pass: 'fixed_records_replay_or_authored_control_not_a_live_draft_model_call',
    records_projection: 'replayRecordSet_then_projectGraphAndOptionsToV3',
    persistence: 'real_commitDirectAnswer_with_injected_local_file_SessionStore_not_Supabase',
    model_version_history: 'disabled_for_this_local_witness',
    rolling_summary: 'not_witnessed_no_Supabase_configuration',
    provider_grammar_enforcement: 'unobserved_adapter_does_not_report_fallback',
    science_and_ui: 'not_witnessed_by_this_runner',
  };
  type Outcome = Awaited<ReturnType<typeof quantifyDraftFactors>>;
  const results: Array<{ id: string; passed: boolean; failures: string[]; metrics?: Outcome['metrics'];
    protected_values_changed: number; estimates: number; provenance_survived: number; uncertainty_survived: number;
    case_latency_ms: number; persistence_latency_ms: number | null }> = [];

  // Independent cases continue after a target failure, so an all-unknown result
  // cannot be concealed by stopping at the first case or discarding its output.
  for (const item of cases) {
    const startedAt = Date.now();
    const failures: string[] = [];
    const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
    let outcome: Outcome | undefined;
    let stage = 'input_projection';
    let changed = 0; let estimateCount = 0; let provenanceSurvived = 0; let uncertaintySurvived = 0;
    let persistenceMs: number | null = null;
    let evidence: Record<string, unknown> = { case_id: item.id, scope, source_identity: sourceIdentity,
      input_kind: item.input_kind, brief: item.brief };
    try {
      const built = await item.build();
      const graph = built.graph;
      const target = graph.nodes.find(n => item.target_id ? n.id === item.target_id : n.label === item.target_label);
      const before = buildCanonicalAnalysisReadyFromGraph(graph);
      const options = (before?.options ?? []).map(option => ({ ...option, id: option.option_id }));
      const requirements = comparisonFactorRequirements(graph, options, before?.goal_node_id);
      const selection = selectQuantificationGaps(graph, requirements);
      const basis = [{ id: 'brief', text: item.brief, factor_ids: selection.gaps.map(g => g.factor_id), kind: 'brief_context' as const }];
      const requestInput = { brief: item.brief, gaps: selection.gaps, context: { basis, nodes: graph.nodes, relationships: graph.edges } };
      const requestHash = sha256(`${FACTOR_QUANTIFICATION_SYSTEM_PROMPT}\n${buildFactorQuantificationPrompt(requestInput)}`);
      const requestId = `factor-live-${randomUUID()}`;
      const scenarioId = randomUUID(); const turnId = randomUUID();
      const protectedNodes = graph.nodes.filter(n => selectFactorQuantity(n).protected);
      evidence = { ...evidence, request_id: requestId, scenario_id: scenarioId, turn_id: turnId,
        input_graph: graph, ...(built.replay ? { records_replay: built.replay } : {}), requirements, selection,
        request_input: requestInput, expected_request_hash: selection.gaps.length ? requestHash : null };
      if (item.expected === 'no_call_protected') {
        check(requirements.some(r => r.factor_id === target?.id), 'Protected churn must actually be a required comparison baseline');
        check(selection.protected_ids.includes(target!.id), 'Source authority must protect the required churn input');
      }
      stage = 'quantification';
      outcome = await quantifyDraftFactors({ graph, brief: item.brief, requestId,
        requestStartMs: Date.now(), options, targetId: before?.goal_node_id });
      evidence = { ...evidence, parsed_model_result: outcome.model, metrics: outcome.metrics, canonical_graph: outcome.graph };
      check(outcome.metrics.fallback === 0, 'No required input may remain generic fallback');
      check(passesStrictQuantificationEvaluation(outcome.metrics), 'Strict Factor Quantification evaluation must pass');
      check(outcome.metrics.protected_values_changed === 0, 'Stage reports changed protected values');
      if (outcome.model.metadata.call_made) {
        check(outcome.model.metadata.provider === 'anthropic', 'Expected an actual Anthropic adapter call');
        check(outcome.model.metadata.model === resolution.resolved_model, 'Served model must equal configured model');
        check(outcome.model.metadata.request_hash === requestHash, 'Exact rendered request hash must match the executing wrapper');
      }
      const noCall = item.expected.startsWith('no_call_');
      check(outcome.model.metadata.call_made === !noCall, noCall ? 'This control must not call the estimator' : 'Missing target must trigger the estimator');
      if (!noCall) check(outcome.model.kind === 'ok', 'Requested target must receive a parsed model answer');
      const parsed = outcome.model.kind === 'ok' ? outcome.model.estimates : [];
      const targetEstimate = parsed.find(estimate => estimate.factor_id === target?.id);
      if (item.protected_label) {
        const stated = graph.nodes.find(n => n.label === item.protected_label);
        check(stated?.observed_state?.value === 0.12 && stated.observed_state.source === 'brief_extraction',
          'The records path must preserve the user-stated .12 before estimation');
      }
      if (item.expected === 'planning_point') {
        check(targetEstimate?.estimate_type === 'estimated' && targetEstimate.value === 0.75 && targetEstimate.std === 0.05,
          'Planning-day target must derive .75 from the historical mean and retain the matching .05 daily spread');
      } else if (item.expected === 'unknown') {
        check(matchesRequiredUnknown(targetEstimate), 'Insufficient quantitative calibration must produce a model-authored unknown');
      } else if (item.expected === 'no_call_diagnostic') {
        check(!outcome.graph.nodes.some(n => n.kind === 'option'), 'Diagnostic must not gain options');
        check(isDeepStrictEqual(outcome.graph, graph), 'Diagnostic without comparison inputs must stay unchanged');
      }

      const statePath = join(out, `${item.id}.session.json`);
      const commitStart = Date.now();
      stage = 'canonical_commit';
      const committed = await commitDirectAnswer({ response_version: 2, assistant_text: 'Local Factor Quantification witness.',
        blocks: [], suggested_actions: [], insights: [], stage_indicator: 'frame' }, {
        scenario_id: scenarioId, turn_id: turnId, turn_class: 'direct_answer', handler_id: null,
        request_hash: `sha256:${sha256(item.brief)}`, llm_calls_used: outcome.model.metadata.call_made ? 1 : 0,
        duration_ms: Date.now() - startedAt, handler_facts: [], graph: outcome.graph, briefText: item.brief,
        userMessage: item.brief,
      }, fileStore(statePath));
      persistenceMs = Date.now() - commitStart;
      // New store instance, disk read and schema parse: never reuse the graph
      // passed to append as a purported readback.
      stage = 'file_readback';
      const loaded = await fileStore(statePath).loadGraphAndBriefText(scenarioId);
      const reloaded = GraphV3.parse(loaded.graph);
      check(committed.graphPersisted === true, 'Real commit must report graph persisted');
      check(loaded.briefText === item.brief, 'Supplied brief must survive file readback');
      for (const original of protectedNodes) {
        const mutated = !isDeepStrictEqual(quantityForWire(original), quantityForWire(outcome.graph.nodes.find(n => n.id === original.id)))
          || !isDeepStrictEqual(quantityForWire(original), quantityForWire(reloaded.nodes.find(n => n.id === original.id)));
        if (mutated) changed += 1;
      }
      check(changed === 0, 'Protected quantities must remain byte-equivalent through adoption and persistence');
      for (const answer of parsed) {
        const canonical = outcome.graph.nodes.find(n => n.id === answer.factor_id);
        const persistedNode = reloaded.nodes.find(n => n.id === answer.factor_id);
        check(isDeepStrictEqual(quantityForWire(canonical), quantityForWire(persistedNode)), `Quantity readback differs for ${answer.factor_id}`);
        const carrier = answer.estimate_type === 'estimated' && answer.distribution !== 'uniform'
          ? persistedNode?.observed_state : persistedNode?.prior;
        const survived = carrier?.source === 'cee_inference'
          && isDeepStrictEqual(carrier.reasoning, { rationale: answer.reasoning, context_basis: answer.basis });
        check(survived, `Model provenance/reasoning did not survive for ${answer.factor_id}`);
        if (answer.estimate_type === 'unknown') {
          check(persistedNode?.observed_state === undefined && isDeepStrictEqual(persistedNode?.prior,
            { prior_is_unquantified: true, source: 'cee_inference', reasoning: { rationale: answer.reasoning, context_basis: answer.basis } }),
          `Unknown acquired a numeric claim for ${answer.factor_id}`);
        } else {
          estimateCount += 1;
          if (survived) provenanceSurvived += 1;
          const prior = persistedNode?.prior;
          const exact = answer.distribution === 'uniform'
            ? persistedNode?.observed_state === undefined && prior !== undefined && 'distribution' in prior && prior.distribution === 'uniform'
              && prior.range_min === answer.range_min && prior.range_max === answer.range_max
            : persistedNode?.observed_state?.value === answer.value && persistedNode.observed_state.std === answer.std;
          if (exact) uncertaintySurvived += 1;
          check(exact, `Estimate value/range/uncertainty did not survive for ${answer.factor_id}`);
        }
      }
      evidence = { ...evidence, reloaded_graph: reloaded, session_file: statePath,
        commit: { performed: committed.performed, graph_persisted: committed.graphPersisted,
          persisted_row_id: committed.persisted_row_id, persistence_latency_ms: persistenceMs },
        final_readiness: buildCanonicalAnalysisReadyFromGraph(reloaded) };
    } catch (error) {
      // An upstream error may contain credentials or request internals. Never
      // print/store its message or stack. Structured model-call outcomes above
      // contain the safe operational reason when the wrapper handled it.
      failures.push(`Case execution failed at ${stage} (${error instanceof Error ? error.name : 'unknown_error'})`);
    }
    const result = { id: item.id, passed: failures.length === 0, failures, metrics: outcome?.metrics,
      protected_values_changed: changed, estimates: estimateCount, provenance_survived: provenanceSurvived,
      uncertainty_survived: uncertaintySurvived, case_latency_ms: Date.now() - startedAt, persistence_latency_ms: persistenceMs };
    results.push(result);
    await atomicJson(join(out, `${item.id}.json`), { ...evidence, result });
    console.log(`${item.id}: ${result.passed ? 'PASS' : 'FAIL'}; gaps=${outcome?.metrics.gaps_entering ?? 'unavailable'}; estimated=${outcome?.metrics.estimated ?? 0}; unknown=${outcome?.metrics.explicit_unknown ?? 0}; fallback=${outcome?.metrics.fallback ?? 'unavailable'}`);
  }

  const sum = (pick: (item: typeof results[number]) => number) => results.reduce((total, item) => total + pick(item), 0);
  const gaps = sum(item => item.metrics?.gaps_entering ?? 0);
  const estimates = sum(item => item.metrics?.estimated ?? 0);
  const unknown = sum(item => item.metrics?.explicit_unknown ?? 0);
  const fallback = sum(item => item.metrics?.fallback ?? 0);
  const percent = (count: number, denominator: number) => denominator ? 100 * count / denominator : null;
  const summary = { generated_at: new Date().toISOString(), scope, source_identity: sourceIdentity,
    model: resolution.resolved_model, provider: resolution.provider, cases: results,
    passed: results.every(item => item.passed), materiality: 'required_input_impact_unassessed',
    totals: { required_inputs: sum(item => item.metrics?.required_inputs ?? 0),
      gaps_entering: gaps, fallback_entering: sum(item => item.metrics?.fallback_entering ?? 0),
      estimated: estimates, model_unknown: sum(item => item.metrics?.model_unknown ?? 0), explicit_unknown: unknown, fallback,
      operational_unresolved: sum(item => item.metrics?.operational_unresolved ?? 0),
      skipped_gaps: sum(item => item.metrics?.skipped_gaps ?? 0),
      unresolved_origin: sum(item => item.metrics?.unresolved_origin.length ?? 0),
      estimated_percent: percent(estimates, gaps), explicit_unknown_percent: percent(unknown, gaps), fallback_percent: percent(fallback, gaps),
      protected_values_changed: sum(item => item.protected_values_changed),
      estimate_provenance_survival_percent: percent(sum(item => item.provenance_survived), sum(item => item.estimates)),
      estimate_uncertainty_survival_percent: percent(sum(item => item.uncertainty_survived), sum(item => item.estimates)),
      adapter_calls: sum(item => Number(item.metrics?.call.call_made ?? false)),
      input_tokens: sum(item => item.metrics?.call.input_tokens ?? 0), output_tokens: sum(item => item.metrics?.call.output_tokens ?? 0),
      adapter_latency_ms: sum(item => item.metrics?.call.latency_ms ?? 0),
      persistence_latency_ms: sum(item => item.persistence_latency_ms ?? 0), cost_usd: null },
    interpretation: 'Parsed/adopted estimates are candidates for independent semantic review; schema and basis-ID compliance do not prove factual correctness.',
    superseded_evaluation: 'The banked run at 8deefc63f79c6e1afa93da2387e752824a30cf6c passed the old pipeline checks, but its figure-poor 0.35/std 0.15 was semantically flagged as unsupported. The old 66.7% adoption rate is not a defensible-quality rate. This unchanged brief now requires unknown; archived artifacts are not rewritten.',
    instrument_warnings: estimates === 0 && gaps > 0 ? ['All requested cases returned no adopted estimate; the explicit planning-day positive target has failed.'] : [],
  };
  await atomicJson(join(out, 'summary.json'), summary);
  console.log(`Evidence written to ${out}; ${summary.passed ? 'all target checks passed' : 'target checks failed'}. Local file persistence only.`);
  if (!summary.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  // CLI/preflight errors above are authored safe messages. Runtime errors after
  // case start are captured without their raw message inside the case evidence.
  console.error(error instanceof Error && (error.message === USAGE || /^(Explicit Anthropic|Refusing live witness|Output directory|The configured quantification|The installed shared schema)/.test(error.message))
    ? error.message : 'Factor Quantification runner failed; no raw error details were logged.');
  process.exitCode = 1;
});
