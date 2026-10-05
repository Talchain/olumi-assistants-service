/**
 * Model Construction RECORDS harness (evaluation tooling, not product code). It drives the SERVED construction path:
 * `buildModelFromRecords` (what the served `build_model_from_brief` capability calls) with the route's OWN construction
 * transport, `constructionCallStructured` from `routes/agent-v1-turn.ts` (same request bytes, `whole_candidate` strict
 * schema, transport retry, provider policy and usage ledger), under the route's own `constructionDeadline` and
 * `OPENAI_ONLY('agent_v1_turn')` policy. Never a side client (DL, 5 Oct live 3×3).
 *
 * The registered graph then takes the register route's own store composition (projection → entity refs → the receipt
 * stamping `withRegisteredStatedDispositions`) and the cold read's own derivations (not-modelled manifest WITH the bound
 * stated-disposition rows, target testability, analysis admission). The output is shaped like a GET /graph body, so the
 * independent scorer reads it exactly as it reads a served wire capture.
 *
 *   live:    real Responses API calls through the served transport; each raw HTTP response is banked. A 429 aborts the
 *            process at once (exit 42) before any retry. A machine-wide counter caps the calls.
 *   replay:  `fetch` answers from the bank, in call order, so the served transport parses the banked bytes again.
 *   fixture: `fetch` answers with MC_FIXTURE (a DraftRecordSet JSON) as the model text. Zero provider calls (smoke).
 *
 * tsx tools/mc-replay/replay-records.ts --mode live|replay|fixture --brief <file> --bank <dir> --draw <n> --out <file>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const mode = arg('mode');
const briefPath = arg('brief');
const bank = arg('bank');
const draw = arg('draw');
const out = arg('out');
if ((mode !== 'live' && mode !== 'replay' && mode !== 'fixture') || !briefPath || !bank || !draw || !out) {
  console.error('usage: --mode live|replay|fixture --brief <file> --bank <dir> --draw <n> --out <file>');
  process.exit(2);
}
if (mode === 'live' && !(process.env.OPENAI_API_KEY ?? '').startsWith('sk-')) { console.error('live: OPENAI_API_KEY missing or without the sk- prefix'); process.exit(3); }
if (mode !== 'live') process.env.OPENAI_API_KEY = 'sk-harness-offline-never-sent';
const brief = readFileSync(briefPath, 'utf8').trim();
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const briefId = sha(brief).slice(0, 12);
mkdirSync(bank, { recursive: true });
const bankFile = (call: number): string => `${bank}/${briefId}-d${draw}-c${call}.json`;

// ── The transport seam: `fetch`, beneath the served transport. ─────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const RESPONSES = 'https://api.openai.com/v1/responses';
let callIndex = 0;
const calls: { call: number; request_sha256: string; schema_name: unknown; latency_ms: number; http_status: number; status: unknown; raw_text_chars: number }[] = [];
const rawTexts: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url !== RESPONSES) throw new Error(`harness: unexpected fetch ${url}`);
  callIndex += 1;
  const body = String(init?.body ?? '');
  const sent = JSON.parse(body) as { text?: { format?: { name?: unknown } } };
  const started = Date.now();
  let status = 200, rawBody: string;
  if (mode === 'live') {
    const capFile = process.env.MC_CALL_COUNTER ?? '';
    const cap = Number(process.env.MC_CALL_CAP ?? '0');
    if (capFile === '' || !(cap > 0)) throw new Error('live: MC_CALL_COUNTER and MC_CALL_CAP are required');
    const spent = existsSync(capFile) ? Number(readFileSync(capFile, 'utf8').trim() || '0') : 0;
    if (spent >= cap) throw new Error(`live: call budget exhausted (${spent}/${cap})`);
    writeFileSync(capFile, String(spent + 1));
    const r = await realFetch(input, init);
    status = r.status; rawBody = await r.text();
    if (status === 429) { console.error('ABORT: 429 from provider'); process.exit(42); }
    writeFileSync(bankFile(callIndex), JSON.stringify({ at: new Date().toISOString(), latency_ms: Date.now() - started, brief_sha256: sha(brief), request_sha256: sha(body), http_status: status, raw_body: rawBody }, null, 2));
  } else if (mode === 'replay') {
    const f = bankFile(callIndex);
    if (!existsSync(f)) throw new Error(`replay: no banked response ${f}`);
    const banked = JSON.parse(readFileSync(f, 'utf8')) as { request_sha256: string; http_status: number; raw_body: string };
    if (banked.request_sha256 !== sha(body)) replayDrift.push({ call: callIndex, banked: banked.request_sha256.slice(0, 12), now: sha(body).slice(0, 12) });
    status = banked.http_status; rawBody = banked.raw_body;
  } else {
    rawBody = JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: readFileSync(process.env.MC_FIXTURE ?? '', 'utf8') }] }] });
  }
  let parsedStatus: unknown = null, text = '';
  try {
    const j = JSON.parse(rawBody) as { status?: unknown; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
    parsedStatus = j.status ?? null;
    for (const item of j.output ?? []) if (item.type === 'message') for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
  } catch { /* the transport reports it */ }
  rawTexts.push(text);
  calls.push({ call: callIndex, request_sha256: sha(body).slice(0, 12), schema_name: sent.text?.format?.name ?? null, latency_ms: Date.now() - started, http_status: status, status: parsedStatus, raw_text_chars: text.length });
  return new Response(rawBody, { status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const replayDrift: { call: number; banked: string; now: string }[] = [];

// Imported AFTER the key is in the environment: the route's config reads it at load.
const { constructionCallStructured, constructionDeadline, CONSTRUCTION_TIMEOUT_REASON } = await import('../../src/routes/agent-v1-turn.js');
const { withRegisteredStatedDispositions } = await import('../../src/routes/assist.v1.scenario-graph-register.js');
const { runWithProviderPolicy, OPENAI_ONLY } = await import('../../src/adapters/llm/provider-policy.js');
const { buildModelFromRecords } = await import('../../src/orchestrator-v5/agent-lane/runtime/build-model-from-records.js');
const { normaliseGraphNodeKindField } = await import('../../src/orchestrator-v5/graph-registration/normalise-node-kind.js');
const { GraphStateIngressSchema } = await import('../../src/orchestrator-v5/boundary/request-extensions.js');
const { projectGraphForPersistence } = await import('../../src/orchestrator-v5/persisted-graph-projection.js');
const { assignEntityRefs } = await import('../../src/orchestrator-v5/graph/entity-refs.js');
const { clearInheritedInterventionSourceQuotes } = await import('../../src/orchestrator/tools/encode-option-interventions.js');
const { StatedDispositionsV3 } = await import('../../src/schemas/graph-stated-dispositions.js');
const { currentStatedDispositionRows } = await import('../../src/orchestrator-v5/graph/stated-dispositions-binding.js');
const { deriveNotModelledManifest } = await import('../../src/cee/context-integrity/not-modelled-manifest.js');
const { targetTestabilityOf } = await import('../../src/orchestrator-v5/admission/target-testability.js');
const { resolveAnalysisAdmission } = await import('../../src/orchestrator-v5/admission/analysis-admission.js');

/** The verdict and its codes only; the full admission object restates the graph hash and signals. */
function analysisAdmissionSummary(graph: unknown) {
  const admission = resolveAnalysisAdmission(graph);
  return {
    permitted_analysis_mode: admission.permitted_analysis_mode,
    codes: admission.missing_important_inputs.map((input) => input.code),
    reason_codes: admission.reasons.map((reason) => `${reason.field}:${reason.code}`),
  };
}

let registered: { graph: unknown; brief_text: unknown; stated_dispositions?: unknown } | undefined;
const SCENARIO = '00000000-0000-4000-8000-000000000001';
const dispatch = async (path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
  if (path.endsWith('/graph/register')) {
    registered = body as typeof registered;
    return { status: 200, json: { graph_hash: 'harness', model_version: { version_id: 'harness', version_number: 1 } } };
  }
  if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  throw new Error(`harness: unexpected dispatch ${path}`);
};

// As the route: one deadline per turn, from the turn's start; every attempt gets only what remains of it.
const startedAt = Date.now();
const deadlineAt = constructionDeadline(startedAt);
const result = await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), () =>
  buildModelFromRecords(SCENARIO, brief, dispatch as never, (reqBody) => constructionCallStructured(reqBody, deadlineAt)));
const constructionMs = Date.now() - startedAt;

let stored: unknown = null;
let ingress: unknown = null;
let receiptRows = 0;
if (registered !== undefined) {
  const normalised = normaliseGraphNodeKindField(registered.graph);
  if (!normalised.ok) ingress = { ok: false, reason: normalised.reason };
  else {
    const parsed = GraphStateIngressSchema.safeParse(normalised.graph);
    ingress = parsed.success ? { ok: true } : { ok: false, issues: parsed.error.issues.slice(0, 10) };
    const receipt = registered.stated_dispositions == null ? undefined : StatedDispositionsV3.safeParse(registered.stated_dispositions);
    if (receipt !== undefined && !receipt.success) ingress = { ok: false, reason: 'STATED_DISPOSITIONS_INVALID' };
    const statedReceipt = receipt?.success ? receipt.data : undefined;
    receiptRows = statedReceipt?.length ?? 0;
    // The register route's store composition for a first draft (no base graph).
    const opts = { scenarioId: SCENARIO, turnClass: 'direct_answer' as const, source: 'graph_registration' as const };
    const projected = projectGraphForPersistence(normalised.graph, opts);
    stored = withRegisteredStatedDispositions(
      assignEntityRefs(projectGraphForPersistence(clearInheritedInterventionSourceQuotes(null, projected), opts), null).graph,
      statedReceipt as never);
  }
}
const boundRows = stored === null ? undefined : currentStatedDispositionRows(stored);

/** goal.scope fill (DL named metric): did the model's records declare the goal's part-or-whole scope? */
function goalScopeFill(): boolean | null {
  for (const text of rawTexts) {
    try {
      const records = JSON.parse(text) as { stated_items?: { kind?: string; scope?: unknown }[] };
      const goals = (records.stated_items ?? []).filter((item) => item.kind === 'goal');
      if (goals.length > 0) return goals.some((goal) => goal.scope != null);
    } catch { /* not a record set */ }
  }
  return null;
}

writeFileSync(out, JSON.stringify({
  harness: {
    kind: 'records-served-transport', mode, draw: Number(draw), brief_id: briefId,
    provider_calls: mode === 'live' ? callIndex : 0, construction_calls: callIndex, calls, replay_drift: replayDrift, ingress,
    construction_ms: constructionMs, deadline_ms: deadlineAt - startedAt,
    timed_out: calls.length > 0 && JSON.stringify(result).includes(CONSTRUCTION_TIMEOUT_REASON),
    goal_scope_filled: goalScopeFill(),
    receipt_rows_sent: receiptRows, receipt_rows_bound: boundRows?.length ?? 0,
  },
  build_result: result,
  registered_stated_dispositions: registered?.stated_dispositions ?? null,
  graph: stored,
  brief_text: brief,
  not_modelled: stored === null ? null : deriveNotModelledManifest(brief, stored, { statedDispositionRows: boundRows }),
  target_testability: stored === null ? null : targetTestabilityOf(stored),
  // M1 is "testable AND admission != none": the stored graph's analysis admission, beside testability.
  analysis_admission: stored === null ? null : analysisAdmissionSummary(stored),
}, null, 2));
console.log(JSON.stringify({ out, ok: (result as { ok?: unknown }).ok, calls: callIndex, drift: replayDrift.length, stored: stored !== null, ms: constructionMs, receipt: `${boundRows?.length ?? 0}/${receiptRows}` }));
process.exit(0);
