import type { OlumiResponse } from '@talchain/schemas/boundary';

import type { CommitResult } from '../../commit.js';
import { buildCanonicalCommittedGraphReceipt } from '../../compose/committed-graph-receipt.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

const EMPTY_PENDING_LIFECYCLE = {
  priorCount: 0,
  consumedCount: 0,
  supersededCount: 0,
  expiredWallCount: 0,
  expiredTurnsCount: 0,
  hashInvalidatedCount: 0,
  capDroppedCount: 0,
  survivedCount: 0,
} as const;

/**
 * Honest post-commit fixture for edit-dispatch tests.
 *
 * The production dispatcher now fails closed unless its mocked commit returns
 * the same canonical persisted graph/hash pair as the real commit seam. Keep
 * that contract in one fixture so unrelated dispatch tests do not hand-build
 * incomplete success receipts.
 */
export function canonicalCommitResultFixture(
  graph: unknown | null,
  options: {
    readonly response?: OlumiResponse;
    readonly persistedRowId?: string;
  } = {},
): CommitResult {
  const persistedGraph = graph === null
    ? null
    : projectGraphForPersistence(graph, { source: 'test_fixture' });
  const persistedAnalysisGraphHash = persistedGraph === null
    ? null
    : computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      );

  return {
    response: options.response ?? ({} as OlumiResponse),
    performed: true,
    persisted_row_id: options.persistedRowId ?? 'row-test',
    graphPersisted: persistedGraph !== null,
    pendingLifecycle: EMPTY_PENDING_LIFECYCLE,
    persistedAnalysisGraphHash,
    persistedGraph,
    canonicalGraphReceipt: persistedGraph === null
      ? null
      : buildCanonicalCommittedGraphReceipt(persistedGraph),
    canonicalAnalysisReady: persistedGraph === null
      ? null
      : (buildCanonicalAnalysisReadyFromGraph(persistedGraph) ?? null),
  };
}
