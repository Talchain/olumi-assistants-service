/**
 * append_turn_atomic_v4 (in-transaction turn fence) migration — SQL-text
 * static guards, same convention as the v3 guards beside this file: CI
 * cannot reach a live database, so these pin the load-bearing lines of the
 * migration FILE so a later edit cannot silently drop them. The BEHAVIOUR
 * was rehearsed against an ephemeral Postgres (forward + rollback + parity
 * with the test fake) — evidence in
 * PHASE0-EVIDENCE-2026-07-28/fence-hardening-build.md.
 *
 * Mutation anchors: delete the fence gate block and the OLTF assertions go
 * red; swap the stopped/superseded order and the precedence assertion goes
 * red; drop the fence-row FOR UPDATE and the serialisation assertion goes
 * red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TURN_FENCE_ATOMIC_SQLSTATE } from '../turn-fence.js';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql',
    import.meta.url,
  ),
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/rollback/20260731130000_v5_turn_fence_atomic_append_rollback.sql.do-not-apply',
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

describe('append_turn_atomic_v4 migration — execution posture', () => {
  it('header declares AUTHORED-not-executed, orchestrator-sequenced, with a pending execution date', () => {
    expect(sql).toMatch(/AUTHORED AS CODE — NOT EXECUTED/);
    expect(sql).toMatch(/orchestrator/i);
    expect(sql).toMatch(/Date executed:\s*\(pending/);
  });

  it('header states the FEATURE-DETECT posture: deploy order is free, PGRST202 falls back to the two-step', () => {
    expect(sql).toMatch(/FEATURE-DETECTS/);
    expect(sql).toMatch(/PGRST202/);
  });
});

describe('append_turn_atomic_v4 migration — distinct name (PostgREST ambiguity class)', () => {
  it('creates a DISTINCTLY named function — never an overload of append_turn_atomic / _v2 / _v3', () => {
    expect(codeOneline).toMatch(
      /CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v4\(/,
    );
    expect(codeOneline).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.append_turn_atomic(_v[23])?\(/,
    );
  });

  it('the fence generation is an optional BIGINT defaulting NULL (v3-equivalent when absent)', () => {
    expect(codeOneline).toMatch(/p_fence_generation\s+BIGINT\s+DEFAULT NULL/);
  });
});

describe('append_turn_atomic_v4 migration — the in-transaction fence gate (fix c core)', () => {
  it('the gate is guarded on BOTH the fence generation and a graph being present', () => {
    expect(codeOneline).toMatch(
      /IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL THEN/,
    );
  });

  it('locks the turn’s OWN fence row FOR UPDATE — the Stop-serialisation point', () => {
    expect(codeOneline).toMatch(
      /FROM v5_turn_fence WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id FOR UPDATE/,
    );
  });

  it('raises the three verdict SQLSTATEs — the exact codes the app maps (derived, not mirrored)', () => {
    // Derive from the app constant: if classifyAtomicFenceError and this
    // migration ever disagree on a code, this goes red — one authority.
    for (const state of Object.values(TURN_FENCE_ATOMIC_SQLSTATE)) {
      expect(code).toContain(`ERRCODE = '${state}'`);
    }
  });

  it('stopped wins over superseded (the classifier’s precedence, in SQL order)', () => {
    const stoppedIdx = code.indexOf(`ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.stopped}'`);
    const supersededIdx = code.indexOf(
      `ERRCODE = '${TURN_FENCE_ATOMIC_SQLSTATE.superseded}'`,
    );
    expect(stoppedIdx).toBeGreaterThan(-1);
    expect(supersededIdx).toBeGreaterThan(stoppedIdx);
  });

  it('refusal DETAIL carries {"generation","max_generation"} JSON for the app’s telemetry', () => {
    expect(codeOneline).toMatch(/DETAIL = format\('\{"generation": %s, "max_generation": %s\}'/);
  });

  it('the gate runs BEFORE the conversation-turn insert (a stopped replay refuses, as the live two-step does today)', () => {
    const gateIdx = code.indexOf('IF p_fence_generation IS NOT NULL');
    const insertIdx = code.indexOf('INSERT INTO v5_conversation_turns');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(gateIdx);
  });

  it('lock ordering is scenarios-first (v3’s writer serialisation), fence row second', () => {
    const scenariosLock = codeOneline.indexOf('FROM scenarios WHERE id = p_scenario_id FOR UPDATE');
    const fenceLock = codeOneline.indexOf(
      'FROM v5_turn_fence WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id FOR UPDATE',
    );
    expect(scenariosLock).toBeGreaterThan(-1);
    expect(fenceLock).toBeGreaterThan(scenariosLock);
  });
});

describe('append_turn_atomic_v4 migration — v3 semantics preserved verbatim', () => {
  it('keeps the in-transaction CAS block raising OLGC1', () => {
    expect(code).toContain("ERRCODE = 'OLGC1'");
    expect(codeOneline).toMatch(/IF p_cas_enforce AND p_expected_graph_identity_hash IS NOT NULL/);
  });

  it('keeps the conflict-replay idempotency branch (ON CONFLICT DO NOTHING → return existing id)', () => {
    expect(codeOneline).toMatch(/ON CONFLICT \(scenario_id, turn_id\) DO NOTHING/);
  });

  it('keeps the write-once brief_text predicate', () => {
    expect(codeOneline).toMatch(/AND \(brief_text IS NULL OR brief_text = ''\)/);
  });
});

describe('append_turn_atomic_v4 migration — security posture (A4 lesson)', () => {
  it('revokes EXECUTE from PUBLIC, anon and authenticated and grants service_role only', () => {
    expect(codeOneline).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.append_turn_atomic_v4\([^)]+\) FROM PUBLIC, anon, authenticated/,
    );
    expect(codeOneline).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.append_turn_atomic_v4\([^)]+\) TO service_role/,
    );
  });
});

describe('append_turn_atomic_v4 rollback', () => {
  it('drops exactly the v4 function and nothing else', () => {
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.append_turn_atomic_v4\(/);
    expect(rollback).not.toMatch(/DROP TABLE/);
    expect(rollback).not.toMatch(/append_turn_atomic_v[23]/);
  });
});
