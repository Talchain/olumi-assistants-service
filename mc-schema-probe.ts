// local probe only: can Claude's structured outputs take the canonical schema once nullable anyOf pairs become type arrays?
import Anthropic from '@anthropic-ai/sdk';
import { CANONICAL_JSON_SCHEMA } from './src/orchestrator-v5/model-program-turn/prompt.js';
let anyOf = 0;
const flat = (n: any): any => {
  if (Array.isArray(n)) return n.map(flat);
  if (!n || typeof n !== 'object') return n;
  if (Array.isArray(n.anyOf) && n.anyOf.length === 2 && n.anyOf.some((x: any) => x?.type === 'null')) {
    const t = n.anyOf.find((x: any) => x?.type !== 'null'); const { anyOf: _, ...rest } = n;
    if (t && typeof t.type === 'string' && !t.anyOf) { if (Array.isArray(t.enum)) { const { type: _t, ...e } = t; return flat({ ...rest, ...e, enum: [...t.enum, null] }); } return flat({ ...rest, ...t, type: [t.type, 'null'] }); }
  }
  if (Array.isArray(n.anyOf)) anyOf += 1;
  return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, flat(v)]));
};
const schema = flat(CANONICAL_JSON_SCHEMA);
console.log('anyOf left after flattening nullable pairs:', anyOf, 'bytes', JSON.stringify(schema).length);
const c = new Anthropic({ maxRetries: 0 });
for (const model of ['claude-sonnet-5-5']) {
  try {
    const r = await c.messages.create({ model, max_tokens: 64, messages: [{ role: 'user', content: 'Return an empty canonical model.' }],
      output_config: { format: { type: 'json_schema', schema } } } as any);
    console.log(model, 'ACCEPTED', r.stop_reason);
  } catch (e: any) { console.log(model, 'REFUSED', e.status, String(e.message).slice(0, 400)); }
}
