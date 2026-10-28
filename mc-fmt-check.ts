// local check only (not committed): B and D shims on a real saved draft round-trip into a model the compiler reads.
import { readFileSync } from 'node:fs';
import { CanonicalModel } from './src/orchestrator-v5/model-program/canonical.js';
import { compile } from './src/orchestrator-v5/model-program/compile.js';
import { withHostFields } from './src/orchestrator-v5/model-program-turn/draft.js';
import { mcShim, mcSchema, mcInstructions } from './src/orchestrator-v5/model-program-turn/mc-format.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS } from './src/orchestrator-v5/model-program-turn/prompt.js';
const saved = JSON.parse(readFileSync(process.argv[2], 'utf8')).canonical;
const brief = readFileSync(process.argv[3], 'utf8');
const strip = (r: any) => { const { approval, approved_by, author_id, ...x } = r; return x; };
const base: any = Object.fromEntries(Object.entries(saved).filter(([k]) => k !== 'history').map(([k, v]) => [k, Array.isArray(v) ? v.map((r: any) => (r && typeof r === 'object' ? strip(r) : r)) : v]));
const before = compile(CanonicalModel.parse(withHostFields(base, true)), { sourceText: brief, asksNeedQuestions: false });
console.log('A errors', before.errors.map((e) => e.code));
for (const f of ['B', 'C', 'D']) {
  process.env['MC_FORMAT'] = f;
  const instr = mcInstructions(DRAFTING_INSTRUCTIONS);
  let raw: any = structuredClone(base);
  if (f === 'B') { const occ = new Set(raw.risks.map((r: any) => r.occurrence)); raw.quantities = raw.quantities.filter((q: any) => !occ.has(q.id)); raw.risks = raw.risks.map(({ occurrence, ...r }: any) => ({ ...r, chance: 'likely', chance_whose: 'olumi', chance_quote: null })); }
  if (f === 'D') for (const k of ['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out']) raw[k] = raw[k].map((r: any) => ({ ...r, title: 'A short title' }));
  const shimmed = mcShim(raw, brief, 0);
  const p = CanonicalModel.safeParse(withHostFields(shimmed, true));
  const r = p.success ? compile(p.data, { sourceText: brief, asksNeedQuestions: false }) : null;
  console.log(f, 'instr changed', instr !== DRAFTING_INSTRUCTIONS, 'instr Δchars', instr.length - DRAFTING_INSTRUCTIONS.length, 'schema changed', mcSchema(CANONICAL_JSON_SCHEMA) !== CANONICAL_JSON_SCHEMA,
    'parse', p.success ? 'ok' : p.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message), 'errors', r?.errors.map((e) => e.code));
}
delete process.env['MC_FORMAT'];
console.log('A instr unchanged', mcInstructions(DRAFTING_INSTRUCTIONS) === DRAFTING_INSTRUCTIONS, 'A schema unchanged', mcSchema(CANONICAL_JSON_SCHEMA) === CANONICAL_JSON_SCHEMA);
