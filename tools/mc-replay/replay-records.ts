/**
 * Model Construction RECORDS replay harness (spike S2; evaluation tooling, not product code). A copy of replay.ts that
 * drives the spike's `buildModelFromRecords` (records grammar → deterministic compile) in place of the served drafter.
 * Extra mode `fixture`: a DraftRecordSet JSON file (MC_FIXTURE) as the response — zero provider calls (harness smoke).
 *
 * Runs the REAL `buildModelFromBrief` with the provider cut at the transport, then takes the registered graph through
 * the register route's own pure steps (node-kind normalisation → ingress parse → persistence projection → entity refs)
 * and the GET route's own on-read derivations (not-modelled manifest, target testability, analysis admission). The
 * output is shaped like a GET /graph body, so the independent scorer reads it exactly as it reads a served wire capture.
 *
 *   live:   one real agent.construct call per construction call; each raw response is banked.
 *   replay: the banked raw responses are replayed in order: zero provider calls, admission re-run on real model output.
 *
 * tsx tools/mc-replay/replay.ts --mode live|replay --brief <file> --bank <dir> --draw <n> --out <file>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import { buildModelFromRecords } from '../../src/orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { normaliseGraphNodeKindField } from '../../src/orchestrator-v5/graph-registration/normalise-node-kind.js';
import { GraphStateIngressSchema } from '../../src/orchestrator-v5/boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../src/orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../src/orchestrator-v5/graph/entity-refs.js';
import { deriveNotModelledManifest } from '../../src/cee/context-integrity/not-modelled-manifest.js';
import { targetTestabilityOf } from '../../src/orchestrator-v5/admission/target-testability.js';
import { resolveAnalysisAdmission } from '../../src/orchestrator-v5/admission/analysis-admission.js';

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
const brief = readFileSync(briefPath, 'utf8').trim();
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const briefId = sha(brief).slice(0, 12);
mkdirSync(bank, { recursive: true });
const bankFile = (call: number): string => `${bank}/${briefId}-d${draw}-c${call}.json`;

let callIndex = 0;
const callStructured: CallStructuredModel = async (req) => {
  callIndex += 1;
  const identity = {
    model: req.model, max_output_tokens: req.max_output_tokens, reasoning_effort: req.reasoning_effort ?? null,
    instructions_sha256: sha(req.instructions), input_sha256: sha(req.input), schema_sha256: sha(JSON.stringify(req.schema)),
  };
  if (mode === 'fixture') return { text: readFileSync(process.env.MC_FIXTURE ?? '', 'utf8') };
  if (mode === 'replay') {
    const f = bankFile(callIndex);
    if (!existsSync(f)) throw new Error(`replay: no banked response ${f}`);
    const banked = JSON.parse(readFileSync(f, 'utf8')) as { request: typeof identity; response: { text: string; usage?: Record<string, unknown>; status?: string; incomplete_reason?: string } };
    const drift = (Object.keys(identity) as (keyof typeof identity)[]).filter((k) => banked.request[k] !== identity[k]);
    if (drift.length > 0) replayDrift.push({ call: callIndex, fields: drift });
    return banked.response;
  }
  const key = process.env.OPENAI_API_KEY ?? '';
  if (!key.startsWith('sk-')) throw new Error('live: OPENAI_API_KEY missing or without the sk- prefix');
  // Hard, machine-wide call budget for this measurement: a shared counter file; refuse once the cap is reached.
  const capFile = process.env.MC_CALL_COUNTER ?? '';
  const cap = Number(process.env.MC_CALL_CAP ?? '0');
  if (capFile === '' || !(cap > 0)) throw new Error('live: MC_CALL_COUNTER and MC_CALL_CAP are required');
  const spent = existsSync(capFile) ? Number(readFileSync(capFile, 'utf8').trim() || '0') : 0;
  if (spent >= cap) throw new Error(`live: call budget exhausted (${spent}/${cap})`);
  writeFileSync(capFile, String(spent + 1));
  const started = Date.now();
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: req.model, instructions: req.instructions, input: req.input, max_output_tokens: req.max_output_tokens,
      ...(req.reasoning_effort !== undefined ? { reasoning: { effort: req.reasoning_effort } } : {}),
      text: { format: { type: 'json_schema', name: 'draft_records', strict: true, schema: req.schema } },
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (r.status === 429) { console.error('ABORT: 429 from provider'); process.exit(42); }
  if (!r.ok) throw new Error(`openai_${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json() as { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: Record<string, unknown>; status?: unknown; incomplete_details?: { reason?: unknown } | null };
  let text = '';
  for (const item of j.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
  }
  const response = {
    text, usage: j.usage,
    ...(j.status === 'incomplete' ? { status: 'incomplete', incomplete_reason: typeof j.incomplete_details?.reason === 'string' ? j.incomplete_details.reason : undefined } : {}),
  };
  writeFileSync(bankFile(callIndex), JSON.stringify({ at: new Date().toISOString(), latency_ms: Date.now() - started, brief_sha256: sha(brief), request: identity, response }, null, 2));
  return response;
};
const replayDrift: { call: number; fields: string[] }[] = [];

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

const result = await buildModelFromRecords(SCENARIO, brief, dispatch as never, callStructured);

let stored: unknown = null;
let ingress: unknown = null;
if (registered !== undefined) {
  const normalised = normaliseGraphNodeKindField(registered.graph);
  if (!normalised.ok) ingress = { ok: false, reason: normalised.reason };
  else {
    const parsed = GraphStateIngressSchema.safeParse(normalised.graph);
    ingress = parsed.success ? { ok: true } : { ok: false, issues: parsed.error.issues.slice(0, 10) };
    const projected = projectGraphForPersistence(normalised.graph, { scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration' });
    stored = assignEntityRefs(projected, null).graph;
  }
}

writeFileSync(out, JSON.stringify({
  harness: { kind: 'records', mode, draw: Number(draw), brief_id: briefId, provider_calls: mode === 'live' ? callIndex : 0, construction_calls: callIndex, replay_drift: replayDrift, ingress },
  build_result: result,
  // Not included in graph: the existing registration route does not persist this diagnostic.
  registered_stated_dispositions: registered?.stated_dispositions ?? null,
  graph: stored,
  brief_text: brief,
  not_modelled: stored === null ? null : deriveNotModelledManifest(brief, stored),
  target_testability: stored === null ? null : targetTestabilityOf(stored),
  // M1 (pass 2) is "testable AND admission != none": the stored graph's analysis admission, beside testability.
  analysis_admission: stored === null ? null : analysisAdmissionSummary(stored),
}, null, 2));
console.log(JSON.stringify({ out, ok: (result as { ok?: unknown }).ok, calls: callIndex, drift: replayDrift.length, stored: stored !== null }));
