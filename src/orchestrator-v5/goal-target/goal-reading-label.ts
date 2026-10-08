import { storedReadingOf } from '../agent-lane/identity-proposal.js';
import { executedReadingAddendOf } from './reading-addend-contribution.js';

type Rec = Record<string, unknown>;
const rec = (x: unknown): x is Rec => x !== null && typeof x === 'object' && !Array.isArray(x);
const nodes = (g: unknown): Rec[] => rec(g) && Array.isArray(g.nodes) ? g.nodes.filter(rec) : [];
const word = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '' && !/[\r\n]/.test(x);
export interface ReadingLabel {
  readonly v: 1;
  readonly source: 'olumi_reading';
  readonly goal: { readonly id: string; readonly label: string };
  readonly factors: readonly [{ readonly id: string; readonly label: string }, { readonly id: string; readonly label: string }];
  readonly addends: readonly { readonly id: string; readonly label: string; readonly sign: 'less' | 'plus'; readonly sized: boolean }[];
}
/** Captured from this dispatch, never from a later/current model on reload. */
export interface GoalReadingRunInput {
  readonly storedGraph: unknown;
  readonly wireGraph: unknown;
  readonly options: readonly Record<string, unknown>[];
  readonly confirmationAvailable: boolean;
}
export interface ReadingRunDecision {
  readonly required: boolean;
  readonly label: ReadingLabel | null;
  readonly allowed: ReadonlySet<string>;
}

/** ONE ruled sentence for point and range readers; the figure has already passed every existing licence gate. */
export function readingChanceSentence(option: string, figure: string, label: ReadingLabel): string {
  const expression = `‘${label.goal.label}’ = ‘${label.factors[0].label}’ × ‘${label.factors[1].label}’`
    + label.addends.map(a => `, ${a.sign} ‘${a.label}’`).join('');
  const standIn = label.addends.some(a => !a.sized)
    ? "; that loss has no figure yet, so Olumi's stand-in for it is used" : '';
  return `‘${option}’: ${figure} chance of meeting your goal, in this model, if ${expression} (Olumi's reading${standIn}).`;
}

export function isReadingLabel(x: unknown): x is ReadingLabel {
  if (!rec(x) || x.v !== 1 || x.source !== 'olumi_reading' || !rec(x.goal) || !word(x.goal.id) || !word(x.goal.label)
    || !Array.isArray(x.factors) || x.factors.length !== 2 || !Array.isArray(x.addends)) return false;
  const named = (a: unknown): a is Rec => rec(a) && word(a.id) && word(a.label);
  if (!x.factors.every(named) || x.factors[0].id === x.factors[1].id || !x.addends.every(a => named(a)
    && (a.sign === 'less' || a.sign === 'plus') && typeof a.sized === 'boolean' && (a.sized || a.sign === 'less'))) return false;
  const ids = [x.goal.id, ...x.factors.map(a => a.id), ...x.addends.map(a => a.id)];
  return new Set(ids).size === ids.length && x.addends.filter(a => !a.sized).length <= 1;
}

export function readingRunDecision(envelope: unknown, graph: unknown, goalId: unknown, input?: GoalReadingRunInput): ReadingRunDecision {
  const storedGoal = nodes(input?.storedGraph ?? graph).find(n => n.id === goalId);
  const wireGoal = nodes(input?.wireGraph).find(n => n.id === goalId);
  const storedIdentity = storedGoal?.nonlinear_identity;
  const identity = wireGoal?.nonlinear_identity;
  const required = (rec(storedIdentity) && storedIdentity.operation === 'product' && storedIdentity.stated_in_brief === false)
    || (rec(identity) && identity.operation === 'product' && identity.stated_in_brief === false);
  const failed: ReadingRunDecision = { required, label: null, allowed: new Set() };
  if (!required || input === undefined || !input.confirmationAvailable || !rec(identity)
    || identity.reading_licence !== 'olumi_reading' || identity.stated_in_brief !== false) return failed;
  const reading = storedReadingOf(input.storedGraph);
  if (reading === null || reading.goal.id !== goalId || !Array.isArray(identity.factor_ids) || identity.factor_ids.length !== 2
    || !reading.factors.every(f => (identity.factor_ids as unknown[]).includes(f.id))) return failed;
  const evaluations = rec(envelope) && Array.isArray(envelope.identity_evaluations) ? envelope.identity_evaluations.filter(rec) : [];
  const evaluation = evaluations.filter(e => e.node_id === goalId);
  if (evaluation.length !== 1 || evaluation[0]!.evaluated !== true
    || (Array.isArray(evaluation[0]!.factor_ids) && (evaluation[0]!.factor_ids.length !== 2
      || !reading.factors.every(f => (evaluation[0]!.factor_ids as unknown[]).includes(f.id))))) return failed;
  let label: ReadingLabel | null = null;
  const allowed = new Set<string>();
  for (const option of input.options) {
    const optionId = typeof option.id === 'string' ? option.id : option.option_id;
    const optionNode = nodes(input.storedGraph).find(n => n.id === optionId && n.kind === 'option');
    if (typeof optionId !== 'string' || !word(optionNode?.label)) continue;
    const addends: ReadingLabel['addends'][number][] = [];
    let complete = true;
    for (const addend of reading.addends) {
      const contribution = executedReadingAddendOf(input.wireGraph, input.options, optionId, String(goalId), addend.id);
      if (contribution === null || contribution.value === 0 || (!contribution.sized && contribution.value >= 0)) { complete = false; break; }
      addends.push({ ...addend, sign: contribution.value < 0 ? 'less' : 'plus', sized: contribution.sized });
    }
    const candidate: ReadingLabel = { v: 1, source: 'olumi_reading', goal: reading.goal, factors: reading.factors, addends };
    if (!complete || !isReadingLabel(candidate)) continue;
    if (label === null) label = candidate;
    // One structured Run label cannot claim conflicting signs for two options. Withhold the incompatible option.
    if (JSON.stringify(label) === JSON.stringify(candidate)) allowed.add(optionId);
  }
  return { required, label, allowed };
}

/** A persisted reader validates the sentence against the structured label and licensed figure, never invents copy. */
export function readingSentencesValid(label: unknown, sentences: unknown, figures: Readonly<Record<string, string>>, ids: readonly string[]): boolean {
  if (!isReadingLabel(label) || !rec(sentences)) return false;
  return ids.every(id => {
    const sentence = sentences[id];
    if (typeof sentence !== 'string' || figures[id] === undefined) return false;
    const match = /^‘([^\r\n]+)’: /.exec(sentence);
    return match !== null && sentence === readingChanceSentence(match[1]!, figures[id]!, label);
  });
}
