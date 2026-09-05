/**
 * UNSUPPORTED OPTION LINK — the consent ask must not confirm a link the
 * engine will discard.
 *
 * THE DEFECT THIS CLOSES (real user, 2026-09). Asked for "a risk of spending
 * more money on development resources and still not hitting our launch
 * date", the product proposed, held, and on a yes replied "Confirmed: add
 * risk '…', link 'Hire a Tech Lead' to it, link 'Two Developers' to it, and
 * link it to 'Boost Productivity'." Two of those three links are
 * `option -> risk`:
 *
 *  - the platform's edge matrix has no such rule. `ALLOWED_EDGES`
 *    (src/validators/graph-validator.types.ts:293-302) carries exactly ONE
 *    rule with `fromKind: "option"` — `option -> factor(controllable)` at
 *    :295 — and the draft prompt lists `option -> risk (options work through
 *    factors)` among prohibited patterns (src/prompts/defaults.ts:246);
 *  - nothing on the interactive path notices. `edit_graph` applies only
 *    `validateGraphStructure` (orchestrator/tools/edit-graph.ts:3134), whose
 *    entire vocabulary (orchestrator/graph-structure-validator.ts:90-100)
 *    has no edge-shape code, so the batch validates CLEAN and persists;
 *  - PLoT then removes it. `filterOptionNodes`
 *    (plot-lite-service src/normalisation/option-filter.ts:60-97) treats
 *    `option` / `decision` / `constraint` as non-causal and removes ALL
 *    edges incident to them, unconditionally, before the compute.
 *
 * So the ask named the links, the user consented, and the links never
 * reached the result. This module makes the HOLD ASK say so, and offer the
 * shape the platform does support.
 *
 * WHAT THE COPY MAY CLAIM. That the link will not reach the calculation is
 * DETERMINATE (the filter above is unconditional). What the analysis then
 * DOES with the unreached risk is not, and this copy never predicts it —
 * same rule the needs-encoding disclosure is held to
 * (needs-encoding-copy-prediction-free.test.ts).
 *
 * TWO QUESTIONS, NAMED APART (the estate's trap 21).
 * `classifyAddRiskToOptionRejection` (orchestrator/add-risk-rejection-
 * guidance.ts:93) answers "a structural violation ALREADY occurred and is
 * reachability-class, should the generic REJECTION copy be replaced?"; its
 * Gate 1 returns null when `newViolations.length === 0`. THIS module answers
 * "this edit will be ACCEPTED, will part of it be discarded before the
 * calculation?", and its precondition is a CLEAN validation. The predicates
 * are disjoint by construction. Neither is widened to cover the other, and
 * `unsupported-option-link-hold-ask.test.ts` pins that.
 *
 * SCOPE, STATED (never inferred). This predicate covers `option -> risk`,
 * `option -> outcome` and `option -> goal`: the three shapes defaults.ts
 * :246-248 names together under the identical parenthetical "(options work
 * through factors)", and which `ALLOWED_EDGES` omits. Deliberately NOT
 * covered, because each is a different question with a different remedy:
 *  - `option -> factor` of a non-controllable category (remedy: change the
 *    factor's category, or choose another factor);
 *  - `decision -> X` shapes (same PLoT filter, different coaching);
 *  - links a batch does not ADD (a graph that already carries the shape —
 *    that is an analysis-time disclosure, not a consent ask; see the PR).
 */

import { clampLabel, type ChangesetOpLike } from './describe-changeset.js';
import { sanitisePublicCopyOrFallback } from '../compose/proposed-change.js';

/** Target kinds an `option` may not link to. Derived from the ALLOWED_EDGES
 *  omission + the defaults.ts:246-248 prohibited list; the kind word is the
 *  user-facing noun the ask renders. */
const UNSUPPORTED_OPTION_TARGETS: ReadonlyMap<string, string> = new Map([
  ['risk', 'risk'],
  ['outcome', 'outcome'],
  ['goal', 'goal'],
]);

/** Kinds whose "more likely" phrasing is correct (a risk occurs or does not). */
const LIKELIHOOD_KINDS: ReadonlySet<string> = new Set(['risk']);

export interface UnsupportedOptionLink {
  /** Option node id the link starts at. */
  readonly fromId: string;
  /** Unsupported target node id the link ends at. */
  readonly toId: string;
}

export interface UnsupportedOptionLinkMatch {
  /** Every unsupported link in the batch, in operation order. */
  readonly links: readonly UnsupportedOptionLink[];
  /** Labels of the option ends, de-duplicated, in first-seen order. */
  readonly optionLabels: readonly string[];
  /** Labels of the target ends, de-duplicated, in first-seen order. */
  readonly targetLabels: readonly string[];
  /** User-facing noun for the shared target kind ('risk' | 'outcome' | 'goal'). */
  readonly targetKindWord: string;
}

interface NodeFacts {
  readonly kind: string | null;
  readonly label: string | null;
}

/** Total object view of an op payload (hostile shapes → empty record). */
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** True iff `text` survives the render-safety filter verbatim. Mirrors the
 *  referee gate's `subjectIsSafe` by calling the SAME shared sanitiser, so
 *  "safe to render" can never mean two different things here. */
function isSafeForCopy(text: string): boolean {
  return sanitisePublicCopyOrFallback(text, ' ') === text.trim();
}

/**
 * Index node kind + label from the pre-edit graph, then overlay `add_node`
 * ops from the batch. A batch may add a node AND link it in the same turn
 * (the captured defect does exactly that), so a classifier reading only the
 * pre-edit graph is blind to the whole case.
 */
function indexNodes(
  operations: readonly ChangesetOpLike[],
  currentGraph: unknown,
): ReadonlyMap<string, NodeFacts> {
  const index = new Map<string, NodeFacts>();
  const graphNodes = asRecord(currentGraph).nodes;
  if (Array.isArray(graphNodes)) {
    for (const n of graphNodes) {
      const rec = asRecord(n);
      if (typeof rec.id !== 'string') continue;
      index.set(rec.id, {
        kind: typeof rec.kind === 'string' ? rec.kind : null,
        label: typeof rec.label === 'string' && rec.label.trim().length > 0 ? rec.label.trim() : null,
      });
    }
  }
  for (const op of operations) {
    if (op.op !== 'add_node') continue;
    const v = asRecord(op.value);
    const id = typeof v.id === 'string' ? v.id : typeof op.path === 'string' ? op.path : null;
    if (id === null) continue;
    index.set(id, {
      kind: typeof v.kind === 'string' ? v.kind : null,
      label: typeof v.label === 'string' && v.label.trim().length > 0 ? v.label.trim() : null,
    });
  }
  return index;
}

/**
 * Find the `add_edge` operations in `operations` that link an OPTION to a
 * kind the platform cannot carry a link to. Returns null when there are
 * none, when the batch's unsupported links do not share a single target
 * node, or when no end can be named safely — in every one of those cases the
 * caller keeps its existing copy rather than saying something vaguer.
 *
 * Bound by node id → kind, never by a label predicate: two nodes can share a
 * label, and only the id identifies the one the batch actually links.
 */
export function classifyUnsupportedOptionLinks(
  operations: readonly ChangesetOpLike[],
  currentGraph: unknown,
): UnsupportedOptionLinkMatch | null {
  if (operations.length === 0) return null;
  const nodes = indexNodes(operations, currentGraph);

  const links: UnsupportedOptionLink[] = [];
  for (const op of operations) {
    if (op.op !== 'add_edge') continue;
    const v = asRecord(op.value);
    if (typeof v.from !== 'string' || typeof v.to !== 'string') continue;
    const from = nodes.get(v.from);
    const to = nodes.get(v.to);
    if (from === undefined || to === undefined) continue;
    if (from.kind !== 'option') continue;
    if (to.kind === null || !UNSUPPORTED_OPTION_TARGETS.has(to.kind)) continue;
    links.push({ fromId: v.from, toId: v.to });
  }
  if (links.length === 0) return null;

  // One named target only. A batch whose unsupported links point at several
  // different targets is a KNOWN-DROPPED case: the caller falls back to the
  // generic ask, which states the shape without naming ends it cannot name
  // coherently. Pinned by the spec so the set fails loud if it grows.
  const targetIds = new Set(links.map((l) => l.toId));
  if (targetIds.size !== 1) return null;

  const targetId = links[0]!.toId;
  const target = nodes.get(targetId)!;
  const targetKindWord = UNSUPPORTED_OPTION_TARGETS.get(target.kind!)!;

  const optionLabels: string[] = [];
  for (const link of links) {
    const label = nodes.get(link.fromId)?.label;
    if (label === undefined || label === null) return null;
    const clamped = clampLabel(label);
    if (!isSafeForCopy(clamped)) return null;
    if (!optionLabels.includes(clamped)) optionLabels.push(clamped);
  }
  if (target.label === null) return null;
  const targetLabel = clampLabel(target.label);
  if (!isSafeForCopy(targetLabel)) return null;

  return {
    links,
    optionLabels,
    targetLabels: [targetLabel],
    targetKindWord,
  };
}

/** Oxford-free list join: "'A'", "'A' and 'B'", "'A', 'B' and 'C'". */
function joinQuoted(labels: readonly string[]): string {
  const quoted = labels.map((l) => `'${l}'`);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]!}`;
}

/**
 * Fallback ask when no end can be named safely, or the batch's unsupported
 * links point at more than one target. States the shape and the consequence
 * without naming anything, and still offers the yes.
 * provisional_doctrine_v0; no em dash.
 */
export const GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT =
  "I'm holding these changes rather than applying them straight away. One thing to " +
  'settle first: a link straight from an option to the rest of the model is not a ' +
  'shape this model can work with, so those links would sit in the model without ' +
  'reaching the result. An option reaches the rest of the model through a factor. ' +
  'Tell me which factor these options change and I will connect them that way ' +
  'instead, or reply yes to add it exactly as described.';

/**
 * The hold ask for a batch carrying an unsupported option link. Replaces the
 * generic ask outright rather than appending a caveat to it: the generic ask
 * ends "Reply yes to continue", and on this batch a plain "continue" is the
 * sentence that misled the captured user.
 *
 * `opCount` governs the lead-in (how many changes are held) and the LINK
 * count governs the disclosure — two different numbers, deliberately not
 * shared.
 */
export function buildGmUnsupportedLinkHeldAssistantText(
  match: UnsupportedOptionLinkMatch,
  subject: string | null,
  opCount: number,
): string {
  if (subject === null || !isSafeForCopy(subject)) {
    return GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT;
  }
  const leadIn =
    opCount > 1
      ? `I'm holding these changes rather than applying them straight away: ${subject}.`
      : `I'm holding the change to ${subject} rather than applying it straight away.`;

  const kind = match.targetKindWord;
  const options = joinQuoted(match.optionLabels);
  const plural = match.optionLabels.length > 1;
  const linkClause = plural
    ? `so the links from ${options} would sit in the model without reaching the result`
    : `so the link from ${options} would sit in the model without reaching the result`;

  const targetLabel = match.targetLabels[0]!;
  const effect = LIKELIHOOD_KINDS.has(kind)
    ? `makes '${targetLabel}' more likely`
    : `moves '${targetLabel}'`;
  const whichFactor = plural
    ? `Tell me which factor they change that ${effect}`
    : `Tell me which factor it changes that ${effect}`;

  return (
    `${leadIn} One thing to settle first: a link straight from an option to a ${kind} ` +
    `is not a shape this model can work with, ${linkClause}. ` +
    `An option reaches a ${kind} through a factor. ` +
    `${whichFactor} and I will connect it that way instead, or reply yes to add it ` +
    'exactly as described.'
  );
}
