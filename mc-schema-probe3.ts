// local probe only: nullable string → required string ("" = null); other nullables → optional; count against Claude's limits.
import Anthropic from '@anthropic-ai/sdk';
import { CANONICAL_JSON_SCHEMA } from './src/orchestrator-v5/model-program-turn/prompt.js';
let unions = 0, optional = 0, sentinel = 0;
const baseOf = (v: any) => { if (Array.isArray(v?.type) && v.type.includes('null')) { const ts = v.type.filter((t: string) => t !== 'null'); return { ...v, type: ts.length === 1 ? ts[0] : ts }; }
  if (Array.isArray(v?.anyOf) && v.anyOf.length === 2 && v.anyOf.some((x: any) => x?.type === 'null')) { const t = v.anyOf.find((x: any) => x?.type !== 'null'); const { anyOf: _, ...rest } = v; return { ...rest, ...t }; } return null; };
const conv = (n: any): any => {
  if (Array.isArray(n)) return n.map(conv);
  if (!n || typeof n !== 'object') return n;
  if (n.type === 'object' && n.properties) {
    const props: Record<string, any> = {}; const drop = new Set<string>();
    for (const [k, v] of Object.entries<any>(n.properties)) {
      const b = baseOf(v);
      if (b && b.type === 'string' && !b.enum) { props[k] = conv({ ...b, description: `${b.description ?? ''} Empty string "" when there is none.`.trim() }); sentinel += 1; }
      else if (b) { props[k] = conv(b); drop.add(k); optional += 1; }
      else props[k] = conv(v);
    }
    return { ...n, properties: props, required: (n.required ?? []).filter((k: string) => !drop.has(k)) };
  }
  if (Array.isArray(n.anyOf) || Array.isArray(n.type)) unions += 1;
  return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, conv(v)]));
};
const schema = conv(CANONICAL_JSON_SCHEMA);
console.log({ unions, optional, sentinel });
if (process.argv[2] !== 'dry') { const c = new Anthropic({ maxRetries: 0 });
  try { const r = await c.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'Return an empty canonical model.' }], output_config: { format: { type: 'json_schema', schema } } } as any); console.log('ACCEPTED', r.stop_reason); }
  catch (e: any) { console.log('REFUSED', e.status, String(e.message).slice(0, 300)); } }
