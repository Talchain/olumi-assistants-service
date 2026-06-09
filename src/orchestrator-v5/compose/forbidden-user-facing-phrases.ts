/**
 * Single source of truth for phrases that must never appear in user-facing
 * prose ("hard-fail prose"), regardless of source (LLM output, deterministic
 * templates, fallback copy, recoverable-handler recovery text).
 *
 * Defined by the V5 stale-aware explain recovery brief. Consumers:
 *   - Runtime finaliser-level egress guard (turn-executor.ts +
 *     edit-graph-dispatch.ts + chip-click-dispatch.ts) — strips/replaces
 *     any assistant_text containing a match before commit.
 *   - Unit tests for state-query-guard, explain-results, chip-generator,
 *     no-op-helpers, staleness-prefix — assert deterministic copy never
 *     contains a forbidden phrase.
 *   - Replay harness (tools/v5-journey-replay/forbidden-terms.ts) — imports
 *     and threads through findForbiddenMatches so the harness and runtime
 *     agree on the contradiction list.
 *
 * Drift guard: add forbidden phrases here, NOT in downstream consumers.
 * The single source of truth is what prevents replay assertions and
 * runtime checks from diverging.
 *
 * British English where relevant. Each pattern is case-insensitive
 * and uses word boundaries (or line anchors with /m) so common
 * sub-string mishits are avoided. The "no changes" class is the
 * delicate one: a bare `\bno\s+changes\b` was over-broad (false-
 * positive on legitimate quoted labels like "No Changes Required"
 * embedded in safe_summary) and an under-narrow contextual-only set
 * missed the standalone denial case ("No changes."). The current
 * mix is the compromise — three contextual denial patterns AND a
 * line-anchored standalone pattern, with regression-test coverage
 * for both label-quote false-positive avoidance and standalone
 * denial detection.
 */

export const FORBIDDEN_USER_FACING_PHRASES: readonly RegExp[] = [
  // "I haven't applied any changes" — straight apostrophe AND curly
  // apostrophe variants. Anchoring on `\b` after `changes` allows for
  // trailing punctuation ("any changes.", "any changes in this session").
  /\bI\s+haven['’]t\s+applied\s+any\s+changes\b/i,
  /\bI\s+have\s+not\s+applied\s+any\s+changes\b/i,
  // Codex round-3 denial variants — simple past, alternative verbs,
  // singular noun form, "updates" instead of "changes". Each
  // expresses the same contradiction sense as the "I haven't applied
  // any changes" canonical entry. The contracted-form regex covers
  // both `apply` and `make` (Codex round-4: "I didn't make any
  // changes" was the missing variant the round-3 patch left out).
  /\bI\s+didn['’]t\s+(?:apply|make)\s+any\s+changes\b/i,
  /\bI\s+did\s+not\s+(?:apply|make)\s+any\s+changes\b/i,
  /\bno\s+change\s+was\s+made\b/i,
  /\bno\s+updates?\s+(?:were|are|have\s+been)\s+(?:made|applied)\b/i,
  // "nothing changed" — denial of state mutation.
  /\bnothing\s+changed\b/i,
  // "no changes" — contextual denial. The previous bare `\bno\s+changes\b`
  // pattern false-positived on legitimate label-quotes in
  // recent_changes[0].summary — e.g. a user-named option "No Changes
  // Required" embedded in a safe_summary string the state-query guard
  // quotes verbatim would erase the entire response via the egress
  // fallback. The three contextual patterns below catch denial framing
  // without catching quoted labels:
  //   1. "no changes [were/are/have been] [made|applied|necessary|needed|required]"
  //   2. "there [are/were/have been] no changes" (existential denial)
  //   3. "no changes [happened|occurred|emerged|appeared|reflected|to report]"
  // The original "I haven't applied any changes" / "nothing changed"
  // patterns still cover the strongest denial classes; these three are
  // the narrowing of the broader "no changes" rule.
  /\bno\s+changes\s+(?:were|are|have\s+been)\s+(?:made|applied|necessary|needed|required)\b/i,
  /\bthere\s+(?:are|were|have\s+been)\s+no\s+changes\b/i,
  /\bno\s+changes\s+(?:happened|occurred|emerged|appeared|reflected|to\s+report)\b/i,
  // Standalone denial — "No changes." / "No changes" as the entire
  // line/utterance. The /m flag makes ^/$ match line boundaries so
  // a terse LLM paragraph carrying just "No changes." is caught
  // even when wrapped in a longer multi-paragraph response.
  // Optional terminal punctuation covers full-stop / exclamation /
  // question variants. Label-quotes (e.g. "Updated the 'No Changes'
  // factor.") do NOT match because the line is not solely the
  // standalone phrase.
  /^\s*no\s+changes[.!?]?\s*$/im,
  // "unknown freshness" — internal/telemetry term that must never reach
  // user prose; the wire envelope's `analysis_ready.freshness: 'unknown'`
  // is separate, and the UI renders it without verbatim quoting.
  /\bunknown\s+freshness\b/i,
  // "loaded from a prior run" — legacy staleness phrasing (was emitted
  // by an earlier analysis-projection fallback) that the brief now
  // explicitly forbids.
  /\bloaded\s+from\s+a\s+prior\s+run\b/i,
  // "cached result" — implies stale state but does not name the
  // remediation; replaced by the brief's "may be out of date" copy.
  /\bcached\s+result\b/i,
  // "previous analysis" / "prior analysis" — both describe an analysis
  // run that the user no longer trusts; the brief's stale copy uses
  // "the model has changed since the last analysis" instead.
  /\bprevious\s+analysis\b/i,
  /\bprior\s+analysis\b/i,
  // V5 H5 — internal-jargon defence. The edit_graph and draft_graph
  // system prompts teach the LLM the word "validator" (and "code
  // validator"), which then surfaces in coaching summaries and was
  // observed leaking through user-facing prose on a staging replay
  // (dl7-staleness). The V4 Mode B fix drops `coaching.summary`
  // passthrough at the no-op path, but the LLM-authored success
  // narration on Mode C can still include internal terms, so this
  // wire-level defence catches any future emit path that hasn't
  // sanitised. Each entry was false-positive-swept against
  // user-facing tests/fixtures before adding — see notes below.
  //
  // Bare-word entries (no plausible user-domain meaning in CEE):
  /\bvalidator(s)?\b/i,           // observed leak; tests use it only in internal `details.failure_origin`
  /\bdispatcher\b/i,              // no user-facing hits in codebase prose
  /\bZod\b/,                       // library name; case-sensitive — "zod" is not a common word
  /\btool\s+calls?\b/i,           // internal term — Sonnet tool call, LLM tool call
  // Narrow contextual entries (bare form would false-positive on
  // legitimate business prose like "envelope of options" or "code
  // validator's report"; narrowed to the exact internal phrasings):
  /\b(response|wire|XML)\s+envelope\b/i,
  /\bcode\s+validator\b/i,        // exact phrasing from draft_graph prompts
  // V5 P0 stabilisation — prescriptive-language defence-in-depth.
  // PR #171 dropped "recommendation" from CEE templates by construction;
  // these regexes prevent a future emit path (deterministic template or
  // LLM authorship) from re-introducing prescriptive copy the brief
  // bans as user-facing. Brief: treat "recommendation" / "recommended"
  // / "winner" / "winning" as banned user-facing wording.
  //
  // "recommendation(s)" and "recommended" are banned broadly — they
  // have no legitimate user-domain use in V5 prose (CEE never quotes
  // user-authored content containing these terms; decision-domain
  // labels are factor/option names, not advice verbs).
  //
  // "winner" / "winning" are NARROWED to prescriptive phrasings only —
  // a user-authored option label like "Winner Take All" would
  // legitimately appear inside a quoted safe_summary, and a bare
  // `\bwinner\b` would erase the entire response via the egress
  // fallback. The narrowed forms target the prescriptive uses
  // ("the winner", "winning option / probability / side / choice")
  // without catching label-quotes.
  /\brecommendations?\b/i,
  /\brecommended\b/i,
  /\bthe\s+winners?\b/i,
  /\bwinning\s+(?:option|probability|side|choice|outcome)\b/i,
  // V5 deterministic-copy hardening (Area A) — internal implementation
  // vocabulary that must never reach user-facing prose. CONSERVATIVE set:
  // only multi-word internal phrases + single words with no legitimate
  // user-domain meaning in CEE decision prose. The egress guard REPLACES the
  // whole response on a hit, so wider single words like `handler` / `debug`
  // are INTENTIONALLY excluded here (legitimate-prose false-positive risk —
  // "I can handle that", "help me debug X"); they are enforced by the
  // deterministic-copy sweep test instead. Each form tolerates a space or an
  // underscore so both the prose phrase ("context pack") and the snake_case
  // identifier ("context_pack") are caught. Only `assistant_text` is scanned,
  // so structured field names (`graph_hash`, `node_id`) in data payloads are
  // unaffected. False-positive-swept against user-facing fixtures.
  /\bcontext[\s_]packs?\b/i,
  /\bturn[\s_]class(?:es)?\b/i,
  // `direct answer` (spaced) is legitimate English ("here's a direct answer"),
  // and the egress guard REPLACES the whole response on a hit — so ONLY the
  // snake_case turn-class identifier is runtime-blocked. The spaced form is
  // still enforced against deterministic composer copy by the wider-set sweep
  // test (it must never appear in CEE-authored prose), just not at runtime.
  /\bdirect_answers?\b/i,
  /\bgraph[\s_]hash(?:es)?\b/i,
  /\bnode[\s_]ids?\b/i,
  /\b_meta\b/i,
  /\borchestrator\b/i,
];

/**
 * Return the first forbidden phrase that hits in `text`, or null when
 * clean. Used by the egress guard for both the detection signal and the
 * telemetry payload. Returns the matched substring (not the source regex)
 * so dashboards can group hits by phrase verbatim.
 */
export function findForbiddenPhraseHit(text: string): string | null {
  if (!text || text.length === 0) return null;
  for (const re of FORBIDDEN_USER_FACING_PHRASES) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * Neutral fallback assistant_text used when the egress guard fires.
 *
 * Property: contains no token from `FORBIDDEN_USER_FACING_PHRASES`. The
 * helper is responsibility-light — it does not name what was wrong with
 * the original text, only invites the user to direct the next action.
 * The chip set and blocks survive the rewrite so the user retains a
 * recovery affordance.
 */
export const EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT =
  "Let me know what you'd like me to do next, and I'll take it from there.";

/**
 * Apply the finaliser-level egress guard to a candidate `assistant_text`
 * value. Pure function — returns either the original text unchanged
 * (when clean) or the neutral fallback (when a forbidden phrase fires).
 *
 * Callers MUST emit `v5.egress.forbidden_phrase_detected` telemetry on
 * a rewritten result, tagging the per-emit-path `dispatch_path`. The
 * helper itself is telemetry-free so it stays usable from any module
 * without coupling to the telemetry registry.
 *
 * Idempotent: a second call on a rewritten result is a no-op because
 * the fallback contains no forbidden phrase.
 */
export interface EgressGuardResult {
  readonly rewritten: boolean;
  readonly text: string;
  readonly hit: string | null;
}

export function applyEgressForbiddenPhraseGuard(text: string): EgressGuardResult {
  const hit = findForbiddenPhraseHit(text);
  if (hit === null) return { rewritten: false, text, hit: null };
  return {
    rewritten: true,
    text: EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
    hit,
  };
}

/**
 * Success-claim language detector. Counterpart to
 * `FORBIDDEN_USER_FACING_PHRASES`: that list catches lexical denial
 * ("I haven't applied any changes") which contradicts a real commit;
 * this list catches lexical success ("I've successfully updated") which
 * contradicts a real *non*-commit.
 *
 * Used by the V5 edit_graph dispatcher's structural-mismatch invariant
 * (V5 H5): when `handleEditGraph` returns wasRejected=false + zero
 * operations + no applied graph, ANY success-claim language in
 * `assistantText` is by definition false — there is no persisted state
 * to back the claim. The invariant rewrites `assistant_text` to the
 * neutral fallback and emits V5EditGraphFalseSuccessRewritten so ops
 * can chase the upstream emit path.
 *
 * Each regex is intentionally narrow: it matches lexical success
 * patterns that imply a commit happened, NOT general affirmative
 * language ("yes", "ok", "I can help"). Examples that SHOULD hit:
 *   - "I've successfully updated the model."
 *   - "I have applied the change."
 *   - "The edit has been applied."
 *   - "Successfully changed X."
 * Examples that should NOT hit (general affirmation, not commit claim):
 *   - "I can apply this if you confirm."
 *   - "I'd like to apply this change."
 *   - "I'll update the value once you specify it."
 */
export const SUCCESS_CLAIM_PATTERNS: readonly RegExp[] = [
  // "successfully" qualifier paired with a commit verb
  /\bsuccessfully\s+(?:applied|updated|set|added|removed|changed|edited|adjusted|modified|created)\b/i,
  // "I've / I have + commit verb" — perfective claim of completed mutation
  /\bI['’]ve\s+(?:applied|updated|set|added|removed|changed|edited|adjusted|modified|created)\b/i,
  /\bI\s+have\s+(?:applied|updated|set|added|removed|changed|edited|adjusted|modified|created)\b/i,
  // "the (change|edit|update|mutation) (has been|is now|was) applied/made"
  /\bthe\s+(?:change|edit|update|mutation|adjustment)\s+(?:has\s+been|is\s+now|was)\s+(?:applied|made|saved|committed)\b/i,
  // "has been + commit verb" — passive completion
  /\bhas\s+been\s+(?:applied|updated|set|added|removed|changed|saved|committed)\b/i,
  // Terse commit acknowledgements (Codex P1 follow-up). These are
  // colloquial confirmations the LLM may emit in a coaching summary
  // or warning string. The V4 Mode B fix already drops both fields
  // on no-op paths, so reaching the wire with these requires a
  // future emit-path regression — this set is defence-in-depth for
  // that scenario.
  /^\s*Done\b[.!\s—-]/m,         // line-anchored "Done.", "Done —", "Done!"
  /\bAll\s+set\b/i,              // "All set." or "All set to N."
  // Sentence-leading bare past-tense commit verbs: "Updated Price.",
  // "Added a constraint.", "Set X to N.". Line-anchored with /m so
  // a successful narration starting any line fires; mid-sentence
  // legitimate prose like "I've already updated this" does NOT match
  // because the verb is not sentence-leading. Requires at least one
  // non-whitespace character after the verb so trailing "Updated"
  // (incomplete sentence) doesn't fire, but accepts both
  // capitalised noun phrases ("Updated Price.") and articled
  // phrases ("Added a constraint.").
  /^\s*(?:Updated|Set|Added|Removed|Changed|Edited|Applied|Adjusted|Modified|Created)\s+\S/m,
];

/**
 * Return the first success-claim pattern that hits in `text`, or null
 * when clean. Mirrors `findForbiddenPhraseHit`'s shape so the
 * dispatcher's rewrite path can treat both signals uniformly.
 */
export function findSuccessClaimHit(text: string): string | null {
  if (!text || text.length === 0) return null;
  for (const re of SUCCESS_CLAIM_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/**
 * R10 — internal-vocabulary / raw-identifier patterns used ONLY by the
 * edit_graph no-op clarification-preservation gate.
 *
 * Deliberately NOT part of {@link FORBIDDEN_USER_FACING_PHRASES}: the global
 * egress guard replaces the WHOLE response on a forbidden hit, and bare words
 * like `node`, `edge`, `path`, `graph`, `operation` have legitimate English /
 * decision-domain uses that would erase ordinary responses. Here a hit merely
 * DECLINES preservation of the LLM's clarifying question and falls back to the
 * deterministic copy — so the gate is intentionally aggressive (false-positive
 * cost is a safe deterministic message, never an erased response).
 *
 * Covers the residual terms the success-claim / forbidden-phrase detectors do
 * not: the bare structural words, the internal nouns, and raw id / path / edge
 * shapes the LLM might echo. The id/path/arrow patterns require an
 * internal-looking token shape (snake_case, `word.word`, or `a->b`) so prose
 * punctuation ("e.g.", a sentence-ending period) does not trip them.
 */
export const EDIT_INTERNALS_PATTERNS: readonly RegExp[] = [
  /\bhandler\b/i,
  /\bschema\b/i,
  /\bvalidator\b/i,
  /\bJSON\b/,
  /\boperations?\b/i,
  /\bgraph\b/i,
  /\b(?:node|edge)s?\b/i,
  /\bpath\b/i,
  // snake_case internal ids: fac_price, dec_launch, opt_hire_local
  /\b[a-z]+_[a-z0-9_]+\b/i,
  // dotted internal paths: operations.path, node.id (≥2 chars each side so
  // "e.g."/"i.e."/sentence boundaries do not match)
  /[a-z_]{2,}\.[a-z_]{2,}/i,
  // raw ascii edge arrows: fac_x->goal_revenue
  /->/,
];

/**
 * Return the first internal-vocabulary / raw-identifier hit in `text`, or null
 * when clean. Used by the no-op preservation gate (see EDIT_INTERNALS_PATTERNS).
 */
export function findEditInternalsHit(text: string): string | null {
  if (!text || text.length === 0) return null;
  for (const re of EDIT_INTERNALS_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
