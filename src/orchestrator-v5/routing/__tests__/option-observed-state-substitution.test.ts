/**
 * ⭐⭐ THE OPTION-`observed_state` SUBSTITUTION — the wrong SEMANTIC CARRIER.
 *
 * Every graph in this file is CAPTURED, not authored: the three fixtures in
 * `fixtures/option-observed-state-substitution-capture.json` are the nodes and
 * edges of the authenticated readbacks an external auditor took on 30 Aug 2026
 * against deployed CEE `91d39119` / UI `525f8c32`, owned scenario
 * `0fe8c040-c47a-4010-b68e-9f42ccc275bf`. A fixture you wrote yourself is not
 * evidence about the wire (CLAUDE.md trap 16-inverse), and the whole point of
 * this seam is that nobody imagined the shape until it was witnessed.
 *
 * WHAT WAS WITNESSED. After a successful analysis the user typed, in plain
 * English: *"Revise Coverage Pilot to staff 30% of support hours, down from
 * 70%. Keep Current Coverage at 40%, and do not change any other values or
 * causal relationships."* The product held a two-option proposal, the user
 * clicked the product's OWN confirmation, and the reply was *"Confirmed: change
 * 'Coverage Pilot' to 30% and change 'Current Coverage' to 40%."*
 *
 * A real write landed — to the wrong carrier. Both OPTION nodes gained their
 * own `observed_state` (`70180763` value 30 / unit % / baseline 70;
 * `4bba0554` value 40 / unit %) while the canonical staffing interventions
 * stayed exactly `0.7` and `0.4`. The next rerun then said *"Since you changed
 * Coverage Pilot, the picture has stayed the same … the conclusion held both
 * before and after that change"* — a robustness claim about an input that
 * never moved.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  detectOptionOwnValueSubstitution,
  formatOptionOwnValueWithheldNotice,
  OPTION_OWN_VALUE_IS_NOT_AN_EFFECT_CARRIER,
} from '../option-observed-state-substitution.js';
import { decideOptionInterventionWrite } from '../option-intervention-write-guard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures/option-observed-state-substitution-capture.json'), 'utf8'),
) as Record<string, { nodes: unknown[]; edges: unknown[] }>;

/** Deep clone so a mutation in one case cannot leak into the next. */
function graph(key: string): { nodes: any[]; edges: any[] } {
  const g = CAPTURE[key];
  if (g === undefined) throw new Error(`capture fixture missing: ${key}`);
  return JSON.parse(JSON.stringify(g));
}

/** The two option ids and the one factor they are both wired to, by identity. */
const PILOT = '70180763';
const CURRENT = '4bba0554';
const STAFFED_COVERAGE = '0d2a1d17';

/** The natural sentence the auditor typed, and the product's own confirmation. */
const NATURAL_SENTENCE =
  'Revise Coverage Pilot to staff 30% of support hours, down from 70%. '
  + 'Keep Current Coverage at 40%, and do not change any other values or causal relationships.';

describe('the captured fixtures are the graphs they claim to be', () => {
  // A spec that reads a fixture must pin the fixture (trap 13b: a guard whose
  // discrimination depends on a fixture nothing pins stops discriminating in
  // silence the day the fixture is tidied).
  it('before: both options carry NO observed_state and their captured interventions', () => {
    const before = graph('before');
    const pilot = before.nodes.find((n) => n.id === PILOT);
    const current = before.nodes.find((n) => n.id === CURRENT);
    expect(pilot.kind).toBe('option');
    expect(pilot.label).toBe('Coverage Pilot');
    expect(pilot.observed_state).toBeUndefined();
    expect(pilot.interventions[STAFFED_COVERAGE].value).toBe(0.7);
    expect(current.observed_state).toBeUndefined();
    expect(current.interventions[STAFFED_COVERAGE].value).toBe(0.4);
    // The identity binding this seam names comes from the BEFORE graph's edges.
    expect(before.edges.some((e) => e.from === PILOT && e.to === STAFFED_COVERAGE)).toBe(true);
  });

  it('after the natural sentence: observed_state appears, interventions do NOT move', () => {
    const after = graph('after_natural_sentence');
    const pilot = after.nodes.find((n) => n.id === PILOT);
    expect(pilot.observed_state).toEqual({
      unit: '%',
      value: 30,
      source: 'user_override',
      baseline: 70,
    });
    expect(pilot.interventions[STAFFED_COVERAGE].value).toBe(0.7);
    const current = after.nodes.find((n) => n.id === CURRENT);
    expect(current.observed_state.value).toBe(40);
    expect(current.interventions[STAFFED_COVERAGE].value).toBe(0.4);
  });

  it('after the explicit control: the intervention moves .7 -> .3, observed_state does not', () => {
    const beforeControl = graph('after_natural_sentence');
    const afterControl = graph('after_explicit_control');
    const pilotBefore = beforeControl.nodes.find((n) => n.id === PILOT);
    const pilotAfter = afterControl.nodes.find((n) => n.id === PILOT);
    expect(pilotAfter.interventions[STAFFED_COVERAGE].value).toBe(0.3);
    expect(pilotAfter.interventions[STAFFED_COVERAGE].source).toBe('user_specified');
    expect(pilotAfter.observed_state).toEqual(pilotBefore.observed_state);
  });
});

describe('the premise, reproduced at this tip', () => {
  // Not a guard — evidence. The auditor's mechanism note says the existing
  // write guard ALLOWS this turn as `outcome_not_unhonoured`. If that ever
  // stops being true the premise of this whole module has changed and this
  // spec is the place that says so.
  it('the pre-existing intervention write guard allows the witnessed turn', () => {
    const verdict = decideOptionInterventionWrite({
      message: NATURAL_SENTENCE,
      before: graph('before'),
      after: graph('after_natural_sentence'),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'outcome_not_unhonoured' });
  });
});

describe('detectOptionOwnValueSubstitution — the spec', () => {
  // ⭐ THE INVARIANT IS WRITTEN AGAINST THE PRODUCER'S DECLARED SEMANTICS, not
  // against the sentence that exposed it. `src/prompts/edit-graph-v6.ts` states
  // the option template as `{ id, kind: "option", label, data: { interventions:
  // {} } }` and its permitted operation as "update_node on the option's
  // intervention data ONLY". An option holds no quantity of its own.
  it('states the spec it is derived from', () => {
    expect(OPTION_OWN_VALUE_IS_NOT_AN_EFFECT_CARRIER).toContain('interventions');
    expect(OPTION_OWN_VALUE_IS_NOT_AN_EFFECT_CARRIER.length).toBeGreaterThan(40);
  });

  it('S1 — WITHHOLDS the witnessed turn, naming BOTH options by identity', () => {
    const verdict = detectOptionOwnValueSubstitution({
      before: graph('before'),
      after: graph('after_natural_sentence'),
      appliedMutation: true,
    });
    if (verdict.verdict !== 'withhold') {
      throw new Error(`expected withhold, got allow:${verdict.reason}`);
    }
    // Bound by IDENTITY (id + label), never by "some node changed".
    const byId = new Map(verdict.substitutions.map((s) => [s.optionId, s]));
    expect([...byId.keys()].sort()).toEqual([CURRENT, PILOT].sort());
    const pilot = byId.get(PILOT)!;
    expect(pilot.optionLabel).toBe('Coverage Pilot');
    expect(pilot.from).toBeUndefined();
    expect(pilot.to).toBe(30);
    expect(pilot.unit).toBe('%');
    // The missing binding, resolved from the BEFORE graph's own edges.
    expect(pilot.linkedFactorLabels).toEqual(['Staffed Coverage']);
    const current = byId.get(CURRENT)!;
    expect(current.optionLabel).toBe('Current Coverage');
    expect(current.to).toBe(40);
  });

  it('S2 — the EXPLICIT POSITIVE CONTROL is untouched (acceptance 2)', () => {
    // "Set the effect of Coverage Pilot on Staffed Coverage to 0.3" — the real
    // intervention moves and no option's own value moves. This turn must be
    // allowed to persist exactly as it does today.
    const verdict = detectOptionOwnValueSubstitution({
      before: graph('after_natural_sentence'),
      after: graph('after_explicit_control'),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'no_option_own_value_write' });
  });

  it('S3 — an option whose OWN effect value ALSO moved is not a substitution', () => {
    // The opposite-direction twin of S1. Same wrong-carrier write, but this
    // turn genuinely moved the option's effect too, so nothing was substituted
    // and discarding it would destroy real work.
    const before = graph('before');
    const after = graph('after_natural_sentence');
    for (const n of after.nodes) {
      if (n.id === PILOT) n.interventions[STAFFED_COVERAGE].value = 0.3;
      if (n.id === CURRENT) n.interventions[STAFFED_COVERAGE].value = 0.45;
    }
    const verdict = detectOptionOwnValueSubstitution({
      before,
      after,
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'option_effect_write_landed' });
  });

  it('S4 — a SIBLING option\'s real write does not excuse this option\'s substitution', () => {
    // ⭐⭐ THE DISCRIMINATOR. `Current Coverage` gets a genuine effect write;
    // `Coverage Pilot` gets only the wrong-carrier one. A guard that asked
    // "did ANY effect value land?" would allow both — a value predicate a
    // sibling can satisfy (trap 19). Only `Coverage Pilot` may be named.
    const before = graph('before');
    const after = graph('after_natural_sentence');
    for (const n of after.nodes) {
      if (n.id === CURRENT) {
        n.interventions[STAFFED_COVERAGE].value = 0.45;
        // and its own value did NOT move on this turn
        delete n.observed_state;
      }
    }
    const verdict = detectOptionOwnValueSubstitution({
      before,
      after,
      appliedMutation: true,
    });
    if (verdict.verdict !== 'withhold') {
      throw new Error(`expected withhold, got allow:${verdict.reason}`);
    }
    expect(verdict.substitutions.map((s) => s.optionId)).toEqual([PILOT]);
  });

  it('S5 — a FACTOR baseline move is NOT this seam\'s business', () => {
    // The sibling guard (`option-intervention-write-guard.ts`) owns that
    // question and answers it with the user's message. Claiming it here would
    // be a second semantic owner for one fact (trap 21).
    const before = graph('before');
    const after = graph('before');
    const factor = after.nodes.find((n) => n.id === STAFFED_COVERAGE);
    expect(factor.kind).toBe('factor');
    factor.observed_state = { ...(factor.observed_state ?? {}), value: 0.9 };
    const verdict = detectOptionOwnValueSubstitution({
      before,
      after,
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'no_option_own_value_write' });
  });

  // ⭐ S5b — THE KIND FILTER IS PINNED FOR EVERY NON-OPTION KIND THE CAPTURED
  // GRAPH ACTUALLY CARRIES, DERIVED FROM THE FIXTURE RATHER THAN HAND-LISTED
  // (trap 12: a hand-maintained list of kinds would drift silently).
  //
  // Added because a mutant SURVIVED: widening the filter to
  // `kind !== 'option' && kind !== 'goal'` left all 25 tests green. A survivor
  // is a claim, and that one was NON-EQUIVALENT — it would have withheld a
  // legitimate goal-threshold edit. S5 alone only pinned `factor`.
  const NON_OPTION_KINDS = [
    ...new Set(
      graph('before')
        .nodes.filter((n) => n.kind !== 'option')
        .map((n) => n.kind as string),
    ),
  ];
  it('S5b — the captured graph carries the non-option kinds this case sweeps', () => {
    // Pin the precondition in-test: a sweep over an empty set asserts nothing.
    expect(NON_OPTION_KINDS.sort()).toEqual(
      ['decision', 'factor', 'goal', 'outcome', 'risk'].sort(),
    );
  });
  it.each(NON_OPTION_KINDS)(
    'S5b — a %s node whose own value moves is never claimed as an option substitution',
    (kind) => {
      const before = graph('before');
      const after = graph('before');
      const target = after.nodes.find((n) => n.kind === kind);
      expect(target).toBeDefined();
      target.observed_state = { ...(target.observed_state ?? {}), value: 0.9123 };
      expect(
        detectOptionOwnValueSubstitution({ before, after, appliedMutation: true }),
      ).toEqual({ verdict: 'allow', reason: 'no_option_own_value_write' });
    },
  );

  it('S6 — no applied mutation is nothing to withhold', () => {
    expect(
      detectOptionOwnValueSubstitution({
        before: graph('before'),
        after: graph('after_natural_sentence'),
        appliedMutation: false,
      }),
    ).toEqual({ verdict: 'allow', reason: 'no_write' });
  });

  it('S7 — an unparseable graph leaves today\'s behaviour byte-identical', () => {
    expect(
      detectOptionOwnValueSubstitution({
        before: { nodes: 'not a graph' },
        after: graph('after_natural_sentence'),
        appliedMutation: true,
      }),
    ).toEqual({ verdict: 'allow', reason: 'graph_unparseable' });
  });

  it('S8 — a REMOVED option value is a substitution too', () => {
    const before = graph('after_natural_sentence');
    const after = graph('after_natural_sentence');
    for (const n of after.nodes) if (n.id === PILOT) delete n.observed_state;
    const verdict = detectOptionOwnValueSubstitution({ before, after, appliedMutation: true });
    if (verdict.verdict !== 'withhold') {
      throw new Error(`expected withhold, got allow:${verdict.reason}`);
    }
    expect(verdict.substitutions.map((s) => s.optionId)).toEqual([PILOT]);
    expect(verdict.substitutions[0].from).toBe(30);
    expect(verdict.substitutions[0].to).toBeUndefined();
  });
});

describe('formatOptionOwnValueWithheldNotice — what the user reads', () => {
  const subs = [
    {
      optionId: PILOT,
      optionLabel: 'Coverage Pilot',
      from: undefined,
      to: 30,
      unit: '%',
      linkedFactorLabels: ['Staffed Coverage'],
    },
  ] as const;

  it('says plainly that nothing was saved, and never claims a commit', () => {
    const notice = formatOptionOwnValueWithheldNotice(subs);
    expect(notice.toLowerCase()).toContain('nothing');
    expect(notice).toContain('saved');
    // It must survive the finaliser's success-claim backstop, so it is phrased
    // as a negation and never as an acknowledgement.
    expect(notice).not.toMatch(/\b(confirmed|applied|updated|I've (set|changed))\b/i);
  });

  it('names the option, the human quantity in the user\'s own units, and the link', () => {
    const notice = formatOptionOwnValueWithheldNotice(subs);
    expect(notice).toContain('"Coverage Pilot"');
    expect(notice).toContain('30%');
    expect(notice).toContain('"Staffed Coverage"');
  });

  it('never spells the internal 0-1 scale at the user', () => {
    // Founder ruling: a strategic user must never be asked to understand
    // Olumi's internal normalised scale. `0.3` is a diagnostic probe, not copy.
    const notice = formatOptionOwnValueWithheldNotice(subs);
    expect(notice).not.toMatch(/0\.\d/);
    expect(notice).not.toMatch(/0\s*-\s*1|0 to 1|normalis/i);
  });

  it('asks which link the number belonged to', () => {
    expect(formatOptionOwnValueWithheldNotice(subs)).toContain('?');
  });

  it('degrades honestly when the option is wired to nothing nameable', () => {
    const notice = formatOptionOwnValueWithheldNotice([
      { ...subs[0], linkedFactorLabels: [] },
    ]);
    expect(notice.toLowerCase()).toContain('nothing');
    expect(notice).toContain('"Coverage Pilot"');
  });
});
