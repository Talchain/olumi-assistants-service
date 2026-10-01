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
 *   · the reply cannot be claiming a leader (`mayClaimALeader`: the enforcer's own ranking detector, plus two safe keeps).
 * The record is in-process, per scenario (like the Agent's own `HistoryStore`): no new database read. After a restart or on
 * another Render instance it is said once more — today's behaviour, the safe direction (DL 5926719387).
 */

import { PROVISIONAL_FIGURES_CAVEATS } from '../compose/leading-option-wire-enforcement.js';
import { splitIntoRedactableUnits } from '../compose/redactable-units.js';
import { dropRankingSentences, OPTION_CUE, rankingLabelContext } from './withheld-leader-fail-closed.js';

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

/** Comparison words that, beside a reference to an option, make a sentence read as a claim about which leads. */
const COMPARATIVE = /\b(?:better|best|stronger|strongest|weaker|weakest|worse|worst|ahead|behind|wins?|winning|winner|leads?|leading|favou?r(?:s|ed|ite)?|prefer(?:s|red|able)?|outperforms?|beats?|top|edges?)\b/i;

/**
 * ⛔ DL 5926719387: whether the reply may claim a leader is decided by the ENFORCER'S OWN detector — `dropRankingSentences`,
 * the gate that removes ranking sentences — never by an exact-label match. A partial label ("investment firms look
 * stronger"), an ordinal ("the first option comes out ahead") and a pronoun ("that one wins") all trip it. Two more keeps,
 * both in the safe direction: a reply that names one of the model's options, and a sentence that refers to an option (the
 * enforcer's own `OPTION_CUE`) beside a comparison word — the detector reads "The first option is better." as no ranking.
 */
function mayClaimALeader(text: string, graph: unknown, analysisReady: unknown): boolean {
  if (dropRankingSentences(text, rankingLabelContext(graph, analysisReady)).droppedSentences > 0) return true;
  const t = fold(text);
  if (optionLabels(graph).some((l) => new RegExp(`(?:^|[^a-z0-9])${escape(fold(l))}(?:$|[^a-z0-9])`).test(t))) return true;
  return splitIntoRedactableUnits(text).some((u) => OPTION_CUE.test(u) && COMPARATIVE.test(u));
}

export interface CaveatTurn {
  readonly scenarioId: string;
  /** This turn ran the analysis (the Run button, the Agent's run, the build's first pass). */
  readonly ranThisTurn: boolean;
  /** The readback's analysis state (its `run_state.computed_at` names the Run). */
  readonly analysisState: unknown;
  /** The readback graph (its options' labels). */
  readonly graph: unknown;
  /** The readback's `analysis_ready` (the enforcer reads option labels from it too). */
  readonly analysisReady?: unknown;
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
  if (repeat && rest.length > 0 && !mayClaimALeader(rest, turn.graph, turn.analysisReady)) return rest;
  if (runAt !== null) {
    shown.delete(turn.scenarioId);
    shown.set(turn.scenarioId, { caveat, runAt });
    if (shown.size > MAX_SCENARIOS) shown.delete(shown.keys().next().value!);
  }
  return text;
}
