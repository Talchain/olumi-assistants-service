/**
 * T1 claim safety — MECHANISM-LEVEL drift guard on LAYER 2 (the projection).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: THREE INSTANCES OF ONE CLASS, PATCHED ONE AT A TIME.
 *
 *   #710  the first-run Phase-3 BLOCKS named the leader on a withheld turn.
 *   #711  the STRUCTURED enrichment (`decision_review`, three `decision_brief`
 *         members, `leading_option_id`) did the same.
 *   this  the rerun NO-OP `assistant_text` did the same, on a path neither
 *         prior walk had ever exercised.
 *
 * Each fix was correct and each was complete for the surface it named. The
 * pattern across them is not "three bugs" — it is ONE mechanism defect: a
 * response-composing path can emit user-facing prose without consulting the
 * verdict, and NOTHING makes that omission visible. The egress guard
 * (`leading-option-egress-guard.ts`) measures the residue, but it is
 * observe-only and its own docstring says it is "the alarm, not the fix"; and
 * the sibling `route-egress-claim-safety-marking.drift.test.ts` pins that the
 * ALARM is ARMED at every exit — not that any path actually GATES content.
 *
 * That is the hole this file covers: **Layer 2, the projection**, as opposed to
 * Layer 3, the alarm.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT ASSERTS. It ENUMERATES, from source, every compose call in
 * `turn-executor.ts` that produces a user-facing `assistant_text`, keys each by
 * the EXPRESSION that supplies that text, and requires the resulting key set to
 * equal {@link COMPOSE_SITE_REGISTER} EXACTLY. Adding a compose site, removing
 * one, or renaming the variable that feeds it all fail this test immediately.
 *
 * ⚠ THIS IS A REGISTER, NOT A DERIVATION — and that is stated plainly because
 * CLAUDE.md trap #12 is that a hand-maintained mirror drifts silently. Whether
 * a given site CAN carry analysis-derived prose is a semantic judgement no
 * source scan can make, so the judgement is recorded here per-site with a
 * reason. What is DERIVED, and therefore cannot drift, is the SET: the mirror
 * fails LOUD the moment source and register disagree, which is the property
 * trap #12 demands when derivation is not possible.
 *
 * ENUMERATOR SCOPE, stated so nobody reads this as covering more than it does:
 * it scans `src/orchestrator-v5/turn-executor.ts` ONLY, for calls to exactly
 * four functions — `composeAnswer`, `composeToolCallResponse`,
 * `composeClarifyResponse`, `composeDirectAnswerResponse`. Compose sites in
 * OTHER modules (notably `handlers/chip-click-dispatch.ts`, which has three)
 * are OUT OF SCOPE and are not covered by any assertion here.
 *
 * ⚠ AND IT IS DELIBERATELY NOT ALL-GREEN-MEANS-SAFE. Eight of the twenty-five
 * registered keys are `ungated`, several carrying LLM-authored or
 * analysis-derived prose. Those are OPEN GAPS, recorded rather than fixed in
 * this slice, so the next reader inherits an explicit list instead of
 * re-deriving it from a fourth live walk. `ungated` is a TODO, not a blessing
 * (TESTING-DISCIPLINE rule 6: a stated limit is a to-do, not a hedge).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TURN_EXECUTOR = resolve(HERE, '../turn-executor.ts');

/**
 * How a compose site stands with respect to the persisted constraint verdict.
 *
 *   gated       — the text is projected through the verdict before compose.
 *   structural  — the text CANNOT name a leading option: it is deterministic
 *                 copy built from a template/constant that carries no
 *                 comparative claim about options at all.
 *   ungated     — an OPEN GAP. The text can carry analysis-derived or
 *                 LLM-authored prose and is NOT verdict-projected today.
 */
type VerdictStance = 'gated' | 'structural' | 'ungated';

/**
 * Every compose site in `turn-executor.ts`, keyed by the expression that
 * supplies its user-facing text.
 *
 * The stances were assigned by reading each site, not by pattern-matching the
 * variable name. Where a site is `ungated`, the reason says what could leak.
 */
interface RegisteredSite {
  readonly stance: VerdictStance;
  readonly why: string;
  /**
   * How many CALL SITES share this key. Defaults to 1.
   *
   * ⚠ LOAD-BEARING (A5). Keys are the EXPRESSION feeding `assistant_text`, and
   * several expressions repeat — `recoveryText` appears at three call sites,
   * `recoveryAssistantText` and `ambiguousAssistantText` at two each. 29 sites
   * collapse to 25 keys. Comparing SETS would let a NEW compose site that
   * happens to reuse a registered variable name slip in and silently inherit
   * that name's stance — the drift this file exists to catch, walking straight
   * past it. The comparison is therefore a MULTISET (key -> count).
   */
  readonly count?: number;
}

const COMPOSE_SITE_REGISTER: Readonly<Record<string, RegisteredSite>> = {
  // ── THE GATED SITE — this PR ────────────────────────────────────────────
  confirmationForCompose: {
    stance: 'gated',
    why: 'Execute path. Projected by projectExplanationAnswerForWithheldClaim when the handler is an explanation handler and the persisted verdict withholds. Covers BOTH the Sonnet-verbatim answer and the deterministic fallback, which also names the leader.',
  },

  // ── STRUCTURAL — deterministic copy with no comparative claim ───────────
  recoveryAssistantText: {
    stance: 'structural',
    count: 2,
    why: 'Bounded recovery copy from a constant builder (NOT the leader-serving buildBoundedFallbackCopyAndChips — verified separately).',
  },
  'buildGmHeldAppliedReceipt(': { stance: 'structural', why: 'Goal-metric receipt; names a metric, never an option ranking.' },
  receiptText: { stance: 'structural', why: 'Mutation receipt; describes the edit just applied.' },
  noPendingAssistantText: { stance: 'structural', why: 'Pending-action recovery template.' },
  '"The analysis is no longer fresh': { stance: 'structural', why: 'Literal staleness copy.' },
  expiredAssistantText: { stance: 'structural', why: 'Pending-expiry template.' },
  ambiguousAssistantText: {
    stance: 'structural',
    count: 2,
    why: 'Clarify copy built from candidate labels.',
  },
  '`I can apply those one at a time': { stance: 'structural', why: 'Literal one-at-a-time copy.' },
  PROPOSAL_DISMISSAL_RESPONSE: { stance: 'structural', why: 'Module constant.' },
  '`Got it: I can add ${riskLabel} as a risk with ${driverLabel} as its m': {
    stance: 'structural',
    why: 'Add-risk resume echo; interpolates two labels, makes no comparison.',
  },
  'buildDeicticClarifyAssistantText(deicticDispatch.reason)': { stance: 'structural', why: 'Clarify template.' },
  'buildNonFactorKindRefusalText(': { stance: 'structural', why: 'Refusal template.' },
  'buildClarifyAssistantText(deterministicValueUpdate.candidates)': { stance: 'structural', why: 'Clarify template.' },
  recoveryText: {
    stance: 'ungated',
    count: 3,
    why: "OPEN GAP, and NOT the 'bounded constant copy' an earlier revision of this register claimed. `buildBoundedFallbackCopyAndChips` (turn-executor.ts ~9700) calls composeExplainResultsFallback / composeWhatWouldFlipFallback whenever `projection?.leading_option` is present — i.e. it can serve the FULL deterministic leader answer, not a constant. Re-derived at the bytes after review flagged the sibling `assistantText` entry.",
  },
  clarifyGuardedText: { stance: 'structural', why: 'Clarify question, entity-guarded.' },
  assistantText: {
    stance: 'ungated',
    why: "OPEN GAP. Same helper as `recoveryText` — the finalise-path bounded fallback serves composeExplainResultsFallback's full leader answer on a routing degrade. Worse, this exit is reached on routing FAILURE, and `mayNameLeadingOptionForRun` is assigned only at the POST-HANDLER claim-safety read (declared `= true` at its outer-let), so a routing-failure exit hands the egress alarm `true`: no gate, no disclosure, and NO telemetry either. Pre-existing, NOT introduced by this PR — but the register previously called it `structural`, which converted an unknown gap into false assurance (CLAUDE.md trap #14). The fix is to hoist the claim-safety read to turn ENTRY so every exit carries the real permission; that is a SEPARATE slice, deliberately not widened into this PR.",
  },
  'noAnalysisOutcome.assistant_text': { stance: 'structural', why: 'Fires only when NO analysis exists — there is no leader to name.' },
  'staleOutcome.assistant_text': { stance: 'structural', why: 'Stale-rerun recovery; suppresses cached insights by construction.' },

  // ── UNGATED — OPEN GAPS, recorded not fixed in this slice ───────────────
  'coachGuarded.assistant_text': {
    stance: 'ungated',
    why: 'OPEN GAP. LLM-authored coach prose, composed from a ContextPack that carries analysis.leading_option / runner_up / margin_pp. Structurally the SAME defect as the one this PR fixes, on a sibling branch. Not induced by the POST-#711/#712 walk (which only reached the execute path), so it is UNVERIFIED rather than known-leaking.',
  },
  'converseGuarded.assistant_text': {
    stance: 'ungated',
    why: 'OPEN GAP. As coachGuarded above — the converse twin.',
  },
  'runComparisonOutcome.assistant_text': {
    stance: 'ungated',
    why: 'OPEN GAP. Narrates a BEFORE/AFTER analysis comparison, i.e. explicitly about which option came out where.',
  },
  'adviceOutcome.assistant_text': {
    stance: 'ungated',
    why: 'OPEN GAP. Post-analysis advice gate; composes from the analysis projection.',
  },
  'freshFollowupOutcome.assistant_text': {
    stance: 'ungated',
    why: 'OPEN GAP. Fresh-analysis follow-up; composes from the analysis projection.',
  },
  'stateQueryOutcome.assistant_text': {
    stance: 'ungated',
    why: 'OPEN GAP. State-query guard; can describe the current analysis state.',
  },
};

/** Count occurrences per key — the multiset the assertions compare. */
function tally(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/** The register as a multiset, defaulting an absent `count` to 1. */
function registerTally(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(COMPOSE_SITE_REGISTER)) out[k] = v.count ?? 1;
  return out;
}

/** Enumerate compose calls and the expression feeding their user-facing text. */
function enumerateComposeSites(source: string): string[] {
  const keys: string[] = [];
  const pattern = /compose(?:Answer|ToolCallResponse|ClarifyResponse|DirectAnswerResponse)\(\{/g;
  for (const m of source.matchAll(pattern)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const span = source.slice(open, j + 1);
    const arg = /(?:assistant_text|confirmation):\s*([^\n,]+)/.exec(span);
    keys.push(arg ? arg[1]!.trim().slice(0, 70) : 'UNPARSEABLE');
  }
  return keys;
}

describe('LAYER 2 drift — every compose site declares a verdict stance', () => {
  const source = readFileSync(TURN_EXECUTOR, 'utf8');

  it('the MULTISET of compose sites in source EXACTLY equals the register', () => {
    const found = tally(enumerateComposeSites(source));
    const registered = registerTally();

    // Both directions, and by COUNT not just presence. A NEW compose site is
    // the drift this file exists for; a STALE entry means the register kept a
    // reassuring line about code that no longer exists; a COUNT change means a
    // site was added or removed under an existing name — the case a set
    // comparison is blind to.
    expect(
      found,
      'compose-site drift in turn-executor.ts. A path that emits assistant_text ' +
        'must declare whether it consumes the persisted constraint verdict — see ' +
        'compose/withheld-explanation-answer.ts. This is the third instance of ' +
        'that omission; do not make it the fourth. (A count mismatch means a site ' +
        'was added or removed under an ALREADY-REGISTERED expression name, which ' +
        'would otherwise inherit that name\'s stance silently.)',
    ).toEqual(registered);
  });

  it('POSITIVE CONTROL: a duplicate-NAME site is caught (the set-comparison blind spot)', () => {
    // The A5 defect, pinned. Plant a second call site reusing an ALREADY
    // REGISTERED expression. Under a set comparison this is invisible — the key
    // is already present. Under the multiset it must show as a count change.
    const planted = `${source}\n composeAnswer({ assistant_text: clarifyGuardedText, stage: 'analyse' });`;
    const found = tally(enumerateComposeSites(planted));
    expect(Object.keys(found)).toEqual(expect.arrayContaining(['clarifyGuardedText']));
    expect(found['clarifyGuardedText']).toBe((registerTally()['clarifyGuardedText'] ?? 0) + 1);
    expect(found).not.toEqual(registerTally());
  });

  it('never parses a compose site it cannot key (the scan is not silently blind)', () => {
    // TESTING-DISCIPLINE rule 2: an instrument that returns the same answer for
    // "clean" and "could not look" is not an instrument. UNPARSEABLE would sail
    // through the set comparison as a single benign-looking key.
    expect(enumerateComposeSites(source)).not.toContain('UNPARSEABLE');
  });

  it('POSITIVE CONTROL: the detector SEES a newly-added compose site', () => {
    // Proves the assertion above can fail. Without this, a broken regex would
    // report an empty diff and read as a pass on every future change.
    const planted = `${source}\n composeAnswer({ assistant_text: totallyNewLeakySite, stage: 'analyse' });`;
    const found = enumerateComposeSites(planted);
    expect(found).toContain('totallyNewLeakySite');
    expect(Object.keys(COMPOSE_SITE_REGISTER)).not.toContain('totallyNewLeakySite');
  });

  it('records the OPEN GAPS explicitly, so the residue is a list and not a surprise', () => {
    const ungated = Object.entries(COMPOSE_SITE_REGISTER)
      .filter(([, v]) => v.stance === 'ungated')
      .map(([k]) => k)
      .sort();

    // This is a LEDGER, not a target. It is pinned so that closing a gap is a
    // deliberate edit here (with the count going DOWN), and so that silently
    // adding a tenth ungated site fails CI.
    expect(ungated).toEqual([
      'adviceOutcome.assistant_text',
      // A2: re-derived from 'structural' after review. Both are
      // buildBoundedFallbackCopyAndChips, which serves the deterministic
      // LEADER answer whenever a projection with a leading_option exists.
      'assistantText',
      'coachGuarded.assistant_text',
      'converseGuarded.assistant_text',
      'freshFollowupOutcome.assistant_text',
      'recoveryText',
      'runComparisonOutcome.assistant_text',
      'stateQueryOutcome.assistant_text',
    ]);
  });

  it('the site this PR gated is registered GATED and really is projected in source', () => {
    expect(COMPOSE_SITE_REGISTER['confirmationForCompose']!.stance).toBe('gated');
    // Non-vacuity: the register's claim is checked against the source, so a
    // future revert of the gate turns this red rather than leaving a register
    // entry asserting a protection that no longer exists.
    expect(source).toContain('projectExplanationAnswerForWithheldClaim(');
    expect(source).toContain('confirmation: confirmationForCompose,');
  });
});
