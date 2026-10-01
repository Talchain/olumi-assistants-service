/**
 * ⭐ F1b B6: ONE LIST OF WHAT STOPS A FIGURE, ONE ACTION EACH (RCA D5; lease #85 5932805160).
 *
 * WHY. Paul's 1 Oct test (`96c6f5f4`): "can you fix them all?" got link sizing only, and six Runs in a row gave no
 * leader and no goal chance while the next blocker surfaced one Run at a time. Every blocker WAS in the Run tool's
 * answer, but in four places with four shapes: the readiness demands, the target sentence, the per-limit asks and the
 * placeholder warning's `acceptable_links`. Three of them minted "What is X today?" for the same node.
 *
 * THE LIST. Read off the stored graph after the Run plus this Run's own limit rows and warnings. Pure: no read, no
 * write. Each item names ONE action:
 *   · B-1: one `next_action` per subject. Asks for the same node merge into one item, and the first source's words
 *     win (readiness, then target, then limit).
 *   · B-2: `can_change_result: false` carries no `ask`. Nothing is offered as a remedy that cannot change the result
 *     (an unscored limit no figure can fix, e.g. one off its node's scale).
 * The sources are NOT reworded: every `ask` is its producer's own sentence, so this list never says something a
 * producer did not.
 *
 * SCOPE (slice 1; claims nothing beyond these four sources): readiness demands (`assessRouteAdmission`, the demand rule
 * `readinessViewOf` uses), target testability (`targetTestabilityOf`), this Run's limit rows (`limitChecksForAgent`)
 * and the placeholder links a user can accept (`acceptable_links`, #2448).
 */
import { assessRouteAdmission } from '../../cee/graph-readiness/canonical-readiness.js';
import { targetTestabilityOf, notTargetTestableSentence } from '../admission/target-testability.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../orchestrator/context/option-result-source.js';
import { limitCheckAsks } from './limited-level-ask.js';
import type { LimitCheck } from './limit-checks.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What an item stops (contract §2 claim classes, plus `run` and `option` for a readiness demand). */
export type BlockedClaim = 'run' | 'option' | 'goal_probability' | 'joint_probability' | 'outcome' | 'win_share' | 'leader' | 'limit_probability';
export type NextActionKind = 'give_level' | 'give_option_value' | 'size_link' | 'restate_target' | 'answer' | 'none';

export interface ResultBlocker {
  /** Stable within one Run: `<kind>:<subject ids>`. */
  readonly id: string;
  /** The source: a readiness issue code, `TARGET_<precondition>`, `LIMIT_<state>`, or `LINK_UNSIZED`. */
  readonly code: string;
  /** Every source merged into this item (B-1 merges per subject; no blocker is lost): `code` first. */
  readonly sources: readonly string[];
  readonly subject_ids: readonly string[];
  readonly blocks: readonly BlockedClaim[];
  readonly next_action: {
    readonly kind: NextActionKind;
    /** The producer's own question, verbatim. Absent when `can_change_result` is false (B-2). */
    readonly ask?: string;
    readonly can_change_result: boolean;
  };
}

export interface ResultBlockersInput {
  /** The model as stored after the Run. */
  readonly graph: unknown;
  /** This Run's per-limit rows (`limitChecksForAgent`), when the Run made them. */
  readonly limitChecks?: readonly LimitCheck[];
  /** This Run's `inference_warnings`. */
  readonly warnings?: readonly unknown[];
}

/** The note the Agent reads beside the list (HARNESS owns the prompt seam; this is the list's own contract). */
export const TO_RESOLVE_NOTE =
  'Everything in this model that is stopping a figure in this Run, one item per thing to resolve, in order. When the user '
  + 'asks what is needed, or asks you to fix them all, go through EVERY item in one reply, asking each item’s `ask` as '
  + 'written. An item with `can_change_result: false` has no answer that would change the result: say so, and never '
  + 'suggest a fix for it.';

const CODE_LIKE = /^[A-Z][A-Z0-9_]+$/;
const BLOCKS_LINK: readonly BlockedClaim[] = ['goal_probability', 'joint_probability', 'outcome', 'win_share', 'leader'];
const BLOCKS_TARGET: readonly BlockedClaim[] = ['goal_probability', 'joint_probability'];
const BLOCKS_LIMIT: readonly BlockedClaim[] = ['limit_probability', 'joint_probability'];

export function resultBlockersOf(input: ResultBlockersInput): ResultBlocker[] {
  const graph = input.graph;
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const labelOf = new Map<string, string>();
  for (const n of (graph.nodes as unknown[]).filter(isRec)) {
    if (typeof n.id === 'string') labelOf.set(n.id, typeof n.label === 'string' && n.label.trim() !== '' ? n.label.trim() : n.id);
  }

  const out: ResultBlocker[] = [];
  const byKey = new Map<string, number>();
  /** B-1: one item per (kind, subject). A later source for the same subject adds what it blocks, never a second ask. */
  const add = (fresh: Omit<ResultBlocker, 'sources'>): void => {
    const item: ResultBlocker = { ...fresh, sources: [fresh.code] };
    const key = `${item.next_action.kind}:${item.subject_ids.join('|')}`;
    const at = byKey.get(key);
    if (at === undefined) { byKey.set(key, out.length); out.push(item); return; }
    const prior = out[at]!;
    out[at] = { ...prior, sources: [...new Set([...prior.sources, item.code])], blocks: [...new Set([...prior.blocks, ...item.blocks])] };
  };

  // 1 · Readiness demands: what the user must give before (part of) the model can run.
  try {
    const verdict = assessRouteAdmission(graph);
    if (verdict.may_run !== 'unknown') {
      for (const issue of verdict.readiness_issues as unknown as Rec[]) {
        const message = typeof issue.message === 'string' ? issue.message.trim() : '';
        const isDemand = issue.repairability === 'human_input_required' && issue.obligation !== 'offered' && issue.waived_by_exclusion !== true;
        if (!isDemand || message === '' || CODE_LIKE.test(message)) continue;
        const code = typeof issue.code === 'string' ? issue.code : 'READINESS';
        const factor = typeof issue.factor_id === 'string' ? issue.factor_id : undefined;
        const option = typeof issue.option_id === 'string' ? issue.option_id : undefined;
        const kind: NextActionKind = code === 'MISSING_FACTOR_LEVEL' && factor !== undefined ? 'give_level'
          : code === 'MISSING_OPTION_VALUE' && option !== undefined ? 'give_option_value' : 'answer';
        const subject = kind === 'give_level' ? [factor!] : [option, factor].filter((x): x is string => x !== undefined);
        add({
          id: `${kind}:${subject.join('|') || code}`, code, subject_ids: subject.length > 0 ? subject : [code],
          blocks: [option !== undefined ? 'option' : 'run'],
          next_action: { kind, ask: message, can_change_result: true },
        });
      }
    }
  } catch { /* an unreadable verdict adds nothing; the other sources still speak */ }

  // 2 · The links a user can accept at Olumi's starting strength (#2448 `acceptable_links`), one item per link.
  const links: { from: string; to: string }[] = [];
  for (const w of input.warnings ?? []) {
    if (!isRec(w) || w.code !== GOAL_FIGURES_PLACEHOLDER_PATH || !Array.isArray(w.acceptable_links)) continue;
    for (const l of w.acceptable_links) {
      if (isRec(l) && typeof l.from === 'string' && typeof l.to === 'string' && !links.some((x) => x.from === l.from && x.to === l.to)) {
        links.push({ from: l.from, to: l.to });
      }
    }
  }

  // 3 · The goal's target, when the Run can't test it. A P5-only verdict IS the unsized links, so when the links are
  // listed it adds no second item.
  const target = targetTestabilityOf(graph);
  if (target.kind === 'not_testable' && target.failures.length > 0) {
    const sentence = notTargetTestableSentence(graph, target);
    const onlyLinks = target.failures.every((f) => f.precondition === 'P5') && links.length > 0;
    if (sentence !== null && !onlyLinks) {
      const first = target.failures.find((f) => f.precondition !== 'P5') ?? target.failures[0]!;
      const kind: NextActionKind = first.case === 'a' || first.case === 'd' ? 'give_level' : first.case === 'b' ? 'restate_target' : 'size_link';
      add({
        id: `${kind}:${target.goal_id}`, code: `TARGET_${first.precondition}`, subject_ids: [target.goal_id], blocks: BLOCKS_TARGET,
        next_action: { kind, ask: sentence, can_change_result: true },
      });
    }
  }

  for (const l of links) {
    const ask = `Accept Olumi’s starting strength for how “${labelOf.get(l.from) ?? l.from}” moves “${labelOf.get(l.to) ?? l.to}”, or give your own figure.`;
    add({
      id: `size_link:${l.from}|${l.to}`, code: 'LINK_UNSIZED', subject_ids: [l.from, l.to], blocks: BLOCKS_LINK,
      next_action: { kind: 'size_link', ask, can_change_result: true },
    });
  }

  // 4 · The user's limits this Run could not check against their own figures.
  if (input.limitChecks !== undefined && input.limitChecks.length > 0) {
    let askOfLimit = new Map<string, { node_id: string; kind: string }>();
    try {
      askOfLimit = new Map(limitCheckAsks(graph as Parameters<typeof limitCheckAsks>[0]).map((a) => [a.constraint_id, { node_id: a.node_id, kind: a.kind }] as const));
    } catch { /* without node ids each limit is its own subject */ }
    for (const row of input.limitChecks) {
      if (row.state === 'scored') continue;
      const ask = typeof row.ask === 'string' && row.ask.trim() !== '' ? row.ask.trim() : undefined;
      if (ask !== undefined) {
        const source = askOfLimit.get(row.constraint_id);
        const subject = source !== undefined ? [source.node_id] : [row.constraint_id];
        // MG's two ask producers: today's level of the limited quantity, or each option's range for it.
        const kind: NextActionKind = source === undefined || source.kind === 'limited_quantity_level' ? 'give_level' : 'give_option_value';
        add({
          id: `${kind}:${subject[0]}`, code: `LIMIT_${row.state}`, subject_ids: subject, blocks: BLOCKS_LIMIT,
          next_action: { kind, ask, can_change_result: true },
        });
      } else if (row.state === 'unscored') {
        // B-2: no figure the user can give changes this limit's check; it is listed, with no remedy.
        add({
          id: `none:${row.constraint_id}`, code: 'LIMIT_unscored', subject_ids: [row.constraint_id], blocks: BLOCKS_LIMIT,
          next_action: { kind: 'none', can_change_result: false },
        });
      }
    }
  }
  return out;
}
