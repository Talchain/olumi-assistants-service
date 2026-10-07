/**
 * GOLDEN REGRESSION — Paul's blocked journey, 23 Sep 2026.
 *
 * ⛔ THE FIXTURE IS THE REAL PERSISTED GRAPH, captured from deployed staging
 * (scenario `399c2814`) after the session in which the product failed him. It
 * is not an invention of this author's, which matters: the whole defect was a
 * predicate that looked right against imagined data.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 * Readiness held exactly ONE blocking issue for thirty-seven minutes:
 *   OPTION_NEEDS_MAPPING — since 23 Sep: "Two Developers is linked straight to Coordination
 *   Overhead Risk? The proposed relationship is retained, but its mechanism
 *   and value still need clarification." (repairability: human_input_required)
 * "Hire a Tech Lead" was `status: ready` throughout.
 *
 * The product instead told him "'Two Developers' does not have effect values
 * yet" (it had two), and routed "just fix what's stopping me" to
 * `adjust_edge_strength`, which moved a number that could never satisfy a
 * mapping obligation.
 *
 * These assertions are what the user should have been told, derived from the
 * readiness authority and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildUnblockAnalysisAnswer } from '../unblock-analysis-answer.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  buildAnalysisRefusalReadiness,
} from '../../../orchestrator/tools/analysis-ready-helper.js';

const blockedGraph = JSON.parse(
  readFileSync('src/orchestrator-v5/routing/__tests__/fixtures/blocked-journey-graph.json', 'utf-8'),
) as unknown;

describe("Paul's blocked journey — the answer he should have received", () => {
  const readiness = buildCanonicalAnalysisReadyFromGraph(blockedGraph as never) as never;

  it('the real graph still reproduces the single blocker', () => {
    const r = readiness as { status?: string; readiness_issues?: readonly { code?: string }[] };
    expect(r.status).toBe('needs_user_mapping');
    expect(r.readiness_issues).toHaveLength(1);
    expect(r.readiness_issues?.[0]?.code).toBe('OPTION_NEEDS_MAPPING');
  });

  it('names the ONE blocker, in the readiness authority’s own words', () => {
    const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(readiness, {
      authorises_repair: true,
    });
    expect(assistant_text).toContain("One thing in your model isn't settled yet");
    expect(assistant_text).toContain('Coordination Overhead Risk');
    expect(offer_run_analysis).toBe(false);
  });

  it('does NOT repeat the false claim that sent him in circles', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    // The measured misdirection: "'Two Developers' does not have effect values yet."
    expect(assistant_text).not.toMatch(/no effect values|does not have effect values/i);
  });

  it('claims NO change it has not made, and does not promise an assumption it cannot supply', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    expect(assistant_text).toContain("I haven't changed anything");
    // repairability is human_input_required — an estimate cannot resolve it.
    // ⚠ Wording updated: the tail used to add "tell me the mechanism and I will
    // write it in", which PRESCRIBED a mapping remedy. On a real multi-issue
    // capture none of the issues was a mapping obligation, so that sentence was
    // a second opinion about what is wrong. It now states only what the payload
    // supports; the remedy stays in each issue's own quoted message.
    expect(assistant_text).toContain('only you can make');
    expect(assistant_text).not.toMatch(/\bI (?:have )?(?:updated|adjusted|applied|set)\b/i);
  });

  it('CONTROL: with no repair authorisation it offers nothing extra', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: false });
    expect(assistant_text).toContain("One thing in your model isn't settled yet");
    expect(assistant_text).not.toContain("I haven't changed anything");
  });
});

describe('buildUnblockAnalysisAnswer — the other states', () => {
  it('a ready model says so and offers the run', () => {
    const r = buildUnblockAnalysisAnswer({ status: 'ready', readiness_issues: [] }, { authorises_repair: false });
    expect(r.assistant_text).toContain('enough in it to compare the options');
    expect(r.offer_run_analysis).toBe(true);
  });

  it('an OFFERED obligation is never presented as blocking', () => {
    const r = buildUnblockAnalysisAnswer(
      {
        status: 'needs_user_mapping',
        readiness_issues: [{ code: 'X', message: 'optional extra', obligation: 'offered' }],
      },
      { authorises_repair: false },
    );
    // ⚠ THIS ASSERTION WAS CORRECTED, AND IT HAD ENCODED THE BUG. It used to
    // demand "Nothing is blocking the analysis" for a payload whose status is
    // `needs_user_mapping` — which is precisely the false readiness claim a
    // reviewer then found reachable from a real refusal producer. The real
    // property is narrower: an `offered` obligation is not LISTED as a blocker,
    // and readiness is still not claimed.
    expect(r.assistant_text).not.toContain('optional extra');
    expect(r.assistant_text).not.toMatch(/enough in it to compare/i);
    // ⚠ CORRECTED: this used to assert the raw status enum APPEARED in the
    // sentence — pinning the very leak a reviewer then found user-visible
    // ("the model is needs_user_input"). The real property is that the turn
    // refuses without printing an internal enum at the user.
    expect(r.assistant_text).toMatch(/cannot run yet/i);
    expect(r.assistant_text).not.toMatch(/needs_user_mapping/);
  });

  it('several blockers are listed, not summarised away', () => {
    const r = buildUnblockAnalysisAnswer(
      {
        status: 'needs_encoding',
        readiness_issues: [
          { code: 'A', message: 'first thing', repairability: 'auto' },
          { code: 'B', message: 'second thing', repairability: 'auto' },
        ],
      },
      { authorises_repair: true },
    );
    expect(r.assistant_text).toContain("2 things in your model aren't settled yet");
    expect(r.assistant_text).toContain('first thing');
    expect(r.assistant_text).toContain('second thing');
    // Repairable ones may be estimated — but only after the user says go.
    expect(r.assistant_text).toContain('Tell me to go ahead');
  });

  it('missing readiness says so rather than guessing', () => {
    const r = buildUnblockAnalysisAnswer(undefined, { authorises_repair: false });
    expect(r.assistant_text).toContain('could not read the model state');
    expect(r.offer_run_analysis).toBe(false);
  });
});

/**
 * ⛔ "NOTHING IS BLOCKING" IS ONLY SAYABLE ON AN EXPLICIT `ready`.
 *
 * The predicate was `status === 'ready' || blocking.length === 0`, so an empty
 * issue list alone produced the claim. A reviewer fed it a REAL production
 * producer and got the opposite of the truth — the payload said `blocked` and
 * named its blocker, and the answer said the model was ready to run.
 *
 * These bind the real producer, not a hand-authored shape, because the shape is
 * exactly what I got wrong.
 */
describe('a payload that says it is blocked is never called ready', () => {
  for (const code of ['NO_PATH_TO_GOAL', 'ORPHAN_NODE', 'NO_OPTIONS']) {
    it(`the real refusal producer for ${code} is not answered as ready`, () => {
      const readiness = buildAnalysisRefusalReadiness(code as never) as never;
      const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(readiness, {
        authorises_repair: false,
      });
      expect(assistant_text).not.toMatch(/enough in it to compare/i);
      expect(assistant_text).not.toMatch(/ready to run/i);
      expect(offer_run_analysis).toBe(false);
    });
  }

  it('it names the blocked_reason the payload gave, and claims no itemised list', () => {
    const readiness = buildAnalysisRefusalReadiness('NO_PATH_TO_GOAL' as never) as never;
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: false });
    expect(assistant_text).toContain('NO_PATH_TO_GOAL');
    expect(assistant_text).toContain('I do not have an itemised list');
  });

  it('CONTROL: an explicit ready IS answered as ready', () => {
    const r = buildUnblockAnalysisAnswer({ status: 'ready', readiness_issues: [] }, { authorises_repair: false });
    expect(r.assistant_text).toContain('enough in it to compare the options');
    expect(r.offer_run_analysis).toBe(true);
  });

  it('an unknown status with no issues is stated, not guessed', () => {
    const r = buildUnblockAnalysisAnswer({ status: 'needs_user_mapping' }, { authorises_repair: false });
    // Same correction: state the refusal, never the enum.
    expect(r.assistant_text).toMatch(/cannot run yet/i);
    expect(r.assistant_text).not.toMatch(/needs_user_mapping/);
    expect(r.assistant_text).not.toMatch(/enough in it to compare/i);
  });

  it('the repair tail sits on its own line after a LIST, not glued to the last item', () => {
    const r = buildUnblockAnalysisAnswer(
      {
        status: 'needs_encoding',
        readiness_issues: [
          { code: 'A', message: 'first thing', repairability: 'human_input_required' },
          { code: 'B', message: 'second thing', repairability: 'human_input_required' },
          { code: 'C', message: 'third thing', repairability: 'human_input_required' },
        ],
      },
      { authorises_repair: true },
    );
    expect(r.assistant_text).toContain("- third thing\nI haven't changed anything");
    expect(r.assistant_text).not.toContain("- third thing I haven't changed");
  });
});

/**
 * ⛔ THE TAIL MUST NOT PRESCRIBE A REMEDY — regression on a REAL captured graph.
 *
 * A reviewer fed `src/routes/__tests__/__fixtures__/scenario-graph-base-capture.json`
 * (a capture already in this repo, not a fixture of mine) through the SAME
 * producer the executor uses. The payload comes back blocked with MANY issues —
 * ORPHAN_NODE, OPTION_NO_FACTOR_EDGES, OPTION_NOT_LINKED_TO_DECISION,
 * NO_PATH_TO_GOAL — every one `human_input_required`, and none of them a
 * mapping obligation.
 *
 * The old tail answered: *"**This one** needs your answer rather than an
 * assumption from me — **tell me the mechanism** and I will write it in."*
 * Singular for many, and a MAPPING remedy for issues whose own messages say
 * "Add at least one factor edge" and "Link the decision to it". That is a
 * second opinion about what is wrong — precisely what this module's header
 * forbids and what its compose-site register entry claims it does not do.
 *
 * The golden regression above could not catch it: it covers the single
 * `OPTION_NEEDS_MAPPING` case, the one shape where that wording is true.
 */
describe('the repair tail on a real multi-issue capture', () => {
  const capture = JSON.parse(
    readFileSync('src/routes/__tests__/__fixtures__/scenario-graph-base-capture.json', 'utf-8'),
  ) as { graph: unknown };
  const readiness = buildCanonicalAnalysisReadyFromGraph(capture.graph as never) as never;

  it('the capture really does produce MANY human-input issues', () => {
    const r = readiness as { status?: string; readiness_issues?: readonly { repairability?: string }[] };
    expect(r.status).not.toBe('ready');
    expect((r.readiness_issues ?? []).length).toBeGreaterThan(1);
    expect((r.readiness_issues ?? []).every((i) => i.repairability === 'human_input_required')).toBe(true);
  });

  it('does NOT say "This one" when many things block', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    expect(assistant_text).not.toMatch(/This is a judgement only you can make/i);
    expect(assistant_text).toMatch(/These are judgements only you can make/i);
  });

  it('⛔ prescribes NO remedy of its own', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    // The remedy belongs to each issue's own quoted message, never to this tail.
    expect(assistant_text).not.toMatch(/tell me the mechanism/i);
    expect(assistant_text).not.toMatch(/I will write it in/i);
  });

  it('still lists every blocking issue, in the payload\u2019s own words', () => {
    const r = readiness as { readiness_issues?: readonly { message?: string }[] };
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    for (const issue of r.readiness_issues ?? []) {
      if (typeof issue.message === 'string' && issue.message.length > 0) {
        expect(assistant_text).toContain(issue.message);
      }
    }
    expect(assistant_text).toContain("I haven't changed anything");
  });

  it('CONTROL: the singular wording is still used for exactly one issue', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(
      { status: 'needs_user_mapping', readiness_issues: [{ code: 'A', message: 'one thing', repairability: 'human_input_required' }] },
      { authorises_repair: true },
    );
    expect(assistant_text).toMatch(/This is a judgement only you can make/i);
  });
});

/**
 * ⛔ ADMISSION IS `may_run`, NOT `status` — and this test must RED without the fix.
 *
 * A reviewer swept 61 canonical payloads and found **13 answered wrongly**: 12
 * `needs_user_input` and 1 `needs_user_mapping`, every one with `may_run: true`
 * and ZERO blocking issues. The user was told *"The analysis cannot run yet —
 * the model is needs_user_input. I do not have an itemised list…"* — both
 * clauses false, the raw enum leaked into prose, and no run offered, on a model
 * the product was perfectly willing to run.
 *
 * The contract is written down at `schemas/analysis-ready.ts:298-313`:
 * *"`status` is the STRICTER 'is this model ready as it stands?'. `may_run` is
 * [the run verdict]. Consumers gate on `may_run !== false` and fall back to
 * their existing [check]."*
 *
 * ⚠ THE REVIEWER'S MUTANT SURVIVED at the previous head because nothing pinned
 * this. These assertions exist so it cannot survive again.
 */
describe('admission is the run verdict, not the readiness status', () => {
  const shapes = [
    { status: 'needs_user_input', may_run: true, readiness_issues: [] },
    { status: 'needs_user_mapping', may_run: true, readiness_issues: [] },
    { status: 'needs_encoding', may_run: true, readiness_issues: [] },
  ];

  for (const r of shapes) {
    it(`may_run:true with status "${r.status}" is NOT refused`, () => {
      const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(r, {
        authorises_repair: false,
      });
      expect(assistant_text).not.toMatch(/cannot run yet/i);
      expect(assistant_text).toContain('enough in it to compare the options');
      expect(offer_run_analysis).toBe(true);
    });
  }

  it('⛔ the raw status enum never appears in prose', () => {
    for (const r of [...shapes, { status: 'needs_user_input', may_run: false, readiness_issues: [] }]) {
      const { assistant_text } = buildUnblockAnalysisAnswer(r, { authorises_repair: false });
      expect(assistant_text).not.toMatch(/needs_user_input|needs_user_mapping|needs_encoding/);
    }
  });

  it('CONTROL: may_run:false is still refused', () => {
    const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(
      { status: 'blocked', may_run: false, blocked_reason: 'NO_PATH_TO_GOAL', readiness_issues: [] },
      { authorises_repair: false },
    );
    expect(assistant_text).toMatch(/cannot run yet/i);
    expect(assistant_text).toContain('NO_PATH_TO_GOAL');
    expect(offer_run_analysis).toBe(false);
  });

  it('CONTROL: may_run ABSENT falls back to status, as the contract says', () => {
    expect(
      buildUnblockAnalysisAnswer({ status: 'ready', readiness_issues: [] }, { authorises_repair: false })
        .offer_run_analysis,
    ).toBe(true);
    expect(
      buildUnblockAnalysisAnswer({ status: 'needs_user_input', readiness_issues: [] }, { authorises_repair: false })
        .offer_run_analysis,
    ).toBe(false);
  });

  it('may_run:true WITH outstanding items says they do not stop the run', () => {
    const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(
      {
        status: 'needs_user_input',
        may_run: true,
        readiness_issues: [{ code: 'A', message: 'a tightenable thing', repairability: 'auto' }],
      },
      { authorises_repair: false },
    );
    expect(offer_run_analysis).toBe(true);
    expect(assistant_text).toMatch(/stop you comparing/i);
  });
});

/**
 * ⛔ A BLOCKER IS A GAP IN THE TEAM'S THINKING, NOT A GATE ON A MACHINE.
 *
 * Olumi's purpose (Paul, 23 Sep): *"a reasoning-enhancement system, not an
 * answer or decision engine … analysis describes what the current model
 * implies … model-relative findings for further reasoning, not
 * recommendations."*
 *
 * The earlier copy said "One thing is blocking the analysis", which frames
 * REACHING AN ANALYSIS as the goal and the issue as an obstacle. It is not:
 * `OPTION_NEEDS_MAPPING` means the team believes two things are connected and
 * has not said how — a causal belief the Living Model exists to expose "so [it]
 * can be expanded, challenged, tested and improved".
 *
 * These pin the framing, not the phrasing, so a future edit that drifts back to
 * gate-language fails.
 */
describe('the framing is reasoning, not gate-clearing', () => {
  const blocked = {
    status: 'needs_user_mapping',
    readiness_issues: [
      { code: 'OPTION_NEEDS_MAPPING', message: 'How does Two Developers change Coordination Overhead Risk?', repairability: 'human_input_required' },
    ],
  };

  it('does not describe the issue as blocking a machine', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(blocked, { authorises_repair: false });
    expect(assistant_text).not.toMatch(/blocking the analysis/i);
    expect(assistant_text).not.toMatch(/stopping the analysis/i);
    expect(assistant_text).toMatch(/your model/i);
  });

  it('still quotes the issue verbatim — the question is the point', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(blocked, { authorises_repair: false });
    expect(assistant_text).toContain('How does Two Developers change Coordination Overhead Risk?');
  });

  it("frames the outstanding item as the team's judgement, not a chore", () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(blocked, { authorises_repair: true });
    expect(assistant_text).toMatch(/judgement only you can make/i);
    expect(assistant_text).not.toMatch(/needs your (input|answer)/i);
  });

  it('an analysable model is described as CONDITIONAL, never as an answer', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(
      { status: 'ready', readiness_issues: [] },
      { authorises_repair: false },
    );
    expect(assistant_text).toMatch(/what THIS model implies/i);
    expect(assistant_text).toMatch(/given the assumptions in it/i);
    // ⛔ never language that implies the product produces the answer
    expect(assistant_text).not.toMatch(/\b(recommend|best option|you should|the answer)\b/i);
  });

  it('an estimate the product supplies is offered as ITS OWN, flagged', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(
      {
        status: 'needs_encoding',
        readiness_issues: [{ code: 'A', message: 'a thing', repairability: 'auto' }],
      },
      { authorises_repair: true },
    );
    expect(assistant_text).toMatch(/flagged as mine/i);
  });
});
