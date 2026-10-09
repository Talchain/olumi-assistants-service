import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const SESSION = 'src/orchestrator-v5/session/supabase-store.ts';
const FRESHNESS = 'src/orchestrator-v5/context/freshness.ts';
/**
 * Reconciled OWN stored-Run reader families, not .order-call counts.
 * C2 bold OWN had nine: R03/R04/R05/R07/R21/R26/R27/R34/R55.
 * R07 now delegates; R34 consumes this turn's producer facts (compose.ts:412,
 * 544/749; chip-generator.ts:479/998), not a stored execution. R09 DOES choose
 * a stored execution for claim-safety (reconciler.ts:609/642): C2 and S29
 * describe it, but C2 did not bold-label OWN. Reconciled start n = 9 - 1 - 1 + 1 = 8; R21 now delegates, leaving 7.
 * R50 was over-counted: history-store.ts:217/226/228 keeps only a neutral
 * conversation marker (runHistoryMarker:173-185), not stored Run authority.
 */
const OWN = [
  { id: 'R03', file: SESSION, name: 'readNewestAnalysisFactFor', reason: 'Deprecated DB-created newest reader; no runtime caller found.' },
  { id: 'R04', file: SESSION, name: 'readRunCurrentness', reason: 'Any-quality computed-time currentness port; distinct eligibility/ties.' },
  { id: 'R05', file: SESSION, name: 'readNewestRunDeliveryFor', reason: 'Newest delivery for one exact execution, not newest successful analysis.' },
  { id: 'R09', file: 'src/orchestrator-v5/context/reconcile-scenario-analysis-facts.ts', name: 'validateDurableContract', reason: 'C2/S29: stored-order first fact supplies claim-safety attestation (609/642); OWN omitted from bold census classification.' },
  { id: 'R26', file: 'src/orchestrator-v5/model-management/version-result-binding.ts', name: 'bind', reason: 'Historical version identity binding uses computed_at DESC then run_id ASC; shared stable input-order ties would change the selected Run.' },
  { id: 'R27', file: 'src/orchestrator-v5/context/changed-since-run.ts', name: 'newestRunBoundary', reason: 'DB execution order places mutation marks; shared computation ordering can change the boundary and which edits are marked.' },
  { id: 'R55', file: 'tools/v5-journey-replay/assurance/facts.ts', name: 'latestRunAnalysisHash', reason: 'Maintenance stored-Run hash: action_type filter plus created_at LIMIT 1; count-only summariseHandlerFacts is not selection.' },
] as const;
const BASELINE = 7;
const RECONCILED_OWN_IDS = ['R03', 'R04', 'R05', 'R09', 'R26', 'R27', 'R55'];
// Sanctioned set readers return collections, never implement a private single-Run choice.
const sanctioned = new Set(['readFactsWithTurnFor', 'readRecentAppliedMutationFactsFor', 'readScenarioRunAnalysisFactsFor']);
type Hit = { file: string; name: string; kind: 'query' | 'sort' | 'stored-order'; line: number };
function stripComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const spans: [number, number][] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      spans.push([scanner.getTokenPos(), scanner.getTextPos()]);
    }
  }
  // Preserve lengths/newlines for source locations; comment-only matches cannot count.
  for (const [a, b] of spans.reverse()) source = source.slice(0, a) + source.slice(a, b).replace(/[^\n]/g, ' ') + source.slice(b);
  return source;
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return /^(?:__tests__|fixtures|node_modules)$/.test(entry.name) ? [] : files(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}
function namedOwner(node: ts.Node, source: ts.SourceFile): { name: string; text: string } {
  for (let parent: ts.Node | undefined = node; parent !== undefined; parent = parent.parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) {
      return { name: parent.name.getText(source), text: parent.getText(source) };
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer && ts.isArrowFunction(parent.initializer)) {
      return { name: parent.name.getText(source), text: parent.getText(source) };
    }
  }
  return { name: '<module>', text: source.text };
}
function scanSource(file: string, input: string): Hit[] {
  const stripped = stripComments(input);
  if (!/v5_handler_facts/.test(stripped) && !(/run_analysis|isSuccessfulRunAnalysisFact|parseIdentifiedRunAnalysisFact/.test(stripped)
    && /\.sort\s*\(|extractLatestCoachingSignalFromFacts|newestRunBoundary/.test(stripped))) return [];
  const source = ts.createSourceFile(file, stripped, ts.ScriptTarget.Latest, true);
  const hits = new Map<string, Hit>();
  function add(node: ts.Node, kind: Hit['kind']) {
    const owner = namedOwner(node, source);
    hits.set(`${owner.name}:${kind}`, { file, name: owner.name, kind,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const owner = namedOwner(node, source);
      const text = node.getText(source);
      if (method === 'order' && /['"](?:created_at|[^'"]*computed_at)['"]/.test(node.arguments[0]?.getText(source) ?? '')
        && /\.from\(\s*['"]v5_handler_facts['"]\s*\)/.test(owner.text)
        && !(file === SESSION && sanctioned.has(owner.name))) add(node, 'query');
      if (method === 'sort' && /run_analysis|isSuccessfulRunAnalysisFact|parseIdentifiedRunAnalysisFact/.test(owner.text)
        && /computed_at|fact_created_at|comparePersistedFactsNewestFirst|run_analysis/.test(text)) add(node, 'sort');
    }
    // C2's OWN forward/reverse scans don't spell .sort; pin these explicitly too.
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      const name = node.name.getText(source);
      if (['extractLatestCoachingSignalFromFacts', 'newestRunBoundary'].includes(name)
        && /run_analysis/.test(node.getText(source))
        && !/\borderRunAnalysisFacts\s*\(/.test(node.getText(source))) add(node, 'stored-order');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  // Raw SQL strings are covered as well as the PostgREST chain, outside sanctioned storage.
  if (file !== SESSION && /(?:FROM|JOIN)\s+(?:public\.)?v5_handler_facts\b[\s\S]*?ORDER\s+BY\s+[^;`]*(?:created_at|computed_at)/i.test(source.text)) {
    hits.set('raw-sql:query', { file, name: '<raw-sql>', kind: 'query', line: 1 });
  }
  return [...hits.values()];
}
function scan() {
  // R55 is a real stored-fact picker outside src/. Include its maintenance
  // module directory; importing/executing maintenance code is unnecessary.
  return [...files(join(root, 'src')), ...files(join(root, 'tools/v5-journey-replay/assurance'))]
    .flatMap(path => scanSource(relative(root, path), readFileSync(path, 'utf8')));
}
describe('S1 Run-selection census ratchet', () => {
  let scanned: Hit[];
  beforeAll(() => { scanned = scan(); }, 30_000);
  it('pins the remaining OWN reader families at n=7 (up AND down fail)', () => {
    const hits = scanned.filter(hit => hit.file !== FRESHNESS);
    const unknown = hits.filter(hit => !OWN.some(entry => entry.file === hit.file && entry.name === hit.name));
    expect(unknown, 'New private Run-selection site; delegate to freshness or justify census change').toEqual([]);
    expect(hits).toHaveLength(BASELINE);
    expect(hits.map(hit => OWN.find(entry => entry.file === hit.file && entry.name === hit.name)!.id).sort())
      .toEqual(OWN.map(entry => entry.id).sort());
    expect(OWN.map(entry => entry.id).sort()).toEqual(RECONCILED_OWN_IDS);
    expect(OWN.every(entry => entry.reason.length > 0)).toBe(true);
  });
  it('R55 contrast: detects the actual maintenance stored-Run query outside src/', () => {
    expect(scanned.filter(hit => hit.file === 'tools/v5-journey-replay/assurance/facts.ts'
      && hit.name === 'latestRunAnalysisHash' && hit.kind === 'query')).toHaveLength(1);
    // Its sibling summarises counts; it does not choose an execution.
    expect(scanned.filter(hit => hit.name === 'summariseHandlerFacts')).toEqual([]);
  });
  it('contrast: finds freshness.ts’s own sort, non-zero', () => {
    expect(scanned.filter(hit => hit.file === FRESHNESS && hit.kind === 'sort').length).toBeGreaterThan(0);
  });
  it('detects a LIMIT-1 query and private Run sort, while ignoring comment-only matches', () => {
    const query = `async function rogue() { return client.from('v5_handler_facts').select('payload').order('created_at', { ascending: false }).limit(1); }`;
    const sort = `function rogue(facts) { return facts.filter(f => f.fact_type === 'run_analysis').sort((a,b) => b.result.computed_at.localeCompare(a.result.computed_at)); }`;
    expect(scanSource('src/rogue.ts', query).map(hit => hit.kind)).toEqual(['query']);
    expect(scanSource('src/rogue.ts', `async function rogue() { const query = client.from('v5_handler_facts'); return query.order('computed_at', { ascending: false }).limit(1); }`)
      .map(hit => hit.kind)).toEqual(['query']);
    expect(scanSource('src/rogue.ts', sort).map(hit => hit.kind)).toEqual(['sort']);
    const delegated = `function extractLatestCoachingSignalFromFacts(facts) {
      for (const { fact } of orderRunAnalysisFacts(facts, { requireSuccessfulStatus: false })) {
        if (fact.fact_type === 'run_analysis') return fact;
      }
    }`;
    expect(scanSource('src/delegated.ts', delegated)).toEqual([]);
    expect(scanSource('src/delegated.ts', delegated.replace('return fact;',
      `return facts.sort((a,b) => b.result.computed_at.localeCompare(a.result.computed_at))[0];`))
      .map(hit => hit.kind)).toEqual(['sort']);
    expect(scanSource('src/comment.ts', `/* ${query} */\n// ${sort}`)).toEqual([]);
  });
});
