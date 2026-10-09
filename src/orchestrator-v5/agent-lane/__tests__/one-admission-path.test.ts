/** S7: production admission census, recorded rows and the 116-draft monotonicity ratchet. Zero LLM. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { AdmittedModel, CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
interface Row { id: string; brief: string; drafter_texts: string[]; widening_texts?: string[] }
interface Baseline { failing_ids: string[]; failing_count: number }
type Snapshot = { candidate: CandidateModel; admitted: AdmittedModel; admit: (model: CandidateModel) => AdmittedModel; admitBase: (model: CandidateModel) => AdmittedModel };
const ROOT = path.resolve(__dirname, '../../../..');
const SRC = path.join(ROOT, 'src');
const fixtures = path.join(__dirname, 'fixtures');
const recorded = JSON.parse(fs.readFileSync(path.join(fixtures, 's7-one-admission-recorded.json'), 'utf8')) as Row[];

async function replay(row: Row, widening = false, observe?: (s: Snapshot) => void) {
  let graph: Rec | undefined;
  let d = 0;
  let w = 0;
  const dispatch: InternalDispatch = async (route, body) => {
    if (route.endsWith('/graph/register')) {
      graph = structuredClone((body as Rec).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (route.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (route.endsWith('/graph')) return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 's7' } };
    return { status: 404, json: {} };
  };
  const drafter: CallStructuredModel = async () => ({ text: row.drafter_texts[Math.min(d++, row.drafter_texts.length - 1)]!, status: 'completed' });
  const wider: CallStructuredModel = async () => {
    if (w >= (row.widening_texts?.length ?? 0)) throw new Error(`${row.id}: unexpected widening call`);
    return { text: row.widening_texts![w++]!, status: 'completed' };
  };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000077', row.brief, dispatch, drafter,
    undefined, undefined, widening ? wider : undefined, observe);
  return { graph, result: result as Rec, wideningCalls: w };
}

function ratchetFailures(now: string[], baseline: Baseline): string[] {
  const failures = now.filter(id => !baseline.failing_ids.includes(id)).map(id => `newly failing: ${id}`);
  if (now.length > baseline.failing_count) failures.push(`failing ${now.length} > baseline ${baseline.failing_count}`);
  const stale = baseline.failing_ids.filter(id => !now.includes(id));
  if (stale.length) failures.push(`stale baseline: remove ids ${stale.join(', ')}`);
  return failures;
}

const BUILD_FILE = 'orchestrator-v5/agent-lane/runtime/build-model.ts';
const ADMIT_FILE = 'orchestrator-v5/agent-lane/admit-model.ts';
const protectedNames = new Set(['admitCandidateModel', 'admitOrdinaryCandidateModel']);

/** A virtual TS program resolves import aliases, namespaces and re-export chains to their original symbols. */
function scanSources(sources: Map<string, string>) {
  const virtualRoot = '/s7-source';
  const full = (file: string) => path.posix.join(virtualRoot, file);
  const texts = new Map([...sources].map(([file, source]) => [full(file), source]));
  const host: ts.CompilerHost = {
    getSourceFile: (file, languageVersion) => texts.has(file) ? ts.createSourceFile(file, texts.get(file)!, languageVersion, true) : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => virtualRoot,
    getDirectories: () => [], fileExists: file => texts.has(file), readFile: file => texts.get(file),
    getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, containing) => names.map(name => {
      if (!name.startsWith('.')) return undefined;
      const target = path.posix.resolve(path.posix.dirname(containing), name);
      const stem = target.replace(/\.[cm]?js$/, '');
      const resolvedFileName = [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${target}/index.ts`].find(file => texts.has(file));
      return resolvedFileName ? { resolvedFileName } : undefined;
    }),
  };
  const program = ts.createProgram([...texts.keys()], { noLib: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext }, host);
  const checker = program.getTypeChecker();
  const allowed: string[] = [];
  const forbidden: string[] = [];
  for (const file of sources.keys()) {
    const ast = program.getSourceFile(full(file))!;
    let allowedBody: ts.Node | undefined;
    if (file === BUILD_FILE) {
      const builds = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'buildModelFromBrief');
      const declarations = builds.length === 1 && builds[0]!.body
        ? builds[0]!.body.statements.filter(ts.isVariableStatement).flatMap(stmt => [...stmt.declarationList.declarations])
          .filter(node => ts.isIdentifier(node.name) && node.name.text === 'admitForBuild') : [];
      if (declarations.length === 1 && declarations[0]!.initializer && ts.isArrowFunction(declarations[0]!.initializer))
        allowedBody = declarations[0]!.initializer.body;
      else forbidden.push(`${file}: expected exactly one admitForBuild arrow declared directly inside buildModelFromBrief`);
    }
    const protectedSymbol = (node: ts.Node): boolean => {
      let symbol = checker.getSymbolAtLocation(node);
      const seen = new Set<ts.Symbol>();
      while (symbol && (symbol.flags & ts.SymbolFlags.Alias) && !seen.has(symbol)) {
        seen.add(symbol); symbol = checker.getAliasedSymbol(symbol);
      }
      return symbol !== undefined && protectedNames.has(symbol.name)
        && (symbol.declarations ?? []).some(declaration => declaration.getSourceFile().fileName === full(ADMIT_FILE));
    };
    const isAdmission = (expression: ts.Expression): boolean => {
      if (ts.isParenthesizedExpression(expression)) return isAdmission(expression.expression);
      if (ts.isPropertyAccessExpression(expression) && ['call', 'apply', 'bind'].includes(expression.name.text)) return isAdmission(expression.expression);
      const name = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
      // Also catch a plainly named unbound call in planted source (and fail closed on that name).
      return (ts.isIdentifier(name) && protectedNames.has(name.text)) || protectedSymbol(name);
    };
    const record = (node: ts.Node, kind: string, canAllow = true) => {
      const hit = `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}:${kind}`;
      if (canAllow && (file === ADMIT_FILE || (file === BUILD_FILE && allowedBody && node.pos >= allowedBody.pos && node.end <= allowedBody.end))) allowed.push(hit);
      else forbidden.push(hit);
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isAdmission(node.expression)) record(node, node.expression.getText(ast));
      if (ts.isExportSpecifier(node) && (protectedSymbol(node.name) || protectedSymbol(node.propertyName ?? node.name)))
        record(node, `re-export ${node.getText(ast)}`, false);
      if (ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier) {
        const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
        if (symbol && checker.getExportsOfModule(symbol).some(exported => {
          const original = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
          return protectedNames.has(original.name) && (original.declarations ?? []).some(d => d.getSourceFile().fileName === full(ADMIT_FILE));
        })) record(node, 're-export * admission', false);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return { allowed, forbidden };
}
function scan(file: string, source: string, extra = new Map<string, string>()) {
  return scanSources(new Map([
    [ADMIT_FILE, 'export function admitCandidateModel(c: unknown) {} export function admitOrdinaryCandidateModel(c: unknown) {}'],
    ...extra, [file, source],
  ]));
}

describe('one production admission path', () => {
  it('has zero calls outside admit-model or build admitForBuild; allowed calls prove the scan is live', () => {
    const sources = new Map<string, string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          sources.set(path.relative(SRC, full), source);
        }
      }
    };
    walk(SRC);
    // Parse only files that can reach admit-model's exports: those naming it or a protected symbol, then (to a fixpoint)
    // any file importing or re-exporting one of those by module name. Conservative: a superset of every alias/barrel chain.
    const stem = (file: string) => path.basename(file).replace(/\.[cm]?[jt]sx?$/, '');
    const reach = new Set([...sources.keys()].filter(f => /admit-model|admitCandidateModel|admitOrdinaryCandidateModel/.test(sources.get(f)!)));
    for (let grew = true; grew;) {
      grew = false;
      const stems = [...reach].map(stem);
      for (const [f, text] of sources) if (!reach.has(f) && stems.some(s => text.includes(`/${s}.js'`) || text.includes(`/${s}'`) || text.includes(`/${s}.js"`) || text.includes(`/${s}"`))) { reach.add(f); grew = true; }
    }
    const { allowed, forbidden } = scanSources(new Map([...sources].filter(([f]) => reach.has(f))));
    expect(allowed.filter(hit => hit.startsWith('orchestrator-v5/agent-lane/runtime/build-model.ts:')).length).toBeGreaterThanOrEqual(1);
    expect(forbidden, 'production admission ratchet: target 0').toEqual([]);
  }, 120_000);
  it('detects a planted second path, ignores comments, and refuses calls outside the allowed body', () => {
    expect(scan('planted.ts', '// admitCandidateModel(c)\n/* admitOrdinaryCandidateModel(c) */').forbidden).toEqual([]);
    expect(scan('planted.ts', 'admitCandidateModel(c)').forbidden).toHaveLength(1);
    const found = scan('orchestrator-v5/agent-lane/runtime/build-model.ts',
      'function buildModelFromBrief() { const admitForBuild = (c) => { return admitCandidateModel(c); }; } admitOrdinaryCandidateModel(c);');
    expect(found.allowed).toHaveLength(1);
    expect(found.forbidden).toHaveLength(1);
  });
});

describe('source guard bypass controls', () => {
  for (const [name, source] of [
    ['alias import', "import { admitCandidateModel as x } from './orchestrator-v5/agent-lane/admit-model.js'; x(c);"],
    ['namespace import', "import * as m from './orchestrator-v5/agent-lane/admit-model.js'; m.admitCandidateModel(c);"],
    ...['call', 'apply', 'bind'].map(method => [method, `admitCandidateModel.${method}(undefined, c);`]),
    ['re-export alias', "export { admitCandidateModel as x } from './orchestrator-v5/agent-lane/admit-model.js';"],
  ]) it(`flags ${name}`, () => { expect(scan('planted.ts', source!).forbidden.length).toBeGreaterThan(0); });
  it('resolves a renamed import through a re-export chain', () => {
    const found = scan('consumer.ts', "import { renamed as x } from './barrel.js'; x(c);",
      new Map([['barrel.ts', "export { admitCandidateModel as renamed } from './orchestrator-v5/agent-lane/admit-model.js';"]]));
    expect(found.forbidden.some(hit => hit.startsWith('consumer.ts:'))).toBe(true);
    expect(found.forbidden.some(hit => hit.startsWith('barrel.ts:'))).toBe(true);
  });
  it('flags a namespace indirect invocation', () => {
    expect(scan('planted.ts', "import * as m from './orchestrator-v5/agent-lane/admit-model.js'; m.admitOrdinaryCandidateModel.apply(undefined, [c]);").forbidden).toHaveLength(1);
  });
  it('refuses an absent direct declaration even when there are no calls', () => {
    expect(scan(BUILD_FILE, 'function buildModelFromBrief() {}').forbidden).toHaveLength(1);
  });
  it('allows only the direct declaration, rejecting a nested namesake', () => {
    const found = scan(BUILD_FILE, 'function buildModelFromBrief() { const admitForBuild = (c) => admitCandidateModel(c); function nested() { const admitForBuild = (c) => admitOrdinaryCandidateModel(c); } }');
    expect(found.allowed).toHaveLength(1);
    expect(found.forbidden).toHaveLength(1);
  });
  it('refuses a namesake in another enclosing function', () => {
    const found = scan('orchestrator-v5/agent-lane/runtime/build-model.ts',
      'function other() { const admitForBuild = (c) => admitCandidateModel(c); }');
    expect(found.allowed).toEqual([]);
    expect(found.forbidden.length).toBeGreaterThan(0);
  });
  it('refuses two direct declarations', () => {
    const found = scan('orchestrator-v5/agent-lane/runtime/build-model.ts',
      'function buildModelFromBrief() { const admitForBuild = (c) => admitCandidateModel(c); const admitForBuild = (c) => admitOrdinaryCandidateModel(c); }');
    expect(found.allowed).toEqual([]);
    expect(found.forbidden.length).toBeGreaterThan(0);
  });
});

// Review scenario: the baseline clause has “revenue”, but no “monthly”.
const revenueCandidate: CandidateModel = {
  goal: { metric: 'Monthly revenue', operator: '>=', value: 20, unit: 'GBP/month', horizon_months: null, frame: 'change_rel', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', provenance: 'explicit' },
  constraints: [],
  options: [
    { label: 'Keep price', changes: [], interventions: [], is_status_quo: true, provenance: 'explicit' },
    { label: 'Raise price', changes: [], interventions: [{ factor_label: 'Plan price', value: 60, unit: 'GBP', provenance: 'ai_proposed' }], provenance: 'explicit' },
    { label: 'Discount', changes: [], interventions: [{ factor_label: 'Plan price', value: 40, unit: 'GBP', provenance: 'ai_proposed' }], provenance: 'explicit' },
  ],
  factors: [{ label: 'Plan price', role: 'controllable', baseline_known: true, baseline_value: 50, unit: 'GBP', plausible_max: 100, provenance: 'ai_proposed' }],
  risks: [], outcomes: [],
  links: [{ from: 'Plan price', to: 'Monthly revenue', direction: 'positive', provenance: 'ai_proposed' }],
  unknowns: [],
};
it('overlapping revenue risk keeps the served baseline and registers widening', async () => {
  const row: Row = { id: 'revenue-overlap', brief: 'Revenue is £75k; should we raise price or discount to increase monthly revenue by 20%?',
    drafter_texts: [JSON.stringify(revenueCandidate)], widening_texts: [JSON.stringify({ risk_suggestions: [{
      label: 'Revenue shortfall', category: 'external', mechanism: 'relies_on', hits_id: 'raise_price', through_id: 'plan_price',
      affects_id: 'monthly_revenue', direction: 'negative', relies_on: 'Customers accepting the new price', watch_for: 'Customer uptake falls',
    }] })] };
  let snapshot: Snapshot | undefined;
  const base = await replay(row, false, s => { snapshot = s; });
  expect(base.graph, JSON.stringify(base.result)).toBeDefined();
  const goal = snapshot!.admitted.nodes.find(n => n.kind === 'goal')!;
  expect(goal.observed_state?.raw_value).toBe(75000);
  const merged = snapshot!.admit({ ...snapshot!.candidate, risks: [...snapshot!.candidate.risks, {
    label: 'Revenue shortfall', provenance: 'ai_proposed', analysis_participation: 'retained_excluded',
  }] });
  const after = merged.nodes.find(n => n.id === goal.id);
  process.stdout.write(`S7 REVENUE FIRSTDIFF ${JSON.stringify({ before: goal, after })}\n`);
  expect(JSON.stringify(after)).toBe(JSON.stringify(goal));
  const widened = await replay(row, true);
  expect(widened.graph, JSON.stringify(widened.result)).toBeDefined();
  expect(widened.graph!.nodes.map((n: Rec) => n.label)).toContain('Revenue shortfall');
  for (const n of base.graph!.nodes as Rec[]) expect(JSON.stringify(widened.graph!.nodes.find((x: Rec) => x.id === n.id))).toBe(JSON.stringify(n));
});

describe('recorded widening keeps base identities and bytes', () => {
  const expected: Record<string, string[]> = {
    'B3-d1': ['Junior onboarding drains senior capacity', 'Senior expertise mismatches platform needs', 'Senior compensation exceeds planned spend'],
    'B3-d2': ['Junior supervision burden', 'Mixed-team role confusion'],
    'B1-d2': ['Feature release delay', 'Value messaging fails', 'Competitor pricing pressure'],
  };
  for (const row of recorded) it(row.id, async () => {
    const base = await replay(row);
    const widened = await replay(row, true);
    expect(base.graph, `${row.id}: base not registered: ${JSON.stringify(base.result)}`).toBeDefined();
    expect(widened.graph, `${row.id}: widened not registered: ${JSON.stringify(widened.result)}`).toBeDefined();
    const oldIds = new Set((base.graph!.nodes as Rec[]).map(n => n.id));
    const added = (widened.graph!.nodes as Rec[]).filter(n => !oldIds.has(n.id));
    expect(added.map(n => n.label), `${row.id}: widened exact labels; result=${JSON.stringify(widened.result)}`).toEqual(expected[row.id]);
    expect(added.every(n => n.kind === 'risk' && n.analysis_participation === 'retained_excluded' && n.draft_widening)).toBe(true);
    for (const n of base.graph!.nodes as Rec[]) expect(JSON.stringify((widened.graph!.nodes as Rec[]).find(x => x.id === n.id)), `${row.id}: base node ${n.id} (${n.label})`).toBe(JSON.stringify(n));
    for (const e of base.graph!.edges as Rec[]) expect(JSON.stringify((widened.graph!.edges as Rec[]).find(x => x.from === e.from && x.to === e.to)), `${row.id}: base edge ${e.from}->${e.to}`).toBe(JSON.stringify(e));
    expect(JSON.stringify(widened.graph!.goal_constraints)).toBe(JSON.stringify(base.graph!.goal_constraints));
    expect(widened.wideningCalls).toBe(row.widening_texts!.length);
    if (row.id === 'B3-d2') expect((widened.graph!.nodes as Rec[]).map(n => n.label)).not.toContain('Senior salary budget overrun');
  });
});

describe('admission monotonicity ratchet controls', () => {
  it('empty PASS, planted RED, stale RED naming id, removed PASS, re-fail RED', () => {
    expect(ratchetFailures([], { failing_ids: [], failing_count: 0 })).toEqual([]);
    expect(ratchetFailures(['planted'], { failing_ids: [], failing_count: 0 })).toEqual(['newly failing: planted', 'failing 1 > baseline 0']);
    expect(ratchetFailures([], { failing_ids: ['stale-id'], failing_count: 1 })).toEqual(['stale baseline: remove ids stale-id']);
    expect(ratchetFailures([], { failing_ids: [], failing_count: 0 })).toEqual([]);
    expect(ratchetFailures(['stale-id'], { failing_ids: [], failing_count: 0 })).toEqual(['newly failing: stale-id', 'failing 1 > baseline 0']);
  });
});

describe('116-draft property census', () => {
  it('both risk label variants preserve the served admitted nodes, edges and goal_constraints byte-for-byte', async () => {
    const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, 's7-construction-census/corpus.json.gz'))).toString('utf8')) as Row[];
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/ci/admission-monotone-baseline.json'), 'utf8')) as Baseline;
    expect(corpus).toHaveLength(116);
    expect(baseline.failing_ids).toHaveLength(baseline.failing_count);
    const failures: { id: string; variant: string; first_difference: unknown }[] = [];
    for (const row of corpus) {
      let snapshot: Snapshot | undefined;
      const built = await replay(row, false, s => { snapshot = s; });
      expect(snapshot, `${row.id}: no candidate reached widening: ${JSON.stringify(built.result)}`).toBeDefined();
      const { candidate, admit, admitted: base } = snapshot!;
      const active = base.nodes.find(n => n.kind === 'option' && n.is_baseline !== true);
      expect(active, `${row.id}: no active option`).toBeDefined();
      const throughIds = new Set(Object.keys(active!.interventions ?? {}));
      const through = base.nodes.find(n => n.kind === 'factor' && (throughIds.has(n.id) || base.edges.some(e => e.from === active!.id && e.to === n.id)));
      expect(through, `${row.id}: active option has no factor attachment`).toBeDefined();
      const goal = base.nodes.find(n => n.kind === 'goal')!;
      for (const [variant, label] of [['fixed', 'S7 planted out-of-chance risk'], ['overlapping', `${goal.label} shortfall`]] as const) {
        const risk: CandidateModel['risks'][number] = {
          label, provenance: 'ai_proposed', analysis_participation: 'retained_excluded',
          draft_widening: { provenance: 'ai_suggested_widen', hits: { id: active!.id, label: active!.label, kind: 'option' },
            through: { id: through!.id, label: through!.label, direction: 'positive' },
            affects: { id: goal.id, label: goal.label, direction: 'negative' },
            mechanism: 'relies_on', relies_on: 'A lab assumption', watch_for: 'A lab signal' },
        };
        const merged = admit({ ...candidate, risks: [...candidate.risks, risk] });
        const oldIds = new Set(base.nodes.map(n => n.id));
        const restricted = { nodes: merged.nodes.filter(n => oldIds.has(n.id)),
          edges: merged.edges.filter(e => oldIds.has(e.from) && oldIds.has(e.to)), goal_constraints: merged.goal_constraints };
        const before = { nodes: base.nodes, edges: base.edges, goal_constraints: base.goal_constraints };
        if (JSON.stringify(restricted) !== JSON.stringify(before)) {
          const node = base.nodes.find(n => JSON.stringify(merged.nodes.find(x => x.id === n.id)) !== JSON.stringify(n));
          failures.push({ id: row.id, variant, first_difference: node ? { node_id: node.id, label: node.label, before: node, after: merged.nodes.find(x => x.id === node.id) ?? null } : { edges_before: base.edges, edges_after: restricted.edges, constraints_before: base.goal_constraints, constraints_after: merged.goal_constraints } });
        }
      }
    }
    const ids = [...new Set(failures.map(f => f.id))];
    process.stdout.write(`S7 PROPERTY CENSUS fixed=${failures.filter(f => f.variant === 'fixed').length}/116 overlapping=${failures.filter(f => f.variant === 'overlapping').length}/116 either=${ids.length}/116 ${JSON.stringify(failures)}\n`);
    expect(ratchetFailures(ids, baseline), JSON.stringify(failures)).toEqual([]);
  }, 120_000);
});
