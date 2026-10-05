-- Align store_draft_graph(uuid, jsonb) with 20260708130000: service-role-only
-- V5 write RPC. Revoke anon (idempotent; a no-op where anon holds no grant).
-- service_role and postgres keep EXECUTE. Applied manually, like 20260708.
REVOKE EXECUTE ON FUNCTION public.store_draft_graph(uuid, jsonb) FROM anon;
