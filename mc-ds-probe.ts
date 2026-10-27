// MODEL-COMPARE DeepSeek drafter-only probe (no turn, no OpenAI): draftCanonicalModel with the DeepSeek call, per brief × N.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { draftCanonicalModel } from './src/orchestrator-v5/model-program-turn/draft.js';
import { deepseekResponsesCall } from './src/orchestrator-v5/model-program-turn/mc-anthropic-call.js';
const [briefsFile, outDir, model, nStr] = process.argv.slice(2);
const briefs = JSON.parse(readFileSync(briefsFile, 'utf8')) as { id: string; brief: string }[];
for (const b of briefs) for (let n = 1; n <= Number(nStr); n += 1) {
  const t0 = Date.now(); const out = await draftCanonicalModel(b.brief, deepseekResponsesCall(model), b.brief, { interpret: true });
  const dir = `${outDir}/${b.id}-${n}`; mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/drafter.json`, JSON.stringify({ s: (Date.now() - t0) / 1000, attempts: out.attempts, canonical: out.model }, null, 1));
  console.log(`${b.id}-${n}: ${(Date.now() - t0) / 1000}s attempts ${out.attempts.length} first_err ${JSON.stringify(out.attempts[0]?.errors?.slice(0, 2) ?? out.attempts[0]?.failed ?? null).slice(0, 300)} final_err ${out.compiled?.errors.length ?? 'no model'}`);
}
