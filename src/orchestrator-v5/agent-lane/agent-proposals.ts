/**
 * The process's one held-proposal store, and how many durable answer rows a reload reads for its offer, on their own so the
 * program's card turn (`program-card-turn.ts`) loads none of the Living Model's offer rules (W5, alpha wall).
 * `held-approval-offers.ts` re-exports both; nothing changed.
 */
import { ProposalStore } from './proposal.js';

/** The SAME process store the turn route authorises and settles. */
export const agentProposals = new ProposalStore();

/** At most eight per-turn durable reads per opt-in graph request. */
export const HELD_OFFER_ROWS_READ_CAP = 8;
