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

export type BiasClaimId = 'DSK-B-001' | 'DSK-B-006' | 'DSK-B-007';

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
  'DSK-B-001': ['frame', 'evaluate'],
  'DSK-B-006': ['frame', 'decide'],
  'DSK-B-007': ['frame', 'ideate'],
};

export function biasRiskOf(f: ActionFacts, offers: readonly ActionOffer[]): BiasRiskV1 | undefined {
  if (!f.readable) return undefined;

  const enabledOffer = (id: ActionId) => offers.find(o => o.action_id === id && o.enabled === true && o.target === undefined);
  const widen = f.rcRows.filter(r => r.policy_id === 'RC-WIDEN' && r.target === 'options');
  const stage = f.canonicalStage === null ? null : mapStageToDecisionStage(f.canonicalStage);
  const items: BiasRiskItem[] = [];
  const add = (claim_id: BiasClaimId, name: string, why: string, offer: ActionOffer): void => {
    const science = stage !== null && STAGES[claim_id].includes(stage) ? resolveDskClaimProvenance(claim_id) : null;
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
  if (moreOptions !== undefined) {
    const sameLever = widen.some(r => r.variant === 'W3');
    if (sameLever || widen.some(r => r.variant === 'W2')) {
      add('DSK-B-007', 'Narrow framing', sameLever
        ? BIAS_CUE.narrow_framing
        : 'There is only one option besides doing nothing, which can hide better routes.', moreOptions);
    }
    if (widen.some(r => r.variant === 'W4')) {
      add('DSK-B-006', 'Status quo', BIAS_CUE.status_quo, moreOptions);
    }
  }

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
