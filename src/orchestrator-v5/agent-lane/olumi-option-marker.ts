/**
 * ⭐ AN OPTION OLUMI ADDED CARRIES A TYPED MARK ON THE SAVED GRAPH: `proposed_by: 'olumi'` (DL #72 5887489508 +
 * 5887510885 + 5887534233; Canonical 5887528088 / 5887564539; MG 5887738387).
 *
 * The construction contract asks the drafter to add "the strongest alternative the question itself points to", tagged
 * `ai_proposed` ("£54 Pro release" beside the user's keep £49 / raise £59). That tag lived only in the ledger, so the Run
 * had no graph field to tell the user's options from Olumi's, and compared both as if the user had named them. The Run's
 * filter (Runtime) and the analysis hash (Canonical) now read ONE graph field, written here, and never the brief.
 *
 * ⛔ THE TAG IS A HEURISTIC, NOT PROOF (AI Quality 5887015488 (a)), so this is the backstop the DL asked MG for: an option
 * is marked only when the BRIEF names neither its label nor a level it sets (`figureTheUserWroteFor`, the door #2284 and
 * #2275 trust). The status quo is never marked (declared, read from its name, stamped `is_baseline`, or setting no level).
 * Anything unclear, such as two
 * options that share a name, is left unmarked, so it stays compared: a wrongly marked user option would be dropped from
 * the comparison, a wrongly unmarked Olumi one is only compared as today.
 *
 * The mark is written ONLY as `'olumi'`, never as `'user'`: a graph with no Olumi option is returned unchanged (the same
 * array), so its analysis hash cannot move. Pure.
 */
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { admittedOptionKeys } from './admitted-option-identity.js';
import { figureTheUserWroteFor } from './stated-by-user.js';
import { labelMatchesBaseline } from '../../cee/transforms/analysis-ready.js';

export const PROPOSED_BY_OLUMI = 'olumi' as const;

type CandidateOption = CandidateModel['options'][number];

/** The canonical labels of the drafter's options that Olumi added, by the four conditions above. */
export function olumiAddedOptionLabels(candidate: CandidateModel, brief: string): ReadonlySet<string> {
  const factorLabels = (candidate.factors ?? []).map((f) => f.label);
  const briefKey = canonicalLabel(brief);
  const levelTheUserWrote = (o: CandidateOption): boolean => (o.interventions ?? []).some((i) => {
    const value = Number(i.value);
    return Number.isFinite(value) && figureTheUserWroteFor(value, i.unit, brief, {
      target: [i.factor_label],
      others: factorLabels.filter((l) => canonicalLabel(l) !== canonicalLabel(i.factor_label)),
    });
  });
  // The drafter often tags "Carry on as now" `ai_proposed` without `is_status_quo`: recognised as admission does.
  const statusQuo = (o: CandidateOption): boolean => o.is_status_quo === true || labelMatchesBaseline(o.label ?? '');
  // An option that sets no level is never marked: an undeclared status quo is inert ("Carry on as now" is not a readiness
  // idiom, and admission holds it through repair edges), and an option with no level is not compared anyway.
  const setsALevel = (o: CandidateOption): boolean => (o.interventions ?? []).some((i) => Number.isFinite(Number(i.value)));
  const options = candidate.options ?? [];
  const count = new Map<string, number>();
  for (const o of options) count.set(canonicalLabel(o.label ?? ''), (count.get(canonicalLabel(o.label ?? '')) ?? 0) + 1);
  return new Set(options
    .filter((o) => typeof o.label === 'string' && canonicalLabel(o.label) !== '')
    .filter((o) => count.get(canonicalLabel(o.label)) === 1)
    .filter((o) => o.provenance === 'ai_proposed' && !statusQuo(o) && setsALevel(o))
    .filter((o) => !briefKey.includes(canonicalLabel(o.label)) && !levelTheUserWrote(o))
    .map((o) => canonicalLabel(o.label)));
}

/**
 * The admitted graph's nodes with `proposed_by: 'olumi'` on each option node Olumi added. A node is marked only when
 * exactly one option node carries that name, and never on a node stamped `is_baseline` or carrying a brief quote;
 * otherwise nothing is marked for it.
 */
export function markOlumiOptions<N extends { readonly kind?: unknown; readonly label?: unknown; readonly description?: unknown; readonly is_baseline?: unknown; readonly source_quote?: unknown }>(
  nodes: readonly N[], candidate: CandidateModel, brief: string,
): readonly N[] {
  const olumi = olumiAddedOptionLabels(candidate, brief);
  if (olumi.size === 0) return nodes;
  const optionKeys = admittedOptionKeys(nodes, candidate.options ?? []);
  // A node carrying the brief's words for it (`option-lineage.ts`) is the user's, whatever the drafter tagged it.
  const marks = (n: N): boolean => {
    const key = optionKeys.get(n);
    return n.is_baseline !== true && n.source_quote === undefined && key !== undefined && olumi.has(key);
  };
  if (!nodes.some(marks)) return nodes;
  return nodes.map((n) => (marks(n) ? { ...n, proposed_by: PROPOSED_BY_OLUMI } : n));
}
