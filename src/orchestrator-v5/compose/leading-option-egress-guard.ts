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
  { code: 'comes_out_ahead', re: /\bcomes?\s+out\s+(?:ahead|on\s+top)\b/i },
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
 * Every user-visible prose field on a Phase-3 block, by block type.
 *
 * `signal` is included on all four block types. It is currently scanned by
 * NOTHING — not `sanitiseBlock` (which walks title/body/action_label and the
 * evidence quartet but skips `signal`), not the prose guard. It is a 140-char
 * user-visible line; an unscanned user-visible line is exactly the shape of
 * this whole defect class.
 */
const BLOCK_PROSE_FIELDS: readonly string[] = [
  'title',
  'body',
  'signal',
  'action_label',
  'factor_label',
  'evidence_gap',
  'suggested_technique',
  'impact_if_gathered',
  'note',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
 */
const ENRICHMENT_CLAIM_BLOBS: readonly string[] = ['decision_review', 'decision_brief'];

/**
 * Node budget for the deep walk, shared across the WHOLE response so total work
 * is bounded even on a pathological envelope (this chokepoint is re-entered up
 * to 4× per response). The live blobs measure ~1–2k nodes, so this is ~25×
 * headroom.
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
  for (const key of Object.keys(record)) scanDeep(`${path}.${key}`, record[key], out, budget);
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
      scanString(`blocks[${i}].${field}`, block[field], hits);
    }

    // `blocks[i].enrichment.{decision_review,decision_brief}` — the
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
      'handler already stamped on the fact (readMayNameLeadingOption in orchestrator/context/' +
      'constraint-feasibility.ts). Do NOT widen this guard instead: it is the alarm, not the fix.',
  );

  // MULTIPLICITY, stated because a residue meter that is silently multiplied is
  // worse than no meter: `sendFinalised200` re-enters this chokepoint up to 4×
  // per response (validate, then finalise the validated-or-fallback envelope),
  // and this event fires on EVERY pass that finds hits. A dashboard must
  // therefore count DISTINCT `request_id`s, not raw increments.
  //
  // Deliberately NOT deduped here: the alternative is request-scoped state in a
  // pure module — a module-level Set keyed by request id, which leaks across
  // requests and is a worse defect than a constant factor on a metric whose
  // actionable payload (`hit_paths`) travels on the log line above.
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

  // OBSERVE-ONLY: report, change nothing. When enforcement is wired, the drop
  // decision belongs HERE and must be per-field, not whole-response — blanking
  // an envelope at egress trades one dishonest answer for no answer at all.
  return response;
}
