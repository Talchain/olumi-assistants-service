/**
 * Mem0 spike benchmark cases (exp/mem0-context-spike-20260929).
 *
 * Every case runs on Paul's REAL stored graph (`paul-cbd15f83-stored-graph.json`: Pro plan price £49, monthly churn 7%,
 * links price → price sensitivity → churn at 0.5 = "strong", churn limit ≤ 10%). The user lines are written in
 * Paul's register from his tests (DIAGNOSIS.md); the filler turns are long, as his were, so the older-words budget
 * (2,400 chars) is genuinely exceeded, as it is in a real 20-turn session.
 *
 * A case is a scripted conversation, the canonical state at the probe (graph mutations + revision + analysis state),
 * and deterministic expectations scored on the MODEL INPUT (Layer 1) and on the REPLY (Layer 2).
 */
import { readFileSync } from 'node:fs';

export interface Turn {
  readonly user: string;
  readonly olumi: string;
  /** The canonical graph revision when this turn ENDED (what `remember` stamps). */
  readonly rev: string;
}

export interface Expect {
  /** Each entry: words that must co-occur on ONE line of the model input (the fact AND what it is about). */
  readonly needed?: readonly (readonly string[])[];
  /** Strings that must never appear in the RECALL item (stale / superseded / conflicting / approval). */
  readonly notInRecall?: readonly string[];
  /** Strings that must never appear anywhere in the model input (cross-scenario sentinels). */
  readonly notInInput?: readonly string[];
  /** Strings the recall item must carry as an UNRECONCILED entry. */
  readonly unreconciled?: readonly string[];
  /** Layer 2: the reply must NOT match (re-asking for what was given; stale value as current; analysis claimed current). */
  readonly replyMustNot?: readonly { readonly id: string; readonly re: RegExp }[];
  /** Layer 2: the reply SHOULD match (the recalled fact used). */
  readonly replyShould?: readonly { readonly id: string; readonly re: RegExp }[];
}

export interface Case {
  readonly id: string;
  readonly title: string;
  /** DIAGNOSIS.md class this probes. */
  readonly klass: string;
  readonly turns: readonly Turn[];
  readonly probe: string;
  /** Canonical revision at the probe. */
  readonly rev: string;
  /** Graph edits applied to Paul's stored graph for the probe's canonical state. */
  readonly graphEdits?: (g: Graph) => void;
  readonly analysisState?: Record<string, unknown>;
  /** Simulate a deploy / restart before the probe: history reseeded from the last 20 durable rows as text. */
  readonly restart?: boolean;
  /** Another scenario, same user, whose memories must never appear here. */
  readonly otherScenario?: { readonly turns: readonly Turn[] };
  readonly expect: Expect;
}

export interface Graph { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; goal_constraints?: unknown[] }

export const paulGraph = (): Graph =>
  JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/agent-lane/__tests__/fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as Graph;

const setValue = (g: Graph, id: string, raw: number, display: string) => {
  const n = g.nodes.find((x) => x.id === id)!;
  n.observed_state = { ...(n.observed_state as Record<string, unknown>), raw_value: raw };
  n.display_value = display;
};

const BRIEF = 'We are a B2B SaaS for agencies. 250 Pro subscribers at £49 a month, about 20 new Pro subscribers a month, churn around 7% a month. '
  + 'Deciding whether to keep £49, raise Pro to £54 at the next release, or raise to £59. Goal: grow MRR without churn going above 10%.';
const BUILT = 'I have built a starting model from your brief: Pro plan price, new Pro subscribers, Pro subscribers, monthly churn and price sensitivity, with your three options. '
  + 'How strongly does the Pro plan price drive price sensitivity and churn: slight, moderate, strong or very strong?';

/** Long, realistic middle turns (Paul-like), each ~300 chars, so older user words overflow the 2,400-char budget. */
const FILLER: readonly Turn[] = [
  { user: 'On timing: the next release is planned for the second week of November, and sales want the new price announced at least 30 days before so existing customers are not surprised. Marketing would prefer to bundle it with the new reporting feature so the rise feels earned rather than arbitrary.', olumi: 'Noted: a November release, 30 days notice, and bundling with the reporting feature. I have not changed the model for this.', rev: 'r1' },
  { user: 'About acquisition: most new Pro customers come from the free tier after about six weeks, and the conversion rate from free to Pro has been fairly flat all year at around 3 to 4 percent. Paid ads bring a few but they are expensive and we have been cutting that budget since the summer.', olumi: 'Thanks. Free-to-Pro conversion is the main acquisition path; I will keep that in mind when we look at new Pro subscribers.', rev: 'r1' },
  { user: 'The finance team also asked me to check whether a price rise would affect the annual plan uptake. At the moment only about a fifth of Pro customers pay annually, and they get two months free, so a rise on the monthly price would make the annual discount look more attractive by comparison.', olumi: 'That is a useful second-order effect. It is not in the model yet; we can add annual uptake as a factor later if you want.', rev: 'r1' },
  { user: 'Support says the loudest complaints last time were from very small agencies, one or two people, who feel the Pro plan is priced for bigger teams. The bigger agencies barely mentioned the price at all; they mostly asked for more seats and better client reporting instead.', olumi: 'So sensitivity differs by agency size. The model treats price sensitivity as one factor today.', rev: 'r1' },
  { user: 'We are also thinking about grandfathering existing customers at £49 for six months, and only charging the new price to new sign-ups straight away. The CEO likes it because it protects goodwill, but finance worries it delays the MRR gain by half a year, which matters for the board.', olumi: 'Grandfathering is a real design choice. It would change when any MRR gain arrives, which the model does not represent over time.', rev: 'r1' },
  { user: 'For context on competitors: two direct competitors charge roughly £45 and £65 for their comparable tiers, and neither has changed price this year. We think we are seen as the mid-market option, with better client reporting than the cheaper one and less complexity than the expensive one.', olumi: 'Thanks. I have noted where you sit between the two competitors; no change to the model.', rev: 'r1' },
  { user: 'Operationally the change is easy: billing can switch prices at a release boundary and the pricing page is managed by marketing. The only real cost is the customer success time to handle questions in the first month, which we estimate at a few days of one person, nothing significant.', olumi: 'Understood: implementation cost is small. Nothing in the model depends on it.', rev: 'r1' },
  { user: 'One more thing from sales: they would like to test the higher price on new sign-ups from one region first, probably the UK, before rolling it out everywhere. They think a four-week test would be enough to see whether conversion from free to Pro drops noticeably at the higher price.', olumi: 'A regional test is a sensible option. Would you like me to add it as an option in the model?', rev: 'r1' },
  { user: 'Not yet, let us first see the result with the current three options. I would also like to understand which assumptions drive the answer most, because the board will ask what we are least sure about and I want a clear answer rather than a list of every factor.', olumi: 'Understood. When we run it I will show which assumptions matter most.', rev: 'r1' },
  { user: 'Also, customer success mentioned that churn spikes in January every year because agencies review their tools at the start of the year. It is seasonal and it happens regardless of price, so we should not read a January spike after a price rise as a reaction to the price itself.', olumi: 'Good caution: a January churn spike is seasonal. The model does not represent seasonality.', rev: 'r1' },
];

const convo = (head: readonly Turn[], tail: readonly Turn[] = []): Turn[] => [...head, ...FILLER, ...tail];

export const CASES: readonly Case[] = [
  {
    id: 'P1-strength-beyond-window',
    title: 'Paul: a strength the user gave early, far outside the window, never written to the model',
    klass: 'old-history loss + user fact not captured (DIAGNOSIS #1, #4)',
    turns: convo([
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      { user: 'It is a moderate effect. People grumble when it goes up, but very few actually leave over it.', olumi: 'Thanks, that is helpful context.', rev: 'r1' },
    ]),
    probe: 'Before we run it again: are you using what I told you about how strongly the price drives churn, or do you still need that from me?',
    rev: 'r1',
    expect: {
      needed: [['moderate', 'price']],
      unreconciled: ['moderate'],
      replyMustNot: [{ id: 're-asks strength', re: /(slight|moderate|strong)[^?]{0,40}(or|,)[^?]{0,40}(very strong|strong)\?|how strong(ly)? (is|does|would)/i }],
      replyShould: [{ id: 'uses moderate', re: /moderate/i }],
    },
  },
  {
    id: 'P2-figure-not-captured',
    title: 'Paul: a corrected churn figure the user stated, never written; the model still holds 7%',
    klass: 'user fact not captured canonically (DIAGNOSIS #2, #4, #8)',
    turns: convo([
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      { user: 'Strong, I would say. And one correction: monthly churn is actually 5% now, not 7%. We fixed onboarding in August.', olumi: 'Thanks. Let me know when you want to review the churn figure.', rev: 'r1' },
    ]),
    probe: 'What monthly churn figure is the model using at the moment?',
    rev: 'r1',
    expect: {
      needed: [['5%', 'churn']],
      unreconciled: ['5%'],
      replyShould: [{ id: 'mentions the user’s 5%', re: /5\s?%/ }, { id: 'states model 7%', re: /7\s?%/ }],
    },
  },
  {
    id: 'B-correction',
    title: 'Correction: user said 9%, then corrected to 7% (applied). Stale 9% must not drive the reply',
    klass: 'correction / supersession',
    turns: convo([
      { user: BRIEF.replace('churn around 7% a month', 'churn is something we track'), olumi: BUILT, rev: 'r1' },
      { user: 'Churn is around 9% a month, I think.', olumi: 'Noted 9% a month. Shall I set monthly churn to 9%?', rev: 'r1' },
      { user: 'Sorry, I misread the dashboard. Monthly churn is 7% a month.', olumi: 'Thanks, monthly churn is set to 7% a month.', rev: 'r2' },
    ]),
    probe: 'Remind me: what churn figure did I give you in the end?',
    rev: 'r2',
    expect: {
      needed: [['7%']],
      notInRecall: ['9%'],
      replyMustNot: [{ id: 'stale 9% as current', re: /\b9\s?%(?![^.]*(earlier|first|misread|correct|before|initial))/i }],
      replyShould: [{ id: 'says 7%', re: /7\s?%/ }],
    },
  },
  {
    id: 'C-cross-scenario',
    title: 'Isolation: same user, another scenario mentions KESTREL; this scenario must never see it',
    klass: 'cross-scenario isolation',
    turns: convo([{ user: BRIEF, olumi: BUILT, rev: 'r1' }]),
    otherScenario: {
      turns: [
        { user: 'Different decision: our main competitor is SENTINEL-KESTREL Analytics and they just cut prices by 20%.', olumi: 'Noted.', rev: 'x1' },
        { user: 'SENTINEL-KESTREL also launched a free agency tier last week.', olumi: 'Noted.', rev: 'x1' },
      ],
    },
    probe: 'Who did I say our main competitor is, and did they just cut prices?',
    rev: 'r1',
    expect: { notInInput: ['SENTINEL-KESTREL', 'KESTREL'], replyMustNot: [{ id: 'cross-scenario leak', re: /kestrel/i }] },
  },
  {
    id: 'D-canonical-moved',
    title: 'Canonical conflict: user said "Pro is £49", the model since moved to £50 (new revision)',
    klass: 'canonical conflict (fail closed)',
    turns: convo([
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      { user: 'Just to confirm the Pro plan price today is £49 a month.', olumi: 'Yes, the Pro plan price is £49 a month in the model.', rev: 'r1' },
    ], [{ user: 'We have rounded Pro up to £50 already, please update the Pro plan price.', olumi: 'Done: the Pro plan price is now £50 a month.', rev: 'r2' }]),
    probe: 'What Pro plan price is in the model right now?',
    rev: 'r2',
    graphEdits: (g) => setValue(g, 'pro_plan_price', 50, '£50'),
    expect: {
      needed: [['£50']],
      notInRecall: ['£49'],
      replyMustNot: [{ id: '£49 as current', re: /(is|at|currently|now)\s+£49\b/i }],
      replyShould: [{ id: 'says £50', re: /£50/ }],
    },
  },
  {
    id: 'D2-unreconciled',
    title: 'Discrepancy: user said "really £45 after discount", model holds £50, revision unchanged since',
    klass: 'user fact not captured → ask, never assume',
    turns: convo([
      { user: BRIEF, olumi: BUILT, rev: 'r2' },
      { user: 'In practice the Pro plan price is really £45 after the standard agency discount everyone gets.', olumi: 'Thanks for the context.', rev: 'r2' },
    ]),
    probe: 'Is the model using the price agencies actually pay?',
    rev: 'r2',
    graphEdits: (g) => setValue(g, 'pro_plan_price', 50, '£50'),
    expect: {
      needed: [['£45', 'price']],
      unreconciled: ['£45'],
      replyMustNot: [{ id: '£45 asserted as model value', re: /model (is using|uses|has) £45/i }],
      replyShould: [{ id: 'raises £45 vs £50', re: /£45[\s\S]{0,200}£50|£50[\s\S]{0,200}£45/ }],
    },
  },
  {
    id: 'E-analysis-stale',
    title: 'Analysis conflict: user remembered "analysis shows £59 wins"; canonical run is complete_stale',
    klass: 'analysis-state confusion (canonical-only)',
    turns: convo([
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      { user: 'Great, so the analysis shows raising to £59 wins. That is what I expected.', olumi: 'That run showed £59 ahead on MRR at that time.', rev: 'r1' },
    ], [{ user: 'I have changed churn to 6% after talking to finance.', olumi: 'Updated: monthly churn is 6%. The earlier analysis is now out of date.', rev: 'r2' }]),
    probe: 'So we are going with £59, since the analysis showed it wins?',
    rev: 'r2',
    graphEdits: (g) => setValue(g, 'monthly_churn', 6, '6%'),
    analysisState: { run_state: { kind: 'complete_stale', computed_at: '2026-09-29T09:05:00Z', cause: 'graph_changed' } },
    expect: {
      notInRecall: ['analysis shows', 'wins'],
      replyMustNot: [{ id: 'claims current analysis', re: /(the|current|latest) (analysis|results?) (shows?|confirms?)(?![^.]*(out of date|stale|earlier|before|re-?run))/i }],
      replyShould: [{ id: 'says stale / re-run', re: /(out of date|stale|re-?run|run (it|the analysis) again)/i }],
    },
  },
  {
    id: 'F-approval-isolation',
    title: 'Permission isolation: earlier "Yes, apply it" must not authorise a new model write',
    klass: 'consent (recall never approves)',
    turns: convo([
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      { user: 'Strong. Yes, apply it.', olumi: 'Applied: the price to price-sensitivity link is strong.', rev: 'r2' },
      { user: 'Go ahead and save the churn limit at 10% as well.', olumi: 'Saved: churn must stay at or below 10%.', rev: 'r3' },
    ]),
    probe: 'Also make the Pro plan price £55.',
    rev: 'r3',
    expect: { notInRecall: ['apply it', 'Go ahead', 'save the churn'] },
  },
  {
    id: 'S-salience-in-window',
    title: 'Salience: the fact is still inside the 8-turn window (recall only duplicates)',
    klass: 'recent-turn salience',
    turns: [
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      ...FILLER.slice(0, 4),
      { user: 'Remember our larger agencies are on annual contracts, so they cannot churn mid-year at all.', olumi: 'Noted: annual-contract agencies cannot churn mid-year.', rev: 'r1' },
      ...FILLER.slice(4, 6),
    ],
    probe: 'Does the 7% monthly churn assumption apply to the larger agencies too?',
    rev: 'r1',
    expect: { needed: [['annual contracts']], replyShould: [{ id: 'uses annual contracts', re: /annual/i }] },
  },
  {
    id: 'R-restart',
    title: 'Restart: a deploy reseeds history as text (last 20 rows); a fact from turn 3 of 24 is gone',
    klass: 'tool/history loss after restart (user words only)',
    turns: [
      { user: BRIEF, olumi: BUILT, rev: 'r1' },
      { user: 'Strong, I would say.', olumi: 'Thanks. Who are most of your Pro customers?', rev: 'r1' },
      { user: 'Most of our Pro customers are small creative agencies with 5 to 20 staff, mostly in the UK.', olumi: 'Thanks, that helps.', rev: 'r1' },
      ...FILLER, ...FILLER.slice(0, 10), ...FILLER.slice(0, 1),
    ],
    probe: 'Which customer segment did I say most Pro customers are in?',
    rev: 'r1',
    restart: true,
    expect: { needed: [['creative agencies']], replyShould: [{ id: 'recalls segment', re: /creative agenc|5 (to|-|–) ?20 staff/i }] },
  },
];
