/** Source-only AST inventory and argument-flow pins. No typecheck, filesystem writes or network. */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const members = new Set(['flip_thresholds', 'option_comparison', 'win_probability', 'leading_option_id', 'winner']);
type Sources = Map<string, string>;
function runtimeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || entry.name === 'fixtures') return [];
    const file = join(dir, entry.name);
    return entry.isDirectory() ? runtimeFiles(file) : entry.name.endsWith('.ts')
      && !/\.(?:d|test|spec)\.ts$/.test(entry.name) ? [file] : [];
  });
}
const files = [...runtimeFiles(join(root, 'src/cee/decision-review')),
  ...readdirSync(join(root, 'src/orchestrator-v5/coaching')).filter(f => /^decision-review-.*\.ts$/.test(f))
    .map(f => join(root, 'src/orchestrator-v5/coaching', f))];
const scoped: Sources = new Map(files.map(file => [relative(root, file), readFileSync(file, 'utf8')]));
const route = 'src/routes/assist.v1.decision-review.ts';
// Discover callers across runtime src, so a new outside-scope omission cannot hide.
const callerSources: Sources = new Map(runtimeFiles(join(root, 'src')).flatMap(file => {
  const source = readFileSync(file, 'utf8');
  return /buildDecisionReviewUserMessage|buildSlices/.test(source) ? [[relative(root, file), source] as [string, string]] : [];
}));
const sources: Sources = new Map([...scoped, ...callerSources]);
function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}
function enclosing(n: ts.Node, source: ts.SourceFile): string {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return p.name?.getText(source) ?? '<anonymous>';
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent))
      return p.parent.name.getText(source);
  }
  return '<module>';
}
function inventory(input: Sources): Map<string, number> {
  const sites = new Map<string, number>();
  for (const [file, source] of input) {
    const ast = parse(file, source);
    const visit = (n: ts.Node): void => {
      if (ts.isTypeNode(n)) return;
      let member: string | undefined, receiver: string | undefined;
      if (ts.isPropertyAccessExpression(n)) { member = n.name.text; receiver = n.expression.getText(ast); }
      else if (ts.isElementAccessExpression(n) && n.argumentExpression && ts.isStringLiteralLike(n.argumentExpression)) {
        member = n.argumentExpression.text; receiver = n.expression.getText(ast);
      } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
        const key = n.propertyName ?? n.name;
        member = ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression) ? key.expression.text
          : ts.isStringLiteralLike(key) ? key.text : key.getText(ast);
        const declaration = n.parent.parent;
        receiver = ts.isVariableDeclaration(declaration) ? declaration.initializer?.getText(ast) : '<binding>';
      }
      const assignment = n.parent !== undefined && ts.isBinaryExpression(n.parent) && n.parent.left === n
        && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (member !== undefined && members.has(member) && !assignment) {
        const site = [file, enclosing(n, ast), receiver, member].join('|');
        sites.set(site, (sites.get(site) ?? 0) + 1);
      }
      ts.forEachChild(n, visit);
    };
    visit(ast);
  }
  return sites;
}
// Exact-site classifications: approved input serialization/grounding or parsed response validation.
// They are not raw Run exemptions; unknown receivers/sites still fail the census.
const classified = new Map<string, number>([
  ["src/cee/decision-review/decompose.ts|buildSlices|licensedFacts|winner", 1],
  ["src/cee/decision-review/decompose.ts|buildSlices|isl|option_comparison", 1],
  ["src/cee/decision-review/decompose.ts|buildSlices|input|winner", 10],
  ["src/cee/decision-review/decompose.ts|buildSlices|input.winner|win_probability", 2],
  ["src/cee/decision-review/decompose.ts|buildSlices|input.runner_up|win_probability", 1],
  ["src/cee/decision-review/decompose.ts|buildSlices|o|win_probability", 1],
  ["src/cee/decision-review/decompose.ts|composeFragments|r3|flip_thresholds", 2],
  ["src/cee/decision-review/decompose.ts|checkComposedConsistency|out|flip_thresholds", 3],
  ["src/cee/decision-review/invoke.ts|buildDecisionReviewUserMessage|licensedFacts|winner", 1],
  ["src/cee/decision-review/invoke.ts|buildDecisionReviewUserMessage|islRaw|option_comparison", 1],
  ["src/cee/decision-review/invoke.ts|buildDecisionReviewUserMessage|b|win_probability", 1],
  ["src/cee/decision-review/invoke.ts|buildDecisionReviewUserMessage|a|win_probability", 1],
  ["src/cee/decision-review/invoke.ts|buildDecisionReviewUserMessage|input|winner", 2],
  ["src/cee/decision-review/invoke.ts|invokeDecisionReview|input.winner|win_probability", 2],
  ["src/cee/decision-review/invoke.ts|invokeDecisionReview|input|winner", 2],
  ["src/cee/decision-review/invoke.ts|invokeDecisionReview|input.runner_up|win_probability", 1],
  ["src/cee/decision-review/shape-check.ts|extractGroundedNumbers|input.winner|win_probability", 1],
  ["src/cee/decision-review/shape-check.ts|extractGroundedNumbers|input|winner", 3],
  ["src/cee/decision-review/shape-check.ts|extractGroundedNumbers|input.runner_up|win_probability", 1],
  ["src/cee/decision-review/shape-check.ts|extractGroundedNumbers|input.isl_results|option_comparison", 1],
  ["src/cee/decision-review/shape-check.ts|extractGroundedNumbers|oc|win_probability", 1],
  ["src/cee/decision-review/shape-check.ts|performShapeCheck|obj|flip_thresholds", 3],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|enrichRunAnalysisWithDecisionReview|invokeInput|winner", 5],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|enrichRunAnalysisWithDecisionReview|invokeInput.winner|win_probability", 2],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|buildInvokeInput|facts|winner", 1],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|buildInvokeInput|winner|win_probability", 2],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|buildInvokeInput|runnerUp|win_probability", 1],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|readIslResults|enrichment|option_comparison", 2],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|readIslResults|r|win_probability", 2],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|computeDecisionReviewOutputDensity|output|flip_thresholds", 2],
]);
// Raw reads retained for telemetry only, shrink-only (file|function|receiver|member, n).
const exemptions = new Map<string, number>([
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|enrichRunAnalysisWithDecisionReview|fact.result|leading_option_id", 2],
  ["src/orchestrator-v5/coaching/decision-review-enricher.ts|computeDecisionReviewInputDensity|enrichment|option_comparison", 2],
]);
function checkInventory(input: Sources): void {
  const actual = inventory(input), allowed = new Map([...classified, ...exemptions]);
  for (const [site, n] of actual) {
    if (!allowed.has(site) || n > allowed.get(site)!) throw new Error('Unlicensed read: ' + site);
  }
  for (const site of allowed.keys()) if (!actual.has(site)) throw new Error('Stale site: ' + site);
}
interface Call { file: string; fn: string; args: string[] }
function calls(input: Sources, name: string): Call[] {
  const found: Call[] = [];
  for (const [file, source] of input) {
    const ast = parse(file, source);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText(ast) === name)
        found.push({ file, fn: enclosing(n, ast), args: n.arguments.map(arg => arg.getText(ast)) });
      ts.forEachChild(n, visit);
    };
    visit(ast);
  }
  return found;
}
function variable(input: Sources, file: string, fn: string, name: string): string | undefined {
  const ast = parse(file, input.get(file)!);
  let initializer: string | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === name && enclosing(n, ast) === fn)
      initializer = n.initializer?.getText(ast);
    ts.forEachChild(n, visit);
  };
  visit(ast);
  return initializer;
}
const enricher = 'src/orchestrator-v5/coaching/decision-review-enricher.ts';
const invokeFile = 'src/cee/decision-review/invoke.ts';
const decompose = 'src/cee/decision-review/decompose.ts';
function checkFlow(input: Sources): void {
  const requireFlow = (condition: boolean): void => { if (!condition) throw new Error('Licensed argument flow missing'); };
  const projection = variable(input, enricher, 'enrichRunAnalysisWithDecisionReview', 'licensedFacts');
  requireFlow(projection === 'buildLicensedRunFacts(fact, input.scenarioId, input.runGraph, input.currentGraph)');
  requireFlow(calls(input, 'buildInvokeInput').some(call => call.fn === 'enrichRunAnalysisWithDecisionReview'
    && call.args[1] === 'licensedFacts'));
  requireFlow(variable(input, enricher, 'buildInvokeInput', 'enrichment') === 'facts.enrichment');
  requireFlow(variable(input, enricher, 'buildInvokeInput', 'winner') === 'facts.winner');
  requireFlow(variable(input, enricher, 'enrichRunAnalysisWithDecisionReview', 'invoke')
    === 'config.cee.decisionReviewDecompose\n      ? invokeDecomposedDecisionReview\n      : invokeDecisionReview');
  const dispatch = calls(input, 'invoke').filter(call => call.file === enricher);
  requireFlow(dispatch.length === 1 && dispatch[0]!.args[0] === 'invokeInput');
  // Object shorthand is a real AST argument member, not an import/comment/string.
  const dispatchAst = parse(enricher, input.get(enricher)!);
  let passesFacts = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(dispatchAst) === 'invoke') {
      const options = n.arguments[1];
      passesFacts = options !== undefined && ts.isObjectLiteralExpression(options) && options.properties.some(p =>
        ts.isShorthandPropertyAssignment(p) && p.name.text === 'licensedFacts');
    }
    ts.forEachChild(n, visit);
  };
  visit(dispatchAst); requireFlow(passesFacts);
  const builders = calls(input, 'buildDecisionReviewUserMessage');
  const omitted = builders.filter(call => call.args.length < 3);
  // One exact shrink-only omission exemption, n=1; it must still exist.
  requireFlow(omitted.length > 0 && omitted.length <= 1);
  requireFlow(omitted.every(call => call.file === route && call.fn === 'route'));
  requireFlow(builders.some(call => call.file === invokeFile && call.args[2] === 'options.licensedFacts'));
  requireFlow(calls(input, 'buildSlices').some(call => call.file === decompose && call.args[1] === 'options.licensedFacts'));
  requireFlow(calls(input, 'invokeDecisionReview').some(call => call.file === decompose
    && call.args[1] === '{ ...options, timeoutMs: budget.timeoutMs }'));
  // Both builders consume the licensed winner rather than retaining the raw input winner.
  for (const [file, fn] of [[invokeFile, 'buildDecisionReviewUserMessage'], [decompose, 'buildSlices']]) {
    const ast = parse(file!, input.get(file!)!); let consumed = false;
    const visit = (n: ts.Node): void => {
      if (ts.isSpreadAssignment(n) && n.expression.getText(ast) === 'licensedFacts.winner'
        && enclosing(n, ast) === fn) consumed = true;
      ts.forEachChild(n, visit);
    };
    visit(ast); requireFlow(consumed);
  }
}
const mutated = (file: string, before: string, after: string): Sources => {
  const input = new Map(sources); const original = input.get(file)!;
  expect(original).toContain(before);
  input.set(file, original.replace(before, after)); return input;
};
describe('decision review licensed raw-read and argument-flow guard', () => {
  it('runtime census is nonempty, exact-site classified and shrink-only with no stale exemption', () => {
    expect(inventory(scoped).size).toBeGreaterThan(0);
    expect(() => checkInventory(scoped)).not.toThrow();
  });
  it('the one licensed object flows through both enricher paths, both builders and the fallback; HTTP alone omits it', () => {
    expect(() => checkFlow(sources)).not.toThrow();
  });
  it('m-a new scoped raw option comparison read fails', () => {
    const mutant = new Map(scoped);
    mutant.set('src/cee/decision-review/new-reader.ts', 'function leak(raw: unknown) { return raw.option_comparison; }');
    expect(() => checkInventory(mutant)).toThrow('Unlicensed read');
  });
  it('m-b removing the licensed-facts message-builder argument fails', () => {
    expect(() => checkFlow(mutated(invokeFile, 'buildDecisionReviewUserMessage(input, margin, options.licensedFacts)',
      'buildDecisionReviewUserMessage(input, margin)'))).toThrow('Licensed argument flow missing');
  });
  it('m-d feeding the review\'s grounding graph as the CURRENT graph fails (edit-after-Run would never be seen)', () => {
    expect(() => checkFlow(mutated(enricher, 'buildLicensedRunFacts(fact, input.scenarioId, input.runGraph, input.currentGraph)',
      'buildLicensedRunFacts(fact, input.scenarioId, input.runGraph, input.runGraph)'))).toThrow('Licensed argument flow missing');
  });
  it('m-c replacing the consumed licensed enrichment with raw enrichment fails', () => {
    expect(() => checkFlow(mutated(enricher, 'const enrichment = facts.enrichment;',
      'const enrichment = raw;'))).toThrow('Licensed argument flow missing');
  });
  it('parser recognises property, element and destructuring reads; ignores comments and pure assignment targets', () => {
    const rows = inventory(new Map([['probe.ts', 'function probe(raw: unknown) { /* raw.win_probability */ raw.winner = null; '
      + 'return [raw.win_probability, raw["option_comparison"], raw[`winner`], (() => { const { ["flip_thresholds"]: flips, "win_probability": share } = raw; return [flips, share]; })()]; }']]));
    expect([...rows.keys()]).toEqual(['probe.ts|probe|raw|win_probability', 'probe.ts|probe|raw|option_comparison',
      'probe.ts|probe|raw|winner', 'probe.ts|probe|raw|flip_thresholds']);
    expect([...rows.values()]).toEqual([2, 1, 1, 1]);
  });
});
