/**
 * ⭐ M1 — A STRENGTHEN PRESS OPENS ONE CARD, WITH NO MODEL CALL (PTL 5938801653 #1, the first investor moment; brief
 * programme-docs `output/reasoning-coach/CODEX-M1-NOW-BRIEF.md` @28cbdc2b; DL ruling 5933929583; RC `method_turns`
 * `card_first`).
 *
 * R3's baseline (5933558156, D1): pressing "Strengthen the model" gave a good challenge but NO card: no typed action, a
 * `C0_identical` rerun and 37.1 s. Here the press, on a CURRENT Run, reads the state once and returns:
 *   · the target: the ONE S1 link, from RC's helper (`selectStrengthenPlaceholder`) over the user's options in the
 *     comparison (`model.non_sq_option_ids`, the T2 signal RC's contract cases use), never a second picker;
 *   · the reply: RC's fixed copy for the S1 row (title + reasoning question), rendered by the leaf (`renderCopy`);
 *   · the call: ONE `propose_link_strengths` with that link at its current band and no `from_words`, so it is Olumi's
 *     estimate, held for the user's Apply or Edit through the existing approval door.
 * Null → the press keeps today's answer. Pure: it reads, it never writes.
 */
import { assembleGuidanceSignals } from './turn-context/guidance-signals.js';
import { selectStrengthenPlaceholder, type StrengthenPlaceholderTarget } from './guidance/select-strengthen-placeholder.js';
import { renderCopy } from './guidance/render.js';
import type { GuidanceSignals as LeafSignals } from './guidance/types.js';

/** The product's own "Strengthen the model" next step (`NEXT_STEP_CHIPS`, agent-v1-turn.ts). */
export const STRENGTHEN_PRESS_CHIP_ID = 'agent-next-strengthen';
/** The proposal's basis (provenance, never shown as the user's words). */
export const STRENGTHEN_CARD_RATIONALE = 'Olumi’s current band for a link nobody has sized yet, for you to apply as it stands or edit.';

export interface StrengthenCard {
  readonly target: StrengthenPlaceholderTarget;
  readonly text: string;
  readonly args: {
    readonly links: readonly [{ readonly from_label: string; readonly to_label: string; readonly strength: StrengthenPlaceholderTarget['band'] }];
    readonly rationale: string;
  };
}

export interface StrengthenPressState {
  readonly graph?: unknown;
  readonly analysisState?: unknown;
  readonly analysisResult?: unknown;
  readonly optionParticipation?: unknown;
  readonly identityEvaluated?: ReadonlySet<string>;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

export function strengthenCardFor(state: StrengthenPressState): StrengthenCard | null {
  // A CURRENT Run only: the S1 rule is "a link nobody sized on a path of an option this Run analysed".
  if (rec(rec(state.analysisState)?.run_state)?.kind !== 'complete_current') return null;
  const identityEvaluations = [...(state.identityEvaluated ?? [])].map((node_id) => ({ node_id, evaluated: true }));
  try {
    const signals = assembleGuidanceSignals({
      request: 'method', offeredSpecific: [], graph: state.graph, analysisState: state.analysisState,
      analysisResult: state.analysisResult, optionParticipation: state.optionParticipation, identityEvaluations,
      // The S1 card names no option: the leader is never read (the helper reads no analysis).
      leaderLicensed: false,
    });
    const target = selectStrengthenPlaceholder(state.graph, signals['model.non_sq_option_ids'], identityEvaluations);
    if (target === null) return null;
    // The S1 copy reads the item's two labels from the goal-path links; nothing else (no goal, plan or leader) is passed.
    const leafSignals: LeafSignals = {
      'model.goal_path_links': signals['model.goal_path_links'],
      'model.non_sq_option_ids': signals['model.non_sq_option_ids'],
      'model.option_labels': signals['model.option_labels'],
    };
    const copy = renderCopy({ policy_id: 'RC-STRENGTHEN-ITEM', variant: 'S1', item: `${target.from_id}->${target.to_id}` }, leafSignals);
    if (copy.title === null || copy.question === null) return null;
    return {
      target,
      text: `${copy.title}\n\n${copy.question}`,
      args: { links: [{ from_label: target.from_label, to_label: target.to_label, strength: target.band }], rationale: STRENGTHEN_CARD_RATIONALE },
    };
  } catch {
    return null;
  }
}
