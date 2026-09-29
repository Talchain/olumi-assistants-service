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
  const carriesEffect = new Set(candidate.links.filter((l) => canon(l.from) !== canon(l.to)).map((l) => canon(l.from)));
  const renamed: KeptApart[] = [];
  const to = new Map<string, string>();
  const plan = (label: string, kind: KeptApart['kind']): void => {
    const option = optionNames.get(canon(label));
    if (option === undefined || to.has(canon(label)) || !carriesEffect.has(canon(label))) return;
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
