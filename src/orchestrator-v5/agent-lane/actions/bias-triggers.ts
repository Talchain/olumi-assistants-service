/**
 * The one bias-trigger owner, P45 slice 1; SCI-08 bias_check consumes it.
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

export function biasRiskOf(f: ActionFacts, offers: readonly ActionOffer[], frame: OptionFrame): BiasRiskV1 | undefined {
  if (!f.readable) return undefined;

  const enabledOffer = (id: ActionId) => offers.find(o => o.action_id === id && o.enabled === true && o.target === undefined);
  const stage = f.canonicalStage === null ? null : mapStageToDecisionStage(f.canonicalStage);
  const items: BiasRiskItem[] = [];
  const add = (claim_id: BiasClaimId, name: string, why: string, offer: ActionOffer): void => {
    const science = biasBadgeApplies(claim_id, stage) ? resolveDskClaimProvenance(claim_id) : null;
    items.push({
      claim_id,
      name,
      why,
      action_id: offer.action_id,
      press_id: offer.press_id,
      offer_key: offer.offer_key,
      ...(science !== null ? { science } : {}),
    });
  };

  const moreOptions = enabledOffer('more_options');
  if (moreOptions !== undefined && (frame.sameLever || (frame.nonSqOptionLabels.length === 1 && frame.nonSqOptionLabels[0] !== ''))) {
    const o = frame.nonSqOptionLabels[0];
    add('DSK-B-007', 'Narrow framing', frame.sameLever
      ? BIAS_CUE.narrow_framing
      : frame.statusQuoPresent
        ? `The only choice on the table is ‘${o}’ or carrying on as now, which can hide other routes.`
        : `‘${o}’ is the only option on the table, which can hide other routes.`, moreOptions);
  }
  // DSK-B-006 waits for a per-option risk fact (Science 393023, 7 Oct): W4 is a missing baseline, not status quo bias.

  if (items.length < BIAS_RISK_MAX) {
    const anchoring = enabledOffer('bias_anchoring');
    if (anchoring !== undefined) {
      const point = estimatePointsOf(f)[0];
      if (point !== undefined) {
        add('DSK-B-001', 'Anchoring', `Olumi’s starting figure for ‘${point.label}’ could pull later estimates towards it.`, anchoring);
      }
    }
  }

  return items.length > 0 ? { v: 1, items } : undefined;
}
