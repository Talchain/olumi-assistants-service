/** C1: exact global compose census after removing conventional routing. Surviving stances and chip claim gates are unchanged. */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAY_NAME_LEADING_OPTION } from '../../orchestrator/context/constraint-feasibility.js';
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, '../..');
type VerdictStance = 'gated' | 'gated_by_input' | 'structural' | 'ungated';
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
const SCANNED_FILES: Readonly<Record<string,string>> = {
"handlers/chip-click-dispatch.ts": resolve(HERE, "../handlers/chip-click-dispatch.ts"),
"compose/edit-clarify-response.ts": resolve(HERE, "../compose/edit-clarify-response.ts"),
"system-events/factor-value-edit.ts": resolve(HERE, "../system-events/factor-value-edit.ts"),
"system-events/edge-strength-edit.ts": resolve(HERE, "../system-events/edge-strength-edit.ts"),
"system-events/goal-target-edit.ts": resolve(HERE, "../system-events/goal-target-edit.ts"),
"handlers/approve-held-proposal.ts": resolve(HERE, "../handlers/approve-held-proposal.ts"),
};
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
  //
  // ⚠ NO LONGER EMPTY AS OF 2026-09-22, AND THE COST IS WRITTEN DOWN.
  'routes/agent-v1-turn.ts': {
    // 3 since the whole-turn replay (olumi-programme-docs#63 5788656586): the
    // third site composes the ORIGINAL stored Agent text for an exact retry by
    // turn_id — same stance as the other two, no validator verdict on this path.
    // 4 since #3310: the turn-start reply when held proposals cannot be read composes a truthful
    // 'could not verify' answer (no tools, no write) — same stance, no validator verdict on this path.
    siteCount: 4,
    keyable: true,
    why:
      'The agent lane composes an answer the OpenAI Agent produced, not one the ' +
      'v5 validator produced. This ledger asks a single question of each site — ' +
      'does it consume the validator verdict before speaking — and that question ' +
      'has no answer here, because no validator verdict exists on this path: the ' +
      'route calls composeDirectAnswerResponse directly with the Agent text and ' +
      'Olumi-authored disclosures. Registering it in SCANNED_FILES would force a ' +
      'stance on a question the code never asks, which is worse than declaring ' +
      'the gap. ' +
      'THE COST, stated plainly: `ungated: []` below no longer speaks for every ' +
      'compose site in src/ — it speaks for every site MINUS these two. The two ' +
      'sites are the substantive turn reply and the refusal for a non-message ' +
      'turn kind. Both are gated by their own lane tests (the disclosure is ' +
      'deterministic and Olumi-authored; the read-only refusal is asserted in ' +
      'three independent layers). ' +
      'This entry should be DELETED, not grown, when the agent lane either ' +
      'adopts the validator path or is removed.',
  },
};
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
const FACTOR_VALUE_EDIT_SITES: Readonly<Record<string, RegisteredSite>> = {
  'review.assistant_text': {
    stance: 'structural',
    why:
      'SD-1 (#2617): the confirm_current branch\'s receipt, from `recordFactorReview` in ' +
      'tools/handlers/set-factor-value.ts — `formatFactorValueUnchanged` over the ONE reviewed ' +
      'factor\'s label and its stored user-unit figure ("X is already set to …"), or the constant-shaped ' +
      '"X is unchanged." when no figure resolves. Deterministic, no LLM call (`llm_calls_used: 0`). ' +
      'IT CANNOT ASSERT A LEADER: the branch refuses any non-factor target (`confirm_not_a_factor`, ' +
      '`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`), so the interpolated label is never an option\'s, and ' +
      'the sentence carries no comparison, ordering, probability or margin. No analysis runs on this path.',
  },
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
const EDGE_STRENGTH_EDIT_SITES: Readonly<Record<string, RegisteredSite>> = {
  "event.intent === 'confirm_current'": {
    stance: 'structural',
    why:
      'ONE site. Both branches are deterministic mutation receipts: explicit confirmation uses ' +
      '`formatEdgeStrengthConfirmed`, while changed sets use the reused `adjust_edge_strength` ' +
      'handler receipt assembled by `formatEdgeAdjustment`. They name only the edited ordered ' +
      'endpoint pair and its influence-band change; neither branch reads an analysis result, ' +
      'selects an option by rank, or can assert a leading option. Unchanged set requests are ' +
      'refused before the handler and never reach this compose site.',
  },
};
const GOAL_TARGET_EDIT_SITES: Readonly<Record<string, RegisteredSite>> = {
  'outcome.assistant_text': {
    stance: 'structural',
    why:
      'ONE site, the same shape as factor-value-edit.ts. The value is the `add_constraint` ' +
      'handler\'s own receipt, passed straight through as `confirmation`. That text is ' +
      'assembled DETERMINISTICALLY in tools/handlers/add-constraint.ts (`fragments.join`) from ' +
      'module formatters over the edited node\'s label and the typed value; the handler declares ' +
      '`llm_calls_used: 0`, and the route test asserts no LLM adapter, no Anthropic transport and ' +
      'no fetch is reached. IT CANNOT ASSERT A LEADER: the goal is named by id from the wire ' +
      'event and must be `kind: goal`; the only other label it can interpolate is the ' +
      'correction alternative, which `findConstraintTargetAlternative` restricts to ' +
      '`kind === \'factor\'`. No comparison, ordering, probability or margin. The dispatch ' +
      'runs no analysis, so it withheld no verdict. Refusal branches compose via the ' +
      'recoverable-response composers keyed where those files are scanned.',
  },
};

const APPROVAL_SITES: Readonly<Record<string, RegisteredSite>> = {
  "text": {
    "stance": "structural",
    "why": "Named stored-card recovery or committed mutation receipt. No model call or analysis claim is composed here."
  },
  "otherHolds.notice === null ? receipt : appendLapseNotice(receipt": {
    "stance": "structural",
    "why": "Named stored-card recovery or committed mutation receipt. No model call or analysis claim is composed here."
  }
};
const COMPOSE_SITE_REGISTER: Readonly<Record<string, Readonly<Record<string,RegisteredSite>>>> = {
"handlers/chip-click-dispatch.ts": CHIP_CLICK_DISPATCH_SITES,
"compose/edit-clarify-response.ts": EDIT_CLARIFY_SITES,
"system-events/factor-value-edit.ts": FACTOR_VALUE_EDIT_SITES,
"system-events/edge-strength-edit.ts": EDGE_STRENGTH_EDIT_SITES,
"system-events/goal-target-edit.ts": GOAL_TARGET_EDIT_SITES,
"handlers/approve-held-proposal.ts": APPROVAL_SITES,
};
function composeCallPattern(): RegExp {
  return /compose(?:Answer|ToolCallResponse|ClarifyResponse|DirectAnswerResponse)\(\{/g;
}
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
function tally(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}
function qualify(file: string, key: string): string {
  return `${file}::${key}`;
}
function registerTally(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [file, sites] of Object.entries(COMPOSE_SITE_REGISTER)) {
    for (const [k, v] of Object.entries(sites)) out[qualify(file, k)] = v.count ?? 1;
  }
  return out;
}
function enumerateAllScannedSites(
  sources: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const key of enumerateComposeSites(source)) out.push(qualify(file, key));
  }
  return out;
}
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
describe('constraint-verdict compose census',()=>{
const sources = Object.fromEntries(Object.entries(SCANNED_FILES).map(([label,p])=>[label,readFileSync(p,'utf8')]));
const source=sources["handlers/approve-held-proposal.ts"]!;
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
    expect(domain).toContain('orchestrator-v5/handlers/approve-held-proposal.ts');
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
      qualify('handlers/approve-held-proposal.ts', 'totallyNewLeakySite'),
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
it('pins every remaining site and key, including the extracted writer',()=>{
expect(enumerateAllScannedSites(sources)).toHaveLength(10);
expect(Object.keys(registerTally())).toHaveLength(10);
expect(Object.keys(COMPOSE_SITE_REGISTER).sort()).toEqual(["compose/edit-clarify-response.ts","handlers/approve-held-proposal.ts","handlers/chip-click-dispatch.ts","system-events/edge-strength-edit.ts","system-events/factor-value-edit.ts","system-events/goal-target-edit.ts"]);
});
it('mutant: duplicating a registered receipt expression changes the multiset',()=>{
const key=qualify("handlers/approve-held-proposal.ts",'text');
const found=tally(enumerateAllScannedSites({...sources,["handlers/approve-held-proposal.ts"]:source+"\ncomposeDirectAnswerResponse({answerKind: 'functional', assistant_text: text, stage: 'frame'});"}));
expect(found[key]).toBe(registerTally()[key]!+1);
expect(found).not.toEqual(registerTally());
});
it('the retained writer reads the same scenario-scoped claim authority',()=>{
expect(source).toContain('readMayNameLeadingOptionVerdict(context.prior_facts, claimSafetyScopeFromContext(context))');
});
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
    // The goal-reading tail is the forwarder's own REBUILD from the handler's graph (AIQ 5895590866 (2)), passed in.
    expect(VALIDATION_REGISTRY).toContain('const goalReadingTail = goalReadingTailOf(outcome);');
    expect(VALIDATION_REGISTRY).toContain("if (isAllowedRunAnalysisAssistantText(candidate, goalReadingTail, '', comparisonPermitted)) {");
    expect(VALIDATION_REGISTRY).toContain(
      "const RUN_ANALYSIS_FALLBACK_TEXT = 'Ran analysis on your current scenario.';",
    );
  });

  it('chip-click confirmationText: HOP 3 — the text is headline ?? locked template', () => {
    // The load-bearing composition. If `summary` ever stops being
    // "withheld-able headline, else a locked template", the `gated` stance is
    // void — so the exact expression is pinned, not paraphrased.
    // Contract B (#3368): the canonical licence is the single headline owner;
    // the retired local withhold ternary must not become a second permission rule.
    expect(RUN_ANALYSIS).toContain(
      'const headlineParts = buildAnalysisResultHeadlineParts(headlineInput, headlineAuthority.licence);\n    const headline = headlineParts.text;',
    );
    // ROADMAP 2.579 added a THIRD disclosure slot, appended after the
    // constraint-gap one. The `gated` stance is unaffected and the pin is
    // updated rather than loosened: `summary` is still "withheld-able headline,
    // else a locked template", now with three additive suffixes in the order
    // `analysis-result-headline.ts`'s TAIL_PATTERN admits them. Re-pinning the
    // exact expression (not a paraphrase, not a substring of it) is what keeps
    // a future reordering visible here — an intake disclosure appended BEFORE
    // the constraint gap would compose a summary the egress allowlist rejects,
    // and the user would silently receive the bare template.
    // The objective-contradiction honesty surface (pricing-objective FINDINGS
    // fix 1) adds a FOURTH disclosure slot, appended after the intake one. The
    // `gated` stance is unaffected and the pin is UPDATED RATHER THAN LOOSENED,
    // for the reason the 2.579 note above gives: `summary` is still
    // "withheld-able headline, else a locked template", now with four additive
    // suffixes in the order `analysis-result-headline.ts`'s TAIL_PATTERN admits
    // them.
    //
    // ⚠ THIS PIN IS WHY THE FOURTH SLOT WAS REVIEWED AT ALL. It is a
    // hand-maintained mirror of one expression, and it did exactly the job it
    // exists for: the wiring lane's own local gate run reported the failure and
    // the required CI check named this line, so an unreviewed change to the
    // compose site could not land quietly. Keep re-pinning the EXACT expression
    // — a paraphrase, or a substring of it, would stop catching a reordering,
    // and a slot appended BEFORE the intake one composes a summary the egress
    // allowlist rejects, leaving the user with the bare template and no error
    // anywhere in the system.
    //
    // The unset-option-effect disclosure (2026-08-28) adds a FIFTH slot,
    // appended after the objective-contradiction one. Same treatment for the
    // same reasons: the `gated` stance is unaffected — `summary` is still
    // "withheld-able headline, else a locked template" — and the pin is UPDATED
    // RATHER THAN LOOSENED, so a future reordering stays visible here.
    //
    // ⚠ AND THE PIN EARNED ITS KEEP A THIRD TIME: this line is what caught the
    // fifth slot, in the lane's own required-gate run, before review. Note the
    // ordering constraint it protects is real for THIS slot too — the
    // unset-effect tail sits LAST in `analysis-result-headline.ts`'s
    // TAIL_PATTERN, so appending it anywhere earlier here would compose a
    // summary the egress allowlist rejects and the user would silently receive
    // the bare template.
    //
    // The run-level PARTICIPATION disclosure adds a SIXTH slot, appended after
    // the unset-option-effect one. Same treatment for the same reasons: the
    // `gated` stance is unaffected — `summary` is still "withheld-able
    // headline, else a locked template" — and the pin is UPDATED RATHER THAN
    // LOOSENED, so a future reordering stays visible here.
    //
    // ⚠ AND THE PIN EARNED ITS KEEP A FOURTH TIME, in the same way and for the
    // same reason as the fifth slot: `pnpm typecheck`, `eslint` and every
    // focused spec the lane ran were GREEN, and the required CI check named
    // this line. A static-source pin catches exactly the thing a behavioural
    // suite cannot see — a compose site that was edited without anyone looking
    // at the composition. The ordering constraint is real for this slot too:
    // the participation tail sits LAST in `analysis-result-headline.ts`'s
    // TAIL_PATTERN, so appending it anywhere earlier here would compose a
    // summary the egress allowlist rejects and the user would silently receive
    // the bare template.
    //
    // The withheld-SEPARABILITY disclosure adds a SEVENTH slot, appended after
    // the participation one. Same treatment for the same reasons — the pin is
    // UPDATED RATHER THAN LOOSENED — with one difference worth recording,
    // because it is the first slot for which it is true: this tail is NOT in
    // TAIL_PATTERN at all. It is registered LAST in
    // `TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS`, i.e. on the TEMPLATE branch only,
    // because it ships exclusively where `computeHeadline` returned
    // `text: null` under `options_not_separable`. So the ordering constraint it
    // protects is against `TEMPLATE_SUFFIX_ONLY_REGEX` rather than against
    // TAIL_PATTERN — and it is just as real: registered last, appended
    // anywhere earlier, the egress allowlist rejects the composed summary and
    // the user silently receives the bare template.
    //
    // ⚠ The `gated` stance is unaffected: `summary` is still "withheld-able
    // headline, else a locked template", and this tail can only ever ride the
    // locked-template arm.
    // Gate 1 v2 adds only this final pattern; the existing pinned composition stays verbatim below.
    expect(RUN_ANALYSIS).toContain('${separabilityDisclosure}${identicalArmsDisclosure}`;');
    expect(RUN_ANALYSIS).toContain(
      // D-ask-1 (2.11) applied to CEE-inferred FACTOR values adds an EIGHTH slot,
      // appended after the participation disclosure — the position its grammar
      // occupies in TAIL_PATTERN and in the egress registry. The `gated` stance
      // is unaffected: the new suffix names no option and asserts no leader.
      // Re-pinned exactly, not loosened, so a future reordering stays visible.
      // ⭐ Olumi's GOAL-READING tail (AIQ 5895590866 (2)) sits straight after the headline/template: the egress admits it
      // only by exact equality with the forwarder's own rebuild (`goalReadingTailOf`), at that position, never a pattern.
      // It names no option and asserts no leader, so the `gated` stance is unaffected.
      'const summary = `${summaryHeadline ?? template}${legacyFiguresDisclosure}${headlineDisclosures}${goalReadingDisclosure}${scaffoldDisclosure}${constraintGapDisclosure}${intakeDisclosure}${objectiveContradictionDisclosure}${unsetOptionEffectDisclosure}${participationDisclosure}${inferredValueDisclosure}${separabilityDisclosure}${identicalArmsDisclosure}`;',
    );
    expect(RUN_ANALYSIS).toContain('assistant_text: summary,');
    // ONE verdict, TWO consumers — the property that makes this `gated` rather
    // than "two derivations that happen to agree". The same object that gates
    // the headline is the one persisted and read back as mayNameLeadingOption.
    //
    // ROADMAP 2.579: the persisted permission is now the CONJUNCTION of that
    // verdict with the intake reconciliation, so the pin covers both halves.
    // `projectClaimSafety(constraintVerdict)` is still the sole source of the
    // constraint half — the intake wrapper can only ever REMOVE the permission,
    // never grant one the constraint verdict withheld, and it leaves
    // `constraint_verdict_state` untouched (CLAUDE.md trap 21: two authorities,
    // two questions, named apart rather than aligned).
    expect(RUN_ANALYSIS).toContain('projectClaimSafety(constraintVerdict),');
    // C46 stage 1 (#70 5841833807): a THIRD remove-only conjunct, outermost — the leader's sign on a product the
    // analysis adds up. It leaves `constraint_verdict_state` untouched, like the intake half.
    expect(RUN_ANALYSIS).toContain(
      'const leaderPermission = applyNonlinearIdentityToLeaderPermission(\n      applyIntakeToLeaderPermission(',
    );
    // The provisional/ratio-comparison/scope gates can only remove that permission; the reason is chosen by the common composer.
    expect(RUN_ANALYSIS).toContain(
      "constraint_verdict: keptOlumiProvisional || ratioOptionCompared\n          || (snapshot.goalScopeClaimInput !== undefined && snapshot.goalScopeClaimInput.status !== 'clear')\n          ? { ...leaderPermission, may_name_leading_option: false }\n          : leaderPermission,",
    );
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
