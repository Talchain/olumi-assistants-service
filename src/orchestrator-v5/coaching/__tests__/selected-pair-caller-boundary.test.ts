import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : files(path);
    return entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name) ? [path] : [];
  });
}
describe('selected version pairs cannot enter the turn freshness path', () => {
  it('derives all real builder calls; only version compare supplies selectedPair', () => {
    const callers: string[] = []; const explicit: string[] = [];
    for (const path of files(join(root, 'src'))) {
      const text = readFileSync(path, 'utf8');
      if (!text.includes('buildRunDelta')) continue;
      const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'buildRunDelta') {
          const name = relative(root, path).replaceAll('\\', '/'); callers.push(name);
          const arg = node.arguments[0];
          if (arg !== undefined && ts.isObjectLiteralExpression(arg) && arg.properties.some(property =>
            property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
              && property.name.text === 'selectedPair')) explicit.push(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(callers.sort()).toStrictEqual([
      'src/orchestrator-v5/context/context-pack-assembler.ts',
      'src/orchestrator-v5/response-finaliser.ts',
      'src/routes/assist.v1.scenario-versions.ts',
      'src/routes/scenario-graph-analysis-read.ts',
    ]);
    expect(explicit).toStrictEqual(['src/routes/assist.v1.scenario-versions.ts']);
  });
});
