/**
 * ⛔ AN OPTION OLUMI PROPOSED IS NOT COMPARED AS THE USER'S (DL 5887489508 / 5887510885; AIQ 5887484795; PTL root 2).
 *
 * MG's construction marks an option the drafter added, and the brief did not name, `proposed_by: 'olumi'`
 * (`isOlumiProposedOption`, the ONE predicate the analysis hash reads too). The Run decides what is compared, AFTER
 * `gateAnalysableOptions`, because only then is the true compared set known:
 *   - at least 2 DISTINCT user options survive PLoT's intervention dedup → Olumi's are left out;
 *   - fewer → Olumi's stay, the comparison is provisional, and no leader is permitted.
 * This no-schema-bump Run path carries no typed participation card.
 */
import { isOlumiProposedOption } from '../../context/olumi-proposed-option.js';
import { interventionFingerprint } from './analysis-ready-core.js';

type Rec = Record<string, unknown>;

export interface OlumiOptionFilterOutcome {
  /** The set to SUBMIT: the gate's submission, less Olumi's options when at least 2 of the user's remain. */
  readonly options: ReadonlyArray<Rec>;
  readonly keptOlumiProvisional: boolean;
}

/** The fewest options a comparison needs (PLoT's `/v2/run` requires 2). */
const MIN_COMPARED = 2;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const optionIdOf = (o: Rec): string | null =>
  (typeof o.option_id === 'string' && o.option_id !== '' ? o.option_id : typeof o.id === 'string' && o.id !== '' ? o.id : null);

/**
 * The Run filter. `graph` is the persisted graph the Run read (its option nodes carry the mark); `submitted` is the
 * gate's submission.
 */
export function filterOlumiProposedOptions(input: {
  readonly submitted: ReadonlyArray<Rec>;
  readonly graph: unknown;
}): OlumiOptionFilterOutcome {
  const nodes = isRec(input.graph) && Array.isArray(input.graph.nodes) ? input.graph.nodes.filter(isRec) : [];
  const proposedIds = new Set(nodes.filter(isOlumiProposedOption).map((n) => n.id).filter((id): id is string => typeof id === 'string'));
  if (proposedIds.size === 0) return { options: input.submitted, keptOlumiProvisional: false };
  const isProposed = (o: Rec): boolean => { const id = optionIdOf(o); return id !== null && proposedIds.has(id); };
  if (!input.submitted.some(isProposed)) return { options: input.submitted, keptOlumiProvisional: false };
  const users = input.submitted.filter((o) => !isProposed(o));
  // The engine deduplicates identical intervention maps. Two user-labelled
  // submissions count only when two distinct comparisons would survive.
  const distinctUserMaps = new Set(users.map((o) => {
    const interventions = isRec(o.interventions) ? o.interventions : null;
    return interventions !== null && Object.keys(interventions).length > 0
      ? interventionFingerprint(interventions) : null;
  }).filter((fingerprint): fingerprint is string => fingerprint !== null));
  if (distinctUserMaps.size >= MIN_COMPARED) {
    return { options: users, keptOlumiProvisional: false };
  }
  return { options: input.submitted, keptOlumiProvisional: true };
}
