/** GR2 mutants execute real bundled source in memory; no production file is rewritten. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Rec = Record<string, any>;
type Api = {
  goalChanceLicenceOf: (...args: any[]) => Rec | null;
  withGoalChanceLicence: (...args: any[]) => Rec;
  goalChanceLicenceForAgent: (result: unknown) => Rec | undefined;
  stampGoalReading: (wire: Rec, stored: Rec) => Rec;
};
type Mutation = 'stand_in_dropped' | 'always_less' | 'label_dropped' | 'stored_predicate_dropped' | 'confirmation_gate_dropped' | 'persisted_stamp'
  | 'confirmed_treated_as_reading' | 'actual_wire_predicate_dropped' | 'listed_levelless_forwarded';
const sourceDir = dirname(fileURLToPath(new URL('../goal-chance-licence.ts', import.meta.url)));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsx'))('esbuild') as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};
const PAUL = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8')) as Rec;
const LOSS = 'mrr_lost_to_price_driven_churn';
const graph = (): Rec => structuredClone(PAUL);
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id)!;
const options = (): Rec[] => [
  { id: 'keep_49_pro_price', interventions: { pro_plan_price: 49 } },
  { id: 'raise_pro_price_to_59', interventions: { pro_plan_price: 59 } },
];
const response = (): Rec => ({
  option_comparison: options().map((o, i) => ({ option_id: o.id, probability_of_goal: i ? .62 : .41 })),
  identity_evaluations: [{ node_id: 'mrr', evaluated: true }],
});
const context = (): Rec => {
  const storedGraph = graph();
  const wireGraph = structuredClone(storedGraph);
  node(wireGraph, 'mrr').nonlinear_identity.reading_licence = 'olumi_reading';
  return { storedGraph, wireGraph, options: options(), confirmationAvailable: true };
};
const EXPECTED = "‘Raise Pro price to £59’: about 62% chance of meeting your goal, in this model, if ‘MRR’ = ‘Pro plan price’ × ‘Pro paying subscribers’, less ‘MRR lost to price-driven churn’ (Olumi's reading; that loss has no figure yet, so Olumi's stand-in for it is used).";

function replaceOnce(source: string, from: string, to: string): string {
  expect(source.split(from).length - 1, `one mutation anchor: ${from}`).toBe(1);
  return source.replace(from, to);
}

function mutated(name: string, source: string, mutation?: Mutation): string {
  if (name === 'goal-reading-label.ts') {
    if (mutation === 'stand_in_dropped') return replaceOnce(source,
      'const standIn = label.addends.some(a => !a.sized)', 'const standIn = false');
    if (mutation === 'always_less') return replaceOnce(source,
      "sign: contribution.value < 0 ? 'less' : 'plus'", "sign: 'less'");
    if (mutation === 'confirmation_gate_dropped') return replaceOnce(source,
      ' || !input.confirmationAvailable', '');
    if (mutation === 'confirmed_treated_as_reading') return replaceOnce(source,
      "const required = (rec(storedIdentity) && storedIdentity.operation === 'product' && storedIdentity.stated_in_brief === false)\n    || (rec(identity) && identity.operation === 'product' && identity.stated_in_brief === false);",
      'const required = true;');
  }
  if (name === 'goal-chance-licence.ts' && mutation === 'label_dropped') return replaceOnce(source,
    'reading_label: reading.label, reading_sentence_by_option: Object.fromEntries',
    'reading_sentence_by_option: Object.fromEntries');
  if (name === 'goal-reading-wire.ts' && mutation === 'stored_predicate_dropped') return replaceOnce(source,
    'const reading = storedReadingOf(storedGraph);', 'const reading = storedReadingOf(clean);');
  if (name === 'goal-reading-wire.ts' && mutation === 'persisted_stamp') return replaceOnce(source,
    'return { ...clean, nodes: clean.nodes.map',
    "Object.assign(storedGoal!, { nonlinear_identity: { ...identity, reading_licence: 'olumi_reading' } }); return { ...clean, nodes: clean.nodes.map");
  const unsafeStamp = "return { ...clean, nodes: clean.nodes.map(n => rec(n) && n.kind === 'goal' ? { ...n, nonlinear_identity: { ...(n.nonlinear_identity as Rec), reading_licence: 'olumi_reading' } } : n) } as G;";
  if (name === 'goal-reading-wire.ts' && mutation === 'actual_wire_predicate_dropped') return replaceOnce(source,
    'const goal = nodesOf(clean).find(n => n.id === reading.goal.id);',
    `${unsafeStamp}\n  const goal = nodesOf(clean).find(n => n.id === reading.goal.id);`);
  if (name === 'goal-reading-wire.ts' && mutation === 'listed_levelless_forwarded') return replaceOnce(source,
    'const reading = storedReadingOf(storedGraph);',
    `const reading = storedReadingOf(storedGraph);\n  if (reading === null && rec(clean) && Array.isArray(clean.nodes) && nodesOf(storedGraph).some(n => rec(n.nonlinear_identity) && Array.isArray(n.nonlinear_identity.addends) && n.nonlinear_identity.addends.length > 0)) { ${unsafeStamp} }`);
  return source;
}

async function buildCompiled(mutation?: Mutation): Promise<Api> {
  const built = await esbuild.build({
    stdin: { contents: 'export { goalChanceLicenceOf, withGoalChanceLicence, goalChanceLicenceForAgent } from "./goal-chance-licence.ts"; export { stampGoalReading } from "./goal-reading-wire.ts";',
      resolveDir: sourceDir, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node20', logLevel: 'silent',
    plugins: [{ name: 'in-memory-gr2-reading-mutant', setup(build: {
      onLoad(filter: { filter: RegExp }, load: (args: { path: string }) => { contents: string; loader: 'ts' }): void;
    }) {
      build.onLoad({ filter: /(?:goal-reading-label|goal-reading-wire|goal-chance-licence)\.ts$/ }, args => ({
        contents: mutated(args.path.slice(args.path.lastIndexOf('/') + 1), readFileSync(args.path, 'utf8'), mutation), loader: 'ts',
      }));
    } }],
  });
  const module = { exports: {} as Api };
  new Function('require', 'module', 'exports', built.outputFiles[0]!.text)(require, module, module.exports);
  return module.exports;
}
const modules = new Map<string, Promise<Api>>();
function compiled(mutation?: Mutation): Promise<Api> {
  const key = mutation ?? 'original';
  let module = modules.get(key);
  if (module === undefined) { module = buildCompiled(mutation); modules.set(key, module); }
  return module;
}
const licence = (api: Api, c = context()): Rec | null =>
  api.goalChanceLicenceOf(response(), c.storedGraph, 'mrr', () => false, undefined, c);

function standInRow(api: Api): void {
  expect(licence(api)?.reading_sentence_by_option.raise_pro_price_to_59, 'case (2) exact addendum-4 words').toBe(EXPECTED);
}
function positiveSignRow(api: Api): void {
  const c = context();
  for (const g of [c.storedGraph, c.wireGraph]) {
    node(g, LOSS).observed_state = { raw_value: 1000, value: .05, unit: '£/month', source: 'cee_inference' };
    node(g, 'mrr').nonlinear_identity.addends = [LOSS];
  }
  const l = licence(api, c);
  expect(l?.reading_label.addends[0], 'positive executed signed operand despite its negative edge').toEqual({
    id: LOSS, label: 'MRR lost to price-driven churn', sign: 'plus', sized: true,
  });
  expect(l?.reading_sentence_by_option.raise_pro_price_to_59).toContain(", plus ‘MRR lost to price-driven churn’ (Olumi's reading).");
  expect(l?.reading_sentence_by_option.raise_pro_price_to_59).not.toContain('stand-in');
}
function labelRow(api: Api): void {
  const c = context();
  const record = api.withGoalChanceLicence(response(), c.storedGraph, 'mrr', undefined, undefined, c);
  const saved = JSON.parse(JSON.stringify({ enrichment: record }));
  const warning = saved.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
  expect(warning?.reading_label, 'Run record has structured authoritative reading').toMatchObject({
    v: 1, source: 'olumi_reading', addends: [{ id: LOSS, sign: 'less', sized: false }],
  });
  expect(api.goalChanceLicenceForAgent(saved)?.reading_sentence_by_option.raise_pro_price_to_59).toBe(EXPECTED);
}
function refusedStoredRow(api: Api, refusal: 'units' | 'user_risk' | 'stated_30k'): void {
  const stored = graph();
  const wire = structuredClone(stored);
  if (refusal === 'units') node(stored, 'pro_paying_subscribers').observed_state.unit = '%';
  if (refusal === 'user_risk') node(stored, LOSS).provenance = 'from_brief';
  if (refusal === 'stated_30k') node(stored, 'mrr').observed_state = { raw_value: 30000, unit: '£/month', source: 'brief_extraction' };
  const stamped = api.stampGoalReading(wire, stored);
  expect(node(stamped, 'mrr').nonlinear_identity.reading_licence, `${refusal}: stored predicate denies authority`).toBeUndefined();
}
function confirmationRow(api: Api): void {
  const c = context();
  c.confirmationAvailable = false;
  expect(licence(api, c), 'a held or unwritable confirmation cannot accompany the required reading').toBeNull();
}
function outboundOnlyRow(api: Api): void {
  const stored = graph();
  const before = JSON.stringify(stored);
  const wire = api.stampGoalReading(structuredClone(stored), stored);
  expect(node(wire, 'mrr').nonlinear_identity.reading_licence).toBe('olumi_reading');
  expect(JSON.stringify(stored), 'stamp never writes to the stored graph').toBe(before);
}
function confirmedRow(api: Api): void {
  const stored = graph(); node(stored, 'mrr').nonlinear_identity.stated_in_brief = true;
  expect(node(api.stampGoalReading(structuredClone(stored), stored), 'mrr').nonlinear_identity.reading_licence).toBeUndefined();
  const l = api.goalChanceLicenceOf(response(), stored, 'mrr');
  expect(l?.pct_by_option.raise_pro_price_to_59).toBe(62);
  expect(l).not.toHaveProperty('reading_label');
}
function replacedFactorRow(api: Api): void {
  const stored = graph(); const wire = structuredClone(stored);
  node(wire, 'mrr').nonlinear_identity.factor_ids[1] = 'monthly_churn_rate';
  expect(node(api.stampGoalReading(wire, stored), 'mrr').nonlinear_identity.reading_licence).toBeUndefined();
}
function listedMissingRow(api: Api): void {
  const stored = graph(); node(stored, 'mrr').nonlinear_identity.addends = [LOSS];
  expect(node(api.stampGoalReading(structuredClone(stored), stored), 'mrr').nonlinear_identity.reading_licence).toBeUndefined();
  const c = context(); node(c.storedGraph, 'mrr').nonlinear_identity.addends = [LOSS];
  expect(licence(api, c)).toBeNull();
}
function killed(name: string, row: () => void): void {
  expect(row, `${name} must become RED`).toThrow();
  console.info(`[MUTANT RED] ${name}`);
}

describe('GR2 labelled reading mutants (in-memory, real raw-wire operands)', () => {
  it('stand-in clause dropped → exact case (2) sentence RED', async () => {
    standInRow(await compiled());
    const mutant = await compiled('stand_in_dropped');
    killed('stand-in clause dropped', () => standInRow(mutant));
  });
  it('always less → positive executed addend SIGN RED', async () => {
    positiveSignRow(await compiled());
    const mutant = await compiled('always_less');
    killed('always less', () => positiveSignRow(mutant));
  });
  it('structured reading_label dropped → record and cold reader RED', async () => {
    labelRow(await compiled());
    const mutant = await compiled('label_dropped');
    killed('structured reading_label dropped', () => labelRow(mutant));
  });
  it.each(['units', 'user_risk', 'stated_30k'] as const)('stored predicate removed → %s authority row RED', async refusal => {
    refusedStoredRow(await compiled(), refusal);
    const mutant = await compiled('stored_predicate_dropped');
    killed(`stored predicate removed (${refusal})`, () => refusedStoredRow(mutant, refusal));
  });
  it('confirmation availability gate removed → same-reply control row RED', async () => {
    confirmationRow(await compiled());
    const mutant = await compiled('confirmation_gate_dropped');
    killed('confirmation availability gate removed', () => confirmationRow(mutant));
  });
  it('stamp persisted → outbound-only row RED', async () => {
    outboundOnlyRow(await compiled());
    const mutant = await compiled('persisted_stamp');
    killed('stamp persisted', () => outboundOnlyRow(mutant));
  });
  it('confirmed identity treated as a reading → Yes/T1b plain-point row RED', async () => {
    confirmedRow(await compiled());
    const mutant = await compiled('confirmed_treated_as_reading');
    killed('confirmed treated as reading', () => confirmedRow(mutant));
  });
  it('actual wire predicate removed → replaced-factor stamp row RED', async () => {
    replacedFactorRow(await compiled());
    const mutant = await compiled('actual_wire_predicate_dropped');
    killed('actual wire predicate removed', () => replacedFactorRow(mutant));
  });
  it('listed levelless operand forwarded → case (1) no-stamp row RED', async () => {
    listedMissingRow(await compiled());
    const mutant = await compiled('listed_levelless_forwarded');
    killed('listed levelless operand forwarded', () => listedMissingRow(mutant));
  });
});
