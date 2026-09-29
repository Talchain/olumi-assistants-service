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
import type { CandidateModel } from './admit-model.js';

const canon = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export interface KeptApart {
  readonly option: string;
  readonly kind: 'factor' | 'risk' | 'outcome';
  readonly from: string;
  readonly to: string;
}

export function keepOptionsAndQuantitiesApart(candidate: CandidateModel): { readonly model: CandidateModel; readonly renamed: readonly KeptApart[] } {
  const optionNames = new Map(candidate.options.map((o) => [canon(o.label), o.label] as const));
  const taken = new Set<string>([
    ...candidate.options.map((o) => canon(o.label)),
    ...candidate.factors.map((f) => canon(f.label)),
    ...candidate.risks.map((r) => canon(r.label)),
    ...candidate.outcomes.map((o) => canon(o.label)),
    canon(candidate.goal.metric),
  ]);
  const onlyAQuantityHolds = new Set([canon(candidate.goal.metric), ...candidate.outcomes.map((o) => canon(o.label))]);
  // A self-link on the shared name ("Discount -> Discount") is the option-to-factor or self-loop claim the loop handling
  // owns; renaming it would re-source it as a factor self-loop, so it fails the rename closed like any other ambiguous
  // link (PR Review CHANGES_REQUIRED on #2281 @ e73b6dbd).
  const carriesEffect = (name: string): boolean => {
    const out = candidate.links.filter((l) => canon(l.from) === name);
    return out.length > 0
      && out.every((l) => canon(l.to) !== name && onlyAQuantityHolds.has(canon(l.to)) && !optionNames.has(canon(l.to)));
  };
  const renamed: KeptApart[] = [];
  const to = new Map<string, string>();
  const plan = (label: string, kind: KeptApart['kind']): void => {
    const option = optionNames.get(canon(label));
    if (option === undefined || to.has(canon(label)) || !carriesEffect(canon(label))) return;
    const suffix = kind === 'risk' && !/\brisk$/i.test(label.trim()) ? ' risk' : ' level';
    let next = `${label.trim()}${suffix}`;
    for (let n = 2; taken.has(canon(next)); n += 1) next = `${label.trim()}${suffix} ${n}`;
    taken.add(canon(next));
    to.set(canon(label), next);
    renamed.push({ option, kind, from: label, to: next });
  };
  candidate.factors.forEach((f) => plan(f.label, 'factor'));
  candidate.risks.forEach((r) => plan(r.label, 'risk'));
  candidate.outcomes.forEach((o) => plan(o.label, 'outcome'));
  if (renamed.length === 0) return { model: candidate, renamed };
  const re = (label: string): string => to.get(canon(label)) ?? label;
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
    links: candidate.links.map((l) => ({ ...l, from: re(l.from), to: re(l.to) })),
    constraints: candidate.constraints.map((c) => ({ ...c, metric: re(c.metric) })),
    ...(candidate.identities !== undefined
      ? { identities: candidate.identities.map((i) => ({ ...i, outcome: re(i.outcome), factors: i.factors.map(re) })) }
      : {}),
  };
  return { model, renamed };
}

/** The line said for each rename (`not_represented`, suffix `.label_kept_apart`). */
export function keptApartLine(k: KeptApart): string {
  return `"${k.option}" names both an option and the ${k.kind} it acts on, so the ${k.kind} is called "${k.to}" to keep the two apart.`;
}
