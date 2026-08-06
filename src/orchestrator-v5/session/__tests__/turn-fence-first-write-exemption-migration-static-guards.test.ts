/**
 * FIRST-WRITE EXEMPTION migration (ROADMAP 2.709) — SQL-text static guards
 * over 20260806120000, same convention as the v3/v4 guard suites beside this
 * file: CI cannot reach a live database, so these pin the load-bearing lines
 * of the migration FILE. The BEHAVIOUR is proven by the executable rehearsal
 * (scripts/rehearse-turn-fence-first-write-exemption.mjs — 26/26 against
 * real Postgres 16, including the RED reproduction of the phantom state
 * against the deployed 20260802120000 SQL), and the app-side semantics are
 * mirrored by the fake in turn-fence-first-write-exemption.test.ts.
 *
 * THE LINES THIS SUITE EXISTS FOR:
 *   · graph presence is read IN the scenarios FOR UPDATE select (zero
 *     check-to-write window — the whole point of doing it in SQL);
 *   · OLTF2 raises ONLY behind `v_has_graph` (the exemption) AND behind the
 *     arrival-8 replay passthrough;
 *   · OLTF1 (stopped) stays UNCONDITIONAL and ordered BEFORE OLTF2;
 *   · the generation-keyed lookup of 2.301 is preserved verbatim;
 *   · the trace columns ship with IF NOT EXISTS;
 *   · the rollback restores the unconditional-OLTF2 body and does NOT drop
 *     the columns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TURN_FENCE_ATOMIC_SQLSTATE } from '../turn-fence.js';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260806120000_v5_turn_fence_first_write_exemption.sql',
    import.meta.url,
  ),
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/rollback/20260806120000_v5_turn_fence_first_write_exemption_rollback.sql.do-not-apply',
    import.meta.url,
  ),
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const rollback = readFileSync(ROLLBACK_PATH, 'utf8');

/** Comment-stripped view — executable-SQL assertions must not match prose. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}
const code = stripComments(sql);
const codeOneline = code.replace(/\s+/g, ' ');
const rollbackCode = stripComments(rollback);
const rollbackOneline = rollbackCode.replace(/\s+/g, ' ');

describe('first-write-exemption migration — execution posture', () => {
  it('header declares AUTHORED-not-executed with a pending, Paul-gated execution date', () => {
    expect(sql).toMatch(/AUTHORED AS CODE — NOT EXECUTED/);
    expect(sql).toMatch(/Date executed:\s*\(pending/);
  });

  it('header names the rehearsal harness that must pass before execution', () => {
    expect(sql).toMatch(/rehearse-turn-fence-first-write-exemption\.mjs/);
  });
});

describe('first-write-exemption migration — the trace columns (invariant 6)', () => {
  it('adds both columns with IF NOT EXISTS (idempotent re-apply)', () => {
    expect(codeOneline).toMatch(
      /ALTER TABLE public\.v5_turn_fence ADD COLUMN IF NOT EXISTS graph_write_failed_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS graph_write_failure_reason TEXT/,
    );
  });
});

describe('first-write-exemption migration — THE EXEMPTION ITSELF', () => {
  it('reads graph presence INSIDE the scenarios FOR UPDATE select (zero-window predicate)', () => {
    expect(codeOneline).toMatch(
      /SELECT user_id, graph_identity_hash, \(graph IS NOT NULL\) INTO v_user_id, v_current_hash, v_has_graph FROM scenarios WHERE id = p_scenario_id FOR UPDATE/,
    );
  });

  it('OLTF2 raises ONLY behind v_has_graph (a graph-less scenario’s first write proceeds)', () => {
    expect(codeOneline).toMatch(/IF p_fence_generation < v_fence_max AND v_has_graph/);
    // And the unconditional form must be GONE from the executable SQL.
    expect(codeOneline).not.toMatch(/IF p_fence_generation < v_fence_max THEN/);
  });

  it('OLTF2 also carries the arrival-8 replay passthrough (committed turn retries return the row id)', () => {
    expect(codeOneline).toMatch(
      /AND NOT EXISTS \( SELECT 1 FROM v5_conversation_turns WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id \)/,
    );
  });

  it('OLTF1 (stopped) stays UNCONDITIONAL — no graph-presence or replay term anywhere near it', () => {
    const stoppedRaise = code.slice(
      code.indexOf('IF v_fence_stopped_at IS NOT NULL'),
      code.indexOf(`ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.stopped}'`),
    );
    expect(stoppedRaise.length).toBeGreaterThan(0);
    expect(stoppedRaise).not.toContain('v_has_graph');
    expect(stoppedRaise).not.toContain('NOT EXISTS');
  });

  it('stopped wins over superseded (OLTF1 raise ordered before OLTF2)', () => {
    const stoppedIdx = code.indexOf(`ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.stopped}'`);
    const supersededIdx = code.indexOf(`ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.superseded}'`);
    expect(stoppedIdx).toBeGreaterThan(-1);
    expect(supersededIdx).toBeGreaterThan(stoppedIdx);
  });

  it('raises all three verdict SQLSTATEs — derived from the app constant, not mirrored', () => {
    for (const state of Object.values(TURN_FENCE_ATOMIC_SQLSTATE)) {
      expect(code).toContain(`ERRCODE = '${state}'`);
    }
  });
});

describe('first-write-exemption migration — 2.301 semantics preserved', () => {
  it('locks the fence row by scenario_id + ADMITTED GENERATION (never the write identity)', () => {
    expect(codeOneline).toMatch(
      /FROM v5_turn_fence WHERE scenario_id = p_scenario_id AND generation = p_fence_generation FOR UPDATE/,
    );
    const fenceBlock = codeOneline.slice(
      codeOneline.indexOf('FROM v5_turn_fence'),
      codeOneline.indexOf('INSERT INTO v5_conversation_turns'),
    );
    expect(fenceBlock.length).toBeGreaterThan(0);
    // The ONE legitimate turn_id predicate inside the gate is the replay
    // passthrough against v5_conversation_turns; the FENCE lookup itself
    // must never key on it.
    expect(fenceBlock).not.toMatch(/v5_turn_fence[^;]*turn_id = p_turn_id/);
  });

  it('replaces the SAME distinctly-named 19-arg function — no overload, no rename', () => {
    expect(codeOneline).toMatch(/CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v4\(/);
    expect(codeOneline).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.append_turn_atomic(_v[235])?\(/,
    );
    expect(codeOneline).toMatch(/p_fence_generation\s+BIGINT\s+DEFAULT NULL/);
  });

  it('service-role-only ACLs restated (defence-in-depth)', () => {
    expect(codeOneline).toMatch(/REVOKE EXECUTE ON FUNCTION public\.append_turn_atomic_v4/);
    expect(codeOneline).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(codeOneline).toMatch(/GRANT EXECUTE ON FUNCTION public\.append_turn_atomic_v4/);
    expect(codeOneline).toMatch(/TO service_role/);
  });
});

describe('first-write-exemption migration — rollback', () => {
  it('is a do-not-apply file that RESTORES the unconditional-OLTF2 (20260802120000) body', () => {
    expect(rollback).toMatch(/DO NOT APPLY/);
    expect(rollbackOneline).toMatch(/CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v4\(/);
    expect(rollbackOneline).toMatch(/IF p_fence_generation < v_fence_max THEN/);
    expect(rollbackOneline).not.toContain('v_has_graph');
  });

  it('does NOT drop the trace columns (a deployed app may still write them)', () => {
    expect(rollbackCode).not.toMatch(/DROP COLUMN/i);
    expect(rollback).toMatch(/LEFT IN PLACE/);
  });
});
