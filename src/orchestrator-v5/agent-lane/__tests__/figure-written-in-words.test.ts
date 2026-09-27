/**
 * ⛔ A COUNT THE USER WROTE IN WORDS IS STILL THE USER'S (X1 option-change-not-atomic; Canonical #70 5859331002, DL
 * route 5859359015 → AIC).
 *
 * Served (DL pj-20260927T181846Z, journey E, turn E07): the user typed "We could also consider one senior and two
 * juniors." The Agent proposed the option, and the reply said "the hiring-count levels are not yet recorded by the
 * tool, so the option would still need 1 senior and 2 juniors set before analysis". The levels were dropped because
 * `figureTheUserWroteFor` read digits only: "1 senior and 2 juniors" grounds, "one senior and two juniors" did not.
 *
 * THE RULE: a number written in words (the repo's one cardinal grammar, `utils/cardinal-words.ts`: no articles, no
 * fractions) grounds a PLAIN figure exactly as its digits would, under the same clause-by-clause entity binding. It
 * never grounds money or a percentage ("two" is not £2 or 2%), because those kinds need their written unit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { figureTheUserWroteFor } from '../stated-by-user.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

// The served journey-E quantities (the E07 draft graph) and the option the Agent proposed.
const QUANTITIES = ['New senior engineers hired', 'New junior engineers hired', 'Annual salary spend'];
const OPTION = 'Hire one senior engineer and two junior engineers';
const scopeFor = (factor: string) => ({ target: [factor, OPTION], others: QUANTITIES.filter((l) => l !== factor) });
const SENIOR = scopeFor('New senior engineers hired');
const JUNIOR = scopeFor('New junior engineers hired');

const WORDS = 'We could also consider one senior and two juniors.';
const DIGITS = 'We could also consider 1 senior and 2 juniors.';

describe('a count written in words grounds exactly as its digits do', () => {
  it('RED: the served E07 message — 1 senior and 2 juniors are the user\'s levels', () => {
    expect(figureTheUserWroteFor(1, 'engineers', WORDS, SENIOR)).toBe(true);
    expect(figureTheUserWroteFor(2, 'engineers', WORDS, JUNIOR)).toBe(true);
  });

  it('words never ground a pair the digits do not (a count in words is held to a TIGHTER binding)', () => {
    for (const v of [1, 2, 3]) for (const scope of [SENIOR, JUNIOR]) {
      if (figureTheUserWroteFor(v, 'engineers', WORDS, scope)) {
        expect(figureTheUserWroteFor(v, 'engineers', DIGITS, scope), `${v} for ${scope.target[0]}`).toBe(true);
      }
    }
    expect(figureTheUserWroteFor(1, 'engineers', DIGITS, SENIOR), 'control: the digits ground').toBe(true);
  });

  it('RED (AIQ 5859477600): an idiomatic "one" beside no label word of the entity is never its 1; the digit form is unchanged', () => {
    const only = { target: ['New senior engineers hired'], others: [] as string[] };
    expect(figureTheUserWroteFor(1, 'engineers', "That's one option we could try.", only)).toBe(false);
    expect(figureTheUserWroteFor(1, 'engineers', 'One more thing: we need a senior engineer.', only)).toBe(false);
    expect(figureTheUserWroteFor(1, 'engineers', "That's 1 option we could try.", only), 'contrast: a written digit keeps today\'s reading').toBe(true);
    expect(figureTheUserWroteFor(1, 'engineers', 'We need one senior engineer.', only), 'control: beside its label word it grounds').toBe(true);
  });

  it('a figure the user did not write is still not theirs (3 is in neither form)', () => {
    expect(figureTheUserWroteFor(3, 'engineers', WORDS, SENIOR)).toBe(false);
  });

  it('RED: bound to its entity like digits — "two juniors" is the juniors\' 2, never the salary spend\'s', () => {
    const salaryOnly = { target: ['Annual salary spend'], others: ['New senior engineers hired', 'New junior engineers hired'] };
    const words = 'Salary spend stays under £400k and we hire two juniors.';
    const digits = 'Salary spend stays under £400k and we hire 2 juniors.';
    expect(figureTheUserWroteFor(2, 'engineers', words, JUNIOR)).toBe(true);
    expect(figureTheUserWroteFor(2, undefined, words, salaryOnly)).toBe(false);
    expect(figureTheUserWroteFor(2, undefined, digits, salaryOnly), 'control: digits bind the same way').toBe(false);
  });
});

describe('a word never stands in for money, a percentage, or an article', () => {
  it('"two" is never £2 or 2%: those kinds need their written unit', () => {
    const price = { target: ['Pro plan price'], others: ['Monthly churn'] };
    const churn = { target: ['Monthly churn'], others: ['Pro plan price'] };
    expect(figureTheUserWroteFor(2, 'GBP per month', 'Offer two price tiers.', price)).toBe(false);
    expect(figureTheUserWroteFor(2, '%', 'Churn could fall by two points.', churn)).toBe(false);
  });

  it('"a senior" is not 1, and "half" is not 0.5 (the grammar refuses articles and fractions)', () => {
    expect(figureTheUserWroteFor(1, 'engineers', 'We could hire a senior engineer.', SENIOR)).toBe(false);
    expect(figureTheUserWroteFor(0.5, undefined, 'Put half the budget into seniors.', SENIOR)).toBe(false);
  });
});

/**
 * THE SEAM: the real `proposeNewOption` over the SERVED journey-E graph (DL pj-20260927T181846Z, E07 `draft_graph`),
 * with the served message. The levels go out in the ONE proposal, as the user's (no `cee_hypothesis` stamp).
 */
describe('propose_new_option on the served E07 turn: the user\'s 1 and 2 ride the ONE proposal as theirs', () => {
  const eGraph = JSON.parse(readFileSync(new URL('./fixtures/journey-e-e07-draft-graph.json', import.meta.url), 'utf8')) as unknown;
  const setup = () => {
    const sent: { path: string; body: unknown }[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: eGraph, graph_hash: 'h0' } };
      sent.push({ path, body });
      return { status: 500, json: {} };
    };
    return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
  };
  type Iv = { factor_id: string; value: unknown; raw_value?: unknown; source?: unknown };
  const sentLevel = (sent: { body: unknown }[], id: string): Iv | undefined =>
    ((sent[0]?.body as { chip?: { parameters?: { interventions?: Iv[] } } } | undefined)?.chip?.parameters?.interventions ?? []).find((x) => x.factor_id === id);
  const propose = (message: string) => {
    const { caps, sent } = setup();
    return caps.proposeNewOption({ scenario_id: '550e8400-e29b-41d4-a716-4466554400e7', authenticated_user_id: null, request_id: 'r', user_text: message }, {
      label: OPTION,
      acts_on: [
        { factor_label: 'New senior engineers hired', direction: 'positive', level: { value: 1, unit: 'engineers' } },
        { factor_label: 'New junior engineers hired', direction: 'positive', level: { value: 2, unit: 'engineers' } },
      ],
      rationale: 'The user asked for it.',
    } as never).then((r) => ({ r: r as { levels_not_set?: unknown[] }, sent }));
  };

  it('RED: "one senior and two juniors" → senior 1 and junior 2 are sent as the user\'s levels, none left unset', async () => {
    const { r, sent } = await propose(WORDS);
    const senior = sentLevel(sent, 'new_senior_engineers_hired');
    const junior = sentLevel(sent, 'new_junior_engineers_hired');
    expect(senior?.raw_value, JSON.stringify(sent[0]?.body)).toBe(1);
    expect(junior?.raw_value).toBe(2);
    expect(senior?.source, 'the user\'s, not Olumi\'s estimate').toBeUndefined();
    expect(junior?.source).toBeUndefined();
    void r;
  });

  it('CONTROL: the digit form was already sent the same way', async () => {
    const { sent } = await propose(DIGITS);
    expect(sentLevel(sent, 'new_senior_engineers_hired')?.raw_value).toBe(1);
    expect(sentLevel(sent, 'new_junior_engineers_hired')?.raw_value).toBe(2);
  });

  it('CONTRAST: a count the user never wrote ("a senior and some juniors") is still sent unset', async () => {
    const { sent } = await propose('We could also consider a senior and some juniors.');
    expect(sentLevel(sent, 'new_senior_engineers_hired'), 'control: the option still links the factor').toBeDefined();
    expect(sentLevel(sent, 'new_senior_engineers_hired')?.value).toBeNull();
    expect(sentLevel(sent, 'new_junior_engineers_hired')?.value).toBeNull();
  });
});
