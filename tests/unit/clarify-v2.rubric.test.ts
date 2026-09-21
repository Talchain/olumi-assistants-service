/**
 * Clarify v2 rubric — table-driven completeness verdicts (E0-B, ROADMAP
 * 1.94 Option A replacement).
 *
 * RED-first: this file fails on base (module absent). The table pins the
 * capability's core promise against the retired clarifier's verified
 * failure mode: the old gate scored DRAFTER self-confidence and never
 * fired (0 questions in ≥7 days of staging logs); this rubric measures
 * the BRIEF, so thin briefs MUST be assessed incomplete and complete
 * briefs MUST pass silently.
 */
import { describe, it, expect } from "vitest";

import {
  assessBriefCompleteness,
  CLARIFY_V2_DIMENSIONS,
  CLARIFY_V2_DIMENSION_PRIORITY,
  CLARIFY_V2_DIMENSION_DETECTORS,
  isClarifyDimension,
} from "../../src/orchestrator-v5/clarify-v2/rubric.js";

describe("clarify_v2 rubric — completeness table", () => {
  // Each row: [name, brief, expected missing dimensions (priority order)].
  const TABLE: ReadonlyArray<[string, string, readonly string[]]> = [
    [
      "complete brief (goal + options + quantities + timeframe)",
      "Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?",
      [],
    ],
    [
      "complete brief with explicit goal clause",
      "Whether to launch in Germany or France next quarter — the goal is to increase revenue by 20%.",
      [],
    ],
    [
      "thin: bare decision question (nothing but the ask)",
      "Should we expand into the German market?",
      ["goal", "options", "timeframe", "quantities"],
    ],
    [
      "thin: options present, everything else missing",
      "Should we build the feature in-house or outsource it to an agency?",
      ["goal", "timeframe", "quantities"],
    ],
    [
      "thin: goal present, no alternatives, no scale, no horizon",
      "Should we adopt the new CRM in order to improve retention?",
      ["options", "timeframe", "quantities"],
    ],
    [
      "quantities only missing",
      "Should we hire a contractor or a permanent engineer this quarter? The goal is to reduce delivery risk.",
      ["quantities"],
    ],
    [
      "timeframe only missing",
      "Should we spend £50k on paid ads or on a sales hire? We want to increase qualified pipeline.",
      ["timeframe"],
    ],
    // ── Round-2 calibration corpus (PR #490 review P2) — permanent, both
    // directions. Direction A: natural complete briefs the launch batteries
    // missed ('choose between', 'success is defined as', 'weighing X
    // against Y') MUST be silent. Direction B: low-precision satisfiers
    // (adjectival 'target', bare year digits, determiner 'one', 'or not')
    // MUST NOT silence genuinely thin briefs.
    [
      "calibration A: 'choose between' + 'success is defined as' is complete",
      "We must choose between acquiring CompetitorX and building in-house; success is defined as 30% market share by 2027.",
      [],
    ],
    [
      "calibration A: 'weighing X against Y' + trying-to goal is complete",
      "We are weighing a merger against an IPO; we are trying to maximise shareholder value, roughly fifty million at stake, deadline end of March — which should we pursue?",
      [],
    ],
    [
      "calibration B: adjectival 'target' + bare year + 'one' do not fake goal/quantities",
      "Do we go after the target account list this 2026 or focus on the one big account?",
      ["goal", "quantities"],
    ],
    [
      "calibration B: 'one more review' is not a quantity",
      "To win, do we ship today or wait for one more review?",
      ["quantities"],
    ],
    [
      "calibration B: 'or not' is not a second alternative",
      "Should we renew the vendor contract or not this quarter?",
      ["goal", "options", "quantities"],
    ],
    [
      "calibration positive control: goal-construction 'the target is' still satisfies goal",
      "Should we double the sales team or invest in automation? The target is £2m ARR by Q4.",
      [],
    ],
    // ── a1/first-message-drafts (19 Jul journey probe) — a bare stated
    // duration / runway ("14 months") is a timeframe signal. Direction:
    // credit already-given horizon content so a brief that carries budget +
    // runway is not asked for a timeframe it already states. The probe brief
    // still misses GOAL (genuinely absent — asking it is legitimate); only
    // timeframe flips from missing → satisfied.
    [
      "runway credit: the journey probe (budget + 14-month runway) misses ONLY goal, not timeframe",
      "Should we hire a senior engineer now or wait until after our next funding round? Budget around £120k, current runway 14 months.",
      ["goal"],
    ],
    [
      "runway credit: a bare runway is the ONLY timeframe token and completes the brief",
      "Should we hire a senior engineer or wait, in order to extend our runway? The budget is around £120k and we have 14 months of cash left.",
      [],
    ],
    [
      "runway credit precision: the WORD compound 'four-day week' is NOT a timeframe (digit-anchored), so this thin brief still misses it",
      "Should we introduce a four-day week at the company?",
      ["goal", "options", "timeframe"],
    ],
    // ── Preference-goal credit (end-to-end journey 2026-07-25, Finding #4).
    // Direction A: a first-person PRIORITY statement IS a stated goal, and the
    // journey's verbatim brief must now be complete — 5 of 5 fresh users were
    // asked for the goal they had just given, offered "grow revenue" / "cut
    // costs", neither of which was it. Direction B: an intensifier is required,
    // so a bare "I care about ..." (a value, not an objective) must NOT silence
    // a thin brief.
    [
      "preference goal: the journey's VERBATIM brief is complete (was: missing goal)",
      "We run a 12-person specialty coffee roastery in Bristol. Wholesale to cafes is about 70% of our revenue but the margins are thin, and one single account is a quarter of that. I have around 80k I could invest. I'm trying to decide between opening our own retail shop, pushing a direct-to-consumer subscription, or just doubling down on wholesale and hiring another sales rep. I care most about profit in 2 years but I don't want to bet the company.",
      [],
    ],
    [
      "preference goal: 'what matters most is' satisfies goal",
      "Should we renew with the incumbent vendor or move to the challenger this quarter? What matters most is total cost over 3 years.",
      [],
    ],
    [
      "preference goal: 'our priority is' satisfies goal",
      "Do we ship the rewrite or patch the current stack next month? Our priority is uptime, and we have £40k to spend.",
      [],
    ],
    [
      "preference goal: 'optimising for' satisfies goal",
      "Should we run 2 campaigns or 5 this quarter? We are optimising for qualified pipeline on a £30k budget.",
      [],
    ],
    [
      "preference precision: a bare 'I care about' (no intensifier) does NOT fake a goal",
      "Should we introduce hot-desking at the company? I care about the team.",
      ["goal", "options", "timeframe", "quantities"],
    ],
    [
      "preference precision: 'the target account list' still does not fake a goal alongside a preference-free brief",
      "Do we go after the target account list this 2026 or focus on the one big account? I care about growth.",
      ["goal", "quantities"],
    ],
    // ── ROADMAP 2.162a — alternatives named as an ORDINARY SERIAL LIST, plus
    // the choice-set noun vocabulary. Direction A (missed satisfiers): the
    // commonest way people name alternatives in English — "A, B, and C" —
    // was credited by NOTHING in the options battery, so the intake asked
    // "What alternatives are you weighing this against?" over a brief that
    // had just named three. Direction B (over-matching satisfiers): ordinary
    // serial grammar is used for lots of things that are NOT alternatives,
    // and every one of those must still be asked.
    [
      "2.162a A: THE MINIMAL FAILING INPUT — a serial 'and' list of three alternatives satisfies options",
      "Should we rebuild billing in-house, buy Vendor A, and stay put?",
      ["goal", "timeframe", "quantities"],
    ],
    [
      "2.162a A: its one-character control (final 'and' → 'or') was already satisfied — the flip was one word",
      "Should we rebuild billing in-house, buy Vendor A, or stay put?",
      ["goal", "timeframe", "quantities"],
    ],
    [
      "2.162a A: 'and/or' is a disjunction — the bare-joiner arm required whitespace before 'or', which a slash is not",
      "Should we hire a lead, hire two juniors, outsource, and/or promote internally?",
      ["goal", "timeframe"],
    ],
    [
      "2.162a A: counted 'four ways' satisfies options …",
      "Should we modernise billing? There are four ways: rebuild, Vendor A, Vendor B, and stay put.",
      ["goal", "timeframe"],
    ],
    [
      "2.162a A: … identically to 'four routes' — the two noun lists in the rubric had drifted (trap 12)",
      "Should we modernise billing? There are four routes: rebuild, Vendor A, Vendor B, and stay put.",
      ["goal", "timeframe"],
    ],
    [
      "2.162a A: the colon/enumeration arm now carries routes|paths too",
      "Should we modernise billing? Routes: rebuild in-house, Vendor A, Vendor B.",
      ["goal", "timeframe", "quantities"],
    ],
    [
      "2.162a B: a GEOGRAPHY list is not alternatives — one action, three places — and must still be asked",
      "Should we launch in France, Spain and Italy this year? The goal is to grow revenue by 20% and the budget is £500,000.",
      ["options"],
    ],
    [
      "2.162a B: the same list WITH an Oxford comma defeats a comma-counting guard; the action-verb anchor is what rejects it",
      "Should we launch in France, Spain, and Italy this year? The goal is to grow revenue by 20% and the budget is £500,000.",
      ["options"],
    ],
    [
      "2.162a B: bulleted FACTS are not alternatives (no bullet-list arm ships — Slice B is deliberately not implemented)",
      "Should we expand into Europe next year?\n- Our revenue is £2m\n- We have 40 staff\n- Churn is 8%",
      ["goal", "options"],
    ],
    [
      "2.162a B: a serial list of facts under a choice lead is not alternatives",
      "Should we expand into Europe next year? We have 40 staff, £2m revenue, and 8% churn.",
      ["goal", "options"],
    ],
    [
      "2.162a B: a BUNDLE of things to hire is not a choice between them",
      "Should we hire a designer, a developer, and a PM?",
      ["goal", "options", "timeframe", "quantities"],
    ],
    [
      "2.162a B: a shopping list is not a choice set",
      "Should we buy laptops, monitors, and desks this year?",
      ["goal", "options", "quantities"],
    ],
    [
      "2.162a B: TWO items is not a serial list — the arm requires ≥3 verb-led items",
      "Should we rebuild billing in-house, and stay put?",
      ["goal", "options", "timeframe", "quantities"],
    ],
    [
      "2.162a B: 'and/or not' still restates the yes/no framing and names no second alternative",
      "Should we renew the vendor contract and/or not this quarter?",
      ["goal", "options", "quantities"],
    ],
    [
      "2.162a B: widening the noun set must not let a bare adjective fake an enumeration ('our plans are ambitious')",
      "Should we expand into Germany? Our plans are ambitious.",
      ["goal", "options", "timeframe", "quantities"],
    ],
    [
      "2.162a copula arm is UNCHANGED from pre-2.162a: 'our choices are limited' still credits options. A PRE-EXISTING false satisfied this lane does NOT fix — pinned so the residual is visible, not so it is endorsed",
      "Should we expand into Germany? Our choices are limited.",
      ["goal", "timeframe", "quantities"],
    ],
    [
      "2.162a positive control: a real two-item copula list still credits ('the candidates are A and B')",
      "Should we expand into Germany? The candidates are Alice and Bob.",
      ["goal", "timeframe", "quantities"],
    ],
    // ── ROADMAP 2.162a AMENDMENT ROUND. Adversarial review measured the first
    // cut against an UNTARGETED corpus of naturally-written thin briefs and
    // found 11 of 36 over-credited (base: 2 of 36) — every widened arm leaked,
    // and 11 briefs naming no alternatives scored COMPLETE and would have
    // proceeded silently, leaving the drafter to invent options. Every row
    // below is one of those leaks, pinned at the exact brief that found it.
    [
      "A1: a widened noun in ordinary COPULA prose is not an enumeration ('our plans are ambitious, but our budget is tight' — the first cut's 160-char list-guard fired on the subordinate clause's comma)",
      "Should we rebuild billing this year? Our plans are ambitious, but our budget is tight at £180,000 and the goal is to cut costs.",
      ["options"],
    ],
    [
      "A1: the same noun with a trailing clause and no punctuation list",
      "Should we expand into Germany next year? Our plans are still forming, the goal is to grow revenue, and we have £300,000.",
      ["options"],
    ],
    [
      "A1: a widened noun as a bare copula subject",
      "Should we rebuild the data warehouse this year? The paths are unclear, we want to reduce reporting lag, and it is a £250,000 project.",
      ["options"],
    ],
    [
      "A2: a COUNT in front of a widened noun counts failure modes, not alternatives ('three ways this could go wrong')",
      "Should we migrate to the new platform this quarter? There are three ways this could go wrong and the goal is to avoid downtime on a £90,000 budget.",
      ["options"],
    ],
    [
      "A2: … and outcomes ('two directions the market could move')",
      "Should we raise prices this year? There are two directions the market could move and we want to protect margin on £4m of revenue.",
      ["options"],
    ],
    [
      "A2 positive control: the SAME counted widened noun WITH a decision frame still credits",
      "We are considering three approaches to the billing rebuild this year.",
      ["goal"],
    ],
    [
      "A3: THE ONE-WORD BREAK — a serial list whose MIDDLE item is not an action. Verb at each end, junk between; the first cut scored this COMPLETE and proceeded silently",
      "Should we launch in France, Spain, Italy, and hire locally this year? The goal is to grow revenue by 20% and the budget is £500,000.",
      ["options"],
    ],
    [
      "A4: an ASSERTIVE lead announces a plan, not a choice — every item IS an action here, so only the lead can reject it",
      "We will launch in Q1, hire in Q2, and expand in Q3. The goal is to grow revenue by 30% on a £1m budget.",
      ["options"],
    ],
    [
      "A6: the serial arm must not depend on punctuation style — the same list without the Oxford comma credits",
      "Should we rebuild billing in-house, buy Vendor A and stay put?",
      ["goal", "timeframe", "quantities"],
    ],
  ];

  it.each(TABLE)("%s", (_name, brief, expectedMissing) => {
    const verdict = assessBriefCompleteness(brief);
    expect(verdict.missing).toEqual(expectedMissing);
    expect(verdict.complete).toBe(expectedMissing.length === 0);
  });

  it("NEVER-FIRES baseline is dead: at least one canonical thin brief is assessed incomplete", () => {
    // The retired clarifier's live behaviour was 0 questions on 100% of
    // firings. A rubric that returns complete for this brief would
    // reproduce that baseline and must fail here.
    const verdict = assessBriefCompleteness("Should we expand into the German market?");
    expect(verdict.complete).toBe(false);
    expect(verdict.missing.length).toBeGreaterThanOrEqual(1);
  });

  it("verdict is deterministic (identical input, identical output)", () => {
    const brief = "Should we build or buy the analytics stack?";
    const a = assessBriefCompleteness(brief);
    const b = assessBriefCompleteness(brief);
    expect(a).toEqual(b);
  });

  it("missing dimensions come back in priority order (goal > options > timeframe > quantities)", () => {
    const verdict = assessBriefCompleteness("Should we expand into the German market?");
    expect(verdict.missing).toEqual(CLARIFY_V2_DIMENSION_PRIORITY);
  });
});

describe("clarify_v2 rubric — surface integrity", () => {
  it("priority order covers exactly the dimension set (derived, no drift)", () => {
    expect([...CLARIFY_V2_DIMENSION_PRIORITY].sort()).toEqual(
      [...CLARIFY_V2_DIMENSIONS].sort(),
    );
  });

  it("every dimension has a non-empty detector battery", () => {
    for (const dim of CLARIFY_V2_DIMENSIONS) {
      expect(CLARIFY_V2_DIMENSION_DETECTORS[dim].length).toBeGreaterThan(0);
    }
  });

  it("isClarifyDimension accepts the set and rejects strangers", () => {
    for (const dim of CLARIFY_V2_DIMENSIONS) expect(isClarifyDimension(dim)).toBe(true);
    expect(isClarifyDimension("confidence")).toBe(false);
    expect(isClarifyDimension("")).toBe(false);
    expect(isClarifyDimension(42)).toBe(false);
  });
});
