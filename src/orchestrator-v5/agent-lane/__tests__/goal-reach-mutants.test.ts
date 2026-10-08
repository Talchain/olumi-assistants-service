/**
 * GOAL-REACH build 1 mutation checks. Each mutant is compiled only in memory;
 * production files are never rewritten. The ordinary row first passes against
 * current source, then must become RED against the mutant (a killed mutant).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { IdentityProposal } from '../identity-proposal.js';

type Json = Record<string, any>;
type Proposer = (graph: unknown) => IdentityProposal | null;
type Mutation = 'drop_condition_3' | 'drop_condition_4' | 'drop_stored_branch' | 'drop_listed_addends';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as Json;
const sourcePath = fileURLToPath(new URL('../identity-proposal.ts', import.meta.url));
const source = () => readFileSync(sourcePath, 'utf8');
const require = createRequire(import.meta.url);
// esbuild already belongs to the installed tsx toolchain; no install is needed.
const esbuild = createRequire(require.resolve('tsx'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};
const graph = (): Json => structuredClone(fixture);
const node = (g: Json, id: string): Json => g.nodes.find((n: Json) => n.id === id)!;

function replaceOnce(value: string, from: string, to: string): string {
  expect(value.split(from).length - 1, `mutation anchor must occur exactly once: ${from}`).toBe(1);
  return value.replace(from, to);
}

function mutate(value: string, mutation: Mutation): string {
  if (mutation === 'drop_stored_branch') {
    return replaceOnce(value, ' ?? proposeOnStoredReading(graph)', '');
  }
  // These narrow anchors remove only the newly added stored-reading guards,
  // leaving the old goal/carrier branches and their reconciliation untouched.
  if (mutation === 'drop_listed_addends') {
    return replaceOnce(value, 'if (listed !== undefined && !(Array.isArray(listed) && listed.length === 0)) return null;', '');
  }
  if (mutation === 'drop_condition_3') {
    return replaceOnce(value,
      "if (readMoneyTotal(goalUnit, goalLabel) === null || unitsCompose(goalUnit, goalLabel, level(a), level(b)).kind === 'no') return null;", '');
  }
  const marker = value.indexOf('// Condition 4:');
  expect(marker, 'stored-reading reconciliation marker').toBeGreaterThan(0);
  const start = value.indexOf('  if (current !== null) {', marker);
  const end = value.indexOf('  const words =', start);
  expect(start).toBeGreaterThan(marker);
  expect(end).toBeGreaterThan(start);
  return value.slice(0, start) + value.slice(end);
}

async function compiledProposer(mutation?: Mutation): Promise<Proposer> {
  const input = mutation === undefined ? source() : mutate(source(), mutation);
  const built = await esbuild.build({
    stdin: { contents: 'export { proposeProductIdentity } from "./identity-proposal.ts";', resolveDir: dirname(sourcePath), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    plugins: [{ name: 'in-memory-goal-reach-mutant', setup(build: {
      onLoad(filter: { filter: RegExp }, load: () => { contents: string; loader: 'ts' }): void;
    }) {
      build.onLoad({ filter: /identity-proposal\.ts$/ }, () => ({ contents: input, loader: 'ts' }));
    } }],
  });
  const module = { exports: {} as { proposeProductIdentity: Proposer } };
  // The executable is the real production module and dependencies, bundled
  // from source; only the specified guard/branch changes for each mutant.
  new Function('require', 'module', 'exports', built.outputFiles![0]!.text)(require, module, module.exports);
  return module.exports.proposeProductIdentity;
}

function row1(propose: Proposer): void {
  const card = propose(graph());
  expect(card, 'row 1: Paul stored reading is reachable').not.toBeNull();
  expect(card?.factor_ids).toEqual(['pro_plan_price', 'pro_paying_subscribers']);
  expect(card?.words).toBe('Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-driven churn’. Is that how you work it out?');
}

function rowListedAddends(propose: Proposer): void {
  const g = graph();
  node(g, 'mrr').nonlinear_identity.addends = ['mrr_lost_to_price_driven_churn'];
  expect(propose(g), 'listed addends: ISL adds the signed value, so no card until build 2').toBeNull();
}

function row3(propose: Proposer): void {
  const g = graph();
  node(g, 'mrr').nonlinear_identity.factor_ids = ['pro_plan_price', 'monthly_churn_rate'];
  // Keep the unit clash as the only failing class condition: both are own
  // parents as Science §(e) requires, and no current MRR was stated.
  g.edges.push({ from: 'monthly_churn_rate', to: 'mrr', strength: { mean: 0.5, std: 0.125 } });
  // Science §(e) addendum 2 vetoes any other non-definitional direct parent; the replaced
  // subscribers edge would otherwise reject the row before condition 3 is reached.
  g.edges = g.edges.filter((e: Json) => !(e.from === 'pro_paying_subscribers' && e.to === 'mrr'));
  expect(propose(g), 'row 3: price × churn % cannot compose into MRR').toBeNull();
}

function row4(propose: Proposer): void {
  const g = graph();
  // The primary fixture is the final 8,000-subscriber model. Restore the
  // earlier 300 used by Science's binding 49 × 300 known-answer control.
  Object.assign(node(g, 'pro_paying_subscribers').observed_state, { raw_value: 300, value: 0.15 });
  node(g, 'mrr').observed_state = { raw_value: 30000, value: 1.2, unit: '£/month', source: 'user_override' };
  expect(propose(g), 'row 4: stated £30,000 contradicts £49 × 300').toBeNull();
}

async function row2Bar(propose: Proposer): Promise<void> {
  vi.resetModules();
  vi.doMock('../identity-proposal.js', async () => ({
    ...await vi.importActual<typeof import('../identity-proposal.js')>('../identity-proposal.js'),
    proposeProductIdentity: propose,
  }));
  try {
    const { actionFactsOf } = await import('../actions/state.js');
    const { actionBarOf } = await import('../actions/rank.js');
    const facts = actionFactsOf({ scenarioId: 'goal-reach-mutant', graph: graph() });
    const bar = actionBarOf(facts);
    const offers = [...bar.priority, ...bar.standard, ...bar.more].filter(o => o.action_id === 'confirm_reading' && o.enabled);
    expect(offers, 'row 2: the real facts/ranker emit one enabled resolving offer').toHaveLength(1);
  } finally {
    vi.doUnmock('../identity-proposal.js');
    vi.resetModules();
  }
}

function killed(row: string, assertion: () => void): void {
  expect(assertion, `${row} must reject its mutant`).toThrow();
  console.info(`[MUTANT RED] ${row}`);
}

describe('GOAL-REACH mutants (in-memory source transformations)', () => {
  it('drop condition 3 → row 3 RED', async () => {
    row3(await compiledProposer());
    const mutant = await compiledProposer('drop_condition_3');
    killed('drop condition 3 → row 3 RED', () => row3(mutant));
  });

  it('drop condition 4 → row 4 RED', async () => {
    row4(await compiledProposer());
    const mutant = await compiledProposer('drop_condition_4');
    killed('drop condition 4 → row 4 RED', () => row4(mutant));
  });

  it('drop the listed-addends withhold → listed-addends row RED', async () => {
    rowListedAddends(await compiledProposer());
    const mutant = await compiledProposer('drop_listed_addends');
    killed('drop listed-addends withhold → listed-addends row RED', () => rowListedAddends(mutant));
  });

  it('drop stored branch → rows 1 and 2 RED', async () => {
    const original = await compiledProposer();
    row1(original);
    await row2Bar(original);
    const mutant = await compiledProposer('drop_stored_branch');
    killed('drop stored branch → row 1 RED', () => row1(mutant));
    await expect(row2Bar(mutant), 'row 2 must reject the missing branch').rejects.toThrow();
    console.info('[MUTANT RED] drop stored branch → row 2 RED');
  }, 30000);
});
