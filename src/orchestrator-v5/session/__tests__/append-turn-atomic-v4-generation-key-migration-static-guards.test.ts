/**
 * append_turn_atomic_v4 GENERATION-KEYED fence gate (ROADMAP 2.301) — SQL-text
 * static guards over the CORRECTED migration file, same convention as the
 * v3/v4 guards beside this file: CI cannot reach a live database, so these
 * pin the load-bearing lines of the migration FILE so a later edit cannot
 * silently drop them. The BEHAVIOUR is proven by the executable rehearsal
 * (scripts/rehearse-turn-fence-atomic-append-generation-key.mjs), which
 * reproduces the staging outage RED against the 20260731130000 SQL and
 * proves the corrected SQL GREEN, with mismatched identities throughout.
 *
 * THE ONE LINE THIS SUITE EXISTS FOR: the fence-row lookup must be keyed on
 * the ADMITTED GENERATION (`generation = p_fence_generation`), never on the
 * commit's write identity (`turn_id = p_turn_id`) — turn-executor commits
 * pass the server request_id as the write identity, while the fence row was
 * claimed under the browser's payload.turn_id, so a turn_id-keyed gate
 * refuses every graph-bearing edit/confirm commit (the 2.301 outage, dead
 * on staging 31 Jul 22:17Z → 2 Aug). turn-fence.ts's header documents the
 * hazard; the executed 20260731130000 violated it.
 *
 * Mutation anchors: key the lookup back on turn_id and the lookup-key guards
 * go red; drop the gate or reorder stopped/superseded and the corresponding
 * pins go red; change the signature and the signature pin goes red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TURN_FENCE_ATOMIC_SQLSTATE } from '../turn-fence.js';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260802120000_v5_turn_fence_atomic_append_generation_key.sql',
    import.meta.url,
  ),
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/rollback/20260802120000_v5_turn_fence_atomic_append_generation_key_rollback.sql.do-not-apply',
    import.meta.url,
  ),
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const rollback = readFileSync(ROLLBACK_PATH, 'utf8');

/** Comment-stripped view — executable-SQL assertions must not match prose. */
const code = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');
const codeOneline = code.replace(/\s+/g, ' ');

describe('generation-key migration — execution posture', () => {
  it('header declares AUTHORED-not-executed with a pending, Paul-gated execution date', () => {
    expect(sql).toMatch(/AUTHORED AS CODE — NOT EXECUTED/);
    expect(sql).toMatch(/Date executed:\s*\(pending/);
  });

  it('header names the rehearsal harness that must pass before execution', () => {
    expect(sql).toMatch(/rehearse-turn-fence-atomic-append-generation-key\.mjs/);
  });
});

describe('generation-key migration — THE LOOKUP KEY (the 2.301 fix itself)', () => {
  it('locks the fence row by scenario_id + ADMITTED GENERATION', () => {
    expect(codeOneline).toMatch(
      /FROM v5_turn_fence WHERE scenario_id = p_scenario_id AND generation = p_fence_generation FOR UPDATE/,
    );
  });

  it('NEVER keys the fence lookup on the write identity (turn_id = p_turn_id) — the executed-migration defect', () => {
    // The write identity appears in executable SQL ONLY as the
    // v5_conversation_turns insert/replay key. Any `turn_id = p_turn_id`
    // predicate against v5_turn_fence is the outage reintroduced.
    const fenceBlock = codeOneline.slice(
      codeOneline.indexOf('FROM v5_turn_fence'),
      codeOneline.indexOf('INSERT INTO v5_conversation_turns'),
    );
    expect(fenceBlock.length).toBeGreaterThan(0);
    expect(fenceBlock).not.toContain('turn_id = p_turn_id');
  });

  it('p_turn_id keeps its one correct job: the conversation-turns insert + replay key', () => {
    expect(codeOneline).toMatch(/ON CONFLICT \(scenario_id, turn_id\) DO NOTHING/);
    expect(codeOneline).toMatch(
      /FROM v5_conversation_turns WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id/,
    );
  });
});

describe('generation-key migration — signature unchanged (no PostgREST hazard)', () => {
  it('replaces the SAME distinctly-named 19-arg function — no overload, no rename', () => {
    expect(codeOneline).toMatch(
      /CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v4\(/,
    );
    expect(codeOneline).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.append_turn_atomic(_v[235])?\(/,
    );
    expect(codeOneline).toMatch(/p_fence_generation\s+BIGINT\s+DEFAULT NULL/);
  });
});

describe('generation-key migration — fence-gate semantics preserved', () => {
  it('the gate is guarded on BOTH the fence generation and a graph being present', () => {
    expect(codeOneline).toMatch(
      /IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL THEN/,
    );
  });

  it('raises the three verdict SQLSTATEs — derived from the app constant, not mirrored', () => {
    for (const state of Object.values(TURN_FENCE_ATOMIC_SQLSTATE)) {
      expect(code).toContain(`ERRCODE = '${state}'`);
    }
  });

  it('stopped wins over superseded (the classifier precedence, in SQL order)', () => {
    const stoppedIdx = code.indexOf(`ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.stopped}'`);
    const supersededIdx = code.indexOf(
      `ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.superseded}'`,
    );
    expect(stoppedIdx).toBeGreaterThan(-1);
    expect(supersededIdx).toBeGreaterThan(stoppedIdx);
  });

  it('refusal DETAIL carries {"generation","max_generation"} JSON for the app telemetry', () => {
    expect(codeOneline).toMatch(/DETAIL = format\('\{"generation": %s, "max_generation": %s\}'/);
  });

  it('the gate runs BEFORE the conversation-turn insert (a stopped replay refuses)', () => {
    const gateIdx = code.indexOf('IF p_fence_generation IS NOT NULL');
    const insertIdx = code.indexOf('INSERT INTO v5_conversation_turns');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(gateIdx);
  });

  it('lock ordering is scenarios-first (writer serialisation), fence row second', () => {
    const scenariosLock = codeOneline.indexOf('FROM scenarios WHERE id = p_scenario_id FOR UPDATE');
    const fenceLock = codeOneline.indexOf(
      'FROM v5_turn_fence WHERE scenario_id = p_scenario_id AND generation = p_fence_generation FOR UPDATE',
    );
    expect(scenariosLock).toBeGreaterThan(-1);
    expect(fenceLock).toBeGreaterThan(scenariosLock);
  });
});

describe('generation-key migration — v3 semantics preserved verbatim', () => {
  it('keeps the in-transaction CAS block raising OLGC1', () => {
    expect(code).toContain("ERRCODE = 'OLGC1'");
    expect(codeOneline).toMatch(/IF p_cas_enforce AND p_expected_graph_identity_hash IS NOT NULL/);
  });

  it('keeps the write-once brief_text predicate', () => {
    expect(codeOneline).toMatch(/AND \(brief_text IS NULL OR brief_text = ''\)/);
  });
});

describe('generation-key migration — security posture (A4 lesson)', () => {
  it('revokes EXECUTE from PUBLIC, anon and authenticated and grants service_role only', () => {
    expect(codeOneline).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.append_turn_atomic_v4\([^)]+\) FROM PUBLIC, anon, authenticated/,
    );
    expect(codeOneline).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.append_turn_atomic_v4\([^)]+\) TO service_role/,
    );
  });
});

describe('generation-key rollback', () => {
  it('drops exactly the v4 function and nothing else — and does NOT restore the defective body', () => {
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.append_turn_atomic_v4\(/);
    expect(rollback).not.toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(rollback).not.toMatch(/DROP TABLE/);
    expect(rollback).not.toMatch(/append_turn_atomic_v[23]/);
  });
});
