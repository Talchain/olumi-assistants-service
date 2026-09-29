/**
 * ⛔ AN OPTION OLUMI ADDED IS PROPOSED, NEVER COMPARED, UNTIL THE USER ACCEPTS IT (PTL #72 5886601943 root 2; DL 5886577370;
 * AI Quality 5886555442 + 5887015488 meaning ACK).
 *
 * The construction contract asks the drafter to add "the strongest alternative the question itself points to", tagged
 * `ai_proposed` ("£54 Pro release" beside the user's keep £49 / raise £59). Admitted, it was compared: the win % and the
 * leader were computed over an option the user never named, and the demo read "no option put forward". So before
 * admission reads the candidate, a non-status-quo option tagged `ai_proposed` is taken OUT of the model and returned as a
 * proposal ("Olumi suggests also comparing ‹label›: add it?"). Nothing is computed for it: no Run, win %, mean or leader.
 *
 * ⛔ THE TAG IS A HEURISTIC, NOT PROOF (AIQ 5887015488 (a)): an option stays compared whatever its tag when the BRIEF
 * names its label, or states one of its levels for the factor it sets (`figureTheUserWroteFor`, the door #2284 and
 * #2275 trust). The status quo is never held (recognised as admission does). And nothing is held unless one of the user's
 * own options still sets a level, so the Run always has the user's options to compare. Pure.
 */
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { figureTheUserWroteFor } from './stated-by-user.js';
import { labelMatchesBaseline } from '../../cee/transforms/analysis-ready.js';

export interface ProposedOption {
  readonly label: string;
  readonly levels: readonly { readonly factor: string; readonly value: number; readonly unit?: string }[];
}

type CandidateOption = CandidateModel['options'][number];

export function holdOlumiOptions(candidate: CandidateModel, brief: string): { readonly model: CandidateModel; readonly proposed: readonly ProposedOption[] } {
  const factorLabels = candidate.factors.map((f) => f.label);
  const briefKey = canonicalLabel(brief);
  const levelTheUserWrote = (o: CandidateOption): boolean => (o.interventions ?? []).some((i) => {
    const value = Number(i.value);
    return Number.isFinite(value) && figureTheUserWroteFor(value, i.unit, brief, {
      target: [i.factor_label],
      others: factorLabels.filter((l) => canonicalLabel(l) !== canonicalLabel(i.factor_label)),
    });
  });
  // The status quo is recognised exactly as admission recognises it (declared, or read as one by the readiness idioms,
  // `labelMatchesBaseline`): the drafter often tags "Carry on as now" `ai_proposed` without `is_status_quo`.
  const statusQuo = (o: CandidateOption): boolean => o.is_status_quo === true || labelMatchesBaseline(o.label ?? '');
  const olumis = (o: CandidateOption): boolean =>
    !statusQuo(o)
    && o.provenance === 'ai_proposed'
    && !briefKey.includes(canonicalLabel(o.label))
    && !levelTheUserWrote(o);
  const held = candidate.options.filter(olumis);
  if (held.length === 0) return { model: candidate, proposed: [] };
  // Never leave the user nothing to compare: at least one of THEIR options (not the status quo) must still set a level,
  // or the Run would refuse "too few to compare" (measured on the real cloud-1 draft). Otherwise nothing is held.
  const analysable = (o: CandidateOption): boolean => (o.interventions ?? []).some((i) => Number.isFinite(Number(i.value)));
  if (!candidate.options.some((o) => !statusQuo(o) && !olumis(o) && analysable(o))) return { model: candidate, proposed: [] };
  const proposed = held.map((o) => ({
    label: o.label,
    levels: (o.interventions ?? [])
      .filter((i) => Number.isFinite(Number(i.value)))
      .map((i) => ({ factor: i.factor_label, value: Number(i.value), ...(typeof i.unit === 'string' ? { unit: i.unit } : {}) })),
  }));
  return { model: { ...candidate, options: candidate.options.filter((o) => !olumis(o)) }, proposed };
}

/** The sentence the user always sees (`open_questions`), in AI Quality's words (5887015488 (2)). */
export function proposedOptionLine(p: ProposedOption): string {
  return `Olumi suggests also comparing "${p.label}": add it?`;
}
