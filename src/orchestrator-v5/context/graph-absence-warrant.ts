/**
 * Is this turn ENTITLED to say the user has no model?
 *
 * ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
 * `SessionStore.loadGraphAndBriefText` returns `{ graph: null }` for two
 * different facts, and `fetchPersistedScenarioState` mints `ok_absent` for
 * both: the row exists with `scenarios.graph` genuinely NULL (a real fresh
 * user), and the model exists but this read did not produce it. `ok_absent`
 * with no caller graph reaches the model as `graph_context.status: 'absent'`,
 * whose code-owned contract states "no Living Model exists yet" — so the second
 * case does not merely fail to answer, it ASSERTS a falsehood about the user's
 * own work.
 *
 * Witnessed on deployed staging: a guest watched a full Monte Carlo analysis
 * complete over a 12-node / 18-edge model, then asked about it and was told
 * "I don't actually have a model started yet, so there's nothing to review
 * structurally" — three times, once from the product's own recovery chip.
 *
 * ── WHY A SUCCESSFUL ANALYSIS FACT IS PROOF, NOT A HEURISTIC ───────────────
 * The analyse path is UI → CEE → PLoT → ISL, and CEE reloads its OWN persisted
 * graph to build the PLoT payload (`loadScenarioSnapshotForRunAnalysis`). A
 * successful `run_analysis` fact therefore cannot exist unless `scenarios.graph`
 * held a model at run time. A null graph beside such a fact is consequently not
 * evidence of "no model" — it is a model this read failed to produce.
 *
 * The claim is deliberately narrow. It is NOT "the graph was deleted", NOT
 * "the write failed", and NOT a diagnosis of the upstream cause (the UI's
 * scenario-graph POST 404-then-retry race is real and separately owned). It is
 * only this: WE ARE NOT ENTITLED TO SAY NO MODEL EXISTS.
 *
 * ── WHAT THIS DELIBERATELY DOES *NOT* DO ───────────────────────────────────
 * It does not falsify the READ, and it does not return `degraded`. An earlier
 * revision of this fix did, and two existing tests caught the regression: a
 * `degraded` read suppresses the first-touch `provisional` promotion of a
 * VALID caller-supplied graph — which is a tested recovery path that can still
 * hand this very user a truthful answer built from their own bytes, and whose
 * commit behaviour is separately relied upon. Withdrawing the absence CLAIM and
 * falsifying the READ are two different changes; only the first is warranted
 * here. The ordering that falls out is:
 *
 *   caller sent a usable graph  → `provisional`  (UNCHANGED — the rescue path)
 *   nothing to fall back on     → `unavailable`  (was `absent`: the lie)
 *   no analysis ever ran        → `absent`       (UNCHANGED — real fresh user)
 *
 * ── POSITIVE EVIDENCE ONLY, AND WHY THAT DIRECTION IS THE SAFE ONE ─────────
 * Withdrawal requires a fact we can SEE. Absence of a fact never withdraws, so:
 *
 *   · a genuine fresh user (no analysis has ever run) is untouched and keeps
 *     the correct, welcoming empty-state behaviour;
 *   · a DEGRADED fact read carries `[]` by construction, so it cannot withdraw
 *     either — a store blip does not start hedging every healthy turn.
 *
 * That asymmetry is the point. Hedging on every turn would be a new falsehood
 * in the opposite direction; this fires only where a model is PROVEN to have
 * existed.
 *
 * Success is judged by `isSuccessfulRunAnalysisFact` — the estate's single
 * shared predicate, also used by the routing, dispatch and compose layers — so
 * "a usable prior analysis" cannot come to mean two different things in two
 * places. A `noop`, failed, blocked or partial fact withdraws nothing.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { CanonicalGraphReadState } from '../build-turn-context.js';
import { isSuccessfulRunAnalysisFact } from './freshness.js';

/**
 * Stamp `absenceWarranted` on a successful-but-empty canonical read.
 *
 * Total and pure. Every other read state is returned by identity, so the
 * healthy (`ok_present`) and already-degraded paths are byte-identical to their
 * pre-change behaviour and no turn that could previously answer loses anything.
 */
export function applyGraphAbsenceWarrant(
  read: CanonicalGraphReadState,
  scenarioAnalysisFacts: readonly HandlerFact[],
): CanonicalGraphReadState {
  // Scoped to the ABSENT case alone. A present graph is never second-guessed,
  // and an already-degraded read already tells the truth.
  if (read.status !== 'ok_absent') return read;
  const warranted = !scenarioAnalysisFacts.some(isSuccessfulRunAnalysisFact);
  // Stamped in BOTH directions rather than only on withdrawal: an explicit
  // `true` is what lets a reader tell "this producer checked and we are
  // entitled" from "nobody asked" (an absent field). The distinction between a
  // derived verdict and an unasked question is the whole subject of this file.
  return { status: 'ok_absent', absenceWarranted: warranted };
}
