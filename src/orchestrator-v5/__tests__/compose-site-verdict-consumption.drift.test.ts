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
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ ENUMERATOR SCOPE — WIDENED 2026-07-27, BECAUSE THE SCOPE WAS ITSELF A HOLE.
 *
 * This file previously scanned `turn-executor.ts` ONLY. That is not a detail:
 * the assertion this file is best known for is `expect(ungated).toEqual([])`,
 * and a reader who takes "0 ungated" as "no ungated compose site in CEE" is
 * reading a number that was silently scoped to one file. The anti-drift
 * instrument had the drift-shaped defect it exists to catch
 * (`WALK-2026-07-27-FINAL.md` §11.6).
 *
 * NOW SCANNED, and the register is keyed by FILE so the scope is visible in the
 * data rather than asserted in a comment:
 *   - `src/orchestrator-v5/turn-executor.ts`  — 29 sites / 25 keys
 *   - `src/orchestrator/route-v2.ts`          —  2 sites /  2 keys  (NEW)
 *
 * STILL OUT OF SCOPE, with the count DERIVED so the next reader inherits a
 * number instead of a shrug: `src/orchestrator-v5/handlers/chip-click-dispatch.ts`
 * has **3** compose sites (two literal failure strings, plus `confirmationText`,
 * which forwards the run_analysis handler's own allowlisted headline and whose
 * stance needs a derivation of `isAllowedRunAnalysisAssistantText` that this
 * slice did not do). That is a KNOWN GAP, not a covered surface, and it is the
 * next widening.
 *
 * The four scanned function names are unchanged: `composeAnswer`,
 * `composeToolCallResponse`, `composeClarifyResponse`,
 * `composeDirectAnswerResponse`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ AND IT IS DELIBERATELY NOT ALL-GREEN-MEANS-SAFE. Eight of the twenty-five
 * turn-executor keys were `ungated` when this file was written, several carrying
 * LLM-authored or analysis-derived prose. ROADMAP 1.233 + 1.231 closed all
 * eight; the empty ledger is PINNED rather than deleted, because an empty
 * assertion is what makes the ninth fail CI the day someone adds one. `ungated`
 * is a TODO, not a blessing (TESTING-DISCIPLINE rule 6: a stated limit is a
 * to-do, not a hedge).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TURN_EXECUTOR = resolve(HERE, '../turn-executor.ts');

/**
 * Every file the enumerator scans, keyed by the label the register uses. Adding
 * a file here without registering its sites fails the multiset assertion — which
 * is the correct direction: widening the scan must never be able to widen it
 * silently.
 */
const SCANNED_FILES: Readonly<Record<string, string>> = {
  'turn-executor.ts': TURN_EXECUTOR,
  'route-v2.ts': resolve(HERE, '../../orchestrator/route-v2.ts'),
};

/** The module the scan does NOT cover yet, and the count it would add. */
const KNOWN_UNSCANNED = {
  file: resolve(HERE, '../handlers/chip-click-dispatch.ts'),
  label: 'handlers/chip-click-dispatch.ts',
  siteCount: 3,
} as const;

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

const TURN_EXECUTOR_SITES: Readonly<Record<string, RegisteredSite>> = {
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
    stance: 'gated_by_input',
    why: "ROADMAP 1.231 (A1's ruling: gate the input, not the output). Verbatim / sanitise-stripped LLM prose — there is no deterministic path to a leader here, so the leader can only arrive via what the model was GIVEN. Confirmed live-leaking by the POST-#713 walk (§7: 3/3 non-execute turns named the leader, one with a probability and no disclosure). Closed by stripping `leading_option` / `runner_up` / `margin` AND the ranked `options` table from the model-facing `display_analysis` on withheld turns. ⚠ THE ADDRESS MATTERS: the ruling named context-pack-assembler.ts:1533, but `buildUserMessage` (route-with-tool-use.ts:1185-1208) drops the raw `analysis` and re-keys `display_analysis` under that name, so gating :1533 alone would have left the model's actual view untouched. See context/withheld-leader-projection.ts.",
  },
  'converseGuarded.assistant_text': {
    stance: 'gated_by_input',
    why: 'As coachGuarded above — the converse twin, same closure, same input gate.',
  },
};

/**
 * `src/orchestrator/route-v2.ts` — brought into scope 2026-07-27.
 *
 * Both sites are module-level string CONSTANTS with no interpolation, so
 * `structural` here is a derivation and not an inspection: there is no
 * expression that could carry an option label, let alone a comparison. The
 * non-vacuity check below pins each literal against its own source, so a future
 * edit that turns either into a template fails THIS test rather than shipping
 * under a register entry still claiming it is safe (CLAUDE.md trap #14 — the
 * honest label overwritten by a false one).
 */
const ROUTE_V2_SITES: Readonly<Record<string, RegisteredSite>> = {
  EDIT_GRAPH_RECOVERY_TEXT: {
    stance: 'structural',
    why: "Module constant (route-v2.ts:1553), exported, zero interpolation: \"I can see you want to update the model, but I couldn't access the current graph…\". An edit-graph recovery notice — it never reaches an analysis, and there is no expression in it to carry one.",
  },
  NO_LIVE_PROPOSAL_TEXT: {
    stance: 'structural',
    why: 'Module constant (route-v2.ts:1853), zero interpolation: "I don\'t have a pending suggested update to apply…". Fires when no live proposal exists; names no option and makes no comparison.',
  },
};

/**
 * The register, KEYED BY FILE. The nesting is the scope statement: a reader of
 * the `ungated` ledger can see exactly which files it speaks for, instead of
 * inferring it from a comment that can go stale (which is what happened).
 */
const COMPOSE_SITE_REGISTER: Readonly<Record<string, Readonly<Record<string, RegisteredSite>>>> = {
  'turn-executor.ts': TURN_EXECUTOR_SITES,
  'route-v2.ts': ROUTE_V2_SITES,
};

/** Count occurrences per key — the multiset the assertions compare. */
function tally(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/**
 * Tally keys are `file::expression`, never the bare expression.
 *
 * Load-bearing for the same reason the multiset is (A5): two files can define
 * the same expression name — `recoveryText` is not an unusual identifier — and a
 * bare-key comparison would let a site in a NEWLY scanned file inherit the
 * stance recorded for an identically-named site in another. Qualifying the key
 * makes that impossible by construction rather than by nobody happening to
 * choose the same name.
 */
function qualify(file: string, key: string): string {
  return `${file}::${key}`;
}

/** The register as a multiset, defaulting an absent `count` to 1. */
function registerTally(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [file, sites] of Object.entries(COMPOSE_SITE_REGISTER)) {
    for (const [k, v] of Object.entries(sites)) out[qualify(file, k)] = v.count ?? 1;
  }
  return out;
}

/** Enumerate every scanned file, qualified. */
function enumerateAllScannedSites(
  sources: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const key of enumerateComposeSites(source)) out.push(qualify(file, key));
  }
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
  const sources: Record<string, string> = Object.fromEntries(
    Object.entries(SCANNED_FILES).map(([label, path]) => [label, readFileSync(path, 'utf8')]),
  );

  it('the MULTISET of compose sites in source EXACTLY equals the register', () => {
    const found = tally(enumerateAllScannedSites(sources));
    const registered = registerTally();

    // Both directions, and by COUNT not just presence. A NEW compose site is
    // the drift this file exists for; a STALE entry means the register kept a
    // reassuring line about code that no longer exists; a COUNT change means a
    // site was added or removed under an existing name — the case a set
    // comparison is blind to.
    expect(
      found,
      'compose-site drift in a SCANNED file (see SCANNED_FILES). A path that emits ' +
        'assistant_text must declare whether it consumes the persisted constraint ' +
        'verdict — see compose/withheld-explanation-answer.ts. This is the third ' +
        'instance of that omission; do not make it the fourth. (A count mismatch ' +
        'means a site was added or removed under an ALREADY-REGISTERED expression ' +
        "name, which would otherwise inherit that name's stance silently.)",
    ).toEqual(registered);
  });

  it('the scan really covers route-v2.ts, and route-v2.ts really has sites', () => {
    // TESTING-DISCIPLINE rule 2 applied to the WIDENING itself. Adding a file to
    // SCANNED_FILES that the enumerator finds nothing in would widen the scope
    // on paper and change no measurement — the shape of a control that decays
    // into a tautology (CLAUDE.md trap 12b). Pin that route-v2.ts contributes
    // real, non-zero sites, so deleting them (or breaking the scan for that
    // file) turns this red rather than reading as a clean widening.
    const routeV2Keys = enumerateComposeSites(sources['route-v2.ts']!);
    expect(routeV2Keys.length).toBeGreaterThan(0);
    expect(routeV2Keys.sort()).toEqual(['EDIT_GRAPH_RECOVERY_TEXT', 'NO_LIVE_PROPOSAL_TEXT']);
  });

  it('names the surface it still does NOT cover, with a derived count', () => {
    // The scope hole this widening only PARTLY closed, pinned as a number rather
    // than left in prose. If chip-click-dispatch grows or loses a compose site,
    // this fails and the next reader is told the register's ledger just changed
    // meaning — instead of the count quietly drifting inside a docstring, which
    // is exactly how the turn-executor-only scope survived three walks.
    const unscanned = enumerateComposeSites(readFileSync(KNOWN_UNSCANNED.file, 'utf8'));
    expect(unscanned).not.toContain('UNPARSEABLE');
    expect(
      unscanned.length,
      `${KNOWN_UNSCANNED.label} is a KNOWN-UNSCANNED surface. Its site count changed, ` +
        "so the register's `ungated: []` ledger now speaks for a different share of " +
        'CEE than it did. Either widen SCANNED_FILES and register the sites, or update ' +
        'this number deliberately.',
    ).toBe(KNOWN_UNSCANNED.siteCount);
    expect(Object.keys(SCANNED_FILES)).not.toContain(KNOWN_UNSCANNED.label);
  });

  it('POSITIVE CONTROL: a duplicate-NAME site is caught (the set-comparison blind spot)', () => {
    // The A5 defect, pinned. Plant a second call site reusing an ALREADY
    // REGISTERED expression. Under a set comparison this is invisible — the key
    // is already present. Under the multiset it must show as a count change.
    const planted = `${source}\n composeAnswer({ assistant_text: clarifyGuardedText, stage: 'analyse' });`;
    const key = qualify('turn-executor.ts', 'clarifyGuardedText');
    const found = tally(enumerateAllScannedSites({ ...sources, 'turn-executor.ts': planted }));
    expect(Object.keys(found)).toEqual(expect.arrayContaining([key]));
    expect(found[key]).toBe((registerTally()[key] ?? 0) + 1);
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
    expect(Object.keys(registerTally())).not.toContain(
      qualify('turn-executor.ts', 'totallyNewLeakySite'),
    );
  });

  it('records the OPEN GAPS explicitly, so the residue is a list and not a surprise', () => {
    const ungated: string[] = [];
    for (const [file, sites] of Object.entries(COMPOSE_SITE_REGISTER)) {
      for (const [k, v] of Object.entries(sites)) {
        if (v.stance === 'ungated') ungated.push(qualify(file, k));
      }
    }
    ungated.sort();

    // ROADMAP 1.233 + 1.231 closed all eight. This stays pinned as an EMPTY
    // ledger rather than being deleted: an empty assertion is what makes the
    // NINTH ungated site fail CI the day someone adds one. A deleted test
    // would let it in silently — which is the whole defect class this file is
    // about.
    //
    // ⚠ READ THE SCOPE WITH THE NUMBER. This `[]` now speaks for turn-executor.ts
    // AND route-v2.ts — 31 sites / 27 keys — and NOT for
    // handlers/chip-click-dispatch.ts (3 sites, pinned above). Before 2026-07-27
    // it spoke for one file and said so nowhere.
    expect(ungated).toEqual([]);
  });

  it('the ledger covers the surface it claims to — counts, derived', () => {
    // The number behind the `[]`, pinned so "0 ungated" can never again be read
    // as covering more than it measures. Both figures are DERIVED from source on
    // every run; only the expectation is written down.
    const sites = enumerateAllScannedSites(sources);
    expect(sites.length, 'total compose SITES across every scanned file').toBe(31);
    expect(Object.keys(registerTally()).length, 'distinct file::expression KEYS').toBe(27);
    expect(Object.keys(COMPOSE_SITE_REGISTER).sort()).toEqual([
      'route-v2.ts',
      'turn-executor.ts',
    ]);
  });

  it('the EXECUTE-path gate is registered GATED and really is projected in source', () => {
    expect(TURN_EXECUTOR_SITES['confirmationForCompose']!.stance).toBe('gated');
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
      expect(TURN_EXECUTOR_SITES[site]!.stance, `${site} must be registered gated`).toBe('gated');
      expect(source, `${site}: the gate this register claims is absent from source`).toContain(
        fragment,
      );
    }
  });

  it('every STRUCTURAL-by-derivation site still IS structural in its own source', () => {
    // F6 (Fable review of #716). Two sites were re-derived from `ungated` to
    // `structural` in this train. They are correct TODAY, and nothing was
    // stopping them drifting: if RECAP_TEXT grew an interpolation, or the
    // state-query guard's `Pick` widened to the whole ContextPack, the register
    // would keep asserting a safety property the code no longer had — the
    // honest-label-overwritten-by-a-false-one failure (CLAUDE.md trap #14),
    // which is exactly what these two entries were CORRECTING.
    //
    // Same shape as the gated-site evidence check: one required source fragment
    // per claim, chosen so that removing the property makes THIS test red.
    const STRUCTURAL_EVIDENCE: ReadonlyArray<readonly [string, string, string]> = [
      [
        'freshFollowupOutcome.assistant_text',
        '../routing/fresh-analysis-followup-guard.ts',
        // The matched branch returns the constant — no template literal, no
        // interpolation. An interpolated variant would not contain this.
        'assistant_text: RECAP_TEXT,',
      ],
      [
        'stateQueryOutcome.assistant_text',
        '../routing/state-query-guard.ts',
        // The strongest form of the claim: the analysis is out of reach BY TYPE.
        "readonly contextPack: Pick<ContextPack, 'recent_changes'>;",
      ],
    ];
    for (const [site, rel, fragment] of STRUCTURAL_EVIDENCE) {
      expect(TURN_EXECUTOR_SITES[site]!.stance, `${site} must be registered structural`).toBe(
        'structural',
      );
      const guardSource = readFileSync(resolve(HERE, rel), 'utf8');
      expect(
        guardSource,
        `${site}: the register claims this site is structural, but the property ` +
          'it rests on is no longer in the guard source',
      ).toContain(fragment);
    }
  });

  it('POSITIVE CONTROL: the structural evidence check can FAIL', () => {
    // Rule 2 — prove the `toContain` above discriminates rather than passing on
    // any file it is handed.
    const guardSource = readFileSync(resolve(HERE, '../routing/fresh-analysis-followup-guard.ts'), 'utf8');
    expect(guardSource).toContain('assistant_text: RECAP_TEXT,');
    // The drift this pin exists to catch: RECAP_TEXT gaining an interpolation.
    const drifted = guardSource.replace(
      'assistant_text: RECAP_TEXT,',
      'assistant_text: `${RECAP_TEXT} ${leadingLabel}`,',
    );
    expect(drifted).not.toContain('assistant_text: RECAP_TEXT,');
  });

  it('every GATED_BY_INPUT site is backed by a real input gate at the assembly seam', () => {
    const byInput: string[] = [];
    for (const [file, sites] of Object.entries(COMPOSE_SITE_REGISTER)) {
      for (const [k, v] of Object.entries(sites)) {
        if (v.stance === 'gated_by_input') byInput.push(qualify(file, k));
      }
    }
    byInput.sort();
    expect(byInput).toEqual([
      qualify('turn-executor.ts', 'coachGuarded.assistant_text'),
      qualify('turn-executor.ts', 'converseGuarded.assistant_text'),
    ]);
    // Non-vacuity, same rationale as the gated check above. `gated_by_input`
    // asserts something about the PACK, so the evidence is the projection call
    // at the assembly seam — not the compose site, which by definition has no
    // gate of its own.
    expect(source).toContain('projectDisplayAnalysisForWithheldClaim(');
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
