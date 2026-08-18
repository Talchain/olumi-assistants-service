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
 *   layer, which is strictly better than the deflection it replaces.
 *
 * ⚠⚠ ROUND 1 ARGUED HERE THAT "the only thing a false positive on conjunct 1 can
 * buy is a fall-through, because conjuncts 2 and 3 cannot be talked into existence
 * by phrasing". **THAT CLAIM IS WITHDRAWN — it was refuted by execution.**
 * Conjuncts 2 and 3 bound the SUBJECT and its GROUNDING; they say nothing about
 * WHICH QUESTION is being answered. A perfectly resolved element with a perfectly
 * good stamp will answer "why is this scoring highest?" with a statement about
 * where it came from. **So conjunct 1 IS load-bearing**, and it is narrowed by a
 * required creation/inclusion predicate (see `CREATION_VERBS`) rather than
 * defended by an argument that the state conjuncts will catch its mistakes.
 * The honest version of the anti-oscillation claim is narrower: widening the frame
 * cannot make us answer about the WRONG ELEMENT, and cannot make us invent
 * provenance — but it can make us answer the wrong QUESTION about the right
 * element, and only the frame stops that.
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
 * ⭐⭐ THE PREDICATE THAT SEPARATES "HOW DID THIS GET HERE?" FROM "WHY DOES IT
 * BEHAVE THAT WAY?" — and its absence was a measured defect in round 1.
 *
 * Round 1's frame opened with a bare `why (did|do|does|is|are|would|…)`, and an
 * adversarial review refuted the design claim built on it by EXECUTION. All three
 * of these received confident provenance answers with `llm_calls: 0`:
 *
 *   · "Why is the hybrid option scoring highest in the analysis?"
 *   · "Why would the hybrid approach fail?"
 *   · "Why does the burn rate goal matter so much?"
 *
 * Those are questions about the model's BEHAVIOUR, RISK and IMPORTANCE. Answering
 * them with a statement about where the node came from is the router substituting
 * its own task for the user's — the exact defect this module was written to
 * remove, reproduced inside the removal.
 *
 * ⚠ AND THE CLAIM THAT LET IT THROUGH IS NOW WITHDRAWN. Round 1's header argued
 * that "a false positive on phrasing can only buy a fall-through, never a wrong
 * answer, because conjuncts 2 and 3 are derived from state". **That is false, and
 * the reason is worth keeping: conjuncts 2 and 3 bound the SUBJECT and its
 * GROUNDING — they say nothing about which QUESTION is being answered.** A
 * perfectly resolved element with a perfectly good provenance stamp will happily
 * answer the wrong question. The phrasing conjunct is load-bearing after all, so
 * it is narrowed here rather than defended.
 *
 * The fix is to require a CREATION / INCLUSION predicate: the question must be
 * about how the element came to BE in the model, not about what it does. Verbs
 * of behaviour, ranking, importance and consequence are absent by construction.
 *
 * ⚠ WHY NOT `isAnalyticalQuestion` (the reviewer's suggestion, re-derived and
 * corrected): that guard is anchored on `ANALYTICAL_OUTCOME_NOUNS`
 * (`result|outcome|analysis|ranking|winner|…`) and **returns FALSE for all three
 * probe questions above** — measured, not assumed. Adding it as a negative gate
 * would not have closed this. It is the right predicate for its own question and
 * the wrong instrument for this one.
 */
const CREATION_VERBS = String.raw`(?:add(?:ed)?|includ(?:e|ed)|creat(?:e|ed)|put|suggest(?:ed)?|introduc(?:e|ed)|invent(?:ed)?|generat(?:e|ed)|come\s+up\s+with)\b`;

/**
 * Conjunct 1 — does this message seek the ORIGIN of something,
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
  // "why did you add / include / suggest / put in …" — authorship of the
  // element's PRESENCE. The creation predicate is required: see CREATION_VERBS.
  new RegExp(String.raw`\bwhy\s+(?:did|would|do|does)\s+(?:you|olumi|the\s+model|it)\b[^?]{0,40}?\b` + CREATION_VERBS, 'i'),
  // "why is there a hybrid option", "why are there two options" — existential,
  // i.e. a question about the element being in the model at all.
  /\bwhy\s+(?:is|are|was|were)\s+there\b/i,
  // "why is the hybrid option in my model" — explicit inclusion locus.
  /\bwhy\s+(?:is|are|was|were)\b[^?]{0,60}?\bin\s+(?:my|the|this)\s+model\b/i,
  // "where did that come from", "where does this come from"
  /\bwhere\s+(?:did|does|do)\b[^?]{0,60}?\bcome\s+from\b/i,
  // "what is the hybrid option based on", "what are these based on"
  /\bwhat\s+(?:is|are|was|were)\b[^?]{0,80}?\bbased\s+on\b/i,
  // "on what basis did you …", "what's the basis for …"
  /\b(?:on\s+what\s+basis|what(?:'s|\s+is)\s+the\s+basis\s+for)\b/i,
  // "what made you add …" — creation predicate required, so "what made you
  // think that?" does not match.
  new RegExp(String.raw`\bwhat\s+(?:made|makes)\s+you\b[^?]{0,30}?\b` + CREATION_VERBS, 'i'),
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
  /** The RECORDS-dict shape (pre-boundary seams only). Null on a persisted graph. */
  readonly provenanceRecord: Record<string, unknown> | null;
  /** The PERSISTED V3 shape: a display enum string. This is what fires live. */
  readonly provenanceEnum: string | null;
  /** Lifted to node level by `projectNodeProvenance`, on BOTH branches. */
  readonly sourceQuote: string | null;
  readonly labelAuthored: boolean;
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
      provenanceRecord: asRecord(node.provenance),
      provenanceEnum: typeof node.provenance === 'string' ? node.provenance : null,
      sourceQuote:
        typeof node.source_quote === 'string' && node.source_quote.length > 0
          ? node.source_quote
          : null,
      labelAuthored: node.label_authored === true,
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
 * ⭐⭐ TWO DECLARED SHAPES, READ SEPARATELY — and round 1 read only the one that
 * never reaches this code.
 *
 * ── THE DEFECT (adversarial review, measured at every hop; I reproduced it) ───
 * Round 1 composed its answer from `provenance.provenance_class` / `basis` /
 * `unbased`, the RECORDS-dict shape written by `cee/draft/records/projector.ts`.
 * That shape does not survive to persistence. `transformResponseToV3`'s
 * `projectNodeProvenance` (`cee/transforms/schema-v3.ts:1133-1152`) **collapses
 * node provenance to the string enum** `"from_brief" | "ai_inferred" | "user_set"`,
 * and `NodeV3` strips undeclared keys. So `asRecord(node.provenance)` returned
 * `null` on every real graph and **the arm was DARK: it could never fire live.**
 *
 * Probe, run against a persisted-shape graph: the witness turn verbatim returned
 * `null`. My own journey witness had already recorded the tell and I did not read
 * it as one — *"All 19 nodes carry `provenance: "ai_inferred"`"*, a STRING. Every
 * dict-shaped fixture in this repo sits at a pre-boundary seam
 * (`draft/records/`, `structure/`, `unified-pipeline/stages/repair/`).
 * **Trap 16-inverse: a fixture I wrote myself is not evidence about the wire —
 * the trap this module's own header cites.**
 *
 * ── THE OTHER HALF: AUTHORSHIP MUST BE GATED ON THE BRIEF BINDING ────────────
 * Round 1's `stated` branch keyed on `provenance_class === 'stated'` alone and
 * emitted *"came from your brief. You wrote: …"* for records whose
 * `brief_binding` is `unverified` — which the producer defines as **"the brief was
 * available and does NOT support it"** (`cee/provenance/brief-binding.ts:88`).
 * Only `verified` earns a brief claim (`bindingEarnsBriefClaim`), and the wire
 * badge already obeys that, so the reply would have contradicted the badge on the
 * same node.
 *
 * ⭐ The persisted enum makes this gate FREE, which is why reading the right shape
 * also fixes the fabrication: `"from_brief"` is *defined* as
 * `provenance_class === "stated" && brief_binding === "verified"`. Reading the enum
 * inherits the producer's own verdict instead of re-deciding it.
 *
 * ── THE AMBIGUITY THE ENUM CREATES, AND WHY WE DECLINE ON IT ─────────────────
 * `"ai_inferred"` is the enum's catch-all: it covers BOTH "the model invented
 * this" AND "the user stated it but it could not be verified against the brief".
 * Saying *"this was my suggestion, not something you wrote"* about the second is a
 * fabrication in the opposite direction. They are separable, because
 * `projectNodeProvenance` lifts `source_quote` **outside** the enum decision — so
 * an unverified-stated node carries `ai_inferred` AND a `source_quote`. Where both
 * are present we DECLINE rather than guess (trap 22f), and the reasoning layer
 * takes the turn.
 *
 * ⚠ WHAT DOES NOT SURVIVE, STATED PLAINLY RATHER THAN FAKED: `basis` and
 * `unbased` are absent from the persisted shape. The "working from what you said
 * about X" clause and the "did not draw it from anything specific" sentence are
 * therefore **confined to the records-dict branch** and are simply not offered on
 * the persisted path. An answer that named a basis there would be inventing one.
 */
function composeAnswer(node: GraphNodeView, nodes: readonly GraphNodeView[]): string | null {
  const label = quote(node.label);
  const authoredTail = node.labelAuthored
    ? ' The label you see is mine rather than your own wording; your exact words are above.'
    : '';

  // ── The PERSISTED shape (what fires live) ─────────────────────────────────
  if (node.provenanceEnum !== null) {
    if (node.provenanceEnum === 'from_brief') {
      // Already means stated AND brief-verified. No second opinion needed.
      return node.sourceQuote === null
        ? `${label} came from your brief, not from me.`
        : `${label} came from your brief, not from me. You wrote: ${quote(node.sourceQuote)}.${authoredTail}`;
    }
    if (node.provenanceEnum === 'user_set') {
      return `${label} is there because you set it yourself, not because I suggested it.`;
    }
    if (node.provenanceEnum === 'ai_inferred') {
      // ⚠ The ambiguous case. A source_quote here means the user DID state
      // something that the brief check could not confirm — neither "mine" nor
      // "yours" is safe, so we say nothing.
      if (node.sourceQuote !== null) return null;
      return `${label} was my suggestion, not something you wrote. I put it forward while drafting the model from your brief.`;
    }
    // An enum value this code does not know. Never a guess.
    return null;
  }

  // ── The RECORDS-dict shape (pre-boundary seams) ───────────────────────────
  const provenance = node.provenanceRecord;
  if (!provenance) return null;
  const cls = provenance.provenance_class;

  if (cls === 'stated') {
    // ⭐ THE BINDING GATE. `verified` is the only verdict that earns a brief
    // claim; `unverified` means the brief was checked and does NOT support it,
    // and `unchecked`/absent means nothing was established. In the latter two we
    // decline outright rather than pick a side the badge would contradict.
    if (provenance.brief_binding !== 'verified') return null;
    const sq = typeof provenance.source_quote === 'string' && provenance.source_quote.length > 0
      ? provenance.source_quote
      : node.sourceQuote;
    const tail = provenance.label_authored === true || node.labelAuthored
      ? ' The label you see is mine rather than your own wording; your exact words are above.'
      : '';
    return sq === null || sq === undefined
      ? `${label} came from your brief, not from me.`
      : `${label} came from your brief, not from me. You wrote: ${quote(sq)}.${tail}`;
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
    // A basis exists but none of it resolves here. Claim neither it nor its absence.
    return `${label} was my suggestion, not something you wrote.`;
  }

  if (cls === 'projector_structural') {
    return (
      `${label} is scaffolding I added so the model holds together structurally. ` +
      `It is not something you wrote, and it carries no reasoning of its own.`
    );
  }

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
