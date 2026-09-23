import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGrammarRedraw, decideGrammarRedraw } from '../grammar-redraw.js';
import {
  buildDraftStructureDirective,
  readDraftStructureFacts,
  secondDrawIsStructurallyCleaner,
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
    const second = ok(READY);
    const out = (await applyGrammarRedraw({
      first: ok(TARGET_ONLY), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    expect(out).toBe(second);
  });

  it('a target-only draw beats a both-mechanisms draw — fewer REFUSED OPTIONS', async () => {
    const second = ok(TARGET_ONLY);
    const out = (await applyGrammarRedraw({
      first: ok(BOTH), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    expect(out).toBe(second);
    expect(readDraftStructureFacts(BOTH).refusedOptions).toBe(5);
    expect(readDraftStructureFacts(TARGET_ONLY).refusedOptions).toBe(1);
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
