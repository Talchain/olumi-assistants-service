/**
 * T1 claim safety — LAYER 3. The loud egress guard.
 *
 * WHAT THIS IS FOR. Layers 1 and 2 gate the producers we KNOW about: the
 * run_analysis confirmation segment, the STEP-5 coaching slot, the
 * decision-review prompt's `recommendation_suppressed`, and the Phase-3 block
 * kinds listed in `compose.ts`'s `presumesLeadingOption`. This layer exists for
 * the producers we do NOT know about.
 *
 * That is not hypothetical. G-CEE-1 was failed twice by the same defect class
 * arriving through a new producer each time:
 *   - #708 fixed the T1 disclosure; #709 then found the coaching slot asserting
 *     the leader the disclosure had just withheld.
 *   - #709 fixed the coaching slot; the 26 Jul live walk (staging `1c078f0`)
 *     then found `blocks[1].body` — "The MacBook Pro leads by a margin of about
 *     52 percentage points" — printed under "no option can be put forward yet".
 * Five independent producers of "who is leading" have now been found. Patching
 * them one at a time is not a strategy; this layer measures the residue.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SHIPS OBSERVE-ONLY. `enforce: false` (the only mode wired today) SCANS and
 * REPORTS and changes not one byte of the response. The `dropped` boolean tag
 * on the telemetry event separates a safety-enforced drop from a
 * telemetry-only detection, exactly as `V5DecisionReviewContractViolation`
 * does (`telemetry.ts`), so the enforcement flip is visible on the dashboard
 * rather than inferred. Turn it on only once real staging traffic has shown
 * what it catches — an enforcing guard built on a guess about its own hit rate
 * is how a fix becomes an outage.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * NEVER THROWS. House rule, ruled at `turn-executor.ts` (the finalise-path
 * invariant): throwing at egress surfaces a 500 to the user instead of a
 * curated recovery, which is a strictly worse outcome than the prose we are
 * trying to suppress. This module degrades and names the invariant LOUDLY
 * instead — `log.error` written to the engineer who caused it, plus a bounded
 * telemetry event, plus a Datadog counter. The scan itself is wrapped so that
 * even a malformed envelope cannot take the turn down.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDERING IS LOAD-BEARING — DO NOT MOVE THIS EARLIER.
 *
 * `compose/terminology-rewrite.ts` (`TERMINOLOGY_RULES`, applied to every
 * Phase-3 prose field via `validateProseAndSchemaOrDrop` in
 * `phase3-blocks.ts`) rewrites:
 *     "recommendation"   → "leading option"
 *     "the winner"       → "the leading option"
 *     "winning option"   → "leading option"
 * OUR OWN SAFETY PASS MANUFACTURES THE BANNED LANGUAGE. A scan placed before
 * that rewrite would read clean prose and pass a response that ships
 * "leading option" to the user. The guard therefore runs at the egress
 * chokepoint (`sanitiseOlumiResponseForEgress`), which is strictly downstream
 * of compose and so strictly downstream of the rewrite.
 *
 * If you are reordering the egress pipeline: this guard must stay AFTER every
 * pass that can edit user-facing prose. Moving it up silently reopens the hole
 * and no test upstream of the rewrite can see it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

/**
 * Copy that NAMES or PRESUMES a leading option.
 *
 * Sourced from the G-CEE-1 walk's own matcher (`raw/matcher.py`), which is the
 * instrument that scored the live failure — so a string this guard misses is a
 * string the acceptance walk would also have missed, and vice versa. Extending
 * one without the other silently decouples the gate from its evidence.
 *
 * `recommend*` and `winner` are ALSO in
 * `compose/forbidden-user-facing-phrases.ts`; the overlap is deliberate. That
 * module is a vocabulary/style guard applied per-block during composition and
 * it drops or rewrites; this one is a CLAIM guard applied to the serialized
 * envelope and it only fires when the verdict says the claim is unlicensed.
 * The same word can be fine on one turn and a false statement on another —
 * that is the distinction the two guards encode.
 *
 * Bounded and ordered: the FIRST match is what rides the telemetry `reason`
 * tag, so this list is the event's cardinality bound. Keep it small.
 */
const LEADER_CLAIM_PATTERNS: ReadonlyArray<{ readonly code: string; readonly re: RegExp }> = [
  { code: 'leads', re: /\bleads\b/i },
  { code: 'leading_option', re: /\bleading\s+option/i },
  { code: 'the_lead', re: /\bthe\s+lead\b/i },
  { code: 'which_option_leads', re: /\bwhich\s+option\s+leads\b/i },
  { code: 'recommend', re: /\brecommend(s|ed|ation|ations)?\b/i },
  { code: 'best_option', re: /\bbest\s+option\b/i },
  { code: 'winner', re: /\bwinners?\b/i },
  { code: 'ahead', re: /\b(?:is|are|was|were)\s+ahead\b/i },
  { code: 'top_choice', re: /\btop\s+(?:choice|option)\b/i },
  /**
   * SECOND RECORDED DIVERGENCE from the walk's matcher — and the one that
   * makes this list able to see the defect it was extended for.
   *
   * The POST-#711/#712 walk's headline leak is, verbatim from `case1e`:
   *
   *   "Standardise on MacBook Pro **comes out ahead, leading in** 44% of
   *    simulations, with Standardise on Dell XPS close behind at 34% …"
   *
   * Checked pattern by pattern, that sentence matches **NOTHING** in this list
   * as it stood: `leads` misses "leading", `leading_option` misses "leading
   * in", `the_lead` misses, `is\s+ahead` misses "comes out ahead", and the
   * band tier's four adverbs miss a bare "ahead". The four live bodies were
   * caught only INCIDENTALLY, by other sentences in the same answer ("The lead
   * is not stable", "take the lead"). Had the model emitted the leader claim
   * alone, this vocabulary would have passed it — and the walk's own §3.3
   * would have read as a clean turn.
   *
   * The additions below are taken from matcher-v3's BAND tier
   * (`WALK-2026-07-26-POST-71112.md` §1.1), which is strictly richer than what
   * this module had: it carries `marginally|narrowly|comfortably` alongside the
   * original four, plus `ahead by`, `out in front`, `top option` and `comes out
   * on top`. `comes out ahead` and `leading in` are additions beyond even that
   * — they are the live string, and matcher-v3 would also have missed them.
   *
   * DIRECTION OF THE DIVERGENCE, stated so a future reader does not have to
   * re-derive it: this guard is now strictly STRONGER than the walk's matcher.
   * A hit here that the matcher does not see is expected and is not a defect in
   * either instrument; the reverse would be.
   */
  /**
   * THE REPO'S OWN DETERMINISTIC TEMPLATE — and the hole that proved a pattern
   * list cannot be maintained by hand.
   *
   * `composeExplainResultsFallback` (explanation-fallback.ts) opens EVERY
   * explanation fallback with `"${leading.label} performs best, with a
   * probability of …"`. That string matched none of the patterns above, so the
   * enforcement gate could not see the fallback it was written to cover — and
   * the gate's own docstring quoted this very sentence as covered.
   *
   * The corridor that made it a live defect rather than a cosmetic miss:
   * withheld turn → Sonnet's answer fails side-band validation → the handler
   * substitutes THIS fallback → the scanner misses it → the gate takes the
   * APPEND branch instead of REPLACE → the leader claim ships beside the
   * disclosure denying it. The `case1g` shape, via the covered producer.
   *
   * ADDED BY, AND PINNED BY, A DERIVED CONTROL — not by inspection.
   * `__tests__/leader-vocabulary-producer-control.test.ts` drives both
   * deterministic fallbacks across their whole margin x stability x runner-up
   * space and asserts the enforcement scanner sees each LEADER SENTENCE in
   * isolation. Reword the template and that test fails in the same PR. This
   * entry exists because that control demanded it; do not add speculative
   * siblings here, add them when the control asks.
   */
  { code: 'performs_best', re: /\bperforms?\s+best\b/i },
  /**
   * ⚠ THE PAST TENSE — added 2026-07-27, and it is the SECOND time this list
   * missed a template the repo itself writes.
   *
   * This entry read `/\bcomes?\s+out\s+(?:ahead|on\s+top)\b/i`: come, comes,
   * and NOT `came`. `routing/run-comparison-gate.ts`'s `composeComparison` — a
   * pure, deterministic, zero-LLM composer — emits, verbatim, on the #731 mixed
   * branch where the prior run's verdict permits and the current run's
   * withholds:
   *
   *     "${prior_leading_label} came out ahead in the earlier run."
   *
   * That sentence matched NOTHING in this list. Its sibling, the both-permitted
   * template, emits "${prior} came out ahead before, and ${current} now leads."
   * and was seen ONLY INCIDENTALLY, through the trailing "now leads" clause —
   * the leader claim about the PRIOR run was invisible in both, and the mixed
   * branch has no neighbouring clause to save it.
   *
   * WHY IT MATTERS BEYOND THAT ONE COMPOSER. The vocabulary is SHARED with four
   * consumers that read UNBOUNDED prose and act on what they see:
   * `compose/withheld-explanation-answer.ts` (REPLACE-vs-APPEND on a handler's
   * answer), `compose.ts`'s `evidence_gap` filter, `compose/withheld-claim-
   * projection.ts`'s `analysis_summary` projection, and
   * `context/withheld-leader-projection.ts`'s notes. A past-tense leader claim
   * in model or enrichment prose was invisible to every one of them. (The fifth
   * consumer, `context/withheld-history-redaction.ts`, already caught it through
   * its own wider bare-`ahead` pattern — which is exactly the alarm-weaker-than-
   * its-own-sibling divergence this module's docstring says must never happen.)
   *
   * ADDED BY, AND PINNED BY, THE DERIVED CONTROL — not by inspection.
   * `__tests__/leader-vocabulary-producer-control.test.ts` now drives
   * `composeComparison` across its full permission x ordering x margin space and
   * asserts PER CLAUSE, so the incidental catch cannot mask a miss. Removing
   * `came|` from the alternation turns that control red and names the template.
   * `coming out ahead` is deliberately NOT added: no producer emits it and the
   * control does not ask for it — when one does, the control is what will say so.
   */
  { code: 'comes_out_ahead', re: /\b(?:came|comes?)\s+out\s+(?:ahead|on\s+top)\b/i },
  { code: 'leading_in', re: /\bleading\s+in\b/i },
  { code: 'ahead_by', re: /\bahead\s+by\b/i },
  { code: 'out_in_front', re: /\bout\s+in\s+front\b/i },
  /**
   * The PRODUCER'S BAND PHRASING, and the one deliberate divergence from the
   * walk's matcher noted above.
   *
   * `WALK-2026-07-26-POST-710.md` §7.2 found its own instrument blind here: on
   * the two `unevaluated` bodies it "reported a leader claim it could not see",
   * because `decision_brief.headline_banded.text` reads *"… is slightly
   * ahead."* and `\bis\s+ahead\b` does not match it. The walk RECOMMENDED
   * promoting this pattern and explicitly declined to apply it itself, because
   * doing so would move its own 26 Jul comparability baseline.
   *
   * The guard has no such baseline to protect, and this is the field with a
   * live UI reader chain (§4.2). Adding it makes the ALARM strictly stronger
   * than the matcher — a one-directional divergence, recorded here rather than
   * left for a future reader to discover as a mystery hit.
   */
  {
    code: 'band_ahead',
    re: /\b(?:slightly|clearly|well|far|marginally|narrowly|comfortably)\s+ahead\b/i,
  },
];

/**
 * Does ONE string name or presume a leading option?
 *
 * The string-level reading of {@link LEADER_CLAIM_PATTERNS}, exported so the
 * PRODUCER-side gates test prose against the SAME vocabulary this alarm
 * measures the residue with. Two consumers today:
 *   - `compose/withheld-explanation-answer.ts` (the explanation-answer gate);
 *   - the per-field `evidence_gap` projection in `compose.ts`.
 *
 * THIS IS NOT "WIDENING THE GUARD" — the module docstring's instruction is
 * "FIX THE PRODUCER … Do NOT widen this guard instead: it is the alarm, not the
 * fix", and that still holds: `guardLeadingOptionClaimsAtEgress` remains
 * observe-only and drops nothing. What is shared here is the VOCABULARY, not
 * the enforcement. Sharing it is the point — a producer gate built on its own
 * private pattern copy would drift from the alarm, and the first symptom would
 * be a leak this module reports and the gate silently permits (CLAUDE.md trap
 * #12: derive, don't mirror).
 *
 * Every pattern is non-global, so `.test` carries no `lastIndex` state and this
 * is safe to call repeatedly on the same or different strings.
 */
export function textNamesLeadingOption(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return LEADER_CLAIM_PATTERNS.some(({ re }) => re.test(value));
}

/**
 * Spans that trip {@link LEADER_CLAIM_PATTERNS} while making NO claim about a
 * leading option. Neutralised for ENFORCEMENT only — never for the alarm.
 *
 * WHY THE TWO READERS DIVERGE, and why this is not a second vocabulary.
 * The alarm and the enforcer have opposite cost functions:
 *
 *   ALARM (observe-only)  a false positive costs one noisy log line. A false
 *                         NEGATIVE costs a shipped contradiction. Bias wide.
 *   ENFORCER (this PR)    a false positive DELETES real user content — it
 *                         replaces a correct answer with withheld copy, or
 *                         drops an evidence block. Bias precise.
 *
 * `\bleads\b` is the sharp case. It is correct for "MacBook Pro leads" and
 * catastrophic for "higher capacity **leads to** faster delivery" or "your
 * **team leads** will need to agree" — ordinary English that the enforcement
 * path would silently destroy. POST-710 §7.1 already recorded "team leads" as a
 * known false positive of this exact pattern; before this carve-out the
 * enforcer inherited it and acted on it.
 *
 * CRUCIALLY this is a CARVE-OUT LIST, not a fork of the pattern set. Both
 * readers run the SAME {@link LEADER_CLAIM_PATTERNS}; the enforcer merely blanks
 * these spans first. A new leader phrasing is therefore added ONCE and both
 * readers get it — the single-source property that keeps the gate tied to the
 * alarm (and to the producer control in
 * `__tests__/leader-vocabulary-producer-control.test.ts`).
 */
const ENFORCEMENT_FALSE_POSITIVE_SPANS: readonly RegExp[] = [
  /** Causal "X leads to Y" — a statement about mechanism, not about ranking. */
  /\bleads\s+to\b/gi,
  /** The job title. "team lead(s)", "tech lead(s)", "engineering lead(s)". */
  /\b(?:team|tech|engineering|project|squad)\s+leads?\b/gi,
];

/**
 * ⚠ WHAT A NEUTRALISED SPAN IS REPLACED WITH — and why it is NOT a space.
 * (ROADMAP 2.149 residual (a); found by the #755 adversarial review, fixed here
 * because 2.149 makes the ENFORCER live over every exit family's copy.)
 *
 * This used to be `' '`. Blanking a span to whitespace does not merely remove
 * the span — it brings the span's two NEIGHBOURS into adjacency, and every
 * pattern in {@link LEADER_CLAIM_PATTERNS} is an adjacency test (`\s+` between
 * words). So the carve-out could MANUFACTURE a match the original string did
 * not contain, and the enforcer became STRICTLY WIDER than the alarm on exactly
 * the strings the carve-out exists to spare:
 *
 *     "Bob is tech lead ahead of Carol."
 *        wide  (textNamesLeadingOption)   → false   — no `is ahead`, no `leads`
 *        narrow, with ' '                 → TRUE    — "Bob is   ahead of Carol."
 *                                                     now matches `\b(?:is|are|
 *                                                     was|were)\s+ahead\b`
 *        narrow, with this token          → false   — adjacency is broken
 *
 * A wider ENFORCER than ALARM inverts the whole cost-function doctrine above:
 * the reader that DELETES user content would fire on a string the observe-only
 * reader would not even log. Latent until now (no shipping copy tripped it —
 * all five run-comparison constants measure false on both readers), and the
 * blast radius widens the moment a wire-level enforcer runs over every exit.
 *
 * REQUIREMENTS ON THE TOKEN, all three load-bearing:
 *   - NOT whitespace — `\s+` must not match it, or adjacency re-forms.
 *   - NOT a word character — or it would fuse with a neighbouring word and
 *     could change what `\b` sees.
 *   - NOT `\0` — CLAUDE.md trap #17: a NUL byte makes `file(1)` classify the
 *     source as binary, which blinds plain `grep` and renders the file as
 *     binary in `gh pr diff`. That sentinel pattern is being REMOVED from this
 *     estate (ROADMAP 2.119), not added to.
 *
 * Because the token is non-word and non-space and the spans are `\b`-anchored,
 * neutralisation can only ever REMOVE matches, never add one — which is the
 * property {@link assertEnforcerIsNarrowerThanAlarm} pins at module load.
 */
const ENFORCEMENT_NEUTRALISED_SPAN = '#';

/**
 * Does one string ASSERT a leading option, for the purposes of ENFORCEMENT?
 *
 * Same vocabulary as {@link textNamesLeadingOption}, minus the documented
 * false-positive spans above. This is the reader the two ENFORCING consumers
 * use — `compose/withheld-explanation-answer.ts` and the `evidence_gap` filter
 * in `compose.ts` — because both DELETE user-facing content when they fire.
 *
 * The observe-only egress guard keeps the wider net: it is measuring residue,
 * and a slightly noisy alarm is the correct trade for one that cannot miss.
 */
export function textAssertsLeadingOption(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  let neutralised = value;
  for (const re of ENFORCEMENT_FALSE_POSITIVE_SPANS) {
    neutralised = neutralised.replace(re, ENFORCEMENT_NEUTRALISED_SPAN);
  }
  return textNamesLeadingOption(neutralised);
}

/**
 * BUILD-TIME PROBE — THE ENFORCER IS NEVER WIDER THAN THE ALARM.
 *
 * `textAssertsLeadingOption(s) ⟹ textNamesLeadingOption(s)`. That implication is
 * the entire cost-function doctrine at {@link ENFORCEMENT_FALSE_POSITIVE_SPANS}
 * expressed as a property, and until ROADMAP 2.149 it did NOT hold — the
 * space-blanking carve-out could manufacture an adjacency the input lacked.
 *
 * Runs at module load and throws, so a regression fails the process at startup
 * and every test that imports the vocabulary (CLAUDE.md trap #12: a guarantee a
 * human must remember to re-check is a guarantee that drifts).
 *
 * ⚠ EVERY ARM HAS A POSITIVE CONTROL (trap #13). An implication probe passes
 * vacuously if the enforcer never fires, so the corpus contains strings the
 * enforcer MUST see as well as strings it must spare, and the probe fails if
 * either half stops discriminating.
 */
const ENFORCER_NARROWNESS_CORPUS: readonly string[] = Object.freeze([
  // ⭐ THE RECORDED DEFECT, verbatim from the #755 adversarial review
  // (adv-review-cee-755.md:315-345). Wide=false; narrow was TRUE under ' '.
  'Bob is tech lead ahead of Carol.',
  // The two carve-out shapes themselves, which must stay spared.
  'Higher capacity leads to faster delivery.',
  'Your team leads will need to agree the rollout window.',
  // Adjacency the carve-out could forge on the OTHER span.
  'The engineering leads recommend nothing in particular.',
  // Ordinary prose with no ordering claim at all.
  'What would firm this up is real enterprise figures from your pipeline.',
]);

/** Strings the ENFORCER must SEE, or the probe above proves nothing. */
const ENFORCER_MUST_FIRE_CORPUS: readonly string[] = Object.freeze([
  'Hire Marketing Manager leads at 72% against Hold at 28%.',
  'Standardise on MacBook Pro comes out ahead, leading in 44% of simulations.',
  'Double Down on SMB is slightly ahead.',
  'Standardise on Dell XPS performs best, with a probability of 56%.',
]);

function assertEnforcerIsNarrowerThanAlarm(): void {
  for (const sentence of ENFORCER_NARROWNESS_CORPUS) {
    if (textAssertsLeadingOption(sentence) && !textNamesLeadingOption(sentence)) {
      throw new Error(
        'leading-option-egress-guard: the ENFORCEMENT reader fires on a string the ALARM reader ' +
          `does not see — ${JSON.stringify(sentence)}. The carve-out neutralisation has ` +
          'manufactured a word adjacency the input never had, so the reader that DELETES user ' +
          'content is now wider than the reader that only logs. Fix ENFORCEMENT_NEUTRALISED_SPAN ' +
          '(it must be non-word and non-whitespace); do not narrow LEADER_CLAIM_PATTERNS, which ' +
          'is shared with the alarm and the producer controls.',
      );
    }
  }
  for (const sentence of ENFORCER_MUST_FIRE_CORPUS) {
    if (!textAssertsLeadingOption(sentence)) {
      throw new Error(
        'leading-option-egress-guard: the ENFORCEMENT reader is blind to a leader claim — ' +
          `${JSON.stringify(sentence)}. The narrowness probe above would then pass by testing ` +
          'nothing (CLAUDE.md trap #13). Restore the pattern this string exercises.',
      );
    }
  }
  // The specific historical defect, asserted as a NAMED case rather than left to
  // the loop: if this line ever throws, the space-collapse adjacency is back.
  if (textAssertsLeadingOption('Bob is tech lead ahead of Carol.')) {
    throw new Error(
      'leading-option-egress-guard: the space-collapse adjacency defect has returned — ' +
        '"tech lead" is being blanked into "is ␣ ahead". See ENFORCEMENT_NEUTRALISED_SPAN.',
    );
  }
}

/**
 * KEY NAMES that designate a leading option — the STRUCTURED half of this
 * vocabulary, and the half whose absence let a leak run for three walks.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SECOND READER AT ALL. Every reader above scans string VALUES for
 * comparative English. That is the right instrument for prose and it is
 * structurally blind to this:
 *
 *   `enrichment.robustness.recommended_option_label`
 *       = "Defer and Keep Current Machines (Status Quo)"
 *   `enrichment.decision_brief.analysis_summary.leading_option`
 *       = "Standardise on Dell XPS"
 *
 * The value is a bare option label. It contains no superiority vocabulary, so
 * `textNamesLeadingOption` correctly returns false on it. THE CLAIM IS CARRIED
 * BY THE KEY, and no text matcher reads keys.
 *
 * Measured, not supposed: `WALK-2026-07-27-FINAL.md` §8 found these four paths
 * on **10 of 10** withheld bodies that carried an analysis block, and present in
 * BOTH prior archives — pre-existing, missed by every prior walk because the
 * structured assertion set S1–S6 is a hand-kept list of five paths with no entry
 * for `analysis_summary` or for `enrichment.robustness`, and because this guard
 * did not scan `enrichment.robustness` at all.
 *
 * ⚠ PATTERNS, NOT A KEY LIST, AND THAT IS THE WHOLE POINT. A list of the four
 * observed key names would be the same hand-maintained mirror that produced the
 * miss (CLAUDE.md trap #12): the fifth key name — `preferred_option_label`, say,
 * or a rename to `leader_label` — would read as green on the day it shipped.
 * A key-name FAMILY covers designations that do not exist yet.
 *
 * ⚠ ANCHORED AT `^`, AND THAT IS LOAD-BEARING TOO. `fragile_edges[].
 * alternative_winner_id` / `alternative_winner_label` are live on every body and
 * are NOT leader designations — they name the COUNTERFACTUAL winner if that edge
 * flips, which is the science content the withheld disclosure explicitly invites
 * the user to act on, and which PR #717 landed a fix to carry through. An
 * unanchored `/winner/` would suppress them. The anchor is what keeps this a
 * leader detector rather than an option-label detector.
 *
 * Shared with the PRODUCER gate (`compose/withheld-claim-projection.ts`) for the
 * same reason {@link textNamesLeadingOption} is: a producer gate with its own
 * private copy drifts from the alarm, and the first symptom is a leak this
 * module reports and the gate silently permits.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const LEADER_DESIGNATING_KEY_PATTERNS: ReadonlyArray<{
  readonly code: string;
  readonly re: RegExp;
}> = [
  { code: 'key_leading_option', re: /^leading_option(?:_(?:id|label|name))?$/i },
  { code: 'key_leader', re: /^leader_(?:option(?:_(?:id|label|name))?|id|label)$/i },
  { code: 'key_recommended_option', re: /^recommend(?:ed|ation)_option(?:_(?:id|label|name))?$/i },
  { code: 'key_top_option', re: /^top_option(?:_(?:id|label|name))?$/i },
  {
    code: 'key_winning_option',
    re: /^(?:winning|winner|best|preferred|chosen)_option(?:_(?:id|label|name))?$/i,
  },
];

/**
 * Does this OBJECT KEY designate a leading option, on its own, regardless of
 * what its value says?
 *
 * Exported so the withheld-turn producer projection drops exactly the keys this
 * alarm reports — one vocabulary, two consumers, no mirror between them.
 *
 * Every pattern is non-global and anchored, so this is safe to call repeatedly.
 */
export function keyDesignatesLeadingOption(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return LEADER_DESIGNATING_KEY_PATTERNS.some(({ re }) => re.test(key));
}

/** One detected claim. `sample` is NEVER logged or emitted — triage only. */
export interface LeaderClaimHit {
  /** Dotted path into the serialized envelope, e.g. `blocks[13].body`. */
  readonly path: string;
  /** The matched pattern's bounded code (see {@link LEADER_CLAIM_PATTERNS}). */
  readonly code: string;
}

export interface LeadingOptionEgressGuardOpts {
  readonly requestId: string;
  readonly exitPath: string;
  /**
   * The turn's OWN answer to "may a leading option be named", threaded from the
   * verdict the run_analysis handler derived — NOT re-derived here (CLAUDE.md
   * trap #12). `true` licenses every string below; the guard is a no-op.
   */
  readonly mayNameLeadingOption: boolean;
  /**
   * OBSERVE-ONLY when false: hits are reported, the response is returned
   * unchanged. Nothing wires `true` yet — see the module docstring.
   */
  readonly enforce: boolean;
}

function scanString(path: string, value: unknown, out: LeaderClaimHit[]): void {
  if (typeof value !== 'string' || value.length === 0) return;
  for (const { code, re } of LEADER_CLAIM_PATTERNS) {
    if (re.test(value)) {
      out.push({ path, code });
      return; // first match per string — the string is already condemned
    }
  }
}

/**
 * Report one KEY whose NAME designates a leading option, when it actually
 * carries an identity.
 *
 * POPULATION IS REQUIRED, and the reason is the whole point of the field it was
 * written for: `blocks[i].leading_option_id` is a REQUIRED wire key that the
 * withheld projection sets to `null` (compose.ts — `null` is the schema's own
 * honest "no leader is being put forward"). A key-name reader that fired on the
 * key's PRESENCE would report the correct, gated shape as a violation on every
 * withheld turn, and an alarm that is loud when nothing is wrong is an alarm
 * that gets muted. So: a non-empty string identity fires; `null`, `undefined`
 * and `''` do not.
 */
function scanKey(path: string, key: string, value: unknown, out: LeaderClaimHit[]): void {
  if (typeof value !== 'string' || value.length === 0) return;
  for (const { code, re } of LEADER_DESIGNATING_KEY_PATTERNS) {
    if (re.test(key)) {
      out.push({ path, code });
      return; // first match per key — the key is already condemned
    }
  }
}

/**
 * Every user-visible prose field on a Phase-3 block, by block type.
 *
 * `signal` is included on all four block types. It is currently scanned by
 * NOTHING — not `sanitiseBlock` (which walks title/body/action_label and the
 * evidence quartet but skips `signal`), not the prose guard. It is a 140-char
 * user-visible line; an unscanned user-visible line is exactly the shape of
 * this whole defect class.
 *
 * ⚠ `summary` ADDED 2026-07-27 (F1), AND IT IS THE FIELD THE WHOLE DOCTRINE
 * SAYS THE DISCLOSURE RIDES ON. `blocks[].summary` is the `analysis_result`
 * block's REQUIRED headline string. `compose.ts`'s `buildAnalysisResultBlock`
 * shipped it VERBATIM on every branch — the withheld projection nulls
 * `leading_option_id`, projects the enrichment and drops the leader-presuming
 * Phase-3 blocks, and never touched `summary`.
 *
 * It was outside BOTH readers: absent from this list, and its key name matches
 * nothing in {@link LEADER_DESIGNATING_KEY_PATTERNS}, so {@link scanKey} could
 * not see it either. On a PRE-#708 fact — no `constraint_verdict`, no
 * `__cee_claim_safety`, so the reader fails CLOSED — the FRESH prior-fact
 * lifecycle branch rebuilds the block and ships
 * "…currently leads by 18 percentage points" beside an assistant_text saying no
 * option can be put forward. Byte-for-byte the G-CEE-1 contradiction, and the
 * residue meter reported ZERO hits on it, so the telemetry sizing this class
 * under-counted exactly the class the fail-closed default manufactures.
 *
 * Why no walk saw it: the walks induce FRESH scenarios, whose facts are stamped
 * and therefore PERMITTED. Only a historic fact takes this path, and there is no
 * migration.
 */
const BLOCK_PROSE_FIELDS: readonly string[] = [
  'title',
  'body',
  'signal',
  'summary',
  'action_label',
  'factor_label',
  'evidence_gap',
  'suggested_technique',
  'impact_if_gathered',
  'note',
  // ⚠ THE SIX EXERCISE PROSE FIELDS — ADDED 2026-07-31 (capability P1, CEE #770
  // adversarial review B1), AND THEY ARE THE FOURTH INSTANCE OF THIS EXACT
  // DEFECT. `signal` and `summary` above were both added only after the field
  // had shipped unobserved; this one was caught BEFORE a producer existed for
  // more than a day, which is the only difference.
  //
  // Until #770 the `exercise` block kind had no V5 producer at all, so its prose
  // was unobservable-but-harmless. #770 gives `warning_signs` / `mitigation` /
  // `review_trigger` a live producer, and the 2.149 scope block's stated
  // justification for leaving `blocks[]` out of WIRE enforcement is precisely
  // "the alarm keeps observing them". That sentence was FALSE for this block
  // kind: the paired probe put the identical roster sentence
  // ("The MacBook Pro leads by a margin of about 52 percentage points.") in the
  // exercise prose fields and in `review_card.body` — ZERO hits vs one hit.
  //
  // All SIX are listed, not only the three #770 emits. Listing what today's
  // builder happens to emit is the mirror defect one layer down: the next
  // exercise_kind (outside_view / devils_advocacy / consider_opposite) reaches
  // for `reference_class` and `counter_case`, and would arrive unobserved.
  // `exercise-prose-alarm-coverage` in the guard's own spec DERIVES this set
  // from `ExerciseBlockSchema.shape` and REDs on any schema addition that is
  // neither listed here nor explicitly classified non-prose — so this list
  // fails loud on drift rather than rotting quietly (CLAUDE.md trap 12).
  //
  // NOT a live leak today: the positional gate in `rebuildPhase3BlocksFresh`
  // means no companion reaches a withheld response at all. This restores
  // defence in depth and the truth of a stated guarantee.
  'failure_scenario',
  'warning_signs', // ARRAY — see `scanProseField`; `scanString` alone is blind to it
  'mitigation',
  'reference_class',
  'counter_case',
  'review_trigger',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Scan one {@link BLOCK_PROSE_FIELDS} member, which may be a STRING or an ARRAY
 * OF STRINGS.
 *
 * WHY THIS EXISTS RATHER THAN JUST LISTING THE FIELD. `scanString` opens with
 * `if (typeof value !== 'string' ...) return;` — a silent early return. So
 * `warning_signs` (the ExerciseBlock's `z.array(z.string().min(1))`) would have
 * been invisible to the alarm EVEN AFTER being added to the field list: the list
 * entry would have read as coverage while scanning nothing. That is the
 * vacuous-guard shape, and adding the name alone would have written a false
 * coverage claim into the very list whose job is to be true.
 *
 * Array entries get an indexed path (`blocks[0].warning_signs[1]`) so the
 * telemetry names the offending entry, not just the field. Non-string entries
 * are skipped by `scanString` exactly as before — this widens the walk, it does
 * not loosen the match.
 */
function scanProseField(path: string, value: unknown, out: LeaderClaimHit[]): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      scanString(`${path}[${i}]`, value[i], out);
    }
    return;
  }
  scanString(path, value, out);
}

/**
 * The `analysis_result` block's enrichment blobs that can carry a leader claim.
 *
 * Scanned by a DEEP WALK, not a field list. That is a correction, and it is the
 * whole point of this change (ROADMAP 1.218):
 *
 *   - `story_headlines` was read as `Array.isArray(...) ? … : []`. On the live
 *     wire it is a DICT keyed by option id — verified `dict` on **10/10** bodies
 *     of the POST-#710 archive. `Array.isArray` was false on every one, so the
 *     loop body never ran and the guard never scanned the field carrying
 *     "Leads under current modelling…". The walk's matcher saw it; the
 *     production alarm did not.
 *   - `decision_brief` was not scanned AT ALL — not `.headline`, not
 *     `.headline_banded`, not `.robustness_caveat` — which is 3 of the leaking
 *     strings on every withheld body.
 *
 * Both defects are the SAME defect: a hand-written path list that mirrored one
 * remembered shape (CLAUDE.md trap #12). Walking every string under the two
 * blobs removes the mirror instead of extending it — leader prose lives under
 * DYNAMIC keys here (option ids, factor ids, edge ids), so no static list can
 * stay complete. This layer drops nothing (observe-only), so a broad scan costs
 * a false alarm at worst and cannot over-suppress.
 *
 * ⚠ `robustness` ADDED 2026-07-27, AND IT IS THE THIRD INSTANCE OF THE SAME
 * DEFECT. `WALK-2026-07-27-FINAL.md` §8: `enrichment.robustness` was outside
 * this scan surface ENTIRELY, and it ships `recommended_option_id`,
 * `recommended_option_label` and `near_tie.top_option_id` — the leading option,
 * by id and by label — on every withheld body carrying an analysis block. The
 * blob is present on **65 of 65** enriched blocks across all five archived
 * corpora, so this was never a rare shape; it was simply never looked at.
 *
 * Note WHY adding it to this list alone would NOT have been enough, and why
 * {@link scanKey} exists: the values under `robustness` are bare labels and ids
 * with no comparative vocabulary in them. The deep STRING walk added here finds
 * nothing on today's shapes. It is the KEY reader that sees this leak, and it is
 * wired into the same walk so a future prose member of `robustness` is covered
 * by both.
 */
const ENRICHMENT_CLAIM_BLOBS: readonly string[] = [
  'decision_review',
  'decision_brief',
  'robustness',
];

/**
 * Node budget for the deep walk, shared across every enrichment blob on ONE
 * `findLeaderClaims` CALL, so total work is bounded even on a pathological
 * envelope. The live blobs measure ~1–2k nodes, so this is ~25× headroom.
 *
 * ⚠ PER-CALL, AND SINCE 2026-07-27 THAT IS ALSO PER-RESPONSE. The history is
 * worth keeping because the entry was wrong twice in opposite directions.
 * It first said "shared across the WHOLE response" (false — `findLeaderClaims`
 * allocates a FRESH `{ remaining }` per invocation). F9 corrected that to "up
 * to 4× this budget per response", which was closer but still wrong: the true
 * re-entry count was 2–8, varying with which debug surfaces were enabled.
 * ROADMAP 1.272 E1 then made the guard run ONCE per response, so per-call and
 * per-response now coincide and a reader sizing the bound or explaining a
 * `scan_budget_exhausted` count can use this number directly.
 *
 * Exhaustion is reported as a HIT, never as a silent truncation: a scanner that
 * quietly stops looking is the broken-alarm class this module exists to avoid.
 */
const ENRICHMENT_SCAN_NODE_BUDGET = 50_000;

/** Walk every string under `value`, bounded by a shared node budget. */
function scanDeep(
  path: string,
  value: unknown,
  out: LeaderClaimHit[],
  budget: { remaining: number },
): void {
  if (budget.remaining <= 0) return;
  budget.remaining -= 1;
  if (typeof value === 'string') {
    scanString(path, value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) scanDeep(`${path}[${i}]`, value[i], out, budget);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  for (const key of Object.keys(record)) {
    // The KEY reader runs alongside the string walk, not instead of it: a member
    // can leak through its name (`recommended_option_label`), through its prose
    // (`headline`), or through both. Reported as separate hits with separate
    // codes so the log line names which channel fired.
    scanKey(`${path}.${key}`, key, record[key], out);
    scanDeep(`${path}.${key}`, record[key], out, budget);
  }
}

/**
 * Collect every leading-option claim on the response.
 *
 * PURE and total — returns hits, decides nothing, logs nothing. Exported so
 * the route-level tests can assert the SCAN SURFACE directly on serialized
 * bytes rather than inferring it from the guard's side effects.
 */
export function findLeaderClaims(response: OlumiResponse): LeaderClaimHit[] {
  const hits: LeaderClaimHit[] = [];
  const budget = { remaining: ENRICHMENT_SCAN_NODE_BUDGET };

  // Top-level prose. `framing_question` is rendered VERBATIM by the UI and is
  // currently scanned by nothing at all.
  //
  // Read through `asRecord` (an `unknown` parameter) rather than an
  // `as unknown as Record` cast: the cast is on the forbidden-boundary
  // baseline, and the shape-read is what this function actually wants — the
  // envelope is walked defensively BECAUSE a producer may put a string where
  // the type says there is none, which is the very defect class being watched.
  const envelope = asRecord(response) ?? {};
  scanString('assistant_text', envelope.assistant_text, hits);
  scanString('framing_question', envelope.framing_question, hits);

  const classification = asRecord(envelope.decision_classification);
  if (classification !== null) {
    scanString('decision_classification.horizon', classification.horizon, hits);
  }

  const blocks = Array.isArray(envelope.blocks) ? envelope.blocks : [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = asRecord(blocks[i]);
    if (block === null) continue;
    for (const field of BLOCK_PROSE_FIELDS) {
      // `scanProseField`, not `scanString`: one member of this list
      // (`warning_signs`) is an ARRAY, and `scanString` early-returns on
      // non-strings — listing it without this would have been coverage on paper
      // and a blind spot in fact.
      scanProseField(`blocks[${i}].${field}`, block[field], hits);
    }

    // The block's OWN keys, by name. `blocks[i].leading_option_id` is the field
    // the whole gate turns on, and until now it sat outside every scan surface
    // in this module — the key reader would have been scoped to enrichment
    // blobs while the sharpest structured designation on the envelope was not
    // covered by it. It is `null` on a correctly-gated withheld turn and so
    // fires nothing; a regression that restores the id fires here.
    for (const key of Object.keys(block)) {
      scanKey(`blocks[${i}].${key}`, key, block[key], hits);
    }

    // `blocks[i].enrichment.{decision_review,decision_brief,robustness}` — the
    // analysis_result block's enrichment blobs. NOT wire-data-only:
    // `DecisionGuideAI/src/v5/applyV5State.ts` maps `decision_review` onto
    // `runMeta.ceeReviewV1`, and `decision_brief.headline_banded` has an
    // unbroken reader chain to `DecisionVerdict.hasLeadingOption` (the walk's
    // §2(d)-ii trace at UI tip `6d3f4611`). The G-CEE-1 walk's original matcher
    // excluded these blobs as "wire data, not rendered copy" — that exclusion
    // was wrong. Deep-scanned here; see ENRICHMENT_CLAIM_BLOBS for why a deep
    // walk and not a path list.
    const enrichment = asRecord(block.enrichment);
    if (enrichment === null) continue;
    for (const blob of ENRICHMENT_CLAIM_BLOBS) {
      if (enrichment[blob] === undefined) continue;
      scanDeep(`blocks[${i}].enrichment.${blob}`, enrichment[blob], hits, budget);
    }
  }

  // FAIL LOUD, never silently short. A truncated scan is a scan that stopped
  // looking, and this module's whole job is to be the alarm the other layers
  // are measured against.
  if (budget.remaining <= 0) {
    hits.push({ path: 'blocks[].enrichment', code: 'scan_budget_exhausted' });
  }

  return hits;
}

/**
 * Run the guard at the egress chokepoint.
 *
 * Returns the response. In observe-only mode that is ALWAYS the input,
 * unchanged and un-cloned.
 *
 * NEVER THROWS — see the module docstring. A scan failure is itself reported as
 * an invariant violation and the response passes through.
 */
export function guardLeadingOptionClaimsAtEgress(
  response: OlumiResponse,
  opts: LeadingOptionEgressGuardOpts,
): OlumiResponse {
  if (opts.mayNameLeadingOption) return response;

  let hits: LeaderClaimHit[];
  try {
    hits = findLeaderClaims(response);
  } catch (err) {
    log.error(
      {
        event: 'v5.invariant_violation',
        invariant: 'leading_option_claim_withheld_at_egress',
        request_id: opts.requestId,
        exit_path: opts.exitPath,
        scan_failed: true,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 egress: the leading-option claim guard could not scan this response, so it is shipping UNCHECKED. ' +
        'Fix the scanner in compose/leading-option-egress-guard.ts — findLeaderClaims must be total over the ' +
        'envelope shape. Do not make the guard throw; a 500 is worse than the prose it suppresses.',
    );
    emit(TelemetryEvents.V5LeadingOptionClaimAtEgress, {
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      reason: 'scan_failed',
      hit_count: 0,
      dropped: false,
    });
    return response;
  }

  if (hits.length === 0) return response;

  // Bounded, sorted, deduped — the telemetry cardinality bound.
  const codes = [...new Set(hits.map((h) => h.code))].sort();
  const paths = [...new Set(hits.map((h) => h.path))].sort();

  log.error(
    {
      event: 'v5.invariant_violation',
      invariant: 'leading_option_claim_withheld_at_egress',
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      // Field PATHS and pattern CODES only. Never the matched prose: this is
      // the egress boundary and the prose is the user's own decision content.
      hit_paths: paths,
      hit_codes: codes,
      hit_count: hits.length,
      enforced: opts.enforce,
    },
    'V5 egress: this turn withheld the leading-option claim, and then asserted it anyway in the fields listed ' +
      'in hit_paths. A user is being told "no option can be put forward yet" and shown which option leads, in ' +
      'one response. FIX THE PRODUCER named by hit_paths — gate it on the constraint verdict the run_analysis ' +
      // ⚠ A6, 2026-07-27: this instruction used to name `readMayNameLeadingOption` — the LEGACY
      // enrichment-only reader, which returns `false` for every fact written since schemas 0.25.0.
      // An engineer following the alarm's own remediation advice would have shipped silent
      // universal withholding. The alarm was right and its instructions were wrong, which is the
      // trap-#14 shape (an honest label overwritten by a false one) inside the module whose whole
      // subject is that a mechanism's label must be true. Name the reader the code actually calls.
      'handler already stamped on the fact (readMayNameLeadingOptionFromResult in orchestrator/context/' +
      'constraint-feasibility.ts). Do NOT widen this guard instead: it is the alarm, not the fix.',
  );

  // MULTIPLICITY: 1× PER RESPONSE. Corrected 2026-07-27 (ROADMAP 1.272 E1) —
  // this comment previously instructed dashboard readers to count DISTINCT
  // `request_id`s rather than raw increments, because `sendFinalised200`
  // re-entered the guard "up to 4× per response".
  //
  // ⚠ THAT NUMBER WAS AN UNDERCOUNT, AND IT WAS LOAD-BEARING. The real figure
  // was 2–8: one unconditional validate pass, exactly one of
  // {validated, fallback}, and up to six CONDITIONAL re-attach passes
  // (`_timings`, `_diagnostic_trace`, `_context_summary`, `_reasoning`,
  // `_answer_shape`, synthesised shape). So the multiplier was not a constant
  // at all — it varied with which debug surfaces were enabled in the
  // environment, which is the worst shape a metric correction can take: a
  // reader dividing by 4 got a different wrong answer per deployment.
  //
  // The fix was not to document the range. The guard now runs ONCE, on the
  // final `wireBody` immediately before `reply.send` (see `sendFinalised200`),
  // so raw increments and distinct `request_id`s are the same number and this
  // event needs no correction factor at all. Dedup state in a pure module — the
  // alternative previously ruled out here, correctly — is still not needed.
  emit(TelemetryEvents.V5LeadingOptionClaimAtEgress, {
    request_id: opts.requestId,
    exit_path: opts.exitPath,
    // PRIMARY code rides the tag; the full set is on the log payload above.
    reason: codes[0] ?? 'unknown',
    hit_count: hits.length,
    // Separates safety-ENFORCED drop from telemetry-only DETECTION, so the
    // observe-only period is distinguishable from enforcement on the dashboard.
    dropped: opts.enforce,
  });

  // OBSERVE-ONLY: report, change nothing.
  //
  // ⚠ THE INSTRUCTION THAT USED TO END THIS FILE HAS BEEN ACTED ON, AND IS
  // REPLACED RATHER THAN DELETED (CLAUDE.md trap #14). It read: *"When
  // enforcement is wired, the drop decision belongs HERE and must be per-field,
  // not whole-response — blanking an envelope at egress trades one dishonest
  // answer for no answer at all."*
  //
  // Enforcement IS now wired (ROADMAP 2.149), and it deliberately did NOT land
  // in this function. It lives in `compose/leading-option-wire-enforcement.ts`,
  // one rail over, for two reasons:
  //
  //   1. ENFORCEMENT AND OBSERVATION ARE SEPARATE RAILS. This guard measures
  //      the residue the PRODUCERS emit. If it also removed what it found, the
  //      meter would report its own success and the producer defect would go
  //      dark — the alarm would be measuring the enforcer, not the estate.
  //   2. The enforcer needs the substituted COPY, which lives in
  //      `withheld-explanation-answer.ts`, which imports the predicate from
  //      HERE. Putting the enforcer in this module makes that a cycle.
  //
  // The "per-field, not whole-response" instruction is honoured — the enforcer
  // is per-field AND per-SENTENCE (see `compose/redactable-units.ts`). This
  // function remains observe-only and `enforce` remains the telemetry tag that
  // separates the two rails on the dashboard.
  return response;
}

// Module-load probes last, so every declaration they read is initialised.
assertEnforcerIsNarrowerThanAlarm();
