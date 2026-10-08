/**
 * ⛔ THE AGENT SAYS HOW EACH LIMIT WAS CHECKED, FROM THE RUN'S OWN PER-LIMIT VERDICTS (MG #72 5864956818).
 *
 * Served `pj-20260928T063347Z` C10: both of the user's limits came back `estimate_only / level_olumi_estimate`. They
 * WERE checked, but against Olumi's own figures. The Agent's run result carried only the generic
 * `leader_claim.withheld_reason: constraint_verdict_withheld`, so the reply said the total-investment limit "was not
 * checkable" and closed on "the model needs a checkable definition of total investment": a false cause, pointing the
 * user at the wrong fix.
 *
 * The per-limit rows (`analysis_limit_verdicts`, the same fact the readback carries) say exactly which it was. Each
 * becomes ONE fixed sentence per state and reason. Nothing is re-derived: a row whose limit has no label in the model
 * is left out, never named by guess.
 */
import { readRatifiedConstraints, type StoredLimitVerdicts } from '../../orchestrator/context/constraint-feasibility.js';
import {
  OLUMI_GUESS_LIMIT_REASON,
  PARTS_IDENTITY_UNMODELLED_REASON,
  PLACEHOLDER_PARTS_REASON,
  optionIdOf,
  placeholderPartsFinding,
  limitUnitsOf,
  type PlaceholderPartsFinding,
} from '../../orchestrator/context/placeholder-parts.js';
import { log } from '../../utils/telemetry.js';
import type { LinkEffectClarificationPending } from './link-effect-clarification.js';
import { limitCheckAsks } from './limited-level-ask.js';

export interface LimitCheck {
  /** The join key for MG's per-limit ask (`limited-level-ask.ts`, seam 5865033356): its sentence rides here verbatim. */
  readonly constraint_id: string;
  readonly limit: string;
  readonly state: 'scored' | 'estimate_only' | 'unscored';
  /** The one sentence the user is told about this limit. */
  readonly say: string;
  /**
   * MG's question for this limit, VERBATIM (`limitCheckAsks`, seam 5865508951): what the user could give so it is
   * checked against THEIR figures. Read off the same graph; absent when MG asks nothing, and never on a `scored` limit.
   */
  readonly ask?: string;
  /**
   * R-c per option (AI Quality #72 5900908629): the options whose own check of this limit was withheld because they move
   * its quantity through a link Olumi has not sized (or through parts the engine cannot combine), by label. Said in
   * `say`; one question per unsized part joins `ask`.
   */
  readonly withheld_for?: readonly string[];
}

const q = (label: string): string => `‘${label}’`;

function carriedLinkAsk(
  from: unknown,
  to: unknown,
  clarifications: readonly LinkEffectClarificationPending[],
): string | undefined {
  const action = clarifications.find(pending => pending.action.from_id === from && pending.action.to_id === to)?.action;
  // AIQ: words pending
  return action === undefined ? undefined : action.question.startsWith('You said') ? action.question : `You said “${action.quote}”. ${action.question}`;
}

/** The old part-to-target ask can span a path. Use its one carried edge only when that edge is unambiguous. */
function carriedPartAsk(
  partId: string | undefined,
  targetId: string,
  nodes: readonly Record<string, unknown>[],
  links: readonly Record<string, unknown>[],
  clarifications: readonly LinkEffectClarificationPending[],
): string | undefined {
  const exact = carriedLinkAsk(partId, targetId, clarifications);
  if (exact !== undefined || partId === undefined || clarifications.length === 0) return exact;
  const allowed = new Set(nodes.filter(node => node.kind !== 'option' && node.kind !== 'decision'
    && (node.analysis_participation !== 'retained_excluded' || node.id === targetId)).map(node => node.id));
  const onPath = links.filter(link => allowed.has(link.from) && allowed.has(link.to));
  const reaches = (from: unknown, to: unknown): boolean => {
    const seen = new Set<unknown>([from]);
    const queue: unknown[] = [from];
    while (queue.length > 0) {
      const at = queue.shift();
      if (at === to) return true;
      for (const link of onPath) {
        if (link.from !== at || seen.has(link.to)) continue;
        seen.add(link.to);
        queue.push(link.to);
      }
    }
    return false;
  };
  const candidates = clarifications.filter(({ action }) => onPath.some(link => link.from === action.from_id && link.to === action.to_id)
    && reaches(partId, action.from_id) && reaches(action.to_id, targetId));
  return candidates.length === 1 ? carriedLinkAsk(candidates[0]!.action.from_id, candidates[0]!.action.to_id, candidates) : undefined;
}

/**
 * ⛔ AN OFF-SCALE LIMIT IS NOT A MISSING LEVEL (AIQ #72 5868296245; DL 5868320182). Served `pj-20260928T101026Z` A14:
 * churn HAD a level (Olumi's 3%, frame 100), and PLoT refused the ≤ 4% limit on its frame (`threshold_clamped`,
 * `CONSTRAINT_REFUSED_FRAME_FIDELITY`). The reply asked "What is Monthly churn today? … can only be checked against
 * Olumi's estimate of 3%", a today-level ask for a level that exists and a cause that was not the cause. A limit the
 * engine could not place on the scale the model holds says exactly that, and carries no today-level ask. These are the
 * scale preconditions of the per-limit reason vocabulary (`PER_LIMIT_REASON_RANK` (a), (c), (d)).
 */
export const OFF_SCALE_LIMIT_REASONS: ReadonlySet<string> = new Set(['threshold_unframed', 'threshold_clamped', 'CONSTRAINT_OUT_OF_DOMAIN']);

/**
 * R-c (AI Quality 5881541947): a limit withheld because the options move its quantity only through parts the model has
 * not sized (or combines by an identity the engine does not honour yet). A today-level cannot make it checkable, so it
 * carries no today-level ask. Nor a link-size ask yet: nothing can write the user's answer as a sized link today, and an
 * ask the model cannot act on is its own over-claim (AI Quality 5882619314; Runtime's code-read 5882633365).
 */
const PARTS_LIMIT_SENTENCES: ReadonlyMap<string, string> = new Map([
  // F1b (F5 D3 5930871304): true for a placeholder AND for Olumi's estimate written in other units — the reason fires
  // for both (`linkIsSized` reads the size IN the limit's units); "placeholders, not estimates" was false for the second.
  [PLACEHOLDER_PARTS_REASON, 'Olumi hasn’t sized the links from its parts to it in this limit’s units.'],
  [PARTS_IDENTITY_UNMODELLED_REASON, 'the model cannot yet combine its parts the way they really combine.'],
]);

/**
 * ⛔ B6's words and its ONE question, per arm (AIQ #75 5916187873 (a)): true for that trigger only, never a generic
 * "couldn't check", and never "checked against …" ((b): a verdict resting on Olumi's guess is not a check). A label the
 * graph lacks leaves the arm unsaid, never guessed.
 */
function guessWords(
  f: PlaceholderPartsFinding,
  labelOf: (id: unknown) => string | null,
  target: string | null,
  clarifications: readonly LinkEffectClarificationPending[],
): { why: string; ask: string } | null {
  if (f.arm === 'link' && f.link !== undefined) {
    const [x, y] = [labelOf(f.link.from), labelOf(f.link.to)];
    return x === null || y === null ? null
      : { why: `it depends on how strongly ${q(x)} moves ${q(y)}, which Olumi estimated.`,
        ask: carriedLinkAsk(f.link.from, f.link.to, clarifications) ?? `How much does ${q(x)} change ${q(y)}?` };
  }
  if (target === null) return null;
  if (f.arm === 'level') return { why: `it starts from Olumi’s estimate of today’s ${q(target)}.`, ask: `What is ${q(target)} today?` };
  if (f.arm === 'point') {
    return { why: `it uses a single Olumi figure for ${q(target)}.`, ask: `What’s each option’s likely range for ${q(target)}?` };
  }
  return null;
}

const andList = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * ⭐ R-c PER OPTION, SAID (AI Quality #72 5900908629). The options PLoT scored whose check of a limit was withheld: each
 * moves the limit's quantity through a part whose link Olumi has not sized. Re-read off the SAME stored graph and the same
 * predicate the run withheld them by (`placeholderPartsFinding`, per option), so the words and the numbers cannot
 * disagree. Returns their labels and one question per part: a size the user gives is written as theirs (#2274) and ends
 * the withhold. Nothing when the row is itself withheld for its parts (every option was such an option).
 */
function withheldOptionsFor(
  graph: unknown,
  targetId: string | null,
  identityEvaluated?: ReadonlySet<string>,
  clarifications: readonly LinkEffectClarificationPending[] = [],
): WithheldOptions {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const edges = (graph as { edges?: unknown } | null | undefined)?.edges;
  if (targetId === null || !Array.isArray(nodes)) return NONE_WITHHELD();
  const recs = nodes.filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object');
  const links = Array.isArray(edges) ? edges.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object') : [];
  const labelOf = (id: unknown): string | null => {
    const l = recs.find((n) => n.id === id)?.label;
    return typeof l === 'string' && l.trim() !== '' ? l.trim() : null;
  };
  const target = labelOf(targetId);
  const out = NONE_WITHHELD();
  for (const o of recs.filter((n) => n.kind === 'option')) {
    const finding = placeholderPartsFinding(targetId, recs, links, [o], limitUnitsOf((graph as { goal_constraints?: unknown } | null | undefined)?.goal_constraints),
      identityEvaluated === undefined ? undefined : [...identityEvaluated].map(node_id => ({ node_id, evaluated: true })));
    const label = labelOf(optionIdOf(o));
    if (finding === null || label === null) continue;
    out.labels.push(label);
    if (finding.reason === OLUMI_GUESS_LIMIT_REASON) {
      const words = guessWords(finding, labelOf, target, clarifications);
      if (words === null) continue;
      out.guesses.set(words.why, [...(out.guesses.get(words.why) ?? []), label]);
      out.guessAsk ??= words.ask;
      continue;
    }
    out.byReason.set(finding.reason, [...(out.byReason.get(finding.reason) ?? []), label]);
    const part = finding.reason === PLACEHOLDER_PARTS_REASON ? labelOf(finding.partId) : null;
    const ask = part !== null && target !== null
      ? carriedPartAsk(finding.partId, targetId, recs, links, clarifications) ?? `How much does ${q(part)} change ${q(target)}?` : null;
    if (ask !== null && !out.asks.includes(ask)) out.asks.push(ask);
  }
  return out;
}

interface WithheldOptions {
  labels: string[];
  byReason: Map<string, string[]>;
  asks: string[];
  /** B6: the options withheld for resting on Olumi's guess, by their arm's words (AIQ 5916187873 (a)). */
  guesses: Map<string, string[]>;
  /** B6's ONE question: the first withheld option's arm's ask. */
  guessAsk?: string;
}
const NONE_WITHHELD = (): WithheldOptions => ({ labels: [], byReason: new Map(), asks: [], guesses: new Map() });

/** {@link withheldOptionsFor} that never throws: a failure costs only the per-option words and asks, never the rows. */
function withheldOptionsOrNone(
  graph: unknown,
  targetId: string | null,
  identityEvaluated?: ReadonlySet<string>,
  clarifications: readonly LinkEffectClarificationPending[] = [],
): ReturnType<typeof withheldOptionsFor> {
  try {
    return withheldOptionsFor(graph, targetId, identityEvaluated, clarifications);
  } catch (err) {
    log.warn({ event: 'agent_lane.limit_withheld_options_failed', err: err instanceof Error ? err.message : String(err) }, 'agent-lane: the options withheld on a limit could not be read; the row goes without them');
    return NONE_WITHHELD();
  }
}

/** Why an option's own check was withheld, by the predicate's reason: an unsized link, or parts the engine cannot combine. */
const PER_OPTION_WHY: ReadonlyMap<string, readonly [one: string, many: string]> = new Map([
  [PLACEHOLDER_PARTS_REASON, ['that option moves it through a link Olumi hasn’t sized in this limit’s units.',
    'those options move it through a link Olumi hasn’t sized in this limit’s units.']],
  [PARTS_IDENTITY_UNMODELLED_REASON, ['that option moves it through parts the model cannot yet combine the way they really combine.',
    'those options move it through parts the model cannot yet combine the way they really combine.']],
]);

/** One sentence per state (and, for `estimate_only`, per whose figure it was checked against). */
function sentenceFor(label: string, state: LimitCheck['state'], reason: string | undefined): string {
  if (state === 'scored') return `${q(label)} was checked against the figures in your model.`;
  if (state === 'unscored' && reason !== undefined && OFF_SCALE_LIMIT_REASONS.has(reason)) {
    return `${q(label)} couldn’t be checked: the limit doesn’t sit on the scale the model holds for it.`;
  }
  const parts = state === 'unscored' && reason !== undefined ? PARTS_LIMIT_SENTENCES.get(reason) : undefined;
  if (parts !== undefined) return `${q(label)} cannot be checked in this model yet: ${parts}`;
  if (state === 'unscored') return `${q(label)} cannot be checked in this model yet.`;
  if (reason === 'level_user_assumption') return `${q(label)} was checked, against a figure you accepted as an assumption.`;
  // Only how it was checked. What the user can give instead is MG's ask (DL ruling 5865003207: one wording, one producer).
  return `${q(label)} was checked, but only against Olumi’s estimates, not figures you gave.`;
}

export const LIMIT_CHECKS_NOTE =
  'How each of the user’s limits was checked in this run. Say it only with its sentence here. Where its sentence says a '
  + 'limit is not shown for an option, give no chance for it, never say it is met or breached, and never say it was '
  + 'checked against anything. Only the options its sentence names were not checked on it. Where a limit has an ask, '
  + 'ask it once, in its words, after its sentence.';

/** MG's one question per limit on this graph, by `constraint_id`. A producer failure costs only the asks, never the rows. */
function asksByLimit(graph: unknown): ReadonlyMap<string, string> {
  try {
    const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
    if (!Array.isArray(nodes)) return new Map();
    return new Map(limitCheckAsks(graph as Parameters<typeof limitCheckAsks>[0])
      .filter((a) => typeof a.question === 'string' && a.question.trim() !== '')
      .map((a) => [a.constraint_id, a.question] as const));
  } catch (err) {
    log.warn({ event: 'agent_lane.limit_check_asks_failed', err: err instanceof Error ? err.message : String(err) }, 'agent-lane: the per-limit asks could not be read; the limit rows go without them');
    return new Map();
  }
}

/** The limits MG asks about on this graph (`limitCheckAsks`), by `constraint_id` — never throws (see `asksByLimit`). */
export function limitAskIdsOf(graph: unknown): ReadonlySet<string> {
  return new Set(asksByLimit(graph).keys());
}

/** `undefined` when the run carries no per-limit rows, or none can be named. */
export function limitChecksForAgent(
  graph: unknown,
  verdicts: StoredLimitVerdicts | null | undefined,
  identityEvaluated?: ReadonlySet<string>,
  clarifications: readonly LinkEffectClarificationPending[] = [],
): LimitCheck[] | undefined {
  if (verdicts === null || verdicts === undefined) return undefined;
  const limits = readRatifiedConstraints(graph);
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const nodeLabel = (id: string | null): string | null => {
    if (id === null || !Array.isArray(nodes)) return null;
    const n = nodes.find((x) => x !== null && typeof x === 'object' && (x as { id?: unknown }).id === id) as { label?: unknown } | undefined;
    return typeof n?.label === 'string' && n.label.trim() !== '' ? n.label.trim() : null;
  };
  const asks = asksByLimit(graph);
  const out: LimitCheck[] = [];
  for (const row of verdicts.per_limit) {
    const limit = limits.find((c) => c.constraint_id === row.constraint_id);
    const label = (limit?.label ?? '').trim() !== '' ? limit!.label!.trim() : nodeLabel(limit?.node_id ?? null);
    if (label === null) continue;
    // A today-level ask only where a level could make the limit checkable: never on a scored, an off-scale or a parts limit.
    const levelCannotHelp = row.state === 'unscored' && typeof row.reason === 'string'
      && (OFF_SCALE_LIMIT_REASONS.has(row.reason) || PARTS_LIMIT_SENTENCES.has(row.reason));
    const ask = row.state === 'scored' || levelCannotHelp ? undefined : asks.get(row.constraint_id);
    // R-c per option: a row the options checked, with some options' own check withheld — say which, and ask once. An
    // unscored row checked no option, so it names none (its own sentence already says it could not be checked)...
    const perOptionRow = row.state !== 'unscored' || row.reason === PLACEHOLDER_PARTS_REASON
      || row.reason === PARTS_IDENTITY_UNMODELLED_REASON || row.reason === OLUMI_GUESS_LIMIT_REASON;
    const perOption = perOptionRow ? withheldOptionsOrNone(graph, limit?.node_id ?? null, identityEvaluated, clarifications) : NONE_WITHHELD();
    // ...unless B6 withheld one of its options (AIQ 5916187873): then every option was withheld PER OPTION, for its own
    // reason, and the row says each one — never one option's reason as if it were every option's.
    if (row.state === 'unscored' && perOption.guesses.size === 0) {
      perOption.labels.length = 0;
      perOption.byReason.clear();
      perOption.asks.length = 0;
    }
    const why = [...PER_OPTION_WHY].filter(([reason]) => perOption.byReason.has(reason)).map(([reason, [one, many]]) => {
      const named = perOption.byReason.get(reason)!;
      return `For ${andList(named.map(q))} it couldn’t be checked: ${named.length === 1 ? one : many}`;
    });
    const guessed = [...perOption.guesses].map(([words, named]) => `For ${andList(named.map(q))} it isn’t shown: ${words}`);
    // B6 supersedes B5's "checked against Olumi's estimates" (AIQ 5916187873): with an option withheld for Olumi's guess,
    // the row no longer claims a check against those estimates, and Olumi's level ask (which says it would be) yields to
    // the ONE question of the first withheld option's arm.
    const b6 = perOption.guesses.size > 0;
    const rowSays = !b6 ? [sentenceFor(label, row.state, row.reason)]
      : row.state === 'unscored' ? [`${q(label)} isn’t shown for any option.`]
        : row.state === 'estimate_only' && row.reason === 'level_olumi_estimate' ? [] : [sentenceFor(label, row.state, row.reason)];
    const say = [...rowSays, ...why, ...guessed].join(' ');
    // The link-size questions are MG's ask, never the sentence's (one wording, one producer): after the level ask.
    const allAsks = [...(ask !== undefined && !b6 ? [ask] : []), ...(perOption.guessAsk !== undefined ? [perOption.guessAsk] : []), ...perOption.asks].join(' ');
    out.push({
      constraint_id: row.constraint_id, limit: label, state: row.state, say,
      ...(allAsks !== '' ? { ask: allAsks } : {}),
      ...(perOption.labels.length > 0 ? { withheld_for: perOption.labels } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}
