/**
 * SCI-DEEP v1 — the deterministic reply to "Test without this link". NO MODEL CALL: every sentence is rendered from the
 * typed result (`StructuralChallengeResultV1`), so if narration ever fails the facts still read the same.
 *
 * Copy rules (existing licences, not new ones):
 *   - goal chances use the bound Run's shared screen/Agent display and goal-chance headline;
 *     an exact 0/1 still needs its stored earned decision; unearned/withheld sentences stay verbatim;
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
import { structuralChallengePresentationPermission, type StructuralChallengeFinalRead, type StructuralChallengeDispatchResult } from '../../handlers/structural-challenge-dispatch.js';
import type { StructuralChallengeCertainty } from '../../coaching/structural-challenge-compare.js';
import { StructuralChallengeAlternativeV1Schema } from '@talchain/schemas';
import type { SelectedRunIdentity } from '../../coaching/build-run-delta.js';
import type { LeaderLicence } from '../../compose/leader-licence.js';
import type { ClaimPermissions } from '../first-analysis.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import { TALK_IT_THROUGH_CHIP } from './method-turn.js';

export interface StructuralChallengeReplyInput {
  readonly result: StructuralChallengeResultV1;
  /** Node id → the user's label (factors, goal and options are all nodes of the canonical graph). */
  readonly labels: ReadonlyMap<string, string>;
  readonly certainty?: StructuralChallengeCertainty;
  readonly leaderLicence?: LeaderLicence;
  readonly claimPermissions?: ClaimPermissions;
  /** Every arm of the version without the link came out identical (its RESULT), while the baseline's did not. */
  readonly identicalArms?: boolean;
  /** Otherwise, groups of arms that came out identical without the link: no leader is compared for that version. */
  readonly identicalGroups?: readonly (readonly string[])[];
  /** The baseline leader's identical companions without the link (distinct in the baseline). */
  readonly leaderSameAs?: readonly string[];
}

function chance(p: number): string {
  if (p === 1) return '100%';
  if (p === 0) return '0%';
  const r = Math.round(p * 100);
  if (r >= 100) return 'over 99%';
  if (r <= 0) return 'under 1%';
  return `about ${r}%`;
}

/**
 * ⛔ NO UNITLESS AMOUNTS (DL beat-4 audit, 5 Oct). An outcome level is in the ENCODED model scale (0.0213), not the
 * goal's authored unit, and the claim carries no unit to say it in. So the line says the DIRECTION (ordering survives
 * the encoding) and the target relation the claim's own side test proves; it never prints the number.
 */
function outcomeLevelLine(who: string, q: StructuralChallengeQuantityClaimV1, reason: string): string {
  const b = q.baseline, a = q.alternative;
  // These bases' sentences are carried by the line's own words below (or refer to figures it no longer prints).
  const tail = reason && q.basis !== 'no_licensed_boundary' && q.basis !== 'within_noise' && q.basis !== 'not_noise_qualified'
    ? ` ${reason}` : '';
  if (b === null || a === null) {
    const where = b === null && a === null ? 'in both versions' : b === null ? 'in the baseline' : 'without the link';
    return `${who}'s expected result is unavailable ${where}.${tail}`;
  }
  // A not-comparable claim asserts no direction: its own reason (definitions, frame, unit…) says why (Codex #2582 P1).
  if (q.verdict === 'not_comparable') return `${who}'s expected result can't be compared between the two versions.${tail}`;
  // Construction-invariant: any difference between the two values is sampling, not this link (Codex #2582 r2 P2).
  if (q.invariant_by_construction) return `${who}'s expected result can't be affected by this link.${tail}`;
  // Direction only where the noise check supports it (Codex #2582 r3 P2).
  const core = a === b ? 'is the same without the link'
    : q.noise_verdict === 'within_noise' ? 'is about the same without the link (the difference is within sampling noise)'
      : q.noise_verdict === 'not_noise_qualified'
        ? `is ${a > b ? 'higher' : 'lower'} without the link (a difference that couldn't be checked against sampling noise)`
        : `is ${a > b ? 'higher' : 'lower'} without the link`;
  // Target words only on the bases whose strict side test (contract C5) licenses them.
  const t = q.target;
  if (t === null || (q.basis !== 'target_crossed' && q.basis !== 'same_side_of_target')) return `${who}'s expected result ${core}.${tail}`;
  const side = (v: number) => (v > t ? 'above' : v < t ? 'below' : 'at');
  const target = side(b) === side(a) ? `, and stays ${side(b)} your target` : `, and moves from ${side(b)} your target to ${side(a)} it`;
  return `${who}'s expected result ${core}${target}.${tail}`;
}
const TARGET_FREQUENCY_UNAVAILABLE = 'The target frequency was unavailable.';

/** The reply's fixed lines that SCI-10's card may show, named once so the chat and the typed rows share their bytes. */
export const STRUCTURAL_CHALLENGE_LINES = {
  provisional: 'The figures are provisional estimates from these two model versions.',
  tested: 'What I tested: the same model and inputs, recomputed with only this link removed. The two Runs are separately sampled (unpaired). It compares these two model versions; it doesn\'t say which version of the model is right.',
  not_saved: 'This test isn\'t saved. You can run it again while the model stays as it is.',
} as const;

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
  missing_on_one_side: 'At least one model version has no usable measurement for this claim.',
};

/** A goal side's words, and the display figure they print (`null` when they print none): SCI-10's typed twin. */
function goalSideTyped(value: number | null, optionId: string, decisions: StructuralChallengeCertainty['baseline'], withheld = false, displays?: Readonly<Record<string, string>>): { readonly text: string; readonly figure: string | null } {
  const matches = decisions?.filter((d) => d.option_id === optionId);
  // The existing certainty reader also speaks its stored sentence beside a withheld figure, without restoring it.
  if (value === null) return { text: withheld && matches?.length === 1 && matches[0].earned === false && matches[0].say
    ? matches[0].say : TARGET_FREQUENCY_UNAVAILABLE, figure: null };
  const headline = () => displays?.[optionId] !== undefined
    ? { text: `${displays[optionId]} chance of meeting the goal, in this model, on current information.`, figure: displays[optionId] }
    : { text: TARGET_FREQUENCY_UNAVAILABLE, figure: null };
  if (value !== 0 && value !== 1) return headline();
  const decision = matches?.length === 1 && matches[0].probability_of_goal === value ? matches[0] : undefined;
  if (decision?.earned === true) return headline();
  // Follow the Run's stored unearned sentence verbatim, just as the existing Agent certainty reader does.
  return { text: decision?.earned === false && decision.say
    ? decision.say : 'This is what this model gives, not a certainty; whether that certainty is earned could not be checked.', figure: null };
}

function goalSide(value: number | null, optionId: string, decisions: StructuralChallengeCertainty['baseline'], withheld = false, displays?: Readonly<Record<string, string>>): string {
  return goalSideTyped(value, optionId, decisions, withheld, displays).text;
}

/** The figures a goal or limit claim's line prints, as CEE's own display strings (never a raw probability). */
function claimFigures(c: StructuralChallengeClaimV1, certainty?: StructuralChallengeCertainty): string[] {
  if (c.kind === 'goal_probability') {
    const withheld = c.basis === 'withheld_on_one_side';
    return [goalSideTyped(c.baseline, c.option_id, certainty?.baseline, withheld, certainty?.baselineDisplay).figure,
      goalSideTyped(c.alternative, c.option_id, certainty?.alternative, withheld, certainty?.alternativeDisplay).figure]
      .filter((f): f is string => f !== null);
  }
  if (c.kind === 'constraint_probability') {
    return [c.baseline, c.alternative].filter((v): v is number => v !== null && v !== 0 && v !== 1).map(chance);
  }
  return [];
}

function claimLine(c: StructuralChallengeClaimV1, label: (id: string) => string, certainty?: StructuralChallengeCertainty, caveat = ''): string {
  const reason = BASIS_WORDS[c.basis] ?? '';
  if (c.kind === 'leader') {
    if (c.baseline_option_id === null || c.alternative_option_id === null) return `Which option most runs support cannot be compared. ${reason}`;
    // A lead that is not clear in the model runs is never stated as a lead (contract C2/C3).
    if (c.verdict !== 'holds' && c.verdict !== 'changes') return c.basis === 'within_noise'
      ? 'Which option most runs support is too close to tell apart in at least one version.' : `Which option most runs support cannot be compared reliably. ${reason}`;
    return c.baseline_option_id === c.alternative_option_id
      ? `${label(c.baseline_option_id)} leads in both versions${caveat}.`
      : `${label(c.alternative_option_id)} leads in the version without the link; ${label(c.baseline_option_id)} leads in the baseline${caveat}.`;
  }
  const q = c as StructuralChallengeQuantityClaimV1;
  const who = label(q.option_id);
  if (q.kind === 'goal_probability') {
    return `${who} — baseline: ${goalSide(q.baseline, q.option_id, certainty?.baseline, q.basis === 'withheld_on_one_side', certainty?.baselineDisplay)} Without the link: ${goalSide(q.alternative, q.option_id, certainty?.alternative, q.basis === 'withheld_on_one_side', certainty?.alternativeDisplay)}${reason ? ` ${reason}` : ''}`;
  }
  const share = (v: number) => v === 1 ? 'all sampled model runs' : v === 0 ? 'none of the sampled model runs' : `${chance(v)} of model runs`;
  if (q.kind === 'outcome_level') return outcomeLevelLine(who, q, reason);
  const limitSide = (v: number | null) => v === null ? 'The frequency within this limit was unavailable.' : `Within the limit in ${share(v)}.`;
  return `${who} — limit ${label(q.constraint_id ?? '')}: baseline: ${limitSide(q.baseline)} Without the link: ${limitSide(q.alternative)}${reason ? ` ${reason}` : ''}`;
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
        return 'The current analysis permission does not allow this comparison to be shown, so there is no conclusion to report. Nothing in your model changed.';
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

  const caveat = input.leaderLicence === 'permitted_with_caveat' ? ', as a provisional finding on Olumi’s starting estimates' : '';
  const changes = result.claims.filter((c) => c.verdict === 'changes');
  const held = result.claims.filter((c) => c.verdict === 'holds' && !c.invariant_by_construction);
  const unaffected = result.claims.filter((c) => c.invariant_by_construction);
  const open = result.claims.filter((c) => c.verdict === 'delta_only' || c.verdict === 'not_comparable');
  const leader = result.claims.find((c) => c.kind === 'leader');
  const named = leader?.kind === 'leader' && leader.baseline_option_id !== null ? leader.baseline_option_id : null;

  const listOf = (names: readonly string[]) => names.length <= 1 ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const sameAs = input.identicalArms === true || named === null ? [] : input.leaderSameAs ?? [];
  let headline: string;
  if (sameAs.length > 0 && named !== null) {
    // The licensed baseline leader comes out the same as these options without the link (the candidate RESULT).
    headline = `Without ${link}, ${label(named)} comes out the same as ${listOf(sameAs.map(label))}, so its edge over ${sameAs.length === 1 ? 'it' : 'them'}${caveat ? `${caveat},` : ''} rests entirely on this link.`;
  } else if (input.identicalArms === true) {
    // The candidate RESULT has no leader to name: every arm is the same. The baseline's licensed leader may be named.
    headline = named !== null
      ? `Without ${link}, your options all come out the same in this model, so ${label(named)}’s lead${caveat ? `${caveat},` : ''} rests entirely on this link.`
      : `Without ${link}, your options all come out the same in this model, so the difference between them rests entirely on this link.`;
  } else if (leader?.verdict === 'changes' && leader.kind === 'leader' && leader.alternative_option_id !== null && named !== null) {
    headline = `In the version without ${link}, ${label(leader.alternative_option_id)} leads; ${label(named)} leads in the baseline${caveat}.`;
  } else if (changes.length > 0 && named !== null && leader?.verdict === 'holds') {
    headline = `Without ${link}, ${label(named)} still leads${caveat} — but part of the result changes.`;
  } else if (changes.length > 0) {
    headline = `Without ${link}, part of the result changes.`;
  } else if (open.length === 0 && held.length > 0) {
    headline = `Without ${link}, the conclusions I tested still hold.`;
  } else if (named !== null && leader?.verdict === 'holds') {
    // A licensed lead that holds is a conclusion; the generic "doesn't establish" headline would contradict it.
    headline = `Without ${link}, ${label(named)} still leads${caveat}. The other figures don't establish a conclusion either way.`;
  } else {
    headline = `Without ${link}, the recorded evidence doesn't establish that the tested conclusions hold or change.`;
  }

  const lines: string[] = [headline, ''];
  if (input.claimPermissions?.permitted_analysis_mode === 'quantified_provisional' || input.leaderLicence === 'permitted_with_caveat') {
    lines.push(STRUCTURAL_CHALLENGE_LINES.provisional);
  }
  lines.push(STRUCTURAL_CHALLENGE_LINES.tested);
  const bullet = (cs: readonly StructuralChallengeClaimV1[]) => cs.map((c) => `- ${claimLine(c, label, input.certainty, caveat)}`);
  const groupLines = (input.identicalArms === true ? [] : input.identicalGroups ?? []).map((g) =>
    `- Without the link, ${listOf(g.map(label))} come out the same, so which option most runs support isn't compared for that version.`);
  const identicalLine = input.identicalArms === true
    ? ['- Without the link, no option is the most supported: every option comes out the same, so the choice between them makes no difference in that version.'] : [];
  if (changes.length > 0 || identicalLine.length > 0) lines.push('', 'What changes:', ...identicalLine, ...bullet(changes));
  if (held.length > 0) lines.push('', 'What holds:', ...bullet(held));
  // A generic "unavailable" target frequency is said ONCE, naming whom it covers; stored certainty sentences stay.
  const nullSides = (c: StructuralChallengeClaimV1) => {
    if (c.kind !== 'goal_probability' || c.baseline !== null || c.alternative !== null) return null;
    const withheld = c.basis === 'withheld_on_one_side';
    const baseline = goalSide(null, c.option_id, input.certainty?.baseline, withheld);
    const alternative = goalSide(null, c.option_id, input.certainty?.alternative, withheld);
    const generic = { baseline: baseline === TARGET_FREQUENCY_UNAVAILABLE, alternative: alternative === TARGET_FREQUENCY_UNAVAILABLE };
    return generic.baseline || generic.alternative ? { optionId: c.option_id, baseline, alternative, generic } : null;
  };
  const aggregated = open.map(nullSides).filter((x): x is NonNullable<ReturnType<typeof nullSides>> => x !== null);
  const uncertain = bullet(open.filter((c) => nullSides(c) === null
    && !((input.identicalArms === true || groupLines.length > 0) && c.kind === 'leader')));
  uncertain.unshift(...groupLines);
  if (aggregated.length > 0) {
    const names = aggregated.map((x) => label(x.optionId));
    const roster = result.claims.filter((c) => c.kind === 'goal_probability').length;
    const whom = aggregated.length === roster && roster > 1 ? 'each option reaches'
      : names.length === 1 ? `${names[0]} reaches` : `${listOf(names)} reach`;
    const where = aggregated.every((x) => x.generic.baseline && x.generic.alternative) ? 'either version' : 'at least one version';
    const stored = aggregated.filter((x) => !x.generic.baseline || !x.generic.alternative).map((x) => `- ${label(x.optionId)} — ${
      x.generic.baseline ? `Without the link: ${x.alternative}` : `baseline: ${x.baseline}`}`);
    uncertain.unshift(`- How often ${whom} the target isn't available in ${where}, so it isn't compared.`, ...stored);
  }
  if (unaffected.length > 0) {
    uncertain.push(...bullet(unaffected));
    uncertain.push('- Some results can\'t be affected by this link at all, so their holding isn\'t evidence either way.');
  }
  uncertain.push('- Driver rankings and other diagnostic scores aren\'t compared between the two versions, because they shift with how the model is scaled.');
  uncertain.push('- All of Olumi\'s other estimates were kept as they are; this is one alternative, not the only one.');
  uncertain.push(`- ${STRUCTURAL_CHALLENGE_LINES.not_saved}`);
  lines.push('', 'What remains uncertain:', ...uncertain);

  const from = label(result.alternative.from_id);
  const to = label(result.alternative.to_id);
  lines.push('', sameAs.length > 0 && named !== null
    ? `Next step: ${label(named)}’s edge over ${listOf(sameAs.map(label))} flows only through this link. Check the evidence for how ${from} affects ${to} before relying on it.`
    : input.identicalArms === true
    ? `Next step: this link carries the whole difference between your options. Check the evidence for how ${from} affects ${to} before relying on ${named !== null ? `${label(named)}’s lead` : 'the comparison'}.`
    : changes.length > 0
    ? `Next step: the two model versions differed in ${changes.map((c) => c.kind === 'leader' ? 'which option most runs support' : c.kind === 'goal_probability' ? `${label(c.option_id)}’s target certainty` : c.kind === 'outcome_level' ? `${label(c.option_id)}’s position relative to the target` : `${label(c.option_id)}’s frequency within ${label(c.constraint_id ?? '')}`).join('; ')}. What evidence do you have for the link from ${from} to ${to}? Review that evidence before deciding whether to keep the link.`
    : open.length === 0 && held.length > 0
      ? `Next step: the tested conclusions held in these two model versions. Review the evidence for how ${from} affects ${to} before deciding whether to keep the link.`
      : `Next step: resolve the missing or unqualified evidence before drawing a conclusion about how ${from} affects ${to}.`);
  return lines.join('\n');
}

// ── The press and the route adapter (the Executor's hot-seam hunk calls only these) ─────────────────────────────────

/**
 * The canonical press id for "Test without this link" on one link. Typed ids, never labels:
 * A JSON tuple encodes both endpoints without reserving any characters in canonical node ids.
 */
export const STRUCTURAL_CHALLENGE_PRESS_PREFIX = 'agent-test-without-link:';

export function structuralChallengePressId(link: ChallengeLink): string {
  return `${STRUCTURAL_CHALLENGE_PRESS_PREFIX}${JSON.stringify([link.from_id, link.to_id])}`;
}

export type StructuralChallengePress = ChallengeLink | { readonly legacyCandidates: readonly ChallengeLink[] };

/** Pure grammar reader. Legacy delimiters may overlap: the graph, never a split heuristic, resolves them. */
export function parseStructuralChallengePress(chipId: unknown): StructuralChallengePress | null {
  if (typeof chipId !== 'string' || !chipId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)) return null;
  const suffix = chipId.slice(STRUCTURAL_CHALLENGE_PRESS_PREFIX.length);
  // Bounds: JSON.parse is linear, so the canonical form keeps base compatibility (whitespace, \u escapes: two
  // fully escaped 200-char ids are ~2,410 chars) under a 4,096 sanity cap; legacy `from::to` enumeration is 402.
  if (suffix.length > 4096) return null;
  const linkOf = (from: unknown, to: unknown): ChallengeLink | null => {
    if (!NodeV3.shape.id.safeParse(from).success || !NodeV3.shape.id.safeParse(to).success || from === to) return null;
    const parsed = StructuralChallengeAlternativeV1Schema.safeParse({ op: 'remove_link', from_id: from, to_id: to, origin: 'user_selected', sizing: 'unmarked' });
    return parsed.success ? { from_id: parsed.data.from_id, to_id: parsed.data.to_id } : null;
  };
  let parts: unknown;
  try { parts = JSON.parse(suffix); } catch {
    if (suffix.length > 402) return null;
    const legacyCandidates: ChallengeLink[] = [];
    for (let split = suffix.indexOf('::'); split !== -1; split = suffix.indexOf('::', split + 1)) {
      const link = linkOf(suffix.slice(0, split), suffix.slice(split + 2));
      if (link !== null) legacyCandidates.push(link);
    }
    return legacyCandidates.length > 0 ? { legacyCandidates } : null;
  }
  if (!Array.isArray(parts) || parts.length !== 2) return null;
  return linkOf(parts[0], parts[1]);
}

export interface StructuralChallengeTurn {
  readonly reply: string;
  readonly outcome: StructuralChallengeResultV1['status'] | 'no_run';
  readonly result: StructuralChallengeResultV1 | null;
  readonly labels: ReadonlyMap<string, string>;
  readonly actions: readonly SuggestedAction[];
  readonly certainty?: StructuralChallengeCertainty;
  readonly candidateLeaderLicence?: LeaderLicence;
  readonly presentedLicence?: LeaderLicence;
  /** Keep the provisional-figures disclosure even when the leader is withheld. */
  readonly presentedProvisionalFigures?: boolean;
  readonly baselineRunIdentity?: SelectedRunIdentity;
  readonly identicalArms?: boolean;
  readonly identicalGroups?: readonly (readonly string[])[];
  readonly leaderSameAs?: readonly string[];
}

/** One line of a completed reply that SCI-10's card may show: what kind it is, the option it is about, its figures. */
export interface StructuralChallengeRow {
  readonly text: string;
  readonly kind: 'provisional' | 'tested' | 'goal' | 'limit' | 'not_saved';
  readonly option_id?: string;
  readonly figures: readonly string[];
}

/**
 * ⭐ SCI-10's allowlist, typed (accel P24): the provisional disclosure, what was tested, each option's goal-chance and
 * limit lines, and "not saved" — never the headline, a lead line, an outcome-level line or the next step. Built with
 * the composer's own functions on the turn as PRESENTED (after `structuralChallengeTurnUnderLicence`), then kept only
 * where the reply says it, in the reply's order: the composer, not this list, decides which claims became lines.
 * Empty for anything but a completed test.
 */
export function structuralChallengeRowsOf(turn: StructuralChallengeTurn): StructuralChallengeRow[] {
  const result = turn.result;
  if (result === null || result.status !== 'completed') return [];
  const label = (id: string) => turn.labels.get(id) ?? id;
  const candidates: StructuralChallengeRow[] = [
    { text: STRUCTURAL_CHALLENGE_LINES.provisional, kind: 'provisional', figures: [] },
    { text: STRUCTURAL_CHALLENGE_LINES.tested, kind: 'tested', figures: [] },
    ...result.claims.flatMap((c): StructuralChallengeRow[] => c.kind === 'goal_probability' || c.kind === 'constraint_probability'
      ? [{ text: claimLine(c, label, turn.certainty), kind: c.kind === 'goal_probability' ? 'goal' : 'limit', option_id: c.option_id, figures: claimFigures(c, turn.certainty) }]
      : []),
    { text: STRUCTURAL_CHALLENGE_LINES.not_saved, kind: 'not_saved', figures: [] },
  ];
  const at = (row: StructuralChallengeRow) => turn.reply.indexOf(row.text);
  return candidates.filter((row) => at(row) >= 0).sort((a, b) => at(a) - at(b));
}

/** Each receipt (dispatch, final, replay) applies this adapter with SAME-read baseline authority.
 * The effective presentation licence only narrows; provisional disclosures persist too.
 */
export function structuralChallengeTurnUnderLicence(
  turn: StructuralChallengeTurn, finalRead: StructuralChallengeFinalRead | undefined,
): StructuralChallengeTurn {
  if (turn.result === null || turn.result.status !== 'completed') return turn;
  const permission = structuralChallengePresentationPermission(turn.result.baseline, finalRead, turn.baselineRunIdentity);
  if (!permission.ok) {
    const result: StructuralChallengeResultV1 = { ...turn.result, status: permission.status, reason: permission.reason,
      claims: [], pair_provenance: null, not_compared: [] };
    return { ...turn, result, outcome: result.status, certainty: undefined,
      reply: composeStructuralChallengeReply({ result, labels: turn.labels }) };
  }
  // Identical arms (all, or ANY group) leave the candidate no leader to licence: only the baseline's canonical licence
  // governs its name. Gate 1 v2 withholds an identical group's figures inside the candidate Run, so its licence reads
  // withheld exactly when the served pair reply needs the baseline name (#2574 interplay, row R0g).
  const candidateNarrows = turn.identicalArms !== true && (turn.identicalGroups?.length ?? 0) === 0;
  let licence: LeaderLicence = !permission.permissions.leader_may_be_named
    || (candidateNarrows && (turn.candidateLeaderLicence === 'withheld' || turn.candidateLeaderLicence === undefined)) ? 'withheld'
    : permission.permissions.provisional === true || (candidateNarrows && turn.candidateLeaderLicence === 'permitted_with_caveat')
      ? 'permitted_with_caveat' : 'permitted';
  const licenceOrder: Record<LeaderLicence, number> = { withheld: 0, permitted_with_caveat: 1, permitted: 2 };
  if (turn.presentedLicence !== undefined && licenceOrder[turn.presentedLicence] < licenceOrder[licence]) {
    licence = turn.presentedLicence;
  }
  const provisionalFigures = turn.presentedProvisionalFigures === true
    || permission.permissions.permitted_analysis_mode === 'quantified_provisional' || licence === 'permitted_with_caveat';
  const claimPermissions: ClaimPermissions = provisionalFigures
    ? { ...permission.permissions, permitted_analysis_mode: 'quantified_provisional' } : permission.permissions;
  const result: StructuralChallengeResultV1 = {
    ...turn.result,
    claims: turn.result.claims.map((c) => (c.kind === 'leader' && licence === 'withheld'
      ? { kind: 'leader', baseline_option_id: null, alternative_option_id: null, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false }
      : c)),
  };
  return { ...turn, result, presentedLicence: licence, presentedProvisionalFigures: provisionalFigures,
    reply: composeStructuralChallengeReply({ result, labels: turn.labels,
      certainty: turn.certainty, leaderLicence: licence, claimPermissions, identicalArms: turn.identicalArms, identicalGroups: turn.identicalGroups, leaderSameAs: turn.leaderSameAs }) };
}

export const STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY =
  'I can\'t show this link test again because it may not match your current analysis. Open the link on the canvas and choose "Test without this link" to test it against the current analysis. Nothing in your model changed.';

/** Re-present the typed turn under a fresh receipt; the route replays stored words only for an identical typed answer. */
export function structuralChallengeReplay(
  remembered: StructuralChallengeTurn | undefined, receipt: StructuralChallengeFinalRead | undefined,
): StructuralChallengeTurn {
  const unbound = (): StructuralChallengeTurn => ({ reply: STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY,
    outcome: 'failed', result: null, labels: new Map(), actions: [TALK_IT_THROUGH_CHIP] });
  if (remembered === undefined) return unbound();
  if (remembered.result?.status !== 'completed') return remembered;
  const presented = structuralChallengeTurnUnderLicence(remembered, receipt);
  return presented.result?.status === 'completed' || presented.result?.status === 'withheld' ? presented : unbound();
}

export const STRUCTURAL_CHALLENGE_NO_RUN_REPLY =
  'There is no analysis to test yet. Run the analysis first, then try "Test without this link".';

export type StructuralChallengePressRefusal = 'malformed' | 'ambiguous' | 'not_found' | 'graph_unavailable' | 'failed';

export function structuralChallengeRefusal(cause: StructuralChallengePressRefusal): StructuralChallengeTurn {
  const replies: Record<StructuralChallengePressRefusal, string> = {
    malformed: "I can't tell which link this is, so I can't test it.",
    ambiguous: "More than one link in your model matches this one, so I can't tell which to test.",
    not_found: "That link isn't in your current model. Open a link from the canvas and try again.",
    graph_unavailable: "I couldn't read a model to test this link against.",
    failed: "I couldn't finish this link test just now. Please try again.",
  };
  return { reply: `${replies[cause]} Nothing in your model changed.`, outcome: cause === 'failed' ? 'failed' : 'unsupported',
    result: null, labels: new Map(), actions: [TALK_IT_THROUGH_CHIP] };
}

export interface StructuralChallengePressResolution {
  /** Already parsed by the route, including a malformed result; never parsed twice. */
  readonly press: StructuralChallengePress | null;
  readonly resolvedLink?: ChallengeLink | null;
  readonly refusal?: StructuralChallengePressRefusal;
}

/**
 * A valid press → one dispatch → the deterministic reply. A malformed press for this method refuses before dispatch;
 * null is reserved for another method's press (the turn proceeds as usual).
 * The caller supplies the dispatch bound to the turn's existing permissions; nothing here reads or writes state.
 */
export async function structuralChallengeTurnFor(
  chipId: unknown,
  ask: (link: ChallengeLink) => Promise<StructuralChallengeDispatchResult>,
  resolution?: StructuralChallengePressResolution,
): Promise<StructuralChallengeTurn | null> {
  const press = resolution === undefined ? parseStructuralChallengePress(chipId) : resolution.press;
  if (press === null) return typeof chipId === 'string' && chipId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)
    ? structuralChallengeRefusal('malformed') : null;
  const candidates = 'legacyCandidates' in press ? press.legacyCandidates : [press];
  const resolved = resolution?.resolvedLink;
  // A caller's resolution may select only the identity encoded by this press.
  if (resolved != null && !candidates.some((candidate) => candidate.from_id === resolved.from_id && candidate.to_id === resolved.to_id)) {
    return structuralChallengeRefusal('malformed');
  }
  if (resolution?.refusal !== undefined) return structuralChallengeRefusal(resolution.refusal);
  // Canonical JSON identities go directly to dispatch; only legacy grammar needs graph resolution.
  const link = 'legacyCandidates' in press ? resolved : press;
  if (link == null) return structuralChallengeRefusal('malformed');
  const actions = [TALK_IT_THROUGH_CHIP];
  const dispatched = await ask(link);
  if (dispatched.kind === 'no_run') return { reply: STRUCTURAL_CHALLENGE_NO_RUN_REPLY, outcome: 'no_run', result: null, labels: new Map(), actions };
  const turn: StructuralChallengeTurn = {
    reply: composeStructuralChallengeReply({ result: dispatched.result, labels: dispatched.labels, certainty: dispatched.certainty, identicalArms: dispatched.identicalArms, identicalGroups: dispatched.identicalGroups, leaderSameAs: dispatched.leaderSameAs }),
    outcome: dispatched.result.status,
    result: dispatched.result,
    labels: dispatched.labels,
    certainty: dispatched.certainty,
    candidateLeaderLicence: dispatched.candidateLeaderLicence,
    baselineRunIdentity: dispatched.baselineRunIdentity,
    identicalArms: dispatched.identicalArms,
    identicalGroups: dispatched.identicalGroups,
    leaderSameAs: dispatched.leaderSameAs,
    actions,
  };
  return structuralChallengeTurnUnderLicence(turn, dispatched.finalRead);
}
