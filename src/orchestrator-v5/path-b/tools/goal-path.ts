/**
 * ⭐ CLASS 3 (thin-core plan, 20 Oct; DL 22 Oct): THE MAPPER'S VERDICT AS TOOL FEEDBACK, OPENAI-NATIVE. The schema lets the AI
 * write one meaning several ways and the mapper takes one; fixing each with a prompt line is whack-a-mole. When a draft or a
 * change would withhold the goal's chance through the AI's OWN encoding of an item on the goal's path (`mapped.rests_on`),
 * the tool says so once, with the typed reasons, and the agent restructures in the same SDK turn: one bounded retry
 * (`Restructure`, one per turn), structure only, never a new figure (the quote rule still labels any figure).
 * ONLY THE MEASURED CLASS (Codex r1 on #3672): a condition declared a prerequisite (served first drafts, 22 Oct: 4 of 8 chances
 * withheld). Its role is the AI's declaration, so re-reading it against the person's words changes no figure. An unsigned link
 * may be the person's own uncertainty, and moving a cause onto a part can change what its figure measures: neither is offered.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import type { Mapped, Withheld } from '../living-model/mapper.js';
import { stable } from '../living-model/diff.js';
import { reachesGoalInPersonsModel } from '../../../orchestrator/graph-structure-validator.js';

/**
 * One offer per turn, shared by the draft and the change; the core route makes it per turn and `pathBTools` uses it.
 * ⭐ A REFUSAL CAN MAKE A TURN BETTER, NEVER WORSE (DL, #3672 fix-forward): the refused call is kept (`pending`) until a draft
 * or a card succeeds after it, and the turn's end runs a call still pending once more, with the offer used, exactly as base
 * would (`settle`, filled by `pathBTools`), so an agent that stops after the refusal still leaves its draft saved.
 */
export interface Restructure {
  offered: boolean;
  pending?: { readonly tool: 'build_model_from_brief'; readonly args: { brief: string; model: LivingModelT } }
    | { readonly tool: 'propose_change'; readonly args: { public_label: string; basis: string; model: LivingModelT; remove: string[] } };
  settle?: () => Promise<void>;
}

type Rec = Record<string, unknown>;
const theirs = (r: unknown): boolean => typeof r === 'object' && r !== null && !Array.isArray(r)
  && ((r as Rec).source === 'user' || (r as Rec).source === 'party');
/** Every record a person or a party gave, nested at any depth (an option's setting, a risk's mitigation, a limit, a definition). */
const nestedTheirs = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(nestedTheirs)
  : typeof v === 'object' && v !== null ? [...(theirs(v) ? [v] : []), ...Object.values(v).flatMap(nestedTheirs)] : []);

/**
 * The person's own content in a (kernelled) model, as labelled entries, one per record, repeats kept (Codex r1 on #3675): each
 * item a person or a party gave, whole (its figures, quotes and settings); each of their records nested in an item of Olumi's;
 * each of their conditions whole, its role left out (the one part the offer asks the AI to re-read); and every view.
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
  for (const { role: _role, ...c } of m.conditions) {
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

/**
 * The retry as the refused call would have it, but for the one part the offer re-reads: each condition the refused call also
 * holds (by its words, scope and author) takes the refused call's role, so the kernel reads the two alike (Codex r2 on #3675: a
 * role-only change re-checked a saved quote outside the verified window and relabelled it).
 */
export function withRefusedRoles(retry: LivingModelT, refused: LivingModelT): LivingModelT {
  const id = (c: LivingModelT['conditions'][number]) => stable([c.text, [...c.applies_to].sort(), c.source, c.party, c.quote]);
  const roles = new Map(refused.conditions.map((c) => [id(c), c.role] as const));
  return { ...retry, conditions: retry.conditions.map((c) => ({ ...c, role: roles.get(id(c)) ?? c.role })) };
}

/** What the AI is told when its retry would have lost the person's content, so the refused call was used as it was. */
export const KEPT_AS_REFUSED = 'Your second call left out or changed items the person or a party gave (listed in lost), so your first '
  + 'call was used exactly as it was. Say so plainly if it matters to your reply.';

export interface GoalPathCause {
  readonly id: string;
  readonly reason: Withheld['reason'];
  /** The condition's words, as the AI wrote them. */
  readonly item: string;
  /** The items it qualifies: part of its identity, since two conditions can share their words (Codex r1 on #3672). */
  readonly applies_to: readonly string[];
}

export function goalPathEncodingCauses(mapped: Mapped): GoalPathCause[] {
  return (mapped.rests_on ?? []).flatMap((w) => (w.reason === 'condition_not_in_slice' && w.id.startsWith('condition:')
    ? [{ id: w.id, reason: w.reason, item: w.id.slice('condition:'.length), applies_to: [...(w.applies_to ?? [])].sort() }] : []));
}

const key = (c: GoalPathCause) => JSON.stringify([c.id, c.reason, c.applies_to]);
/** The causes `after` has that `before` did not: a change answers only for what it adds. */
export const addedCauses = (before: readonly GoalPathCause[], after: readonly GoalPathCause[]): GoalPathCause[] =>
  after.filter((c) => !new Set(before.map(key)).has(key(c)));

const CHECK = 'Check each against the person\'s own words. A condition they stated as an assumption the result is worked out under is an '
  + 'assumption, and a doubt to raise is a challenge; only a requirement that must actually be met first stays a prerequisite. Never add '
  + 'or change a figure.';

/** What the AI is told with a draft it can restructure once (words for the AI, never shown to the person). */
export const RESTRUCTURE_DRAFT = `Not saved yet. The goal's chance would be withheld by the prerequisites in goal_path. ${CHECK} `
  + 'Then call build_model_from_brief once more. If every item is right as it is, call it again with the same model and it is saved as it is.';

/** What the AI is told with a change it can restructure once. */
export const RESTRUCTURE_CHANGE = `No card yet. This change would withhold the goal's chance through the prerequisites in goal_path. ${CHECK} `
  + 'Then call propose_change once more. If every item is right as it is, call it again with the same change and its card is made.';

const pathNode = (n: Rec): n is Rec & { id: string; kind: string; label: string } =>
  typeof n.id === 'string' && typeof n.kind === 'string' && typeof n.label === 'string';
const pathEdge = (e: Rec): e is Rec & { from: string; to: string } => typeof e.from === 'string' && typeof e.to === 'string';

/** The options the person compares that reach the goal in their model, by the reader readiness uses (`reachesGoalInPersonsModel`). */
export function optionsReachingGoal(model: LivingModelT, mapped: Mapped): string[] {
  const reach = reachesGoalInPersonsModel({ nodes: mapped.graph.nodes.filter(pathNode), edges: mapped.graph.edges.filter(pathEdge), living_model: model });
  return model.options.filter((o) => o.status === 'feasible' && reach.has(o.id)).map((o) => o.id);
}

/**
 * What the AI is told with a change after which no option reaches the goal any more (marketing on 7ee0d90f, DL 22 Oct: a new
 * measure for the goal removed every link into it and added none, so the approved card cut the goal's path and no Run could
 * start). The person's figures stay on the measure they gave them for; a link of Olumi's carries Olumi's own provisional
 * estimate, labelled as Olumi's, as the estimate rule says.
 */
export const RESTRUCTURE_CUT = 'No card yet. After this change no option reaches the goal (cut lists the links into it that the '
  + 'change removes), so no analysis could run. If the goal\'s new measure changes what those links meant, link what drives the goal '
  + 'to it under that measure: never move a figure the person gave onto a different measure; a link of yours carries your own provisional '
  + 'estimate, labelled as yours. Then call propose_change once more. If the change is right as it is, call it again with the same '
  + 'change and its card is made.';

/**
 * What the AI is told with a change that adds the person's own aim with its target, which becomes the goal (`changeGoal`), when
 * no option reaches it (DL 22 Oct, marketing on 4a4c338c: both aims were added with no links, so no analysis could run).
 */
export const RESTRUCTURE_AIM = 'No card yet. This change adds the person\'s own aim with its target (aim), so it becomes the goal, but '
  + 'no option reaches it, so no analysis could run. Link what drives it to that aim under its measure: never move a figure the '
  + 'person gave onto a different measure; a link of yours carries your own provisional estimate, labelled as yours. Then call '
  + 'propose_change once more. If the change is right as it is, call it again with the same change and its card is made.';
