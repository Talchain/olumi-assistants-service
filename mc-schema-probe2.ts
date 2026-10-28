// local probe only: nullable fields → optional (dropped from `required`), restored to null after parsing.
import Anthropic from '@anthropic-ai/sdk';
import { CANONICAL_JSON_SCHEMA } from './src/orchestrator-v5/model-program-turn/prompt.js';
let unions = 0;
const isNullPair = (n: any) => Array.isArray(n?.anyOf) && n.anyOf.length === 2 && n.anyOf.some((x: any) => x?.type === 'null');
const opt = (n: any): any => {
  if (Array.isArray(n)) return n.map(opt);
  if (!n || typeof n !== 'object') return n;
  if (n.type === 'object' && n.properties) {
    const props: Record<string, any> = {}; const nullable = new Set<string>();
    for (const [k, v] of Object.entries<any>(n.properties)) {
      if (Array.isArray(v?.type) && v.type.includes('null')) { const ts = v.type.filter((t: string) => t !== 'null'); props[k] = opt({ ...v, type: ts.length === 1 ? ts[0] : ts }); nullable.add(k); }
      else if (isNullPair(v)) { const t = v.anyOf.find((x: any) => x?.type !== 'null'); const { anyOf: _, ...rest } = v; props[k] = opt({ ...rest, ...t }); nullable.add(k); }
      else props[k] = opt(v);
    }
    return { ...n, properties: props, required: (n.required ?? []).filter((k: string) => !nullable.has(k)) };
  }
  if (Array.isArray(n.anyOf) || Array.isArray(n.type)) unions += 1;
  return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, opt(v)]));
};
const schema = opt(CANONICAL_JSON_SCHEMA);
console.log('unions left:', unions);
const c = new Anthropic({ maxRetries: 0 });
try {
  const r = await c.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 64, messages: [{ role: 'user', content: 'Return an empty canonical model.' }],
    output_config: { format: { type: 'json_schema', schema } } } as any);
  console.log('ACCEPTED', r.stop_reason);
} catch (e: any) { console.log('REFUSED', e.status, String(e.message).slice(0, 400)); }
