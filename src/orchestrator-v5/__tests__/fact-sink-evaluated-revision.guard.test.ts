/** Textual source guard: latest fact sinks must retain frozen revision metadata. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_ROOT = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
type Definition = { name: string; file: string; body: string };

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function latestDefinitions(migrations: { file: string; sql: string }[]): Definition[] {
  const latest = new Map<string, Definition>();
  for (const { file, sql } of [...migrations].sort((a, b) => a.file.localeCompare(b.file))) {
    const definitions = stripComments(sql).matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\s*\.\s*)?(\w+)\s*\([\s\S]*?\bAS\s+(\$(?:\w+)?\$)([\s\S]*?)\2/gi,
    );
    for (const match of definitions) {
      const name = match[1].toLowerCase();
      latest.set(name, { name, file, body: match[3] });
    }
  }
  return [...latest.values()];
}

const insertsFacts = (body: string): boolean =>
  /\bINSERT\s+INTO\s+(?:public\s*\.\s*)?v5_handler_facts\b/i.test(body);
const missingRevision = (definitions: Definition[]): string[] =>
  definitions.filter(({ body }) => insertsFacts(body) && !/\bevaluated_scenario_revision\b/i.test(body))
    .map(({ name, file }) => `${name} in ${file}`);
const LATEST = latestDefinitions(readdirSync(MIGRATIONS_ROOT)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_ROOT, file), 'utf8') })));

describe('B2 — every latest fact INSERT retains evaluated_scenario_revision', () => {
  it('the four fact INSERT CASE blocks are byte-identical to the complete v4 expression', () => {
    const blocks = [
      ['append_turn_atomic', '20261009170000_b2_fact_revision_all_appends.sql'],
      ['append_turn_atomic_v2', '20261009170000_b2_fact_revision_all_appends.sql'],
      ['append_turn_atomic_v3', '20261009170000_b2_fact_revision_all_appends.sql'],
      ['append_turn_atomic_v4', '20261009160000_b2_fact_evaluated_revision.sql'],
    ].map(([name, file]) => {
      // Read raw bytes: stripping comments or normalising whitespace could hide drift.
      const sql = readFileSync(join(MIGRATIONS_ROOT, file), 'utf8');
      const body = sql.match(new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$`,
      ))?.[1];
      expect(body, `${name} in ${file}`).toBeDefined();
      // Stop at the INSERT terminator, not the first nested CASE's END.
      const block = body?.match(
        /^ {8}CASE WHEN jsonb_typeof\(v_fact->'evaluated_scenario_revision'\)[\s\S]*?(?=\n {6}\);)/m,
      )?.[0];
      expect(block, `${name} in ${file}: missing CASE block`).toBeDefined();
      return { name, file, block };
    });
    const reference = blocks[3].block;
    expect(reference).toMatch(/\n {10}ELSE NULL END\n {8}ELSE NULL END$/);
    for (const { name, file, block } of blocks) {
      expect(block, `${name} in ${file}`).toBe(reference);
    }
  });

  it('CONTROL — finds at least the four known fact-inserting functions', () => {
    const sinks = LATEST.filter(({ body }) => insertsFacts(body)).map(({ name }) => name);
    expect(sinks.length).toBeGreaterThanOrEqual(4);
    expect(sinks).toEqual(expect.arrayContaining([
      'append_turn_atomic', 'append_turn_atomic_v2', 'append_turn_atomic_v3', 'append_turn_atomic_v4',
    ]));
  });

  it('CONTROL — strips comments, selects the latest definition and flags a planted missing column', () => {
    const definitions = latestDefinitions([
      { file: '002.sql', sql: `-- evaluated_scenario_revision in prose
        /* CREATE FUNCTION fake() AS $$ INSERT INTO v5_handler_facts; $$; */
        CREATE OR REPLACE FUNCTION public.planted() RETURNS void AS $body$
          INSERT INTO public.v5_handler_facts (payload) VALUES ('{}');
        $body$ LANGUAGE sql;` },
      { file: '001.sql', sql: `CREATE FUNCTION planted() RETURNS void AS $$
        INSERT INTO v5_handler_facts (evaluated_scenario_revision) VALUES (7);
        $$ LANGUAGE sql;` },
    ]);
    expect(definitions).toHaveLength(1);
    expect(missingRevision(definitions)).toEqual(['planted in 002.sql']);
    expect(missingRevision([{ name: 'safe', file: '003.sql', body:
      'INSERT INTO v5_handler_facts (evaluated_scenario_revision) VALUES (7);' }])).toEqual([]);
  });

  it('no latest fact-inserting body drops the frozen revision (failure names function and file)', () => {
    expect(missingRevision(LATEST)).toEqual([]);
  });
});
