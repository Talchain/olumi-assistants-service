/** One read-only M2 call for the disposable Lab. The pinned MM-1 files are byte-for-byte snapshots. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentHash } from './pinned-runtime/artefact-runtime/canonical.ts';
import { MM1_PROPOSAL_JSON_SCHEMA, validateMM1Output } from './pinned-runtime/artefact-runtime/evals/mm-1/package.ts';
import { MM1_WIDENING_PROMPT, MM1_DIFFERENT_MODEL, MM1_EFFORT } from './pinned-runtime/artefact-runtime/evals/mm-1/sealed-provider-pack.ts';

const source = 'Talchain/olumi-programme-docs@03897e41624f3c261c061f06efbf4daf52e5be24';
const pinned = {
  './pinned-runtime/artefact-runtime/canonical.ts': '8db892f56a0af42220dda13011f09431ff80922eb784114e2b12e54267d06066',
  './pinned-runtime/artefact-runtime/evals/mm-1/package.ts': '6d28de2fcfd5d76484d5cfeee215952a32c02c00ae0b5983f89ee260349b573a',
  './pinned-runtime/artefact-runtime/evals/mm-1/sealed-provider-pack.ts': 'a462282815bb15c277a3af5391fba42e48c3e51a3ef714e1b10adf8aa9b0d525',
};
export function assertPinnedSource() {
  for (const [path, expected] of Object.entries(pinned)) {
    const actual = createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
    if (actual !== expected) throw new Error(`mm1_source_changed:${path}`);
  }
}

export function currentM2Input({ session_id, brief, graph }) {
  if (typeof session_id !== 'string' || !session_id || typeof brief !== 'string' || !brief.trim() || brief.length > 12000 ||
      graph === null || typeof graph !== 'object' || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error('invalid_current_m1_binding');
  }
  const refs = graph.nodes.map(node => node?.id);
  if (refs.some(id => typeof id !== 'string' || !id.trim()) || new Set(refs).size !== refs.length) {
    throw new Error('invalid_current_m1_refs');
  }
  const graphHash = contentHash(graph); // Full model identity; CEE's analysis projection intentionally omits some content.
  const binding = {
    brief: { id: `lab:${session_id}`, revision: graphHash, text: brief, content_hash: contentHash(brief) },
    admitted_m1: { scenario_id: session_id, graph_revision: graphHash, graph_hash: graphHash,
      model: graph, model_refs: refs, model_name: 'existing_lab_snapshot' },
    evidence_refs: [], validation_warning_codes: [],
  };
  const providerInput = {
    brief: binding.brief,
    admitted_m1: { scenario_id: session_id, graph_revision: graphHash, graph_hash: graphHash, model: graph, model_refs: refs },
    evidence_refs: [], validation_warning_codes: [],
  };
  return { binding, providerInput, input_hash: contentHash(providerInput), graph_hash: graphHash };
}

/** OpenAI requires an explicit type beside JSON Schema const; this changes transport syntax only. */
export function providerSchema(value) {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (value === null || typeof value !== 'object') return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([key, part]) => [key, providerSchema(part)]));
  if (Object.hasOwn(mapped, 'const') && !Object.hasOwn(mapped, 'type')) {
    if (typeof mapped.const !== 'string') throw new Error('unsupported_mm1_const_type');
    return { type: 'string', ...mapped };
  }
  return mapped;
}

export function validateM2Output(binding, output) {
  const errors = validateMM1Output(binding, output);
  if (errors.length === 0 && binding.evidence_refs.length === 0 &&
      output.proposals.some(proposal => proposal.origin === 'evidence_derived')) {
    errors.push('evidence_derived_without_source');
  }
  return { accepted: errors.length === 0, errors, proposals: errors.length === 0 ? output.proposals : [] };
}

export async function callM2(snapshot, send = fetch) {
  assertPinnedSource();
  const current = currentM2Input(snapshot);
  const instructions = current.binding.evidence_refs.length === 0
    ? `${MM1_WIDENING_PROMPT}\n\nLive binding: evidence_refs is empty. Every proposal must use origin "olumi_hypothesis"; do not label an idea evidence-derived. Cite only an exact brief span, a current model reference, or a specific graph absence, and keep each idea provisional.`
    : MM1_WIDENING_PROMPT;
  const request = {
    model: MM1_DIFFERENT_MODEL,
    instructions,
    input: JSON.stringify(current.providerInput),
    reasoning: { effort: MM1_EFFORT },
    max_output_tokens: 3200,
    text: { format: { type: 'json_schema', name: 'mm1_widening_proposals', strict: true,
      schema: providerSchema(MM1_PROPOSAL_JSON_SCHEMA) } },
  };
  const started = Date.now();
  const response = await send('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.json();
  const latency_ms = Date.now() - started;
  const text = (raw.output ?? []).filter(item => item.type === 'message')
    .flatMap(item => item.content ?? []).filter(item => item.type === 'output_text')
    .map(item => item.text ?? '').join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const verdict = response.ok && raw.status === 'completed'
    ? validateM2Output(current.binding, parsed)
    : { accepted: false, errors: [response.ok ? `provider_${raw.status ?? 'incomplete'}` : `provider_http_${response.status}`], proposals: [] };
  return {
    accepted: verdict.accepted, proposals: verdict.proposals, errors: verdict.errors,
    receipt: { mode: 'live_m2_read_only', source, session_id: snapshot.session_id, model: request.model,
      effort: MM1_EFFORT, input_hash: current.input_hash, graph_hash: current.graph_hash,
      instruction_hash: createHash('sha256').update(instructions).digest('hex'),
      schema_hash: contentHash(MM1_PROPOSAL_JSON_SCHEMA), provider_schema_hash: contentHash(request.text.format.schema),
      request_input: current.providerInput,
      provider_status: response.status, provider_state: raw.status ?? null, latency_ms, usage: raw.usage ?? null,
      validation_errors: verdict.errors, raw_response: raw },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 512_000) throw new Error('m2_input_too_large');
  }
  try { process.stdout.write(JSON.stringify(await callM2(JSON.parse(input))) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ accepted: false, proposals: [], errors: [String(error?.message ?? error)] }) + '\n'); }
}
