import { proposeProductIdentity, type IdentityProposal } from './identity-proposal.js';
import { proposeCeilingStock } from './ceiling-stock.js';
import { timeClassOf } from '../goal-target/time-class.js';

/**
 * The reading a card may be OFFERED for, on a stored model and its brief: the structural product / net-flow reading, else the
 * ceiling-stock reading. A brief that states a timing shape the product cannot yet work out over time (`time-class.ts`) is
 * offered none: the card's Yes would license a chance that ignores the mechanism. This can only withhold; it never offers a
 * card that the two proposers would not. Every issuing door (the Run's hint, the re-offer, the Agent's `propose_identity`)
 * goes through here, and `time-class.guard.test.ts` fails on a door that does not.
 */
export function identityReadingWithinTimeClass(graph: unknown, brief: string | null | undefined): IdentityProposal | null {
  if (!timeClassOf(brief).supported) return null;
  return proposeProductIdentity(graph) ?? proposeCeilingStock(graph, brief);
}
