/**
 * store_draft_graph(uuid, jsonb) is a service-role-only V5 write RPC.
 *
 * Replays every top-level migration's GRANT/REVOKE EXECUTE statements for the
 * function, in filename order, starting from Supabase's default privileges on a
 * new public function (EXECUTE to anon, authenticated and service_role; the A4
 * lesson in `migration-static-guards.test.ts`). The replayed end state must leave
 * only service_role, so a fresh build from this repo's history reproduces the
 * service-role-only posture. Text-level, comment-stripped; not a live check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const CREATED_IN = '20260422120000_v5_store_draft_graph.sql';

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

const STATEMENT =
  /\b(GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?store_draft_graph\s*\(\s*uuid\s*,\s*jsonb\s*\)\s+(TO|FROM)\s+([^;]+);/gi;

function replay(files: readonly string[]) {
  const holders = new Set<string>();
  let statements = 0;
  for (const f of files) {
    if (f === CREATED_IN) ['anon', 'authenticated', 'service_role'].forEach((r) => holders.add(r));
    const code = stripComments(readFileSync(DIR + f, 'utf8'));
    for (const m of code.matchAll(STATEMENT)) {
      statements += 1;
      const roles = m[3].split(',').map((r) => r.trim().toLowerCase());
      for (const r of roles) {
        if (m[1].toUpperCase() === 'GRANT') holders.add(r);
        else holders.delete(r);
      }
    }
  }
  return { holders, statements };
}

describe('store_draft_graph grants: service-role only after a full migration replay', () => {
  it('the replay sees the function created and every grant statement (positive control)', () => {
    expect(FILES, 'precondition: the creating migration is in the history').toContain(CREATED_IN);
    // 20260422: REVOKE PUBLIC + GRANT authenticated; 20260708: REVOKE authenticated; 20261005: REVOKE anon.
    expect(replay(FILES).statements).toBeGreaterThanOrEqual(4);
  });

  it('leaves EXECUTE with service_role only: neither anon nor authenticated', () => {
    const { holders } = replay(FILES);
    expect([...holders].sort()).toEqual(['service_role']);
  });

  it('discriminating twin: without the anon revoke, the replay still grants anon', () => {
    const withoutAnonRevoke = FILES.filter((f) => f !== '20261005150000_v5_revoke_store_draft_graph_anon.sql');
    expect(withoutAnonRevoke.length, 'precondition: the twin really dropped one file').toBe(FILES.length - 1);
    expect(replay(withoutAnonRevoke).holders.has('anon')).toBe(true);
  });
});
