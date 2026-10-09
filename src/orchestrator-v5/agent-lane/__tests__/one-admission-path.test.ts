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

/** Strip comments using the TS scanner, preserving strings and positions, then scan actual call expressions. */
function scan(file: string, source: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const comments: [number, number][] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia)
      comments.push([scanner.getTokenPos(), scanner.getTextPos()]);
  }
  let stripped = source;
  for (const [start, end] of comments.reverse()) stripped = stripped.slice(0, start) + stripped.slice(start, end).replace(/[^\r\n]/g, ' ') + stripped.slice(end);
  const ast = ts.createSourceFile(file, stripped, ts.ScriptTarget.Latest, true);
  let allowedBody: ts.Node | undefined;
  const locate = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'admitForBuild' && node.initializer && ts.isArrowFunction(node.initializer))
      allowedBody = node.initializer.body;
    ts.forEachChild(node, locate);
  };
  locate(ast);
  const allowed: string[] = [];
  const forbidden: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText(ast);
      if (name === 'admitCandidateModel' || name === 'admitOrdinaryCandidateModel') {
        const hit = `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}:${name}`;
        if (file === 'orchestrator-v5/agent-lane/admit-model.ts' ||
          (file === 'orchestrator-v5/agent-lane/runtime/build-model.ts' && allowedBody && node.pos >= allowedBody.pos && node.end <= allowedBody.end)) allowed.push(hit);
        else forbidden.push(hit);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { allowed, forbidden };
}

describe('one production admission path', () => {
  it('has zero calls outside admit-model or build admitForBuild; allowed calls prove the scan is live', () => {
    const allowed: string[] = [];
    const forbidden: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          if (!/admitCandidateModel|admitOrdinaryCandidateModel/.test(source)) continue;
          const found = scan(path.relative(SRC, full), source);
          allowed.push(...found.allowed); forbidden.push(...found.forbidden);
        }
      }
    };
    walk(SRC);
    expect(allowed.filter(hit => hit.startsWith('orchestrator-v5/agent-lane/runtime/build-model.ts:')).length).toBeGreaterThanOrEqual(1);
    expect(forbidden, 'production admission ratchet: target 0').toEqual([]);
  }, 30_000);
  it('detects a planted second path, ignores comments, and refuses calls outside the allowed body', () => {
    expect(scan('planted.ts', '// admitCandidateModel(c)\n/* admitOrdinaryCandidateModel(c) */').forbidden).toEqual([]);
    expect(scan('planted.ts', 'admitCandidateModel(c)').forbidden).toHaveLength(1);
    const found = scan('orchestrator-v5/agent-lane/runtime/build-model.ts',
      'const admitForBuild = (c) => { return admitCandidateModel(c); }; admitOrdinaryCandidateModel(c);');
    expect(found.allowed).toHaveLength(1);
    expect(found.forbidden).toHaveLength(1);
  });
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
  it('empty PASS, planted RED, stale RED naming id, removed PASS', () => {
    expect(ratchetFailures([], { failing_ids: [], failing_count: 0 })).toEqual([]);
    expect(ratchetFailures(['planted'], { failing_ids: [], failing_count: 0 })).toEqual(['newly failing: planted', 'failing 1 > baseline 0']);
    expect(ratchetFailures([], { failing_ids: ['stale-id'], failing_count: 1 })).toEqual(['stale baseline: remove ids stale-id']);
    expect(ratchetFailures([], { failing_ids: [], failing_count: 0 })).toEqual([]);
  });
});

describe('116-draft property census', () => {
  it('one out-of-chance risk preserves C admitted nodes, edges and goal_constraints byte-for-byte', async () => {
    const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, 's7-construction-census/corpus.json.gz'))).toString('utf8')) as Row[];
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/ci/admission-monotone-baseline.json'), 'utf8')) as Baseline;
    expect(corpus).toHaveLength(116);
    expect(baseline.failing_ids).toHaveLength(baseline.failing_count);
    const failures: { id: string; first_difference: unknown }[] = [];
    for (const row of corpus) {
      let snapshot: Snapshot | undefined;
      const built = await replay(row, false, s => { snapshot = s; });
      expect(snapshot, `${row.id}: no candidate reached widening: ${JSON.stringify(built.result)}`).toBeDefined();
      const { candidate, admit, admitBase } = snapshot!;
      const base = admitBase(candidate);
      const active = base.nodes.find(n => n.kind === 'option' && n.is_baseline !== true);
      expect(active, `${row.id}: no active option`).toBeDefined();
      const throughIds = new Set(Object.keys(active!.interventions ?? {}));
      const through = base.nodes.find(n => n.kind === 'factor' && (throughIds.has(n.id) || base.edges.some(e => e.from === active!.id && e.to === n.id)));
      expect(through, `${row.id}: active option has no factor attachment`).toBeDefined();
      const goal = base.nodes.find(n => n.kind === 'goal')!;
      const risk: CandidateModel['risks'][number] = {
        label: 'S7 planted out-of-chance risk', provenance: 'ai_proposed', analysis_participation: 'retained_excluded',
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
        failures.push({ id: row.id, first_difference: node ? { node_id: node.id, label: node.label, before: node, after: merged.nodes.find(x => x.id === node.id) ?? null } : { edges_before: base.edges, edges_after: restricted.edges, constraints_before: base.goal_constraints, constraints_after: merged.goal_constraints } });
      }
    }
    process.stdout.write(`S7 PROPERTY CENSUS n=${failures.length}/116 ${JSON.stringify(failures)}\n`);
    expect(ratchetFailures(failures.map(f => f.id), baseline), JSON.stringify(failures)).toEqual([]);
  }, 120_000);
});
