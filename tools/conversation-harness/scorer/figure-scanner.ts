/**
 * figure-scanner.ts — numeric-literal scanner for %-anchored figures in prose
 * (conversation-harness, Wave1-L3 rounds 4–7).
 *
 * WHY A SCANNER AND NOT A REGEX
 * -----------------------------
 * G4 (canonical-state use) is the promotion-gate dimension that blocks a coach
 * prompt from shipping when it states figures that do not exist in the
 * canonical analysis payload. Its extraction step has now been through six
 * review rounds:
 *
 *   round 2: /(\d{1,3})\s?%/ captured the digits abutting '%', so a decimal
 *            figure surfaced as its FRACTION ('62.5%' -> 5) — inverting the
 *            gate in both directions.
 *   round 3: fixed decimals/thousands, and review found the SAME regex still
 *            inverted on NEGATIVE figures and HYPHENATED RANGES.
 *   round 4: replaced the regex with this scanner + the FAIL-CLOSED policy.
 *   round 5: closed 4 extraction-semantics holes (word-numbers, BY-vs-TO,
 *            signed 'to'-ranges, clause commas).
 *   round 6: TWO-LAYER ANCHOR ACCOUNTING — a dumb over-matching anchor
 *            detector reconciled against the strict extractor, so an anchor
 *            no outcome consumed fails closed by construction.
 *   round 7: NUMERIC-TOKEN ACCOUNTING (below) — anchor accounting was still
 *            fail-open for figures that SHARE one anchor.
 *
 * The FAIL-CLOSED CONTRACT (round 4, unchanged):
 *
 *   ANY %-ANCHORED FIGURE THE SCANNER CANNOT PARSE UNAMBIGUOUSLY IS REPORTED
 *   AS `unparseable` — the caller must count it as an UNTRACEABLE figure
 *   (gate-relevant), NEVER as absent.
 *
 * WHAT COUNTS AS A FIGURE
 * -----------------------
 * A figure must be ANCHORED to '%' or a percent-family word (word boundary:
 * 'percentile'/bare 'percentage' do not anchor). Currency-marked literals
 * ('$1,250') are consumed as complete tokens and are never percent figures;
 * a directly-anchored currency ('$5%') is malformed ⇒ unparseable.
 * Identifier-glued digit runs ('utf8', 'v2', 'top-10') are classified as
 * identifier fragments, never figures — a fabricated 'win62%' still fails
 * closed because its ANCHOR goes unconsumed.
 *
 * SIGN — literal and directional (rounds 4–5, unchanged)
 * ------------------------------------------------------
 * Explicit signs immediately adjacent are honoured ('-20%', '−20%', '+20%',
 * '±5%' both values). A directional cue in the 3 words before the figure
 * (lose/down/fell/…) applies a negative sign; 'fell TO 20%' is a LEVEL (+20)
 * where 'fell BY 20%' is a change (-20); 'up to' is neutral. Contradictions
 * are unparseable, not guessed. HONEST LIMIT: the cue window looks BACKWARD
 * only — "a 20% drop" extracts +20 (post-nouns more often name the metric).
 *
 * RANGES AND LISTS (rounds 4–5, unchanged)
 * ----------------------------------------
 * '60-70%' / '60 to 70%' / '60%-70%' expand to BOTH bounds; a conjunction
 * list sharing one anchor ('10, 20 and 30%') distributes it. Malformed forms
 * (descending bounds, sign inside a hyphen range, three-bound chains,
 * asymmetric dash spacing) are unparseable. Explicit signs in a 'to'-range
 * are unambiguous ('from -20% to 35%'). A bare comma with no conjunction
 * later in the cluster is a CLAUSE boundary the anchor must not cross
 * ('In 2024, 25% of users churned' yields [25]).
 *
 * ROUND 6 — TWO-LAYER ANCHOR ACCOUNTING (kept as invariant v1)
 * ------------------------------------------------------------
 * LAYER 1 finds EVERY percent-anchor token, deliberately over-matching;
 * LAYER 2 (this extractor) records the span of every anchor it consumed.
 * RECONCILIATION INVARIANT v1: any Layer-1 anchor no outcome consumed
 * increments `unparseable`. Bare anchors ('expressed as a percent', a '(%)'
 * header) therefore fail closed. PERCENTAGE POINTS are a DISTINCT UNIT: a
 * pp-anchored figure ('12 percentage points', '12pp') must NEVER trace
 * against a % canonical — the canonical surface carries no pp values, so
 * every pp figure is an explicit unparseable. The change-then-level idiom
 * ('revenue fell 10% to 55%') extracts a negative change and a positive
 * level; clause commas bound the cue window.
 *
 * ==========================================================================
 * ROUND 7 — NUMERIC-TOKEN ACCOUNTING (replaces anchor accounting as the
 * mechanism that kills the invisible-figure class)
 * ==========================================================================
 * Round-6 review proved anchor accounting fail-OPEN for figures that SHARE
 * one anchor: reconciliation counted ANCHORS, so 'between ninety and 95%'
 * scanned {values:[95], unparseable:0} — the fabricated word bound
 * contributed NOTHING ('ninety or 95%', 'either eighty or 95%', 'a
 * ninety–95% chance', 'outcomes of ten, 20 and 30%', '10, twenty and 30%'
 * all leaked the same way, the last even dropping a DIGIT bound). The
 * round-6 800-run invariant test could not see this because its generator
 * rendered exactly ONE number per anchor.
 *
 * Round 7 accounts NUMERIC TOKENS, which are enumerable where phrasings are
 * not:
 *
 *   TOKEN DETECTOR: every numeric token in the text — ASCII digit runs,
 *   common Unicode digit runs (Arabic-Indic, Extended Arabic-Indic,
 *   full-width) and Unicode vulgar-fraction chars, plus the CLOSED
 *   word-number lexicon (units, teens, tens, hyphenated compounds like
 *   'twenty-five', scales, and 'half'/'third'/'quarter' when %-adjacent).
 *   Word-number and foreign-numeral tokens enter the SAME literal stream the
 *   cluster grammar chews, as recognised-but-unvaluable literals — so
 *   'between ninety and 95%' is ONE anchored form containing an unvaluable
 *   bound and the WHOLE form refuses (fail closed, one outcome).
 *
 *   RECONCILIATION INVARIANT v2: within any ANCHOR-BEARING CLAUSE, EVERY
 *   numeric token must be consumed by exactly one Layer-2 outcome (a valued
 *   figure or an explicit unparseable). Any unconsumed numeric token in an
 *   anchor-bearing clause increments `unparseable` — untraceable, fail
 *   closed, by construction. Clause boundaries are sentence stops plus
 *   commas, EXCEPT commas that chained as list glue inside a literal cluster
 *   ('wins 10%, 20, and 30' — those commas do not shield, so the trailing
 *   bare members round 6 silently dropped now fail closed; 'In 2024, 25%'
 *   keeps its round-5 shield). Digit-flanked '.'/',' (decimals, thousands)
 *   are not boundaries.
 *
 * Deliberate calibration costs (all fail-closed, all visible):
 *  - a bare number sharing a clause with an anchor now counts untraceable
 *    ('Option 3 gives a 40% win rate' → 40 traces, 3 blocks). Over-blocking
 *    faithful prose beats an invisible fabricated figure; the shield for the
 *    clause-comma shape is pinned in tests.
 *  - '3/4%' no longer silently values the 4 alone — the 3 fails closed.
 *  - a non-ASCII numeral or vulgar fraction near an anchor fails closed
 *    (recognised, never valued).
 *
 * P1 (round-6 verified): 'pts'/'pt'/'bps'/'basis point(s)' join the pp-unit
 * anchor set in BOTH the Layer-1 detector and the Layer-2 extractor, so
 * 'rose 12 percent pts' parses as unit pp (refused) instead of backtracking
 * to bare 'percent' and valuing 12% — the pp-as-% conflation is dead. pp
 * figures still NEVER trace against % canonicals.
 *
 * UNIT SUB-SPLITTING (round-6 P2(c)): adjacent SELF-ANCHORED figures whose
 * units differ — 'dropped 3 percentage points to 55%' — resolve
 * independently: the pp delta refuses (honest untraceable) AND the 55%
 * level is extracted; the level is no longer swallowed. Self-anchored
 * list/comma neighbours also resolve independently ('ninety percent, and
 * 20% elsewhere' → the word figure refuses, the 20 values).
 *
 * OTHER ROUND-7 PICKUPS: '٪' (U+066A), '﹪' (U+FE6A), '‰' (U+2030) join the
 * anchor set as recognise-and-refuse glyphs (like full-width '％' and
 * 'pct' since round 6 — never valued, never invisible); soft hyphens
 * (U+00AD) are normalised away before scanning.
 *
 * ==========================================================================
 * ROUND 8 — three recognizer-edge holes, closed WITHOUT weakening round 7
 * ==========================================================================
 * (1) P0 — the fraction-word carve-out re-opened the shared-anchor class for
 *     the scanner's OWN lexicon: 'between a third and 95%' anchored on the
 *     digit bound, 'third' never entered the literal stream, and the
 *     fabricated fraction bound scored 1.000 invisibly. The carve-out is now
 *     CONDITIONED ON GLUE CONTEXT: a fraction word list/range-glued to a
 *     numeric neighbour (and/or/to, dashes, a 'between'-partner, a list
 *     comma — the same glue classes the cluster grammar recognises, one
 *     optional article allowed) enters the token stream, so the cluster
 *     grammar refuses the form whole or reconciliation v2 flags the
 *     stranded token. Plain partitive prose ('half the users churned',
 *     'a third of users hit 40%') keeps the carve-out — that over-block
 *     motive is real. The ', maybe'-comma straddle ('roughly a third,
 *     maybe 95%') stays shielded by the round-5 clause doctrine, identical
 *     to its digit twin — a FILED follow-up, not a fraction-word special.
 * (2) P1 — FOREIGN_NUMERAL_RE was a hand-enumerated mirror of 3 Unicode
 *     ranges (the programme's dominant defect class): Devanagari, Thai,
 *     Bengali, Tamil, superscript digit runs were invisible. Now DERIVED
 *     via Unicode property escapes (\p{Nd} minus ASCII + \p{No}) — every
 *     script is covered by construction, not by enumeration.
 * (3) P1 — bare 'point'/'points' joins the pp anchor family in BOTH layers
 *     with the SAME treatment as pts/pt/bps ('up 12 points' was invisible
 *     whenever a comma/sentence boundary separated it from a %-anchor).
 *     [ROUND 9 RECALIBRATED the no-number case — see below: a bare prose
 *     'point' with NO numeric neighbour is prose, not a unit; round 8 had
 *     it fail closed via invariant v1 like 'shown in pts', which made G4's
 *     =1.0 floor hard-block every candidate whose coach said 'good point'.]
 *
 * ==========================================================================
 * ROUND 9 — recognizer-edge holes in the ROUND-8 fixes themselves
 * ==========================================================================
 * (1) P1 — the two HYPHEN CARVE-OUTS (the prefix 'x-one' compound-fragment
 *     guard and the suffix 'one-off' modifier guard) were not
 *     glue-conditioned — the same class as the round-8 P0, one carve-out
 *     over: 'between twenty-odd and 95%', 'either thirty-something or 95%',
 *     'between mid-forty and 95%', 'a sub-ten–95% range' all discarded the
 *     word token and the fabricated bound scanned invisibly. Both carve-outs
 *     now apply COMPOUND GLUE CONTEXT (the round-8 glue classes, tested past
 *     the hyphen fragments on both sides): a glued token enters the stream
 *     and the form refuses whole or reconciliation v2 flags it. Plain
 *     compound prose ('a one-off gain', 'phase-two hit 40%') keeps the
 *     carve-out; the round-5 clause shield is untouched.
 * (2) P1 — the round-8 foreign-numeral derivation omitted \p{Nl}: \p{N} is
 *     Nd ∪ Nl ∪ No, and Roman-numeral glyphs (Ⅳ/Ⅻ) and Han 〇 are Nl, so
 *     'between Ⅳ and 95%' was invisible and the round-8 'every script
 *     covered by construction' claim was false as written. The regex now
 *     carries the full derivation (see FOREIGN_NUMERAL_RE).
 * (3) CALIBRATION RULING (orchestrator) — bare prose 'point(s)' with no
 *     number was counted unparseable by round 8 ('That is a good point to
 *     consider.' → {[], 1}), and G4's =1.0 floor made ANY candidate whose
 *     coach said 'good point' hard-block: the gate was unusable on honest
 *     coaching prose. RULING: points-family tokens are anchors/refusals
 *     ONLY when a numeric neighbour (digit or word-number literal) is in
 *     the adjacency window — 'points' is a unit only when attached to a
 *     number. Scope: the standalone 'point'/'points' token (the only family
 *     member that is ordinary English); 'pts'/'pp'/'bps'/'pct'/'percent'
 *     and the multi-word forms keep invariant-v1 fail-closed treatment.
 *     '12 points' / 'rose 12 percent pts' stay recognised-and-refused;
 *     'at this point we should run it' is clean. Implemented in Layer 1
 *     (numericNeighbourBefore); Layer 2 already requires a numeric literal
 *     by construction.
 *
 * ==========================================================================
 * ROUND 10 — the r9 calibration ruling was implemented BACKWARD-ONLY; the
 * ruling's letter ("a numeric neighbour in the ADJACENCY WINDOW") is
 * direction-agnostic. One family, three shapes, plus a demote-path hazard —
 * all closed per orchestrator rulings, implemented exactly:
 * ==========================================================================
 * (1) BIDIRECTIONAL adjacency (ruling 1): a numeric neighbour AFTER the
 *     points token also anchors — numericNeighbourAfter mirrors the backward
 *     window (whitespace, ≤1 hyphen) plus at most ONE connective: a copula
 *     (was/is/are/were) or a colon. 'The drop in points was 12.' /
 *     'points: 12' / 'the gap in points was 12%' all refuse. Forward
 *     anchors are never consumed by Layer 2 (it only matches anchors forward
 *     FROM a literal), so they refuse via invariant v1 — the correct outcome
 *     for a pp-family figure, which never values.
 * (2) DIGIT-BEARING COMPOUND neighbours (ruling 2): the backward check now
 *     inspects the whole compound token before the points token, not its
 *     last char/word — '20-odd' starts with a digit, so 'up 20-odd points'
 *     refuses; word-number-bearing compounds ('twenty-odd') count too
 *     (fail-closed direction; closes the r9 'up twenty-odd points'
 *     disclosure gap).
 *     DEMOTE-PATH BACKSTOP (ruling 2b): a DEMOTED points token keeps its
 *     clause anchor-bearing for reconciliation v2 — demotion can never
 *     disarm the stranded-token check ('points dropped from 12' fails
 *     closed even though the points token itself is prose by the ruling).
 * (3) ARTICLE variant (ruling 3): 'a'/'an' immediately before SINGULAR
 *     'point' counts as a numeric neighbour (value = one) ONLY when a
 *     movement/delta cue from the CLOSED ruling list (rose/fell/up/down/
 *     gain(ed)/lost/improve(d)/drop(ped)/climb(ed)/slip(ped)/shed/added)
 *     sits in the adjacency window — 3 words, clause-bounded, the same
 *     convention as the directional-cue rule. 'their score rose a point' /
 *     'improved by a point' refuse; 'that raises a point about scope' /
 *     'good point' stay clean.
 *
 * Round-10 deliberate costs (fail-closed, visible, pinned):
 *  - a bare number sharing a clause with a DEMOTED points token blocks
 *    ('Good point about the 3 scenarios.') — same class as the round-7
 *    bare-number cost; a CONSUMED figure in the clause stays clean ('Good
 *    point about the 40% figure').
 *  - [SUPERSEDED by ROUND 11 ruling 1] a copula-adjacent %-figure anchored
 *    a singular point token ('The tipping point is 62%.' → {[62], 1}); the
 *    flagged recalibration happened — singular 'point' never forward-anchors
 *    and the idiom now scans {[62], 0}.
 * Round-10 accepted residuals (outside the rulings, pinned):
 *  - word-number-free movement prose ('points slid modestly', 'shed a few
 *    points') — no numeric token exists anywhere;
 *  - movement verbs outside the CLOSED cue list ('they won a point');
 *  - cues outside the 3-word window ('rose by more than a point');
 *  - cue-after-the-token shapes ('a point higher') — the cue window looks
 *    backward, mirroring the long-standing sign-cue doctrine.
 *
 * ==========================================================================
 * ROUND 11 — FINAL CALIBRATION for the points-family (orchestrator rulings,
 * implemented exactly; r10's copula extension beyond the ruling's letter is
 * what caused this round). The r10 forward window over-blocked canonical
 * coach formatting; from here the DEFAULT disposition for any new shape is
 * DOCUMENTED RESIDUAL (register below + pins), not a new mechanism.
 * ==========================================================================
 * (1) FORWARD anchoring requires PLURAL 'points' (ruling 1). Singular
 *     'point' NEVER forward-anchors; a singular whose ONLY numeric
 *     adjacency is forward is FULLY prose — not even demoted, so the
 *     ruling-2b backstop cannot strand its trailing number: 'The tipping
 *     point is 62%.' → {[62],0} · 'The score at that point was 45.' →
 *     clean · 'the decimal point is 2 places left' → clean. Backward +
 *     article rules from r10 are unchanged for singular. Ruling 3
 *     retro-ratifies the copula set (was/is/are/were) for the PLURAL case
 *     only ('the drop in points is 12' refuses, same leak as 'was').
 * (2) LIST MARKERS never forward-anchor (ruling 2). A numeric token that
 *     is LIST-MARKER-SHAPED (^\d+[.)] at a line start) is CLASSIFIED a
 *     marker in scanLiterals — never a figure, never a strandable token —
 *     and a numeric token immediately after a newline is never a forward
 *     neighbour; the colon connective never anchors across a newline:
 *     'Key points:\n1. Your win rate is 62%.' → {[62],0} · 'A few
 *     points:\n1) run it again\n2) check the 40% figure' → {[40],0}.
 *     ANCHOR-FOLLOW GUARD (the round-6 invariant generator caught the
 *     unguarded rule live): a marker-shaped run whose punct abuts an
 *     anchor ('62. points', '62.%') keeps its released-punct fail-closed
 *     refusal — malformed typography, not list formatting.
 * (3) The article variant admits ONE adjective from the CLOSED ruling list
 *     (full|entire|whole|single|half) between a/an and singular 'point'
 *     (ruling 4): 'rose an entire point' / 'gained a full point' refuse
 *     under the movement-cue rule; 'that raises an important point about
 *     scope' stays prose ('important' is NOT in the list).
 *
 * Round-11 deliberate costs (fail-closed, visible, pinned — ruling 5):
 *  - same-line colon, plural, non-list-marker number: 'Two quick points:
 *    60% of runs pass.' → the 60 values, the phantom points figure refuses
 *    (2 counts: unconsumed forward anchor v1 + stranded 'Two' v2);
 *  - enumeration-count: 'The key points are 3: cost, speed, and risk.' →
 *    blocks ({[],2} — same two invariants);
 *  - 'Good point about the 3 scenarios.' keeps its r10 pin.
 * Round-11 accepted residuals (the rulings' letter, pinned + registered):
 *  - a forward-only-neighboured SINGULAR is fully prose, so its number is
 *    invisible ('the point was 12' → {[],0}) — the price of un-blocking
 *    the idiom;
 *  - cross-line forward shapes are invisible ('points\n12' → {[],0}) —
 *    the newline guard is categorical;
 *  - a GENUINE figure typed as a line-start marker ('62.' opening a line,
 *    no abutting anchor) is read as list formatting and is invisible.
 *
 * DOCUMENTED RESIDUALS — OUTSIDE the contract, pinned out-of-scope in tests:
 *  - bare numbers in clauses with NO anchor ('we ran 3 scenarios.') are not
 *    figures; a clause comma shields ('Across 3 cohorts, 40% converted').
 *    The same shield covers the ', maybe'-straddle for EVERY token kind,
 *    fraction words included ('roughly a third, maybe 95%' ==
 *    'roughly 33, maybe 95%') — filed follow-up, round-5 doctrine.
 *  - ordinal/quantity words OUTSIDE the closed lexicon ('fifth', 'dozen',
 *    'twice') are not numeric tokens — ACCEPTED scope (round 8): the lexicon
 *    is closed on cardinal number words + %-adjacent fractions; growing it
 *    word-by-word is the hand-maintained-mirror trap. Pinned in tests.
 *    ROUND 9 makes the GLUE-SHAPE disposition explicit (the round-8 P0
 *    proved partitive-shape dispositions do not transfer to glue shapes,
 *    so it is decided and pinned separately, not inherited): 'between a
 *    fifth and 95%' scans {[95], 0} — the out-of-lexicon bound is invisible
 *    even glued. ACCEPTED, same doctrine, same reason: the only fix is
 *    growing the open ordinal/quantity vocabulary word-by-word.
 *  - Lo-SCRIPT NUMERALS: Han ideograph numerals ('九五') are \p{Lo} —
 *    LETTERS, not numbers, to Unicode — so no property escape isolates
 *    them (unlike Nd/Nl/No, round 9) and 'between 九五 and 95%' scans
 *    {[95], 0} even glued. ACCEPTED (round 9): a hand-listed ideograph set
 *    is the mirror trap AND the same glyphs double as ordinary words in
 *    running CJK text. Pinned in tests as the explicit glue-shape
 *    disposition.
 *  - implicit/ratio figures with no anchor token: 'your win probability
 *    halved', 'one in five runs fails'.
 *  - compound modifiers ('a one-off gain', 'ten-fold') are not numeric
 *    tokens; currency amounts ('$1,250') are never percent figures.
 *  - the cue window stays backward-only ('a 20% drop' → +20).
 *
 * PII: this module returns numbers and counts only — never text fragments.
 * Callers must not emit scanned prose into details/notes.
 *
 * PURE — no src/ imports, no I/O.
 */

export interface FigureScan {
  /** Fully-resolved signed values, in text order (range/list forms expanded so
   * every bound/member is its own figure). */
  values: number[];
  /** Count of %-anchored figures that could NOT be parsed unambiguously.
   * FAIL-CLOSED CONTRACT: the caller MUST count each as an untraceable figure
   * (it can never trace), NEVER treat it as absent. */
  unparseable: number;
}

// ---------- character classes ----------

const CURRENCY = new Set(['$', '£', '€']);
/** Explicit sign characters. NOTE: en dash '–' and em dash '—' are range
 * separators, never signs; U+2212 minus is a sign, never a separator. */
const SIGN_CHARS = new Set(['-', '−', '+', '±']);
const SENTENCE_STOP = new Set(['.', '!', '?', ';', ':', '\n']);
/** ROUND 6: the cue window and the anchor rule share ONE clause-boundary set
 * — comma included — so the two rules can never disagree (see module doc). */
const CUE_BOUNDARY = new Set([...SENTENCE_STOP, ',']);

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

interface Span {
  start: number;
  end: number;
}

const spansOverlap = (a: Span, b: Span): boolean => a.start < b.end && a.end > b.start;

// ---------- LAYER 1: the anchor detector (round 6 — see module doc) ----------

/**
 * Deliberately over-matching: every occurrence of a percent-anchor token,
 * any case, hyphen/newline-separable, numeral or not. Order matters — the
 * longest ('percentage points') alternatives come first. Word-boundary
 * rules: the percent-family needs no letter AFTER it ('percentile' and bare
 * 'percentage' do not anchor; a letter merged BEFORE — 'ninetypercent' —
 * still anchors, and fails closed via reconciliation); 'pp'/'pct'/'pts'/
 * 'bps' need non-letters on BOTH sides (ordinary words contain 'pp'/'pt').
 * ROUND 7: 'pts'/'pt'/'bps'/'basis point(s)' join the pp family in BOTH
 * layers; '٪'/'﹪'/'‰' join the glyph set (recognise-and-refuse).
 * ROUND 8: bare 'point'/'points' joins the pp family in BOTH layers, same
 * treatment as pts/pt/bps ('up 12 points' — the most natural English pp
 * phrasing — was invisible whenever a comma/sentence boundary separated it
 * from a %-anchor). The multi-word alternatives ('percentage points',
 * 'basis points', 'percent points') still match FIRST at their own start
 * positions, so they are never split by the standalone token.
 * ROUND 9: a standalone 'point'/'points' MATCH is demoted to prose (not an
 * anchor) when no numeric neighbour precedes it — see detectAnchorTokens
 * and the calibration ruling in the module doc.
 */
const ANCHOR_TOKEN_RE =
  /％|%|٪|﹪|‰|percentage[\s-]*(?:points?|pts?)(?![a-z])|per[\s-]+cent(?:[\s-]*(?:points?|pts?))?(?![a-z])|percent(?:[\s-]*(?:points?|pts?))?(?![a-z])|basis[\s-]+points?(?![a-z])|(?<![a-z])points?(?![a-z])|(?<![a-z])bps(?![a-z])|(?<![a-z])pp(?![a-z])|(?<![a-z])pct(?![a-z])|(?<![a-z])pts?(?![a-z])/gi;

/** ROUND 9 (calibration ruling): the standalone 'point'/'points' token only.
 * Never matches the multi-word forms — the longest-first alternation in
 * ANCHOR_TOKEN_RE consumes 'percentage points'/'basis points'/'percent
 * points' whole, so a bare-points match is exactly the standalone token. */
const BARE_POINTS_RE = /^points?$/i;

interface AnchorDetection {
  anchors: Span[];
  /** ROUND 10 (ruling 2b): bare points tokens DEMOTED to prose — no numeric
   * neighbour on either side, no article-cue. NOT anchors (invariant v1
   * never fires on them — that was the round-8 over-block), but
   * reconciliation v2 still treats their clauses as anchor-bearing for
   * UNCONSUMED numeric tokens, so the demote-path can never disarm the
   * stranded-token check ('points dropped from 12' fails closed).
   * ROUND 11 (ruling 1): a SINGULAR 'point' whose only numeric adjacency
   * is FORWARD is fully prose — in NEITHER list, so the backstop cannot
   * strand its trailing number ('The score at that point was 45.' clean). */
  demotedPoints: Span[];
}

function detectAnchorTokens(text: string): AnchorDetection {
  const anchors: Span[] = [];
  const demotedPoints: Span[] = [];
  for (const m of text.matchAll(ANCHOR_TOKEN_RE)) {
    const span = { start: m.index, end: m.index + m[0].length };
    // ROUND 9 (calibration ruling — orchestrator): bare 'point'/'points' is
    // ordinary prose far more often than it is a unit ('a good point to
    // consider'), and G4's =1.0 floor hard-blocked every candidate whose
    // coach used the idiom. The standalone points token is an anchor ONLY
    // when a numeric neighbour sits in the adjacency window — 'points' is a
    // unit only when attached to a number. Every OTHER anchor family member
    // keeps invariant-v1 fail-closed treatment ('shown in pts', 'expressed
    // as a percent', 'measured in percentage points'): those are unit
    // tokens with no prose reading.
    // ROUND 10 extended the window forward (direction-agnostic); ROUND 11
    // (ruling 1) scopes the FORWARD window to PLURAL 'points': the singular
    // forward-copula shape is the canonical coach idiom ('the tipping point
    // is 62%'), and r10 over-blocked it. A singular 'point' whose ONLY
    // numeric adjacency is forward is FULLY prose — not even demoted, so
    // the ruling-2b backstop cannot strand its trailing number ('The score
    // at that point was 45.' stays clean per the ruling's letter; the
    // invisible-number price is a documented residual). Ruling 3
    // retro-ratifies the copula set (was/is/are/were) for the plural case.
    if (BARE_POINTS_RE.test(m[0]) && !numericNeighbourBefore(text, m.index, m[0])) {
      const plural = /s$/i.test(m[0]);
      if (!numericNeighbourAfter(text, span.end)) {
        demotedPoints.push(span);
      } else if (plural) {
        anchors.push(span);
      }
      // else: singular + forward-only neighbour — fully prose (ruling 1).
      continue;
    }
    anchors.push(span);
  }
  return { anchors, demotedPoints };
}

/** ROUND 10 (ruling 3): the CLOSED movement/delta cue list, verbatim from
 * the orchestrator ruling — rose|fell|up|down|gain(ed)?|lost|improved?|
 * dropp(ed)?|climb(ed)?|slipp(ed)?|shed|added (doubled-consonant stems read
 * as their dictionary pairs: drop/dropped, climb/climbed, slip/slipped).
 * CLOSED by ruling: growing it verb-by-verb is the hand-maintained-mirror
 * trap; out-of-list movement verbs are a pinned accepted residual ('they
 * won a point'). */
const MOVEMENT_CUES = new Set([
  'rose', 'fell', 'up', 'down',
  'gain', 'gained', 'lost',
  'improve', 'improved',
  'drop', 'dropped',
  'climb', 'climbed',
  'slip', 'slipped',
  'shed', 'added',
]);

/** ROUND 10 (ruling 2): the maximal compound token immediately before a
 * position — letters/digits/letter-numbers/apostrophes joined by single
 * hyphens ('20-odd', 'twenty-odd', "o'clock"). Inspected WHOLE: the round-9
 * check looked only at the last char/word, so the digit head of '20-odd'
 * was invisible. */
const COMPOUND_TOKEN_BEFORE_RE =
  /[\p{L}\p{Nd}\p{Nl}\p{No}'’](?:[\p{L}\p{Nd}\p{Nl}\p{No}'’]|-(?=[\p{L}\p{Nd}\p{Nl}\p{No}'’]))*$/u;

/** True when a numeric token — a digit in any script, a letter/other-number
 * form, a word-number from the closed lexicon, or (ROUND 10, ruling 2) a
 * COMPOUND carrying one ('20-odd', 'twenty-odd') — sits immediately before
 * `pos` in the adjacency window: whitespace, at most one hyphen, one
 * optional article (mirroring the forward tolerance matchAnchor /
 * matchAnchorAfterWord give a number looking toward its anchor, so the two
 * layers agree on '12 points', '3-point', '62\npoints', 'half a point').
 * ROUND 10 (ruling 3): when the only thing before the token is an article
 * ('a'/'an') and the token is SINGULAR 'point', a movement/delta cue in the
 * 3-word clause-bounded window makes the article itself the number (one) —
 * 'their score rose a point' anchors; 'that raises a point about scope'
 * stays prose.
 * Layer 2 needs no equivalent check: it only ever matches an anchor FORWARD
 * from a numeric literal, so its numeric neighbour holds by construction. */
function numericNeighbourBefore(text: string, pos: number, anchorToken: string): boolean {
  let i = pos;
  const skipBack = (): void => {
    while (i > 0 && /[ \t\r\n]/.test(text[i - 1])) i--;
    if (i > 0 && text[i - 1] === '-') {
      i--;
      while (i > 0 && /[ \t\r\n]/.test(text[i - 1])) i--;
    }
  };
  skipBack();
  let articleStart = -1;
  const art = /(?:^|[^a-z])(an?)$/i.exec(text.slice(Math.max(0, i - 4), i));
  if (art !== null) {
    i -= art[1].length;
    articleStart = i;
    skipBack();
  }
  if (i > 0) {
    // ROUND 10 (ruling 2): inspect the WHOLE compound token, not its last
    // char/word. Digit-bearing compounds ('20-odd') and word-number-bearing
    // compounds ('twenty-odd', 'mid-forty') are numeric neighbours — the
    // fail-closed direction. The 64-char window is safe: a truncated head
    // can only under-match, and a stranded digit head still fails closed
    // via the demote-path backstop (ruling 2b).
    const tok = COMPOUND_TOKEN_BEFORE_RE.exec(text.slice(Math.max(0, i - 64), i));
    if (tok !== null) {
      if (/[0-9\p{Nd}\p{Nl}\p{No}]/u.test(tok[0])) return true;
      if (tok[0].toLowerCase().split(/[-'’]/).some((w) => WORD_NUMBER_SET.has(w))) return true;
    }
  }
  // ROUND 10 (ruling 3 — article variant): 'a'/'an' immediately before
  // SINGULAR 'point' counts as the number one ONLY when a movement/delta
  // cue from the closed list is in the adjacency window (3 words,
  // clause-bounded — the cueSign convention).
  if (articleStart >= 0 && /^point$/i.test(anchorToken)) {
    const words = precedingWords(text, articleStart, 3);
    if (words.some((w) => MOVEMENT_CUES.has(w))) return true;
  }
  // ROUND 11 (ruling 4 — article variant, adjective form): ONE adjective
  // from the CLOSED ruling list (full|entire|whole|single|half) may sit
  // between the article and SINGULAR 'point' — 'rose an entire point' /
  // 'gained a full point' refuse under the same movement-cue rule, the cue
  // window measured from the article (the ruling-3 convention). The list is
  // CLOSED by ruling: 'important' and every other adjective stays prose;
  // growing it word-by-word is the hand-maintained-mirror trap.
  if (articleStart < 0 && /^point$/i.test(anchorToken)) {
    const adj = /(?:^|[^a-z])(full|entire|whole|single|half)$/i.exec(text.slice(Math.max(0, i - 7), i));
    if (adj !== null) {
      let j = i - adj[1].length;
      while (j > 0 && /[ \t\r\n]/.test(text[j - 1])) j--;
      const art = /(?:^|[^a-z])(an?)$/i.exec(text.slice(Math.max(0, j - 4), j));
      if (art !== null) {
        const words = precedingWords(text, j - art[1].length, 3);
        if (words.some((w) => MOVEMENT_CUES.has(w))) return true;
      }
    }
  }
  return false;
}

/** ROUND 10 (ruling 1 — the calibration ruling is direction-agnostic): true
 * when a numeric token sits immediately AFTER `pos` in the adjacency
 * window: whitespace, at most one hyphen, plus at most ONE connective — a
 * copula (was/is/are/were) or a colon — so 'points was 12', 'points: 12'
 * and 'the gap in points was 12%' anchor exactly like '12 points'. An
 * explicit sign is transparent ('points was -12'). Forward anchors are
 * never consumed by Layer 2 (it only matches anchors forward FROM a
 * literal), so a forward-neighboured points token refuses via invariant v1
 * — the correct outcome for a pp-family figure, which never values.
 * ROUND 11: the CALLER gates this to PLURAL 'points' (ruling 1), and the
 * window never crosses a newline to a list item (ruling 2): the colon
 * connective never anchors across a newline, and a token immediately after
 * a newline is never a forward neighbour. */
function numericNeighbourAfter(text: string, pos: number): boolean {
  let i = pos;
  let crossedNewline = false;
  const skip = (): void => {
    while (i < text.length && /[ \t\r\n]/.test(text[i])) {
      if (text[i] === '\n') crossedNewline = true;
      i++;
    }
  };
  skip();
  if (text[i] === '-' || text[i] === ':') {
    const colon = text[i] === ':';
    i++;
    skip();
    // ROUND 11 (ruling 2): the colon connective NEVER anchors across a
    // newline — 'Key points:\n1. Your win rate is 62%.' is canonical coach
    // list formatting, not points-unit adjacency.
    if (colon && crossedNewline) return false;
  } else {
    const cop = /^(?:was|is|are|were)(?![a-z])/i.exec(text.slice(i, i + 5));
    if (cop !== null) {
      i += cop[0].length;
      skip();
    }
  }
  // ROUND 11 (ruling 2): a numeric token that immediately follows a newline
  // is on its own line — the list-item shape — and is NEVER a forward
  // numeric neighbour. (A LIST-MARKER-SHAPED token — ^\d+[.)] at a line
  // start — necessarily follows a newline too, so this check subsumes the
  // marker case here; the marker CLASSIFICATION lives in scanLiterals.)
  if (i > 0 && text[i - 1] === '\n') return false;
  if (i < text.length && SIGN_CHARS.has(text[i])) i++;
  const c = text[i];
  if (c === undefined) return false;
  if (isDigit(c) || /[\p{Nd}\p{Nl}\p{No}]/u.test(c)) return true;
  const w = /^[a-z]+/i.exec(text.slice(i, i + 16));
  return w !== null && WORD_NUMBER_SET.has(w[0].toLowerCase());
}

// ---------- directional cues (backward window only — see module doc) ----------

const NEG_CUES = new Set([
  'lose', 'loses', 'losing', 'lost', 'loss', 'losses',
  'minus', 'negative', 'down',
  'drop', 'drops', 'dropped', 'dropping',
  'decline', 'declines', 'declined', 'declining',
  'decrease', 'decreases', 'decreased', 'decreasing',
  'fall', 'falls', 'fell', 'fallen', 'falling',
  'shrink', 'shrinks', 'shrinking', 'shrank', 'shrunk',
  'worse', 'worsen', 'worsens', 'worsened', 'deficit',
]);

const POS_CUES = new Set([
  'gain', 'gains', 'gained', 'gaining',
  'grow', 'grows', 'grew', 'growing', 'growth',
  'rise', 'rises', 'rose', 'risen', 'rising',
  'increase', 'increases', 'increased', 'increasing',
  'improve', 'improves', 'improved', 'improving',
  'plus', 'positive', 'up',
]);

// ---------- word-number tokens (round 7: literals in the cluster grammar) ----------

/** The CLOSED word-number lexicon: units, teens, tens, scales. Hyphenated
 * compounds ('twenty-five') and space-joined runs ('ninety five') merge into
 * ONE token via WORD_SEQ_RE. */
const CORE_NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'thousand', 'million', 'billion',
];
/** Fraction words are numeric tokens when %-adjacent ('half a percent') OR —
 * ROUND 8 — when list/range-GLUED to a numeric neighbour ('between a third
 * and 95%'); plain partitive prose ('half the users') stays carved out —
 * see module doc. */
const FRACTION_WORDS = ['half', 'third', 'thirds', 'quarter', 'quarters'];
const FRACTION_SET = new Set(FRACTION_WORDS);
/** ROUND 9: the whole closed lexicon, for the points-token neighbour check
 * (numericNeighbourBefore) — derived from the same two arrays WORD_ALT is
 * built from, never a re-enumeration. */
const WORD_NUMBER_SET = new Set([...CORE_NUMBER_WORDS, ...FRACTION_WORDS]);

const WORD_ALT = [...CORE_NUMBER_WORDS, ...FRACTION_WORDS]
  .sort((a, b) => b.length - a.length)
  .join('|');
/** A maximal run of number words joined by spaces/tabs or single hyphens:
 * 'ninety', 'twenty-five', 'ninety five', 'three quarters'. */
const WORD_SEQ_RE = new RegExp(
  `\\b(?:${WORD_ALT})(?:(?:[ \\t]+|-)(?:${WORD_ALT}))*\\b`,
  'gi',
);

// ---------- ROUND 8 (P0): glue-context condition on the fraction carve-out --

/** A numeric neighbour as seen from a glue edge: a (possibly signed) digit
 * run, a percent glyph (an anchored literal's tail), or a word-number from
 * the closed lexicon. */
const FRACTION_GLUE_NUM_RIGHT = `(?:[-+±−]?\\.?[0-9]|[%％]|(?:${WORD_ALT})\\b)`;
const FRACTION_GLUE_NUM_LEFT = `(?:[0-9]|[%％]|(?:${WORD_ALT}))`;
/** Right glue: conjunction/'to' (optionally after a comma), a bare LIST
 * comma, or a dash — then one optional article — then a numeric neighbour.
 * These are the SAME glue classes the cluster grammar recognises; a comma
 * followed by a non-number ('a third, maybe 95%') is a clause boundary and
 * does NOT match (round-5 shield doctrine, deliberately untouched). */
const FRACTION_RIGHT_GLUE_RE = new RegExp(
  `^(?:\\s*,?\\s*(?:and|or|to)\\s+|\\s*,\\s*|\\s*[–—-]\\s*)(?:an?\\s+)?${FRACTION_GLUE_NUM_RIGHT}`,
  'i',
);
/** Left glue: a numeric neighbour, then conjunction/'to' (optionally after a
 * comma) or a dash, then one optional article ('between 95% and a third',
 * 'either 95% or half'). A BARE left comma is not glue — it is the round-5
 * clause boundary. */
const FRACTION_LEFT_GLUE_RE = new RegExp(
  `${FRACTION_GLUE_NUM_LEFT}(?:\\s*,?\\s*(?:and|or|to)\\s+|\\s*[–—-]\\s*)(?:an?\\s+)?$`,
  'i',
);

/** ROUND 8 (P0): true when a fraction word is list/range-glued to a numeric
 * neighbour on either side — it must then enter the token stream so the
 * cluster grammar refuses the shared-anchor form whole or reconciliation v2
 * flags the stranded token. Mutation hook: forcing this to `false` restores
 * the round-7 unconditional carve-out (the verified P0 leak). */
function fractionGlueContext(text: string, start: number, end: number): boolean {
  return FRACTION_RIGHT_GLUE_RE.test(text.slice(end)) || FRACTION_LEFT_GLUE_RE.test(text.slice(0, start));
}

// ---------- ROUND 9 (P1): glue-context condition on the hyphen carve-outs --

/** Extend a token span across single-hyphen-joined letter fragments on both
 * sides ('forty' out to 'mid-forty'; 'twenty' out to 'twenty-odd') so the
 * glue test can look PAST the compound fragment to the real neighbour. */
function hyphenCompoundSpan(text: string, start: number, end: number): Span {
  let s = start;
  while (text[s - 1] === '-' && /[a-z]/i.test(text[s - 2] ?? '')) {
    let k = s - 2;
    while (k >= 0 && /[a-z']/i.test(text[k])) k--;
    s = k + 1;
  }
  let e = end;
  while (text[e] === '-' && /[a-z]/i.test(text[e + 1] ?? '')) {
    let k = e + 1;
    while (k < text.length && /[a-z']/i.test(text[k])) k++;
    e = k;
  }
  return { start: s, end: e };
}

/** ROUND 9 (P1): the round-8 hyphen carve-outs (the prefix 'x-one'
 * compound-fragment guard and the suffix 'one-off' modifier guard) were NOT
 * glue-conditioned — the exact defect class the round-8 P0 closed for
 * fraction words, one carve-out over: 'between twenty-odd and 95%' /
 * 'a sub-ten–95% range' discarded the word token and the fabricated bound
 * scanned invisibly. A compound-fragment word that is list/range-glued to a
 * numeric neighbour (looking past its hyphen fragments) must enter the token
 * stream — the cluster grammar refuses the form whole, or reconciliation v2
 * flags the stranded token. Plain compound prose ('a one-off gain',
 * 'phase-two hit 40%') keeps the carve-out. Mutation hook: forcing this to
 * `false` restores the round-8 unconditioned carve-outs (the verified
 * round-9 P1 leak). */
function compoundGlueContext(text: string, start: number, end: number): boolean {
  const span = hyphenCompoundSpan(text, start, end);
  return (
    FRACTION_RIGHT_GLUE_RE.test(text.slice(span.end)) || FRACTION_LEFT_GLUE_RE.test(text.slice(0, span.start))
  );
}

/** Last `n` words immediately before `pos`, lowercased, not crossing a
 * clause boundary (the shared CUE_BOUNDARY set — round 6). Hyphenated words
 * split into their parts ('twenty-five' → 'twenty', 'five'). */
function precedingWords(text: string, pos: number, n: number): string[] {
  let boundary = 0;
  for (let k = pos - 1; k >= 0; k--) {
    if (CUE_BOUNDARY.has(text[k])) {
      boundary = k + 1;
      break;
    }
  }
  return text
    .slice(boundary, pos)
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean)
    .slice(-n);
}

// ---------- literal token ----------

interface Literal {
  /** Index of the first char of the token (sign/currency prefix included). */
  start: number;
  /** Index just past the last numeric char (before any released punctuation). */
  end: number;
  /** Index of the anchor's first char when anchored, else === end (round 6:
   * recorded so the consumed span reconciles against the Layer-1 tokens). */
  anchorStart: number;
  /** Index just past the anchor when anchored, else === end. */
  anchorEnd: number;
  value: number;
  /** False for malformed digit runs AND for word-number / foreign-numeral
   * tokens (round 7): recognised, never valuable — an anchored form
   * containing one refuses whole (fail closed). */
  valid: boolean;
  sign: '' | '-' | '+' | '±';
  currency: boolean;
  anchored: boolean;
  /** ROUND 6/7: '%'-family anchors value as percentages; 'pp'-family anchors
   * (percentage point(s) / percent point(s)/pt(s) / pp / bps / basis points)
   * are a DISTINCT UNIT that must never trace against a % canonical;
   * 'other' anchors (pct, ％, ٪, ﹪, ‰) are recognised-and-refused. */
  unit: '%' | 'pp' | 'other';
  /** True when the anchor sits on the far side of released trailing
   * punctuation ('62.%') — malformed typography around an anchor. */
  anchorAfterReleasedPunct: boolean;
  /** Repeated sign/currency prefix chars ('--5%', '$$5%'). */
  malformedPrefix: boolean;
}

/** Validate and evaluate a digits/commas/dots run (prefix already stripped,
 * trailing punctuation already released). Strict thousands grouping: the first
 * group 1–3 digits, every later group exactly 3; at most one dot; no commas in
 * the fraction. '1,25' and '62.5.3' are invalid, not reinterpreted. */
function parseRaw(raw: string): { valid: boolean; value: number } {
  if (raw.length === 0 || !/[0-9]/.test(raw)) return { valid: false, value: NaN };
  if ((raw.match(/\./g) ?? []).length > 1) return { valid: false, value: NaN };
  const [intPart, fracPart] = raw.split('.') as [string, string | undefined];
  if (fracPart !== undefined && !/^\d+$/.test(fracPart)) return { valid: false, value: NaN };
  if (intPart.includes(',')) {
    const groups = intPart.split(',');
    if (groups[0].length < 1 || groups[0].length > 3 || !/^\d+$/.test(groups[0])) {
      return { valid: false, value: NaN };
    }
    for (const g of groups.slice(1)) {
      if (!/^\d{3}$/.test(g)) return { valid: false, value: NaN };
    }
  } else if (intPart !== '' && !/^\d+$/.test(intPart)) {
    return { valid: false, value: NaN };
  }
  const value = Number(raw.replace(/,/g, ''));
  return { valid: Number.isFinite(value), value };
}

interface AnchorMatch {
  /** Index of the anchor token's first char. */
  start: number;
  /** Index just past the anchor token. */
  end: number;
  unit: Literal['unit'];
}

/** Word-form anchors Layer 2 understands, matched stickily at one position.
 * Longest alternatives first. 'percentile' / bare 'percentage' do not anchor
 * (letter follows / no 'point'). ROUND 7: the points-suffix alternation
 * includes 'pts'/'pt' so 'percent pts' can never backtrack to bare 'percent'
 * (the pp-as-% conflation); standalone 'pts'/'pt'/'bps'/'basis point(s)'
 * anchor as pp; 'pct' anchors as recognise-and-refuse. ROUND 8: standalone
 * 'point'/'points' anchors as pp too, same treatment as pts/pt/bps — the
 * multi-word alternatives are listed first and cannot backtrack onto it. */
const WORD_ANCHOR_STICKY =
  /(?:percentage[\s-]*(?:points?|pts?)|per[\s-]+cent(?:[\s-]*(?:points?|pts?))?|percent(?:[\s-]*(?:points?|pts?))?|basis[\s-]+points?|points?|bps|pp|pct|pts?)(?![a-z])/iy;

function wordAnchorUnit(tok: string): Literal['unit'] {
  const t = tok.toLowerCase();
  if (t === 'pct') return 'other';
  if (t === 'pp' || t === 'bps' || t.startsWith('basis') || /point|(?:^|[\s-])pts?$/.test(t)) {
    return 'pp';
  }
  return '%';
}

/** Match an anchor at/after `pos`. Skips whitespace INCLUDING newlines plus
 * at most one hyphen ('a 25-percent drop', '62\npercent', 'a 9-per-cent
 * gain'), and returns the matched span + unit, or null. ROUND 7: non-ASCII
 * percent glyphs and per-mille are RECOGNISED and always refused (unit
 * 'other') — never valued, never invisible. */
function matchAnchor(text: string, pos: number): AnchorMatch | null {
  let i = pos;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
  if (text[i] === '-') {
    i++;
    while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
  }
  if (text[i] === '%') return { start: i, end: i + 1, unit: '%' };
  if (text[i] === '％' || text[i] === '٪' || text[i] === '﹪' || text[i] === '‰') {
    return { start: i, end: i + 1, unit: 'other' };
  }
  WORD_ANCHOR_STICKY.lastIndex = i;
  const m = WORD_ANCHOR_STICKY.exec(text);
  if (m) {
    return { start: i, end: i + m[0].length, unit: wordAnchorUnit(m[0]) };
  }
  return null;
}

/** matchAnchor for word-number tokens: one article may sit between the word
 * and its anchor ('half a percent', 'a hundred percent' needs none). */
function matchAnchorAfterWord(text: string, pos: number): AnchorMatch | null {
  const direct = matchAnchor(text, pos);
  if (direct !== null) return direct;
  const art = /^[ \t\r\n]+an?(?![a-z])/i.exec(text.slice(pos, pos + 12));
  if (art !== null) return matchAnchor(text, pos + art[0].length);
  return null;
}

function unvaluableLiteral(start: number, end: number, anchor: AnchorMatch | null): Literal {
  return {
    start,
    end,
    anchorStart: anchor === null ? end : anchor.start,
    anchorEnd: anchor === null ? end : anchor.end,
    value: NaN,
    valid: false,
    sign: '',
    currency: false,
    anchored: anchor !== null,
    unit: anchor === null ? '%' : anchor.unit,
    anchorAfterReleasedPunct: false,
    malformedPrefix: false,
  };
}

/** ROUND 7: word-number tokens from the CLOSED lexicon become literals in the
 * same stream the cluster grammar chews — recognised, never valuable. */
function scanWordNumberLiterals(text: string): Literal[] {
  const out: Literal[] = [];
  for (const m of text.matchAll(WORD_SEQ_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    // 'x-one': a number word hyphen-glued onto a preceding real word is a
    // compound fragment, not a numeric token — UNLESS (ROUND 9) the compound
    // is list/range-glued to a numeric neighbour ('a sub-ten–95% range').
    if (
      text[start - 1] === '-' &&
      /[a-z]/i.test(text[start - 2] ?? '') &&
      !compoundGlueContext(text, start, end)
    ) {
      continue;
    }
    const anchor = matchAnchorAfterWord(text, end);
    if (anchor === null) {
      // Fraction words are numeric tokens when %-adjacent — or (ROUND 8)
      // when list/range-glued to a numeric neighbour; only plain partitive
      // prose ('half the users') keeps the carve-out.
      const words = m[0].toLowerCase().split(/[^a-z]+/).filter(Boolean);
      if (words.every((w) => FRACTION_SET.has(w)) && !fractionGlueContext(text, start, end)) continue;
      // Compound modifiers ('one-off', 'ten-fold') are not numeric tokens —
      // UNLESS (ROUND 9) the compound is list/range-glued to a numeric
      // neighbour ('between twenty-odd and 95%'). (An anchored hyphen form —
      // 'ninety-percent' — was caught above.)
      if (
        text[end] === '-' &&
        /[a-z]/i.test(text[end + 1] ?? '') &&
        !compoundGlueContext(text, start, end)
      ) {
        continue;
      }
    }
    out.push(unvaluableLiteral(start, end, anchor));
  }
  return out;
}

/** ROUND 7: non-ASCII numerals and Unicode fraction/number forms —
 * recognised, never valuable.
 *
 * ROUND 8 (P1): DERIVED, not mirrored. The round-7 version hand-enumerated
 * 3 digit ranges (Arabic-Indic, Extended Arabic-Indic, full-width) plus the
 * vulgar-fraction block, so Devanagari/Thai/Bengali/Tamil digit runs and
 * superscripts were invisible to the token stream — the hand-maintained-
 * mirror defect class, again.
 *
 * ROUND 9 (P1): the round-8 derivation was ITSELF incomplete — \p{N} is
 * Nd ∪ Nl ∪ No, and round 8 took only Nd (minus ASCII) + No, omitting Nl
 * (LETTER NUMBERS: Roman-numeral glyphs Ⅳ/Ⅻ, Han 〇, Suzhou numerals), so
 * 'between Ⅳ and 95%' was invisible in glue shapes and the round-8 'every
 * script covered by construction' doc claim was FALSE as written. The full
 * derivation is now spelled out: \p{Nd} = ANY script's decimal digits
 * (ASCII excluded — the main scanner owns 0-9); \p{Nl} = letter numbers;
 * \p{No} = every other-number form (vulgar fractions, superscripts, circled
 * numbers, ...). Together: every \p{N} codepoint, by construction. A
 * maximal run is ONE token, mirroring the digit scanner. (Han IDEOGRAPH
 * numerals 九/五 are \p{Lo} — letters, not numbers, to Unicode — and stay a
 * documented residual; see the module doc.) Mutation hook: regressing this
 * to the round-7 enumeration, or dropping the Nl branch, turns the
 * multi-script corpus RED. */
const FOREIGN_NUMERAL_RE = /(?:(?![0-9])\p{Nd})+|[\p{Nl}\p{No}]+/gu;

function scanForeignNumeralLiterals(text: string): Literal[] {
  const out: Literal[] = [];
  for (const m of text.matchAll(FOREIGN_NUMERAL_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    out.push(unvaluableLiteral(start, end, matchAnchor(text, end)));
  }
  return out;
}

function scanLiterals(text: string): Literal[] {
  const lits: Literal[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const startsLiteral = isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''));
    if (!startsLiteral) {
      i++;
      continue;
    }
    // ROUND 11 (ruling 2): a LIST-MARKER-SHAPED digit run — ^\d+[.)] at a
    // line start (position 0 or immediately after a newline) — is list
    // formatting, CLASSIFIED as a marker: never a figure, never a numeric
    // token that can strand ('A few points:\n1) run it again\n2) check the
    // 40% figure' must not strand the 2 in the 40% clause). The (?!digit)
    // lookahead keeps line-start decimals real figures ('62.5% remains').
    // Marker digits can carry no prefix — nothing precedes them on the line.
    if ((i === 0 || text[i - 1] === '\n') && /^\d+(?:\)|\.(?!\d))/.test(text.slice(i, i + 32))) {
      let k = i;
      while (k < n && isDigit(text[k])) k++;
      k++; // the marker's '.' / ')'
      // Anchor-follow guard (the round-6 invariant generator caught the
      // unguarded version live: '62. points overall.' at a line start
      // accounted to ZERO outcomes): a marker-shaped run whose punct is
      // followed by an ANCHOR ('62. points', '62.%') is the long-standing
      // released-punctuation malformed-typography shape, NOT list
      // formatting — it keeps its fail-closed refusal.
      if (matchAnchor(text, k) === null) {
        i = k;
        continue;
      }
    }
    // Attached prefix (sign/currency immediately adjacent, any order).
    let p = i - 1;
    let sign: Literal['sign'] = '';
    let currency = false;
    let malformedPrefix = false;
    while (p >= 0 && (SIGN_CHARS.has(text[p]) || CURRENCY.has(text[p]))) {
      if (SIGN_CHARS.has(text[p])) {
        if (sign !== '') malformedPrefix = true;
        sign = text[p] === '+' ? '+' : text[p] === '±' ? '±' : '-';
      } else {
        if (currency) malformedPrefix = true;
        currency = true;
      }
      p--;
    }
    // A consumed sign whose left neighbour is a digit or an anchor is not a
    // sign at all — it is the separator INSIDE '60-70%' / '60%-70%'. Surrender
    // it to the glue classifier (which owns range-vs-ambiguous), and start
    // this literal at its digits.
    if ((sign !== '' || currency) && p >= 0 && (isDigit(text[p]) || text[p] === '%')) {
      sign = '';
      currency = false;
      malformedPrefix = false;
      p = i - 1;
    }
    // Identifier guard: 'v2', 'utf8', 'CAGR20%' are fragments, not figures —
    // an enumerable CLASSIFICATION (letter-glued digits), not a silent drop;
    // a directly-anchored fragment still fails closed via the unconsumed
    // ANCHOR (invariant v1).
    if (p >= 0 && /[A-Za-z0-9_]/.test(text[p])) {
      while (i < n && /[0-9.,]/.test(text[i])) i++;
      continue;
    }
    const start = p + 1;
    // Maximal digits/commas/dots run, then release trailing punctuation
    // (sentence periods / list commas are not part of the number).
    let j = i;
    while (j < n && /[0-9.,]/.test(text[j])) j++;
    let raw = text.slice(i, j);
    let released = false;
    while (raw.length > 0 && /[.,]$/.test(raw)) {
      raw = raw.slice(0, -1);
      released = true;
    }
    const end = i + raw.length;
    const { valid, value } = parseRaw(raw);
    let anchored = false;
    let anchorStart = end;
    let anchorEnd = end;
    let unit: Literal['unit'] = '%';
    let anchorAfterReleasedPunct = false;
    const a1 = matchAnchor(text, end);
    if (a1 !== null) {
      // Normal case: anchor directly (modulo spacing/hyphen) after the
      // number. When punctuation was released, matchAnchor(end) sees the
      // punctuation char and fails — handled below.
      anchored = true;
      anchorStart = a1.start;
      anchorEnd = a1.end;
      unit = a1.unit;
    } else if (released) {
      const a2 = matchAnchor(text, j);
      if (a2 !== null) {
        // '62.%' — an anchor on the far side of released punctuation.
        anchored = true;
        anchorStart = a2.start;
        anchorEnd = a2.end;
        unit = a2.unit;
        anchorAfterReleasedPunct = true;
      }
    }
    lits.push({
      start,
      end,
      anchorStart,
      anchorEnd,
      value,
      valid,
      sign,
      currency,
      anchored,
      unit,
      anchorAfterReleasedPunct,
      malformedPrefix,
    });
    i = Math.max(anchorEnd, j);
  }
  return lits;
}

// ---------- glue between consecutive literals ----------

type Glue = 'range' | 'list' | 'comma' | 'to' | 'ambiguous' | 'break';

function glueKind(s: string): Glue {
  if (/^\s*$/.test(s)) return 'break';
  if (/^[\s\-–—−]+$/.test(s)) {
    // Dash-and-space only. A clean range separator is exactly ONE dash with
    // SYMMETRIC spacing ('60-70%', '60 - 70%'). Everything else dash-like
    // ('60- 70%', '60--70%', a lone U+2212 used as a separator) is ambiguous
    // typography around figures — fail closed, never guess.
    const m = /^(\s*)([-–—])(\s*)$/.exec(s);
    if (m && (m[1].length === 0) === (m[3].length === 0)) return 'range';
    return 'ambiguous';
  }
  // A bare comma is only PROVISIONALLY list glue: it is a list separator when
  // a conjunction glue follows later in the cluster ('10, 20 and 30%'),
  // otherwise a CLAUSE boundary the anchor must not cross ('In 2024, 25%…').
  // The cluster resolver makes that call — see module doc, round 5.
  if (/^\s*,\s*$/.test(s)) return 'comma';
  if (/^\s*,\s*(?:and|or)\s+$/i.test(s)) return 'list';
  if (/^\s+(?:and|or)\s+$/i.test(s)) return 'list';
  if (/^\s+to\s+$/i.test(s)) return 'to';
  return 'break';
}

// ---------- directional-cue window ----------

/** Sign implied by the words immediately before the cluster. Backward window
 * only (see module doc), 3 words, not crossing a CLAUSE boundary — ROUND 6:
 * the boundary set is the SAME one the round-5 anchor rule uses
 * (comma/semicolon/sentence stops), so a cue can never sign a figure the
 * anchor rule places in the next clause. The hedge bigram 'up to' is neutral. */
function cueSign(text: string, clusterStart: number): 'neg' | 'pos' | 'none' | 'ambiguous' {
  let boundary = 0;
  for (let k = clusterStart - 1; k >= 0; k--) {
    if (CUE_BOUNDARY.has(text[k])) {
      boundary = k + 1;
      break;
    }
  }
  let words = text
    .slice(boundary, clusterStart)
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean);
  // Neutralise 'up to' so the hedge cannot read as a positive cue.
  const dropped: string[] = [];
  for (let k = 0; k < words.length; k++) {
    if (words[k] === 'up' && words[k + 1] === 'to') {
      k++;
      continue;
    }
    dropped.push(words[k]);
  }
  words = dropped.slice(-3);
  // BY vs TO (round 5): '<fell/dropped/down> TO X%' is a LEVEL restatement —
  // the figure names where the metric sits, not the change — so no
  // directional sign applies. 'up to' was neutralised above, so a surviving
  // trailing 'to' is a true level 'to'. ('fell BY 20%' / 'fell 20%' keep the
  // cue: their last surviving word is not 'to'.)
  if (words[words.length - 1] === 'to') return 'none';
  const neg = words.some((w) => NEG_CUES.has(w));
  const pos = words.some((w) => POS_CUES.has(w));
  if (neg && pos) return 'ambiguous';
  if (neg) return 'neg';
  if (pos) return 'pos';
  return 'none';
}

// ---------- clause boundaries for the round-7 token reconciliation ----------

/** Positions of clause-boundary chars: sentence stops plus commas — EXCEPT
 * digit-flanked '.'/',' (decimals, thousands grouping) and commas that
 * CHAINED as list glue inside a literal cluster (an Oxford-list comma must
 * not shield the members it lists — see module doc, round 7). */
function clauseBoundaries(src: string, chainedGlueSpans: Span[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (SENTENCE_STOP.has(c)) {
      if (c === '.' && isDigit(src[i - 1] ?? '') && isDigit(src[i + 1] ?? '')) continue;
      out.push(i);
    } else if (c === ',') {
      if (isDigit(src[i - 1] ?? '') && isDigit(src[i + 1] ?? '')) continue;
      if (chainedGlueSpans.some((s) => i >= s.start && i < s.end)) continue;
      out.push(i);
    }
  }
  return out;
}

function clauseAround(boundaries: number[], len: number, pos: number): Span {
  let lo = 0;
  let hi = len;
  for (const b of boundaries) {
    if (b < pos) {
      lo = b + 1;
    } else {
      hi = b;
      break;
    }
  }
  return { start: lo, end: hi };
}

// ---------- cluster classification ----------

const LIST_MEMBER_CAP = 5;

/**
 * Scan prose for %-anchored figures. See the module doc for the grammar and
 * the fail-closed contract on `unparseable`.
 */
export function scanProseFigures(text: string): FigureScan {
  // ROUND 7: soft hyphens are invisible typography — normalise before
  // scanning so they cannot split a token or an anchor.
  const src = (text ?? '').replace(/\u00AD/g, '');
  const values: number[] = [];
  let unparseable = 0;

  // ROUND 6/7: spans of every Layer-1 anchor consumed by a Layer-2 outcome,
  // and every numeric-token literal consumed likewise. Reconciled at the end
  // — anything unconsumed fails closed there.
  const consumedAnchors: Span[] = [];
  const consumedLits = new Set<Literal>();
  const consume = (ms: Literal[]): void => {
    for (const m of ms) {
      if (m.anchored) consumedAnchors.push({ start: m.anchorStart, end: m.anchorEnd });
      consumedLits.add(m);
    }
  };

  // ROUND 7: digit literals, word-number tokens and foreign numerals enter
  // ONE literal stream — the numeric-token enumeration IS this list.
  const lits = [
    ...scanLiterals(src),
    ...scanWordNumberLiterals(src),
    ...scanForeignNumeralLiterals(src),
  ].sort((a, b) => a.start - b.start);

  // Commas that chained as list glue (recorded pre-pop so a popped trailing
  // member's comma still reads as list glue for the clause reconciliation).
  const chainedGlueSpans: Span[] = [];

  // Group consecutive literals into clusters. Currency literals never chain
  // (they cannot inherit or donate an anchor), so glue into/out of one breaks.
  let k = 0;
  while (k < lits.length) {
    const members: Literal[] = [lits[k]];
    const glues: Glue[] = [];
    while (k + 1 < lits.length) {
      const g = glueKind(src.slice(members[members.length - 1].anchorEnd, lits[k + 1].start));
      if (g === 'break') break;
      if (members[members.length - 1].currency || lits[k + 1].currency) break;
      members.push(lits[k + 1]);
      glues.push(g);
      k++;
    }
    k++;

    // ROUND 7: record which commas CHAINED — a 'list' glue's comma always,
    // a bare-comma glue's only when a conjunction glue follows later in the
    // cluster (the round-5 Oxford-list rule, applied to the PRE-POP shape).
    for (let g = 0; g < glues.length; g++) {
      if (glues[g] === 'list' || (glues[g] === 'comma' && glues.slice(g + 1).includes('list'))) {
        chainedGlueSpans.push({ start: members[g].anchorEnd, end: members[g + 1].start });
      }
    }

    // Trailing unanchored members of a LIST get no anchor to inherit — they
    // are not figures this form states. ROUND 7: they are no longer silently
    // dropped — they stay UNCONSUMED, and the token reconciliation fails
    // them closed when an anchor shares their clause ('wins 10%, 20, and 30'
    // — the chained commas do not shield; 'sold 10%, 20 units' — the clause
    // comma does). Range glue keeps both sides: '60%-70' inherits.
    while (
      members.length > 1 &&
      !members[members.length - 1].anchored &&
      (glues[glues.length - 1] === 'list' || glues[glues.length - 1] === 'comma')
    ) {
      members.pop();
      glues.pop();
    }

    // CLAUSE BOUNDARIES (round 5): a bare comma with no conjunction glue
    // later in the cluster is a clause boundary, not a list separator —
    // split there so the anchor cannot distribute backward across it
    // ('In 2024, 25% of users churned' must not pull 2024 into the
    // denominator). Commas followed by a conjunction are the Oxford-list
    // shape ('10, 20 and 30%') and keep chaining.
    const segments: Array<{ members: Literal[]; glues: Glue[] }> = [];
    {
      let segMembers: Literal[] = [members[0]];
      let segGlues: Glue[] = [];
      for (let g = 0; g < glues.length; g++) {
        if (glues[g] === 'comma' && !glues.slice(g + 1).includes('list')) {
          segments.push({ members: segMembers, glues: segGlues });
          segMembers = [members[g + 1]];
          segGlues = [];
        } else {
          segMembers.push(members[g + 1]);
          segGlues.push(glues[g]);
        }
      }
      segments.push({ members: segMembers, glues: segGlues });
    }

    // ROUND 7 — UNIT SUB-SPLITTING: adjacent members that are BOTH
    // self-anchored are independent stated figures when list/comma-glued or
    // when their units differ — 'dropped 3 percentage points to 55%' must
    // yield the pp refusal AND the 55% level; 'ninety percent, and 20%' must
    // not let the word figure poison the digit one. Range/'to' glue between
    // same-unit self-anchored bounds still binds ('60% to 70%', the
    // change-then-level idiom).
    const finalSegments: Array<{ members: Literal[]; glues: Glue[] }> = [];
    for (const seg of segments) {
      let cur: Literal[] = [seg.members[0]];
      let curGlues: Glue[] = [];
      for (let g = 0; g < seg.glues.length; g++) {
        const a = seg.members[g];
        const b = seg.members[g + 1];
        const bothAnchored = a.anchored && b.anchored;
        const split =
          bothAnchored &&
          (seg.glues[g] === 'list' || seg.glues[g] === 'comma' || a.unit !== b.unit);
        if (split) {
          finalSegments.push({ members: cur, glues: curGlues });
          cur = [seg.members[g + 1]];
          curGlues = [];
        } else {
          cur.push(seg.members[g + 1]);
          curGlues.push(seg.glues[g]);
        }
      }
      finalSegments.push({ members: cur, glues: curGlues });
    }

    for (const seg of finalSegments) {
      const segMembers = seg.members;
      const segGlues = seg.glues;

      const anchoredAny = segMembers.some((m) => m.anchored);
      if (!anchoredAny) {
        // Bare numbers stay unconsumed (reconciliation decides); currency
        // amounts are CLASSIFIED non-figures — consumed by that
        // classification, never percent figures ('$5 and 20%').
        for (const m of segMembers) {
          if (m.currency) consumedLits.add(m);
        }
        continue;
      }

      // From here on, this segment IS a stated figure (or several) and every
      // path below yields EXACTLY ONE outcome (values or unparseable), so its
      // anchors and tokens are consumed for the reconciliation here, once.
      consume(segMembers);

      // ROUND 6/7 — NON-% UNITS NEVER VALUE: a pp-anchored figure
      // ('12 percentage points', '12 percent pts', '12pp', '12 bps') is a
      // DELTA in points, not a % level — it must never trace against a %
      // canonical; 'other' anchors (pct, ％, ٪, ﹪, ‰) are recognised
      // typography this scanner refuses to value. Explicit unparseable
      // (recognised, counted, visible), never a valued %.
      if (segMembers.some((m) => m.anchored && m.unit !== '%')) {
        unparseable++;
        continue;
      }

      // Every malformation below counts as unparseable — never a silent drop.
      // ROUND 7: an anchored form containing a word-number / foreign-numeral
      // bound (valid === false) refuses WHOLE here — 'between ninety and
      // 95%' is one untraceable figure-form, not a clean [95].
      const malformed =
        segGlues.includes('ambiguous') ||
        segMembers.some(
          (m) => !m.valid || m.malformedPrefix || m.anchorAfterReleasedPunct || (m.currency && m.anchored),
        );
      if (malformed) {
        unparseable++;
        continue;
      }

      const kinds = new Set(segGlues);
      const isRange = kinds.has('range') || kinds.has('to');
      if (isRange && (kinds.size > 1 || segMembers.length !== 2)) {
        // Mixed glue ('10, 20 and 30-40%') or a many-bound chain ('10-20-30%').
        unparseable++;
        continue;
      }
      if (!isRange && segMembers.length > LIST_MEMBER_CAP) {
        unparseable++;
        continue;
      }

      const cue = cueSign(src, segMembers[0].start);
      if (cue === 'ambiguous') {
        unparseable++;
        continue;
      }

      if (isRange) {
        // A range is one figure-form with two bounds, ascending. Explicit
        // signs are honoured in a 'to'-glued range ('from -20% to 35%' — the
        // natural signed-percentile phrasing, round 5) provided no
        // directional cue contradicts them; a sign inside a HYPHEN range
        // ('-20-30%'), '±' on any bound, and descending bounds stay refused.
        const [lo, hi] = segMembers;
        const hasSign = lo.sign !== '' || hi.sign !== '';

        // ROUND 6 (change-then-level): '<neg-cue> X% to Y%' — 'revenue fell
        // 10% to 55%' — is the financial change-then-level idiom: X is a
        // negative CHANGE, Y is a positive LEVEL, NEVER a sign-flipped range.
        // Idiom conditions: 'to' glue, negative cue, the change bound carries
        // its OWN anchor, no explicit signs, and no leading 'from' ('down
        // from 30% to 20%' is a level transition — round-5 treatment stands).
        if (segGlues[0] === 'to' && cue === 'neg' && lo.anchored && !hasSign) {
          const w = precedingWords(src, lo.start, 1);
          if (w[w.length - 1] !== 'from') {
            if (!hi.anchored) {
              // Idiom-shaped but the level bound has no anchor of its own
              // ('fell 10% to 55') — ambiguous change-vs-price ⇒ fail closed.
              unparseable++;
              continue;
            }
            values.push(-lo.value, hi.value);
            continue;
          }
        }
        const signedFormOk = segGlues[0] === 'to' && lo.sign !== '±' && hi.sign !== '±' && cue === 'none';
        if (hasSign && !signedFormOk) {
          unparseable++;
          continue;
        }
        const loV = lo.sign === '-' ? -lo.value : lo.value;
        const hiV = hi.sign === '-' ? -hi.value : hi.value;
        if (loV > hiV) {
          unparseable++;
          continue;
        }
        const s = cue === 'neg' ? -1 : 1;
        values.push(s * loV, s * hiV);
        continue;
      }

      // Single literal or conjunction list: resolve each member independently.
      let clusterBad = false;
      const resolved: number[] = [];
      for (const m of segMembers) {
        if (m.sign === '±') {
          if (cue !== 'none') {
            clusterBad = true; // '±' against a directional cue: contradiction
            break;
          }
          resolved.push(m.value, -m.value);
          continue;
        }
        if ((m.sign === '-' && cue === 'pos') || (m.sign === '+' && cue === 'neg')) {
          clusterBad = true; // explicit sign contradicts the directional cue
          break;
        }
        const negative = m.sign === '-' || (m.sign === '' && cue === 'neg');
        resolved.push(negative ? -m.value : m.value);
      }
      if (clusterBad) {
        unparseable++;
        continue;
      }
      values.push(...resolved);
    }
  }

  const { anchors, demotedPoints } = detectAnchorTokens(src);

  // ---------- ROUND 6: ANCHOR RECONCILIATION (invariant v1) ----------
  // Every anchor token the dumb detector finds must have been consumed by
  // exactly one Layer-2 outcome above. Any anchor left unconsumed is a
  // figure shape this extractor never anticipated — fail CLOSED here.
  for (const t of anchors) {
    const covered = consumedAnchors.some((s) => spansOverlap(t, s));
    if (!covered) unparseable++;
  }

  // ---------- ROUND 7: NUMERIC-TOKEN RECONCILIATION (invariant v2) ----------
  // Within any anchor-bearing clause, EVERY numeric token must be consumed
  // by exactly one Layer-2 outcome. An unconsumed token sharing a clause
  // with an anchor is exactly the class round 6 leaked ('between ninety and
  // 95%' — the 'ninety' vanished): fail CLOSED, by construction. Clause
  // commas shield ('In 2024, 25%…'); chained list commas do not.
  const boundaries = clauseBoundaries(src, chainedGlueSpans);
  for (const lit of lits) {
    if (consumedLits.has(lit)) continue;
    const clause = clauseAround(boundaries, src.length, lit.start);
    // ROUND 10 (ruling 2b): a DEMOTED bare-points token keeps its clause
    // anchor-bearing for this check — demotion can never disarm the
    // stranded-token reconciliation ('points dropped from 12' fails closed
    // even though the points token itself is prose by the calibration
    // ruling). A CONSUMED (valued) figure sharing the clause stays clean
    // ('Good point about the 40% figure').
    if (
      anchors.some((a) => spansOverlap(a, clause)) ||
      demotedPoints.some((d) => spansOverlap(d, clause))
    ) {
      unparseable++;
    }
  }

  return { values, unparseable };
}
