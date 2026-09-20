/**
 * SHARED-DATA-LAYER WRITE PATH — DELIBERATE RELIABILITY SET
 * =========================================================
 *
 * A NAMED set for five failure modes of the canonical turn-write path, rather
 * than coverage that happens to arise where each one was last debugged.
 *
 * ── WHAT THIS FILE IS, AND WHAT IT IS NOT ────────────────────────────────────
 * These are STATIC SQL ORACLES over the committed migration files. CI has no
 * Postgres, so they pin the load-bearing ORDER and CONJUNCTS of the two RPCs
 * that own every turn write. They establish that the SQL SOURCE at this tip
 * still says what the app's reliability guarantees assume. They do NOT execute
 * Postgres, and therefore do NOT establish that Postgres behaves as the source
 * reads — for that there is `scripts/rehearse-turn-fence-first-write-exemption
 * .mjs` (39 recorded checks against real Postgres 16), which is a MANUAL script
 * outside every suite. The gap this file closes is stated per-describe.
 *
 * ── WHY EACH ASSERTION IS HERE (measured 2026-09-20, not assumed) ────────────
 * Sibling suites already cover, and are deliberately NOT duplicated:
 *   · the CLIENT mapping of OLGC1 → GraphStaleWriteError and the
 *     two-edits-one-base dead end — supabase-store-graph-cas-v3.test.ts;
 *   · v5's OWN added CAS guard, including its unstamped-row exemption —
 *     supabase-store-v5-cas-static-guards.test.ts;
 *   · v5's no-swallow / marker-version-head ordering —
 *     model-management/__tests__/atomic-restore-migration-static-guards.test.ts;
 *   · a degraded prior-fact read reading "unknown", never "none" —
 *     context/__tests__/freshness-degraded-fact-read.test.ts;
 *   · the app-level replay answer and the fence exemption —
 *     turn-fence-first-write-exemption.test.ts.
 *
 * What NOTHING covered before this file, in v4 — the RPC every non-versioned
 * graph write still takes:
 *   1. that the conflict-replay RETURN is ordered BEFORE the graph update, the
 *      handler-facts loop and the brief update. The existing guard asserts only
 *      that `ON CONFLICT ... DO NOTHING` appears, which is silent about the
 *      three writes a duplicate submission must not repeat. The real-Postgres
 *      rehearsal calls v4 with `p_handler_facts => '[]'` and
 *      `p_brief_text => NULL` on every one of its 39 checks, so the facts and
 *      brief limbs are unexercised there too.
 *   2. that the function body carries NO exception handler, which is what makes
 *      a CAS refusal roll the already-inserted turn row back. v5 has exactly
 *      this guard; v4 had none.
 *   3. that v4's CAS carries the `v_current_hash IS NOT NULL` conjunct — the
 *      first-write exemption for a scenario whose `graph_identity_hash` was
 *      never stamped. The rehearsal always passes
 *      `p_expected_graph_identity_hash => null` and `p_cas_enforce => false`,
 *      so it cannot reach this conjunct at all.
 *
 * Every assertion binds by IDENTITY (a named anchor string at a measured
 * offset), never by a value predicate another region could satisfy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const V4_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260806120000_v5_turn_fence_first_write_exemption.sql',
    import.meta.url,
  ),
);
const V5_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql',
    import.meta.url,
  ),
);

/** Comment-stripped view — an executable-SQL claim must never match prose. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const v4Source = readFileSync(V4_PATH, 'utf8');
const v5Source = readFileSync(V5_PATH, 'utf8');

/**
 * The v4 body: from its own CREATE to the terminating `$$;`. Scoping matters —
 * the file also carries prose and grant statements, and an offset comparison
 * over the whole file would silently compare a comment against code.
 */
function extractV4Body(source: string): string {
  const code = stripComments(source);
  const start = code.indexOf('CREATE OR REPLACE FUNCTION public.append_turn_atomic_v4(');
  const end = code.indexOf('$$;', start);
  return start === -1 || end === -1 ? '' : code.slice(start, end);
}

/** The v5 APPEND body only — the same file also defines the restore RPC. */
function extractV5AppendBody(source: string): string {
  const code = stripComments(source);
  const start = code.indexOf('CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5(');
  const end = code.indexOf('$$;', start);
  return start === -1 || end === -1 ? '' : code.slice(start, end);
}

const v4 = extractV4Body(v4Source).replace(/\s+/g, ' ');
const v5 = extractV5AppendBody(v5Source).replace(/\s+/g, ' ');

/** Offset of an anchor, asserted present by identity before it is compared. */
function at(body: string, anchor: string, label: string): number {
  const idx = body.indexOf(anchor);
  expect(idx, `${label}: anchor not found — "${anchor}"`).toBeGreaterThan(-1);
  return idx;
}

function count(body: string, needle: string): number {
  return body.split(needle).length - 1;
}

// ── PROBE LIVENESS ───────────────────────────────────────────────────────────
// Every assertion below is an ORDER or ABSENCE claim over these two strings.
// An extraction that silently returned '' would make most of them vacuous and
// the absence claims trivially true, so the instrument is proven first.
describe('write-path reliability set — probe liveness (a blind oracle agrees with everything)', () => {
  it('both migration bodies were located and are non-empty', () => {
    expect(v4.length, 'the v4 function body extracted empty').toBeGreaterThan(2000);
    expect(v5.length, 'the v5 append body extracted empty').toBeGreaterThan(2000);
  });

  it('CONTRAST CONTROL: the extractor discriminates — v4 names v4 and not the v5 RPC body', () => {
    expect(v4).toContain('append_turn_atomic_v4');
    expect(v5).toContain('append_turn_atomic_v5');
    // v5 DELEGATES to v4, so it legitimately mentions the name; what it must
    // not contain is v4's own turn INSERT (that is the delegation's whole
    // point, and it is what proves the two extractions are different regions).
    expect(count(v4, 'INSERT INTO v5_conversation_turns (')).toBe(1);
    expect(count(v5, 'INSERT INTO v5_conversation_turns (')).toBe(0);
  });

  it('CONTRAST CONTROL: the comment stripper removed prose without eating code', () => {
    expect(v4Source).toContain('-- ');
    expect(v4).not.toContain('-- ');
    expect(v4).toContain("ERRCODE = 'OLGC1'");
  });
});

// ── CASE 1 + CASE 3 ──────────────────────────────────────────────────────────
// Duplicate submission, and the interrupted caller who retries. Both arrive as
// the SAME (scenario_id, turn_id) a second time, and both depend on one thing:
// the conflict arm RETURNS before any of v4's three durable side effects.
describe('CASE 1/3 — a duplicate (scenario_id, turn_id) replays and repeats NO durable write', () => {
  it('the turn insert claims the row with ON CONFLICT DO NOTHING, exactly once', () => {
    expect(count(v4, 'ON CONFLICT (scenario_id, turn_id) DO NOTHING')).toBe(1);
    const insert = at(v4, 'INSERT INTO v5_conversation_turns (', 'turn insert');
    const conflict = at(v4, 'ON CONFLICT (scenario_id, turn_id) DO NOTHING', 'conflict clause');
    expect(conflict).toBeGreaterThan(insert);
  });

  it('the conflict arm re-reads the EXISTING row id, bound to (scenario_id, turn_id)', () => {
    const read = at(v4, 'SELECT id INTO v_turn_id', 'replay read');
    // Identity binding: the replay must select the row by the submission key,
    // not "the latest turn" or any other predicate another row could satisfy.
    const keyed = v4.indexOf('WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id', read);
    expect(keyed, 'the replay read is not keyed on (scenario_id, turn_id)').toBeGreaterThan(read);
    expect(v4.indexOf('RETURN v_turn_id;', keyed)).toBeGreaterThan(keyed);
  });

  it('the replay RETURN precedes the graph update — a second submission writes no second graph', () => {
    const replayReturn = v4.indexOf(
      'RETURN v_turn_id;',
      at(v4, 'SELECT id INTO v_turn_id', 'replay read'),
    );
    const graphUpdate = at(v4, 'SET graph = p_graph,', 'graph update');
    expect(count(v4, 'SET graph = p_graph,')).toBe(1);
    expect(
      graphUpdate,
      'the graph update is reachable on a replay: a duplicate submission would ' +
        'overwrite a graph a later turn may already have committed',
    ).toBeGreaterThan(replayReturn);
  });

  it('the replay RETURN precedes the handler-facts insert — no duplicate facts', () => {
    const replayReturn = v4.indexOf(
      'RETURN v_turn_id;',
      at(v4, 'SELECT id INTO v_turn_id', 'replay read'),
    );
    const facts = at(v4, 'INSERT INTO v5_handler_facts (', 'handler-facts insert');
    expect(count(v4, 'INSERT INTO v5_handler_facts (')).toBe(1);
    expect(
      facts,
      'v5_handler_facts has no (turn, fact) uniqueness constraint, so a ' +
        'reachable second pass DUPLICATES every fact of the turn silently',
    ).toBeGreaterThan(replayReturn);
  });

  it('the replay RETURN precedes the brief update — no second brief write', () => {
    const replayReturn = v4.indexOf(
      'RETURN v_turn_id;',
      at(v4, 'SELECT id INTO v_turn_id', 'replay read'),
    );
    const brief = at(v4, 'SET brief_text = p_brief_text,', 'brief update');
    expect(count(v4, 'SET brief_text = p_brief_text,')).toBe(1);
    expect(brief).toBeGreaterThan(replayReturn);
  });

  it('CASE 3 (v5): the pre-existing-turn arm answers BEFORE the idempotency marker write', () => {
    const arm = at(v5, 'IF v_turn_preexisting THEN', 'v5 replay arm');
    const marker = at(v5, 'UPDATE public.v5_conversation_turns', 'v5 marker claim');
    expect(
      marker,
      'the marker UPDATE is the first NEW write of a versioned append; a replay ' +
        'reaching it would re-claim a turn that is already durable',
    ).toBeGreaterThan(arm);
  });

  it('CASE 3 (v5): the replay recovers the DURABLE receipt, keyed by mutation id and source turn', () => {
    const arm = at(v5, 'IF v_turn_preexisting THEN', 'v5 replay arm');
    const marker = at(v5, 'UPDATE public.v5_conversation_turns', 'v5 marker claim');
    const receiptRead = at(v5, 'SELECT * INTO v_version FROM public.model_versions', 'receipt read');
    expect(receiptRead).toBeGreaterThan(arm);
    expect(receiptRead).toBeLessThan(marker);
    // Identity binding: the recovered receipt must be THIS mutation's and THIS
    // turn's, never "a version of this scenario" — which another turn satisfies.
    const keyed = v5.indexOf(
      'mutation_id = p_version_mutation_id AND source_turn_id = p_turn_id',
      receiptRead,
    );
    expect(keyed, 'the receipt read is not bound to (mutation_id, source_turn_id)').toBeGreaterThan(
      receiptRead,
    );
    expect(keyed).toBeLessThan(marker);
  });

  it('CASE 3 (v5): a replay under a DIFFERENT mutation id is refused (MV422), inside the arm', () => {
    const arm = at(v5, 'IF v_turn_preexisting THEN', 'v5 replay arm');
    const marker = at(v5, 'UPDATE public.v5_conversation_turns', 'v5 marker claim');
    const reuse = at(v5, "USING ERRCODE = 'MV422'", 'MV422 raise');
    expect(reuse).toBeGreaterThan(arm);
    expect(
      reuse,
      'MV422 must fire inside the replay arm — after the marker write it would ' +
        'be reporting on a turn it had already mutated',
    ).toBeLessThan(marker);
  });
});

// ── CASE 2 ───────────────────────────────────────────────────────────────────
describe('CASE 2 — a stale-revision write is refused with OLGC1 and leaves NOTHING behind', () => {
  it('the CAS raise is ordered AFTER the turn insert, so the abort is load-bearing', () => {
    const insert = at(v4, 'INSERT INTO v5_conversation_turns (', 'turn insert');
    const raise = at(v4, "ERRCODE = 'OLGC1'", 'CAS raise');
    expect(
      raise,
      'if the raise ever moved BEFORE the insert this ordering claim would be ' +
        'vacuous — it is asserted so the no-handler guard below stays meaningful',
    ).toBeGreaterThan(insert);
  });

  it('the v4 body carries NO exception handler — nothing can swallow the raise', () => {
    expect(
      /\bEXCEPTION\s+WHEN\b/i.test(v4),
      'an EXCEPTION ... WHEN block would catch OLGC1 and let the function RETURN ' +
        'normally with the turn row already inserted — a partially-written refusal',
    ).toBe(false);
  });

  it('POSITIVE CONTROL: the no-handler probe can SEE a handler when one is present', () => {
    // An absence assertion is vacuous until its probe is shown to fire. This is
    // the same predicate, run against a body that deliberately contains one.
    const withHandler = v4.replace(
      'RETURN v_turn_id; END;',
      'RETURN v_turn_id; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;',
    );
    expect(withHandler, 'the synthetic mutation did not apply').not.toBe(v4);
    expect(/\bEXCEPTION\s+WHEN\b/i.test(withHandler)).toBe(true);
  });

  it('the refusal names the expected AND the current hash, so the caller can re-read', () => {
    const raise = at(v4, "ERRCODE = 'OLGC1'", 'CAS raise');
    const message = v4.indexOf('p_expected_graph_identity_hash, v_current_hash)', raise);
    expect(
      message,
      'a refusal that does not report the current hash leaves the caller unable to ' +
        'distinguish a stale base from a broken write',
    ).toBeGreaterThan(raise);
  });
});

// ── CASE 5 ───────────────────────────────────────────────────────────────────
describe('CASE 5 — the FIRST write on a scenario whose graph_identity_hash is NULL is NOT refused', () => {
  it('v4 CAS carries the v_current_hash IS NOT NULL conjunct (the unstamped-row exemption)', () => {
    const casIf = at(v4, 'IF p_cas_enforce', 'CAS gate');
    const raise = at(v4, "ERRCODE = 'OLGC1'", 'CAS raise');
    const exemption = v4.indexOf('AND v_current_hash IS NOT NULL', casIf);
    expect(
      exemption,
      'without this conjunct every scenario whose graph_identity_hash was never ' +
        'stamped is refused on its first instrumented write — the outage the ' +
        'migration this file reads is literally named after',
    ).toBeGreaterThan(casIf);
    // Identity binding: the conjunct must be part of THIS gate's predicate,
    // i.e. between the IF and the raise it guards — not some later condition.
    expect(exemption).toBeLessThan(raise);
  });

  it('the CAS gate and the FENCE exemption are two different gates, not one', () => {
    // `v_has_graph` exempts the turn-fence OLTF2 verdict; `v_current_hash IS
    // NOT NULL` exempts the CAS. Conflating them is how one of the two gets
    // "already covered" and then deleted. Pin that they are disjoint regions.
    const fenceExemption = at(
      v4,
      'IF p_fence_generation < v_fence_max AND v_has_graph THEN',
      'fence (OLTF2) exemption',
    );
    const insert = at(v4, 'INSERT INTO v5_conversation_turns (', 'turn insert');
    const casIf = at(v4, 'IF p_cas_enforce', 'CAS gate');
    expect(
      fenceExemption,
      'the fence exemption must be decided before the turn insert; the CAS gate ' +
        'runs after it, on the graph write',
    ).toBeLessThan(insert);
    expect(insert).toBeLessThan(casIf);
    expect(v4.slice(casIf, at(v4, "ERRCODE = 'OLGC1'", 'CAS raise'))).not.toContain('v_has_graph');
  });

  it('the unstamped exemption survives the incoming-hash escape too (no second bypass)', () => {
    const casIf = at(v4, 'IF p_cas_enforce', 'CAS gate');
    const raise = at(v4, "ERRCODE = 'OLGC1'", 'CAS raise');
    const predicate = v4.slice(casIf, raise);
    expect(predicate).toContain('p_expected_graph_identity_hash IS NOT NULL');
    expect(predicate).toContain('v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash');
  });
});
