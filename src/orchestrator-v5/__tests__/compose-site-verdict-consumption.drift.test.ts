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
 *   gated          — the site CONSUMES the verdict itself, on the OUTPUT side:
 *                    it composes leader text from structured data in code, so
 *                    it must read `mayNameLeadingOption` and suppress.
 *   gated_by_input — the site emits LLM-authored prose, and the verdict is
 *                    applied to the MODEL'S INPUT instead (ROADMAP 1.231): the
 *                    leader-designating fields are stripped from the
 *                    ContextPack's model-facing `display_analysis`, so the
 *                    model cannot name a leader it never sees. There is no
 *                    output-side scrub on these sites BY DESIGN — scrubbing
 *                    conversational prose risks the over-suppression failure
 *                    the acceptance criteria weight equally with the leak.
 *   structural     — the text CANNOT name a leading option: it is deterministic
 *                    copy built from a template/constant that carries no
 *                    comparative claim about options at all.
 *   ungated        — an OPEN GAP. The text can carry analysis-derived or
 *                    LLM-authored prose and is NOT verdict-projected today.
 *
 * ⚠ `gated_by_input` IS A WEAKER GUARANTEE THAN `gated`, and the distinction is
 * kept rather than collapsed for that reason. `gated` is a code path that
 * cannot emit the claim. `gated_by_input` is "the model was not given the
 * facts", which is strong against fabrication-from-data and NOT a proof about
 * every other channel the model can read (conversation history above all — a
 * leader named in an EARLIER turn's assistant message is still in the window).
 * That residual is stated in ROADMAP 1.231 rather than papered over here.
 */
type VerdictStance = 'gated' | 'gated_by_input' | 'structural' | 'ungated';

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
  clarifyGuardedText: { stance: 'structural', why: 'Clarify question, entity-guarded.' },
  'noAnalysisOutcome.assistant_text': { stance: 'structural', why: 'Fires only when NO analysis exists — there is no leader to name.' },
  'staleOutcome.assistant_text': { stance: 'structural', why: 'Stale-rerun recovery; suppresses cached insights by construction.' },
  'freshFollowupOutcome.assistant_text': {
    stance: 'structural',
    why: "RE-DERIVED at the bytes from 'ungated' (ROADMAP 1.233 lane). The prior entry said it 'composes from the analysis projection'; it does not. `tryFreshAnalysisFollowupGuard`'s input type is `{message, readiness}` — no analysis reaches it — and its matched branch returns `assistant_text: RECAP_TEXT`, a module constant with ZERO interpolation (fresh-analysis-followup-guard.ts:172, :274). Structural by construction, not by inspection.",
  },
  'stateQueryOutcome.assistant_text': {
    stance: 'structural',
    why: "RE-DERIVED at the bytes from 'ungated' (ROADMAP 1.233 lane), and structural in the STRONGEST sense: the analysis projection is out of reach BY TYPE. `TryStateQueryGuardInput.contextPack` is `Pick<ContextPack, 'recent_changes'>` (state-query-guard.ts:267-270), so the guard cannot read `analysis` / `display_analysis` at all. Its two outputs are `NO_RECENT_CHANGES_TEXT` (constant, :354) and `composeRecentChangeAnswer` = `${head.summary}${tail}` (:337), where `head.summary` is a persisted MUTATION receipt (factor / constraint labels and values). A receipt may name an entity; it makes no comparison between options, which is the same standard the sibling add-risk echo entry is held to.",
  },

  // ── GATED — sites that compose leader text from STRUCTURED data in code,
  //    and therefore consume the verdict themselves. Input gating cannot help
  //    these: there is no model to withhold the leader from. ─────────────────
  recoveryText: {
    stance: 'gated',
    count: 3,
    why: 'ROADMAP 1.233. `buildBoundedFallbackCopyAndChips` (turn-executor.ts ~9700) calls composeExplainResultsFallback / composeWhatWouldFlipFallback whenever a projection with a `leading_option` exists — the FULL deterministic leader answer, not a constant. Now guarded by `mayNameLeadingOptionForRun && projection?.leading_option`; withheld ⇒ falls through to the bounded copy, which makes no comparative claim. All three call sites share the one helper, so they are one gap and one fix.',
  },
  assistantText: {
    stance: 'gated',
    why: "ROADMAP 1.233. Same helper as `recoveryText`, so gated by the same conjunct. This entry also carried the register's own account of WHY the hoist was needed, and that account is now discharged: the exit is reached on routing FAILURE, and `mayNameLeadingOptionForRun` used to be assigned only at the post-handler claim-safety read (declared `= true` at its outer-let), so a routing-degrade turn shipped the deterministic leader answer with no gate, no disclosure, and a `true` permission that made the Layer-3 alarm a licensed no-op. The read is now HOISTED to turn entry, so every exit carries the real permission.",
  },
  'runComparisonOutcome.assistant_text': {
    stance: 'gated',
    why: 'ROADMAP 1.233. Zero LLM calls: `composeComparison` builds "The leading option has changed. X came out ahead before, and Y now leads." and the margin sentences straight from the two runs\' persisted enrichment. `tryRunComparisonGate` now takes a REQUIRED `mayNameLeadingOption` (required, not optional-defaulting-true, so a new call site cannot re-open the leak by omission) and suppresses the ordering + margin sentences while KEEPING the robustness-band shift and the driver-influence mover, which rank nothing and are the substance of "what changed?".',
  },
  'adviceOutcome.assistant_text': {
    stance: 'gated',
    why: "ROADMAP 1.233 — the sharpest of the eight. Zero LLM calls, and it reads the RAW handler-facing `contextPack.analysis` to compose \"Based on this model, the analysis currently favours ${leadingLabel}${probability}\" and \"It sits ahead of ${runnerLabel} by ${margin}\" — the exact sentence pair the POST-#713 walk captured live on a withheld scenario (case5.clarify, §7, with NO disclosure). Gated on the gate's INPUT, not by listing the leader-naming advice classes: the class list is a hand-maintained mirror (trap #12) and a class added later would inherit 'safe' silently. A null-leader projection makes the gate's own `evaluateAvailability` decline every class declaring `needs_leading_option` — including ones that do not exist yet — while readiness / evidence-gap classes keep serving.",
  },

  // ── GATED BY INPUT — LLM-authored prose; the verdict is applied to the
  //    model's view of the analysis instead (ROADMAP 1.231). ────────────────
  'coachGuarded.assistant_text': {
    stance: 'ungated',
    why: "ROADMAP 1.231 (A1's ruling: gate the input, not the output). Verbatim / sanitise-stripped LLM prose — there is no deterministic path to a leader here, so the leader can only arrive via what the model was GIVEN. Confirmed live-leaking by the POST-#713 walk (§7: 3/3 non-execute turns named the leader, one with a probability and no disclosure). Closed by stripping `leading_option` / `runner_up` / `margin` AND the ranked `options` table from the model-facing `display_analysis` on withheld turns. ⚠ THE ADDRESS MATTERS: the ruling named context-pack-assembler.ts:1533, but `buildUserMessage` (route-with-tool-use.ts:1185-1208) drops the raw `analysis` and re-keys `display_analysis` under that name, so gating :1533 alone would have left the model's actual view untouched. See context/withheld-leader-projection.ts.",
  },
  'converseGuarded.assistant_text': {
    stance: 'ungated',
    why: 'As coachGuarded above — the converse twin, same closure, same input gate.',
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

    // ROADMAP 1.233 + 1.231 closed all eight. This stays pinned as an EMPTY
    // ledger rather than being deleted: an empty assertion is what makes the
    // NINTH ungated site fail CI the day someone adds one. A deleted test
    // would let it in silently — which is the whole defect class this file is
    // about.
    // 1.233 closed six of the eight. The two remaining are the LLM-authored
    // coach/converse pair, closed by the sibling input-gate commit (1.231).
    expect(ungated).toEqual([
      'coachGuarded.assistant_text',
      'converseGuarded.assistant_text',
    ]);
  });

  it('the EXECUTE-path gate is registered GATED and really is projected in source', () => {
    expect(COMPOSE_SITE_REGISTER['confirmationForCompose']!.stance).toBe('gated');
    // Non-vacuity: the register's claim is checked against the source, so a
    // future revert of the gate turns this red rather than leaving a register
    // entry asserting a protection that no longer exists.
    expect(source).toContain('projectExplanationAnswerForWithheldClaim(');
    expect(source).toContain('confirmation: confirmationForCompose,');
  });

  it('every GATED site really consumes the verdict in source (non-vacuity, per site)', () => {
    // TESTING-DISCIPLINE rule 1 + CLAUDE.md trap #14: a register entry that
    // ASSERTS a protection is worth nothing unless the assertion is checked
    // against the code. Without this, reverting any one of these gates would
    // leave a green suite and a register still claiming the site is safe —
    // the precise shape of "an honest label overwritten by a false one".
    //
    // One required source fragment per gated site, chosen to be the line the
    // gate actually turns on, so deleting the gate makes THIS test red.
    const GATE_EVIDENCE: Readonly<Record<string, string>> = {
      // buildBoundedFallbackCopyAndChips — serves recoveryText ×3 + assistantText
      recoveryText: 'if (mayNameLeadingOptionForRun && projection?.leading_option) {',
      assistantText: 'if (mayNameLeadingOptionForRun && projection?.leading_option) {',
      'runComparisonOutcome.assistant_text': 'mayNameLeadingOption: mayNameLeadingOptionForRun,',
      'adviceOutcome.assistant_text': 'projectContextPackAnalysisForWithheldClaim(contextPack.analysis)',
    };
    for (const [site, fragment] of Object.entries(GATE_EVIDENCE)) {
      expect(COMPOSE_SITE_REGISTER[site]!.stance, `${site} must be registered gated`).toBe('gated');
      expect(source, `${site}: the gate this register claims is absent from source`).toContain(
        fragment,
      );
    }
  });

  it('POSITIVE CONTROL: the per-site gate evidence check can FAIL', () => {
    // Rule 2 — an instrument that returns the same answer for "gated" and
    // "could not look" is not an instrument. Prove the `toContain` above
    // discriminates, by running it against a source with the gate removed.
    const gate = 'if (mayNameLeadingOptionForRun && projection?.leading_option) {';
    expect(source).toContain(gate);
    const reverted = source.replace(gate, 'if (projection?.leading_option) {');
    expect(reverted).not.toContain(gate);
    // And the mutation is real: the reverted source is the PRE-1.233 shape.
    expect(reverted).toContain('if (projection?.leading_option) {');
  });

  it('the claim-safety read is HOISTED, not post-handler only (ROADMAP 1.233)', () => {
    // The load-bearing structural claim of 1.233, pinned against source: the
    // permission is initialised from the persisted verdict at the DECLARATION,
    // so every early exit carries it. A revert to `= true` fails here.
    expect(source).toContain(
      'let mayNameLeadingOptionForRun = readMayNameLeadingOptionForFacts(context.prior_facts);',
    );
    expect(source).not.toContain('let mayNameLeadingOptionForRun = true;');
  });
});
