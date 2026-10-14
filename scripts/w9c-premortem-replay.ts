/** The same CI rows, through real selector/adapter/checker; no LLM and no vitest runner. */
import { rows, capture, turn, draftFor } from '../src/orchestrator-v5/agent-lane/method-turn/__tests__/helpers/w9c-rows.js';
import { fallbackReply } from '../src/orchestrator-v5/agent-lane/method-turn/method-turn.js';

let failed = false;
for (const [name, check] of Object.entries(rows)) {
  try { check(); console.log(`PASS ${name}`); }
  catch (error) { failed = true; console.error(`FAIL ${name}`, error); }
}
if (process.argv.includes('--reply')) {
  console.log('COMPLIANT DRAFT w9b-2\n' + draftFor('w9b-2'));
  console.log('DETERMINISTIC FALLBACK w9b-2\n' + fallbackReply(turn(capture('w9b-2')).context));
}
process.exitCode = failed ? 1 : 0;
