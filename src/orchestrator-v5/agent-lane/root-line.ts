/**
 * Carry canonical missing-root refusals and their useful next steps through the
 * existing reply editors. Labels that cannot survive those editors use a
 * counted, label-free ask. T4e never presents an unknown root as zero.
 *
 * Historical zero-disclosure constants remain exported for readers of an
 * older Run's explicit GOAL_ANCESTOR_DATA_GAP fact; they do not admit a new Run.
 */

import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { placeholderZeroFactorIds } from '../coaching/unvalued-driver-card.js';
import { treatedAsZeroLine } from './readiness-view.js';
import { withoutProposalIds } from './display-ids.js';
import { textAtRest } from './decision-input-ask.js';
import { sentencesOf } from './reply/compose-reply.js';
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
  // The face composer splits this ask: test each partition as its displayed bullet, including the marker at its start.
  if (sentencesOf(line).some(sentence => textAtRest(`• ${sentence}`) !== `• ${sentence}`)) return false;
  if (dropRankingSentences(line, rankingLabelContext(graph, analysisReady)).droppedSentences !== 0) return false;
  if (textNamesAnOption(line, optionRosterFromGraph(graph))) return false;
  // The leader vocabulary as the DELETING consumers read it (`textAssertsLeadingOption`: the egress vocabulary minus its
  // documented false-positive spans, "leads to" and "tech/team lead(s)"). The egress alarm's wider net only observes, so
  // it edits nothing; reading it here suppressed real labels such as Paul's "Tech leads" (a994c38a; #2581 r1).
  return !textAssertsLeadingOption(line);
}

/** The risk and outcome roots a bound saved Run explicitly treated as zero: a saved fact, never inferred from a missing value. */
export function savedZeroRootIds(graph: unknown, analysisReady: unknown, analysisResult?: unknown): ReadonlySet<string> {
  const nodes = graph !== null && typeof graph === 'object' && Array.isArray((graph as { nodes?: unknown }).nodes)
    ? (graph as { nodes: Array<{ id?: unknown; kind?: unknown }> }).nodes : [];
  const savedRoots = (analysisReady as { unvalued_roots?: unknown } | null)?.unvalued_roots;
  const recorded = new Set<string>(Array.isArray(savedRoots) ? savedRoots.filter(root => root?.treated_as === 'zero').map(root => root.node_id) : []);
  const candidates = nodes.filter(n => (n.kind === 'risk' || n.kind === 'outcome') && typeof n.id === 'string');
  for (const id of placeholderZeroFactorIds(analysisResult, candidates.map(n => n.id as string))) recorded.add(id);
  return new Set(candidates.filter(n => recorded.has(n.id as string)).map(n => n.id as string));
}

/** A bound saved Run keeps its explicit zero treatment; without that evidence,
 * current unknown non-factor roots retain their canonical refusal and ask. */
export function treatedAsZeroReplyLine(graph: unknown, analysisReady: unknown, analysisResult?: unknown): string | null {
  const nodes = graph !== null && typeof graph === 'object' && Array.isArray((graph as { nodes?: unknown }).nodes)
    ? (graph as { nodes: Array<{ id?: unknown; kind?: unknown; label?: unknown }> }).nodes : [];
  // Historical treatment is an explicit saved fact, never inferred from a missing current value.
  const recorded = savedZeroRootIds(graph, analysisReady, analysisResult);
  const historical = nodes.filter(n => typeof n.id === 'string' && recorded.has(n.id));
  if (historical.length > 0) {
    const labels = historical.map(n => typeof n.label === 'string' ? n.label : '');
    const labelled = treatedAsZeroLine({ checked: true, may_run: true, treated_as_zero: labels,
      needs_from_user: [], olumi_can_offer: [], will_run_without: [], levels_not_set: [] })!;
    if (labels.slice(0, 2).every(label => label.trim() !== '') && survivesReplyEditors(labelled, graph, analysisReady)) return labelled;
    return historical.length === 1 ? TREATED_AS_ZERO_UNNAMED_ONE : treatedAsZeroUnnamedMany(historical.length);
  }
  const nonFactors = new Set(nodes.filter(n => n.kind !== 'factor').map(n => n.id));
  const gaps = assessCanonicalAnalysisReadiness(graph).blockingIssues.filter(issue =>
    issue.code === 'MISSING_FACTOR_LEVEL' && nonFactors.has(issue.factor_id));
  if (gaps.length === 0) return null;
  const labelled = gaps.map(gap => gap.message.replace(/\s+/g, ' ').trim()).join(' ');
  if (gaps.every(gap => (gap.factor_label ?? '').trim() !== '') && survivesReplyEditors(labelled, graph, analysisReady)) return labelled;
  return missingRootUnnamedLine(gaps.length);
}

export const missingRootUnnamedLine = (count: number): string => count === 1
  ? 'One input on your goal’s path has no supported figure. Numerical analysis is withheld; give it a current value on the canvas, or ask Olumi to propose a labelled starting assumption for review.'
  : `${count} inputs on your goal’s path have no supported figures. Numerical analysis is withheld; give each a current value on the canvas, or ask Olumi to propose labelled starting assumptions for review.`;
