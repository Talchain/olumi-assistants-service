/**
 * SCI-DEEP v1 — the deterministic reply to "Test without this link". NO MODEL CALL: every sentence is rendered from the
 * typed result (`StructuralChallengeResult`), so if narration ever fails the facts still read the same.
 *
 * Copy rules (existing licences, not new ones):
 *   - a chance of reaching the target is said as how often it does so IN MODEL RUNS ("in about 53% of model runs"),
 *     never "likely", never rounded to certain (a non-exact 99.6% is "over 99%");
 *   - a leader is named only when the result carries its id (the per-Run licence decided that upstream);
 *   - no internal vocabulary reaches the user (claim kinds, bases, statuses are mapped to plain words);
 *   - the reply always says what was tested, that it is one alternative and not "the true model", and that it is not
 *     saved (NOT_RETAINED), and ends with one next step.
 */
import type { SuggestedAction } from '../../compose/types.js';
import type {
  StructuralChallengeClaim,
  StructuralChallengeQuantityClaim,
  StructuralChallengeResult,
} from '../../coaching/structural-challenge-compare.js';
import type { ChallengeLink } from '../../coaching/structural-challenge-eligibility.js';
import type { StructuralChallengeDispatchResult } from '../../handlers/structural-challenge-dispatch.js';
import { TALK_IT_THROUGH_CHIP } from './method-turn.js';

export interface StructuralChallengeReplyInput {
  readonly result: StructuralChallengeResult;
  /** Node id → the user's label (factors, goal and options are all nodes of the canonical graph). */
  readonly labels: ReadonlyMap<string, string>;
}

function chance(p: number): string {
  if (p === 1) return '100%';
  if (p === 0) return '0%';
  const r = Math.round(p * 100);
  if (r >= 100) return 'over 99%';
  if (r <= 0) return 'under 1%';
  return `about ${r}%`;
}

const amount = (x: number) => Math.round(x).toLocaleString('en-GB');

const UNSUPPORTED: Record<string, string> = {
  link_not_found: 'That link isn\'t in the model this analysis ran on, so there is nothing to test.',
  option_wiring_link: 'That link is how one of your options sets a factor, not a belief about how the world works, so removing it would change what the option means rather than test an assumption.',
  bidirected_link: 'That link marks a shared cause the model doesn\'t measure; it isn\'t part of the calculation, so removing it would change nothing.',
  identity_participant_link: 'That link is part of a definition in your model (one quantity is calculated from others), so it can\'t be tested by removing it.',
  anchored_identity_target: 'That link feeds a quantity your model calculates from a formula; removing it would change how the whole formula is scaled, so it wouldn\'t be a fair test.',
  target_becomes_root: 'Removing that link would leave its target with nothing driving it, which changes how its starting level is read — the comparison would measure that change of meaning, not the link.',
  candidate_rejected: 'Without that link the model can\'t be analysed (for example, an option no longer reaches your goal), so there is no fair comparison to show.',
};

function linkPhrase(result: StructuralChallengeResult, label: (id: string) => string): string {
  return `the link from ${label(result.alternative.from_id)} to ${label(result.alternative.to_id)}`;
}

function claimLine(c: StructuralChallengeClaim, label: (id: string) => string): string | null {
  if (c.kind === 'leader') {
    if (c.baseline_option_id === null || c.alternative_option_id === null) return null;
    // A lead that is not clear in the model runs is never stated as a lead (contract C2/C3).
    if (c.verdict !== 'holds' && c.verdict !== 'changes') return 'Which option leads is too close to call in at least one version.';
    return c.baseline_option_id === c.alternative_option_id
      ? `${label(c.baseline_option_id)} leads in both versions.`
      : `${label(c.alternative_option_id)} would lead instead of ${label(c.baseline_option_id)}.`;
  }
  const q = c as StructuralChallengeQuantityClaim;
  if (q.baseline === null || q.alternative === null) return null;
  const who = label(q.option_id);
  if (q.kind === 'goal_probability') {
    return `${who} reaches your target in ${chance(q.baseline)} of model runs now, and in ${chance(q.alternative)} without the link.`;
  }
  if (q.kind === 'outcome_level') {
    const side = q.target === null ? '' : ` (your target is ${amount(q.target)})`;
    return `${who}'s expected result is ${amount(q.baseline)} now and ${amount(q.alternative)} without the link${side}.`;
  }
  return `${who} stays within the limit in ${chance(q.baseline)} of model runs now, and in ${chance(q.alternative)} without the link.`;
}

export function composeStructuralChallengeReply(input: StructuralChallengeReplyInput): string {
  const { result } = input;
  const label = (id: string) => input.labels.get(id) ?? id;
  const link = linkPhrase(result, label);

  if (result.status !== 'completed') {
    switch (result.status) {
      case 'unsupported':
        return `I can't test ${link}. ${UNSUPPORTED[result.reason ?? ''] ?? 'It isn\'t a link this test can remove fairly.'} Nothing in your model changed.`;
      case 'stale':
        return 'Your model has changed since this analysis ran, so I can\'t test it against that run. Run the analysis again, then try this test.';
      case 'timed_out':
        return `The test of ${link} took too long to finish, so there is no result. Nothing in your model changed; you can try again.`;
      case 'withheld':
        return 'This analysis isn\'t currently permitted to explore alternatives, so I haven\'t run the test. Nothing in your model changed.';
      case 'failed':
        if (result.reason === 'baseline_payload_mismatch' || result.reason === 'probe_unavailable') {
          return 'I couldn\'t line this test up exactly with the analysis you ran, so there\'s no fair comparison to show. Run the analysis again, then try this test. Nothing in your model changed.';
        }
        return `I couldn't complete the test of ${link}, so there is no result. Nothing in your model changed.`;
      default:
        return `I couldn't complete the test of ${link}, so there is no result. Nothing in your model changed.`;
    }
  }

  const changes = result.claims.filter((c) => c.verdict === 'changes');
  const held = result.claims.filter((c) => c.verdict === 'holds' && !c.invariant_by_construction);
  const unaffected = result.claims.filter((c) => c.invariant_by_construction);
  const open = result.claims.filter((c) => c.verdict === 'delta_only' || c.verdict === 'not_comparable');
  const leader = result.claims.find((c) => c.kind === 'leader');
  const named = leader?.kind === 'leader' && leader.baseline_option_id !== null ? leader.baseline_option_id : null;

  let headline: string;
  if (leader?.verdict === 'changes' && leader.kind === 'leader' && leader.alternative_option_id !== null && named !== null) {
    headline = `Without ${link}, ${label(leader.alternative_option_id)} would lead instead of ${label(named)}.`;
  } else if (changes.length > 0 && named !== null && leader?.verdict === 'holds') {
    headline = `Without ${link}, ${label(named)} still leads — but what you can expect from it changes.`;
  } else if (changes.length > 0) {
    headline = `Without ${link}, part of the result changes.`;
  } else if (open.length === 0) {
    headline = `Without ${link}, the conclusions I tested still hold.`;
  } else {
    headline = `Without ${link}, nothing changes clearly enough to call, though some figures move.`;
  }

  const lines: string[] = [headline, ''];
  lines.push('What I tested: the same model and inputs, recomputed with only this link removed. It shows what depends on this link; it doesn\'t say which version of the model is right.');
  const bullet = (cs: readonly StructuralChallengeClaim[]) => cs.map((c) => claimLine(c, label)).filter((l): l is string => l !== null).map((l) => `- ${l}`);
  if (changes.length > 0) lines.push('', 'What changes:', ...bullet(changes));
  if (held.length > 0) lines.push('', 'What holds:', ...bullet(held));
  const uncertain = bullet(open);
  if (unaffected.length > 0) {
    uncertain.push('- Some results can\'t be affected by this link at all, so their holding isn\'t evidence either way.');
  }
  uncertain.push('- Driver rankings and other diagnostic scores aren\'t compared between the two versions, because they shift with how the model is scaled.');
  uncertain.push('- All of Olumi\'s other estimates were kept as they are; this is one alternative, not the only one.');
  uncertain.push('- This test isn\'t saved. You can run it again while the model stays as it is.');
  lines.push('', 'What remains uncertain:', ...uncertain);

  const from = label(result.alternative.from_id);
  const to = label(result.alternative.to_id);
  lines.push('', changes.length > 0
    ? `Next step: this conclusion rests on how ${from} affects ${to}. What evidence do you have for that link? If you decide it doesn't belong, you can remove it on the canvas and rerun — the comparison is then saved.`
    : `Next step: your conclusion doesn't depend on this link, so there's no need to change it.`);
  return lines.join('\n');
}

// ── The press and the route adapter (the Executor's hot-seam hunk calls only these) ─────────────────────────────────

/**
 * The press id the existing Challenge surface sends for "Test without this link" on one link. Typed ids, never labels:
 * `agent-test-without-link:<from_id>::<to_id>` (node ids cannot contain `::`).
 */
export const STRUCTURAL_CHALLENGE_PRESS_PREFIX = 'agent-test-without-link:';

export function structuralChallengePressId(link: ChallengeLink): string {
  return `${STRUCTURAL_CHALLENGE_PRESS_PREFIX}${link.from_id}::${link.to_id}`;
}

export function parseStructuralChallengePress(chipId: unknown): ChallengeLink | null {
  if (typeof chipId !== 'string' || !chipId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)) return null;
  const parts = chipId.slice(STRUCTURAL_CHALLENGE_PRESS_PREFIX.length).split('::');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) return null;
  return { from_id: parts[0], to_id: parts[1] };
}

export interface StructuralChallengeTurn {
  readonly reply: string;
  readonly outcome: StructuralChallengeResult['status'] | 'no_run';
  readonly result: StructuralChallengeResult | null;
  readonly labels: ReadonlyMap<string, string>;
  readonly actions: readonly SuggestedAction[];
}

/**
 * The reply under the turn's FINAL leader licence. The dispatch ran under the press-time read's licence; the route
 * composes this turn's retained goal-scope issues into the final read (#2545) and passes that read's permission here.
 * A licence that now withholds the leader is applied exactly as the comparator applies it
 * (`mayPresentComparedRunLeader` with false: both ids withheld), and the reply is re-rendered. A licence never names a
 * leader the dispatch withheld — this only ever narrows.
 */
export function structuralChallengeTurnUnderLicence(turn: StructuralChallengeTurn, leaderMayBeNamed: boolean): StructuralChallengeTurn {
  if (leaderMayBeNamed || turn.result === null || turn.result.status !== 'completed') return turn;
  const result: StructuralChallengeResult = {
    ...turn.result,
    claims: turn.result.claims.map((c) => (c.kind === 'leader'
      ? { kind: 'leader', baseline_option_id: null, alternative_option_id: null, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false }
      : c)),
  };
  return { ...turn, result, reply: composeStructuralChallengeReply({ result, labels: turn.labels }) };
}

export const STRUCTURAL_CHALLENGE_NO_RUN_REPLY =
  'There is no analysis to test yet. Run the analysis first, then try "Test without this link".';

/**
 * A recognised press → one dispatch → the deterministic reply. Null for any other press (the turn proceeds as usual).
 * The caller supplies the dispatch bound to the turn's existing permissions; nothing here reads or writes state.
 */
export async function structuralChallengeTurnFor(
  chipId: unknown,
  ask: (link: ChallengeLink) => Promise<StructuralChallengeDispatchResult>,
): Promise<StructuralChallengeTurn | null> {
  const link = parseStructuralChallengePress(chipId);
  if (link === null) return null;
  const actions = [TALK_IT_THROUGH_CHIP];
  const dispatched = await ask(link);
  if (dispatched.kind === 'no_run') return { reply: STRUCTURAL_CHALLENGE_NO_RUN_REPLY, outcome: 'no_run', result: null, labels: new Map(), actions };
  return {
    reply: composeStructuralChallengeReply({ result: dispatched.result, labels: dispatched.labels }),
    outcome: dispatched.result.status,
    result: dispatched.result,
    labels: dispatched.labels,
    actions,
  };
}
