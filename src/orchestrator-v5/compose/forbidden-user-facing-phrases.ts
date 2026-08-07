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

import { applyTerminologyRewrite } from './terminology-rewrite.js';

/**
 * ROADMAP 2.213 — the no-recommendations doctrine, at the wire seam.
 *
 * Founder's BINDING ruling: "the product should not be recommending
 * anything. It should be just providing science-grounded data and
 * coaching." The four recommendation-NOUN patterns in the V5 P0 set
 * (`recommendation`, `recommended`, `the winner`, `winning <X>`) let the
 * whole ADVISORY REGISTER through: "X is the clear best choice", "X is your
 * best bet", "X is advisable", "X is the way to go", "you should choose X"
 * all passed clean. `src/cee/key-insight/index.ts` (12 strings) and
 * `src/cee/recommendation-narrative/templates.ts` (11) shipped exactly that
 * copy on live registered routes behind this guard until 2.213 deleted both.
 * The guard read as protection and was not.
 *
 * REMEDY CLASS — deliberately FATAL, not rewritable. The RC4 rewrite-first
 * path (`applyTerminologyRewrite`) fixes a vocabulary offence in place
 * ("recommendation" → "leading option"). A choice directive is not a
 * vocabulary offence: substituting a noun leaves the product still telling
 * the user what to pick. So there is NO TERMINOLOGY_RULES entry for this
 * family, and a hit takes the whole-response neutral fallback. Because that
 * remedy is destructive, every pattern below is anchored to a CHOICE frame
 * rather than to bare English, and each was false-positive-swept over all
 * 2,813 string-bearing files in this repo (src, tests, Prompts, tools,
 * contracts, config, data, openapi.yaml) before being added.
 *
 * ⚠ WHY THIS IS A NAMED EXPORT AND NOT SIX INLINE ENTRIES. The fatal class is
 * distinguished from the rewritable class by an ABSENCE — no TERMINOLOGY_RULES
 * entry matches these frames — and an absence has no symbol to assert against.
 * Inlined, the only way to test the class was a hand-listed array of exemplar
 * strings in the spec, i.e. a hand-maintained mirror: add a seventh pattern (or
 * add a TERMINOLOGY_RULES entry that quietly downgrades one of these six to a
 * content-preserving rewrite) and the spec keeps passing while the doctrine
 * silently weakens. Exporting the set lets the spec ITERATE it and derive the
 * three properties per pattern — hits / no terminology rewrite applies /
 * remedy is the whole-response fallback — so both drift directions go RED.
 * See `__tests__/forbidden-user-facing-phrases.test.ts`.
 */
export const DOCTRINE_FATAL_PATTERNS: readonly RegExp[] = [
  // 1. The superlative-choice crowning: "<X> is/remains/looks like/appears to
  //    be [the|your|clearly the|…] <superlative> <choice-noun>". The copula
  //    anchor is what keeps legitimate coaching sayable — "what would make
  //    Option B the better choice?" (adapters/llm/router.ts) carries no copula
  //    and does not match. The negation lookahead keeps the product able
  //    to DE-recommend: "the status quo is not always the safest choice"
  //    (cee/validation/pre-decision-checks.ts) must survive, and does.
  //    `become` is deliberately absent from the copula set so conditional
  //    flip readings ("X could become the better choice") stay sayable.
  //
  //    ⚠ ROADMAP 2.725 — `strongest|most promising` ADDED, closing a MEASURED
  //    evasion. `src/services/review/blockBuilders.ts:459` shipped
  //    `"{label}" appears to be the strongest option.` and passed this pattern
  //    clean, because `strongest` was absent from an alternation that already
  //    carried `best|better|optimal|right|obvious|clear|clearest|smartest|
  //    safest|sensible|superior|preferable`. Two sibling layers in this same
  //    estate ALREADY treat it as a crowning word — the decision-review
  //    validator's WIN_CUE (`decompose.ts`) and the unified-pipeline coaching
  //    instructions (`coaching-pass.ts:172-173`, which ban "strongest or most
  //    promising option" verbatim). The wire guard was the one that did not
  //    know it. `most promising` rides along because the sibling that already
  //    bans `strongest` bans it in the same breath, and leaving it out would
  //    recreate the same one-word hole one synonym over.
  //
  //    FALSE-POSITIVE SWEEP (2.725, at 8c316b5e, 2,991 string-bearing files
  //    across src/ Prompts/ data/ tools/ tests/ contracts/ config/ +
  //    openapi.yaml + package.json): the extended alternation matches 12 lines
  //    the current one does not. ONE is production source — the evasion above,
  //    fixed in the same change. The other ELEVEN are all ADVERSARIAL fixtures
  //    and negative-assertion strings (validator-explanation, validation-
  //    registry `adversarial`, journey-classifiers, coaching-output-postcheck,
  //    critiques-leader-claim-scan, the orchestrator-eval vocabulary fixture),
  //    i.e. strings that exist precisely BECAUSE this register is banned.
  //    Zero legitimate-prose false positives.
  /\b(?:is|are|was|were|remains?|looks?\s+like|seems?|appears?\s+to\s+be)\s+(?!not\b|never\b|no\b|rarely\b|seldom\b)(?:\w+\s+){0,2}(?:best|better|optimal|right|obvious|clear|clearest|smartest|safest|sensible|superior|preferable|strongest|most\s+promising)\s+(?:choice|option|bet|path|route)\b/i,
  // 2. "your/the best bet" without a copula ("Your best bet: X").
  /\b(?:your|the)\s+best\s+bet\b/i,
  // 3. "advisable" — the ruling's exact prohibited verb. Bare-word safe: the
  //    sweep found it in exactly four places, all inside the two modules 2.213
  //    deleted, and nowhere else in the repo.
  /\badvisable\b/i,
  // 4. "the way to go" — one occurrence repo-wide, in a deleted template. No
  //    legitimate use in data or coaching register.
  /\bthe\s+way\s+to\s+go\b/i,
  // 5. "gives you the best chance of <goal>" — a superlative crowning wearing
  //    a probability's clothes, with no number attached.
  /\bgives?\s+you\s+the\s+best\s+chance\b/i,
  // 6. The explicit choice directive. This mirrors, verbatim, the pattern
  //    `coaching/copy-quality-gate.ts:127` has policed on the COACHING path
  //    since PR #171 — the gap 2.213 closes is that the WIRE guard never
  //    carried it. Reusing the already-swept shape (rather than inventing a
  //    wider one) is why bare "go with" / "proceed with" are NOT here: the
  //    sweep found 66 legitimate "proceed with" and 69 legitimate "go with"
  //    hits — option labels ("Proceed with acquisition"), coaching ("proceed
  //    with caution"), and the user's own quoted question ("Should I go with
  //    A or B?"). Banning them bare would erase real responses.
  /\b(?:you|i)\s+(?:should|would)\s+(?:choose|pick|go\s+with|select)\b/i,
];

/**
 * ROADMAP 2.725 — the recommendation-NOUN class, extracted so a SECOND surface
 * can share this exact definition instead of copying it.
 *
 * These four patterns lived inline in {@link FORBIDDEN_USER_FACING_PHRASES}
 * until 2.725 needed them on the `assist.v1.*` route family too (see
 * `src/services/doctrine/route-egress-doctrine-scan.ts`). Copying four regexes
 * into a second module would have been the estate's dominant defect — a
 * hand-maintained mirror that reads green while it drifts (CLAUDE.md trap 12).
 * Naming the set is what makes both consumers spread ONE definition, and lets
 * a spec assert set-membership by IDENTITY (`toContain(pattern)` on the regex
 * object, not on its source string) so adding a fifth pattern here
 * automatically covers both paths and cannot silently cover only one.
 *
 * Remedy class differs BY CONSUMER and that is deliberate:
 *   - turn path: rewritable — `applyTerminologyRewrite` maps every one of these
 *     ("recommendation" → "leading option", "recommended" → "suggested",
 *     "the winner" → "the leading option", "winning <X>" → "leading <X>").
 *   - route family: detection only. See that module's header for why importing
 *     the turn path's remedy would corrupt user-authored content.
 */
export const DOCTRINE_VERDICT_PATTERNS: readonly RegExp[] = [
  /\brecommendations?\b/i,
  /\brecommended\b/i,
  /\bthe\s+winners?\b/i,
  /\bwinning\s+(?:option|probability|side|choice|outcome)\b/i,
];

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
  // Declared above as DOCTRINE_VERDICT_PATTERNS (2.725) and spread in here, so
  // the `assist.v1.*` route scanner and this turn-path guard share ONE
  // definition rather than two copies that drift. Full rationale on that
  // constant.
  ...DOCTRINE_VERDICT_PATTERNS,
  // ROADMAP 2.213 — the no-recommendations doctrine (the six choice-directive
  // frames). Declared above as DOCTRINE_FATAL_PATTERNS and spread in here, so
  // the fatal-remedy class has a symbol the spec can iterate; full rationale
  // lives on that constant.
  ...DOCTRINE_FATAL_PATTERNS,
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
  // ROADMAP 2.655 — THE OPERATION-BUDGET VOCABULARY.
  //
  // Witnessed on the wire (walk 2.634, 2026-08-07): "it would require 6 node
  // operations and 6 edge operations - more than is safe in a single edit
  // (limit: 4 node ops, 8 edge ops)". A patch operation is an internal unit;
  // a user has no way to count one, and the sentence named a cap that had not
  // even been breached.
  //
  // ⚠ SCOPE, DELIBERATELY NARROW. This bans the internal NOUN, not the numbers
  // beside it. A pattern for the numbers themselves ("limit: 4") would have to
  // fire on a colon followed by a digit, and a user's own constraint is
  // legitimately written that way ("churn limit: 3%") — with a REMEDY that
  // erases the whole response, over-reach here costs a turn. The numeric shape
  // is swept where it is BUILT instead, over every rejection the copy builder
  // can produce (`tests/unit/orchestrator/patch-rejection-no-internal-caps`),
  // which is also the only level at which the whole input matrix can be
  // checked rather than the one fixture a dispatch test happens to run.
  //
  // Swept before adding: the phrase appears nowhere in user-facing prose in
  // this repo. Its only non-comment occurrence was the sentence above, which
  // 2.655 removed at the producer. `node/edge operations` in the edit prompts
  // is model-facing and is not scanned by this guard.
  /\b(?:node|edge)\s+op(?:eration)?s?\b/i,
];

/**
 * ⭐ RAW PROBABILITY DECIMALS IN USER-FACING BLOCK PROSE.
 *
 * Intentionally NARROW: a leading `0.\d` or `.\d` only. `"v1.3"`, `"1.5x"`,
 * `"10.5%"` do NOT match — the rule targets bare probabilities leaking into
 * copy, not every decimal.
 *
 * ⚠ MOVED HERE from `phase3-blocks.ts` (ROADMAP 2.688 slice 1), where it was
 * a `const` local to one builder file. It is a prose-guard lexicon and this
 * module is where the prose-guard lexicons live; keeping it next to
 * `FORBIDDEN_USER_FACING_PHRASES` means a second builder (the
 * reference-class `outside_view` exercise) DERIVES the rule instead of
 * copying the regex — the hand-maintained mirror is the defect class this
 * estate loses most time to (CLAUDE.md trap 12). `phase3-blocks.ts` now
 * imports it; the pattern source is unchanged, byte for byte.
 *
 * ⚠ SCOPE, stated rather than implied: this catches LEADING-decimal form
 * ONLY. A producer-authored `'55%'` or `'16000 GBP'` passes it. That is a
 * known, rowed gap (ROADMAP 2.205), not an oversight — a blanket numeric
 * block would gut legitimate prose ("review in 3 months").
 */
export const RAW_DECIMAL_RE = /(?:^|[\s(=,])(?:0\.\d|\.\d)/;

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
 * value. Pure function.
 *
 * RC4 proportionate remedies (2026-07-15 session RCA): the guard is
 * REWRITE-FIRST. When the (first) hit belongs to the rewritable
 * prescriptive-lexicon class, the deterministic terminology substitution
 * (`applyTerminologyRewrite`, mirroring the prompt TERMINOLOGY map —
 * "recommendation" → "leading option" etc.) is applied and the result is
 * RE-SCANNED with `findForbiddenPhraseHit`. Only a residual hit — by
 * construction a fatal-class phrase (mutation denial, false success,
 * staleness wording, internal jargon), for which no safe rewrite exists —
 * triggers the whole-response neutral-fallback replacement. Detection is
 * NOT weakened anywhere: the phrase list and `findForbiddenPhraseHit` are
 * unchanged; only the REMEDY is proportionate to the offence class. The
 * re-scan (not a second phrase list) is what keeps the fatal classes
 * fatal — there is no mirrored "rewritable phrases" list to drift.
 *
 * Callers MUST emit `v5.egress.forbidden_phrase_detected` telemetry on
 * a rewritten result, tagging the per-emit-path `dispatch_path`. The
 * helper itself is telemetry-free so it stays usable from any module
 * without coupling to the telemetry registry. `remedy` (and
 * `rewritten_terms` on a terminology rewrite) let callers enrich that
 * event without re-deriving the classification.
 *
 * Idempotent: a second call on a rewritten result is a no-op because
 * neither the terminology-rewritten text nor the fallback contains a
 * forbidden phrase.
 */
export interface EgressGuardResult {
  readonly rewritten: boolean;
  readonly text: string;
  readonly hit: string | null;
  /** How the violation was remedied (RC4 proportionate remedies). */
  readonly remedy: 'none' | 'terminology_rewrite' | 'fallback_replacement';
  /** Terms substituted when `remedy === 'terminology_rewrite'`. Generic
   *  banned vocabulary only — safe for telemetry. */
  readonly rewritten_terms?: readonly string[];
}

export function applyEgressForbiddenPhraseGuard(text: string): EgressGuardResult {
  const hit = findForbiddenPhraseHit(text);
  if (hit === null) return { rewritten: false, text, hit: null, remedy: 'none' };
  const substituted = applyTerminologyRewrite(text);
  if (
    substituted.applied.length > 0 &&
    findForbiddenPhraseHit(substituted.text) === null
  ) {
    return {
      rewritten: true,
      text: substituted.text,
      hit,
      remedy: 'terminology_rewrite',
      rewritten_terms: substituted.applied,
    };
  }
  return {
    rewritten: true,
    text: EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
    hit,
    remedy: 'fallback_replacement',
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
 * Held-science vocabulary — the single canonical pattern for scientific-claim
 * wording (sensitivity / fragility / flip / driver / robustness / causal /
 * elasticity / EVPI / VoI …) that must NOT surface on prose paths where the
 * science is HELD: the Cap-1 safe-now composer, the Cap-2A add-risk rejection
 * copy, and the golden-journey harness A8b invariant.
 *
 * Deliberately NOT part of {@link FORBIDDEN_USER_FACING_PHRASES}: these words
 * are legitimate — and deliberate — on surfaces that DO carry the science
 * (driver prose from projectTopDrivers, what_would_flip copy, robustness
 * summaries). Wiring this into the runtime egress guard would erase those
 * responses. It is a contextual checker for held-science surfaces only,
 * consumed by:
 *   - tools/golden-journey-harness/invariants.ts (A8b source-rejection
 *     grounding)
 *   - the AI-harness coaching suites (post-analysis-loop golden/honesty/
 *     integration, coaching-flags-combined) and the Cap-2A rejection tests
 *     (add-risk-rejection-render / -guidance)
 *
 * Superset union of the previously-diverged per-suite copies — five-plus
 * variants had drifted (one dropped `vulnerable`, others lacked
 * driver/drivers, causal, elasticity, evpi, voi). Add vocabulary here, not
 * in downstream consumers.
 */
export const HELD_SCIENCE_VOCABULARY_PATTERN =
  /\b(?:sensitiv\w*|fragile|fragility|flip|driver|drivers|robustness|vulnerable|influence|elasticity|evpi|voi|causal)\b/i;

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
  // Lane 22: bare `path` REMOVED from the decline set. It is legitimate
  // decision English ("no path from the option to the goal" carries the
  // same meaning as the approved NO_PATH_TO_GOAL user copy "cannot reach
  // the goal"), and it cost the user a claim-safe clarifying question in
  // the live 2026-07-07 session class. Raw internal path SHAPES are still
  // declined by the dotted-path pattern below (`operations.path`), and
  // snake_case ids / ascii arrows keep their own patterns.
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
