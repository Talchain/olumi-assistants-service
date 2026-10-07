/**
 * event_risk.v1 CENSUS REPLAY of `input_snapshot.sent_digest` (Science 393023 §4 byte-identity).
 *
 * Claim: a Run whose graph carries no `event_risk` sends PLoT a byte-identical request before and
 * after the event_risk.v1 declaration on CEE's `NodeV3`, so its `sent_digest` is unchanged.
 *
 * Method (0 LLM, no network, no database): for each row, re-run the Run loader's node parse
 * (`GraphV3.safeParse`, build-turn-context.ts) on the payload's graph, rebuild the payload with the
 * parsed graph, and print `sentDigest` (run-input-snapshot.ts, the function the Run records). Run it
 * in a BASE tree and in the BRANCH tree on the same input, then diff the two outputs. Every legacy
 * row must match. A contrast row (`event_risk` added to one risk node) must DIFFER: the branch
 * carries the block and the base strips it. That proves the probe can see a difference. When a row
 * carries `stored_sent_digest`, the script also prints whether the payload as given reproduces it,
 * which shows the corpus row is the bytes the Run actually sent.
 *
 * Input: a JSON array of `{ id, payload, stored_sent_digest? }`, where `payload` is a CEE→PLoT /v2/run
 * body. The stored Runs live in the shared database (production's), which a build lane may not
 * touch, so the DL exports the rows read-only. Until then the lane runs this over the served
 * CEE→PLoT captures in the PLoT repo's test fixtures.
 *
 * Usage: pnpm tsx scripts/census/event-risk-sent-digest-replay.ts <rows.json>
 */
import { readFileSync } from 'node:fs';
import { GraphV3 } from '../../src/schemas/cee-v3.js';
import { sentDigest } from '../../src/orchestrator-v5/tools/handlers/run-input-snapshot.js';

type Rec = Record<string, unknown>;
interface Row { id: string; payload: Rec; stored_sent_digest?: string }

const rows = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Row[];
for (const row of rows) {
  const parsed = GraphV3.safeParse(row.payload.graph);
  if (!parsed.success) {
    console.log(`${row.id}\tPARSE_FAILED`);
    continue;
  }
  const replayed = sentDigest({ ...row.payload, graph: parsed.data });
  const stored = row.stored_sent_digest === undefined
    ? 'no_stored_digest'
    : sentDigest(row.payload) === row.stored_sent_digest ? 'stored_reproduced' : 'stored_MISMATCH';
  const carries = (parsed.data.nodes as Rec[]).filter((n) => n.event_risk !== undefined).length;
  console.log(`${row.id}\t${replayed}\tevent_risk_nodes=${carries}\t${stored}`);
}
