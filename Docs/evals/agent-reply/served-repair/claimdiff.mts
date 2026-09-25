import { assertsCompletedWrite as NEW } from '<cee-worktree>/src/orchestrator-v5/agent-lane/write-outcome.ts';
import { assertsCompletedWrite as OLD } from '<scratch>/write-outcome.old.ts';
import { readFileSync, readdirSync, statSync } from 'node:fs'; import { join } from 'node:path';
const files: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.jsonl?$/.test(f)) files.push(p); } };
process.argv.slice(2).forEach(walk);
const seen = new Set<string>(); let sent = 0, oldC = 0, newC = 0; const added: string[] = [], removed: string[] = [];
const visit = (o: any) => { if (!o || typeof o !== 'object' || typeof o.assistant_text !== 'string' || seen.has(o.assistant_text)) return; seen.add(o.assistant_text);
  for (const s of o.assistant_text.split(/(?<=[.!?])\s+|\n+/)) { if (!s.trim()) continue; sent++; const a = OLD(s), b = NEW(s); if (a) oldC++; if (b) newC++; if (b && !a) added.push(s.slice(0, 200)); if (a && !b) removed.push(s.slice(0, 200)); } };
for (const f of files) { const raw = readFileSync(f, 'utf8'); for (const l of (f.endsWith('.jsonl') ? raw.split('\n') : [raw])) { if (!l.trim()) continue; try { const j = JSON.parse(l); for (const x of (Array.isArray(j) ? j : [j])) { visit(x); visit(x?.json); visit(x?.response); } } catch {} } }
console.log(JSON.stringify({ texts: seen.size, sentences: sent, old_claims: oldC, new_claims: newC, newly_flagged: added.length, no_longer_flagged: removed.length }));
added.forEach((s) => console.log('  + ' + s)); removed.forEach((s) => console.log('  - ' + s));
