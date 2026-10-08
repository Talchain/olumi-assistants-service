/**
 * ⭐ M2 RERUN-EXPLANATION — what changed between two Runs is Olumi's CODE LINE from run_delta's TYPED rows; the model only
 * says why, and each of its sentences passes RC's `checkMethodTurn` beside that line or is dropped (DL ruling 5940472067;
 * MG mechanics 5940496939; RC contract `RERUN-EXPLANATION`; lease #85 5939005849).
 *
 * Fixture: the FINAL investor seed `eeeff8b4` as served (R3 journey-2 `seed-readback.json`, guest 4e53dfa5): its two
 * placeholder links, which the journey's two Accepts turn into accepted estimates (52f8cd 5938955871: exactly two `sizing`
 * rows placeholder → olumi_accepted, coverage complete). The run_delta is shaped by @talchain/schemas 0.70.0
 * (`RunDeltaInputChangeObjectSchema`, `win_probabilities_unavailable`).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof ts }>();
  return { default: { ...actual.default, createProgram: vi.fn(actual.default.createProgram) } };
});
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { diffRunInputSnapshots } from '../../coaching/run-input-changes.js';
import { findEditInternalsHit, findForbiddenPhraseHit, findSuccessClaimHit, HELD_SCIENCE_VOCABULARY_PATTERN } from '../../compose/forbidden-user-facing-phrases.js';
import { findProcessNarrationHit } from '../../compose/process-narration.js';
import { sanitiseNarrateOutput } from '../../sanitise.js';
import { sanitiseUserFacingText } from '../../../orchestrator/shared/output-safety.js';
import { REPAIR_VOCABULARY_DENYLIST } from '../../../orchestrator/shared/repair-vocabulary-denylist.js';
import { checkMethodTurn, internalValueTerms } from '../guidance/index.js';
import { composeRerunExplanation, rerunExplanationPlan, rerunViewFailures, RERUN_FALLBACK_LINES, RERUN_NO_CHANGE_LINES } from '../rerun-explanation.js';

const LABELS: Record<string, string> = {
  quarterly_revenue: 'Quarterly revenue',
  ai_reporting_module_sprint: 'AI Reporting Module Sprint',
  integration_bug_fix_sprint: 'Integration Bug Fix Sprint',
  split_sprint_capacity: 'Split Sprint Capacity',
  continue_current_plan: 'Continue Current Plan',
  sprint_capacity_for_ai_reporting: 'Sprint capacity for AI reporting',
  sprint_capacity_for_integration_fix: 'Sprint capacity for integration fix',
  ai_reporting_module_availability: 'AI reporting module availability',
  integration_step_bug_resolution: 'Integration-step bug resolution',
  qualified_leads: 'Qualified leads per month',
  risk: 'Feature release slips',
  mrr: 'MRR',
  price: 'Pro plan price',
  o: 'Raise price',
};
const labelOf = (id: string) => LABELS[id];
const OPTIONS = ['AI Reporting Module Sprint', 'Integration Bug Fix Sprint', 'Split Sprint Capacity', 'Continue Current Plan'];
const MODEL_LABELS = Object.values(LABELS);

const accept = (from: string, to: string) => ({
  entity_kind: 'link', entity_id: `${from}->${to}`, link: { from, to }, field: 'sizing',
  before: { raw: 'placeholder' }, after: { raw: 'olumi_accepted' }, change: 'changed',
});
const AI = accept('sprint_capacity_for_ai_reporting', 'ai_reporting_module_availability');
const FIX = accept('sprint_capacity_for_integration_fix', 'integration_step_bug_resolution');
const SAID_AI = "You accepted Olumi's estimate for how much Sprint capacity for AI reporting changes AI reporting module availability.";
const SAID_FIX = "You accepted Olumi's estimate for how much Sprint capacity for integration fix changes Integration-step bug resolution.";

/** The investor moment: the earlier Run held its figures back (prior_withheld), no win shares to pair. */
const UNWITHHELD = {
  attribution_case: 'C1_attributable', input_coverage: 'complete', input_changes: [AI, FIX],
  win_probabilities: [], win_probabilities_unavailable: 'prior_withheld',
  leader: { changed: true, noise_verdict: 'not_noise_qualified' },
};
const plan = (delta: unknown, licensed = false) => rerunExplanationPlan(delta, labelOf, OPTIONS, licensed, MODEL_LABELS);

const LINE = `${SAID_AI} ${SAID_FIX} ${RERUN_FALLBACK_LINES.unwithheld}`;
const PAIRED = { ...UNWITHHELD, win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] };

const snapshot = (over: Partial<RunInputSnapshot> = {}): RunInputSnapshot => ({
  snapshot_version: 1, sent_digest: 'a'.repeat(64), residual_digest: 'b'.repeat(64),
  goal: null, options: [], options_not_sent: [], factors: [], constraints: [], links: [], ...over,
});
const PRESENCE_ROWS = diffRunInputSnapshots(snapshot(), snapshot({ links: [
  { from: 'risk', to: 'mrr', mean: -0.5 }, { from: 'price', to: 'risk', mean: -0.5 },
] }));
const ENTERED = [
  'The link from ‘Feature release slips’ to ‘MRR’ is now part of the analysis.',
  'The link from ‘Pro plan price’ to ‘Feature release slips’ is now part of the analysis.',
];

const ROW_HELPERS = ['changeRow', 'pushPair'] as const;
const referenceVariant = (helper: typeof ROW_HELPERS[number], shorthand: boolean) => (source: string): string => {
  const ends = helper === 'changeRow' ? 'null, { raw: true }' : '[null, { raw: true }]';
  const declaration = shorthand ? `const emitters = { ${helper} };` : `const emit = ${helper};`;
  return (helper === 'changeRow'
    ? source.replace('const byId', `${declaration}\n\nconst byId`)
    : source.replace('  // ── option settings', `  ${declaration}\n  // ── option settings`))
    .replace('  // ── option settings',
      `  ${shorthand ? `emitters.${helper}` : 'emit'}({ entity_kind: 'link', entity_id: 'new', field: 'presence', link: { from: 'risk', to: 'mrr' } }, ${ends});\n  // ── option settings`);
};
const PRODUCER_VARIANTS = {
  'alias:changeRow': referenceVariant('changeRow', false),
  'alias:pushPair': referenceVariant('pushPair', false),
  'shorthand:changeRow': referenceVariant('changeRow', true),
  'shorthand:pushPair': referenceVariant('pushPair', true),
  'export:changeRow': (source: string) => `${source}\nexport { changeRow };\n`,
};
type ProducerVariant = keyof typeof PRODUCER_VARIANTS;
const producerPath = fileURLToPath(new URL('../../coaching/run-input-changes.ts', import.meta.url));
const producerVariantPath = (variant?: ProducerVariant) => variant === undefined ? producerPath
  : producerPath.replace(/\.ts$/u, `.probe-${variant.replace(':', '-')}.ts`);
let producerCache: { program: ts.Program; checker: ts.TypeChecker } | undefined;

/** One lazy program for this file; virtual sibling modules preserve each mutation's own helper symbols. */
function producerCompiler(): NonNullable<typeof producerCache> {
  if (producerCache !== undefined) return producerCache;
  const baseline = readFileSync(producerPath, 'utf8');
  const virtualSources = new Map(Object.entries(PRODUCER_VARIANTS)
    .map(([variant, mutate]) => [producerVariantPath(variant as ProducerVariant), mutate(baseline)]));
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile;
  const fileExists = host.fileExists;
  host.readFile = (file) => virtualSources.get(file) ?? readFile(file);
  host.fileExists = (file) => virtualSources.has(file) || fileExists(file);
  const program = ts.createProgram([producerPath, ...virtualSources.keys()], options, host);
  producerCache = { program, checker: program.getTypeChecker() };
  return producerCache;
}

/** Resolve literal kinds/fields at the producer's constructors; helper references must be direct calls, never aliases. */
function emittedPairs(variant?: ProducerVariant): string[] {
  const { program, checker } = producerCompiler();
  const source = program.getSourceFile(producerVariantPath(variant));
  if (source === undefined) throw new Error(`Missing producer source: ${variant ?? 'baseline'}`);
  const producer = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'diffRunInputs');
  if (producer === undefined || !ts.isFunctionDeclaration(producer) || producer.body === undefined) throw new Error('Missing diffRunInputs');
  const changeRow = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'changeRow');
  const pushPair = producer.body.statements.filter(ts.isVariableStatement).flatMap((node) => node.declarationList.declarations)
    .find((node) => ts.isIdentifier(node.name) && node.name.text === 'pushPair');
  if (changeRow === undefined || !ts.isFunctionDeclaration(changeRow) || changeRow.name === undefined || pushPair === undefined) {
    throw new Error('Missing row helpers');
  }
  const helpers = new Map([
    [checker.getSymbolAtLocation(changeRow.name)!, 'changeRow'],
    [checker.getSymbolAtLocation(pushPair.name)!, 'pushPair'],
  ]);
  const checkHelperReferences = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const symbol = ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
      const resolved = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
      if (helpers.has(resolved!)) {
        expect(ts.isVariableDeclaration(parent) && parent.name === node
          || ts.isFunctionDeclaration(parent) && parent.name === node
          || ts.isCallExpression(parent) && parent.expression === node, 'row helpers must be called directly').toBe(true);
      }
    }
    ts.forEachChild(node, checkHelperReferences);
  };
  checkHelperReferences(source);
  const pairs = new Set<string>();
  let writes = 0;
  const strings = (type: ts.Type): string[] => {
    if (type.isUnion()) return type.types.flatMap(strings);
    if (type.isStringLiteral()) return [type.value];
    throw new Error(`Unresolved producer row type: ${checker.typeToString(type)}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'rows') {
      const parent = node.parent;
      expect(ts.isVariableDeclaration(parent) && parent.name === node
        || ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'push'
        || ts.isShorthandPropertyAssignment(parent), 'row writes must not bypass the constructor guard').toBe(true);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'rows') {
      expect(node.getText(source), 'rows must enter through the checked constructors').toBe('rows.push(r)');
      writes += 1;
      const declaration = checker.getSymbolAtLocation(node.arguments[0]!)?.valueDeclaration;
      expect(declaration?.parent.parent.getText(source)).toMatch(/^push\s*=/u);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'push') expect(node.arguments[0] && ts.isCallExpression(node.arguments[0])
        && node.arguments[0].expression.getText(source) === 'changeRow').toBe(true);
      const name = helpers.get(checker.getSymbolAtLocation(node.expression)!);
      if (name !== undefined) {
        const argument = node.arguments[0]!;
        const declaration = ts.isIdentifier(argument) ? checker.getSymbolAtLocation(argument)?.valueDeclaration : undefined;
        if (declaration !== undefined && ts.isParameter(declaration)) {
          expect(name).toBe('changeRow');
          expect(node.getText(source)).toBe('changeRow(base, pair[0], pair[1])');
          expect(declaration.parent.parent.getText(source)).toMatch(/^pushPair\s*=/u);
        } else {
          const type = checker.getTypeAtLocation(argument);
          const values = (key: string) => {
            const property = type.getProperty(key);
            if (property === undefined) throw new Error(`Missing ${key}: ${node.getText(source)}`);
            return strings(checker.getTypeOfSymbolAtLocation(property, argument));
          };
          for (const kind of values('entity_kind')) for (const field of values('field')) pairs.add(`${kind}:${field}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(producer.body);
  expect(writes).toBe(1);
  expect(pairs.size).toBeGreaterThan(0);
  return [...pairs].sort();
}

describe('Q4: every recorded row is spoken or accounted for', () => {
  it.each(ROW_HELPERS)('exhaustiveness: an alias of %s cannot bypass row discovery', (helper) => {
    expect(() => emittedPairs(`alias:${helper}`)).toThrow('row helpers must be called directly');
  }, 20_000);

  it.each(ROW_HELPERS)('exhaustiveness: a shorthand reference to %s cannot bypass row discovery', (helper) => {
    expect(() => emittedPairs(`shorthand:${helper}`)).toThrow('row helpers must be called directly');
  }, 20_000);

  it('exhaustiveness: an exported helper reference is rejected', () => {
    expect(() => emittedPairs('export:changeRow')).toThrow('row helpers must be called directly');
  }, 20_000);

  it('Paul\'s risk → MRR and price → risk presence rows name both links now part of the analysis', () => {
    const p = plan({ ...PAIRED, input_changes: PRESENCE_ROWS })!;
    expect(p.changes).toEqual([ENTERED[1], ENTERED[0]]);
    expect(p.codeLine).not.toContain(RERUN_NO_CHANGE_LINES.unknown);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it('a link leaving the calculation inputs says no longer part of the analysis, with both endpoint labels', () => {
    const rows = diffRunInputSnapshots(snapshot({ links: [{ from: 'risk', to: 'mrr', mean: -0.5 }] }), snapshot());
    const p = plan({ ...PAIRED, input_changes: rows })!;
    expect(p.changes).toEqual(['The link from ‘Feature release slips’ to ‘MRR’ is no longer part of the analysis.']);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it.each([
    ['entered', false, 'The option ‘Raise price’ is now part of the analysis.'],
    ['left', true, 'The option ‘Raise price’ is no longer part of the analysis.'],
  ] as const)('an option that %s the calculation inputs names its direction', (_name, leaving, sentence) => {
    const withOption = snapshot({ options: [{ option_id: 'o', label: 'Raise price', settings: [] }] });
    const rows = diffRunInputSnapshots(leaving ? withOption : snapshot(), leaving ? snapshot() : withOption);
    expect(rows).toMatchObject([{ entity_kind: 'option', field: 'presence',
      before: leaving ? { raw: true } : null, after: leaving ? null : { raw: true } }]);
    const p = plan({ ...PAIRED, input_changes: rows })!;
    expect(p.changes).toEqual([sentence]);
    expect(composeRerunExplanation('', p).text).toBe(`${sentence} ${RERUN_FALLBACK_LINES.C1}`);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it.each(['added', 'removed', 'replaced'] as const)('a goal that was %s names each recorded goal and its direction', (change) => {
    // Both nodes remain calculation inputs: presence records the goal's role, not deletion of a node.
    const base = snapshot({ factors: [{ factor_id: 'mrr', label: 'MRR' },
      { factor_id: 'quarterly_revenue', label: 'Quarterly revenue' }] });
    const oldGoal = { ...base, goal: { node_id: 'mrr', label: 'MRR' } };
    const newGoal = { ...base, goal: { node_id: 'quarterly_revenue', label: 'Quarterly revenue' } };
    const rows = diffRunInputSnapshots(change === 'added' ? base : oldGoal,
      change === 'removed' ? base : change === 'added' ? oldGoal : newGoal);
    const sentences = change === 'added' ? ['‘MRR’ is now the goal of the analysis.']
      : change === 'removed' ? ['‘MRR’ is no longer the goal of the analysis.']
        : ['‘MRR’ is no longer the goal of the analysis.', '‘Quarterly revenue’ is now the goal of the analysis.'];
    expect(rows).toMatchObject(change === 'replaced'
      ? [{ entity_kind: 'goal', field: 'presence', label_before: 'MRR', before: { raw: true }, after: null },
        { entity_kind: 'goal', field: 'presence', label_after: 'Quarterly revenue', before: null, after: { raw: true } }]
      : [{ entity_kind: 'goal', field: 'presence', before: change === 'added' ? null : { raw: true },
        after: change === 'added' ? { raw: true } : null }]);
    const p = plan({ ...PAIRED, input_changes: rows })!;
    expect(p.changes).toEqual(sentences);
    expect(composeRerunExplanation('', p).text).toBe(`${sentences.join(' ')} ${RERUN_FALLBACK_LINES.C1}`);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it.each([
    ['changed', 49, 59, 'The value of ‘Pro plan price’ for the option ‘Raise price’ changed: 49 GBP → 59 GBP.'],
    ['added', undefined, 59, 'The value of ‘Pro plan price’ for the option ‘Raise price’ was recorded: 59 GBP.'],
    ['removed', 49, undefined, 'The recorded value of ‘Pro plan price’ for the option ‘Raise price’ was removed.'],
  ] as const)('an option setting that was %s names its own option, distinct from today’s factor value', (_name, before, after, sentence) => {
    const withSetting = (raw: number | undefined) => snapshot({
      options: [{ option_id: 'o', label: 'Raise price', settings: raw === undefined ? []
        : [{ factor_id: 'price', label: 'Pro plan price', raw, unit: 'GBP', encoded: raw }] }],
      factors: raw === undefined ? [] : [{ factor_id: 'price', label: 'Pro plan price', raw, unit: 'GBP', encoded: raw }],
    });
    const rows = diffRunInputSnapshots(withSetting(before), withSetting(after));
    const setting = rows.find((r) => r.entity_kind === 'option_setting')!;
    const factor = rows.find((r) => r.entity_kind === 'factor_value')!;
    expect(setting).toMatchObject({ option_id: 'o', entity_id: 'price', field: 'value' });
    const p = plan({ ...PAIRED, input_changes: rows })!;
    expect(p.changes[0]).toBe(sentence);
    expect(p.changes[0]).not.toBe(plan({ ...PAIRED, input_changes: [factor] })!.changes[0]);
    expect(composeRerunExplanation('', p).text).toBe(p.codeLine);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
    const unknownOption = { ...setting, option_id: 'gone' };
    expect(plan({ ...PAIRED, input_changes: [unknownOption] })!.codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
    expect(plan({ ...PAIRED, input_changes: [AI, unknownOption] })!.codeLine).toBe(`${SAID_AI} ${RERUN_FALLBACK_LINES.other}`);
  });

  it.each([
    'The option ‘Raise price’ is now part of the analysis.',
    'The option ‘Raise price’ is no longer part of the analysis.',
    '‘MRR’ is now the goal of the analysis.',
    '‘MRR’ is no longer the goal of the analysis.',
    '‘Quarterly revenue’ is now the goal of the analysis.',
    'The value of ‘Pro plan price’ for the option ‘Raise price’ changed: 49 GBP → 59 GBP.',
    'The value of ‘Pro plan price’ for the option ‘Raise price’ was recorded: 59 GBP.',
    'The recorded value of ‘Pro plan price’ for the option ‘Raise price’ was removed.',
  ])('every new per-kind sentence passes the repository copy guards: %s', (sentence) => {
    expect(findForbiddenPhraseHit(sentence)).toBeNull();
    expect(findEditInternalsHit(sentence)).toBeNull();
    expect(findSuccessClaimHit(sentence)).toBeNull();
    expect(findProcessNarrationHit(sentence)).toBeNull();
    expect(sentence).not.toMatch(HELD_SCIENCE_VOCABULARY_PATTERN);
    expect(internalValueTerms(sentence)).toEqual([]);
    expect(sanitiseNarrateOutput(sentence)).toEqual({ output: sentence, contamination_detected: false });
    expect(sanitiseUserFacingText(sentence, null)).toMatchObject({ text: sentence, matches: [] });
    for (const ban of REPAIR_VOCABULARY_DENYLIST) expect(sentence).not.toMatch(ban);
  });

  it.each(['from', 'to'] as const)('an unknown %s end stays skipped, alone and beside a named presence row', (end) => {
    const known = PRESENCE_ROWS.find((r) => r.link?.from === 'risk')!;
    const unknown = { ...known, link: { ...known.link!, [end]: 'gone' } };
    expect(plan({ ...PAIRED, input_changes: [unknown] })!.codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
    const p = plan({ ...PAIRED, attribution_case: 'C0_identical', input_changes: [known, unknown] })!;
    expect(p.changes).toEqual([ENTERED[0]]);
    expect(p.codeLine).toBe(`${ENTERED[0]} ${RERUN_FALLBACK_LINES.other}`);
    expect(p.codeLine).not.toContain(RERUN_FALLBACK_LINES.C0);
    expect(p.inputs.attribution_case).toBe('C2_unpaired');
  });

  it('exhaustiveness: every producer pair has a sentence or a skipped-row disclosure, never a silent omission', () => {
    const prior = snapshot({
      goal: { node_id: 'mrr', label: 'MRR', target_raw: 55000, unit: 'GBP', operator: '>=', direction: 'maximise' },
      factors: [{ factor_id: 'mrr', label: 'MRR', raw: 40000, unit: 'GBP', encoded: 0.4 },
        { factor_id: 'price', label: 'Pro plan price', raw: 49, unit: 'GBP', encoded: 49 }],
      options: [{ option_id: 'o', label: 'Raise price', settings: [{ factor_id: 'price', label: 'Pro plan price', raw: 49, unit: 'GBP', encoded: 49 }] }],
      constraints: [{ constraint_id: 'c', node_id: 'price', label: 'Price limit', raw: 50, unit: 'GBP', operator: '<=' }],
      links: [{ from: 'risk', to: 'mrr', mean: 0.4, band: 'moderate', sizing: 'placeholder',
        natural_effect: { amount: 2, amount_unit: 'GBP', per_source_change: 1, per_source_change_unit: 'days' } }],
    });
    const current = snapshot({
      goal: { ...prior.goal!, target_raw: 60000, unit: 'USD', operator: '>', direction: 'minimise' },
      factors: prior.factors.map((f) => ({ ...f, raw: 59, encoded: 59 })),
      options: [{ ...prior.options[0]!, settings: [{ ...prior.options[0]!.settings[0]!, raw: 59, encoded: 59 }] },
        { option_id: 'new', label: 'New option', settings: [] }],
      constraints: [{ ...prior.constraints[0]!, raw: 60, operator: '>=' }],
      links: [{ ...prior.links[0]!, mean: 0.8, band: 'strong', sizing: 'olumi_accepted',
        natural_effect: { ...prior.links[0]!.natural_effect!, amount: 3 } }, { from: 'price', to: 'risk', mean: -0.5 }],
    });
    const rows = [...diffRunInputSnapshots(prior, current), ...diffRunInputSnapshots(prior, { ...prior, goal: null })];
    const probes = new Map(rows.map((row) => [`${row.entity_kind}:${row.field}`, row]));
    expect([...probes.keys()].sort(), 'a new producer pair needs a behavioural row').toEqual(emittedPairs());
    const sentences: Record<string, string | undefined> = {
      'option_setting:value': 'The value of ‘Pro plan price’ for the option ‘Raise price’ changed: 49 GBP → 59 GBP.',
      'option:presence': 'The option ‘New option’ is now part of the analysis.',
      'factor_value:value': 'You changed Pro plan price: 49 GBP → 59 GBP.',
      'goal:value': "Today's level of ‘MRR’ was recorded: 59 GBP.",
      'goal:target': 'You changed the target for ‘MRR’: 55000 GBP → 60000 USD.',
      'goal:unit': '‘MRR’ is now measured in USD.',
      'goal:operator': 'You changed MRR: >= → >.',
      'goal:direction': 'You changed MRR: maximise → minimise.',
      'goal:presence': '‘MRR’ is no longer the goal of the analysis.',
      'constraint:target': 'You changed Price limit: 50 GBP → 60 GBP.',
      'constraint:operator': 'You changed Price limit: <= → >=.',
      'link:presence': ENTERED[1],
      'link:sizing': "You accepted Olumi's estimate for how much Feature release slips changes MRR.",
      'link:strength': undefined,
      'link:effect': undefined,
    };
    expect(Object.keys(sentences).sort(), 'every pair needs exact words or an exact skipped-row disclosure').toEqual([...probes.keys()].sort());
    for (const [pair, row] of probes) {
      const sentence = sentences[pair];
      const alone = plan({ ...PAIRED, attribution_case: 'C0_identical', input_changes: [row] })!;
      expect(alone.changes, pair).toEqual(sentence === undefined ? [] : [sentence]);
      expect(alone.codeLine, pair).toBe(sentence === undefined ? RERUN_NO_CHANGE_LINES.unknown : `${sentence} ${RERUN_FALLBACK_LINES.C0}`);
      const beside = plan({ ...PAIRED, attribution_case: 'C0_identical', input_changes: [AI, row] })!;
      expect(beside.changes, pair).toEqual(sentence === undefined ? [SAID_AI] : [SAID_AI, sentence]);
      expect(beside.codeLine, pair).toBe(sentence === undefined
        ? `${SAID_AI} ${RERUN_FALLBACK_LINES.other}` : `${SAID_AI} ${sentence} ${RERUN_FALLBACK_LINES.C0}`);
      if (sentence === undefined) {
        expect(beside.inputs.attribution_case, pair).toBe('C2_unpaired');
      }
      const unnamed = { ...row, label_before: undefined, label_after: undefined,
        ...(row.link !== undefined ? { link: { from: 'gone', to: row.link.to } } : {}) };
      const unsaid = plan({ ...PAIRED, attribution_case: 'C0_identical', input_changes: [AI, unnamed] })!;
      expect(unsaid.changes, pair).toEqual([SAID_AI]);
      expect(unsaid.codeLine, pair).toBe(`${SAID_AI} ${RERUN_FALLBACK_LINES.other}`);
      expect(unsaid.inputs.attribution_case, pair).toBe('C2_unpaired');
    }
  }, 20_000);

  it('exhaustiveness: all mutation probes and repeat reads reuse one TypeScript program per file', () => {
    emittedPairs();
    for (const variant of Object.keys(PRODUCER_VARIANTS) as ProducerVariant[]) {
      expect(() => emittedPairs(variant)).toThrow('row helpers must be called directly');
    }
    emittedPairs();
    expect(ts.createProgram).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe('the plan: Olumi\'s code line from the typed rows, the check inputs', () => {
  it('RED (the investor moment): two Accepts → RC\'s two sentences with the graph\'s labels + the UNWITHHELD line; prior_withheld is typed', () => {
    const p = plan(UNWITHHELD)!;
    expect(p.changes).toEqual([SAID_AI, SAID_FIX]);
    expect(p.inputs).toMatchObject({ change_labels: [SAID_AI, SAID_FIX], prior_withheld: true, no_matched_figures: false,
      attribution_case: 'C1_attributable', leader_licensed: false, model_labels: MODEL_LABELS });
    expect(p.codeLine).toBe(LINE);
    expect(p.fallback).toBe(LINE);
    expect(p.instruction).toContain(LINE);
    expect(p.instruction).toContain('never say whether the inputs changed or stayed the same');
  });

  it('INERT: no run_delta (a first Run) → no plan (the explanation path is exactly as before)', () => {
    expect(plan(undefined)).toBeNull();
  });

  it.each([
    ['a typed, COMPLETE, empty record', { attribution_case: 'C0_identical', input_coverage: 'complete', input_changes: [], win_probabilities: [{ option_id: 'x' }] }, RERUN_NO_CHANGE_LINES.nothing],
    ['… with prior_withheld', { attribution_case: 'C0_identical', input_coverage: 'complete', input_changes: [], win_probabilities: [], win_probabilities_unavailable: 'prior_withheld' }, `${RERUN_NO_CHANGE_LINES.nothing} ${RERUN_NO_CHANGE_LINES.unwithheld}`],
    ['a PARTIAL empty record (served 6b today)', { attribution_case: 'C2_unpaired', input_coverage: 'partial', input_changes: [], win_probabilities: [] }, RERUN_NO_CHANGE_LINES.unknown],
    ['a pre-0.70 delta: no input_changes at all', { attribution_case: 'C1_attributable', input_coverage: 'complete', win_probabilities: [] }, RERUN_NO_CHANGE_LINES.unknown],
    ['rows whose link ends the graph does not hold', { attribution_case: 'C1_attributable', input_coverage: 'complete', input_changes: [accept('gone_a', 'gone_b')], win_probabilities: [] }, RERUN_NO_CHANGE_LINES.unknown],
  ])('no nameable change: %s → "%s"', (_n, delta, line) => {
    const p = plan(delta)!;
    expect(p.codeLine).toBe(line);
    expect(p.changes).toEqual([]);
  });

  it('"Nothing you entered changed" ONLY on a complete empty record — a row the graph cannot name is never "nothing"', () => {
    expect(plan({ ...UNWITHHELD, input_changes: [accept('gone_a', 'gone_b')] })!.codeLine).not.toContain(RERUN_NO_CHANGE_LINES.nothing);
  });

  it('an unknown-end link presence row beside a named Accept: never "Nothing else changed", checked as unpaired (Codex pre-review P2)', () => {
    const presence = { entity_kind: 'link', entity_id: 'p', link: { from: 'gone', to: 'quarterly_revenue' }, field: 'presence', before: null, after: { raw: true }, change: 'added' };
    const p = plan({ ...PAIRED, attribution_case: 'C0_identical', input_changes: [AI, presence] })!;
    expect(p.codeLine).toBe(`${SAID_AI} ${RERUN_FALLBACK_LINES.other}`);
    expect(p.codeLine).not.toContain(RERUN_FALLBACK_LINES.C0);
    expect(p.inputs.attribution_case).toBe('C2_unpaired');
  });

  it('prior_withheld is never inferred from an empty array: empty win shares WITHOUT the typed reason → no_matched_figures, not UNWITHHELD', () => {
    const p = plan({ ...UNWITHHELD, win_probabilities_unavailable: undefined })!;
    expect(p.inputs).toMatchObject({ prior_withheld: false, no_matched_figures: true });
    expect(p.codeLine).toBe(`${SAID_AI} ${SAID_FIX} ${RERUN_FALLBACK_LINES.C1}`);
  });

  it('one sentence per link: a sizing (→ user) and a strength row on ONE link are one change', () => {
    const own = { ...AI, after: { raw: 'user' } };
    const band = { ...AI, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' } };
    expect(plan({ ...UNWITHHELD, input_changes: [own, band] })!.changes).toEqual([
      'You gave your own estimate for how much Sprint capacity for AI reporting changes AI reporting module availability: moderate → strong.',
    ]);
  });

  it('the Accept is never folded away: sizing → olumi_accepted + a band move on ONE link keeps "You accepted"', () => {
    const band = { ...AI, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' } };
    expect(plan({ ...UNWITHHELD, input_changes: [AI, band] })!.changes).toEqual([
      "You accepted Olumi's estimate for how much Sprint capacity for AI reporting changes AI reporting module availability: moderate → strong.",
    ]);
  });

  // ⛔ CODEX CEE BUDDY CR 5940970957: four complete Accept rows with a C0 pair named three and then said "Nothing else changed".
  it.each([
    ['3 recorded changes → all named, no disclosure', [AI, FIX, accept('qualified_leads', 'quarterly_revenue')], ''],
    ['4 recorded changes → 3 named + "You also made 1 other change."', [AI, FIX, accept('qualified_leads', 'quarterly_revenue'), accept('integration_step_bug_resolution', 'quarterly_revenue')], ' You also made 1 other change.'],
    ['5 recorded changes → 3 named + "You also made 2 other changes."', [AI, FIX, accept('qualified_leads', 'quarterly_revenue'), accept('integration_step_bug_resolution', 'quarterly_revenue'), accept('ai_reporting_module_availability', 'quarterly_revenue')], ' You also made 2 other changes.'],
  ])('the cap never hides a recorded change (C0 pair): %s', (_n, rows, disclosed) => {
    const p = plan({ ...PAIRED, attribution_case: 'C0_identical', input_changes: rows })!;
    expect(p.changes).toHaveLength(3);
    expect(p.codeLine).toBe(`${p.changes.join(' ')}${disclosed} ${RERUN_FALLBACK_LINES.C0}`);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
    expect(composeRerunExplanation('', p).text, 'an empty model reply keeps the disclosure').toBe(p.codeLine);
  });

  it('a non-link row says its own label, before → after, with units; at most three changes', () => {
    const price = { entity_kind: 'factor', entity_id: 'f', field: 'value', label_after: 'Pro plan price', before: { raw: 49, unit: '£' }, after: { raw: 59, unit: '£' }, change: 'changed' };
    const p = plan({ ...UNWITHHELD, input_changes: [price, AI, FIX, accept('qualified_leads', 'quarterly_revenue')] })!;
    expect(p.changes).toHaveLength(3);
    expect(p.changes[0]).toBe('You changed Pro plan price: 49 £ → 59 £.');
  });

  it.each([
    ['C0_identical', RERUN_FALLBACK_LINES.C0],
    ['C2_unpaired', RERUN_FALLBACK_LINES.C2],
    ['C3_engine_drift', RERUN_FALLBACK_LINES.other],
    ['C4_budget_drift', RERUN_FALLBACK_LINES.other],
    // Unattributed is UNKNOWN, not an observed difference (CODEX on b6e52dbc P1; DL 5943403202's ruling).
    ['C5_unattributed', RERUN_FALLBACK_LINES.unverified],
  ])('the case line for %s (C3–C5 are checked as C2 and never say "a new draw")', (c, line) => {
    const p = plan({ ...PAIRED, attribution_case: c })!;
    expect(p.codeLine.endsWith(line)).toBe(true);
    expect(p.inputs.attribution_case).toBe(c === 'C0_identical' ? 'C0_identical' : 'C2_unpaired');
  });

  // `partial` = "can't VERIFY every sent input was the same" (F1b 5943379851), never "an input changed": said as Olumi
  // can't confirm, never as an observed difference (MG 5943403202; DL ruling).
  it.each(['partial', 'not_recorded', undefined])('coverage %s never licenses "same inputs" or a cause: checked as unpaired, said as "Olumi can\'t confirm"', (coverage) => {
    const p2 = plan({ ...PAIRED, attribution_case: 'C0_identical', input_coverage: coverage })!;
    expect(p2.inputs.attribution_case).toBe('C2_unpaired');
    expect(p2.codeLine.endsWith(RERUN_FALLBACK_LINES.unverified)).toBe(true);
    expect(p2.codeLine).not.toContain(RERUN_FALLBACK_LINES.C0);
    expect(p2.codeLine).not.toContain(RERUN_FALLBACK_LINES.other);
  });

  it.each([
    ['UNWITHHELD', UNWITHHELD],
    ['C0', { ...PAIRED, attribution_case: 'C0_identical' }],
    ['C2', { ...PAIRED, attribution_case: 'C2_unpaired' }],
    ['C3', { ...PAIRED, attribution_case: 'C3_engine_drift' }],
    ['C5', { ...PAIRED, attribution_case: 'C5_unattributed' }],
    ['partial', { ...PAIRED, input_coverage: 'partial' }],
    ['nothing', { attribution_case: 'C0_identical', input_coverage: 'complete', input_changes: [], win_probabilities: [{ option_id: 'x' }] }],
    ['nothing + withheld', { attribution_case: 'C0_identical', input_coverage: 'complete', input_changes: [], win_probabilities: [], win_probabilities_unavailable: 'prior_withheld' }],
    ['unknown', { attribution_case: 'C2_unpaired', input_coverage: 'partial', input_changes: [], win_probabilities: [] }],
    ['unknown + withheld', { attribution_case: 'C2_unpaired', input_coverage: 'partial', input_changes: [], win_probabilities: [], win_probabilities_unavailable: 'prior_withheld' }],
  ])('the CODE LINE alone passes RC\'s check (%s) — so a sentence beside it is judged on its own words', (_n, delta) => {
    const p = plan(delta)!;
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });
});

/**
 * ⛔ M2 CHAIN (CODEX pre-review on CEE 864e915c, P1; DL GO): "That was what held the comparison back" CREDITS the user's
 * change, so it rides ONLY a C1 pair (complete coverage, same draw and builds → the named changes are the only
 * differences). Under engine drift, a new draw or partial coverage the comparison may be owed to something else: the
 * line is the neutral "Olumi can now compare the options." followed by the case line.
 */
describe('the UNWITHHELD line credits the change ONLY on a C1 pair; an unknown difference is never said as observed', () => {
  const NEUTRAL = RERUN_NO_CHANGE_LINES.unwithheld;
  const UNSURE = 'Olumi can’t confirm nothing else differed between the two Runs';
  it.each<[string, string, string, string]>([
    ['C0 complete', 'C0_identical', 'complete', `${NEUTRAL} ${RERUN_FALLBACK_LINES.C0}`],
    ['C1 complete (the investor moment)', 'C1_attributable', 'complete', RERUN_FALLBACK_LINES.unwithheld],
    ['C2 draw not shown equal', 'C2_unpaired', 'complete', `${NEUTRAL} ${RERUN_FALLBACK_LINES.C2}`],
    ['C3 engine drift (recorded)', 'C3_engine_drift', 'complete', `${NEUTRAL} ${RERUN_FALLBACK_LINES.other}`],
    ['C4 budget drift (recorded)', 'C4_budget_drift', 'complete', `${NEUTRAL} ${RERUN_FALLBACK_LINES.other}`],
    ['C5 unattributed (unknown)', 'C5_unattributed', 'complete', `${NEUTRAL} ${RERUN_FALLBACK_LINES.unverified}`],
    ...(['C0_identical', 'C1_attributable', 'C2_unpaired', 'C3_engine_drift', 'C4_budget_drift', 'C5_unattributed'] as const)
      .map((c): [string, string, string, string] => [`${c} with PARTIAL coverage (unknown)`, c, 'partial', `${NEUTRAL} ${RERUN_FALLBACK_LINES.unverified}`]),
  ])('prior_withheld + a named change, %s → the exact line; RC\'s check passes', (_n, attribution_case, input_coverage, tail) => {
    const p = plan({ ...UNWITHHELD, attribution_case, input_coverage, input_changes: [AI] })!;
    expect(p.codeLine).toBe(`${SAID_AI} ${tail}`);
    if (attribution_case !== 'C1_attributable' || input_coverage !== 'complete') expect(p.codeLine).not.toContain(RERUN_FALLBACK_LINES.unwithheld);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it('RED (CODEX on 3d0891e2): a C2 pair never asserts "a new draw" — the draw may only be unrecorded; Olumi can\'t confirm it was the same', () => {
    const p = plan({ ...PAIRED, attribution_case: 'C2_unpaired', input_changes: [AI] })!;
    expect(p.codeLine).toBe(`${SAID_AI} Olumi can’t confirm both runs used the same draw, so the difference can’t be put down to your edit alone.`);
    expect(p.codeLine).not.toContain('new draw');
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  // The model's premise per case, on a PAIRED (not withheld) delta with a named change — each must be TRUE of its case.
  it.each([
    ['C0 complete + NO change: identity is proven', { ...PAIRED, attribution_case: 'C0_identical', input_changes: [] }, 'Nothing differed between the two Runs', ['Other things also differed', UNSURE]],
    ['C1 complete', { ...PAIRED, input_changes: [AI] }, 'You may say what moved', ['Other things also differed', UNSURE]],
    ['C2 complete: the draw is not shown equal', { ...PAIRED, attribution_case: 'C2_unpaired', input_changes: [AI] }, 'Olumi can’t confirm both Runs used the same draw', ['Other things also differed', 'new draw']],
    ['C3 complete: a recorded engine difference', { ...PAIRED, attribution_case: 'C3_engine_drift', input_changes: [AI] }, 'Other things also differed between the two Runs', [UNSURE]],
    ['C4 complete: a recorded budget difference', { ...PAIRED, attribution_case: 'C4_budget_drift', input_changes: [AI] }, 'Other things also differed between the two Runs', [UNSURE]],
    ['C5 complete: unattributed', { ...PAIRED, attribution_case: 'C5_unattributed', input_changes: [AI] }, UNSURE, ['Other things also differed']],
    ['C0 PARTIAL', { ...PAIRED, attribution_case: 'C0_identical', input_coverage: 'partial', input_changes: [AI] }, UNSURE, ['Other things also differed', 'Nothing differed']],
    ['C2 PARTIAL', { ...PAIRED, attribution_case: 'C2_unpaired', input_coverage: 'partial', input_changes: [AI] }, UNSURE, ['Other things also differed']],
    ['C4 PARTIAL', { ...PAIRED, attribution_case: 'C4_budget_drift', input_coverage: 'partial', input_changes: [AI] }, UNSURE, ['Other things also differed']],
    ['C5 PARTIAL', { ...PAIRED, attribution_case: 'C5_unattributed', input_coverage: 'partial', input_changes: [AI] }, UNSURE, ['Other things also differed']],
  ])('the model instruction is true of its case: %s', (_n, delta, says, never) => {
    const p = plan(delta)!;
    expect(p.instruction).toContain(says);
    for (const n of never) expect(p.instruction).not.toContain(n);
  });

  it('RED (MG 5943403202): an UNWITHHELD pair with PARTIAL coverage never says "Other things also differed" — Olumi can\'t confirm', () => {
    const p = plan({ ...PAIRED, input_coverage: 'partial', input_changes: [AI] })!;
    expect(p.codeLine).toBe(`${SAID_AI} ${RERUN_FALLBACK_LINES.unverified}`);
    expect(p.instruction).toContain('Olumi can’t confirm nothing else differed between the two Runs');
    expect(p.instruction).not.toContain('Other things also differed');
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it('CONTROL: a RECORDED row no template can name, under PARTIAL coverage, is an observed difference → "Other things also differed"', () => {
    const presence = { entity_kind: 'link', entity_id: 'p', link: { from: 'gone', to: 'quarterly_revenue' }, field: 'presence', before: null, after: { raw: true }, change: 'added' };
    expect(plan({ ...PAIRED, input_coverage: 'partial', input_changes: [AI, presence] })!.codeLine).toBe(`${SAID_AI} ${RERUN_FALLBACK_LINES.other}`);
  });

  it('CONTROL: a RECORDED difference stays observed — engine drift says "Other things also differed", in the line and the instruction', () => {
    const p = plan({ ...PAIRED, attribution_case: 'C3_engine_drift', input_changes: [AI] })!;
    expect(p.codeLine).toBe(`${SAID_AI} ${RERUN_FALLBACK_LINES.other}`);
    expect(p.instruction).toContain('Other things also differed between the two Runs');
  });

  it('the instruction never tells the model the earlier Run had NO figures (a subset withhold keeps some): it held them back', () => {
    const p = plan(UNWITHHELD)!;
    expect(p.instruction).toContain('The earlier Run held its comparison figures back');
    expect(p.instruction).not.toContain('had no figures');
  });
});

describe('the composer: the code line first, then the model\'s sentences that pass RC\'s checker beside it', () => {
  const p = plan(UNWITHHELD)!;
  const WHY = 'The model now shows a provisional comparison of the four options.';

  it('CONTROL: a clean model paragraph is sent after the code line, as written', () => {
    expect(composeRerunExplanation(WHY, p)).toEqual({ text: `${LINE}\n\n${WHY}`, dropped: [], failed: [] });
  });

  it('a model sentence that only repeats the code line is dropped silently (the record is said once)', () => {
    expect(composeRerunExplanation(`${SAID_AI}\n${RERUN_FALLBACK_LINES.unwithheld} ${WHY}`, p)).toEqual({ text: `${LINE}\n\n${WHY}`, dropped: [], failed: [] });
  });

  it('RED (RX-NO-MOVEMENT-WITHOUT-PRIOR): the "rose" sentence is dropped, the honest one kept — never the claim', () => {
    const r = composeRerunExplanation(`${WHY} AI Reporting Module Sprint's chance rose to 57%.`, p);
    expect(r.text).toBe(`${LINE}\n\n${WHY}`);
    expect(r.failed).toContain('RX-NO-MOVEMENT-WITHOUT-PRIOR');
    expect(r.dropped).toEqual(["AI Reporting Module Sprint's chance rose to 57%."]);
  });

  it('every model sentence fails → the code line alone', () => {
    expect(composeRerunExplanation("AI Reporting Module Sprint's chance rose to 57%.", p).text).toBe(LINE);
  });

  it('RED (RX-NO-LEADER-UNLICENSED): an unlicensed option said to lead is dropped', () => {
    const r = composeRerunExplanation(`${WHY} AI Reporting Module Sprint leads the comparison.`, p);
    expect(r.failed).toContain('RX-NO-LEADER-UNLICENSED');
    expect(r.text).toBe(`${LINE}\n\n${WHY}`);
  });

  it('CONTROL (RC MT-RERUN-MODEL-LABEL-GOOD): a MODEL label containing "leads", beside an option, is masked — kept', () => {
    // Without the mask this sentence holds an option label AND "leads", so RX-NO-LEADER-UNLICENSED would fire.
    const reply = 'Continue Current Plan keeps Qualified leads per month where it was.';
    expect(composeRerunExplanation(reply, p)).toMatchObject({ text: `${LINE}\n\n${reply}`, dropped: [] });
    const unmasked = rerunExplanationPlan(UNWITHHELD, labelOf, OPTIONS, false, []);
    expect(composeRerunExplanation(reply, unmasked!).failed, 'the contrast: without model_labels it reads as a leader claim').toContain('RX-NO-LEADER-UNLICENSED');
  });

  // ⛔ DL ruling 5940472067: no phrase list is the control — the CODE LINE leads every sent text, so no model sentence can
  // replace the record. HARNESS's 7 outside lines (5940373987) + Codex's (pre-review e1c7c788) + the 2 honest ones.
  it.each([
    'Nothing changed.', 'It used the same inputs.', 'The inputs were unchanged.', 'No inputs were changed.', 'This didn’t change anything.',
    'Nothing in your model has changed.', 'Nothing in your model was changed.', 'None of your inputs changed.', 'Your model is unchanged.',
    'Your model hasn’t changed.', 'The inputs stayed the same.', 'The other inputs were unchanged.', 'Everything else used the same inputs.',
  ])('whatever the model says ("%s"), the sent text opens on the code line', (line) => {
    const r = composeRerunExplanation(`${WHY} ${line}`, p);
    expect(r.text.startsWith(`${LINE}\n\n${WHY}`)).toBe(true);
  });

  it.each(['You ran it with the same input values.', 'Nothing in your model changed.'])('RED (RX-NO-CONTRARY-SAME, on staging today): "%s" is dropped', (line) => {
    const r = composeRerunExplanation(`${WHY} ${line}`, p);
    expect(r.failed).toContain('RX-NO-CONTRARY-SAME');
    expect(r.text).toBe(`${LINE}\n\n${WHY}`);
  });

  it('CONTROL (buddy preflight 5939219187): a PAIRED, licensed C1 rerun MAY say what moved', () => {
    const paired = plan(PAIRED, true)!;
    expect(paired.inputs).toMatchObject({ prior_withheld: false, no_matched_figures: false, leader_licensed: true });
    const moved = "AI Reporting Module Sprint's chance rose to 57% and it leads the comparison.";
    expect(composeRerunExplanation(moved, paired)).toMatchObject({ dropped: [], text: `${paired.codeLine}\n\n${moved}` });
  });

  // ⚠ RE-PINNED (Science d5, #87 6005682972 (1)): this row read `plan(PAIRED)`, which carries TWO changes (AI, FIX), as
  // "a C1 pair may state the cause". C1 proves the same draw, builds and sample count but allows several edits, and with two
  // edits no single one can be credited without an ablation. The permissive half now uses ONE change; the two-change and
  // goal-row cases are the RED rows below.
  it('a C2 pair: a causal sentence is dropped (RX-NO-CAUSE-UNPAIRED); a C1 pair with ONE change may state the cause', () => {
    const causal = 'The shift happened because of your change.';
    expect(composeRerunExplanation(causal, plan({ ...PAIRED, attribution_case: 'C2_unpaired' })!).failed).toContain('RX-NO-CAUSE-UNPAIRED');
    const one = plan({ ...PAIRED, input_changes: [AI] })!;
    expect(one.inputs.attribution_case).toBe('C1_attributable');
    expect(one.instruction).toContain('You may say what moved in the comparison.');
    expect(composeRerunExplanation(causal, one).dropped).toEqual([]);
  });

  it('RED (d5 6005682972 (1)): a C1 pair with TWO changes never credits one of them; checked as unpaired, told so', () => {
    const causal = 'The shift happened because of your change.';
    const two = plan(PAIRED)!;
    expect(two.inputs.attribution_case).toBe('C2_unpaired');
    expect(two.instruction).not.toContain('You may say what moved in the comparison.');
    expect(two.instruction).toContain('More than one input changed between the two Runs, or the goal itself changed, so never say which change caused the difference.');
    expect(composeRerunExplanation(causal, two).failed).toContain('RX-NO-CAUSE-UNPAIRED');
    // The line is still the record: both changes named, the same-draw case line kept.
    expect(two.codeLine).toBe(`${SAID_AI} ${SAID_FIX} ${RERUN_FALLBACK_LINES.C1}`);
  });

  it('RED (d5 6005682972 (1), (4)): a C1 pair whose ONE change is to the goal (direction) never credits it: the question changed', () => {
    const flip = { entity_kind: 'goal', entity_id: 'quarterly_revenue', field: 'direction', label_before: 'Quarterly revenue',
      label_after: 'Quarterly revenue', before: { raw: 'maximize' }, after: { raw: 'minimize' }, change: 'changed' };
    const p = plan({ ...PAIRED, input_changes: [flip] })!;
    expect(p.inputs.attribution_case).toBe('C2_unpaired');
    expect(p.instruction).not.toContain('You may say what moved in the comparison.');
    expect(composeRerunExplanation('The shift happened because of your change.', p).failed).toContain('RX-NO-CAUSE-UNPAIRED');
  });

  it('RED (d5 6005682972 (4)): an engine-drift pair (C3, builds differ) never credits the change, even with ONE change', () => {
    const p = plan({ ...PAIRED, attribution_case: 'C3_engine_drift', input_changes: [AI] })!;
    expect(p.inputs.attribution_case).toBe('C2_unpaired');
    expect(composeRerunExplanation('The shift happened because of your change.', p).failed).toContain('RX-NO-CAUSE-UNPAIRED');
  });

  it('the UNWITHHELD line is not this gate: two Accepts on a C1 prior-withheld pair keep the investor-moment line and its check case', () => {
    const p = plan(UNWITHHELD)!;
    expect(p.inputs.attribution_case).toBe('C1_attributable');
    expect(p.codeLine).toBe(LINE);
  });
});

describe('the typed provisional view is the model\'s words too (Codex pre-review e1c7c788 P1)', () => {
  const p = plan(UNWITHHELD)!;
  const view = { view: 'For now, AI Reporting Module Sprint leads my provisional view.', reasoning: 'It needs the least new capacity.', confirm_step: 'Size the integration fix link.' };

  it('RED: "Its chance rose from 40% to 57%." in reasoning, with no prior figures → fails RX-NO-MOVEMENT-WITHOUT-PRIOR', () => {
    expect(rerunViewFailures({ ...view, reasoning: 'Its chance rose from 40% to 57%.' }, p)).toEqual(['RX-NO-MOVEMENT-WITHOUT-PRIOR']);
  });

  it('CONTROL: a labelled provisional leaning (leader words) passes — the view IS the permitted provisional leaning', () => {
    expect(rerunViewFailures(view, p)).toEqual([]);
  });
});
