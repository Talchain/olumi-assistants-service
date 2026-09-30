/**
 * ⛔ A USER'S LIMIT IS NEVER AN OPTION'S ACTION, AND THE DRAFTER'S WORD ALONE NEVER MAKES AN OPTION LINK THE USER'S
 * (AIQ role rule 5909030106; PTL 5909397701: B's executable counterexample becomes a regression fixture on the served
 * control; MG SUCCESSOR root cause, 30 Sep).
 *
 * Paul's brief: "Should we raise our Pro plan price from £49 to £59 a month? … Monthly churn must stay below 5% …".
 * The only ACTION the user wrote is the price rise: the £59 option sets the Pro plan price. "Monthly churn must stay
 * below 5%" is a LIMIT: it attests a constraint, never an option → churn intervention, whoever types it.
 *
 * MEASURED on the served control (`buildModelFromBrief` at staging f7c8c86a, 0 provider calls; the drafter's answer is a
 * real gpt-5.6-terra capture with P0's counterexample planted on it):
 *   · the drafter marks a link "Raise price to £59" → "Monthly churn" `explicit`: admission stamps the edge
 *     `brief_extraction` (the user's), because a link's `explicit` becomes the user's stamp for ANY link. The level-gap
 *     retry then asks the drafter to "give the level this option sets" on churn, and whether the drafter repeats the
 *     link, adds churn = 5 (the limit's own figure) as the option's action, or the retry fails, the user-stamped
 *     option → churn edge is registered;
 *   · the drafter gives the £59 option an `explicit` action "Monthly churn = 5 %": admission already keeps it as
 *     OLUMI's (`cee_hypothesis`), so no user authorship is claimed. That row is a CONTROL here. Whether an Olumi action
 *     at a limit's own figure is a role error is AIQ's open question: real cut-costs drafts give "switch to GCP" a
 *     downtime of 1, 1.5 or 2 weeks against the user's 2-week limit, so equality alone is not evidence.
 * The price action itself (59 on the price, the user's) is the control and must not move.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'mrr-drafter-answer-20260930.json'), 'utf8')) as { brief: string; raw: string };
const USER = new Set(['brief_extraction', 'user_specified', 'user_stated']);
const PRICE_59 = /59/;

const plant = (edit: (m: Rec) => void): string => { const m = JSON.parse(FIXTURE.raw) as Rec; edit(m); return JSON.stringify(m); };
const linkToChurn = (m: Rec) => { m.links.push({ from: 'Raise price to £59', to: 'Monthly churn', direction: 'positive', provenance: 'explicit' }); };
const limitAsAction = (m: Rec) => {
  for (const o of m.options) if (PRICE_59.test(o.label)) o.interventions.push({ factor_label: 'Monthly churn', value: 5, value_kind: 'absolute', unit: '%', provenance: 'explicit' });
};

/** The served path, 0 provider calls: each call returns the next drafter answer (a retry that repeats the last one). */
async function register(answers: string[]): Promise<Rec> {
  let registered: Rec | null = null; let i = 0;
  const call = (async () => ({ text: answers[Math.min(i++, answers.length - 1)], status: 'completed' })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { registered = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.includes('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as unknown as InternalDispatch;
  await buildModelFromBrief('00000000-0000-4000-8000-000000000059', FIXTURE.brief, dispatch, call);
  expect(registered).not.toBeNull();
  return registered!;
}

const nodes = (g: Rec): Rec[] => g.nodes ?? [];
const option59 = (g: Rec): Rec => { const o = nodes(g).find((n) => n.kind === 'option' && PRICE_59.test(String(n.label))); expect(o).toBeDefined(); return o!; };
const churnId = (g: Rec): string => { const c = nodes(g).find((n) => n.kind === 'factor' && /churn/i.test(String(n.label))); expect(c).toBeDefined(); return c!.id; };
const priceAction = (g: Rec) => Object.entries(option59(g).interventions ?? {}).find(([t]) => /price/i.test(t));
const userLinksToChurn = (g: Rec) => (g.edges ?? []).filter((e: Rec) => e.from === option59(g).id && e.to === churnId(g) && USER.has(String(e.provenance?.source)));
const userActionsOnChurn = (g: Rec) => nodes(g).filter((n) => n.kind === 'option').flatMap((n) =>
  Object.entries(n.interventions ?? {}).filter(([t, iv]: [string, any]) => t === churnId(g) && USER.has(String(iv?.source))));

describe('an option link or action the brief does not give is never the user\'s', () => {
  it('CONTROL — the untouched drafter answer: the £59 price action is the user\'s, the churn limit is a constraint, and no option link to churn is the user\'s', async () => {
    const g = await register([FIXTURE.raw]);
    const act = priceAction(g);
    expect(act?.[1]).toMatchObject({ raw_value: 59, source: 'brief_extraction' });
    expect((g.goal_constraints ?? []).some((c: Rec) => c.node_id === churnId(g) && c.value === 5 && c.provenance === 'explicit')).toBe(true);
    expect(userLinksToChurn(g)).toEqual([]);
  });

  it('a drafted "explicit" link from the £59 option to churn is never registered as the user\'s (the retry repeats it)', async () => {
    const g = await register([plant(linkToChurn)]);
    expect(userLinksToChurn(g)).toEqual([]);
    expect(priceAction(g)?.[1]).toMatchObject({ raw_value: 59, source: 'brief_extraction' });
  });

  it('…nor when the retry answers the level gap by making the churn LIMIT the option\'s action', async () => {
    const g = await register([plant(linkToChurn), plant((m) => { linkToChurn(m); limitAsAction(m); })]);
    expect(userLinksToChurn(g)).toEqual([]);
    expect(userActionsOnChurn(g)).toEqual([]);
  });

  it('CONTROL — the churn limit typed as the £59 option\'s "explicit" action is never the user\'s action', async () => {
    const g = await register([plant(limitAsAction)]);
    expect(userActionsOnChurn(g)).toEqual([]);
    expect((g.goal_constraints ?? []).some((c: Rec) => c.node_id === churnId(g) && c.value === 5)).toBe(true);
    expect(priceAction(g)?.[1]).toMatchObject({ raw_value: 59, source: 'brief_extraction' });
  });
});
