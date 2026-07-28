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
 *   - `src/orchestrator-v5/turn-executor.ts`              — 29 sites / 25 keys
 *   - `src/orchestrator/route-v2.ts`                      —  2 sites /  2 keys
 *   - `src/orchestrator-v5/handlers/chip-click-dispatch.ts` — 3 sites / 3 keys (NEW 2026-07-27)
 *   - `src/orchestrator-v5/compose/edit-clarify-response.ts`  —  1 site  /  1 key  (NEW 1.276)
 *   - `src/orchestrator-v5/routing/post-analysis-label-intercept.ts` — 1 / 1 (NEW 1.276)
 *
 * 36 sites / 32 keys / 5 files, and `UNSCANNED_COMPOSE_FILES` is now EMPTY —
 * so `expect(ungated).toEqual([])` finally speaks for every production compose
 * site in `src/`, by derivation rather than by scope nobody had written down.
 *
 * The four scanned function names are unchanged: `composeAnswer`,
 * `composeToolCallResponse`, `composeClarifyResponse`,
 * `composeDirectAnswerResponse`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ AND THE SCOPE STATEMENT ITSELF IS NOW DERIVED — BECAUSE THE HAND-WRITTEN
 * ONE WAS WRONG THE DAY IT WAS WRITTEN.
 *
 * The previous revision named `handlers/chip-click-dispatch.ts` as THE surface
 * still out of scope, pinned its site count, and left the reader with "widen
 * this one file and the ledger speaks for all of CEE". That was false. A walk
 * of `src/` for the enumerator's OWN pattern finds FIVE non-test files with
 * compose sites, not three — `compose/edit-clarify-response.ts` and
 * `routing/post-analysis-label-intercept.ts` were named nowhere, by anything.
 *
 * So the hand-chosen domain was doing exactly what CLAUDE.md trap #12 says a
 * hand-maintained mirror does, one level ABOVE the register: the register's own
 * scope was a list a human had to remember to sync, and the drift read as green
 * ("0 ungated", "1 file left"). Widening the scan by one file would have
 * REPLACED that defect rather than removed it.
 *
 * {@link derivedComposeFileDomain} now walks `src/` and derives the complete
 * file set from source on every run. `SCANNED_FILES` ∪ {@link
 * UNSCANNED_COMPOSE_FILES} must equal it EXACTLY, so a new production file
 * containing a compose call fails THIS test on the commit that adds it — it can
 * no longer be invisible, whichever of the two lists it belongs in.
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
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve, sep } from 'node:path';

import { MAY_NAME_LEADING_OPTION } from '../../orchestrator/context/constraint-feasibility.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TURN_EXECUTOR = resolve(HERE, '../turn-executor.ts');
/** `src/` — the root of the derived file domain below. */
const SRC_ROOT = resolve(HERE, '../..');

/**
 * Every file the enumerator scans, keyed by the label the register uses. Adding
 * a file here without registering its sites fails the multiset assertion — which
 * is the correct direction: widening the scan must never be able to widen it
 * silently.
 */
const SCANNED_FILES: Readonly<Record<string, string>> = {
  'turn-executor.ts': TURN_EXECUTOR,
  'route-v2.ts': resolve(HERE, '../../orchestrator/route-v2.ts'),
  'handlers/chip-click-dispatch.ts': resolve(HERE, '../handlers/chip-click-dispatch.ts'),
  // ROADMAP 1.276 — the two files `derivedComposeFileDomain()` surfaced on its
  // first run and that nothing had ever named. Both now carry a DERIVED stance;
  // `UNSCANNED_COMPOSE_FILES` is consequently empty, which is the strongest
  // form of this register's claim: no production compose site in `src/` is
  // outside the scan.
  'compose/edit-clarify-response.ts': resolve(HERE, '../compose/edit-clarify-response.ts'),
  'routing/post-analysis-label-intercept.ts': resolve(
    HERE,
    '../routing/post-analysis-label-intercept.ts',
  ),
  // ROADMAP 1.346 — the value-carrying inspector edit's compose site.
  'system-events/factor-value-edit.ts': resolve(HERE, '../system-events/factor-value-edit.ts'),
};

/**
 * The production files that contain compose sites and are STILL NOT SCANNED.
 *
 * This list is NOT the scope statement — {@link derivedComposeFileDomain} is.
 * This is the declared REMAINDER, and the domain test below proves the two
 * lists together are exhaustive. A file may sit here only while someone has
 * looked at it and written down what it costs; it may not sit here by having
 * been forgotten, because a forgotten file is in neither list and fails.
 */
const UNSCANNED_COMPOSE_FILES: Readonly<
  Record<string, { readonly siteCount: number; readonly keyable: boolean; readonly why: string }>
> = {
  // ⭐ EMPTY AS OF 2026-07-27 (ROADMAP 1.276), AND THE EMPTINESS IS THE POINT.
  //
  // Both former entries have been derived and registered:
  //
  //   - `routing/post-analysis-label-intercept.ts` was declared keyable but
  //     left UNREGISTERED on the explicit grounds that "this file exists to
  //     stop stances being assigned by inspection-at-a-glance". It now carries
  //     a derived stance with its evidence — see POST_ANALYSIS_LABEL_INTERCEPT_SITES.
  //   - `compose/edit-clarify-response.ts` was declared UNPARSEABLE because the
  //     key regex required `assistant_text:` and the site uses the ES6
  //     shorthand `assistant_text,`. That was an INSTRUMENT limitation, not a
  //     property of the code, and the instrument has been widened rather than
  //     the file excused. See EDIT_CLARIFY_SITES.
  //
  // The mechanism stays even though the list is empty: this is the declared
  // REMAINDER, and the domain test below proves SCANNED_FILES ∪ this === the
  // derived domain. An empty remainder therefore asserts something strictly
  // stronger than "we looked at everything we remembered" — it asserts, by
  // derivation, that no production compose site in `src/` is unscanned. A file
  // may still be added here later, but only WITH its cost written down; it may
  // never sit here by having been forgotten, because a forgotten file is in
  // neither list and fails.
};

/**
 * The enumerator's own pattern, as the DOMAIN definition. Deliberately the same
 * regex {@link enumerateComposeSites} uses: the set of files that matters is
 * exactly the set the scan could find sites in, so the domain and the scan
 * cannot disagree about what a "compose site" is.
 *
 * Built fresh per call — a `/g` regex carries `lastIndex` between `.test()`
 * calls, and a stateful matcher inside a completeness check would skip files on
 * alternate iterations. (Trap 13 in miniature: the instrument would report
 * "clean" for "did not look".)
 */
function composeCallPattern(): RegExp {
  return /compose(?:Answer|ToolCallResponse|ClarifyResponse|DirectAnswerResponse)\(\{/g;
}

/**
 * DERIVED, from source, on every run: every non-test `.ts` file under `src/`
 * containing at least one compose call, as a path relative to `src/`.
 *
 * This is the answer to "which files does the `ungated` ledger speak for?" that
 * cannot go stale, and it replaces a hand-written scope note that was wrong on
 * the day it was written (see the header). Test files are excluded by directory
 * (`__tests__`) AND by suffix (`.test.ts` / `.spec.ts`) — they compose responses
 * constantly and none of it reaches a user.
 */
function derivedComposeFileDomain(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
      if (composeCallPattern().test(readFileSync(full, 'utf8'))) {
        out.push(relative(SRC_ROOT, full).split(sep).join('/'));
      }
    }
  };
  walk(SRC_ROOT);
  return out.sort();
}

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
 * the model's OUTPUT.
 *
 * ⚠ UPDATED 2026-07-27, AND THE OLD SENTENCE IS QUOTED RATHER THAN DELETED
 * (trap #14 — never let a label drift out from under the claim it made). It
 * read: *"…NOT a proof about every other channel the model can read
 * (conversation history above all — a leader named in an EARLIER turn's
 * assistant message is still in the window). That residual is stated in ROADMAP
 * 1.231 rather than papered over here."*
 *
 * That residual was then MEASURED — `WALK-HISTORIC-PREP-2026-07-27.md` §10,
 * build `b35d09de`, 2/5 samples — and CLOSED for the assistant side:
 * `context/withheld-history-redaction.ts` redacts the ordering claims out of
 * `conversation.recent_turns[].assistant_message` at the same pack chokepoint.
 *
 * ⚠ UPDATED AGAIN 2026-07-27, SAME DISCIPLINE — the entry below read
 * *"`conversation_summary` (the rolling summary) — its own ROADMAP row"*, and
 * that row has now been worked. A live read on scenario `f63ccb45` found its
 * `RESOLVED` slot carrying "Current analysis shows Double Down on SMB leading
 * 52% vs Enterprise 35%…" three sentences above the SAME summary's own "No
 * ranking can be put forward…". It is gated at the same chokepoint by
 * `projectConversationSummaryForWithheldClaim`, reusing this module's reader
 * (the shared alarm scores that sentence FALSE — bare participle).
 *
 * THE INPUT SET IS NOW WIDER, NOT COMPLETE. What `gated_by_input` still does
 * NOT cover, enumerated rather than implied:
 *   - `conversation.recent_turns[].user_message` — the USER'S own words, left
 *     verbatim by design (CEE asserting a claim ≠ the user restating one), and
 *     not the self-reinforcing half.
 *   - `brief`, `coaching_context`, `recent_changes`, `parsed_quantities`,
 *     `system_event`, `payload`, `display_graph` — never gated on this axis.
 *   - the V4 edit-graph dispatch (`handlers/edit-graph-dispatch.ts:1261`),
 *     which builds its OWN conversation slice for the edit LLM and has no
 *     verdict to consume — it loads no prior facts. ASSESSED 2026-07-27 and
 *     deliberately left: threading the verdict there needs a NEW prior-facts
 *     read on a path that performs none, which is a derivation this arc's own
 *     rule (one hoist, one selector) says not to add in passing. Sized in the
 *     PR body for #725.
 *   - the STORED summary itself: this gate is a PROJECTION, so
 *     `scenarios.rolling_summary` still HOLDS the claim on disk and every
 *     historic row stays as written. That is deliberate (the audit trail is what
 *     makes a leak investigable) and it is why the write-side question is a
 *     separate slice, not an oversight.
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
    why:
      'ROADMAP 1.233. Zero LLM calls: `composeComparison` builds "The leading option has changed. X came out ahead before, and Y now leads." and the margin sentences straight from the two runs\' persisted enrichment. `tryRunComparisonGate` takes a REQUIRED `mayNameLeadingOption` (required, not optional-defaulting-true, so a new call site cannot re-open the leak by omission) and suppresses the ordering + margin sentences while KEEPING the robustness-band shift and the driver-influence mover, which rank nothing and are the substance of "what changed?". '
      + '⚠ 2026-07-27 — THE PERMISSION WAS SINGULAR AND THE CLAIM IS PLURAL. That required boolean is the TURN\'s permission, read off the scenario\'s newest CLAIM-BEARING fact (#730); the sentence above names TWO runs. So a scenario whose PRIOR run withheld its leader had that leader named as soon as a later run permitted — the withhold expired after one more analysis. Commonest form needs no unusual state at all: a run predating the #710 verdict stamp fail-closes, and every such legacy run was nameable from a later permitted turn. Closed by `RunComparisonLeaderAuthority`: one permission PER COMPARED RUN, each `turnPermission && thatRunsOwnVerdict` via #730\'s one fact -> one verdict narrow over the pair the gate already selects — no second selection. Cross-run claims (the "has changed" sentence, "still leads", and the margin shift) require BOTH permissions, because each presupposes both leaders; the mixed cases name the licensed run and state plainly that the other half is unavailable. One-directional by construction: every value is <= the pre-fix boolean, so permitted/permitted is byte-identical.',
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
    why:
      'As coachGuarded above — the converse twin, same closure, same input gates. ' +
      "⚠ 2026-07-27: the input set GREW. `WALK-HISTORIC-PREP-2026-07-27.md` §10 measured a " +
      'residual leak on build `b35d09de` — AFTER #721 and #723 — sourced from ' +
      '`conversation.recent_turns[].assistant_message`, which carries prior answers verbatim ' +
      'into the routing prompt and SELF-REINFORCES (a leaked answer is persisted and feeds the ' +
      'next turn). Closed by `context/withheld-history-redaction.ts`, applied at the SAME pack ' +
      'chokepoint as the display_analysis gate. See the stance docstring for what the input set ' +
      'still does NOT cover.',
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
 * `src/orchestrator-v5/handlers/chip-click-dispatch.ts` — brought into scope
 * 2026-07-27. THREE sites, and only the third needed real work.
 *
 * This module is the deterministic chip-click fast path: route-v2 detects a
 * `chip_click` whose `action_type` is `run_analysis` and calls
 * `dispatchDeterministicChipClick`, which invokes the registered `run_analysis`
 * handler directly — no Sonnet routing, no ORIENT call, zero LLM calls on the
 * compose path. So every byte of user-facing text here is deterministic code
 * output, which is what makes a byte-level derivation possible at all.
 */
const CHIP_CLICK_DISPATCH_SITES: Readonly<Record<string, RegisteredSite>> = {
  "'Could not run analysis. The analysis service is temporarily unavailab": {
    stance: 'structural',
    why:
      'Literal (chip-click-dispatch.ts:533), zero interpolation. The registry-missing safety ' +
      'net: fires when `resolveHandler(registry, "run_analysis")` returns nothing, i.e. before ' +
      'any analysis has run. No analysis exists on this path, so there is no leader to name and ' +
      'no expression in the string to carry one.',
  },
  "'Analysis could not complete.'": {
    stance: 'structural',
    why:
      'Literal (chip-click-dispatch.ts:551), zero interpolation. The `failureResponse` skeleton ' +
      'for the two typed-failure exits (HandlerInvocationFailedError / HandlerResultInvalidError), ' +
      'where the handler never produced a usable outcome. Same reasoning: no result, no leader.',
  },

  // ── THE ONE THAT NEEDED A DERIVATION ────────────────────────────────────
  confirmationText: {
    stance: 'gated',
    why:
      "GATED — derived at the bytes, not assumed, because the honest stance was NOT obvious: the " +
      'allowlist that admits this text is anchored on the literal phrase "currently leads", which ' +
      'is the exact shape that leaked three times. The allowlist is NOT the gate. THE LIVE CHAIN ' +
      '(trap #16 — traced producer→consumer, not grepped): chip-click-dispatch.ts:786 reads ' +
      '`HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template` = ' +
      '`runAnalysisConfirmationTemplate` (validation-registry.ts:104), which forwards ' +
      "`outcome.assistant_text` iff `isAllowedRunAnalysisAssistantText` accepts it and otherwise " +
      'falls back to the locked literal; the forwarded value reaches `confirmation:` at :807. ' +
      '`outcome` is the run_analysis handler’s single return (run-analysis.ts:1066, ' +
      '`assistant_text: summary`; the handler has exactly one exit and `outcome` is never ' +
      'reassigned between the call and the read). `summary` is ' +
      '`${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}` (:1004). ' +
      'THE GATE IS `headline`: `buildAnalysisResultHeadline` returns `text: null` — withholding ' +
      'the whole "{X} currently leads…" grammar — for each of the three verdict states that ' +
      'withhold the claim (analysis-result-headline.ts:460, :484, :507), and `template` is one of ' +
      'the five RUN_ANALYSIS_ASSISTANT_TEMPLATES literals, none of which interpolates an option. ' +
      'CRUCIALLY IT IS THE SAME VERDICT, NOT A SECOND DERIVATION: run-analysis.ts computes ONE ' +
      '`constraintVerdict`, feeds its three withholding states into the headline input (:872-895) ' +
      'AND persists it as `result.constraint_verdict` (:1046) — which is precisely what ' +
      '`readMayNameLeadingOptionForFacts` reads back as `mayNameLeadingOption`. Output-side ' +
      'consumption of the persisted verdict, at the same turn, from one derivation. ' +
      '⚠ ONE RESIDUAL, STATED RATHER THAN SMOOTHED: the `evaluated_infeasible` conjunct is ' +
      '`config.features.constraintInfeasibleGate && …` (run-analysis.ts:893-895) while the ' +
      "persisted verdict's `MAY_NAME_LEADING_OPTION.evaluated_infeasible` is `false` " +
      'UNCONDITIONALLY. The flag defaults to `true` (config/index.ts:728), so they agree as ' +
      'shipped — but with `CEE_CONSTRAINT_INFEASIBLE_GATE=false` the headline would name a leader ' +
      'the persisted verdict withholds, and Layer 3 is observe-only ' +
      '(`guardLeadingOptionClaimsAtEgress` returns the response unchanged). The default is ' +
      'PINNED below so flipping it turns this register red rather than silently voiding this ' +
      'entry.',
  },
};

/**
 * The register, KEYED BY FILE. The nesting is the scope statement: a reader of
 * the `ungated` ledger can see exactly which files it speaks for, instead of
 * inferring it from a comment that can go stale (which is what happened).
 */
/**
 * `src/orchestrator-v5/compose/edit-clarify-response.ts` — brought into scope
 * 2026-07-27 (ROADMAP 1.276), and it required WIDENING THE INSTRUMENT first.
 *
 * This file was previously declared `keyable: false` / UNPARSEABLE. That was
 * never a fact about the code — it was a fact about the enumerator, whose key
 * regex required `assistant_text:` and so could not read the ES6 shorthand
 * `assistant_text,` this site uses. Worth stating in the register itself,
 * because "the instrument cannot read it" and "the site is hard to classify"
 * look identical from the outside and only one of them is a reason to exclude.
 */
const EDIT_CLARIFY_SITES: Readonly<Record<string, RegisteredSite>> = {
  assistant_text: {
    stance: 'structural',
    why:
      'ONE site (edit-clarify-response.ts:128-133), keyed `assistant_text` because the site uses ' +
      'the ES6 shorthand property. The value is built two lines above as ' +
      "`pieces.join(' ')` over at most THREE module string constants — LEAD_TEXT (\"The model " +
      'is unchanged so far."), FRESHNESS_SUFFIX ("Your last analysis is still current.") and ' +
      'CLOSING_TEXT ("Tell me the specific factor, edge, option, or value to change…") at ' +
      ':98-101. ZERO interpolation: there is no expression in `assistant_text` that could carry ' +
      'an option label, a probability, a margin or an ordering, so it cannot assert a leader ' +
      'under any input. That is a STRONGER derivation than several sites already registered ' +
      'structural (the add-risk echo interpolates two labels; this interpolates none). The only ' +
      'input-dependent behaviour is whether FRESHNESS_SUFFIX is present, gated on the ' +
      'caller-supplied boolean `input.priorAnalysisIsFresh`. ' +
      'SCOPE NOTE, so a later reader does not think it was missed: the CHIPS this file builds ' +
      'DO carry graph labels (`buildLabelChip` emits "Change {label}" / "For {label}, what value ' +
      'should we use?", drawn from factor then option nodes), so option labels do reach the ' +
      'response — on `suggested_actions`, which is not a channel this register keys. Both ' +
      'upstream call sites (route-v2.ts:3660 chip_simplify, :3738 vague_edit) pass ' +
      '`mayNameLeadingOption: true`, and on this path that is honest: the file makes zero LLM ' +
      'calls (pinned by context-policy.conformance.test.ts) and reads no analysis.',
  },
};

/**
 * `src/orchestrator-v5/routing/post-analysis-label-intercept.ts` — brought into
 * scope 2026-07-27 (ROADMAP 1.276). Previously `keyable: true` but deliberately
 * UNREGISTERED, on the grounds that this file exists to stop stances being
 * assigned by inspection-at-a-glance. Here is the derivation it was owed.
 */
const POST_ANALYSIS_LABEL_INTERCEPT_SITES: Readonly<Record<string, RegisteredSite>> = {
  'composeExploreText(canonicalLabel)': {
    stance: 'structural',
    why:
      'ONE site (post-analysis-label-intercept.ts:329-334, `assistant_text:` at :331). ' +
      '`composeExploreText` (:273-280) is a fixed template with a SINGLE interpolation slot ' +
      'carrying ONE canonical graph-node label: "It looks like you would like to explore ' +
      '{label}. Would you like me to walk you through the analysis, look at what could change ' +
      'the outcome, or run a pre-mortem?". No LLM involvement (the module docstring: "Pure ' +
      'function. No I/O, no telemetry", and "Label matching uses ONLY canonical graph labels ' +
      '(already user-authored). No LLM invention."). The three chips are frozen module ' +
      'constants. It CAN name an option — `findLabelMatch` (:149-162) does not filter by ' +
      '`node.kind`, so an option-kind node matches — but naming is not RANKING: the sentence ' +
      'carries no comparison, no ordering, no probability and no margin, which is the same ' +
      'standard already applied to the add-risk echo. The file additionally bans ' +
      '"recommended"/"winner"/"winning option" in its own copy contract (:266). ' +
      '⚠ REGISTERED RESIDUAL, and it is the reason this stance is worth writing down rather ' +
      'than waving through. Unlike the edit-clarify path, this intercept fires ONLY when a ' +
      'fresh prior analysis EXISTS — `if (!priorAnalysisIsFresh) return {matched:false}` at ' +
      ':183-185 — so a verdict that may have WITHHELD provably exists on every turn that ' +
      'reaches this compose site. Yet route-v2.ts:3720 passes `mayNameLeadingOption: true` ' +
      'under a comment reading "this path runs no analysis, so it withheld no leading-option ' +
      'claim". Running no analysis is not the same as no analysis existing. There is no live ' +
      'leak, because the prose above cannot express a leader claim — but the Layer-3 alarm is ' +
      'a LICENSED NO-OP on this exit, which is precisely the shape ROADMAP 1.233 fixed ' +
      'elsewhere (see the `assistantText` entry: "a `true` permission that made the Layer-3 ' +
      'alarm a licensed no-op"). Flagged here, NOT fixed here: threading a real verdict into ' +
      'this exit is a behaviour change needing the turn context, and it belongs in its own ' +
      'reviewed PR rather than riding along with an enumerator widening.',
  },
};

/**
 * `src/orchestrator-v5/system-events/factor-value-edit.ts` — brought into scope
 * 2026-07-28 (ROADMAP 1.346), on the commit that created the file. The derived
 * domain test caught it on its first run, which is the mechanism working.
 */
const FACTOR_VALUE_EDIT_SITES: Readonly<Record<string, RegisteredSite>> = {
  'outcome.assistant_text': {
    stance: 'structural',
    why:
      'ONE site. The value is the `set_factor_value` handler\'s own receipt, passed straight ' +
      'through as `confirmation`. That text is assembled DETERMINISTICALLY in ' +
      'tools/handlers/set-factor-value.ts from `formatFactorChange` / `formatFactorValueSet` / ' +
      '`formatFactorValueUnchanged` over the target factor\'s label and its before/after ' +
      'user-unit values, plus at most two module constants (STALENESS_NARRATIVE and the ' +
      'cap-change scale note). The handler declares `llm_calls_used: 0` and makes no LLM call, ' +
      'so no model-authored prose can reach this key. ' +
      'IT CANNOT ASSERT A LEADER. The only graph label it interpolates is the label of the ' +
      'ONE factor the user edited — named by id from the wire event, never selected by rank — ' +
      'and `SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS` is `[\'factor\']`, so the interpolated ' +
      'label can never be an OPTION\'s. The sentence carries no comparison, no ordering, no ' +
      'probability and no margin. That is a stronger derivation than the add-risk echo already ' +
      'registered structural, which interpolates two labels without a kind restriction. ' +
      'The route threads `mayNameLeadingOption: true` on the system_event exit, and on this ' +
      'path that is honest for the same reason: the dispatch runs no analysis, so it withheld ' +
      'no verdict. ' +
      'SCOPE NOTE so a later reader does not think it was missed: the REFUSAL branches of this ' +
      'file do not reach this key — they compose via `composeRecoverableValidationResponse` / ' +
      '`composeRecoverableHandlerResponse`, whose own copy lives in ' +
      'compose/validation-failure-responses.ts and is keyed where that file is scanned.',
  },
};

const COMPOSE_SITE_REGISTER: Readonly<Record<string, Readonly<Record<string, RegisteredSite>>>> = {
  'turn-executor.ts': TURN_EXECUTOR_SITES,
  'route-v2.ts': ROUTE_V2_SITES,
  'handlers/chip-click-dispatch.ts': CHIP_CLICK_DISPATCH_SITES,
  'compose/edit-clarify-response.ts': EDIT_CLARIFY_SITES,
  'routing/post-analysis-label-intercept.ts': POST_ANALYSIS_LABEL_INTERCEPT_SITES,
  'system-events/factor-value-edit.ts': FACTOR_VALUE_EDIT_SITES,
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
    // ⚠ WIDENED 2026-07-27 (ROADMAP 1.276) TO PARSE ES6 SHORTHAND.
    //
    // The previous pattern was `/(?:assistant_text|confirmation):\s*([^\n,]+)/`
    // — it REQUIRED a colon, so a site passing the shorthand property
    // `assistant_text,` keyed as `UNPARSEABLE`. That is how
    // `compose/edit-clarify-response.ts` came to be declared unscannable: not
    // because its stance was hard to derive, but because the INSTRUMENT could
    // not read the syntax. An enumerator blind to a language feature quietly
    // narrows the register's domain to "sites written in the style the regex
    // happened to be built for".
    //
    // The two branches, and why the key differs between them:
    //   - `assistant_text: expr`  ⇒ key is `expr`, exactly as before.
    //   - `assistant_text,`       ⇒ key is `assistant_text`, the identifier,
    //     because under shorthand the identifier IS the expression.
    // Verified key-identical on all 34 previously-scanned sites, so widening
    // moves no existing key and cannot perturb the multiset for a non-semantic
    // reason (the `slice(0, 70)`-of-raw-source keying is already fragile enough
    // — see the header's Prettier-reflow note).
    //
    // `\b` prevents matching a longer identifier that merely ends in
    // `assistant_text`; the `[,}]` lookahead branch is what admits shorthand
    // both mid-object (`assistant_text,`) and last (`assistant_text }`).
    const arg = /\b(assistant_text|confirmation)\s*(?::\s*([^\n,]+)|\s*[,}])/.exec(span);
    keys.push(arg ? (arg[2] ?? arg[1]!).trim().slice(0, 70) : 'UNPARSEABLE');
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

  it('the scan really covers chip-click-dispatch.ts, and it really has sites', () => {
    // Same anti-tautology pin as route-v2.ts above, for the 2026-07-27 widening.
    // A file added to SCANNED_FILES that the enumerator finds nothing in widens
    // the scope on paper and changes no measurement (trap 12b).
    const chipKeys = enumerateComposeSites(sources['handlers/chip-click-dispatch.ts']!);
    expect(chipKeys.length).toBeGreaterThan(0);
    expect(chipKeys.sort()).toEqual([
      "'Analysis could not complete.'",
      "'Could not run analysis. The analysis service is temporarily unavailab",
      'confirmationText',
    ]);
  });

  it('edit-clarify-response: the scan finds its ONE site, keyed via ES6 SHORTHAND', () => {
    // The sibling anti-tautology pin for the file brought into scope by 1.276.
    // ⭐ THIS IS ALSO THE WIDENING'S ACCEPTANCE TEST: before the key regex
    // learned shorthand, this file's only site keyed `UNPARSEABLE`, which is
    // why it sat in `UNSCANNED_COMPOSE_FILES` with `keyable: false`.
    const keys = enumerateComposeSites(sources['compose/edit-clarify-response.ts']!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual(['assistant_text']);
  });

  it('post-analysis-label-intercept: the scan finds its ONE site', () => {
    const keys = enumerateComposeSites(sources['routing/post-analysis-label-intercept.ts']!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual(['composeExploreText(canonicalLabel)']);
  });

  it('THE WIDENING: shorthand is parsed, and every pre-existing key is UNMOVED', () => {
    // ⭐ THE TWO HALVES THAT MATTER, and the second is the one that could have
    // broken the register for a non-semantic reason.
    //
    // (a) The enumerator now reads shorthand — in both the mid-object and the
    //     final-property positions, and it does NOT match a longer identifier
    //     that merely ends in `assistant_text`.
    const wide = (span: string): string[] =>
      enumerateComposeSites(`composeDirectAnswerResponse(${span})`);
    expect(wide("{ answerKind: 'functional', assistant_text, stage: input.stage }")).toEqual([
      'assistant_text',
    ]);
    expect(wide('{ stage, assistant_text }')).toEqual(['assistant_text']);
    expect(wide('{ assistant_text: composeExploreText(label), stage }')).toEqual([
      'composeExploreText(label)',
    ]);
    expect(wide('{ confirmation: confirmationText, coaching }')).toEqual(['confirmationText']);
    expect(wide('{ stage: s, blocks: [] }')).toEqual(['UNPARSEABLE']);
    // The `\b` guard: a longer identifier ending in the tracked name must not
    // be mistaken for the tracked property.
    expect(wide('{ draft_assistant_text: x, stage }')).toEqual(['UNPARSEABLE']);

    // (b) NO EXISTING KEY MOVED. The register keys sites on
    //     `expr.trim().slice(0, 70)` of RAW SOURCE, so a widening that
    //     re-keyed even one site would fail the multiset assertion for a reason
    //     that has nothing to do with a compose site drifting — the exact
    //     fragility the header calls out about Prettier reflow. Re-derive the
    //     OLD key for every site with the pre-1.276 regex and require equality
    //     wherever the old regex could key at all.
    const narrow = (span: string): string | null => {
      const m = /(?:assistant_text|confirmation):\s*([^\n,]+)/.exec(span);
      return m ? m[1]!.trim().slice(0, 70) : null;
    };
    let compared = 0;
    for (const [label, src] of Object.entries(sources)) {
      const pattern = /compose(?:Answer|ToolCallResponse|ClarifyResponse|DirectAnswerResponse)\(\{/g;
      const newKeys = enumerateComposeSites(src);
      let i = 0;
      for (const m of src.matchAll(pattern)) {
        const open = m.index! + m[0].length - 1;
        let depth = 0;
        let j = open;
        for (; j < src.length; j++) {
          const c = src[j];
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        const old = narrow(src.slice(open, j + 1));
        if (old !== null) {
          expect(newKeys[i], `${label} site ${i}: the widening RE-KEYED an existing site`).toBe(
            old,
          );
          compared += 1;
        }
        i += 1;
      }
    }
    // Anti-vacuity: this loop must actually have compared every site the OLD
    // regex could key, not silently zero of them.
    //
    // 35 = all 36 sites MINUS the one shorthand site the old regex could not
    // key. That single site is the entire behavioural delta of the widening,
    // and this number says so precisely: 34 of the 35 are the previously
    // scanned files, and the 35th is `post-analysis-label-intercept.ts`, which
    // used `assistant_text:` and was therefore always keyable — it was
    // unregistered for a different reason (nobody had derived its stance), and
    // conflating the two exclusions is what this count prevents.
    expect(compared, 'the re-key comparison compared nothing').toBe(36);
  });

  it('THE DOMAIN IS DERIVED: scanned ∪ unscanned == every compose file in src/', () => {
    // ⭐ THE SCOPE-LEVEL TRAP-12 FIX. The previous revision hand-named ONE file
    // as the remaining gap. A walk of src/ finds FIVE non-test files with
    // compose sites — two of them (`compose/edit-clarify-response.ts`,
    // `routing/post-analysis-label-intercept.ts`) were named nowhere at all. The
    // register's `ungated: []` was therefore scoped by a list a human had to
    // remember to sync, and the drift read as green.
    //
    // Now the domain is DERIVED and the two lists must exhaust it. A new
    // production file with a compose site fails HERE, on the commit that adds
    // it, whichever list it should have joined — which is the property trap 12
    // demands: derive from the source of truth, and where the JUDGEMENT cannot
    // be derived, make the MEMBERSHIP fail loud.
    const declared = [
      ...Object.values(SCANNED_FILES).map((p) => relative(SRC_ROOT, p).split(sep).join('/')),
      ...Object.keys(UNSCANNED_COMPOSE_FILES),
    ].sort();
    expect(
      declared,
      'A file under src/ contains a compose site and is in NEITHER SCANNED_FILES nor ' +
        "UNSCANNED_COMPOSE_FILES (or one of those lists names a file that no longer has " +
        'sites). The `ungated: []` ledger below speaks only for SCANNED_FILES, so an ' +
        'undeclared compose file means that ledger silently covers less of CEE than the ' +
        'last reader believed. Register it, or declare it unscanned WITH a reason.',
    ).toEqual(derivedComposeFileDomain());
  });

  it('POSITIVE CONTROL: the derived domain SEES a compose file (it is not vacuously empty)', () => {
    // Rule 2. A walk that silently found nothing — wrong root, wrong extension
    // filter, a `/g` regex carrying `lastIndex` — would make the assertion above
    // pass only when BOTH lists were also empty, and read as clean forever.
    const domain = derivedComposeFileDomain();
    expect(domain.length).toBeGreaterThanOrEqual(5);
    expect(domain).toContain('orchestrator-v5/turn-executor.ts');
    expect(domain).toContain('orchestrator-v5/handlers/chip-click-dispatch.ts');
    // And it must EXCLUDE the definition site: compose.ts declares
    // `composeToolCallResponse(input: …)` and calls none of the four, so a
    // domain containing it would mean the pattern had drifted from the
    // enumerator's and the two could disagree about what a site is.
    expect(domain).not.toContain('orchestrator-v5/compose.ts');
  });

  it('the declared UNSCANNED remainder still has the sites it says it has', () => {
    // The remainder is a to-do with a price on it, not a shrug. If either file
    // gains or loses a site the number here is wrong, and the next reader would
    // otherwise inherit a stale cost estimate for closing the gap.
    for (const [rel, decl] of Object.entries(UNSCANNED_COMPOSE_FILES)) {
      const keys = enumerateComposeSites(readFileSync(resolve(SRC_ROOT, rel), 'utf8'));
      expect(keys.length, `${rel}: declared site count is stale`).toBe(decl.siteCount);
      // `keyable: false` is a DECLARED instrument limitation, pinned in both
      // directions so it can neither be quietly fixed nor quietly spread.
      expect(keys.includes('UNPARSEABLE'), `${rel}: declared keyable=${decl.keyable}`).toBe(
        !decl.keyable,
      );
    }
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
    //
    // ⚠ WIDENED TO EVERY SCANNED FILE, 2026-07-27 (1.276). This assertion used
    // to read only `source` (turn-executor.ts), so the one file in the estate
    // that ACTUALLY keyed UNPARSEABLE — `compose/edit-clarify-response.ts`,
    // via ES6 shorthand — was outside the assertion that exists to catch
    // exactly that. The blindness was recorded honestly in
    // `UNSCANNED_COMPOSE_FILES` rather than hidden, but it was recorded as a
    // property of the FILE when it was a property of the ENUMERATOR. Now the
    // enumerator reads shorthand and this checks all five.
    for (const [label, src] of Object.entries(sources)) {
      expect(
        enumerateComposeSites(src),
        `${label}: a compose site keyed UNPARSEABLE. The enumerator could not read the ` +
          'expression feeding this site, so the register cannot speak for it — and an ' +
          'unreadable site is indistinguishable from a clean one in the multiset comparison. ' +
          'Widen the key regex; do not excuse the file.',
      ).not.toContain('UNPARSEABLE');
    }
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
    // ⚠ READ THE SCOPE WITH THE NUMBER. This `[]` speaks for turn-executor.ts,
    // route-v2.ts AND handlers/chip-click-dispatch.ts — 36 sites / 32 keys — and
    // NOT for the two files in UNSCANNED_COMPOSE_FILES (1 site each). The
    // difference from previous revisions is that the boundary is no longer a
    // sentence anyone has to keep true: the derived-domain test above fails if
    // this list of files stops being the whole story.
    //
    // NOTE the chip-click widening did NOT add an ungated site. That is a
    // derivation (see `confirmationText`'s entry), not a convenience: had the
    // headline gate turned out absent, the honest move was to add the key here
    // and change this assertion deliberately — never to relabel the site.
    expect(ungated).toEqual([]);
  });

  it('the ledger covers the surface it claims to — counts, derived', () => {
    // The number behind the `[]`, pinned so "0 ungated" can never again be read
    // as covering more than it measures. Both figures are DERIVED from source on
    // every run; only the expectation is written down.
    const sites = enumerateAllScannedSites(sources);
    expect(sites.length, 'total compose SITES across every scanned file').toBe(37);
    expect(Object.keys(registerTally()).length, 'distinct file::expression KEYS').toBe(33);
    expect(Object.keys(COMPOSE_SITE_REGISTER).sort()).toEqual([
      'compose/edit-clarify-response.ts',
      'handlers/chip-click-dispatch.ts',
      'route-v2.ts',
      'routing/post-analysis-label-intercept.ts',
      'system-events/factor-value-edit.ts',
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
    //
    // BOTH gates are required, and BOTH are pinned. Reverting either one leaves
    // a register still claiming an input gate the pack no longer has — the
    // honest-label-overwritten-by-a-false-one failure (trap #14). The second
    // entry is the 2026-07-27 conversation-history gate.
    expect(source).toContain('projectDisplayAnalysisForWithheldClaim(');
    expect(
      source,
      'the conversation-history input gate is gone from turn-executor.ts. Prior-turn ' +
        'assistant prose would again reach the model verbatim on a withheld turn — the ' +
        'channel WALK-HISTORIC-PREP-2026-07-27.md §10 measured leaking 2/5 AFTER #721 and ' +
        '#723, and the one that self-reinforces.',
    ).toContain('conversation: projectConversationForWithheldClaim(');
    // The THIRD gate at that chokepoint (2026-07-27): the rolling summary.
    expect(
      source,
      'the rolling-summary input gate is gone from turn-executor.ts. The stored four-slot ' +
        'summary would again reach the model verbatim on a withheld turn — scenario ' +
        'f63ccb45 holds "…Double Down on SMB leading 52% vs Enterprise 35%…" in its RESOLVED ' +
        'slot, three sentences above that same summary\'s own "No ranking can be put forward".',
    ).toContain('conversation_summary: projectConversationSummaryForWithheldClaim(');
  });

  it('POSITIVE CONTROL: the rolling-summary gate evidence check can FAIL', () => {
    // Rule 2, for the pin just added — prove the `toContain` discriminates
    // rather than passing against any source it is handed.
    const gate = 'conversation_summary: projectConversationSummaryForWithheldClaim(';
    expect(source).toContain(gate);
    expect(
      source.replace(gate, 'conversation_summary: assembledContextPack.conversation_summary, // ('),
    ).not.toContain(gate);
  });

  it('POSITIVE CONTROL: the conversation-gate evidence check can FAIL', () => {
    // Rule 2, for the pin just added. Prove the `toContain` discriminates
    // rather than passing against any source it is handed.
    const gate = 'conversation: projectConversationForWithheldClaim(';
    expect(source).toContain(gate);
    expect(source.replace(gate, 'conversation: assembledContextPack.conversation, // (')).not.toContain(
      gate,
    );
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
    expect(source).toContain('let mayNameLeadingOptionVerdictForRun = readMayNameLeadingOptionVerdict(');
    expect(source).not.toContain('let mayNameLeadingOptionForRun = true;');
  });

  it('the hoisted read is SCENARIO-scoped, not window-scoped (2026-07-27)', () => {
    // ⭐ THE SECOND STRUCTURAL CLAIM, and it is a DIFFERENT one from the hoist.
    // 1.233 fixed WHERE the permission is read (at the declaration, so every
    // exit carries it). It did not fix WHAT is read: `context.prior_facts` is
    // a `LIMIT SESSION_READ_WINDOW_TURNS` window, so past 20 turns the
    // scenario's analysis fact was not loaded at all and the "no analysis ⇒
    // true" branch fired on a WITHHELD scenario. Confirmed live on
    // `f63ccb45-…`: rank 20 ⇒ `false`, rank 21 ⇒ `true`, zero store change.
    //
    // Both directions pinned. The scope must be PRESENT…
    expect(source).toContain('const claimSafetyScope = claimSafetyScopeFromContext(context);');
    // …and the window-scoped read must not come back, at EITHER read point.
    // The post-dispatch refinement matters as much as the hoist: its
    // unconditional assignment is only safe while its array is a superset of
    // the entry array, which stops being true the moment it drops the scope.
    expect(source).not.toContain('readMayNameLeadingOptionForFacts(context.prior_facts)');
    expect(source).not.toContain('readMayNameLeadingOptionForFacts([');
  });

  it('POSITIVE CONTROL: the scenario-scope evidence check can FAIL', () => {
    // Rule 2 — an instrument that cannot go red is not an instrument. Prove
    // both halves discriminate by mutating the source they read.
    const scope = 'const claimSafetyScope = claimSafetyScopeFromContext(context);';
    expect(source).toContain(scope);
    expect(source.replace(scope, 'const claimSafetyScope = null;')).not.toContain(scope);

    // And the anti-regression half: a source that DID revert to the windowed
    // read must trip the `not.toContain` above.
    const reverted = source.replace(
      'let mayNameLeadingOptionVerdictForRun = readMayNameLeadingOptionVerdict(\n    context.prior_facts,\n    claimSafetyScope,\n  );',
      'let mayNameLeadingOptionForRun = readMayNameLeadingOptionForFacts(context.prior_facts);',
    );
    expect(reverted).toContain('readMayNameLeadingOptionForFacts(context.prior_facts)');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // chip-click `confirmationText` — the derivation, pinned hop by hop.
  //
  // This site is registered `gated` on a FOUR-HOP chain across four files. A
  // single `toContain` on the compose site would prove none of it, and the
  // stance would rest on this file's prose — which is the failure mode the
  // register's own header calls out (trap #14: the honest label overwritten by
  // a false one). Each hop below is the line the gate actually turns on, so
  // breaking ANY hop turns this red.
  // ══════════════════════════════════════════════════════════════════════════

  const CHIP_CLICK = readFileSync(SCANNED_FILES['handlers/chip-click-dispatch.ts']!, 'utf8');
  const VALIDATION_REGISTRY = readFileSync(resolve(HERE, '../routing/validation-registry.ts'), 'utf8');
  const RUN_ANALYSIS = readFileSync(resolve(HERE, '../tools/handlers/run-analysis.ts'), 'utf8');
  const HEADLINE = readFileSync(resolve(HERE, '../coaching/analysis-result-headline.ts'), 'utf8');

  it('chip-click: the two failure sites really ARE literals (structural, non-vacuous)', () => {
    for (const key of [
      "'Could not run analysis. The analysis service is temporarily unavailab",
      "'Analysis could not complete.'",
    ]) {
      expect(CHIP_CLICK_DISPATCH_SITES[key]!.stance).toBe('structural');
    }
    // The claim is "zero interpolation", so the evidence is the literal itself
    // WITH its terminating quote+comma: a future edit turning either into a
    // template literal cannot leave these fragments intact.
    expect(CHIP_CLICK).toContain(
      "confirmation: 'Could not run analysis. The analysis service is temporarily unavailable.',",
    );
    expect(CHIP_CLICK).toContain("confirmation: 'Analysis could not complete.',");
  });

  it('chip-click confirmationText: HOP 1-2 — the site reads the registry template', () => {
    expect(CHIP_CLICK_DISPATCH_SITES['confirmationText']!.stance).toBe('gated');
    // HOP 1: the compose site is fed by the registry declaration, not by raw
    // handler prose. Both halves matter — the `typeof === 'function'` branch is
    // what routes through the allowlist at all.
    expect(CHIP_CLICK).toContain("decl?.confirmation_template === 'function'");
    expect(CHIP_CLICK).toContain('confirmation: confirmationText,');
    // HOP 2: run_analysis's declared template IS the allowlisting forwarder, and
    // that forwarder gates on the allowlist rather than passing prose through.
    expect(VALIDATION_REGISTRY).toContain('confirmation_template: runAnalysisConfirmationTemplate,');
    expect(VALIDATION_REGISTRY).toContain('if (isAllowedRunAnalysisAssistantText(candidate)) {');
    expect(VALIDATION_REGISTRY).toContain(
      "const RUN_ANALYSIS_FALLBACK_TEXT = 'Ran analysis on your current scenario.';",
    );
  });

  it('chip-click confirmationText: HOP 3 — the text is headline ?? locked template', () => {
    // The load-bearing composition. If `summary` ever stops being
    // "withheld-able headline, else a locked template", the `gated` stance is
    // void — so the exact expression is pinned, not paraphrased.
    expect(RUN_ANALYSIS).toContain('const headline = buildAnalysisResultHeadline(headlineInput);');
    expect(RUN_ANALYSIS).toContain(
      'const summary = `${headline ?? template}${scaffoldDisclosure}${constraintGapDisclosure}`;',
    );
    expect(RUN_ANALYSIS).toContain('assistant_text: summary,');
    // ONE verdict, TWO consumers — the property that makes this `gated` rather
    // than "two derivations that happen to agree". The same object that gates
    // the headline is the one persisted and read back as mayNameLeadingOption.
    expect(RUN_ANALYSIS).toContain('constraint_verdict: projectClaimSafety(constraintVerdict),');
  });

  it('chip-click confirmationText: HOP 4 — EVERY withholding verdict state withholds the headline', () => {
    // ⭐ THE DERIVATION, not a fragment grep. The set of states that withhold the
    // claim is DERIVED from `MAY_NAME_LEADING_OPTION` — the same exhaustive
    // `Record<ConstraintVerdictState, boolean>` the verdict itself reads — so a
    // SIXTH state added with `false` and no matching headline branch fails here
    // instead of shipping a leader the verdict withheld.
    //
    // The state -> headline-input mapping cannot be derived (the names are not
    // mechanical: `evaluated_infeasible` -> `constraint_infeasible`), so it is a
    // mirror — and per trap #12 a mirror that cannot be derived must FAIL LOUD
    // on drift, which is what the key-set assertion immediately below does.
    const WITHHOLD_STATE_TO_HEADLINE_INPUT: Readonly<Record<string, string>> = {
      evaluated_infeasible: 'constraint_infeasible',
      unevaluated: 'constraint_unevaluated',
      identity_unresolved: 'constraint_identity_unresolved',
    };
    const derivedWithholdingStates = Object.entries(MAY_NAME_LEADING_OPTION)
      .filter(([, mayName]) => !mayName)
      .map(([state]) => state)
      .sort();
    expect(
      Object.keys(WITHHOLD_STATE_TO_HEADLINE_INPUT).sort(),
      'A ConstraintVerdictState changed its leading-option answer, or a new state was ' +
        'added. The chip-click confirmationText stance is `gated` ONLY because every state ' +
        'that withholds the claim also withholds the headline — re-derive that before ' +
        'updating this map.',
    ).toEqual(derivedWithholdingStates);

    for (const [state, field] of Object.entries(WITHHOLD_STATE_TO_HEADLINE_INPUT)) {
      // The headline builder returns `text: null` on this input...
      expect(HEADLINE, `${state}: headline no longer withholds on ${field}`).toContain(
        `if (input.${field} === true) {`,
      );
      // ...and the handler really wires THAT state to THAT input.
      expect(RUN_ANALYSIS, `${state}: handler no longer feeds the verdict state to the headline`)
        .toContain(`constraintVerdict.state === '${state}',`);
    }

    // ⚠ THE RESIDUAL, PINNED. `evaluated_infeasible` is the one hop whose
    // withhold is flag-conditional, while the persisted verdict's answer for it
    // is unconditional `false`. They agree only because the flag defaults ON.
    // Flipping this default re-opens a divergence between the confirmation text
    // and the verdict the same response carries — with Layer 3 observe-only —
    // so it must not be possible to do it quietly.
    expect(MAY_NAME_LEADING_OPTION.evaluated_infeasible).toBe(false);
    expect(RUN_ANALYSIS).toContain('config.features.constraintInfeasibleGate &&');
    expect(
      readFileSync(resolve(HERE, '../../config/index.ts'), 'utf8'),
      'CEE_CONSTRAINT_INFEASIBLE_GATE no longer defaults ON. The chip-click ' +
        '`confirmationText` gate for the evaluated_infeasible state is conditional on this ' +
        'flag; with it off, the headline names a leader the persisted verdict withholds and ' +
        'the Layer-3 guard is observe-only. Re-derive the stance before changing this.',
    ).toContain('constraintInfeasibleGate: booleanString.default(true),');
  });

  it('POSITIVE CONTROL: the chip-click hop evidence can FAIL', () => {
    // Rule 2, for the four-hop chain. Each `toContain` above must discriminate;
    // prove it on the two hops that carry the whole stance — the compose-site
    // read and the headline withhold — by mutating each and re-checking.
    const site = 'confirmation: confirmationText,';
    expect(CHIP_CLICK).toContain(site);
    expect(CHIP_CLICK.replace(site, 'confirmation: outcome.assistant_text,')).not.toContain(site);

    const withhold = 'if (input.constraint_infeasible === true) {';
    expect(HEADLINE).toContain(withhold);
    // The pre-gate shape: the branch deleted entirely.
    expect(HEADLINE.replace(withhold, 'if (false) {')).not.toContain(withhold);
  });

  it('chip-click reads the SHARED claim-safety reader, not a copy of it', () => {
    // 2026-07-27. The chip-click exit used to inline an IIFE that was
    // line-for-line `readMayNameLeadingOptionForFacts` — same selector, same
    // `null ⇒ true`, same narrow, same input array. Identical behaviour, and
    // therefore invisible: the shared reader's docstring promises "a future
    // third caller gets the same answer BY CONSTRUCTION rather than by a
    // reviewer noticing", and the third caller got it by copy. Pinned in both
    // directions so the copy cannot come back.
    expect(CHIP_CLICK).toContain('readMayNameLeadingOptionVerdict(');
    expect(CHIP_CLICK).not.toContain('selectRunAnalysisFact([...enrichedFacts');

    // 2026-07-27 — and the SCOPE is shared too, not just the reader. Calling
    // the shared function with a window-scoped input would give this exit a
    // different permission from the routed path again: the same divergence the
    // comment above says calling the shared reader was meant to end,
    // reintroduced one layer down.
    expect(CHIP_CLICK).toContain('claimSafetyScopeFromContext(context)');
  });
});
