import { describe, expect, it } from "vitest";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const ANALYSIS_A = "1".repeat(64);
const ANALYSIS_B = "2".repeat(64);

interface Write {
  turn: string;
  mutation: string;
  expected: string | null;
  incoming: string;
  analysis: string;
  graph: unknown;
  owned?: boolean;
  casEnforce: boolean;
}

interface Receipt {
  mutation_id: string;
  version_id: string;
  version_number: number;
  graph_identity_hash: string;
  analysis_affecting_hash: string;
  parent_version_id: string | null;
  undo_version_id: string | null;
  event_id: string;
}

interface State {
  graphHash: string | null;
  graph: unknown;
  head: string | null;
  turns: Array<{ id: string; mutation: string; versionCreated: boolean }>;
  versions: Receipt[];
  events: string[];
}

class AtomicAppendModel {
  state: State;
  private tail: Promise<void> = Promise.resolve();

  constructor(graphHash: string | null = null) {
    this.state = {
      graphHash,
      graph: graphHash === null ? null : { id: "base" },
      head: null,
      turns: [],
      versions: [],
      events: [],
    };
  }

  snapshot(): State {
    return structuredClone(this.state);
  }

  async append(write: Write, failAt?: "after_turn" | "after_version") {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return this.appendLocked(write, failAt);
    } finally {
      release();
    }
  }

  private appendLocked(write: Write, failAt?: "after_turn" | "after_version") {
    const tx = this.snapshot();
    const replay = tx.turns.find((turn) => turn.id === write.turn);
    if (replay) {
      if (replay.mutation !== write.mutation) throw new Error("MV422");
      if (!replay.versionCreated) return null;
      return tx.versions.find(
        (version) => version.mutation_id === write.mutation
      )!;
    }

    // append_turn_atomic_v4 is the sole CAS authority. Its compatibility
    // contract deliberately skips comparison when enforcement is off, the
    // expectation is null, or the current persisted hash is null.
    if (
      write.casEnforce &&
      write.expected !== null &&
      tx.graphHash !== null &&
      tx.graphHash !== write.expected &&
      write.incoming !== tx.graphHash
    ) {
      throw new Error("OLGC1");
    }
    const createVersion =
      write.owned !== false && tx.graphHash !== write.incoming;
    tx.turns.push({
      id: write.turn,
      mutation: write.mutation,
      versionCreated: createVersion,
    });
    if (failAt === "after_turn") throw new Error("injected after turn");
    tx.graphHash = write.incoming;
    tx.graph = write.graph;
    if (createVersion) {
      const parent = tx.head;
      const receipt: Receipt = {
        mutation_id: write.mutation,
        version_id: `version-${write.mutation}`,
        version_number: tx.versions.length + 1,
        graph_identity_hash: write.incoming,
        analysis_affecting_hash: write.analysis,
        parent_version_id: parent,
        undo_version_id: parent,
        event_id: `model_version_created_mutation_${write.mutation}`,
      };
      tx.versions.push(receipt);
      tx.head = receipt.version_id;
      tx.events.push(receipt.event_id);
      if (failAt === "after_version") throw new Error("injected after version");
      this.state = tx;
      return receipt;
    }
    this.state = tx;
    return null;
  }
}

function write(
  turn: string,
  mutation: string,
  expected: string | null,
  incoming: string,
  analysis: string,
  casEnforce = true
): Write {
  return {
    turn,
    mutation,
    expected,
    incoming,
    analysis,
    graph: { incoming },
    casEnforce,
  };
}

describe("C8 atomic semantic append behaviour", () => {
  it.each(["after_turn", "after_version"] as const)(
    "rolls back turn/graph/version/head/event on %s failure",
    async (failAt) => {
      const db = new AtomicAppendModel(HASH_A);
      const before = db.snapshot();
      await expect(
        db.append(
          write("turn-1", "mutation-1", HASH_A, HASH_B, ANALYSIS_B),
          failAt
        )
      ).rejects.toThrow("injected");
      expect(db.state).toEqual(before);
    }
  );

  it("serializes enforced writers from a non-null base: one success and one total rollback", async () => {
    const db = new AtomicAppendModel(HASH_A);
    const results = await Promise.allSettled([
      db.append(write("turn-1", "mutation-1", HASH_A, HASH_B, ANALYSIS_A)),
      db.append(write("turn-2", "mutation-2", HASH_A, HASH_C, ANALYSIS_B)),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(db.state.turns).toHaveLength(1);
    expect(db.state.versions).toHaveLength(1);
    expect(db.state.events).toHaveLength(1);
    expect(db.state.graphHash).toBe(HASH_B);
  });

  it("preserves v4 first-write/null-expectation compatibility instead of inventing a v5 CAS", async () => {
    const db = new AtomicAppendModel(null);
    const results = await Promise.allSettled([
      db.append(write("turn-1", "mutation-1", null, HASH_A, ANALYSIS_A)),
      db.append(write("turn-2", "mutation-2", null, HASH_B, ANALYSIS_B)),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(db.state.turns).toHaveLength(2);
    expect(db.state.versions).toHaveLength(2);
    expect(db.state.events).toHaveLength(2);
    expect(db.state.graphHash).toBe(HASH_B);
  });

  it("preserves v4's first-write guard when current is null but expectation is stale", async () => {
    const db = new AtomicAppendModel(null);
    const receipt = await db.append(
      write("turn-1", "mutation-1", HASH_C, HASH_A, ANALYSIS_A)
    );
    expect(receipt?.graph_identity_hash).toBe(HASH_A);
    expect(db.state.graphHash).toBe(HASH_A);
  });

  it("preserves v4's p_cas_enforce=false compatibility path", async () => {
    const db = new AtomicAppendModel(HASH_A);
    const receipt = await db.append(
      write("turn-1", "mutation-1", HASH_C, HASH_B, ANALYSIS_B, false)
    );
    expect(receipt?.graph_identity_hash).toBe(HASH_B);
    expect(db.state.graphHash).toBe(HASH_B);
  });

  it("returns the byte-identical original receipt on replay with zero writes", async () => {
    const db = new AtomicAppendModel(HASH_A);
    const operation = write("turn-1", "mutation-1", HASH_A, HASH_B, ANALYSIS_B);
    const first = await db.append(operation);
    const after = db.snapshot();
    const replay = await db.append(operation);
    expect(replay).toEqual(first);
    expect(db.state).toEqual(after);
  });

  it("commits exact self-noop and guest turns with no version/head/event, including replay", async () => {
    const db = new AtomicAppendModel(HASH_A);
    const noop = write(
      "turn-noop",
      "mutation-noop",
      HASH_A,
      HASH_A,
      ANALYSIS_A
    );
    expect(await db.append(noop)).toBeNull();
    const afterNoop = db.snapshot();
    expect(await db.append(noop)).toBeNull();
    expect(db.state).toEqual(afterNoop);

    const guest = {
      ...write("turn-guest", "mutation-guest", HASH_A, HASH_B, ANALYSIS_B),
      owned: false,
    };
    expect(await db.append(guest)).toBeNull();
    expect(db.state.turns).toHaveLength(2);
    expect(db.state.versions).toHaveLength(0);
    expect(db.state.events).toHaveLength(0);
    expect(db.state.head).toBeNull();
  });

  it("keeps full and analysis identities separate and makes undo equal parent/head", async () => {
    const db = new AtomicAppendModel(HASH_A);
    const first = await db.append(
      write("turn-1", "mutation-1", HASH_A, HASH_B, ANALYSIS_A)
    );
    const second = await db.append(
      write("turn-2", "mutation-2", HASH_B, HASH_C, ANALYSIS_B)
    );
    expect(first).toMatchObject({
      graph_identity_hash: HASH_B,
      analysis_affecting_hash: ANALYSIS_A,
      parent_version_id: null,
      undo_version_id: null,
    });
    expect(second!.undo_version_id).toBe(second!.parent_version_id);
    expect(second!.undo_version_id).toBe(first!.version_id);
  });
});
