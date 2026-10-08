/**
 * ⛔ AN OPTION AND A QUANTITY NEVER SHARE A NAME — OR ADMISSION MAKES THEM ONE NODE (Canvas #72 5884644099, the
 * morning-path cloud-bill brief; reproduced 2/3 on the live route, MG 29 Sep).
 *
 * "…or renegotiate our enterprise discount with the provider" drafted the OPTION "Enterprise discount" AND the FACTOR it
 * sets, "Enterprise discount". Admission gives one id per canonical label (`assignIds`: "the same thing, spelled
 * differently"), so the factor vanished into the option: its intervention pointed at the option itself and was lost,
 * and the drafter's factor → goal link became option → goal. The model read "an option has no factor connections"
 * and could not be run. An option (the act) and a quantity (what it sets) are never the same thing.
 *
 * So before anything reads the candidate's labels, a factor, risk or outcome whose name is an option's name is renamed
 * EVERYWHERE the candidate names it — its own entry, every option's `interventions[].factor_label` and `changes`,
 * every link end, every limit's `metric`, every identity — to "<name> level" (a risk: "<name> risk"), and the rename is
 * said. The option keeps the user's words. The goal is never renamed (a goal named like an option is left as it is).
 * Measured: 3 of 412 saved construction outputs (Canvas's brief 2/3). Pure.
 *
 * Only a quantity that CARRIES A DRAWN EFFECT (it is the `from` of a link to something else) is renamed: that effect
 * is what the merge loses. A same-named quantity with no effect of its own (served journey C, "Advertising investment",
 * `construction-option-self-loop.test.ts`) is left to the loop handling, which withholds the self-link and says so;
 * renaming it would only keep an orphan that no path joins to the goal, and readiness would refuse Run on it.
 *
 * ⭐ (DL ruling, dental brief) Such a link no longer refuses the build: see `SetAsideLink`. Only a name carried by more than
 * one other item (`because: 'owners'`) still fails closed, since no link, level or limit naming it can be given to one.
 *
 * ⛔ A LINK FROM THE SHARED NAME IS AMBIGUOUS UNLESS ONLY THE QUANTITY CAN HOLD IT (PR Review CHANGES_REQUIRED on
 * #2281 @ bcd8d856). `links[].from` is an untyped label, so "Discount -> Churn risk" may be the option's link:
 * admission reads option -> factor as what the option sets and option -> risk as a shortcut it folds or asks about.
 * Rewriting that link to start at "Discount level" would silently change its source. So the rename happens only when
 * EVERY link from the shared name ends at the goal or an outcome: an option never holds such a link (options act
 * only through factors; merged, cloud3's became a dead option -> goal edge and the blocker), so it can only be the
 * quantity's. Any link from the shared name to a factor, a risk, an option, an unnamed label, or the shared name
 * ITSELF (a self-link) fails closed: the candidate is left exactly as it came. The new name never collides: "<name>
 * level" already in the draft becomes "<name> level 2" (AI Quality 5885116642's collision row), so the renamed
 * quantity cannot merge into another node one label later.
 */
import { canonicalLabel, limitedOutcomeFrame, metricNamesLabel, type CandidateModel } from './admit-model.js';
import { isDraftLikelihoodFactorLabel } from './olumi-event-risk-draft.js';

/** Admission's OWN key (`assignIds` merges labels equal under it), so a clash or a collision cannot hide from this rule. */
const canon = canonicalLabel;

export interface KeptApart {
  readonly option: string;
  readonly kind: 'factor' | 'risk' | 'outcome';
  readonly from: string;
  readonly to: string;
}

/**
 * An option's name the rename cannot safely separate: more than one other item owns it (`owners`), or one does and a link
 * drawn from the name could be the option's (`links`). ⛔ FAIL CLOSED AT REGISTRATION (PR Review CHANGES_REQUIRED on
 * #2281 @ b3f0c2ab): admission gives every canonical-equal label one id, so registering it would silently lose the
 * factor or risk. The build refuses (`option_name_ambiguous`) with the reason, and nothing is saved.
 */
/**
 * ⭐ A LINK SET ASIDE, NOT A BUILD REFUSED (DL ruling on the dental brief; Acceptance e7, prod CEE b38592e: 3 of 3 first drafts
 * of a guest's brief refused, "Missed-appointment fee" option + factor). When ONE quantity shares the option's name and a
 * link drawn from that name could be the option's (to a factor, a risk, an option, an unnamed label, or the name itself),
 * the quantity is still renamed and keeps every link only it can hold (to the goal or an outcome); each link the option
 * could hold is SET ASIDE — left out of the model, said, and asked about — never re-sourced (PR Review #2281 row 8's
 * concern: re-sourcing would assert a mechanism) and never the reason nothing is saved.
 */
export interface SetAsideLink {
  readonly option: string;
  /** The quantity's new name ("Missed-appointment fee level"). */
  readonly renamed: string;
  readonly to: string;
  /** A link from the shared name to itself: said, never asked (it is no question either could answer). */
  readonly self: boolean;
  /** DL #2655 (6010980882): held across a retry that renamed the quantity with no single new name. Said, never asked. */
  readonly unasked?: true;
}

export interface NotToldApart {
  readonly option: string;
  /** What else carries the name, e.g. ['factor', 'risk'], ['factor', 'factor'], ['factor', 'goal'], ['factor', 'option']. */
  readonly owners: readonly string[];
  readonly because: 'owners' | 'links';
}

export function keepOptionsAndQuantitiesApart(candidate: CandidateModel): {
  readonly model: CandidateModel; readonly renamed: readonly KeptApart[]; readonly ambiguous: readonly NotToldApart[];
  readonly setAside: readonly SetAsideLink[];
} {
  // The FIRST option spelled this way keeps its words (the order the user's options came in).
  const optionNames = new Map([...candidate.options].reverse().map((o) => [canon(o.label), o.label] as const));
  const taken = new Set<string>([
    ...candidate.options.map((o) => canon(o.label)),
    ...candidate.factors.map((f) => canon(f.label)),
    ...candidate.risks.map((r) => canon(r.label)),
    ...candidate.outcomes.map((o) => canon(o.label)),
    canon(candidate.goal.metric),
  ]);
  // ⛔ Codex r1 #2655 P1: an outcome a stated limit names is admitted as an observable FACTOR (`limitedOutcomeFrame`), which
  // an option can act on directly, so only the outcomes admission keeps as outcomes are held by the quantity alone.
  // Codex r2: by admission's MERGED key, so a spelling the limit does not name ("Monthly  churn") is re-kinded with the one it does.
  const rekinded = new Set(candidate.outcomes.filter((o) => candidate.constraints.some((c) => metricNamesLabel(c.metric, o.label) && limitedOutcomeFrame(c) !== undefined))
    .map((o) => canon(o.label)));
  const keptAnOutcome = (label: string): boolean => !rekinded.has(canon(label));
  const onlyAQuantityHolds = new Set([canon(candidate.goal.metric), ...candidate.outcomes.filter((o) => keptAnOutcome(o.label)).map((o) => canon(o.label))]);
  // What the links drawn FROM the shared name say. `none`: nothing but (at most) a self-link, the served journey-C shape
  // the loop handling owns (it withholds the self-link, says it and asks). `quantity`: every link ends at the goal or an
  // outcome, which only the quantity can hold, so the rename is safe. `ambiguous`: any link to a factor, a risk, an
  // option, an unnamed label, or the name itself beside another link (PR Review @ e73b6dbd), which the option could hold.
  const linksFrom = (name: string): 'none' | 'quantity' | 'ambiguous' => {
    const out = candidate.links.filter((l) => canon(l.from) === name);
    if (out.every((l) => canon(l.to) === name)) return 'none';
    return out.every((l) => canon(l.to) !== name && onlyAQuantityHolds.has(canon(l.to)) && !optionNames.has(canon(l.to)))
      ? 'quantity' : 'ambiguous';
  };
  const renamed: KeptApart[] = [];
  const to = new Map<string, string>();
  // ⛔ ONE OTHER OWNER ONLY (PR Review CHANGES_REQUIRED on #2281 @ 97bff479: option + factor + risk all "Discount" renamed
  // BOTH quantities to "Discount level", and admission kept one, so the risk vanished). When the option's name is also
  // carried by more than one quantity (of any kinds), or by a quantity AND the goal, or by a second option, no link,
  // level or limit naming it can be given to one of them: nothing is renamed, and the ambiguity is SAID.
  const quantityKinds = (key: string): string[] => [
    ...candidate.factors.filter((f) => canon(f.label) === key).map(() => 'factor'),
    ...candidate.risks.filter((r) => canon(r.label) === key).map(() => 'risk'),
    ...candidate.outcomes.filter((o) => canon(o.label) === key).map(() => 'outcome'),
  ];
  const ownersBesideTheOption = (key: string): string[] => [
    ...quantityKinds(key),
    ...(canon(candidate.goal.metric) === key ? ['goal'] : []),
    ...candidate.options.filter((o) => canon(o.label) === key).slice(1).map(() => 'option'),
  ];
  const ambiguous: NotToldApart[] = [];
  // Names whose links are SPLIT: the quantity keeps those only it can hold, the rest are set aside.
  const split = new Set<string>();
  const plan = (label: string, kind: KeptApart['kind']): void => {
    const option = optionNames.get(canon(label));
    if (option === undefined || to.has(canon(label))) return;
    const owners = ownersBesideTheOption(canon(label));
    if (owners.length > 1) {
      if (!ambiguous.some((a) => canon(a.option) === canon(option))) ambiguous.push({ option, owners, because: 'owners' });
      return;
    }
    const links = linksFrom(canon(label));
    if (links === 'none') return;
    if (links === 'ambiguous') split.add(canon(label));
    const suffix = kind === 'risk' && !/\brisk$/i.test(label.trim()) ? ' risk' : ' level';
    let next = `${label.trim()}${suffix}`;
    for (let n = 2; taken.has(canon(next)); n += 1) next = `${label.trim()}${suffix} ${n}`;
    taken.add(canon(next));
    to.set(canon(label), next);
    renamed.push({ option, kind, from: label, to: next });
  };
  // Event admission removes and discloses these original drafted labels; do not disguise them as levels.
  candidate.factors.filter(f => !isDraftLikelihoodFactorLabel(f.label)).forEach((f) => plan(f.label, 'factor'));
  candidate.risks.forEach((r) => plan(r.label, 'risk'));
  candidate.outcomes.forEach((o) => plan(o.label, 'outcome'));
  if (renamed.length === 0) return { model: candidate, renamed, ambiguous, setAside: [] };
  const re = (label: string): string => to.get(canon(label)) ?? label;
  // A link from a SPLIT name the option could hold: set aside (and said), never re-sourced to the quantity.
  const setAside: SetAsideLink[] = [];
  const optionHolds = (l: { from: string; to: string }): boolean => split.has(canon(l.from))
    && (canon(l.to) === canon(l.from) || !onlyAQuantityHolds.has(canon(l.to)) || optionNames.has(canon(l.to)));
  // ⛔ Codex r1 #2655 P1: a link to a quantity the option already acts on (its own intervention or change) is the option's
  // own stated action, which admission draws from that action: it is neither set aside (it IS in the model) nor re-sourced
  // to the quantity (that would assert a mechanism).
  const optionActsOn = (l: { from: string; to: string }): boolean => canon(l.to) !== canon(l.from) && candidate.options.some((o) => canon(o.label) === canon(l.from)
    && [...(o.interventions ?? []).map((i) => i.factor_label), ...(o.changes ?? [])].some((f) => canon(f) === canon(l.to)));
  const setAsideOnly = (l: { from: string; to: string }): boolean => optionHolds(l) && !optionActsOn(l);
  for (const l of candidate.links) {
    // Codex r1 #2655 P2: one relationship is said and asked once, however many times it was drawn.
    if (!setAsideOnly(l) || setAside.some((a) => canon(a.option) === canon(l.from) && canon(a.to) === canon(l.to))) continue;
    setAside.push({ option: optionNames.get(canon(l.from))!, renamed: re(l.from), to: l.to, self: canon(l.to) === canon(l.from) });
  }
  const model: CandidateModel = {
    ...candidate,
    factors: candidate.factors.map((f) => ({ ...f, label: re(f.label) })),
    risks: candidate.risks.map((r) => ({ ...r, label: re(r.label) })),
    outcomes: candidate.outcomes.map((o) => ({ ...o, label: re(o.label) })),
    options: candidate.options.map((o) => ({
      ...o,
      ...(o.interventions !== undefined ? { interventions: o.interventions.map((i) => ({ ...i, factor_label: re(i.factor_label) })) } : {}),
      ...(o.changes !== undefined ? { changes: o.changes.map(re) } : {}),
    })),
    links: candidate.links.filter((l) => !optionHolds(l)).map((l) => ({ ...l, from: re(l.from), to: re(l.to) })),
    constraints: candidate.constraints.map((c) => ({ ...c, metric: re(c.metric) })),
    ...(candidate.identities !== undefined
      ? { identities: candidate.identities.map((i) => ({ ...i, outcome: re(i.outcome), factors: i.factors.map(re) })) }
      : {}),
  };
  return { model, renamed, ambiguous, setAside };
}

/** What is said for a link set aside (`not_represented`, suffix `.link_set_aside`). */
export function setAsideLinkLine(a: SetAsideLink): string {
  if (a.unasked === true) return `The link from "${a.option}" to "${a.to}" was set aside: it is not in the model.`;
  return a.self
    ? `A link from "${a.option}" to itself was set aside: it is not in the model.`
    : `The link from "${a.option}" to "${a.to}" could be the option's own or "${a.renamed}"'s, so it is set aside and not in the model yet.`;
}

/** The one question asked for it (`open_questions`), never for a self-link. */
export function setAsideLinkQuestion(a: SetAsideLink): string | null {
  // ⛔ No promise to draw it (DL pre-check #2655): the link door asks for the user's own strength and direction first.
  return a.self || a.unasked === true ? null : `Does "${a.option}" change "${a.to}" directly, or through "${a.renamed}"? Until you say, that link is not in the model.`;
}

/**
 * ⛔ AN ADOPTED RETRY KEEPS WHAT THE FIRST DRAFT SET ASIDE (Codex r1 #2655 P1). The retry is drafted from the renamed
 * candidate, the set-aside link already gone, so its own pass finds nothing to rename or set aside; and a retry that draws
 * a link between those ends, from the option or from the renamed quantity, is Olumi's guess at the very mechanism asked
 * about. Each rename and set-aside whose names the retry still carries is kept (said, and asked, again), and every retry
 * link between set-aside ends is removed. One whose option or other end the retry no longer carries is left to its own pass.
 * ⛔ Codex r2 #2655, the same guess by other means:
 *   · the retry makes the option ACT on the held end (a change or an intervention the first draft did not have, or the link
 *     would not have been set aside): that action is removed, so admission never draws the link the words say is absent;
 *   · the retry RENAMES the quantity (only a compaction can: a repair that sheds an action is never adopted,
 *     `keepsEveryAction`): the hold follows it when the option sets exactly ONE quantity the first draft did not name (said
 *     and asked under the new name); otherwise no question can be put in the retry's names, so the option's own link to
 *     that end is still never drawn, and that is SAID, never asked (DL #2655 6010980882).
 */
export function holdAcrossRetry(
  model: CandidateModel,
  first: { readonly model: CandidateModel; readonly renamed: readonly KeptApart[]; readonly setAside: readonly SetAsideLink[] },
  own: { readonly renamed: readonly KeptApart[]; readonly setAside: readonly SetAsideLink[] },
): { readonly model: CandidateModel; readonly renamed: readonly KeptApart[]; readonly setAside: readonly SetAsideLink[] } {
  const namesOf = (m: CandidateModel): Set<string> => new Set([canon(m.goal.metric), ...m.options.map((o) => canon(o.label)),
    ...m.factors.map((f) => canon(f.label)), ...m.risks.map((r) => canon(r.label)), ...m.outcomes.map((o) => canon(o.label))]);
  const names = namesOf(model);
  const before = namesOf(first.model);
  const setBy = (option: string): string[] => model.options.filter((o) => canon(o.label) === canon(option))
    .flatMap((o) => [...(o.interventions ?? []).map((i) => i.factor_label), ...(o.changes ?? [])]);
  const held: SetAsideLink[] = [];
  const optionOnly: SetAsideLink[] = [];
  for (const a of first.setAside) {
    if (!names.has(canon(a.option)) || !names.has(canon(a.to))) continue;
    if (names.has(canon(a.renamed))) { held.push(a); continue; }
    if (a.self) continue;
    const fresh = [...new Set(setBy(a.option).filter((f) => !before.has(canon(f)) && names.has(canon(f))).map(canon))];
    const next = fresh.length === 1 ? [...model.factors, ...model.risks, ...model.outcomes].find((q) => canon(q.label) === fresh[0]) : undefined;
    if (next === undefined) { optionOnly.push(a); continue; }
    held.push({ ...a, renamed: next.label });
  }
  const ends = (a: SetAsideLink): Set<string> => new Set([canon(a.option), canon(a.renamed)]);
  const between = (l: { from: string; to: string }): boolean => held.some((a) => ends(a).has(canon(l.from))
    && (a.self ? canon(l.to) === canon(l.from) : canon(l.to) === canon(a.to)))
    || optionOnly.some((a) => canon(l.from) === canon(a.option) && canon(l.to) === canon(a.to));
  const heldEnd = (option: string, f: string): boolean => held.some((a) => !a.self && canon(a.option) === canon(option) && canon(a.to) === canon(f));
  const setAside: SetAsideLink[] = [...held, ...optionOnly.map((a) => ({ ...a, unasked: true as const }))];
  for (const a of own.setAside) if (!setAside.some((b) => canon(b.option) === canon(a.option) && canon(b.to) === canon(a.to))) setAside.push(a);
  const renamed = [...own.renamed];
  for (const k of first.renamed) {
    if (names.has(canon(k.option)) && names.has(canon(k.to)) && !renamed.some((r) => canon(r.to) === canon(k.to))) renamed.push(k);
  }
  return {
    model: {
      ...model,
      links: model.links.filter((l) => !between(l)),
      options: model.options.map((o) => ({
        ...o,
        ...(o.interventions !== undefined ? { interventions: o.interventions.filter((i) => !heldEnd(o.label, i.factor_label)) } : {}),
        ...(o.changes !== undefined ? { changes: o.changes.filter((f) => !heldEnd(o.label, f)) } : {}),
      })),
    },
    renamed, setAside,
  };
}

/** The line said for each rename (`not_represented`, suffix `.label_kept_apart`). */
export function keptApartLine(k: KeptApart): string {
  return `"${k.option}" names both an option and the ${k.kind} it acts on, so the ${k.kind} is called "${k.to}" to keep the two apart.`;
}

const OWNER_WORDS: Record<string, string> = { factor: 'factor', risk: 'risk', outcome: 'outcome', goal: 'goal', option: 'option' };

/** The reason for an `option_name_ambiguous` refusal, one line per name. */
export function notToldApartLine(a: NotToldApart): string {
  const counts = new Map<string, number>();
  for (const o of a.owners) counts.set(o, (counts.get(o) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => (k === 'goal' ? 'the goal' : n === 1 ? `a ${OWNER_WORDS[k]}` : `${n} ${OWNER_WORDS[k]}s`));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  if (a.because === 'links') {
    return `"${a.option}" names an option and also ${list} in this model, and a link from "${a.option}" could belong to either, `
      + 'so they could not be told apart and nothing was saved. Say what the option changes, in different words, and the model can be built.';
  }
  return `"${a.option}" names an option and also ${list} in this model, so they could not be told apart and nothing was saved. `
    + 'Say what each one is, in different words, and the model can be built.';
}
