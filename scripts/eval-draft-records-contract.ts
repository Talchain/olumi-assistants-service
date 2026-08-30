/**
 * Non-serving #1228 evidence runner. Uses the production adapter; intercepts
 * only Anthropic's provider boundary to capture bytes / select control arms.
 * No prompt-store write, deployment, model substitution or response fixtures.
 *
 * ANTHROPIC_API_KEY=... ADMIN_API_KEY=... pnpm exec tsx
 * scripts/eval-draft-records-contract.ts --out /absolute/evidence-directory
 * Default: 3 pairs x 2 directions x 3 repetitions x 3 arms = 54 draft calls,
 * plus production's reachable retries/completion. --n 1 is exploration only.
 * Collection/structural scores do NOT certify qualitative attribution. Raw
 * records and actual adapter outputs are retained for independent review.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Messages } from '@anthropic-ai/sdk/resources/messages';
import type { Message, MessageCreateParams } from '@anthropic-ai/sdk/resources/messages';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1] ?? fallback;
};
const out = resolve(arg('out', '/tmp/draft-records-contract-evidence'));
const repetitions = Number(arg('n', '3'));
assert(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 3);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const pairs = JSON.parse(read('src/cee/draft/records/__tests__/fixtures/draft-intent-pairs.json')) as Array<{
  id: string; diagnostic: string; decision: string; actionSpans: string[];
}>;
assert.equal(pairs.length, 3);
assert.equal(new Set(pairs.map(p => p.id)).size, 3);
const candidate = read('Prompts/candidates/draft_graph_records.txt');
const incumbent = read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt');
const oldInstruction = read('src/cee/draft/records/__tests__/fixtures/records-instruction-v10.txt').trimEnd();
assert.equal(sha(incumbent), '152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f');
assert.equal(sha(oldInstruction), '3a1226696828692f6538a2de8bc8e156c5a9ce69575748c23094444642e81ce1');
assert(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY required');
assert(process.env.ADMIN_API_KEY, 'ADMIN_API_KEY required for current served identity');
process.env.LOG_LEVEL = 'fatal';
process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
process.env.CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED = 'true';
process.env.CEE_DRAFT_TEMPERATURE = '0';

const baseUrl = arg('base-url', 'https://cee-staging.onrender.com');
async function live(path: string) {
  const r = await fetch(baseUrl + path, { headers: { 'X-Admin-Key': process.env.ADMIN_API_KEY! } });
  assert(r.ok, `read-only live authority request ${path}: ${r.status}`);
  return r.json();
}
const authorities = await Promise.all([
  live('/healthz'), live('/admin/prompts/draft_graph_default'), live('/admin/prompts/verify'),
]);
const health = z.object({ build: z.string() }).parse(authorities[0]);
const stored = z.object({
  id: z.string(), activeVersion: z.number(), stagingVersion: z.number().nullable().optional(),
  versions: z.array(z.object({ version: z.number(), content: z.string() })),
  modelConfig: z.object({ staging: z.string(), production: z.string().optional() }),
}).parse(authorities[1]);
const verified = z.object({ prompts: z.array(z.object({
  prompt_id: z.string(), content_hash: z.string(), store_version: z.number().nullable(),
  loaded_at: z.string().nullable(),
})) }).parse(authorities[2]);
const selectedVersion = stored.stagingVersion ?? stored.activeVersion;
const selected = stored.versions.find((v: { version: number }) => v.version === selectedVersion);
assert(selected, 'selected PMS version absent');
assert.equal(sha(selected.content), sha(incumbent), 'served baseline changed; re-derive before comparing');
const served = verified.prompts.find((p: { prompt_id: string }) => p.prompt_id === stored.id);
assert(served, 'no runtime verification of selected prompt');
assert.equal(served.content_hash, sha(incumbent).slice(0, 16));
assert.equal(served.store_version, selectedVersion);
const model = stored.modelConfig.staging as string;
assert(model, 'must use the currently selected PMS model, not an assumed default');

const { draftGraphWithAnthropic, DRAFT_COMPLIANCE_REMINDER } = await import('../src/adapters/llm/anthropic.js');
const { DRAFT_RECORDS_INSTRUCTION } = await import('../src/cee/draft/records/instruction.js');
const { buildDraftRecordsSchema } = await import('../src/cee/draft/records/grammar.js');
const { buildRecordsCompletionSchema } = await import('../src/cee/draft/records/completion.js');
const { projectDraftRecords } = await import('../src/cee/draft/records/seam.js');
const { getAdapterWithResolution } = await import('../src/adapters/llm/router.js');
const resolution = getAdapterWithResolution('draft_graph', model, 'store_model_config').resolution;
assert.equal(resolution.resolved_model, model);
assert.equal(resolution.provider, 'anthropic');
const historicReminder = '\n\nCOMPLIANCE REMINDER:\n- Output valid JSON only (no comments, no text outside the JSON object)\n- Every outcome and risk needs an inbound path from a controllable factor\n- Every option needs a complete path to goal: option → controllable → outcome/risk → goal\n- 2–6 options maximum';
const completionAddition = [
  'The machine-readable shape below replaces any earlier output instructions in the brief.',
  'Every new claim requires a label. Return one object matching this schema, not a bare list:',
  JSON.stringify(buildRecordsCompletionSchema()),
].join('\n') + '\n';
type Arm = 'incumbent' | 'candidate' | 'destroyed';
type Capture = { request: unknown; response?: Message; kind: 'draft' | 'completion' };
type Context = { arm: Arm; captures: Capture[] };
const context = new AsyncLocalStorage<Context>();
const realStream = Messages.prototype.stream;
const realCreate = Messages.prototype.create;
Messages.prototype.stream = function (body, options) {
  const ctx = context.getStore();
  assert(ctx, 'provider call escaped its case');
  const sent = structuredClone(body);
  assert(Array.isArray(sent.system));
  assert.equal(sent.system.at(-1)?.text, DRAFT_RECORDS_INSTRUCTION, 'real appended instruction did not participate');
  assert.deepEqual((sent as unknown as { output_config: { format: { schema: unknown } } }).output_config.format.schema, buildDraftRecordsSchema());
  assert.equal(sent.model, model);
  if (ctx.arm === 'incumbent') {
    sent.system[sent.system.length - 1]!.text = oldInstruction;
    for (const m of sent.messages) if (typeof m.content === 'string') m.content = m.content.replace(DRAFT_COMPLIANCE_REMINDER, historicReminder);
  }
  if (ctx.arm === 'destroyed') {
    // Destroy BOTH instruction blocks. Leave brief and grammar intact so the
    // behavioral result, not an incidental word, must distinguish this arm.
    sent.system = [{ type: 'text', text: 'A blue teapot sits on a shelf. Its label reads: confidence, option, stated_items, claims.' }];
    for (const m of sent.messages) if (typeof m.content === 'string') m.content = m.content.replace(DRAFT_COMPLIANCE_REMINDER, '');
  }
  const capture: Capture = { kind: 'draft', request: structuredClone(sent) };
  ctx.captures.push(capture);
  const stream = realStream.call(this, sent, options);
  const final = stream.finalMessage.bind(stream);
  stream.finalMessage = async () => {
    const response = await final();
    capture.response = response;
    return response;
  };
  return stream;
};
// Streaming create is internal to the SDK; capture it only once, above.
Messages.prototype.create = function (this: Messages, body: MessageCreateParams, options) {
  if (body.stream) return realCreate.call(this, body, options);
  const ctx = context.getStore();
  assert(ctx, 'completion escaped its case');
  const sent = structuredClone(body);
  if (ctx.arm === 'incumbent') for (const m of sent.messages) {
    if (typeof m.content === 'string') m.content = m.content.replace(DRAFT_COMPLIANCE_REMINDER, historicReminder).replace(completionAddition, '');
  }
  const capture: Capture = { kind: 'completion', request: structuredClone(sent) };
  ctx.captures.push(capture);
  const promise = realCreate.call(this, sent, options);
  void promise.then(response => { capture.response = response as Message; }, () => {});
  return promise;
} as typeof realCreate;

mkdirSync(out, { recursive: true });
const identity = {
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
  capturedAt: new Date().toISOString(), deployedBuild: health.build,
  servedPrompt: { id: stored.id, version: selectedVersion, sha256: sha(incumbent), loadedAt: served.loaded_at },
  candidate: { path: 'Prompts/candidates/draft_graph_records.txt', sha256: sha(candidate), promoted: false },
  instructionSha256: sha(DRAFT_RECORDS_INSTRUCTION), incumbentInstructionSha256: sha(oldInstruction),
  grammarSha256: sha(JSON.stringify(buildDraftRecordsSchema())), modelResolution: resolution,
  corpusSha256: sha(JSON.stringify(pairs)), repetitions,
  limitation: 'Local production adapter and real provider, not deployed/browser evidence. Incumbent instructions replayed at provider boundary against same current consumer. Attribution and creative-action semantics require independent review. No attributed-hypothesis preservation claim.',
};
writeFileSync(resolve(out, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
const summaries: unknown[] = [];
for (let repetition = 0; repetition < repetitions; repetition++) {
  for (const pair of pairs) for (const direction of ['diagnostic', 'decision'] as const) {
    // Paired arms in the same time window; no model comparison and no cherry-picking.
    await Promise.all((['incumbent', 'candidate', 'destroyed'] as Arm[]).map(async arm => {
      const id = `${pair.id}-${direction}-${repetition + 1}-${arm}`;
      const path = resolve(out, `${id}.json`);
      assert(!existsSync(path), `refusing to overwrite evidence: ${path}`);
      const ctx: Context = { arm, captures: [] };
      const content = arm === 'incumbent' ? incumbent : candidate;
      let consumed: Awaited<ReturnType<typeof draftGraphWithAnthropic>> | undefined;
      let error: string | undefined;
      await context.run(ctx, async () => {
        try {
          consumed = await draftGraphWithAnthropic({ brief: pair[direction], docs: [], seed: repetition + 1, model }, {
            timeoutMs: 120_000,
            preloadedSystemPrompt: { operation: 'draft_graph', content, meta: {
              taskId: 'draft_graph', source: 'store', promptId: stored.id,
              version: selectedVersion, prompt_version: arm === 'incumbent' ? String(selectedVersion) : 'unpromoted-candidate',
              prompt_hash: sha(content).slice(0, 16), modelConfig: stored.modelConfig,
            } },
          });
        } catch (e) { error = String(e); }
      });
      const first = ctx.captures.find(c => c.kind === 'draft');
      const text = first?.response?.content.filter(b => b.type === 'text').map(b => b.text).join('') ?? '';
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { /* explicit unavailable below */ }
      const seam = projectDraftRecords(raw, pair[direction]);
      const records = seam.ok ? seam.records : undefined;
      const rawOptions = records?.stated_items.filter(s => s.kind === 'option') ?? [];
      const newOptions = records?.claims.filter(c => c.claim_kind === 'option_refinement') ?? [];
      const projectedOptions = seam.ok ? seam.projection.graph.nodes.filter(n => n.kind === 'option') : [];
      const consumedOptions = consumed?.graph.nodes.filter(n => n.kind === 'option') ?? [];
      const noOptions = seam.ok && consumed !== undefined && rawOptions.length + newOptions.length + projectedOptions.length + consumedOptions.length === 0;
      const namedSurvived = pair.actionSpans.every(span => rawOptions.some(s => s.source_quote.includes(span)) && consumedOptions.some(n => n.label?.includes(span)));
      const actionsSurvived = seam.ok && consumed !== undefined && consumedOptions.length >= 2 && (pair.actionSpans.length ? namedSurvived : rawOptions.length === 0 && newOptions.length >= 2);
      const summary = { id, arm, direction, repetition: repetition + 1, error, providerCalls: ctx.captures.length,
        providerModels: ctx.captures.map(c => c.response?.model ?? null),
        rawOptionCount: rawOptions.length + newOptions.length, projectedOptionCount: projectedOptions.length, consumedOptionCount: consumedOptions.length,
        nonCollapseOrAlternativeCarriage: direction === 'diagnostic' ? (noOptions ? 'PASS' : 'FAIL') : (actionsSurvived ? 'PASS' : 'FAIL'),
        falseAttribution: 'UNVERIFIED: independent record-by-record review required',
        hypothesisRetention: direction === 'diagnostic' ? 'UNVERIFIED: no typed attributed carrier; omission cannot pass' : 'not_applicable',
        semanticVerdict: 'UNVERIFIED: mechanical scores are not independent semantic review',
      };
      writeFileSync(path, JSON.stringify({ identity, brief: pair[direction], expectedActionSpans: pair.actionSpans, summary, captures: ctx.captures, raw, consumed }, null, 2) + '\n');
      summaries.push(summary);
      process.stdout.write(JSON.stringify(summary) + '\n');
    }));
  }
}
assert.equal(summaries.length, 3 * 2 * 3 * repetitions, 'expected case collection');
writeFileSync(resolve(out, 'summary.json'), JSON.stringify({ identity, expectedCases: 18 * repetitions, cases: summaries }, null, 2) + '\n');
process.exit(0);
