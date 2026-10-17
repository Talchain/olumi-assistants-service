/** Unit-only legacy products use symbolic revisions/raw mirrors. Delegate the REAL native preparation on the
 * canonical saved shape/hash. No offer verdict is fabricated; real-route/hash-fence evidence lives in native specs. */
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { preOfferOptionInterventions } from '../../../system-events/option-intervention-preoffer.js';

export function canonicalFixturePreoffer(real: typeof preOfferOptionInterventions): typeof preOfferOptionInterventions {
  return async (input, before, context) => {
    const graph = projectGraphForPersistence(before);
    const hash = computeAnalysisAffectingGraphHash(graph as never);
    if (hash === null) throw new Error('The unit fixture has no canonical graph hash');
    return real({ ...input, expectedGraphHash: hash }, graph, context);
  };
}
