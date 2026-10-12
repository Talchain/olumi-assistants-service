/**
 * ⭐ B2-c (DL, 12 Oct; independent check FAIL on 3c7d1a71, E2 BLOCKING, its second instance-level miss): THE CLASS, GENERATED.
 * A duration is the team's time to finish only when the user's own statement attributes it to the team (positive
 * attribution, `team-share-write.ts`). Every other subject is refused, however the sentence is punctuated or ordered.
 *
 * Generated: subjects (20 non-team, 6 team) × durations (7 forms: single, approximate, range, "between", words, a year,
 * weeks) × punctuation and brackets (8 wraps) × clause orders (8 constructions) × quote forms (the figure alone, the whole
 * sentence) × where the words are (this message, an earlier message). The checker's two repros are rows of their own.
 *
 * Properties: (1) NO non-team subject is ever bound, in any generated sentence; (2) the team, named before its time in the
 * canonical orders, binds exactly the stated figure; (3) a sentence that names the team only AFTER the figure is refused
 * (conservative: asked, never misattributed); (4) the lists the rule reads hold no other-quantity word; (5) THIS message's
 * bare answer with a remark on confidence binds, and a remark that names anything else, or the same words in an earlier
 * message, is asked.
 */
import { describe, expect, it } from 'vitest';
import { ANSWER_CONFIDENCE_WORDS, bindTeamTimeQuote, readTeamTime, TEAM_AFTER_WORDS, TEAM_GAP_WORDS } from '../team-share-write.js';

const NON_TEAM = ['Recruitment', 'Hiring', 'Procurement', 'Onboarding', 'The notice period', 'The contract', 'Legal review',
  'The recruiter', 'The vendor', 'Security sign-off', 'Training', 'Budget approval', 'Finance', 'The new hire', 'The tech lead',
  'The other project', 'Testing', 'The migration', 'Their visa', 'Interviewing'];
const TEAM = ['The team', 'Our team', 'The current team', 'The developers', 'Our devs', 'We'];
const VERBS = ['takes', 'will take', 'needs', 'should take', 'would take', 'is', 'could take', 'is going to take'];
const DURATIONS: readonly (readonly [string, number, number])[] = (['7 months', 'about 7 months', '6–10 months', 'between 6 and 10 months',
  'seven months', 'a year', '30 weeks'] as const).map((d) => { const r = readTeamTime(d)!; return [d, r.low_months, r.high_months] as const; });
const WRAPS: readonly ((d: string) => string)[] = [
  (d) => d, (d) => `(${d})`, (d) => `[${d}]`, (d) => `(so, ${d})`, (d) => `— ${d}`, (d) => `, ${d}`, (d) => `: ${d}`, (d) => `“${d}”`,
];
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
/** Sentences in which `figure` belongs to the non-team subject `s` (with and without the team named elsewhere). */
const NON_TEAM_ORDERS: readonly ((s: string, v: string, figure: string) => string)[] = [
  (s, v, f) => `${s} ${v} ${f}.`,
  (s, v, f) => `The team will finish in 9 months; ${lower(s)} ${v} ${f}.`,
  (s, v, f) => `The team say ${lower(s)} ${v} ${f}.`,
  (s, v, f) => `We think ${lower(s)} ${v} ${f}.`,
  (s, v, f) => `${f} is what ${lower(s)} ${v}.`,
  (s, v, f) => `${s} ${v} ${f}, the team say.`,
  (s, v, f) => `The team are fine, but ${lower(s)} ${v} ${f}.`,
  (s, _v, f) => `The team need ${f} for ${lower(s)}.`,
];
const bind = (text: string, quote: string, low: number, high: number, where: 'now' | 'earlier') =>
  bindTeamTimeQuote(where === 'now' ? { now: text } : { now: 'Here is what I know.', conversation: text },
    { quote, low_months: low, high_months: high }, 'next feature launch');

describe('B2-c: the checker\'s repros', () => {
  it.each([
    ['The team will finish in 9 months; recruitment takes (7 months)', '7 months', 7],
    ['procurement takes 7 months', '7 months', 7],
  ])('%s → refused', (text, quote, p) => {
    for (const where of ['now', 'earlier'] as const) expect(bind(text, quote, p, p, where)).toMatchObject({ kind: 'refused' });
  });
  it('CONTRAST: the team\'s own figure in the first repro binds; Paul\'s own sentence binds with his low confidence', () => {
    expect(bind('The team will finish in 9 months; recruitment takes (7 months)', '9 months', 9, 9, 'earlier'))
      .toMatchObject({ kind: 'bound', time: { forecast_months: 9 } });
    const paul = "The team are currently telling me they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence in this because they keep missing deadlines.";
    expect(bind(paul, '7 months', 7, 7, 'earlier')).toMatchObject({ kind: 'bound', time: { forecast_months: 7, low_months: 3.5, high_months: 10.5, range_rule: 'low_confidence' } });
  });
});

describe('B2-c property 1: no non-team subject is ever bound', () => {
  it(`${NON_TEAM.length} subjects × ${VERBS.length} verbs × ${DURATIONS.length} durations × ${WRAPS.length} wraps × ${NON_TEAM_ORDERS.length} orders × 2 quotes × 2 places`, () => {
    const bound: string[] = [];
    let n = 0;
    for (const s of NON_TEAM) for (const v of VERBS) for (const [d, low, high] of DURATIONS) for (const wrap of WRAPS) for (const order of NON_TEAM_ORDERS) {
      const text = order(s, v, wrap(d));
      for (const quote of [d, text]) for (const where of ['now', 'earlier'] as const) {
        n += 1;
        if (bind(text, quote, low, high, where).kind === 'bound') bound.push(`${where} | ${quote === d ? 'figure' : 'sentence'} | ${text}`);
      }
    }
    expect(n).toBe(NON_TEAM.length * VERBS.length * DURATIONS.length * WRAPS.length * NON_TEAM_ORDERS.length * 4);
    expect(bound.slice(0, 20), `${bound.length} misattributed`).toEqual([]);
  });
});

describe('B2-c property 2: the team, named before its time, binds exactly the stated figure', () => {
  const TEAM_VERBS = ['will take', 'need', 'think it will take', 'say it will take', 'are telling me it will take', 'will finish in', 'expect to finish in'];
  const TEAM_WRAPS = WRAPS.filter((_w, i) => i !== 6); // ':' ends the statement, so "The team will take: 7 months" is asked.
  it(`${TEAM.length} team names × ${TEAM_VERBS.length} verbs × ${DURATIONS.length} durations × ${TEAM_WRAPS.length} wraps × 2 places`, () => {
    const wrong: string[] = [];
    for (const t of TEAM) for (const v of TEAM_VERBS) for (const [d, low, high] of DURATIONS) for (const wrap of TEAM_WRAPS) for (const where of ['now', 'earlier'] as const) {
      const verb = t === 'We' ? v.replace(/^are telling me/, 'are told').replace(/^say /, 'reckon ') : v;
      const text = `${t} ${verb} ${wrap(d)}.`;
      const r = bind(text, d, low, high, where);
      const ok = r.kind === 'bound' && (low === high
        ? r.time.forecast_months === low
        : r.time.low_months === low && r.time.high_months === high && r.time.forecast_months === undefined);
      if (!ok) wrong.push(`${where} | ${text} → ${JSON.stringify(r)}`);
    }
    expect(wrong.slice(0, 10), `${wrong.length} not bound`).toEqual([]);
  });
  it('the base whole-message answer still binds with no team named ("6–10 months", "It’ll take 6–10 months", "about 8 months")', () => {
    for (const [now, low, high] of [['6–10 months', 6, 10], ['It’ll take 6–10 months', 6, 10], ['about 8 months', 8, 8]] as const) {
      expect(bindTeamTimeQuote({ now }, { low_months: low, high_months: high }, 'next feature launch')).toMatchObject({ kind: 'bound' });
    }
  });
  it('CONTRAST: the same bare figure as a statement inside a longer message is NOT the whole answer, so it is asked', () => {
    expect(bind('Recruitment is slow. 7 months.', '7 months', 7, 7, 'now')).toMatchObject({ kind: 'refused' });
  });
});

describe('B2-c property 3: the team named only after the figure is asked, never bound', () => {
  it.each(TEAM)('%s, after the figure', (t) => {
    expect(bind(`7 months, ${lower(t)} say.`, '7 months', 7, 7, 'earlier')).toMatchObject({ kind: 'refused' });
  });
});

describe('B2-c property 4: the closed lists hold no other-quantity word', () => {
  it('no non-team subject word, and no delay or hiring word after the figure', () => {
    const subjectWords = new Set(NON_TEAM.flatMap((s) => s.toLowerCase().split(/[^\p{L}]+/u)).filter((w) => w !== '' && w !== 'the' && w !== 'their' && w !== 'other' && w !== 'new'));
    expect([...subjectWords].filter((w) => TEAM_GAP_WORDS.has(w) || TEAM_AFTER_WORDS.has(w) || ANSWER_CONFIDENCE_WORDS.has(w))).toEqual([]);
    expect(['late', 'early', 'behind', 'over', 'hire', 'hiring', 'recruit', 'notice', 'ago', 'delay', 'start', 'team', 'months', 'wrong', 'longer', 'more', 'less']
      .filter((w) => ANSWER_CONFIDENCE_WORDS.has(w))).toEqual([]);
    expect(['late', 'early', 'behind', 'over', 'hire', 'hiring', 'recruit', 'notice', 'ago', 'delay', 'start'].filter((w) => TEAM_AFTER_WORDS.has(w))).toEqual([]);
  });
});

describe('B2-c property 5: THIS message\'s answer with a remark on confidence', () => {
  const REMARKS = ["I'm not confident in that", "I'm not confident", 'We have no doubt', "I'm fairly sure", "I'm not very sure about this",
    'I have low confidence in that', "Honestly I'm not sure"];
  const JOINS: readonly ((a: string, r: string) => string)[] = [
    (a, r) => `${a}, but ${r}.`, (a, r) => `${a}. ${r}.`, (a, r) => `${r}: ${a}.`, (a, r) => `${r}. ${a}.`,
  ];
  it(`${DURATIONS.length} answers × ${REMARKS.length} remarks × ${JOINS.length} joins: bound to exactly the stated figure`, () => {
    const wrong: string[] = [];
    for (const [d, low, high] of DURATIONS) for (const r of REMARKS) for (const join of JOINS) {
      const now = join(d, r);
      const out = bindTeamTimeQuote({ now }, { quote: d, low_months: low, high_months: high }, 'next feature launch');
      const ok = out.kind === 'bound' && (low === high ? out.time.forecast_months === low
        : out.time.low_months === low && out.time.high_months === high && out.time.forecast_months === undefined);
      if (!ok) wrong.push(`${now} → ${JSON.stringify(out)}`);
    }
    expect(wrong.slice(0, 10), `${wrong.length} not bound`).toEqual([]);
  });
  it(`a remark naming anything else (${NON_TEAM.length} subjects), a remark with no confidence word, a second figure, or an earlier message → asked`, () => {
    const bound: string[] = [];
    for (const [d, low, high] of DURATIONS) for (const join of JOINS) {
      const cases: [string, 'now' | 'earlier'][] = [
        ...NON_TEAM.map((s): [string, 'now'] => [join(d, `I'm not sure about ${lower(s)}`), 'now']),
        ...NON_TEAM.map((s): [string, 'now'] => [join(d, `${s} is slow`), 'now']),
        [join(d, 'No'), 'now'], [join(d, "That's wrong"), 'now'], [join(d, "I'm not sure, maybe 12 months"), 'now'],
        ...REMARKS.map((r): [string, 'earlier'] => [join(d, r), 'earlier']),
      ];
      for (const [text, where] of cases) if (bind(text, d, low, high, where).kind === 'bound') bound.push(`${where} | ${text}`);
    }
    expect(bound.slice(0, 20), `${bound.length} bound`).toEqual([]);
  });
});
