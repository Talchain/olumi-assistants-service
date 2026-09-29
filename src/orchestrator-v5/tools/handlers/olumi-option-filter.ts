/**
 * ⛔ AN OPTION OLUMI PROPOSED IS NOT COMPARED AS THE USER'S (DL 5887489508 / 5887510885; AIQ 5887484795; PTL root 2).
 *
 * MG's construction marks an option the drafter added, and the brief did not name, `proposed_by: 'olumi'`
 * (`isOlumiProposedOption`, the ONE predicate the analysis hash reads too). The Run decides what is compared, AFTER
 * `gateAnalysableOptions`, because only then is the true compared set known:
 *   - at least 2 of the USER's options would be analysed → Olumi's are left out of the submission, typed
 *     `excluded_olumi_proposed` ("Olumi suggests…", Add to comparison);
 *   - fewer → leaving them out would leave no comparison, so they STAY, typed `kept_olumi_provisional`, naming the user's
 *     option(s) the Run could not analyse. The comparison is then Olumi's, provisional; the unqualified leader claim is
 *     withheld (Canonical's intake, #2293, fails closed on an analysed Olumi option).
 * A filter that can never create a refusal: it only removes options when at least 2 of the user's remain.
 *
 * Only options OUTSIDE the ordinary comparison appear in `participation`; a Run with none gives `[]`.
 */
import { isOlumiProposedOption } from '../../context/olumi-proposed-option.js';
import type { ExcludedOptionRecord } from './analysable-option-gate.js';

type Rec = Record<string, unknown>;

/** One option outside the user's ordinary comparison, and why. */
export interface OptionParticipationEntry {
  readonly option_id: string;
  readonly state: 'excluded_olumi_proposed' | 'kept_olumi_provisional';
  /** `kept_olumi_provisional` only, when there are any: the user's options the Run could not analyse. */
  readonly unanalysable_user_option_ids?: readonly string[];
}

export interface OlumiOptionFilterOutcome {
  /** The set to SUBMIT: the gate's submission, less Olumi's options when at least 2 of the user's remain. */
  readonly options: ReadonlyArray<Rec>;
  readonly participation: readonly OptionParticipationEntry[];
}

/** The fewest options a comparison needs (PLoT's `/v2/run` requires 2). */
const MIN_COMPARED = 2;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const optionIdOf = (o: Rec): string | null =>
  (typeof o.option_id === 'string' && o.option_id !== '' ? o.option_id : typeof o.id === 'string' && o.id !== '' ? o.id : null);

/**
 * The Run filter. `graph` is the persisted graph the Run read (its option nodes carry the mark); `submitted` is the
 * gate's submission; `excluded` the gate's exclusions (options with nothing set).
 */
export function filterOlumiProposedOptions(input: {
  readonly submitted: ReadonlyArray<Rec>;
  readonly graph: unknown;
  readonly excluded: readonly ExcludedOptionRecord[];
}): OlumiOptionFilterOutcome {
  const nodes = isRec(input.graph) && Array.isArray(input.graph.nodes) ? input.graph.nodes.filter(isRec) : [];
  const proposedIds = new Set(nodes.filter(isOlumiProposedOption).map((n) => n.id).filter((id): id is string => typeof id === 'string'));
  if (proposedIds.size === 0) return { options: input.submitted, participation: [] };
  const isProposed = (o: Rec): boolean => { const id = optionIdOf(o); return id !== null && proposedIds.has(id); };
  const proposed = input.submitted.filter(isProposed);
  if (proposed.length === 0) return { options: input.submitted, participation: [] };
  const users = input.submitted.filter((o) => !isProposed(o));
  if (users.length >= MIN_COMPARED) {
    return {
      options: users,
      participation: proposed.map((o) => ({ option_id: optionIdOf(o)!, state: 'excluded_olumi_proposed' as const })),
    };
  }
  const unanalysable = input.excluded.map((e) => e.option_id).filter((id) => !proposedIds.has(id));
  return {
    options: input.submitted,
    participation: proposed.map((o) => ({
      option_id: optionIdOf(o)!, state: 'kept_olumi_provisional' as const,
      ...(unanalysable.length > 0 ? { unanalysable_user_option_ids: unanalysable } : {}),
    })),
  };
}
