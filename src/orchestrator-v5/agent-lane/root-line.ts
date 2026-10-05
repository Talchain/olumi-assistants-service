/**
 * ⛔ GATE 2: THE TREATED-AS-ZERO LINE REACHES THE USER WHOLE, OR NOT WITH ITS LABEL (Codex #2577 rounds 2-3).
 *
 * `treatedAsZeroLine` quotes the user's own node labels. A label is user text, and every editor the reply passes after
 * the line is placed reads text: the proposal-id scrub (`withoutProposalIds`), the at-rest marker parse (`textAtRest`),
 * the withheld-leader ranking drop (`dropRankingSentences`), the shared leader gate (keyed on option names) and the
 * leader enforcement (`textAssertsLeadingOption`, the vocabulary its deleting consumers read). A label such as
 * `Hire a Tech Lead leads. Demand falls`, one holding a `prop_…` id, or
 * one holding "Questions this model does not answer yet:" was rewritten, cut or truncated by one of them.
 *
 * So the labelled line is said only when EVERY one of those editors leaves it byte-identical, in the strictest posture
 * (the leader withheld). Otherwise the label-free form is said: the disclosure and the ask survive, the label does not.
 * Structural, not a wording rule: the editors themselves decide, and none of them is changed. One helper for the live Run
 * turn and its replay, from the same readback, so both say the same words.
 */

import { readinessViewOf, treatedAsZeroLine } from './readiness-view.js';
import { withoutProposalIds } from './display-ids.js';
import { textAtRest } from './decision-input-ask.js';
import { dropRankingSentences, rankingLabelContext } from './withheld-leader-fail-closed.js';
import { textAssertsLeadingOption } from '../compose/leading-option-egress-guard.js';
import { optionRosterFromGraph, textNamesAnOption } from '../compose/leading-option-wire-enforcement.js';

/**
 * The label-free form, said only when a label would not survive the reply's editors. Science's words (5 Oct): the
 * disclosure stays; the question does not, since an input the reply cannot name cannot be answered without guessing
 * which. The count is the typed roots' (`unvalued_roots`), never counted from prose.
 */
export const TREATED_AS_ZERO_UNNAMED_ONE =
  'One input on your goal’s path has no figure yet, so the analysis treats it as zero. Give it a figure on the canvas to include it.';
export const treatedAsZeroUnnamedMany = (n: number): string =>
  `${n} inputs on your goal’s path have no figures yet, so the analysis treats them as zero. Give each a figure on the canvas to include it.`;

/** Does every editor after placement leave `line` byte-identical, with the leader withheld? */
export function survivesReplyEditors(line: string, graph: unknown, analysisReady: unknown): boolean {
  if (line.includes('\n')) return false;
  if (withoutProposalIds(line) !== line) return false;
  if (textAtRest(line) !== line) return false;
  if (dropRankingSentences(line, rankingLabelContext(graph, analysisReady)).droppedSentences !== 0) return false;
  if (textNamesAnOption(line, optionRosterFromGraph(graph))) return false;
  // The leader vocabulary as the DELETING consumers read it (`textAssertsLeadingOption`: the egress vocabulary minus its
  // documented false-positive spans, "leads to" and "tech/team lead(s)"). The egress alarm's wider net only observes, so
  // it edits nothing; reading it here suppressed real labels such as Paul's "Tech leads" (a994c38a; #2581 r1).
  return !textAssertsLeadingOption(line);
}

/**
 * The Run reply's treated-as-zero line for this readback: `treatedAsZeroLine`'s words when they survive the reply's
 * editors and every label it quotes says something, else the label-free form with the same count; `null` when no root
 * is treated as zero. A blank label quoted as `""` names nothing and asks about nothing (Codex #2581 r3), so it takes the
 * label-free form too; only the first two labels are ever quoted ("and N more" counts the rest).
 */
export function treatedAsZeroReplyLine(graph: unknown, analysisReady: unknown): string | null {
  const view = readinessViewOf(graph);
  const labelled = treatedAsZeroLine(view);
  if (labelled === null) return null;
  const quoted = (view.treated_as_zero ?? []).slice(0, 2);
  const quotesBlank = quoted.some((label) => label.replace(/\s+/g, ' ').trim() === '');
  if (!quotesBlank && survivesReplyEditors(labelled, graph, analysisReady)) return labelled;
  const n = (view.treated_as_zero ?? []).length;
  return n === 1 ? TREATED_AS_ZERO_UNNAMED_ONE : treatedAsZeroUnnamedMany(n);
}
