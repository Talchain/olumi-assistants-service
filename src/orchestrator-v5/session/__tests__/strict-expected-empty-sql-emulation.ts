/**
 * THE STRICT EXPECTED-EMPTY PRESENCE READ, LIFTED FROM THE MIGRATION FILE — never restated.
 *
 * Migration 20260924030000 refuses a strict (`p_require_expected_empty`) append when the
 * scenario row already carries a graph. For an UNSTAMPED row (`graph_identity_hash` NULL:
 * written by append_turn_atomic_v2, store_draft_graph or the pre-v3 append) that decision is
 * a jsonb expression over `scenarios.graph`. CI cannot reach Postgres, so two suites need to
 * know what that expression decides:
 *   - `append-turn-atomic-v5-strict-expected-empty-static-guards.test.ts` pins it against
 *     the canonical TS rule (`isIdentityEmptyGraph`, graph-identity.ts), and
 *   - `supabase-store-atomic-version-v5.test.ts` uses it as the rpc double's strict clause.
 * Both read it from HERE, and this reads it from the FILE: edit the SQL and both suites see
 * the edit. A hand-written JS copy of the predicate would stay green while the SQL drifted.
 *
 * ⛔ FAIL-CLOSED PARSE. The expression is accepted only in the forms below; any other text
 * THROWS rather than being skipped, so a term this parser does not understand can never be
 * silently dropped from the emulation:
 *   [CASE WHEN jsonb_typeof(graph) = 'object' THEN] term (OR term)* [ELSE FALSE END]
 *   term := (CASE WHEN jsonb_typeof(graph -> 'k') = 'array'
 *                 THEN jsonb_array_length(graph -> 'k') > 0 ELSE FALSE END)   -- array term
 *         | (graph ? 'k')                                                      -- key term
 * and the refusal line must be exactly `IF v_current_hash IS NOT NULL OR <var> IS TRUE THEN`.
 *
 * WHAT THIS IS NOT: a Postgres evaluation. The jsonb semantics are modelled on JSON-origin
 * values (the column is jsonb, so fixtures are JSON-round-tripped first): `jsonb_typeof`
 * maps to the JSON type, `->` of an absent key is SQL NULL, `?` on an object tests key
 * presence whatever the value (JSON null included) and, on a string or array, top-level
 * string equality / membership. The SQL itself has still never been parsed by Postgres.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STRICT_MIGRATION_FILE = '20260924030000_v5_append_v5_strict_expected_empty.sql';

export interface StrictPresenceSql {
  /** The PL/pgSQL variable the presence read is `SELECT … INTO`. */
  readonly variable: string;
  /** True when the expression is wrapped in `CASE WHEN jsonb_typeof(graph) = 'object'`. */
  readonly objectGuarded: boolean;
  /** Keys whose value counts only as a NON-EMPTY jsonb array. */
  readonly arrayKeys: readonly string[];
  /** Keys whose mere presence (`graph ? 'k'`) counts. */
  readonly presenceKeys: readonly string[];
  /** The value the SQL assigns to {@link variable} for this stored `scenarios.graph`. */
  identityBearing(storedGraph: unknown): boolean;
  /** Does the strict clause raise OLGC1 for a row in this state? */
  refuses(row: { readonly hash: string | null; readonly graph: unknown }): boolean;
}

/** Comment-stripped view — the emulation must read executable SQL, never prose. */
export function executableSql(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** The IF block whose opening line is EXACTLY `head` (trimmed, and unique), through its matching END IF. */
function ifBlock(body: string, head: string): string {
  const lines = body.split('\n');
  const hits = lines.flatMap((l, i) => (l.trim() === head ? [i] : []));
  if (hits.length !== 1) throw new Error(`IF block head must occur exactly once (found ${hits.length}): ${head}`);
  const start = hits[0]!;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*IF\s/.test(lines[i]!)) depth++;
    if (/^\s*END IF;/.test(lines[i]!)) depth--;
    if (depth === 0) return lines.slice(start, i + 1).join('\n');
  }
  throw new Error(`unbalanced IF block: ${head}`);
}

const OBJECT_GUARD = /^CASE WHEN jsonb_typeof\(graph\) = 'object' THEN (.*) ELSE FALSE END$/;
const ARRAY_TERM =
  /^(\()?CASE WHEN jsonb_typeof\(graph -> '([a-z_]+)'\) = 'array' THEN jsonb_array_length\(graph -> '\2'\) > 0 ELSE FALSE END(\))?/;
const KEY_TERM = /^(\()?graph \? '([a-z_]+)'(\))?/;

type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
function jsonbTypeof(v: unknown): JsonType | null {
  if (v === undefined) return null; // SQL NULL: an absent key, or a NULL column
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object' || t === 'string' || t === 'number' || t === 'boolean') return t;
  throw new Error(`not a JSON value: ${t}`);
}
/** `v -> 'k'`: SQL NULL (undefined) unless v is an object carrying k. */
function arrow(v: unknown, k: string): unknown {
  return jsonbTypeof(v) === 'object' && Object.hasOwn(v as object, k) ? (v as Record<string, unknown>)[k] : undefined;
}
/** `v ? 'k'` (jsonb_exists). */
function exists(v: unknown, k: string): boolean {
  switch (jsonbTypeof(v)) {
    case 'object': return Object.hasOwn(v as object, k);
    case 'string': return v === k;
    case 'array': return (v as unknown[]).some((e) => e === k);
    default: return false;
  }
}

/**
 * Parse the strict clause's presence read out of the migration text (default: the file on
 * disk). Throws on anything it does not recognise.
 */
export function strictPresenceFromMigration(sqlText?: string): StrictPresenceSql {
  const raw =
    sqlText ??
    readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${STRICT_MIGRATION_FILE}`, import.meta.url)), 'utf8');
  const strict = ifBlock(executableSql(raw), 'IF p_require_expected_empty THEN');
  const read = ifBlock(strict, 'IF v_current_hash IS NULL THEN');

  const flat = read.replace(/\s+/g, ' ').trim();
  const sel = /^IF v_current_hash IS NULL THEN SELECT (.+) INTO ([a-z_]+) FROM public\.scenarios WHERE id = p_scenario_id; END IF;$/.exec(flat);
  if (sel === null) throw new Error(`presence read not in the recognised SELECT … INTO form: ${flat}`);
  const variable = sel[2]!;

  const refusal = strict
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('IF v_current_hash IS NOT NULL'));
  if (refusal.length !== 1 || refusal[0] !== `IF v_current_hash IS NOT NULL OR ${variable} IS TRUE THEN`) {
    throw new Error(`refusal condition not recognised: ${JSON.stringify(refusal)}`);
  }

  let expr = sel[1]!.trim();
  const guard = OBJECT_GUARD.exec(expr);
  const objectGuarded = guard !== null;
  if (guard) expr = guard[1]!.trim();

  const arrayKeys: string[] = [];
  const presenceKeys: string[] = [];
  let rest = expr;
  for (;;) {
    const a = ARRAY_TERM.exec(rest);
    const k = a === null ? KEY_TERM.exec(rest) : null;
    const m = a ?? k;
    if (m === null) throw new Error(`unrecognised presence term at: ${rest}`);
    if ((m[1] === '(') !== (m[3] === ')')) throw new Error(`unbalanced parentheses at: ${rest}`);
    (a !== null ? arrayKeys : presenceKeys).push(m[2]!);
    rest = rest.slice(m[0].length).trim();
    if (rest === '') break;
    if (!rest.startsWith('OR ')) throw new Error(`expected OR between presence terms at: ${rest}`);
    rest = rest.slice(3).trim();
  }

  const identityBearing = (storedGraph: unknown): boolean => {
    // The column is jsonb: model what Postgres would hold.
    const g: unknown = storedGraph === undefined ? undefined : JSON.parse(JSON.stringify(storedGraph));
    if (objectGuarded && jsonbTypeof(g) !== 'object') return false;
    return (
      arrayKeys.some((key) => {
        const v = arrow(g, key);
        return jsonbTypeof(v) === 'array' && (v as unknown[]).length > 0;
      }) || presenceKeys.some((key) => exists(g, key))
    );
  };

  return {
    variable,
    objectGuarded,
    arrayKeys,
    presenceKeys,
    identityBearing,
    // The graph is read only when the hash is NULL; a stamped hash is presence on its own.
    refuses: (row) => row.hash !== null || identityBearing(row.graph === null ? undefined : row.graph),
  };
}
