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
  PARTS_IDENTITY_UNMODELLED_REASON,
  PLACEHOLDER_PARTS_REASON,
  optionIdOf,
  placeholderPartsFinding,
} from '../../orchestrator/context/placeholder-parts.js';
import { log } from '../../utils/telemetry.js';
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
  [PLACEHOLDER_PARTS_REASON, 'Olumi’s links from its parts to it are placeholders, not estimates.'],
  [PARTS_IDENTITY_UNMODELLED_REASON, 'the model cannot yet combine its parts the way they really combine.'],
]);

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
): { labels: string[]; byReason: Map<string, string[]>; asks: string[] } {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const edges = (graph as { edges?: unknown } | null | undefined)?.edges;
  if (targetId === null || !Array.isArray(nodes)) return { labels: [], byReason: new Map(), asks: [] };
  const recs = nodes.filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object');
  const links = Array.isArray(edges) ? edges.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object') : [];
  const labelOf = (id: unknown): string | null => {
    const l = recs.find((n) => n.id === id)?.label;
    return typeof l === 'string' && l.trim() !== '' ? l.trim() : null;
  };
  const target = labelOf(targetId);
  const labels: string[] = [];
  const byReason = new Map<string, string[]>();
  const asks: string[] = [];
  for (const o of recs.filter((n) => n.kind === 'option')) {
    const finding = placeholderPartsFinding(targetId, recs, links, [o]);
    const label = labelOf(optionIdOf(o));
    if (finding === null || label === null) continue;
    labels.push(label);
    byReason.set(finding.reason, [...(byReason.get(finding.reason) ?? []), label]);
    const part = finding.reason === PLACEHOLDER_PARTS_REASON ? labelOf(finding.partId) : null;
    const ask = part !== null && target !== null ? `How much does ${q(part)} change ${q(target)}?` : null;
    if (ask !== null && !asks.includes(ask)) asks.push(ask);
  }
  return { labels, byReason, asks };
}

/** Why an option's own check was withheld, by the predicate's reason: an unsized link, or parts the engine cannot combine. */
const PER_OPTION_WHY: ReadonlyMap<string, readonly [one: string, many: string]> = new Map([
  [PLACEHOLDER_PARTS_REASON, ['that option moves it through a link Olumi has not sized (a placeholder, not an estimate).',
    'those options move it through a link Olumi has not sized (a placeholder, not an estimate).']],
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
  'How each of the user’s limits was checked in this run. Say it only with its sentence here. A limit checked against '
  + 'Olumi’s estimates WAS checked: never call it not checkable or unchecked, and never ask for a way to make it checkable. '
  + 'Only a limit whose state is unscored cannot be checked yet, and only the options its sentence names could not be '
  + 'checked on it. Where a limit has an ask, ask it once, in its words, after its sentence.';

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
export function limitChecksForAgent(graph: unknown, verdicts: StoredLimitVerdicts | null | undefined): LimitCheck[] | undefined {
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
    // unscored row checked no option, so it names none (its own sentence already says it could not be checked).
    const perOption = row.state === 'unscored'
      ? { labels: [], byReason: new Map<string, string[]>(), asks: [] }
      : withheldOptionsFor(graph, limit?.node_id ?? null);
    const why = [...PER_OPTION_WHY].filter(([reason]) => perOption.byReason.has(reason)).map(([reason, [one, many]]) => {
      const named = perOption.byReason.get(reason)!;
      return `For ${andList(named.map(q))} it couldn’t be checked: ${named.length === 1 ? one : many}`;
    });
    const say = [sentenceFor(label, row.state, row.reason), ...why].join(' ');
    // The link-size questions are MG's ask, never the sentence's (one wording, one producer): after the level ask.
    const allAsks = [...(ask !== undefined ? [ask] : []), ...perOption.asks].join(' ');
    out.push({
      constraint_id: row.constraint_id, limit: label, state: row.state, say,
      ...(allAsks !== '' ? { ask: allAsks } : {}),
      ...(perOption.labels.length > 0 ? { withheld_for: perOption.labels } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}
