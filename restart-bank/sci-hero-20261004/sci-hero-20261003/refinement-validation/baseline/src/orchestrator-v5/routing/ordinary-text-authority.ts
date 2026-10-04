/**
 * ⭐⭐ ORDINARY-TEXT AUTHORITY — "did the user's own words AUTHORISE a write, or
 * ask what I THINK?"
 *
 * ═══ WHY THIS MODULE EXISTS, AND WHY IT IS NOT A NEW PREDICATE ═══
 *
 * The product performs the SAME model mutation whether the user gave an explicit
 * edit instruction or merely asked for advice. Two write paths carry one name:
 *
 *   PATH A — the V5 typed handlers. `detectMutationWarrant` gates them, and its
 *            message half GRANTS ON ADVICE: `isEditRequestShape` is TRUE for
 *            "Do you think the churn rate should be lower?" (measured at this
 *            tip), so an advice question is an authorised write.
 *   PATH B — `edit_graph` / the V4 cordon. `grep -c warrant` over
 *            `handlers/edit-graph-dispatch.ts` reads **0** at this tip (in-file
 *            contrast control: `scope_unresolved` reads 3, so the probe can
 *            see), and `orchestrator/route-v2.ts` imports only the two NEGATIVE
 *            warrant helpers. It has NO affirmative authority at all.
 *
 * ⭐ THE CAPABILITY WAS MISPLACED, NOT MISSING. The estate already owns a
 * ratified, non-punctuation deliberation classifier — `classifyUnappliedEditFrame`
 * (`compose/unapplied-edit-reply.ts`), whose own header records that every one of
 * its eight patterns requires an explicit second-person or first-person-plural
 * deliberative frame and that a bare question mark is never enough. It is ALREADY
 * IMPORTED by `orchestrator/tools/edit-graph.ts` — and consulted ONLY in the
 * no-op branch, purely to WORD the reply. It never touched the write decision.
 *
 * This module resolves that one question ONCE and hands the verdict to two
 * consumers. It writes no new lexical or phrase predicate, and it must not
 * acquire one: four consecutive rounds on exactly this shape each closed one
 * direction and reopened the other, a reviewer then ran the obvious fifth round
 * in advance and proved it oscillates too, and the standing ruling recorded on
 * `hasMutationWarrantSignal` is that no further punctuation-only or lexical rule
 * will settle it. Reusing the ratified classifier IS the fix.
 *
 * ═══ QUOTE-MASKING IS LOAD-BEARING, AND IT IS BOUND TO THE GRAPH ═══
 *
 * Measured over 1,564 mutating turns: THREE carry a deliberative frame and TWO
 * of those are FALSE POSITIVES, because a user's graph contains a node labelled
 * `"What should we do?"` and the frame pattern matches INSIDE the quoted label.
 * Quote-masked, the true number is **1 of 1,564 — and that one IS the harm**.
 *
 * So the mask is not hygiene: without it this gate would tax two legitimate
 * mutations to catch one harm, and the whole increment would be net-negative.
 *
 * ⚠ IT DOES NOT REUSE `maskQuotedMentions` (`mutation-warrant.ts`). That helper
 * masks a quoted span only when the span is a COMPLETE NO-CHANGE PHRASE (a
 * prohibitive cue + a mutation lexeme + a model object, all inside the quotes) —
 * measured too narrow for this question by construction: `"What should we do?"`
 * carries none of the three and would never be masked.
 *
 * ⚠ AND IT IS DERIVED, NOT MIRRORED (CLAUDE.md trap 12). A quoted span is masked
 * only when its content matches a label the GRAPH ACTUALLY CARRIES. There is no
 * phrase list here to go stale: the authority is the model in front of the user.
 * That also bounds the mask tightly — it can never blank the user's own words,
 * because the user's own words are not node labels.
 *
 * ═══ THE SUBORDINATION IS THE MIXED-EDIT PRESERVATION, AND IT IS THE ESTATE'S
 *     OWN RATIFIED SHAPE ═══
 *
 * `hasMutationWarrantSignal`'s Term 0 already vetoes on an explicit no-change
 * intent, and it carries two negated conjuncts — `!hasMutationSignal &&
 * !hasConstraintMutationSignal` — because without them it stripped the warrant
 * from 81 of 81 ordinary fenced edits. This veto is built to the SAME shape for
 * the SAME reason, and measurement at this tip says it is exactly what preserves
 * a MIXED edit (advice + an explicit edit in one message):
 *
 *   "Do you think churn is too high? Set churn to 5%."          canonical TRUE
 *   "What are your thoughts on the budget limit? Cap marketing
 *    at £200,000."                                              constraint TRUE
 *   "Any thoughts on supplier risk? Add a risk for supplier
 *    delay."                                                    canonical TRUE
 *
 * Every mixed shape measured that HOLDS a warrant at pristine carries a canonical
 * or constraint signal, so every one of them survives this veto by construction
 * rather than by a list somebody has to keep in sync.
 *
 * ⛔ THE PRICE IS PINNED, NOT PAPERED OVER — AND IT IS BIGGER THAN THE SCOPING
 * SAID. A deliberative frame that ALSO carries a canonical or constraint signal
 * keeps its authority and still writes: "Should we increase the marketing budget
 * to £200,000?" and "Should we cap marketing at £200,000?" are advice and are
 * NOT withheld. Telling those from their mixed twins is a natural-language
 * discrimination over trailing clauses, which is the exact predicate the
 * standing ruling forbids. Measured at this tip the KNOWN_DROPPED set is FIVE
 * members over a ten-message advice corpus (the scoping put it at two, and two
 * was only reachable by dropping mixed edits). It is pinned in
 * `__tests__/ordinary-text-authority-write-gate.test.ts` with each member's
 * MECHANISM and a set-equality assertion that REDs if the set GROWS or SHRINKS —
 * together with the clause-scoped alternative, which scores 9/10 instead of 5/10
 * on the same corpus and was still refused, because its mixed-edit safety is a
 * self-authored-corpus result where this rule's is a structural guarantee.
 */

import { classifyUnappliedEditFrame } from '../compose/unapplied-edit-reply.js';
import { hasMutationSignal } from './analytical-intent.js';
import { hasConstraintMutationSignal } from './constraint-mutation-signal.js';

/**
 * The two answers. Named as a type so a consumer cannot silently treat the
 * absence of a withhold as the presence of one, or vice versa.
 *
 * `'granted'` is the DEFAULT EVERYWHERE, deliberately: a caller that never
 * resolves this question must behave exactly as it did before this module
 * existed, so adding the module cannot change a path nobody wired.
 */
export type OrdinaryTextAuthority = 'granted' | 'withheld_deliberation';

/** Longest label first, so a label that contains another is matched whole. */
function normaliseLabel(label: string): string {
  return label.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Project the node labels of a permissive graph shape.
 *
 * Tolerant on purpose: every caller holds the graph as `unknown` or as an
 * ingress shape at the point the question is asked, and a graph read that
 * degrades must cost the mask, never the turn. An unreadable graph yields `[]`,
 * which masks nothing — the fail-safe direction here is TOWARDS withholding.
 */
export function projectModelNodeLabels(graph: unknown): readonly string[] {
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const labels: string[] = [];
  for (const node of nodes) {
    const label = (node as { label?: unknown } | null)?.label;
    if (typeof label === 'string' && label.trim().length > 0) labels.push(label);
  }
  return labels;
}

/** The quote pairs this product's users actually type, straight and curly. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ['‘', '’'],
  ["'", "'"],
];

/**
 * Blank every QUOTED span whose content IS one of the graph's own node labels.
 *
 * Replaced with spaces rather than removed, so offsets are preserved and a
 * pattern cannot accidentally bridge the two sides of a deleted span.
 *
 * Matching is whitespace-normalised, case-insensitive and tolerant of trailing
 * sentence punctuation inside the quotes (`"What should we do?"` for a label
 * spelled `What should we do?` — and for one spelled `What should we do`).
 * It is NOT tolerant of anything else: the span must BE the label.
 */
export function maskQuotedNodeLabels(
  message: string,
  modelNodeLabels: readonly string[],
): string {
  if (typeof message !== 'string' || message.length === 0) return '';
  if (modelNodeLabels.length === 0) return message;

  const wanted = new Set<string>();
  for (const label of modelNodeLabels) {
    const normalised = normaliseLabel(label);
    if (normalised.length === 0) continue;
    wanted.add(normalised);
    // A label spelled without terminal punctuation must still match a quoted
    // mention that carries some, and vice versa. Both directions, one set.
    wanted.add(normalised.replace(/[.?!,;:]+$/, '').trim());
  }
  wanted.delete('');
  if (wanted.size === 0) return message;

  const characters = [...message];
  for (let start = 0; start < characters.length; start += 1) {
    const opening = characters[start]!;
    const pair = QUOTE_PAIRS.find(([open]) => open === opening);
    if (pair === undefined) continue;
    const closing = pair[1];
    let end = start + 1;
    while (end < characters.length && characters[end] !== closing) end += 1;
    if (end >= characters.length) continue; // unmatched quote — leave untouched
    const quoted = characters.slice(start + 1, end).join('');
    const normalised = normaliseLabel(quoted);
    const bare = normalised.replace(/[.?!,;:]+$/, '').trim();
    if (wanted.has(normalised) || wanted.has(bare)) {
      for (let cursor = start; cursor <= end; cursor += 1) characters[cursor] = ' ';
    }
    start = end;
  }
  return characters.join('');
}

export interface OrdinaryTextAuthorityInput {
  /** The user's own message bytes, never a synthesised or model-authored string. */
  readonly message: string;
  /**
   * The resolved node labels of the model this turn is about. `[]` is a legal
   * value and means "no labels resolved" — it masks nothing, which withholds
   * MORE rather than less.
   */
  readonly modelNodeLabels: readonly string[];
}

/**
 * THE one resolution. Two consumers read this verdict; neither re-derives it.
 *
 *  1. `edit-graph-dispatch.ts` — a conjunct on `effectiveAppliedMutation`, the
 *     dispatcher's single gate for persist, edit fact, `analysis_ready` and the
 *     returned graph.
 *  2. `mutation-warrant.ts` — a veto term inside `hasMutationWarrantSignal`,
 *     reached only after `confirm_resume` and `typed_mutation_chip` have had
 *     their say (see `hasStrongerThanTextWarrant`).
 *
 * ⚠ THE SUBORDINATION LIVES HERE, NOT IN THE CONSUMERS, so the two cannot fork.
 * That is this estate's dominant defect — two lists standing for one concept —
 * and it is the reason the frame classifier was worded into a reply while a
 * second, unrelated authority decided the write.
 */
export function resolveOrdinaryTextAuthority(
  input: OrdinaryTextAuthorityInput,
): OrdinaryTextAuthority {
  const { message } = input;
  if (typeof message !== 'string' || message.trim().length === 0) return 'granted';

  const masked = maskQuotedNodeLabels(message, input.modelNodeLabels);
  if (classifyUnappliedEditFrame(masked) !== 'deliberation') return 'granted';

  // The mixed-edit preservation, in Term 0's own shape and for Term 0's own
  // reason. An unambiguous canonical or constraint instruction anywhere in the
  // message keeps its authority; only a message whose ENTIRE mutation claim is
  // the deliberative frame is withheld.
  if (hasMutationSignal(message) || hasConstraintMutationSignal(message)) return 'granted';

  return 'withheld_deliberation';
}
