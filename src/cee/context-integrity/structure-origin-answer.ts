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
 * Every sentence this module emits is derived from the node's own persisted
 * fields as DECLARED BY THE PRODUCER, never from a distribution observed in a
 * corpus. The producer here is `cee/transforms/schema-v3.ts` + the V3 node
 * contract at `schemas/cee-v3.ts:208-237`:
 *   · `provenance: "from_brief"` — set at `schema-v3.ts:1136` when the typed
 *     record is `provenance_class === 'stated' && brief_binding === 'verified'`,
 *     and at `:1165`/`:1171` when `bindingEarnsBriefClaim(bindOptionLabelToBrief(...))`
 *     holds. `verified` is defined by `cee/provenance/brief-binding.ts:88` as
 *     "tied to brief bytes; may claim brief provenance". THE BRIEF-BINDING GATE
 *     IS THEREFORE ALREADY INSIDE THE ENUM — we inherit the producer's verdict
 *     rather than re-deciding it, which is also what the wire badge obeys.
 *   · `provenance: "ai_inferred"` — everything else, INCLUDING a stated record
 *     whose brief check came back `unverified`/`unchecked`. It is a catch-all,
 *     not a claim of invention (see the ambiguity note on `composeAnswer`).
 *   · `provenance: "user_set"` — declared by the V3 node contract at
 *     `cee-v3.ts:208` and by the route contract at `assist.v1.draft-graph.ts:49`.
 *   · `source_quote` — "the user's verbatim words", lifted to node level at
 *     `schema-v3.ts:1145`, OUTSIDE the enum decision.
 *   · `label_authored` — "the DISPLAY LABEL is ours rather than the user's
 *     verbatim", derived at the producer from `label !== source_quote`
 *     (`cee-v3.ts:231-237`), lifted at `schema-v3.ts:1146`.
 *
 * ⚠⚠ WHAT IS NOT HERE, AND WHY THE MODULE NO LONGER LOOKS FOR IT.
 * Round 1 composed its answer from `provenance.provenance_class` / `basis` /
 * `unbased` — the RECORDS-DICT shape written by `cee/draft/records/projector.ts`.
 * **That shape cannot exist in the graph this module receives.** Derived at the
 * producer, not inferred: `transformNodeToV3` (`schema-v3.ts:222`) REBUILDS each
 * node field-by-field — there is no spread of the V1 node, and the producer's own
 * comment at `:248` states the consequence ("the transform rebuilds the node
 * field-by-field, so a `goal_threshold_frame` minted on the V1 draft graph is
 * dropped here unless it is named"). `provenance` is never named there, and every
 * later assignment to `v3Node.provenance` is a STRING (`:538`, `:554`, `:1136`,
 * `:1165`, `:1171`). So `basis` and `unbased` are not merely absent from the wire,
 * they are unreachable — and the "working from what you said about X" clause and
 * the "did not draw it from anything specific" sentence are **dropped, not
 * re-grounded and not faked**. An answer naming a basis here would be inventing
 * one. `RED-DICT` pins the consequence: an object-shaped provenance DECLINES, so
 * no pre-boundary fixture can ever certify this arm again.
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
  /**
   * The PERSISTED V3 shape, and the ONLY shape read here: a display enum string
   * (`schemas/cee-v3.ts:208`).
   *
   * ⚠ NULL FOR AN OBJECT, DELIBERATELY. A records-dict `provenance` is a
   * PRE-BOUNDARY artefact that `transformNodeToV3` cannot emit, so meeting one
   * means we are being handed a graph from a seam this module does not serve.
   * The honest response is to decline, not to grow a second reader for it —
   * a second reader is how round 1 shipped a dark arm certified by its own
   * fixture (trap 16-inverse). Pinned by `RED-DICT`.
   */
  readonly provenanceEnum: string | null;
  /** Lifted to node level by `projectNodeProvenance` (`schema-v3.ts:1145-1146`). */
  readonly sourceQuote: string | null;
  /**
   * ⭐⭐ WHETHER A QUOTE WAS RECORDED AT ALL — which is NOT the same question as
   * whether we can READ one, and conflating them was a live fabrication.
   *
   * Found by P1 (drive a malformed input one seam PAST the guard): a node
   * carrying `source_quote: 99` from a degraded JSONB read fails the string
   * test, so `sourceQuote` is null, so the `ai_inferred` ambiguity gate below
   * does not fire — and the user is told their own words were "my suggestion,
   * not something you wrote". The presence of the field is the producer telling
   * us this node came off a STATED record (`schema-v3.ts:1145` lifts it only
   * from `typed.source_quote`), so presence alone must close the gate.
   * Fail-CLOSED: an unreadable quote declines, and declining costs only a
   * fall-through to the reasoning layer. Pinned by RED-I / RED-27.
   */
  readonly quoteRecorded: boolean;
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
      provenanceEnum: typeof node.provenance === 'string' ? node.provenance : null,
      sourceQuote:
        typeof node.source_quote === 'string' && node.source_quote.length > 0
          ? node.source_quote
          : null,
      // `undefined` is the ONLY value that means "no stated record behind this".
      // Anything else — a string, an empty string, a number, null — means the
      // producer wrote the field, and we must not out-argue it.
      quoteRecorded: node.source_quote !== undefined,
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

/**
 * ⭐⭐ IS A RECORDED SESSION MUTATION ABOUT THE ELEMENT THIS QUESTION NAMES?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Composed journey witness, 18 Aug 2026, deployed CEE `4a513781`, LINK 6, VERBATIM:
 *
 *   user:  "Why did you add a status quo option? I never mentioned one —
 *           where did that come from?"
 *   Olumi: "Updated Enterprise sales headcount and spend"   (`llm_calls: 0`)
 *
 * The caller's origin arm deferred to the session-edit arms on the blanket test
 * `recent_changes.length > 0`, and the readback arm then answered a provenance
 * challenge with the PREVIOUS turn's mutation receipt. **The product asserted a
 * change on a turn that made none** — worse in kind than the deflection it
 * replaced, because a deflection declines and this one states a falsehood about
 * the user's own model.
 *
 * ── THE QUESTION THIS PREDICATE ANSWERS (trap 21, written down first) ────────
 * NOT "is this an origin question?" (that is `isStructureOriginQuestion`) and NOT
 * "can we answer it?" (that is `tryStructureOriginAnswer`). It answers exactly
 * one thing: **is the session-edit reading of this question even available?**
 *
 * The deferral it gates is genuinely right in one case and only one: *"why did
 * you add the cost constraint?"* when the cost constraint is precisely what was
 * just changed. There, "why did you make that edit" and "why does this exist"
 * are indistinguishable, and trap 22f is explicit that we do not guess — the
 * readback arm quotes a REAL persisted mutation, so deferring leaves the user
 * with grounded copy. When the recorded change concerns a DIFFERENT element the
 * ambiguity does not exist at all: nothing about a question naming the status quo
 * option can be a request for a receipt about enterprise sales headcount.
 *
 * ── WHY THIS IS NOT ANOTHER PHRASE-LIST ROUND ───────────────────────────────
 * CEE #888 burned four rounds oscillating on one natural-language predicate, and
 * the ruling (trap 22f) was that no further punctuation-or-phrasing rule settles
 * such a thing. **Nothing is added to any phrase list here.** This conjunct is a
 * fact about STATE: it resolves the subject with the module's existing
 * identity-binding resolver and compares it against the persisted
 * `RecentMutation.target_label` the handler itself wrote. Phrasing decides
 * nothing.
 *
 * ── FAILURE DIRECTION, STATED ───────────────────────────────────────────────
 * `false` is the permissive answer here (the caller then answers from provenance
 * or declines to the reasoning layer); `true` preserves today's behaviour. So it
 * is written to err TOWARDS `true`: any identifying-token overlap defers. An
 * incidental overlap ("Enterprise partnerships" vs "Enterprise sales headcount")
 * therefore costs only the status quo, which the caller's own copy fix has
 * already made truthful. What it must never do is defer on NO overlap, which is
 * the witnessed harm.
 *
 * Returns `false` when the subject cannot be resolved — an unresolvable subject
 * is not evidence of ambiguity, and the caller's next step (`tryStructureOriginAnswer`)
 * declines on exactly the same resolution failure.
 */
export function originSubjectIsRecentlyChanged(
  message: string,
  graph: unknown,
  recentTargetLabels: readonly string[],
): boolean {
  const subject = resolveElement(message, graph);
  if (subject === null) return false;
  const subjectTokens = identifyingTokens(subject.label);
  if (subjectTokens.size === 0) return false;
  for (const raw of recentTargetLabels) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    for (const token of identifyingTokens(raw)) {
      if (subjectTokens.has(token)) return true;
    }
  }
  return false;
}

// ============================================================================
// Conjunct 3 — composing the answer from the record, and only from the record
// ============================================================================

function quote(text: string): string {
  return `"${text}"`;
}

/**
 * ⭐⭐ ONE SHAPE, THE ONE THAT REACHES THIS CODE — and round 1 read the other.
 *
 * ── THE DEFECT (adversarial review, measured at every hop; reproduced here) ──
 * Round 1 composed its answer from `provenance.provenance_class` / `basis` /
 * `unbased`, the RECORDS-dict shape written by `cee/draft/records/projector.ts`.
 * That shape does not survive to persistence. `transformResponseToV3`'s
 * `projectNodeProvenance` (`cee/transforms/schema-v3.ts:1122-1175`) **collapses
 * node provenance to the string enum** `"from_brief" | "ai_inferred" | "user_set"`.
 * So `asRecord(node.provenance)` returned `null` on every real graph and **the arm
 * was DARK: it could never fire live.** Its own journey witness had already
 * recorded the tell — *"All 19 nodes carry `provenance: "ai_inferred"`"*, a STRING
 * — and round 1 did not read it as one.
 * **Trap 16-inverse: a fixture you wrote yourself is not evidence about the wire.**
 *
 * ⚠ ROUND 2 KEPT A SECOND, DICT-READING BRANCH "for the pre-boundary seams". THAT
 * IS ALSO REMOVED, and the removal is the substantive half of this closure.
 * Reachability was DERIVED, not assumed: this module has exactly ONE call site
 * (`orchestrator-v5/routing/state-query-guard.ts:417`), which passes
 * `input.briefAudit.graph` = `context.persistedGraph` = the `scenarios.graph`
 * column (`session/supabase-store.ts:1676`). Every writer of that column writes a
 * post-boundary `GraphV3T`, and `transformNodeToV3` rebuilds each node
 * field-by-field without ever naming `provenance` — so a dict-shaped provenance
 * is not merely unlikely there, it is unproducible. A branch that cannot execute
 * is not a fallback; it is a second reader whose green tests describe a seam the
 * product does not have. That is exactly how the dark arm shipped, so keeping it
 * would leave the defect class in place while claiming to have removed it.
 *
 * ── THE BRIEF-BINDING GATE IS INSIDE THE ENUM, WHICH IS WHY READING THE RIGHT
 *    SHAPE ALSO FIXES THE FABRICATION ───────────────────────────────────────
 * Round 1's `stated` branch keyed on `provenance_class === 'stated'` alone and
 * emitted *"came from your brief. You wrote: …"* for records whose
 * `brief_binding` is `unverified` — which the producer defines as **"the brief was
 * available and does NOT support it"** (`cee/provenance/brief-binding.ts:88`;
 * 22% of stated records on the reference capture). The reply would have
 * contradicted the wire badge on the same node. `"from_brief"` is *defined* at
 * `schema-v3.ts:1136` as `provenance_class === "stated" && brief_binding ===
 * "verified"`, and at `:1165`/`:1171` as `bindingEarnsBriefClaim(...)`. Reading
 * the enum INHERITS the producer's verdict instead of re-deciding it, so the
 * chat reply and the badge cannot disagree.
 *
 * ⚠ Note the second producer path this admits, and it is legitimate: an option
 * whose LABEL binds to the brief (`bindOptionLabelToBrief`) earns `"from_brief"`
 * with NO `source_quote`. "Came from your brief, not from me" is exactly the
 * claim the badge makes for it, so it is honest with no quote to offer, and the
 * `You wrote:` clause is simply omitted. Pinned by `RED-24`.
 *
 * ── THE AMBIGUITY THE ENUM CREATES, AND WHY WE DECLINE ON IT ─────────────────
 * `"ai_inferred"` is the enum's catch-all: it covers BOTH "the model invented
 * this" AND "the user stated it but it could not be verified against the brief".
 * Saying *"this was my suggestion, not something you wrote"* about the second is a
 * fabrication in the opposite direction. They are separable, because
 * `projectNodeProvenance` lifts `source_quote` **outside** the enum decision
 * (`:1145`) — so an unverified-stated node carries `ai_inferred` AND a
 * `source_quote`. Where both are present we DECLINE rather than guess (trap 22f),
 * and the reasoning layer takes the turn.
 *
 * ⚠ WHAT IS DROPPED RATHER THAN FAKED: `basis` and `unbased` do not exist in the
 * persisted shape, so the "working from what you said about X" clause and the
 * "did not draw it from anything specific in your brief" sentence are GONE. There
 * is no honest re-grounding available for them here, and inventing one would be
 * the fabrication this module exists to prevent.
 */
function composeAnswer(node: GraphNodeView): string | null {
  const label = quote(node.label);
  const authoredTail = node.labelAuthored
    ? ' The label you see is mine rather than your own wording; your exact words are above.'
    : '';

  // ⚠ NULL HERE MEANS THE PROVENANCE WAS ABSENT **OR** OBJECT-SHAPED. Both
  // decline. An object is a pre-boundary artefact from a seam this module does
  // not serve (see the header derivation); guessing at it would rebuild the
  // dark-arm defect. Pinned by `RED-DICT` and `RED-10`.
  if (node.provenanceEnum === null) return null;

  if (node.provenanceEnum === 'from_brief') {
    // Already means stated AND brief-verified, or label-bound-and-verified.
    // No second opinion needed, and none may be substituted.
    return node.sourceQuote === null
      ? `${label} came from your brief, not from me.`
      : `${label} came from your brief, not from me. You wrote: ${quote(node.sourceQuote)}.${authoredTail}`;
  }

  if (node.provenanceEnum === 'user_set') {
    return `${label} is there because you set it yourself, not because I suggested it.`;
  }

  if (node.provenanceEnum === 'ai_inferred') {
    // ⚠ The ambiguous case. A recorded source_quote here means the user DID
    // state something that the brief check could not confirm — neither "mine"
    // nor "yours" is safe, so we say nothing. Keyed on RECORDED, not on
    // readable: see `quoteRecorded`.
    if (node.quoteRecorded) return null;
    // ⚠⚠ ROUND 2 APPENDED "I put it forward while drafting the model from your
    // brief." — CAUGHT BY THE DERIVED GUARD (RED-21), NOT BY INSPECTION, and it
    // is this module's own defect class one level down. The enum records that
    // the content is not the user's stated words. It records NOTHING about WHEN
    // the element was introduced or WHAT it was drafted from, and `ai_inferred`
    // is equally the value for an element Olumi minted during a LATER
    // `edit_graph` turn in response to the user's own instruction. Telling that
    // user we put it forward "while drafting the model from your brief" is a
    // narrative the persisted state does not support, and it contradicts what
    // they remember doing. The bare, warranted sentence is the whole answer.
    return `${label} was my suggestion, not something you wrote.`;
  }

  // An enum value this code does not know. Never a guess.
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
  return composeAnswer(element);
}
