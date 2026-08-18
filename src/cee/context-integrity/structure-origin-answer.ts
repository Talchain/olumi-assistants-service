/**
 * ⭐⭐ "WHY IS THIS IN MY MODEL?" IS A FOURTH QUESTION, AND IT IS THE ONE THE
 * PRODUCT EXISTS TO ANSWER.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────
 * Live journey witness, 18 Aug 2026, deployed CEE `585f8dce` (turn 2, verbatim):
 *
 *   user:  "Why did you add a hybrid phased option? I never mentioned one —
 *           where did that come from?"
 *   Olumi: "I don't have a record of recent edits in this conversation. If you'd
 *           like to make a change, tell me what to update and I'll do it directly."
 *
 * `_diagnostic_trace.llm_calls` was `[]`. **No model was called.** The message had
 * matched `\bdid\s+you\s+(?:change|update|apply|add)\b` in the state-query guard's
 * `STATE_QUERY_PATTERNS`, so the guard answered an EDIT-HISTORY question that the
 * user had not asked. A team challenging AI-authored structure is the core
 * collaborative-reasoning move, and it was the one interaction the router
 * intercepted.
 *
 * ── THE QUESTION EACH ARM ANSWERS (trap 21, written down BEFORE the change) ───
 * The estate has already paid twice for two authorities answering two questions
 * under one name. So, explicitly:
 *
 *   | arm                  | the question it answers                        | answered from                       |
 *   |----------------------|------------------------------------------------|-------------------------------------|
 *   | `brief_audit`        | "what did you keep from / leave out of MY BRIEF?"| derived not-modelled manifest      |
 *   | `with_recent_change` | "what did you change in THIS SESSION?"          | `contextPack.recent_changes`        |
 *   | `no_recent_changes`  | ditto, when nothing is recorded                 | (nothing — an honest absence)       |
 *   | **`structure_origin`** (this module) | **"why does THIS ELEMENT exist?"** | **the node's persisted provenance record** |
 *
 * The session-edit arms are CORRECT and stay. Their purpose is real: the model
 * cannot recall its own past actions, so an ungrounded answer about them is a
 * confabulation, and a question about a prior mutation must never be routed into
 * a fresh one. **Nothing here weakens that.** What changes is only that a question
 * about ORIGIN stops being answered as a question about OCCURRENCE.
 *
 * ── WHY THIS IS NOT ANOTHER REGEX ROUND ──────────────────────────────────────
 * CEE #888 burned four consecutive rounds oscillating on one natural-language
 * predicate, each round fixing one direction and reopening the other, before the
 * ruling that no further punctuation-or-phrasing rule would settle it (trap 22f).
 * The difference here is structural, and it is the whole design:
 *
 *   **A phrasing predicate ALONE never decides anything. It is one conjunct of
 *   three, and the other two are DERIVED FROM PERSISTED STATE:**
 *     1. the message seeks an ORIGIN (a closed grammatical class — see below);
 *     2. exactly ONE element of the persisted graph resolves from the message;
 *     3. that element carries a provenance record we can honestly report.
 *
 *   Fail any of them and we return `null` — the turn goes to the reasoning
 *   layer, which is strictly better than the deflection it replaces. **The only
 *   thing a false positive on conjunct 1 can buy is a fall-through**, because
 *   conjuncts 2 and 3 cannot be talked into existence by phrasing. That is what
 *   stops the oscillation: widening the frame cannot manufacture a wrong answer,
 *   it can only reach a decline.
 *
 * ⭐ AND THE LEAD QUESTION, ASKED OF THIS FIX ITSELF: *could it be another
 * instance of the defect class it removes — a guard substituting its own canned
 * answer for the user's question?* It is bounded against exactly that:
 *   · it never answers about an element it cannot RESOLVE (no wrong subject);
 *   · it never answers from anything but the element's OWN persisted record
 *     (no invented origin);
 *   · it declines on ambiguity rather than picking (trap 22f: do not guess);
 *   · it emits **no question and no offer**, so there is nothing it asks that it
 *     could then refuse (P8);
 *   · and where it cannot speak, it is SILENT rather than reassuring.
 *
 * ── CONJUNCT 1 IS A CLOSED CLASS, NOT AN OPEN LEXICON ────────────────────────
 * `ORIGIN_FRAME_PATTERNS` is a list, and the brief is right to be suspicious of
 * lists. Two things bound it. First, it keys on English's wh-interrogatives,
 * which are a genuinely closed function-word class — the language admits no new
 * ones. Second, it is NOT hand-maintained-and-silent: a derived coverage guard
 * (`__tests__/../state-query-guard.structure-origin.test.ts`, RED-E) iterates
 * this exported array and FAILS when any entry is not exercised by the corpus,
 * so a pattern added without a case reddens rather than shipping unobserved.
 *
 * ── PROVENANCE IS READ, NEVER INFERRED (P5, P7) ──────────────────────────────
 * Every sentence this module emits is derived from the node's own
 * `provenance` record as written by the PRODUCER
 * (`cee/draft/records/projector.ts`, `RecordProvenance` at `:212`):
 *   · `provenance_class: 'stated'`  → the user stated it; `source_quote` is
 *     "the verbatim quote, canonicalised" (declared "present iff `stated`").
 *   · `provenance_class: 'ai_inferred'` → ours; `basis` holds "minted ids of the
 *     stated items it builds on" and `unbased` is "TRUE when `basis` is empty —
 *     pure invention, and marked so".
 *   · `provenance_class: 'projector_structural'` → "the machine put this here"
 *     (`PROJECTOR_STRUCTURAL_CLASS`, the one authority for machine topology).
 *   · `label_authored` → "the DISPLAY LABEL is ours rather than the user's
 *     verbatim", derived at the producer from `label !== source_quote`.
 * The producer's declared meanings are the oracle here, not any distribution
 * observed in a corpus.
 *
 * ⚠ MEASURED, AND IT BOUNDS WHAT WE MAY SAY: on the governed capture
 * `tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json`
 * (238 node-level provenance records), **only 131 of 238 `basis` references —
 * 55% — resolve to a node id.** The rest are record ids for stated items that
 * never became nodes. So the basis clause names ONLY what resolves, and an
 * unresolvable basis is reported as NOTHING rather than as "based on nothing":
 * `unbased: true` is the sole warrant for the no-basis sentence. Claiming a
 * basis we cannot name and claiming an absence we have not established are both
 * fabrications, in opposite directions.
 *
 * British English. No em dashes in user-facing copy, per the guard's convention.
 */

/**
 * Conjunct 1 — does this message seek the ORIGIN or REASON for something,
 * rather than report on an OCCURRENCE?
 *
 * ⚠ EXPORTED for the derived coverage guard. Do not inline it.
 *
 * The distinction is grammatical, not lexical. *"Did you add X?"* is a polar
 * interrogative about an event; *"Why did you add X?"* is a wh-interrogative
 * about a reason, and the guard's existing `did you (change|update|apply|add)`
 * alternative matches the substring inside BOTH. These patterns identify the
 * reason/source-seeking constructions only.
 *
 * ⚠ `where did it go?` and `what did you change?` are deliberately NOT here.
 * They are wh-questions too, and they are READBACK questions — the session-edit
 * arms own them and must keep owning them. The origin class is narrower than
 * "contains a wh-word".
 */
export const ORIGIN_FRAME_PATTERNS: readonly RegExp[] = [
  // "why did you add …", "why is there …", "why does the model have …"
  /\bwhy\s+(?:did|do|does|is|are|was|were|would|have|has)\b/i,
  // "where did that come from", "where does this come from"
  /\bwhere\s+(?:did|does|do)\b[^?]{0,60}?\bcome\s+from\b/i,
  // "what is the hybrid option based on", "what are these based on"
  /\bwhat\s+(?:is|are|was|were)\b[^?]{0,80}?\bbased\s+on\b/i,
  // "on what basis did you …", "what's the basis for …"
  /\b(?:on\s+what\s+basis|what(?:'s|\s+is)\s+the\s+basis\s+for)\b/i,
  // "what made you add …", "what makes you think …"
  /\bwhat\s+(?:made|makes)\s+you\b/i,
  // "how did this end up in my model", "how did that get in there"
  /\bhow\s+did\b[^?]{0,60}?\b(?:end\s+up|get\s+(?:in|into)|come\s+to\s+be)\b/i,
];

export function isStructureOriginQuestion(message: string): boolean {
  if (typeof message !== 'string' || message.length === 0) return false;
  return ORIGIN_FRAME_PATTERNS.some((pattern) => pattern.test(message));
}

// ============================================================================
// Conjunct 2 — resolving the element the user means
// ============================================================================

/**
 * Words that carry no identifying power. Deliberately SHORT: this is not a
 * linguistic stopword list, it is the set of tokens that appear in the origin
 * frame itself plus the commonest English function words, which would otherwise
 * let an unrelated label score a point.
 */
const NON_IDENTIFYING = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'from', 'with', 'into', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'did', 'do', 'does', 'done', 'have', 'has', 'had', 'why', 'where', 'what', 'how',
  'who', 'which', 'when', 'you', 'your', 'yours', 'i', 'me', 'my', 'mine', 'we',
  'our', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'they',
  'them', 'their', 'add', 'added', 'put', 'come', 'came', 'get', 'got', 'go',
  'gone', 'made', 'make', 'makes', 'based', 'basis', 'never', 'not', 'no', 'one',
  'all', 'any', 'some', 'so', 'up', 'out', 'model', 'models', 'graph', 'would',
  'should', 'could', 'can', 'will', 'ever', 'even', 'just', 'about', 'mentioned',
  'mention', 'said', 'say', 'think', 'end', 'ended', 'stuff', 'thing', 'things',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

function identifyingTokens(text: string): Set<string> {
  return new Set(tokenise(text).filter((t) => !NON_IDENTIFYING.has(t)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface GraphNodeView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance: Record<string, unknown> | null;
}

function nodeViews(graph: unknown): readonly GraphNodeView[] {
  const raw = asRecord(graph)?.nodes;
  if (!Array.isArray(raw)) return [];
  const views: GraphNodeView[] = [];
  for (const entry of raw) {
    const node = asRecord(entry);
    if (!node) continue;
    const { id, kind, label } = node;
    if (typeof id !== 'string' || typeof label !== 'string' || label.length === 0) continue;
    views.push({
      id,
      kind: typeof kind === 'string' ? kind : '',
      label,
      provenance: asRecord(node.provenance),
    });
  }
  return views;
}

/**
 * Resolve the ONE element the message is asking about, or `null`.
 *
 * ⚠ BINDS BY IDENTITY, NOT BY A PREDICATE ANOTHER OBJECT COULD SATISFY (trap 19).
 * The witnessed graph carries FOUR elements containing the token "hybrid" — one
 * option and three per-option twin factors. A resolver that accepted "any node
 * whose label shares a word with the message" would answer confidently about the
 * wrong one, which is a worse defect than the deflection being fixed.
 *
 * So a winner must beat every rival OUTRIGHT: a strict maximum, never a tie. The
 * kind word the user typed ("option", "factor", "risk") narrows first, and only
 * when it names a kind the graph actually has — derived from the graph in hand,
 * never a hand-listed vocabulary (trap 12).
 */
function resolveElement(message: string, graph: unknown): GraphNodeView | null {
  const nodes = nodeViews(graph);
  if (nodes.length === 0) return null;

  const messageTokens = identifyingTokens(message);
  if (messageTokens.size === 0) return null;

  // Kind narrowing, derived from THIS graph's kinds.
  const kindsPresent = new Set(nodes.map((n) => n.kind).filter((k) => k.length > 0));
  const messageWords = new Set(tokenise(message));
  const namedKinds = [...kindsPresent].filter(
    (kind) => messageWords.has(kind) || messageWords.has(`${kind}s`),
  );
  const candidates =
    namedKinds.length > 0 ? nodes.filter((n) => namedKinds.includes(n.kind)) : nodes;
  if (candidates.length === 0) return null;

  let best: GraphNodeView | null = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const node of candidates) {
    let score = 0;
    for (const token of identifyingTokens(node.label)) {
      if (messageTokens.has(token)) score += 1;
    }
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = node;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // A strict maximum, or nothing. Ties are ambiguity, and the honest response to
  // ambiguity is to let the reasoning layer ask (trap 22f), not to pick.
  if (best === null || bestScore === 0 || bestScore === runnerUp) return null;
  return best;
}

// ============================================================================
// Conjunct 3 — composing the answer from the record, and only from the record
// ============================================================================

function quote(text: string): string {
  return `"${text}"`;
}

function joinEnglish(values: readonly string[]): string {
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/** Labels of the basis records that resolve to a real element of THIS graph. */
function resolvableBasisLabels(
  provenance: Record<string, unknown>,
  nodes: readonly GraphNodeView[],
): string[] {
  const basis = provenance.basis;
  if (!Array.isArray(basis)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n.label] as const));
  const labels: string[] = [];
  for (const ref of basis) {
    if (typeof ref !== 'string') continue;
    const label = byId.get(ref);
    if (label !== undefined && !labels.includes(label)) labels.push(label);
  }
  // Two is enough to make the answer concrete; more makes it a list, not a reply.
  return labels.slice(0, 2);
}

/**
 * The user-facing answer for ONE resolved element, or `null` when the record
 * cannot ground one.
 *
 * ⚠ RETURNING `null` IS A FIRST-CLASS OUTCOME, not a failure path. An element
 * with no provenance stamp is exactly the case where an invented origin would do
 * the most damage: the witness recorded `NHS Data Regulation Outcome` as the one
 * factor the drafter had HONESTLY left unknown, and manufacturing a story for it
 * would undo that honesty one layer down.
 */
function composeAnswer(node: GraphNodeView, nodes: readonly GraphNodeView[]): string | null {
  const provenance = node.provenance;
  if (!provenance) return null;
  const cls = provenance.provenance_class;
  const label = quote(node.label);

  if (cls === 'stated') {
    const sourceQuote =
      typeof provenance.source_quote === 'string' && provenance.source_quote.length > 0
        ? provenance.source_quote
        : null;
    if (sourceQuote === null) {
      return `${label} came from your brief, not from me.`;
    }
    const authored = provenance.label_authored === true;
    const tail = authored
      ? ' I shortened that into the label you see; your exact words are above.'
      : '';
    return `${label} came from your brief, not from me. You wrote: ${quote(sourceQuote)}.${tail}`;
  }

  if (cls === 'ai_inferred') {
    const basisLabels = resolvableBasisLabels(provenance, nodes);
    if (basisLabels.length > 0) {
      return (
        `${label} was my suggestion, not something you wrote. ` +
        `I put it forward while drafting the model, working from what you said about ` +
        `${joinEnglish(basisLabels.map(quote))}.`
      );
    }
    if (provenance.unbased === true) {
      return (
        `${label} was my suggestion, not something you wrote, ` +
        `and I did not draw it from anything specific in your brief.`
      );
    }
    // A basis exists but none of it resolves to an element of this graph. Say
    // the one thing we know, and claim neither a basis nor its absence.
    return `${label} was my suggestion, not something you wrote.`;
  }

  if (cls === 'projector_structural') {
    return (
      `${label} is scaffolding I added so the model holds together structurally. ` +
      `It is not something you wrote, and it carries no reasoning of its own.`
    );
  }

  // An unrecognised or absent class. Never a guess.
  return null;
}

/**
 * Answer *"why is this in my model?"* from the persisted graph, or `null`.
 *
 * `null` means "not mine to answer" and the caller must fall through to the
 * reasoning layer. It must NEVER be turned into a canned reply: producing
 * boilerplate here would recreate the defect this module exists to remove.
 */
export function tryStructureOriginAnswer(message: string, graph: unknown): string | null {
  if (!isStructureOriginQuestion(message)) return null;
  const nodes = nodeViews(graph);
  if (nodes.length === 0) return null;
  const element = resolveElement(message, graph);
  if (element === null) return null;
  return composeAnswer(element, nodes);
}
