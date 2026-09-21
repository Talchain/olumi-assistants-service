/**
 * Behavioural proof for the C8-A transaction contract.
 *
 * A small stateful model mirrors the RPC's row lock, copy-on-write transaction,
 * replay-before-CAS ordering and append-only rows. SQL text parity is pinned by
 * atomic-restore-migration-static-guards.test.ts.
 */
import { describe, expect, it } from "vitest";

const TARGET_A = "11111111-1111-4111-8111-111111111111";
const TARGET_B = "22222222-2222-4222-8222-222222222222";
const MUTATION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MUTATION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH_CURRENT = "1".repeat(64);
const HASH_TARGET_A = "2".repeat(64);
const HASH_TARGET_B = "3".repeat(64);
const ANALYSIS_CURRENT = "4".repeat(64);
const ANALYSIS_SHARED = "5".repeat(64);

type FailurePoint = "after_undo" | "after_restore" | undefined;

interface VersionRow {
  id: string;
  source: string | null;
  mutation: string | null;
  parent: string | null;
  graph: unknown;
  fullHash: string;
  analysisHash: string | null;
}

interface RestoreWrite {
  target: string;
  mutation: string;
  expectedHash: string | null;
}

interface Receipt {
  mutation_id: string;
  version_id: string;
  graph_identity_hash: string;
  analysis_affecting_hash: string | null;
  restored_from_version_id: string;
  undo_version_id: string | null;
  graph: unknown;
  deduped: boolean;
  replayed: boolean;
  event_id: string;
}

interface DbState {
  graph: unknown;
  graphHash: string | null;
  head: string | null;
  events: string[];
  versions: VersionRow[];
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

class AtomicRestoreModel {
  state: DbState = {
    graph: { nodes: [{ id: "current", label: "Working" }], edges: [] },
    graphHash: HASH_CURRENT,
    head: null,
    events: [],
    versions: [
      {
        id: TARGET_A,
        source: null,
        mutation: null,
        parent: null,
        graph: { nodes: [{ id: "target-a", label: "A" }], edges: [] },
        fullHash: HASH_TARGET_A,
        analysisHash: ANALYSIS_SHARED,
      },
      {
        id: TARGET_B,
        source: null,
        mutation: null,
        parent: null,
        graph: { nodes: [{ id: "target-b", label: "B" }], edges: [] },
        fullHash: HASH_TARGET_B,
        analysisHash: ANALYSIS_SHARED,
      },
    ],
  };

  private tail: Promise<void> = Promise.resolve();

  snapshot(): DbState {
    return copy(this.state);
  }

  async restore(write: RestoreWrite, failure?: FailurePoint): Promise<Receipt> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return this.restoreLocked(write, failure);
    } finally {
      release();
    }
  }

  private restoreLocked(write: RestoreWrite, failure?: FailurePoint): Receipt {
    const tx = copy(this.state);
    const existing = tx.versions.find((row) => row.mutation === write.mutation);
    if (existing) {
      if (existing.source !== write.target) throw new Error("MV422");
      return this.receipt(existing, true);
    }

    const target = tx.versions.find((row) => row.id === write.target);
    if (!target) throw new Error("MV404");
    if (tx.graphHash !== write.expectedHash) throw new Error("MV409");

    const undo: VersionRow = {
      id: `undo-${write.mutation}`,
      source: null,
      mutation: null,
      parent: tx.head,
      graph: tx.graph,
      fullHash: tx.graphHash!,
      analysisHash: ANALYSIS_CURRENT,
    };
    tx.versions.push(undo);
    if (failure === "after_undo") throw new Error("injected after undo");

    const restored: VersionRow = {
      id: `restore-${write.mutation}`,
      source: target.id,
      mutation: write.mutation,
      parent: undo.id,
      graph: target.graph,
      fullHash: target.fullHash,
      analysisHash: target.analysisHash,
    };
    tx.versions.push(restored);
    if (failure === "after_restore") throw new Error("injected after restore");

    tx.graph = target.graph;
    tx.graphHash = target.fullHash;
    tx.head = restored.id;
    tx.events.push(`model_version_restored_mutation_${write.mutation}`);
    this.state = tx;
    return this.receipt(restored, false);
  }

  private receipt(row: VersionRow, replayed: boolean): Receipt {
    return {
      mutation_id: row.mutation!,
      version_id: row.id,
      graph_identity_hash: row.fullHash,
      analysis_affecting_hash: row.analysisHash,
      restored_from_version_id: row.source!,
      undo_version_id: row.parent,
      graph: row.graph,
      deduped: false,
      replayed,
      event_id: `model_version_restored_mutation_${row.mutation}`,
    };
  }
}

describe("C8-A transaction behaviour", () => {
  it.each(["after_undo", "after_restore"] as const)(
    "rolls back every row/head/graph/event write on failure injection %s",
    async (failure) => {
      const db = new AtomicRestoreModel();
      const before = db.snapshot();
      await expect(
        db.restore(
          {
            target: TARGET_A,
            mutation: MUTATION_A,
            expectedHash: HASH_CURRENT,
          },
          failure
        )
      ).rejects.toThrow(/injected/);
      expect(db.state).toEqual(before);
    }
  );

  it("serializes competing writers: one commits and the same-base loser cannot clobber it", async () => {
    const db = new AtomicRestoreModel();
    const results = await Promise.allSettled([
      db.restore({
        target: TARGET_A,
        mutation: MUTATION_A,
        expectedHash: HASH_CURRENT,
      }),
      db.restore({
        target: TARGET_B,
        mutation: MUTATION_B,
        expectedHash: HASH_CURRENT,
      }),
    ]);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toEqual(
      new Error("MV409")
    );
    expect(db.state.graphHash).toBe(HASH_TARGET_A);
    expect(db.state.events).toEqual([
      `model_version_restored_mutation_${MUTATION_A}`,
    ]);
    expect(
      db.state.versions.filter((row) => row.mutation !== null)
    ).toHaveLength(1);
  });

  it("replays the same mutation before CAS with the exact original receipt and no new writes", async () => {
    const db = new AtomicRestoreModel();
    const first = await db.restore({
      target: TARGET_A,
      mutation: MUTATION_A,
      expectedHash: HASH_CURRENT,
    });
    const afterFirst = db.snapshot();
    const replay = await db.restore({
      target: TARGET_A,
      mutation: MUTATION_A,
      expectedHash: HASH_CURRENT,
    });

    const { replayed: firstReplayFlag, ...firstCanonical } = first;
    const { replayed: replayFlag, ...replayCanonical } = replay;
    expect(firstReplayFlag).toBe(false);
    expect(replayFlag).toBe(true);
    expect(replayCanonical).toEqual(firstCanonical);
    expect(db.state).toEqual(afterFirst);
  });

  it("refuses a mutation replayed for a different target", async () => {
    const db = new AtomicRestoreModel();
    await db.restore({
      target: TARGET_A,
      mutation: MUTATION_A,
      expectedHash: HASH_CURRENT,
    });
    await expect(
      db.restore({
        target: TARGET_B,
        mutation: MUTATION_A,
        expectedHash: HASH_TARGET_A,
      })
    ).rejects.toThrow("MV422");
  });

  it("keeps full identity and analysis-affecting identity distinct in rows and receipts", async () => {
    const db = new AtomicRestoreModel();
    const receipt = await db.restore({
      target: TARGET_A,
      mutation: MUTATION_A,
      expectedHash: HASH_CURRENT,
    });
    expect(receipt.graph_identity_hash).toBe(HASH_TARGET_A);
    expect(receipt.analysis_affecting_hash).toBe(ANALYSIS_SHARED);
    expect(receipt.graph_identity_hash).not.toBe(
      receipt.analysis_affecting_hash
    );
    const undo = db.state.versions.find(
      (row) => row.id === receipt.undo_version_id
    );
    expect(undo?.fullHash).toBe(HASH_CURRENT);
    expect(undo?.analysisHash).toBe(ANALYSIS_CURRENT);
  });
});
