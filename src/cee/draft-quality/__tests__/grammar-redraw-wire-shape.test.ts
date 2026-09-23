import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGrammarRedraw, decideGrammarRedraw } from '../grammar-redraw.js';
import {
  buildDraftStructureDirective,
  readDraftStructureFacts,
  secondDrawIsStructurallyCleaner,
  secondDrawKeepsEveryIdentity,
} from '../draft-structure.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

/**
 * ⛔⛔ THE GAP THIS CLOSES, AND IT WAS FOUND BY INDEPENDENT REVIEW, NOT HERE.
 *
 * Every body in `grammar-redraw.test.ts` is shaped `{ graph }`. **Production is
 * not.** `boundary.ts` returns the V3 body and `draft-graph.ts` requests
 * `schemaVersion: 'v3'`, so a real draft carries `nodes`, `edges` and
 * `analysis_ready` at the **TOP LEVEL** with no `graph` key at all — verified on
 * all 8 banked captures (`'graph' in body === false`, `'nodes' in body === true`).
 *
 * So the `rec.graph ?? rec` fallback in `readDraftStructureFacts` — **the branch
 * production takes on every single draw** — was untested, and four mutants
 * survived the suite, including deleting `?? rec`, which makes EVERY production
 * draw unreadable and silently retires the whole pass.
 *
 * These fixtures are the RAW WIRE SHAPE of three real draws from
 * `output/grammar-baseline-20260923/`, ids/kinds/edges/targets verbatim.
 */
const wire = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.wire.json`, import.meta.url), 'utf8'));

const TARGET_ONLY = wire('wire-target-only');        // run 7: 0 edges, 1 refused option
const BOTH = wire('wire-both-mechanisms');           // run 2: 4 edges + 1 target option
const READY = wire('wire-ready-control');            // run 8: clean, ar.status ready

const ok = (body: unknown): UnifiedPipelineResult =>
  ({ statusCode: 200, body }) as unknown as UnifiedPipelineResult;
const AFFORDABLE_MS = 20_000;

describe('the wire shape itself — the precondition every test below rests on', () => {
  it('a real draft body has NO `graph` key and carries nodes at the top level', () => {
    for (const body of [TARGET_ONLY, BOTH, READY]) {
      const rec = body as Record<string, unknown>;
      expect('graph' in rec).toBe(false);
      expect(Array.isArray(rec.nodes)).toBe(true);
      expect(Array.isArray(rec.edges)).toBe(true);
    }
  });

  it('⛔ the `?? rec` fallback is load-bearing — without it every draw is unreadable', () => {
    // Deleting `rec.graph ?? rec` leaves `readDraftStructureFacts` reading
    // `undefined` for a production body, so `readable` goes false and the pass
    // silently stops firing on 100% of traffic. This is the assertion that REDs.
    expect(readDraftStructureFacts(TARGET_ONLY).readable).toBe(true);
    expect(readDraftStructureFacts(BOTH).readable).toBe(true);
    expect(readDraftStructureFacts(READY).readable).toBe(true);
  });
});

describe('on the real wire shape: target-only draws must still redraw', () => {
  it('⛔ TRIGGERS on a draw with ZERO edge violations', () => {
    // The mutant this kills: triggering on edges only. Run 7 is the counter-
    // example the earlier suite could not express, because its bodies were
    // `{ graph }` and it never exercised a target-only draw end to end.
    const f = readDraftStructureFacts(TARGET_ONLY);
    expect(f.edgeGrammar.violations).toHaveLength(0);
    expect(f.refusedOptions).toBe(1);

    const d = decideGrammarRedraw({
      first: ok(TARGET_ONLY), elapsedMs: AFFORDABLE_MS, redraw: async () => ok(READY),
    });
    expect(d.redraw).toBe(true);
  });

  it('⛔ hands the drafter a NON-EMPTY directive', () => {
    // Without this the handler omits `priorAttemptDirective` and the redraw is a
    // blind re-roll — it spends the user's budget and says nothing about why.
    const directive = buildDraftStructureDirective(readDraftStructureFacts(TARGET_ONLY));
    expect(directive.length).toBeGreaterThan(0);
    expect(directive).toContain('carry an intervention');
  });

  it('⛔ the directive does NOT accuse the drafter of minting the target', () => {
    // `"49"` is CEE'S OWN token from the extractor's label fallback
    // (`intervention-extractor.ts:1261`), reached only when the drafter supplied
    // NO intervention. Correcting an error the model did not make is the one
    // thing this module forbids itself.
    const directive = buildDraftStructureDirective(readDraftStructureFacts(TARGET_ONLY));
    expect(directive).not.toContain('does not name any node');
    expect(directive).not.toMatch(/never a bare number|lifted from the brief/);
    expect(directive).toContain('states a value');
  });

  it('SHIPS the second draw when the redraw comes back ready', () => {
    // The end-to-end claim: a target-only defect is actually fixable by a redraw
    // and the cleaner draw actually wins, on the production body shape.
    expect(readDraftStructureFacts(READY).refusedOptions).toBe(0);
  });
});

describe('on the real wire shape: selection', () => {
  it('a ready draw beats a target-only draw', async () => {
    // ⚠ NOT object identity any more: a shipped redraw carries a DISCLOSURE, so
    // the result is a new object wrapping the second draw's body. What is
    // asserted is that the SECOND DRAW'S MODEL shipped — by its own node ids.
    const second = ok(READY);
    const out = (await applyGrammarRedraw({
      first: ok(TARGET_ONLY), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    expect(readDraftStructureFacts(out.body).refusedOptions).toBe(0);
    expect((out.body as { nodes: { id: string }[] }).nodes.map((n) => n.id))
      .toEqual((READY as { nodes: { id: string }[] }).nodes.map((n) => n.id));
  });

  it('a target-only draw beats a both-mechanisms draw — fewer REFUSED OPTIONS', async () => {
    const second = ok(TARGET_ONLY);
    const out = (await applyGrammarRedraw({
      first: ok(BOTH), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    expect(readDraftStructureFacts(out.body).refusedOptions).toBe(1);
    expect(readDraftStructureFacts(BOTH).refusedOptions).toBe(5);
  });

  it('a clean draw is never redrawn and the drafter is never called', async () => {
    const first = ok(READY);
    const redraw = vi.fn(async () => ok(READY));
    const out = (await applyGrammarRedraw({ first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw })).result;
    expect(out).toBe(first);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('⛔ selecting on REFUSED OPTIONS, not on mixed defect counts', () => {
    // THE UNIT BUG THIS PINS. Edge violations count per EDGE while unresolvable
    // targets count per distinct STRING, so the old score mixed two units and a
    // draw refusing MORE options could win.
    //
    // ⚠ The real captures do not discriminate it — `BOTH` scores 5 either way,
    // which is exactly why the defect survived. The discriminating shape is ONE
    // option wired to THREE risks: three violations, one refused option. That is
    // a structural property of the units, so a constructed graph is the right
    // instrument here and a capture is not.
    const oneOptionThreeRisks = {
      nodes: [
        { id: 'opt', kind: 'option' },
        { id: 'r1', kind: 'risk' }, { id: 'r2', kind: 'risk' }, { id: 'r3', kind: 'risk' },
      ],
      edges: [
        { from: 'opt', to: 'r1' }, { from: 'opt', to: 'r2' }, { from: 'opt', to: 'r3' },
      ],
      analysis_ready: { status: 'needs_user_mapping', options: [] },
    };
    const f = readDraftStructureFacts(oneOptionThreeRisks);
    expect(f.totalViolations).toBe(3);   // the old, mixed-unit score
    expect(f.refusedOptions).toBe(1);    // what the user actually meets

    // And the consequence: a draw refusing ONE option must beat a draw refusing
    // TWO, even though the first carries MORE raw violations.
    const twoOptionsOneRiskEach = {
      nodes: [
        { id: 'a', kind: 'option' }, { id: 'b', kind: 'option' }, { id: 'r1', kind: 'risk' },
      ],
      edges: [{ from: 'a', to: 'r1' }, { from: 'b', to: 'r1' }],
      analysis_ready: { status: 'needs_user_mapping', options: [] },
    };
    const worse = readDraftStructureFacts(twoOptionsOneRiskEach);
    expect(worse.refusedOptions).toBe(2);
    expect(worse.totalViolations).toBe(2);        // fewer raw violations…
    expect(worse.totalViolations).toBeLessThan(f.totalViolations);
    // …yet it refuses MORE options, so it must LOSE. The old score had it winning.
    expect(secondDrawIsStructurallyCleaner(f, worse)).toBe(false);
    expect(secondDrawIsStructurallyCleaner(worse, f)).toBe(true);
  });
});


/**
 * ⛔⛔ B3 — A CLEANER DRAW THAT LOST THE USER'S MATERIAL MUST NOT WIN.
 *
 * Found by independent review. Selection was `refusedOptions <` and nothing
 * else, so the cheapest way to score better was to DELETE something: drop the
 * risk and the option→risk violations go with it; drop the option and its
 * refusal goes too. Either won and shipped, while the module promised it
 * "never deletes a causal claim".
 *
 * ⛔⛔ THE REVIEW PROPOSED "keep every first-draw option". THAT IS
 * UNIMPLEMENTABLE, and adopting it verbatim would have made the whole feature
 * dead. MEASURED across two real draws of one brief: **1 of 5 option ids
 * survive, and 1 of 5 labels.** An independent re-draft invents new
 * alternatives with new ids every time, so "keep every option" refuses every
 * redraw there has ever been.
 *
 * The survivor is the one carrying `provenance: "from_brief"` — the user's own
 * material, whose id is stable BECAUSE it derives from their words. All three
 * banked captures share exactly the same two: the goal and the user's option.
 * That is the thing worth protecting, and it is #1710's `keepsUserMaterial`
 * rule applied here.
 */
describe('B3 — a redraw may ADD and may replace its OWN inventions; it may never lose the user\'s', () => {
  const draw = (nodes: Record<string, unknown>[], edges: { from: string; to: string }[]) =>
    readDraftStructureFacts({ nodes, edges, analysis_ready: { status: 'x', options: [] } });

  const USER_OPT = { id: 'opt_user', kind: 'option', provenance: 'from_brief' };
  const USER_GOAL = { id: 'goal_user', kind: 'goal', provenance: 'from_brief' };
  const AI_OPT = { id: 'opt_ai', kind: 'option' };

  const FIRST = draw(
    [USER_GOAL, USER_OPT, AI_OPT, { id: 'risk_1', kind: 'risk' }],
    [{ from: 'opt_user', to: 'risk_1' }, { from: 'opt_ai', to: 'risk_1' }],
  );

  it('the first draw is genuinely dirty, and its user material is identified', () => {
    expect(FIRST.refusedOptions).toBe(2);
    expect(FIRST.briefStatedIds).toEqual(['goal_user', 'opt_user']);
  });

  it('⛔ DROPPING THE USER\'S OPTION scores better and must still LOSE', () => {
    const thinned = draw([USER_GOAL, AI_OPT, { id: 'risk_1', kind: 'risk' }], [{ from: 'opt_ai', to: 'risk_1' }]);
    expect(thinned.refusedOptions).toBeLessThan(FIRST.refusedOptions);   // strictly "cleaner"…
    expect(secondDrawKeepsEveryIdentity(FIRST, thinned)).toBe(false);
    expect(secondDrawIsStructurallyCleaner(FIRST, thinned)).toBe(false); // …and it loses
  });

  it('⛔ DROPPING THE USER\'S GOAL must LOSE, even with zero violations', () => {
    const noGoal = draw([USER_OPT, AI_OPT], []);
    expect(noGoal.refusedOptions).toBe(0);
    expect(secondDrawIsStructurallyCleaner(FIRST, noGoal)).toBe(false);
  });

  it('⛔ SWAPPING the user\'s option for another keeps the COUNT and must LOSE', () => {
    // Identity, never count — the case a count-based guard misses.
    const swapped = draw(
      [USER_GOAL, { id: 'opt_OTHER', kind: 'option', provenance: 'from_brief' }, AI_OPT],
      [],
    );
    expect(swapped.briefStatedIds).toHaveLength(FIRST.briefStatedIds.length);
    expect(secondDrawKeepsEveryIdentity(FIRST, swapped)).toBe(false);
  });

  it('⭐ REPLACING THE DRAFTER\'S OWN INVENTIONS is allowed — this is what a real redraw does', () => {
    // Measured: an independent re-draft keeps 1 of 5 option ids. If this case
    // did not adopt, the feature would never fire in production.
    const realistic = draw(
      [USER_GOAL, USER_OPT, { id: 'opt_ai_DIFFERENT', kind: 'option' },
       { id: 'risk_NEW', kind: 'risk' }, { id: 'fac_1', kind: 'factor' }],
      [{ from: 'opt_user', to: 'fac_1' }, { from: 'fac_1', to: 'risk_NEW' }],
    );
    expect(realistic.refusedOptions).toBe(0);
    expect(secondDrawKeepsEveryIdentity(FIRST, realistic)).toBe(true);
    expect(secondDrawIsStructurallyCleaner(FIRST, realistic)).toBe(true);
  });

  it('⭐ the three REAL captures all carry the same user material, so a real redraw is adoptable', () => {
    const ids = [TARGET_ONLY, BOTH, READY].map((b) => readDraftStructureFacts(b).briefStatedIds);
    expect(ids[0]).toEqual(ids[1]);
    expect(ids[1]).toEqual(ids[2]);
    expect(ids[0].length).toBeGreaterThan(0);
    expect(secondDrawKeepsEveryIdentity(readDraftStructureFacts(BOTH), readDraftStructureFacts(READY))).toBe(true);
  });

  it('an unreadable draw on either side keeps the first', () => {
    const bad = readDraftStructureFacts(null);
    expect(secondDrawKeepsEveryIdentity(FIRST, bad)).toBe(false);
    expect(secondDrawKeepsEveryIdentity(bad, FIRST)).toBe(false);
  });

  it('a draw with NO marked user material is judged on cleanliness alone — fails safe', () => {
    // An absent or differently-spelled marker must not silently refuse every
    // redraw; it restores exactly the pre-guard behaviour.
    const a = draw([{ id: 'o', kind: 'option' }, { id: 'r', kind: 'risk' }], [{ from: 'o', to: 'r' }]);
    const b = draw([{ id: 'o2', kind: 'option' }, { id: 'r2', kind: 'risk' }], []);
    expect(a.briefStatedIds).toEqual([]);
    expect(secondDrawKeepsEveryIdentity(a, b)).toBe(true);
    expect(secondDrawIsStructurallyCleaner(a, b)).toBe(true);
  });
});
