/**
 * C1 "why it moved" — reuse the prior Run's Monte Carlo seed on a rerun of the SAME structure, so a single input
 * edit is comparable on a common set of random draws (common random numbers). Design: programme-docs
 * `c1-why-it-moved/C1-DESIGN.md`; science R3 #75 5920656318 (S1–S4); lease #75 5920739086.
 *
 * WHY: PLoT derives the seed from the graph's values when the caller sends none (`run.ts` `resolveSeed`), so every
 * value edit moves it and the pair classifies `C2_unpaired` ("drew different random samples"). PLoT already honours a
 * caller seed and echoes it as `meta.seed_used`; `run-analysis.ts` already forwards a seed. The only missing piece is
 * a producer, which is this module.
 *
 * S1 — reuse ONLY when the two Runs' recorded inputs have the same STRUCTURE: the key is built from two
 *   `input_snapshot`s made by the ONE builder (`buildRunInputSnapshot`), never from a second reading of the graph.
 *   A Run with no snapshot (every Run before SC-24) never lends its seed.
 * S2 — the seed lent is the prior Run's own PLoT echo (`meta.seed_used`, read by the same reader `seed_equal`
 *   compares), sent back verbatim; the new Run's echo records it, so the chain carries forward.
 * S3 — currentness stays the analysis hash; nothing here reads or writes freshness.
 * S4 — `n_equal` / `builds_equal` still gate C1 in `classifyAttribution`; unchanged.
 *
 * DRAW STRUCTURE: `draw-structure.ts` — this producer reads the SNAPSHOT key (a pre-filter); the classifier reads PLoT's
 * recorded key (the claim gate). See that file's header (R3 #75 5920859011; SCIENCE/DSK 5935983506).
 */
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { orderSuccessfulRunAnalysisFactsNewestFirst } from '../context/freshness.js';
import {
  isReconciledScenarioAnalysisFactSet,
  isScenarioAnalysisReasoningAuthority,
  type ScenarioAnalysisFactSet,
} from '../context/reconcile-scenario-analysis-facts.js';
import { runSeedEcho } from './build-run-delta.js';
import { drawStructureKey, drawStructureKeyOfFact } from './draw-structure.js';

/** What the turn knows about the Run a rerun would be paired with. */
export interface PriorRunForSeed {
  readonly seedUsed: string;
  readonly structureKey: string;
}

export type SeedReuseReason =
  | 'reused'
  | 'explicit_seed'
  | 'no_prior_run'
  | 'prior_not_recorded'
  | 'current_not_recorded'
  | 'structure_changed';


/**
 * C1 — the facts a Run's seed is lent from (DL lease 5944383317, narrowed to the seed; DL conditions on the narrowing).
 *
 * The turn's HOT WINDOW (its newest 20 turn rows) first: today's source, and the window the turn's own delta pairs
 * from, so the Run that lends the seed is the Run the delta compares against. Only when that window holds NO
 * successful Run — the prior Run's turn aged out of it (a user who talked for 20+ turns between Runs) — does the
 * scenario's reconciled DURABLE set lend it, and only when it is
 *   - attested for THIS scenario by the reconciler (`isReconciledScenarioAnalysisFactSet`: a forged or foreign carrier
 *     never counts), and
 *   - a reasoning authority (`complete | capped`: a validated durable page; `capped` keeps the NEWEST rows, and the
 *     reconciler degrades any snapshot that omits a hot-window fact, so it never hides a newer Run).
 * Anything else (degraded, absent, foreign) leaves the window, and `priorRunForSeed` answers `no_prior_run` as today.
 * The selector downstream reads only successful `run_analysis` facts, so no other writer's fact can lend a seed.
 * Without this, the aged-out Run sent no seed: a new draw, `C2_unpaired`, and the user's edit could not be credited.
 */
export function seedHistoryFacts(input: {
  readonly scenarioId: string;
  readonly hotWindow: readonly HandlerFact[] | undefined;
  readonly durable: ScenarioAnalysisFactSet | undefined;
}): readonly HandlerFact[] | undefined {
  if (input.hotWindow !== undefined && orderSuccessfulRunAnalysisFactsNewestFirst(input.hotWindow).length > 0) return input.hotWindow;
  const durable = input.durable;
  return isReconciledScenarioAnalysisFactSet(durable, input.scenarioId) && isScenarioAnalysisReasoningAuthority(durable)
    ? durable.facts
    : input.hotWindow;
}

/**
 * The newest SUCCESSFUL Run of this window — the same ordering `selectTwoNewestRunAnalysisFacts` pairs from, so the
 * Run that lends its seed is the Run the next delta compares against, by construction.
 */
export function priorRunForSeed(priorFacts: readonly HandlerFact[] | undefined): PriorRunForSeed | 'no_prior_run' | 'prior_not_recorded' {
  const newest = priorFacts === undefined ? undefined : orderSuccessfulRunAnalysisFactsNewestFirst(priorFacts)[0]?.fact;
  if (newest === undefined) return 'no_prior_run';
  const seedUsed = runSeedEcho(newest);
  const structureKey = drawStructureKeyOfFact(newest);
  if (seedUsed === null || structureKey === null) return 'prior_not_recorded';
  return { seedUsed, structureKey };
}

/** Decide the seed for this Run. Returns the seed to send (verbatim prior echo) or none, with the reason. */
export function decideSeedReuse(args: {
  /** From the turn binding; `undefined` outside a turn (no claim → no reuse). */
  readonly prior: PriorRunForSeed | 'no_prior_run' | 'prior_not_recorded' | undefined;
  readonly current: RunInputSnapshot | null;
  readonly explicitSeed: unknown;
}): { readonly seed?: string; readonly reason: SeedReuseReason } {
  if (args.explicitSeed !== undefined) return { reason: 'explicit_seed' };
  if (args.prior === undefined) return { reason: 'no_prior_run' };
  if (typeof args.prior === 'string') return { reason: args.prior };
  if (args.current === null) return { reason: 'current_not_recorded' };
  if (drawStructureKey(args.current) !== args.prior.structureKey) return { reason: 'structure_changed' };
  return { seed: args.prior.seedUsed, reason: 'reused' };
}
