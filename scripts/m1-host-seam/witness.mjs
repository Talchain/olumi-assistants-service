/**
 * One M1 host-seam witness: fresh brief → served Agent → readback. Writes `readback.json` + `turn.json` to <out>.
 *
 *   ASSIST_API_KEY=… [M1_USER_JWT=…] node scripts/m1-host-seam/witness.mjs <brief-file> <out-dir> [base]
 *
 * Credentials come from the environment only and are never printed or written. Refuses to run with an Anthropic
 * key in the environment (OpenAI-only programme rule). Exit 0 only when the model is `bound`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildFromBrief, readback } from './readback.mjs';

const [briefFile, out, base = 'https://cee-staging.onrender.com'] = process.argv.slice(2);
if (!briefFile || !out) { console.error('usage: witness.mjs <brief-file> <out-dir> [base]'); process.exit(2); }
if (process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is set — refusing (OpenAI only)'); process.exit(2); }
const assistKey = process.env.ASSIST_API_KEY;
const bearer = process.env.M1_USER_JWT || undefined;
if (!assistKey) { console.error('ASSIST_API_KEY is required in the environment'); process.exit(2); }
mkdirSync(out, { recursive: true });

const brief = readFileSync(briefFile, 'utf8').trim();
const turn = await buildFromBrief({ base, assistKey, bearer, brief });
writeFileSync(`${out}/turn.json`, JSON.stringify(turn, null, 2));
const rb = await readback({ base, assistKey, bearer, scenarioId: turn.scenario_id });
writeFileSync(`${out}/readback.json`, JSON.stringify(rb, null, 2));
console.log(JSON.stringify({
  cee_build: rb.cee_build, scenario_id: rb.scenario_id, signed_in: rb.signed_in,
  turn_http: turn.http, tools: turn.tools.map((t) => `${t.name}${t.ok ? '' : '✗'}`), providers: turn.providers,
  nodes: rb.graph?.nodes?.length ?? null, brief_matches: rb.brief_text === brief,
  graph_identity_hash: rb.graph_identity_hash?.value ?? null, model_version: rb.model_version?.version_id ?? null,
  version_binding: rb.version_binding,
}, null, 2));
process.exitCode = rb.version_binding === 'bound' ? 0 : 1;
