/**
 * ⭐ THE PROVISIONAL CAVEAT IS SAID ONCE PER RUN, NOT ON EVERY LATER REPLY (AIQ #75 5925678816 (A): "say it once per Run (on
 * the first reply reporting that Run), and again only when the provisional state changes. It's true each time, so the
 * repeats are noise, not falsity (PROMPT STRIKE's call)"; lease #85 5926691199).
 *
 * Served R3 `train-0545Z` (CEE `3b0537c1`): the shared leader chokepoint (`enforceLeadingOptionClaimsAtWire`, permit-with-
 * caveat) puts the 36-word caveat FIRST on every reply while a provisional Run is on record — the Run reply, then inspect,
 * link-size, adopt and answer, none of which named an option: 140 repeated words on Paul's journey.
 *
 * Dropped here, on the Agent route only, and only when ALL hold:
 *   · this turn did not run the analysis (the reply reporting a Run always carries it);
 *   · this scenario already showed the SAME caveat string (so the same cause) for the SAME Run (`run_state.computed_at`);
 *   · the reply names no option of the model (a reply comparing or naming options keeps its qualifier).
 * The record is in-process, per scenario (like the Agent's own `HistoryStore`): no new database read. After a restart or on
 * another instance it is said once more — today's behaviour, the safe direction.
 */

import { PROVISIONAL_FIGURES_CAVEATS } from '../compose/leading-option-wire-enforcement.js';

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);

/** Per scenario: the caveat last shown and the Run it was shown for. Bounded: the oldest scenario is forgotten first. */
const shown = new Map<string, { readonly caveat: string; readonly runAt: string }>();
const MAX_SCENARIOS = 5000;

/** For tests only: forget every record. */
export function resetCaveatRecordForTests(): void { shown.clear(); }

/** The Run a readback's analysis state reports (`run_state.computed_at`), or null when none is on record. */
export function runAtOf(analysisState: unknown): string | null {
  const at = recordOf(recordOf(analysisState)?.run_state)?.computed_at;
  return typeof at === 'string' && at.length > 0 ? at : null;
}

const fold = (s: string): string => s.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/\s+/g, ' ');
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

/** The model's options, by label. */
function optionLabels(graph: unknown): string[] {
  const nodes = recordOf(graph)?.nodes;
  return Array.isArray(nodes)
    ? nodes.map(recordOf).filter((n): n is Rec => n?.kind === 'option' && typeof n.label === 'string' && n.label.trim().length >= 3)
      .map((n) => String(n.label).trim())
    : [];
}

/** The reply names one of the model's options (whole words, quotes and case ignored). */
function namesAnOption(text: string, graph: unknown): boolean {
  const t = fold(text);
  return optionLabels(graph).some((l) => new RegExp(`(?:^|[^a-z0-9])${escape(fold(l))}(?:$|[^a-z0-9])`).test(t));
}

export interface CaveatTurn {
  readonly scenarioId: string;
  /** This turn ran the analysis (the Run button, the Agent's run, the build's first pass). */
  readonly ranThisTurn: boolean;
  /** The readback's analysis state (its `run_state.computed_at` names the Run). */
  readonly analysisState: unknown;
  /** The readback graph (its options' labels). */
  readonly graph: unknown;
}

/**
 * The reply with a repeated caveat dropped (see the module note), or unchanged. Records the caveat whenever the returned
 * reply still opens with it.
 */
export function withCaveatOncePerRun(text: string, turn: CaveatTurn): string {
  const caveat = PROVISIONAL_FIGURES_CAVEATS.find((c) => text.startsWith(c));
  if (caveat === undefined) return text;
  const runAt = runAtOf(turn.analysisState);
  const rest = text.slice(caveat.length).replace(/^\s+/, '');
  const prior = shown.get(turn.scenarioId);
  const repeat = !turn.ranThisTurn && runAt !== null && prior !== undefined && prior.caveat === caveat && prior.runAt === runAt;
  if (repeat && rest.length > 0 && !namesAnOption(rest, turn.graph)) return rest;
  if (runAt !== null) {
    shown.delete(turn.scenarioId);
    shown.set(turn.scenarioId, { caveat, runAt });
    if (shown.size > MAX_SCENARIOS) shown.delete(shown.keys().next().value!);
  }
  return text;
}
