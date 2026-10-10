/**
 * REAL /agent/v1/turn route: selected-converse.
 * Doubles: getSessionStore (in-memory storage reads/append), internal POST
 * /assist/v1/scenarios/:scenario/graph snapshot read. Provider fetch intercepted;
 * exact sentBody bytes + sha256 written under out/provider/selected-converse/. No network.
 * Fixture run1/run2 come verbatim from prior seed manifests. All mutations and
 * synthetic revision probes are documented in fixtures/README.md.
 */
import { installContract } from './contract-rows.js';
installContract('selected-converse');
