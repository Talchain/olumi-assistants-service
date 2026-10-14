/**
 * The one bias-trigger owner, P45 slices 1 and 3; bias_check consumes it.
 * Every item's mitigation press is an enabled offer already on the same bar, never inert.
 * It describes risks in the model and never diagnoses the user.
 */
import type { ActionFacts } from './state.js';
import { estimatePointsOf } from './state.js';
import type { ActionOffer } from './rank.js';
import type { ActionId } from './registry.js';
import { mapStageToDecisionStage } from '../../../dsk/stage-edge.js';
import { resolveDskClaimProvenance, type DskClaimProvenance } from '../../compose/dsk-claim-record.js';
import { POLICY } from '../guidance/policy.js';

export type BiasClaimId = 'DSK-B-001' | 'DSK-B-007';

export interface OptionFrame {
  readonly nonSqOptionLabels: readonly string[];
  readonly statusQuoPresent: boolean;
  readonly sameLever: boolean;
}

export interface BiasRiskItem {
  readonly claim_id: BiasClaimId;
  readonly name: string;
  readonly why: string;
  readonly action_id: ActionId;
  readonly press_id: string;
  readonly offer_key: string;
  readonly science?: DskClaimProvenance;
}

export interface BiasRiskV1 {
  readonly v: 1;
  readonly items: readonly BiasRiskItem[];
}

/** A fired trigger: its wire item plus the reply context (the model item it bites on, and its same-bar offer). */
interface FiredBias {
  readonly wire: BiasRiskItem;
  readonly item: string;
  readonly offer: ActionOffer;
}

export const BIAS_RISK_MAX = 2;

/** RC-WIDEN's typed `bias_cue` words (reasoning-interventions.json, COPY-SHAPE): read, never restated. */
type PolicyRow = (typeof POLICY.rows)[number];
const BIAS_CUE = POLICY.rows.find((r): r is Extract<PolicyRow, { readonly bias_cue: unknown }> => r.policy_id === 'RC-WIDEN' && 'bias_cue' in r)!.bias_cue;

const STAGES: Readonly<Record<BiasClaimId, readonly ReturnType<typeof mapStageToDecisionStage>[]>> = {
  'DSK-B-001': ['frame', 'evaluate', 'decide'], // decide→evaluate for the badge (Science 393023 #2771 ruling)
  'DSK-B-007': ['frame', 'ideate'],
};

/** The one stage rule for a bias claim's science badge (the row here and the press reply in handlers.ts). */
export const biasBadgeApplies = (claim_id: BiasClaimId, stage: ReturnType<typeof mapStageToDecisionStage> | null): boolean =>
  stage !== null && STAGES[claim_id].includes(stage);

/** The one trigger logic: at most BIAS_RISK_MAX fired items, each bound to an enabled, untargeted offer on the same bar. */
function firedBiasesOf(f: ActionFacts, offers: readonly ActionOffer[], frame: OptionFrame): FiredBias[] {
  if (!f.readable) return [];

  const enabledOffer = (id: ActionId) => enabledOfferOf(offers, id);
  const stage = f.canonicalStage === null ? null : mapStageToDecisionStage(f.canonicalStage);
  const items: FiredBias[] = [];
  const add = (claim_id: BiasClaimId, name: string, why: string, item: string, offer: ActionOffer): void => {
    const science = biasBadgeApplies(claim_id, stage) ? resolveDskClaimProvenance(claim_id) : null;
    items.push({
      wire: {
        claim_id,
        name,
        why,
        action_id: offer.action_id,
        press_id: offer.press_id,
        offer_key: offer.offer_key,
        ...(science !== null ? { science } : {}),
      },
      item,
      offer,
    });
  };

  const moreOptions = enabledOffer('more_options');
  if (moreOptions !== undefined && (frame.sameLever || (frame.nonSqOptionLabels.length === 1 && frame.nonSqOptionLabels[0] !== ''))) {
    const o = frame.nonSqOptionLabels[0];
    add('DSK-B-007', 'Narrow framing', frame.sameLever
      ? BIAS_CUE.narrow_framing
      : frame.statusQuoPresent
        ? `The only choice on the table is ‘${o}’ or carrying on as now, which can hide other routes.`
        : `‘${o}’ is the only option on the table, which can hide other routes.`,
      frame.sameLever ? frame.nonSqOptionLabels.map(oneLine).join('’, ‘') : oneLine(o!), moreOptions);
  }
  // DSK-B-006 waits for a per-option risk fact (Science 393023, 7 Oct): W4 is a missing baseline, not status quo bias.

  if (items.length < BIAS_RISK_MAX) {
    const anchoring = enabledOffer('bias_anchoring');
    if (anchoring !== undefined) {
      const point = estimatePointsOf(f)[0];
      if (point !== undefined) {
        add('DSK-B-001', 'Anchoring', `Olumi’s starting figure for ‘${point.label}’ could pull later estimates towards it.`, oneLine(point.label), anchoring);
      }
    }
  }

  return items;
}

const enabledOfferOf = (offers: readonly ActionOffer[], id: ActionId): ActionOffer | undefined =>
  offers.find(o => o.action_id === id && o.enabled === true && o.target === undefined);

export function biasRiskOf(f: ActionFacts, offers: readonly ActionOffer[], frame: OptionFrame): BiasRiskV1 | undefined {
  const fired = firedBiasesOf(f, offers, frame);
  return fired.length > 0 ? { v: 1, items: fired.map(b => b.wire) } : undefined;
}

/**
 * The bias check press (P45 slice 3, 0 LLM): the same owner's fired items, said with the model item each could bite on.
 * "Checked" names only what this bar could check; what it could not check yet is said, never reported as "none fire".
 */
export function biasCheckReply(f: ActionFacts, offers: readonly ActionOffer[]): { text: string; exits: ActionOffer[] } {
  const fired = firedBiasesOf(f, offers, f.optionFrame);
  const narrowChecked = enabledOfferOf(offers, 'more_options') !== undefined;
  const anchoringFired = fired.some(b => b.wire.claim_id === 'DSK-B-001');
  // Anchoring is checked when it fired, or on a bound Run whose model holds no Olumi figure at all. An Olumi figure that
  // cannot be shown (display-scale filter) is "not checked yet", never "none fire".
  const anchoringChecked = anchoringFired || (f.runBound && f.olumiEstimateCount === 0);
  const anchoringWhy = f.runBound ? 'Olumi can’t show its starting figures in this model yet' : 'it needs a current analysis first';
  const checked = [...(narrowChecked ? ['Narrow framing'] : []), ...(anchoringChecked ? ['Anchoring'] : [])];
  const lines = [
    ...(checked.length > 0 ? [`Checked: ${checked.join(', ')}.`] : []),
    // Science's verbatim sentence sits right under "Checked", so "these" is only the checked patterns.
    ...(checked.length > 0 && fired.length === 0 ? ["None of these patterns' triggers fire in this model."] : []),
    ...(narrowChecked ? [] : ['Not checked yet: Narrow framing, because the model needs a goal first.']),
    ...(anchoringChecked ? [] : [`Not checked yet: Anchoring, because ${anchoringWhy}.`]),
  ];
  for (const b of fired) {
    lines.push(`${b.wire.name}: where the pattern could bite: ‘${b.item}’. One test: press ‘${oneLine(b.offer.label)}’.`);
    if (b.wire.science !== undefined) {
      lines.push(`Decision-science claim: ${b.wire.science.claim_title} · ${b.wire.science.evidence_strength} evidence`);
    }
  }
  if (fired.length > 0) lines.push('Which of these is worth ten minutes now?');
  return { text: lines.join('\n'), exits: fired.map(b => b.offer) };
}

/** A model label quoted inside one line: whitespace runs (incl. newlines) collapse, and quote marks cannot close the quote. */
const oneLine = (label: string): string => label.replace(/\s+/g, ' ').trim().replace(/[‘’]/g, "'");
