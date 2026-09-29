/**
 * Agent lane — may this model be analysed, and with what caveat?
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ WHY A POLICY IS NEEDED AND NOT JUST A LEDGER.
 *
 * Recording a representation loss changes nothing on its own: PLoT will happily
 * compute over projected magnitudes and return a confident leading option. The
 * ledger has to be able to STOP or QUALIFY a run, or "we recorded it" becomes a
 * footnote under a fabricated result.
 *
 * Measured on the admitted capture (22 Sep 2026, first live run of the banked
 * chain — not a contrived input):
 *
 *   nodes 25 · edges 14 · defaulted magnitudes 14/14 (100%)
 *   edges into the goal 3 · of which projected 3
 *   goal_constraints attached 0
 *   withheld links 1 — `pro_plan_price -> monthly_churn_rate`
 *
 * Read that last line against the brief. The user is deciding whether to raise
 * the price, under a churn constraint. The ONE link the decision turns on —
 * price to churn — is the link that cannot be admitted, because the builder
 * marked its direction `unknown` and no honest magnitude exists. Meanwhile the
 * constraint that governs churn did not attach.
 *
 * So an analysis of this model would rank pricing options using 14 machine-
 * authored magnitudes, with the decisive causal link absent and the user's own
 * constraint unenforced — and it would look authoritative. That is the exact
 * failure this lane exists to avoid, so the verdict here is `withheld`, with the
 * reasons named in the user's terms.
 *
 * ⛔ `withheld` IS A SUCCESSFUL OUTCOME. It is not an error state and must not be
 * reported as a failure, retried, or "fixed" by loosening a rule. The honest
 * repair is upstream: elicit the missing direction, or resolve the constraint
 * target — both of which are questions for the user.
 */

import type { RepairEntry } from '@talchain/schemas';
import type { AdmittedModel } from './admit-model.js';

/** Percentage of defaulted magnitudes at which results must carry a caveat. */
export const DEFAULTED_LIMIT_PERCENT = 50;

export type AnalysisVerdict = 'ready' | 'limited' | 'withheld';

export interface AdmissibilityReason {
  readonly code:
    | 'goal_reachable_only_by_projection'
    | 'user_constraint_not_enforced'
    | 'decisive_link_withheld'
    | 'majority_magnitudes_projected'
    | 'existence_priors_projected';
  /** Stated in the user's terms, not the schema's. */
  readonly message: string;
}

export interface AdmissibilityResult {
  readonly verdict: AnalysisVerdict;
  readonly reasons: readonly AdmissibilityReason[];
  /** Carried through so a caller never has to re-derive it. */
  readonly loss: readonly RepairEntry[];
}

export function assessAnalysisAdmissibility(model: AdmittedModel): AdmissibilityResult {
  const reasons: AdmissibilityReason[] = [];
  const goal = model.nodes.find((n) => n.kind === 'goal');
  const edgesIntoGoal = goal === undefined ? [] : model.edges.filter((e) => e.to === goal.id);
  const projectedIntoGoal = edgesIntoGoal.filter((e) => e.defaulted === true);

  // 1. Nothing authored connects anything to the goal.
  if (edgesIntoGoal.length > 0 && projectedIntoGoal.length === edgesIntoGoal.length) {
    reasons.push({
      code: 'goal_reachable_only_by_projection',
      message:
        `Every link into "${goal?.label}" carries a strength this system chose, not one you or ` +
        `your evidence supplied (${projectedIntoGoal.length} of ${edgesIntoGoal.length}). ` +
        `Ranking the options would be reporting our own assumptions back to you as a result.`,
    });
  }

  // 2. A constraint the user set is not being enforced.
  if (model.loss.some((l) => l.field_path.endsWith('.node_id') && l.severity === 'warn')) {
    reasons.push({
      code: 'user_constraint_not_enforced',
      message:
        'A limit you set could not be attached to anything in the model, so the analysis would ' +
        'not be holding you to it. Which measure it refers to is a question for you, not a guess ' +
        'for us to make.',
    });
  }

  // 3. A link was withheld because nobody authored its direction.
  for (const w of model.withheld) {
    if (w.reason === 'no_authored_direction') {
      reasons.push({
        code: 'decisive_link_withheld',
        message:
          `The relationship between "${w.from}" and "${w.to}" is in the model as a question, not ` +
          `an answer: nothing states which way it runs. It is left out rather than guessed, so any ` +
          `result would be answering a different question from the one you asked.`,
      });
    }
  }

  // 4. Most magnitudes are projections — a caveat even when the above do not fire.
  //
  // ⛔ NOT "placeholders at the standard value (0.5)" any more (magnitude contract, D6): a placeholder is now sized to
  // its target's range, and `defaulted` also marks an estimate whose spread is Olumi's. So the sentence names what
  // is true of every marked edge — some figure on it is this system's — and no single value.
  const projected = model.edges.filter((e) => e.defaulted === true).length;
  const percent = model.edges.length === 0 ? 0 : (projected / model.edges.length) * 100;
  if (percent >= DEFAULTED_LIMIT_PERCENT) {
    reasons.push({
      code: 'majority_magnitudes_projected',
      message:
        `${projected} of ${model.edges.length} link strengths rest on a figure this system chose ` +
        `(an estimate, a placeholder or a spread), not a measurement. Results would show the ` +
        `shape of your reasoning, not its size.`,
    });
  }

  // 5. The probability that each link EXISTS AT ALL is ours, not theirs.
  //
  // ⛔ This was missed entirely at first: the policy read only `e.defaulted`,
  // which was set only when the MEAN was projected. An edge with an authored mean
  // carried an unauthored `exists_probability` and the verdict came back `ready`
  // with zero reasons — PLoT computing over machine-chosen link-existence priors
  // with nothing said to the user. Found by adversarially auditing this lane.
  const existenceProjected = model.loss.filter((l) =>
    l.field_path.endsWith('.exists_probability'),
  ).length;
  if (existenceProjected > 0) {
    reasons.push({
      code: 'existence_priors_projected',
      message:
        `For ${existenceProjected} link${existenceProjected === 1 ? '' : 's'}, how likely the link ` +
        `exists at all is a value this system chose, not one you or your evidence supplied. ` +
        `Results would carry that assumption invisibly.`,
    });
  }

  // Any reason other than the bare caveats withholds the run.
  const CAVEAT_ONLY: readonly AdmissibilityReason['code'][] = [
    'majority_magnitudes_projected',
    'existence_priors_projected',
  ];
  const withholding = reasons.filter((r) => !CAVEAT_ONLY.includes(r.code));
  const verdict: AnalysisVerdict =
    withholding.length > 0 ? 'withheld' : reasons.length > 0 ? 'limited' : 'ready';

  return { verdict, reasons, loss: model.loss };
}
