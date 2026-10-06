/** The delivered, typed current-level ask owns its answer; the existing level door owns the reading and refusal. */
import { randomUUID } from 'node:crypto';
import { isPendingActionExpired, parsePendingAction, type PendingAction } from '../session/pending-action.js';
import { isChangeOwnPercent } from './admit-model.js';
import { readStatedGoalLevel } from './goal-current-level.js';
import { unitPhraseFamily } from './unit-conflict.js';

export const CURRENT_LEVEL_TOOL = 'propose_goal_current_level';
type Ask = PendingAction & { action: Extract<PendingAction['action'], { kind: 'elicit_goal_current_level' }> };
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const records = (v: unknown): Rec[] => Array.isArray(v) ? v.map(rec).filter((r): r is Rec => r !== undefined) : [];
const plain = (s: string): string => s.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (s: string, label: string): boolean => label.trim() !== '' && new RegExp(`(?:^|[^\\p{L}\\d])${escape(plain(label))}(?=$|[^\\p{L}\\d])`, 'u').test(plain(s));
const UNCERTAIN = /\b(?:don['’]t know|do not know|not sure|unsure|no idea|don['’]t have|do not have|cannot|can['’]t|maybe|perhaps|probably|possibly|likely|unlikely|presumably|apparently|I think|I believe|I suspect|guess|might|could|would|will)\b/i;
const CONDITIONAL = /\b(?:if|unless|provided|providing|assuming|as long as|on condition|subject to)\b/i;
const QUESTION = /\?|^\s*(?:what|why|how|when|where|which|who|can|could|should|would|is|are|do|does)\b/i;

/** Bounded figure/unit spans from the person's own reply; never a host choice between the figures. */
export function levelAnswerFigures(message: string): string[] {
  return [...message.matchAll(/[£$€]?\d[\d,]*(?:\.\d+)?\s*(?:%|[\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*){0,6})?/gu)]
    .map((m) => m[0].trim().replace(/\s+(?:today|currently|now|roughly|approximately|about|around)\b.*$/i, '').trim())
    .filter((s) => /[£$€%\p{L}]/u.test(s) && s.length <= 100).slice(0, 8);
}

export function latestCurrentLevelAsk(pending: readonly unknown[], scenarioId: string, userId: string | null, nowMs = Date.now()): Ask | null {
  const asks = pending.map(parsePendingAction).filter((p): p is Ask => p !== null && p.action.kind === 'elicit_goal_current_level'
    && p.scenario_id === scenarioId && p.action.user_id === userId && !isPendingActionExpired(p, nowMs));
  return asks.length === 1 ? asks[0]! : null;
}

/** Read the current native unit from canonical state, never the relative target's percentage. */
function goalInState(state: unknown, ask: Ask): { label: string; unit?: string; entities: Rec[] } | null {
  const s = rec(state);
  if (s?.ok !== true) return null;
  const entities = records(s.entities);
  const goal = entities.find((e) => e.id === ask.action.goal_id && e.kind === 'goal' && e.label === ask.action.goal_label);
  if (goal === undefined || typeof goal.raw_value === 'number') return null;
  const target = rec([...(rec(s.goal) !== undefined ? [rec(s.goal)!] : []), ...records(s.goals)].find((g) => g.id === goal.id)?.target);
  const held = typeof goal.unit === 'string' ? goal.unit : typeof target?.unit === 'string' ? target.unit : undefined;
  const unit = isChangeOwnPercent({ frame: target?.frame, unit: held, metric: goal.label }) ? undefined : held;
  // A changed metric/unit must not inherit an earlier question's answer licence.
  if (unit !== ask.action.goal_unit) return null;
  return { label: String(goal.label), ...(unit !== undefined ? { unit } : {}), entities };
}

/** No chips/methods/preview/withheld tools reach this gate; callers preserve those existing routes. */
export function currentLevelAnswerFirstCall(state: unknown, ask: Ask | null, typedMessage: string | null, otherForcedPath: boolean): typeof CURRENT_LEVEL_TOOL | undefined {
  if (otherForcedPath || ask === null || typedMessage === null || UNCERTAIN.test(typedMessage) || CONDITIONAL.test(typedMessage)) return undefined;
  const goal = goalInState(state, ask);
  if (goal === null) return undefined;
  const text = typedMessage.trim();
  if (ask.action.confirmation === 'choice' && /^(?:the\s+)?latter[.!]?$/i.test(text)) return CURRENT_LEVEL_TOOL;
  if (ask.action.confirmation !== undefined && /^(?:yes|correct|that['’]s right|that is right)[.!]?$/i.test(text)) return CURRENT_LEVEL_TOOL;
  // The founder's yes confirms the restated figure before asking about its consequence, without giving a new quantity.
  if (ask.action.confirmation === 'figure' && /^yes,?\s+how do (?:they|these figures|those figures) affect (?:this|the) decision\?$/i.test(text)) return CURRENT_LEVEL_TOOL;
  if (QUESTION.test(text) || /[−-]\s*\d/.test(text) || /\b(?:no|not|instead|target|increase|decrease|raise|reduce|change|next|forecast)\b/i.test(text)) return undefined;
  if (goal.entities.some((e) => e.id !== ask.action.goal_id && typeof e.label === 'string' && names(text, e.label))) return undefined;
  const figures = levelAnswerFigures(text);
  if (figures.length === 0) return undefined;
  // A percentage cannot answer a non-percentage metric, including a goal whose target is a relative percentage change.
  if (/%|\bpercent\b|\bper cent\b/i.test(text) && unitPhraseFamily(goal.unit) !== 'percent') return undefined;
  for (const span of figures) {
    const match = /^([£$€]?)([\d,]+(?:\.\d+)?)\s*(.*)$/.exec(span)!;
    const unit = match[1] || match[3];
    if (goal.entities.some((e) => e.id !== ask.action.goal_id && e.kind !== 'option' && typeof e.unit === 'string'
      && e.unit !== goal.unit && names(unit, e.unit))) return undefined;
    if (goal.unit !== undefined && !readStatedGoalLevel(Number(match[2]!.replace(/,/g, '')), unit, { label: goal.label, unit: goal.unit }).ok) return undefined;
  }
  // Capacity verbs do not identify the metric: bind them to its label or the same ask's typed clarification figures.
  const remainder = figures.reduce((s, f) => s.replace(f, ''), text).replace(/\b(?:and|or|roughly|approximately|about|around)\b|[,.;]/gi, '').trim();
  const reading = ask.action.confirmation !== undefined && figures.every((f) => ask.action.figures?.some((held) => plain(held) === plain(f)));
  return names(text, goal.label) || remainder === '' || (reading && /^(?:we|our team)\s+(?:can\s+)?(?:fit|deliver|complete)\b/i.test(text))
    || /^(?:today['’]s|the current|our current)\s+level\s+(?:is|of)\b/i.test(text) ? CURRENT_LEVEL_TOOL : undefined;
}

/** Persist only a producer-typed ask actually delivered, or a qualifying clarification of that SAME ask. */
export function currentLevelAskOnAnswer(input: {
  graph: unknown; analysisResult: unknown; sentText: string; scenarioId: string; userId: string | null;
  emittedAtIso: string; prior: Ask | null; answered: boolean; message: string; awaitingApproval: boolean;
}): Ask | null {
  if (input.awaitingApproval) return null;
  const nodes = records(rec(input.graph)?.nodes);
  const result = rec(input.analysisResult);
  const warnings = [...records(result?.inference_warnings), ...records(rec(result?.enrichment)?.inference_warnings)];
  for (const warning of warnings) {
    const first = rec(warning.first_ask);
    if (first?.kind !== 'goal_level' || typeof first.question !== 'string' || !plain(input.sentText).includes(plain(first.question))) continue;
    const goal = nodes.find((n) => n.id === first.node_id && n.kind === 'goal');
    if (goal === undefined || typeof goal.label !== 'string') continue;
    const held = rec(goal.observed_state)?.unit ?? goal.goal_threshold_unit;
    const unit = isChangeOwnPercent({ frame: goal.goal_threshold_frame, unit: held, metric: goal.label }) ? undefined : held;
    const pa = parsePendingAction({
      id: randomUUID(), scenario_id: input.scenarioId, chip_id: 'agent-current-level-ask',
      action: { kind: 'elicit_goal_current_level', goal_id: goal.id, goal_label: goal.label, user_id: input.userId,
        question: first.question, ...(typeof unit === 'string' ? { goal_unit: unit } : {}) },
      preconditions: { target_id: goal.id }, expires_at_turn_count: 3,
      emitted_at_iso: input.emittedAtIso, expires_at_iso: new Date(Date.parse(input.emittedAtIso) + 10 * 60_000).toISOString(),
    });
    if (pa !== null) return pa as Ask;
  }
  const prior = input.prior;
  if (!input.answered || prior === null || isPendingActionExpired(prior, Date.parse(input.emittedAtIso))) return null;
  const goal = nodes.find((n) => n.id === prior.action.goal_id && n.kind === 'goal' && n.label === prior.action.goal_label);
  if (goal === undefined || typeof rec(goal.observed_state)?.raw_value === 'number') return null;
  const figures = levelAnswerFigures(input.message);
  const source = figures.length > 0 ? figures : prior.action.figures ?? [];
  const sourceQuote = figures.length > 0 ? input.message : prior.action.figure_quote;
  if (sourceQuote === undefined || sourceQuote.length > 2000) return null;
  const repeated = source.filter((f) => new RegExp(`(?:^|[^\\d])${escape(plain(f))}(?=$|[^\\p{L}\\d])`, 'u').test(plain(input.sentText)));
  if (repeated.length === 0 || !/\?/.test(input.sentText)) return null;
  // The next answer must select a stated reading, not approve a host estimate or answer an unrelated question.
  const closingQuestion = input.sentText.trim().split(/(?:[.!]\s+|\n)/).at(-1) ?? '';
  const choice = /\bor\b/i.test(closingQuestion) && /\b(?:mean|mix|mixture|equivalent|reading|capacity)\b/i.test(closingQuestion);
  const figure = /^(?:is (?:that|this) (?:right|correct)|have I got (?:that|this) right|(?:can|shall|should) I (?:record|use|capture) (?:that|this)|does (?:that|this) (?:capture|measure))\b.*\?$/i.test(closingQuestion);
  if (!choice && !figure) return null;
  return { ...prior, expires_at_turn_count: prior.expires_at_turn_count - 1,
    action: { ...prior.action, figures: source, figure_quote: sourceQuote, confirmation: choice ? 'choice' : 'figure' } };
}
