/**
 * append_turn_atomic_v5 — STRICT EXPECTED-EMPTY (migration 20260924030000). SQL-text static
 * guards, the same convention as `append-turn-atomic-v5-replay-precedes-cas-static-guards`:
 * CI cannot reach a live database, so these pin the migration FILE. They say nothing about
 * the function installed in any database — that was not compared.
 *
 * THE HOLE THESE PIN (independent review of #1786, 5806044132). The installed guard
 * (20260920210000:263-276) exempts `p_incoming_graph_identity_hash IS NOT DISTINCT FROM
 * v_current_hash` as a content-idempotent retry. For a caller that asserted a KNOWN-EMPTY
 * base, a DIFFERENT operation that saved byte-identical bytes first is admitted, v5 creates
 * no version (current = incoming), and the route reports success with no receipt.
 *
 * ⭐ EVERY ASSERTION HAS A CONTRAST ON THE OLD FILE. The 20260920210000 migration is read by
 * the same probes and must come out the other way (no strict clause, no new parameter, no
 * DROP, a 30-type grant) — and where a probe asserts ABSENCE inside the strict clause
 * (`incoming` is not consulted), the same probe must find it PRESENT in the ordinary guard.
 *
 * Mutation anchors (run 2026-09-24): delete the strict clause → 4 red (ordering, existence,
 * no-exemption, presence read); add `p_incoming_graph_identity_hash IS DISTINCT FROM
 * v_current_hash` to it → the no-exemption assertion goes red; `DEFAULT TRUE` → the default
 * assertion goes red. The VERBATIM assertion guards everything OUTSIDE the marked blocks, so
 * it deliberately does not see an edit inside them — the clause assertions do.
 *
 * ⭐ ONE EMPTY PREDICATE (independent review of #1786, 5807034398). The presence read for an
 * unstamped row is the SQL mirror of graph-identity.ts `isIdentityEmptyGraph` — the predicate
 * the route's `expected_model_empty` preflight calls. The CORRESPONDENCE block parses the
 * read out of this file (`strict-expected-empty-sql-emulation.ts`, fail-closed) and compares
 * it with the TS function by behaviour: which keys count, how they count, and the verdict on
 * a probe set that includes non-objects. Mutation anchor: revert the read to nodes-only → the
 * correspondence and RED (2) cases go red here, and the rpc-double cases in
 * `supabase-store-atomic-version-v5.test.ts` (which evaluate the same parsed read) go red too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { isIdentityEmptyGraph } from '../../context/graph-identity.js';
import { strictPresenceFromMigration } from './strict-expected-empty-sql-emulation.js';

const TS = '20260924030000';
const rel = (p: string) => fileURLToPath(new URL(`../../../../supabase/migrations/${p}`, import.meta.url));
const NEW_RAW = readFileSync(rel(`${TS}_v5_append_v5_strict_expected_empty.sql`), 'utf8');
const OLD_RAW = readFileSync(rel('20260920210000_v5_append_v5_replay_precedes_cas.sql'), 'utf8');
const ORIGIN_RAW = readFileSync(rel('20260824200000_c8_atomic_model_version_restore.sql'), 'utf8');
const ROLLBACK_RAW = readFileSync(
  rel(`rollback/${TS}_v5_append_v5_strict_expected_empty_rollback.sql.do-not-apply`),
  'utf8',
);

const CREATE_HEAD = 'CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5(';

/** Comment-stripped view — executable-SQL assertions must not match prose. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** The v5 CREATE statement, from its head to its closing `$$;`, in the given view. */
function v5Function(sql: string): string {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) => l.startsWith(CREATE_HEAD));
  expect(start, 'v5 CREATE not found').toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === '$$;');
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join('\n');
}

type Param = { name: string; type: string; rest: string };
/** The CREATE's parameters, in order, from the comment-stripped text. */
function params(sql: string): Param[] {
  const fn = v5Function(executable(sql));
  const open = fn.indexOf('(');
  const close = fn.indexOf(')\nRETURNS');
  expect(close).toBeGreaterThan(open);
  return fn
    .slice(open + 1, close)
    .split(',')
    .map((p) => p.trim().split(/\s+/))
    .filter((parts) => parts[0] !== '')
    .map(([name, type, ...rest]) => ({ name: name!, type: type!.toUpperCase(), rest: rest.join(' ').toUpperCase() }));
}

/** Every `<VERB> … FUNCTION public.append_turn_atomic_v5(<types>) <tail>` statement. */
function signatureStatements(sql: string, verb: 'REVOKE' | 'GRANT' | 'DROP'): Array<{ types: string[]; tail: string }> {
  const re =
    verb === 'DROP'
      ? /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.append_turn_atomic_v5\s*\(([^)]*)\)\s*;/g
      : new RegExp(`${verb}\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.append_turn_atomic_v5\\s*\\(([^)]*)\\)([^;]*);`, 'g');
  return [...executable(sql).matchAll(re)].map((m) => ({
    types: m[1]!.split(',').map((t) => t.trim().toUpperCase()).filter((t) => t !== ''),
    tail: (m[2] ?? '').trim().replace(/\s+/g, ' '),
  }));
}

/** Index of a marker that MUST occur exactly once. */
function soleIndexOf(body: string, marker: string): number {
  const first = body.indexOf(marker);
  expect(first, `marker absent: ${marker}`).toBeGreaterThanOrEqual(0);
  expect(body.indexOf(marker, first + 1), `marker occurs more than once: ${marker}`).toBe(-1);
  return first;
}

/** The IF block whose opening line is EXACTLY `head` (trimmed, and unique), through its matching END IF. */
function ifBlock(body: string, head: string): string {
  const lines = body.split('\n');
  const hits = lines.flatMap((l, i) => (l.trim() === head ? [i] : []));
  expect(hits, `IF block head must occur exactly once: ${head}`).toHaveLength(1);
  const start = hits[0]!;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*IF\s/.test(lines[i]!)) depth++;
    if (/^\s*END IF;/.test(lines[i]!)) depth--;
    if (depth === 0) return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`unbalanced IF block: ${head}`);
}

const newBody = v5Function(executable(NEW_RAW));
const oldBody = v5Function(executable(OLD_RAW));
const originBody = v5Function(executable(ORIGIN_RAW));

const LOOKUP_MARKER = 'v_turn_preexisting := FOUND;';
const CAS_HEAD = 'IF p_cas_enforce';
const STRICT_HEAD = 'IF p_require_expected_empty THEN';
const REPLAY_GUARD = 'IF NOT v_turn_preexisting THEN';
const EXEMPTION = 'p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash';
const MESSAGE = "'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)'";

describe('append_turn_atomic_v5 — strict expected-empty (migration static guards)', () => {
  it('PROBE LIVENESS: both functions were located and are substantial', () => {
    expect(newBody.length).toBeGreaterThan(8000);
    expect(oldBody.length).toBeGreaterThan(8000);
    expect(params(NEW_RAW).length).toBeGreaterThan(25);
    expect(params(OLD_RAW).length).toBeGreaterThan(25);
  });

  it('the replay lookup still precedes the CAS AND the strict clause, and both sit inside the replay guard', () => {
    const lookup = soleIndexOf(newBody, LOOKUP_MARKER);
    const guard = soleIndexOf(newBody, REPLAY_GUARD);
    const cas = soleIndexOf(newBody, CAS_HEAD);
    const strict = soleIndexOf(newBody, STRICT_HEAD);
    expect(lookup).toBeLessThan(guard);
    expect(guard).toBeLessThan(cas);
    expect(cas).toBeLessThan(strict);
    // the strict clause is INSIDE the replay guard's block, not after it
    expect(ifBlock(newBody, REPLAY_GUARD)).toContain(STRICT_HEAD);
    // the lookup text itself is unchanged
    expect(newBody).toContain(
      'SELECT id, model_version_mutation_id, model_version_created\n    INTO v_existing_turn_id, v_turn_version_mutation_id, v_turn_version_created\n    FROM public.v5_conversation_turns\n    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;\n  v_turn_preexisting := FOUND;',
    );
  });

  it('⭐ CONTRAST — the ordering probe can see an ordering: 20260824200000 has the CAS ABOVE the lookup', () => {
    expect(soleIndexOf(originBody, CAS_HEAD)).toBeLessThan(soleIndexOf(originBody, LOOKUP_MARKER));
  });

  it('the strict clause exists in the new file and NOT in the old one', () => {
    expect(newBody).toContain(STRICT_HEAD);
    expect(oldBody).not.toContain(STRICT_HEAD);
    expect(oldBody).not.toContain('p_require_expected_empty');
  });

  it('⛔ the strict clause refuses ANY presence with OLGC1, and carries NO `incoming` exemption', () => {
    const strict = ifBlock(newBody, STRICT_HEAD);
    expect(strict).toContain('IF v_current_hash IS NOT NULL OR v_current_identity_bearing IS TRUE THEN');
    expect(strict).toContain("ERRCODE = 'OLGC1'");
    expect(strict).toContain(MESSAGE);
    // NOT consulted at all — neither the incoming hash nor any IS DISTINCT FROM, nor the posture
    expect(strict).not.toContain('p_incoming_graph_identity_hash');
    expect(strict).not.toContain('IS DISTINCT FROM');
    expect(strict).not.toContain('IS NOT DISTINCT FROM');
    expect(strict).not.toContain('p_cas_enforce');
  });

  it('⭐ CONTRAST — the same probe FINDS the exemption in the ordinary guard, in both files', () => {
    for (const body of [newBody, oldBody]) {
      const cas = ifBlock(body, CAS_HEAD);
      expect(cas).toContain(EXEMPTION);
      expect(cas).toContain("ERRCODE = 'OLGC1'");
      expect(cas).toContain(MESSAGE);
    }
  });

  it('the ordinary guard is byte-identical to 20260920210000 (the change adds, it does not re-specify)', () => {
    expect(ifBlock(newBody, CAS_HEAD)).toBe(ifBlock(oldBody, CAS_HEAD));
  });

  it('empty-but-present: an UNSTAMPED identity-bearing graph is presence; the read is object-guarded and CASE-protected', () => {
    const strict = ifBlock(newBody, STRICT_HEAD);
    const read = ifBlock(strict, 'IF v_current_hash IS NULL THEN');
    expect(read).toContain("SELECT CASE WHEN jsonb_typeof(graph) = 'object' THEN");
    for (const key of ['nodes', 'edges', 'options']) {
      expect(read).toContain(`CASE WHEN jsonb_typeof(graph -> '${key}') = 'array'`);
      expect(read).toContain(`THEN jsonb_array_length(graph -> '${key}') > 0`);
    }
    expect(read).toContain("OR (graph ? 'goal_node_id')");
    expect(read).toContain('ELSE FALSE');
    expect(read).toContain('INTO v_current_identity_bearing');
    expect(read).toContain('FROM public.scenarios');
    expect(read).toContain('WHERE id = p_scenario_id;');
    // the parsed variable is the one the refusal reads
    expect(strictPresenceFromMigration(NEW_RAW).variable).toBe('v_current_identity_bearing');
    // the unguarded form would raise on a non-array entry field
    expect(strict).not.toMatch(/jsonb_typeof\([^)]*\)\s*=\s*'array'\s+AND\s+jsonb_array_length/);
    expect(newBody).toMatch(/^\s*v_current_identity_bearing\s+BOOLEAN;$/m);
    expect(oldBody).not.toContain('v_current_identity_bearing');
    // the nodes-only predicate this replaced is gone
    expect(newBody).not.toContain('v_current_has_nodes');
  });

  /**
   * ⭐ ONE EMPTY PREDICATE AT BOTH BOUNDARIES (independent review of #1786, 5807034398).
   * The route's preflight is `isIdentityEmptyGraph` (graph-identity.ts); the SQL cannot import
   * it, so the SQL MIRRORS it and this pins the mirror. Nothing below restates either side:
   * the TS side is probed by calling `isIdentityEmptyGraph`, the SQL side is the migration's
   * own presence read, parsed fail-closed by `strictPresenceFromMigration`.
   */
  describe('⭐ CORRESPONDENCE — the SQL presence read IS graph-identity.ts `isIdentityEmptyGraph`', () => {
    const sql = strictPresenceFromMigration(NEW_RAW);
    type Kind = 'array' | 'presence' | 'none' | 'other';
    /** How a top-level key counts, measured by BEHAVIOUR over one value of each JSON type. */
    const kindOf = (bearing: (graph: unknown) => boolean, key: string): Kind => {
      const probes = [[1], [], 'x', null, {}, 0, false].map((v) => bearing({ [key]: v }));
      if (probes.every(Boolean)) return 'presence';
      if (probes.every((b) => !b)) return 'none';
      if (probes[0] && probes.slice(1).every((b) => !b)) return 'array';
      return 'other';
    };
    const tsBearing = (g: unknown) => !isIdentityEmptyGraph(g);
    // The key universe: every key the ingress schema declares, every key the SQL names, and a
    // few a graph plausibly carries. A TS key outside this set would go unseen — keep
    // `isIdentityEmpty` to schema-declared keys, or add it here.
    const universe = [
      ...new Set([
        ...Object.keys(GraphStateIngressSchema.shape),
        ...sql.arrayKeys,
        ...sql.presenceKeys,
        'goal', 'factors', 'constraints', 'meta', 'schema_version', 'version', 'id',
      ]),
    ].sort();

    it('PROBE LIVENESS: the presence read parsed from the file, and both probes see a known field', () => {
      expect(kindOf(tsBearing, 'nodes')).toBe('array');
      expect(kindOf(sql.identityBearing, 'nodes')).toBe('array');
      expect(kindOf(tsBearing, 'goal_constraints'), 'CONTRAST: a declared key that is NOT identity').toBe('none');
    });

    it('the SQL counts EXACTLY the fields isIdentityEmptyGraph counts, the same way: nodes, edges, options (non-empty arrays) and goal_node_id (present)', () => {
      const ts = Object.fromEntries(universe.map((k) => [k, kindOf(tsBearing, k)]));
      const db = Object.fromEntries(universe.map((k) => [k, kindOf(sql.identityBearing, k)]));
      expect(db).toEqual(ts);
      // the spec, named — and nothing the SQL grammar cannot express
      expect(Object.entries(ts).filter(([, v]) => v !== 'none').sort()).toEqual([
        ['edges', 'array'], ['goal_node_id', 'presence'], ['nodes', 'array'], ['options', 'array'],
      ]);
      expect([...sql.arrayKeys].sort()).toEqual(['edges', 'nodes', 'options']);
      expect(sql.presenceKeys).toEqual(['goal_node_id']);
    });

    it('on every probe graph the SQL decides what isIdentityEmptyGraph decides — including non-objects', () => {
      const probes: unknown[] = [
        undefined, null, {}, { nodes: [], edges: [] }, { nodes: [], edges: [], options: [] },
        { nodes: [{ id: 'n' }], edges: [] }, { nodes: [], edges: [{ from: 'a', to: 'b' }] },
        { nodes: [], edges: [], options: [{ id: 'o' }] }, { options: [{ id: 'o' }] },
        { nodes: [], edges: [], goal_node_id: 'g' }, { goal_node_id: null }, { goal_node_id: '' },
        { nodes: 'x', edges: {}, options: 3 }, { goal_constraints: [1], meta: { nodes: [1] } },
        [], ['goal_node_id'], 'goal_node_id', 0, 1, true, false,
      ];
      const mismatches = probes.filter((g) => sql.identityBearing(g) !== tsBearing(g)).map((g) => JSON.stringify(g));
      expect(mismatches).toEqual([]);
      // the probes are not all one answer (a probe that always agrees proves nothing)
      expect(probes.filter(tsBearing).length).toBeGreaterThan(4);
      expect(probes.filter((g) => !tsBearing(g)).length).toBeGreaterThan(4);
    });

    it('RED (2): an UNSTAMPED graph with only options, only edges or only a goal id is PRESENCE — the strict clause raises', () => {
      for (const graph of [
        { nodes: [], edges: [], options: [{ id: 'opt_contractor', label: 'Hire a contractor' }] },
        { options: [{ id: 'opt_contractor' }] },
        { nodes: [], edges: [{ from: 'fac_capacity', to: 'out_velocity' }] },
        { nodes: [], edges: [], goal_node_id: 'goal_velocity' },
        { nodes: [{ id: 'goal_velocity', kind: 'goal', label: 'Velocity' }], edges: [] }, // the existing control
      ]) {
        expect(sql.refuses({ hash: null, graph }), JSON.stringify(graph)).toBe(true);
      }
    });

    it('CONTRAST (1): a truly empty skeleton, empty entry arrays or no graph is NOT presence; a stamped hash always is', () => {
      for (const graph of [null, { nodes: [], edges: [] }, { nodes: [], edges: [], options: [] }]) {
        expect(sql.refuses({ hash: null, graph }), JSON.stringify(graph)).toBe(false);
        expect(sql.refuses({ hash: 'a'.repeat(64), graph }), 'a stamped hash is presence on its own').toBe(true);
      }
    });
  });

  it('asking for strictness without a KNOWN-EMPTY base is refused (22023), before the row lock', () => {
    const check = ifBlock(newBody, 'IF p_require_expected_empty');
    expect(check).toContain('AND (p_expected_base_known IS NOT TRUE');
    expect(check).toContain('OR p_expected_graph_identity_hash IS NOT NULL) THEN');
    expect(check).toContain("USING ERRCODE = '22023'");
    expect(newBody.indexOf('IF p_require_expected_empty\n')).toBeLessThan(newBody.indexOf('FOR UPDATE;'));
    expect(oldBody).not.toContain('strict expected-empty requires a known-empty expected base');
  });

  it('the new parameter is the LAST one and DEFAULTS TO FALSE; the rest of the list is unchanged', () => {
    const next = params(NEW_RAW);
    const prev = params(OLD_RAW);
    expect(next.slice(0, -1)).toEqual(prev);
    expect(next.at(-1)).toEqual({ name: 'p_require_expected_empty', type: 'BOOLEAN', rest: 'DEFAULT FALSE' });
    // CONTRAST: the old list ends on p_expected_base_known and has no such parameter
    expect(prev.at(-1)!.name).toBe('p_expected_base_known');
    expect(prev.map((p) => p.name)).not.toContain('p_require_expected_empty');
  });

  it('the exact OLD signature is DROPPED, inside one transaction, before the CREATE', () => {
    const drops = signatureStatements(NEW_RAW, 'DROP');
    expect(drops).toHaveLength(1);
    expect(drops[0]!.types).toEqual(params(OLD_RAW).map((p) => p.type));
    const code = executable(NEW_RAW);
    const begin = soleIndexOf(code, '\nBEGIN;\n');
    const drop = soleIndexOf(code, 'DROP FUNCTION IF EXISTS public.append_turn_atomic_v5(');
    const create = soleIndexOf(code, CREATE_HEAD);
    const commit = soleIndexOf(code, '\nCOMMIT;\n');
    expect(begin).toBeLessThan(drop);
    expect(drop).toBeLessThan(create);
    expect(code.lastIndexOf('GRANT EXECUTE')).toBeLessThan(commit);
    expect(code.slice(commit).trim()).toBe('COMMIT;');
    // CONTRAST: the old file replaces in place and drops nothing
    expect(signatureStatements(OLD_RAW, 'DROP')).toHaveLength(0);
  });

  it('REVOKE/GRANT reproduce the original exactly — same roles, over the NEW type list', () => {
    const newRevoke = signatureStatements(NEW_RAW, 'REVOKE');
    const newGrant = signatureStatements(NEW_RAW, 'GRANT');
    const oldRevoke = signatureStatements(OLD_RAW, 'REVOKE');
    const oldGrant = signatureStatements(OLD_RAW, 'GRANT');
    for (const s of [newRevoke, newGrant, oldRevoke, oldGrant]) expect(s).toHaveLength(1);
    expect(newRevoke[0]!.tail).toBe(oldRevoke[0]!.tail);
    expect(newRevoke[0]!.tail).toBe('FROM PUBLIC, anon, authenticated');
    expect(newGrant[0]!.tail).toBe(oldGrant[0]!.tail);
    expect(newGrant[0]!.tail).toBe('TO service_role');
    const newTypes = params(NEW_RAW).map((p) => p.type);
    expect(newRevoke[0]!.types).toEqual(newTypes);
    expect(newGrant[0]!.types).toEqual(newTypes);
    // CONTRAST: the old grants name the OLD list, which the new one is not
    expect(oldGrant[0]!.types).toEqual(params(OLD_RAW).map((p) => p.type));
    expect(oldGrant[0]!.types).not.toEqual(newTypes);
  });

  it('SECURITY DEFINER and search_path are unchanged, and neither file comments or re-owns the function', () => {
    const between = (body: string) => body.slice(body.indexOf(')\nRETURNS'), body.indexOf('AS $$'));
    expect(between(newBody)).toBe(between(oldBody));
    expect(between(newBody)).toContain('SECURITY DEFINER');
    expect(between(newBody)).toContain('SET search_path = pg_catalog, public');
    for (const raw of [NEW_RAW, OLD_RAW]) {
      expect(executable(raw)).not.toMatch(/COMMENT\s+ON\s+FUNCTION\s+public\.append_turn_atomic_v5/);
      expect(executable(raw)).not.toMatch(/ALTER\s+FUNCTION\s+public\.append_turn_atomic_v5[\s\S]*OWNER/);
    }
  });

  it('⛔ VERBATIM: remove the marked strict blocks and the function IS 20260920210000, byte for byte', () => {
    const fn = v5Function(NEW_RAW);
    const markers = fn.match(new RegExp(`-- ── (BEGIN|END) strict expected-empty \\(${TS}\\) ──`, 'g')) ?? [];
    expect(markers).toHaveLength(8); // four blocks: parameter, variable, argument check, clause
    const stripped = fn
      .split('\n')
      .reduce<{ out: string[]; inside: boolean }>(
        (acc, line) => {
          if (line.includes(`-- ── BEGIN strict expected-empty (${TS}) ──`)) return { ...acc, inside: true };
          if (line.includes(`-- ── END strict expected-empty (${TS}) ──`)) return { ...acc, inside: false };
          if (!acc.inside) acc.out.push(line);
          return acc;
        },
        { out: [], inside: false },
      )
      .out.join('\n')
      .replace('  p_expected_base_known          BOOLEAN DEFAULT FALSE,\n)', '  p_expected_base_known          BOOLEAN DEFAULT FALSE\n)');
    expect(stripped).toBe(v5Function(OLD_RAW));
    // CONTRAST: without the removal the two differ
    expect(fn).not.toBe(v5Function(OLD_RAW));
  });

  it('the ROLLBACK restores 20260920210000 verbatim and drops the NEW signature', () => {
    expect(v5Function(ROLLBACK_RAW)).toBe(v5Function(OLD_RAW));
    const drops = signatureStatements(ROLLBACK_RAW, 'DROP');
    expect(drops).toHaveLength(1);
    expect(drops[0]!.types).toEqual(params(NEW_RAW).map((p) => p.type));
    expect(signatureStatements(ROLLBACK_RAW, 'GRANT')).toEqual(signatureStatements(OLD_RAW, 'GRANT'));
    expect(signatureStatements(ROLLBACK_RAW, 'REVOKE')).toEqual(signatureStatements(OLD_RAW, 'REVOKE'));
    expect(executable(ROLLBACK_RAW)).toMatch(/\nBEGIN;\n[\s\S]*\nCOMMIT;\n$/);
  });

  it('it is the LAST migration that defines append_turn_atomic_v5 (it must replace the latest body)', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
    const definers = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => executable(readFileSync(`${dir}${f}`, 'utf8')).includes(CREATE_HEAD));
    // CONTRAST: the probe finds the two earlier definitions too, in order
    expect(definers).toEqual([
      '20260824200000_c8_atomic_model_version_restore.sql',
      '20260920210000_v5_append_v5_replay_precedes_cas.sql',
      `${TS}_v5_append_v5_strict_expected_empty.sql`,
    ]);
  });
});
