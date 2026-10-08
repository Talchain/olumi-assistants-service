import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() && e.name !== '__tests__' ? files(join(dir, e.name)) : e.isFile() && e.name.endsWith('.ts') && !e.name.includes('.test.') ? [join(dir, e.name)] : []);
}
function walk(node: ts.Node, f: (n: ts.Node) => void) { f(node); ts.forEachChild(node, n => walk(n, f)); }
it('one authority: no route/orchestrator calls scenarioAccessDecision or authorizeScenarioOwnership', () => {
  const forbidden: string[] = [];
  for (const file of [...files('src/routes'), ...files('src/orchestrator')]) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const names = new Set(['scenarioAccessDecision', 'authorizeScenarioOwnership']);
    walk(source, n => {
      if (ts.isImportSpecifier(n) && names.has((n.propertyName ?? n.name).text)) names.add(n.name.text);
    });
    walk(source, n => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text : '';
      if (names.has(name)) forbidden.push(`${file}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    });
  }
  expect(forbidden).toEqual([]);
});
it('every source registration has explicit scenarioId config; graph alone enables member reads', () => {
  const missing: string[] = []; const members: string[] = [];
  for (const file of [...files('src/routes'), 'src/server.ts', 'src/orchestrator/route-v2.ts']) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    walk(source, n => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || !['get','post','patch','delete','put','options','head','all','route'].includes(n.expression.name.text) || !['app','fastify','server'].includes(n.expression.expression.getText(source))) return;
      const options = n.arguments[1];
      if (!options || !ts.isObjectLiteralExpression(options) || !/\bscenarioId\s*:/.test(options.getText(source))) missing.push(`${file}:${source.getLineAndCharacterOfPosition(n.getStart()).line+1}`);
      if (options?.getText(source).includes('viewerMemberRead: true')) members.push(file);
    });
  }
  expect(missing).toEqual([]); expect(members).toEqual(['src/routes/assist.v1.scenario-graph.ts']);
});
// A planted route in the real production build, not a replacement build function.
vi.mock('../routes/v1.limits.js', async load => {
  const actual = await load<any>();
  return { ...actual, limitsRoute: async (app: any) => { await actual.limitsRoute(app); app.get('/owniso-planted-undeclared', async () => ({ unsafe: true })); } };
});
it('build() rejects a planted route without a scenario declaration', async () => {
  vi.stubEnv('ASSIST_API_KEY', 'owniso-test-key'); vi.stubEnv('PROMPTS_ENABLED', 'false'); vi.stubEnv('OPENAI_API_KEY', 'owniso-not-a-real-provider-key'); vi.stubEnv('PROMPTS_WARMUP_ENABLED', 'false');
  const { build } = await import('../server.js');
  let app: Awaited<ReturnType<typeof build>> | undefined;
  let caught: unknown;
  try { app = await build(); } catch (e) { caught = e; }
  await app?.close();
  expect(caught instanceof Error ? caught.stack : String(caught)).toMatch(/scenarioId/);
}, 60000);
it('onRoute rejects an undeclared scenario route at boot', async () => {
  const app = Fastify();
  if (existsSync('src/plugins/scenario-ownership.ts')) { const { scenarioOwnershipPlugin } = await import('../plugins/scenario-ownership.js'); await app.register(scenarioOwnershipPlugin); }
  expect(() => app.post('/unsafe/:scenario_id', async () => ({ unsafe: true }))).toThrow(/scenarioId/);
  await app.close();
});
