/**
 * Offline GUIDED PATH round-5 census. No network, model, or database calls.
 * Run: node --import tsx scripts/gp-goal-census.ts
 *
 * Replays the actual pinned and working-tree target verdicts and goal-chance
 * licences. Graph-only and already-stripped Run records remain explicit;
 * this script never invents probabilities to manufacture a shown result.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Rebased pre-r4: holds the current staging context constant while replaying
// the Science §(i) amendment against its immediate predecessor.
const BASE = '2768e2c4af279bc603e37874b3c9fac4f7dfe1f5';
const EXPECTED_HEAD = 'de40ae3bed7fe39966b7ebb57dc5521d25803916';
const ROOT = resolve(process.cwd());
const OUT = join(ROOT, 'GP-CENSUS.md');
const RAW = join(ROOT, 'GP-CENSUS.json');
const roots = [ROOT, '/private/tmp/accel-p44/goalreach', '/Users/paulslee/Documents/GitHub/output'];
type Rec = Record<string, any>;
type Direction = 'at least' | 'at most' | 'maximise' | 'minimise' | 'other';
const DIRECTIONS: Direction[] = ['at least', 'at most', 'maximise', 'minimise', 'other'];
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = (v: unknown): string => JSON.stringify(v, (_key, value) => rec(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const hash = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');
type Found = { value: Rec; path: string; file: string; ancestors: Rec[]; graphHash?: string; runHash?: string };
type Document = { file: string; source: string; graphs: Found[]; runs: Found[] };
const graphShape = (v: unknown): v is Rec => rec(v) && Array.isArray(v.nodes)
  && v.nodes.every((n: unknown) => rec(n) && typeof n.id === 'string')
  && (v.edges === undefined || Array.isArray(v.edges));
const sources = (v: Rec): Rec[][] => [v.option_comparison, Array.isArray(v.results) ? v.results : undefined,
  v.results?.option_comparison, v.results?.options, v.results?.option_results, v.decision_brief?.options]
  .filter(Array.isArray).map(rows => rows.filter(rec)).filter(rows => rows.length > 0);
const runShape = (v: Rec): boolean => v.type === 'analysis_result' || (rec(v.enrichment) && sources(v.enrichment).length > 0)
  || (!graphShape(v) && sources(v).some(rows => rows.some(r => typeof (r.option_id ?? r.id) === 'string')));
const envOf = (v: Rec): Rec => rec(v.enrichment) ? v.enrichment : v;
const inherited = (ancestors: Rec[], keys: string[]): string | undefined => {
  for (const a of [...ancestors].reverse()) for (const key of keys) if (typeof a[key] === 'string') return a[key];
  return undefined;
};
const runHashOf = (chain: Rec[]): string | undefined => {
  // Any Run-bound stamp outranks an ancestor's latest live-graph hash.
  for (const a of [...chain].reverse()) {
    for (const v of [a.computed_against_hash, a.graph_hash_at_run, a.analysis_ready?.graph_hash_at_run,
      a.analysis_state?.run_state?.graph_hash_at_run]) if (typeof v === 'string') return v;
  }
  const own = chain[chain.length - 1];
  if (typeof own?.graph_hash === 'string') return own.graph_hash;
  for (const a of [...chain].reverse()) {
    if (a.analysis_state?.run_state?.kind === 'complete_current' && typeof a.graph_hash === 'string') return a.graph_hash;
  }
  return undefined;
};
const skippedDirs = new Set(['.git', 'node_modules', 'dist', '.next', '.cache']);
function files(root: string): string[] {
  if (!existsSync(root)) throw new Error(`Required census root missing: ${root}`);
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !skippedDirs.has(e.name)) visit(join(dir, e.name));
      else if (e.isFile() && /\.(?:jsonl?|sse)$/.test(e.name) && !['GP-CENSUS.json'].includes(e.name)) out.push(join(dir, e.name));
    }
  };
  visit(root);
  return out.sort();
}

function extract(file: string, source: string, value: unknown): Document {
  const doc: Document = { file, source, graphs: [], runs: [] };
  const walk = (v: unknown, path: string, ancestors: Rec[], inRun = false, depth = 0): void => {
    if (depth > 100) throw new Error(`JSON nesting exceeds 100: ${file}:${path}`);
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('{') || s.startsWith('[')) {
        try { walk(JSON.parse(s), `${path}::<json>`, ancestors, inRun, depth + 1); } catch { /* Non-JSON prose is not a stored JSON record. */ }
      }
      // SSE captures often store complete response bodies as JSON strings.
      if (s.includes('\ndata:')) for (const [i, line] of s.split('\n').entries()) {
        if (!line.startsWith('data:')) continue;
        try { walk(JSON.parse(line.slice(5).trim()), `${path}::<sse:${i}>`, ancestors, inRun, depth + 1); } catch { /* Non-JSON SSE heartbeat. */ }
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, ancestors, inRun, depth + 1)); return; }
    if (!rec(v)) return;
    const chain = [...ancestors, v];
    if (graphShape(v)) doc.graphs.push({ value: v.edges === undefined ? { ...v, edges: [] } : v, file, path, ancestors,
      graphHash: inherited(chain, ['graph_hash', 'graphHash']) });
    const isRun = !inRun && runShape(v);
    if (isRun) doc.runs.push({ value: v, file, path, ancestors,
      runHash: runHashOf(chain) });
    for (const [key, x] of Object.entries(v)) walk(x, `${path}.${key}`, chain, inRun || isRun, depth + 1);
  };
  walk(value, '$', []);
  return doc;
}

const load = loadavg()[0]!;
console.log(`Load gate: ${load.toFixed(2)} < 25`);
if (load >= 25) throw new Error('Load gate failed; census not run.');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (head !== EXPECTED_HEAD) throw new Error(`Expected HEAD ${EXPECTED_HEAD}, got ${head}`);
const documents: Document[] = [];
const coverage: Rec[] = [];
const parseErrors: Rec[] = [];
const auxiliaryParseErrors: Rec[] = [];
function parseStored(text: string): unknown[] {
  const s = text.replace(/^\uFEFF/, '').trim();
  try { return [JSON.parse(s)]; } catch { /* A capture may be SSE or multiple JSON records. */ }
  if (/^(?:event:|data:|:)/m.test(s)) {
    const values: unknown[] = [];
    for (const line of s.split(/\r?\n/)) if (line.startsWith('data:')) {
      try { values.push(JSON.parse(line.slice(5).trim())); } catch { /* A non-JSON heartbeat. */ }
    }
    if (values.length > 0) return values;
  }
  // Board/history captures can hold concatenated JSON objects even with a .json suffix.
  const values: unknown[] = [];
  let start = -1, level = 0, quoted = false, escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (start < 0) { if (ch === '{' || ch === '[') { start = i; level = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') level++;
    else if (ch === '}' || ch === ']') {
      if (--level === 0) {
        try { values.push(JSON.parse(s.slice(start, i + 1))); } catch { /* Continue to independent later records. */ }
        start = -1;
      }
    }
  }
  if (values.length > 0) return values;
  throw new Error('No valid JSON record or SSE data record found.');
}
for (const root of roots) {
  const inventory = files(root);
  let parsed = 0, selected = 0;
  for (const file of inventory) {
    const text = readFileSync(file, 'utf8');
    // Other output graphs may be needed to bind a separately captured Run by its actual hash.
    if (root === roots[2] && !text.includes('analysis_result') && !(/"nodes"/.test(text) && /"edges"/.test(text))) continue;
    selected++;
    try {
      const values = parseStored(text);
      values.forEach((value, i) => documents.push(extract(file + (values.length > 1 ? `#line${i + 1}` : ''), root, value)));
      parsed++;
    } catch (error) {
      const relevant = root === roots[2] ? text.includes('analysis_result')
        : /"(?:nodes|analysis_result|option_comparison|option_results|probability_of_goal)"/.test(text);
      (relevant ? parseErrors : auxiliaryParseErrors).push({ file, error: String(error) });
    }
  }
  coverage.push({ root, files: inventory.length, selected, parsed });
  console.log(`Scanned ${root}: ${parsed}/${selected} selected files (${inventory.length} JSON/JSONL files inventoried).`);
}

const snapshot = mkdtempSync(join(tmpdir(), 'gp-census-baseline-'));
try {
  const archive = join(snapshot, 'baseline.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, BASE, 'src', 'package.json'], { cwd: ROOT });
  execFileSync('tar', ['-xf', archive, '-C', snapshot]);
  symlinkSync(join(ROOT, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
  const importAt = (base: string, path: string): Promise<Rec> => import(pathToFileURL(join(base, path)).href);
  const modules = async (base: string): Promise<Rec> => {
    const [target, licence, certainty, seam, guidance, estimates, optionSources, goalGate, unread, screen, parts, graphHashes, goalKind, goalDirection] = await Promise.all([
      importAt(base, 'src/orchestrator-v5/admission/target-testability.ts'),
      importAt(base, 'src/orchestrator-v5/goal-target/goal-chance-licence.ts'),
      importAt(base, 'src/orchestrator-v5/agent-lane/goal-certainty.ts'),
      importAt(base, 'src/orchestrator/context/constraint-feasibility.ts'),
      importAt(base, 'src/orchestrator-v5/agent-lane/turn-context/guidance-signals.ts'),
      importAt(base, 'src/orchestrator-v5/agent-lane/olumi-estimates-feeding-result.ts'),
      importAt(base, 'src/orchestrator/context/option-result-source.ts'),
      importAt(base, 'src/orchestrator-v5/goal-target/goal-chance-gate.ts'),
      importAt(base, 'src/orchestrator-v5/agent-lane/unread-goal-product.ts'),
      importAt(base, 'src/orchestrator-v5/agent-lane/goal-chance-screen-lines.ts'),
      importAt(base, 'src/orchestrator/context/placeholder-parts.ts'),
      importAt(base, 'src/orchestrator-v5/context/graph-hash.ts'),
      importAt(base, 'src/orchestrator-v5/goal-target/goal-kind.ts'),
      importAt(base, 'src/orchestrator-v5/goal-target/goal-direction.ts'),
    ]);
    return { ...target, ...licence, ...certainty, ...seam, ...guidance, ...estimates, ...optionSources, ...goalGate, ...unread,
      ...screen, ...parts, ...graphHashes, ...goalKind, ...goalDirection };
  };
  const [before, after] = await Promise.all([modules(snapshot), modules(ROOT)]);
  const allGraphs = documents.flatMap(d => d.graphs);
  console.log(`Loaded baseline/current modules; binding ${allGraphs.length} graph occurrences.`);
  const graphContentHash = new WeakMap<Rec, string>();
  const contentHash = (g: Rec): string => {
    const old = graphContentHash.get(g);
    if (old !== undefined) return old;
    const key = hash(g); graphContentHash.set(g, key); return key;
  };
  const computedHashCache = new Map<string, Set<string | null | undefined>>();
  const runContentHash = new WeakMap<Rec, string>();
  const replayCache = new Map<string, Rec>();
  const graphByRunHash = new Map<string, Found[]>();
  const graphHashAliases = new Map<Found, Set<string | undefined | null>>();
  for (const [index, g] of allGraphs.entries()) {
    const key = contentHash(g.value);
    let computed = computedHashCache.get(key);
    if (computed === undefined) {
      computed = new Set([createHash('sha256').update(JSON.stringify(g.value)).digest('hex').slice(0, 16)]);
      for (const projection of ['current', 'legacy', 'pre_hold', 'pre_definition', 'pre_route_once']) {
        try { computed.add(before.computeAnalysisAffectingGraphHash(g.value, projection)); } catch { /* A noncanonical stored graph. */ }
      }
      computedHashCache.set(key, computed);
    }
    const aliases = new Set(computed); aliases.add(g.graphHash);
    graphHashAliases.set(g, aliases);
    for (const h of aliases) if (h) (graphByRunHash.get(h) ?? graphByRunHash.set(h, []).get(h)!).push(g);
    if ((index + 1) % 2000 === 0) console.log(`Hashed ${index + 1}/${allGraphs.length} graph occurrences (${computedHashCache.size} distinct graphs).`);
  }
  const sameOptions = (run: Found, graph: Found): boolean => {
    const ids = sources(envOf(run.value)).flat().map(r => r.option_id ?? r.id).filter((v): v is string => typeof v === 'string');
    const graphIds = new Set(graph.value.nodes.filter(rec).filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id));
    return ids.length === 0 || ids.every(id => graphIds.has(id));
  };
  const commonPath = (a: string, b: string): number => {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i;
  };
  const uniqueGraphs = (gs: Found[]): Found[] => [...new Map(gs.map(g => [contentHash(g.value), g])).values()];
  const cases = new Map<string, { graph: Rec; run?: Rec; occurrences: Rec[]; direction: Direction }>();
  const unmatchedRuns: Rec[] = [];
  const direction = (g: Rec): Direction => {
    const goal = g.nodes.filter(rec).find((n: Rec) => n.kind === 'goal');
    const held = goal?.goal_direction;
    if (held === '>=' || held === '>') return 'at least';
    if (held === '<=' || held === '<') return 'at most';
    if (held === 'maximise' || held === 'maximize') return 'maximise';
    if (held === 'minimise' || held === 'minimize') return 'minimise';
    const row = Array.isArray(g.goal_constraints) ? g.goal_constraints.filter(rec).find(r => r.node_id === goal?.id) : undefined;
    if (row?.operator === '>=' || row?.operator === '>') return 'at least';
    if (row?.operator === '<=' || row?.operator === '<') return 'at most';
    const resolved = after.resolveGoalDirection(g, goal?.id)?.direction;
    return resolved === 'maximise' || resolved === 'minimise' ? resolved : 'other';
  };
  const add = (g: Found, r?: Found, pairing = 'graph-only', equivalentGraphs: Found[] = []): void => {
    const key = hash({ graph: g.value, run: r?.value ?? null });
    const c = cases.get(key) ?? { graph: g.value, run: r?.value, direction: direction(g.value), occurrences: [] };
    c.occurrences.push({ graph_file: g.file, graph_path: g.path, ...(r ? { run_file: r.file, run_path: r.path } : {}), pairing,
      ...(equivalentGraphs.length === 0 ? {} : { equivalent_graphs: equivalentGraphs.map(x => ({ file: x.file, path: x.path })) }) });
    cases.set(key, c);
  };
  const pairedGraphs = new Set<Found>();
  for (const d of documents) {
    for (const r of d.runs) {
      let candidates = d.graphs.filter(g => sameOptions(r, g) && (!r.runHash || graphHashAliases.get(g)!.has(r.runHash)));
      let pairing = 'same captured document';
      if (candidates.length > 1) {
        const closest = Math.max(...candidates.map(g => commonPath(r.path, g.path)));
        candidates = candidates.filter(g => commonPath(r.path, g.path) === closest);
      }
      candidates = uniqueGraphs(candidates);
      if (candidates.length === 0 && r.runHash) {
        candidates = uniqueGraphs((graphByRunHash.get(r.runHash) ?? []).filter(g => sameOptions(r, g)));
        pairing = 'exact captured/recomputed graph hash';
      }
      if (candidates.length === 0 && !r.runHash && /-cur\.plot-body\.json$/.test(r.file)) {
        const graphFile = r.file.replace(/-cur\.plot-body\.json$/, '-graph.json');
        candidates = uniqueGraphs(allGraphs.filter(g => g.file === graphFile && sameOptions(r, g)));
        pairing = 'named stored fixture pair (-cur.plot-body/-graph)';
      }
      let equivalent: Found[] = [];
      if (candidates.length > 1) {
        // Hashes intentionally omit cosmetic fields. Multiple copies are safe only if both actual replays agree.
        const signatures = candidates.map(g => canonical({ before: replay(before, g.value, r.value), after: replay(after, g.value, r.value) }));
        if (new Set(signatures).size === 1) { equivalent = candidates.slice(1); candidates = candidates.slice(0, 1); pairing += '; equivalent actual replays'; }
      }
      if (candidates.length !== 1) {
        unmatchedRuns.push({ file: r.file, path: r.path, run_hash: r.runHash, reason: candidates.length === 0 ? 'no identity-bound graph' : 'ambiguous graph', candidate_graphs: candidates.length });
        continue;
      }
      add(candidates[0]!, r, pairing, equivalent);
      for (const g of d.graphs) if (contentHash(g.value) === contentHash(candidates[0]!.value)) pairedGraphs.add(g);
    }
  }
  for (const g of allGraphs) if (!pairedGraphs.has(g)) add(g);

  function replay(m: Rec, graph: Rec, run?: Rec): Rec {
    const stored = run === undefined ? {} : envOf(run);
    let runKey = runContentHash.get(stored);
    if (runKey === undefined) { runKey = hash(stored); runContentHash.set(stored, runKey); }
    const cacheKey = `${m === before ? 'before' : 'after'}:${contentHash(graph)}:${runKey}`;
    const cached = replayCache.get(cacheKey);
    if (cached !== undefined) return cached;
    // Pin the ORIGINAL owner's authoritative source before replacing its warning.
    // ABSENT STAYS ABSENT: an empty stripped current carrier never falls back to
    // stale results/options after the old target warning has been removed.
    const originalRows = m.readOptionResultSources(stored).find((s: Rec[]) => s.length > 0) ?? [];
    const envelope: Rec = { ...structuredClone(stored), option_comparison: structuredClone(originalRows) };
    delete envelope.results;
    if (rec(envelope.decision_brief)) delete envelope.decision_brief.options;
    // Recomputed owners replace their saved records. Keeping the old target veto or
    // two licence records would make the stored-result reader reject a sound replay.
    if (Array.isArray(envelope.inference_warnings)) envelope.inference_warnings = envelope.inference_warnings.filter((w: unknown) =>
      !rec(w) || (w.code !== 'GOAL_FIGURES_TARGET_NOT_TESTABLE' && w.code !== 'GOAL_CHANCE_LICENSED'));
    const evaluations = Array.isArray(envelope.identity_evaluations) ? envelope.identity_evaluations : undefined;
    const verdict = m.targetTestabilityOf(graph, evaluations);
    const goalId = graph.nodes.filter(rec).find((n: Rec) => n.kind === 'goal')?.id;
    const analysed = m.asAnalysed(graph);
    const signals = m.assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph: analysed,
      analysisState: undefined, analysisResult: run, identityEvaluations: evaluations, leaderLicensed: false });
    const k = m.olumiEstimatesFeedingResult({ goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] }).links.length;
    const rows = m.readOptionResultSources(envelope).find((s: Rec[]) => s.length > 0) ?? [];
    const ids: string[] = [...new Set<string>(rows.map((r: Rec) => r.option_id ?? r.id).filter((x: unknown): x is string => typeof x === 'string'))];
    const hasChance = rows.some((r: Rec) => typeof r.probability_of_goal === 'number');
    let gated = envelope;
    // Honour every unrelated captured withhold: a target relaxation cannot resurrect another gate's figure.
    for (const warning of (Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : []).filter(rec)) {
      if (warning.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE' || !m.GOAL_FIGURES_WITHHELD_CODES.has(warning.code)) continue;
      const withheld = Array.isArray(warning.option_ids) && warning.option_ids.length > 0
        && warning.option_ids.every((id: unknown) => typeof id === 'string') ? warning.option_ids : ids;
      gated = m.withholdOptionGoalFigures(gated, new Set(withheld), warning, { keepOrdering: true });
    }
    // Recompute the placeholder gate for raw stored Run envelopes, rather than assuming no warning means no placeholders.
    const paths = m.unsizedLeaderGoalPaths(graph, ids, evaluations);
    if (paths.length > 0) gated = m.withholdOptionGoalFigures(gated, new Set(paths.map((p: Rec) => p.option_id)),
      m.placeholderGoalWarning(graph, paths, 'GOAL_FIGURES_PLACEHOLDER_PATH'), { keepOrdering: true });
    const unread = m.unreadGoalProduct(graph);
    if (unread !== null) gated = m.withholdOptionGoalFigures(gated, new Set(ids),
      m.unreadGoalProductWarning(unread, ids, 'GOAL_FIGURES_PRODUCT_NOT_READ'), { keepOrdering: true });
    const goal = graph.nodes.filter(rec).find((n: Rec) => n.kind === 'goal');
    if (m.goalKindOf(goal, graph) === 'chance_of_event') gated = m.withholdOptionGoalFigures(gated, new Set(ids),
      { code: 'GOAL_FIGURES_CHANCE_AS_GOAL', option_ids: ids }, { keepOrdering: true });
    const warning = m.targetNotTestableWarning(graph, verdict, ids, 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    if (warning !== null) gated = m.withholdOptionGoalFigures(gated, new Set(ids), warning, { keepOrdering: true });
    const certainty = m.goalCertaintyOfStoredResult(graph, { enrichment: envelope });
    const earned = (id: string, p: number): boolean => certainty.some((d: Rec) => d.option_id === id && d.probability_of_goal === p && d.earned === true);
    gated = m.withholdUnusableGoalChances(gated, graph, goalId);
    const licence = m.goalChanceLicenceOf(gated, graph, goalId, earned);
    const labelled = m.withGoalChanceLicence(gated, graph, goalId, earned);
    const screenLines = m.goalChanceScreenLinesForAgent({ enrichment: labelled }, graph, true);
    const storedLicence = m.agentLicenceRecordOf({ enrichment: labelled });
    const result = { verdict, k, hasChance, licence, shown: storedLicence !== undefined && licence !== null && Object.keys(licence.pct_by_option).length > 0,
      screenLines,
      status: run === undefined ? 'graph-only' : hasChance ? 'stored chance replayed' : 'stored Run chance absent/stripped' };
    replayCache.set(cacheKey, result);
    return result;
  }

  const detail: Rec[] = [];
  const table = Object.fromEntries(DIRECTIONS.map(d => [d, { total: 0, withheld_to_shown: 0, shown_to_withheld: 0, unchanged: 0,
    unavailable: 0, verdict_withheld_to_pass: 0, verdict_pass_to_withheld: 0, verdict_unchanged: 0, k: {} as Rec }]));
  console.log(`Bound corpus: ${cases.size} distinct graph/Run cases; ${unmatchedRuns.length} unpaired Run occurrences.`);
  for (const [index, [caseHash, c]] of [...cases.entries()].entries()) {
    const b = replay(before, c.graph, c.run), a = replay(after, c.graph, c.run);
    const row = table[c.direction]!;
    row.total++;
    row.k[String(a.k)] = (row.k[String(a.k)] ?? 0) + 1;
    const targetB = before.targetVerdictWithholdsTargetClaims(b.verdict), targetA = after.targetVerdictWithholdsTargetClaims(a.verdict);
    if (targetB && !targetA) row.verdict_withheld_to_pass++;
    else if (!targetB && targetA) row.verdict_pass_to_withheld++;
    else row.verdict_unchanged++;
    if (!a.hasChance) row.unavailable++;
    else if (!b.shown && a.shown) row.withheld_to_shown++;
    else if (b.shown && !a.shown) row.shown_to_withheld++;
    else row.unchanged++;
    detail.push({ case_hash: caseHash, direction: c.direction, occurrences: c.occurrences, before: b, after: a });
    if ((index + 1) % 500 === 0) console.log(`Replayed ${index + 1}/${cases.size} cases.`);
  }
  const missingPointLabels = (r: Rec): boolean => {
    if (!r.shown || r.k < 1) return false;
    const suffix = `using Olumi's estimates for ${r.k} ${r.k === 1 ? 'link' : 'links'} (see Check estimates)`;
    // The licence names POINT options. A range on a different option has its own
    // existing words and must not be mistaken for an unlabelled estimate point.
    return Object.keys(r.licence.pct_by_option).some(id => !r.screenLines.some((line: Rec) =>
      line.option_id === id && line.olumi_estimate_link_count === r.k && line.chance.includes(suffix)));
  };
  const unlabelledFinalPoints = detail.filter(d => missingPointLabels(d.after));
  const unlabelledNewPoints = unlabelledFinalPoints.filter(d => !d.before.shown);
  const ranges = (r: Rec): Rec[] => r.screenLines.filter((line: Rec) => line.figure.includes('between'));
  const existingRanges = detail.filter(d => ranges(d.before).length > 0);
  const rangeCoverage = { total: existingRanges.length, unchanged: existingRanges.filter(d => canonical(ranges(d.before)) === canonical(ranges(d.after))).length,
    changed: existingRanges.filter(d => canonical(ranges(d.before)) !== canonical(ranges(d.after))).length };
  const regression = Object.values(table).some(row => row.shown_to_withheld > 0 || row.verdict_pass_to_withheld > 0);
  const sum = (field: 'total' | 'withheld_to_shown' | 'shown_to_withheld' | 'unchanged' | 'unavailable'): number =>
    Object.values(table).reduce((n, r) => n + Number(r[field]), 0);
  const kWords = (counts: Rec): string => Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, n]) => `${k}:${n}`).join(', ') || '—';
  const warnings = [parseErrors.length > 0 ? `${parseErrors.length} files failed JSON parsing; see GP-CENSUS.json.` : null,
    unmatchedRuns.length > 0 ? `${unmatchedRuns.length} stored Run records had no unambiguous identity-bound graph; see GP-CENSUS.json.` : null].filter(Boolean);
  const lines = [
    '# GUIDED PATH round-5 offline census', '', `Baseline: \`${BASE}\`. Working-tree HEAD: \`${head}\`.`,
    `Generated ${new Date().toISOString()}; load gate ${load.toFixed(2)} < 25. No network, LLM, or database access.`, '',
    `Status: **${regression ? 'STOP — shown→withheld regression' : unlabelledFinalPoints.length > 0 ? 'STOP — shown estimate point has no labelled sentence' : warnings.length > 0 ? 'INCOMPLETE — coverage gaps listed below' : 'PASS — no shown→withheld regression'}**.`, '',
    '| Goal direction | Total | Withheld→shown | Shown→withheld | Unchanged | Licence unavailable | k distribution (k:cases) |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...DIRECTIONS.map(d => { const r = table[d]!; return `| ${d} | ${r.total} | ${r.withheld_to_shown} | ${r.shown_to_withheld} | ${r.unchanged} | ${r.unavailable} | ${kWords(r.k)} |`; }),
    `| **Total** | **${sum('total')}** | **${sum('withheld_to_shown')}** | **${sum('shown_to_withheld')}** | **${sum('unchanged')}** | **${sum('unavailable')}** | |`, '',
    'Actual target-testability verdict replay (independent of whether a stored chance survived):', '',
    '| Goal direction | Total | Withheld→pass | Pass→withheld | Unchanged |', '|---|---:|---:|---:|---:|',
    ...DIRECTIONS.map(d => { const r = table[d]!; return `| ${d} | ${r.total} | ${r.verdict_withheld_to_pass} | ${r.verdict_pass_to_withheld} | ${r.verdict_unchanged} |`; }), '',
    '| Corpus | JSON/JSONL inventoried | Selected | Parsed |', '|---|---:|---:|---:|',
    ...coverage.map(c => `| ${c.root} | ${c.files} | ${c.selected} | ${c.parsed} |`), '',
    `Found ${allGraphs.length} stored graph occurrences and ${documents.reduce((n, d) => n + d.runs.length, 0)} stored Run occurrences. Canonical graph+Run SHA-256 de-duplicates copies; GP-CENSUS.json retains every occurrence, pairing, verdict, licence and count.`,
    'Output selects every local JSON/JSONL/SSE file containing analysis_result, plus graph files needed for exact Run binding. Repo and goalreach scan every JSON/JSONL/SSE fixture/capture; dependency/build/cache trees are excluded. Embedded JSON, concatenated JSON and raw/embedded SSE JSON bodies are extracted. Executable TypeScript fixture builders are not stored JSON fixtures.',
    'Runs pair to their graph in the same captured document, by exact captured/recomputed graph hash, or by the named stored -cur.plot-body/-graph fixture pairing. Option identities must agree. Hash-equivalent graph variants must agree on both actual replays. Ambiguous or missing pairs are reported, never matched by labels or guessed from directory proximity.',
    'Licence replay pins the original authoritative option-result source before replacing owned target/licence warnings, uses stored probabilities only, applies the actual placeholder/product/target seams and chance licence, and preserves unrelated captured withholds. Empty stripped current sources never fall back to historical result copies. A removed chance cannot be recovered without a raw stored Run: those cases are licence unavailable, never counted as proven shown or unchanged.',
    "k is olumiEstimatesFeedingResult({goalPathFactors, goalPathLinks}).links.length, fed by assembleGuidanceSignals. Values, accepted estimates, off-path links and placeholders never enter k.",
    `Existing valid range-only cases: ${rangeCoverage.total}; unchanged ${rangeCoverage.unchanged}; changed ${rangeCoverage.changed}. They remain point-licence unavailable, rather than being called point withholds.`,
    `Shown estimate points missing the actual labelled sentence: ${unlabelledFinalPoints.length} in all final shown cases; ${unlabelledNewPoints.length} newly shown. Point option IDs come from the actual licence; specialised chance words and unrelated range sentences are preserved.`,
    `Unrelated auxiliary JSON parse errors: ${auxiliaryParseErrors.length} (for example commented tsconfig; excluded from capture coverage gaps).`,
    ...warnings.map(w => `Coverage gap: ${w}`), '',
    'Changed verdicts:',
    ...detail.filter(d => canonical(d.before.verdict) !== canonical(d.after.verdict)).slice(0, 10)
      .map(d => `- ${d.direction}; k=${d.after.k}; ${d.before.verdict.kind}→${d.after.verdict.kind}; ${d.occurrences[0].graph_file}:${d.occurrences[0].graph_path}`),
    'At most 10 changed-verdict examples are printed here; the complete ledger is in GP-CENSUS.json.',
    '', `Raw evidence: \`${basename(RAW)}\`.`,
  ];
  writeFileSync(RAW, JSON.stringify({ baseline: BASE, head, load, coverage, table, parseErrors, auxiliaryParseErrors, unmatchedRuns, unlabelledFinalPoints, unlabelledNewPoints, rangeCoverage, cases: detail }, null, 2) + '\n');
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(lines.slice(0, 29).join('\n'));
  if (regression) throw new Error('STOP: shown→withheld or pass→withheld regression.');
  if (unlabelledFinalPoints.length > 0) throw new Error('STOP: shown estimate points lack the labelled sentence.');
  if (warnings.length > 0) process.exitCode = 2;
} finally { rmSync(snapshot, { recursive: true, force: true }); }
