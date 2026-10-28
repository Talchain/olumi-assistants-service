// MODEL-COMPARE drafter-only run (no turn, no OpenAI call): the same draftCanonicalModel loop, Claude call, per sealed brief × N.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { draftCanonicalModel } from './src/orchestrator-v5/model-program-turn/draft.js';
import { anthropicResponsesCall } from './src/orchestrator-v5/model-program-turn/mc-anthropic-call.js';
const [briefsFile, outDir, model, nStr] = process.argv.slice(2);
const briefs = JSON.parse(readFileSync(briefsFile, 'utf8')) as { id: string; brief: string }[];
const jobs = briefs.flatMap((b) => Array.from({ length: Number(nStr) }, (_, i) => ({ ...b, n: i + 1 })));
let stop = false;
async function one(j: { id: string; brief: string; n: number }): Promise<void> {
  if (stop) return;
  const t0 = Date.now();
  const out = await draftCanonicalModel(j.brief, anthropicResponsesCall(model), j.brief, { interpret: true });
  if (out.attempts.some((a) => a.provider_error?.status === 429)) { stop = true; console.log(`429 on ${j.id}-${j.n}: stopping`); }
  const dir = `${outDir}/${j.id}-${j.n}`; mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/drafter.json`, JSON.stringify({ id: j.id, n: j.n, model, s: (Date.now() - t0) / 1000, has_model: out.model !== null,
    final_errors: out.compiled?.errors.length ?? null, attempts: out.attempts, canonical: out.model }, null, 1));
  console.log(`${j.id}-${j.n}: ${(Date.now() - t0) / 1000}s attempts ${out.attempts.length} first_err ${out.attempts[0]?.errors?.length ?? out.attempts[0]?.failed} final_err ${out.compiled?.errors.length ?? 'no model'}`);
}
const q = [...jobs]; await Promise.all([0, 1].map(async () => { while (q.length && !stop) await one(q.shift()!); }));
