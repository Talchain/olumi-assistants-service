import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ALLOW = new Set([
  'orchestrator-v5/goal-target/horizon-basis.ts',
  'orchestrator-v5/goal-target/goal-horizon-verdict.ts',
  'schemas/cee-v3.ts', 'schemas/value-warrant-guard.ts', 'adapters/llm/normalisation.ts',
  'orchestrator-v5/graph-management/field-safety.ts', 'orchestrator-v5/context/graph-hash.ts',
]);
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}
describe('S4: the typed horizon verdict is the sole consumer path', () => {
  it('ratchets raw fields and old predicate calls, with live-walk contrasts', () => {
    const files = walk(ROOT).map(path => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
    const A = files.filter(file => !ALLOW.has(file.path) && /horizon_basis_(source|months|key)/.test(file.text));
    const B = files.filter(file => !['orchestrator-v5/goal-target/goal-horizon-verdict.ts',
      'orchestrator-v5/goal-target/horizon-basis.ts'].includes(file.path) && /\bhorizonSteadyAttested\s*\(/.test(file.text));
    const C = files.filter(file => file.path !== 'orchestrator-v5/goal-target/goal-horizon-verdict.ts'
      && /\baccumulationTestedAtGoalHorizon\s*\(/.test(file.text));
    const offenders = [A, B, C].map((rows, i) => `${'ABC'[i]}=${rows.length}: ${rows.map(row => row.path).join(', ')}`).join('\n');
    expect(A.length + B.length + C.length, offenders).toBe(0);
    const callers = files.filter(file => file.path !== 'orchestrator-v5/goal-target/goal-horizon-verdict.ts'
      && /\bgoalHorizonVerdict\s*\(/.test(file.text)).length;
    expect(callers).toBeGreaterThanOrEqual(4);
    expect(files.length).toBeGreaterThanOrEqual(1000);
    process.stdout.write(`S4 ratchet: A=${A.length} B=${B.length} C=${C.length}, verdict callers=${callers}, files=${files.length}\n`);
  });
});
