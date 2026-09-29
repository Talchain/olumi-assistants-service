/**
 * ⛔ AN OPTION LINKED STRAIGHT TO A RISK MAKES THE WHOLE MODEL UNANALYSABLE.
 *
 * DEFECT 1 of Paul's hiring case, measured on the capture named below. The
 * drafter is told "THE GOAL METRIC MUST BE THE TERMINAL NODE. Every option needs
 * a causal path that ends at the goal metric", and `option -> risk -> goal` is
 * the shortest path that satisfies it — so the drafter takes it. Nothing in the
 * construction contract forbids it: the risk clause only says "Give every risk a
 * link to what it threatens", which constrains what comes OUT of a risk and says
 * nothing about what may go IN, and `links[].from`/`to` are free labels.
 *
 * Readiness then refuses that exact shape. `cee/transforms/analysis-ready.ts`
 * (the `buildAnalysisReadyPayload` prologue) reads:
 *
 *     const unresolved = graph.edges.filter((edge) =>
 *       edge.from === option.id && nodeById.get(edge.to)?.kind === "risk"
 *       && edge.edge_type !== "bidirected",
 *     );
 *     if (unresolved.length === 0) return option;
 *     return { ...option, status: "needs_user_mapping", …
 *
 * so ANY directed option -> risk edge forces `needs_user_mapping` on that
 * option, which `analysis-ready-helper.ts` mints as `OPTION_NEEDS_MAPPING`, and
 * the model cannot be run. MEASURED on the capture below plus that one link:
 * `optionsNeedingMapping` 0 -> 1, the blocker reading
 *
 *     "How does Hire a Tech Lead change Hiring delay? The proposed relationship
 *      is retained, but its mechanism and value still need clarification."
 *
 * on an edge with `provenance.source: "cee_hypothesis"` and `defaulted: true` —
 * Olumi's own hypothesis, blocking Olumi's own analysis.
 *
 * ⛔ THE REPAIR IS NOT MEDIATOR SYNTHESIS. Inventing the missing `factor -> risk`
 * link would mean choosing a direction nobody stated, which Release Control #63
 * 5793252993 forbids and which `admit-model.ts` already records as removed by
 * ruling for the `factor -> goal` case. It is not a deletion either: the
 * hypothesis and its uncertainty are the user's to keep.
 *
 * So there are exactly two honest outcomes, and this file pins both:
 *
 *   A. THE MECHANISM IS ALREADY IN THE MODEL. The drafter itself stated
 *      `Tech leads hired -> Hiring delay`, and the option acts on
 *      `Tech leads hired`. The direct edge is that same belief stated twice —
 *      the same defect the file's "ONE CONNECTION, ONE EDGE" repair already
 *      handles for `option -> factor`. The shortcut is folded onto the
 *      mechanism, recorded in `loss`, and the risk keeps its incoming link.
 *   B. THERE IS NO MECHANISM. The edge is KEPT — the risk is not deleted, no
 *      sign is invented, `may_run` is not forced — and an explicit actionable
 *      repair proposal is recorded and surfaced in the build result's
 *      `not_represented`, which is the channel the Agent says out loud.
 *
 * THE CAPTURE. `fixtures/live-hiring-envelope-candidate-20260923.json`, whose
 * own `_provenance` reads "2026-09-23, live gpt-5.6-terra via /v1/responses,
 * buildCandidateSchema() at the Path A contract, brief: Should I hire a Tech
 * lead or two developers to increase velocity? … byte-for-byte model output".
 * Every arm below is that capture with ONE field varied — its `links` array —
 * and the varied value is the shape witnessed in Paul's draw (four direct
 * option -> risk hypotheses) and independently in
 * `src/orchestrator-v5/routing/__tests__/fixtures/blocked-journey-graph.json`
 * ("Two Developers" -> "Coordination Overhead Risk"). No arm is self-authored.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_INSTRUCTIONS,
  buildModelFromBrief,
  type CallStructuredModel,
} from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const CAPTURE = 'live-hiring-envelope-candidate-20260923.json';
const SCENARIO = '44444444-4444-4444-8444-444444444444';
const BRIEF = 'Should I hire a Tech lead or two developers to increase velocity?';
const BANKED = (
  JSON.parse(readFileSync(join(__dirname, 'fixtures', CAPTURE), 'utf8')) as { candidate: CandidateModel }
).candidate;

/** Identities, not positions: the ids admission assigns to the capture's labels. */
const OPTION = 'hire_a_tech_lead';
const RISK = 'hiring_delay';
const MEDIATOR = 'tech_leads_hired';
const GOAL = 'velocity';

/** Paul's draw: the option linked straight at the risk, as Olumi's own hypothesis. */
const SHORTCUT = { from: 'Hire a Tech Lead', to: 'Hiring delay', direction: 'positive', provenance: 'ai_proposed' };
/** The mechanism the capture itself states, and which arm B removes. */
const MECHANISM = { from: 'Tech leads hired', to: 'Hiring delay' };

type RawLink = { from: string; to: string; direction: string; provenance: string };
const links = (c: CandidateModel) => c.links as unknown as RawLink[];

/** The capture, with the shortcut added. Its own mechanism is untouched. */
function withShortcut(): CandidateModel {
  return { ...BANKED, links: [...links(BANKED), SHORTCUT] } as unknown as CandidateModel;
}
/** The capture, with the shortcut added AND the mechanism it shortcuts removed. */
function withShortcutAndNoMechanism(): CandidateModel {
  return {
    ...BANKED,
    links: [
      ...links(BANKED).filter((l) => !(l.from === MECHANISM.from && l.to === MECHANISM.to)),
      SHORTCUT,
    ],
  } as unknown as CandidateModel;
}

const mappingBlockers = (a: { nodes: readonly unknown[]; edges: readonly unknown[] }) =>
  assessCanonicalAnalysisReadiness({ nodes: a.nodes, edges: a.edges })
    .issues.filter((i) => i.code === 'OPTION_NEEDS_MAPPING')
    .map((i) => ({ option_id: i.option_id, message: i.message }));

const edge = (a: ReturnType<typeof admitCandidateModel>, from: string, to: string) =>
  a.edges.find((e) => e.from === from && e.to === to);

const lossAt = (a: ReturnType<typeof admitCandidateModel>, path: string) =>
  a.loss.find((l) => l.field_path === path);

function reaches(a: ReturnType<typeof admitCandidateModel>, from: string, to: string): boolean {
  const out = new Map<string, string[]>();
  for (const e of a.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const x = stack.pop()!;
    if (x === to) return true;
    for (const y of out.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}

describe(`CONTRAST CONTROL — the unvaried capture (${CAPTURE})`, () => {
  const a = admitCandidateModel(BANKED, {});

  it('carries NO option -> risk edge and NO OPTION_NEEDS_MAPPING', () => {
    const kind = new Map(a.nodes.map((n) => [n.id, n.kind]));
    expect(a.edges.filter((e) => kind.get(e.from) === 'option' && kind.get(e.to) === 'risk')).toEqual([]);
    expect(mappingBlockers(a)).toEqual([]);
  });

  it('states the mechanism this fix relies on, so the arms below differ in ONE link', () => {
    // The drafter's own `Tech leads hired -> Hiring delay`, and the option acting
    // on `Tech leads hired` through its stated intervention.
    expect(edge(a, MEDIATOR, RISK)?.effect_direction).toBe('positive');
    expect(edge(a, OPTION, MEDIATOR)).toBeDefined();
    expect(a.nodes.find((n) => n.id === RISK)?.kind).toBe('risk');
  });
});

describe('the construction contract forbids the shortcut at the producer', () => {
  it('tells the drafter to route an option to a risk through a factor', () => {
    expect(BUILD_INSTRUCTIONS).toContain('NEVER LINK AN OPTION STRAIGHT TO A RISK');
    expect(BUILD_INSTRUCTIONS).toContain('it is the factor that raises or lowers the risk');
  });
});

describe('A — the model already states the mechanism: the shortcut is folded onto it', () => {
  const a = admitCandidateModel(withShortcut(), {});

  it('RED: the option is no longer blocked by OPTION_NEEDS_MAPPING', () => {
    expect(mappingBlockers(a)).toEqual([]);
  });

  it('the direct option -> risk edge is gone and the mechanism carries the hypothesis', () => {
    expect(edge(a, OPTION, RISK)).toBeUndefined();
    // Nothing was deleted: the risk keeps its incoming link and still reaches the
    // goal, and the option still reaches the risk THROUGH the stated mediator.
    expect(edge(a, MEDIATOR, RISK)?.effect_direction).toBe('positive');
    expect(reaches(a, OPTION, RISK)).toBe(true);
    expect(reaches(a, RISK, GOAL)).toBe(true);
    expect(a.nodes.find((n) => n.id === RISK)?.kind).toBe('risk');
  });

  it('records the fold, naming the mediator — nothing silent', () => {
    const l = lossAt(a, `edges[${OPTION}::${RISK}].mechanism`);
    expect(l, 'the fold must be recorded in loss').toBeDefined();
    expect(l!.reason).toContain('Tech leads hired');
    expect(l!.reason).toContain('Hiring delay');
    expect(l!.severity).toBe('info');
  });
});

/**
 * ⛔ A SHORTCUT THE **USER** STATED IS NOT OLUMI'S TO FOLD (Panel review
 * 5793954535, B2). Folding it would move their claim onto a link they did not
 * draw and strip the `brief_extraction` stamp that `brief_stated_keys.edges` and
 * `keepsEveryUserStatedIdentity` read. So it is left exactly as stated, and the
 * ask the user already gets from readiness — which names the risk in their own
 * label — is the channel, not a rewrite behind their back.
 */
describe('the user\u2019s own option -> risk link is left exactly as stated', () => {
  const stated = {
    ...BANKED,
    links: [...links(BANKED), { ...SHORTCUT, provenance: 'explicit' }],
  } as unknown as CandidateModel;
  const a = admitCandidateModel(stated, {});

  it('is kept with the user\u2019s authorship, and is NOT folded onto the mechanism', () => {
    const e = edge(a, OPTION, RISK);
    expect(e, 'the user\u2019s stated link must survive').toBeDefined();
    expect(e!.provenance?.source).toBe('brief_extraction');
    expect(lossAt(a, `edges[${OPTION}::${RISK}].mechanism`)).toBeUndefined();
    // The mechanism it shortcuts is still there too — both, because neither was touched.
    expect(edge(a, MEDIATOR, RISK)?.effect_direction).toBe('positive');
  });

  it('and readiness still asks the user about it, by identity', () => {
    expect(mappingBlockers(a)).toEqual([
      {
        option_id: OPTION,
        message:
          'How does Hire a Tech Lead change Hiring delay? The proposed relationship is retained, '
          + 'but its mechanism and value still need clarification.',
      },
    ]);
  });
});

describe('B — no mechanism exists: the risk is KEPT and a repair proposal is raised', () => {
  const a = admitCandidateModel(withShortcutAndNoMechanism(), {});

  it('the option -> risk hypothesis is NOT deleted and no sign is invented', () => {
    const e = edge(a, OPTION, RISK);
    expect(e, 'the hypothesis must survive when there is no mechanism to fold it onto').toBeDefined();
    expect(e!.effect_direction).toBe('positive');
    expect(e!.provenance?.source).toBe('cee_hypothesis');
    expect(edge(a, MEDIATOR, RISK)).toBeUndefined();
  });

  it('may_run is NOT forced: the blocker stays, by identity', () => {
    expect(mappingBlockers(a)).toEqual([
      {
        option_id: OPTION,
        message:
          'How does Hire a Tech Lead change Hiring delay? The proposed relationship is retained, '
          + 'but its mechanism and value still need clarification.',
      },
    ]);
  });

  it('RED: an explicit actionable repair proposal is recorded', () => {
    const l = lossAt(a, `edges[${OPTION}::${RISK}].mechanism_missing`);
    expect(l, 'a missing mechanism must raise a repair proposal').toBeDefined();
    expect(l!.severity).toBe('warn');
    expect(l!.reason).toContain('Hire a Tech Lead');
    expect(l!.reason).toContain('Hiring delay');
    // Actionable: it names the step the user can take, not just the problem.
    expect(l!.reason).toMatch(/which factor/i);
  });

  it('RED: the proposal is surfaced to the user in the build result', async () => {
    const fn = vi.fn(async () => ({ text: JSON.stringify(withShortcutAndNoMechanism()) })) as unknown as CallStructuredModel;
    const d: InternalDispatch = async () => ({ status: 200, json: { registered: true } });
    const out = await buildModelFromBrief(SCENARIO, BRIEF, d, fn);
    expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
    const said = (out['not_represented'] as string[]) ?? [];
    expect(
      said.filter((s) => s.includes('Hire a Tech Lead') && s.includes('Hiring delay')),
      JSON.stringify(said),
    ).toHaveLength(1);
  });
});
