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
 *   · the ask: the existing link-size question, never approval of an unsized link's default prior.
 * Null → the press keeps today's answer. Pure: it reads, it never writes.
 */
import { assembleGuidanceSignals } from './turn-context/guidance-signals.js';
import { selectStrengthenPlaceholder, type StrengthenPlaceholderTarget } from './guidance/select-strengthen-placeholder.js';
import { renderCopy } from './guidance/render.js';
import type { GuidanceSignals as LeafSignals } from './guidance/types.js';
import { linkSizeAsk } from './link-size-ask.js';

/** The product's own "Strengthen the model" next step (`NEXT_STEP_CHIPS`, agent-v1-turn.ts). */
export const STRENGTHEN_PRESS_CHIP_ID = 'agent-next-strengthen';
/** The proposal's basis (provenance, never shown as the user's words). */
export const STRENGTHEN_CARD_RATIONALE = 'This link has no size yet; ask how much it changes its target.';

/** A sized link supplies a proposed band. An unsized target supplies only its labels for a size ask. */
export interface LinkStrengthsCardArgs {
  readonly links: readonly [{ readonly from_label: string; readonly to_label: string; readonly strength?: StrengthenPlaceholderTarget['band'] }];
  readonly rationale: string;
}

/**
 * ⭐ THE ONE COMPOSER of a link card's arguments (SCIENCE/DSK + AI HARNESS 5939230071; DL 5939415083 (3)). The M1
 * Strengthen press and the T3 pre-mortem card both build their `propose_link_strengths` call here, from RC's ONE band
 * read (`linkTargetOf`). Placeholders carry no band, so they cannot propose the prior as Olumi's estimate. A sized
 * link keeps its existing proposal behaviour, including same-band preservation (#2473).
 */
export function linkStrengthsCardArgs(
  link: Pick<StrengthenPlaceholderTarget, 'from_label' | 'to_label' | 'band'>,
  rationale: string,
): LinkStrengthsCardArgs {
  return { links: [{ from_label: link.from_label, to_label: link.to_label,
    ...(link.band === undefined ? {} : { strength: link.band }) }], rationale };
}

export interface StrengthenCard {
  readonly target: StrengthenPlaceholderTarget;
  readonly text: string;
  readonly args: LinkStrengthsCardArgs;
  /** A placeholder target: `text` asks for the size and NO proposal is issued (the route shows `text` alone). */
  readonly ask_only?: true;
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
    const question = linkSizeAsk(state.graph, {
      message: `Tell me about the link from "${target.from_label}" to "${target.to_label}".`,
      restingText: '', awaitingApproval: false,
    }) ?? copy.question;
    return {
      target,
      text: `${copy.title}\n\n${question}`,
      args: linkStrengthsCardArgs(target, STRENGTHEN_CARD_RATIONALE),
      ...(target.band === undefined ? { ask_only: true as const } : {}),
    };
  } catch {
    return null;
  }
}
