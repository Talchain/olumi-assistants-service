/**
 * ⭐ THE READINESS SELF-CHECK (DL 22 Oct, replacing the one-encoding-at-a-time offers of Class 3). After every draft or change, before
 * its save or card, the host dry-runs what a Run would get from the very postimage the write registers (`corePostimage`, 0 engine
 * calls): the mapper's verdict on the goal and the readiness authority's blockers. A blocker the AI can fix in Olumi's own items
 * gets one sentence; one that needs the person's input, or sits on the person's own content, is an ask. At most `REPAIRS` repairs
 * a turn, then the call is saved as it is with its asks. A repair never alters or removes the person's content: a retry that
 * would is not used (`personContentLost`), and the call it retried is.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import type { Mapped } from '../living-model/mapper.js';
import { stable } from '../living-model/diff.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { projectCorePostimageForPersistence } from '../../persisted-graph-projection.js';
import { composeIdentityAskForNode } from '../../coaching/identity-not-evaluated-ask.js';
import { notTargetTestableSentence, targetTestabilityOf } from '../../admission/target-testability.js';
import { goalTargetGapOf } from '../../goal-target/goal-target-gap.js';
import { aimTargetReading } from '../living-model/aim-reading.js';
import { nodeUnitOf } from '../../../orchestrator/context/placeholder-parts.js';

/**
 * The turn's repairs, shared by the draft and the change; the core route makes it per turn and `pathBTools` uses it.
 * ⭐ A REFUSAL CAN MAKE A TURN BETTER, NEVER WORSE (DL, #3672 fix-forward): the latest refused call is kept (`pending`) until a
 * draft or a card succeeds after it (each retry is checked against it, so it holds all the person's content of the calls before), and the turn's end runs a call still pending once more, with no repair left, exactly as
 * base would (`settle`, filled by `pathBTools`), so an agent that stops after the refusal still leaves its draft saved.
 */
export interface Restructure {
  repairs: number;
  pending?: { readonly tool: 'build_model_from_brief'; readonly args: { brief: string; model: LivingModelT } }
    | { readonly tool: 'propose_change'; readonly args: { public_label: string; basis: string; model: LivingModelT; remove: string[] } };
  settle?: () => Promise<void>;
  /**
   * The saved aim a change was asked to replace (`living-change.ts`), with the refused call that asked (`of`, pending's own args):
   * naming it in remove in the next call is the replace, never a loss. Any later refusal replaces pending, and so ends it.
   */
  replace?: { readonly id: string; readonly of: object };
}

/** At most this many refusals a turn; then the call is saved as it is and the AI asks (DL 22 Oct). */
export const REPAIRS = 2;

type Rec = Record<string, unknown>;
const theirs = (r: unknown): boolean => typeof r === 'object' && r !== null && !Array.isArray(r)
  && ((r as Rec).source === 'user' || (r as Rec).source === 'party');
/** Every record a person or a party gave, nested at any depth (an option's setting, a risk's mitigation, a limit, a definition). */
const nestedTheirs = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(nestedTheirs)
  : typeof v === 'object' && v !== null ? [...(theirs(v) ? [v] : []), ...Object.values(v).flatMap(nestedTheirs)] : []);

/**
 * The person's own content in a (kernelled) model, as labelled entries, one per record, repeats kept (Codex r1 on #3675): each
 * item a person or a party gave, whole (its figures, quotes and settings); each of their records nested in an item of Olumi's;
 * each of their conditions whole, its role included (DL 22 Oct: a person's condition is asked about, never re-read); every view.
 */
function personContent(m: LivingModelT): { readonly label: string; readonly value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const kind of ['aims', 'options', 'factors', 'links', 'risks'] as const) {
    for (const item of m[kind]) {
      if (theirs(item)) out.push({ label: `${kind}:${item.id}`, value: stable(item) });
      else for (const r of nestedTheirs(Object.values(item))) out.push({ label: `${kind}:${item.id}`, value: stable(r) });
    }
  }
  // Today's level the person set themselves on an aim of Olumi's (`current_source: 'user'`, a canvas edit), in the unit it is
  // read in (Codex r2, r3 on #3675).
  for (const a of m.aims) {
    if (!theirs(a) && a.target?.current_source === 'user') out.push({ label: `aims:${a.id}`, value: stable({ current: a.target.current, unit: a.target.current_unit ?? a.target.unit }) });
  }
  for (const c of m.conditions) {
    if (theirs(c)) out.push({ label: `conditions:${c.text}`, value: stable({ ...c, applies_to: [...c.applies_to].sort() }) });
  }
  for (const v of m.views) out.push({ label: `views:${v.holder}: ${v.position}`, value: stable(v) });
  return out;
}

/**
 * What of the person's content in `refused` the retry left out or changed, compared on the kernelled models (the kernel makes
 * ids canonical and labels sources): the retry never loses it (DL, #3672 fix-forward).
 */
export function personContentLost(refused: LivingModelT, retry: LivingModelT): string[] {
  const keyOf = (e: { readonly label: string; readonly value: string }) => `${e.label}\u0000${e.value}`;
  const left = new Map<string, number>();
  for (const e of personContent(retry)) left.set(keyOf(e), (left.get(keyOf(e)) ?? 0) + 1);
  const lost = personContent(refused).flatMap((e) => {
    const n = left.get(keyOf(e)) ?? 0;
    left.set(keyOf(e), n - 1);
    return n > 0 ? [] : [e.label];
  });
  return [...new Set(lost)];
}

/** What the AI is told when its retry would have lost the person's content, so the refused call was used as it was. */
export const KEPT_AS_REFUSED = 'Your call left out or changed items the person or a party gave in the call refused before it (listed in '
  + 'lost), so that refused call was used exactly as it was. Say so plainly if it matters to your reply.';

/** The postimage a write registers, which the self-check reads too: the same object, so the two never differ. */
export const corePostimage = (mapped: Mapped, model: LivingModelT): Rec => ({ ...mapped.graph, living_model: model });

/** Each fix, in one sentence, for a blocker in Olumi's own items (DL 22 Oct). */
const FIX = {
  condition: 'Re-read Olumi\'s condition against the person\'s words: a doubt is a challenge, a premise the result is worked out under is an '
    + 'assumption, and only a real-world requirement that must be met first stays a prerequisite. A missing input is never a condition: '
    + 'remove it, and give the figure Olumi\'s labelled estimate as the figure rules allow, or ask.',
  path: 'Link what drives each option to the goal under its measure, adding each missing link with Olumi\'s own labelled estimate under '
    + 'the estimate rule. Never move a figure the person gave onto a different measure.',
  unit: 'State Olumi\'s figure in the unit of the item it links into; convert only where the conversion is exact.',
  law: 'Give Olumi\'s link a direction, ends that are in the model, and a figure or range a law can be drawn from.',
  option: 'Give Olumi\'s option a setting on a factor, or a sized link of Olumi\'s from it.',
  target: 'Give Olumi\'s target one figure a Run can test: at least or at most it, never exactly equal and never a range.',
  measure: 'Olumi\'s suggested measure carries no figure of its own: set its figures null. The figure that would count as meeting the '
    + 'goal is the person\'s to give.',
  level: 'Give Olumi\'s target a level that today\'s level does not already meet, in the unit and scale of today\'s level. A change is in '
    + 'the quantity\'s own unit, never a percentage of a level of 0 or below.',
  size: 'Size Olumi\'s link in the own unit of the item it links into, per one unit of what it comes from: both ends have their units, '
    + 'and the figure is how much that item moves when the source rises by 1.',
} as const;
/** Each blocker's fix, or `ask` for the person's input. An unlisted code is said, never repaired. */
const BLOCKER: Readonly<Record<string, keyof typeof FIX | 'ask'>> = {
  condition_not_in_slice: 'condition',
  NO_PATH_TO_GOAL: 'path', MISSING_OPTION_CONNECTION: 'path',
  link_unit_mismatch: 'unit', link_frame_unknown: 'unit', current_unit_mismatch: 'unit', UNIT_MISMATCH: 'unit',
  link_sign_unknown: 'law', link_endpoint_unknown: 'law', exact_not_drawable: 'law', link_range_no_law: 'law',
  OPTION_NEEDS_ENCODING: 'option', OPTION_NEEDS_MAPPING: 'option', setting_not_convertible: 'option', MISSING_OPTION_VALUE: 'option',
  // The Run's own verdict on the target (`targetTestabilityOf`); a path's unsized link of Olumi's is Olumi's to size (DL 93d79c3e).
  missing_goal_baseline: 'ask', threshold_off_scale: 'ask', comparator_unscorable: 'target', threshold_unit_mismatch: 'unit',
  goal_path_placeholder: 'size', goal_path_unsized: 'size',
  // Every aim reading that withholds the goal's chance reaches the loop: Olumi's is fixed, the person's asked (DL 93d79c3e, 00:48Z),
  // ownership choosing which (Codex R1 on #3699).
  exact_target_not_in_slice: 'target', target_range_not_in_slice: 'target', target_not_theirs: 'measure', change_base_invalid: 'level',
  goal_level_not_admitted: 'level', stay_within_base_not_theirs: 'level',
  goal_level_unknown: 'ask', link_goal_level_unknown: 'ask', no_level_target: 'ask', link_goal_target_unknown: 'ask', change_kind_unknown: 'ask',
  change_base_not_theirs: 'ask', stay_within_unconfirmed: 'ask', MISSING_FACTOR_LEVEL: 'ask', identity_part_unknown: 'ask', FEWER_THAN_TWO_OPTIONS: 'ask',
  // The identity ask composer's own reasons (`composeIdentityAskForNode`): each is the person's to answer.
  identity_operand_missing: 'ask', identity_frame_missing: 'ask', identity_zero_level: 'ask', identity_rate_out_of_range: 'ask',
};

/** One blocker: its code, the items it is on (by id; `condition:<words>` for a condition), and its fix, or an ask, or said only. */
export interface Blocker {
  readonly code: string;
  readonly items: readonly string[];
  readonly fix?: string;
  readonly ask?: true;
  readonly said?: true;
  /** An ask's question, in the host's own words where a composer has them (0 AI calls); the AI asks in its own otherwise. */
  readonly question?: string;
}

/**
 * Whether the item holds anything of the person's or a party's (Codex r1 on #3689): the item itself, any record nested in it (a
 * setting, a limit, a definition), today's level they set on it, or their setting on it (a factor). A setting (`<option>:<factor>`)
 * is its option's. An item the model does not hold, or none named, counts as theirs, so it is asked about, never edited.
 */
function theirsIn(model: LivingModelT, item: string | null): boolean {
  if (item?.startsWith('condition:')) return model.conditions.some((c) => `condition:${c.text}` === item && theirs(c));
  const id = item?.split(':')[0];
  const found = [...model.aims, ...model.options, ...model.factors, ...model.links, ...model.risks].find((x) => x.id === id);
  return found === undefined || theirs(found) || nestedTheirs(Object.values(found)).length > 0
    || ('target' in found && found.target?.current_source === 'user')
    || model.options.some((o) => o.settings.some((st) => st.factor_id === id && theirs(st)));
}

/** A blocker found, on one item; a condition's scope is part of it, since two conditions can share their words (Codex r1 on #3672). */
export type Found = { readonly code: string; readonly item: string | null; readonly scope?: string; readonly question?: string;
  /** This item's own fix words, where they name its ends (a link's size); else its kind's. */
  readonly fix?: string };
/** The aim readings whose ask is the held-target composer's question or none: one with no words for it is said (Codex R1 on #3699). */
const WORDED = new Set(['exact_target_not_in_slice', 'target_range_not_in_slice', 'target_not_theirs', 'change_base_invalid',
  'goal_level_not_admitted', 'stay_within_base_not_theirs']);
/**
 * ⛔ NEVER ASK FOR A FIGURE THE ITEM ALREADY HOLDS (DL 93d79c3e, C1): a factor's level (a bare range too, until the mapper carries
 * it; B1), a link's size, or the aim's level today. An ask for it is said instead, so the log still shows the gap.
 */
const holdsAsked = (model: LivingModelT, code: string, item: string | null): boolean => (code === 'MISSING_FACTOR_LEVEL'
  ? model.factors.some((f) => f.id === item && (f.value !== null || (f.low !== null && f.high !== null)))
  : code === 'goal_path_unsized' || code === 'goal_path_placeholder'
    ? model.links.some((l) => l.id === item && [l.effect.value, l.effect.low, l.effect.high].some((v) => v !== null))
    : (code === 'missing_goal_baseline' || code === 'change_base_invalid') && model.aims.some((a) => a.id === item && typeof a.target?.current === 'number'));
/** Each found blocker's fix or ask, one per code and kind. */
function said(model: LivingModelT, found: readonly Found[]): Blocker[] {
  const out = new Map<string, { code: string; items: string[]; fix?: string; ask?: true; said?: true; question?: string }>();
  for (const { code, item, question, fix } of found) {
    const kind = BLOCKER[code];
    // ⛔ A repair never alters or removes the person's own content (DL 22 Oct): a fix on it is an ask. Adding Olumi's links (`path`)
    // alters nothing of theirs.
    const ask = kind !== undefined && (kind === 'ask' || (kind !== 'path' && theirsIn(model, item)));
    const unasked = ask && (holdsAsked(model, code, item) || (WORDED.has(code) && question === undefined));
    const how = kind === undefined || unasked ? { said: true as const } : ask ? { ask: true as const } : { fix: fix ?? FIX[kind] };
    // An ask with its own question, or a fix with its own words, is that item's, so none is lost to another's (Codex r2 on #3691).
    const own = ('ask' in how && question !== undefined) || ('fix' in how && fix !== undefined);
    const key = `${code}\u0000${Object.keys(how)[0]}${own ? `\u0000${item}` : ''}`;
    const b = out.get(key) ?? out.set(key, { code, items: [], ...how }).get(key)!;
    if (item !== null && !b.items.includes(item)) b.items.push(item);
    if ('ask' in how && b.question === undefined && question !== undefined) b.question = question;
  }
  return [...out.values()];
}

/**
 * Olumi's link's size fix in ITS OWN ends' units (Codex R1 on #3699): the item it links into, per one unit of what it comes from.
 * The goal's unit only when it links into the goal (the unit the Run reads it in); an option is on or off.
 */
function sizeFix(model: LivingModelT, mapped: Mapped, x: LivingModelT['links'][number]): string {
  const goal = mapped.graph.nodes.find((n) => n.kind === 'goal' && n.id === x.to);
  const unitOf = nodeUnitOf(mapped.graph.nodes);
  const to = goal !== undefined ? [goal.goal_threshold_unit, (goal.observed_state as Rec | undefined)?.unit].find((u): u is string => typeof u === 'string' && u !== '')
    : unitOf(x.to);
  const from = model.options.some((o) => o.id === x.from) ? 'on or off: 1 once it is in place' : unitOf(x.from);
  const none = 'none yet: state it';
  return `Size Olumi's link ${x.id} in the own unit of ${x.to} (${to ?? none}) per one unit of ${x.from} (${from ?? none}): the figure is how much `
    + `${x.to} moves when ${x.from} rises by 1.`;
}

/**
 * What a Run would get from this model, dry: the mapper's verdict on the goal (its own holds and, when its chance rests on held
 * items, those), then each blocker the readiness authority finds on the postimage the write registers. None: Run-ready.
 */
export function selfCheck(model: LivingModelT, mapped: Mapped): Found[] {
  const goal = mapped.graph.nodes.find((n) => n.kind === 'goal')?.id;
  const held = mapped.withheld.filter((w) => w.id === goal && w.reason !== 'chance_rests_on_withheld');
  // A held link on the goal's path (into it, or into what leads to it) leaves the Run a placeholder it withholds the goal's
  // figures on, even where the goal keeps its threshold (Codex r1 on #3689). Only a listed hold: one that withholds nothing (a
  // person's link restating a definition, `identity_restated`) never blocks (Codex r2).
  const reach = new Set(goal === undefined ? [] : [String(goal)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of model.links) if (reach.has(l.to) && !reach.has(l.from)) { reach.add(l.from); grew = true; }
  }
  const linkHolds = mapped.withheld.filter((w) => BLOCKER[w.reason] !== undefined && model.links.some((l) => l.id === w.id && reach.has(l.to)));
  const causes: NonNullable<Mapped['rests_on']>[number][] = [...held, ...(mapped.rests_on ?? []), ...linkHolds];
  // A path cut by a held link on it is said by that link's own cause (a fix, or an ask on the person's link): never a parallel
  // link of Olumi's beside it.
  const linkHeld = causes.some((w) => model.links.some((l) => l.id === w.id));
  const postimage = projectCorePostimageForPersistence(corePostimage(mapped, model));
  const issues = assessCanonicalAnalysisReadiness(postimage).blockingIssues
    .filter((i) => !linkHeld || (i.code !== 'NO_PATH_TO_GOAL' && i.code !== 'MISSING_OPTION_CONNECTION'));
  // An identity the engine would refuse (a part at 0, a missing level or frame) is the composer's one ask (DL 22 Oct).
  const identities = mapped.graph.nodes.filter((n) => n.nonlinear_identity !== undefined).flatMap((n) => {
    const ask = composeIdentityAskForNode(String(n.id), postimage);
    return ask === null ? [] : [{ code: ask.reason, item: String(n.id), question: ask.assistant_text }];
  });
  // ⭐ THE RUN'S OWN VERDICT ON THE TARGET (DL 93d79c3e, C1): what the Run withholds the goal's chance on before the engine
  // (`targetTestabilityOf`, run-analysis.ts), on the same postimage, so `run_ready` never reads true on a failure it decides
  // statically. A path failure counts only on a link of the model: an identity's own edges (and an inferred identity) are the
  // engine's to judge, since ISL's evaluation can clear them, so they are left to the Run (on the replay corpus, capacity's
  // product). A failure a cause above already holds is said by that cause.
  const verdict = targetTestabilityOf(postimage);
  const untestable = verdict.kind === 'not_testable' ? verdict.failures.filter((f) => f.code !== 'identity_unconfirmed') : [];
  // Each failure, and each failing link, gets the Run's sentence for that ONE item, never the first failing link's (Codex R1 on #3699).
  const sentence = (f: (typeof untestable)[number]): { question?: string } => {
    const q = verdict.kind === 'not_testable' ? notTargetTestableSentence(postimage, { ...verdict, failures: [f] }) : null;
    return q === null ? {} : { question: q };
  };
  const nodes = mapped.graph.nodes;
  const labelOf = (id: string): string => { const n = nodes.find((x) => x.id === id); return typeof n?.label === 'string' && n.label.trim() !== '' ? n.label.trim() : id; };
  const target = untestable.flatMap((f): Found[] => (f.precondition !== 'P5' ? [{ code: f.code, item: goal === undefined ? null : String(goal), ...sentence(f) }]
    : (f.links ?? []).flatMap((l) => {
      // The mapped edge carries the model link's id, also where an option's own link runs from its switch (`<option>__on`, mapper).
      const ids = new Set(mapped.graph.edges.filter((e) => e.from === l.from && e.to === l.to).map((e) => e.id));
      const one = { ...f, links: [l], lever: labelOf(l.from), link_to: labelOf(l.to), link: { from: l.from, to: l.to } };
      return model.links.filter((x) => ids.has(x.id)).map((x) => ({ code: f.code, item: x.id, ...sentence(one), fix: sizeFix(model, mapped, x) }));
    })))
    .filter((t) => !causes.some((w) => w.id === t.item));
  // An aim reading the goal is held on asks in the ONE held-target composer's words (`goalTargetGapOf`, the canvas gap's), only
  // for the reading those words are about: never its "no target" words for a goal that has one.
  const gap = goalTargetGapOf(postimage);
  const aim = model.aims.find((a) => a.id === goal);
  const aimQuestion = (w: { readonly id: string; readonly reason: string }): { question?: string } => (gap !== null
    && gap.kind !== 'goal_target_missing' && gap.goal_id === w.id && aim !== undefined && aimTargetReading(aim) === w.reason ? { question: gap.question } : {});
  return [...causes.map((w) => ({ code: w.reason, item: w.id, ...(w.applies_to ? { scope: stable([...w.applies_to].sort()) } : {}), ...aimQuestion(w) })),
    ...issues.map((i) => ({ code: i.code, item: i.option_id ?? i.factor_id ?? null, question: i.message })), ...identities, ...target];
}

/** The blockers of `after` to say back: a change answers only for those it adds to what `before` had (none for a draft). */
export function blockersOf(model: LivingModelT, after: readonly Found[], before: readonly Found[] = []): { all: Blocker[]; added: Blocker[] } {
  const added = after.filter((b) => !before.some((a) => a.code === b.code && a.item === b.item && a.scope === b.scope));
  return { all: said(model, after), added: said(model, added) };
}

/** What the AI is told with a call it can repair (words for the AI, never shown to the person). */
const REPAIR = 'A Run would withhold the goal\'s chance; blockers lists why. Make each fix, in Olumi\'s own items, labelled Olumi\'s. Never '
  + 'change or remove anything the person or a party gave (a figure, sign, range, unit, condition, target or link). Each ask is the '
  + 'person\'s: ask them, in one question, in your reply, in its question\'s words where it has one.';
export const REPAIR_DRAFT = `Not saved yet. ${REPAIR} Then call build_model_from_brief once more; sent unchanged, it is saved as it is.`;
export const REPAIR_CHANGE = `No card yet. ${REPAIR} Then call propose_change once more; sent unchanged, its card is made.`;
/** With a save or card that a Run would still withhold the goal's chance on. */
export const STILL_ASK = 'A Run would still withhold the goal\'s chance (blockers). In your reply, ask the person, in one question, for '
  + 'what is marked ask, in its question\'s words where it has one; never present a chance.';

/** The repair to offer, if any: a fix to make, a repair left, and not the refused call sent again unchanged. */
export function repairOf(r: Restructure | undefined, blockers: readonly Blocker[], model: LivingModelT): boolean {
  const resent = r?.pending !== undefined && stable(r.pending.args.model) === stable(model);
  return r !== undefined && r.repairs < REPAIRS && !resent && blockers.some((b) => b.fix !== undefined);
}
