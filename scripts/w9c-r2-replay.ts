/** Executes the CI assertions directly: zero LLM calls and no Vitest runner. */
import { writeFileSync } from 'node:fs';
import { rows } from '../src/orchestrator-v5/agent-lane/method-turn/__tests__/helpers/w9c-rows.js';
import { r2Rows, timings } from '../src/orchestrator-v5/agent-lane/method-turn/__tests__/helpers/w9c-r2-rows.js';
let failed = false;
for (const [name, check] of Object.entries({ ...rows, ...r2Rows })) {
  if (process.argv[2] && !name.includes(process.argv[2])) continue;
  try { check(); console.log(`PASS ${name}`); }
  catch (error) { failed = true; console.error(`FAIL ${name}`, error); }
}
if (!process.argv[2]) writeFileSync('acceptance-evidence/premortem-r2/timing.json', JSON.stringify(timings, null, 2) + '\n');
process.exitCode = failed ? 1 : 0;
