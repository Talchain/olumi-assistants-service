/**
 * ⭐ S-B — THE DETERMINISTIC RANKER AND THE `action_bar` v1 SIDECAR (ACTION-SYSTEM-DRAFT §C3/§D6/§E; github-a2 contract
 * v1 amendments 1–11 + v1.1).
 *
 * A pure function of `ActionFacts` (a canonical read + RC's persisted history): the same read gives a byte-identical
 * bar, on a live turn and on the reload GET alike. RC stays the ranking authority (AIE 6036471065): an action ranks by
 * the RC row that names it (`eligibleGuidanceRows`, after RC's own cooldown), so a pressed row leaves the pills until
 * its state changes. Canonical standing gaps rank T0 on every reply, yielding to approval or a stale Run. Ties break
 * by registry order. No model call, clock or random source.
 *
 * LAYOUT (§E.2: a maximum, never a requirement): `standard` = the four standard actions in FIXED order, each present
 * only while its typed contract can be offered; `priority` ≤2 = the most important other actions RC ranks P1–P3, never a
 * standard id (amendment 3); `more` = every other emitted action. (action_id, target) is unique across the three.
 * Every offer is a COMPLETE typed action (contract v1.1 item 3): `enabled: false` only for a precondition the user can
 * change, named in `disabled_reason`.
 */
import { createHash } from 'node:crypto';
import type { SelectedRow } from '../guidance/index.js';
import { structuralChallengePressId } from '../method-turn/structural-challenge-turn.js';
import { ACTION_IDS, ACTION_REGISTRY, STANDARD_ACTIONS, type ActionGroup, type ActionId } from './registry.js';
import { estimatePointsOf, type ActionFacts, type ActionRevision } from './state.js';
import { biasRiskOf, type BiasRiskV1 } from './bias-triggers.js';

export type ItemRef =
  | { readonly kind: 'option' | 'factor' | 'risk' | 'outcome' | 'goal'; readonly id: string }
  | { readonly kind: 'link'; readonly from_id: string; readonly to_id: string };

export interface ActionOffer {
  readonly action_id: ActionId;
  readonly label: string;
  readonly icon: string;
  readonly group: ActionGroup;
  readonly press_id: string;
  readonly user_line: string;
  readonly enabled: boolean;
  readonly why_now?: string;
  readonly disabled_reason?: string;
  readonly target?: ItemRef;
  readonly offer_key: string;
}

export interface ActionBarV1 {
  readonly v: 1;
  readonly state_key: string;
  readonly revision: ActionRevision;
  readonly priority: readonly ActionOffer[];
  readonly standard: readonly ActionOffer[];
  readonly more: readonly ActionOffer[];
  /** P45: the standing one-line bias-risk row; every item presses an offer on this same bar. Absent when none fires. */
  readonly bias_risk?: BiasRiskV1;
}

export const PRIORITY_MAX = 2;
export const MORE_MAX = 20;
/** RC priorities P1–P3 are the actionable ones a pill may carry (P4/P5 stay in the menu). */
const PILL_TIER_MAX = 3;
const GENERIC_TIER = 9;
/** Menu-only and last: a full More menu drops the bias check before any existing offer. */
const BIAS_CHECK_TIER = GENERIC_TIER + 1;

export const WHY_NOW = {
  review: 'Lists what this result rests on before you rely on it.',
  what_changes: 'Shows what would have to change for this result to change.',
  strengthen: 'A link on your goal’s path has no size yet.',
  pre_mortem: 'Imagine this went badly and find the most likely causes.',
  more_options: 'Find options you haven’t considered yet.',
  more_options_W1: 'No option meets your limit yet.',
  more_options_W2Z: 'Your model has no options to compare yet.',
  more_options_W2: 'There is only one option besides doing nothing.',
  more_options_W3: 'Your options all work through the same lever.',
  more_options_W4: 'There is no do-nothing option to compare against.',
  more_options_W5: 'Your options don’t separate in this model yet.',
  frame_brief_T0: 'Your model has no goal yet, so nothing can be judged against it.',
  frame_brief: 'See what your brief has and what it is missing.',
  set_deadline: 'Your goal has no date yet, so no chance of meeting it can be worked out.',
  set_goal: 'Your goal has no target yet, so no chance of meeting it can be worked out.',
  more_risks_W6: 'Your model has at most one risk.',
  more_risks: 'Find risks you haven’t considered yet.',
  bias_anchoring: 'Test Olumi’s figures against your own evidence.',
  check_estimates: 'See the Olumi estimates feeding this result.',
  bias_check: 'See where common reasoning patterns could bite in this model.',
  test_link: 'This result is most sensitive to one link: see what happens without it.',
} as const;

export const DISABLED = {
  needs_current_analysis: 'Needs a current analysis.',
  needs_goal: 'Needs a goal in the model first.',
  needs_option: 'Needs at least one option in the model.',
} as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2027-04-07" → "7 April 2027", with no clock or locale involved. */
export function sayDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m === null ? undefined : MONTHS[Number(m[2]) - 1];
  return m === null || month === undefined || Number(m[3]) < 1 || Number(m[3]) > 31 ? null : `${Number(m[3])} ${month} ${m[1]}`;
}

const hash16 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** The offer's identity (§E.1): scenario + graph hash (+ the goal's date) + action + target, and the Run only for a Run-dependent action. */
export function offerKeyOf(f: ActionFacts, action: ActionId, target?: ItemRef): string {
  return hash16(['offer', 1, f.scenarioId, f.revision.graph_hash, f.deadline, action, target ?? null,
    ACTION_REGISTRY[action].run_dependent ? f.revision.run_key : null]);
}

const tierOfPriority = (row: SelectedRow): number => Number(row.priority.slice(1));

type Draft = { readonly offer: ActionOffer; readonly tier: number };

function draft(f: ActionFacts, action: ActionId, state: { enabled: true; why_now: string } | { enabled: false; disabled_reason: string },
  tier: number, extra: { target?: ItemRef; press_id?: string; user_line?: string } = {}): Draft {
  const entry = ACTION_REGISTRY[action];
  const pressId = extra.press_id ?? (entry.press.kind === 'fixed' ? entry.press.id : '');
  return {
    tier,
    offer: {
      action_id: action, label: entry.label, icon: entry.icon, group: entry.group, press_id: pressId,
      user_line: extra.user_line ?? entry.user_line, enabled: state.enabled,
      ...(state.enabled ? { why_now: state.why_now } : { disabled_reason: state.disabled_reason }),
      ...(extra.target !== undefined ? { target: extra.target } : {}),
      offer_key: offerKeyOf(f, action, extra.target),
    },
  };
}

/** Each action's offer on these facts, or nothing when its typed contract cannot be offered here. */
function drafts(f: ActionFacts): Draft[] {
  const rc = (policy: SelectedRow['policy_id'], pred: (r: SelectedRow) => boolean = () => true) => f.rcRows.find((r) => r.policy_id === policy && pred(r));
  const out: Draft[] = [];
  const needsRun = { enabled: false as const, disabled_reason: DISABLED.needs_current_analysis };

  if (f.identityReading != null) {
    const prefix = "Olumi can't show the chance until you check how it reads ‘";
    const suffix = '’.';
    const maxLabel = 90 - prefix.length - suffix.length;
    const label = f.identityReading.goalLabel.length <= maxLabel ? f.identityReading.goalLabel
      : `${f.identityReading.goalLabel.slice(0, maxLabel - 1)}…`;
    out.push(draft(f, 'confirm_reading', { enabled: true, why_now: `${prefix}${label}${suffix}` }, 1));
  }

  out.push(draft(f, 'review', f.runBound ? { enabled: true, why_now: WHY_NOW.review } : needsRun, GENERIC_TIER));

  const whatChanges = rc('RC-WHAT-CHANGES');
  out.push(draft(f, 'what_changes', f.runBound ? { enabled: true, why_now: WHY_NOW.what_changes } : needsRun,
    whatChanges !== undefined ? tierOfPriority(whatChanges) : GENERIC_TIER));

  // S1 scope only (§E.4): offered while the S1 card exists, or (disabled) until there is a current Run to look for one.
  // A current Run with no unsized goal-path link has nothing in scope: not offered (not a precondition the user can change).
  if (f.strengthenCard) {
    const row = rc('RC-STRENGTHEN-ITEM', (r) => r.variant === 'S1');
    out.push(draft(f, 'strengthen', { enabled: true, why_now: WHY_NOW.strengthen }, row !== undefined ? tierOfPriority(row) : GENERIC_TIER));
  } else if (!f.runBound) {
    out.push(draft(f, 'strengthen', needsRun, GENERIC_TIER));
  }

  if (f.readable) {
    const standing = !f.goalPresent ? 'frame_brief'
      : f.goalKind === 'chance_of_event' && f.deadline === null ? 'set_deadline'
        : f.goalKind !== null && f.goalKind !== 'chance_of_event' && !f.targetPresent ? 'set_goal' : null;
    out.push(draft(f, 'frame_brief', { enabled: true, why_now: standing === 'frame_brief' ? WHY_NOW.frame_brief_T0 : WHY_NOW.frame_brief },
      standing === 'frame_brief' ? 0 : GENERIC_TIER));
    if (standing === 'set_goal' || standing === 'set_deadline') {
      out.push(draft(f, standing, { enabled: true, why_now: WHY_NOW[standing] }, 0));
    }
    if (f.risksAvailability !== 'omit') {
      const risks = rc('RC-WIDEN', r => r.target === 'risks');
      out.push(draft(f, 'more_risks', f.risksAvailability === 'run'
        ? { enabled: true, why_now: risks?.variant === 'W6' ? WHY_NOW.more_risks_W6 : WHY_NOW.more_risks }
        : { enabled: false, disabled_reason: DISABLED.needs_goal },
      risks !== undefined ? tierOfPriority(risks) : GENERIC_TIER));
    }
    // Both estimate actions speak of "this result" and are run_dependent in the registry: offered only on a bound Run (DL on #2766).
    if (f.runBound && estimatePointsOf(f).length > 0) {
      out.push(draft(f, 'bias_anchoring', { enabled: true, why_now: WHY_NOW.bias_anchoring }, GENERIC_TIER));
      out.push(draft(f, 'check_estimates', { enabled: true, why_now: WHY_NOW.check_estimates }, GENERIC_TIER));
    }
    const premortem = rc('RC-PREMORTEM');
    const date = f.deadline === null ? null : sayDate(f.deadline);
    // Contract v1.1 item 4: the user line names the horizon the model holds, never a default year.
    const userLine = date === null ? undefined
      : `Run a pre-mortem with me: imagine it is ${date} and this decision went badly. What most plausibly went wrong?`;
    out.push(draft(f, 'pre_mortem',
      !f.goalPresent ? { enabled: false, disabled_reason: DISABLED.needs_goal }
        : f.ownOptionCount < 1 ? { enabled: false, disabled_reason: DISABLED.needs_option }
          : { enabled: true, why_now: WHY_NOW.pre_mortem },
      premortem !== undefined ? tierOfPriority(premortem) : GENERIC_TIER, userLine !== undefined ? { user_line: userLine } : {}));

    const widen = rc('RC-WIDEN', (r) => r.target === 'options');
    const variantWhy = widen?.variant !== undefined ? (WHY_NOW as Record<string, string>)[`more_options_${widen.variant}`] : undefined;
    out.push(draft(f, 'more_options',
      f.goalPresent ? { enabled: true, why_now: variantWhy ?? WHY_NOW.more_options } : { enabled: false, disabled_reason: DISABLED.needs_goal },
      widen !== undefined ? tierOfPriority(widen) : GENERIC_TIER));
  }

  if (f.testLink !== null) {
    const target: ItemRef = { kind: 'link', from_id: f.testLink.from_id, to_id: f.testLink.to_id };
    out.push(draft(f, 'test_link', { enabled: true, why_now: WHY_NOW.test_link }, PILL_TIER_MAX, { target, press_id: structuralChallengePressId(f.testLink) }));
  }
  if (f.readable) {
    out.push(draft(f, 'bias_check', { enabled: true, why_now: WHY_NOW.bias_check }, BIAS_CHECK_TIER));
  }
  return out;
}

const registryIndex = (id: ActionId): number => ACTION_IDS.indexOf(id);
const byRank = (a: Draft, b: Draft): number => a.tier - b.tier || registryIndex(a.offer.action_id) - registryIndex(b.offer.action_id);
const isStandard = (id: ActionId): boolean => (STANDARD_ACTIONS as readonly ActionId[]).includes(id);

/** THE BAR for these facts. Pure and deterministic: same facts → byte-identical JSON. */
export function actionBarOf(f: ActionFacts): ActionBarV1 {
  const all = drafts(f);
  const standard = STANDARD_ACTIONS.flatMap((id) => all.filter((d) => d.offer.action_id === id)).map((d) => d.offer);
  const others = all.filter((d) => !isStandard(d.offer.action_id)).sort(byRank);
  const standing = others.find(d => d.tier === 0);
  const priority = standing !== undefined && !f.approvalWaiting && !f.runStale ? [standing]
    : others.filter(d => d.offer.enabled && d.tier > 0 && d.tier <= PILL_TIER_MAX).slice(0, PRIORITY_MAX);
  const more = others.filter((d) => !priority.includes(d)).slice(0, MORE_MAX);
  const bar = { v: 1 as const, state_key: f.stateKey, revision: f.revision, priority: priority.map((d) => d.offer), standard, more: more.map((d) => d.offer) };
  const biasRisk = biasRiskOf(f, [...bar.priority, ...bar.standard, ...bar.more], f.optionFrame);
  return biasRisk !== undefined ? { ...bar, bias_risk: biasRisk } : bar;
}

const sameTarget = (a: ItemRef | undefined, b: ItemRef | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The current offer for (action, target) on these facts, wherever it sits on the bar; undefined when not offered now. */
export function currentOfferFor(bar: ActionBarV1, action: ActionId, target?: ItemRef): ActionOffer | undefined {
  return [...bar.priority, ...bar.standard, ...bar.more].find((o) => o.action_id === action && sameTarget(o.target, target));
}
