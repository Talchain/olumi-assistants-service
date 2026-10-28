// local check only: does OpenAI's strict json_schema accept B's and D's schemas? 1 call each, tiny output cap.
import OpenAI from 'openai';
import { mcSchema } from './src/orchestrator-v5/model-program-turn/mc-format.js';
import { CANONICAL_JSON_SCHEMA } from './src/orchestrator-v5/model-program-turn/prompt.js';
const c = new OpenAI({ maxRetries: 0 });
for (const f of ['B', 'D']) {
  process.env['MC_FORMAT'] = f; (globalThis as any).x = 0;
  const schema = mcSchema(CANONICAL_JSON_SCHEMA);
  try { const r = await c.responses.create({ model: 'gpt-6.1-sol', input: 'Say nothing.', max_output_tokens: 16, reasoning: { effort: 'low' }, store: false,
    text: { format: { type: 'json_schema', name: 'canonical_model', strict: true, schema } } } as any); console.log(f, 'accepted', r.status, r.incomplete_details?.reason ?? ''); }
  catch (e: any) { console.log(f, 'REFUSED', e.status, String(e.message).slice(0, 300)); }
}
