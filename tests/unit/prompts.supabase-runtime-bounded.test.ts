import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  prompts: [] as Array<Record<string, unknown>>,
  versions: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{
    table: string;
    columns: string;
    filters: Array<[string, unknown]>;
    ordered: boolean;
  }>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const query = {
        table,
        columns: '',
        filters: [] as Array<[string, unknown]>,
        ordered: false,
        select(columns: string) {
          this.columns = columns;
          return this;
        },
        eq(column: string, value: unknown) {
          this.filters.push([column, value]);
          return this;
        },
        order() {
          this.ordered = true;
          return this;
        },
        single() {
          const rows = this.rows();
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        rows() {
          db.queries.push({
            table: this.table,
            columns: this.columns,
            filters: [...this.filters],
            ordered: this.ordered,
          });
          const source = table === 'cee_prompts' ? db.prompts : db.versions;
          return source.filter((row) =>
            this.filters.every(([column, value]) => row[column] === value),
          );
        },
        then(resolve: (value: unknown) => void) {
          const rows = this.rows();
          resolve({ data: rows, error: null, count: rows.length });
        },
      };
      return query;
    },
  }),
}));

import { SupabasePromptStore } from '../../src/prompts/stores/supabase.js';
import { governPromptStore } from '../../src/prompts/stores/governed.js';

const canonical = {
  id: 'draft_graph_default',
  task_id: 'draft_graph',
  status: 'production',
  active_version: 2,
  staging_version: 3,
  model_config: { staging: 'test-model' },
};

beforeEach(() => {
  db.prompts = [
    { ...canonical, id: 'z-legacy-rival' },
    { ...canonical },
  ];
  db.versions = [
    { prompt_id: canonical.id, version: 1, content: 'POISONED OLD VERSION', variables: {} },
    { prompt_id: canonical.id, version: 2, content: 'ACTIVE {{name}}', variables: [] },
    { prompt_id: canonical.id, version: 3, content: 'STAGING {{name}}', variables: [] },
  ];
  db.queries = [];
});

async function store() {
  const raw = new SupabasePromptStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-key',
  });
  await raw.initialize();
  db.queries = [];
  return governPromptStore(raw);
}

describe('Supabase governed runtime lookup', () => {
  it('elects canonical authority and reads only the selected active/staging version', async () => {
    const governed = await store();

    const staging = await governed.getCompiled('draft_graph', { name: 'Paul' }, { useStaging: true });
    expect(staging).toMatchObject({
      promptId: canonical.id,
      version: 3,
      content: 'STAGING Paul',
      isStaging: true,
      modelConfig: { staging: 'test-model' },
    });
    expect(db.queries).toEqual([
      {
        table: 'cee_prompts',
        columns: 'id,task_id,status,active_version,staging_version,model_config',
        filters: [['task_id', 'draft_graph']],
        ordered: false,
      },
      {
        table: 'cee_prompt_versions',
        columns: 'version,content,variables',
        filters: [['prompt_id', canonical.id], ['version', 3]],
        ordered: false,
      },
    ]);

    db.queries = [];
    const active = await governed.getCompiled('draft_graph', { name: 'Paul' }, { useStaging: false });
    expect(active).toMatchObject({ version: 2, content: 'ACTIVE Paul', isStaging: false });
    expect(db.queries[1]?.filters).toContainEqual(['version', 2]);
    expect(db.queries.every((query) => !query.ordered && query.columns !== '*')).toBe(true);
  });

  it('does not elect a rival if the canonical row is archived', async () => {
    db.prompts[1] = { ...canonical, status: 'archived' };
    const governed = await store();

    expect(await governed.getCompiled('draft_graph', {}, { useStaging: true })).toBeNull();
    expect(db.queries.map((query) => query.table)).toEqual(['cee_prompts']);
  });
});
