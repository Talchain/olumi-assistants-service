/** Architectural negative controls: restoring either exported legacy hash door
 * or the exported freshness policy fails, without relying on a happy-path Run. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const context = join(process.cwd(), 'src/orchestrator-v5/context');
const read = (name: string) => readFileSync(join(context, name), 'utf8');
const exportedFunctions = (name: string) => ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true)
  .statements.filter(ts.isFunctionDeclaration)
  .filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
  .map(node => node.name?.text);

describe('analysis identity and currency retain their existing authorities', () => {
  it('has no separate legacy hash implementation or exported legacy hash door', () => {
    expect(exportedFunctions('graph-hash-legacy.ts')).toEqual([]);
    expect(read('graph-hash-legacy.ts')).not.toMatch(/createHash|function|=>/);
    expect(exportedFunctions('graph-hash.ts').filter(name => name?.match(/legacy|frozen/i))).toEqual([]);
    const source = read('graph-hash.ts');
    expect(source).toContain("if (projection === 'legacy') return frozenLegacyProjectionHash(graph)");
    expect(source).toContain('Private frozen-version implementation of this hash authority');
  });

  it('keeps Run projection currency private to deriveAnalysisFreshness', () => {
    expect(exportedFunctions('analysis-projection-policy.ts')).not.toContain('runProjectionAllowsFreshness');
    expect(exportedFunctions('freshness.ts')).not.toContain('runProjectionAllowsFreshness');
    expect(read('freshness.ts')).toContain("function runProjectionAllowsFreshness(");
    expect(read('analysis-projection-policy.ts')).not.toContain('runProjectionAllowsFreshness');
  });
});
