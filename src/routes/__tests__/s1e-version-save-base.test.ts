/**
 * S1-E: real HTTP save/list, round mint, version service and RPC adapter.
 * Only createClient is replaced, at the persistence boundary. Authentication
 * verifies a real ES256 token against a local JWKS server. The fake RPC models
 * the row-locked SQL contract; SQL-text rows separately pin its actual guards.
 * RED at base: save returns 200 (expected 409); mint resolves (expected refusal)
 * because neither caller carries a known base to create_model_version.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { SupabaseClient } from '@supabase/supabase-js';

const boundary = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@supabase/supabase-js')>(),
  createClient: () => {
    if (!boundary.client) throw new Error('Persistence fixture not initialised');
    return boundary.client;
  },
}));

import versionsRoute from '../assist.v1.scenario-versions.js';
import { SupabaseCollabStore } from '../../collab/store.js';
import { mintRound } from '../../collab/rounds-service.js';
import { resetModelManagementServiceForTests } from '../../orchestrator-v5/model-management/index.js';
import { resetSessionStoreForTests } from '../../orchestrator-v5/session/index.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { _resetConfigCache } from '../../config/index.js';
import { resetSupabaseJwksCacheForTests } from '../../utils/supabase-user-jwt.js';

const SCENARIO = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
const graph = (label: string) => ({ nodes: [{ id: 'n1', kind: 'factor' as const, label }], edges: [] });
type Row = Record<string, unknown>;
const copy = <T>(value: T): T => structuredClone(value);
const identity = (g: ReturnType<typeof graph>) => {
  const value = computeGraphIdentityHash(g);
  if (!value) throw new Error('Fixture graph has no identity');
  return value;
};
let scenario: Row;
let versions: Row[];
let rounds: Row[];
let events: Row[];
let calls: Row[];
let beforeWrite: (() => void) | null;
let jwksServer: Server;
let token: string;

function addVersion(g: ReturnType<typeof graph>): Row {
  const h = identity(g);
  const number = versions.length + 1;
  const row: Row = {
    id: `aaaaaaaa-1111-4111-8111-${String(number).padStart(12, '0')}`,
    scenario_id: SCENARIO, owner_user_id: OWNER, version_number: number,
    graph: copy(g), graph_identity_hash: h.value, hash_algorithm: h.algorithm,
    identity_projection_version: h.projection_version,
    identity_normaliser_version: h.normaliser_version, graph_schema_version: h.graph_schema_version,
    analysis_affecting_hash: 'a'.repeat(64), mutation_id: null, parent_version_id: null,
    root_version_id: null, actor_kind: null, authored_by: null, creation_kind: null,
    source_version_id: null, source_turn_id: null, restored_from_version_id: null,
    label: null, provenance: 'user_save', created_at: '2026-10-06T12:00:00.000Z',
  };
  versions.push(row);
  scenario.current_model_version_id = row.id;
  (scenario.events as Row[]).push({ event_id: `event_${row.id}`, type: 'model_version_created' });
  return row;
}

function persistenceClient(): SupabaseClient {
  return {
    rpc: async (name: string, args: Row) => {
      if (name === 'ensure_scenario_exists') return { data: OWNER, error: null };
      if (name !== 'create_model_version') throw new Error(`Unexpected RPC ${name}`);
      calls.push(copy(args));
      const interleave = beforeWrite;
      beforeWrite = null;
      interleave?.(); // A peer commits AFTER the caller read, BEFORE the lock.
      const conflict = () => ({ data: null, error: { code: 'MV409', message: 'base moved' } });
      if (args.p_base_known === true && (
        args.p_expected_working_graph_identity_hash !== args.p_graph_identity_hash ||
        JSON.stringify(scenario.graph) !== JSON.stringify(args.p_graph) ||
        (scenario.graph_identity_hash !== null &&
          scenario.graph_identity_hash !== args.p_expected_working_graph_identity_hash)
      )) return conflict();
      const head = versions.find(v => v.id === scenario.current_model_version_id);
      // Preserve the live optional hash CAS before no-op dedupe. Omitted
      // legacy arguments default to NULL in PostgreSQL.
      if (args.p_expected_graph_identity_hash != null &&
        head?.graph_identity_hash !== args.p_expected_graph_identity_hash) return conflict();
      if (args.p_base_known === true &&
        scenario.current_model_version_id !== args.p_expected_head_version_id) return conflict();
      if (head && head.graph_identity_hash === args.p_graph_identity_hash &&
        head.identity_projection_version === args.p_projection_version &&
        head.identity_normaliser_version === args.p_normaliser_version &&
        head.graph_schema_version === args.p_graph_schema_version) {
        return { data: { version_id: head.id, version_number: head.version_number,
          graph_identity_hash: head.graph_identity_hash, deduped: true, event_id: null }, error: null };
      }
      const row = addVersion(args.p_graph as ReturnType<typeof graph>);
      return { data: { version_id: row.id, version_number: row.version_number,
        graph_identity_hash: row.graph_identity_hash, deduped: false, event_id: `event_${row.id}` }, error: null };
    },
    from: (table: string) => {
      const filters: Row = {};
      let max = Infinity;
      let patch: Row | null = null;
      const rows = () => {
        const all = table === 'scenarios' ? [scenario] : table === 'model_versions' ? versions
          : table === 'elicitation_rounds' ? rounds : table === 'round_events' ? events : [];
        const matching = all.filter(row => Object.entries(filters).every(([k, v]) => row[k] === v));
        if (patch) matching.forEach(row => Object.assign(row, patch));
        return copy(matching.slice().reverse().slice(0, max));
      };
      const query = {
        select: (_columns: string) => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        order: () => query,
        abortSignal: () => query,
        limit: (n: number) => { max = n; return query; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: async (row: Row) => {
          (table === 'elicitation_rounds' ? rounds : events).push(copy(row));
          return { data: null, error: null };
        },
        update: (value: Row) => { patch = value; return query; },
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: rows(), error: null })),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

beforeAll(async () => {
  const keys = await generateKeyPair('ES256');
  const publicKey = { ...await exportJWK(keys.publicKey), kid: 's1e', alg: 'ES256' };
  jwksServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [publicKey] }));
  });
  await new Promise<void>(resolve => jwksServer.listen(0, '127.0.0.1', resolve));
  const address = jwksServer.address();
  if (!address || typeof address === 'string') throw new Error('JWKS server unavailable');
  vi.stubEnv('SUPABASE_JWKS_URL', `http://127.0.0.1:${address.port}/jwks`);
  vi.stubEnv('SUPABASE_URL', 'https://s1e.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 's1e-fixture-only');
  vi.stubEnv('ASSIST_API_KEYS', 's1e-fixture-only');
  vi.stubEnv('CEE_REQUIRE_USER_JWT', 'true');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 's1e' })
    .setSubject(OWNER).setIssuer('https://s1e.invalid/auth/v1').setAudience('authenticated')
    .setExpirationTime('1h').sign(keys.privateKey);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => jwksServer.close(err => err ? reject(err) : resolve()));
  resetSupabaseJwksCacheForTests();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

beforeEach(() => {
  _resetConfigCache();
  resetModelManagementServiceForTests();
  resetSessionStoreForTests();
  scenario = { id: SCENARIO, user_id: OWNER, graph: graph('Working model'),
    graph_identity_hash: identity(graph('Working model')).value, current_model_version_id: null, events: [] };
  versions = []; rounds = []; events = []; calls = []; beforeWrite = null;
  addVersion(graph('Earlier model'));
  boundary.client = persistenceClient();
});

async function http(method: 'GET' | 'POST', suffix: string, payload?: Row) {
  const app = Fastify();
  await app.register(versionsRoute);
  try {
    return await app.inject({ method, url: `/assist/v1/scenarios/${SCENARIO}/versions${suffix}`,
      headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  } finally { await app.close(); }
}

const mint = () => mintRound(new SupabaseCollabStore(boundary.client!), {
  scenario_id: SCENARIO, actor: { kind: 'owner', user_id: OWNER }, context_note: null,
  target_manifest: [{ target: { kind: 'factor', id: 'n1' }, label: 'Working model', description: null, unit: null }],
});

describe('S1-E read-to-write base through the real commit doors', () => {
  for (const writer of ['save', 'mint'] as const) {
    for (const change of ['head', 'working', 'unstamped working', 'first head'] as const) {
      it(`${writer}: refuses a moved ${change}; cold history and round rows unchanged`, async () => {
        if (change === 'first head') { versions = []; scenario.current_model_version_id = null; scenario.events = []; }
        if (change === 'unstamped working') scenario.graph_identity_hash = null;
        let peerState: unknown;
        beforeWrite = () => {
          if (change === 'head' || change === 'first head') addVersion(graph('Peer version'));
          else {
            scenario.graph = graph('Peer working model');
            if (change === 'working') scenario.graph_identity_hash = identity(graph('Peer working model')).value;
          }
          peerState = copy({ versions, head: scenario.current_model_version_id, graph: scenario.graph, events: scenario.events });
        };
        if (writer === 'save') {
          const response = await http('POST', '/save', { label: 'My save' });
          expect(response.statusCode).toBe(409);
          expect(response.json().details.code).toBe('VERSION_STALE');
        } else await expect(mint()).rejects.toThrow('(conflict)');
        expect(calls).toHaveLength(1);
        expect(calls[0]!.p_base_known).toBe(true);
        expect({ versions, head: scenario.current_model_version_id, graph: scenario.graph, events: scenario.events }).toEqual(peerState);
        expect(rounds).toEqual([]);
        expect(events).toEqual([]);
        resetModelManagementServiceForTests();
        resetSessionStoreForTests();
        const cold = await http('POST', '', {});
        expect(cold.statusCode).toBe(200);
        expect(cold.json().versions.map((v: { version_id: string }) => v.version_id))
          .toEqual(versions.slice().reverse().map(v => v.id));
        expect(cold.json().current_version_id).toBe(scenario.current_model_version_id);
      });
    }

    it(`${writer}: normal and known-empty head succeed and use the returned version`, async () => {
      for (const empty of [false, true]) {
        if (empty) { versions = []; scenario.current_model_version_id = null; scenario.events = []; }
        const base = scenario.current_model_version_id;
        if (writer === 'save') expect((await http('POST', '/save', {})).statusCode).toBe(200);
        else {
          const round = await mint();
          expect(round.graph_version_ref).toBe(scenario.current_model_version_id);
          expect(round.graph_version_ref).not.toBe(base);
        }
        expect(calls.at(-1)!.p_expected_head_version_id).toBe(base);
        expect(calls.at(-1)!.p_expected_working_graph_identity_hash).toBe(scenario.graph_identity_hash);
      }
    });

    it(`${writer}: same-target peer commit refuses a moved captured head before dedupe`, async () => {
      let peerState: unknown;
      beforeWrite = () => {
        addVersion(scenario.graph as ReturnType<typeof graph>);
        peerState = copy(scenario);
      };
      if (writer === 'save') {
        const saved = await http('POST', '/save', {});
        expect(saved.statusCode).toBe(409);
        expect(saved.json().details.code).toBe('VERSION_STALE');
      } else await expect(mint()).rejects.toThrow('(conflict)');
      expect(scenario).toEqual(peerState);
      expect(versions).toHaveLength(2);
      expect(rounds).toEqual([]);
      expect(events).toEqual([]);
      resetModelManagementServiceForTests();
      resetSessionStoreForTests();
      const cold = await http('POST', '', {});
      expect(cold.statusCode).toBe(200);
      expect(cold.json().versions.map((v: { version_id: string }) => v.version_id))
        .toEqual(versions.slice().reverse().map(v => v.id));
      expect(cold.json().current_version_id).toBe(scenario.current_model_version_id);
    });

    it(`${writer}: unchanged captured head and working graph still dedupe`, async () => {
      addVersion(scenario.graph as ReturnType<typeof graph>);
      const prior = copy(scenario);
      if (writer === 'save') {
        const saved = await http('POST', '/save', {});
        expect(saved.statusCode).toBe(200);
        expect(saved.json().version.deduped).toBe(true);
      } else expect((await mint()).graph_version_ref).toBe(scenario.current_model_version_id);
      expect(versions).toHaveLength(2);
      expect(scenario).toEqual(prior);
    });
  }

  it('caller head-hash expectation remains enforced', async () => {
    const response = await http('POST', '/save', { expected_graph_identity_hash: 'f'.repeat(64) });
    expect(response.statusCode).toBe(409);
    expect(versions).toHaveLength(1);
  });

  it('caller head-hash mismatch refuses even when the target matches the head', async () => {
    addVersion(scenario.graph as ReturnType<typeof graph>);
    const prior = copy(scenario);
    const response = await http('POST', '/save', { expected_graph_identity_hash: 'f'.repeat(64) });
    expect(response.statusCode).toBe(409);
    expect(response.json().details.code).toBe('VERSION_STALE');
    expect(versions).toHaveLength(2);
    expect(scenario).toEqual(prior);
  });

  it('a stale working graph cannot dedupe to an old saved head', async () => {
    addVersion(scenario.graph as ReturnType<typeof graph>);
    beforeWrite = () => { scenario.graph = graph('Peer unsaved edit'); };
    expect((await http('POST', '/save', {})).statusCode).toBe(409);
    expect(versions).toHaveLength(2);
  });
});

describe('S1-E SQL transaction guards (authored, not executed)', () => {
  it('latest definition locks, checks working and both head bases before dedupe and insert', () => {
    // Resolve from repository root rather than a pinned historic migration.
    const root = new URL('../../../', import.meta.url);
    const migrations = new URL('supabase/migrations/', root);
    const latest = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort().reverse()
      .map(name => readFileSync(new URL(name, migrations), 'utf8'))
      .find(sql => sql.includes('CREATE OR REPLACE FUNCTION public.create_model_version('));
    expect(latest).toBeDefined();
    const sql = latest!;
    const markers = ['FOR UPDATE;', 'v_working_graph IS DISTINCT FROM p_graph',
      'IF p_expected_graph_identity_hash IS NOT NULL',
      'v_head_id IS DISTINCT FROM p_expected_head_version_id', "'deduped', true",
      'INSERT INTO public.model_versions'];
    const positions = markers.map(marker => sql.indexOf(marker));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.slice().sort((a, b) => a - b));
    expect(sql).toContain('IF p_base_known IS TRUE THEN');
    expect(sql).toContain('IF p_base_known IS TRUE\n     AND v_head_id IS DISTINCT FROM p_expected_head_version_id');
    expect(sql).toContain('v_working_identity_hash IS DISTINCT FROM p_expected_working_graph_identity_hash');
    expect(sql).toContain("USING ERRCODE = 'MV409'");
    expect(sql).toContain('DROP FUNCTION public.create_model_version(');
    expect(sql).toContain(') FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain(') TO service_role;');
  });
});
