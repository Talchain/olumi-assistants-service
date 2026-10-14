/** Read-only M1 evidence probe: original base/head source, no assertions or test runner. */
import '/private/tmp/accel-er-b2scope-cee/src/orchestrator-v5/tools/handlers/run-analysis.ts';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readOptionResultSources, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ } from '/private/tmp/accel-er-b2scope-cee/src/orchestrator/context/option-result-source.ts';
import { withholdOptionGoalFigures } from '/private/tmp/accel-er-b2scope-cee/src/orchestrator/context/constraint-feasibility.ts';
import { unsizedLeaderGoalPaths, placeholderGoalWarning } from '/private/tmp/accel-er-b2scope-cee/src/orchestrator-v5/agent-lane/goal-certainty.ts';
import { unreadGoalProduct, unreadGoalProductWarning } from '/private/tmp/accel-er-b2scope-cee/src/orchestrator-v5/agent-lane/unread-goal-product.ts';
import { linkSizing } from '/private/tmp/accel-er-b2scope-cee/src/cee/magnitude/link-sizing.ts';

type Rec = Record<string, any>;
const worktree = '/private/tmp/accel-er-b2scope-cee';
const headRef = 'a4981a7afc5511fff9bf042573a6c1f158a43af8';
const baseRef = '53a68cd6e50eee2a30110cd68e859f8edda3c8be';
const fixturePath = 'src/orchestrator-v5/tools/handlers/__tests__/fixtures/r3-m1-card-yes-served-run-20260930.json';
const gitSource = (ref: string, path: string): string => execFileSync('git', ['--git-dir=/private/tmp/b2-fix1-merge.git', 'show', `${ref}:${path}`], { cwd: worktree, encoding: 'utf8' });
const fixture = JSON.parse(gitSource(headRef, fixturePath)) as Rec;
const graph = fixture.graph;
const body = fixture.plot_body;
const ids = graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id);
const evaluations = Array.isArray(body.identity_evaluations) ? body.identity_evaluations : undefined;
const labelOf = (id: string): string | undefined => graph.nodes.find((n: Rec) => n.id === id)?.label;
const compactFailures = (failures: Rec[]) => failures.map(({ case: caseValue, precondition, code, links, link }) => ({
  case: caseValue, precondition, code, links: links ?? (link === undefined ? [] : [link]),
}));
const modules = [
  'src/orchestrator-v5/admission/identity-evaluations.ts',
  'src/orchestrator-v5/admission/target-testability.ts',
  'src/orchestrator-v5/goal-target/target-testability-per-option.ts',
];
const tempDir = mkdtempSync('/private/tmp/b2-fix1-m1-modules-');

async function snapshotModules(ref: string, label: string): Promise<Rec> {
  const destinations = new Map(modules.map((path, i) => [resolve(worktree, path), resolve(tempDir, `${label}-${i}.mts`)]));
  for (const path of modules) {
    const origin = resolve(worktree, path);
    const source = gitSource(ref, path).replace(/(from\s+|import\s+)(['"])(\.[^'"]+)\2/g, (full, prefix, quote, specifier) => {
      const absolute = resolve(dirname(origin), specifier);
      const tsAbsolute = absolute.replace(/\.js$/, '.ts');
      const target = destinations.get(tsAbsolute) ?? tsAbsolute;
      return `${prefix}${quote}${target}${quote}`;
    });
    writeFileSync(destinations.get(origin)!, source);
  }
  const verdictModule = await import(pathToFileURL(destinations.get(resolve(worktree, modules[1]))!).href);
  const scopedModule = await import(pathToFileURL(destinations.get(resolve(worktree, modules[2]))!).href);
  return { ...verdictModule, ...scopedModule };
}

function shownOptions(envelope: Rec): string[] {
  return [...new Set(readOptionResultSources(envelope).flat().filter((r: Rec) =>
    typeof r.probability_of_goal === 'number' || typeof r.probability_of_joint_goal === 'number')
    .map((r: Rec) => r.option_id ?? r.id))] as string[];
}

async function main(): Promise<void> {
try {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const scoredIds = [...new Set(readOptionResultSources(body).flat().map((r: Rec) => r.option_id ?? r.id))] as string[];
  const interventionMap = new Map(graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => [n.id, n.interventions ?? {}]));
  const earlierProduct = unreadGoalProduct(graph);
  const earlierPaths = unsizedLeaderGoalPaths(graph, scoredIds, evaluations, interventionMap as Map<string, Rec>);
  let beforeTarget = clone(body);
  if (earlierProduct !== null) beforeTarget = withholdOptionGoalFigures(beforeTarget, new Set(scoredIds),
    unreadGoalProductWarning(earlierProduct, scoredIds, GOAL_FIGURES_PRODUCT_NOT_READ));
  if (earlierPaths.length > 0) beforeTarget = withholdOptionGoalFigures(beforeTarget, new Set(earlierPaths.map(p => p.option_id)),
    placeholderGoalWarning(graph, earlierPaths, GOAL_FIGURES_PLACEHOLDER_PATH, earlierProduct !== null));

  console.log(JSON.stringify({ fixture: fixturePath, base: baseRef, head: headRef,
    targetVerdictSourceIdentical: gitSource(baseRef, modules[1]) === gitSource(headRef, modules[1]),
    identityEvaluations: evaluations ?? null,
    graphOptions: ids,
    plotScoredOptions: scoredIds,
    edges: graph.edges.map((e: Rec) => ({ from: e.from, to: e.to, sizing: linkSizing(e), defaulted: e.defaulted ?? false })),
    purePreTargetGateEvidence: { productGate: earlierProduct, placeholderPaths: earlierPaths,
      shownBeforeEarlierGates: shownOptions(body), shownAtTargetGate: shownOptions(beforeTarget),
      warningCodesAtTargetGate: (beforeTarget.inference_warnings ?? []).map((w: Rec) => w.code),
      qualification: 'Pure earlier gate functions on served M1.graph; not a complete handler/wire witness.' },
  }, null, 2));

  for (const [label, ref] of [['base', baseRef], ['head', headRef]]) {
    const api = await snapshotModules(ref, label);
    const verdict = api.targetTestabilityOf(graph, evaluations);
    const paths = api.optionPathsOf(graph, ids, evaluations, verdict.goal_id, body.inference_warnings);
    const scopes = ids.map((optionId: string) => ({ option_id: optionId, links: paths.get(optionId) ?? [],
      scoped_failures: compactFailures(verdict.kind === 'not_testable'
        ? api.scopedFailuresFor(verdict.failures, paths.get(optionId) ?? [], labelOf) : []),
    }));
    console.log(JSON.stringify({ label, ref,
      verdict: { ...verdict, ...(verdict.kind === 'not_testable' ? { failures: compactFailures(verdict.failures) } : {}) },
      options: scopes,
      ownFailingOptions: scopes.filter((o: Rec) => o.scoped_failures.length > 0).map((o: Rec) => o.option_id),
      scopedRemainingCandidates: scopes.filter((o: Rec) => shownOptions(beforeTarget).includes(o.option_id)
        && o.scoped_failures.length > 0).map((o: Rec) => o.option_id),
    }, null, 2));
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
