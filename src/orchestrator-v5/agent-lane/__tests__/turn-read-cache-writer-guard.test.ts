/**
 * ⛔ WRITER COMPLETENESS FOR THE READ CACHE (DL pre-review on #2114, question 1).
 *
 * `turnReadCache` is only sound if EVERY write the Agent turn can make advances its epoch. There are exactly two
 * ways a write reaches the model from this route:
 *   1. a dispatch through the turn's `countingDispatch` → `readCache.dispatch` (every non-read path runs in `around`);
 *   2. an in-process door the route hands the capabilities (`*InProcess`) or the first analysis, each run in `around`.
 * This guard fails when a third way appears: an agent-lane module that imports a writer directly, or a door called
 * outside `readCache.around`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const ROUTE = readFileSync(join(ROOT, 'src/routes/agent-v1-turn.ts'), 'utf8');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') out.push(...sources(p)); }
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** VALUE imports of a module that can write the model (a `import type` carries no writer). */
const WRITER_IMPORT = /^import\s+(?!type\b)[^;]*from\s+'[^']*(?:persist-graph-write|system-events\/dispatch|session\/index|session\/store|collab\/store)(?:\.js)?'/m;

describe('the read cache sees every write the Agent turn can make', () => {
  it('CONTRAST: the matcher finds the writers the ROUTE imports (so a zero below is not a blind probe)', () => {
    expect(WRITER_IMPORT.test(ROUTE)).toBe(true);
  });

  it('no agent-lane module imports a writer: its only write channels are the dispatch and the doors it is handed', () => {
    const files = sources(join(ROOT, 'src/orchestrator-v5/agent-lane'));
    expect(files.length, 'control: the lane has sources').toBeGreaterThan(20);
    const offenders = files.filter((f) => WRITER_IMPORT.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it('every in-process door and the first analysis run inside readCache.around', () => {
    const calls = [...ROUTE.matchAll(/(\w+InProcess|runFirstAnalysisAfterConstruction)\(/g)].map((m) => m.index!);
    const defs = [...ROUTE.matchAll(/import\s*\{[^}]*\}\s*from/g)].map((m) => [m.index!, m.index! + m[0].length] as const);
    const inCode = calls.filter((i) => !defs.some(([a, b]) => i >= a && i < b));
    expect(inCode.length, 'control: the doors are called here').toBeGreaterThanOrEqual(4);
    for (const i of inCode) {
      const before = ROUTE.slice(Math.max(0, i - 40), i);
      expect(before, ROUTE.slice(i, i + 60)).toMatch(/readCache\.around\(\(\) => $/);
    }
  });

  it('the capabilities write through the counting dispatch, and it reads through the cache', () => {
    expect(ROUTE).toMatch(/createAgentCapabilities\(\s*countingDispatch,/);
    expect(ROUTE).toMatch(/const countingDispatch[^]*?return readingDispatch\(path, body\);/);
    expect(ROUTE).toMatch(/const readingDispatch: typeof dispatch = readCache\.dispatch;/);
  });
});
