import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Sink = { file: string; symbol: string; assignments?: string[] };
type Site = Sink & { keys: string[]; lines: number[] };

// Every final graph serialiser calls the ONE projection. Forwarders and internal
// assignments are separately enumerated below; additions require explicit review.
const SINK_MANIFEST: Sink[] = [
  {"file": "src/orchestrator-v5/compose/applied-graph-emit.ts", "symbol": "buildAppliedGraphWireField", "assignments": []},
  {"file": "src/orchestrator-v5/compose/applied-graph-emit.ts", "symbol": "buildCanonicalCommittedGraphReceipt", "assignments": []},
  {"file": "src/orchestrator-v5/handlers/draft-graph-dispatch.ts", "symbol": "draftResultToOlumiResponse", "assignments": ["draft_graph", "draft_graph"]},
  {"file": "src/routes/assist.v1.scenario-graph.ts", "symbol": "route", "assignments": ["graph", "graph", "graph", "graph"]},
  {"file": "src/orchestrator-v5/model-management/mutation-receipt.ts", "symbol": "toModelVersionMutationReceiptV1", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/tools/handlers/run-analysis.ts", "symbol": "runAnalysisHandler", "assignments": ["graph", "graph", "graph", "graph", "graph", "graph", "graph"]},
  {"file": "src/orchestrator/tools/draft-graph.ts", "symbol": "handleDraftGraph", "assignments": ["applied_graph"]},
  {"file": "src/orchestrator/tools/edit-graph.ts", "symbol": "handleEditGraph", "assignments": ["applied_graph"]},
  {"file": "src/routes/assist.share.ts", "symbol": "route", "assignments": ["graph", "graph", "graph"]},
  {"file": "src/routes/assist.v1.draft-graph-staged.ts", "symbol": "onStage", "assignments": ["graph"]},
  {"file": "src/routes/streamed-turn-sse.ts", "symbol": "onStage", "assignments": ["graph"]},
  {"file": "src/routes/admin.testing.ts", "symbol": "adminTestRoutes", "assignments": ["graph"]},
];

const ALLOWLIST: (Sink & { reason: string })[] = [
  {"file": "src/adapters/llm/caching.ts", "symbol": "getConfiguredMaxTokens", "reason": "Task token budget lookup, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/adapters/llm/router.ts", "symbol": "<module>", "reason": "Task model-routing configuration, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/cee/unified-pipeline/index.ts", "symbol": "attachDraftGraphTimings", "reason": "Draft timing metadata only, not a graph.", "assignments": ["draft_graph", "draft_graph"]},
  {"file": "src/config/model-routing.ts", "symbol": "<module>", "reason": "Task model-routing configuration, not a graph.", "assignments": ["draft_graph", "draft_graph", "draft_graph"]},
  {"file": "src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts", "symbol": "authoriseChange", "reason": "Reads committed receipts into graph-free receipt summaries.", "assignments": ["model_version_receipt", "model_version_receipt", "model_version_receipt", "model_version_receipt"]},
  {"file": "src/orchestrator-v5/compose/leader-licence-shadow.ts", "symbol": "leaderLicenceShadow", "reason": "Internal permission input; graph is never serialised.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/compose/unsupported-action-response.ts", "symbol": "<module>", "reason": "Capability phrase lookup, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/compose/withheld-claim-projection.ts", "symbol": "projectCritiquesForWithheldClaim", "reason": "Internal critique input with graph null.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/context/context-budget-telemetry.ts", "symbol": "<module>", "reason": "Task context policy lookup, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/context/context-policy.ts", "symbol": "<module>", "reason": "Task context policy lookup, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/handlers/edit-graph-dispatch.ts", "symbol": "dispatchEditGraph", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/model-management/contracts.ts", "symbol": "<module>", "reason": "Schema declarations, not graph values.", "assignments": ["graph", "graph", "graph"]},
  {"file": "src/orchestrator-v5/model-management/mutation-receipt.ts", "symbol": "<module>", "reason": "Receipt schema declarations, not graph values.", "assignments": ["graph", "model_version_receipt"]},
  {"file": "src/orchestrator-v5/model-management/mutation-receipt.ts", "symbol": "attachModelVersionMutationReceipt", "reason": "Attaches the receipt already projected by the manifest converter.", "assignments": ["model_version_receipt"]},
  {"file": "src/orchestrator-v5/model-management/service.ts", "symbol": "saveVersion", "reason": "Internal version persistence requests; stored proof must be retained.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/model-management/service.ts", "symbol": "restoreVersionAtomic", "reason": "Internal version persistence requests; stored proof must be retained.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/model-management/store-adapter.ts", "symbol": "getVersion", "reason": "Internal stored-version readback; public conversion is in the manifest.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/model-management/store-adapter.ts", "symbol": "getVersionForCommittedTurn", "reason": "Internal stored-version readback; public conversion is in the manifest.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/model-management/store-adapter.ts", "symbol": "parseAtomicRestoreOutcome", "reason": "Internal stored-version readback; public conversion is in the manifest.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/routing/clarification-resume.ts", "symbol": "<module>", "reason": "Task mutation policy lookup, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/session/pending-action.ts", "symbol": "<module>", "reason": "Task consent policy lookup, not a graph.", "assignments": ["draft_graph", "draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "replyForAttemptThatWroteNothing", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchEdgeStrengthEdit", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchStructuralDelete", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchFactorValueEdit", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph", "draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchOptionLevelsBatch", "reason": "Forwards buildCanonicalCommittedGraphReceipt output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "commitLimitEditInProcess", "reason": "Forwards the committed receipt from the manifest converter.", "assignments": ["model_version_receipt"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "commitLimitAddInProcess", "reason": "Forwards the committed receipt from the manifest converter.", "assignments": ["model_version_receipt"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchStructuralRename", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchOptionStatusEdit", "reason": "Forwards manifest applied-graph output and the converted committed receipt.", "assignments": ["draft_graph", "model_version_receipt", "model_version_receipt"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "commitOptionStatusInProcess", "reason": "Forwards the committed receipt from the manifest converter.", "assignments": ["model_version_receipt"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchStructuralAdd", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchStructuralAddEdge", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/dispatch.ts", "symbol": "dispatchAddConstraintEdit", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/system-events/olumi-option-adoption.ts", "symbol": "commitOlumiOptionAdoptionInProcess", "reason": "Forwards the committed receipt from the manifest converter.", "assignments": ["model_version_receipt"]},
  {"file": "src/orchestrator-v5/tools/handlers/run-analysis.ts", "symbol": "withoutDriftedAccumulations", "reason": "Internal compute projection; public payload projection is in the manifest.", "assignments": ["graph"]},
  {"file": "src/orchestrator-v5/turn-executor.ts", "symbol": "commitReadinessRepairResume", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/turn-executor.ts", "symbol": "commitValueBatchResume", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/turn-executor.ts", "symbol": "commitGmHeldResume", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/turn-executor.ts", "symbol": "commitGmHeldResumeAll", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/orchestrator-v5/turn-executor.ts", "symbol": "runTurnExecutor", "reason": "Forwards buildAppliedGraphWireField output from the manifest.", "assignments": ["draft_graph"]},
  {"file": "src/prompts/defaults.ts", "symbol": "registerAllDefaultPrompts", "reason": "Prompt task registration or override mapping, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/prompts/defaults.ts", "symbol": "<module>", "reason": "Prompt task registration or override mapping, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/prompts/estate.ts", "symbol": "<module>", "reason": "Prompt task registry, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/prompts/operations.ts", "symbol": "<module>", "reason": "Prompt task registry, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/routes/admin.testing.ts", "symbol": "parseGraphFromLLMOutput", "reason": "Internal LLM graph parse; public adminTestRoutes projection is in the manifest.", "assignments": ["graph"]},
  {"file": "src/routes/agent-v1-turn.ts", "symbol": "persistedFactorReviewFor", "reason": "Internal factor review input; no graph is emitted.", "assignments": ["graph"]},
  {"file": "src/routes/agent-v1-turn.ts", "symbol": "withRetainedScopeIssues", "reason": "Internal graph validation input; returns issues only.", "assignments": ["graph"]},
  {"file": "src/routes/agent-v1-turn.ts", "symbol": "agentTurnHandler", "reason": "Internal reasoning inputs and draft readback from buildAppliedGraphWireField.", "assignments": ["draft_graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph"]},
  {"file": "src/routes/agent-v1-turn.ts", "symbol": "replayed", "reason": "Internal replay reasoning inputs and draft readback from buildAppliedGraphWireField.", "assignments": ["draft_graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph", "graph"]},
  {"file": "src/routes/agent-v1-turn.ts", "symbol": "onModelRegistered", "reason": "Internal observer readback, not serialised.", "assignments": ["graph"]},
  {"file": "src/routes/assist.critique-graph.ts", "symbol": "route", "reason": "Internal critique adapter input from the request, not a graph response.", "assignments": ["graph"]},
  {"file": "src/routes/assist.evidence-pack.ts", "symbol": "<module>", "reason": "Request schema or internal share persistence; share readback is in the manifest.", "assignments": ["graph"]},
  {"file": "src/routes/assist.evidence-pack.ts", "symbol": "route", "reason": "Request schema or internal share persistence; share readback is in the manifest.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.decision-review.ts", "symbol": "<module>", "reason": "Request schema declaration, not a graph value.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.enhanced-decision-review.ts", "symbol": "<module>", "reason": "Request schema declaration, not a graph value.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.evidence-helper.ts", "symbol": "route", "reason": "Internal quality input with graph undefined.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.explain-graph.ts", "symbol": "route", "reason": "Internal quality input, not serialised.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.graph-readiness.ts", "symbol": "<module>", "reason": "Request schema declaration, not a graph value.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.health.ts", "symbol": "route", "reason": "Feature configuration, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/routes/assist.v1.review.ts", "symbol": "route", "reason": "Internal block, quality and guidance inputs; response has no graph.", "assignments": ["graph", "graph", "graph", "graph", "graph", "graph", "graph"]},
  {"file": "src/routes/assist.v1.scenario-graph-register.ts", "symbol": "route", "reason": "Internal invariant and append inputs; stored proof must be retained.", "assignments": ["graph", "graph"]},
  {"file": "src/routes/assist.v1.scenario-graph.ts", "symbol": "readConversationTurns", "reason": "Internal words permission input, no graph in the conversation response.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.scenario-versions.ts", "symbol": "route", "reason": "Internal save, restore and analysis inputs; public receipt uses the manifest converter.", "assignments": ["graph", "graph", "graph", "graph"]},
  {"file": "src/routes/assist.v1.suggest-utility-weights.ts", "symbol": "route", "reason": "Internal utility suggestion input; response has no graph.", "assignments": ["graph"]},
  {"file": "src/routes/assist.v1.team-perspectives.ts", "symbol": "route", "reason": "Internal quality input with graph undefined.", "assignments": ["graph"]},
  {"file": "src/routes/scenario-graph-analysis-read.ts", "symbol": "readScenarioAnalysis", "reason": "Internal permission and analysis-view inputs; the view projects graph-free facts.", "assignments": ["graph", "graph", "graph", "graph", "graph"]},
  {"file": "src/schemas/working-set.ts", "symbol": "<module>", "reason": "Schema declaration, not a graph value.", "assignments": ["graph_snapshot"]},
  {"file": "src/server.ts", "symbol": "buildCeeConfig", "reason": "Feature configuration, not a graph.", "assignments": ["draft_graph"]},
  {"file": "src/services/model-selector.ts", "symbol": "getEnvModelForTask", "reason": "Task model lookup, not a graph.", "assignments": ["draft_graph"]},
];

const wireKeys = new Set(['draft_graph', 'applied_graph', 'canonical_graph', 'model_version_receipt', 'graph_snapshot']);
function symbolOf(node: ts.Node): string {
  for (let parent = node; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isMethodDeclaration(parent)) {
      if (parent.name) return parent.name.getText();
    }
    if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
      const owner = parent.parent;
      if (ts.isVariableDeclaration(owner) || ts.isPropertyAssignment(owner)) return owner.name.getText();
    }
  }
  return '<module>';
}
function scanSource(file: string, source: string) {
  const graphScope = /\/(?:routes|compose|model-management)\//.test(file)
    || file === 'src/orchestrator/plot-client.ts' || file === 'src/orchestrator-v5/tools/handlers/run-analysis.ts';
  if (!SINK_MANIFEST.some(sink => sink.file === file)
    && !/\b(?:draft_graph|applied_graph|canonical_graph|model_version_receipt|graph_snapshot)\b/.test(source)
    && !(graphScope && /\bgraph\s*:/.test(source))) return { sites: [], functions: new Map<string, ts.Node>() };
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sites = new Map<string, Site>(); const functions = new Map<string, ts.Node>();
  function visit(node: ts.Node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body) {
      const symbol = symbolOf(node);
      // Anonymous callbacks belong to the enclosing named symbol; keep its full body.
      if (symbol !== '<module>' && symbolOf(node.parent) !== symbol) functions.set(symbol, node.body);
    }
    const assignment = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    const name = ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) ? node.name
      : assignment && ts.isPropertyAccessExpression(node.left) ? node.left.name
      : assignment && ts.isElementAccessExpression(node.left) ? node.left.argumentExpression : undefined;
    if (name) {
      const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
      if (wireKeys.has(key) || (graphScope && key === 'graph' && ts.isPropertyAssignment(node))) {
        const symbol = symbolOf(node); const id = `${file}:${symbol}`;
        const found = sites.get(id) ?? { file, symbol, keys: [], lines: [] };
        found.keys.push(key); found.lines.push(tree.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        sites.set(id, found);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { sites: [...sites.values()], functions };
}
function sourceFiles(dir = 'src'): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return ['__tests__', 'tests', 'fixtures'].includes(entry.name) ? [] : sourceFiles(file);
    return /\.[cm]?tsx?$/.test(file) && !/\.(test|spec)\./.test(file) ? [file] : [];
  });
}

const siteId = (site: Sink) => `${site.file}:${site.symbol}`;
function unlistedSites(sites: Site[], manifest = SINK_MANIFEST, allowlist = ALLOWLIST): string[] {
  const known = new Set([...manifest, ...allowlist].map(siteId));
  return sites.filter(site => !known.has(siteId(site))).map(siteId).sort();
}
function changedAssignments(sites: Site[], entries: Sink[]): string[] {
  const actual = new Map(sites.map(site => [siteId(site), [...site.keys].sort()]));
  return entries.filter(entry => JSON.stringify(actual.get(siteId(entry)) ?? []) !== JSON.stringify(entry.assignments ?? []))
    .map(entry => `changed wire assignments: ${siteId(entry)}`).sort();
}
function callsProjection(body: ts.Node): boolean {
  let found = false;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'toOutboundGraph') found = true;
    ts.forEachChild(node, visit);
  }
  visit(body); return found;
}
function missingCalls(sources: Map<string, ReturnType<typeof scanSource>>, manifest: Sink[]): string[] {
  return manifest.filter(sink => {
    const body = sources.get(sink.file)?.functions.get(sink.symbol);
    return body === undefined || !callsProjection(body);
  }).map(siteId).sort();
}

// Required config auto-collects tests/contract/*.test.ts. Walk the filesystem,
// including untracked sources: a planted/new source file cannot evade the ratchet.
describe('S5 horizon-basis outbound sink census', () => {
  const sources = new Map(sourceFiles().map(file => [file, scanSource(file, readFileSync(file, 'utf8'))]));
  const sites = [...sources.values()].flatMap(source => source.sites);
  it('each manifest symbol calls toOutboundGraph in its own body', () => {
    expect(missingCalls(sources, SINK_MANIFEST)).toEqual([]);
  });
  it('every discovered wire assignment has a manifest or explicitly reasoned allowlist entry', () => {
    expect(unlistedSites(sites)).toEqual([]);
    expect(changedAssignments(sites, [...SINK_MANIFEST, ...ALLOWLIST])).toEqual([]);
    expect(sites.length).toBeGreaterThan(50);
    const ids = [...SINK_MANIFEST, ...ALLOWLIST].map(siteId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALLOWLIST.every(entry => entry.reason.trim().length > 0)).toBe(true);
    // A deleted assignment must pay down its allowance; serializer-only
    // manifest symbols (nodes/edges builders) intentionally need no wire key.
    expect(ALLOWLIST.filter(entry => !sites.some(site => siteId(site) === siteId(entry))).map(siteId)).toEqual([]);
  });
  it('contrast: the SAME scanner discovers a planted unlisted draft_graph assignment', () => {
    const file = 'src/routes/planted-outbound.ts';
    const source = 'export function leak(graph) { return { draft_graph: graph }; }';
    expect(unlistedSites(scanSource(file, source).sites)).toEqual([`${file}:leak`]);
    expect(unlistedSites(scanSource(file, 'export function leak(graph) { response.draft_graph = graph; }').sites))
      .toEqual([`${file}:leak`]);
  });
  it('contrast: a second graph assignment in an already-listed symbol also fails the ratchet', () => {
    const file = 'src/routes/listed.ts', symbol = 'emit';
    const entries = [{ file, symbol, assignments: ['draft_graph'] }];
    expect(changedAssignments(scanSource(file, 'function emit(graph) { return { draft_graph: graph }; }').sites, entries)).toEqual([]);
    expect(changedAssignments(scanSource(file, 'function emit(graph) { return { draft_graph: graph, graph: graph }; }').sites, entries))
      .toEqual([`changed wire assignments: ${file}:${symbol}`]);
  });
  it('contrast: the SAME scanner reports a listed symbol without the projection call', () => {
    const file = 'src/routes/fixture.ts', symbol = 'emit';
    const manifest = [{ file, symbol }];
    const scan = (source: string) => new Map([[file, scanSource(file, source)]]);
    expect(missingCalls(scan('function emit(graph) { return { draft_graph: graph }; }'), manifest)).toEqual([`${file}:${symbol}`]);
    expect(missingCalls(scan('function emit(graph) { return { draft_graph: toOutboundGraph(graph) }; }'), manifest)).toEqual([]);
    expect(missingCalls(scan('function emit(graph) { /* toOutboundGraph(graph) */ return { draft_graph: graph }; }'), manifest))
      .toEqual([`${file}:${symbol}`]);
  });
});
