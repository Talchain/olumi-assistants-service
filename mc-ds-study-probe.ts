// Drafter-only probe. Synthetic inputs only; no OpenAI calls, no Supabase writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { draftCanonicalModel, draftRequestBody } from './src/orchestrator-v5/model-program-turn/draft.js';
import { deepseekResponsesCall, dsSystem } from './src/orchestrator-v5/model-program-turn/mc-anthropic-call.js';
import { DS_NATIVE_RULES } from './src/orchestrator-v5/model-program-turn/mc-ds-native.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS } from './src/orchestrator-v5/model-program-turn/prompt.js';
const [briefsFile, outDir, model, nStr = '1'] = process.argv.slice(2);
const briefs = JSON.parse(readFileSync(briefsFile, 'utf8')) as { id: string; brief: string }[];
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/prompt-manifest.json`, JSON.stringify({ round3: DRAFTING_INSTRUCTIONS, native: DS_NATIVE_RULES, schema: CANONICAL_JSON_SCHEMA, system: dsSystem(draftRequestBody([], false, '2026-10-28')) }, null, 2));
for (const b of briefs) for (let n = 1; n <= Number(nStr); n += 1) {
  if (existsSync('/Users/paulslee/olumi-work/recovery/live/q-runs-model-compare/deepseek-study/STOP-429.txt')) process.exit(3);
  const t0 = Date.now();
  const out = await draftCanonicalModel(b.brief, deepseekResponsesCall(model), b.brief, { interpret: true });
  const dir = `${outDir}/${b.id}-${n}`; mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/drafter.json`, JSON.stringify({ s: (Date.now() - t0) / 1000, attempts: out.attempts, canonical: out.model, compiled_errors: out.compiled?.errors ?? null }, null, 1));
  console.log(JSON.stringify({ id: `${b.id}-${n}`, s: Math.round((Date.now() - t0) / 1000), attempts: out.attempts.length, model: out.model !== null, error_codes: out.attempts.map((a) => a.errors?.map((e) => e.code) ?? a.failed), final_errors: out.compiled?.errors.length ?? null, provider_errors: out.attempts.map(a => a.provider_error ?? null) }));
}
