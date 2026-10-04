/**
 * SCI-DEEP v1 — the deterministic reply to "Test without this link". NO MODEL CALL: every sentence is rendered from the
 * typed result (`StructuralChallengeResultV1`), so if narration ever fails the facts still read the same.
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
  StructuralChallengeClaimV1,
  StructuralChallengeQuantityClaimV1,
  StructuralChallengeResultV1,
} from '@talchain/schemas';
import type { ChallengeLink } from '../../coaching/structural-challenge-eligibility.js';
import type { StructuralChallengeDispatchResult } from '../../handlers/structural-challenge-dispatch.js';
import type { StructuralChallengeCertainty } from '../../coaching/structural-challenge-compare.js';
import { StructuralChallengeAlternativeV1Schema } from '@talchain/schemas';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import { TALK_IT_THROUGH_CHIP } from './method-turn.js';

export interface StructuralChallengeReplyInput {
  readonly result: StructuralChallengeResultV1;
  /** Node id → the user's label (factors, goal and options are all nodes of the canonical graph). */
  readonly labels: ReadonlyMap<string, string>;
  readonly certainty?: StructuralChallengeCertainty;
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

function linkPhrase(result: StructuralChallengeResultV1, label: (id: string) => string): string {
  return `the link from ${label(result.alternative.from_id)} to ${label(result.alternative.to_id)}`;
}

const BASIS_WORDS: Partial<Record<StructuralChallengeClaimV1['basis'], string>> = {
  within_noise: 'The difference is within sampling noise.',
  not_noise_qualified: 'The recorded evidence cannot qualify this comparison against sampling noise.',
  no_licensed_boundary: 'The figures can be compared, but no supported conclusion boundary is available.',
  frame_changed: 'The measurement frame changed between the runs.',
  unit_changed: 'The measurement unit changed between the runs.',
  identity_status_changed: 'The runs did not evaluate the same definitions.',
  ranking_status_changed: 'The runs did not record the same comparison status.',
  withheld_on_one_side: 'At least one run withheld this claim.',
  missing_on_one_side: 'At least one run did not record this claim.',
};

function goalSide(value: number | null, optionId: string, decisions: StructuralChallengeCertainty['baseline']): string {
  const matches = decisions?.filter((d) => d.option_id === optionId);
  // The existing certainty reader also speaks its stored sentence beside a withheld figure, without restoring it.
  if (value === null) return matches?.length === 1 && matches[0].earned === false && matches[0].say
    ? matches[0].say : 'The target frequency was unavailable.';
  if (value !== 0 && value !== 1) return `Reaches the target in ${chance(value)} of model runs.`;
  const decision = matches?.length === 1 && matches[0].probability_of_goal === value ? matches[0] : undefined;
  if (decision?.earned === true) return `Reaches the target in ${chance(value)} of model runs.`;
  // Follow the Run's stored unearned sentence verbatim, just as the existing Agent certainty reader does.
  return decision?.earned === false && decision.say
    ? decision.say : 'This is what this model gives, not a certainty; whether that certainty is earned could not be checked.';
}

function claimLine(c: StructuralChallengeClaimV1, label: (id: string) => string, certainty?: StructuralChallengeCertainty): string {
  const reason = BASIS_WORDS[c.basis] ?? '';
  if (c.kind === 'leader') {
    if (c.baseline_option_id === null || c.alternative_option_id === null) return `Which option leads cannot be compared. ${reason}`;
    // A lead that is not clear in the model runs is never stated as a lead (contract C2/C3).
    if (c.verdict !== 'holds' && c.verdict !== 'changes') return c.basis === 'within_noise'
      ? 'Which option leads is too close to call in at least one version.' : `Which option leads cannot be compared reliably. ${reason}`;
    return c.baseline_option_id === c.alternative_option_id
      ? `${label(c.baseline_option_id)} leads in both versions.`
      : `${label(c.alternative_option_id)} would lead instead of ${label(c.baseline_option_id)}.`;
  }
  const q = c as StructuralChallengeQuantityClaimV1;
  const who = label(q.option_id);
  if (q.kind === 'goal_probability') {
    return `${who} — baseline: ${goalSide(q.baseline, q.option_id, certainty?.baseline)} Without the link: ${goalSide(q.alternative, q.option_id, certainty?.alternative)}${reason ? ` ${reason}` : ''}`;
  }
  const value = (v: number | null, probability: boolean) => v === null ? 'unavailable' : probability
    ? v === 1 ? 'all sampled model runs' : v === 0 ? 'none of the sampled model runs' : `${chance(v)} of model runs` : amount(v);
  if (q.kind === 'outcome_level') {
    const side = q.target === null ? '' : ` (your target is ${amount(q.target)})`;
    return `${who}'s expected result is ${value(q.baseline, false)} now and ${value(q.alternative, false)} without the link${side}.${reason ? ` ${reason}` : ''}`;
  }
  return `${who} — limit ${label(q.constraint_id ?? '')}: within the limit in ${value(q.baseline, true)} now, and in ${value(q.alternative, true)} without the link.${reason ? ` ${reason}` : ''}`;
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
        if (result.reason === 'candidate_unparseable') {
          return `The test's recorded evidence couldn't be read, so there is no fair comparison for ${link}. Nothing in your model changed; run the analysis again before retrying.`;
        }
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
    headline = `Without ${link}, ${label(named)} still leads — but part of the result changes.`;
  } else if (changes.length > 0) {
    headline = `Without ${link}, part of the result changes.`;
  } else if (open.length === 0 && held.length > 0) {
    headline = `Without ${link}, the conclusions I tested still hold.`;
  } else {
    headline = `Without ${link}, the recorded evidence doesn't establish that the tested conclusions hold or change.`;
  }

  const lines: string[] = [headline, ''];
  lines.push('What I tested: the same model and inputs, recomputed with only this link removed. It compares these two model versions; it doesn\'t say which version of the model is right.');
  const bullet = (cs: readonly StructuralChallengeClaimV1[]) => cs.map((c) => `- ${claimLine(c, label, input.certainty)}`);
  if (changes.length > 0) lines.push('', 'What changes:', ...bullet(changes));
  if (held.length > 0) lines.push('', 'What holds:', ...bullet(held));
  const uncertain = bullet(open);
  if (unaffected.length > 0) {
    uncertain.push(...bullet(unaffected));
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
    : open.length === 0 && held.length > 0
      ? `Next step: the tested conclusions held in these two model versions. Review the evidence for how ${from} affects ${to} before deciding whether to keep the link.`
      : `Next step: resolve the missing or unqualified evidence before drawing a conclusion about how ${from} affects ${to}.`);
  return lines.join('\n');
}

// ── The press and the route adapter (the Executor's hot-seam hunk calls only these) ─────────────────────────────────

/**
 * The press id the existing Challenge surface sends for "Test without this link" on one link. Typed ids, never labels:
 * A JSON tuple encodes both endpoints without reserving any characters in canonical node ids.
 */
export const STRUCTURAL_CHALLENGE_PRESS_PREFIX = 'agent-test-without-link:';

export function structuralChallengePressId(link: ChallengeLink): string {
  return `${STRUCTURAL_CHALLENGE_PRESS_PREFIX}${JSON.stringify([link.from_id, link.to_id])}`;
}

export function parseStructuralChallengePress(chipId: unknown): ChallengeLink | null {
  if (typeof chipId !== 'string' || !chipId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)) return null;
  let parts: unknown;
  try { parts = JSON.parse(chipId.slice(STRUCTURAL_CHALLENGE_PRESS_PREFIX.length)); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 2) return null;
  if (!parts.every((id) => NodeV3.shape.id.safeParse(id).success)) return null;
  const parsed = StructuralChallengeAlternativeV1Schema.safeParse({ op: 'remove_link', from_id: parts[0], to_id: parts[1], origin: 'user_selected', sizing: 'unmarked' });
  return parsed.success ? { from_id: parsed.data.from_id, to_id: parsed.data.to_id } : null;
}

export interface StructuralChallengeTurn {
  readonly reply: string;
  readonly outcome: StructuralChallengeResultV1['status'] | 'no_run';
  readonly result: StructuralChallengeResultV1 | null;
  readonly labels: ReadonlyMap<string, string>;
  readonly actions: readonly SuggestedAction[];
  readonly certainty?: StructuralChallengeCertainty;
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
  const result: StructuralChallengeResultV1 = {
    ...turn.result,
    claims: turn.result.claims.map((c) => (c.kind === 'leader'
      ? { kind: 'leader', baseline_option_id: null, alternative_option_id: null, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false }
      : c)),
  };
  return { ...turn, result, reply: composeStructuralChallengeReply({ result, labels: turn.labels, certainty: turn.certainty }) };
}

export const STRUCTURAL_CHALLENGE_NO_RUN_REPLY =
  'There is no analysis to test yet. Run the analysis first, then try "Test without this link".';

/**
 * A valid press → one dispatch → the deterministic reply. A malformed press for this method refuses before dispatch;
 * null is reserved for another method's press (the turn proceeds as usual).
 * The caller supplies the dispatch bound to the turn's existing permissions; nothing here reads or writes state.
 */
export async function structuralChallengeTurnFor(
  chipId: unknown,
  ask: (link: ChallengeLink) => Promise<StructuralChallengeDispatchResult>,
): Promise<StructuralChallengeTurn | null> {
  const link = parseStructuralChallengePress(chipId);
  const actions = [TALK_IT_THROUGH_CHIP];
  if (link === null) return typeof chipId === 'string' && chipId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)
    ? { reply: 'This test needs a link between two distinct nodes with valid recorded identities. Nothing in your model changed.', outcome: 'unsupported', result: null, labels: new Map(), actions }
    : null;
  const dispatched = await ask(link);
  if (dispatched.kind === 'no_run') return { reply: STRUCTURAL_CHALLENGE_NO_RUN_REPLY, outcome: 'no_run', result: null, labels: new Map(), actions };
  return {
    reply: composeStructuralChallengeReply({ result: dispatched.result, labels: dispatched.labels, certainty: dispatched.certainty }),
    outcome: dispatched.result.status,
    result: dispatched.result,
    labels: dispatched.labels,
    certainty: dispatched.certainty,
    actions,
  };
}
