/**
 * ⛔ A LEVEL THE USER STATED IS SENT AS STATED — not as ±10 points of PLoT's default spread (DL #70 5848646560).
 *
 * PLoT gives every observed factor with no `observed_state.std` a parameter uncertainty of
 * σ = max(0.1, 0.15·value) on its normalised frame (plot-lite-service `parameter-uncertainty-bounds.ts`,
 * `buildParameterUncertaintiesV3`). So a figure the user STATED — "40 support staff" on a cap of 100, "£49" on a cap
 * of 200 — was sampled as ±10 people, ±£20: uncertainty nobody expressed.
 *
 * WIRE, engine-direct on served PLoT `1f6ad52` / ISL `8a5e973` (`stated-fact-spread-20260926/RESULTS.md`):
 *   · "headcount ≤ 45" on a stated 40 that no option changes read P(meets) 0.698, decision-grade — a certified 30%
 *     breach risk the model does not support; with the stated level sent exactly, 1;
 *   · Paul's brief (MG witness 1750Z): the stated £49 price at the default σ put 6.05% of "Current state" and "Release
 *     at £49" churn draws below 0%; sent exactly, 0 on every option, win-% unchanged.
 *
 * PLoT honours a stated `observed_state.std` first and unfloored (down to MIN_USER_STD 1e-4), so no new mechanism:
 * the level a PERSON stated is carried on the WIRE copy with that minimum spread. Who stated it is the census's one
 * authority (`earnsAuthorshipCredit(structureProvenance(node))`): Olumi's estimates and ratified estimates keep PLoT's
 * default spread; a stated `std` is never overwritten; only factors (PLoT emits parameter uncertainty for factors).
 * Uncertainty in how things CHANGE (link strengths) is untouched. Nothing is persisted.
 */
import { earnsAuthorshipCredit, structureProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { isSwitch, resolveMagnitudeFrame, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** PLoT's floor for a stated spread (`MIN_USER_STD`): the level exactly as the user stated it. */
export const STATED_LEVEL_STD = 1e-4;

/** The factor ids whose level a person stated and that carry no spread of their own. */
export function statedLevelNodeIds(graph: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return out;
  for (const node of graph.nodes) {
    if (!isRec(node) || node.kind !== 'factor' || typeof node.id !== 'string' || !isRec(node.observed_state)) continue;
    const os = node.observed_state;
    if (typeof os.value !== 'number' || !Number.isFinite(os.value)) continue;
    if (typeof os.std === 'number' && Number.isFinite(os.std) && os.std > 0) continue;
    if (!earnsAuthorshipCredit(structureProvenance(node, graph))) continue;
    out.add(node.id);
  }
  return out;
}

/** The wire graph with each stated level carried at `STATED_LEVEL_STD`. Returns `graph` itself when none. */
export function carryStatedLevelSpread<G>(graph: G): G {
  const ids = statedLevelNodeIds(graph);
  if (ids.size === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n: unknown) =>
      isRec(n) && typeof n.id === 'string' && ids.has(n.id) && isRec(n.observed_state)
        ? { ...n, observed_state: { ...n.observed_state, std: STATED_LEVEL_STD } }
        : n,
    ),
  } as G;
}

/**
 * ⭐ A SWITCH AN OPTION SETS IS HELD AT ITS STATE, NOT SAMPLED (served-claim audit P1-b, #70 5850076002).
 *
 * ⚠ SERVED (`f-20260926T201724Z` step 12, CEE d6b09c0): at churn 12% (limit ≤10%) "Continue as now" read "meets it in
 * 8.22%", while "Keep £49 + add-on", with identical churn inputs, read 0. The release switch ("release status (0/1)",
 * the user's adopted 0) carried PLoT's default BINARY level spread, so holding it at 0 (the status quo) or setting it to
 * 1 (the release options) sampled partial releases. WIRE, engine-direct PLoT 1f6ad52 (`sq-spread-20260926/`): with the
 * switch's level sent at the minimum spread, the status quo reads 0 and the release options 0.49 → 0.60.
 *
 * A 0/1 lever has no partial states: its uncertainty is in how much it CHANGES things (its links' σ), never in which
 * state it is in. So a factor that an option SETS and that `isSwitch` (the magnitude contract's one switch test: frame
 * 1, the held and every option level exactly 0 or 1) calls a switch is sent at `STATED_LEVEL_STD` on the wire copy. A
 * non-switch lever, a switch no option sets, and a stated `std` are untouched; nothing is persisted.
 */
export function switchLevelNodeIds(graph: unknown, options: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(options)) return out;
  const levels = new Map<string, number[]>();
  for (const o of options) {
    if (!isRec(o) || !isRec(o.interventions)) continue;
    for (const [id, iv] of Object.entries(o.interventions)) {
      const v = typeof iv === 'number' ? iv : isRec(iv) ? iv.value : undefined;
      if (typeof v === 'number' && Number.isFinite(v)) levels.set(id, [...(levels.get(id) ?? []), v]);
    }
  }
  for (const node of graph.nodes) {
    if (!isRec(node) || node.kind !== 'factor' || typeof node.id !== 'string' || !isRec(node.observed_state)) continue;
    const optionLevels = levels.get(node.id);
    if (optionLevels === undefined) continue;
    const os = node.observed_state;
    if (typeof os.value !== 'number' || !Number.isFinite(os.value)) continue;
    if (typeof os.std === 'number' && Number.isFinite(os.std) && os.std > 0) continue;
    const mn: MagnitudeNode = {
      label: typeof node.label === 'string' ? node.label : node.id,
      kind: 'factor',
      scale_frame: node.scale_frame,
      observed_state: os as MagnitudeNode['observed_state'],
      unit: null,
      option_levels: optionLevels,
    };
    if (isSwitch(mn, resolveMagnitudeFrame(mn))) out.add(node.id);
  }
  return out;
}

/** The wire graph with each option-set switch held at `STATED_LEVEL_STD`. Returns `graph` itself when none. */
export function carrySwitchLevelSpread<G>(graph: G, options: unknown): G {
  const ids = switchLevelNodeIds(graph, options);
  if (ids.size === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n: unknown) =>
      isRec(n) && typeof n.id === 'string' && ids.has(n.id) && isRec(n.observed_state)
        ? { ...n, observed_state: { ...n.observed_state, std: STATED_LEVEL_STD } }
        : n,
    ),
  } as G;
}
