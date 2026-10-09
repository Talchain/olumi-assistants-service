-- Temporary-session helper: exact public catalogue identity/definitions/ACLs,
-- omitting data/statistics that naturally change during a rehearsal.
CREATE OR REPLACE FUNCTION pg_temp.phase2_catalogue() RETURNS jsonb LANGUAGE sql AS $catalogue$
  WITH entries AS (
    SELECT 'relation'::text AS kind, c.oid AS id, jsonb_build_object('name', c.relname, 'kind', c.relkind,
      'owner', c.relowner, 'acl', c.relacl, 'options', c.reloptions, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'view', CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) ELSE NULL END,
      'index', CASE WHEN c.relkind = 'i' THEN pg_get_indexdef(c.oid) ELSE NULL END) AS definition
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'function', p.oid, jsonb_build_object('definition', pg_get_functiondef(p.oid), 'owner', p.proowner, 'acl', p.proacl)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind <> 'a'
    UNION ALL
    SELECT 'trigger', t.oid, jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'constraint', x.oid, jsonb_build_object('name', x.conname, 'definition', pg_get_constraintdef(x.oid), 'validated', x.convalidated)
      FROM pg_constraint x JOIN pg_namespace n ON n.oid = x.connamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'type', t.oid, jsonb_build_object('name', t.typname, 'owner', t.typowner, 'kind', t.typtype, 'relation', t.typrelid, 'element', t.typelem, 'array', t.typarray, 'base', t.typbasetype)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'columns', c.oid, jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid), 'acl', a.attacl) ORDER BY a.attnum)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped GROUP BY c.oid
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'definition', definition) ORDER BY kind, id), '[]') FROM entries;
$catalogue$;
